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

/** Jungle "maze" for team 0's half; mirrored for team 1. Rooms are where neutral camps will go. */
const JUNGLE_ROOMS: { c: Vec2; r: number }[] = [
  { c: { x: 52, y: 104 }, r: 7 },
  { c: { x: 100, y: 148 }, r: 7 },
  { c: { x: 64, y: 140 }, r: 6 },
];
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

/** Fraction of lane length (from own base) where tier-1 / tier-2 towers stand. */
const TOWER_FRACTION: Record<LaneId, { t1: number; t2: number }> = {
  top: { t1: 0.36, t2: 0.2 },
  mid: { t1: 0.38, t2: 0.22 },
  bot: { t1: 0.36, t2: 0.2 },
};

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

  // Structures (team 0, then mirrored for team 1).
  const structures: StructureSpawn[] = [];
  for (const lane of LANE_IDS) {
    const path = LANES[lane];
    const len = polylineLength(path);
    const f = TOWER_FRACTION[lane];
    const t1 = pointAlong(path, len * f.t1);
    const t2 = pointAlong(path, len * f.t2);
    // Barracks sits beside tier-2, a little closer to base, offset off the lane.
    const behind = pointAlong(path, len * f.t2 - 5);
    const ahead = pointAlong(path, len * f.t2 + 1);
    const dx = ahead.x - behind.x;
    const dy = ahead.y - behind.y;
    const l = Math.hypot(dx, dy) || 1;
    // Perpendicular pointing toward the team-0 interior (away from the map edge).
    let px = -dy / l;
    let py = dx / l;
    if (px * (100 - behind.x) + py * (100 - behind.y) < 0) {
      px = -px;
      py = -py;
    }
    const rax = { x: behind.x + px * 7, y: behind.y + py * 7 };
    structures.push({ team: 0, tier: 'tower1', lane, pos: t1 });
    structures.push({ team: 0, tier: 'tower2', lane, pos: t2 });
    structures.push({ team: 0, tier: 'barracks', lane, pos: rax });
    carveCircle(rax, 5);
  }
  const toCenter = Math.atan2(-1, 1);
  for (const sign of [-1, 1]) {
    const a = toCenter + (sign * 40 * Math.PI) / 180;
    structures.push({
      team: 0,
      tier: 'shrineTower',
      lane: null,
      pos: { x: SHRINE0.x + Math.cos(a) * 13, y: SHRINE0.y + Math.sin(a) * 13 },
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

  return {
    size: MAP_SIZE,
    cell: CELL,
    grid: GRID,
    walkable,
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
