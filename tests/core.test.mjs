import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/core/rng.js';
import { angleDiff, circleRect, clamp } from '../js/core/util.js';
import { GAMES, COMING_SOON, findGame } from '../js/registry.js';
import { fakeCtx, idle, makeInput, run, started } from './helpers.mjs';

test('rng is deterministic per seed and stays in range', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const seqA = Array.from({ length: 20 }, () => a.next());
  assert.deepEqual(seqA, Array.from({ length: 20 }, () => b.next()));
  assert.notDeepEqual(seqA, Array.from({ length: 20 }, () => c.next()));
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
  const r = createRng(1);
  for (let i = 0; i < 200; i++) {
    const n = r.int(3, 5);
    assert.ok(n >= 3 && n <= 5 && Number.isInteger(n));
  }
});

test('util helpers', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.ok(Math.abs(angleDiff(0.1, 2 * Math.PI - 0.1) + 0.2) < 1e-9);
  assert.ok(circleRect(5, 5, 3, 0, 0, 4, 4));
  assert.ok(!circleRect(20, 20, 3, 0, 0, 4, 4));
});

test('registry lists the six non-Imitation games and a locked Imitation slot', () => {
  assert.deepEqual(GAMES.map((g) => g.id).sort(), ['asteroids', 'breakout', 'missile', 'pong', 'snake', 'splat']);
  assert.ok(COMING_SOON.some((g) => g.id === 'imitation'));
  assert.equal(findGame('snake').title, 'Snake');
});

for (const meta of GAMES) {
  test(`${meta.id}: meta describes both roles`, () => {
    for (const m of ['normal', 'flipped']) {
      assert.ok(meta.rules[m].length > 40, `${m} rules`);
      assert.ok(meta.controls[m].length >= 1, `${m} controls`);
    }
    assert.notEqual(meta.rules.normal, meta.rules.flipped);
    assert.equal(typeof meta.Game, 'function');
  });

  for (const mode of ['normal', 'flipped']) {
    test(`${meta.id} (${mode}): contract - ready, start, step, hud, draw`, () => {
      const g = new meta.Game({ mode, seed: 3 });
      assert.equal(g.state, 'ready');
      assert.equal(g.mode, mode);
      g.step(idle());
      assert.equal(g.state, 'ready', 'idle input does not start the game');
      g.step(makeInput({ pressed: ['Space'] }));
      assert.equal(g.state, 'playing', 'Space starts the game');
      run(g, 300);
      const hud = g.hud();
      assert.ok(Array.isArray(hud) && hud.every((h) => 'label' in h && 'value' in h));
      const ctx = fakeCtx();
      g.draw(ctx);
      assert.ok(ctx.calls.n > 5, 'draw issues canvas calls');
    });

    test(`${meta.id} (${mode}): survives 4000 ticks of random input without errors`, () => {
      const g = started(meta.Game, { mode, seed: 9 });
      const rng = createRng(5);
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Digit1', 'Digit3', 'KeyJ', 'KeyL'];
      run(g, 4000, () => makeInput({
        keys: [rng.pick(keys)],
        pressed: [rng.pick(keys)],
        mouse: { x: rng.range(0, 640), y: rng.range(0, 480), moved: true, inside: true, clicked: rng.chance(0.1) },
      }));
      g.draw(fakeCtx());
      assert.ok(['playing', 'over'].includes(g.state));
      if (g.state === 'over') assert.ok(['win', 'lose'].includes(g.result.outcome));
    });
  }
}

test('same seed gives identical games (reproducible simulations)', () => {
  for (const meta of GAMES) {
    const a = started(meta.Game, { mode: 'flipped', seed: 77 }), b = started(meta.Game, { mode: 'flipped', seed: 77 });
    run(a, 1500); run(b, 1500);
    assert.deepEqual(a.hud(), b.hud(), meta.id);
  }
});
