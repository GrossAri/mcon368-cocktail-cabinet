import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MissileGame, GROUND_Y, INTERCEPT_SPEED, BATTERY_AMMO, LAUNCH_COOLDOWN, BLAST_R, BLAST_TICKS, CITY_X, humanSupplyFor, enemySpeedFor,
} from '../js/games/missile.js';
import { idle, makeInput, run, started } from './helpers.mjs';

const click = (x, y) => makeInput({ mouse: { x, y, clicked: true, moved: true, inside: true } });
// a normal-mode game with the computer's attack switched off, for controlled scenarios
const quiet = (opts = {}) => {
  const g = started(MissileGame, { mode: 'normal', seed: 1, ...opts });
  g.toLaunch = 1; g.nextLaunch = 1e9; // wave never ends and nothing attacks
  return g;
};

test('normal: clicking fires an interceptor from the nearest battery that explodes at the target after real travel time', () => {
  const g = quiet();
  g.step(click(80, 200));
  assert.equal(g.interceptors.length, 1);
  assert.equal(g.interceptors[0].battery, g.batteries[0], 'nearest battery is the left one');
  assert.equal(g.batteries[0].ammo, BATTERY_AMMO - 1);
  const need = g.interceptors[0].steps;
  assert.ok(need > 20, 'takes time to arrive');
  run(g, need - 2);
  assert.equal(g.blasts.length, 0);
  run(g, 3);
  assert.ok(g.blasts.some((b) => !b.ground && Math.abs(b.x - 80) < 1 && Math.abs(b.y - 200) < 1));
});

test('normal: batteries run out of ammo and can fire only after their reload', () => {
  const g = quiet();
  for (let i = 0; i < 30; i++) { g.step(click(320, 200)); run(g, 20); }
  assert.equal(g.batteries.reduce((s, b) => s + b.ammo, 0), 0, 'all 15 shots used, none spawned from nothing');
  assert.equal(g.humanFire(320, 200), false);
});

test('an explosion destroys enemy missiles inside its radius but not outside it', () => {
  const g = quiet();
  g.enemies = [
    { sx: 0, sy: 0, x: 300, y: 200, tx: 300, ty: GROUND_Y, vx: 0, vy: 0.01, alive: true, covered: 0 },
    { sx: 0, sy: 0, x: 300 + BLAST_R + 30, y: 200, tx: 400, ty: GROUND_Y, vx: 0, vy: 0.01, alive: true, covered: 0 },
  ];
  g.blasts.push({ x: 300, y: 200, t: BLAST_TICKS / 2 - 1, max: BLAST_R });
  g.step(idle());
  assert.equal(g.enemies.length, 1);
  assert.ok(g.enemies[0].x > 300 + BLAST_R);
  assert.equal(g.score, 25);
});

test('blast radius grows then shrinks, and ends', () => {
  const g = quiet();
  const b = { x: 0, y: 0, t: 0, max: 30 };
  assert.equal(g.blastRadius(b), 0);
  b.t = BLAST_TICKS / 2;
  assert.equal(g.blastRadius(b), 30);
  b.t = BLAST_TICKS;
  assert.equal(g.blastRadius(b), 0);
});

test('an enemy missile that reaches its target destroys that city; it does not skip collisions', () => {
  const g = quiet();
  const city = g.cities[0];
  g.launchEnemy(city.x, city.x, GROUND_Y);
  assert.ok(city.alive);
  run(g, 2000);
  assert.equal(city.alive, false);
  assert.equal(g.aliveCities, 5);
});

test('normal: losing every city ends the game', () => {
  const g = quiet();
  g.cities.forEach((c) => { c.alive = false; });
  g.step(idle());
  assert.equal(g.result.outcome, 'lose');
});

test('normal: surviving a wave refills ammo, repairs a city and advances; wave 5 survived wins', () => {
  const g = quiet();
  g.cities[2].alive = false;
  g.batteries[1].ammo = 0;
  g.toLaunch = 0;
  run(g, 140);
  assert.equal(g.level, 2);
  assert.equal(g.batteries[1].ammo, BATTERY_AMMO);
  g.level = 5; g.toLaunch = 0;
  run(g, 140);
  assert.equal(g.result.outcome, 'win');
});

test('waves get faster and bigger (computer attack)', () => {
  assert.ok(enemySpeedFor(5) > enemySpeedFor(1));
  const g = started(MissileGame, { mode: 'normal' });
  const w1 = g.toLaunch;
  g.level = 4; g.startWave();
  assert.ok(g.toLaunch > w1);
});

test('normal: a human leading the targets (using real interceptor travel) holds off the attack; idling does not', () => {
  const g = started(MissileGame, { mode: 'normal', seed: 2 });
  run(g, 60000, (gg) => {
    const m = gg.enemies.find((e) => !gg.isCovered(e));
    if (!m) return idle();
    const b = gg.batteries.filter((x) => x.alive && x.ammo > 0 && x.cool === 0).sort((p, q) => Math.abs(p.x - m.x) - Math.abs(q.x - m.x))[0];
    const p = b && gg.solveIntercept(b, m);
    return p ? click(p.x, p.y) : idle();
  });
  assert.ok(g.level >= 4 && g.score > 1500, `reached wave ${g.level}, score ${g.score}`);
  const i = started(MissileGame, { mode: 'normal', seed: 2 });
  run(i, 60000, idle);
  assert.equal(i.result.outcome, 'lose');
});

