import { CELL, GRID, MAP_SIZE, Team } from './constants';
import { Vec2, distToSegment, distV, pointAlong, polylineLength, projectOnPolyline } from './math';

export type LaneId = 'top' | 'mid' | 'bot';
export const LANE_IDS: LaneId[] = ['top', 'mid', 'bot'];

export type StructureTier = 'tower1' | 'tower2' | 'tower3' | 'barracks' | 'shrineTower' | 'shrine' | 'fountain';

export interface StructureSpawn {
  team: Team;
  tier: StructureTier;
  lane: LaneId | null;
  pos: Vec2;
  /** Barracks: which creeps it powers up for the enemy when it falls. */
  rax?: 'melee' | 'ranged';
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
  /** The river's winding centre line (for drawing), from corner to corner. */
  riverPath: Vec2[];
  riverWidth: number;
  /** Where roads cross the river (drawn as bridges; the ground there is walkable). */
  bridges: Bridge[];
  /** Every tree: blocks walking and sight in its cell. */
  trees: Tree[];
  shrines: [Vec2, Vec2];
  fountains: [Vec2, Vec2];
  structures: StructureSpawn[];
  /** Neutral jungle camp spots (both halves). */
  camps: Vec2[];
  /** The two river spots where power-ups appear. */
  runeSpots: [Vec2, Vec2];
  /** Where the boss lives (a pit beside the river). */
  bossPit: Vec2;
  /** The Warden's walled house around the boss pit (one doorway facing the map centre). */
  house: House;
}

export interface Tree {
  x: number;
  y: number;
  /** Size factor (about 0.8–1.4). */
  s: number;
  kind: 'pine' | 'oak' | 'dead';
}

export interface Bridge {
  x: number;
  y: number;
  /** Direction of the road (radians, map coordinates). */
  angle: number;
  length: number;
  width: number;
}

export interface House {
  x: number;
  y: number;
  /** Inside radius (open floor). */
  inner: number;
  /** Outer edge of the wall. */
  outer: number;
  /** Unit vector from the centre out through the doorway. */
  door: Vec2;
  /** Half the doorway's width. */
  doorHalf: number;
}

/**
 * Layout: team 0 (Azure) owns the bottom-left triangle, team 1 (Crimson) the top-right.
 * The diagonal river (y = x, screen coordinates with y pointing down) splits the map.
 * Everything is point-symmetric around the centre so both sides are identical.
 */
export const mirror = (p: Vec2): Vec2 => ({ x: MAP_SIZE - p.x, y: MAP_SIZE - p.y });
const mirrorLane = (l: LaneId): LaneId => (l === 'top' ? 'bot' : l === 'bot' ? 'top' : 'mid');

/**
 * The layout below is written for a 200 m map and scaled up to MAP_SIZE (so the whole map
 * can be made bigger without redrawing it). Corridor widths stay about the same.
 */
const S = MAP_SIZE / 200;
const sc = (p: Vec2): Vec2 => ({ x: p.x * S, y: p.y * S });

const RIVER: [Vec2, Vec2] = [sc({ x: 20, y: 20 }), sc({ x: 180, y: 180 })];
const RIVER_WIDTH = 16;
/** How far the river winds to either side of the diagonal (meters). */
const RIVER_BEND = 6 * S;
/**
 * Point on the river at t (−1 = top-left corner, 0 = map centre, 1 = bottom-right corner).
 * The bend is an odd function of t, so the river is point-symmetric like the rest of the map,
 * and it is straight at the centre (mid bridge) and at the Warden's house (t = ±0.5).
 */
function riverAt(t: number): Vec2 {
  const c = MAP_SIZE / 2;
  const o = RIVER_BEND * Math.sin(2 * Math.PI * t);
  const k = Math.SQRT1_2;
  return { x: c + c * t + o * k, y: c + c * t - o * k };
}
const RIVER_PATH: Vec2[] = Array.from({ length: 121 }, (_, i) => riverAt(-1.05 + (2.1 * i) / 120));

const LANE_WIDTH = 13;
const JUNGLE_WIDTH = 10;

