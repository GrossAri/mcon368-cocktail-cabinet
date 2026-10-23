import { GAMES, COMING_SOON, findGame } from './registry.js';
import { Input } from './core/input.js';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const input = new Input();
input.attach(canvas);

const els = {
  menu: $('menu'), stage: $('stage'), list: $('game-list'), play: $('play'), modeSet: $('mode-set'),
  dTitle: $('d-title'), dRules: $('d-rules'), dControls: $('d-controls'),
  hud: $('hud'), overlay: $('overlay'), oTitle: $('o-title'), oText: $('o-text'), oButtons: $('o-buttons'),
  title: $('stage-title'), live: $('live'), help: $('stage-help'),
};

let selected = null; // game meta chosen in the menu
let current = null; // { meta, mode, game }
let paused = false;
let lastOverlayKey = '';
let lastMessage = '';

const mode = () => document.querySelector('input[name=mode]:checked').value;
const modeName = (m) => (m === 'flipped' ? 'Flipped' : 'Normal');

// ---- menu -------------------------------------------------------------
function buildMenu() {
  for (const g of GAMES) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card';
    b.dataset.game = g.id;
    b.style.setProperty('--accent', g.accent);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<strong></strong><span></span>`;
    b.querySelector('strong').textContent = g.title;
    b.querySelector('span').textContent = g.tagline;
    b.addEventListener('click', () => select(g));
    li.append(b);
    els.list.append(li);
  }
  for (const g of COMING_SOON) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card';
    b.dataset.game = g.id;
    b.style.setProperty('--accent', g.accent);
    b.setAttribute('aria-disabled', 'true');
    b.innerHTML = `<strong></strong><span></span>`;
    b.querySelector('strong').textContent = `${g.title} (coming soon)`;
    b.querySelector('span').textContent = g.tagline;
    b.addEventListener('click', () => {
      els.dTitle.textContent = `${g.title} is not on the cabinet yet`;
      els.dRules.textContent = g.tagline;
      els.dControls.replaceChildren();
      els.modeSet.disabled = true;
      els.play.disabled = true;
    });
    li.append(b);
    els.list.append(li);
  }
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => selected && renderDetails()));
  els.play.addEventListener('click', () => selected && play(selected, mode()));
}

function select(meta) {
  selected = meta;
  els.list.querySelectorAll('.card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.game === meta.id)));
  els.modeSet.disabled = false;
  els.play.disabled = false;
  renderDetails();
}

function renderDetails() {
  const m = mode();
  els.dTitle.textContent = `${selected.title} — ${modeName(m)} mode`;
  els.dRules.textContent = selected.rules[m];
  els.dControls.replaceChildren(...selected.controls[m].map(([k, v]) => {
    const li = document.createElement('li');
    li.innerHTML = '<b></b> — <span></span>';
    li.querySelector('b').textContent = k;
    li.querySelector('span').textContent = v;
    return li;
  }));
  els.play.textContent = `Play ${selected.title} (${modeName(m)})`;
}

// ---- stage ------------------------------------------------------------
function play(meta, m) {
  current = { meta, mode: m, game: new meta.Game({ mode: m, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0 }) };
  window.__cabinet = current;
  paused = false;
  lastOverlayKey = '';
  lastMessage = '';
  input.releaseAll();
  els.menu.hidden = true;
  els.stage.hidden = false;
  els.title.textContent = `${meta.title} — ${modeName(m)}`;
  els.help.innerHTML = '';
  const h = document.createElement('p');
  h.textContent = meta.rules[m];
  const ul = document.createElement('ul');
  ul.className = 'controls-list';
  for (const [k, v] of meta.controls[m]) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b> — <span></span>';
    li.querySelector('b').textContent = k;
    li.querySelector('span').textContent = v;
    ul.append(li);
  }
  els.help.append(h, ul);
  history.replaceState(null, '', `#${meta.id}/${m}`);
  document.title = `${meta.title} – Cocktail Cabinet`;
  canvas.focus({ preventScroll: true });
}

function toMenu() {
  current = null;
  window.__cabinet = null;
  els.stage.hidden = true;
  els.menu.hidden = false;
  history.replaceState(null, '', location.pathname);
  document.title = 'Cocktail Cabinet';
  const card = selected && els.list.querySelector(`[data-game="${selected.id}"]`);
  (card || els.list.querySelector('.card')).focus();
}

