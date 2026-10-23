import { createInputState } from '../js/core/input.js';

export function makeInput({ keys = [], pressed = [], mouse = {} } = {}) {
  const i = createInputState();
  keys.forEach((k) => i.keys.add(k));
  pressed.forEach((k) => i.pressed.add(k));
  Object.assign(i.mouse, mouse);
  return i;
}
export const idle = () => makeInput();

// A canvas context stand-in: every method is a no-op, gradients are inert.
export function fakeCtx() {
  const calls = { n: 0 };
  const target = { canvas: { width: 640, height: 480 }, calls };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      return (...a) => { calls.n++; return p === 'createLinearGradient' || p === 'createRadialGradient' ? { addColorStop() {} } : p === 'measureText' ? { width: 10 } : undefined; };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

// Run `ticks` fixed steps, calling policy(game, tick) -> input each tick.
export function run(game, ticks, policy = idle) {
  for (let t = 0; t < ticks && game.state !== 'over'; t++) game.step(typeof policy === 'function' ? policy(game, t) : policy);
  return game;
}

export function started(Game, opts = {}) {
  const g = new Game({ seed: 1, ...opts });
  g.start();
  return g;
}
