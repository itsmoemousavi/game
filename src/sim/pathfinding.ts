import { GameMap, lineClear } from './map';
import { Vec2 } from './math';

const SQRT2 = Math.SQRT2;

/** Binary min-heap of cell indices keyed by an external score array. */
class Heap {
  items: number[] = [];
  constructor(private score: Float32Array) {}
  push(i: number) {
    const a = this.items;
    a.push(i);
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[n]]) break;
      [a[p], a[n]] = [a[n], a[p]];
      n = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        const r = l + 1;
        let m = n;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n], a[m]];
        n = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

/** Closest walkable cell (spiral search) to a world position. */
export function nearestWalkableCell(map: GameMap, x: number, y: number): number {
  const g = map.grid;
  const cx0 = Math.min(g - 1, Math.max(0, Math.floor(x / map.cell)));
  const cy0 = Math.min(g - 1, Math.max(0, Math.floor(y / map.cell)));
  if (map.walkable[cy0 * g + cx0]) return cy0 * g + cx0;
  for (let r = 1; r < g; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = cx0 + dx;
        const cy = cy0 + dy;
        if (cx < 0 || cy < 0 || cx >= g || cy >= g) continue;
        if (!map.walkable[cy * g + cx]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = cy * g + cx;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

export function cellCenter(map: GameMap, idx: number): Vec2 {
  return { x: ((idx % map.grid) + 0.5) * map.cell, y: (Math.floor(idx / map.grid) + 0.5) * map.cell };
}

/**
 * 8-directional A* over the walk grid, followed by line-of-sight smoothing.
 * Returns world-space waypoints (excluding the start), or null if unreachable.
 */
export function findPath(map: GameMap, from: Vec2, to: Vec2, radius = 0.6): Vec2[] | null {
  const g = map.grid;
  const start = nearestWalkableCell(map, from.x, from.y);
  const goal = nearestWalkableCell(map, to.x, to.y);
  if (start < 0 || goal < 0) return null;
  const n = g * g;
  const gScore = new Float32Array(n).fill(Infinity);
  const fScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gx = goal % g;
  const gy = Math.floor(goal / g);
  const h = (i: number) => {
    const dx = Math.abs((i % g) - gx);
    const dy = Math.abs(Math.floor(i / g) - gy);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  };
  const open = new Heap(fScore);
  gScore[start] = 0;
  fScore[start] = h(start);
  open.push(start);
  let found = false;
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % g;
    const cy = Math.floor(cur / g);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= g || ny >= g) continue;
        const ni = ny * g + nx;
        if (!map.walkable[ni] || closed[ni]) continue;
        // No corner cutting.
        if (dx !== 0 && dy !== 0 && (!map.walkable[cy * g + nx] || !map.walkable[ny * g + cx])) continue;
        const tentative = gScore[cur] + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
        if (tentative < gScore[ni]) {
          came[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + h(ni);
          open.push(ni);
        }
      }
    }
  }
  if (!found) return null;

  const cells: Vec2[] = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(cellCenter(map, c));
  cells.reverse();
  cells[0] = { x: from.x, y: from.y };
  const end = map.walkable[Math.floor(to.y / map.cell) * g + Math.floor(to.x / map.cell)] ? to : cells[cells.length - 1];
  cells[cells.length - 1] = { x: end.x, y: end.y };

  // String-pull: keep only waypoints needed to stay in line of sight.
  const out: Vec2[] = [];
  let anchor = cells[0];
  let i = 1;
  while (i < cells.length) {
    let j = i;
    while (j + 1 < cells.length && lineClear(map, anchor, cells[j + 1], radius)) j++;
    out.push(cells[j]);
    anchor = cells[j];
    i = j + 1;
  }
  return out;
}
