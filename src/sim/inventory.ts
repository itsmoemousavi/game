import { Side, Team } from './constants';
import { BLINK_DAMAGE_LOCK, COURIER_SLOTS, INVENTORY_SLOTS, ITEMS, ItemId, ItemStats, MANA_FLASK, SALVE, SHOP_RADIUS, TELEPORT } from './data/items';
import { dist, dAtan2, dCos, dSin } from './math';
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
  /**
   * A part promised to a combined item that is on its way by courier: it combines when the
   * courier delivers, so until then it can't be sold or dropped.
   */
  reserved?: boolean;
}

/** One courier slot: an item (or a stack of teleport scrolls) bought away from the shop. */
export interface CourierSlot {
  id: ItemId | 'tp';
  count: number;
  boughtAt?: number;
  /** Gold actually paid (a combined item costs less when you own its parts). */
  paid: number;
  /** Inventory parts this combined item uses up on delivery (they are reserved until then). */
  parts?: ItemId[];
  /** On the courier (false = bought while the courier was away: it's waiting at the base). */
  loaded: boolean;
}

export const emptyCourierBag = (): (CourierSlot | null)[] => Array<CourierSlot | null>(COURIER_SLOTS).fill(null);

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
    thornsPct: 0,
    sunderArmor: 0,
    chainChance: 0,
    buildingDamagePct: 0,
    attackRange: 0,
    teleportBoots: false,
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
    // Special effects don't stack either: the best item counts.
    b.thornsPct = Math.max(b.thornsPct, s.thornsPct ?? 0);
    b.sunderArmor = Math.max(b.sunderArmor, s.sunderArmor ?? 0);
    b.chainChance = Math.max(b.chainChance, s.chainChance ?? 0);
    b.buildingDamagePct = Math.max(b.buildingDamagePct, s.buildingDamagePct ?? 0);
    b.attackRange = Math.max(b.attackRange, s.attackRange ?? 0);
    b.teleportBoots ||= !!s.teleportBoots;
  }
  return b;
}

export const inShop = (w: World, u: Unit) => {
  const f = w.map.fountains[u.team as Team];
  return dist(u.x, u.y, f.x, f.y) <= SHOP_RADIUS;
};

type Hero = NonNullable<Unit['hero']>;

/**
 * Where the parts of `id`'s recipe are: inventory slots (not already promised to another
 * item) first, then courier slots. Each part is matched to a different slot.
 */
export function recipeSources(h: Hero, id: ItemId): { inv: number[]; bag: number[] } {
  const inv: number[] = [];
  const bag: number[] = [];
  for (const part of ITEMS[id].recipe ?? []) {
    const i = h.items.findIndex((s, k) => s?.id === part && !s.reserved && !inv.includes(k));
    if (i >= 0) {
      inv.push(i);
      continue;
    }
    const j = h.courier.bag.findIndex((s, k) => s?.id === part && !bag.includes(k));
    if (j >= 0) bag.push(j);
  }
  return { inv, bag };
}

/** Inventory slots holding the parts of `id`'s recipe. */
export const recipeParts = (h: Hero, id: ItemId): number[] => recipeSources(h, id).inv;

/** What `id` costs this hero right now (parts already owned, in the bag or on the courier, are subtracted). */
export function priceFor(h: Hero, id: ItemId): number {
  const { inv, bag } = recipeSources(h, id);
  const owned = inv.reduce((sum, i) => sum + ITEMS[h.items[i]!.id].cost, 0) + bag.reduce((sum, i) => sum + ITEMS[h.courier.bag[i]!.id as ItemId].cost, 0);
  return ITEMS[id].cost - owned;
}

/** At the shop: near your fountain, or dead (you respawn there). */
const atShop = (w: World, u: Unit) => !u.alive || inShop(w, u);

/** Room for `id` in the inventory (a stack, a freed part slot or an empty slot). */
function fitsInventory(h: Hero, id: ItemId, partSlots: number) {
  const def = ITEMS[id];
  const stack = def.consumable && h.items.some((s) => s?.id === id && s.count < def.consumable!.maxStack);
  return !!stack || partSlots > 0 || h.items.includes(null);
}
/** Room for `id` on the courier. */
function fitsCourier(h: Hero, id: ItemId | 'tp', partSlots: number) {
  const max = id === 'tp' ? Infinity : ITEMS[id].consumable?.maxStack ?? 1;
  const stack = max > 1 && h.courier.bag.some((s) => s?.id === id && s.count < max);
  return stack || partSlots > 0 || h.courier.bag.includes(null);
}

