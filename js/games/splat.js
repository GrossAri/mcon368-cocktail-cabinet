import { Game } from '../core/game.js';
import { COLORS, circleRect, clamp, text } from '../core/util.js';

export const BIRD_X = 140;
export const BIRD_R = 12;
export const GRAVITY = 0.32;
export const FLAP = -5.2;
export const MAX_FALL = 8;
export const FLOOR = 440;
export const COL_W = 56;
export const SPACING = 220; // horizontal distance between columns, in pixels
export const TARGET = 25;

// Difficulty is a pure function of level so the human-placed and computer-placed
// layouts are held to exactly the same, tested limits.
export const speedFor = (level) => 2.4 + 0.25 * (level - 1);
export const gapFor = (level) => Math.max(120, 170 - 10 * (level - 1));
// Highest climb the bird can always manage between two consecutive columns.
export const maxClimbFor = (level) => Math.round(1.8 * ((SPACING - COL_W - 2 * BIRD_R) / speedFor(level)));
export const maxDropFor = (level) => Math.round(1.5 * maxClimbFor(level));

export class SplatGame extends Game {
  constructor(opts) {
    super(opts);
    this.bird = { y: 240, vy: 0 };
    this.columns = [];
    this.passed = 0;
    this.lastGapY = 240;
    this.sinceSpawn = SPACING - 90; // first column arrives soon after start
    this.flying = this.flipped; // normal: wait for the first flap
    this.cursorY = 240;
    this.ai = { cooldown: 0, noise: 0, forCol: null };
    this.splat = null;
    this.birdPhase = 0;
  }

  get speed() {
    return speedFor(this.level);
  }
  get gap() {
    return gapFor(this.level);
  }
  get ready() {
    return this.sinceSpawn >= SPACING;
  }
  // Where a column's gap may be centred, given the previous column.
  band() {
    const half = this.gap / 2;
    const lo = Math.max(half + 30, this.lastGapY - maxClimbFor(this.level));
    const hi = Math.min(FLOOR - half - 30, this.lastGapY + maxDropFor(this.level));
    return { lo, hi };
  }

  // Human (flipped) or computer (normal) places the next column. Returns the stored gap centre.
  placeColumn(wantY) {
    if (!this.ready || this.state !== 'playing') return null;
    const { lo, hi } = this.band();
    const gapY = clamp(wantY, lo, hi);
    this.columns.push({ x: 640, gapY, gapH: this.gap, passed: false });
    this.lastGapY = gapY;
    this.sinceSpawn = 0;
    return gapY;
  }

  update(input) {
    const b = this.bird;
    this.birdPhase++;
    let flap = false;
    if (this.flipped) {
      this.updatePlacement(input);
      flap = this.aiWantsFlap();
    } else {
      const wants = input.pressed.has('Space') || input.pressed.has('ArrowUp') || input.mouse.clicked;
      if (wants) {
        this.flying = true;
        flap = true;
      }
      if (this.flying && this.ready) {
        const { lo, hi } = this.band();
        this.placeColumn(this.rng.range(lo, hi)); // computer lays out fair, reachable columns
      }
    }
    if (!this.flying) {
      b.y = 240 + Math.sin(this.birdPhase / 10) * 8;
      return;
    }
    if (flap) b.vy = FLAP;
    b.vy = Math.min(MAX_FALL, b.vy + GRAVITY);
    b.y += b.vy;
    if (b.y < BIRD_R) { b.y = BIRD_R; b.vy = Math.max(0, b.vy); }

    const v = this.speed;
    this.sinceSpawn += v;
    for (const c of this.columns) {
      c.x -= v;
      if (!c.passed && c.x + COL_W < BIRD_X - BIRD_R) {
        c.passed = true;
        this.passed++;
        this.score = this.passed;
        this.level = Math.min(6, 1 + Math.floor(this.passed / 5));
      }
    }
    this.columns = this.columns.filter((c) => c.x + COL_W > -10);

    if (b.y + BIRD_R >= FLOOR) return this.splatted('the ground');
    for (const c of this.columns) {
      const top = circleRect(BIRD_X, b.y, BIRD_R, c.x, 0, COL_W, c.gapY - c.gapH / 2);
      const bottom = circleRect(BIRD_X, b.y, BIRD_R, c.x, c.gapY + c.gapH / 2, COL_W, FLOOR);
      if (top || bottom) return this.splatted('a column');
    }
    if (this.passed >= TARGET) {
      this.finish(this.flipped ? 'lose' : 'win', this.flipped
        ? `The bird flew through ${TARGET} columns.`
        : `You flew through ${TARGET} columns!`);
    }
  }

  updatePlacement(input) {
    const m = input.mouse;
    if (m.moved && m.inside) this.cursorY = m.y;
    if (input.keys.has('ArrowUp')) this.cursorY -= 5;
    if (input.keys.has('ArrowDown')) this.cursorY += 5;
    this.cursorY = clamp(this.cursorY, 0, FLOOR);
    if (this.ready && (m.clicked || input.pressed.has('Space') || input.pressed.has('Enter'))) {
      this.placeColumn(this.cursorY);
    } else if (this.sinceSpawn >= SPACING + this.speed * 90) {
      // stalling never helps the human: the computer drops a fair column
      const { lo, hi } = this.band();
      this.placeColumn(this.rng.range(lo, hi));
      this.say('Too slow! The computer placed a column.', 90);
    }
  }

