import { describe, expect, it } from 'vitest';
import { HERO_IDS, ITEMS, LANE_IDS, PlayerSlot, TICK_RATE, Team, Unit, World, priceFor } from '../src/sim';

function humans() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 21, slots });
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

describe('combining items', () => {
  it('owned parts are used up and only the difference is paid', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    v.hero!.gold = 5000;
    w.applyCommand({ type: 'buy', unitId: v.id, itemId: 'ironBlade' });
    w.applyCommand({ type: 'buy', unitId: v.id, itemId: 'quickGloves' });
    const gold = v.hero!.gold;
    const price = priceFor(v.hero!, 'twinBlades');
    expect(price).toBe(ITEMS.twinBlades.cost - ITEMS.ironBlade.cost - ITEMS.quickGloves.cost);
    w.applyCommand({ type: 'buy', unitId: v.id, itemId: 'twinBlades' });
    expect(v.hero!.gold).toBe(gold - price);
    expect(v.hero!.items.filter(Boolean).map((s) => s!.id)).toEqual(['twinBlades']);
    expect(v.hero!.bonus.damage).toBe(30);
  });

  it('a combined item can be bought outright with a full inventory if a part is in it', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 20000;
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'vitalStone' });
    for (let i = 0; i < 5; i++) w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'guardPlate' });
    expect(b.hero!.items.every(Boolean)).toBe(true);
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'titanHeart' });
    expect(b.hero!.items.some((s) => s?.id === 'titanHeart')).toBe(true);
  });
});

describe('items with a button', () => {
  it('Shadow Step blinks to the target point (max range) and goes on cooldown', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 5000;
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'shadowStep' });
    place(b, 70, 130); // mid lane
    w.applyCommand({ type: 'useItem', unitId: b.id, slot: 0, x: 77, y: 123 }); // 9.9 m away
    expect(Math.hypot(b.x - 77, b.y - 123)).toBeLessThan(1.5);
    expect(b.hero!.items[0]!.cooldown).toBeGreaterThan(10);
    const x = b.x;
    w.applyCommand({ type: 'useItem', unitId: b.id, slot: 0, x: 60, y: 140 });
    expect(b.x).toBe(x); // on cooldown
  });

  it('Shadow Step stops at its 11 m range when aimed further', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 5000;
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'shadowStep' });
    place(b, 70, 130);
    w.applyCommand({ type: 'useItem', unitId: b.id, slot: 0, x: 90, y: 110 }); // 28 m away
    expect(Math.hypot(b.x - 70, b.y - 130)).toBeLessThan(12.2);
    expect(Math.hypot(b.x - 70, b.y - 130)).toBeGreaterThan(9.5);
  });

  it("Shadow Step can't be used right after taking hero damage", () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 5000;
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'shadowStep' });
    place(b, 70, 130);
    w.dealDamage(hero(1, 'vexa').id, b, 10, 'attack');
    w.applyCommand({ type: 'useItem', unitId: b.id, slot: 0, x: 80, y: 120 });
    expect(b.x).toBe(70);
  });

  it('Warded Cloak makes the hero immune to ability damage and stuns', () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    o.hero!.gold = 5000;
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'wardedCloak' });
    w.applyCommand({ type: 'useItem', unitId: o.id, slot: 0 });
    const hp = o.hp;
    w.dealDamage(hero(1, 'vexa').id, o, 300, 'spell');
    w.stun(o, 2);
    expect(o.hp).toBe(hp);
    expect(o.stunTimer).toBe(0);
    w.dealDamage(hero(1, 'vexa').id, o, 100, 'attack');
    expect(o.hp).toBeLessThan(hp); // normal attacks still hurt
    run(w, 4.2);
    w.stun(o, 1);
    expect(o.stunTimer).toBeGreaterThan(0);
  });
});
