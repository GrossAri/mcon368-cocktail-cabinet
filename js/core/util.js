export const W = 640;
export const H = 480;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
}

// Smallest signed difference between two angles (radians), in (-PI, PI].
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export const COLORS = {
  bg: '#12091f',
  panel: '#1d1033',
  ink: '#fdf4e3',
  dim: '#8f7fae',
  amber: '#ffb347',
  pink: '#ff5d8f',
  teal: '#3de0c2',
  lime: '#b8f04a',
  violet: '#9b7bff',
  red: '#ff4d4d',
};

export function text(ctx, str, x, y, { size = 16, color = COLORS.ink, align = 'left', weight = 'bold' } = {}) {
  ctx.font = `${weight} ${size}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}
