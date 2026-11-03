import { describe, expect, it } from 'vitest';
import { COURIER_FLY_AT, HERO_IDS, ITEMS, LANE_IDS, PlayerSlot, TELEPORT, TICK_RATE, Team, Unit, World, buyBlocker, courierHome, pointAlong } from '../src/sim';

function humans() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 3, slots });
  const hero = (team: Team, id: string) => w.heroes.find((h) => h.team === team && h.hero!.defId === id)!;
  return { w, hero };
}
const place = (u: Unit, x: number, y: number) => {
  u.x = u.px = x;
  u.y = u.py = y;
};
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * TICK_RATE); i++) w.step();
};
/** Out on team 0's mid lane, away from the shop. */
const outInLane = (w: World, u: Unit, along = 70) => {
  const p = pointAlong(w.map.lanes.mid, along);
  place(u, p.x, p.y);
  u.maxHp = u.hp = 1e7;
  return p;
};

describe('courier', () => {
  it('buys away from the shop go on the courier; buys at the shop go into the inventory', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 5000;
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'ironBlade' });
    expect(b.hero!.items[0]?.id).toBe('ironBlade');
    outInLane(w, b);
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'vitalStone' });
    expect(b.hero!.items[1]).toBeNull();
    expect(b.hero!.courier.bag[0]?.id).toBe('vitalStone');
    expect(b.hero!.courier.bag[0]?.loaded).toBe(true); // the courier was home
  });

  it('holds 3 slots; the 4th buy is refused with "courier full"', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 9000;
    outInLane(w, b);
    for (const id of ['ironBlade', 'vitalStone', 'guardPlate'] as const) w.applyCommand({ type: 'buy', unitId: b.id, itemId: id });
    expect(b.hero!.courier.bag.every((s) => s)).toBe(true);
    expect(buyBlocker(w, b, 'manaCrystal')).toBe('courierFull');
    // Consumables still stack onto a slot already on the courier.
    const { w: w2, hero: hero2 } = humans();
    const o = hero2(0, 'orin');
    o.hero!.gold = 9000;
    outInLane(w2, o);
    for (const id of ['healingSalve', 'ironBlade', 'vitalStone'] as const) w2.applyCommand({ type: 'buy', unitId: o.id, itemId: id });
    expect(buyBlocker(w2, o, 'healingSalve')).toBeNull();
  });

  it('walks along the lanes for the first 6 minutes and hands the items over', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 5000;
    const p = outInLane(w, b);
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'vitalStone' });
    w.applyCommand({ type: 'courier', unitId: b.id });
    const c = b.hero!.courier;
    let offLane = 0;
    for (let i = 0; i < 40 * TICK_RATE && c.bag[0]; i++) {
      place(b, p.x, p.y);
      w.step();
      if (!w.courierNav.walkable[Math.floor(c.y / w.map.cell) * w.map.grid + Math.floor(c.x / w.map.cell)]) offLane++;
    }
    expect(b.hero!.items.some((s) => s?.id === 'vitalStone')).toBe(true);
    expect(offLane).toBeLessThan(10);
    // Then it goes home.
    run(w, 40);
    const home = courierHome(w, b);
    expect(Math.hypot(c.x - home.x, c.y - home.y)).toBeLessThan(1);
    expect(c.mode).toBe('home');
  });

  it('flies straight after 6:00, faster', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 5000;
    w.time = COURIER_FLY_AT + 1;
    const p = outInLane(w, b, 120);
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'vitalStone' });
    const home = courierHome(w, b);
    w.applyCommand({ type: 'courier', unitId: b.id });
    let t = 0;
    while (b.hero!.courier.bag[0] && t < 60) {
      place(b, p.x, p.y);
      w.step();
      t += 1 / TICK_RATE;
    }
    expect(b.hero!.items.some((s) => s?.id === 'vitalStone')).toBe(true);
    // Straight line at flying speed.
    expect(t).toBeLessThan(Math.hypot(p.x - home.x, p.y - home.y) / 8 + 2);
  });

  it('delivers only what fits, in slot order; the rest stays on the courier', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 20000;
    for (let i = 0; i < 5; i++) w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'ironBlade' });
    const p = outInLane(w, b, 30);
    for (const id of ['vitalStone', 'guardPlate', 'manaCrystal'] as const) w.applyCommand({ type: 'buy', unitId: b.id, itemId: id });
    w.applyCommand({ type: 'courier', unitId: b.id });
    for (let i = 0; i < 30 * TICK_RATE && b.hero!.courier.mode !== 'return'; i++) {
      place(b, p.x, p.y);
      w.step();
    }
    expect(b.hero!.items[5]?.id).toBe('vitalStone');
    expect(b.hero!.courier.bag.map((s) => s?.id ?? null)).toEqual([null, 'guardPlate', 'manaCrystal']);
  });

  it('combined items cost less with the parts in your bag, combine on delivery, and the parts are locked until then', () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    o.hero!.gold = 5000;
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'swiftBoots' });
    const p = outInLane(w, o, 30);
    const gold = o.hero!.gold;
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'arcaneBoots' });
    expect(gold - o.hero!.gold).toBe(ITEMS.arcaneBoots.cost - ITEMS.swiftBoots.cost);
    expect(o.hero!.items[0]).toMatchObject({ id: 'swiftBoots', reserved: true });
    w.applyCommand({ type: 'dropItem', unitId: o.id, slot: 0 });
    expect(o.hero!.items[0]?.id).toBe('swiftBoots'); // can't drop a promised part
    w.applyCommand({ type: 'courier', unitId: o.id });
    for (let i = 0; i < 30 * TICK_RATE && o.hero!.courier.bag[0]; i++) {
      place(o, p.x, p.y);
      w.step();
    }
    expect(o.hero!.items.filter((s) => s).map((s) => s!.id)).toEqual(['arcaneBoots']);
  });

  it('a teleport scroll bought away from the shop rides the courier into the TP slot', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 500;
    const p = outInLane(w, b, 30);
    w.applyCommand({ type: 'buyTp', unitId: b.id });
    expect(b.hero!.tpCount).toBe(0);
    expect(b.hero!.courier.bag[0]).toMatchObject({ id: 'tp', count: 1 });
    w.applyCommand({ type: 'courier', unitId: b.id });
    for (let i = 0; i < 30 * TICK_RATE && b.hero!.courier.bag[0]; i++) {
      place(b, p.x, p.y);
      w.step();
    }
    expect(b.hero!.tpCount).toBe(1);
  });

  it('turns back when its hero dies', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 5000;
    outInLane(w, b, 100);
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'vitalStone' });
    w.applyCommand({ type: 'courier', unitId: b.id });
    run(w, 3);
    b.maxHp = b.hp = 100;
    w.dealDamage(hero(1, 'brakk').id, b, 1e6, 'spell');
    run(w, 0.2);
    expect(b.alive).toBe(false);
    expect(b.hero!.courier.mode).toBe('return');
    expect(b.hero!.courier.bag[0]?.id).toBe('vitalStone');
  });

  it('sells from the courier (full refund at first) and re-orders slots', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 5000;
    outInLane(w, b);
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'vitalStone' });
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'ironBlade' });
    w.applyCommand({ type: 'swapItems', unitId: b.id, courier: true, a: 0, b: 2 });
    expect(b.hero!.courier.bag.map((s) => s?.id ?? null)).toEqual([null, 'ironBlade', 'vitalStone']);
    const gold = b.hero!.gold;
    w.applyCommand({ type: 'sellCourier', unitId: b.id, slot: 2 });
    expect(b.hero!.gold - gold).toBe(ITEMS.vitalStone.cost);
    expect(b.hero!.courier.bag[2]).toBeNull();
    // Inventory slots re-order too.
    w.applyCommand({ type: 'swapItems', unitId: b.id, courier: false, a: 0, b: 4 });
  });

  it('items bought while the courier is out wait at the base; walking into the shop picks them up', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 5000;
    const p = outInLane(w, b, 100);
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'vitalStone' });
    w.applyCommand({ type: 'courier', unitId: b.id });
    run(w, 1);
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'ironBlade' });
    expect(b.hero!.courier.bag[1]).toMatchObject({ id: 'ironBlade', loaded: false });
    for (let i = 0; i < 60 * TICK_RATE && b.hero!.courier.bag[0]; i++) {
      place(b, p.x, p.y);
      w.step();
    }
    expect(b.hero!.items.some((s) => s?.id === 'vitalStone')).toBe(true);
    expect(b.hero!.items.some((s) => s?.id === 'ironBlade')).toBe(false); // still waiting at base
    const f = w.map.fountains[0];
    place(b, f.x + 4, f.y - 4);
    run(w, 30);
    expect(b.hero!.items.some((s) => s?.id === 'ironBlade')).toBe(true);
    void TELEPORT;
  });
});
