import { Team } from './constants';
import { BLINK_DAMAGE_LOCK, INVENTORY_SLOTS, ITEMS, ItemId, ItemStats, SALVE, SHOP_RADIUS, TELEPORT } from './data/items';
import { dist } from './math';
import { cellCenter, nearestWalkableCell } from './pathfinding';
import type { Unit, World } from './world';

/** One inventory slot. Consumables stack (count > 1). */
export interface ItemSlot {
  id: ItemId;
  count: number;
  /** Seconds until an item with a button can be used again. */
  cooldown?: number;
  /** Match time it was bought (sold within SELL_REFUND_WINDOW it refunds in full). */
  boughtAt?: number;
}

/** Changed your mind? Selling an item within this many seconds of buying it refunds the full price. */
export const SELL_REFUND_WINDOW = 10;

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

/** Inventory slots holding the parts of `id`'s recipe (each part matched to a different slot). */
export function recipeParts(h: NonNullable<Unit['hero']>, id: ItemId): number[] {
  const used: number[] = [];
  for (const part of ITEMS[id].recipe ?? []) {
    const i = h.items.findIndex((s, k) => s?.id === part && !used.includes(k));
    if (i >= 0) used.push(i);
  }
  return used;
}

/** What `id` costs this hero right now (parts already owned are subtracted). */
export function priceFor(h: NonNullable<Unit['hero']>, id: ItemId): number {
  return ITEMS[id].cost - recipeParts(h, id).reduce((sum, i) => sum + ITEMS[h.items[i]!.id].cost, 0);
}

/** Why `id` can't be bought right now, or null. */
export function buyBlocker(w: World, u: Unit, id: ItemId): 'shop' | 'gold' | 'full' | null {
  const h = u.hero!;
  // While dead you're back at base (you respawn at the fountain), so the shop is open.
  if (u.alive && !inShop(w, u)) return 'shop';
  if (h.gold < priceFor(h, id)) return 'gold';
  const def = ITEMS[id];
  const stack = def.consumable && h.items.some((s) => s?.id === id && s.count < def.consumable!.maxStack);
  const freed = recipeParts(h, id).length;
  if (!stack && freed === 0 && h.items.every((s) => s !== null)) return 'full';
  return null;
}

export function buyItem(w: World, u: Unit, id: ItemId): boolean {
  if (buyBlocker(w, u, id)) return false;
  const h = u.hero!;
  const def = ITEMS[id];
  h.gold -= priceFor(h, id);
  // Combining: the parts are used up.
  for (const i of recipeParts(h, id)) h.items[i] = null;
  const stack = def.consumable ? h.items.find((s) => s?.id === id && s.count < def.consumable!.maxStack) : undefined;
  if (stack) {
    stack.count++;
    stack.boughtAt = w.time;
  } else h.items[h.items.indexOf(null)] = { id, count: 1, cooldown: 0, boughtAt: w.time };
  w.applyHeroStats(u);
  w.events.push({ type: 'purchase', unitId: u.id });
  return true;
}

/** What an item sells for: full price just after buying it, half price after that. */
export function sellPrice(w: World, s: ItemSlot): number {
  const full = ITEMS[s.id].cost * s.count;
  return w.time - (s.boughtAt ?? -999) <= SELL_REFUND_WINDOW ? full : Math.floor(full / 2);
}

export function sellItem(w: World, u: Unit, slot: number): boolean {
  const h = u.hero!;
  const s = h.items[slot];
  if (!s || (u.alive && !inShop(w, u))) return false;
  h.gold += sellPrice(w, s);
  h.items[slot] = null;
  w.applyHeroStats(u);
  return true;
}

/** Why the item in `slot` can't be used right now, or null. */
export function itemBlocker(w: World, u: Unit, slot: number): 'none' | 'cooldown' | 'stunned' | 'hurt' | null {
  const s = u.hero!.items[slot];
  if (!s) return 'none';
  if (!u.alive || u.stunTimer > 0) return 'stunned';
  if ((s.cooldown ?? 0) > 0) return 'cooldown';
  if (ITEMS[s.id].active?.kind === 'blink') {
    for (const at of u.hero!.damagedBy.values()) if (w.time - at < BLINK_DAMAGE_LOCK) return 'hurt';
  }
  return null;
}

/** Use the item in `slot`. Blink items take a target point (x, y); without one they go forward. */
export function useItem(w: World, u: Unit, slot: number, x?: number, y?: number): boolean {
  const h = u.hero!;
  const s = h.items[slot];
  if (!s || !u.alive || u.stunTimer > 0) return false;
  const active = ITEMS[s.id].active;
  if (active) {
    if (itemBlocker(w, u, slot)) return false;
    if (active.kind === 'blink') {
      const range = active.range ?? 10;
      let tx = x ?? u.x + Math.cos(u.facing) * range;
      let ty = y ?? u.y + Math.sin(u.facing) * range;
      const d = dist(u.x, u.y, tx, ty);
      if (d > range) {
        tx = u.x + ((tx - u.x) / d) * range;
        ty = u.y + ((ty - u.y) / d) * range;
      }
      const cell = nearestWalkableCell(w.nav, tx, ty);
      if (cell < 0) return false;
      const p = cellCenter(w.nav, cell);
      const near = dist(p.x, p.y, tx, ty) < 1.2 ? { x: tx, y: ty } : p;
      w.events.push({ type: 'blink', unitId: u.id, fromX: u.x, fromY: u.y });
      u.facing = Math.atan2(near.y - u.y, near.x - u.x);
      u.x = u.px = near.x;
      u.y = u.py = near.y;
      u.path = null;
      h.channel = null;
      if (h.order.type === 'move') h.order = { type: 'idle' };
    } else if (active.kind === 'immunity') {
      u.buffs = u.buffs.filter((b) => !b.slowPct); // shrug off slows
      w.addBuff(u, { key: 'immunity', t: active.duration ?? 4, spellImmune: true });
      w.events.push({ type: 'immunity', unitId: u.id });
    }
    s.cooldown = active.cooldown;
    return true;
  }
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
  if ((u.alive && !inShop(w, u)) || h.gold < TELEPORT.cost) return false;
  h.gold -= TELEPORT.cost;
  h.tpCount++;
  w.events.push({ type: 'purchase', unitId: u.id });
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
