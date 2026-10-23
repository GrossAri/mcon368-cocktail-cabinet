import test from 'node:test';
import assert from 'node:assert/strict';
import { BreakoutGame, PADDLE_Y, SHIELD_Y, SHIELD_COST, SHIELD_MAX, BRICK_W, BRICK_H } from '../js/games/breakout.js';
import { idle, makeInput, run, started } from './helpers.mjs';

const keys = (...k) => makeInput({ keys: k });
const serve = (g) => { g.served = true; g.ball.speed = 4; };
const only = (g, n) => { g.bricks.forEach((b, i) => { b.alive = i < n; }); };

test('normal: bricks are hit, destroyed and scored; ball reflects', () => {
  const g = started(BreakoutGame, { mode: 'normal' });
  const br = g.bricks[g.bricks.length - 1]; // lowest row
  const before = g.aliveBricks;
  serve(g);
  Object.assign(g.ball, { x: br.x + 20, y: br.y + BRICK_H + 12, vx: 0, vy: -4 });
  run(g, 10);
  assert.equal(g.aliveBricks, before - 1);
  assert.ok(g.score > 0);
  assert.ok(g.ball.vy > 0, 'bounced back down');
});

test('ball reflects off walls and ceiling', () => {
  const g = started(BreakoutGame, { mode: 'normal' });
  serve(g);
  Object.assign(g.ball, { x: 8, y: 300, vx: -4, vy: 0.5 });
  run(g, 3);
  assert.ok(g.ball.vx > 0);
});

test('paddle angle depends on where the ball lands', () => {
  const g = started(BreakoutGame, { mode: 'normal' });
  serve(g);
  g.paddle.x = 300;
  Object.assign(g.ball, { x: 300 + 90, y: PADDLE_Y - 9, vx: 0, vy: 4 });
  run(g, 3);
  assert.ok(g.ball.vy < 0 && g.ball.vx > 1, 'right edge sends it up and right');
});

test('normal: dropping the ball costs a life; three lives lost ends the game', () => {
  const g = started(BreakoutGame, { mode: 'normal' });
  for (let i = 0; i < 3; i++) {
    serve(g);
    g.paddle.x = 0;
    Object.assign(g.ball, { x: 600, y: 470, vx: 0, vy: 5 });
    run(g, 10);
  }
  assert.equal(g.lives, 0);
  assert.equal(g.result.outcome, 'lose');
});

test('normal: clearing a board advances the level; clearing level 3 wins', () => {
  const g = started(BreakoutGame, { mode: 'normal' });
  only(g, 1);
  const br = g.bricks[0];
  serve(g);
  Object.assign(g.ball, { x: br.x + 20, y: br.y + BRICK_H + 10, vx: 0, vy: -4 });
  run(g, 10);
  assert.equal(g.level, 2);
  assert.ok(g.bricks.length > 50, 'more rows next level');
  g.level = 3;
  only(g, 1);
  const last = g.bricks[0];
  last.hp = 1;
  serve(g);
  Object.assign(g.ball, { x: last.x + 20, y: last.y + BRICK_H + 10, vx: 0, vy: -4 });
  run(g, 10);
  assert.equal(g.result.outcome, 'win');
});

test('level 2+ top row needs two hits', () => {
  const g = started(BreakoutGame, { mode: 'normal' });
  g.level = 2; g.buildBricks(2);
  assert.equal(g.bricks[0].hp, 2);
});

test('normal: an attentive human clears the game; an idle human cannot', () => {
  const g = started(BreakoutGame, { mode: 'normal', seed: 2 });
  run(g, 200000, (gg) => {
    const c = gg.paddle.x + 50;
    return makeInput({ keys: gg.ball.x > c + 10 ? ['ArrowRight'] : gg.ball.x < c - 10 ? ['ArrowLeft'] : [], pressed: ['Space'] });
  });
  assert.equal(g.result.outcome, 'win');
  const i = started(BreakoutGame, { mode: 'normal', seed: 2 });
  run(i, 200000, idle);
  assert.equal(i.result.outcome, 'lose');
});

// ---- flipped ---------------------------------------------------------------
test('flipped: arrows move the human deflector, never the computer paddle', () => {
  const g = started(BreakoutGame, { mode: 'flipped' });
  g.step(idle());
  const p0 = g.paddle.x, s0 = g.shield.x;
  g.ai.timer = 99; g.ai.target = p0 + 50;
  run(g, 5, () => keys('ArrowLeft'));
  assert.ok(g.shield.x < s0);
  assert.ok(g.paddle.x >= p0, 'paddle follows its own AI target, not the human key');
});

