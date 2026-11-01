/**
 * Hero definitions. Everything about a hero is data so we can rebalance or swap heroes
 * without touching game logic. Ability behaviour lives in ../abilities.ts.
 */
export type HeroId = 'brakk' | 'vexa' | 'orin';
export type HeroRole = 'Tank / Initiator' | 'Ranged Carry' | 'Mage / Support';

export type AbilityId =
  | 'shieldCharge'
  | 'ironHide'
  | 'earthsplitter'
  | 'piercingArrow'
  | 'huntersRhythm'
  | 'arrowStorm'
  | 'fireball'
  | 'mendingFlame'
  | 'cataclysm';

/**
 * How an ability is aimed.
 *  - none:      instant, centred on the caster
 *  - direction: skillshot / dash toward a point (range = max travel)
 *  - point:     ground-targeted area within cast range
 *  - enemy:     targets an enemy unit
 *  - ally:      targets an allied hero (or self)
 *  - passive:   always on
 */
export type Targeting = 'none' | 'direction' | 'point' | 'enemy' | 'ally' | 'passive';

export interface AbilityDef {
  id: AbilityId;
  slot: 'Q' | 'W' | 'R';
  name: string;
  ultimate: boolean;
  targeting: Targeting;
  castRange: number;
  /** Radius (areas) or width (lines) used for the aim indicator. */
  radius: number;
  /** Per ability level (index 0 = level 1). */
  manaCost: number[];
  cooldown: number[];
  values: Record<string, number[]>;
  summary: string;
}

export interface HeroDef {
  id: HeroId;
  name: string;
  title: string;
  role: HeroRole;
  color: string;
  baseHp: number;
  hpPerLevel: number;
  hpRegen: number;
  baseMana: number;
  manaPerLevel: number;
  manaRegen: number;
  baseArmor: number;
  armorPerLevel: number;
  baseDamage: number;
  damagePerLevel: number;
  /** Seconds between attacks at level 1. */
  attackInterval: number;
  attackIntervalPerLevel: number;
  /** Edge-to-edge reach in meters. */
  attackRange: number;
  /** 0 = melee (instant hit). */
  projectileSpeed: number;
  moveSpeed: number;
  abilities: [AbilityDef, AbilityDef, AbilityDef];
}

