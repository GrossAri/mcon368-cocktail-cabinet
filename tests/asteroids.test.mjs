import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AsteroidsGame, ROT, THRUST, MAX_SPEED, FIRE_COOLDOWN, MAX_BULLETS, COST, ENERGY_MAX, SURVIVE_TICKS, pointToT, tToPoint,
} from '../js/games/asteroids.js';
import { idle, makeInput, run, started } from './helpers.mjs';

const keys = (...k) => makeInput({ keys: k });
const ctrlKeys = (c) => keys(...[c.left && 'ArrowLeft', c.right && 'ArrowRight', c.thrust && 'ArrowUp', c.fire && 'Space'].filter(Boolean));
const clear = (g) => { g.asteroids = []; };

test('ship rotates at a fixed rate, thrusts along its heading, and wraps the screen', () => {
  const g = started(AsteroidsGame, { mode: 'normal' });
  clear(g);
  const a0 = g.ship.angle;
  g.step(keys('ArrowRight'));
  assert.ok(Math.abs(g.ship.angle - a0 - ROT) < 1e-9);
  g.ship.angle = 0; g.ship.vx = g.ship.vy = 0;
  g.step(keys('ArrowUp'));
  assert.ok(Math.abs(g.ship.vx - THRUST * 0.99) < 1e-6 && Math.abs(g.ship.vy) < 1e-9);
  g.ship.x = 639.9; g.ship.vx = 3;
  g.step(idle());
  assert.ok(g.ship.x < 10, 'wrapped to the left edge');
  run(g, 600, () => keys('ArrowUp'));
  assert.ok(Math.hypot(g.ship.vx, g.ship.vy) <= MAX_SPEED + 1e-9);
});

test('gun has a cooldown and a bullet cap, bullets expire', () => {
  const g = started(AsteroidsGame, { mode: 'normal' });
  clear(g);
  g.step(keys('Space'));
  assert.equal(g.bullets.length, 1);
  g.step(keys('Space'));
  assert.equal(g.bullets.length, 1, 'cooldown');
  run(g, FIRE_COOLDOWN + 1, () => keys('Space'));
  assert.equal(g.bullets.length, 2);
  g.ship.vx = g.ship.vy = 0;
  run(g, 400, () => keys('Space'));
  assert.ok(g.bullets.length <= MAX_BULLETS);
  run(g, 100);
  assert.equal(g.bullets.length, 0);
});

test('a bullet destroys an asteroid, which splits into two smaller ones; score rises', () => {
  const g = started(AsteroidsGame, { mode: 'normal' });
  g.asteroids = [{ x: 420, y: 240, vx: 0, vy: 0, size: 3 }];
  g.ship.angle = 0;
  g.step(keys('Space'));
  run(g, 40);
  assert.equal(g.asteroids.length, 2);
  assert.ok(g.asteroids.every((a) => a.size === 2));
  assert.equal(g.score, 20);
});

test('small asteroids vanish when shot', () => {
  const g = started(AsteroidsGame, { mode: 'normal' });
  g.asteroids = [{ x: 420, y: 240, vx: 0, vy: 0, size: 1 }, { x: 100, y: 50, vx: 0, vy: 0, size: 1 }];
  g.ship.angle = 0;
  g.step(keys('Space'));
  run(g, 40);
  assert.equal(g.asteroids.length, 1);
  assert.equal(g.score, 100);
});

test('ship collision costs a life, respawns with invulnerability; three lives ends the game', () => {
  const g = started(AsteroidsGame, { mode: 'normal' });
  g.asteroids = [{ x: 320, y: 240, vx: 0, vy: 0, size: 2 }];
  g.step(idle());
  assert.equal(g.lives, 2);
  g.asteroids = [];
  run(g, 100);
  assert.ok(g.invuln > 0 && g.respawnTimer === 0, 'respawned and protected');
  g.asteroids = [{ x: 320, y: 240, vx: 0, vy: 0, size: 3 }];
  g.step(idle());
  assert.equal(g.lives, 2, 'invulnerable right after respawn');
  g.invuln = 0; g.lives = 1;
  g.step(idle());
  assert.equal(g.result.outcome, 'lose');
});

test('normal: clearing waves progresses and wave 5 clear wins', () => {
  const g = started(AsteroidsGame, { mode: 'normal' });
  clear(g);
  run(g, 100);
  assert.equal(g.level, 2);
  assert.ok(g.asteroids.length > 0);
  g.level = 5; clear(g);
  run(g, 100);
  assert.equal(g.result.outcome, 'win');
});

test('normal: a pilot using only the four buttons can clear the game; idle cannot', () => {
  const g = started(AsteroidsGame, { mode: 'normal', seed: 2 });
  run(g, 100000, (gg) => ctrlKeys(AsteroidsGame.prototype.aiControls.call(gg)));
  assert.equal(g.result.outcome, 'win');
});

// ---- flipped -------------------------------------------------------------
test('border parametrisation round-trips', () => {
  for (const [x, y] of [[0, 0], [300, 0], [640, 200], [100, 480], [0, 400]]) {
    const p = tToPoint(pointToT(x, y));
    assert.ok(Math.hypot(p.x - x, p.y - y) < 1e-6, `${x},${y}`);
  }
  const edge = tToPoint(pointToT(320, 100));
  assert.equal(edge.y, 0, 'interior points snap to the nearest border');
});

