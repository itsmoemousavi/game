import { DT, Team } from './constants';
import { ITEMS, ItemId } from './data/items';
import { CourierSlot, ItemSlot, emptyCourierBag, inShop } from './inventory';
import { GameMap, LANE_WIDTH } from './map';
import { Vec2, dist, distToSegment } from './math';
import { cellCenter, findPath, nearestWalkableCell } from './pathfinding';
import type { Unit, World } from './world';

/**
 * Each hero has a courier: three slots for things bought away from the shop, and a small
 * helper that carries them out.
 *
 *  - Buying away from the shop (or at base with a full inventory) puts the item on the
 *    courier. Items bought while it is out wait at the base until it comes back for them.
 *  - Sending it: it picks up anything waiting at the base, then goes to the hero and hands
 *    over, in slot order, as much as fits (a combined item uses up its parts; scrolls go to
 *    the TP slot). Leftovers stay on it. Then it goes home.
 *  - For the first 6 minutes it walks, and only along the lanes (and inside the base); after
 *    that it flies straight over the trees.
 *  - If the hero dies it turns back. It can't be attacked (for now).
 *  - At the base, a hero standing in the shop gets the courier's items straight away.
 */
export interface CourierState {
  bag: (CourierSlot | null)[];
  x: number;
  y: number;
  /** Position last tick (for drawing). */
  px: number;
  py: number;
  facing: number;
  /** home: waiting at the base · fetch: going to the base for waiting items · deliver · return. */
  mode: 'home' | 'fetch' | 'deliver' | 'return';
  path: Vec2[] | null;
  pathGoal: Vec2 | null;
  pathAt: number;
}

/** From this match time on, couriers fly (straight over the trees). */
export const COURIER_FLY_AT = 360;
export const COURIER_SPEED = { walk: 6.5, fly: 8.5 };
/** The courier hands items over within this distance of its hero. */
export const COURIER_REACH = 3;

export const courierFlying = (w: World) => w.time >= COURIER_FLY_AT;

/** Where a hero's courier waits: just inside the fountain yard, toward its doorway. */
export function courierHome(w: World, u: Unit): Vec2 {
  const team = u.team as Team;
  const y = w.map.fountainYards[team];
  const k = u.hero!.slot % 3;
  const side = { x: -y.door.y, y: y.door.x };
  return { x: y.x + y.door.x * 9 + side.x * (k - 1) * 2.5, y: y.y + y.door.y * 9 + side.y * (k - 1) * 2.5 };
}

export function newCourier(w: World, u: Unit): CourierState {
  const p = courierHome(w, u);
  return { bag: emptyCourierBag(), x: p.x, y: p.y, px: p.x, py: p.y, facing: 0, mode: 'home', path: null, pathGoal: null, pathAt: -1e9 };
}

/** Cells a walking courier may use: the lanes and the base plateaus. */
export function courierGround(map: GameMap): Uint8Array {
  const n = map.grid;
  const ok = new Uint8Array(n * n);
  const half = LANE_WIDTH / 2 + 0.5;
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cy * n + cx;
      const x = (cx + 0.5) * map.cell;
      const y = (cy + 0.5) * map.cell;
      let lane = map.height[i] === 2;
      for (const id of ['top', 'mid', 'bot'] as const) {
        const p = map.lanes[id];
        for (let k = 1; k < p.length && !lane; k++) lane = distToSegment(x, y, p[k - 1], p[k]) <= half;
      }
      ok[i] = lane ? 1 : 0;
    }
  }
  return ok;
}

/** Why the courier can't be sent right now, or null. */
export function courierBlocker(u: Unit): 'dead' | 'empty' | 'busy' | null {
  const c = u.hero!.courier;
  if (!u.alive) return 'dead';
  if (!c.bag.some((s) => s)) return 'empty';
  if (c.mode === 'deliver' || (c.mode === 'fetch' && c.bag.some((s) => s && !s.loaded))) return 'busy';
  return null;
}

/** Send the courier to its hero (picking up waiting items at the base first). */
export function sendCourier(w: World, u: Unit): boolean {
  if (courierBlocker(u)) return false;
  const c = u.hero!.courier;
  if (c.mode === 'home') {
    for (const s of c.bag) if (s) s.loaded = true;
    c.mode = 'deliver';
  } else c.mode = c.bag.some((s) => s && !s.loaded) ? 'fetch' : 'deliver';
  c.path = null;
  w.events.push({ type: 'courierSend', unitId: u.id });
  return true;
}

/** Hand over as many loaded courier items as fit, in slot order. Returns how many were delivered. */
export function deliverCourier(w: World, u: Unit, onlyLoaded = true): number {
  const h = u.hero!;
  const c = h.courier;
  let n = 0;
  c.bag.forEach((s, i) => {
    if (!s || (onlyLoaded && !s.loaded)) return;
    if (s.id === 'tp') {
      h.tpCount += s.count;
    } else if (!placeInInventory(u, s as CourierSlot & { id: ItemId })) return;
    c.bag[i] = null;
    n++;
  });
  if (n) {
    w.applyHeroStats(u);
    w.events.push({ type: 'courierDeliver', unitId: u.id });
  }
  return n;
}

