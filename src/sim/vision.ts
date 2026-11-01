import { DAY_SECONDS, NIGHT_SECONDS, Team } from './constants';
import type { Unit, World } from './world';

/**
 * Fog of war. Each team has a coarse grid (same cells as the walk grid) of what it
 * can currently see. Vision comes from the team's living heroes, creeps and buildings
 * and shrinks at night. Enemy units outside it are hidden from players and bots.
 * (Trees don't block sight yet; that can come later.)
 */
export class Vision {
  readonly grids: [Uint8Array, Uint8Array];

  constructor(private grid: number, private cell: number) {
    this.grids = [new Uint8Array(grid * grid), new Uint8Array(grid * grid)];
  }

  update(w: World) {
    const night = isNight(w.time);
    for (const team of [0, 1] as Team[]) {
      const g = this.grids[team];
      g.fill(0);
      for (const u of w.units) {
        if (!u.alive || u.team !== team) continue;
        const r = night ? u.visionNight : u.visionDay;
        if (r > 0) this.reveal(g, u.x, u.y, r);
      }
    }
  }

  private reveal(g: Uint8Array, x: number, y: number, r: number) {
    const n = this.grid;
    const c = this.cell;
    const c0 = Math.max(0, Math.floor((x - r) / c));
    const c1 = Math.min(n - 1, Math.floor((x + r) / c));
    const r0 = Math.max(0, Math.floor((y - r) / c));
    const r1 = Math.min(n - 1, Math.floor((y + r) / c));
    const r2 = r * r;
    for (let cy = r0; cy <= r1; cy++) {
      const dy = (cy + 0.5) * c - y;
      for (let cx = c0; cx <= c1; cx++) {
        const dx = (cx + 0.5) * c - x;
        if (dx * dx + dy * dy <= r2) g[cy * n + cx] = 1;
      }
    }
  }

  seesPoint(team: Team, x: number, y: number): boolean {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.grid || cy >= this.grid) return false;
    return this.grids[team][cy * this.grid + cx] === 1;
  }

  /** Own units and buildings are always known; others only when inside vision. */
  sees(team: Team, u: Unit): boolean {
    if (u.team === team || u.kind === 'structure') return true;
    return this.seesPoint(team, u.x, u.y);
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