const LANES_200: Record<LaneId, Vec2[]> = {
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

const LANES: Record<LaneId, Vec2[]> = {
  top: LANES_200.top.map(sc),
  mid: LANES_200.mid.map(sc),
  bot: LANES_200.bot.map(sc),
};

const SHRINE0: Vec2 = sc({ x: 24, y: 176 });
const FOUNTAIN0: Vec2 = sc({ x: 10, y: 190 });
const BASE0: Vec2 = sc({ x: 26, y: 174 });
const BASE_RADIUS = 24 * S;
/** The base sits on a plateau a little wider than the base clearing. */
const BASE_PLATEAU = 26 * S;

/** Jungle "maze" for team 0's half; mirrored for team 1. Rooms are where neutral camps will go. */
const JUNGLE_ROOMS: { c: Vec2; r: number }[] = [
  { c: { x: 52, y: 104 }, r: 7 },
  { c: { x: 100, y: 148 }, r: 7 },
  { c: { x: 42, y: 136 }, r: 6 },
].map((room) => ({ c: sc(room.c), r: room.r * 1.25 }));
/**
 * Narrow paths through the forest ("juke paths") for hiding, ganking and escaping.
 * Trees on both sides still block sight. Polylines, team-0 half; mirrored for team 1.
 */
const FOREST_PATHS_200: Vec2[][] = [
  [{ x: 22, y: 70 }, { x: 40, y: 62 }, { x: 58, y: 59 }],
  [{ x: 22, y: 96 }, { x: 34, y: 91 }, { x: 47, y: 100 }],
  [{ x: 22, y: 124 }, { x: 40, y: 128 }, { x: 59, y: 139 }],
  [{ x: 64, y: 112 }, { x: 84, y: 104 }, { x: 95, y: 96 }],
  [{ x: 80, y: 180 }, { x: 83, y: 165 }, { x: 98, y: 151 }],
  [{ x: 120, y: 180 }, { x: 123, y: 166 }, { x: 132, y: 157 }, { x: 146, y: 147 }],
  [{ x: 152, y: 180 }, { x: 157, y: 168 }, { x: 160, y: 161 }],
  [{ x: 87, y: 128 }, { x: 90, y: 144 }],
];
const FOREST_PATHS = FOREST_PATHS_200.map((p) => p.map(sc));
const FOREST_PATH_WIDTH = 5.5;
/** Ward hills (height 3) on the forest paths. */
const HILLS_200: Vec2[] = [
  { x: 34, y: 86 },
  { x: 128, y: 162 },
  { x: 87, y: 127 },
];
const HILLS = HILLS_200.map(sc);
const HILL_RADIUS = 5;

const JUNGLE_PATHS_200: [Vec2, Vec2][] = [
  [{ x: 18, y: 112 }, { x: 52, y: 104 }],
  [{ x: 52, y: 104 }, { x: 68, y: 68 }],
  [{ x: 52, y: 104 }, { x: 82, y: 118 }],
  [{ x: 100, y: 148 }, { x: 102, y: 182 }],
  [{ x: 100, y: 148 }, { x: 132, y: 132 }],
  [{ x: 100, y: 148 }, { x: 78, y: 122 }],
  [{ x: 42, y: 136 }, { x: 22, y: 132 }],
  [{ x: 42, y: 136 }, { x: 40, y: 156 }],
  [{ x: 42, y: 136 }, { x: 52, y: 104 }],
];
const JUNGLE_PATHS = JUNGLE_PATHS_200.map(([a, b]) => [sc(a), sc(b)] as [Vec2, Vec2]);
/** Power-up spots: river junctions where jungle paths meet (mirror images of each other). */
const RUNE_SPOT: Vec2 = riverAt((68 * S - MAP_SIZE / 2) / (MAP_SIZE / 2));
/** Boss pit on the river (the river line y = x is equally far from both bases). */
const BOSS_PIT: Vec2 = sc({ x: 150, y: 150 }); // on the river (its bend is zero here)

/**
 * The Warden's house: a round walled room on the river between the bottom and middle lanes.
 * Its only doorway faces the map centre along the river, so both teams reach it equally fast.
 */
const HOUSE: House = (() => {
  const d = Math.SQRT1_2;
  return { x: BOSS_PIT.x, y: BOSS_PIT.y, inner: 5, outer: 8, door: { x: -d, y: -d }, doorHalf: 4 };
})();
/** Open ground around the house, so you can walk all the way round it. */
const HOUSE_CLEARING = 12;


/**
 * Tier-1 towers stand this far along the way from the base gate to the river (close to it)
 * (as a fraction), so every lane's outer tower is equally "half-way out".
 */
const T1_FRACTION = 0.86;
/** Tier-2 towers stand a bit further back toward the base. */
const T2_FRACTION = 0.45;
/**
 * Towers stand just past the lane edge: they leave most of the lane open, and their reach
 * (11 m + body sizes) still covers the far side of the lane.
 */
const TOWER_SIDE_OFFSET = LANE_WIDTH / 2 + 0.5;
/** Tier-3 tower + barracks form a gate this far from where the lane leaves the base. */
const GATE_DISTANCE = 5 * S;

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
  for (let i = 1; i < RIVER_PATH.length; i++) carveSeg(RIVER_PATH[i - 1], RIVER_PATH[i], RIVER_WIDTH);
  carveCircle(BOSS_PIT, HOUSE_CLEARING); // the house (walls added below) and, mirrored, an open pit
  carveCircle(RUNE_SPOT, 4.5 * S);
  carveCircle(BASE0, BASE_RADIUS);
  for (const room of JUNGLE_ROOMS) carveCircle(room.c, room.r);
  for (const [a, b] of JUNGLE_PATHS) carveSeg(a, b, JUNGLE_WIDTH);
  for (const path of FOREST_PATHS) for (let i = 1; i < path.length; i++) carveSeg(path[i - 1], path[i], FOREST_PATH_WIDTH);
  for (const h of HILLS) carveCircle(h, HILL_RADIUS);
  // The Warden's house (only on this side of the river; the mirrored pit stays an open clearing).
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      const x = (cx + 0.5) * CELL;
      const y = (cy + 0.5) * CELL;
      const d = Math.hypot(x - HOUSE.x, y - HOUSE.y);
      if (d <= HOUSE_CLEARING) walkable[cy * GRID + cx] = isHouseWallAt(HOUSE, x, y) ? 0 : 1;
    }
  }

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
    const dot = px * (MAP_SIZE / 2 - a.x) + py * (MAP_SIZE / 2 - a.y);
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
    const t2 = sideOf(path, river * T2_FRACTION);
    const t1Pos = { x: t1.at.x + t1.px * TOWER_SIDE_OFFSET, y: t1.at.y + t1.py * TOWER_SIDE_OFFSET };
    const t2Pos = { x: t2.at.x + t2.px * TOWER_SIDE_OFFSET, y: t2.at.y + t2.py * TOWER_SIDE_OFFSET };
    // Gate: the tier-3 tower stands out front, the two barracks behind it on either side.
    const front = sideOf(path, GATE_DISTANCE + 4);
    const t3Pos = { x: front.at.x + front.px * TOWER_SIDE_OFFSET, y: front.at.y + front.py * TOWER_SIDE_OFFSET };
    const back = sideOf(path, Math.max(1, GATE_DISTANCE - 3));
    const meleePos = { x: back.at.x + back.px * (TOWER_SIDE_OFFSET + 1.5), y: back.at.y + back.py * (TOWER_SIDE_OFFSET + 1.5) };
    const rangedPos = { x: back.at.x - back.px * (TOWER_SIDE_OFFSET + 1.5), y: back.at.y - back.py * (TOWER_SIDE_OFFSET + 1.5) };
    structures.push({ team: 0, tier: 'tower1', lane, pos: t1Pos });
    structures.push({ team: 0, tier: 'tower2', lane, pos: t2Pos });
    structures.push({ team: 0, tier: 'tower3', lane, pos: t3Pos });
    structures.push({ team: 0, tier: 'barracks', lane, pos: meleePos, rax: 'melee' });
    structures.push({ team: 0, tier: 'barracks', lane, pos: rangedPos, rax: 'ranged' });
    for (const p of [t1Pos, t2Pos, t3Pos]) carveCircle(p, 5.5); // room to walk all the way round
    for (const p of [meleePos, rangedPos]) carveCircle(p, 6.5);
  }
  // Shrine towers flank the Shrine on the side facing the lanes.
  const toCenter = Math.atan2(-1, 1);
  // Close to the Shrine and to each other, so they cover it (and each other) together.
  for (const sign of [-1, 1]) {
    const a = toCenter + (sign * 35 * Math.PI) / 180;
    structures.push({
      team: 0,
      tier: 'shrineTower',
      lane: null,
      pos: { x: SHRINE0.x + Math.cos(a) * 11, y: SHRINE0.y + Math.sin(a) * 11 },
    });
  }
  structures.push({ team: 0, tier: 'shrine', lane: null, pos: SHRINE0 });
  structures.push({ team: 0, tier: 'fountain', lane: null, pos: FOUNTAIN0 });

  const mirrored = structures.map<StructureSpawn>((s) => ({
    team: 1,
    tier: s.tier,
    lane: s.lane ? mirrorLane(s.lane) : null,
    pos: mirror(s.pos),
    rax: s.rax,
  }));
  structures.push(...mirrored);

  // Forest. Everything not carved out above is woodland: dense thickets (solid), open
  // woods with gaps you can walk through, and glades with a few trees. Generated for team 0's
  // half and mirrored, so both sides are identical.
  const trees = plantForest(walkable);

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

  // Anything walkable that can't be reached from the bases (a pocket inside a thicket)
  // is filled in, so a blink can never land somewhere you can't walk out of.
  sealPockets(walkable, FOUNTAIN0);

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
    riverPath: RIVER_PATH,
    riverWidth: RIVER_WIDTH,
    bridges: findBridges(),
    trees,
    shrines,
    fountains: [FOUNTAIN0, mirror(FOUNTAIN0)],
    structures,
    camps: [...JUNGLE_ROOMS.map((r) => r.c), ...JUNGLE_ROOMS.map((r) => mirror(r.c))],
    runeSpots: [RUNE_SPOT, mirror(RUNE_SPOT)],
    bossPit: BOSS_PIT,
    house: HOUSE,
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

