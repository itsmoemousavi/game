import { describe, expect, it } from 'vitest';
import { GROUND_ITEM_LIFETIME, HERO_IDS, LANE_IDS, PlayerSlot, TICK_RATE, Team, Unit, World } from '../src/sim';

function humans() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 5, slots });
  const hero = (team: Team, i: number) => w.heroes.filter((h) => h.team === team)[i];
  return { w, hero };
}
const place = (u: Unit, x: number, y: number) => {
  u.x = u.px = x;
  u.y = u.py = y;
};
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * TICK_RATE); i++) w.step();
};
const send = (w: World, c: Parameters<World['enqueue']>[0]) => {
  w.enqueue(c);
  w.step();
};

describe('dropping items', () => {
  it('drops an item, loses its stats, and picks it back up', () => {
    const { w, hero } = humans();
    const a = hero(0, 0);
    a.hero!.gold = 5000;
    send(w, { type: 'buy', unitId: a.id, itemId: 'ironBlade' });
    const dmg = a.damage;
    const slot = a.hero!.items.findIndex((s) => s?.id === 'ironBlade');
    send(w, { type: 'dropItem', unitId: a.id, slot });
    expect(a.hero!.items[slot]).toBeNull();
    expect(a.damage).toBeLessThan(dmg);
    expect(w.groundItems).toHaveLength(1);
    const g = w.groundItems[0];
    // Walk away, then tap it: the hero walks back and picks it up.
    place(a, a.x + 12, a.y);
    send(w, { type: 'pickUp', unitId: a.id, groundId: g.id });
    run(w, 6);
    expect(w.groundItems).toHaveLength(0);
    expect(a.hero!.items.some((s) => s?.id === 'ironBlade')).toBe(true);
    expect(a.damage).toBe(dmg);
  });

  it('nobody else can take your items: not allies, not enemies', () => {
    const { w, hero } = humans();
    const a = hero(0, 0);
    const ally = hero(0, 1);
    const enemy = hero(1, 0);
    a.hero!.gold = 5000;
    send(w, { type: 'buy', unitId: a.id, itemId: 'ironBlade' });
    send(w, { type: 'dropItem', unitId: a.id, slot: a.hero!.items.findIndex((s) => s?.id === 'ironBlade') });
    const g = w.groundItems[0];
    for (const other of [ally, enemy]) {
      place(other, g.x, g.y);
      send(w, { type: 'pickUp', unitId: other.id, groundId: g.id });
      expect(other.hero!.items.some((s) => s?.id === 'ironBlade')).toBe(false);
    }
    expect(w.groundItems).toHaveLength(1);
  });

  it('wards can be handed to allies, but not to enemies', () => {
    const { w, hero } = humans();
    const a = hero(0, 0);
    const ally = hero(0, 1);
    const enemy = hero(1, 0);
    a.hero!.gold = 5000;
    send(w, { type: 'buy', unitId: a.id, itemId: 'observerWard' });
    send(w, { type: 'dropItem', unitId: a.id, slot: a.hero!.items.findIndex((s) => s?.id === 'observerWard') });
    const g = w.groundItems[0];
    place(enemy, g.x, g.y);
    send(w, { type: 'pickUp', unitId: enemy.id, groundId: g.id });
    expect(w.groundItems).toHaveLength(1);
    place(ally, g.x, g.y);
    send(w, { type: 'pickUp', unitId: ally.id, groundId: g.id });
    expect(w.groundItems).toHaveLength(0);
    expect(ally.hero!.items.some((s) => s?.id === 'observerWard')).toBe(true);
  });

  it('dropped items disappear after 2 minutes', () => {
    const { w, hero } = humans();
    const a = hero(0, 0);
    a.hero!.gold = 5000;
    send(w, { type: 'buy', unitId: a.id, itemId: 'healingSalve' });
    send(w, { type: 'dropItem', unitId: a.id, slot: a.hero!.items.findIndex((s) => s?.id === 'healingSalve') });
    expect(GROUND_ITEM_LIFETIME).toBe(120);
    run(w, GROUND_ITEM_LIFETIME - 1);
    expect(w.groundItems).toHaveLength(1);
    run(w, 2);
    expect(w.groundItems).toHaveLength(0);
  });

  it("can't pick up with a full inventory", () => {
    const { w, hero } = humans();
    const a = hero(0, 0);
    a.hero!.gold = 50000;
    send(w, { type: 'buy', unitId: a.id, itemId: 'ironBlade' });
    send(w, { type: 'dropItem', unitId: a.id, slot: 0 });
    for (let i = 0; i < 6; i++) send(w, { type: 'buy', unitId: a.id, itemId: 'vitalStone' });
    expect(a.hero!.items.every((s) => s !== null)).toBe(true);
    const g = w.groundItems[0];
    place(a, g.x, g.y);
    send(w, { type: 'pickUp', unitId: a.id, groundId: g.id });
    expect(w.groundItems).toHaveLength(1);
  });
});
