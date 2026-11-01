export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
export const distV = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
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
