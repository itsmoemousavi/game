import { describe, expect, it } from 'vitest';
import { HERO_IDS, HEROES, LANE_IDS, PlayerSlot, TICK_RATE, Team, Unit, World, XP_TABLE } from '../src/sim';

/** All six heroes human-controlled (so they stay idle) and moved into an empty jungle room. */
function arena() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 3, slots });
  const hero = (team: Team, id: string) => w.heroes.find((h) => h.team === team && h.hero!.defId === id)!;
  // Park everybody far apart so nothing interacts unless a test places it.
  w.heroes.forEach((h, i) => place(h, 25 + i * 2, 281));
  return { w, hero };
}

function place(u: Unit, x: number, y: number) {
  u.x = u.px = x;
  u.y = u.py = y;
}

function levelTo(w: World, u: Unit, level: number) {
  w.giveXp(u, XP_TABLE[level - 1] - u.hero!.xp);
  expect(u.hero!.level).toBe(level);
}

function learn(w: World, u: Unit, slot: number, times = 1) {
  for (let i = 0; i < times; i++) w.applyCommand({ type: 'learn', unitId: u.id, slot });
}

const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * TICK_RATE); i++) w.step();
};

describe('skill points', () => {
  it('starts with one point; ultimate unlocks at 6; basics capped by level', () => {
    const { w, hero } = arena();
    const b = hero(0, 'brakk');
    expect(b.hero!.skillPoints).toBe(1);
    learn(w, b, 2);
    expect(b.hero!.abilities[2].level).toBe(0);
    learn(w, b, 0);
    expect(b.hero!.abilities[0].level).toBe(1);
    levelTo(w, b, 2);
    learn(w, b, 0);
    expect(b.hero!.abilities[0].level).toBe(1); // level 2 hero: basic max 1
    levelTo(w, b, 6);
    learn(w, b, 2);
    expect(b.hero!.abilities[2].level).toBe(1);
  });
});

