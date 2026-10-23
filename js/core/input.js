// Keyboard + pointer input, polled once per fixed simulation tick.
// Games only ever read: keys (held), pressed (new this tick), mouse.
const ALIASES = {
  KeyW: 'ArrowUp',
  KeyS: 'ArrowDown',
  KeyA: 'ArrowLeft',
  KeyD: 'ArrowRight',
};
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function createInputState() {
  return {
    keys: new Set(),
    pressed: new Set(),
    mouse: { x: 0, y: 0, inside: false, down: false, clicked: false, moved: false },
  };
}

// Normalises WASD onto the arrow keys so games handle one set of names.
export const held = (input, code) => input.keys.has(code);
export const hit = (input, code) => input.pressed.has(code);

export class Input {
  constructor() {
    Object.assign(this, createInputState());
    this.canvas = null;
  }

  press(code) {
    const c = ALIASES[code] || code;
    if (!this.keys.has(c)) this.pressed.add(c);
    this.keys.add(c);
    // Allow auto-repeat to count as presses for cursor-style movement.
  }

  release(code) {
    this.keys.delete(ALIASES[code] || code);
  }

  releaseAll() {
    this.keys.clear();
    this.mouse.down = false;
  }

  attach(canvas, target = window) {
    this.canvas = canvas;
    target.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      const code = ALIASES[e.code] || e.code;
      // Let focused buttons keep Space/Enter; otherwise the game owns arrows/space.
      if (GAME_KEYS.has(code) && tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'SELECT') e.preventDefault();
      if (tag === 'BUTTON' && code === 'Space') return;
      if (e.repeat) this.pressed.add(code);
      this.press(e.code);
    });
    target.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('blur', () => this.releaseAll());

    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
      this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
      this.mouse.moved = true;
    };
    canvas.addEventListener('pointermove', (e) => {
      toCanvas(e);
      this.mouse.inside = true;
    });
    canvas.addEventListener('pointerleave', () => {
      this.mouse.inside = false;
    });
    canvas.addEventListener('pointerdown', (e) => {
      toCanvas(e);
      this.mouse.inside = true;
      this.mouse.down = true;
      this.mouse.clicked = true;
      if (e.pointerType !== 'mouse') this.mouse.inside = false; // touch has no hover cursor
      canvas.focus({ preventScroll: true });
    });
    window.addEventListener('pointerup', () => {
      this.mouse.down = false;
    });
  }

  // Called by the loop after every simulation tick.
  endTick() {
    this.pressed.clear();
    this.mouse.clicked = false;
    this.mouse.moved = false;
  }
}