/** Where a purchase of `id` would go right now: into the inventory, or onto the courier. */
export function buyDestination(w: World, u: Unit, id: ItemId): 'inventory' | 'courier' | null {
  const h = u.hero!;
  const { inv, bag } = recipeSources(h, id);
  if (atShop(w, u) && fitsInventory(h, id, inv.length)) return 'inventory';
  // Away from the shop (or with a full inventory at base) it goes on the courier.
  if (fitsCourier(h, id, bag.length)) return 'courier';
  return null;
}

/** Why `id` can't be bought right now, or null. */
export function buyBlocker(w: World, u: Unit, id: ItemId): 'shop' | 'gold' | 'full' | 'courierFull' | null {
  const h = u.hero!;
  if (ITEMS[id].noShop) return 'shop';
  if (h.gold < priceFor(h, id)) return 'gold';
  if (!buyDestination(w, u, id)) return atShop(w, u) ? 'full' : 'courierFull';
  return null;
}

export function buyItem(w: World, u: Unit, id: ItemId): boolean {
  if (buyBlocker(w, u, id)) return false;
  const h = u.hero!;
  const def = ITEMS[id];
  const price = priceFor(h, id);
  const where = buyDestination(w, u, id)!;
  const { inv, bag } = recipeSources(h, id);
  h.gold -= price;
  // Parts already on the courier are used up right away (their own promised parts carry over).
  const carried: ItemId[] = [];
  let bagSpot = -1;
  for (const j of bag) {
    carried.push(...(h.courier.bag[j]!.parts ?? []));
    h.courier.bag[j] = null;
    if (bagSpot < 0) bagSpot = j;
  }
  if (where === 'inventory') {
    // Combining at the shop: the parts are used up now (promised parts of a used courier part too).
    for (const i of inv) h.items[i] = null;
    for (const p of carried) {
      const k = h.items.findIndex((s) => s?.id === p && s.reserved);
      if (k >= 0) h.items[k] = null;
    }
    const stack = def.consumable ? h.items.find((s) => s?.id === id && s.count < def.consumable!.maxStack) : undefined;
    if (stack) {
      stack.count++;
      stack.boughtAt = w.time;
    } else h.items[h.items.indexOf(null)] = { id, count: 1, cooldown: 0, boughtAt: w.time };
  } else {
    // On the courier: inventory parts are promised to it and combine on delivery.
    for (const i of inv) h.items[i]!.reserved = true;
    const parts = [...carried, ...inv.map((i) => h.items[i]!.id)];
    addToCourier(w, u, id, price, parts, bagSpot);
  }
  w.applyHeroStats(u);
  w.events.push({ type: 'purchase', unitId: u.id });
  return true;
}

/** Put a purchase on the courier (stacking consumables / scrolls). Loaded at once if the courier is home. */
function addToCourier(w: World, u: Unit, id: ItemId | 'tp', paid: number, parts: ItemId[], spot = -1) {
  const c = u.hero!.courier;
  const max = id === 'tp' ? Infinity : ITEMS[id].consumable?.maxStack ?? 1;
  const loaded = c.mode === 'home';
  const stack = max > 1 ? c.bag.find((s) => s?.id === id && s.count < max) : undefined;
  if (stack) {
    stack.count++;
    stack.paid += paid;
    stack.boughtAt = w.time;
    stack.loaded &&= loaded;
    return;
  }
  const i = spot >= 0 ? spot : c.bag.indexOf(null);
  c.bag[i] = { id, count: 1, boughtAt: w.time, paid, parts: parts.length ? parts : undefined, loaded };
}

/** Why a teleport scroll can't be bought right now, or null. */
export function tpBuyBlocker(w: World, u: Unit): 'boots' | 'gold' | 'courierFull' | null {
  const h = u.hero!;
  if (h.bonus.teleportBoots) return 'boots';
  if (h.gold < TELEPORT.cost) return 'gold';
  if (!atShop(w, u) && !fitsCourier(h, 'tp', 0)) return 'courierFull';
  return null;
}

