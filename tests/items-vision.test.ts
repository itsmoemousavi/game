import { describe, expect, it } from 'vitest';
import {
  DAY_SECONDS,
  HERO_IDS,
  ITEMS,
  LANE_IDS,
  PlayerSlot,
  TELEPORT,
  TICK_RATE,
  Team,
  Unit,
  World,
  effectiveCooldown,
  isNight,
} from '../src/sim';

function humans() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
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

describe('shop & items', () => {
  it('buys only at base, with enough gold, and applies stats', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const dmg = v.damage;
    w.applyCommand({ type: 'buy', unitId: v.id, itemId: 'ironBlade' });
    expect(v.hero!.items[0]?.id).toBe('ironBlade');
    expect(v.damage).toBe(dmg + 15);
    expect(v.hero!.gold).toBeCloseTo(600 - ITEMS.ironBlade.cost);
    w.applyCommand({ type: 'buy', unitId: v.id, itemId: 'crownOfAscension' }); // too expensive
    expect(v.hero!.items[1]).toBeNull();
    place(v, 100, 100);
    v.hero!.gold = 5000;
    w.applyCommand({ type: 'buy', unitId: v.id, itemId: 'vitalStone' }); // away from base
    expect(v.hero!.items[1]).toBeNull();
  });

  it('has 6 slots, stacks salves, sells for half price', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    b.hero!.gold = 10000;
    for (let i = 0; i < 3; i++) w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'healingSalve' });
    expect(b.hero!.items[0]).toEqual({ id: 'healingSalve', count: 3 });
    for (let i = 0; i < 6; i++) w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'guardPlate' });
    expect(b.hero!.items.filter(Boolean).length).toBe(6);
    const gold = b.hero!.gold;
    w.applyCommand({ type: 'sell', unitId: b.id, slot: 1 });
    expect(b.hero!.gold).toBe(gold + ITEMS.guardPlate.cost / 2);
    expect(b.hero!.items[1]).toBeNull();
  });

  it('Healing Salve heals over time and is consumed', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    w.applyCommand({ type: 'buy', unitId: b.id, itemId: 'healingSalve' });
    place(b, 52, 104);
    b.hp = 200;
    w.applyCommand({ type: 'useItem', unitId: b.id, slot: 0 });
    expect(b.hero!.items[0]).toBeNull();
    run(w, 8.1);
    expect(b.hp).toBeGreaterThan(200 + 330);
  });

  it('Focus Lens and the Crown reduce cooldowns; Lifedrinker heals on hit', () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    o.hero!.gold = 10000;
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'focusLens' });
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'crownOfAscension' });
    const r = { cooldown: [90, 80, 70], ultimate: true } as never;
    expect(effectiveCooldown(o, r, 1)).toBeCloseTo(90 * 0.85 * 0.7);
    const v = hero(0, 'vexa');
    v.hero!.gold = 2000;
    w.applyCommand({ type: 'buy', unitId: v.id, itemId: 'lifedrinker' });
    const e = hero(1, 'brakk');
    v.hp = 100;
    w.dealDamage(v.id, e, 100, 'attack');
    expect(v.hp).toBeGreaterThan(100);
  });
});

describe('teleport', () => {
  it('buy as many as you like; channel 3s; lands next to the building; cooldown', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    for (let i = 0; i < 4; i++) w.applyCommand({ type: 'buyTp', unitId: v.id });
    expect(v.hero!.tpCount).toBe(4);
    const t1 = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1' && s.structure!.lane === 'mid')!;
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: t1.id });
    run(w, TELEPORT.channel - 0.5);
    expect(Math.hypot(v.x - t1.x, v.y - t1.y)).toBeGreaterThan(50);
    run(w, 0.7);
    expect(Math.hypot(v.x - t1.x, v.y - t1.y)).toBeLessThan(10);
    expect(v.hero!.tpCount).toBe(3);
    expect(v.hero!.tpCooldown).toBeGreaterThan(50);
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: t1.id });
    expect(v.hero!.channel).toBeNull(); // on cooldown
  });

  it('moving or a stun cancels the channel; cannot teleport to enemy buildings', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    w.applyCommand({ type: 'buyTp', unitId: v.id });
    const mine = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1')!;
    const theirs = w.structures.find((s) => s.team === 1 && s.structure!.tier === 'tower1')!;
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: theirs.id });
    expect(v.hero!.channel).toBeNull();
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: mine.id });
    expect(v.hero!.channel).not.toBeNull();
    run(w, 1);
    w.applyCommand({ type: 'moveDir', unitId: v.id, dx: 1, dy: 0 });
    expect(v.hero!.channel).toBeNull();
    expect(v.hero!.tpCount).toBe(1);
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: mine.id });
    w.stun(v, 1);
    run(w, 3.5);
    expect(v.hero!.tpCount).toBe(1);
  });
});

describe('fog of war & day/night', () => {
  it('hides enemies outside vision and blocks attacking them', () => {
    const { w, hero } = humans();
    const me = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    place(me, 52, 104);
    place(foe, 136, 60); // the enemy's jungle: none of our units or buildings see it
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(false);
    w.applyCommand({ type: 'attack', unitId: me.id, targetId: foe.id });
    expect(me.hero!.order.type).not.toBe('attack');
    place(foe, 58, 104);
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(true);
  });

  it('night shrinks hero vision', () => {
    const { w, hero } = humans();
    const me = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    place(me, 52, 104);
    place(foe, 52, 90); // 14 m away: inside day vision (17), outside night vision (10)
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(true);
    w.time = DAY_SECONDS + 1;
    expect(isNight(w.time)).toBe(true);
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(false);
  });
});

describe('jungle camps', () => {
  it('spawn at 0:30, stay passive, fight back when attacked, leash home, and pay gold', () => {
    const { w, hero } = humans();
    run(w, 31);
    const camp = w.map.camps[0];
    const neutrals = w.units.filter((u) => u.neutral?.camp === 0);
    expect(neutrals.length).toBe(3);
    const v = hero(0, 'vexa');
    place(v, camp.x + 7, camp.y);
    run(w, 1);
    expect(v.hp).toBe(v.maxHp); // passive
    const imp = neutrals.find((n) => n.maxHp < 500)!;
    const gold = v.hero!.gold;
    v.damage = 200; // speed the test up
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: imp.id });
    run(w, 4);
    expect(imp.alive).toBe(false);
    expect(v.hero!.gold).toBeGreaterThan(gold + 30);
    expect(v.hp).toBeLessThan(v.maxHp); // the camp fought back
    // Run away: they give up and go home.
    w.applyCommand({ type: 'moveTo', unitId: v.id, x: 20, y: 150 });
    run(w, 10);
    for (const n of neutrals.filter((x) => x.alive)) {
      expect(Math.hypot(n.x - n.neutral!.homeX, n.y - n.neutral!.homeY)).toBeLessThan(1);
    }
  });
});
