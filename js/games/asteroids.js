import { Game } from '../core/game.js';
import { COLORS, W, H, angleDiff, text } from '../core/util.js';

export const ROT = 0.07; // radians per tick — identical for human and computer pilot
export const THRUST = 0.12;
export const FRICTION = 0.99;
export const MAX_SPEED = 6;
export const BULLET_SPEED = 8;
export const BULLET_LIFE = 55;
export const FIRE_COOLDOWN = 14;
export const MAX_BULLETS = 6;
export const SHIP_R = 10;
export const START_LIVES = 3;
export const WAVES_TO_WIN = 5;
export const SURVIVE_TICKS = 5400; // flipped: the pilot must survive 90 seconds
export const ENERGY_MAX = 8;
export const ENERGY_REGEN = 0.012; // per tick (~0.7 energy per second)
export const COST = { 1: 1, 2: 2, 3: 3 };
const RADIUS = { 1: 12, 2: 22, 3: 36 };
const POINTS = { 1: 100, 2: 50, 3: 20 };
const SENT_SPEED = { 1: 2.0, 2: 1.5, 3: 1.0 };
const PERIM = 2 * (W + H);

const wrap = (v, max) => ((v % max) + max) % max;
// Shortest signed distance on a wrapping axis.
const delta = (a, b, max) => {
  let d = wrap(b - a, max);
  if (d > max / 2) d -= max;
  return d;
};

// Border parametrisation: t in [0, PERIM) runs clockwise from the top-left corner.
export function pointToT(x, y) {
  const d = [y, W - x, H - y, x];
  const m = d.indexOf(Math.min(...d));
  if (m === 0) return x;
  if (m === 1) return W + y;
  if (m === 2) return W + H + (W - x);
  return 2 * W + H + (H - y);
}
export function tToPoint(t) {
  t = wrap(t, PERIM);
  if (t < W) return { x: t, y: 0 };
  if (t < W + H) return { x: W, y: t - W };
  if (t < 2 * W + H) return { x: W - (t - W - H), y: H };
  return { x: 0, y: H - (t - 2 * W - H) };
}

export class AsteroidsGame extends Game {
  constructor(opts) {
    super(opts);
    this.ship = this.newShip();
    this.lives = START_LIVES;
    this.asteroids = [];
    this.bullets = [];
    this.cooldown = 0;
    this.invuln = 0;
    this.respawnTimer = 0;
    this.waveTimer = 0;
    this.destroyed = 0; // asteroids shot down
    this.hits = 0; // flipped: ships lost
    this.energy = ENERGY_MAX;
    this.sendSize = 2;
    this.edgeT = 0;
    this.cursor = { x: W / 2, y: 0 };
    this.ai = { ctrl: { left: false, right: false, thrust: false, fire: false }, timer: 0, targetBias: 0, forTarget: null };
    this.sparks = [];
    if (this.flipped) {
      this.level = 1;
    } else {
      this.level = 1;
      this.spawnWave();
    }
  }

  newShip() {
    return { x: W / 2, y: H / 2, vx: 0, vy: 0, angle: -Math.PI / 2 };
  }