describe('abilities', () => {
  it('Shield Charge dashes into the first enemy hero, damages and stuns it', () => {
    const { w, hero } = arena();
    const b = hero(0, 'brakk');
    const v = hero(1, 'vexa');
    place(b, 72, 156);
    place(v, 80, 156);
    learn(w, b, 0);
    w.applyCommand({ type: 'cast', unitId: b.id, slot: 0, x: 86, y: 156 });
    expect(b.mana).toBeLessThan(b.maxMana);
    expect(b.hero!.abilities[0].cooldown).toBeGreaterThan(0);
    run(w, 0.5);
    expect(v.hp).toBeLessThan(v.maxHp);
    expect(v.stunTimer).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThan(76);
  });

  it('cannot cast on cooldown or without mana', () => {
    const { w, hero } = arena();
    const b = hero(0, 'brakk');
    learn(w, b, 0);
    w.applyCommand({ type: 'cast', unitId: b.id, slot: 0, x: 40, y: 186 });
    const mana = b.mana;
    w.applyCommand({ type: 'cast', unitId: b.id, slot: 0, x: 40, y: 186 });
    expect(b.mana).toBe(mana);
  });

  it('Earthsplitter stuns everyone around Brakk after the wind-up', () => {
    const { w, hero } = arena();
    const b = hero(0, 'brakk');
    const [e1, e2] = [hero(1, 'vexa'), hero(1, 'orin')];
    levelTo(w, b, 6);
    learn(w, b, 2);
    place(b, 78, 156);
    place(e1, 81, 156);
    place(e2, 78, 160);
    e1.hero!.order = { type: 'idle' };
    w.applyCommand({ type: 'cast', unitId: b.id, slot: 2 });
    run(w, 0.3);
    expect(e1.stunTimer).toBe(0); // still winding up
    run(w, 0.5);
    expect(e1.stunTimer).toBeGreaterThan(0);
    expect(e2.stunTimer).toBeGreaterThan(0);
    expect(e2.hp).toBeLessThan(e2.maxHp);
  });

  it('Piercing Arrow hits every enemy in a line', () => {
    const { w, hero } = arena();
    const v = hero(0, 'vexa');
    const [a, b] = [hero(1, 'brakk'), hero(1, 'orin')];
    place(v, 72, 156);
    place(a, 77, 156);
    place(b, 82, 156);
    learn(w, v, 0);
    w.applyCommand({ type: 'cast', unitId: v.id, slot: 0, x: 86, y: 156 });
    run(w, 0.6);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('Arrow Storm damages and slows enemies in the area', () => {
    const { w, hero } = arena();
    const v = hero(0, 'vexa');
    const e = hero(1, 'brakk');
    levelTo(w, v, 6);
    learn(w, v, 2);
    place(v, 72, 156);
    place(e, 80, 156);
    const speed = w.speedOf(e);
    w.applyCommand({ type: 'cast', unitId: v.id, slot: 2, x: 80, y: 156 });
    run(w, 1);
    expect(e.hp).toBeLessThan(e.maxHp);
    expect(w.speedOf(e)).toBeLessThan(speed);
  });

  it("Hunter's Rhythm makes every 4th attack a critical hit", () => {
    const { w, hero } = arena();
    const v = hero(0, 'vexa');
    const e = hero(1, 'brakk');
    learn(w, v, 1);
    place(v, 72, 156);
    place(e, 78, 156);
    const hits: number[] = [];
    const orig = w.dealDamage.bind(w);
    w.dealDamage = (src, t, raw, kind) => {
      if (src === v.id) hits.push(raw);
      orig(src, t, raw, kind);
    };
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: e.id });
    run(w, 7);
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits[3]).toBeCloseTo(hits[0] * HEROES.vexa.abilities[1].values.critMult[0]);
  });

  it('Fireball flies where it is aimed, explodes on the first enemy and splashes nearby enemies', () => {
    const { w, hero } = arena();
    const o = hero(0, 'orin');
    const [a, b] = [hero(1, 'brakk'), hero(1, 'vexa')];
    place(o, 68, 157);
    place(a, 78, 156);
    place(b, 79, 158);
    learn(w, o, 0);
    w.applyCommand({ type: 'cast', unitId: o.id, slot: 0, x: 86, y: 156 });
    run(w, 0.6);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('Fireball can be aimed backwards and can miss', () => {
    const { w, hero } = arena();
    const o = hero(0, 'orin');
    const a = hero(1, 'brakk');
    place(o, 72, 156);
    place(a, 60, 159);
    o.facing = 0; // facing away (east); enemy is behind (west)
    learn(w, o, 0);
    w.applyCommand({ type: 'cast', unitId: o.id, slot: 0, x: 60, y: 159 });
    run(w, 0.8);
    expect(a.hp).toBeLessThan(a.maxHp);

    // Aim straight up instead: no one there, the fireball misses.
    const { w: w2, hero: hero2 } = arena();
    const o2 = hero2(0, 'orin');
    const a2 = hero2(1, 'brakk');
    place(o2, 72, 156);
    place(a2, 84.5, 156); // outside auto-attack range
    learn(w2, o2, 0);
    w2.applyCommand({ type: 'cast', unitId: o2.id, slot: 0, x: 72, y: 142 });
    run(w2, 1);
    expect(a2.hp).toBe(a2.maxHp);
  });

  it('Mending Flame heals an ally over time', () => {
    const { w, hero } = arena();
    const o = hero(0, 'orin');
    const ally = hero(0, 'brakk');
    place(o, 72, 156);
    place(ally, 76, 156);
    ally.hp = 200;
    learn(w, o, 1);
    w.applyCommand({ type: 'cast', unitId: o.id, slot: 1, targetId: ally.id });
    run(w, 4.2);
    expect(ally.hp).toBeGreaterThan(200 + 110);
  });

  it('Cataclysm lands after a delay and leaves burning ground', () => {
    const { w, hero } = arena();
    const o = hero(0, 'orin');
    const e = hero(1, 'vexa');
    levelTo(w, o, 6);
    learn(w, o, 2);
    // Out of Orin's attack range (so only the spell hurts), inside cast range.
    place(o, 68, 157);
    place(e, 80, 156);
    w.applyCommand({ type: 'cast', unitId: o.id, slot: 2, x: 80, y: 156 });
    run(w, 1);
    expect(e.hp).toBe(e.maxHp);
    run(w, 0.7);
    const afterImpact = e.hp;
    expect(afterImpact).toBeLessThan(e.maxHp - 200);
    expect(w.zones.some((z) => z.kind === 'burn')).toBe(true);
    run(w, 1);
    expect(e.hp).toBeLessThan(afterImpact);
  });

  it('Iron Hide blocks part of every attack', () => {
    const { w, hero } = arena();
    const b = hero(0, 'brakk');
    const v = hero(1, 'vexa');
    const before = b.hp;
    w.dealDamage(v.id, b, 50, 'attack');
    const plain = before - b.hp;
    b.hp = before;
    learn(w, b, 1);
    w.dealDamage(v.id, b, 50, 'attack');
    expect(before - b.hp).toBeLessThan(plain - 2);
  });

  it('spells never damage structures', () => {
    const { w } = arena();
    const t1 = w.structures.find((s) => s.team === 1 && s.structure!.tier === 'tower1')!;
    w.dealDamage(w.heroes[0].id, t1, 500, 'spell');
    expect(t1.hp).toBe(t1.maxHp);
  });

  it('stunned heroes cannot move', () => {
    const { w, hero } = arena();
    const b = hero(0, 'brakk');
    place(b, 72, 156);
    w.stun(b, 1);
    w.applyCommand({ type: 'moveDir', unitId: b.id, dx: 1, dy: 0 });
    run(w, 0.5);
    expect(b.x).toBe(72);
    run(w, 1);
    expect(b.x).toBeGreaterThan(72);
  });
});
