import test from 'node:test';
import assert from 'node:assert/strict';
import { PongGame, WIN_SCORE, PADDLE_H, FUEL_MAX } from '../js/games/pong.js';
import { idle, makeInput, run, started } from './helpers.mjs';

const keys = (...k) => makeInput({ keys: k });

test('normal: the human moves the left paddle with the keys, clamped to the court', () => {
  const g = started(PongGame, { mode: 'normal' });
  const y0 = g.left.y;
  run(g, 10, () => keys('ArrowUp'));
  assert.ok(g.left.y < y0);
  run(g, 200, () => keys('ArrowUp'));
  assert.equal(g.left.y, 0);
  run(g, 200, () => keys('ArrowDown'));
  assert.equal(g.left.y, 480 - PADDLE_H);
});

test('ball bounces off top and bottom walls', () => {
  const g = started(PongGame, { mode: 'normal' });
  g.serveTimer = 0;
  Object.assign(g.ball, { x: 320, y: 9, vx: 0.1, vy: -4 });
  g.step(idle());
  assert.ok(g.ball.vy > 0);
  Object.assign(g.ball, { x: 320, y: 471, vx: 0.1, vy: 4 });
  g.step(idle());
  assert.ok(g.ball.vy < 0);
});

test('paddle returns the ball; hitting off-centre changes the angle', () => {
  const g = started(PongGame, { mode: 'normal' });
  g.serveTimer = 0;
  g.left.y = 200;
  Object.assign(g.ball, { x: 45, y: 200 + 5, vx: -4, vy: 0, speed: 4 });
  run(g, 3);
  assert.ok(g.ball.vx > 0, 'returned');
  assert.ok(g.ball.vy < 0, 'hit near the top sends it upward');
});

test('normal: missing the ball gives the computer a point; level rises when the human scores', () => {
  const g = started(PongGame, { mode: 'normal' });
  g.serveTimer = 0;
  g.left.y = 400;
  Object.assign(g.ball, { x: 30, y: 50, vx: -4, vy: 0 });
  run(g, 20);
  assert.equal(g.cpuPts, 1);
  g.serveTimer = 0;
  Object.assign(g.ball, { x: 620, y: 5, vx: 4, vy: 0 });
  g.right.y = 300;
  run(g, 20);
  assert.equal(g.humanPts, 1);
  assert.equal(g.level, 2);
  assert.ok(g.aiMaxSpeed > 1.7 && g.aiError < 70, 'computer gets sharper');
});

test('first to 7 ends the match with the right outcome', () => {
  const g = started(PongGame, { mode: 'normal' });
  g.humanPts = WIN_SCORE - 1;
  g.pointTo('human', 'scored');
  assert.equal(g.result.outcome, 'win');
  const h = started(PongGame, { mode: 'normal' });
  h.cpuPts = WIN_SCORE - 1;
  h.pointTo('cpu', 'missed');
  assert.equal(h.result.outcome, 'lose');
});

test('computer paddle never exceeds its speed cap and stays on court', () => {
  for (const mode of ['normal', 'flipped']) {
    const g = started(PongGame, { mode, seed: 4 });
    let last = g.right.y, maxStep = 0;
    run(g, 6000, () => {
      maxStep = Math.max(maxStep, Math.abs(g.right.y - last));
      last = g.right.y;
      assert.ok(g.right.y >= 0 && g.right.y <= 480 - PADDLE_H);
      return keys('ArrowUp');
    });
    assert.ok(maxStep <= 5.2 + 1e-9, `${mode} max step ${maxStep}`);
  }
});

test('normal: an attentive human beats nothing; an idle human loses', () => {
  const g = started(PongGame, { mode: 'normal', seed: 2 });
  run(g, 60000);
  assert.equal(g.result.outcome, 'lose');
  assert.equal(g.humanPts, 0);
});

