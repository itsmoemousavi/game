/**
 * Hero definitions. Everything about a hero is data so we can rebalance or swap heroes
 * without touching game logic. Abilities are described here and will be implemented
 * in milestone 3 (see docs/DESIGN.md).
 */
export type HeroId = 'brakk' | 'vexa' | 'orin';
export type HeroRole = 'Tank / Initiator' | 'Ranged Carry' | 'Mage / Support';

export interface AbilityDef {
  slot: 'Q' | 'W' | 'R';
  name: string;
  kind: 'active' | 'passive';
  ultimate: boolean;
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
        slot: 'Q',
        name: 'Shield Charge',
        kind: 'active',
        ultimate: false,
        summary: 'Dashes forward, damaging and stunning the first enemy hero hit.',
      },
      {
        slot: 'W',
        name: 'Iron Hide',
        kind: 'passive',
        ultimate: false,
        summary: 'Blocks a flat amount of damage from every attack; bonus armor when below 50% health.',
      },
      {
        slot: 'R',
        name: 'Earthsplitter',
        kind: 'active',
        ultimate: true,
        summary: 'After a short wind-up, slams the ground: big area damage and stun around Brakk.',
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
        slot: 'Q',
        name: 'Piercing Arrow',
        kind: 'active',
        ultimate: false,
        summary: 'Fires a long skillshot arrow that damages every enemy in a line.',
      },
      {
        slot: 'W',
        name: "Hunter's Rhythm",
        kind: 'passive',
        ultimate: false,
        summary: 'Every 4th attack deals critical damage and briefly grants move speed.',
      },
      {
        slot: 'R',
        name: 'Arrow Storm',
        kind: 'active',
        ultimate: true,
        summary: 'Rains arrows on a target area for 3s, damaging and slowing enemies inside.',
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
        slot: 'Q',
        name: 'Fireball',
        kind: 'active',
        ultimate: false,
        summary: 'Hurls a fireball at a target; explodes for area damage.',
      },
      {
        slot: 'W',
        name: 'Mending Flame',
        kind: 'active',
        ultimate: false,
        summary: 'Heals an allied hero (or self) over 4 seconds.',
      },
      {
        slot: 'R',
        name: 'Cataclysm',
        kind: 'active',
        ultimate: true,
        summary: 'Calls a meteor on a target area; after 1.5s it lands for massive damage and leaves burning ground.',
      },
    ],
  },
};

export const HERO_IDS: HeroId[] = ['brakk', 'vexa', 'orin'];
