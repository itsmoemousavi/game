/** Simulation runs on a fixed clock so it is deterministic and can later run on a server. */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

/** World is MAP_SIZE x MAP_SIZE "meters". The walk grid uses CELL-sized cells. */
export const MAP_SIZE = 200;
export const CELL = 2;
export const GRID = MAP_SIZE / CELL;

export const FIRST_WAVE_TIME = 3;
export const CREEP_WAVE_INTERVAL = 30;
export const MELEE_PER_WAVE = 3;
export const RANGED_PER_WAVE = 1;

export const STARTING_GOLD = 600;
export const PASSIVE_GOLD_PER_SEC = 2;
export const XP_SHARE_RADIUS = 30;
export const FOUNTAIN_HEAL_RADIUS = 16;
export const MAX_LEVEL = 15;
/** Ultimate ability becomes learnable at this hero level. */
export const ULTIMATE_LEVEL = 6;

/** Cumulative XP required to reach level index+1 (index 0 = level 1). */
export const XP_TABLE = [0, 230, 600, 1080, 1660, 2260, 2980, 3730, 4510, 5320, 6160, 7030, 7930, 8860, 9820];

/** Day/night cycle: night shrinks vision (fog of war). Matches start at dawn. */
export const DAY_SECONDS = 180;
export const NIGHT_SECONDS = 120;
/** Fog-of-war grid updates this many times per second. */
export const VISION_HZ = 10;

/** Neutral camps (re)spawn on every full minute when empty. */
export const CAMP_FIRST_SPAWN = 30;
export const CAMP_RESPAWN = 60;
export const NEUTRAL_LEASH = 11;

export type Team = 0 | 1;
/** Side a unit belongs to: a team, or 2 for neutral jungle monsters. */
export type Side = Team | 2;
export const NEUTRAL: Side = 2;
export const TEAM_NAMES = ['Azure', 'Crimson'] as const;
export const otherTeam = (t: Team): Team => (t === 0 ? 1 : 0);
