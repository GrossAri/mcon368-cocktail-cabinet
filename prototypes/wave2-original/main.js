/* Echo Heist — UI, input, rendering and game flow. Rules live in core.js. */
(function () {
  'use strict';
  const C = window.EchoCore, A = window.EchoAudio;
  const $ = id => document.getElementById(id);
  const canvas = $('eh-canvas'), ctx = canvas.getContext('2d');
  const T = 48; // pixels per tile
  const ECHO_COLORS = ['#c77dff', '#ff7eb6', '#6ee7a8', '#ffb86b', '#7db4ff'];
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
    ' ': 'wait',
  };
  const params = new URLSearchParams(location.search);

  let best = 0;
  try { best = parseInt(localStorage.getItem('echoheist.best'), 10) || 0; } catch (e) { /* ignore */ }

  // ---- game flow state ----
  const G = {
    state: 'title',        // title | ready | running | paused | ending | between | over
    vault: 0, roundNo: 1, score: 0,
    echoes: [],            // [{round, path}] — carried between rounds of a vault
    round: null, cfg: null, seedBase: 0,
    lastStepAt: 0, acc: 0, lastFrame: 0,
    lastDir: 'down', endAt: 0, endKind: '',
  };

  // ---- input ----
  const held = [];
  let pending = null;
  function pushDir(name) { pending = name; if (name !== 'wait' && !held.includes(name)) held.push(name); }
  function releaseDir(name) { const i = held.indexOf(name); if (i >= 0) held.splice(i, 1); }
  function takeInput() {
    let name = null;
    if (pending) { name = pending; pending = null; }
    else if (held.length) name = held[held.length - 1];
    if (!name) return null;
    if (name === 'wait') return 'wait';
    G.lastDir = name;
    return C.DIRS[name];
  }
  function clearInput() { held.length = 0; pending = null; }

  // ---- overlay helpers ----
  const ov = { root: $('eh-overlay'), title: $('eh-ov-title'), body: $('eh-ov-body'), b1: $('eh-ov-btn'), b2: $('eh-ov-btn2') };
  let ovPrimary = null, ovSecondary = null;
  function showOverlay(title, html, label, onPrimary, label2, onSecondary) {
    ov.title.textContent = title;
    ov.body.innerHTML = html;
    ov.b1.textContent = label; ovPrimary = onPrimary;
    ov.b2.hidden = !label2; if (label2) ov.b2.textContent = label2;
    ovSecondary = onSecondary || null;
    ov.root.hidden = false;
    ov.b1.focus();
  }
  function hideOverlay() { ov.root.hidden = true; ovPrimary = ovSecondary = null; canvas.focus({ preventScroll: true }); }
  ov.b1.addEventListener('click', () => { A.unlock(); if (ovPrimary) ovPrimary(); });
  ov.b2.addEventListener('click', () => { A.unlock(); if (ovSecondary) ovSecondary(); });

  const HOWTO = `
    <p><b>Steal every gem, then escape — but your own past runs are hunting you.</b></p>
    <ol>
      <li>Collect all the <b style="color:#5cf0ff">◆ gems</b>. The red <b>EXIT</b> unlocks when you have them all.</li>
      <li>Reach the exit before the timer runs out.</li>
      <li>Every route you clear is recorded as an <b style="color:#c77dff">Echo</b>. In later rounds the Echoes replay your old route, starting <b>4 steps</b> after you move. Touching one ends your run.</li>
      <li>Echoes show where they're heading with a dotted trail. Clear 5 rounds to crack the vault and move on to a new one.</li>
    </ol>
    <p><kbd>←↑↓→</kbd> or <kbd>WASD</kbd> to move · <kbd>Space</kbd> to wait · <kbd>P</kbd> pause · <kbd>R</kbd> restart · <kbd>M</kbd> mute</p>
    <p>The clock starts on your first step.</p>`;

  // ---- flow ----
  function showTitle() {
    G.state = 'title';
    showOverlay('Echo Heist', HOWTO, 'Start the heist', () => startRun());
    drawIdleBoard();
    updateHud();
  }

  function startRun(vault, roundNo) {
    if (vault === undefined) {
      const v = parseInt(params.get('vault'), 10), r = parseInt(params.get('round'), 10);
      vault = v > 0 ? v - 1 : 0;
      roundNo = r >= 1 && r <= C.ROUNDS_PER_VAULT ? r : 1;
    }
    const sp = parseInt(params.get('seed'), 10);
    G.seedBase = isNaN(sp) ? Math.floor(Math.random() * 1e9) : sp;
    G.vault = vault; G.roundNo = roundNo; G.score = 0;
    G.echoes = roundNo > 1 ? C.syntheticEchoes(vault, roundNo, G.seedBase) : [];
    beginRound();
  }

  function beginRound() {
    G.cfg = C.roundConfig(G.vault, G.roundNo, G.seedBase);
    G.round = new C.Round({ layout: G.cfg.layout, gems: C.gemsFor(G.cfg), echoes: G.echoes.slice(), limit: G.cfg.limit });
    G.state = 'ready'; G.acc = 0; G.lastStepAt = performance.now(); G.lastDir = 'down';
    clearInput();
    hideOverlay();
    lastSecondsShown = -1;
    updateHud();
  }

  function finishRound(kind) {
    G.state = 'ending'; G.endKind = kind; G.endAt = performance.now();
    clearInput();
    const r = G.round;
    if (kind === 'cleared') {
      const bonus = r.timeBonus();
      G.score += C.SCORE.clear + bonus;
      const vaultDone = G.roundNo === C.ROUNDS_PER_VAULT;
      if (vaultDone) G.score += C.SCORE.vault;
      saveBest();
      A.play(vaultDone ? 'vault' : 'cleared');
      setTimeout(() => showCleared(bonus, vaultDone), 700);
    } else {
      saveBest();
      A.play(kind === 'caught' ? 'caught' : 'timeout');
      setTimeout(() => showOver(kind), 1000);
    }
    updateHud();
  }

  function showCleared(bonus, vaultDone) {
    if (G.state !== 'ending') return;
    G.state = 'between';
    const r = G.round;
    const echoNote = `Your route is now <b style="color:${ECHO_COLORS[(G.roundNo - 1) % 5]}">Echo #${G.roundNo}</b>.`;
    const lines = `<p><span class="stat">Round clear +${C.SCORE.clear}</span><span class="stat">Time bonus +${bonus}</span>` +
      (vaultDone ? `<span class="stat eh-good">Vault cracked +${C.SCORE.vault}</span>` : '') + `</p>`;
    if (vaultDone) {
      const nextName = C.roundConfig(G.vault + 1, 1, G.seedBase).layout.name;
      showOverlay(`Vault ${G.vault + 1} cracked!`, lines + `<p>All Echoes dissolve. Next target: <b>${nextName}</b> — a tighter clock and a fresh floor plan.</p><p>Score: <b>${G.score}</b></p>`,
        'Next vault', () => {
          G.vault++; G.roundNo = 1; G.echoes = []; beginRound();
        });
    } else {
      G.echoes = G.echoes.concat([{ round: G.roundNo, path: r.path.map(p => ({ x: p.x, y: p.y })) }]).slice(-C.MAX_ECHOES);
      showOverlay('Round clear!', lines + `<p>${echoNote} It will replay this exact run next round — don't cross your own path.</p><p>Score: <b>${G.score}</b></p>`,
        `Round ${G.roundNo + 1}`, () => { G.roundNo++; beginRound(); });
    }
  }

  function showOver(kind) {
    if (G.state !== 'ending') return;
    G.state = 'over';
    const r = G.round;
    const why = kind === 'caught'
      ? `<p class="eh-bad">You ran into <b>Echo #${G.echoes[r.caughtBy].round}</b> — your own earlier route.</p>`
      : `<p class="eh-bad">The alarm sounded before you reached the exit.</p>`;
    const isBest = G.score > 0 && G.score >= best;
    showOverlay(kind === 'caught' ? 'Caught by your own echo!' : "Time's up!",
      why + `<p><span class="stat">Reached vault ${G.vault + 1}, round ${G.roundNo}</span><span class="stat">Score ${G.score}</span></p>` +
      (isBest ? '<p class="eh-good"><b>New best score!</b></p>' : `<p>Best: ${best}</p>`),
      'Try again', () => startRun(), 'Rules', () => showTitle());
  }

  function saveBest() {
    if (G.score > best) { best = G.score; try { localStorage.setItem('echoheist.best', String(best)); } catch (e) { /* ignore */ } }
  }

  function togglePause() {
    if (G.state === 'running' || G.state === 'ready') {
      G.pausedFrom = G.state; G.state = 'paused';
      showOverlay('Paused', '<p>Take a breather — the clock is stopped.</p>', 'Resume', togglePause, 'Restart', () => startRun());
    } else if (G.state === 'paused') {
      G.state = G.pausedFrom; G.lastStepAt = performance.now(); G.acc = 0; clearInput(); hideOverlay();
    }
  }

  function restart() {
    if (G.state === 'title') return;
    A.unlock();
    startRun();
  }

  // ---- stepping ----
  function applyEvents(events) {
    for (const e of events) {
      if (e.type === 'start') A.play('start');
      else if (e.type === 'move') A.play('move');
      else if (e.type === 'bump') A.play('bump');
      else if (e.type === 'gem') { G.score += C.SCORE.gem; A.play('gem', e.left); }
      else if (e.type === 'exitOpen') A.play('exitOpen');
      else if (e.type === 'wake') A.play('wake');
    }
    const s = G.round.status;
    if (s === 'cleared' || s === 'caught' || s === 'timeout') finishRound(s);
  }

  function doStep(input) {
    const r = G.round;
    const events = r.step(input);
    G.lastStepAt = performance.now();
    if (G.state === 'ready' && r.status === 'running') { G.state = 'running'; G.acc = 0; }
    applyEvents(events);
    updateHud();
  }

  let lastSecondsShown = -1;
  function frame(now) {
    const dt = Math.min(250, now - (G.lastFrame || now));
    G.lastFrame = now;
    if (G.state === 'ready') {
      const inp = takeInput();
      if (inp) doStep(inp);
    } else if (G.state === 'running') {
      G.acc += dt;
      while (G.acc >= C.TICK_MS && G.state === 'running') {
        G.acc -= C.TICK_MS;
        doStep(takeInput());
      }
    }
    render(now);
    requestAnimationFrame(frame);
  }

  // ---- HUD ----
  function updateHud() {
    const r = G.round;
    $('eh-vault').textContent = G.vault + 1;
    $('eh-round').textContent = G.roundNo + '/' + C.ROUNDS_PER_VAULT;
    $('eh-gems').textContent = r ? r.gemsTaken + '/' + r.gems.length : '0/0';
    $('eh-echoes').textContent = r ? r.echoes.length : 0;
    $('eh-score').textContent = G.score;
    $('eh-best').textContent = best;
    const fill = $('eh-timerfill'), txt = $('eh-timertext');
    if (r) {
      const left = Math.max(0, r.limit - r.tick);
      const secs = Math.ceil(left * C.TICK_MS / 1000);
      fill.style.width = (left / r.limit * 100) + '%';
      fill.classList.toggle('low', secs <= 10);
      txt.textContent = r.status === 'ready' ? 'Clock starts on your first step · ' + secs + 's' : secs + 's';
      if (G.state === 'running' && secs <= 5 && secs !== lastSecondsShown) A.play('tick');
      lastSecondsShown = secs;
    } else { fill.style.width = '100%'; txt.textContent = ''; }
    const hint = $('eh-hint');
    let msg = '';
    if (r && G.state === 'ready') msg = G.roundNo === 1 && G.vault === 0 ? 'Press an arrow key or WASD to begin — grab every ◆, then reach the exit' : 'Press a direction to begin — Echoes wake 4 steps after you move';
    else if (r && G.state === 'running') msg = r.exitOpen ? 'Exit unlocked — run for it!' : (r.tick < C.WAKE && r.echoes.length ? 'Echoes are waking…' : '');
    hint.textContent = msg; hint.hidden = !msg;
  }

  // ---- rendering ----
  const lerp = (a, b, t) => a + (b - a) * t;

  function drawIdleBoard() {
    const cfg = C.roundConfig(0, 1, 1);
    G.round = null;
    drawBoard(cfg.layout, C.gemsFor(cfg).map(g => ({ x: g.x, y: g.y, taken: false })), false, performance.now());
  }

  function drawBoard(layout, gems, exitOpen, now) {
    ctx.fillStyle = '#0f1226';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < layout.h; y++) for (let x = 0; x < layout.w; x++) {
      const px = x * T, py = y * T;
      if (layout.isWall(x, y)) {
        ctx.fillStyle = '#4a55b0'; ctx.fillRect(px, py, T, T);
        ctx.fillStyle = '#6b78dc'; ctx.fillRect(px, py, T, 5);
        ctx.fillStyle = '#2e3680'; ctx.fillRect(px, py + T - 6, T, 6);
      } else {
        ctx.fillStyle = (x + y) % 2 ? '#12163a' : '#0f1331'; ctx.fillRect(px, py, T, T);
      }
    }
    // start marker
    ctx.strokeStyle = '#4fd1c5aa'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.strokeRect(layout.start.x * T + 6, layout.start.y * T + 6, T - 12, T - 12); ctx.setLineDash([]);
    // exit door
    const ex = layout.exit.x * T, ey = layout.exit.y * T;
    const pulse = exitOpen ? 0.6 + 0.4 * Math.sin(now / 160) : 1;
    ctx.fillStyle = exitOpen ? `rgba(80,255,150,${0.35 + 0.35 * pulse})` : '#7a2538';
    ctx.fillRect(ex + 4, ey + 4, T - 8, T - 8);
    ctx.strokeStyle = exitOpen ? '#7dffb0' : '#ff6b81'; ctx.lineWidth = 3; ctx.strokeRect(ex + 4, ey + 4, T - 8, T - 8);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(exitOpen ? 'EXIT' : '🔒', ex + T / 2, ey + T / 2);
    // gems
    for (const g of gems) {
      if (g.taken) continue;
      const cx = g.x * T + T / 2, cy = g.y * T + T / 2 + Math.sin(now / 300 + g.x * 2 + g.y) * 2;
      ctx.fillStyle = '#5cf0ff'; ctx.strokeStyle = '#e6fdff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy - 15); ctx.lineTo(cx + 12, cy); ctx.lineTo(cx, cy + 15); ctx.lineTo(cx - 12, cy); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff88'; ctx.beginPath(); ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx, cy - 10); ctx.lineTo(cx + 4, cy - 4); ctx.closePath(); ctx.fill();
    }
  }

  function drawEcho(cx, cy, color, armed, label, wakeProgress, now, scale) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(scale || 1, scale || 1); cx = 0; cy = 0;
    ctx.globalAlpha = armed ? 0.92 : 0.45;
    const r = 17;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, r, Math.PI, 0);
    const base = cy + r - 2, wob = Math.sin(now / 120) * 1.5;
    ctx.lineTo(cx + r, base);
    for (let i = 0; i < 3; i++) {
      const x1 = cx + r - (i + 0.5) * (2 * r / 3), x2 = cx + r - (i + 1) * (2 * r / 3);
      ctx.lineTo(x1, base - 6 + wob * (i % 2 ? 1 : -1)); ctx.lineTo(x2, base);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - 6, cy - 4, 4, 0, 7); ctx.arc(cx + 6, cy - 4, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#1a1033'; ctx.beginPath(); ctx.arc(cx - 6, cy - 3, 2, 0, 7); ctx.arc(cx + 6, cy - 3, 2, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#10102a'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('#' + label, cx, cy + 8);
    if (!armed && wakeProgress !== null) {
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 23, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * wakeProgress); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer(cx, cy, dir, flash) {
    ctx.save();
    ctx.fillStyle = flash ? '#ff5d5d' : '#ffd24a';
    ctx.strokeStyle = '#3a2a00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 15, 0, 7); ctx.fill(); ctx.stroke();
    // mask band + eyes shifted toward heading
    const o = { up: [0, -3], down: [0, 3], left: [-4, 0], right: [4, 0], wait: [0, 0] }[dir] || [0, 0];
    ctx.fillStyle = '#222'; ctx.fillRect(cx - 12 + o[0] / 2, cy - 6 + o[1], 24, 7);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - 5 + o[0], cy - 3 + o[1], 2.2, 0, 7); ctx.arc(cx + 5 + o[0], cy - 3 + o[1], 2.2, 0, 7); ctx.fill();
    ctx.restore();
  }

  function render(now) {
    const r = G.round;
    if (!r) return;
    const layout = r.layout;
    const frac = G.state === 'running' ? Math.min(1, (now - G.lastStepAt) / C.TICK_MS) : 1;
    drawBoard(layout, r.gems, r.exitOpen, now);

    // Echo trails (preview of their next few steps) then bodies
    r.echoes.forEach((e, i) => {
      const color = ECHO_COLORS[(e.round - 1) % 5];
      const live = r.status === 'ready' ? -1 : r.tick;
      const t0 = Math.max(live, 0);
      ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 3; ctx.setLineDash([2, 7]); ctx.lineCap = 'round';
      ctx.beginPath(); let started = false;
      for (let k = 0; k <= 7; k++) {
        const g = r.ghostAt(i, t0 + k); if (!g) break;
        const gx = g.x * T + T / 2, gy = g.y * T + T / 2;
        if (!started) { ctx.moveTo(gx, gy); started = true; } else ctx.lineTo(gx, gy);
      }
      ctx.stroke(); ctx.restore();
    });
    r.echoes.forEach((e, i) => {
      const color = ECHO_COLORS[(e.round - 1) % 5];
      const cur = r.ghostAt(i, r.tick);
      if (!cur) return;
      const prev = r.tick > 0 ? r.ghostAt(i, r.tick - 1) : null;
      let gx = cur.x, gy = cur.y;
      if (prev && prev.armed && cur.armed) { gx = lerp(prev.x, cur.x, frac); gy = lerp(prev.y, cur.y, frac); }
      const wake = !cur.armed ? (r.status === 'ready' ? 0 : r.tick / C.WAKE) : null;
      if (!cur.armed) { // dormant Echoes wait around the start tile, fanned out so each one is visible
        const a = (i / r.echoes.length) * Math.PI * 2 - Math.PI / 2, n = r.echoes.length;
        const off = n > 1 ? 20 : 17;
        drawEcho(gx * T + T / 2 + Math.cos(a) * off, gy * T + T / 2 + Math.sin(a) * off, color, false, e.round, wake, now, 0.5);
      } else drawEcho(gx * T + T / 2, gy * T + T / 2, color, true, e.round, wake, now);
    });

    // player
    let px = r.player.x, py = r.player.y;
    if (r.tick > 0 && G.state === 'running') { const p = r.path[r.tick - 1]; px = lerp(p.x, px, frac); py = lerp(p.y, py, frac); }
    const caught = r.status === 'caught';
    drawPlayer(px * T + T / 2, py * T + T / 2, G.lastDir, caught && Math.floor(now / 100) % 2 === 0);
    if (caught) {
      ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(px * T + T / 2, py * T + T / 2, 22 + ((now - G.endAt) / 25) % 20, 0, 7); ctx.stroke();
    }
    if (r.status === 'cleared') {
      ctx.fillStyle = '#7dffb044'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ---- events ----
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const typing = e.target && e.target.tagName === 'INPUT';
    if (typing) return;
    if (k === 'm' || k === 'M') { A.unlock(); A.setMuted(!A.muted); syncAudioUi(); return; }
    if (k === 'p' || k === 'P' || k === 'Escape') {
      if (G.state === 'running' || G.state === 'ready' || G.state === 'paused') { e.preventDefault(); togglePause(); }
      return;
    }
    if (k === 'r' || k === 'R') { if (!e.repeat) restart(); return; }
    const overlayOpen = !ov.root.hidden;
    if (overlayOpen && (k === 'Enter' || k === ' ')) {
      A.unlock();
      if (e.target && e.target.tagName === 'BUTTON') return; // native click on the focused button
      e.preventDefault(); if (ovPrimary) ovPrimary(); return;
    }
    const dir = KEYMAP[k];
    if (!dir) return;
    if (e.target && e.target.tagName === 'BUTTON' && dir === 'wait') return;
    e.preventDefault();
    A.unlock();
    if (!e.repeat && !overlayOpen) pushDir(dir);
  });
  window.addEventListener('keyup', e => { const d = KEYMAP[e.key]; if (d) releaseDir(d); });
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (G.state === 'running')) togglePause();
  });

  document.querySelectorAll('.eh-pad button').forEach(b => {
    const dir = b.dataset.dir;
    b.addEventListener('pointerdown', e => { e.preventDefault(); A.unlock(); if (ov.root.hidden) pushDir(dir); });
    const up = () => releaseDir(dir);
    b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  });
  canvas.addEventListener('pointerdown', () => { A.unlock(); canvas.focus({ preventScroll: true }); });
  $('eh-pause').addEventListener('click', () => { A.unlock(); togglePause(); });
  $('eh-restart').addEventListener('click', restart);

  function syncAudioUi() {
    $('eh-mute').textContent = A.muted ? '🔇' : '🔊';
    $('eh-vol').value = Math.round(A.volume * 100);
  }
  $('eh-mute').addEventListener('click', () => { A.unlock(); A.setMuted(!A.muted); syncAudioUi(); });
  $('eh-vol').addEventListener('input', e => { A.unlock(); A.setVolume(e.target.value / 100); if (A.muted && e.target.value > 0) A.setMuted(false); syncAudioUi(); A.play('gem', 6); });

  // Read-only-ish handle used by automated tests; not needed for normal play.
  window.EchoHeistDebug = {
    get state() { return G.state; },
    get round() { return G.round; },
    get game() { return G; },
    startRun, restart, step: doStep,
  };

  syncAudioUi();
  showTitle();
  requestAnimationFrame(frame);
})();
