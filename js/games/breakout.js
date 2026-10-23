import { Game } from '../core/game.js';
import { COLORS, circleRect, clamp, text } from '../core/util.js';

export const PADDLE_Y = 448;
export const PADDLE_H = 12;
export const BALL_R = 7;
export const COLS = 10;
export const BRICK_W = 58;
export const BRICK_H = 18;
const BRICK_GAP = 4;
const BRICK_X0 = 12;
const BRICK_Y0 = 56;
export const SHIELD_Y = 330;
export const SHIELD_H = 10;
export const LEVELS_TO_WIN = 3;
export const SHIELD_MAX = 100;
export const SHIELD_COST = 25; // a deflection uses a quarter of the charge
export const SHIELD_REGEN = 0.3; // per tick
const ROW_COLORS = [COLORS.pink, COLORS.amber, COLORS.lime, COLORS.teal, COLORS.violet, COLORS.ink, COLORS.dim];

export class BreakoutGame extends Game {
  constructor(opts) {
    super(opts);
    this.paddle = { x: 270, w: 100 };
    this.shield = { x: 270, w: 110, charge: SHIELD_MAX }; // flipped only: the human's rationed deflector
    this.ball = { x: 320, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, speed: 3.6 };
    this.lives = 3; // normal: your lives. flipped: the computer paddle's lives
    this.broken = 0;
    this.served = false;
    this.serveTimer = 0;
    this.ai = { target: 320, timer: 0, aim: 0 };
    this.buildBricks(1);
    this.resetBall();
  }

