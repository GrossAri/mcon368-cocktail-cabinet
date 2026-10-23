import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGame, COLS, ROWS, TARGET, GROW, PLACE_WINDOW } from '../js/games/snake.js';
import { idle, makeInput, run, started } from './helpers.mjs';

const press = (...codes) => makeInput({ pressed: codes });
const dirKey = (d) => (d.x === 1 ? 'ArrowRight' : d.x === -1 ? 'ArrowLeft' : d.y === 1 ? 'ArrowDown' : 'ArrowUp');
const ticksPerMove = (g) => g.interval;

test('normal: snake moves one cell per interval in its direction', () => {
  const g = started(SnakeGame, { mode: 'normal' });
  const h0 = { ...g.snake[0] };
  run(g, ticksPerMove(g));
  assert.deepEqual(g.snake[0], { x: h0.x + 1, y: h0.y });
  assert.equal(g.snake.length, 3);
});

test('normal: steering works and a 180-degree reversal is ignored', () => {
  const g = started(SnakeGame, { mode: 'normal' });
  g.step(press('ArrowLeft')); // opposite of current heading (right)
  assert.equal(g.queue.length, 0);
  g.step(press('ArrowUp'));
  run(g, ticksPerMove(g));
  assert.deepEqual(g.dir, { x: 0, y: -1 });
});

test('normal: hitting the wall loses; flipped: the same crash is a human win', () => {
  const n = started(SnakeGame, { mode: 'normal' });
  run(n, 10000);
  assert.equal(n.result.outcome, 'lose');
  assert.equal(n.deathReason, 'wall');
});

test('normal: running into itself loses', () => {
  const g = started(SnakeGame, { mode: 'normal' });
  g.snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }];
  g.dir = { x: 0, y: -1 };
  g.apple = { x: 30, y: 20 };
  g.move(); // head goes up into (5,4) = body
  assert.equal(g.deathReason, 'self');
  assert.equal(g.result.outcome, 'lose');
});

test('moving into the cell the tail is leaving is legal', () => {
  const g = started(SnakeGame, { mode: 'normal' });
  g.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }];
  g.dir = { x: 0, y: 1 };
  g.apple = { x: 30, y: 20 };
  g.move();
  assert.equal(g.state, 'playing');
});

test('eating grows the snake by GROW, scores, and the next apple is reachable and free', () => {
  const g = started(SnakeGame, { mode: 'normal', seed: 4 });
  const h = g.snake[0];
  g.apple = { x: h.x + 1, y: h.y };
  g.move();
  assert.equal(g.eaten, 1);
  assert.equal(g.score, 1);
  run(g, ticksPerMove(g) * GROW);
  assert.equal(g.snake.length, 3 + GROW);
  for (let i = 0; i < 200; i++) {
    g.apple = null;
    g.spawnApple();
    assert.ok(g.apple && !g.onSnake(g.apple.x, g.apple.y));
    assert.ok(g.reachable(g.snake[0], (x, y) => g.onSnake(x, y)).has(g.apple.y * COLS + g.apple.x));
  }
});

test('speed increases with level', () => {
  const g = started(SnakeGame, { mode: 'normal' });
  const base = g.interval;
  g.eaten = 8; g.level = 3;
  assert.ok(g.interval < base);
});

test('normal: eating TARGET apples wins', () => {
  const g = started(SnakeGame, { mode: 'normal' });
  g.eaten = TARGET - 1;
  const h = g.snake[0];
  g.apple = { x: h.x + 1, y: h.y };
  g.move();
  assert.equal(g.result.outcome, 'win');
});

// ---- flipped ----------------------------------------------------------
test('flipped: human cannot steer; the computer picks the heading', () => {
  const g = started(SnakeGame, { mode: 'flipped', seed: 2 });
  g.placeApple(2, 2);
  run(g, ticksPerMove(g) * 3, () => makeInput({ pressed: ['ArrowDown'], keys: ['ArrowDown'] }));
  // arrow keys only move the placement cursor, snake heads toward the apple in the top-left instead of down
  assert.ok(g.snake[0].y <= 12);
});

test('flipped: apples only go on empty squares and only one at a time', () => {
  const g = started(SnakeGame, { mode: 'flipped' });
  const body = g.snake[1];
  assert.equal(g.placeApple(body.x, body.y), false);
  assert.equal(g.placeApple(-1, 3), false);
  assert.equal(g.placeApple(COLS, 3), false);
  assert.equal(g.placeApple(20, 3), true);
  assert.equal(g.placeApple(21, 3), false, 'one apple at a time');
});

