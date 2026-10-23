/* Imitation — built-in chat opponent ("bot") and heuristic judge.
 *
 * IMPORTANT: this is a LOCAL, rule-based chatbot. It is NOT Claude. A static
 * site cannot call Claude without an API key (see README.md). The provider
 * hook at the bottom lets a real model be plugged in later without changes
 * to the game code.
 */
(function (root) {
  'use strict';

  function defaultRng() { return Math.random(); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  // [regex, replies]. First match wins; each reply list is consumed without repeats.
  const RULES = [
    [/\b(are you|r u)\b.*\b(bot|ai|robot|human|real|person|machine|computer|chatgpt|claude)\b/i, [
      'lol no, are you?', 'yes im a person. is that a thing people ask now', 'haha why does everyone ask that',
      'last i checked yes. you?', 'thats a weird thing to open with',
    ]],
    [/^\s*(hi|hello|hey|yo|sup|hiya)\b/i, ['hey', 'hi there', 'heyy whats up', 'yo']],
    [/how are you|how\'?s it going|how r u|what\'?s up|whats up/i, [
      'pretty tired honestly, long day', 'not bad, kinda bored. you?', 'ok i guess. been a slow one', 'good! just snacking lol',
    ]],
    [/\b(your name|who are you|call you)\b/i, ['call me whatever, im bad with names', 'does it matter lol', 'ill tell you after you guess']],
    [/\b(where|live|from|city|country)\b/i, [
      'a smallish town, nothing exciting', 'out east, you wouldnt know it', 'about an hour from a big city. you?',
    ]],
    [/\b(food|eat|dinner|lunch|breakfast|pizza|hungry)\b/i, [
      'pizza. always pizza', 'had leftover pasta, not my best choice', 'i could really go for tacos rn', 'cereal for dinner counts right',
    ]],
    [/\b(music|song|band|listen)\b/i, [
      'mostly whatever is on shuffle tbh', 'been replaying the same three songs all week', 'depends on the mood, you?',
    ]],
    [/\b(movie|film|show|series|watch|netflix)\b/i, [
      'rewatching old stuff mostly, new things take effort', 'i started a show and fell asleep in episode 2 lol', 'nothing good lately, any recs?',
    ]],
    [/\b(game|games|play|gaming)\b/i, [
      'a bit, mostly casual stuff', 'i rage quit more than i win', 'yeah when i have time. you?',
    ]],
    [/\b(weather|rain|snow|hot|cold|sunny)\b/i, ['its grey and gross here', 'honestly its been freezing', 'cant complain, kinda nice out']],
    [/\b(work|job|school|class|study|college|major)\b/i, [
      'school mostly, deadlines everywhere', 'ugh dont remind me, i have something due', 'work is work. pays ok',
    ]],
    [/\b(hobby|hobbies|free time|fun)\b/i, ['walking and doing nothing, mostly', 'i draw badly but it relaxes me', 'cooking when im motivated']],
    [/\b(pet|dog|cat)\b/i, ['cat. she ignores me mostly', 'wish i had a dog, landlord says no', 'my friends dog is basically mine']],
    [/\b(favou?rite|best)\b/i, ['hmm hard one, ask me again later', 'depends on the day honestly', 'i change my mind constantly about that']],
    [/\b(feel|feeling|mood|sad|happy|angry)\b/i, ['a little meh but ok', 'fine, just distracted', 'better than yesterday at least']],
    [/\b(why)\b/i, ['no idea honestly', 'good question lol', 'i havent thought about it that much']],
    [/\b(joke|funny)\b/i, ['i only know bad ones. why did the chicken... nvm i forgot', 'my humor is mostly accidental']],
    [/\b(sleep|tired|nap|bed)\b/i, ['i barely slept so same', 'sleep is overrated until you dont get any']],
  ];

  const FALLBACKS = [
    'hm, say more?', 'yeah i guess', 'ha fair', 'not sure i follow', 'what made you ask that?',
    'interesting. why though', 'idk, depends', 'that makes sense', 'lol ok', 'wait what do you mean',
    'honestly never thought about it', 'ok and you?',
  ];

  function arithmetic(text) {
    const m = text.replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*([+\-*x×\/÷])\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const a = parseFloat(m[1]), b = parseFloat(m[3]);
    const op = m[2];
    let r;
    if (op === '+') r = a + b; else if (op === '-') r = a - b;
    else if (op === '/' || op === '÷') r = b === 0 ? null : a / b; else r = a * b;
    return r;
  }

  function maybeTypo(rng, s) {
    if (s.length < 8 || rng() > 0.12) return s;
    const i = 1 + Math.floor(rng() * (s.length - 3));
    if (s[i] === ' ' || s[i + 1] === ' ') return s;
    return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); // swap two letters
  }

  /** speed: multiplier for delays (tests use a tiny value). */
  function createBot(opts) {
    opts = opts || {};
    const rng = opts.rng || defaultRng;
    const speed = opts.speed == null ? 1 : opts.speed;
    const used = new Set();
    let turn = 0;

    function choose(list) {
      const fresh = list.filter(function (x) { return !used.has(x); });
      const r = pick(rng, fresh.length ? fresh : list);
      used.add(r);
      return r;
    }

    function compose(text) {
      const lower = text.trim();
      const math = arithmetic(lower);
      if (math !== null && /\d/.test(lower)) {
        // People are slow / unsure at maths; sometimes dodge.
        if (rng() < 0.3) return 'ugh i dont do maths in my head, calculator?';
        return Number.isInteger(math) ? String(math) + ' i think' : '~' + math.toFixed(1) + ' roughly';
      }
      if (/\b(time|date|day|year)\b/i.test(lower) && /\bwhat\b/i.test(lower)) return 'no clue, my clock is wrong anyway';
      for (const rule of RULES) if (rule[0].test(lower)) return choose(rule[1]);
      if (lower.length > 120 && rng() < 0.5) return 'thats a lot to read lol, short version?';
      return choose(FALLBACKS);
    }

    return {
      kind: 'builtin-rule-bot',
      /** @returns {{text:string, delayMs:number, typingMs:number}} */
      reply: function (userText) {
        turn++;
        let text = maybeTypo(rng, compose(String(userText || '')));
        if (rng() < 0.15) text = text.replace(/[.?!]+$/, '');
        const think = (700 + rng() * 2200) * speed;
        const typing = text.length * (70 + rng() * 80) * speed;
        return { text: text, delayMs: Math.round(think), typingMs: Math.round(typing), turn: turn };
      },
    };
  }

  /* ---- Flipped mode: the computer judges the human. Heuristic, transparent. ---- */

  const JUDGE_QUESTIONS = [
    'Hi! Tell me about your morning so far.',
    'What is 17 + 26? (Take your time.)',
    'Describe the last thing you ate, without being too formal.',
    'If you could be anywhere right now, where would it be and why?',
    'Say something that would be hard for a computer to say.',
  ];

  /** answers: [{text, ms}] → {verdict:'human'|'ai', score, signals:[string]} */
  function judgeAnswers(answers) {
    const signals = [];
    let score = 0; // positive = human-like
    const texts = answers.map(function (a) { return a.text; });
    const avgLen = texts.reduce(function (s, t) { return s + t.length; }, 0) / Math.max(1, texts.length);
    const times = answers.map(function (a) { return a.ms; });
    const mean = times.reduce(function (s, t) { return s + t; }, 0) / Math.max(1, times.length);
    const sd = Math.sqrt(times.reduce(function (s, t) { return s + (t - mean) * (t - mean); }, 0) / Math.max(1, times.length));

    if (avgLen < 140) { score += 1; signals.push('answers were short and conversational (+1)'); }
    else { score -= 1; signals.push('answers were long and essay-like (-1)'); }

    if (texts.some(function (t) { return /\b(lol|haha|idk|ugh|hmm|um|uh|lmao)\b|[a-z]\.\.\.|!!/.test(t.toLowerCase()); })) {
      score += 1; signals.push('used casual filler words (+1)');
    }
    if (texts.every(function (t) { return /^[A-Z]/.test(t) && /[.!?]$/.test(t); })) {
      score -= 1; signals.push('every answer was perfectly capitalised and punctuated (-1)');
    }
    if (mean > 1500 && sd > 400) { score += 1; signals.push('response times varied naturally (+1)'); }
    if (mean < 600) { score -= 2; signals.push('answered implausibly fast (-2)'); }
    if (sd < 120 && times.length > 2) { score -= 1; signals.push('response times were suspiciously uniform (-1)'); }
    if (new Set(texts.map(function (t) { return t.toLowerCase().trim(); })).size < texts.length) {
      score -= 1; signals.push('repeated an identical answer (-1)');
    }
    if (texts.some(function (t) { return /as an ai|language model|i don't have personal|i do not have personal/i.test(t); })) {
      score -= 3; signals.push('mentioned being an AI / language model (-3)');
    }
    const maths = texts[1] || '';
    if (/\b43\b/.test(maths)) { score += 0; signals.push('maths answer was correct (neutral — humans and machines both can)'); }
    return { verdict: score >= 1 ? 'human' : 'ai', score: score, signals: signals };
  }

  const api = { createBot: createBot, judgeAnswers: judgeAnswers, JUDGE_QUESTIONS: JUDGE_QUESTIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImitationBot = api;
})(typeof self !== 'undefined' ? self : this);
