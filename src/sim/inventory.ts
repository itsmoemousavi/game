import { Side, Team } from './constants';
import { BLINK_DAMAGE_LOCK, INVENTORY_SLOTS, ITEMS, ItemId, ItemStats, SALVE, SHOP_RADIUS, TELEPORT } from './data/items';
import { dist } from './math';
import { cellCenter, nearestWalkableCell } from './pathfinding';
import { onHillTop } from './objectives';
import type { Unit, World } from './world';

/** One inventory slot. Consumables stack (count > 1). */
export interface ItemSlot {
  id: ItemId;
  count: number;
  /** Seconds until an item with a button can be used again. */
  cooldown?: number;
  /** Match time it was bought (sold within SELL_REFUND_WINDOW it refunds in full). */
  boughtAt?: number;
  /** Match time the item crumbles (wherever it is: in a bag or on the ground). */
  expiresAt?: number;
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
    critChance: 0,
    critMult: 1,
    cleavePct: 0,
    spellLifestealPct: 0,
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
    // Crits and cleave don't stack: the best item counts.
    if ((s.critChance ?? 0) > b.critChance) {
      b.critChance = s.critChance!;
      b.critMult = s.critMult ?? 1.5;
    }
    b.cleavePct = Math.max(b.cleavePct, s.cleavePct ?? 0);
    b.spellLifestealPct += s.spellLifestealPct ?? 0;
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
  if ((u.alive && !inShop(w, u)) || ITEMS[id].noShop) return 'shop';
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
  if (!s || (u.alive && !inShop(w, u)) || ITEMS[s.id].noShop) return false;
  h.gold += sellPrice(w, s);
  h.items[slot] = null;
  w.applyHeroStats(u);
  return true;
}

