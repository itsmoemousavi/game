/**
 * Math that gives exactly the same answer on every device. Multiplayer runs the same match on every
 * phone, and browsers are free to round Math.sin, cos, atan2 and hypot differently, which would slowly
 * make matches drift apart. These use only + - * / and sqrt, which every browser computes identically.
 * The simulation must use these, never the Math versions.
 */
const PI = 3.141592653589793;
const TAU = 2 * PI;
export const dHypot = (x: number, y: number) => Math.sqrt(x * x + y * y);

/** Sine, accurate to about 1e-10. */
export function dSin(x: number): number {
  x -= TAU * Math.floor(x / TAU + 0.5); // now in [-pi, pi]
  if (x > PI / 2) x = PI - x;
  else if (x < -PI / 2) x = -PI - x; // now in [-pi/2, pi/2]
  const z = x * x;
  return x * (1 + z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880 + z * (-1 / 39916800 + z * (1 / 6227020800)))))));
}
export const dCos = (x: number) => dSin(x + PI / 2);

/** Arctangent of a number in [0, 1], accurate to about 1e-10. */
function atanUnit(t: number): number {
  // Halve the angle twice so the series converges fast: atan(t) = 2 atan(t / (1 + sqrt(1 + t^2))).
  const a = t / (1 + Math.sqrt(1 + t * t));
  const b = a / (1 + Math.sqrt(1 + a * a));
  const z = b * b;
  return 4 * b * (1 + z * (-1 / 3 + z * (1 / 5 + z * (-1 / 7 + z * (1 / 9 + z * (-1 / 11 + z * (1 / 13)))))));
}
export function dAtan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const r = ay <= ax ? atanUnit(ay / ax) : PI / 2 - atanUnit(ax / ay);
  const q = x >= 0 ? r : PI - r;
  return y >= 0 ? q : -q;
}

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const dist = (ax: number, ay: number, bx: number, by: number) => dHypot(ax - bx, ay - by);
export const distV = (a: Vec2, b: Vec2) => dHypot(a.x - b.x, a.y - b.y);
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function polylineLength(path: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distV(path[i - 1], path[i]);
  return total;
}

/** Point at distance `d` along a polyline (clamped to its ends). */
export function pointAlong(path: Vec2[], d: number): Vec2 {
  if (d <= 0) return { ...path[0] };
  for (let i = 1; i < path.length; i++) {
    const seg = distV(path[i - 1], path[i]);
    if (d <= seg) {
      const t = d / seg;
      return {
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
        y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
      };
    }
    d -= seg;
  }
  return { ...path[path.length - 1] };
}

/** Distance along the polyline of the closest point to `p`. */
export function projectOnPolyline(path: Vec2[], p: Vec2): number {
  let best = Infinity;
  let bestD = 0;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1);
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const d = dist(p.x, p.y, cx, cy);
    const segLen = Math.sqrt(len2);
    if (d < best) {
      best = d;
      bestD = acc + segLen * t;
    }
    acc += segLen;
  }
  return bestD;
}

/** Distance from point p to segment ab. */
export function distToSegment(px: number, py: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : clamp(((px - a.x) * abx + (py - a.y) * aby) / len2, 0, 1);
  return dist(px, py, a.x + abx * t, a.y + aby * t);
}
