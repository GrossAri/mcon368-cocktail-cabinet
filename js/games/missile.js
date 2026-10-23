import { Game } from '../core/game.js';
import { COLORS, W, H, clamp, dist, text } from '../core/util.js';

export const GROUND_Y = 430;
export const WAVES_TO_WIN = 5;
export const INTERCEPT_SPEED = 5;
export const BLAST_R = 34;
export const BLAST_TICKS = 50;
export const CITY_X = [95, 170, 245, 395, 470, 545];
export const BATTERY_X = [30, 320, 610];
export const BATTERY_AMMO = 5;
export const LAUNCH_COOLDOWN = 40; // flipped: ticks between the human's launches
const LAUNCH_Y = 0;

// Normal: the computer's attack. Flipped: the human's attack (a little faster, but rationed).
export const enemySpeedFor = (wave, flipped = false) => (flipped ? 0.7 + 0.08 * (wave - 1) : 0.55 + 0.08 * (wave - 1));
export const humanSupplyFor = (wave) => 11 + 2 * (wave - 1);

export class MissileGame extends Game {
  constructor(opts) {
    super(opts);
    this.level = 1; // wave
    this.cities = CITY_X.map((x) => ({ x, alive: true }));
    this.batteries = BATTERY_X.map((x) => ({ x, alive: true, ammo: BATTERY_AMMO, cool: 0 }));
    this.enemies = [];
    this.interceptors = [];
    this.blasts = [];
    this.cursor = { x: 320, y: 200 };
    this.launcherX = 320;
    this.launchCool = 0;
    this.toLaunch = 0; // missiles left to send this wave (computer in normal mode)
    this.nextLaunch = 0;
    this.supply = 0; // missiles the human may still send (flipped)
    this.waveTimer = 0;
    this.shotsFired = 0;
    this.destroyedEnemies = 0;
    this.idle = 0;
    this.ai = { timer: 0 };
    this.startWave();
  }

  get enemySpeed() {
    return enemySpeedFor(this.level, this.flipped);
  }
  get aliveCities() {
    return this.cities.filter((c) => c.alive).length;
  }

  startWave() {
    this.idle = 0;
    for (const b of this.batteries) {
      b.ammo = BATTERY_AMMO;
      b.cool = 0;
    }
    if (this.flipped) {
      this.supply = humanSupplyFor(this.level);
      this.batteries.forEach((b, i) => { if (!b.alive && this.level % 2 === 0 && i === 1) b.alive = true; }); // crews rebuild the centre battery every other wave
    } else {
      this.toLaunch = 6 + 3 * this.level;
      this.nextLaunch = 60;
      const dead = this.cities.find((c) => !c.alive);
      if (dead && this.level > 1) dead.alive = true; // one city is repaired between waves
      this.batteries.forEach((b) => { b.alive = true; });
    }
  }

  // ---- enemy missiles (computer in normal mode, human in flipped) ----
  launchEnemy(fromX, tx, ty) {
    const sx = clamp(fromX, 0, W), sy = LAUNCH_Y;
    const d = dist(sx, sy, tx, ty) || 1;
    const sp = this.enemySpeed;
    const m = { sx, sy, x: sx, y: sy, tx, ty, vx: ((tx - sx) / d) * sp, vy: ((ty - sy) / d) * sp, alive: true, covered: 0 };
    this.enemies.push(m);
    return m;
  }

  // Flipped: the human picks the launcher position (fromX) and a target on the ground or in the sky.
  humanLaunch(tx, ty) {
    if (!this.flipped || this.state !== 'playing') return false;
    if (this.supply <= 0 || this.launchCool > 0) return false;
    this.launchEnemy(this.launcherX, tx, Math.min(ty, GROUND_Y));
    this.supply--;
    this.launchCool = LAUNCH_COOLDOWN;
    this.idle = 0;
    return true;
  }

  // Normal mode: human interceptor from the nearest working battery that has ammo.
  humanFire(tx, ty) {
    if (this.flipped || this.state !== 'playing') return false;
    return this.fireInterceptor(tx, Math.min(ty, GROUND_Y - 20), null);
  }

