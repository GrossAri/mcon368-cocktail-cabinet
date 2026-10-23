const test = require('node:test');
const assert = require('node:assert');
const Bot = require('../js/bot.js');
const P = require('../js/protocol.js');

function seeded(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

test('bot replies are non-empty, bounded and never admit to being an AI', () => {
  const bot = Bot.createBot({ rng: seeded(1) });
  const inputs = ['hi', 'are you a bot?', 'what did you eat', 'asdf', 'x'.repeat(300), 'where do you live', '12 + 30'];
  for (const i of inputs) {
    const r = bot.reply(i);
    assert.ok(r.text.length > 0);
    assert.ok(r.delayMs > 0 && r.delayMs < 4000, 'think time ' + r.delayMs);
    assert.ok(r.typingMs < 10000);
    assert.ok(!/as an ai|language model/i.test(r.text));
  }
});

test('bot does not repeat the same canned reply back-to-back for repeated prompts', () => {
  const bot = Bot.createBot({ rng: seeded(7) });
  const seen = new Set();
  for (let i = 0; i < 4; i++) seen.add(bot.reply('are you a bot?').text.replace(/[.?!]$/, ''));
  assert.ok(seen.size >= 3, 'got ' + [...seen].join(' | '));
});

test('bot delays scale with speed factor', () => {
  const slow = Bot.createBot({ rng: () => 0.5, speed: 1 }).reply('hello there');
  const fast = Bot.createBot({ rng: () => 0.5, speed: 0.01 }).reply('hello there');
  assert.ok(fast.delayMs * 50 < slow.delayMs);
});

test('judge: human-like answers are classified human, robotic ones AI', () => {
  const human = Bot.judgeAnswers([
    { text: 'ugh just woke up, coffee lol', ms: 2600 }, { text: '43 i think', ms: 4100 },
    { text: 'half a bagel', ms: 1900 }, { text: 'honestly the beach', ms: 3300 }, { text: 'i dunno... my cat?', ms: 2200 }]);
  assert.strictEqual(human.verdict, 'human');
  const robot = Bot.judgeAnswers([
    { text: 'My morning has been productive and I have completed several tasks in an efficient manner.', ms: 300 },
    { text: 'The sum of 17 and 26 is 43.', ms: 310 }, { text: 'I recently consumed a balanced meal consisting of grains.', ms: 305 },
    { text: 'I would choose a location that offers relaxation and cultural enrichment.', ms: 298 },
    { text: 'As an AI language model, I do not have personal experiences.', ms: 302 }]);
  assert.strictEqual(robot.verdict, 'ai');
  assert.ok(robot.signals.length > 0);
});

test('parseMessage accepts valid messages and rejects malformed/hostile ones', () => {
  assert.deepStrictEqual(P.parseMessage('{"t":"msg","text":"hi"}'), { t: 'msg', text: 'hi' });
  assert.strictEqual(P.parseMessage('not json'), null);
  assert.strictEqual(P.parseMessage('{"t":"evil"}'), null);
  assert.strictEqual(P.parseMessage('{"t":"msg","text":"  "}'), null);
  assert.strictEqual(P.parseMessage('{"t":"msg","text":5}'), null);
  assert.strictEqual(P.parseMessage('{"t":"round","n":0,"judge":"host"}'), null);
  assert.strictEqual(P.parseMessage('{"t":"verdict","guess":"maybe"}'), null);
  assert.strictEqual(P.parseMessage({ t: 'msg', text: 'a'.repeat(5000) }).text.length, P.MAX_TEXT);
  assert.deepStrictEqual(P.parseMessage('{"t":"round","n":2,"judge":"guest","extra":1}'), { t: 'round', n: 2, judge: 'guest' });
});

test('signalling codes round-trip and reject garbage / wrong type', async () => {
  const desc = { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n' + 'a=candidate:1 1 udp 1 1.2.3.4 5 typ host\r\n'.repeat(20) };
  const code = await P.encodeCode(desc);
  assert.ok(code.startsWith('IMG1.'));
  assert.deepStrictEqual(await P.decodeCode(code, 'offer'), desc);
  assert.deepStrictEqual(await P.decodeCode('  ' + code.slice(0, 10) + '\n' + code.slice(10) + ' ', 'offer'), desc); // whitespace tolerated
  await assert.rejects(P.decodeCode(code, 'answer'), /invite code/);
  await assert.rejects(P.decodeCode('hello', 'offer'), /does not look/);
  await assert.rejects(P.decodeCode(code.slice(0, 30), 'offer'), /damaged/);
  await assert.rejects(P.decodeCode('', 'offer'), /does not look/);
});
