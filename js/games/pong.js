import { Game } from '../core/game.js';
import { COLORS, clamp, text } from '../core/util.js';

export const WIN_SCORE = 7;
export const PADDLE_W = 12;
export const PADDLE_H = 80;
export const BALL_R = 7;
const LEFT_X = 24;
const RIGHT_X = 640 - 24 - PADDLE_W;
const HUMAN_SPEED = 6;
export const FUEL_MAX = 100;

export class PongGame extends Game {
  constructor(opts) {
    super(opts);
    this.humanPts = 0;
    this.cpuPts = 0;
    this.left = { y: (480 - PADDLE_H) / 2 };
    this.right = { y: (480 - PADDLE_H) / 2 };
    this.ai = { target: 240, timer: 0, err: 0 };
    this.fuel = FUEL_MAX; // flipped: the human steers the ball with a limited fuel meter
    this.exhausted = false;
    this.returns = 0; // flipped: paddle returns in the current rally
    this.serveTimer = 60;
    this.serveDir = 1;
    this.ball = { x: 320, y: 240, vx: 0, vy: 0, speed: 4 };
    this.resetBall(1);
  }

  get aiMaxSpeed() {
    return Math.min(5.2, 1.7 + 0.55 * (this.level - 1));
  }
  get aiError() {
    return Math.max(8, 70 - 10 * (this.level - 1));
  }
  // Flipped: how many times the paddle may return the ball before the defender takes the point.
  get returnLimit() {
    return Math.max(3, 6 - (this.level - 1));
  }

  resetBall(dir) {
    const b = this.ball;
    b.x = 320;
    b.y = 240 + this.rng.range(-80, 80);
    b.speed = 4 + 0.25 * (this.level - 1);
    const ang = this.rng.range(-0.45, 0.45);
    b.vx = Math.cos(ang) * b.speed * dir;
    b.vy = Math.sin(ang) * b.speed;
    this.serveTimer = 50;
    this.returns = 0;
  }

  update(input) {
    this.moveHumanPaddle(input);
    this.moveAiPaddle();

    if (this.serveTimer > 0) {
      this.serveTimer--;
      return;
    }
    this.stepBall();
  }

  // Normal: the human owns the left paddle. Flipped: no human paddle at all —
  // the human owns the ball's curve instead.
  moveHumanPaddle(input) {
    if (this.flipped) {
      this.steerBall(input);
      return;
    }
    const p = this.left;
    if (input.mouse.moved && input.mouse.inside) p.y = input.mouse.y - PADDLE_H / 2;
    if (input.keys.has('ArrowUp')) p.y -= HUMAN_SPEED;
    if (input.keys.has('ArrowDown')) p.y += HUMAN_SPEED;
    p.y = clamp(p.y, 0, 480 - PADDLE_H);
  }

  steerBall(input) {
    const up = input.keys.has('ArrowUp'), down = input.keys.has('ArrowDown');
    const want = (down ? 1 : 0) - (up ? 1 : 0);
    if (this.exhausted && this.fuel >= 25) this.exhausted = false;
    if (want !== 0 && !this.exhausted && this.serveTimer === 0) {
      this.fuel = Math.max(0, this.fuel - 1.2);
      if (this.fuel === 0) this.exhausted = true;
      const b = this.ball;
      b.vy = clamp(b.vy + want * 0.22, -b.speed * 0.85, b.speed * 0.85);
      b.vx = Math.sign(b.vx || 1) * Math.sqrt(Math.max(1, b.speed ** 2 - b.vy ** 2)); // constant speed
    } else {
      this.fuel = Math.min(FUEL_MAX, this.fuel + 0.5);
    }
  }

  // Computer paddle: sees only the ball, has a speed cap and aiming error.
  moveAiPaddle() {
    const ai = this.ai;
    const b = this.ball;
    const p = this.right;
    if (--ai.timer <= 0) {
      ai.timer = 8; // reaction delay
      if (b.vx > 0) {
        ai.target = this.predictY(b) + this.rng.range(-1, 1) * this.aiError;
      } else {
        ai.target = 240 + this.rng.range(-30, 30);
      }
    }
    const center = p.y + PADDLE_H / 2;
    const diff = ai.target - center;
    p.y += clamp(diff, -this.aiMaxSpeed, this.aiMaxSpeed);
    p.y = clamp(p.y, 0, 480 - PADDLE_H);
  }

  // Where the ball will arrive on the right side, accounting for wall bounces.
  predictY(b) {
    if (b.vx <= 0) return 240;
    const t = (RIGHT_X - BALL_R - b.x) / b.vx;
    let y = b.y + b.vy * t;
    const span = 480 - 2 * BALL_R;
    y = (((y - BALL_R) % (2 * span)) + 2 * span) % (2 * span);
    if (y > span) y = 2 * span - y;
    return y + BALL_R;
  }

  stepBall() {
    const b = this.ball;
    // sub-steps stop the ball tunnelling through a paddle at high speed
    const steps = Math.ceil(Math.hypot(b.vx, b.vy) / 3);
    for (let i = 0; i < steps; i++) {
      b.x += b.vx / steps;
      b.y += b.vy / steps;
      if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); }
      if (b.y > 480 - BALL_R) { b.y = 480 - BALL_R; b.vy = -Math.abs(b.vy); }