  fireInterceptor(tx, ty, preferred) {
    const ready = this.batteries.filter((b) => b.alive && b.ammo > 0 && b.cool === 0);
    if (!ready.length) { if (!this.flipped) this.say('No ammo available!', 50); return false; }
    const b = preferred && ready.includes(preferred) ? preferred : ready.sort((p, q) => Math.abs(p.x - tx) - Math.abs(q.x - tx))[0];
    b.ammo--;
    b.cool = this.flipped ? 90 : 14;
    const sy = GROUND_Y - 10;
    const d = dist(b.x, sy, tx, ty) || 1;
    this.interceptors.push({
      sx: b.x, sy, x: b.x, y: sy, tx, ty,
      vx: ((tx - b.x) / d) * INTERCEPT_SPEED, vy: ((ty - sy) / d) * INTERCEPT_SPEED,
      steps: Math.ceil(d / INTERCEPT_SPEED), battery: b,
    });
    this.shotsFired++;
    return true;
  }

  update(input) {
    this.readInput(input);
    for (const b of this.batteries) if (b.cool > 0) b.cool--;
    if (this.launchCool > 0) this.launchCool--;

    if (!this.flipped && this.toLaunch > 0 && --this.nextLaunch <= 0) {
      this.computerLaunch();
      this.toLaunch--;
      this.nextLaunch = Math.max(25, Math.round((95 - 6 * this.level) * this.rng.range(0.6, 1.4)));
    }
    if (this.flipped) this.aiDefend();

    this.moveInterceptors();
    this.moveEnemies();
    this.updateBlasts();
    this.checkEnd();
  }

  readInput(input) {
    const m = input.mouse;
    if (m.moved && m.inside) { this.cursor.x = m.x; this.cursor.y = m.y; }
    const k = input.keys;
    if (k.has('ArrowLeft') && !this.flipped) this.cursor.x -= 6;
    if (k.has('ArrowRight') && !this.flipped) this.cursor.x += 6;
    if (k.has('ArrowUp')) this.cursor.y -= 6;
    if (k.has('ArrowDown')) this.cursor.y += 6;
    this.cursor.x = clamp(this.cursor.x, 0, W);
    this.cursor.y = clamp(this.cursor.y, 0, GROUND_Y);
    if (this.flipped) {
      if (input.keys.has('KeyJ')) this.launcherX -= 5;
      if (input.keys.has('KeyL')) this.launcherX += 5;
      if (input.keys.has('ArrowLeft')) this.cursor.x -= 6; // cursor moves with arrows; launcher with J / L
      if (input.keys.has('ArrowRight')) this.cursor.x += 6;
      this.launcherX = clamp(this.launcherX, 0, W);
      if (m.moved && m.inside && m.y < 40) this.launcherX = m.x; // pointing at the top edge slides the launcher
      if (m.clicked && m.y >= 40) this.humanLaunch(m.x, m.y);
      else if (input.pressed.has('Space') || input.pressed.has('Enter')) this.humanLaunch(this.cursor.x, this.cursor.y);
    } else if (m.clicked) {
      this.humanFire(m.x, m.y);
    } else if (input.pressed.has('Space') || input.pressed.has('Enter')) {
      this.humanFire(this.cursor.x, this.cursor.y);
    }
  }

  // Normal mode: the computer's attack. Aims at surviving cities or batteries (never at nothing).
  computerLaunch() {
    const targets = [...this.cities.filter((c) => c.alive), ...this.batteries.filter((b) => b.alive)];
    if (!targets.length) return;
    const t = this.rng.pick(targets);
    this.launchEnemy(this.rng.range(0, W), t.x, GROUND_Y);
    // from wave 3 a missile may split mid-flight
    if (this.level >= 3 && this.rng.chance(0.25)) this.enemies[this.enemies.length - 1].splitAt = this.rng.range(120, 220);
  }

