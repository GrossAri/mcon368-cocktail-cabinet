/* Echo Heist — game logic (no DOM, no audio). Works in browsers and Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EchoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WAKE = 4;            // an Echo starts replaying this many steps after you first move
  const MAX_ECHOES = 5;      // most Echoes alive at once
  const ROUNDS_PER_VAULT = 5;
  const TICK_MS = 150;       // one step per tick
  const GEMS_PER_ROUND = [3, 4, 4, 5, 6];

  const DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
  };

  // '#' wall, '.' floor, 'S' start, 'E' exit
  const LAYOUT_DEFS = [
    { name: 'The Lobby', rows: [
      '###############',
      '#S............#',
      '#.##.#...#.##.#',
      '#.#..#...#..#.#',
      '#....#.#.#....#',
      '#.##...#...##.#',
      '#....#.#.#....#',
      '#.#..#...#..#.#',
      '#.##.#...#.##.#',
      '#............E#',
      '###############' ] },
    { name: 'Pillar Rooms', rows: [
      '###############',
      '#S.....#......#',
      '#.####.#.####.#',
      '#.#....#....#.#',
      '#.#.##...##.#.#',
      '#...#.....#...#',
      '#.#.##...##.#.#',
      '#.#....#....#.#',
      '#.####.#.####.#',
      '#......#.....E#',
      '###############' ] },
    { name: 'The Ring', rows: [
      '###############',
      '#S............#',
      '#.###.###.###.#',
      '#.#.........#.#',
      '#.#.#######.#.#',
      '#.........#...#',
      '#.#.#######.#.#',
      '#.#.........#.#',
      '#.###.###.###.#',
      '#............E#',
      '###############' ] },
    { name: 'The Maze', rows: [
      '###############',
      '#S..#.....#...#',
      '#.#.#.###.#.#.#',
      '#.#...#.#...#.#',
      '#.#####.#####.#',
      '#.......#.....#',
      '#.#####.#####.#',
      '#.#...#.#...#.#',
      '#.#.#.###.#.#.#',
      '#...#.....#..E#',
      '###############' ] },
  ];

  function parseLayout(def) {
    const rows = def.rows;
    const h = rows.length, w = rows[0].length;
    const wall = [];
    let start = null, exit = null;
    for (let y = 0; y < h; y++) {
      if (rows[y].length !== w) throw new Error('Ragged layout row ' + y + ' in ' + def.name);
      for (let x = 0; x < w; x++) {
        const c = rows[y][x];
        wall.push(c === '#');
        if (c === 'S') start = { x, y };
        if (c === 'E') exit = { x, y };
      }
    }
    if (!start || !exit) throw new Error('Layout needs S and E: ' + def.name);
    return {
      name: def.name, w, h, start, exit,
      isWall(x, y) { return x < 0 || y < 0 || x >= w || y >= h || wall[y * w + x]; },
    };
  }

  const LAYOUTS = LAYOUT_DEFS.map(parseLayout);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Breadth-first distances from `from`; -1 where unreachable. Flat array y*w+x. */
  function distances(layout, from) {
    const { w, h } = layout;
    const dist = new Array(w * h).fill(-1);
    const queue = [from];
    dist[from.y * w + from.x] = 0;
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      for (const k in DIRS) {
        const nx = p.x + DIRS[k].dx, ny = p.y + DIRS[k].dy;
        if (layout.isWall(nx, ny) || dist[ny * w + nx] !== -1) continue;
        dist[ny * w + nx] = dist[p.y * w + p.x] + 1;
        queue.push({ x: nx, y: ny });
      }
    }
    return dist;
  }

  /** Shortest path as positions after `from`, ending on `to`. */
  function shortestPath(layout, from, to) {
    const dist = distances(layout, to); // walk downhill from `from`
    const { w } = layout;
    const out = [];
    let p = { x: from.x, y: from.y };
    while (dist[p.y * w + p.x] > 0) {
      let best = null;
      for (const k in DIRS) {
        const nx = p.x + DIRS[k].dx, ny = p.y + DIRS[k].dy;
        if (layout.isWall(nx, ny)) continue;
        if (dist[ny * w + nx] === dist[p.y * w + p.x] - 1) { best = { x: nx, y: ny }; break; }
      }
      p = best;
      out.push(p);
    }
    return out;
  }

  /** Pick gem tiles: reachable, away from start/exit, and spread apart. */
  function placeGems(layout, count, rng) {
    const fromStart = distances(layout, layout.start);
    const cands = [];
    for (let y = 0; y < layout.h; y++) for (let x = 0; x < layout.w; x++) {
      const d = fromStart[y * layout.w + x];
      if (d < 5) continue;
      if (x === layout.exit.x && y === layout.exit.y) continue;
      cands.push({ x, y });
    }
    const gems = [];
    for (let spacing = 5; spacing >= 0 && gems.length < count; spacing--) {
      const pool = cands.filter(c => !gems.some(g => g.x === c.x && g.y === c.y));
      while (pool.length && gems.length < count) {
        const i = Math.floor(rng() * pool.length);
        const c = pool.splice(i, 1)[0];
        if (gems.every(g => Math.abs(g.x - c.x) + Math.abs(g.y - c.y) >= spacing)) gems.push(c);
      }
    }
    return gems;
  }

  /** A complete, legal run (start → every gem → exit) used to fabricate Echoes for level-jumps. */
  function planRoute(layout, gems) {
    const path = [{ x: layout.start.x, y: layout.start.y }];
    let pos = layout.start;
    const left = gems.slice();
    while (left.length) {
      const d = distances(layout, pos);
      left.sort((a, b) => d[a.y * layout.w + a.x] - d[b.y * layout.w + b.x]);
      const g = left.shift();
      for (const p of shortestPath(layout, pos, g)) path.push(p);
      pos = g;
    }
    for (const p of shortestPath(layout, pos, layout.exit)) path.push(p);
    return path;
  }

  function roundConfig(vault, roundNo, seedBase) {
    const layoutIndex = vault % LAYOUTS.length;
    const loops = Math.floor(vault / LAYOUTS.length);
    return {
      layoutIndex,
      layout: LAYOUTS[layoutIndex],
      gemCount: GEMS_PER_ROUND[roundNo - 1] + Math.min(loops, 2),
      limit: Math.max(220, 360 - 25 * vault),
      seed: (seedBase + vault * 101 + roundNo * 7919) >>> 0,
    };
  }

  function gemsFor(cfg) {
    return placeGems(cfg.layout, cfg.gemCount, mulberry32(cfg.seed));
  }

  /** Echoes for rounds 1..roundNo-1 of a vault, as if the player had flown perfect routes. */
  function syntheticEchoes(vault, roundNo, seedBase) {
    const echoes = [];
    for (let r = 1; r < roundNo; r++) {
      const cfg = roundConfig(vault, r, seedBase);
      echoes.push({ round: r, path: planRoute(cfg.layout, gemsFor(cfg)) });
    }
    return echoes.slice(-MAX_ECHOES);
  }

  /**
   * Exact Echo-aware solver: a breadth-first search over (tile, tick, gems taken), waiting allowed,
   * using the same collision rule as the game. Returns the earliest-finishing survivable route
   * (a position per tick) or null if the round cannot be survived. Used to prove rounds are fair.
   */
  function solve(layout, gems, echoes, limit) {
    const probe = new Round({ layout, gems, echoes, limit });
    const { w, h } = layout;
    const n = gems.length, full = (1 << n) - 1, M = full + 1;
    const gemAt = new Map(gems.map((g, i) => [g.y * w + g.x, i]));
    const exitTile = layout.exit.y * w + layout.exit.x;
    const moves = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const startState = (layout.start.y * w + layout.start.x) * M;
    const parents = [null];                       // parents[t] = Int32Array(w*h*M): previous state at t-1
    let frontier = [startState];
    for (let t = 1; t <= limit && frontier.length; t++) {
      const parent = new Int32Array(w * h * M).fill(-1);
      parents.push(parent);
      const next = [];
      for (const st of frontier) {
        const tile = Math.floor(st / M), mask = st % M;
        const px = tile % w, py = Math.floor(tile / w);
        for (const [dx, dy] of moves) {
          if (t === 1 && dx === 0 && dy === 0) continue; // the clock starts on the first real move
          const nx = px + dx, ny = py + dy;
          if (layout.isWall(nx, ny)) continue;
          if (probe.collides({ x: px, y: py }, { x: nx, y: ny }, t) !== -1) continue;
          const nt = ny * w + nx;
          let nm = mask;
          if (gemAt.has(nt)) nm |= 1 << gemAt.get(nt);
          const ns = nt * M + nm;
          if (parent[ns] !== -1) continue;
          parent[ns] = st;
          if (nt === exitTile && nm === full) {
            const path = [];
            let cur = ns;
            for (let tt = t; tt >= 0; tt--) {
              const ct = Math.floor(cur / M);
              path.push({ x: ct % w, y: Math.floor(ct / w) });
              cur = tt > 0 ? parents[tt][cur] : cur;
            }
            return path.reverse();
          }
          next.push(ns);
        }
      }
      frontier = next;
    }
    return null;
  }

  const SCORE = { gem: 10, clear: 50, vault: 200 };

  class Round {
    /**
     * @param {{layout:object, gems:{x:number,y:number}[], echoes:{round:number,path:{x:number,y:number}[]}[], limit:number}} o
     */
    constructor(o) {
      this.layout = o.layout;
      this.gems = o.gems.map(g => ({ x: g.x, y: g.y, taken: false }));
      this.echoes = o.echoes || [];
      this.limit = o.limit;
      this.status = 'ready';          // ready | running | cleared | caught | timeout
      this.tick = 0;
      this.player = { x: o.layout.start.x, y: o.layout.start.y };
      this.path = [{ x: this.player.x, y: this.player.y }]; // position at every tick
      this.gemsTaken = 0;
      this.caughtBy = -1;
    }

    get exitOpen() { return this.gemsTaken === this.gems.length; }

    /** Echo i at tick t: null once it has finished; armed=false while still waking up. */
    ghostAt(i, t) {
      const path = this.echoes[i].path;
      const idx = t - WAKE;
      if (idx < 0) return { x: path[0].x, y: path[0].y, armed: false };
      if (idx >= path.length) return null;
      return { x: path[idx].x, y: path[idx].y, armed: true };
    }

    /** Index of the Echo that catches a player moving prev→cur during `tick` (same tile or swap), else -1. */
    collides(prev, cur, tick) {
      for (let i = 0; i < this.echoes.length; i++) {
        const g = this.ghostAt(i, tick);
        if (!g || !g.armed) continue;
        const gPrev = this.ghostAt(i, tick - 1);
        const sameTile = g.x === cur.x && g.y === cur.y;
        const swapped = gPrev && gPrev.armed && gPrev.x === cur.x && gPrev.y === cur.y &&
          g.x === prev.x && g.y === prev.y;
        if (sameTile || swapped) return i;
      }
      return -1;
    }

    /**
     * Advance one tick. input: {dx,dy} to move, 'wait' to hold still, or null (nothing happens
     * while ready; counts as waiting while running). Returns a list of event objects.
     */
    step(input) {
      const events = [];
      let move = input && input !== 'wait' ? input : null;
      if (this.status === 'ready') {
        if (!move) return events;
        if (this.layout.isWall(this.player.x + move.dx, this.player.y + move.dy)) {
          events.push({ type: 'bump' });
          return events;
        }
        this.status = 'running';
        events.push({ type: 'start' });
      } else if (this.status !== 'running') {
        return events;
      }

      const prev = { x: this.player.x, y: this.player.y };
      if (move) {
        const nx = prev.x + move.dx, ny = prev.y + move.dy;
        if (this.layout.isWall(nx, ny)) events.push({ type: 'bump' });
        else { this.player.x = nx; this.player.y = ny; events.push({ type: 'move' }); }
      }
      this.tick++;
      this.path.push({ x: this.player.x, y: this.player.y });
      if (this.tick === WAKE && this.echoes.length) events.push({ type: 'wake' });

      const hit = this.collides(prev, this.player, this.tick);
      if (hit !== -1) {
        this.status = 'caught';
        this.caughtBy = hit;
        events.push({ type: 'caught', echo: hit });
        return events;
      }

      for (const gem of this.gems) {
        if (!gem.taken && gem.x === this.player.x && gem.y === this.player.y) {
          gem.taken = true;
          this.gemsTaken++;
          events.push({ type: 'gem', left: this.gems.length - this.gemsTaken });
          if (this.exitOpen) events.push({ type: 'exitOpen' });
        }
      }

      if (this.exitOpen && this.player.x === this.layout.exit.x && this.player.y === this.layout.exit.y) {
        this.status = 'cleared';
        events.push({ type: 'cleared' });
      } else if (this.tick >= this.limit) {
        this.status = 'timeout';
        events.push({ type: 'timeout' });
      }
      return events;
    }

    timeBonus() { return Math.max(0, Math.floor((this.limit - this.tick) / 2)); }
  }

  return {
    WAKE, MAX_ECHOES, ROUNDS_PER_VAULT, TICK_MS, DIRS, SCORE,
    LAYOUTS, Round, parseLayout, mulberry32, distances, shortestPath, placeGems,
    planRoute, solve, roundConfig, gemsFor, syntheticEchoes,
  };
});
