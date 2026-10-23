// Browser smoke test: drives the real cabinet in headless Chromium.
// Run: npm run test:browser   (needs Playwright; uses the globally installed one if not local)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shots = path.join(root, 'tests/browser/screenshots');
fs.mkdirSync(shots, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* try next */ }
  }
  throw new Error('Playwright not found. Install it (npm i -D playwright) or run in an environment that has it.');
}
const { chromium } = loadPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

let passed = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); passed++; results.push(`PASS  ${name}`); } catch (e) { results.push(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); process.exitCode = 1; }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const GAMES = ['snake', 'breakout', 'splat', 'asteroids', 'missile', 'pong'];
const state = () => page.evaluate(() => ({ s: window.__cabinet.game.state, tick: window.__cabinet.game.tick, mode: window.__cabinet.game.mode, id: window.__cabinet.meta.id }));
const canvasPoint = async (x, y) => { // game coordinates -> page coordinates
  const box = await page.locator('#canvas').boundingBox();
  return { x: box.x + (x / 640) * box.width, y: box.y + (y / 480) * box.height };
};
async function openGame(id, mode) {
  await page.goto(base);
  await page.click(`.card[data-game="${id}"]`);
  await page.check(`input[name=mode][value=${mode}]`);
  await page.click('#play');
  await page.waitForSelector('#stage:not([hidden])');
}
async function startPlaying() {
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__cabinet.game.state === 'playing');
}
async function nonBlank() {
  return page.evaluate(() => {
    const c = document.getElementById('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    return seen.size;
  });
}

await check('menu lists six playable games and a locked Imitation card', async () => {
  await page.goto(base);
  assert.equal(await page.locator('.card:not([aria-disabled])').count(), 6);
  assert.equal(await page.locator('.card[aria-disabled="true"]').count(), 1);
  assert.match(await page.locator('.card[aria-disabled="true"]').innerText(), /Imitation/);
  await page.screenshot({ path: path.join(shots, 'menu.png') });
});

for (const id of GAMES) for (const mode of ['normal', 'flipped']) {
  await check(`${id} (${mode}): opens, starts on Space, runs, renders, shows HUD`, async () => {
    await openGame(id, mode);
    assert.equal((await state()).s, 'ready');
    assert.ok(await page.locator('#overlay').isVisible(), 'start overlay visible');
    await startPlaying();
    await page.waitForTimeout(700);
    const st = await state();
    assert.equal(st.mode, mode);
    assert.ok(st.tick > 20, `ticks advanced (${st.tick})`);
    assert.ok(await page.locator('#hud li').count() >= 2, 'hud populated');
    assert.ok(await nonBlank() > 3, 'canvas drawn');
    assert.ok(!(await page.locator('#overlay').isVisible()), 'overlay hidden while playing');
    await page.screenshot({ path: path.join(shots, `${id}-${mode}.png`) });
  });
}

await check('snake normal: arrow keys steer', async () => {
  await openGame('snake', 'normal');
  await startPlaying();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => window.__cabinet.game.dir), { x: 0, y: -1 });
});

await check('snake flipped: clicking the board places an apple; computer snake then moves toward it', async () => {
  await openGame('snake', 'flipped');
  await startPlaying();
  const p = await canvasPoint(100, 60);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.__cabinet.game.apple), { x: 5, y: 3 });
  const x0 = await page.evaluate(() => window.__cabinet.game.snake[0].x);
  await page.waitForTimeout(900);
  assert.notEqual(await page.evaluate(() => window.__cabinet.game.snake.length > 0 && window.__cabinet.game.snake[0].x + ',' + window.__cabinet.game.snake[0].y), x0 + ',12');
});

await check('splat normal: Space flaps; splat flipped: click places a column', async () => {
  await openGame('splat', 'normal');
  await startPlaying();
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => window.__cabinet.game.flying));
  await openGame('splat', 'flipped');
  await startPlaying();
  await page.waitForTimeout(900);
  const p = await canvasPoint(560, 200);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  assert.ok((await page.evaluate(() => window.__cabinet.game.columns.length)) >= 1);
});

await check('missile normal: click fires an interceptor; flipped: click launches an enemy missile', async () => {
  await openGame('missile', 'normal');
  await startPlaying();
  const p = await canvasPoint(300, 150);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
  assert.ok((await page.evaluate(() => window.__cabinet.game.shotsFired)) >= 1);
  await openGame('missile', 'flipped');
  await startPlaying();
  const q = await canvasPoint(170, 428);
  await page.mouse.move(q.x, q.y);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(80);
  assert.ok((await page.evaluate(() => window.__cabinet.game.enemies.length)) >= 1);
});

await check('asteroids flipped: click throws a rock that costs energy', async () => {
  await openGame('asteroids', 'flipped');
  await startPlaying();
  const p = await canvasPoint(320, 4);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
  assert.ok((await page.evaluate(() => window.__cabinet.game.energy)) < 8);
});

await check('breakout flipped: left arrow moves the deflector; pong flipped: arrows steer the ball', async () => {
  await openGame('breakout', 'flipped');
  await startPlaying();
  const x0 = await page.evaluate(() => window.__cabinet.game.shield.x);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowLeft');
  assert.ok((await page.evaluate(() => window.__cabinet.game.shield.x)) < x0);
  await openGame('pong', 'flipped');
  await startPlaying();
  await page.waitForTimeout(1200);
  const fuel0 = await page.evaluate(() => window.__cabinet.game.fuel);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowUp');
  assert.ok((await page.evaluate(() => window.__cabinet.game.fuel)) < fuel0 || fuel0 < 100);
});

await check('pause, resume, restart, flip roles, and Escape back to the menu', async () => {
  await openGame('pong', 'normal');
  await startPlaying();
  await page.keyboard.press('KeyP');
  const t = (await state()).tick;
  await page.waitForTimeout(300);
  assert.equal((await state()).tick, t, 'frozen while paused');
  assert.ok(await page.locator('#overlay').isVisible());
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  assert.ok((await state()).tick > t);
  await page.click('#b-flip');
  assert.equal((await state()).mode, 'flipped');
  await page.click('#b-restart');
  assert.equal((await state()).mode, 'flipped');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#menu').isVisible());
});

await check('game over shows result overlay with replay options', async () => {
  await openGame('snake', 'normal');
  await startPlaying();
  await page.waitForFunction(() => window.__cabinet.game.state === 'over', null, { timeout: 15000 }); // snake runs into the wall
  assert.ok(await page.locator('#overlay').isVisible());
  assert.match(await page.locator('#o-title').innerText(), /lose/i);
  assert.ok((await page.locator('#o-buttons button').count()) >= 3);
  await page.screenshot({ path: path.join(shots, 'game-over.png') });
});

await check('deep link #splat/flipped opens straight into the game', async () => {
  await page.goto(base + '#splat/flipped');
  await page.waitForSelector('#stage:not([hidden])');
  assert.equal((await state()).id, 'splat');
  assert.equal((await state()).mode, 'flipped');
});

await check('phone viewport: no horizontal scroll in menu or game', async () => {
  const phone = await browser.newContext({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true });
  const pp = await phone.newPage();
  await pp.goto(base);
  assert.ok(await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'menu fits');
  await pp.screenshot({ path: path.join(shots, 'menu-phone.png') });
  await pp.goto(base + '#snake/normal');
  await pp.waitForSelector('#stage:not([hidden])');
  assert.ok(await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'game fits');
  await pp.screenshot({ path: path.join(shots, 'game-phone.png') });
  await phone.close();
});

await check('no console or page errors during the whole run', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} browser checks passed`);