  moveEnemies() {
    for (const m of this.enemies) {
      if (!m.alive) continue;
      m.age = (m.age || 0) + 1;
      m.x += m.vx;
      m.y += m.vy;
      if (m.splitAt && m.y >= m.splitAt) {
        m.splitAt = 0;
        const targets = [...this.cities.filter((c) => c.alive), ...this.batteries.filter((b) => b.alive)];
        for (let i = 0; i < 2 && targets.length; i++) {
          const t = this.rng.pick(targets);
          const d = dist(m.x, m.y, t.x, GROUND_Y) || 1;
          this.enemies.push({ sx: m.x, sy: m.y, x: m.x, y: m.y, tx: t.x, ty: GROUND_Y, vx: ((t.x - m.x) / d) * this.enemySpeed, vy: ((GROUND_Y - m.y) / d) * this.enemySpeed, alive: true, covered: 0 });
        }
      }
      if (m.y >= m.ty - 0.5 || (m.vy <= 0 && dist(m.x, m.y, m.tx, m.ty) < 1)) this.impact(m);
    }
    this.enemies = this.enemies.filter((m) => m.alive);
  }

  impact(m) {
    m.alive = false;
    this.blasts.push({ x: m.x, y: m.y, t: 0, ground: true, max: 22 });
    for (const c of this.cities) if (c.alive && Math.abs(c.x - m.x) < 16 && m.y >= GROUND_Y - 6) c.alive = false;
    for (const b of this.batteries) if (b.alive && Math.abs(b.x - m.x) < 16 && m.y >= GROUND_Y - 6) b.alive = false;
  }

  moveInterceptors() {
    for (const i of this.interceptors) {
      i.x += i.vx;
      i.y += i.vy;
      if (--i.steps <= 0) {
        i.done = true;
        this.blasts.push({ x: i.tx, y: i.ty, t: 0, max: BLAST_R });
      }
    }
    this.interceptors = this.interceptors.filter((i) => !i.done);
  }

  blastRadius(b) {
    const half = BLAST_TICKS / 2;
    return b.max * (b.t < half ? b.t / half : (BLAST_TICKS - b.t) / half);
  }

  updateBlasts() {
    for (const b of this.blasts) {
      b.t++;
      if (b.ground) continue; // ground impacts are cosmetic; they never destroy missiles
      const r = this.blastRadius(b);
      for (const m of this.enemies) {
        if (m.alive && dist(m.x, m.y, b.x, b.y) <= r) {
          m.alive = false;
          if (!this.flipped) this.score += 25;
          this.blasts.push({ x: m.x, y: m.y, t: 0, max: 18 });
          this.destroyedEnemies++;
        }
      }
    }
    this.enemies = this.enemies.filter((m) => m.alive);
    this.blasts = this.blasts.filter((b) => b.t < BLAST_TICKS);
  }

  // ---- computer defender (flipped) ----
  // Fires real interceptors with finite speed, limited ammo and a reload; it only
  // knows each missile's position/velocity, never the human's plans.
  aiDefend() {
    const ai = this.ai;
    if (--ai.timer > 0) return;
    ai.timer = Math.max(8, 30 - 4 * this.level);
    const cands = this.enemies
      .filter((m) => m.alive && (m.age || 0) >= Math.max(10, 45 - 6 * this.level) && !this.isCovered(m)) // radar needs time to lock on
      .map((m) => ({ m, eta: (m.ty - m.y) / (m.vy || 0.001) }))
      .sort((a, b) => a.eta - b.eta);
    for (const { m } of cands) {
      const battery = this.batteries.filter((b) => b.alive && b.ammo > 0 && b.cool === 0)
        .sort((p, q) => Math.abs(p.x - m.x) - Math.abs(q.x - m.x))[0];
      if (!battery) return;
      const p = this.solveIntercept(battery, m);
      if (!p) continue;
      const err = Math.max(4, 24 - 3 * this.level);
      this.fireInterceptor(clamp(p.x + this.rng.range(-err, err), 0, W), clamp(p.y + this.rng.range(-err, err), 0, GROUND_Y - 20), battery);
      return;
    }
  }

