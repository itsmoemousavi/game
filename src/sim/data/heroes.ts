/**
 * Hero definitions. Everything about a hero is data so we can rebalance or swap heroes
 * without touching game logic. Ability behaviour lives in ../abilities.ts.
 */
export type HeroId = 'brakk' | 'vexa' | 'orin' | 'syl' | 'grom' | 'kaela';
export type HeroRole = 'Tank / Initiator' | 'Ranged Carry' | 'Mage / Support' | 'Melee Assassin' | 'Bruiser / Controller' | 'Support / Controller';

export type AbilityId =
  | 'shieldCharge'
  | 'ironHide'
  | 'earthsplitter'
  | 'piercingArrow'
  | 'huntersRhythm'
  | 'arrowStorm'
  | 'fireball'
  | 'mendingFlame'
  | 'cataclysm'
  | 'shadowLunge'
  | 'veil'
  | 'execution'
  | 'rootSnare'
  | 'barkSkin'
  | 'overgrowth'
  | 'tidalWave'
  | 'brineVeil'
  | 'maelstrom';

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
    baseHp: 680,
    hpPerLevel: 82,
    hpRegen: 3,
    baseMana: 250,
    manaPerLevel: 25,
    manaRegen: 1,
    baseArmor: 4,
    armorPerLevel: 0.45,
    baseDamage: 50,
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
        values: { block: [4, 7, 10, 13], lowHpArmor: [2, 3, 4, 5] },
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
        values: { damage: [175, 260, 345], stun: [1.3, 1.6, 1.9], windup: [0.6, 0.6, 0.6] },
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
    baseHp: 510,
    hpPerLevel: 62,
    hpRegen: 1.5,
    baseMana: 300,
    manaPerLevel: 30,
    manaRegen: 1.2,
    baseArmor: 2,
    armorPerLevel: 0.5,
    baseDamage: 36,
    damagePerLevel: 3,
    attackInterval: 1.5,
    attackIntervalPerLevel: 0.025,
    attackRange: 7,
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
        values: { damage: [80, 135, 190, 245] },
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
        values: { critMult: [1.3, 1.45, 1.6, 1.75], speedPct: [10, 13, 16, 20] },
        summary: 'Passive. Every 4th attack is a critical hit (not on buildings) and grants a burst of move speed.',
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
        values: { dps: [60, 90, 120], slowPct: [30, 35, 40], duration: [3, 3, 3] },
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
    baseHp: 660,
    hpPerLevel: 72,
    hpRegen: 1.5,
    baseMana: 450,
    manaPerLevel: 50,
    manaRegen: 2.4,
    baseArmor: 2,
    armorPerLevel: 0.3,
    baseDamage: 47,
    damagePerLevel: 3,
    attackInterval: 1.5,
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
        targeting: 'direction',
        castRange: 13,
        radius: 3,
        manaCost: [90, 100, 110, 120],
        cooldown: [7, 7, 7, 7],
        values: { damage: [115, 180, 240, 305] },
        summary: 'Hurls a fireball in a direction. It explodes on the first enemy hit (or at max range), damaging everything nearby.',
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
        values: { heal: [160, 240, 320, 400], duration: [4, 4, 4, 4] },
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
        values: { damage: [315, 460, 600], delay: [1.2, 1.2, 1.2], burnDps: [30, 45, 60], burnDuration: [3, 3, 3] },
        summary: 'Calls a meteor on an area. After 1.5s it lands for massive damage and leaves burning ground.',
      },
    ],
  },
  syl: {
    id: 'syl',
    name: 'Syl',
    title: 'the Shadeblade',
    role: 'Melee Assassin',
    color: '#a78bfa',
    baseHp: 660,
    hpPerLevel: 90,
    hpRegen: 1.8,
    baseMana: 280,
    manaPerLevel: 28,
    manaRegen: 1.1,
    baseArmor: 5,
    armorPerLevel: 0.5,
    baseDamage: 58,
    damagePerLevel: 4.3,
    attackInterval: 1.3,
    attackIntervalPerLevel: 0.03,
    attackRange: 1.5,
    projectileSpeed: 0,
    moveSpeed: 7.4,
    abilities: [
      {
        id: 'shadowLunge',
        slot: 'Q',
        name: 'Shadow Lunge',
        ultimate: false,
        targeting: 'enemy',
        castRange: 8,
        radius: 0,
        manaCost: [70, 75, 80, 85],
        cooldown: [11, 10, 9, 8],
        values: { damage: [112, 167, 222, 277] },
        summary: 'Leaps to an enemy and strikes it.',
      },
      {
        id: 'veil',
        slot: 'W',
        name: 'Veil',
        ultimate: false,
        targeting: 'none',
        castRange: 0,
        radius: 0,
        manaCost: [60, 60, 60, 60],
        cooldown: [16, 15, 14, 13],
        values: { duration: [3, 3.5, 4, 4.5], speedPct: [15, 20, 25, 30] },
        summary: 'Turns invisible and faster for a few seconds. Attacking or casting reveals Syl.',
      },
      {
        id: 'execution',
        slot: 'R',
        name: 'Execution',
        ultimate: true,
        targeting: 'enemy',
        castRange: 4,
        radius: 0,
        manaCost: [120, 140, 160],
        cooldown: [60, 50, 40],
        values: { damage: [175, 275, 375], missingPct: [35, 45, 55] },
        summary: 'A finishing blow: base damage plus a share of the health the target is missing.',
      },
    ],
  },
  grom: {
    id: 'grom',
    name: 'Grom',
    title: 'the Ironroot',
    role: 'Bruiser / Controller',
    color: '#65a30d',
    baseHp: 800,
    hpPerLevel: 90,
    hpRegen: 3.2,
    baseMana: 240,
    manaPerLevel: 24,
    manaRegen: 1,
    baseArmor: 4,
    armorPerLevel: 0.45,
    baseDamage: 60,
    damagePerLevel: 4.4,
    attackInterval: 1.6,
    attackIntervalPerLevel: 0.02,
    attackRange: 1.6,
    projectileSpeed: 0,
    moveSpeed: 6.8,
    abilities: [
      {
        id: 'rootSnare',
        slot: 'Q',
        name: 'Root Snare',
        ultimate: false,
        targeting: 'point',
        castRange: 10,
        radius: 3,
        manaCost: [90, 95, 100, 105],
        cooldown: [12, 11, 10, 9],
        values: { damage: [90, 145, 200, 255], stun: [1.2, 1.5, 1.8, 2.1] },
        summary: 'Roots grab enemies in an area after a short moment: damage and they can’t move or act.',
      },
      {
        id: 'barkSkin',
        slot: 'W',
        name: 'Bark Skin',
        ultimate: false,
        targeting: 'none',
        castRange: 0,
        radius: 0,
        manaCost: [60, 60, 60, 60],
        cooldown: [18, 17, 16, 15],
        values: { armor: [6, 8, 10, 12], regen: [8, 12, 16, 20], duration: [6, 6, 6, 6] },
        summary: 'Hardens Grom’s skin: bonus armor and fast health regeneration for 6 seconds.',
      },
      {
        id: 'overgrowth',
        slot: 'R',
        name: 'Overgrowth',
        ultimate: true,
        targeting: 'none',
        castRange: 0,
        radius: 7.5,
        manaCost: [150, 175, 200],
        cooldown: [85, 75, 65],
        values: { stun: [2, 2.5, 3], dps: [50, 75, 100], duration: [3, 3, 3] },
        summary: 'Vines burst out around Grom: every enemy nearby is rooted, then takes damage over time.',
      },
    ],
  },
  kaela: {
    id: 'kaela',
    name: 'Kaela',
    title: 'the Tidecaller',
    role: 'Support / Controller',
    color: '#06b6d4',
    baseHp: 580,
    hpPerLevel: 74,
    hpRegen: 1.5,
    baseMana: 420,
    manaPerLevel: 48,
    manaRegen: 2,
    baseArmor: 3,
    armorPerLevel: 0.3,
    baseDamage: 46,
    damagePerLevel: 3,
    attackInterval: 1.6,
    attackIntervalPerLevel: 0.02,
    attackRange: 8.5,
    projectileSpeed: 18,
    moveSpeed: 6.9,
    abilities: [
      {
        id: 'tidalWave',
        slot: 'Q',
        name: 'Tidal Wave',
        ultimate: false,
        targeting: 'direction',
        castRange: 14,
        radius: 1.5,
        manaCost: [90, 100, 110, 120],
        cooldown: [8, 8, 8, 8],
        values: { damage: [120, 180, 240, 300], slowPct: [40, 40, 40, 40] },
        summary: 'Sends a wave in a line: damages and slows every enemy it hits.',
      },
      {
        id: 'brineVeil',
        slot: 'W',
        name: 'Brine Veil',
        ultimate: false,
        targeting: 'ally',
        castRange: 10,
        radius: 0,
        manaCost: [80, 85, 90, 95],
        cooldown: [14, 13, 12, 11],
        values: { heal: [100, 150, 200, 250], armor: [4, 6, 8, 10], speedPct: [15, 15, 15, 15] },
        summary: 'Heals an ally (or Kaela) and gives bonus armor and speed for 5 seconds.',
      },
      {
        id: 'maelstrom',
        slot: 'R',
        name: 'Maelstrom',
        ultimate: true,
        targeting: 'point',
        castRange: 14,
        radius: 6,
        manaCost: [150, 175, 200],
        cooldown: [70, 60, 50],
        values: { dps: [65, 100, 135], slowPct: [50, 50, 50], duration: [4, 4, 4] },
        summary: 'A whirlpool rages over an area for 4 seconds: damage and a heavy slow.',
      },
    ],
  },

};

export const HERO_IDS: HeroId[] = ['brakk', 'vexa', 'orin', 'syl', 'grom', 'kaela'];

/** Highest level an ability may have at a given hero level (Dota-style). */
export function maxAbilityLevel(def: AbilityDef, heroLevel: number): number {
  if (def.ultimate) return heroLevel >= 14 ? 3 : heroLevel >= 10 ? 2 : heroLevel >= 6 ? 1 : 0;
  return Math.min(4, Math.ceil(heroLevel / 2));
}
