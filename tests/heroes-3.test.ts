import { describe, expect, it } from 'vitest';
import { HeroId, LANE_IDS, PlayerSlot, TICK_RATE, Team, Unit, World, castBlocker } from '../src/sim';

function arena(a: HeroId[], b: HeroId[], bots = false) {
  const slots: PlayerSlot[] = [];
  a.forEach((heroId, i) => slots.push({ team: 0, heroId, controller: bots ? 'bot' : 'human', lane: LANE_IDS[i] }));
  b.forEach((heroId, i) => slots.push({ team: 1, heroId, controller: bots ? 'bot' : 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 5, slots });
  return { w, hero: (t: Team, id: string) => w.heroes.find((h) => h.team === t && h.hero!.defId === id)! };
}
const place = (u: Unit, x: number, y: number) => {
  u.x = u.px = x;
  u.y = u.py = y;
};
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * TICK_RATE); i++) w.step();
};
const learn = (u: Unit, slot: number, level = 1) => {
  u.hero!.abilities[slot].level = level;
  u.mana = u.maxMana;
};
const SPOT = { x: 150, y: 150 };
const summons = (w: World, o: Unit) => w.units.filter((u) => u.alive && u.summon?.ownerId === o.id);

describe('Morra', () => {
  it('calls wolves that fight, and a new call replaces the old pack', () => {
    const { w, hero } = arena(['morra'], ['brakk']);
    const m = hero(0, 'morra');
    const foe = hero(1, 'brakk');
    place(m, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 5, SPOT.y);
    learn(m, 0);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 0 });
    const pack = summons(w, m);
    expect(pack.length).toBe(1);
    const hp = foe.hp;
    run(w, 3);
    expect(foe.hp).toBeLessThan(hp);
    m.hero!.abilities[0].cooldown = 0;
    m.mana = m.maxMana;
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 0 });
    const again = summons(w, m);
    expect(again.length).toBe(1);
    expect(again.some((u) => pack.includes(u))).toBe(false);
  });

  it('wolves vanish when their time is up', () => {
    const { w, hero } = arena(['morra'], ['brakk']);
    const m = hero(0, 'morra');
    place(m, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    learn(m, 0);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 0 });
    run(w, 36);
    expect(summons(w, m).length).toBe(0);
  });

  it("a creature's kill pays its owner and its death pays the killer", () => {
    const { w, hero } = arena(['morra'], ['brakk']);
    const m = hero(0, 'morra');
    const foe = hero(1, 'brakk');
    place(m, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 3, SPOT.y);
    learn(m, 0);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 0 });
    const [wolf] = summons(w, m);
    foe.hp = 1;
    const before = m.hero!.kills;
    w.dealDamage(wolf.id, foe, 100, 'attack');
    expect(m.hero!.kills).toBe(before + 1);

    const { w: w2, hero: h2 } = arena(['morra'], ['brakk']);
    const m2 = h2(0, 'morra');
    const f2 = h2(1, 'brakk');
    place(m2, SPOT.x, SPOT.y);
    learn(m2, 0);
    w2.applyCommand({ type: 'cast', unitId: m2.id, slot: 0 });
    const [w0] = summons(w2, m2);
    const gold = f2.hero!.gold;
    w0.hp = 1;
    w2.dealDamage(f2.id, w0, 1000, 'attack');
    expect(f2.hero!.gold).toBeGreaterThan(gold);
  });

  it('calls one wolf at levels 1 and 2, two from level 3', () => {
    for (const [level, count] of [[1, 1], [2, 1], [3, 2], [4, 2]]) {
      const { w, hero } = arena(['morra'], ['brakk']);
      const m = hero(0, 'morra');
      place(m, SPOT.x, SPOT.y);
      place(hero(1, 'brakk'), 20, 20);
      learn(m, 0, level);
      w.applyCommand({ type: 'cast', unitId: m.id, slot: 0 });
      expect(summons(w, m).length).toBe(count);
    }
  });

  it('Red Wolf: melee for 14 s with more speed and damage, then back to ranged', () => {
    const { w, hero } = arena(['morra'], ['brakk']);
    const m = hero(0, 'morra');
    place(m, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    m.hero!.level = 6;
    w.applyHeroStats(m);
    learn(m, 2);
    const range = m.attackRange;
    const shot = m.projectileSpeed;
    const damage = m.damage;
    const speed = w.speedOf(m);
    expect(shot).toBeGreaterThan(0);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 2 });
    expect(m.hero!.wolfForm).toBe(true);
    expect(m.attackRange).toBeLessThan(2);
    expect(m.projectileSpeed).toBe(0);
    expect(m.damage).toBe(damage + 35);
    expect(w.speedOf(m)).toBeGreaterThan(speed);
    run(w, 13.5);
    expect(m.hero!.wolfForm).toBe(true);
    run(w, 1);
    expect(m.hero!.wolfForm).toBe(false);
    expect(m.attackRange).toBe(range);
    expect(m.projectileSpeed).toBe(shot);
    expect(m.damage).toBe(damage);
  });

  it('Red Wolf ends on death and she comes back human', () => {
    const { w, hero } = arena(['morra'], ['brakk']);
    const m = hero(0, 'morra');
    const foe = hero(1, 'brakk');
    const range = m.attackRange;
    m.hero!.level = 6;
    learn(m, 2);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 2 });
    m.hp = 1;
    w.dealDamage(foe.id, m, 500, 'spell');
    run(w, 0.1);
    expect(m.hero!.wolfForm).toBe(false);
    expect(m.attackRange).toBe(range);
  });

  it('Red Wolf can land critical hits', () => {
    const { w, hero } = arena(['morra'], ['brakk']);
    const m = hero(0, 'morra');
    const foe = hero(1, 'brakk');
    place(m, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 2, SPOT.y);
    m.hero!.level = 6;
    learn(m, 2);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 2 });
    let crits = 0;
    for (let i = 0; i < 40 * TICK_RATE && m.hero!.wolfForm !== undefined; i++) {
      m.hp = m.maxHp;
      foe.hp = foe.maxHp;
      m.hero!.order = { type: 'attack', targetId: foe.id };
      if (!m.buffs.some((b) => b.key === 'redWolf')) {
        m.hero!.abilities[2].cooldown = 0;
        m.mana = m.maxMana;
        w.applyCommand({ type: 'cast', unitId: m.id, slot: 2 });
      }
      w.step();
      if (m.hero!.lastCrit) crits++;
    }
    expect(crits).toBeGreaterThan(0);
  });

  it('Feral Bond speeds up Morra as a human but not as the Red Wolf; her wolves still get it', () => {
    const { w, hero } = arena(['morra'], ['brakk']);
    const m = hero(0, 'morra');
    place(m, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    m.hero!.level = 6;
    learn(m, 0);
    learn(m, 1);
    learn(m, 2);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 1 });
    expect(m.buffs.some((b) => b.key === 'feralBond')).toBe(true);
    m.buffs = m.buffs.filter((b) => b.key !== 'feralBond');
    m.hero!.abilities[1].cooldown = 0;
    m.mana = m.maxMana;
    run(w, 0.3);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 0 });
    run(w, 0.3);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 2 });
    run(w, 0.3);
    m.mana = m.maxMana;
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 1 });
    expect(m.buffs.some((b) => b.key === 'feralBond')).toBe(false);
    expect(summons(w, m)[0].buffs.some((b) => b.key === 'feralBond')).toBe(true);
  });

  it('Feral Bond heals creatures and makes them hit harder', () => {
    const { w, hero } = arena(['morra'], ['brakk']);
    const m = hero(0, 'morra');
    place(m, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    learn(m, 0);
    learn(m, 1);
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 0 });
    run(w, 0.3);
    const [wolf] = summons(w, m);
    wolf.hp = 50;
    w.applyCommand({ type: 'cast', unitId: m.id, slot: 1 });
    expect(wolf.hp).toBeGreaterThan(50);
    expect(wolf.buffs.some((b) => b.damageMult)).toBe(true);
  });
});

