import { createRng } from './rng.js';
import { W, H } from './util.js';

// Base class every cabinet game extends.
//
// Contract used by the cabinet shell (and by Imitation / the Wave 2 game later):
//   new GameClass({ mode: 'normal' | 'flipped', seed })
//   game.state    'ready' | 'playing' | 'over'
//   game.start()  leave 'ready'
//   game.step(input)  advance ONE fixed tick (1/60 s)
//   game.draw(ctx)    render (never mutates game state)
//   game.hud()        [{label, value}] for the DOM status bar
//   game.result       null | { outcome: 'win' | 'lose', message }  (outcome is for the HUMAN)
//
// Role semantics: "normal" = human plays the classic role; "flipped" = the
// human takes the opposing role and the computer plays the classic role under
// exactly the same rules.
export class Game {
  constructor({ mode = 'normal', seed = Date.now() } = {}) {
    this.mode = mode === 'flipped' ? 'flipped' : 'normal';
    this.flipped = this.mode === 'flipped';
    this.rng = createRng(seed);
    this.W = W;
    this.H = H;
    this.state = 'ready';
    this.score = 0;
    this.level = 1;
    this.tick = 0;
    this.result = null;
    this.message = '';
    this.messageTimer = 0;
  }

  start() {
    if (this.state === 'ready') this.state = 'playing';
  }

  step(input) {
    if (this.state === 'ready') {
      if (input.pressed.has('Space') || input.pressed.has('Enter') || input.mouse.clicked) this.start();
      return;
    }
    if (this.state !== 'playing') return;
    this.tick++;
    if (this.messageTimer > 0 && --this.messageTimer === 0) this.message = '';
    this.update(input);
  }

  update() {}
  draw() {}
  hud() {
    return [{ label: 'Score', value: this.score }, { label: 'Level', value: this.level }];
  }

  say(msg, ticks = 120) {
    this.message = msg;
    this.messageTimer = ticks;
  }

  finish(outcome, message) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.result = { outcome, message };
    this.message = '';
  }
}
