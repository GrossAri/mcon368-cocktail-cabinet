/* End-to-end tests: two independent Chromium PROCESSES connect over real WebRTC
 * (manual code exchange, loopback ICE, no STUN, no signalling server). Run: node tests/e2e.js */
const http = require('http'), fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright')); }

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'text/plain' }); res.end(fs.readFileSync(f));
});

const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, true]); console.log('PASS', name); }
  catch (e) { results.push([name, false]); console.log('FAIL', name, '\n  ', e.message.split('\n')[0]); }
}
const T = (id) => `[data-testid="${id}"]`;
const log = (p) => p.locator(T('chat-log')).innerText();

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/index.html?fast=1&stun=0`;
  const args = ['--disable-features=WebRtcHideLocalIpsWithMdns', '--no-sandbox'];
  // Two separate browser processes = two independent browser instances (no shared storage/process).
  const b1 = await chromium.launch({ args }), b2 = await chromium.launch({ args });
  const host = await (await b1.newContext()).newPage(), guest = await (await b2.newContext()).newPage();
  const errors = [];
  for (const [n, p] of [['host', host], ['guest', guest]]) p.on('pageerror', (e) => errors.push(n + ': ' + e.message));

  await check('malformed / wrong-type codes give readable errors without connecting', async () => {
    await guest.goto(url); await guest.click(T('mode-pair')); await guest.click(T('btn-guest'));
    await guest.fill(T('invite-input'), 'garbage'); await guest.click(T('btn-accept'));
    await guest.locator(T('banner')).filter({ hasText: 'does not look like' }).waitFor({ timeout: 3000 });
    await guest.reload();
  });

  await check('host creates invite; guest replies; both browsers connect over WebRTC', async () => {
    await host.goto(url); await host.click(T('mode-pair')); await host.click(T('btn-host'));
    await host.waitForFunction(() => document.querySelector('[data-testid="invite-code"]').value.startsWith('IMG1.'), null, { timeout: 15000 });
    const invite = await host.inputValue(T('invite-code'));
    await guest.goto(url); await guest.click(T('mode-pair')); await guest.click(T('btn-guest'));
    // an answer-type code pasted in the wrong place must be rejected: use invite on host side later; here wrong order test
    await guest.fill(T('invite-input'), invite); await guest.click(T('btn-accept'));
    await guest.waitForFunction(() => document.querySelector('[data-testid="reply-code"]').value.startsWith('IMG1.'), null, { timeout: 15000 });
    const reply = await guest.inputValue(T('reply-code'));
    // host pasting its own invite as the reply must be rejected
    await host.fill(T('reply-input'), invite); await host.click(T('btn-connect'));
    await host.locator(T('banner')).filter({ hasText: 'invite code' }).waitFor({ timeout: 3000 });
    await host.fill(T('reply-input'), reply); await host.click(T('btn-connect'));
    // host judges round 1 → matchmaking screen, guest → witness wait screen
    await host.locator(T('screen-wait')).or(host.locator(T('screen-chat'))).first().waitFor({ timeout: 15000 });
    await guest.locator(T('screen-wait')).or(guest.locator(T('screen-chat'))).first().waitFor({ timeout: 15000 });
  });

  const seen = { human: 0, ai: 0 };
  await check('rounds alternate roles; human-routed messages arrive at the real peer; bot-routed ones never do', async () => {
    let judge = host, witness = guest;
    for (let round = 1; round <= 24 && (seen.human < 2 || seen.ai < 2); round++) {
      await judge.locator(T('screen-chat')).waitFor({ timeout: 10000 });
      assert((await judge.innerText(T('chat-role'))).includes('JUDGE'), 'judge role label');
      const marker = `ping-${round}-${Math.random().toString(36).slice(2, 8)}`;
      for (let i = 0; i < 3; i++) {
        await judge.fill(T('chat-input'), i === 0 ? marker : `message ${i}`);
        await judge.click(T('chat-send'));
      }
      await judge.locator(T('guess-human')).isEnabled();
      await judge.waitForFunction(() => !document.querySelector('[data-testid="guess-human"]').disabled);
      const witnessChat = await witness.locator(T('screen-chat')).isVisible();
      if (witnessChat) {
        // human route: peer must have received our exact text, and can answer back
        await witness.waitForFunction((m) => document.querySelector('[data-testid="chat-log"]').innerText.includes(m), marker, { timeout: 5000 });
        assert((await witness.innerText(T('chat-role'))).includes('WITNESS'));
        await witness.fill(T('chat-input'), `peer-reply-${round}`); await witness.click(T('chat-send'));
        await judge.waitForFunction((m) => document.querySelector('[data-testid="chat-log"]').innerText.includes(m), `peer-reply-${round}`, { timeout: 5000 });
        seen.human++;
      } else {
        // bot route: witness must not have received anything; bot replies locally
        await judge.waitForFunction(() => document.querySelectorAll('.bubble.them').length >= 2, null, { timeout: 8000 });
        assert(!(await witness.locator(T('screen-chat')).isVisible()), 'witness must not be in a chat on bot rounds');
        seen.ai++;
      }
      await judge.click(T('guess-human'));
      const truthIsHuman = witnessChat;
      const text = await judge.innerText(T('result-text'));
      assert(text.includes(truthIsHuman ? 'real person' : 'built-in bot'), 'reveal matches routing: ' + text);
      assert((await judge.innerText(T('result-title'))) === (truthIsHuman ? 'Correct!' : 'Fooled!'), 'result feedback');
      await witness.locator(T('screen-result')).waitFor({ timeout: 5000 });
      const wText = await witness.innerText(T('result-text'));
      assert(truthIsHuman ? wText.includes('guessed human') : wText.includes('built-in bot'), 'witness feedback: ' + wText);
      // host starts next round; roles swap
      await host.click(T('btn-next'));
      [judge, witness] = [witness, judge];
    }
    assert(seen.human >= 1 && seen.ai >= 1, `saw both routes: ${JSON.stringify(seen)}`);
    console.log('   routes observed:', JSON.stringify(seen));
  });

  await check('closing one browser shows a clear connection-lost message on the other', async () => {
    await guest.close();
    await host.locator(T('banner')).filter({ hasText: /lost|left/ }).waitFor({ timeout: 20000 });
    assert(await host.locator(T('screen-menu')).isVisible());
  });

  await check('practice mode: play a full round against the bot with feedback', async () => {
    await host.goto(url); await host.click(T('mode-practice'));
    await host.locator(T('screen-chat')).waitFor({ timeout: 5000 });
    for (let i = 0; i < 3; i++) { await host.fill(T('chat-input'), 'hello how are you'); await host.click(T('chat-send')); }
    await host.waitForFunction(() => document.querySelectorAll('.bubble.them').length >= 2, null, { timeout: 8000 });
    await host.click(T('guess-ai'));
    assert((await host.innerText(T('result-title'))) === 'Correct!');
  });

  await check('flipped mode: computer asks questions and delivers a verdict with reasons', async () => {
    await host.goto(url); await host.click(T('mode-flipped'));
    const answers = ['ugh just woke up lol', '43', 'cereal i think', 'somewhere warm', 'my cat hates mondays'];
    for (const a of answers) {
      await host.waitForFunction((n) => document.querySelectorAll('.bubble.them').length > n, answers.indexOf(a) , { timeout: 5000 });
      await host.waitForTimeout(150);
      await host.fill(T('chat-input'), a); await host.click(T('chat-send'));
    }
    await host.locator(T('screen-result')).waitFor({ timeout: 5000 });
    assert((await host.locator('#r-signals li').count()) > 0, 'signals listed');
  });

  await check('no uncaught page errors', async () => { assert(errors.length === 0, errors.join('; ')); });

  await b1.close(); await b2.close(); server.close();
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} e2e checks passed`);
  process.exit(failed ? 1 : 0);
})();
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