  isCovered(m) {
    return this.interceptors.some((i) => {
      const t = i.steps;
      const px = m.x + m.vx * t, py = m.y + m.vy * t;
      return dist(px, py, i.tx, i.ty) < BLAST_R * 0.6;
    }) || this.blasts.some((b) => !b.ground && dist(b.x, b.y, m.x, m.y) < BLAST_R * 1.4 && b.t < 30);
  }

  // Lead the missile: find where it will be when the interceptor arrives.
  solveIntercept(battery, m) {
    let t = dist(battery.x, GROUND_Y - 10, m.x, m.y) / INTERCEPT_SPEED;
    for (let k = 0; k < 6; k++) {
      const px = m.x + m.vx * t, py = m.y + m.vy * t;
      t = dist(battery.x, GROUND_Y - 10, px, py) / INTERCEPT_SPEED;
    }
    const px = m.x + m.vx * t, py = m.y + m.vy * t;
    if (py >= m.ty || py > GROUND_Y - 25) return null; // it lands first
    return { x: px, y: py };
  }

  checkEnd() {
    if (this.aliveCities === 0) {
      return this.finish(this.flipped ? 'win' : 'lose', this.flipped
        ? 'You destroyed every city!' : 'Every city has been destroyed.');
    }
    // holding missiles back forever never helps: unused stock is forfeited after 15 idle seconds
    if (this.flipped && this.supply > 0 && this.enemies.length === 0 && ++this.idle >= 900) {
      this.supply = 0;
      this.say('Unused missiles forfeited.');
    }
    const waveOver = this.enemies.length === 0 && this.interceptors.length === 0 &&
      (this.flipped ? this.supply <= 0 : this.toLaunch <= 0) && !this.blasts.some((b) => !b.ground && b.t < BLAST_TICKS);
    if (!waveOver) return;
    if (++this.waveTimer < 100) return;
    this.waveTimer = 0;
    const bonus = this.batteries.reduce((s, b) => s + b.ammo, 0) * 5 + this.aliveCities * 100;
    if (!this.flipped) this.score += bonus;
    if (this.level >= WAVES_TO_WIN) {
      return this.finish(this.flipped ? 'lose' : 'win', this.flipped
        ? `${this.aliveCities} city(ies) survived all ${WAVES_TO_WIN} waves.`
        : `You defended the cities through ${WAVES_TO_WIN} waves!`);
    }
    this.level++;
    this.startWave();
    this.say(`Wave ${this.level}`);
  }

  hud() {
    if (this.flipped) {
      return [
        { label: 'Cities left', value: this.aliveCities },
        { label: 'Missiles', value: this.supply },
        { label: 'Wave', value: `${this.level}/${WAVES_TO_WIN}` },
        { label: 'Defender ammo', value: this.batteries.reduce((s, b) => s + (b.alive ? b.ammo : 0), 0) },
      ];
    }
    return [
      { label: 'Score', value: this.score },
      { label: 'Cities', value: this.aliveCities },
      { label: 'Wave', value: `${this.level}/${WAVES_TO_WIN}` },
      { label: 'Ammo', value: this.batteries.reduce((s, b) => s + (b.alive ? b.ammo : 0), 0) },
    ];
  }