/** Seconds until blink items work again after taking damage from an enemy hero (0 = ready). */
export function blinkLockLeft(w: World, u: Unit): number {
  let left = 0;
  for (const at of u.hero!.damagedBy.values()) left = Math.max(left, BLINK_DAMAGE_LOCK - (w.time - at));
  return left;
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
      // Blinking onto a ward hill lands right on top (the only way up there).
      const hill = onHillTop(w, tx, ty);
      const cell = hill ? -1 : nearestWalkableCell(w.nav, tx, ty);
      if (!hill && cell < 0) return false;
      const p = hill ? { x: tx, y: ty } : cellCenter(w.nav, cell);
      const near = hill || dist(p.x, p.y, tx, ty) < 1.2 ? { x: tx, y: ty } : p;
      w.events.push({ type: 'blink', unitId: u.id, fromX: u.x, fromY: u.y });
      u.facing = Math.atan2(near.y - u.y, near.x - u.x);
      u.x = u.px = near.x;
      u.y = u.py = near.y;
      u.path = null;
      h.channel = null;
      if (h.order.type === 'move') h.order = { type: 'idle' };
    } else if (active.kind === 'manaBurst') {
      for (const a of w.heroes) {
        if (!a.alive || a.team !== u.team || dist(a.x, a.y, u.x, u.y) > (active.range ?? 10)) continue;
        a.mana = Math.min(a.maxMana, a.mana + (active.amount ?? 0));
      }
      w.events.push({ type: 'itemActive', unitId: u.id, kind: 'manaBurst' });
    } else if (active.kind === 'frostNova') {
      for (const e of w.units) {
        if (!e.alive || e.team === u.team || e.kind === 'structure' || dist(e.x, e.y, u.x, u.y) > (active.range ?? 6) + e.radius) continue;
        if (w.isSpellImmune(e)) continue;
        w.dealDamage(u.id, e, active.amount ?? 0, 'spell');
        w.addBuff(e, { key: 'slow:frostHorn', t: active.duration ?? 3, slowPct: 45 });
      }
      w.events.push({ type: 'itemActive', unitId: u.id, kind: 'frostNova' });
    } else if (active.kind === 'stoneskin') {
      w.addBuff(u, { key: 'stoneskin', t: active.duration ?? 4, armor: active.amount ?? 10 });
      w.events.push({ type: 'itemActive', unitId: u.id, kind: 'stoneskin' });
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
  w.events.push({ type: 'teleportStart', unitId: u.id, targetId });
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

// ------------------------------------------------------------------ dropping items

/** An item lying on the ground (dropped by a hero). */
export interface GroundItem {
  id: number;
  item: ItemSlot;
  x: number;
  y: number;
  /** The hero who dropped it: only they can pick it up again (wards: any ally; the Warden's charm: anyone). */
  ownerId: number;
  team: Side;
  droppedAt: number;
}

/** Dropped items vanish after this many seconds. */
export const GROUND_ITEM_LIFETIME = 120;
/** How close (beyond the hero's own radius) a hero must be to pick an item up. */
export const PICKUP_RANGE = 1.5;
/** Items an ally may pick up (everything else stays with the hero who bought it). */
const SHAREABLE: ItemId[] = ['observerWard', 'sentryWard'];
/** Items anyone may pick up, enemies too. */
const FREE_FOR_ALL: ItemId[] = ['wardenCharm'];

export function canPickUp(u: Unit, g: GroundItem): boolean {
  if (!u.hero) return false;
  if (FREE_FOR_ALL.includes(g.item.id)) return true;
  return g.ownerId === u.id || (g.team === u.team && SHAREABLE.includes(g.item.id));
}

/** Drop the item in `slot` at the hero's feet. */
export function dropItem(w: World, u: Unit, slot: number): boolean {
  const h = u.hero!;
  const s = h.items[slot];
  if (!s || !u.alive) return false;
  // A step in front of the hero, on walkable ground.
  const fx = u.x + Math.cos(u.facing) * (u.radius + 0.6);
  const fy = u.y + Math.sin(u.facing) * (u.radius + 0.6);
  const cell = nearestWalkableCell(w.nav, fx, fy);
  const p = cell >= 0 && dist(cellCenter(w.nav, cell).x, cellCenter(w.nav, cell).y, fx, fy) > 1.2 ? { x: u.x, y: u.y } : { x: fx, y: fy };
  h.items[slot] = null;
  w.groundItems.push({ id: w.newId(), item: s, x: p.x, y: p.y, ownerId: u.id, team: u.team as Team, droppedAt: w.time });
  w.applyHeroStats(u);
  w.events.push({ type: 'itemDrop', unitId: u.id });
  return true;
}

/** Why `u` can't pick up ground item `g` right now (other than distance), or null. */
export function pickUpBlocker(u: Unit, g: GroundItem): 'notYours' | 'full' | null {
  if (!canPickUp(u, g)) return 'notYours';
  const h = u.hero!;
  const max = ITEMS[g.item.id].consumable?.maxStack ?? 1;
  const stack = max > 1 && h.items.some((s) => s?.id === g.item.id && s.count + g.item.count <= max);
  if (!stack && !h.items.includes(null)) return 'full';
  return null;
}

/** Pick up ground item `groundId` (walk there first if it's out of reach). */
export function pickUpItem(w: World, u: Unit, groundId: number): 'picked' | 'approach' | 'fail' {
  const g = w.groundItems.find((x) => x.id === groundId);
  if (!g || !u.alive || pickUpBlocker(u, g)) return 'fail';
  if (dist(u.x, u.y, g.x, g.y) > u.radius + PICKUP_RANGE) return 'approach';
  const h = u.hero!;
  const max = ITEMS[g.item.id].consumable?.maxStack ?? 1;
  const stack = max > 1 ? h.items.find((s) => s?.id === g.item.id && s.count + g.item.count <= max) : undefined;
  // An ally's ward is a gift: it can't be sold back for the full price.
  const item: ItemSlot = g.ownerId === u.id ? g.item : { ...g.item, boughtAt: undefined };
  if (stack) stack.count += item.count;
  else h.items[h.items.indexOf(null)] = item;
  w.groundItems = w.groundItems.filter((x) => x !== g);
  w.applyHeroStats(u);
  w.events.push({ type: 'itemPickUp', unitId: u.id, itemId: item.id });
  return 'picked';
}

/** When a ground item vanishes: its own crumble time if it has one, else GROUND_ITEM_LIFETIME after dropping. */
export const groundItemExpiry = (g: GroundItem) => g.item.expiresAt ?? g.droppedAt + GROUND_ITEM_LIFETIME;

/** Remove dropped items that have been lying around too long, and items that crumble in a bag. */
export function expireGroundItems(w: World) {
  if (w.groundItems.length && w.groundItems.some((g) => w.time >= groundItemExpiry(g))) {
    w.groundItems = w.groundItems.filter((g) => w.time < groundItemExpiry(g));
  }
  if (w.tick % 15 !== 0) return;
  for (const u of w.heroes) {
    const h = u.hero!;
    let changed = false;
    h.items.forEach((s, i) => {
      if (s?.expiresAt !== undefined && w.time >= s.expiresAt) {
        h.items[i] = null;
        changed = true;
        w.events.push({ type: 'itemExpire', unitId: u.id, itemId: s.id });
      }
    });
    if (changed) w.applyHeroStats(u);
  }
}

/** The hero's slot holding the Warden's charm, or -1. */
export const charmSlot = (u: Unit) => u.hero?.items.findIndex((s) => s?.id === 'wardenCharm') ?? -1;

export const emptyInventory = (): (ItemSlot | null)[] => Array<ItemSlot | null>(INVENTORY_SLOTS).fill(null);

/**
 * Item auras (Banner of Valor): every tick, refresh a short buff on allied heroes near each
 * holder. Same-kind auras share one buff key, so two banners don't stack.
 */
export function updateItemAuras(w: World) {
  for (const u of w.heroes) {
    if (!u.alive) continue;
    for (const slot of u.hero!.items) {
      const aura = slot && ITEMS[slot.id].aura;
      if (!aura) continue;
      for (const a of w.heroes) {
        if (!a.alive || a.team !== u.team || dist(a.x, a.y, u.x, u.y) > aura.radius) continue;
        w.addBuff(a, { key: `aura:${slot!.id}`, t: 0.5, armor: aura.armor, healPerSec: aura.hpRegen });
      }
    }
  }
}
