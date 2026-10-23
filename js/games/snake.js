import { Game } from '../core/game.js';
import { COLORS, text } from '../core/util.js';

export const COLS = 32;
export const ROWS = 24;
export const CELL = 20;
export const TARGET = 20; // apples needed for the snake to win
export const GROW = 3; // segments gained per apple
export const PLACE_WINDOW = 300; // ticks the human has to place an apple (flipped)
const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const key = (x, y) => y * COLS + x;
const same = (a, b) => a.x === b.x && a.y === b.y;
const opposite = (a, b) => a.x === -b.x && a.y === -b.y;

export class SnakeGame extends Game {
  constructor(opts) {
    super(opts);
    this.snake = [{ x: 16, y: 12 }, { x: 15, y: 12 }, { x: 14, y: 12 }];
    this.dir = { x: 1, y: 0 };
    this.queue = [];
    this.apple = null;
    this.eaten = 0;
    this.moveTimer = 0;
    this.hunger = 0;
    this.growth = 0;
    this.placeTimer = PLACE_WINDOW;
    this.cursor = { x: 24, y: 12 };
    this.deathReason = null;
    if (!this.flipped) this.spawnApple();
  }

  // --- rules -----------------------------------------------------------
  get interval() {
    return Math.max(4, 11 - this.level); // ticks between moves; speeds up each level
  }
  get hungerLimit() {
    // measured in moves so it stays fair as the snake speeds up: 68 moves at level 1 (more than the board is wide), 53 at level 6
    return this.interval * (68 - 3 * (this.level - 1));
  }
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
  }
  onSnake(x, y) {
    return this.snake.some((s) => s.x === x && s.y === y);
  }

  // The computer's fair apple spawn (normal mode): any free cell the snake can reach.
  spawnApple() {
    const reach = this.reachable(this.snake[0], (x, y) => this.onSnake(x, y));
    const cells = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const d = reach.get(key(x, y));
      if (d !== undefined && d >= 3) cells.push({ x, y });
    }
    if (cells.length === 0) return;
    this.apple = this.rng.pick(cells);
  }

  // Human apple placement (flipped). Only free cells are legal.
  placeApple(x, y) {
    if (this.state !== 'playing' || this.apple) return false;
    if (!this.inBounds(x, y) || this.onSnake(x, y)) {
      this.say('Apples need an empty square.', 60);
      return false;
    }
    this.apple = { x, y };
    this.hunger = 0;
    return true;
  }

  // BFS distances from `start` over cells where blocked() is false.
  reachable(start, blocked) {
    const dist = new Map([[key(start.x, start.y), 0]]);
    const q = [start];
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      for (const d of DIRS) {
        const nx = c.x + d.x, ny = c.y + d.y;
        if (!this.inBounds(nx, ny) || dist.has(key(nx, ny)) || blocked(nx, ny)) continue;
        dist.set(key(nx, ny), dist.get(key(c.x, c.y)) + 1);
        q.push({ x: nx, y: ny });
      }
    }
    return dist;
  }

  update(input) {
    if (this.flipped) this.updateApplePlacement(input);
    else this.readSteering(input);

    if (this.state !== 'playing') return;
    if (this.flipped && this.apple && ++this.hunger > this.hungerLimit) {
      this.die('starved');
      return;
    }
    if (++this.moveTimer >= this.interval) {
      this.moveTimer = 0;
      this.move();
    }
  }

  readSteering(input) {
    const map = { ArrowUp: DIRS[0], ArrowRight: DIRS[1], ArrowDown: DIRS[2], ArrowLeft: DIRS[3] };
    for (const code of input.pressed) {
      const d = map[code];
      if (!d) continue;
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
      if (same(d, last) || opposite(d, last) || this.queue.length >= 2) continue;
      this.queue.push(d);
    }
  }

  updateApplePlacement(input) {
    const m = input.mouse;
    if (m.moved && m.inside) {
      this.cursor.x = Math.max(0, Math.min(COLS - 1, Math.floor(m.x / CELL)));
      this.cursor.y = Math.max(0, Math.min(ROWS - 1, Math.floor(m.y / CELL)));
    }
    const c = this.cursor;
    if (input.pressed.has('ArrowLeft')) c.x = Math.max(0, c.x - 1);
    if (input.pressed.has('ArrowRight')) c.x = Math.min(COLS - 1, c.x + 1);
    if (input.pressed.has('ArrowUp')) c.y = Math.max(0, c.y - 1);
    if (input.pressed.has('ArrowDown')) c.y = Math.min(ROWS - 1, c.y + 1);
    if (!this.apple) {
      if (m.clicked) this.placeApple(Math.floor(m.x / CELL), Math.floor(m.y / CELL));
      else if (input.pressed.has('Space') || input.pressed.has('Enter')) this.placeApple(c.x, c.y);
      if (!this.apple && --this.placeTimer <= 0) {
        this.spawnApple(); // stalling never starves the snake: the computer drops one
        this.hunger = 0;
        this.say('Too slow! The computer dropped an apple.');
      }
    }
  }

  move() {
    if (this.flipped) this.dir = this.aiChooseDir();
    else if (this.queue.length) this.dir = this.queue.shift();

    const head = this.snake[0];
    const nx = head.x + this.dir.x, ny = head.y + this.dir.y;
    const eats = !!this.apple && this.apple.x === nx && this.apple.y === ny;
    if (!this.inBounds(nx, ny)) return this.die('wall');
    // The tail cell is vacated this tick unless the snake grows.
    const body = eats ? this.snake : this.snake.slice(0, -1);
    if (body.some((s) => s.x === nx && s.y === ny)) return this.die('self');

    this.snake.unshift({ x: nx, y: ny });
    if (!eats) {
      if (this.growth > 0) this.growth--;
      else this.snake.pop();
      return;
    }
    this.growth += GROW - 1;
    this.eaten++;
    this.score = this.eaten;
    this.apple = null;
    this.hunger = 0;
    this.level = 1 + Math.floor(this.eaten / 4);
    if (this.eaten >= TARGET) {
      this.finish(this.flipped ? 'lose' : 'win', this.flipped
        ? `The snake ate ${TARGET} apples. Try trapping it sooner!`
        : `You ate ${TARGET} apples!`);
    } else if (this.flipped) {
      this.placeTimer = PLACE_WINDOW;
    } else {
      this.spawnApple();
    }
  }

  die(reason) {
    this.deathReason = reason;
    const why = { wall: 'hit the wall', self: 'ran into itself', starved: 'starved' }[reason];
    this.finish(this.flipped ? 'win' : 'lose',
      this.flipped ? `The snake ${why}! You win.` : `You ${why} after ${this.eaten} apples.`);
  }

  // --- computer snake pilot (flipped) ---------------------------------
  // Chooses only a heading; walls, body and starvation are enforced by move().
  aiChooseDir() {
    const head = this.snake[0];
    const tail = this.snake[this.snake.length - 1];
    const blocked = (x, y) => this.onSnake(x, y) && !(x === tail.x && y === tail.y);
    const options = DIRS.filter((d) => !opposite(d, this.dir))
      .map((d) => ({ d, x: head.x + d.x, y: head.y + d.y }))
      .filter((o) => this.inBounds(o.x, o.y) && !blocked(o.x, o.y));
    if (options.length === 0) return this.dir; // doomed; move() will kill it

    if (this.apple) {
      const path = this.pathTo(head, this.apple, blocked);
      if (path && path.length > 0) {
        const skilled = this.level >= 3; // early levels chase greedily, later levels plan an escape
        // A cautious snake refuses apples that would trap it, but gets desperate as it starves.
        const desperate = this.hunger > this.hungerLimit * 0.85;
        if (!skilled || desperate || this.pathIsSafe(path)) return path[0].d;
      }
    }
    // No (safe) route to the apple: keep the most open space and hug the tail.
    let best = null;
    for (const o of options) {
      const area = this.reachable(o, (x, y) => blocked(x, y) || same({ x, y }, head)).size;
      const toTail = this.reachable(o, (x, y) => blocked(x, y) || same({ x, y }, head)).get(key(tail.x, tail.y));
      const score = area * 1000 - (toTail === undefined ? 999 : toTail);
      if (!best || score > best.score) best = { score, d: o.d };
    }
    return best.d;
  }

  pathTo(from, to, blocked) {
    const prev = new Map([[key(from.x, from.y), null]]);
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      if (same(c, to)) break;
      for (const d of DIRS) {
        const nx = c.x + d.x, ny = c.y + d.y;
        if (!this.inBounds(nx, ny) || prev.has(key(nx, ny)) || blocked(nx, ny)) continue;
        prev.set(key(nx, ny), { x: c.x, y: c.y, d });
        q.push({ x: nx, y: ny });
      }
    }
    if (!prev.has(key(to.x, to.y))) return null;
    const out = [];
    let c = to;
    while (prev.get(key(c.x, c.y))) {
      const p = prev.get(key(c.x, c.y));
      out.unshift({ x: c.x, y: c.y, d: p.d });
      c = p;
    }
    return out;
  }

  // After eating, the tail stays put for GROW-1 moves, so the snake needs real room to
  // manoeuvre: demand enough open space reachable from the head, not just a route to the tail.
  pathIsSafe(path) {
    const sim = this.snake.map((s) => ({ ...s }));
    path.forEach((step, i) => {
      sim.unshift({ x: step.x, y: step.y });
      if (i < path.length - 1) sim.pop();
    });
    const body = new Set(sim.map((s) => key(s.x, s.y)));
    const head = sim[0];
    const room = this.reachable(head, (x, y) => body.has(key(x, y))).size;
    return room >= sim.length + 2 * GROW;
  }

  // --- presentation ---------------------------------------------------
  hud() {
    const base = [{ label: 'Apples', value: `${this.eaten}/${TARGET}` }, { label: 'Level', value: this.level }];
    if (this.flipped && this.apple) {
      const left = Math.max(0, Math.ceil((this.hungerLimit - this.hunger) / 60));
      base.push({ label: 'Snake starves in', value: `${left}s` });
    }
    return base;
  }

  draw(ctx) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
    if (this.apple) {
      const cx = this.apple.x * CELL + CELL / 2, cy = this.apple.y * CELL + CELL / 2;
      ctx.fillStyle = COLORS.pink;
      ctx.beginPath();
      ctx.arc(cx, cy + 1, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.lime;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5);
      ctx.lineTo(cx + 3, cy - 9);
      ctx.stroke();
    }
    this.snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? COLORS.lime : COLORS.teal;
      ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
    });
    const h = this.snake[0];
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(h.x * CELL + 5 + this.dir.x * 3, h.y * CELL + 5 + this.dir.y * 3, 3, 3);
    ctx.fillRect(h.x * CELL + 12 + this.dir.x * 3, h.y * CELL + 12 + this.dir.y * 3, 3, 3);

    if (this.flipped && !this.apple && this.state === 'playing') {
      const c = this.cursor;
      ctx.strokeStyle = COLORS.amber;
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2);
      const secs = Math.ceil(this.placeTimer / 60);
      text(ctx, `Place an apple! (${secs}s)`, this.W / 2, 14, { size: 16, color: COLORS.amber, align: 'center' });
    }
    if (this.message) text(ctx, this.message, this.W / 2, this.H - 16, { size: 15, color: COLORS.amber, align: 'center' });
  }
}

export const meta = {
  id: 'snake',
  title: 'Snake',
  tagline: 'Eat, grow, don’t crash — or be the one dropping the apples.',
  accent: '#b8f04a',
  Game: SnakeGame,
  rules: {
    normal: 'Steer the snake and eat 20 apples. Hitting a wall or yourself ends the run. The computer drops apples only where you can reach them. The snake speeds up every 4 apples.',
    flipped: 'The computer drives the snake. You drop one apple at a time on any empty square. The snake dies if it hits a wall or itself, or starves if it can’t reach your apple in time. Stall and the computer drops one for you. Early levels the snake is greedy; from level 3 it plans escape routes. Make it crash before it eats 20!',
  },
  controls: {
    normal: [['Arrow keys / WASD', 'Steer'], ['Touch pad', 'Steer on phones']],
    flipped: [['Mouse / arrow keys', 'Move cursor'], ['Click / Space', 'Drop apple']],
  },
};