describe('Seren', () => {
  it('Aegis lasts 3 seconds', () => {
    const { w, hero } = arena(['seren'], ['vexa']);
    const s = hero(0, 'seren');
    place(s, SPOT.x, SPOT.y);
    place(hero(1, 'vexa'), 20, 20);
    learn(s, 0);
    w.applyCommand({ type: 'cast', unitId: s.id, slot: 0, targetId: s.id });
    run(w, 2.8);
    expect(s.buffs.some((b) => b.key === 'aegis')).toBe(true);
    run(w, 0.4);
    expect(s.buffs.some((b) => b.key === 'aegis')).toBe(false);
  });

  it('Aegis soaks up damage of any kind, then breaks', () => {
    const { w, hero } = arena(['seren', 'brakk'], ['vexa']);
    const s = hero(0, 'seren');
    const a = hero(0, 'brakk');
    const foe = hero(1, 'vexa');
    place(s, SPOT.x, SPOT.y);
    place(a, SPOT.x + 3, SPOT.y);
    place(foe, 20, 20);
    learn(s, 0);
    w.applyCommand({ type: 'cast', unitId: s.id, slot: 0, targetId: a.id });
    const hp = a.hp;
    w.dealDamage(foe.id, a, 60, 'spell');
    expect(a.hp).toBe(hp);
    w.events.length = 0;
    w.dealDamage(foe.id, a, 200, 'spell');
    expect(a.hp).toBeLessThan(hp);
    expect(w.events.some((e) => e.type === 'shieldBreak')).toBe(true);
    run(w, 0.1);
    expect(a.buffs.some((b) => b.key === 'aegis')).toBe(false);
  });

  it('Rebuke damages and slows everything along its line', () => {
    const { w, hero } = arena(['seren'], ['vexa', 'brakk']);
    const s = hero(0, 'seren');
    const [a, b] = [hero(1, 'vexa'), hero(1, 'brakk')];
    place(s, SPOT.x, SPOT.y);
    place(a, SPOT.x + 3, SPOT.y);
    place(b, SPOT.x + 7, SPOT.y);
    learn(s, 1);
    const [ha, hb] = [a.hp, b.hp];
    w.applyCommand({ type: 'cast', unitId: s.id, slot: 1, x: SPOT.x + 10, y: SPOT.y });
    run(w, 0.6);
    expect(a.hp).toBeLessThan(ha);
    expect(b.hp).toBeLessThan(hb);
    expect(a.buffs.some((x) => x.key === 'slow:rebuke')).toBe(true);
  });

  it('Sanctuary protects allies inside, slows enemies, and ends', () => {
    const { w, hero } = arena(['seren'], ['vexa']);
    const s = hero(0, 'seren');
    const foe = hero(1, 'vexa');
    place(s, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 2, SPOT.y);
    s.hero!.level = 6;
    learn(s, 2);
    const hit = () => {
      const hp = s.hp;
      w.dealDamage(foe.id, s, 100, 'spell');
      const d = hp - s.hp;
      s.hp = hp;
      return d;
    };
    const open = hit();
    w.applyCommand({ type: 'cast', unitId: s.id, slot: 2, x: SPOT.x, y: SPOT.y });
    run(w, 0.2);
    expect(hit()).toBeCloseTo(open * 0.55);
    expect(foe.buffs.some((b) => b.key === 'slow:sanctuary')).toBe(true);
    run(w, 5);
    expect(hit()).toBeCloseTo(open);
  });
});

