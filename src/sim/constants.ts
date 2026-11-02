/** Simulation runs on a fixed clock so it is deterministic and can later run on a server. */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

/** World is MAP_SIZE x MAP_SIZE "meters". The walk grid uses CELL-sized cells. */
export const MAP_SIZE = 300;
export const CELL = 2;
export const GRID = MAP_SIZE / CELL;

export const FIRST_WAVE_TIME = 3;
export const CREEP_WAVE_INTERVAL = 30;
export const MELEE_PER_WAVE = 3;
/** Lane creeps gain this much HP and damage every 5 minutes (like Dota's creep upgrades). */
export const CREEP_GROWTH_PER_5MIN = 0.3;
export const RANGED_PER_WAVE = 1;

export const STARTING_GOLD = 600;
export const PASSIVE_GOLD_PER_SEC = 3;
export const XP_SHARE_RADIUS = 30;
export const FOUNTAIN_HEAL_RADIUS = 16;
export const MAX_LEVEL = 15;
/** Ultimate ability becomes learnable at this hero level. */
export const ULTIMATE_LEVEL = 6;

/** Cumulative XP required to reach level index+1 (index 0 = level 1). */
/** Tuned for 15–20 minute matches (level 6 around minute 5, max level around minute 18). */
export const XP_TABLE = [0, 200, 500, 900, 1350, 1850, 2400, 3000, 3650, 4350, 5100, 5900, 6750, 7650, 8600];

/** Day/night cycle: night shrinks vision (fog of war). Matches start at dawn. */
export const DAY_SECONDS = 180;
export const NIGHT_SECONDS = 120;
/** Fog-of-war grid updates this many times per second. */
export const VISION_HZ = 10;

/** Neutral camps (re)spawn on every full minute when empty. */
export const CAMP_FIRST_SPAWN = 30;
export const CAMP_RESPAWN = 60;
export const NEUTRAL_LEASH = 11;

/** Power-ups (runes): first at 1:00, then every 2 minutes, at one of the two river spots. */
export const RUNE_FIRST = 60;
export const RUNE_INTERVAL = 120;
/** The boss returns this long after it dies. */
export const BOSS_RESPAWN = 300;
/** Revive charm from the boss lasts this long; reviving takes REVIVE_DELAY. */
export const CHARM_DURATION = 300;
/** The Warden chases attackers at most this far from the middle of its house. */
export const WARDEN_LEASH = 17;
/** Ground slam: every WARDEN_SLAM_INTERVAL s while fighting, after a short wind-up, it stuns everyone close by. */
export const WARDEN_SLAM = { interval: 8, windup: 0.8, radius: 5, stun: 1.5, damage: 120 };
/** Gold for the Warden: the hero who lands the killing blow gets it all, teammates get half. */
export const WARDEN_GOLD = 300;
export const REVIVE_DELAY = 3;

export const BUYBACK_COOLDOWN = 300;
export const buybackCost = (level: number, minutes: number) => Math.round(150 + level * 30 + minutes * 8);

/** Team tower shield ("glyph"): all your buildings invulnerable for a few seconds. */
export const GLYPH_COOLDOWN = 300;
export const GLYPH_DURATION = 5;

/**
 * Backdoor protection (inner towers, barracks, shrine towers, shrine — not tier-1 towers):
 * with no enemy creeps nearby they take much less damage, and regenerate for a while after
 * being hit that way.
 */
export const BACKDOOR_RADIUS = 18;
export const BACKDOOR_DAMAGE_MULT = 0.25;
export const BACKDOOR_REGEN = 40;

/** Denying: last-hit your own creeps below this HP fraction (towers below DENY_TOWER). */
export const DENY_CREEP = 0.5;
export const DENY_TOWER = 0.1;
/** Enemy heroes still get this share of XP from a denied creep (and no gold). */
export const DENY_XP_SHARE = 0.3;

export const WARD_DURATION = 360;
export const WARD_CAST_RANGE = 7;
/** Sentry wards reveal invisible enemies (wards, invisible heroes) in this radius. */
export const TRUE_SIGHT_RADIUS = 10;

/** Attacks from lower ground onto higher ground miss this often. */
export const UPHILL_MISS_CHANCE = 0.25;

/** Kills this close together count as a multi-kill (double, triple...). */
export const MULTI_KILL_WINDOW = 10;

/** Gold lost on death: base + share of net worth (only from unspent gold). */
export const DEATH_GOLD = { base: 25, share: 0.025 };

export type Team = 0 | 1;
/** Side a unit belongs to: a team, or 2 for neutral jungle monsters. */
export type Side = Team | 2;
export const NEUTRAL: Side = 2;
export const TEAM_NAMES = ['Azure', 'Crimson'] as const;
export const otherTeam = (t: Team): Team => (t === 0 ? 1 : 0);
