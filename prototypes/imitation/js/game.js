/* Imitation — game controller + UI. Mounts into any container element.
 *
 *   ImitationGame.mount(el, { fast:false, iceServers:undefined, onExit:fn })
 *
 * Modes
 *   practice : you judge the built-in bot (always the bot — labelled honestly).
 *   flipped  : the computer (heuristic judge) decides whether YOU are human.
 *   pair     : two real browsers over WebRTC. Players alternate judging. When you
 *              judge, a hidden coin flip routes your chat either to your real
 *              partner or to the built-in bot, after a believable matchmaking wait.
 */
(function (root) {
  'use strict';
  const B = root.ImitationBot, P = root.ImitationProtocol, R = root.ImitationRTC;
  const MIN_TURNS = 3, MAX_TURNS = 8;

  function secureFlip() {
    if (root.crypto && root.crypto.getRandomValues) return root.crypto.getRandomValues(new Uint32Array(1))[0] % 2 === 0;
    return Math.random() < 0.5;
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function mount(host, options) {
    options = options || {};
    const q = new URLSearchParams(root.location ? root.location.search : '');
    const fast = options.fast != null ? options.fast : q.get('fast') === '1';
    const iceServers = options.iceServers !== undefined ? options.iceServers : (q.get('stun') === '0' ? [] : undefined);
    const speed = fast ? 0.01 : 1;

    const S = { mode: null, link: null, round: 0, judgeIsMe: false, score: { right: 0, total: 0 }, stats: { fooled: 0, judged: 0 },
      chat: null, timers: [], isHost: false };

    host.innerHTML = '';
    const root$ = el('div'); host.appendChild(root$);
    root$.innerHTML = `
      <h1>Imitation</h1>
      <p class="muted">Is it a person or a program? Talk, then make the call.</p>
      <div id="banner" role="alert" class="banner hidden" data-testid="banner"></div>

      <section id="s-menu" class="panel" data-testid="screen-menu">
        <h2>How to play</h2>
        <ol>
          <li><b>Judge:</b> chat with a hidden opponent for at least ${MIN_TURNS} messages, then decide: <i>human</i> or <i>AI</i>.</li>
          <li><b>Witness:</b> if you're the one being judged, act naturally and convince the judge you're human.</li>
          <li>In <b>Two-browser match</b> you and a friend alternate roles. When you judge, a hidden coin flip decides whether you're talking to your friend or to the built-in bot &mdash; and the matchmaking wait is the same either way.</li>
        </ol>
        <button id="b-pair" data-testid="mode-pair">Two-browser match</button>
        <button id="b-practice" class="secondary" data-testid="mode-practice">Practice vs. built-in bot</button>
        <button id="b-flipped" class="secondary" data-testid="mode-flipped">Flipped: computer judges me</button>
        <p class="muted">The built-in opponent is a simple rule-based chatbot that runs locally. It is not Claude.</p>
      </section>

      <section id="s-connect" class="panel hidden" data-testid="screen-connect">
        <h2>Connect two browsers</h2>
        <p class="muted">No server is involved: you swap two short codes through any channel you like (chat app, email). Both browsers then talk directly.</p>
        <div id="c-choose">
          <button id="b-host" data-testid="btn-host">I'm hosting (create invite)</button>
          <button id="b-guest" class="secondary" data-testid="btn-guest">I'm joining (I have a code)</button>
        </div>
        <div id="c-host" class="hidden">
          <h2>1. Send this invite code to your friend</h2>
          <textarea id="t-invite" readonly data-testid="invite-code" aria-label="Invite code"></textarea>
          <button id="b-copy-invite" class="secondary">Copy</button>
          <h2>2. Paste their reply code here</h2>
          <textarea id="t-reply-in" data-testid="reply-input" aria-label="Reply code from guest"></textarea>
          <button id="b-connect" data-testid="btn-connect">Connect</button>
        </div>
        <div id="c-guest" class="hidden">
          <h2>1. Paste the host's invite code</h2>
          <textarea id="t-invite-in" data-testid="invite-input" aria-label="Invite code from host"></textarea>
          <button id="b-accept" data-testid="btn-accept">Create reply code</button>
          <div id="c-guest-out" class="hidden">
            <h2>2. Send this reply code back to the host</h2>
            <textarea id="t-reply-out" readonly data-testid="reply-code" aria-label="Reply code"></textarea>
            <button id="b-copy-reply" class="secondary">Copy</button>
          </div>
        </div>
        <p id="c-status" class="muted" role="status" data-testid="connect-status"></p>
        <button id="b-connect-back" class="secondary">Back</button>
      </section>

      <section id="s-wait" class="panel hidden" data-testid="screen-wait">
        <h2 id="w-title"></h2>
        <p role="status"><span class="spinner"></span><span id="w-text"></span></p>
      </section>

      <section id="s-chat" class="panel hidden" data-testid="screen-chat">
        <div class="scoreboard muted"><span id="ch-role" data-testid="chat-role"></span><span id="ch-round"></span><span id="ch-score" data-testid="score"></span></div>
        <div id="ch-log" class="chat" role="log" aria-live="polite" data-testid="chat-log"></div>
        <p id="ch-typing" class="muted" aria-live="polite"></p>
        <form id="ch-form" class="composer">
          <input id="ch-input" type="text" autocomplete="off" maxlength="${P.MAX_TEXT}" aria-label="Your message" data-testid="chat-input">
          <button id="ch-send" type="submit" data-testid="chat-send">Send</button>
        </form>
        <div id="ch-judge" class="hidden">
          <p id="ch-hint" class="muted"></p>
          <button id="g-human" data-testid="guess-human">It's a human</button>
          <button id="g-ai" data-testid="guess-ai">It's an AI</button>
        </div>
      </section>

      <section id="s-result" class="panel hidden" data-testid="screen-result">
        <h2 id="r-title" data-testid="result-title"></h2>
        <p id="r-text" data-testid="result-text"></p>
        <ul id="r-signals" class="signals"></ul>
        <p id="r-score" class="muted"></p>
        <button id="b-next" data-testid="btn-next">Next round</button>
        <button id="b-menu" class="secondary" data-testid="btn-menu">Back to menu</button>
      </section>`;

    const $ = function (id) { return root$.querySelector('#' + id); };
    const screens = ['menu', 'connect', 'wait', 'chat', 'result'];
    function show(name) { screens.forEach(function (s) { $('s-' + s).classList.toggle('hidden', s !== name); }); }
    function banner(msg, info) { const b = $('banner'); b.textContent = msg || ''; b.classList.toggle('hidden', !msg); b.classList.toggle('info', !!info); }
    function later(fn, ms) { const t = setTimeout(fn, ms); S.timers.push(t); return t; }
    function clearTimers() { S.timers.forEach(clearTimeout); S.timers = []; }
    function say(cls, text) { const b = el('div', 'bubble ' + cls, text); const log = $('ch-log'); log.appendChild(b); log.scrollTop = log.scrollHeight; return b; }
    function updateScore() { $('ch-score').textContent = S.mode === 'pair' || S.mode === 'practice' ? 'Score: ' + S.score.right + '/' + S.score.total : ''; }

    function resetToMenu(msg) {
      clearTimers();
      if (S.link) { S.link.onstate = function () {}; S.link.close(); S.link = null; }
      S.chat = null; S.mode = null; S.round = 0; S.score = { right: 0, total: 0 };
      banner(msg || '', false);
      show('menu');
    }

    /* ---------------- chat view helpers ---------------- */
    function openChat(opts) {
      S.chat = { role: opts.role, sent: 0, route: opts.route || null, bot: opts.bot || null, answers: [], qIndex: 0, shownAt: 0, over: false };
      $('ch-log').innerHTML = '';
      $('ch-typing').textContent = '';
      $('ch-role').textContent = opts.role === 'judge' ? 'You are the JUDGE' : opts.role === 'witness' ? 'You are the WITNESS — prove you are human' : 'You are being JUDGED by the computer';
      $('ch-round').textContent = S.round ? 'Round ' + S.round : '';
      $('ch-judge').classList.toggle('hidden', opts.role !== 'judge');
      $('g-human').disabled = $('g-ai').disabled = true;
      $('ch-hint').textContent = 'Send at least ' + MIN_TURNS + ' messages, then make your call.';
      $('ch-input').disabled = false; $('ch-send').disabled = false;
      updateScore();
      show('chat');
      $('ch-input').focus();
    }
    function endChat() { if (S.chat) S.chat.over = true; $('ch-input').disabled = true; $('ch-send').disabled = true; }

    /* ---------------- practice (judge vs bot) & pair judge round ---------------- */
    function startJudgeRound() {
      S.judgeIsMe = true; S.chat = null;
      const viaPeer = S.mode === 'pair' && secureFlip();
      const route = S.mode === 'pair' ? (viaPeer ? 'human' : 'ai') : 'ai';
      $('w-title').textContent = S.mode === 'pair' ? 'Finding you an opponent…' : 'Warming up the practice bot…';
      $('w-text').textContent = S.mode === 'pair' ? 'Matching you with someone online.' : 'Practice mode — your opponent is the built-in bot.';
      show('wait');
      // Same wait distribution for both routes so timing never gives the answer away.
      const wait = fast ? 60 + Math.random() * 60 : (S.mode === 'pair' ? 4000 + Math.random() * 6000 : 1200);
      later(function () {
        if (route === 'human' && !S.link.send({ t: 'open' })) return; // link lost handler shows the error
        openChat({ role: 'judge', route: route, bot: route === 'ai' ? B.createBot({ speed: speed }) : null });
        say('sys', 'You are connected. Say hello!');
      }, wait);
    }

    function startWitnessRound() {
      S.judgeIsMe = false; S.chat = null;
      $('w-title').textContent = 'Your partner is being matched…';
      $('w-text').textContent = 'Waiting. You may be chatted with, or not — stay ready.';
      show('wait');
    }

    function sendMine(text) {
      const c = S.chat;
      say('me', text);
      c.sent++;
      if (c.role === 'judge') {
        if (c.route === 'human') { S.link.send({ t: 'msg', text: text }); $('ch-typing').textContent = ''; }
        else botRespond(text);
        if (c.sent >= MIN_TURNS) { $('g-human').disabled = $('g-ai').disabled = false; }
        if (c.sent >= MAX_TURNS) { $('ch-hint').textContent = 'That is enough conversation — make your call.'; $('ch-input').disabled = true; $('ch-send').disabled = true; }
      } else if (c.role === 'witness') {
        S.link.send({ t: 'msg', text: text });
      } else if (c.role === 'judged') {
        const ms = Date.now() - c.shownAt;
        c.answers.push({ text: text, ms: ms });
        askNext();
      }
    }

    function botRespond(text) {
      const c = S.chat, r = c.bot.reply(text);
      later(function () {
        if (c.over) return;
        $('ch-typing').textContent = 'Opponent is typing…';
        later(function () { if (c.over) return; $('ch-typing').textContent = ''; say('them', r.text); }, r.typingMs);
      }, r.delayMs);
    }

    function guess(g) {
      const c = S.chat; if (!c || c.over) return;
      endChat();
      const truth = c.route === 'human' ? 'human' : 'ai';
      const right = g === truth;
      S.score.total++; if (right) S.score.right++;
      if (S.mode === 'pair' && S.link) S.link.send({ t: 'verdict', guess: g, truth: truth });
      showJudgeResult(g, truth, right);
    }

    function showJudgeResult(g, truth, right) {
      clearTimers();
      $('r-title').textContent = right ? 'Correct!' : 'Fooled!';
      $('r-title').className = right ? 'verdict-good' : 'verdict-bad';
      $('r-text').textContent = 'You said ' + (g === 'human' ? 'human' : 'AI') + '. Your opponent was ' +
        (truth === 'human' ? 'a real person (your partner).' : 'the built-in bot.');
      $('r-signals').innerHTML = '';
      $('r-score').textContent = 'Score: ' + S.score.right + '/' + S.score.total;
      setNext();
      show('result');
    }

    function setNext() {
      const b = $('b-next');
      if (S.mode === 'pair') {
        b.classList.toggle('hidden', !S.isHost);
        if (!S.isHost) $('r-score').textContent += ' — waiting for the host to start the next round.';
      } else b.classList.remove('hidden');
    }

    /* ---------------- flipped (computer judges you) ---------------- */
    function startFlipped() {
      S.mode = 'flipped';
      openChat({ role: 'judged' });
      $('ch-judge').classList.add('hidden');
      say('sys', 'A computer judge will ask you ' + B.JUDGE_QUESTIONS.length + ' questions and decide if you are human.');
      askNext();
    }
    function askNext() {
      const c = S.chat;
      if (c.qIndex >= B.JUDGE_QUESTIONS.length) return finishFlipped();
      const q = B.JUDGE_QUESTIONS[c.qIndex++];
      later(function () { say('them', q); c.shownAt = Date.now(); }, fast ? 10 : 600);
    }
    function finishFlipped() {
      endChat();
      const res = B.judgeAnswers(S.chat.answers);
      $('r-title').textContent = res.verdict === 'human' ? 'The judge thinks you are human.' : 'The judge thinks you are an AI!';
      $('r-title').className = res.verdict === 'human' ? 'verdict-good' : 'verdict-bad';
      $('r-text').textContent = 'The judge is a simple scoring heuristic (not a real AI), so treat the verdict as a game, not a measurement.';
      $('r-signals').innerHTML = '';
      res.signals.forEach(function (s) { $('r-signals').appendChild(el('li', null, s)); });
      $('r-score').textContent = 'Score: ' + res.score;
      $('b-next').classList.remove('hidden');
      show('result');
    }

    /* ---------------- pair protocol ---------------- */
    function onPeerMessage(m) {
      switch (m.t) {
        case 'hello': break;
        case 'round':
          S.round = m.n;
          if (m.judge === (S.isHost ? 'host' : 'guest')) startJudgeRound(); else startWitnessRound();
          break;
        case 'open':
          if (S.judgeIsMe) break;
          openChat({ role: 'witness' });
          say('sys', 'Someone is chatting with you. They are trying to tell if you are human.');
          break;
        case 'msg':
          if (S.chat && !S.chat.over) {
            say('them', m.text);
            if (S.chat.role === 'judge' && S.chat.route !== 'human') break; // ignore stray traffic on bot rounds
          }
          break;
        case 'verdict':
          if (S.judgeIsMe) break;
          endChat();
          $('r-title').textContent = S.chat ? (m.guess === 'human' ? 'You were recognised as human.' : 'You were mistaken for an AI!') : 'Round over';
          $('r-title').className = S.chat ? (m.guess === 'human' ? 'verdict-good' : 'verdict-bad') : '';
          $('r-text').textContent = S.chat ? 'Your partner guessed ' + (m.guess === 'human' ? 'human' : 'AI') + '.'
            : 'Your partner judged the built-in bot this round, so you did not take part. Swapping roles next.';
          $('r-signals').innerHTML = '';
          $('r-score').textContent = '';
          setNext();
          show('result');
          break;
        case 'bye': resetToMenu('Your partner left the game.'); break;
      }
    }

    function startPairRounds() {
      S.mode = 'pair'; S.score = { right: 0, total: 0 };
      banner('Connected to a real partner over WebRTC.', true);
      S.link.send({ t: 'hello', v: P.VERSION });
      if (S.isHost) nextPairRound();
      else { $('w-title').textContent = 'Connected'; $('w-text').textContent = 'Waiting for the host to start round 1…'; show('wait'); }
    }
    function nextPairRound() {
      S.round++;
      const judge = S.round % 2 === 1 ? 'host' : 'guest';
      S.link.send({ t: 'round', n: S.round, judge: judge });
      if (judge === 'host') startJudgeRound(); else startWitnessRound();
    }

    function attachLink(link) {
      S.link = link;
      link.onmessage = onPeerMessage;
      link.onstate = function (s) {
        if (s === 'open') startPairRounds();
        else if (s === 'lost' && S.mode === 'pair') resetToMenu('The connection to your partner was lost. Start a new match to play again.');
        else if (s === 'lost') { $('c-status').textContent = 'Connection failed. Check both codes were copied in full, then try again.'; }
      };
    }

    /* ---------------- wiring ---------------- */
    $('b-practice').onclick = function () { banner(''); S.mode = 'practice'; S.round = 1; S.score = { right: 0, total: 0 }; startJudgeRound(); };
    $('b-flipped').onclick = function () { banner(''); startFlipped(); };
    $('b-pair').onclick = function () {
      banner('');
      if (!root.RTCPeerConnection) return banner('This browser does not support WebRTC, so two-browser play is unavailable.');
      $('c-choose').classList.remove('hidden'); $('c-host').classList.add('hidden'); $('c-guest').classList.add('hidden'); $('c-status').textContent = '';
      show('connect');
    };
    $('b-connect-back').onclick = function () { resetToMenu(); };
    $('b-menu').onclick = function () { if (S.link && S.mode === 'pair') S.link.send({ t: 'bye' }); resetToMenu(); };
    $('b-next').onclick = function () {
      if (S.mode === 'pair') nextPairRound();
      else if (S.mode === 'practice') { S.round++; startJudgeRound(); }
      else startFlipped();
    };
    $('b-copy-invite').onclick = function () { copy($('t-invite')); };
    $('b-copy-reply').onclick = function () { copy($('t-reply-out')); };
    function copy(ta) { try { navigator.clipboard.writeText(ta.value); } catch (e) { ta.select(); } }

    $('b-host').onclick = async function () {
      $('c-choose').classList.add('hidden'); $('c-host').classList.remove('hidden');
      S.isHost = true; $('c-status').textContent = 'Gathering network info…';
      try {
        attachLink(new R.PeerLink({ iceServers: iceServers }));
        $('t-invite').value = await S.link.createInvite();
        $('c-status').textContent = 'Invite ready. Send it to your friend, then paste their reply below.';
      } catch (e) { banner('Could not create an invite: ' + e.message); }
    };
    $('b-guest').onclick = function () { $('c-choose').classList.add('hidden'); $('c-guest').classList.remove('hidden'); S.isHost = false; };
    $('b-accept').onclick = async function () {
      banner(''); $('c-status').textContent = 'Working…';
      try {
        attachLink(new R.PeerLink({ iceServers: iceServers }));
        $('t-reply-out').value = await S.link.acceptInvite($('t-invite-in').value);
        $('c-guest-out').classList.remove('hidden');
        $('c-status').textContent = 'Send the reply code to the host. This page connects automatically once they paste it.';
      } catch (e) { S.link = null; banner(e.message); $('c-status').textContent = ''; }
    };
    $('b-connect').onclick = async function () {
      banner('');
      try { await S.link.acceptAnswer($('t-reply-in').value); $('c-status').textContent = 'Connecting…'; }
      catch (e) { banner(e.message); }
    };
    $('ch-form').onsubmit = function (e) {
      e.preventDefault();
      const v = $('ch-input').value.trim();
      if (!v || !S.chat || S.chat.over) return;
      $('ch-input').value = '';
      sendMine(v);
    };
    $('g-human').onclick = function () { guess('human'); };
    $('g-ai').onclick = function () { guess('ai'); };

    return { reset: resetToMenu };
  }

  root.ImitationGame = { mount: mount };
})(typeof self !== 'undefined' ? self : this);