test('normal: a tracking human can score against the computer', () => {
  const g = started(PongGame, { mode: 'normal', seed: 3 });
  run(g, 60000, (gg) => {
    const c = gg.left.y + 40;
    return keys(...(gg.ball.y > c + 8 ? ['ArrowDown'] : gg.ball.y < c - 8 ? ['ArrowUp'] : []));
  });
  assert.ok(g.humanPts >= 2, `scored ${g.humanPts}`);
});

// ---- flipped: the human is the ball --------------------------------------
test('flipped: the human has no paddle - arrows steer the ball, the left paddle never moves', () => {
  const g = started(PongGame, { mode: 'flipped' });
  g.serveTimer = 0;
  Object.assign(g.ball, { x: 300, y: 240, vx: 4, vy: 0, speed: 4 });
  const left0 = g.left.y;
  run(g, 20, () => keys('ArrowDown'));
  assert.ok(g.ball.vy > 0, 'ball curved down');
  assert.equal(g.left.y, left0);
  const speed = Math.hypot(g.ball.vx, g.ball.vy);
  assert.ok(Math.abs(speed - 4) < 0.2, 'steering never adds speed');
});

test('flipped: steering uses fuel, runs out, then recharges', () => {
  const g = started(PongGame, { mode: 'flipped' });
  g.serveTimer = 0;
  Object.assign(g.ball, { x: 100, y: 240, vx: 0.01, vy: 0, speed: 4 });
  run(g, 90, () => keys('ArrowUp'));
  assert.ok(g.exhausted);
  assert.ok(g.fuel < 25, 'drained');
  const vy = g.ball.vy;
  run(g, 5, () => keys('ArrowUp'));
  assert.equal(g.ball.vy, vy, 'no steering while exhausted');
  run(g, 300, idle);
  assert.ok(g.fuel > 25 && g.fuel <= FUEL_MAX);
});

test('flipped: the left edge is a wall, so the ball rebounds there instead of scoring for anyone', () => {
  const g = started(PongGame, { mode: 'flipped' });
  g.serveTimer = 0;
  Object.assign(g.ball, { x: 10, y: 240, vx: -4, vy: 0 });
  g.step(idle());
  assert.ok(g.ball.vx > 0);
  assert.equal(g.cpuPts, 0);
});

test('flipped: getting the ball past the paddle scores for the human', () => {
  const g = started(PongGame, { mode: 'flipped' });
  g.serveTimer = 0;
  g.right.y = 0;
  g.ai.timer = 99; g.ai.target = 0;
  Object.assign(g.ball, { x: 600, y: 400, vx: 5, vy: 0 });
  run(g, 20);
  assert.equal(g.humanPts, 1);
});

test('flipped: if the paddle returns the ball too often the defender takes the point', () => {
  const g = started(PongGame, { mode: 'flipped' });
  g.serveTimer = 0;
  g.returns = g.returnLimit - 1;
  g.right.y = 200;
  g.ai.timer = 99; g.ai.target = 240;
  Object.assign(g.ball, { x: 590, y: 240, vx: 4, vy: 0 });
  run(g, 10);
  assert.equal(g.cpuPts, 1);
  assert.equal(g.returns, 0, 'new rally');
  assert.ok(g.returnLimit >= 3);
});

test('flipped: a ball-steering human can win points, and an idle ball loses', () => {
  const smart = started(PongGame, { mode: 'flipped', seed: 2 });
  run(smart, 60000, (gg) => {
    const pc = gg.right.y + 40;
    return keys(...(gg.ball.x > 250 ? (pc > 240 ? ['ArrowUp'] : ['ArrowDown']) : []));
  });
  assert.ok(smart.humanPts >= 3, `human scored ${smart.humanPts}`);
  const idleGame = started(PongGame, { mode: 'flipped', seed: 2 });
  run(idleGame, 60000, idle);
  assert.equal(idleGame.result.outcome, 'lose');
});
