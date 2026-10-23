import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SplatGame, BIRD_X, FLAP, GRAVITY, FLOOR, COL_W, SPACING, TARGET, gapFor, speedFor, maxClimbFor, maxDropFor,
} from '../js/games/splat.js';
import { idle, makeInput, run, started } from './helpers.mjs';

const space = () => makeInput({ pressed: ['Space'] });
const flapPilot = (g) => (SplatGame.prototype.aiWantsFlap.call(g) || !g.flying ? space() : idle());

test('normal: waits for the first flap, then gravity pulls and flaps lift', () => {
  const g = started(SplatGame, { mode: 'normal' });
  run(g, 30);
  assert.ok(!g.flying);
  assert.ok(Math.abs(g.bird.y - 240) < 10, 'hovers');
  g.step(space());
  assert.ok(g.flying);
  assert.ok(Math.abs(g.bird.vy - (FLAP + GRAVITY)) < 1e-9);
  run(g, 5);
  assert.ok(g.bird.vy > FLAP + GRAVITY, 'gravity decelerates the rise');
});

test('hitting the ground splats the bird (normal: loss, flipped: human win)', () => {
  const g = started(SplatGame, { mode: 'normal' });
  g.step(space());
  run(g, 300);
  assert.equal(g.result.outcome, 'lose');
  assert.ok(g.splat);
  const f = started(SplatGame, { mode: 'flipped' });
  f.bird.y = FLOOR - 15; f.bird.vy = 5;
  run(f, 5);
  assert.equal(f.result.outcome, 'win');
});

test('columns scroll, collide above/below the gap, and are passed through the gap', () => {
  const g = started(SplatGame, { mode: 'normal' });
  g.flying = true;
  g.columns = [{ x: BIRD_X - 10, gapY: 240, gapH: 150, passed: false }];
  g.bird.y = 240; g.bird.vy = -GRAVITY; // hold steady inside the gap
  g.step(idle());
  assert.equal(g.state, 'playing');
  const h = started(SplatGame, { mode: 'normal' });
  h.flying = true;
  h.columns = [{ x: BIRD_X - 10, gapY: 100, gapH: 100, passed: false }];
  h.bird.y = 300; h.bird.vy = 0;
  h.step(idle());
  assert.equal(h.result.outcome, 'lose');
});

test('passing a column scores and levels up every 5', () => {
  const g = started(SplatGame, { mode: 'normal' });
  g.flying = true;
  g.passed = 4;
  g.columns = [{ x: BIRD_X - COL_W - 20, gapY: 240, gapH: 150, passed: false }];
  g.bird.y = 240; g.bird.vy = -GRAVITY;
  g.step(idle());
  assert.equal(g.passed, 5);
  assert.equal(g.level, 2);
  assert.ok(speedFor(2) > speedFor(1) && gapFor(2) < gapFor(1));
});

test('layout rules are shared: the placement band never exceeds the tested climb/drop limits', () => {
  const g = started(SplatGame, { mode: 'flipped' });
  for (let level = 1; level <= 6; level++) {
    g.level = level;
    g.lastGapY = 240;
    const { lo, hi } = g.band();
    assert.ok(240 - lo <= maxClimbFor(level) && hi - 240 <= maxDropFor(level));
    assert.ok(lo >= gapFor(level) / 2 + 30 && hi <= FLOOR - gapFor(level) / 2 - 30);
  }
  assert.ok(maxClimbFor(6) < maxClimbFor(1), 'harder levels shrink the allowed jump');
});

test('flipped: human column placement is clamped into the reachable band and rate-limited', () => {
  const g = started(SplatGame, { mode: 'flipped' });
  g.sinceSpawn = 0;
  assert.equal(g.placeColumn(100), null, 'not reloaded yet');
  g.sinceSpawn = SPACING;
  const y = g.placeColumn(0);
  assert.ok(y !== null && y > 0);
  assert.ok(240 - y <= maxClimbFor(1) + 1e-9, 'ask for the ceiling, get the highest reachable gap');
  assert.equal(g.columns.length, 1);
  assert.equal(g.ready, false);
});

test('flipped: clicking places a column at the cursor; stalling makes the computer place one', () => {
  const g = started(SplatGame, { mode: 'flipped' });
  run(g, 60);
  assert.ok(g.ready);
  g.step(makeInput({ mouse: { x: 600, y: 260, clicked: true, moved: true, inside: true } }));
  assert.equal(g.columns.length, 1);
  const s = started(SplatGame, { mode: 'flipped', seed: 3 });
  run(s, 400);
  assert.ok(s.columns.length >= 1, 'computer placed one when the human stalled');
});

test('computer bird uses exactly the human flap physics (it only decides when to flap)', () => {
  const g = started(SplatGame, { mode: 'flipped', seed: 1 });
  let flaps = 0, prevVy = g.bird.vy;
  run(g, 3000, () => {
    prevVy = g.bird.vy;
    return idle();
  });
  // after any tick where vy jumped up it must equal FLAP + GRAVITY, never an arbitrary value
  const h = started(SplatGame, { mode: 'flipped', seed: 1 });
  let lastVy = h.bird.vy;
  for (let t = 0; t < 3000 && h.state === 'playing'; t++) {
    h.step(idle());
    if (h.bird.vy < lastVy - 1e-9) { // upward velocity change = a flap
      flaps++;
      assert.ok(Math.abs(h.bird.vy - (FLAP + GRAVITY)) < 1e-9 || h.bird.y <= 12);
    }
    lastVy = h.bird.vy;
  }
  assert.ok(flaps > 3);
});

test('normal: computer-built layouts are always passable (a bird using the flap pilot clears 25 columns on every seed)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = started(SplatGame, { mode: 'normal', seed });
    run(g, 40000, flapPilot);
    assert.equal(g.result.outcome, 'win', `seed ${seed} died after ${g.passed}`);
    assert.equal(g.passed, TARGET);
  }
});

test('flipped: whatever the human asks for, consecutive gaps stay within the climb/drop limits', () => {
  for (const seed of [1, 2, 3]) {
    const g = started(SplatGame, { mode: 'flipped', seed });
    let up = false, prev = null;
    run(g, 20000, (gg) => {
      if (gg.columns.length && gg.columns[gg.columns.length - 1] !== prev) {
        const cols = gg.columns, c = cols[cols.length - 1];
        if (prev) {
          const d = c.gapY - prev.gapY;
          assert.ok(d >= -maxClimbFor(gg.level) - 1e-9 && d <= maxDropFor(gg.level) + 1e-9, `delta ${d}`);
        }
        prev = c;
      }
      if (!gg.ready) return idle();
      up = !up;
      gg.cursorY = up ? 0 : 480;
      return space();
    });
  }
});

test('flipped: an extreme alternating layout can beat the bird, so the human can win', () => {
  let wins = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const g = started(SplatGame, { mode: 'flipped', seed });
    let up = false;
    run(g, 20000, (gg) => {
      if (!gg.ready) return idle();
      up = !up;
      gg.cursorY = up ? 0 : 480;
      return space();
    });
    if (g.result.outcome === 'win') wins++;
  }
  assert.ok(wins >= 1, `human won ${wins}/10`);
});

test('flipped: a lazy layout (every gap in the middle) lets the bird win', () => {
  const g = started(SplatGame, { mode: 'flipped', seed: 1 });
  run(g, 20000, (gg) => {
    if (!gg.ready) return idle();
    gg.cursorY = 240;
    return space();
  });
  assert.equal(g.result.outcome, 'lose');
});
