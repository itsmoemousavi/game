import { describe, expect, it } from 'vitest';
import { LANE_IDS, MAP_SIZE, World, createMap, findPath, isWalkable, lineClear, mirror, pointAlong, polylineLength } from '../src/sim';

const map = createMap();

describe('map', () => {
  it('is point-symmetric so both teams get the same map', () => {
    const h = map.house;
    const nearHouse = (cx: number, cy: number) => Math.hypot((cx + 0.5) * map.cell - h.x, (cy + 0.5) * map.cell - h.y) < 13;
    for (let cy = 0; cy < map.grid; cy++) {
      for (let cx = 0; cx < map.grid; cx++) {
        const m = (map.grid - 1 - cy) * map.grid + (map.grid - 1 - cx);
        // The Warden's house stands on the river on one side only (checked below).
        if (nearHouse(cx, cy) || nearHouse(map.grid - 1 - cx, map.grid - 1 - cy)) continue;
        expect(map.walkable[cy * map.grid + cx]).toBe(map.walkable[m]);
      }
    }
  });

  it("the Warden's house is mirror-symmetric across the river (fair to both teams)", () => {
    const h = map.house;
    expect(h.x).toBe(h.y); // on the river line y = x
    for (let cy = 0; cy < map.grid; cy++) {
      for (let cx = 0; cx < map.grid; cx++) {
        if (Math.hypot((cx + 0.5) * map.cell - h.x, (cy + 0.5) * map.cell - h.y) > 11.5) continue;
        expect(map.walkable[cy * map.grid + cx]).toBe(map.walkable[cx * map.grid + cy]);
      }
    }
  });

  it('has 3 lanes that are walkable end to end', () => {
    for (const lane of LANE_IDS) {
      const p = map.lanes[lane];
      for (let i = 1; i < p.length; i++) expect(lineClear(map, p[i - 1], p[i], 1)).toBe(true);
    }
  });

  it('places every structure on walkable ground and mirrors them', () => {
    const counts = { 0: 0, 1: 0 };
    for (const s of map.structures) {
      expect(isWalkable(map, s.pos.x, s.pos.y)).toBe(true);
      counts[s.team]++;
    }
    // 3 lanes x (2 towers + barracks) + 2 shrine towers + shrine + fountain
    expect(counts).toEqual({ 0: 19, 1: 19 });
    const t1 = map.structures.find((s) => s.team === 0 && s.tier === 'tower1' && s.lane === 'top')!;
    const mirrored = map.structures.find((s) => s.team === 1 && s.tier === 'tower1' && s.lane === 'bot')!;
    expect(mirror(t1.pos).x).toBeCloseTo(mirrored.pos.x);
  });

  it('keeps each team on its side of the diagonal', () => {
    for (const s of map.structures) {
      if (s.team === 0) expect(s.pos.y).toBeGreaterThan(s.pos.x);
      else expect(s.pos.y).toBeLessThan(s.pos.x);
    }
  });

  it('finds a path between the two fountains through the maze', () => {
    const path = findPath(map, map.fountains[0], map.fountains[1]);
    expect(path).not.toBeNull();
    const last = path![path!.length - 1];
    expect(Math.hypot(last.x - map.fountains[1].x, last.y - map.fountains[1].y)).toBeLessThan(2);
    expect(MAP_SIZE).toBe(300);
  });

  it('buildings never squeeze a lane: at least 10 m of open ground all along every lane', () => {
    const nav = new World({ seed: 1, slots: [] }).nav;
    for (const lane of LANE_IDS) {
      const p = map.lanes[lane];
      for (let d = 30; d < polylineLength(p) - 30; d += 1) {
        const a = pointAlong(p, d);
        const b = pointAlong(p, d + 0.5);
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        const nx = -(b.y - a.y) / l;
        const ny = (b.x - a.x) / l;
        let best = 0;
        let run = 0;
        for (let t = -12; t <= 12; t += 0.25) {
          if (isWalkable(nav, a.x + nx * t, a.y + ny * t)) best = Math.max(best, (run += 0.25));
          else run = 0;
        }
        expect(best, `${lane} lane at ${a.x.toFixed(0)},${a.y.toFixed(0)}`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('every building can be walked up to from both bases', () => {
    const nav = new World({ seed: 1, slots: [] }).nav;
    for (const s of map.structures) {
      if (s.tier === 'fountain') continue;
      for (const f of map.fountains) expect(findPath(nav, f, s.pos, 0.42), `${s.tier} ${s.lane} team ${s.team}`).not.toBeNull();
    }
  });

  it('lane towers reach right across their lane (nobody slips past out of range)', () => {
    const w = new World({ seed: 1, slots: [] });
    for (const t of w.units.filter((u) => u.structure && /^tower[123]$/.test(u.structure.tier))) {
      const lane = map.lanes[t.structure!.lane!];
      // Closest point on the lane centre line, then the far edge of the lane from the tower.
      let best = { d: Infinity, x: 0, y: 0 };
      for (let d = 0; d < polylineLength(lane); d += 0.5) {
        const p = pointAlong(lane, d);
        const dd = Math.hypot(p.x - t.x, p.y - t.y);
        if (dd < best.d) best = { d: dd, x: p.x, y: p.y };
      }
      const k = (best.d + 6.5) / best.d; // centre line + half the lane width (13 m lanes)
      const far = { x: t.x + (best.x - t.x) * k, y: t.y + (best.y - t.y) * k };
      expect(Math.hypot(far.x - t.x, far.y - t.y), `${t.structure!.tier} ${t.structure!.lane} team ${t.team}`).toBeLessThanOrEqual(t.attackRange + t.radius + 0.6);
    }
  });
});