// ---- flipped ------------------------------------------------------------------
test('flipped: the human launches from the launcher position toward the clicked target, rationed by supply and reload', () => {
  const g = started(MissileGame, { mode: 'flipped', seed: 1 });
  g.launcherX = 100;
  assert.equal(g.supply, humanSupplyFor(1));
  g.step(click(CITY_X[1], GROUND_Y));
  assert.equal(g.enemies.length, 1);
  assert.equal(g.enemies[0].sx, 100);
  assert.equal(g.enemies[0].tx, CITY_X[1]);
  assert.equal(g.supply, humanSupplyFor(1) - 1);
  g.step(click(CITY_X[2], GROUND_Y));
  assert.equal(g.enemies.length, 1, 'reload blocks an immediate second launch');
  run(g, LAUNCH_COOLDOWN);
  g.step(click(CITY_X[2], GROUND_Y));
  assert.equal(g.enemies.length, 2);
});

test('flipped: the human cannot fire interceptors, and the computer defender is automatic', () => {
  const g = started(MissileGame, { mode: 'flipped' });
  assert.equal(g.humanFire(100, 100), false);
  assert.equal(g.interceptors.length, 0);
});

test('flipped: running out of missiles ends the human’s wave; unused missiles are forfeited after a long idle', () => {
  const g = started(MissileGame, { mode: 'flipped' });
  run(g, 950);
  assert.equal(g.supply, 0, 'forfeited');
  run(g, 120);
  assert.equal(g.level, 2, 'next wave began');
});

test('computer defender fires real interceptors: finite speed, limited ammo, reload, no firing from a destroyed battery', () => {
  const g = started(MissileGame, { mode: 'flipped', seed: 1 });
  g.launcherX = 320;
  g.humanLaunch(CITY_X[4], GROUND_Y);
  let fired = null;
  run(g, 600, (gg) => {
    if (!fired && gg.interceptors.length) fired = { ...gg.interceptors[0], tick: gg.tick };
    return idle();
  });
  assert.ok(fired, 'defender reacted');
  assert.ok(fired.tick > 5, 'with a reaction delay');
  assert.ok(Math.hypot(fired.vx, fired.vy) <= INTERCEPT_SPEED + 1e-9);

  const h = started(MissileGame, { mode: 'flipped', seed: 1 });
  h.batteries.forEach((b) => { b.alive = false; });
  h.humanLaunch(CITY_X[0], GROUND_Y);
  run(h, 300);
  assert.equal(h.interceptors.length + h.shotsFired, 0, 'no battery, no defence');

  const k = started(MissileGame, { mode: 'flipped', seed: 1 });
  k.batteries.forEach((b) => { b.ammo = 0; });
  k.humanLaunch(CITY_X[0], GROUND_Y);
  run(k, 300);
  assert.equal(k.shotsFired, 0, 'no ammo, no shots');
});

test('defender ammo is never negative and total shots never exceed supply of ammo', () => {
  const g = started(MissileGame, { mode: 'flipped', seed: 4 });
  let r = 4;
  run(g, 4000, (gg) => {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    gg.launcherX = r % 640;
    gg.batteries.forEach((b) => assert.ok(b.ammo >= 0));
    return click(CITY_X[r % 6], GROUND_Y);
  });
  assert.ok(g.shotsFired <= g.level * BATTERY_AMMO * 3);
});

test('flipped: destroying every city wins for the human; surviving all waves wins for the computer', () => {
  const g = started(MissileGame, { mode: 'flipped' });
  g.cities.forEach((c) => { c.alive = false; });
  g.step(idle());
  assert.equal(g.result.outcome, 'win');
  const h = started(MissileGame, { mode: 'flipped' });
  h.level = 5; h.supply = 0; h.enemies = [];
  run(h, 140);
  assert.equal(h.result.outcome, 'lose');
});

test('flipped: a human who knocks out batteries first beats the defender; one who never fires loses', () => {
  const g = started(MissileGame, { mode: 'flipped', seed: 1 });
  let r = 7;
  run(g, 60000, (gg) => {
    if (gg.launchCool > 0 || gg.supply <= 0) return idle();
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    const bs = gg.batteries.filter((b) => b.alive), cs = gg.cities.filter((c) => c.alive);
    const pool = bs.length && gg.level < 3 ? bs : cs.length ? cs : bs;
    const t = pool[r % pool.length];
    gg.launcherX = (r >> 5) % 640;
    return click(t.x, GROUND_Y);
  });
  assert.equal(g.result.outcome, 'win');
  const i = started(MissileGame, { mode: 'flipped', seed: 1 });
  run(i, 60000, idle);
  assert.equal(i.result.outcome, 'lose');
});