function button(label, onClick, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'btn primary' : 'btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

const restart = (m = current.mode) => play(current.meta, m);
const flip = () => restart(current.mode === 'flipped' ? 'normal' : 'flipped');

function setPaused(p) {
  if (!current || current.game.state !== 'playing') return;
  paused = p;
  $('b-pause').textContent = p ? 'Resume (P)' : 'Pause (P)';
  if (!p) canvas.focus({ preventScroll: true });
}

function syncOverlay() {
  const g = current.game;
  const key = paused ? 'paused' : g.state === 'over' ? `over:${g.result.outcome}` : g.state;
  if (key === lastOverlayKey) return;
  lastOverlayKey = key;
  els.oButtons.replaceChildren();
  if (key === 'playing') {
    els.overlay.hidden = true;
    return;
  }
  els.overlay.hidden = false;
  if (key === 'ready') {
    els.oTitle.textContent = `${current.meta.title} — ${modeName(current.mode)}`;
    els.oText.textContent = current.meta.rules[current.mode];
    els.oButtons.append(button('Start (Space)', () => { g.start(); canvas.focus(); }, true));
  } else if (key === 'paused') {
    els.oTitle.textContent = 'Paused';
    els.oText.textContent = 'Take your time.';
    els.oButtons.append(button('Resume', () => setPaused(false), true));
  } else {
    els.oTitle.textContent = g.result.outcome === 'win' ? 'You win!' : 'You lose';
    els.oText.textContent = g.result.message;
    els.oButtons.append(
      button('Play again', () => restart(), true),
      button(current.mode === 'flipped' ? 'Play normal' : 'Play flipped', flip),
      button('Menu', toMenu),
    );
    els.live.textContent = `${els.oTitle.textContent} ${g.result.message}`;
  }
  // Delay focusing the primary button on game over so a player still mashing
  // Space/Enter doesn't instantly restart without seeing the result.
  const first = els.oButtons.querySelector('button');
  if (first) setTimeout(() => { if (lastOverlayKey === key) first.focus({ preventScroll: true }); }, key.startsWith('over') ? 900 : 0);
}

function syncHud() {
  const g = current.game;
  els.hud.replaceChildren(...g.hud().map(({ label, value }) => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><b></b>';
    li.firstChild.textContent = label;
    li.lastChild.textContent = String(value);
    return li;
  }));
  if (g.message && g.message !== lastMessage) els.live.textContent = g.message;
  lastMessage = g.message;
}

// ---- main loop (fixed 60 Hz simulation, rendering every frame) ---------
const STEP = 1000 / 60;
let acc = 0;
let prev = performance.now();
let frame = 0;
function loop(now) {
  acc = Math.min(acc + (now - prev), STEP * 6);
  prev = now;
  if (current) {
    const g = current.game;
    while (acc >= STEP) {
      acc -= STEP;
      if (!paused) {
        g.step(input);
        input.endTick();
      }
    }
    g.draw(ctx);
    if (frame++ % 4 === 0) syncHud();
    syncOverlay();
  } else acc = 0;
  requestAnimationFrame(loop);
}

// ---- global keys / buttons ------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (!current || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'KeyP') setPaused(!paused);
  else if (e.code === 'KeyR' && !e.repeat) restart();
  else if (e.code === 'Escape') toMenu();
});
$('b-pause').addEventListener('click', () => setPaused(!paused));
$('b-restart').addEventListener('click', () => restart());
$('b-flip').addEventListener('click', flip);
$('b-menu').addEventListener('click', toMenu);
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

// touch buttons feed the same Input object as the keyboard
document.querySelectorAll('#touch [data-key]').forEach((b) => {
  const k = b.dataset.key;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press(k); });
  const up = () => input.release(k);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointerleave', up);
  b.addEventListener('pointercancel', up);
});

// #game/mode deep links (also reacts to the hash changing while the page is open)
function openFromHash() {
  const m = location.hash.match(/^#(\w+)\/(normal|flipped)$/);
  const meta = m && findGame(m[1]);
  if (!meta) return;
  if (current && current.meta.id === meta.id && current.mode === m[2]) return;
  select(meta);
  document.querySelector(`input[name=mode][value=${m[2]}]`).checked = true;
  renderDetails();
  play(meta, m[2]);
}
window.addEventListener('hashchange', openFromHash);

buildMenu();
openFromHash();
requestAnimationFrame(loop);