  // --- computer bird pilot: same physics as the human, it only chooses when to flap ---
  aiWantsFlap() {
    const b = this.bird, ai = this.ai;
    if (ai.cooldown > 0) ai.cooldown--;
    const next = this.columns.find((c) => c.x + COL_W >= BIRD_X - BIRD_R);
    let target = 240;
    if (next) {
      if (ai.forCol !== next) { // fresh imprecision each column; smaller at higher levels' pace
        ai.forCol = next;
        ai.noise = this.rng.range(-1, 1) * next.gapH * 0.12;
      }
      target = this.safeTarget(next, next.gapY + 14 + ai.noise);
    }
    if (this.tick % 2 === 0 && ai.cooldown === 0 && b.y + b.vy * 3 > target && b.vy > -1) {
      ai.cooldown = 6;
      return true;
    }
    return false;
  }

  // A flap lifts ~42px, so keep the oscillation band (target-44 .. target+12) inside the gap.
  safeTarget(col, want) {
    const half = col.gapH / 2;
    return clamp(want, col.gapY - half + BIRD_R + 44, col.gapY + half - BIRD_R - 12);
  }

  splatted(on) {
    this.splat = { x: BIRD_X, y: this.bird.y };
    this.finish(this.flipped ? 'win' : 'lose', this.flipped
      ? `Splat! The bird hit ${on}. You win!`
      : `Splat! You hit ${on} after ${this.passed} columns.`);
  }

  hud() {
    const base = [{ label: 'Columns', value: `${this.passed}/${TARGET}` }, { label: 'Level', value: this.level }];
    if (this.flipped) {
      base.push({ label: 'Next column', value: this.ready ? 'READY' : `${Math.ceil((SPACING - this.sinceSpawn) / this.speed / 60 * 10) / 10}s` });
    }
    return base;
  }

  draw(ctx) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, FLOOR, this.W, this.H - FLOOR);
    ctx.fillStyle = COLORS.violet;
    ctx.fillRect(0, FLOOR, this.W, 4);
    for (const c of this.columns) this.drawColumn(ctx, c.x, c.gapY, c.gapH, 1);

    if (this.flipped && this.state === 'playing') {
      const { lo, hi } = this.band();
      const gy = clamp(this.cursorY, lo, hi);
      ctx.fillStyle = 'rgba(61,224,194,0.12)';
      ctx.fillRect(this.W - 90, lo - this.gap / 2, 90, hi - lo + this.gap);
      this.drawColumn(ctx, this.W - COL_W - 10, gy, this.gap, this.ready ? 0.7 : 0.25);
      text(ctx, this.ready ? 'Click / Space: place' : 'Reloading…', this.W - 8, 16, { size: 13, color: COLORS.teal, align: 'right' });
    }
    if (this.splat) {
      ctx.fillStyle = COLORS.pink;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(this.splat.x + Math.cos(a) * 16, this.splat.y + Math.sin(a) * 16, 6 + (i % 3) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = COLORS.lime;
      ctx.beginPath();
      ctx.arc(BIRD_X, this.bird.y, BIRD_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.pink;
      ctx.beginPath();
      ctx.arc(BIRD_X, this.bird.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    text(ctx, String(this.passed), 320, 40, { size: 40, color: COLORS.ink, align: 'center' });
    if (!this.flying && this.state === 'playing') text(ctx, 'Space / click to flap', 320, 300, { size: 16, color: COLORS.amber, align: 'center' });
    if (this.message) text(ctx, this.message, 320, 466, { size: 14, color: COLORS.amber, align: 'center' });
  }

  drawColumn(ctx, x, gapY, gapH, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS.amber;
    ctx.fillRect(x, 0, COL_W, gapY - gapH / 2);
    ctx.fillRect(x, gapY + gapH / 2, COL_W, FLOOR - gapY - gapH / 2);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(x - 4, gapY - gapH / 2 - 10, COL_W + 8, 10);
    ctx.fillRect(x - 4, gapY + gapH / 2, COL_W + 8, 10);
    ctx.globalAlpha = 1;
  }
}

export const meta = {
  id: 'splat',
  title: 'Splat',
  tagline: 'Flap through the columns — or build them and watch for the splat.',
  accent: '#ffb347',
  Game: SplatGame,
  rules: {
    normal: 'Tap to flap and fly through 25 columns. Hitting a column or the ground splats you. The computer lays the columns out, always within a gap you can physically reach. Every 5 columns the world speeds up and the gaps shrink.',
    flipped: 'The computer flies the bird using the same flap physics as you. YOU lay out the columns: pick the height of the gap and place a column each time the meter reloads. Your gap must stay within the shaded band — the highest climb or drop the bird can reach in time — so every layout is passable. Narrower gaps and faster scrolling come every 5 columns. Splat the bird before it clears 25 columns! If you stall, the computer places one for you.',
  },
  controls: {
    normal: [['Space / Up / click / tap', 'Flap']],
    flipped: [['Mouse or Up / Down', 'Choose gap height'], ['Click / Space', 'Place column']],
  },
};