function placeInInventory(u: Unit, s: CourierSlot & { id: ItemId }): boolean {
  const h = u.hero!;
  const items = h.items;
  const max = ITEMS[s.id].consumable?.maxStack ?? 1;
  // A combined item uses up its promised parts.
  const partSlots: number[] = [];
  for (const p of s.parts ?? []) {
    const k = items.findIndex((x, j) => x?.id === p && x.reserved && !partSlots.includes(j));
    if (k >= 0) partSlots.push(k);
  }
  const stack = max > 1 ? items.find((x) => x?.id === s.id && x.count + s.count <= max) : undefined;
  if (!stack && !partSlots.length && !items.includes(null)) return false;
  for (const k of partSlots) items[k] = null;
  if (stack) {
    stack.count += s.count;
    stack.boughtAt = s.boughtAt;
  } else {
    const slot: ItemSlot = { id: s.id, count: s.count, cooldown: 0, boughtAt: s.boughtAt };
    items[items.indexOf(null)] = slot;
  }
  return true;
}

/** Drop a courier item on the ground where the courier is (not combined items still waiting for parts, not scrolls). */
export function dropCourierItem(w: World, u: Unit, slot: number): boolean {
  const c = u.hero!.courier;
  const s = c.bag[slot];
  if (!s || s.id === 'tp' || s.parts?.length) return false;
  const cell = nearestWalkableCell(w.nav, c.x, c.y);
  const p = cell >= 0 ? cellCenter(w.nav, cell) : { x: c.x, y: c.y };
  c.bag[slot] = null;
  w.groundItems.push({ id: w.newId(), item: { id: s.id, count: s.count, boughtAt: s.boughtAt }, x: p.x, y: p.y, ownerId: u.id, team: u.team as Team, droppedAt: w.time });
  w.events.push({ type: 'itemDrop', unitId: u.id });
  return true;
}

/** Move every courier one tick. */
export function updateCouriers(w: World) {
  for (const u of w.heroes) {
    const h = u.hero!;
    const c = h.courier;
    c.px = c.x;
    c.py = c.y;
    const home = courierHome(w, u);
    // At the base, a hero in the shop takes the courier's items straight away.
    if (c.mode === 'home' && u.alive && w.tick % 15 === 0 && c.bag.some((s) => s) && inShop(w, u)) deliverCourier(w, u, false);
    if (c.mode === 'home') continue;
    if ((c.mode === 'deliver' || c.mode === 'fetch') && !u.alive) c.mode = 'return';
    const goal = c.mode === 'deliver' ? { x: u.x, y: u.y } : home;
    if (c.mode === 'deliver' && dist(c.x, c.y, u.x, u.y) <= COURIER_REACH + u.radius) {
      deliverCourier(w, u);
      c.mode = 'return';
      c.path = null;
      continue;
    }
    if (c.mode !== 'deliver' && dist(c.x, c.y, home.x, home.y) < 0.6) {
      for (const s of c.bag) if (s) s.loaded = true;
      if (c.mode === 'fetch') {
        c.mode = 'deliver';
        c.path = null;
      } else {
        c.mode = 'home';
        c.x = home.x;
        c.y = home.y;
      }
      continue;
    }
    moveCourier(w, c, goal);
  }
}

function moveCourier(w: World, c: CourierState, goal: Vec2) {
  let step = (courierFlying(w) ? COURIER_SPEED.fly : COURIER_SPEED.walk) * DT;
  if (courierFlying(w)) {
    c.path = null;
    stepToward(c, goal, step);
    return;
  }
  // Walking: along the lanes only. Re-plan now and then as the hero moves.
  const stale = !c.path || !c.pathGoal || w.time - c.pathAt > 1 || dist(goal.x, goal.y, c.pathGoal.x, c.pathGoal.y) > 3;
  if (stale && (w.time - c.pathAt > 0.5 || !c.path)) {
    c.path = findPath(w.courierNav, c, goal, 0.3) ?? [];
    c.pathGoal = { ...goal };
    c.pathAt = w.time;
  }
  const path = c.path!;
  while (path.length && step > 0) {
    const p = path[0];
    const d = dist(c.x, c.y, p.x, p.y);
    if (d <= step) {
      c.facing = Math.atan2(p.y - c.y, p.x - c.x);
      c.x = p.x;
      c.y = p.y;
      step -= d;
      path.shift();
    } else {
      stepToward(c, p, step);
      step = 0;
    }
  }
}

function stepToward(c: CourierState, p: Vec2, step: number) {
  const d = dist(c.x, c.y, p.x, p.y);
  if (d < 1e-6) return;
  const k = Math.min(1, step / d);
  c.facing = Math.atan2(p.y - c.y, p.x - c.x);
  c.x += (p.x - c.x) * k;
  c.y += (p.y - c.y) * k;
}