/** True for a point inside the Warden's house (on its floor, not in the doorway or the wall). */
export function inHouse(map: GameMap, x: number, y: number): boolean {
  const h = map.house;
  return Math.hypot(x - h.x, y - h.y) < h.inner;
}

/** True where the house wall stands (the ring between inner and outer, minus the doorway). */
export function isHouseWallAt(h: House, x: number, y: number): boolean {
  const dx = x - h.x;
  const dy = y - h.y;
  const d = Math.hypot(dx, dy);
  if (d < h.inner || d > h.outer) return false;
  const along = dx * h.door.x + dy * h.door.y;
  const across = Math.abs(-dx * h.door.y + dy * h.door.x);
  return !(along > 0 && across < h.doorHalf);
}

// ---------------------------------------------------------------- forest

/** Deterministic hash of a cell to [0, 1). */
function hash01(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1] (bilinear between hashed lattice points). */
function noise(x: number, y: number, k = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash01(x0, y0, k);
  const b = hash01(x0 + 1, y0, k);
  const c = hash01(x0, y0 + 1, k);
  const d = hash01(x0 + 1, y0 + 1, k);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** The Warden's house and its clearing (and the matching open pit) are laid out by hand. */
const nearHouse = (x: number, y: number) => Math.hypot(x - HOUSE.x, y - HOUSE.y) <= HOUSE_CLEARING || Math.hypot(MAP_SIZE - x - HOUSE.x, MAP_SIZE - y - HOUSE.y) <= HOUSE_CLEARING;

/** Thicket (solid) belt around each base: you only get in along the lanes. */
const BASE_WALL = BASE_PLATEAU + 9;
/** Outside the side lanes (between them and the map edge) is solid forest. */
const BORDER_THICKET = 19;

/**
 * Turn every not-yet-walkable cell into forest: thickets stay solid (a tree in every cell),
 * woods get scattered trees with walkable gaps, glades get a few. Returns the trees.
 */
function plantForest(walkable: Uint8Array): Tree[] {
  const carved = new Uint8Array(walkable);
  const isTree = new Uint8Array(GRID * GRID);
  const trees: Tree[] = [];
  const tree = (cx: number, cy: number) => {
    walkable[cy * GRID + cx] = 0;
    isTree[cy * GRID + cx] = 1;
    const h = hash01(cx, cy, 7);
    const x = (cx + 0.5) * CELL + (h - 0.5) * 0.8;
    const y = (cy + 0.5) * CELL + (hash01(cx, cy, 8) - 0.5) * 0.8;
    const kn = noise(x / 40, y / 40, 3);
    const kind: Tree['kind'] = hash01(cx, cy, 9) < 0.04 ? 'dead' : kn > 0.45 ? 'pine' : 'oak';
    return { x, y, s: 0.8 + hash01(cx, cy, 10) * 0.6, kind };
  };
  const half: Tree[] = [];
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      // Team 0's half is below the diagonal (y > x); the other half is its mirror image.
      if (cy <= cx) continue;
      if (carved[cy * GRID + cx]) continue;
      const x = (cx + 0.5) * CELL;
      const y = (cy + 0.5) * CELL;
      if (nearHouse(x, y)) continue;
      const edge = Math.min(x, y, MAP_SIZE - x, MAP_SIZE - y);
      const nearBase = Math.hypot(x - BASE0.x, y - BASE0.y) < BASE_WALL;
      const d = noise(x / 26, y / 26) * 0.75 + noise(x / 9, y / 9, 1) * 0.25;
      let p: number;
      if (edge < BORDER_THICKET || nearBase || d > 0.52) p = 1; // thicket
      else if (d > 0.3) p = 0.55; // woods
      else p = 0.14; // glade
      if (p < 1) {
        // Keep a gap of at least one free cell between trees outside the thickets.
        let crowded = false;
        for (let oy = -1; oy <= 1 && !crowded; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const n = (cy + oy) * GRID + (cx + ox);
            if ((ox || oy) && n >= 0 && n < GRID * GRID && isTree[n]) crowded = true;
          }
        }
        if (crowded || hash01(cx, cy, 2) >= p) {
          walkable[cy * GRID + cx] = 1;
          continue;
        }
      }
      half.push(tree(cx, cy));
    }
  }
  // Mirror onto the other half.
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      if (cy >= cx) continue;
      const mx = GRID - 1 - cx;
      const my = GRID - 1 - cy;
      if (carved[cy * GRID + cx] || nearHouse((cx + 0.5) * CELL, (cy + 0.5) * CELL)) continue;
      walkable[cy * GRID + cx] = walkable[my * GRID + mx];
    }
  }
  // The diagonal itself (river) is carved; any leftover diagonal cell stays as it was.
  for (const t of half) trees.push(t, { ...t, x: MAP_SIZE - t.x, y: MAP_SIZE - t.y });
  return trees;
}

/** Fill walkable cells that can't be reached from `start` (pockets inside thickets). */
function sealPockets(walkable: Uint8Array, start: Vec2) {
  const seen = new Uint8Array(GRID * GRID);
  const s0 = Math.floor(start.y / CELL) * GRID + Math.floor(start.x / CELL);
  const stack = [s0];
  seen[s0] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const cx = c % GRID;
    const cy = (c - cx) / GRID;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const n = ny * GRID + nx;
      if (seen[n] || !walkable[n]) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  for (let i = 0; i < walkable.length; i++) if (walkable[i] && !seen[i]) walkable[i] = 0;
}

/** Where each lane crosses the river: a bridge along the road. */
function findBridges(): Bridge[] {
  const out: Bridge[] = [];
  for (const id of LANE_IDS) {
    const p = LANES[id];
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1];
      const b = p[i];
      for (let j = 1; j < RIVER_PATH.length; j++) {
        const c = RIVER_PATH[j - 1];
        const d = RIVER_PATH[j];
        const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
        const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const ra = Math.atan2(d.y - c.y, d.x - c.x);
        const cross = Math.abs(Math.sin(angle - ra)) || 1;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle, length: RIVER_WIDTH / cross + 4, width: 9 });
      }
    }
  }
  return out;
}
