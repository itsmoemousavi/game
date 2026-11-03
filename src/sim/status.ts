import { abilityLevel } from './abilities';
import { dist } from './math';
import type { Unit, World } from './world';

/**
 * Status effects on a unit, for the status icons above the health bar:
 * helpful effects (yours or from allies) and harmful ones (slows, stuns, damage over time),
 * plus counters such as Vexa's "attacks until the next critical hit".
 */
export type StatusId =
  | 'stun'
  | 'slow'
  | 'arrowStorm'
  | 'maelstrom'
  | 'burn'
  | 'haste'
  | 'doubleDamage'
  | 'regen'
  | 'invisibility'
  | 'salve'
  | 'mendingFlame'
  | 'veil'
  | 'barkSkin'
  | 'brineVeil'
  | 'huntersRhythm'
  | 'rhythmCount'
  | 'immunity'
  | 'charm'
  | 'ironHide'
  | 'stoneskin'
  | 'banner';

export interface Status {
  id: StatusId;
  good: boolean;
  /** Seconds left (none = lasts while the condition holds). */
  left?: number;
  /** Number shown on the icon (stacks / counters). */
  count?: number;
}

export const STATUS_INFO: Record<StatusId, { name: string; good: boolean }> = {
  stun: { name: 'Stunned', good: false },
  slow: { name: 'Slowed', good: false },
  arrowStorm: { name: 'Arrow Storm: damage and slow', good: false },
  maelstrom: { name: 'Maelstrom: damage and slow', good: false },
  burn: { name: 'Burning: damage over time', good: false },
  haste: { name: 'Haste rune: faster', good: true },
  doubleDamage: { name: 'Double damage rune', good: true },
  regen: { name: 'Regeneration rune', good: true },
  invisibility: { name: 'Invisible', good: true },
  salve: { name: 'Healing Salve', good: true },
  mendingFlame: { name: 'Mending Flame: healing', good: true },
  veil: { name: 'Veil: invisible and faster', good: true },
  barkSkin: { name: 'Bark Skin: armor and regeneration', good: true },
  brineVeil: { name: 'Brine Veil: armor and speed', good: true },
  huntersRhythm: { name: "Hunter's Rhythm: speed burst", good: true },
  rhythmCount: { name: "Hunter's Rhythm: every 4th attack is a critical hit", good: true },
  immunity: { name: 'Immune to spells', good: true },
  charm: { name: 'Revive charm: you come back to life where you fall', good: true },
  ironHide: { name: 'Iron Hide: extra armor while hurt', good: true },
  stoneskin: { name: 'Stoneskin: extra armor', good: true },
  banner: { name: 'Banner of Valor: armor and regeneration', good: true },
};

const BUFF_STATUS: Record<string, StatusId> = {
  salve: 'salve',
  mendingFlame: 'mendingFlame',
  veil: 'veil',
  barkSkin: 'barkSkin',
  brineVeil: 'brineVeil',
  huntersRhythm: 'huntersRhythm',
  immunity: 'immunity',
  charm: 'charm',
  stoneskin: 'stoneskin',
  'aura:bannerOfValor': 'banner',
};

export function statusEffects(w: World, u: Unit): Status[] {
  const out: Status[] = [];
  if (!u.alive) return out;
  const add = (id: StatusId, left?: number, count?: number) => out.push({ id, good: STATUS_INFO[id].good, left, count });

  // Standing in an enemy area spell (one icon per kind; it replaces that area's slow icon).
  const inZone = new Set<string>();
  for (const z of w.zones) {
    if (z.team === u.team || inZone.has(z.kind) || dist(z.x, z.y, u.x, u.y) > z.radius + u.radius) continue;
    inZone.add(z.kind);
    add(z.kind, Math.max(0, z.duration - z.t));
  }
  if (u.stunTimer > 0) add('stun', u.stunTimer);
  let slow: number | undefined;
  for (const b of u.buffs) {
    if (b.key.startsWith('slow:')) {
      if (!inZone.has(b.key.slice(5))) slow = Math.max(slow ?? 0, b.t);
      continue;
    }
    if (b.key === 'rune') {
      add(b.damageMult ? 'doubleDamage' : b.invisible ? 'invisibility' : b.healPerSec ? 'regen' : 'haste', b.t);
      continue;
    }
    const id = BUFF_STATUS[b.key];
    if (id) add(id, b.t);
  }
  // Carrying the Warden's charm.
  const charm = u.hero?.items.find((s) => s?.id === 'wardenCharm');
  if (charm) add('charm', charm.expiresAt !== undefined ? Math.max(0, charm.expiresAt - w.time) : undefined);
  if (slow !== undefined) add('slow', slow);

  // Passives worth tracking.
  if (u.hero) {
    if (abilityLevel(u, 'huntersRhythm') > 0) {
      const n = u.hero.attackCount % 4;
      if (n > 0) add('rhythmCount', undefined, n);
    }
    if (abilityLevel(u, 'ironHide') > 0 && u.hp < u.maxHp * 0.5) add('ironHide');
  }
  // Helpful first, then harmful (like the buff row in most games).
  return out.sort((a, b) => Number(b.good) - Number(a.good));
}