  draw(ctx) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2b1648';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.lineWidth = 1.5;
    for (const m of this.enemies) {
      ctx.strokeStyle = COLORS.pink;
      ctx.beginPath(); ctx.moveTo(m.sx, m.sy); ctx.lineTo(m.x, m.y); ctx.stroke();
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
    }
    for (const i of this.interceptors) {
      ctx.strokeStyle = COLORS.teal;
      ctx.beginPath(); ctx.moveTo(i.sx, i.sy); ctx.lineTo(i.x, i.y); ctx.stroke();
      ctx.strokeStyle = COLORS.teal;
      ctx.strokeRect(i.tx - 3, i.ty - 3, 6, 6);
    }
    for (const b of this.blasts) {
      const r = b.ground ? b.max * (1 - b.t / BLAST_TICKS) : this.blastRadius(b);
      ctx.fillStyle = b.ground ? 'rgba(255,93,143,0.5)' : 'rgba(255,179,71,0.55)';
      ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(0, r), 0, Math.PI * 2); ctx.fill();
    }
    for (const c of this.cities) {
      ctx.fillStyle = c.alive ? COLORS.violet : '#3a2a55';
      if (c.alive) {
        ctx.fillRect(c.x - 16, GROUND_Y - 22, 10, 22);
        ctx.fillRect(c.x - 5, GROUND_Y - 32, 12, 32);
        ctx.fillRect(c.x + 8, GROUND_Y - 16, 9, 16);
      } else ctx.fillRect(c.x - 16, GROUND_Y - 5, 33, 5);
    }
    for (const b of this.batteries) {
      ctx.fillStyle = b.alive ? COLORS.teal : '#3a2a55';
      ctx.beginPath();
      ctx.moveTo(b.x - 18, GROUND_Y); ctx.lineTo(b.x, GROUND_Y - 22); ctx.lineTo(b.x + 18, GROUND_Y); ctx.fill();
      if (b.alive) text(ctx, String(b.ammo), b.x, GROUND_Y + 14, { size: 13, color: COLORS.ink, align: 'center' });
    }
    // crosshair / launcher
    const c = this.cursor;
    ctx.strokeStyle = COLORS.amber;
    ctx.beginPath();
    ctx.moveTo(c.x - 9, c.y); ctx.lineTo(c.x + 9, c.y); ctx.moveTo(c.x, c.y - 9); ctx.lineTo(c.x, c.y + 9);
    ctx.stroke();
    if (this.flipped && this.state === 'playing') {
      ctx.fillStyle = COLORS.pink;
      ctx.beginPath(); ctx.moveTo(this.launcherX - 10, 0); ctx.lineTo(this.launcherX + 10, 0); ctx.lineTo(this.launcherX, 14); ctx.fill();
      ctx.strokeStyle = 'rgba(255,93,143,0.35)';
      ctx.beginPath(); ctx.moveTo(this.launcherX, 0); ctx.lineTo(c.x, c.y); ctx.stroke();
      if (this.launchCool > 0) text(ctx, 'Reloading…', W / 2, 24, { size: 13, color: COLORS.dim, align: 'center' });
    }
    if (this.message) text(ctx, this.message, W / 2, 80, { size: 16, color: COLORS.amber, align: 'center' });
  }
}

export const meta = {
  id: 'missile',
  title: 'Missile Command',
  tagline: 'Defend the skyline — or launch the attack on it.',
  accent: '#ff4d4d',
  Game: MissileGame,
  rules: {
    normal: 'Enemy missiles fall on your six cities and three batteries. Click the sky to fire an interceptor from the nearest battery; it flies to that spot and explodes. Anything inside the blast is destroyed, so lead your targets. Each battery holds 5 shots. Survive 5 waves; one city is repaired between waves; later waves can split mid-flight.',
    flipped: 'You launch the attack. Slide the launcher along the top edge (move the pointer to the top strip, or J / L), then click a target on the skyline — a city or battery — or press Space at the crosshair. You have a limited stock of missiles and a reload between shots (11 missiles in wave 1, +2 per wave, faster each wave). The computer defends with real interceptors: finite speed, 5 shots per battery, a reload per battery, and a reaction delay that shrinks each wave. Destroy batteries to thin the defence, then destroy all 6 cities. If any city survives 5 waves, the computer wins.',
  },
  controls: {
    normal: [['Mouse click', 'Fire interceptor'], ['Arrow keys + Space', 'Move crosshair / fire']],
    flipped: [['Pointer to top strip or J / L', 'Slide launcher'], ['Click skyline / Space', 'Launch missile at target'], ['Arrow keys', 'Move crosshair']],
  },
};
