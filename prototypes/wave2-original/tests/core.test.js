// Run: node prototypes/wave2-original/tests/core.test.js
const assert = require('assert');
const C = require('../core.js');
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok -', name); }

const R = C.DIRS.right, L = C.DIRS.left, U = C.DIRS.up, D = C.DIRS.down;
function dirBetween(a, b) {
  return b.x > a.x ? R : b.x < a.x ? L : b.y > a.y ? D : b.y < a.y ? U : 'wait';
}
/** Drive a Round along a recorded path. */
function play(round, path) {
  for (let i = 1; i < path.length && round.status !== 'cleared' && round.status !== 'caught'; i++) {
    round.step(dirBetween(path[i - 1], path[i]));
  }
}

test('every layout is rectangular, fully connected, and has a reachable exit', () => {
  for (const l of C.LAYOUTS) {
    const d = C.distances(l, l.start);
    for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
      if (!l.isWall(x, y)) assert(d[y * l.w + x] >= 0, `${l.name}: unreachable floor at ${x},${y}`);
    }
    assert(d[l.exit.y * l.w + l.exit.x] > 0, l.name + ' exit unreachable');
  }
});

test('gems are unique, reachable, off start/exit, for many seeds and vaults', () => {
  for (let vault = 0; vault < 10; vault++) for (let r = 1; r <= C.ROUNDS_PER_VAULT; r++) for (const seed of [1, 42, 99999]) {
    const cfg = C.roundConfig(vault, r, seed);
    const gems = C.gemsFor(cfg);
    assert.strictEqual(gems.length, cfg.gemCount, `vault ${vault} round ${r}`);
    const d = C.distances(cfg.layout, cfg.layout.start);
    const seen = new Set();
    for (const g of gems) {
      assert(d[g.y * cfg.layout.w + g.x] >= 5);
      assert(!(g.x === cfg.layout.exit.x && g.y === cfg.layout.exit.y));
      const k = g.x + ',' + g.y; assert(!seen.has(k)); seen.add(k);
    }
  }
});

test('gem placement is deterministic for a seed', () => {
  const cfg = C.roundConfig(1, 3, 123);
  assert.deepStrictEqual(C.gemsFor(cfg), C.gemsFor(cfg));
});

test('clock does not start on wait, bump, or empty input', () => {
  const l = C.LAYOUTS[0];
  const r = new C.Round({ layout: l, gems: [{ x: 5, y: 1 }], echoes: [], limit: 100 });
  r.step(null); r.step('wait'); r.step(L); r.step(U);
  assert.strictEqual(r.status, 'ready'); assert.strictEqual(r.tick, 0);
  r.step(R);
  assert.strictEqual(r.status, 'running'); assert.strictEqual(r.tick, 1);
});

test('walls block movement; waiting while running still advances time', () => {
  const l = C.LAYOUTS[0];
  const r = new C.Round({ layout: l, gems: [{ x: 5, y: 1 }], echoes: [], limit: 100 });
  r.step(R); r.step(U);                       // bump into the top wall
  assert.deepStrictEqual(r.player, { x: 2, y: 1 }); assert.strictEqual(r.tick, 2);
  r.step('wait'); assert.strictEqual(r.tick, 3);
});

test('exit stays locked until all gems taken, then clears', () => {
  const l = C.LAYOUTS[0];
  const gem = { x: 3, y: 1 };
  const r = new C.Round({ layout: l, gems: [gem], echoes: [], limit: 200 });
  // walk to the exit row first, passing the exit tile before the gem is taken is impossible here,
  // so walk to the gem, then to the exit.
  play(r, C.planRoute(l, [gem]));
  assert.strictEqual(r.status, 'cleared');
  assert.strictEqual(r.gemsTaken, 1);
});

test('standing on the exit with gems missing does not clear', () => {
  const l = C.LAYOUTS[0];
  const toExit = [l.start, ...C.shortestPath(l, l.start, l.exit)];
  let off = null; // a floor tile that is not on the route to the exit
  for (let y = 1; y < l.h && !off; y++) for (let x = 1; x < l.w && !off; x++) {
    if (!l.isWall(x, y) && !toExit.some(p => p.x === x && p.y === y)) off = { x, y };
  }
  const r = new C.Round({ layout: l, gems: [off], echoes: [], limit: 200 });
  play(r, toExit);
  assert.strictEqual(r.status, 'running');
  assert(!r.exitOpen);
});

