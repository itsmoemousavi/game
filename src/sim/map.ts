import { CELL, GRID, MAP_SIZE, Team } from './constants';
import { Vec2, distToSegment, distV, pointAlong, polylineLength, projectOnPolyline } from './math';

export type LaneId = 'top' | 'mid' | 'bot';
export const LANE_IDS: LaneId[] = ['top', 'mid', 'bot'];

export type StructureTier = 'tower1' | 'tower2' | 'barracks' | 'shrineTower' | 'shrine' | 'fountain';

export interface StructureSpawn {
  team: Team;
  tier: StructureTier;
  lane: LaneId | null;
  pos: Vec2;
}

export interface GameMap {
  size: number;
  cell: number;
  grid: number;
  /** 1 = walkable, 0 = wall. Indexed [cy * grid + cx]. */
  walkable: Uint8Array;
  /**
   * Ground level per cell: 1 = normal, 2 = base plateau, 3 = ward hill. You can only see
   * ground at your level or lower, and trees block sight unless you stand above their tops.
   */
  height: Uint8Array;
  /** Raised clearings in the jungle: wards (or heroes) there see over the forest. */
  hills: Vec2[];
  /** Narrow paths through the forest (both halves), for drawing. */
  forestPaths: Vec2[][];
  /** Lane polylines, ordered from team 0's base to team 1's base. */
  lanes: Record<LaneId, Vec2[]>;
  /** Creep routes per team: lane polyline from own base, ending at the enemy shrine. */
  teamLanes: [Record<LaneId, Vec2[]>, Record<LaneId, Vec2[]>];
  river: [Vec2, Vec2];
  shrines: [Vec2, Vec2];
  fountains: [Vec2, Vec2];
  structures: StructureSpawn[];
  /** Neutral jungle camp spots (both halves). */
  camps: Vec2[];
  /** The two river spots where power-ups appear. */
  runeSpots: [Vec2, Vec2];
  /** Where the boss lives (a pit beside the river). */
  bossPit: Vec2;
}

/**
 * Layout: team 0 (Azure) owns the bottom-left triangle, team 1 (Crimson) the top-right.
 * The diagonal river (y = x, screen coordinates with y pointing down) splits the map.
 * Everything is point-symmetric around the centre so both sides are identical.
 */
export const mirror = (p: Vec2): Vec2 => ({ x: MAP_SIZE - p.x, y: MAP_SIZE - p.y });
const mirrorLane = (l: LaneId): LaneId => (l === 'top' ? 'bot' : l === 'bot' ? 'top' : 'mid');

const LANE_WIDTH = 12;
const JUNGLE_WIDTH = 6;

const LANES: Record<LaneId, Vec2[]> = {
  top: [
    { x: 22, y: 156 },
    { x: 18, y: 30 },
    { x: 30, y: 18 },
    { x: 156, y: 22 },
  ],
  mid: [
    { x: 38, y: 162 },
    { x: 100, y: 100 },
    { x: 162, y: 38 },
  ],
  bot: [
    { x: 44, y: 178 },
    { x: 170, y: 182 },
    { x: 182, y: 170 },
    { x: 178, y: 44 },
  ],
};

const SHRINE0: Vec2 = { x: 24, y: 176 };
const FOUNTAIN0: Vec2 = { x: 10, y: 190 };
const BASE0: Vec2 = { x: 26, y: 174 };
const BASE_RADIUS = 24;
/** The base sits on a plateau a little wider than the base clearing. */
const BASE_PLATEAU = 26;

/** Jungle "maze" for team 0's half; mirrored for team 1. Rooms are where neutral camps will go. */
const JUNGLE_ROOMS: { c: Vec2; r: number }[] = [
  { c: { x: 52, y: 104 }, r: 7 },
  { c: { x: 100, y: 148 }, r: 7 },
  { c: { x: 64, y: 140 }, r: 6 },
];
/**
 * Narrow paths through the forest ("juke paths") for hiding, ganking and escaping.
 * Trees on both sides still block sight. Polylines, team-0 half; mirrored for team 1.
 */
