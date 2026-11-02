import { DAY_SECONDS, NIGHT_SECONDS, TRUE_SIGHT_RADIUS, Team } from './constants';
import type { House } from './map';
import type { Unit, World } from './world';

/**
 * Fog of war. Each team has a coarse grid (same cells as the walk grid) of what it
 * can currently see. Vision comes from the team's living heroes, creeps and buildings
 * and shrinks at night. Enemy units outside it are hidden from players and bots.
 *
 * Trees (wall cells) block line of sight: a cell is visible only if the straight line
 * from the viewer to it crosses no tree. The first trees along a line are lit, so you
 * see the edge of the forest but not through it. Buildings don't block sight.
 *
 * High ground: every cell has a ground level (1 normal, 2 base plateau, 3 ward hill).
 *  - You can't see ground higher than you're standing on (no seeing up a cliff).
 *  - A tree's top is one level above its ground; trees only block you if their tops are
 *    at or above your level. So a ward on a hill (3) sees over normal forest (top 2)
 *    straight into the forest paths, but not over the trees around a base (top 3).
 */
/**
 * The Warden's house is always dark from outside (even through its doorway): a team sees
 * its floor only while one of its units is inside, and then sees all of it.
 */
/** Wards are always invisible; heroes are while an invisibility buff is active. */
export const isInvisible = (u: Unit) => !!u.ward || u.buffs.some((b) => b.invisible);

export class Vision {
  readonly grids: [Uint8Array, Uint8Array];
  /** Where each team can see invisible things (sentry wards, fountain). */
  readonly trueSight: [Uint8Array, Uint8Array];
  /** Per radius (in half-cells): offsets in range + the cells each sight line crosses. */
  private patterns = new Map<number, { dx: Int16Array; dy: Int16Array; lineStart: Int32Array; lineX: Int16Array; lineY: Int16Array }>();

  constructor(
    private grid: number,
    private cell: number,
    private walkable: Uint8Array,
    private height: Uint8Array,
    house?: House,
  ) {
    this.grids = [new Uint8Array(grid * grid), new Uint8Array(grid * grid)];
    this.trueSight = [new Uint8Array(grid * grid), new Uint8Array(grid * grid)];
    const inside: number[] = [];
    if (house) {
      this.house = house;
      for (let cy = 0; cy < grid; cy++)
        for (let cx = 0; cx < grid; cx++)
          if (Math.hypot((cx + 0.5) * cell - house.x, (cy + 0.5) * cell - house.y) < house.inner + cell * 0.5) inside.push(cy * grid + cx);
    }
    this.houseCells = Int32Array.from(inside);
  }

  private house: House | null = null;
  /** Cells of the house floor (hidden unless your team is inside). */
  private houseCells: Int32Array;

  /** Goes up every time the grids are recomputed (lets the 3D view skip rebuilding its fog texture). */
  version = 0;

  update(w: World) {
    this.version++;
    const night = isNight(w.time);
    for (const team of [0, 1] as Team[]) {
      const g = this.grids[team];
      const ts = this.trueSight[team];
      g.fill(0);
      ts.fill(0);
      for (const u of w.units) {
        if (!u.alive || u.team !== team) continue;
        const r = night ? u.visionNight : u.visionDay;
        if (r > 0) this.reveal(g, u.x, u.y, r);
        if (u.ward?.kind === 'sentry') this.disc(ts, u.x, u.y, TRUE_SIGHT_RADIUS);
        if (u.structure?.tier === 'fountain') this.disc(ts, u.x, u.y, 16);
      }
      const hs = this.house;
      if (hs) {
        const inside = w.units.some((u) => u.alive && u.team === team && Math.hypot(u.x - hs.x, u.y - hs.y) < hs.inner);
        for (const c of this.houseCells) g[c] = inside ? 1 : 0;
      }
    }
  }

  private disc(g: Uint8Array, x: number, y: number, r: number) {
    const n = this.grid;
    const c = this.cell;
    for (let cy = Math.max(0, Math.floor((y - r) / c)); cy <= Math.min(n - 1, Math.floor((y + r) / c)); cy++) {
      for (let cx = Math.max(0, Math.floor((x - r) / c)); cx <= Math.min(n - 1, Math.floor((x + r) / c)); cx++) {
        const dx = (cx + 0.5) * c - x;
        const dy = (cy + 0.5) * c - y;
        if (dx * dx + dy * dy <= r * r) g[cy * n + cx] = 1;
      }
    }
  }