export const HEROES: Record<HeroId, HeroDef> = {
  brakk: {
    id: 'brakk',
    name: 'Brakk',
    title: 'the Bulwark',
    role: 'Tank / Initiator',
    color: '#c9a227',
    baseHp: 720,
    hpPerLevel: 95,
    hpRegen: 3,
    baseMana: 250,
    manaPerLevel: 25,
    manaRegen: 1,
    baseArmor: 4,
    armorPerLevel: 0.45,
    baseDamage: 54,
    damagePerLevel: 3.5,
    attackInterval: 1.5,
    attackIntervalPerLevel: 0.02,
    attackRange: 1.6,
    projectileSpeed: 0,
    moveSpeed: 7,
    abilities: [
      {
        id: 'shieldCharge',
        slot: 'Q',
        name: 'Shield Charge',
        ultimate: false,
        targeting: 'direction',
        castRange: 10,
        radius: 1.6,
        manaCost: [80, 85, 90, 95],
        cooldown: [13, 12, 11, 10],
        values: { damage: [70, 110, 150, 190], stun: [1, 1.2, 1.4, 1.6] },
        summary: 'Dashes forward, damaging enemies in the way. Stops at the first enemy hero and stuns it.',
      },
      {
        id: 'ironHide',
        slot: 'W',
        name: 'Iron Hide',
        ultimate: false,
        targeting: 'passive',
        castRange: 0,
        radius: 0,
        manaCost: [0, 0, 0, 0],
        cooldown: [0, 0, 0, 0],
        values: { block: [10, 18, 26, 34], lowHpArmor: [4, 6, 8, 10] },
        summary: 'Passive. Blocks flat damage from every attack. Bonus armor while below 50% health.',
      },
      {
        id: 'earthsplitter',
        slot: 'R',
        name: 'Earthsplitter',
        ultimate: true,
        targeting: 'none',
        castRange: 0,
        radius: 7,
        manaCost: [150, 175, 200],
        cooldown: [80, 70, 60],
        values: { damage: [200, 300, 400], stun: [1.5, 1.8, 2.1], windup: [0.6, 0.6, 0.6] },
        summary: 'After a short wind-up, slams the ground: damages and stuns all enemies around Brakk.',
      },
    ],
  },
  vexa: {
    id: 'vexa',
    name: 'Vexa',
    title: 'the Gale Archer',
    role: 'Ranged Carry',
    color: '#3fbf7f',
    baseHp: 540,
    hpPerLevel: 72,
    hpRegen: 1.5,
    baseMana: 300,
    manaPerLevel: 30,
    manaRegen: 1.2,
    baseArmor: 2,
    armorPerLevel: 0.5,
    baseDamage: 50,
    damagePerLevel: 4.5,
    attackInterval: 1.4,
    attackIntervalPerLevel: 0.035,
    attackRange: 10,
    projectileSpeed: 24,
    moveSpeed: 7.2,
    abilities: [
      {
        id: 'piercingArrow',
        slot: 'Q',
        name: 'Piercing Arrow',
        ultimate: false,
        targeting: 'direction',
        castRange: 18,
        radius: 1.2,
        manaCost: [90, 95, 100, 105],
        cooldown: [10, 9, 8, 7],
        values: { damage: [90, 150, 210, 270] },
        summary: 'Fires a long arrow that damages every enemy in a line.',
      },
      {
        id: 'huntersRhythm',
        slot: 'W',
        name: "Hunter's Rhythm",
        ultimate: false,
        targeting: 'passive',
        castRange: 0,
        radius: 0,
        manaCost: [0, 0, 0, 0],
        cooldown: [0, 0, 0, 0],
        values: { critMult: [1.4, 1.6, 1.8, 2.0], speedPct: [15, 20, 25, 30] },
        summary: 'Passive. Every 4th attack is a critical hit and grants a burst of move speed.',
      },
      {
        id: 'arrowStorm',
        slot: 'R',
        name: 'Arrow Storm',
        ultimate: true,
        targeting: 'point',
        castRange: 14,
        radius: 6,
        manaCost: [125, 150, 175],
        cooldown: [70, 60, 50],
        values: { dps: [70, 105, 140], slowPct: [30, 35, 40], duration: [3, 3, 3] },
        summary: 'Rains arrows on an area for 3 seconds, damaging and slowing enemies inside.',
      },
    ],
  },
  orin: {
    id: 'orin',
    name: 'Orin',
    title: 'the Emberseer',
    role: 'Mage / Support',
    color: '#e0703a',
    baseHp: 500,
    hpPerLevel: 66,
    hpRegen: 1.5,
    baseMana: 450,
    manaPerLevel: 50,
    manaRegen: 2,
    baseArmor: 1,
    armorPerLevel: 0.3,
    baseDamage: 44,
    damagePerLevel: 3,
    attackInterval: 1.6,
    attackIntervalPerLevel: 0.02,
    attackRange: 9,
    projectileSpeed: 18,
    moveSpeed: 6.8,
    abilities: [
      {
        id: 'fireball',
        slot: 'Q',
        name: 'Fireball',
        ultimate: false,
        targeting: 'enemy',
        castRange: 11,
        radius: 3,
        manaCost: [90, 100, 110, 120],
        cooldown: [8, 8, 8, 8],
        values: { damage: [80, 130, 180, 230] },
        summary: 'Hurls a fireball at an enemy; it explodes, damaging everything nearby.',
      },
      {
        id: 'mendingFlame',
        slot: 'W',
        name: 'Mending Flame',
        ultimate: false,
        targeting: 'ally',
        castRange: 10,
        radius: 0,
        manaCost: [80, 90, 100, 110],
        cooldown: [14, 13, 12, 11],
        values: { heal: [120, 180, 240, 300], duration: [4, 4, 4, 4] },
        summary: 'Heals an allied hero (or Orin) over 4 seconds.',
      },
      {
        id: 'cataclysm',
        slot: 'R',
        name: 'Cataclysm',
        ultimate: true,
        targeting: 'point',
        castRange: 15,
        radius: 5,
        manaCost: [175, 225, 275],
        cooldown: [90, 80, 70],
        values: { damage: [250, 375, 500], delay: [1.5, 1.5, 1.5], burnDps: [30, 45, 60], burnDuration: [3, 3, 3] },
        summary: 'Calls a meteor on an area. After 1.5s it lands for massive damage and leaves burning ground.',
      },
    ],
  },
};

export const HERO_IDS: HeroId[] = ['brakk', 'vexa', 'orin'];

/** Highest level an ability may have at a given hero level (Dota-style). */
export function maxAbilityLevel(def: AbilityDef, heroLevel: number): number {
  if (def.ultimate) return heroLevel >= 14 ? 3 : heroLevel >= 10 ? 2 : heroLevel >= 6 ? 1 : 0;
  return Math.min(4, Math.ceil(heroLevel / 2));
}
