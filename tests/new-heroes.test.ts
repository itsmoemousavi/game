import { describe, expect, it } from 'vitest';
import { HeroId, LANE_IDS, PlayerSlot, TICK_RATE, Team, Unit, World, XP_TABLE } from '../src/sim';

function arena(a: HeroId[], b: HeroId[]) {
  const slots: PlayerSlot[] = [];
  a.forEach((heroId, i) => slots.push({ team: 0, heroId, controller: 'human', lane: LANE_IDS[i] }));
  b.forEach((heroId, i) => slots.push({ team: 1, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 41, slots });
  const hero = (team: Team, id: string) => w.heroes.find((h) => h.team === team && h.hero!.defId === id)!;
  w.heroes.forEach((h, i) => place(h, 25 + i * 2, 281));
  return { w, hero };
}
const place = (u: Unit, x: number, y: number) => {
  u.x = u.px = x;
  u.y = u.py = y;
};
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * TICK_RATE); i++) w.step();
};
/** Learn an ability (levels the hero to 6 first so there are skill points / the ultimate is open). */
const learn = (w: World, u: Unit, slot: number) => {
  if (u.hero!.level < 6) w.giveXp(u, XP_TABLE[5] - u.hero!.xp);
  w.applyCommand({ type: 'learn', unitId: u.id, slot });
};

describe('Syl, Grom and Kaela', () => {
  it('Shadow Lunge leaps next to the target and damages it', () => {
    const { w, hero } = arena(['syl'], ['grom']);
    const s = hero(0, 'syl');
    const g = hero(1, 'grom');
    place(s, 72, 156);
    place(g, 79, 156);
    run(w, 0.2);
    learn(w, s, 0);
    w.applyCommand({ type: 'cast', unitId: s.id, slot: 0, targetId: g.id });
    expect(Math.hypot(s.x - g.x, s.y - g.y)).toBeLessThan(3);
    expect(g.hp).toBeLessThan(g.maxHp);
  });

  it('Veil makes Syl invisible and faster', () => {
    const { w, hero } = arena(['syl'], ['grom']);
    const s = hero(0, 'syl');
    const g = hero(1, 'grom');
    place(s, 40, 40);
    place(g, 46, 46);
    const speed = w.speedOf(s);
    learn(w, s, 1);
    w.applyCommand({ type: 'cast', unitId: s.id, slot: 1 });
    run(w, 0.3);
    expect(w.canSee(1, s)).toBe(false);
    expect(w.speedOf(s)).toBeGreaterThan(speed);
  });

  it('Execution hits harder on a hurt target', () => {
    const { w, hero } = arena(['syl'], ['grom', 'kaela']);
    const s = hero(0, 'syl');
    const [g, k] = [hero(1, 'grom'), hero(1, 'kaela')];
    learn(w, s, 2);
    place(s, 72, 156);
    place(g, 74, 156);
    g.maxHp = g.hp = 5000;
    w.applyCommand({ type: 'cast', unitId: s.id, slot: 2, targetId: g.id });
    const fresh = 5000 - g.hp;
    k.maxHp = 5000;
    k.hp = 1000;
    place(k, 74, 158);
    run(w, 0.3); // cast time between spells
    s.hero!.abilities[2].cooldown = 0;
    s.mana = s.maxMana;
    w.applyCommand({ type: 'cast', unitId: s.id, slot: 2, targetId: k.id });
    expect(1000 - k.hp).toBeGreaterThan(fresh + 500);
  });

  it('Root Snare and Overgrowth root enemies', () => {
    const { w, hero } = arena(['grom'], ['syl', 'kaela']);
    const g = hero(0, 'grom');
    const [s, k] = [hero(1, 'syl'), hero(1, 'kaela')];
    learn(w, g, 0);
    place(g, 72, 156);
    place(s, 80, 156);
    w.applyCommand({ type: 'cast', unitId: g.id, slot: 0, x: 80, y: 156 });
    run(w, 0.6);
    expect(s.stunTimer).toBeGreaterThan(0);
    learn(w, g, 2);
    place(k, 76, 159);
    s.stunTimer = 0;
    w.applyCommand({ type: 'cast', unitId: g.id, slot: 2 });
    run(w, 0.3);
    expect(k.stunTimer).toBeGreaterThan(0);
    run(w, 1);
    expect(k.hp).toBeLessThan(k.maxHp);
  });

  it('Bark Skin gives armor', () => {
    const { w, hero } = arena(['grom'], ['syl']);
    const g = hero(0, 'grom');
    const armor = w.armorOf(g);
    learn(w, g, 1);
    w.applyCommand({ type: 'cast', unitId: g.id, slot: 1 });
    run(w, 0.2);
    expect(w.armorOf(g)).toBeGreaterThan(armor + 5);
  });

  it('Tidal Wave damages and slows in a line; Brine Veil heals; Maelstrom slows an area', () => {
    const { w, hero } = arena(['kaela', 'grom'], ['syl', 'brakk']);
    const k = hero(0, 'kaela');
    const g = hero(0, 'grom');
    const [s, b] = [hero(1, 'syl'), hero(1, 'brakk')];
    place(k, 68, 157);
    place(s, 75, 156);
    place(b, 79, 156);
    learn(w, k, 0);
    const speed = w.speedOf(s);
    w.applyCommand({ type: 'cast', unitId: k.id, slot: 0, x: 86, y: 156 });
    run(w, 0.6);
    expect(s.hp).toBeLessThan(s.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(w.speedOf(s)).toBeLessThan(speed);
    // Brine Veil on an ally.
    learn(w, k, 1);
    place(g, 70, 157);
    g.hp = 300;
    w.applyCommand({ type: 'cast', unitId: k.id, slot: 1, targetId: g.id });
    expect(g.hp).toBeGreaterThan(300);
    // Maelstrom.
    run(w, 0.3); // cast time between spells
    learn(w, k, 2);
    const hp = b.hp;
    w.applyCommand({ type: 'cast', unitId: k.id, slot: 2, x: 79, y: 156 });
    run(w, 1);
    expect(b.hp).toBeLessThan(hp);
  });

  it('a bots-only match with the new heroes plays out', async () => {
    const slots: PlayerSlot[] = [];
    (['syl', 'grom', 'kaela'] as HeroId[]).forEach((heroId, i) => slots.push({ team: 0, heroId, controller: 'bot', lane: LANE_IDS[i] }));
    (['brakk', 'vexa', 'orin'] as HeroId[]).forEach((heroId, i) => slots.push({ team: 1, heroId, controller: 'bot', lane: LANE_IDS[i] }));
    const w = new World({ seed: 8, slots });
    let casts = 0;
    let n = 0;
    while (w.winner === null && w.time < 60 * 60) {
      w.step();
      // Let the test runner breathe now and then (long synchronous runs time out its heartbeat on CI).
      if (++n % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
      for (const e of w.events) if (e.type === 'cast' && w.unit(e.unitId)?.team === 0) casts++;
    }
    expect(w.winner).not.toBeNull();
    expect(casts).toBeGreaterThan(30);
  }, 90_000);
});