/** Sell price of a courier slot: what you paid, in full within the refund window, else half. */
export function courierSellPrice(w: World, s: CourierSlot): number {
  return w.time - (s.boughtAt ?? -999) <= SELL_REFUND_WINDOW ? s.paid : Math.floor(s.paid / 2);
}

/** Sell an item off the courier (works anywhere). Its promised inventory parts are freed again. */
export function sellCourierItem(w: World, u: Unit, slot: number): boolean {
  const h = u.hero!;
  const s = h.courier.bag[slot];
  if (!s || (s.id !== 'tp' && ITEMS[s.id].noShop)) return false;
  h.gold += courierSellPrice(w, s);
  for (const p of s.parts ?? []) {
    const k = h.items.findIndex((x) => x?.id === p && x.reserved);
    if (k >= 0) h.items[k]!.reserved = false;
  }
  h.courier.bag[slot] = null;
  return true;
}

/** Swap two slots of the inventory, or of the courier. */
export function swapItems(u: Unit, courier: boolean, a: number, b: number): boolean {
  const list: unknown[] = courier ? u.hero!.courier.bag : u.hero!.items;
  if (a === b || a < 0 || b < 0 || a >= list.length || b >= list.length) return false;
  [list[a], list[b]] = [list[b], list[a]];
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
  if (!s || (u.alive && !inShop(w, u)) || ITEMS[s.id].noShop || s.reserved) return false;
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
      let tx = x ?? u.x + dCos(u.facing) * range;
      let ty = y ?? u.y + dSin(u.facing) * range;
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
      u.facing = dAtan2(near.y - u.y, near.x - u.x);
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
    } else if (active.kind === 'silence') {
      for (const e of w.heroes) {
        if (!e.alive || e.team === u.team || dist(e.x, e.y, u.x, u.y) > (active.range ?? 7) + e.radius || w.isSpellImmune(e)) continue;
        w.addBuff(e, { key: 'silenced', t: active.duration ?? 3, silenced: true });
      }
      w.events.push({ type: 'itemActive', unitId: u.id, kind: 'silence' });
    } else if (active.kind === 'teamHeal') {
      for (const a of w.heroes) {
        if (!a.alive || a.team !== u.team || dist(a.x, a.y, u.x, u.y) > (active.range ?? 10)) continue;
        const before = a.hp;
        w.heal(a, active.amount ?? 0);
        if (a !== u) h.stats.healing += a.hp - before;
      }
      w.events.push({ type: 'itemActive', unitId: u.id, kind: 'teamHeal' });
    } else if (active.kind === 'vanish') {
      w.events.push({ type: 'itemActive', unitId: u.id, kind: 'vanish' });
      w.addBuff(u, { key: 'ghostShroud', t: active.duration ?? 5, invisible: true, moveSpeedPct: active.amount ?? 25 });
    } else if (active.kind === 'mire') {
      // The tap picks the nearest enemy you can see around that spot; a miss doesn't use the item up.
      const px = x ?? u.x;
      const py = y ?? u.y;
      const range = active.range ?? 9;
      let best: Unit | null = null;
      let bd = 4;
      for (const e of w.units) {
        if (!e.alive || e.team === u.team || e.kind === 'structure' || e.ward || w.isSpellImmune(e) || !w.canSee(u.team, e)) continue;
        if (dist(u.x, u.y, e.x, e.y) > range + e.radius) continue;
        const d = dist(px, py, e.x, e.y);
        if (d < bd || (best && !best.hero && e.hero && d < 4)) {
          best = e;
          bd = d;
        }
      }
      if (!best) return false;
      w.dealDamage(u.id, best, active.amount ?? 0, 'spell');
      w.addBuff(best, { key: 'slow:mireStaff', t: active.duration ?? 3.5, slowPct: 60 });
      w.events.push({ type: 'itemActive', unitId: u.id, kind: 'mire', targetId: best.id });
    } else if (active.kind === 'immunity') {
      u.buffs = u.buffs.filter((b) => !b.slowPct && !b.silenced); // shrug off slows and silence
      w.addBuff(u, { key: 'immunity', t: active.duration ?? 4, spellImmune: true });
      w.events.push({ type: 'immunity', unitId: u.id });
    }
    s.cooldown = active.cooldown;
    return true;
  }
  if (s.id === 'manaFlask') {
    w.addBuff(u, { key: 'manaFlask', t: MANA_FLASK.duration, manaPerSec: MANA_FLASK.mana / MANA_FLASK.duration });
    s.count--;
    if (s.count <= 0) h.items[slot] = null;
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
  if (tpBuyBlocker(w, u)) return false;
  h.gold -= TELEPORT.cost;
  // Away from the shop the scroll goes on the courier (into the TP slot on delivery).
  if (atShop(w, u)) h.tpCount++;
  else addToCourier(w, u, 'tp', TELEPORT.cost, []);
  w.events.push({ type: 'purchase', unitId: u.id });
  return true;
}

