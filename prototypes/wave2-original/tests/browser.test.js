// Browser end-to-end check. Needs Playwright + Chromium and a static server on the game folder:
//   (cd prototypes/wave2-original && python3 -m http.server 8765) &
//   NODE_PATH=$(npm root -g) node prototypes/wave2-original/tests/browser.test.js
// Env: ECHO_URL (default http://localhost:8765/index.html), CHROMIUM (path to browser binary).
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');
const URL = process.env.ECHO_URL || 'http://localhost:8765/index.html';
const SHOTS = process.env.ECHO_SHOTS || '';
let passed = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function newPage(query = '', viewport = { width: 900, height: 900 }) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(URL + query);
    await page.waitForFunction(() => window.EchoHeistDebug);
    return page;
  }
  const state = page => page.evaluate(() => window.EchoHeistDebug.state);
  const snap = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, name + '.png') }) : null;
  async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }

  // Play a whole round in-page by following the engine-verified solver route (fast, deterministic).
  const autoplay = page => page.evaluate(() => {
    const D = window.EchoHeistDebug, C = window.EchoCore, r = D.round;
    const route = C.solve(r.layout, r.gems, r.echoes, r.limit);
    if (!route) return 'nosolution';
    for (let i = 1; i < route.length && D.round.status === 'ready' || D.round.status === 'running'; i++) {
      const a = route[i - 1], b = route[i];
      D.step(b.x > a.x ? C.DIRS.right : b.x < a.x ? C.DIRS.left : b.y > a.y ? C.DIRS.down : b.y < a.y ? C.DIRS.up : 'wait');
      if (i >= route.length - 1) break;
    }
    return D.round.status;
  });

  await t('title screen shows rules and no console errors', async () => {
    const page = await newPage('?seed=5');
    assert.strictEqual(await state(page), 'title');
    const text = await page.textContent('#eh-overlay');
    assert(/gem/i.test(text) && /Echo/.test(text) && /4 steps/.test(text), 'rules visible');
    await snap(page, '01-title');
    await page.context().close();
  });

  await t('real keyboard: Enter starts, hold-to-move, Space waits, clock starts on first step', async () => {
    const page = await newPage('?seed=5');
    await page.keyboard.press('Enter');
    assert.strictEqual(await state(page), 'ready');
    await sleep(400);
    assert.strictEqual(await page.evaluate(() => window.EchoHeistDebug.round.tick), 0, 'clock must not run before first step');
    await page.keyboard.down('ArrowRight'); await sleep(620); await page.keyboard.up('ArrowRight');
    const x = await page.evaluate(() => window.EchoHeistDebug.round.player.x);
    assert(x >= 4, 'held arrow moved several tiles, got x=' + x);
    assert.strictEqual(await state(page), 'running');
    await snap(page, '02-running');
    const tick0 = await page.evaluate(() => window.EchoHeistDebug.round.tick);
    await page.keyboard.press(' '); await sleep(400);
    const px = await page.evaluate(() => window.EchoHeistDebug.round.player.x);
    assert.strictEqual(px, x, 'Space waits in place');
    assert(await page.evaluate(t0 => window.EchoHeistDebug.round.tick > t0, tick0), 'time advances while waiting');
    await page.context().close();
  });

  await t('a single tap moves exactly one tile', async () => {
    const page = await newPage('?seed=5');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await sleep(500);
    const p = await page.evaluate(() => window.EchoHeistDebug.round.player);
    assert.deepStrictEqual(p, { x: 1, y: 2 });
    await page.context().close();
  });

  await t('pause freezes the clock; resume continues; mute toggles', async () => {
    const page = await newPage('?seed=5');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await sleep(300);
    await page.keyboard.press('p');
    assert.strictEqual(await state(page), 'paused');
    const a = await page.evaluate(() => window.EchoHeistDebug.round.tick);
    await sleep(600);
    assert.strictEqual(await page.evaluate(() => window.EchoHeistDebug.round.tick), a);
    await snap(page, '03-paused');
    await page.keyboard.press('p');
    assert.strictEqual(await state(page), 'running');
    await sleep(500);
    assert(await page.evaluate(a => window.EchoHeistDebug.round.tick > a, a));
    const before = await page.textContent('#eh-mute');
    await page.keyboard.press('m');
    assert.notStrictEqual(await page.textContent('#eh-mute'), before);
    await page.context().close();
  });

  await t('full vault: five rounds clear, Echoes accumulate, vault cracks into the next', async () => {
    const page = await newPage('?seed=5');
    await page.keyboard.press('Enter');
    for (let r = 1; r <= 5; r++) {
      assert.strictEqual(await page.evaluate(() => window.EchoHeistDebug.round.echoes.length), r - 1, 'echoes at round ' + r);
      assert.strictEqual(await autoplay(page), 'cleared', 'round ' + r);
      await page.waitForFunction(() => ['between'].includes(window.EchoHeistDebug.state), null, { timeout: 4000 });
      const title = await page.textContent('#eh-ov-title');
      if (r < 5) assert(/Round clear/.test(title), title); else assert(/Vault 1 cracked/.test(title), title);
      if (r === 2) await snap(page, '04-round-clear');
      await page.click('#eh-ov-btn');
    }
    assert.strictEqual(await page.textContent('#eh-vault'), '2');
    assert.strictEqual(await page.evaluate(() => window.EchoHeistDebug.round.echoes.length), 0, 'echoes reset in new vault');
    assert(parseInt(await page.textContent('#eh-score'), 10) > 500, 'score accumulated');
    assert.strictEqual(await page.textContent('#eh-best'), await page.textContent('#eh-score'));
    await page.context().close();
  });

  await t('being caught by an Echo ends the run, shows why, and Try again restarts cleanly', async () => {
    const page = await newPage('?seed=5&vault=1&round=2');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.evaluate(() => window.EchoHeistDebug.round.echoes.length), 1);
    // step off start, then stand still where the Echo's route runs through us
    await page.evaluate(() => {
      const D = window.EchoHeistDebug, C = window.EchoCore;
      const s = D.round.layout.start, p1 = D.round.echoes[0].path[1]; // stand on the Echo's first tile
      D.step({ dx: p1.x - s.x, dy: p1.y - s.y });
      for (let i = 0; i < 40 && D.round.status === 'running'; i++) D.step('wait');
    });
    await page.waitForFunction(() => window.EchoHeistDebug.state === 'over', null, { timeout: 4000 });
    assert(/Caught/.test(await page.textContent('#eh-ov-title')));
    assert(/Echo #1/.test(await page.textContent('#eh-ov-body')));
    await snap(page, '05-caught');
    await page.click('#eh-ov-btn');
    assert.strictEqual(await state(page), 'ready');
    assert.strictEqual(await page.evaluate(() => window.EchoHeistDebug.round.tick), 0);
    assert.strictEqual(await page.evaluate(() => window.EchoHeistDebug.game.score), 0, 'score reset');
    await page.context().close();
  });

  await t('running out of time ends the run', async () => {
    const page = await newPage('?seed=5');
    await page.keyboard.press('Enter');
    await page.evaluate(() => {
      const D = window.EchoHeistDebug, C = window.EchoCore;
      D.step(C.DIRS.right);
      for (let i = 0; i < 1000 && D.round.status === 'running'; i++) D.step('wait');
    });
    await page.waitForFunction(() => window.EchoHeistDebug.state === 'over', null, { timeout: 4000 });
    assert(/Time/.test(await page.textContent('#eh-ov-title')));
    await page.keyboard.press('Enter');          // overlay primary via keyboard
    assert.strictEqual(await state(page), 'ready');
    await page.context().close();
  });

  await t('level-select URL jumps to a late round with the right Echoes, and R restarts', async () => {
    const page = await newPage('?seed=9&vault=4&round=5');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.textContent('#eh-vault'), '4');
    assert.strictEqual(await page.textContent('#eh-echoes'), '4');
    assert.strictEqual(await page.textContent('#eh-round'), '5/5');
    await snap(page, '06-late-round');
    await page.keyboard.press('ArrowRight'); await sleep(300);
    await page.keyboard.press('r');
    assert.strictEqual(await state(page), 'ready');
    assert.strictEqual(await page.evaluate(() => window.EchoHeistDebug.round.tick), 0);
    await page.context().close();
  });

  await t('phone viewport: touch pad visible, canvas fits without horizontal scroll', async () => {
    const page = await newPage('?seed=5', { width: 390, height: 844 });
    await page.click('#eh-ov-btn');
    assert(await page.isVisible('.eh-pad'));
    await page.dispatchEvent('.eh-pad [data-dir=right]', 'pointerdown');
    await page.dispatchEvent('.eh-pad [data-dir=right]', 'pointerup');
    await sleep(400);
    assert(await page.evaluate(() => window.EchoHeistDebug.round.player.x) >= 2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow');
    await snap(page, '07-phone');
    await page.context().close();
  });

  assert.deepStrictEqual(errors, [], 'console errors: ' + errors.join(' | '));
  console.log(`\n${passed} browser tests passed, 0 console errors`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
