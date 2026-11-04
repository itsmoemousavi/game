import { describe, expect, it } from 'vitest';
import { HERO_IDS, ItemId, LANE_IDS, PlayerSlot, TICK_RATE, Team, Unit, World } from '../src/sim';
import { STRUCTURES } from '../src/sim/data/units';

function humans() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 5, slots });
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
const give = (w: World, u: Unit, ...ids: ItemId[]) => {
  ids.forEach((id, i) => (u.hero!.items[i] = { id, count: 1 }));
  w.applyHeroStats(u);
};
/** Keep everyone else far away and quiet. */
const clear = (w: World, keep: Unit[]) => {
  for (const u of w.units) if (!keep.includes(u) && u.kind !== 'structure') place(u, 5, 5);
};

describe('new items', () => {
  it('towers get tougher tier by tier', () => {
    const tiers = ['tower1', 'tower2', 'tower3', 'shrineTower'] as const;
    for (let i = 1; i < tiers.length; i++) {
      const a = STRUCTURES[tiers[i - 1]];
      const b = STRUCTURES[tiers[i]];
      expect(b.hp).toBeGreaterThan(a.hp);
      expect(b.armor).toBeGreaterThan(a.armor);
      expect(b.damage).toBeGreaterThan(a.damage);
    }
  });

  it('critical hit items land crits on heroes', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    give(w, v, 'reaperEdge');
    clear(w, [v, foe]);
    place(v, 150, 150);
    place(foe, 154, 150);
    foe.maxHp = foe.hp = 1e6;
    let crits = 0;
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: foe.id });
    for (let i = 0; i < 30 * TICK_RATE; i++) {
      w.step();
      for (const e of w.events) if (e.type === 'damage' && e.crit && e.sourceId === v.id) crits++;
    }
    expect(crits).toBeGreaterThan(2);
  });

  it('cleave hits enemies next to the target, for melee heroes only', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    const foe = hero(1, 'brakk');
    const other = hero(1, 'vexa');
    give(w, b, 'cleavingAxe');
    clear(w, [b, foe, other]);
    place(b, 150, 150);
    place(foe, 151.8, 150);
    place(other, 153, 151);
    for (const u of [foe, other]) {
      u.maxHp = u.hp = 1e6;
      u.hero!.order = { type: 'idle' };
    }
    w.applyCommand({ type: 'attack', unitId: b.id, targetId: foe.id });
    run(w, 3);
    expect(other.hp).toBeLessThan(1e6);
  });

  it('Banner of Valor gives nearby allies armor', () => {
    const { w, hero } = humans();
    const g = hero(0, 'brakk');
    const ally = hero(0, 'vexa');
    give(w, g, 'bannerOfValor');
    place(g, 150, 150);
    place(ally, 155, 150);
    const before = w.armorOf(ally);
    run(w, 0.2);
    expect(w.armorOf(ally)).toBeGreaterThan(before);
    place(ally, 190, 150);
    run(w, 1);
    expect(w.armorOf(ally)).toBeCloseTo(before, 5);
  });

  it('Frost Horn slows enemies around you; Arcane Boots restore mana', () => {
    const { w, hero } = humans();
    const g = hero(0, 'brakk');
    const ally = hero(0, 'vexa');
    const foe = hero(1, 'orin');
    give(w, g, 'frostHorn', 'arcaneBoots');
    clear(w, [g, ally, foe]);
    place(g, 150, 150);
    place(ally, 153, 150);
    place(foe, 154, 152);
    const hp = foe.hp;
    ally.mana = 0;
    w.applyCommand({ type: 'useItem', unitId: g.id, slot: 0 });
    w.applyCommand({ type: 'useItem', unitId: g.id, slot: 1 });
    w.step();
    expect(foe.hp).toBeLessThan(hp);
    expect(foe.buffs.some((b) => b.key === 'slow:frostHorn')).toBe(true);
    expect(ally.mana).toBeGreaterThan(100);
  });
});