  private reveal(g: Uint8Array, x: number, y: number, r: number) {
    const n = this.grid;
    const ox = Math.floor(x / this.cell);
    const oy = Math.floor(y / this.cell);
    if (ox < 0 || oy < 0 || ox >= n || oy >= n) return;
    const p = this.pattern(r);
    const walk = this.walkable;
    const hgt = this.height;
    const eye = hgt[oy * n + ox];
    g[oy * n + ox] = 1;
    outer: for (let i = 0; i < p.dx.length; i++) {
      const tx = ox + p.dx[i];
      const ty = oy + p.dy[i];
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      if (hgt[ty * n + tx] > eye) continue; // can't see up onto higher ground
      for (let k = p.lineStart[i]; k < p.lineStart[i + 1]; k++) {
        const lx = ox + p.lineX[k];
        const ly = oy + p.lineY[k];
        if (lx < 0 || ly < 0 || lx >= n || ly >= n) continue outer;
        const c = ly * n + lx;
        if (hgt[c] > eye) continue outer; // a cliff in the way
        if (!walk[c] && hgt[c] + 1 >= eye) continue outer; // trees at least as tall as our eye
      }
      g[ty * n + tx] = 1;
    }
  }

  /** Cells within radius `r` (meters) and, for each, the cells strictly between it and the origin. */
  private pattern(r: number) {
    const key = Math.round((r / this.cell) * 2);
    let p = this.patterns.get(key);
    if (p) return p;
    const rc = key / 2;
    const dx: number[] = [];
    const dy: number[] = [];
    const lineStart: number[] = [0];
    const lineX: number[] = [];
    const lineY: number[] = [];
    const R = Math.ceil(rc);
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        if ((x === 0 && y === 0) || x * x + y * y > rc * rc) continue;
        dx.push(x);
        dy.push(y);
        // Sample the segment between cell centres; record each distinct cell crossed.
        const steps = Math.max(Math.abs(x), Math.abs(y)) * 2;
        let px = 0;
        let py = 0;
        for (let s = 1; s < steps; s++) {
          const cx = Math.round((x * s) / steps);
          const cy = Math.round((y * s) / steps);
          if ((cx === px && cy === py) || (cx === x && cy === y) || (cx === 0 && cy === 0)) continue;
          px = cx;
          py = cy;
          lineX.push(cx);
          lineY.push(cy);
        }
        lineStart.push(lineX.length);
      }
    }
    p = {
      dx: Int16Array.from(dx),
      dy: Int16Array.from(dy),
      lineStart: Int32Array.from(lineStart),
      lineX: Int16Array.from(lineX),
      lineY: Int16Array.from(lineY),
    };
    this.patterns.set(key, p);
    return p;
  }

  seesPoint(team: Team, x: number, y: number): boolean {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.grid || cy >= this.grid) return false;
    return this.grids[team][cy * this.grid + cx] === 1;
  }

  /** Own units and buildings are always known; others only inside vision (and true sight if invisible). */
  sees(team: Team, u: Unit): boolean {
    if (u.team === team || u.kind === 'structure') return true;
    if (!this.seesPoint(team, u.x, u.y)) return false;
    if (isInvisible(u)) {
      const cx = Math.floor(u.x / this.cell);
      const cy = Math.floor(u.y / this.cell);
      return this.trueSight[team][cy * this.grid + cx] === 1;
    }
    return true;
  }
}

export function isNight(time: number): boolean {
  return time % (DAY_SECONDS + NIGHT_SECONDS) >= DAY_SECONDS;
}

/** Seconds until the next day/night change. */
export function phaseTimeLeft(time: number): number {
  const t = time % (DAY_SECONDS + NIGHT_SECONDS);
  return t < DAY_SECONDS ? DAY_SECONDS - t : DAY_SECONDS + NIGHT_SECONDS - t;
}