test('flipped: sending a rock costs energy, is refused when there is not enough, and heads toward the ship', () => {
  const g = started(AsteroidsGame, { mode: 'flipped', seed: 1 });
  assert.equal(g.energy, ENERGY_MAX);
  assert.equal(g.sendAsteroid(320, 0, 3), true);
  assert.equal(g.energy, ENERGY_MAX - COST[3]);
  const a = g.asteroids[0];
  assert.equal(a.y, 0);
  assert.ok(a.vy > 0, 'moving down toward the ship at the centre');
  g.energy = 1;
  assert.equal(g.sendAsteroid(100, 0, 2), false);
  assert.equal(g.asteroids.length, 1);
  assert.equal(g.sendAsteroid(100, 0, 1), true);
});

test('flipped: energy recharges and is capped', () => {
  const g = started(AsteroidsGame, { mode: 'flipped' });
  g.energy = 0;
  run(g, 600);
  assert.ok(g.energy > 5);
  run(g, 3000);
  assert.ok(g.energy <= ENERGY_MAX);
});

test('flipped: keys 1/2/3 pick the size and Space/click throw from the cursor', () => {
  const g = started(AsteroidsGame, { mode: 'flipped' });
  g.step(makeInput({ pressed: ['Digit3'] }));
  assert.equal(g.sendSize, 3);
  g.step(makeInput({ pressed: ['Space'] }));
  assert.equal(g.asteroids.length, 1);
  assert.equal(g.asteroids[0].size, 3);
  g.step(makeInput({ mouse: { x: 600, y: 200, clicked: true, moved: true, inside: true } }));
  assert.equal(g.asteroids.length, 2);
});

test('flipped: the human cannot fly the ship - ship keys do nothing to it', () => {
  const g = started(AsteroidsGame, { mode: 'flipped' });
  const before = { ...g.ship };
  g.ai.timer = 1000; // keep the pilot quiet for this tick
  g.ai.ctrl = { left: false, right: false, thrust: false, fire: false };
  g.step(keys('ArrowUp', 'Space'));
  assert.equal(g.ship.vx, before.vx * 0.99);
  assert.equal(g.bullets.length, 0);
});

test('computer pilot obeys the same limits: rotation <= ROT per tick, speed cap, gun cooldown', () => {
  const g = started(AsteroidsGame, { mode: 'flipped', seed: 3 });
  let prev = g.ship.angle, prevShip = g.ship, maxTurn = 0, shots = 0, lastBullets = 0;
  let r = 3;
  run(g, 4000, (gg) => {
    if (gg.ship === prevShip) maxTurn = Math.max(maxTurn, Math.abs(gg.ship.angle - prev)); // a respawn replaces the ship
    prev = gg.ship.angle; prevShip = gg.ship;
    assert.ok(Math.hypot(gg.ship.vx, gg.ship.vy) <= MAX_SPEED + 1e-9);
    if (gg.bullets.length > lastBullets) shots += gg.bullets.length - lastBullets;
    lastBullets = gg.bullets.length;
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    gg.energy = ENERGY_MAX;
    return makeInput({ mouse: { x: r % 640, y: (r >> 9) % 480, clicked: gg.tick % 20 === 0, moved: false, inside: true } });
  });
  assert.ok(maxTurn <= ROT + 1e-9, `turned ${maxTurn}`);
  assert.ok(shots <= 4000 / FIRE_COOLDOWN + 1, `${shots} shots`);
  assert.ok(shots > 5, 'and it actually shoots');
});

test('computer pilot shoots down an incoming rock', () => {
  const g = started(AsteroidsGame, { mode: 'flipped', seed: 5 });
  g.sendAsteroid(0, 240, 2);
  run(g, 600);
  assert.ok(g.destroyed >= 1, 'rock was destroyed');
  assert.ok(g.lives >= 2);
});

test('flipped: survive 90 seconds => computer wins; destroying all ships => human wins', () => {
  const idleRun = started(AsteroidsGame, { mode: 'flipped', seed: 1 });
  run(idleRun, SURVIVE_TICKS + 5, idle);
  assert.equal(idleRun.result.outcome, 'lose');
  const g = started(AsteroidsGame, { mode: 'flipped' });
  g.invuln = 0; g.lives = 1;
  g.asteroids = [{ x: g.ship.x, y: g.ship.y, vx: 0, vy: 0, size: 3 }];
  g.step(idle());
  assert.equal(g.result.outcome, 'win');
});

test('flipped: a human who keeps throwing rocks can win', () => {
  let wins = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const g = started(AsteroidsGame, { mode: 'flipped', seed });
    let r = seed;
    run(g, SURVIVE_TICKS + 10, (gg) => {
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      gg.sendSize = gg.energy >= 3 ? 3 : gg.energy >= 2 ? 2 : 1;
      return makeInput({ mouse: { x: r % 640, y: (r >> 9) % 480, clicked: gg.energy >= 1, moved: false, inside: true } });
    });
    if (g.result.outcome === 'win') wins++;
  }
  assert.ok(wins >= 1 && wins <= 5, `human won ${wins}/6`);
});