      if (b.vx > 0 && b.x + BALL_R >= RIGHT_X && b.x - BALL_R <= RIGHT_X + PADDLE_W &&
          b.y + BALL_R >= this.right.y && b.y - BALL_R <= this.right.y + PADDLE_H) {
        this.bounceOff(this.right, -1);
        if (this.flipped) {
          this.returns++;
          if (this.returns >= this.returnLimit) return this.pointTo('cpu', 'defended');
        }
      } else if (b.vx < 0 && !this.flipped && b.x - BALL_R <= LEFT_X + PADDLE_W && b.x + BALL_R >= LEFT_X &&
          b.y + BALL_R >= this.left.y && b.y - BALL_R <= this.left.y + PADDLE_H) {
        this.bounceOff(this.left, 1);
      }
      if (b.vx < 0 && b.x - BALL_R <= 0) {
        if (this.flipped) { // the human's own back wall: the ball just rebounds
          b.x = BALL_R;
          b.vx = Math.abs(b.vx);
        } else {
          return this.pointTo('cpu', 'missed');
        }
      }
      if (b.x + BALL_R >= 640 && b.vx > 0) return this.pointTo('human', 'scored');
    }
  }

  bounceOff(paddle, dirX) {
    const b = this.ball;
    const rel = clamp((b.y - (paddle.y + PADDLE_H / 2)) / (PADDLE_H / 2), -1, 1);
    b.speed = Math.min(9, b.speed + 0.3);
    const ang = rel * 1.0 + this.rng.range(-0.06, 0.06); // up to ~57 degrees, tiny jitter so rallies can't loop forever
    b.vx = Math.cos(ang) * b.speed * dirX;
    b.vy = Math.sin(ang) * b.speed;
    b.x = dirX > 0 ? LEFT_X + PADDLE_W + BALL_R : RIGHT_X - BALL_R;
  }

  pointTo(who, how) {
    if (who === 'human') {
      this.humanPts++;
      this.level = 1 + this.humanPts; // each point you win makes the computer sharper
      this.say(this.flipped ? 'Got past the paddle!' : 'Point!');
    } else {
      this.cpuPts++;
      this.say(how === 'defended' ? 'Paddle held the rally — defender’s point.' : 'Computer scores.');
    }
    this.score = this.humanPts;
    if (this.humanPts >= WIN_SCORE) return this.finish('win', `You win ${this.humanPts}–${this.cpuPts}!`);
    if (this.cpuPts >= WIN_SCORE) return this.finish('lose', `The computer wins ${this.cpuPts}–${this.humanPts}.`);
    // Serve towards whoever just lost the point (flipped: always at the defender).
    this.resetBall(this.flipped || who === 'human' ? 1 : -1);
  }

  hud() {
    const base = [
      { label: this.flipped ? 'You (ball)' : 'You', value: this.humanPts },
      { label: 'Computer', value: this.cpuPts },
      { label: 'Level', value: this.level },
    ];
    if (this.flipped) base.push({ label: 'Returns left', value: Math.max(0, this.returnLimit - this.returns) });
    return base;
  }

  draw(ctx) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let y = 8; y < 480; y += 28) ctx.fillRect(318, y, 4, 14);
    text(ctx, String(this.humanPts), 250, 40, { size: 40, color: COLORS.teal, align: 'center' });
    text(ctx, String(this.cpuPts), 390, 40, { size: 40, color: COLORS.pink, align: 'center' });

    ctx.fillStyle = COLORS.pink;
    ctx.fillRect(RIGHT_X, this.right.y, PADDLE_W, PADDLE_H);
    if (!this.flipped) {
      ctx.fillStyle = COLORS.teal;
      ctx.fillRect(LEFT_X, this.left.y, PADDLE_W, PADDLE_H);
    } else {
      ctx.fillStyle = COLORS.teal;
      ctx.fillRect(0, 0, 4, 480); // the human’s rebound wall
    }
    const b = this.ball;
    ctx.fillStyle = this.flipped ? COLORS.teal : COLORS.ink;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    if (this.flipped) {
      ctx.strokeStyle = COLORS.teal;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(20, 456, 160, 10);
      ctx.fillStyle = this.exhausted ? COLORS.red : COLORS.amber;
      ctx.fillRect(20, 456, 160 * (this.fuel / FUEL_MAX), 10);
      text(ctx, this.exhausted ? 'Recharging…' : 'Steer fuel', 20, 444, { size: 12, color: COLORS.dim });
    }
    if (this.message) text(ctx, this.message, 320, 440, { size: 16, color: COLORS.amber, align: 'center' });
  }
}

export const meta = {
  id: 'pong',
  title: 'Pong',
  tagline: 'The original rally — or play the ball itself.',
  accent: '#3de0c2',
  Game: PongGame,
  rules: {
    normal: 'Classic Pong: you are the left paddle against the computer. First to 7 wins. The ball speeds up with every hit, and the computer paddle gets faster and more accurate each time you score.',
    flipped: 'You are the BALL. There is no paddle for you: the left edge is a wall and the computer defends the right side. Steer the ball up or down (limited fuel that recharges) to slip past its paddle. If the paddle returns the ball too many times in one rally (starts at 5, shrinks to 3), the defender takes the point. First to 7. The paddle gets quicker every time you score.',
  },
  controls: {
    normal: [['Up / Down or W / S', 'Move paddle'], ['Mouse', 'Paddle follows pointer']],
    flipped: [['Up / Down or W / S', 'Curve the ball (uses fuel)']],
  },
};