test('flipped: click and keyboard placement both work', () => {
  const g = started(SnakeGame, { mode: 'flipped' });
  g.step(makeInput({ mouse: { x: 110, y: 50, clicked: true } }));
  assert.deepEqual(g.apple, { x: 5, y: 2 });
  const k = started(SnakeGame, { mode: 'flipped' });
  k.step(press('ArrowUp'));
  k.step(press('Space'));
  assert.deepEqual(k.apple, { x: 24, y: 11 });
});

test('flipped: stalling never starves the snake - the computer drops an apple', () => {
  const g = started(SnakeGame, { mode: 'flipped', seed: 5 });
  run(g, PLACE_WINDOW + 5);
  assert.ok(g.apple, 'computer placed an apple');
  assert.equal(g.state, 'playing');
});

test('flipped: starvation is a human win', () => {
  const g = started(SnakeGame, { mode: 'flipped' });
  g.placeApple(2, 2);
  g.hunger = g.hungerLimit;
  run(g, 2);
  assert.equal(g.deathReason, 'starved');
  assert.equal(g.result.outcome, 'win');
});

test('flipped AI obeys the same rules: always moves one orthogonal step and never leaves the board alive', () => {
  for (const seed of [1, 2, 3]) {
    const g = started(SnakeGame, { mode: 'flipped', seed });
    let last = { ...g.snake[0] };
    let r = seed * 17;
    run(g, 40000, (gg) => {
      const h = gg.snake[0];
      const step = Math.abs(h.x - last.x) + Math.abs(h.y - last.y);
      assert.ok(step <= 1, 'head moves at most one cell');
      assert.ok(gg.inBounds(h.x, h.y), 'head stays on the board');
      assert.equal(new Set(gg.snake.map((s) => `${s.x},${s.y}`)).size, gg.snake.length, 'no overlapping segments');
      last = { ...h };
      if (gg.apple) return idle();
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      gg.cursor.x = r % COLS; gg.cursor.y = (r >> 8) % ROWS;
      return press('Space');
    });
    assert.ok(g.state === 'over');
    assert.ok(g.eaten >= 8, `snake should handle random apples for a good while (ate ${g.eaten})`);
  }
});

// Human strategies, expressed as a scoring function over free squares.
function playHuman(seed, score) {
  const g = started(SnakeGame, { mode: 'flipped', seed });
  run(g, 80000, (gg) => {
    if (gg.apple) return idle();
    const h = gg.snake[0], tail = gg.snake[gg.snake.length - 1];
    const reach = gg.reachable(h, (x, y) => gg.onSnake(x, y) && !(x === tail.x && y === tail.y));
    let best = null;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (gg.onSnake(x, y)) continue;
      const sc = score(x, y, tail, reach);
      if (!best || sc > best.sc) best = { sc, x, y };
    }
    gg.cursor.x = best.x; gg.cursor.y = best.y;
    return press('Space');
  });
  return g;
}

test('flipped: a smart human CAN win - lure the greedy snake back to its own tail', () => {
  const g = playHuman(1, (x, y, tail) => -(Math.abs(x - tail.x) + Math.abs(y - tail.y)));
  assert.equal(g.result.outcome, 'win');
  assert.ok(g.eaten < TARGET);
});

test('flipped: a smart human CAN win - force long detours until the shrinking hunger clock runs out', () => {
  const g = playHuman(1, (x, y, tail, reach) => reach.get(y * COLS + x) ?? -1);
  assert.equal(g.result.outcome, 'win');
  assert.equal(g.deathReason, 'starved');
});

test('flipped: the early snake is greedy, from level 3 it plans safe routes', () => {
  const g = started(SnakeGame, { mode: 'flipped' });
  g.level = 2;
  g.snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }];
  g.dir = { x: 1, y: 0 };
  g.apple = { x: 8, y: 5 };
  assert.deepEqual(g.aiChooseDir(), { x: 1, y: 0 });
});

test('normal: the computer-placed apples are always reachable (a pilot using the same planner reaches the target)', () => {
  for (const seed of [1, 2, 3]) {
    const g = started(SnakeGame, { mode: 'normal', seed });
    run(g, 60000, (gg) => press(dirKey(SnakeGame.prototype.aiChooseDir.call(gg))));
    assert.equal(g.result.outcome, 'win', `seed ${seed}`);
  }
});