  // --- shared physics --------------------------------------------------
  // Both the human and the computer pilot act ONLY through these four buttons.
  applyShipControls(ctrl) {
    const s = this.ship;
    if (ctrl.left) s.angle -= ROT;
    if (ctrl.right) s.angle += ROT;
    if (ctrl.thrust) {
      s.vx += Math.cos(s.angle) * THRUST;
      s.vy += Math.sin(s.angle) * THRUST;
    }
    s.vx *= FRICTION;
    s.vy *= FRICTION;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > MAX_SPEED) { s.vx *= MAX_SPEED / sp; s.vy *= MAX_SPEED / sp; }
    s.x = wrap(s.x + s.vx, W);
    s.y = wrap(s.y + s.vy, H);
    if (ctrl.fire && this.cooldown === 0 && this.bullets.length < MAX_BULLETS) {
      this.bullets.push({
        x: s.x + Math.cos(s.angle) * 12,
        y: s.y + Math.sin(s.angle) * 12,
        vx: s.vx + Math.cos(s.angle) * BULLET_SPEED,
        vy: s.vy + Math.sin(s.angle) * BULLET_SPEED,
        life: BULLET_LIFE,
      });
      this.cooldown = FIRE_COOLDOWN;
    }
  }

  spawnWave() {
    const n = 3 + this.level;
    for (let i = 0; i < n; i++) {
      let x, y;
      do { x = this.rng.range(0, W); y = this.rng.range(0, H); }
      while (Math.hypot(delta(this.ship.x, x, W), delta(this.ship.y, y, H)) < 160);
      const ang = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(0.5, 1.1) * (1 + 0.1 * (this.level - 1));
      this.asteroids.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, size: 3 });
    }
  }

  // Flipped: the human launches an asteroid from the border toward the ship.
  sendAsteroid(x, y, size = this.sendSize) {
    if (this.state !== 'playing' || !this.flipped) return false;
    if (this.energy < COST[size]) { this.say('Not enough energy — wait for it to recharge.', 60); return false; }
    if (this.asteroids.length >= 30) return false;
    const p = tToPoint(pointToT(x, y));
    const toShip = Math.atan2(this.ship.y - p.y, this.ship.x - p.x) + this.rng.range(-0.12, 0.12);
    const sp = SENT_SPEED[size] * (1 + 0.06 * (this.level - 1));
    this.energy -= COST[size];
    this.asteroids.push({ x: p.x, y: p.y, vx: Math.cos(toShip) * sp, vy: Math.sin(toShip) * sp, size });
    return true;
  }

  update(input) {
    if (this.cooldown > 0) this.cooldown--;
    if (this.invuln > 0) this.invuln--;

    if (this.respawnTimer > 0) {
      if (--this.respawnTimer === 0) this.respawn();
    } else {
      const ctrl = this.flipped ? this.aiControls() : this.humanControls(input);
      this.applyShipControls(ctrl);
    }
    if (this.flipped) this.updateSender(input);

    for (const a of this.asteroids) {
      a.x = wrap(a.x + a.vx, W);
      a.y = wrap(a.y + a.vy, H);
    }
    this.moveBullets();
    if (this.state !== 'playing') return;
    this.checkShipHit();
    if (this.state !== 'playing') return;

    if (this.flipped) {
      this.energy = Math.min(ENERGY_MAX, this.energy + ENERGY_REGEN);
      this.level = 1 + Math.floor(this.tick / 900);
      this.score = Math.floor(this.tick / 60);
      if (this.tick >= SURVIVE_TICKS) this.finish('lose', 'The pilot survived 90 seconds.');
    } else if (this.asteroids.length === 0 && this.respawnTimer === 0) {
      if (++this.waveTimer >= 90) {
        this.waveTimer = 0;
        if (this.level >= WAVES_TO_WIN) return this.finish('win', `You cleared all ${WAVES_TO_WIN} waves!`);
        this.level++;
        this.spawnWave();
        this.say(`Wave ${this.level}`);
      }
    }
  }

  humanControls(input) {
    return {
      left: input.keys.has('ArrowLeft'),
      right: input.keys.has('ArrowRight'),
      thrust: input.keys.has('ArrowUp'),
      fire: input.keys.has('Space'),
    };
  }

  updateSender(input) {
    if (input.pressed.has('Digit1')) this.sendSize = 1;
    if (input.pressed.has('Digit2')) this.sendSize = 2;
    if (input.pressed.has('Digit3')) this.sendSize = 3;
    if (input.pressed.has('KeyQ')) this.sendSize = this.sendSize === 1 ? 3 : this.sendSize - 1;
    if (input.pressed.has('KeyE')) this.sendSize = this.sendSize === 3 ? 1 : this.sendSize + 1;
    const m = input.mouse;
    if (m.moved && m.inside) this.edgeT = pointToT(m.x, m.y);
    if (input.keys.has('ArrowLeft')) this.edgeT -= 6;
    if (input.keys.has('ArrowRight')) this.edgeT += 6;
    this.edgeT = wrap(this.edgeT, PERIM);
    this.cursor = tToPoint(this.edgeT);
    if (m.clicked) this.sendAsteroid(m.x, m.y);
    else if (input.pressed.has('Space') || input.pressed.has('Enter')) this.sendAsteroid(this.cursor.x, this.cursor.y);
  }

  moveBullets() {
    for (const b of this.bullets) {
      b.x = wrap(b.x + b.vx, W);
      b.y = wrap(b.y + b.vy, H);
      b.life--;
    }
    for (const b of this.bullets) {
      for (let i = 0; i < this.asteroids.length; i++) {
        const a = this.asteroids[i];
        if (Math.hypot(delta(b.x, a.x, W), delta(b.y, a.y, H)) <= RADIUS[a.size] + 2) {
          b.life = 0;
          this.breakAsteroid(i);
          break;
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  breakAsteroid(i) {
    const a = this.asteroids[i];
    this.asteroids.splice(i, 1);
    this.destroyed++;
    if (!this.flipped) this.score += POINTS[a.size];
    this.sparks.push({ x: a.x, y: a.y, t: 14, r: RADIUS[a.size] });
    if (a.size > 1) {
      const base = Math.atan2(a.vy, a.vx);
      const sp = Math.hypot(a.vx, a.vy) * 1.25;
      for (const off of [-0.6, 0.6]) {
        this.asteroids.push({ x: a.x, y: a.y, vx: Math.cos(base + off) * sp, vy: Math.sin(base + off) * sp, size: a.size - 1 });
      }
    }
  }

  checkShipHit() {
    if (this.respawnTimer > 0 || this.invuln > 0) return;
    const s = this.ship;
    for (const a of this.asteroids) {
      if (Math.hypot(delta(s.x, a.x, W), delta(s.y, a.y, H)) <= RADIUS[a.size] + SHIP_R - 2) {
        this.lives--;
        this.hits++;
        this.sparks.push({ x: s.x, y: s.y, t: 20, r: 30 });
        if (this.lives <= 0) {
          return this.finish(this.flipped ? 'win' : 'lose', this.flipped
            ? 'You destroyed all three of the pilot’s ships!'
            : 'Your last ship was destroyed.');
        }
        this.respawnTimer = 90;
        this.say(this.flipped ? 'Direct hit! Ship lost.' : 'Ship destroyed!');
        return;
      }
    }
  }

  respawn() {
    // wait until the centre is clear so nobody is respawned into a rock
    const near = this.asteroids.some((a) => Math.hypot(delta(W / 2, a.x, W), delta(H / 2, a.y, H)) < RADIUS[a.size] + 70);
    if (near) { this.respawnTimer = 20; return; }
    this.ship = this.newShip();
    this.invuln = 150;
    this.bullets = [];
  }

  // --- computer pilot (flipped) ---------------------------------------
  // Outputs the same four buttons a human has; reacts only every few ticks.
  aiControls() {
    const ai = this.ai;
    if (--ai.timer > 0) return ai.ctrl;
    ai.timer = Math.max(2, 7 - this.level);
    const s = this.ship;
    const ctrl = { left: false, right: false, thrust: false, fire: false };

    const rel = this.asteroids.map((a) => {
      const dx = delta(s.x, a.x, W), dy = delta(s.y, a.y, H);
      const rvx = a.vx - s.vx, rvy = a.vy - s.vy;
      const rv2 = rvx * rvx + rvy * rvy;
      const t = rv2 > 1e-6 ? Math.min(120, Math.max(0, -(dx * rvx + dy * rvy) / rv2)) : 0;
      const ox = dx + rvx * t, oy = dy + rvy * t;
      return { a, dx, dy, rvx, rvy, t, ox, oy, miss: Math.hypot(ox, oy), d: Math.hypot(dx, dy) };
    });

    // 1) dodge: the soonest predicted collision inside a safety margin
    const threats = rel.filter((r) => r.miss < RADIUS[r.a.size] + SHIP_R + 26 && r.t < 80).sort((p, q) => p.t - q.t);
    let evading = false;
    if (threats.length && this.invuln === 0) {
      const th = threats[0];
      let ex = -th.ox, ey = -th.oy;
      if (Math.hypot(ex, ey) < 1) { ex = -th.rvy; ey = th.rvx; } // dead-centre: sidestep
      const want = Math.atan2(ey, ex);
      const err = angleDiff(s.angle, want);
      if (Math.abs(err) > ROT / 2) { ctrl.left = err < 0; ctrl.right = err > 0; }
      if (Math.abs(err) < 0.7) ctrl.thrust = true;
      evading = true;
    }

    // 2) shoot the nearest rock with a lead
    const targets = rel.slice().sort((p, q) => p.d - q.d);
    if (targets.length) {
      const tg = targets[0];
      if (ai.forTarget !== tg.a) {
        ai.forTarget = tg.a;
        ai.targetBias = this.rng.range(-1, 1) * Math.max(0.03, 0.14 - 0.02 * (this.level - 1));
      }
      let t = tg.d / BULLET_SPEED;
      for (let k = 0; k < 3; k++) t = Math.hypot(tg.dx + tg.rvx * t, tg.dy + tg.rvy * t) / BULLET_SPEED;
      const aim = Math.atan2(tg.dy + tg.rvy * t, tg.dx + tg.rvx * t) + ai.targetBias;
      const err = angleDiff(s.angle, aim);
      if (!evading && Math.abs(err) > ROT / 2) { ctrl.left = err < 0; ctrl.right = err > 0; }
      const tol = Math.atan2(RADIUS[tg.a.size] * 0.8, Math.max(1, tg.d));
      if (Math.abs(err) < Math.max(0.04, tol) && tg.d < BULLET_SPEED * BULLET_LIFE * 0.85) ctrl.fire = true;
    }
    ai.ctrl = ctrl;
    return ctrl;
  }

  hud() {
    if (this.flipped) {
      return [
        { label: 'Pilot ships', value: this.lives },
        { label: 'Survive', value: `${Math.max(0, Math.ceil((SURVIVE_TICKS - this.tick) / 60))}s` },
        { label: 'Energy', value: this.energy.toFixed(1) },
        { label: 'Rock', value: ['', 'small', 'medium', 'large'][this.sendSize] },
      ];
    }
    return [{ label: 'Score', value: this.score }, { label: 'Ships', value: this.lives }, { label: 'Wave', value: `${this.level}/${WAVES_TO_WIN}` }];
  }

  draw(ctx) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.ink;
    for (const a of this.asteroids) {
      const r = RADIUS[a.size];
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const rr = r * (0.82 + 0.18 * (((i * 7 + a.size * 3) % 5) / 4));
        const px = a.x + Math.cos(ang) * rr, py = a.y + Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.amber;
    for (const b of this.bullets) ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
    for (const sp of this.sparks) {
      ctx.strokeStyle = COLORS.pink;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r * (1 - sp.t / 24), 0, Math.PI * 2);
      ctx.stroke();
      sp.t--;
    }
    this.sparks = this.sparks.filter((s) => s.t > 0);
    if (this.respawnTimer === 0 && this.lives > 0) {
      const s = this.ship;
      if (this.invuln === 0 || Math.floor(this.invuln / 6) % 2 === 0) {
        ctx.strokeStyle = this.flipped ? COLORS.pink : COLORS.teal;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(s.angle) * 14, s.y + Math.sin(s.angle) * 14);
        ctx.lineTo(s.x + Math.cos(s.angle + 2.5) * 11, s.y + Math.sin(s.angle + 2.5) * 11);
        ctx.lineTo(s.x + Math.cos(s.angle - 2.5) * 11, s.y + Math.sin(s.angle - 2.5) * 11);
        ctx.closePath();
        ctx.stroke();
      }
    }
    if (this.flipped && this.state === 'playing') {
      const c = this.cursor;
      ctx.strokeStyle = COLORS.teal;
      ctx.beginPath();
      ctx.arc(c.x, c.y, RADIUS[this.sendSize], 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(20, H - 22, 160, 8);
      ctx.fillStyle = this.energy >= COST[this.sendSize] ? COLORS.teal : COLORS.red;
      ctx.fillRect(20, H - 22, 160 * (this.energy / ENERGY_MAX), 8);
    }
    if (this.message) text(ctx, this.message, W / 2, H / 2 - 60, { size: 16, color: COLORS.amber, align: 'center' });
  }
}

export const meta = {
  id: 'asteroids',
  title: 'Asteroids',
  tagline: 'Blast the rocks — or be the one who throws them.',
  accent: '#9b7bff',
  Game: AsteroidsGame,
  rules: {
    normal: 'Fly the ship, shoot every rock (large rocks split in two) and survive. Clear 5 waves with your 3 ships. The screen wraps around. You get a short shield after respawning.',
    flipped: 'The computer flies and shoots using the same turn rate, thrust and gun as the human ship. You throw rocks from the screen border: pick small (cost 1), medium (2) or large (3) — energy refills slowly. Each rock heads toward the ship’s current position, with some scatter. Destroy all 3 of its ships before it survives 90 seconds. The pilot reacts faster and aims better every 15 seconds.',
  },
  controls: {
    normal: [['Left / Right', 'Rotate'], ['Up', 'Thrust'], ['Space', 'Fire']],
    flipped: [['Mouse / Left / Right', 'Choose launch point on the border'], ['Click / Space', 'Throw rock'], ['1 / 2 / 3 or Q / E', 'Rock size']],
  },
};
