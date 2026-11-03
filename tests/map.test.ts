import { describe, expect, it } from 'vitest';
import { CREEPS, LANE_IDS, MAP_SIZE, World, createMap, findPath, isWalkable, lineClear, mirror, pointAlong, polylineLength } from '../src/sim';

const map = createMap();
const CREEP = { ...CREEPS.melee, vision: [14, 14] as [number, number] };

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

  it('the river is low ground behind curbs, with slopes to the runes, the Warden and the lanes', () => {
    const curbs = map.cliff.reduce((n, c) => n + c, 0);
    expect(curbs).toBeGreaterThan(100); // most of the bank is a curb
    for (let i = 0; i < map.cliff.length; i++) if (map.cliff[i]) expect(map.walkable[i]).toBe(0);
    const cellOf = (p: { x: number; y: number }) => Math.floor(p.y / map.cell) * map.grid + Math.floor(p.x / map.cell);
    expect(map.height[cellOf(map.runeSpots[0])]).toBe(0);
    // Both fountains can walk to both rune spots and to the Warden's door, and not by a long detour.
    const door = { x: map.house.x + map.house.door.x * (map.house.outer + 2), y: map.house.y + map.house.door.y * (map.house.outer + 2) };
    for (const f of map.fountains) {
      for (const goal of [...map.runeSpots, door]) {
        const path = findPath(map, f, goal, 0.7);
        expect(path).not.toBeNull();
        let len = 0;
        let prev = f;
        for (const p of path!) {
          len += Math.hypot(p.x - prev.x, p.y - prev.y);
          prev = p;
        }
        expect(len).toBeLessThan(Math.hypot(goal.x - f.x, goal.y - f.y) * 1.6);
      }
    }
  });

  it('from a bank you see down into the river, but not up onto the bank from the water', () => {
    const w = new World({ seed: 3, slots: [] });
    const r = map.runeSpots[0];
    // A bank point beside the river near the rune: step away from the river centre until on level 1.
    const nx = Math.SQRT1_2;
    let bank = { x: r.x, y: r.y };
    for (let d = 0; d < 20; d += 0.5) {
      const p = { x: r.x - nx * d, y: r.y + nx * d };
      const c = Math.floor(p.y / map.cell) * map.grid + Math.floor(p.x / map.cell);
      if (map.height[c] === 1 && map.walkable[c]) {
        bank = p;
        break;
      }
    }
    expect(bank).not.toEqual(r);
    const a = w.spawnUnit('creep', 0, bank, { ...CREEP });
    const b = w.spawnUnit('creep', 1, r, { ...CREEP });
    w.vision.update(w);
    expect(w.canSee(0, b)).toBe(true); // bank → river
    expect(w.canSee(1, a)).toBe(false); // river → bank
  });
});
