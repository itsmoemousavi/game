/**
 * Shop items. Pure data: the stats are summed in World.applyHeroStats and the
 * special effects (lifesteal, spell amp, cooldown reduction, ultimate upgrade,
 * consumables, teleport) are applied where they matter.
 */
export type ItemId =
  | 'swiftBoots'
  | 'ironBlade'
  | 'vitalStone'
  | 'manaCrystal'
  | 'quickGloves'
  | 'guardPlate'
  | 'focusLens'
  | 'arcaneAmplifier'
  | 'lifedrinker'
  | 'crownOfAscension'
  | 'healingSalve';

export interface ItemStats {
  damage?: number;
  hp?: number;
  mana?: number;
  manaRegen?: number;
  hpRegen?: number;
  armor?: number;
  /** +% attack speed (attack interval is divided by 1 + pct/100). */
  attackSpeedPct?: number;
  moveSpeedPct?: number;
  /** Ability cooldown reduction, % (does not stack beyond 40%). */
  cdrPct?: number;
  /** Ability damage amplification, %. */
  spellAmpPct?: number;
  /** Attack damage returned as health, %. */
  lifestealPct?: number;
  /** Ultimate upgrade: +25% ultimate effect, −30% ultimate cooldown. */
  ultUpgrade?: boolean;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Short label for the tiny item slot on a phone. */
  short: string;
  cost: number;
  icon: string;
  stats: ItemStats;
  /** Consumables are used from the slot and stack in one slot. */
  consumable?: { maxStack: number };
  summary: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  healingSalve: {
    id: 'healingSalve',
    name: 'Healing Salve',
    short: 'Salve',
    cost: 100,
    icon: '#4ade80',
    stats: {},
    consumable: { maxStack: 3 },
    summary: 'Use: restores 350 health over 8 seconds. Stacks up to 3.',
  },
  swiftBoots: {
    id: 'swiftBoots',
    name: 'Swift Boots',
    short: 'Boots',
    cost: 450,
    icon: '#a3a3a3',
    stats: { moveSpeedPct: 15 },
    summary: '+15% move speed (one pair of boots counts).',
  },
  ironBlade: {
    id: 'ironBlade',
    name: 'Iron Blade',
    short: 'Blade',
    cost: 400,
    icon: '#e5e7eb',
    stats: { damage: 15 },
    summary: '+15 attack damage.',
  },
  vitalStone: {
    id: 'vitalStone',
    name: 'Vital Stone',
    short: 'Vital',
    cost: 450,
    icon: '#ef4444',
    stats: { hp: 220, hpRegen: 1.5 },
    summary: '+220 health, +1.5 health regen.',
  },
  manaCrystal: {
    id: 'manaCrystal',
    name: 'Mana Crystal',
    short: 'Mana',
    cost: 450,
    icon: '#3b82f6',
    stats: { mana: 200, manaRegen: 1.5 },
    summary: '+200 mana, +1.5 mana regen.',
  },
  quickGloves: {
    id: 'quickGloves',
    name: 'Quick Gloves',
    short: 'Gloves',
    cost: 500,
    icon: '#f59e0b',
    stats: { attackSpeedPct: 20 },
    summary: '+20% attack speed.',
  },
  guardPlate: {
    id: 'guardPlate',
    name: 'Guard Plate',
    short: 'Plate',
    cost: 500,
    icon: '#64748b',
    stats: { armor: 5 },
    summary: '+5 armor.',
  },
  focusLens: {
    id: 'focusLens',
    name: 'Focus Lens',
    short: 'Lens',
    cost: 1200,
    icon: '#22d3ee',
    stats: { cdrPct: 15, mana: 150, manaRegen: 1 },
    summary: '−15% ability cooldowns, +150 mana, +1 mana regen.',
  },
  arcaneAmplifier: {
    id: 'arcaneAmplifier',
    name: 'Arcane Amplifier',
    short: 'Amp',
    cost: 1300,
    icon: '#a855f7',
    stats: { spellAmpPct: 15, mana: 150 },
    summary: '+15% ability damage, +150 mana.',
  },
  lifedrinker: {
    id: 'lifedrinker',
    name: 'Lifedrinker',
    short: 'Drink',
    cost: 1100,
    icon: '#be123c',
    stats: { damage: 12, lifestealPct: 15 },
    summary: '+12 damage. Attacks heal for 15% of damage dealt.',
  },
  crownOfAscension: {
    id: 'crownOfAscension',
    name: 'Crown of Ascension',
    short: 'Crown',
    cost: 2600,
    icon: '#facc15',
    stats: { ultUpgrade: true, hp: 200, mana: 200 },
    summary: 'Upgrades your Ultimate: +25% effect, −30% cooldown. +200 health, +200 mana.',
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const INVENTORY_SLOTS = 6;

export const TELEPORT = {
  cost: 50,
  channel: 3,
  cooldown: 60,
  /** Units appear this far from the target building, on its base side. */
  offset: 4.5,
};

/** Buying needs the hero within this distance of their fountain. */
export const SHOP_RADIUS = 22;

export const SALVE = { heal: 350, duration: 8 };

/** Default build orders (also the "recommended" list in the shop). */
export const BUILDS: Record<'brakk' | 'vexa' | 'orin', ItemId[]> = {
  brakk: ['healingSalve', 'swiftBoots', 'vitalStone', 'guardPlate', 'focusLens', 'crownOfAscension', 'vitalStone', 'lifedrinker'],
  vexa: ['healingSalve', 'swiftBoots', 'ironBlade', 'quickGloves', 'lifedrinker', 'crownOfAscension', 'quickGloves', 'ironBlade'],
  orin: ['healingSalve', 'swiftBoots', 'manaCrystal', 'arcaneAmplifier', 'focusLens', 'crownOfAscension', 'vitalStone', 'guardPlate'],
};
