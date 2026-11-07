import { AbilityDef, ITEMS, ItemId, Unit, effectiveCooldown } from '../sim';
import type { ItemStats } from '../sim/data/items';

/**
 * The one layout for every item and spell description: name, mana per level, cooldown per level, then "Stats",
 * then "Active" or "Passive". The current level is bold and bright, the other levels plain.
 */

const num = (v: number) => String(Math.round(v * 10) / 10);

/** 25/35/45/55 with the current level marked. All levels the same: just the one number. */
export function perLevel(vals: number[], level: number, fmt = num): string {
  if (vals.every((v) => v === vals[0])) return `<span class="lv${level > 0 ? ' cur' : ''}">${fmt(vals[0])}</span>`;
  return vals.map((v, i) => `<span class="lv${i === level - 1 ? ' cur' : ''}">${fmt(v)}</span>`).join('<span class="sl">/</span>');
}

const line = (label: string, value: string) => `<div class="c-line"><span>${label}</span><b>${value}</b></div>`;
const section = (title: string, body: string) => `<h4 class="c-head">${title}</h4>${body}`;

/** Each stat of an item, as a line: "+45 Damage". In this order, attack first. */
const STAT_LINES: [keyof ItemStats, (v: number) => string][] = [
  ['damage', (v) => `+${v} Damage`],
  ['attackSpeedPct', (v) => `+${v}% Attack speed`],
  ['attackRange', (v) => `+${v} m Attack range`],
  ['critChance', (v) => `+${v}% Critical chance`],
  ['cleavePct', (v) => `+${v}% Cleave`],
  ['lifestealPct', (v) => `+${v}% Lifesteal`],
  ['sunderArmor', (v) => `−${v} Target armor`],
  ['chainChance', (v) => `+${v}% Lightning chance`],
  ['buildingDamagePct', (v) => `+${v}% Building damage`],
  ['hp', (v) => `+${v} Health`],
  ['hpRegen', (v) => `+${v} Health regen`],
  ['armor', (v) => `+${v} Armor`],
  ['thornsPct', (v) => `+${v}% Damage returned`],
  ['mana', (v) => `+${v} Mana`],
  ['manaRegen', (v) => `+${v} Mana regen`],
  ['spellAmpPct', (v) => `+${v}% Ability damage`],
  ['spellLifestealPct', (v) => `+${v}% Ability lifesteal`],
  ['cdrPct', (v) => `−${v}% Ability cooldowns`],
  ['moveSpeedPct', (v) => `+${v}% Move speed`],
];

export function itemStatLines(stats: ItemStats): string[] {
  const out: string[] = [];
  for (const [k, text] of STAT_LINES) {
    const v = stats[k];
    if (typeof v === 'number' && v !== 0) out.push(text(v));
  }
  return out;
}

/** The item card's body, under its name and price. */
export function itemCard(id: ItemId): string {
  const d = ITEMS[id];
  let html = d.active ? `<div class="c-levels">${line('Cooldown', `<span class="lv cur">${d.active.cooldown} s</span>`)}</div>` : '';
  const stats = itemStatLines(d.stats);
  if (stats.length) html += section('Stats', `<ul class="c-stats">${stats.map((s) => `<li>${s}</li>`).join('')}</ul>`);
  if (d.use) html += section('Active', `<p class="c-text">${d.use}</p>`);
  if (d.passive) html += section(d.aura ? 'Aura' : 'Passive', `<p class="c-text">${d.passive}</p>`);
  return html;
}

/** What each of a spell's numbers is called. */
export const VALUE_LABELS: Record<string, string> = {
  damage: 'Damage',
  stun: 'Stun (s)',
  block: 'Damage blocked per attack',
  lowHpArmor: 'Armor below 50% health',
  windup: 'Wind-up (s)',
  critMult: 'Critical multiplier',
  critChance: 'Critical chance %',
  speedPct: 'Speed bonus %',
  dps: 'Damage per second',
  slowPct: 'Slow %',
  duration: 'Duration (s)',
  heal: 'Heal',
  delay: 'Delay (s)',
  burnDps: 'Burn damage per second',
  burnDuration: 'Burn duration (s)',
  missingPct: 'Extra damage, % of missing health',
  armor: 'Armor',
  regen: 'Health regen',
  wolves: 'Wolves',
  hp: 'Health',
  damageMult: 'Damage multiplier',
  attackSpeed: 'Attack speed %',
  shield: 'Shield',
  reduction: 'Damage reduced %',
};

/** A spell's whole card. */
export function abilityCard(me: Unit, def: AbilityDef, level: number): string {
  const passive = def.targeting === 'passive';
  let html = `<h3 class="c-name">${def.name}${def.ultimate ? ' <small>Ultimate</small>' : ''}</h3>`;
  if (!passive) {
    html += `<div class="c-levels">${line('Mana', perLevel(def.manaCost, level))}${line(
      'Cooldown',
      perLevel(def.cooldown.map((_, i) => effectiveCooldown(me, def, i + 1)), level),
    )}</div>`;
  }
  let stats = Object.entries(def.values).map(([k, vals]) => line(VALUE_LABELS[k] ?? k, perLevel(vals, level))).join('');
  if (!passive && def.castRange) stats += line('Range', `<span class="lv cur">${def.castRange} m</span>`);
  if (!passive && def.radius && def.targeting !== 'direction') stats += line('Radius', `<span class="lv cur">${def.radius} m</span>`);
  if (stats) html += section('Stats', stats);
  html += section(passive ? 'Passive' : 'Active', `<p class="c-text">${def.summary.replace(/^Passive\.\s*/, '')}</p>`);
  return html;
}
