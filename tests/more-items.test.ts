import { describe, expect, it } from 'vitest';
import { HERO_IDS, ITEMS, ItemId, LANE_IDS, PlayerSlot, TICK_RATE, Team, Unit, World, castBlocker, isInvisible } from '../src/sim';

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
const clear = (w: World, keep: Unit[]) => {
  for (const u of w.units) if (!keep.includes(u) && u.kind !== 'structure') place(u, 5, 5);
};
/** A quiet open spot on the middle lane, away from every tower. */
const SPOT = { x: 150, y: 150 };

describe('more items', () => {
  it('every new item costs more than its parts and has a shop summary', () => {
    for (const id of ['sunderPike', 'stormBlade', 'siegeMaul', 'ghostShroud', 'brambleMail', 'mendersCenser', 'hushBell', 'mireStaff'] as ItemId[]) {
      const d = ITEMS[id];
      const parts = (d.recipe ?? []).reduce((s, p) => s + ITEMS[p].cost, 0);
      expect(d.cost).toBeGreaterThan(parts);
      expect(d.summary.length).toBeGreaterThan(10);
    }
  });

  it('Bramble Mail hurts melee attackers, not ranged ones', () => {
    const { w, hero } = humans();
    const tank = hero(0, 'brakk');
    const melee = hero(1, 'brakk');
    const ranged = hero(1, 'vexa');
    clear(w, [tank, melee, ranged]);
    give(w, tank, 'brambleMail');
    place(tank, SPOT.x, SPOT.y);
    place(melee, SPOT.x + 1, SPOT.y);
    const hp = melee.hp;
    w.dealDamage(melee.id, tank, 100, 'attack');
    expect(melee.hp).toBeLessThan(hp);
    const rhp = ranged.hp;
    w.dealDamage(ranged.id, tank, 100, 'attack');
    expect(ranged.hp).toBe(rhp);
  });

  it('two Bramble Mails hitting each other do not bounce forever', () => {
    const { w, hero } = humans();
    const a = hero(0, 'brakk');
    const b = hero(1, 'brakk');
    clear(w, [a, b]);
    give(w, a, 'brambleMail');
    give(w, b, 'brambleMail');
    const ahp = a.hp;
    const bhp = b.hp;
    w.dealDamage(a.id, b, 100, 'attack');
    expect(b.hp).toBeLessThan(bhp);
    expect(a.hp).toBeLessThan(ahp);
    expect(ahp - a.hp).toBeLessThan(bhp - b.hp);
  });

  it('Sunder Pike lowers armor for a few seconds without stacking', () => {
    const { w, hero } = humans();
    const a = hero(0, 'vexa');
    const b = hero(1, 'brakk');
    clear(w, [a, b]);
    give(w, a, 'sunderPike');
    const armor = w.armorOf(b);
    w.dealDamage(a.id, b, 10, 'attack');
    w.dealDamage(a.id, b, 10, 'attack');
    expect(w.armorOf(b)).toBeCloseTo(armor - 5);
    run(w, 5);
    expect(w.armorOf(b)).toBeCloseTo(armor);
  });

  it('Storm Blade throws lightning at nearby enemies', () => {
    const { w, hero } = humans();
    const a = hero(0, 'vexa');
    const t = hero(1, 'brakk');
    const n = hero(1, 'orin');
    clear(w, [a, t, n]);
    give(w, a, 'stormBlade');
    place(t, SPOT.x, SPOT.y);
    place(n, SPOT.x + 3, SPOT.y);
    let jumped = false;
    for (let i = 0; i < 60 && !jumped; i++) {
      n.hp = n.maxHp;
      w.events.length = 0;
      w.dealDamage(a.id, t, 1, 'attack');
      t.hp = t.maxHp;
      jumped = n.hp < n.maxHp;
      if (jumped) expect(w.events.some((e) => e.type === 'chainLightning')).toBe(true);
    }
    expect(jumped).toBe(true);
  });

  it('Siege Maul hits buildings harder but heroes the same', () => {
    const { w, hero } = humans();
    const a = hero(0, 'vexa');
    const b = hero(1, 'brakk');
    const tower = w.units.find((u) => u.structure && u.team === 1 && u.structure.vulnerable)!;
    clear(w, [a, b]);
    const hitTower = () => {
      const hp = tower.hp;
      w.dealDamage(a.id, tower, 100, 'attack');
      const d = hp - tower.hp;
      tower.hp = hp;
      return d;
    };
    const hitHero = () => {
      const hp = b.hp;
      w.dealDamage(a.id, b, 100, 'attack');
      const d = hp - b.hp;
      b.hp = hp;
      return d;
    };
    const t0 = hitTower();
    const h0 = hitHero();
    give(w, a, 'siegeMaul');
    expect(hitTower()).toBeCloseTo(t0 * 1.6);
    expect(hitHero()).toBeCloseTo(h0);
  });

  it('Hush Bell stops enemies casting, but not items, and spell immunity protects', () => {
    const { w, hero } = humans();
    const a = hero(0, 'orin');
    const foe = hero(1, 'brakk');
    const far = hero(1, 'vexa');
    clear(w, [a, foe, far]);
    give(w, a, 'hushBell');
    give(w, foe, 'stoneskinAmulet');
    place(a, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 4, SPOT.y);
    place(far, SPOT.x + 20, SPOT.y);
    foe.hero!.abilities[0].level = 1;
    far.hero!.abilities[0].level = 1;
    w.applyCommand({ type: 'useItem', unitId: a.id, slot: 0 });
    expect(castBlocker(foe, 0)).toBe('silenced');
    expect(castBlocker(far, 0)).not.toBe('silenced');
    w.applyCommand({ type: 'useItem', unitId: foe.id, slot: 0 });
    expect(foe.buffs.some((b) => b.key === 'stoneskin')).toBe(true);
    run(w, 3.2);
    expect(castBlocker(foe, 0)).not.toBe('silenced');
    a.hero!.items[0]!.cooldown = 0;
    foe.buffs.push({ key: 'immunity', t: 5, spellImmune: true });
    w.applyCommand({ type: 'useItem', unitId: a.id, slot: 0 });
    expect(castBlocker(foe, 0)).not.toBe('silenced');
  });

  it("Mender's Censer heals nearby allies only", () => {
    const { w, hero } = humans();
    const a = hero(0, 'orin');
    const near = hero(0, 'brakk');
    const far = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    clear(w, [a, near, far, foe]);
    give(w, a, 'mendersCenser');
    place(a, SPOT.x, SPOT.y);
    place(near, SPOT.x + 6, SPOT.y);
    place(far, SPOT.x + 30, SPOT.y);
    place(foe, SPOT.x + 2, SPOT.y);
    for (const u of [near, far, foe]) u.hp = 100;
    a.hp = 100;
    w.applyCommand({ type: 'useItem', unitId: a.id, slot: 0 });
    expect(a.hp).toBe(300);
    expect(near.hp).toBe(300);
    expect(far.hp).toBe(100);
    expect(foe.hp).toBe(100);
  });

  it('Ghost Shroud turns you invisible until you attack', () => {
    const { w, hero } = humans();
    const a = hero(0, 'vexa');
    const b = hero(1, 'brakk');
    clear(w, [a, b]);
    give(w, a, 'ghostShroud');
    place(a, SPOT.x, SPOT.y);
    place(b, SPOT.x + 2, SPOT.y);
    w.applyCommand({ type: 'useItem', unitId: a.id, slot: 0 });
    expect(isInvisible(a)).toBe(true);
    expect(a.hero!.items[0]!.cooldown).toBeGreaterThan(0);
    w.breakInvisibility(a);
    expect(isInvisible(a)).toBe(false);
  });

  it('Mire Staff slows the enemy you tap; a tap on nothing keeps the item ready', () => {
    const { w, hero } = humans();
    const a = hero(0, 'orin');
    const foe = hero(1, 'brakk');
    clear(w, [a, foe]);
    give(w, a, 'mireStaff');
    place(a, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 6, SPOT.y);
    run(w, 0.2); // vision updates
    w.applyCommand({ type: 'useItem', unitId: a.id, slot: 0, x: SPOT.x - 8, y: SPOT.y });
    expect(a.hero!.items[0]!.cooldown ?? 0).toBe(0);
    const hp = foe.hp;
    w.applyCommand({ type: 'useItem', unitId: a.id, slot: 0, x: foe.x, y: foe.y });
    expect(foe.buffs.some((b) => b.key === 'slow:mireStaff')).toBe(true);
    expect(foe.hp).toBeLessThan(hp);
    expect(a.hero!.items[0]!.cooldown).toBeGreaterThan(0);
  });
});
