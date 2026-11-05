/**
 * Hero definitions. Everything about a hero is data so we can rebalance or swap heroes
 * without touching game logic. Ability behaviour lives in ../abilities.ts.
 */
export type HeroId = 'brakk' | 'vexa' | 'orin' | 'syl' | 'grom' | 'kaela' | 'morra' | 'seren' | 'rhen';
export type HeroRole = 'Tank / Initiator' | 'Ranged Carry' | 'Mage / Support' | 'Melee Assassin' | 'Bruiser / Controller' | 'Support / Controller' | 'Summoner' | 'Support / Protector' | 'Mobile Ranged Carry';

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
  | 'maelstrom'
  | 'callPack'
  | 'feralBond'
  | 'redWolf'
  | 'aegis'
  | 'rebuke'
  | 'sanctuary'
  | 'galeStep'
  | 'hawkMark'
  | 'boltStorm';

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
    hpPerLevel: 79,
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
    baseDamage: 38,
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
        values: { damage: [110, 170, 230, 290] },
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
        values: { damage: [295, 435, 570], delay: [1.2, 1.2, 1.2], burnDps: [30, 45, 60], burnDuration: [3, 3, 3] },
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
        values: { damage: [120, 175, 230, 285] },
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
    baseDamage: 64,
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
    attackRange: 9,
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

  morra: {
    id: 'morra',
    name: 'Morra',
    title: 'the Beastcaller',
    role: 'Summoner',
    color: '#b5653a',
    baseHp: 630,
    hpPerLevel: 74,
    hpRegen: 2,
    baseMana: 340,
    manaPerLevel: 34,
    manaRegen: 1.6,
    baseArmor: 3,
    armorPerLevel: 0.38,
    baseDamage: 48,
    damagePerLevel: 3.4,
    attackInterval: 1.6,
    attackIntervalPerLevel: 0.015,
    attackRange: 7,
    projectileSpeed: 17,
    moveSpeed: 6.7,
    abilities: [
      {
        id: 'callPack',
        slot: 'Q',
        name: 'Call the Pack',
        ultimate: false,
        targeting: 'none',
        castRange: 0,
        radius: 0,
        manaCost: [90, 100, 110, 120],
        cooldown: [20, 18, 16, 14],
        values: { wolves: [1, 1, 2, 2], hp: [325, 405, 430, 520], damage: [25, 32, 34, 43], duration: [35, 35, 35, 35] },
        summary: 'Calls a wolf (two from level 3) that stays by you for 35 s, attacks whatever you attack and turns on whoever hits you. Calling again replaces the old pack. Enemies earn a little gold for killing them. Wolves deal half damage to buildings.',
      },
      {
        id: 'feralBond',
        slot: 'W',
        name: 'Feral Bond',
        ultimate: false,
        targeting: 'none',
        castRange: 0,
        radius: 14,
        manaCost: [60, 70, 80, 90],
        cooldown: [16, 15, 14, 13],
        values: { heal: [20, 28, 36, 44], damageMult: [1.2, 1.3, 1.4, 1.5], speedPct: [25, 25, 30, 30], duration: [5, 5, 6, 6] },
        summary: 'Your wolves within 14 m heal part of their health and hit harder and run faster for a few seconds. Morra also gets the speed, unless she is the Red Wolf.',
      },
      {
        id: 'redWolf',
        slot: 'R',
        name: 'Red Wolf',
        ultimate: true,
        targeting: 'none',
        castRange: 0,
        radius: 0,
        manaCost: [100, 120, 140],
        cooldown: [75, 65, 55],
        values: { duration: [14, 14, 14], attackSpeed: [45, 65, 85], damage: [35, 60, 85], critChance: [10, 15, 20], speedPct: [30, 35, 40] },
        summary: 'Morra becomes a big red wolf for 14 s: she fights in melee, with more attack speed, damage and move speed and a small chance of critical hits. Feral Bond no longer speeds her up while she is the wolf.',
      },
    ],
  },
  seren: {
    id: 'seren',
    name: 'Seren',
    title: 'the Aegis',
    role: 'Support / Protector',
    color: '#cfe4ee',
    baseHp: 700,
    hpPerLevel: 82,
    hpRegen: 3,
    baseMana: 300,
    manaPerLevel: 30,
    manaRegen: 1.4,
    baseArmor: 5,
    armorPerLevel: 0.5,
    baseDamage: 54,
    damagePerLevel: 3.4,
    attackInterval: 1.55,
    attackIntervalPerLevel: 0.018,
    attackRange: 1.7,
    projectileSpeed: 0,
    moveSpeed: 6.8,
    abilities: [
      {
        id: 'aegis',
        slot: 'Q',
        name: 'Aegis',
        ultimate: false,
        targeting: 'ally',
        castRange: 11,
        radius: 0,
        manaCost: [70, 80, 90, 100],
        cooldown: [12, 11, 10, 9],
        values: { shield: [150, 235, 320, 400], duration: [3, 3, 3, 3] },
        summary: 'Shields an allied hero or yourself: the shield soaks up damage for 3 s or until it breaks.',
      },
      {
        id: 'rebuke',
        slot: 'W',
        name: 'Rebuke',
        ultimate: false,
        targeting: 'direction',
        castRange: 11,
        radius: 1.3,
        manaCost: [80, 90, 100, 110],
        cooldown: [11, 10, 9, 8],
        values: { damage: [95, 150, 205, 260], slowPct: [30, 35, 40, 45] },
        summary: 'A lance of light flies forward through enemies, damaging and slowing all it hits.',
      },
      {
        id: 'sanctuary',
        slot: 'R',
        name: 'Sanctuary',
        ultimate: true,
        targeting: 'point',
        castRange: 10,
        radius: 6,
        manaCost: [150, 180, 210],
        cooldown: [85, 75, 65],
        values: { reduction: [45, 55, 65], duration: [4, 5, 6], slowPct: [30, 30, 30] },
        summary: 'Raises a golden dome: allied heroes inside take much less damage and enemies inside are slowed.',
      },
    ],
  },
  rhen: {
    id: 'rhen',
    name: 'Rhen',
    title: 'the Galewalker',
    role: 'Mobile Ranged Carry',
    color: '#9aa84e',
    baseHp: 610,
    hpPerLevel: 70,
    hpRegen: 1.8,
    baseMana: 240,
    manaPerLevel: 24,
    manaRegen: 1,
    baseArmor: 3.2,
    armorPerLevel: 0.38,
    baseDamage: 47,
    damagePerLevel: 4,
    attackInterval: 1.45,
    attackIntervalPerLevel: 0.024,
    attackRange: 8.5,
    projectileSpeed: 26,
    moveSpeed: 7.1,
    abilities: [
      {
        id: 'galeStep',
        slot: 'Q',
        name: 'Gale Step',
        ultimate: false,
        targeting: 'direction',
        castRange: 7,
        radius: 0.8,
        manaCost: [60, 65, 70, 75],
        cooldown: [14, 12, 10, 8],
        values: { attackSpeed: [25, 35, 45, 55], duration: [3, 3, 3, 3] },
        summary: 'Dashes on the wind, then shoots faster for 3 s.',
      },
      {
        id: 'hawkMark',
        slot: 'W',
        name: 'Hawk Mark',
        ultimate: false,
        targeting: 'enemy',
        castRange: 11,
        radius: 0,
        manaCost: [55, 65, 75, 85],
        cooldown: [14, 13, 12, 11],
        values: { armor: [3, 5, 7, 9], duration: [5, 5, 6, 6] },
        summary: 'Marks an enemy: it loses armor and everyone on your team can see it, even if it turns invisible.',
      },
      {
        id: 'boltStorm',
        slot: 'R',
        name: 'Bolt Storm',
        ultimate: true,
        targeting: 'none',
        castRange: 0,
        radius: 11,
        manaCost: [140, 170, 200],
        cooldown: [75, 65, 55],
        values: { damage: [58, 80, 102], duration: [3, 3.5, 4] },
        summary: 'For a few seconds, fires a stream of bolts at nearby enemies while you keep moving and attacking. Heroes are shot first.',
      },
    ],
  },
};

export const HERO_IDS: HeroId[] = ['brakk', 'vexa', 'orin', 'syl', 'grom', 'kaela', 'morra', 'seren', 'rhen'];

/** Highest level an ability may have at a given hero level (Dota-style). */
export function maxAbilityLevel(def: AbilityDef, heroLevel: number): number {
  if (def.ultimate) return heroLevel >= 14 ? 3 : heroLevel >= 10 ? 2 : heroLevel >= 6 ? 1 : 0;
  return Math.min(4, Math.ceil(heroLevel / 2));
}