const FOREST_PATHS: Vec2[][] = [
  [{ x: 22, y: 70 }, { x: 40, y: 62 }, { x: 58, y: 59 }],
  [{ x: 22, y: 96 }, { x: 34, y: 91 }, { x: 47, y: 100 }],
  [{ x: 22, y: 124 }, { x: 40, y: 128 }, { x: 59, y: 139 }],
  [{ x: 64, y: 112 }, { x: 84, y: 104 }, { x: 95, y: 96 }],
  [{ x: 80, y: 180 }, { x: 83, y: 165 }, { x: 98, y: 151 }],
  [{ x: 120, y: 180 }, { x: 123, y: 166 }, { x: 132, y: 157 }, { x: 146, y: 147 }],
  [{ x: 152, y: 180 }, { x: 157, y: 168 }, { x: 160, y: 161 }],
  [{ x: 87, y: 128 }, { x: 90, y: 144 }],
];
const FOREST_PATH_WIDTH = 3.8;
/** Ward hills (height 3) on the forest paths. */
const HILLS: Vec2[] = [
  { x: 34, y: 86 },
  { x: 128, y: 162 },
  { x: 87, y: 127 },
];
const HILL_RADIUS = 3.6;

const JUNGLE_PATHS: [Vec2, Vec2][] = [
  [{ x: 18, y: 112 }, { x: 52, y: 104 }],
  [{ x: 52, y: 104 }, { x: 68, y: 68 }],
  [{ x: 52, y: 104 }, { x: 82, y: 118 }],
  [{ x: 100, y: 148 }, { x: 102, y: 182 }],
  [{ x: 100, y: 148 }, { x: 132, y: 132 }],
  [{ x: 100, y: 148 }, { x: 78, y: 122 }],
  [{ x: 64, y: 140 }, { x: 100, y: 148 }],
  [{ x: 64, y: 140 }, { x: 40, y: 158 }],
  [{ x: 64, y: 140 }, { x: 52, y: 104 }],
];
/** Power-up spots: river junctions where jungle paths meet (mirror images of each other). */
const RUNE_SPOT: Vec2 = { x: 68, y: 68 };
/** Boss pit on the river (the river line y = x is equally far from both bases). */
const BOSS_PIT: Vec2 = { x: 150, y: 150 };

const RIVER: [Vec2, Vec2] = [
  { x: 20, y: 20 },
  { x: 180, y: 180 },
];

/**
 * Tier-1 towers stand this far along the way from the base gate to the river
 * (as a fraction), so every lane's outer tower is equally "half-way out".
 */
const T1_FRACTION = 0.55;
/** Towers stand beside the lane, not in the middle of it. */
const TOWER_SIDE_OFFSET = 4.5;
/** Tier-2 tower + barracks form a gate this far from where the lane leaves the base. */
const GATE_DISTANCE = 5;

export function teamLanePath(map: GameMap, team: Team, lane: LaneId): Vec2[] {
  return map.teamLanes[team][lane];
}