describe('Rhen', () => {
  it('Gale Step dashes through enemies without stopping, and speeds up attacks', () => {
    const { w, hero } = arena(['rhen'], ['brakk']);
    const r = hero(0, 'rhen');
    const foe = hero(1, 'brakk');
    place(r, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 3, SPOT.y);
    learn(r, 0);
    w.applyCommand({ type: 'cast', unitId: r.id, slot: 0, x: SPOT.x + 7, y: SPOT.y });
    expect(r.buffs.some((b) => b.key === 'galeStep')).toBe(true);
    run(w, 0.4);
    expect(foe.stunTimer).toBe(0);
    expect(r.x).toBeGreaterThan(SPOT.x + 5);
  });

  it('Hawk Mark lowers armor and shows the target even when it goes invisible', () => {
    const { w, hero } = arena(['rhen'], ['syl']);
    const r = hero(0, 'rhen');
    const foe = hero(1, 'syl');
    place(r, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 6, SPOT.y);
    run(w, 0.2);
    learn(r, 1);
    const armor = w.armorOf(foe);
    w.applyCommand({ type: 'cast', unitId: r.id, slot: 1, targetId: foe.id });
    expect(w.armorOf(foe)).toBeCloseTo(armor - 3);
    foe.buffs.push({ key: 'veil', t: 3, invisible: true });
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(true);
    run(w, 6);
    expect(w.armorOf(foe)).toBeCloseTo(armor);
  });

  it('Bolt Storm fires at enemies on its own and stops when it ends', () => {
    const { w, hero } = arena(['rhen'], ['brakk']);
    const r = hero(0, 'rhen');
    const foe = hero(1, 'brakk');
    place(r, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 6, SPOT.y);
    r.hero!.level = 6;
    learn(r, 2);
    run(w, 0.2);
    const hp = foe.hp;
    w.applyCommand({ type: 'cast', unitId: r.id, slot: 2 });
    run(w, 1.5);
    expect(foe.hp).toBeLessThan(hp);
    run(w, 3);
    foe.hp = foe.maxHp;
    run(w, 1);
    expect(foe.hp).toBeGreaterThan(foe.maxHp - 60);
    expect(castBlocker(r, 2)).toBe('cooldown');
  });
});

describe('bots play the new heroes', () => {
  it('a full match runs with all three, and they use their spells', async () => {
    const { w } = arena(['morra', 'seren', 'rhen'], ['brakk', 'orin', 'vexa'], true);
    let wolves = 0;
    let shields = 0;
    let storms = 0;
    for (let i = 0; i < 30 * 60 * TICK_RATE && w.winner === null; i++) {
      w.step();
      for (const e of w.events) if (e.type === 'summon') wolves++;
      if (w.heroes.some((h) => h.buffs.some((b) => b.key === 'aegis'))) shields++;
      if (w.heroes.some((h) => h.buffs.some((b) => b.key === 'boltStorm'))) storms++;
      if (i % 600 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    expect(wolves).toBeGreaterThan(0);
    expect(shields).toBeGreaterThan(0);
    expect(storms).toBeGreaterThan(0);
  }, 120000);
});
