import { Team } from './constants';
import { INVENTORY_SLOTS, ITEMS, ItemId, ItemStats, SALVE, SHOP_RADIUS, TELEPORT } from './data/items';
import { dist } from './math';
import { cellCenter, nearestWalkableCell } from './pathfinding';
import type { Unit, World } from './world';

/** One inventory slot. Consumables stack (count > 1). */
export interface ItemSlot {
  id: ItemId;
  count: number;
}

/** Sum of item stats; boots don't stack and cooldown reduction is capped. */
export function itemBonuses(items: (ItemSlot | null)[]): Required<ItemStats> {
  const b: Required<ItemStats> = {
    damage: 0,
    hp: 0,
    mana: 0,
    manaRegen: 0,
    hpRegen: 0,
    armor: 0,
    attackSpeedPct: 0,
    moveSpeedPct: 0,
    cdrPct: 0,
    spellAmpPct: 0,
    lifestealPct: 0,
    ultUpgrade: false,
  };
  for (const slot of items) {
    if (!slot) continue;
    const s = ITEMS[slot.id].stats;
    b.damage += s.damage ?? 0;
    b.hp += s.hp ?? 0;
    b.mana += s.mana ?? 0;
    b.manaRegen += s.manaRegen ?? 0;
    b.hpRegen += s.hpRegen ?? 0;
    b.armor += s.armor ?? 0;
    b.attackSpeedPct += s.attackSpeedPct ?? 0;
    b.moveSpeedPct = Math.max(b.moveSpeedPct, s.moveSpeedPct ?? 0);
    b.cdrPct = Math.min(40, b.cdrPct + (s.cdrPct ?? 0));
    b.spellAmpPct += s.spellAmpPct ?? 0;
    b.lifestealPct += s.lifestealPct ?? 0;
    b.ultUpgrade ||= !!s.ultUpgrade;
  }
  return b;
}

export const inShop = (w: World, u: Unit) => {
  const f = w.map.fountains[u.team as Team];
  return dist(u.x, u.y, f.x, f.y) <= SHOP_RADIUS;
};

/** Why `id` can't be bought right now, or null. */
export function buyBlocker(w: World, u: Unit, id: ItemId): 'shop' | 'gold' | 'full' | null {
  const h = u.hero!;
  if (!u.alive || !inShop(w, u)) return 'shop';
  if (h.gold < ITEMS[id].cost) return 'gold';
  const def = ITEMS[id];
  const stack = def.consumable && h.items.some((s) => s?.id === id && s.count < def.consumable!.maxStack);
  if (!stack && h.items.every((s) => s !== null)) return 'full';
  return null;
}

export function buyItem(w: World, u: Unit, id: ItemId): boolean {
  if (buyBlocker(w, u, id)) return false;
  const h = u.hero!;
  const def = ITEMS[id];
  h.gold -= def.cost;
  const stack = def.consumable ? h.items.find((s) => s?.id === id && s.count < def.consumable!.maxStack) : undefined;
  if (stack) stack.count++;
  else h.items[h.items.indexOf(null)] = { id, count: 1 };
  w.applyHeroStats(u);
  return true;
}

export function sellItem(w: World, u: Unit, slot: number): boolean {
  const h = u.hero!;
  const s = h.items[slot];
  if (!s || !inShop(w, u)) return false;
  h.gold += Math.floor((ITEMS[s.id].cost * s.count) / 2);
  h.items[slot] = null;
  w.applyHeroStats(u);
  return true;
}

export function useItem(w: World, u: Unit, slot: number): boolean {
  const h = u.hero!;
  const s = h.items[slot];
  if (!s || !u.alive || u.stunTimer > 0) return false;
  if (s.id === 'healingSalve') {
    w.addBuff(u, { key: 'salve', t: SALVE.duration, healPerSec: SALVE.heal / SALVE.duration });
    s.count--;
    if (s.count <= 0) h.items[slot] = null;
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ teleport

export function buyTeleport(w: World, u: Unit): boolean {
  const h = u.hero!;
  if (!u.alive || !inShop(w, u) || h.gold < TELEPORT.cost) return false;
  h.gold -= TELEPORT.cost;
  h.tpCount++;
  return true;
}

/** Allied buildings a hero may teleport to. */
export function teleportTargets(w: World, team: Team): Unit[] {
  return w.units.filter((s) => s.structure && s.alive && s.team === team);
}

export function tpBlocker(u: Unit): 'none' | 'cooldown' | 'busy' | null {
  const h = u.hero!;
  if (h.tpCount <= 0) return 'none';
  if (h.tpCooldown > 0) return 'cooldown';
  if (!u.alive || u.stunTimer > 0 || h.channel) return 'busy';
  return null;
}

export function startTeleport(w: World, u: Unit, targetId: number): boolean {
  const t = w.unit(targetId);
  if (tpBlocker(u) || !t || !t.structure || !t.alive || t.team !== u.team) return false;
  const h = u.hero!;
  h.channel = { kind: 'tp', t: TELEPORT.channel, total: TELEPORT.channel, targetId };
  h.order = { type: 'idle' };
  u.path = null;
  return true;
}

/** Runs every tick while channelling. Returns true while the hero is busy. */
export function updateChannel(w: World, u: Unit, dt: number): boolean {
  const h = u.hero!;
  const c = h.channel;
  if (!c) return false;
  if (!u.alive || u.stunTimer > 0) {
    h.channel = null;
    return false;
  }
  c.t -= dt;
  if (c.t > 0) return true;
  h.channel = null;
  const t = w.unit(c.targetId);
  if (!t || !t.alive) return false;
  // Land on the home side of the building so you arrive behind it, not in front.
  const f = w.map.fountains[u.team as Team];
  const d = dist(t.x, t.y, f.x, f.y) || 1;
  const off = t.radius + TELEPORT.offset;
  const gx = t.x + ((f.x - t.x) / d) * off;
  const gy = t.y + ((f.y - t.y) / d) * off;
  const cell = nearestWalkableCell(w.nav, gx, gy);
  const p = cell >= 0 ? cellCenter(w.nav, cell) : { x: gx, y: gy };
  u.x = u.px = p.x;
  u.y = u.py = p.y;
  u.path = null;
  h.tpCount--;
  h.tpCooldown = TELEPORT.cooldown;
  w.events.push({ type: 'teleport', unitId: u.id });
  return false;
}

export const emptyInventory = (): (ItemSlot | null)[] => Array<ItemSlot | null>(INVENTORY_SLOTS).fill(null);