export function createMap(): GameMap {
  const walkable = new Uint8Array(GRID * GRID);

  const carve = (test: (x: number, y: number) => boolean) => {
    for (let cy = 0; cy < GRID; cy++) {
      for (let cx = 0; cx < GRID; cx++) {
        const x = (cx + 0.5) * CELL;
        const y = (cy + 0.5) * CELL;
        if (test(x, y) || test(MAP_SIZE - x, MAP_SIZE - y)) walkable[cy * GRID + cx] = 1;
      }
    }
  };
  const carveSeg = (a: Vec2, b: Vec2, w: number) => carve((x, y) => distToSegment(x, y, a, b) <= w / 2);
  const carveCircle = (c: Vec2, r: number) => carve((x, y) => Math.hypot(x - c.x, y - c.y) <= r);

  for (const id of LANE_IDS) {
    const p = LANES[id];
    for (let i = 1; i < p.length; i++) carveSeg(p[i - 1], p[i], LANE_WIDTH);
  }
  carveSeg(RIVER[0], RIVER[1], 10);
  carveCircle(BOSS_PIT, 7);
  carveCircle(RUNE_SPOT, 4.5);
  carveCircle(BASE0, BASE_RADIUS);
  for (const room of JUNGLE_ROOMS) carveCircle(room.c, room.r);
  for (const [a, b] of JUNGLE_PATHS) carveSeg(a, b, JUNGLE_WIDTH);
  for (const path of FOREST_PATHS) for (let i = 1; i < path.length; i++) carveSeg(path[i - 1], path[i], FOREST_PATH_WIDTH);
  for (const h of HILLS) carveCircle(h, HILL_RADIUS);

  // Structures (team 0, then mirrored for team 1). Dota-style layout:
  //   lane: tier-1 tower out in the lane → tier-2 tower + barracks as a gate where the
  //   lane leaves the base → two shrine towers guarding the Shrine.
  const structures: StructureSpawn[] = [];
  const sideOf = (path: Vec2[], d: number) => {
    // Unit vector perpendicular to the lane at distance d, pointing to the map's inside.
    const a = pointAlong(path, Math.max(0, d - 1));
    const b = pointAlong(path, d + 1);
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let px = -(b.y - a.y) / l;
    let py = (b.x - a.x) / l;
    const dot = px * (100 - a.x) + py * (100 - a.y);
    if (dot < -0.5) {
      px = -px;
      py = -py;
    }
    return { px, py, at: pointAlong(path, d) };
  };
  for (const lane of LANE_IDS) {
    const path = LANES[lane];
    // Distance along the lane to where it reaches the river (the y = x line).
    let river = polylineLength(path);
    for (let d = 0; d < river; d += 0.5) {
      const p = pointAlong(path, d);
      if (p.y <= p.x) {
        river = d;
        break;
      }
    }
    const t1 = sideOf(path, river * T1_FRACTION);
    const gate = sideOf(path, GATE_DISTANCE);
    const t1Pos = { x: t1.at.x + t1.px * TOWER_SIDE_OFFSET, y: t1.at.y + t1.py * TOWER_SIDE_OFFSET };
    const t2Pos = { x: gate.at.x + gate.px * TOWER_SIDE_OFFSET, y: gate.at.y + gate.py * TOWER_SIDE_OFFSET };
    const raxPos = { x: gate.at.x - gate.px * (TOWER_SIDE_OFFSET + 1), y: gate.at.y - gate.py * (TOWER_SIDE_OFFSET + 1) };
    structures.push({ team: 0, tier: 'tower1', lane, pos: t1Pos });
    structures.push({ team: 0, tier: 'tower2', lane, pos: t2Pos });
    structures.push({ team: 0, tier: 'barracks', lane, pos: raxPos });
    for (const p of [t1Pos, t2Pos]) carveCircle(p, 3.5);
    carveCircle(raxPos, 4.5);
  }
  // Shrine towers flank the Shrine on the side facing the lanes.
  const toCenter = Math.atan2(-1, 1);
  for (const sign of [-1, 1]) {
    const a = toCenter + (sign * 42 * Math.PI) / 180;
    structures.push({
      team: 0,
      tier: 'shrineTower',
      lane: null,
      pos: { x: SHRINE0.x + Math.cos(a) * 12.5, y: SHRINE0.y + Math.sin(a) * 12.5 },
    });
  }
  structures.push({ team: 0, tier: 'shrine', lane: null, pos: SHRINE0 });
  structures.push({ team: 0, tier: 'fountain', lane: null, pos: FOUNTAIN0 });

  const mirrored = structures.map<StructureSpawn>((s) => ({
    team: 1,
    tier: s.tier,
    lane: s.lane ? mirrorLane(s.lane) : null,
    pos: mirror(s.pos),
  }));
  structures.push(...mirrored);

  // Solid border.
  for (let i = 0; i < GRID; i++) {
    for (const [cx, cy] of [
      [i, 0],
      [i, 1],
      [i, GRID - 1],
      [i, GRID - 2],
      [0, i],
      [1, i],
      [GRID - 1, i],
      [GRID - 2, i],
    ]) {
      walkable[cy * GRID + cx] = 0;
    }
  }

  const shrines: [Vec2, Vec2] = [SHRINE0, mirror(SHRINE0)];
  const route = (team: Team, lane: LaneId) => {
    const p = team === 0 ? [...LANES[lane]] : [...LANES[lane]].reverse();
    p.push(shrines[team === 0 ? 1 : 0]);
    return p;
  };
  const teamLanes = ([0, 1] as Team[]).map((t) => ({ top: route(t, 'top'), mid: route(t, 'mid'), bot: route(t, 'bot') })) as GameMap['teamLanes'];

  // Ground levels: base plateaus (2) and ward hills (3); everything else is 1.
  const height = new Uint8Array(GRID * GRID).fill(1);
  const hills = [...HILLS, ...HILLS.map(mirror)];
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      const x = (cx + 0.5) * CELL;
      const y = (cy + 0.5) * CELL;
      const i = cy * GRID + cx;
      const b0 = Math.hypot(x - BASE0.x, y - BASE0.y);
      const b1 = Math.hypot(MAP_SIZE - x - BASE0.x, MAP_SIZE - y - BASE0.y);
      if (Math.min(b0, b1) <= BASE_PLATEAU) height[i] = 2;
      if (hills.some((h) => Math.hypot(x - h.x, y - h.y) <= HILL_RADIUS)) height[i] = 3;
    }
  }

  return {
    size: MAP_SIZE,
    cell: CELL,
    grid: GRID,
    walkable,
    height,
    hills,
    forestPaths: [...FOREST_PATHS, ...FOREST_PATHS.map((p) => p.map(mirror))],
    lanes: LANES,
    teamLanes,
    river: RIVER,
    shrines,
    fountains: [FOUNTAIN0, mirror(FOUNTAIN0)],
    structures,
    camps: [...JUNGLE_ROOMS.map((r) => r.c), ...JUNGLE_ROOMS.map((r) => mirror(r.c))],
    runeSpots: [RUNE_SPOT, mirror(RUNE_SPOT)],
    bossPit: BOSS_PIT,
  };
}

