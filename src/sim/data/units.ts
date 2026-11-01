import { StructureTier } from '../map';

export interface CombatStats {
  hp: number;
  armor: number;
  damage: number;
  /** Seconds between attacks; 0 = cannot attack. */
  attackInterval: number;
  attackRange: number;
  projectileSpeed: number;
  moveSpeed: number;
  radius: number;
  /** Distance at which the unit notices enemies. */
  acquireRange: number;
  bountyGold: number;
  bountyXp: number;
  /** Vision radius (meters) by day and by night. */
  vision?: [number, number];
}

export const CREEPS: Record<'melee' | 'ranged', CombatStats> = {
  melee: {
    hp: 550,
    armor: 2,
    damage: 21,
    attackInterval: 1,
    attackRange: 1.2,
    projectileSpeed: 0,
    moveSpeed: 5.5,
    radius: 0.8,
    acquireRange: 8,
    bountyGold: 38,
    bountyXp: 57,
    vision: [11, 8],
  },
  ranged: {
    hp: 300,
    armor: 0,
    damage: 24,
    attackInterval: 1,
    attackRange: 8,
    projectileSpeed: 18,
    moveSpeed: 5.5,
    radius: 0.7,
    acquireRange: 9,
    bountyGold: 48,
    bountyXp: 69,
    vision: [11, 8],
  },
};

/** Multiplier applied to creeps of a lane whose enemy barracks has fallen. */
export const SUPER_CREEP_MULT = { hp: 1.6, damage: 1.6, gold: 0.6 };

const tower = (hp: number, damage: number): CombatStats => ({
  hp,
  armor: 12,
  damage,
  attackInterval: 1,
  attackRange: 11,
  projectileSpeed: 26,
  moveSpeed: 0,
  radius: 2.2,
  acquireRange: 11,
  bountyGold: 0,
  bountyXp: 0,
  vision: [15, 13],
});

export const STRUCTURES: Record<StructureTier, CombatStats & { teamGold: number }> = {
  tower1: { ...tower(1400, 100), teamGold: 140 },
  tower2: { ...tower(1700, 120), teamGold: 180 },
  shrineTower: { ...tower(1700, 140), teamGold: 220 },
  barracks: { ...tower(1500, 0), attackInterval: 0, attackRange: 0, acquireRange: 0, armor: 10, radius: 3, teamGold: 200 },
  shrine: { ...tower(3000, 0), attackInterval: 0, attackRange: 0, acquireRange: 0, armor: 13, radius: 4.5, teamGold: 0 },
  fountain: {
    ...tower(99999, 300),
    attackInterval: 0.25,
    attackRange: 14,
    acquireRange: 14,
    radius: 3,
    projectileSpeed: 40,
    vision: [20, 20],
    teamGold: 0,
  },
};

/** Jungle monsters: passive until attacked, then fight and leash back to camp. */
export const NEUTRALS: Record<'brute' | 'imp', CombatStats> = {
  brute: {
    hp: 700,
    armor: 3,
    damage: 30,
    attackInterval: 1.2,
    attackRange: 1.3,
    projectileSpeed: 0,
    moveSpeed: 5.5,
    radius: 1.1,
    acquireRange: 0,
    bountyGold: 60,
    bountyXp: 75,
  },
  imp: {
    hp: 380,
    armor: 1,
    damage: 18,
    attackInterval: 1,
    attackRange: 1.1,
    projectileSpeed: 0,
    moveSpeed: 5.5,
    radius: 0.75,
    acquireRange: 0,
    bountyGold: 35,
    bountyXp: 45,
  },
};

/** The river boss: tough, hits hard, drops a revive charm for the team that kills it. */
export const BOSS: CombatStats = {
  hp: 6500,
  armor: 8,
  damage: 80,
  attackInterval: 1.3,
  attackRange: 1.8,
  projectileSpeed: 0,
  moveSpeed: 5,
  radius: 2,
  acquireRange: 0,
  bountyGold: 250,
  bountyXp: 400,
};

export const WARDS: Record<'observer' | 'sentry', CombatStats> = {
  observer: {
    hp: 200,
    armor: 0,
    damage: 0,
    attackInterval: 0,
    attackRange: 0,
    projectileSpeed: 0,
    moveSpeed: 0,
    radius: 0.6,
    acquireRange: 0,
    bountyGold: 50,
    bountyXp: 50,
    vision: [16, 12],
  },
  sentry: {
    hp: 200,
    armor: 0,
    damage: 0,
    attackInterval: 0,
    attackRange: 0,
    projectileSpeed: 0,
    moveSpeed: 0,
    radius: 0.6,
    acquireRange: 0,
    bountyGold: 25,
    bountyXp: 25,
    vision: [3, 3],
  },
};

export const HERO_VISION: [number, number] = [17, 10];