  buildBricks(level) {
    const rows = 4 + level; // 5, 6, 7 rows over the levels
    this.bricks = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        this.bricks.push({
          x: BRICK_X0 + c * (BRICK_W + BRICK_GAP),
          y: BRICK_Y0 + r * (BRICK_H + BRICK_GAP),
          row: r,
          hp: level >= 2 && r === 0 ? 2 : 1,
          alive: true,
        });
      }
    }
  }

  get paddleSpeed() {
    return this.flipped ? Math.min(7, 2.8 + 0.35 * (this.level - 1)) : 8;
  }
  get baseSpeed() {
    return this.flipped ? 3.8 : 3.6 + 0.5 * (this.level - 1);
  }
  get aliveBricks() {
    return this.bricks.filter((b) => b.alive).length;
  }

  // Put the ball back on the paddle and wait for a serve.
  resetBall() {
    const b = this.ball;
    b.x = this.paddle.x + this.paddle.w / 2;
    b.y = PADDLE_Y - BALL_R - 1;
    b.vx = b.vy = 0;
    b.speed = this.baseSpeed;
    this.served = false;
    this.serveTimer = this.flipped ? 45 : 150;
  }

  serve() {
    const b = this.ball;
    b.speed = this.baseSpeed + Math.min(2.2, this.broken * 0.03);
    const ang = this.rng.range(-0.5, 0.5);
    b.vx = Math.sin(ang) * b.speed;
    b.vy = -Math.cos(ang) * b.speed;
    this.served = true;
  }

  update(input) {
    this.level = this.flipped ? 1 + Math.floor(this.broken / 10) : this.level;
    const prevX = this.paddle.x;
    if (this.flipped) {
      this.moveShield(input);
      this.shield.charge = Math.min(SHIELD_MAX, this.shield.charge + SHIELD_REGEN);
      this.moveAiPaddle();
    } else {
      this.moveHumanPaddle(input);
    }
    if (!this.served) {
      this.ball.x = this.paddle.x + this.paddle.w / 2;
      this.ball.y = PADDLE_Y - BALL_R - 1;
      const wants = !this.flipped && (input.pressed.has('Space') || input.pressed.has('ArrowUp') || input.mouse.clicked);
      if (wants || --this.serveTimer <= 0) this.serve();
      return;
    }
    this.moveBall(prevX);
  }

  moveHumanPaddle(input) {
    const p = this.paddle;
    if (input.mouse.moved && input.mouse.inside) p.x = input.mouse.x - p.w / 2;
    if (input.keys.has('ArrowLeft')) p.x -= this.paddleSpeed;
    if (input.keys.has('ArrowRight')) p.x += this.paddleSpeed;
    p.x = clamp(p.x, 0, 640 - p.w);
  }

  moveShield(input) {
    const s = this.shield;
    if (input.mouse.moved && input.mouse.inside) s.x = input.mouse.x - s.w / 2;
    if (input.keys.has('ArrowLeft')) s.x -= 7;
    if (input.keys.has('ArrowRight')) s.x += 7;
    s.x = clamp(s.x, 0, 640 - s.w);
  }

  // Computer paddle: reads the ball, predicts the wall bounces, limited speed and aim.
  moveAiPaddle() {
    const ai = this.ai, b = this.ball, p = this.paddle;
    if (--ai.timer <= 0) {
      ai.timer = 6;
      if (this.served && b.vy > 0) {
        const err = Math.max(8, 70 - 9 * (this.level - 1));
        ai.target = this.predictX(b) + ai.aim + this.rng.range(-err, err);
      } else if (this.served) {
        ai.target = b.x; // drift beneath the ball while it travels up
      }
    }
    const diff = ai.target - (p.x + p.w / 2);
    p.x = clamp(p.x + clamp(diff, -this.paddleSpeed, this.paddleSpeed), 0, 640 - p.w);
  }

  predictX(b) {
    const t = (PADDLE_Y - BALL_R - b.y) / b.vy;
    let x = b.x + b.vx * t;
    const span = 640 - 2 * BALL_R;
    x = (((x - BALL_R) % (2 * span)) + 2 * span) % (2 * span);
    if (x > span) x = 2 * span - x;
    return x + BALL_R;
  }

  moveBall() {
    const b = this.ball;
    const steps = Math.ceil(Math.hypot(b.vx, b.vy) / 2);
    for (let i = 0; i < steps; i++) {
      b.x += b.vx / steps;
      b.y += b.vy / steps;
      if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); }
      if (b.x > 640 - BALL_R) { b.x = 640 - BALL_R; b.vx = -Math.abs(b.vx); }
      if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); }

      if (this.hitBrick()) {
        if (this.state !== 'playing') return;
      }
      // shield: only deflects balls travelling upwards, sending them back down
      if (this.flipped && b.vy < 0 && this.shield.charge >= SHIELD_COST && circleRect(b.x, b.y, BALL_R, this.shield.x, SHIELD_Y, this.shield.w, SHIELD_H)) {
        this.deflect(this.shield, 1);
        this.shield.charge -= SHIELD_COST;
        b.y = SHIELD_Y + SHIELD_H + BALL_R;
        this.ai.aim = this.rng.range(-30, 30);
      }
      const p = this.paddle;
      if (b.vy > 0 && circleRect(b.x, b.y, BALL_R, p.x, PADDLE_Y, p.w, PADDLE_H)) {
        this.deflect(p, -1);
        b.y = PADDLE_Y - BALL_R;
      }
      if (b.y > 480 + BALL_R) return this.loseBall();
    }
  }

  // rebound angle depends on where the ball lands on the bar (dirY: -1 up, 1 down)
  deflect(bar, dirY) {
    const b = this.ball;
    const rel = clamp((b.x - (bar.x + bar.w / 2)) / (bar.w / 2), -1, 1);
    const ang = rel * 1.05;
    b.vx = Math.sin(ang) * b.speed;
    b.vy = Math.cos(ang) * b.speed * dirY;
  }

  hitBrick() {
    const b = this.ball;
    for (const br of this.bricks) {
      if (!br.alive || !circleRect(b.x, b.y, BALL_R, br.x, br.y, BRICK_W, BRICK_H)) continue;
      const dx = (b.x - (br.x + BRICK_W / 2)) / (BRICK_W / 2);
      const dy = (b.y - (br.y + BRICK_H / 2)) / (BRICK_H / 2);
      if (Math.abs(dx) > Math.abs(dy)) b.vx = Math.sign(dx) * Math.abs(b.vx);
      else b.vy = Math.sign(dy) * Math.abs(b.vy);
      br.hp--;
      if (br.hp <= 0) {
        br.alive = false;
        this.broken++;
        this.score += 10 * (this.bricks.length > 0 ? Math.max(1, 6 - br.row) : 1);
        b.speed = Math.min(this.baseSpeed + 2.2, b.speed + 0.03);
        const mag = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / mag) * b.speed;
        b.vy = (b.vy / mag) * b.speed;
        if (this.aliveBricks === 0) this.cleared();
      }
      return true;
    }
    return false;
  }

  cleared() {
    if (this.flipped) {
      this.finish('lose', 'The computer cleared every brick.');
    } else if (this.level >= LEVELS_TO_WIN) {
      this.finish('win', `You cleared all ${LEVELS_TO_WIN} levels!`);
    } else {
      this.level++;
      this.buildBricks(this.level);
      this.resetBall();
      this.say(`Level ${this.level}`);
    }
  }

  loseBall() {
    this.lives--;
    if (this.lives <= 0) {
      return this.finish(this.flipped ? 'win' : 'lose',
        this.flipped ? 'You got the ball past the computer three times!' : 'Out of lives.');
    }
    this.say(this.flipped ? 'Computer lost a life!' : `Lives left: ${this.lives}`);
    this.resetBall();
  }

  hud() {
    const extra = this.flipped ? [{ label: 'Deflections', value: Math.floor(this.shield.charge / SHIELD_COST) }] : [];
    return [
      ...extra,
      { label: 'Score', value: this.score },
      { label: this.flipped ? 'Computer lives' : 'Lives', value: this.lives },
      { label: 'Level', value: this.flipped ? this.level : `${this.level}/${LEVELS_TO_WIN}` },
      { label: 'Bricks', value: this.aliveBricks },
    ];
  }

  draw(ctx) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.W, this.H);
    for (const br of this.bricks) {
      if (!br.alive) continue;
      ctx.fillStyle = ROW_COLORS[br.row % ROW_COLORS.length];
      ctx.globalAlpha = br.hp > 1 ? 1 : 0.85;
      ctx.fillRect(br.x, br.y, BRICK_W, BRICK_H);
      if (br.hp > 1) {
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 2;
        ctx.strokeRect(br.x + 1, br.y + 1, BRICK_W - 2, BRICK_H - 2);
      }
      ctx.globalAlpha = 1;
    }
    if (this.flipped) {
      const live = this.shield.charge >= SHIELD_COST;
      ctx.fillStyle = live ? COLORS.teal : '#5a4a77';
      ctx.fillRect(this.shield.x, SHIELD_Y, this.shield.w, SHIELD_H);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(20, 466, 160, 8);
      ctx.fillStyle = live ? COLORS.teal : COLORS.red;
      ctx.fillRect(20, 466, 160 * (this.shield.charge / SHIELD_MAX), 8);
      text(ctx, 'Deflector charge', 20, 456, { size: 12, color: COLORS.dim });
      text(ctx, '▼', this.shield.x + this.shield.w / 2, SHIELD_Y + 22, { size: 12, color: COLORS.teal, align: 'center' });
    }
    ctx.fillStyle = this.flipped ? COLORS.pink : COLORS.teal;
    ctx.fillRect(this.paddle.x, PADDLE_Y, this.paddle.w, PADDLE_H);
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    if (this.message) text(ctx, this.message, 320, 400, { size: 16, color: COLORS.amber, align: 'center' });
    if (!this.served && this.state === 'playing' && !this.flipped) {
      text(ctx, 'Space / click to serve', 320, 380, { size: 14, color: COLORS.dim, align: 'center' });
    }
  }
}

export const meta = {
  id: 'breakout',
  title: 'Breakout',
  tagline: 'Smash the wall — or defend it with a deflector.',
  accent: '#ff5d8f',
  Game: BreakoutGame,
  rules: {
    normal: 'Move the paddle to keep the ball alive and break every brick. 3 lives, 3 levels (more rows each level, top row takes two hits). The ball speeds up as bricks fall.',
    flipped: 'The computer plays the paddle and tries to clear the wall. You control the wall’s deflector (teal bar): when the ball travels upward and touches it, it is knocked back down at an angle set by where it lands, so you can steer it past the computer’s paddle. Make the computer lose 3 lives before it clears the bricks. The computer paddle speeds up and aims better every 10 bricks it breaks.',
  },
  controls: {
    normal: [['Left / Right or A / D', 'Move paddle'], ['Mouse', 'Paddle follows pointer'], ['Space / click', 'Serve (auto after 2.5s)']],
    flipped: [['Left / Right or A / D', 'Move deflector'], ['Mouse', 'Deflector follows pointer']],
  },
};