test('timeout ends the round', () => {
  const l = C.LAYOUTS[0];
  const r = new C.Round({ layout: l, gems: [{ x: 9, y: 9 }], echoes: [], limit: 5 });
  r.step(R); for (let i = 0; i < 10; i++) r.step('wait');
  assert.strictEqual(r.status, 'timeout');
});

test('echoes are harmless while waking and replay the recorded route afterwards', () => {
  const l = C.LAYOUTS[0];
  const echoPath = [l.start, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 }];
  const r = new C.Round({ layout: l, gems: [{ x: 9, y: 9 }], echoes: [{ round: 1, path: echoPath }], limit: 100 });
  assert.strictEqual(r.ghostAt(0, 0).armed, false);
  assert.strictEqual(r.ghostAt(0, C.WAKE - 1).armed, false);
  assert.deepStrictEqual(r.ghostAt(0, C.WAKE), { x: 1, y: 1, armed: true });
  assert.deepStrictEqual(r.ghostAt(0, C.WAKE + 3), { x: 4, y: 1, armed: true });
  assert.strictEqual(r.ghostAt(0, C.WAKE + echoPath.length), null); // finished
});

test('an Echo that reaches the player tile catches them', () => {
  const l = C.LAYOUTS[0];
  const echoPath = [l.start, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }];
  const r = new C.Round({ layout: l, gems: [{ x: 9, y: 9 }], echoes: [{ round: 1, path: echoPath }], limit: 100 });
  r.step(R);                      // player to (2,1) at tick 1
  for (let i = 0; i < 6 && r.status === 'running'; i++) r.step('wait');
  assert.strictEqual(r.status, 'caught'); assert.strictEqual(r.caughtBy, 0);
});

test('swapping places with an Echo in one tick also catches', () => {
  const l = C.LAYOUTS[0];
  // Echo at tick 4,5 moves (1,1)->(2,1); player moves (2,1)->(1,1) across ticks 4->5.
  const echoPath = [l.start, { x: 2, y: 1 }];
  const r = new C.Round({ layout: l, gems: [{ x: 9, y: 9 }], echoes: [{ round: 1, path: echoPath }], limit: 100 });
  r.step(R);                       // tick1 player (2,1)
  r.step('wait'); r.step('wait'); r.step('wait'); // tick 4: echo at (1,1) armed; player (2,1)
  assert.strictEqual(r.status, 'running');
  r.step(L);                       // tick 5: player (1,1), echo (2,1) -> swap
  assert.strictEqual(r.status, 'caught');
});

test('every vault round has a survivable solution against its stacked Echoes (solver proof)', () => {
  for (let vault = 0; vault < 8; vault++) for (const seed of [11, 2024, 7]) {
    const echoes = [];
    for (let r = 1; r <= C.ROUNDS_PER_VAULT; r++) {
      const cfg = C.roundConfig(vault, r, seed);
      const gems = C.gemsFor(cfg);
      const route = C.solve(cfg.layout, gems, echoes.slice(), cfg.limit);
      assert(route, `no survivable route: vault ${vault} round ${r} seed ${seed}`);
      // Replay the route through the real engine so the solver cannot disagree with the rules.
      const round = new C.Round({ layout: cfg.layout, gems, echoes: echoes.slice(), limit: cfg.limit });
      play(round, route);
      assert.strictEqual(round.status, 'cleared', `vault ${vault} round ${r} seed ${seed}`);
      assert(route.length < cfg.limit * 0.75, 'route should leave slack under the time limit');
      echoes.push({ round: r, path: round.path });
    }
  }
});

test('syntheticEchoes builds one Echo per earlier round', () => {
  const e = C.syntheticEchoes(2, 4, 7);
  assert.deepStrictEqual(e.map(x => x.round), [1, 2, 3]);
});

console.log(`\n${n} tests passed`);
