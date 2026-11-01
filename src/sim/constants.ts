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

export type Team = 0 | 1;
export const TEAM_NAMES = ['Azure', 'Crimson'] as const;
export const otherTeam = (t: Team): Team => (t === 0 ? 1 : 0);