test('flipped: the deflector knocks an upward ball back down and spends charge', () => {
  const g = started(BreakoutGame, { mode: 'flipped' });
  serve(g);
  g.shield.x = 250;
  Object.assign(g.ball, { x: 300, y: SHIELD_Y + 25, vx: 0, vy: -4 });
  const charge = g.shield.charge;
  run(g, 8);
  assert.ok(g.ball.vy > 0);
  assert.ok(g.shield.charge < charge && Math.abs((charge - g.shield.charge) - SHIELD_COST) < 2);
});

test('flipped: the deflector is one-way (a falling ball passes through) and dead when out of charge', () => {
  const g = started(BreakoutGame, { mode: 'flipped' });
  serve(g);
  g.shield.x = 250;
  Object.assign(g.ball, { x: 300, y: SHIELD_Y - 20, vx: 0, vy: 3 });
  run(g, 15);
  assert.ok(g.ball.vy > 0 && g.ball.y > SHIELD_Y, 'fell straight through');
  const h = started(BreakoutGame, { mode: 'flipped' });
  serve(h);
  h.shield.x = 250; h.shield.charge = 0;
  Object.assign(h.ball, { x: 300, y: SHIELD_Y + 25, vx: 0, vy: -4 });
  run(h, 10);
  assert.ok(h.ball.vy < 0 && h.ball.y < SHIELD_Y + 10, 'passes upward when uncharged');
  run(h, 400);
  assert.ok(h.shield.charge > SHIELD_COST && h.shield.charge <= SHIELD_MAX, 'recharges');
});

test('flipped: computer paddle respects its speed cap, and losing the ball costs the computer a life', () => {
  const g = started(BreakoutGame, { mode: 'flipped', seed: 6 });
  let last = g.paddle.x, maxStep = 0;
  run(g, 3000, () => {
    maxStep = Math.max(maxStep, Math.abs(g.paddle.x - last));
    last = g.paddle.x;
    return idle();
  });
  assert.ok(maxStep <= g.paddleSpeed + 1e-9);
  const h = started(BreakoutGame, { mode: 'flipped' });
  serve(h);
  h.paddle.x = 0; h.ai.timer = 99; h.ai.target = 0;
  Object.assign(h.ball, { x: 600, y: 470, vx: 0, vy: 5 });
  run(h, 10);
  assert.equal(h.lives, 2);
  assert.equal(h.result, null);
});

test('flipped: three lost balls is a human win; clearing every brick is a human loss', () => {
  const g = started(BreakoutGame, { mode: 'flipped' });
  g.lives = 1;
  serve(g);
  g.paddle.x = 0; g.ai.timer = 99; g.ai.target = 0;
  Object.assign(g.ball, { x: 600, y: 470, vx: 0, vy: 5 });
  run(g, 10);
  assert.equal(g.result.outcome, 'win');
  const h = started(BreakoutGame, { mode: 'flipped' });
  only(h, 1);
  serve(h);
  Object.assign(h.ball, { x: h.bricks[0].x + 20, y: h.bricks[0].y + BRICK_H + 10, vx: 0, vy: -4 });
  run(h, 10);
  assert.equal(h.result.outcome, 'lose');
});

test('flipped: the computer paddle really plays - it clears bricks when the human does nothing', () => {
  const g = started(BreakoutGame, { mode: 'flipped', seed: 3 });
  run(g, 100000, idle);
  assert.equal(g.result.outcome, 'lose');
  assert.equal(g.aliveBricks, 0);
});

test('flipped: a skilled human that aims deflections can win', () => {
  const g = started(BreakoutGame, { mode: 'flipped', seed: 2 });
  run(g, 150000, (gg) => {
    const b = gg.ball;
    let want = b.x;
    if (b.vy < 0 && b.y > SHIELD_Y) {
      const t = (b.y - SHIELD_Y) / -b.vy;
      want = b.x + b.vx * t - (gg.paddle.x + 50 > 320 ? -1 : 1) * 50; // knock it away from the paddle
    }
    const c = gg.shield.x + 55;
    return keys(...(want > c + 5 ? ['ArrowRight'] : want < c - 5 ? ['ArrowLeft'] : []));
  });
  assert.equal(g.result.outcome, 'win');
});