/** Where a hero may teleport: allied buildings, and with Wayfarer Boots allied heroes and creeps too. */
export function teleportTargets(w: World, team: Team, boots = false): Unit[] {
  return w.units.filter((s) => s.alive && s.team === team && (s.structure || (boots && (s.hero || s.creep))));
}

export function tpBlocker(u: Unit): 'none' | 'cooldown' | 'busy' | null {
  const h = u.hero!;
  if (h.tpCount <= 0) return 'none';
  if (h.tpCooldown > 0) return 'cooldown';
  if (!u.alive || u.stunTimer > 0 || h.channel) return 'busy';
  return null;
}

/** Where you arrive: on the home side of a building, right beside a hero or creep. */
function landingPoint(w: World, team: Team, t: Unit) {
  const f = w.map.fountains[team];
  const d = dist(t.x, t.y, f.x, f.y) || 1;
  const off = t.structure ? t.radius + TELEPORT.offset : t.radius + 1.2;
  return { x: t.x + ((f.x - t.x) / d) * off, y: t.y + ((f.y - t.y) / d) * off };
}

export function startTeleport(w: World, u: Unit, targetId: number): boolean {
  const h = u.hero!;
  const t = w.unit(targetId);
  if (tpBlocker(u) || !t || t === u || !teleportTargets(w, u.team as Team, h.bonus.teleportBoots).includes(t)) return false;
  // The destination is decided now: if a building falls during the channel you still arrive there.
  const p = landingPoint(w, u.team as Team, t);
  h.channel = { kind: 'tp', t: TELEPORT.channel, total: TELEPORT.channel, targetId, x: p.x, y: p.y };
  w.events.push({ type: 'teleportStart', unitId: u.id, targetId });
  h.order = { type: 'idle' };
  u.path = null;
  u.targetId = null;
  return true;
}

/** Runs every tick while channelling. Returns true while the hero is busy (frozen in place). */
export function updateChannel(w: World, u: Unit, dt: number): boolean {
  const h = u.hero!;
  const c = h.channel;
  if (!c) return false;
  if (!u.alive || u.stunTimer > 0) {
    h.channel = null;
    return false;
  }
  // Heading for a hero or creep: follow them while they live, then keep the last place they stood.
  const t = w.unit(c.targetId);
  if (t?.alive && !t.structure) {
    const p = landingPoint(w, u.team as Team, t);
    c.x = p.x;
    c.y = p.y;
  }
  c.t -= dt;
  if (c.t > 0) return true;
  h.channel = null;
  const cell = nearestWalkableCell(w.nav, c.x, c.y);
  const p = cell >= 0 ? cellCenter(w.nav, cell) : { x: c.x, y: c.y };
  u.x = u.px = p.x;
  u.y = u.py = p.y;
  u.path = null;
  if (h.bonus.teleportBoots) h.tpCooldown = TELEPORT.bootsCooldown;
  else {
    h.tpCount--;
    h.tpCooldown = TELEPORT.cooldown;
  }
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
  if (!s || !u.alive || s.reserved) return false;
  // A step in front of the hero, on walkable ground.
  const fx = u.x + dCos(u.facing) * (u.radius + 0.6);
  const fy = u.y + dSin(u.facing) * (u.radius + 0.6);
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
