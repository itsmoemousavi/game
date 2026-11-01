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
});

export const STRUCTURES: Record<StructureTier, CombatStats & { teamGold: number }> = {
  tower1: { ...tower(1800, 100), teamGold: 120 },
  tower2: { ...tower(2200, 120), teamGold: 160 },
  shrineTower: { ...tower(2600, 140), teamGold: 200 },
  barracks: { ...tower(2000, 0), attackInterval: 0, attackRange: 0, acquireRange: 0, armor: 10, radius: 3, teamGold: 200 },
  shrine: { ...tower(4500, 0), attackInterval: 0, attackRange: 0, acquireRange: 0, armor: 13, radius: 4.5, teamGold: 0 },
  fountain: {
    ...tower(99999, 300),
    attackInterval: 0.25,
    attackRange: 14,
    acquireRange: 14,
    radius: 3,
    projectileSpeed: 40,
    teamGold: 0,
  },
};