export function isWalkable(map: GameMap, x: number, y: number): boolean {
  const cx = Math.floor(x / map.cell);
  const cy = Math.floor(y / map.cell);
  if (cx < 0 || cy < 0 || cx >= map.grid || cy >= map.grid) return false;
  return map.walkable[cy * map.grid + cx] === 1;
}

/** True when a body of radius `r` fits at (x, y). */
export function fits(map: GameMap, x: number, y: number, r: number): boolean {
  const k = r * 0.7;
  return (
    isWalkable(map, x, y) &&
    isWalkable(map, x + k, y + k) &&
    isWalkable(map, x - k, y + k) &&
    isWalkable(map, x + k, y - k) &&
    isWalkable(map, x - k, y - k)
  );
}

/** Straight-line walkability check (sampled every half meter), widened by `r`. */
export function lineClear(map: GameMap, a: Vec2, b: Vec2, r = 0): boolean {
  const d = distV(a, b);
  const steps = Math.ceil(d / 0.5);
  const nx = d > 0 ? -(b.y - a.y) / d : 0;
  const ny = d > 0 ? (b.x - a.x) / d : 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (!isWalkable(map, x, y)) return false;
    if (r > 0 && (!isWalkable(map, x + nx * r, y + ny * r) || !isWalkable(map, x - nx * r, y - ny * r))) {
      return false;
    }
  }
  return true;
}

export const laneProgress = (path: Vec2[], p: Vec2) => projectOnPolyline(path, p);

/** Ground level at a world position (1 outside the map). */
export function heightAt(map: GameMap, x: number, y: number): number {
  const cx = Math.floor(x / map.cell);
  const cy = Math.floor(y / map.cell);
  if (cx < 0 || cy < 0 || cx >= map.grid || cy >= map.grid) return 1;
  return map.height[cy * map.grid + cx];
}
