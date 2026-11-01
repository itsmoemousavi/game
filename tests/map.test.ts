import { describe, expect, it } from 'vitest';
import { LANE_IDS, MAP_SIZE, createMap, findPath, isWalkable, lineClear, mirror } from '../src/sim';

const map = createMap();

describe('map', () => {
  it('is point-symmetric so both teams get the same map', () => {
    for (let cy = 0; cy < map.grid; cy++) {
      for (let cx = 0; cx < map.grid; cx++) {
        const m = (map.grid - 1 - cy) * map.grid + (map.grid - 1 - cx);
        expect(map.walkable[cy * map.grid + cx]).toBe(map.walkable[m]);
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
    expect(counts).toEqual({ 0: 13, 1: 13 });
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
    expect(MAP_SIZE).toBe(200);
  });
});
