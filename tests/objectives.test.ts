import { describe, expect, it } from 'vitest';
import { GLYPH_DURATION, HERO_IDS, LANE_IDS, PlayerSlot, RUNE_FIRST, TICK_RATE, Team, Unit, World, buybackCost } from '../src/sim';

function humans() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 11, slots });
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

describe('denying', () => {
  it('can last-hit own creeps below 50% (no gold to the enemy), not above', () => {
    const { w, hero } = humans();
    run(w, 4); // first wave
    const v = hero(0, 'vexa');
    const mine = w.units.find((u) => u.creep && u.team === 0 && u.creep.lane === 'mid')!;
    place(v, mine.x - 3, mine.y);
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: mine.id });
    expect(v.hero!.order.type).toBe('idle'); // full health: not deniable
    mine.hp = 30;
    const enemyGold = hero(1, 'vexa').hero!.gold;
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: mine.id });
    expect(v.hero!.order.type).toBe('attack');
    let denied = false;
    for (let i = 0; i < 3 * TICK_RATE && !denied; i++) {
      w.step();
      denied = w.events.some((e) => e.type === 'deny');
    }
    expect(denied).toBe(true);
    expect(mine.alive).toBe(false);
    expect(hero(1, 'vexa').hero!.gold).toBeLessThan(enemyGold + 10); // only passive income
  });

  it('can deny own towers below 10% only', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    const t1 = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1')!;
    expect(w.canDeny(b, t1)).toBe(false);
    t1.hp = t1.maxHp * 0.05;
    expect(w.canDeny(b, t1)).toBe(true);
  });
});

describe('wards', () => {
  it('observer wards give vision, are invisible to enemies, revealed by sentries', () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    o.hero!.gold = 1000;
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'observerWard' });
    const slot = o.hero!.items.findIndex((s) => s?.id === 'observerWard');
    place(o, 128, 128); // on the river near the enemy jungle junction
    w.applyCommand({ type: 'placeWard', unitId: o.id, slot, x: 132, y: 132 });
    const ward = w.units.find((u) => u.ward)!;
    expect(ward.ward!.kind).toBe('observer');
    place(o, 20, 186); // walk away: the ward keeps watching
    const foe = hero(1, 'vexa');
    place(foe, 142, 142); // further down the river, in the ward's sight
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(true);
    expect(w.canSee(1, ward)).toBe(false); // enemy can't see the ward...
    foe.hero!.gold = 1000;
    place(foe, 186, 14); // at their fountain shop
    w.applyCommand({ type: 'buy', unitId: foe.id, itemId: 'sentryWard' });
    place(foe, 136, 136);
    const s = foe.hero!.items.findIndex((x) => x?.id === 'sentryWard');
    w.applyCommand({ type: 'placeWard', unitId: foe.id, slot: s, x: 137, y: 137 });
    run(w, 0.2);
    expect(w.canSee(1, ward)).toBe(true); // ...until a sentry reveals it
  });

  it('walks into range to place a far-away ward', () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'observerWard' });
    w.applyCommand({ type: 'placeWard', unitId: o.id, slot: 0, x: 40, y: 160 });
    expect(o.hero!.order.type).toBe('ward');
    run(w, 6);
    expect(w.units.some((u) => u.ward && u.team === 0)).toBe(true);
  });
});

describe('power-ups', () => {
  it('appear at 1:00 at a river spot and apply on pickup', () => {
    const { w, hero } = humans();
    run(w, RUNE_FIRST + 0.1);
    expect(w.runes.length).toBe(1);
    const r = w.runes[0];
    const v = hero(0, 'vexa');
    const gold = v.hero!.gold;
    place(v, r.x, r.y);
    run(w, 0.1);
    expect(w.runes.length).toBe(0);
    const got = v.buffs.some((b) => b.key === 'rune') || v.hero!.gold > gold + 50;
    expect(got).toBe(true);
  });

  it('invisibility hides the hero until it attacks', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    place(v, 40, 40);
    place(foe, 49, 49); // just outside Vexa's attack range, inside her vision
    w.addBuff(v, { key: 'rune', t: 20, invisible: true });
    run(w, 0.2);
    expect(w.canSee(1, v)).toBe(false);
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: foe.id });
    run(w, 0.3);
    expect(w.canSee(1, v)).toBe(true);
  });
});

describe('boss', () => {
  it('drops a revive charm; the holder revives on the spot', () => {
    const { w, hero } = humans();
    const boss = w.units.find((u) => u.neutral?.boss)!;
    expect(boss).toBeDefined();
    const b = hero(0, 'brakk');
    place(b, boss.x - 3, boss.y);
    run(w, 0.2); // let vision catch up
    boss.hp = 1; // (bosses heal at home, so set this right before attacking)
    w.applyCommand({ type: 'attack', unitId: b.id, targetId: boss.id });
    run(w, 2);
    expect(boss.alive).toBe(false);
    expect(b.buffs.some((x) => x.key === 'charm')).toBe(true);
    expect(w.bossRespawnAt).not.toBeNull();
    const deathAt = { x: b.x, y: b.y };
    w.dealDamage(hero(1, 'vexa').id, b, 99999, 'spell');
    expect(b.alive).toBe(false);
    run(w, 3.2);
    expect(b.alive).toBe(true);
    expect(Math.hypot(b.x - deathAt.x, b.y - deathAt.y)).toBeLessThan(1);
  });
});

describe('buyback, tower shield, backdoor', () => {
  it('buyback respawns immediately for gold, then has a cooldown', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    v.hero!.gold = 2000;
    w.dealDamage(hero(1, 'brakk').id, v, 99999, 'spell');
    w.applyCommand({ type: 'buyback', unitId: v.id });
    run(w, 0.1);
    expect(v.alive).toBe(true);
    expect(v.hero!.gold).toBeLessThan(2000 - buybackCost(1, 0) + 5);
    w.dealDamage(hero(1, 'brakk').id, v, 99999, 'spell');
    w.applyCommand({ type: 'buyback', unitId: v.id });
    run(w, 0.1);
    expect(v.alive).toBe(false);
  });

  it('tower shield makes all team buildings invulnerable for a few seconds', () => {
    const { w, hero } = humans();
    const t1 = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1')!;
    w.applyCommand({ type: 'glyph', unitId: hero(0, 'orin').id });
    w.dealDamage(hero(1, 'vexa').id, t1, 500, 'attack');
    expect(t1.hp).toBe(t1.maxHp);
    run(w, GLYPH_DURATION + 0.1);
    w.dealDamage(hero(1, 'vexa').id, t1, 500, 'attack');
    expect(t1.hp).toBeLessThan(t1.maxHp);
    expect(w.glyphCooldown[0]).toBeGreaterThan(200);
  });

  it('inner buildings resist hero-only attacks; tier-1 towers do not', () => {
    const { w, hero } = humans();
    run(w, 1);
    const v = hero(1, 'vexa');
    const t1 = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1' && s.structure!.lane === 'top')!;
    const t2 = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower2' && s.structure!.lane === 'top')!;
    w.dealDamage(v.id, t1, 1e9, 'attack'); // open up tier 2
    w.dealDamage(v.id, t2, 400, 'attack');
    const lost = t2.maxHp - t2.hp;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(400 * 0.3);
  });
});

describe('walk + attack (multi-touch)', () => {
  it('holding attack while steering hits enemies in range, and keeps walking when none are', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    const foe = hero(1, 'vexa');
    place(b, 40, 40);
    place(foe, 42, 40);
    run(w, 0.2);
    w.applyCommand({ type: 'moveDir', unitId: b.id, dx: 0, dy: 1 }); // steering away
    w.applyCommand({ type: 'attackHold', unitId: b.id, held: true });
    run(w, 2);
    expect(foe.hp).toBeLessThan(foe.maxHp);
    expect(b.hero!.order.type).toBe('dir'); // still steering
    place(foe, 140, 60); // enemy gone: keep walking
    const y0 = b.y;
    run(w, 1);
    expect(b.y).toBeGreaterThan(y0 + 3);
    w.applyCommand({ type: 'attackHold', unitId: b.id, held: false });
    expect(b.hero!.attackHeld).toBe(false);
  });
});

describe('visibility & auto attack', () => {
  it('an attacker hidden in the fog becomes visible for a moment', () => {
    const { w, hero } = humans();
    const v = hero(1, 'vexa');
    const b = hero(0, 'brakk');
    place(b, 40, 40);
    place(v, 49, 49); // in Brakk's vision...
    run(w, 0.2);
    w.time = 181; // ...but at night (10 m vision) she'd be hidden at 12.7 m
    place(v, 49, 49);
    run(w, 0.2);
    expect(w.canSee(0, v)).toBe(false);
    v.visionNight = 20; // (test) Vexa can see Brakk; Brakk can't see her
    run(w, 0.2);
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: b.id });
    run(w, 1);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(w.canSee(0, v)).toBe(true);
  });

  it('an invisible hero does not auto-attack (stays hidden)', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    place(v, 40, 40);
    place(foe, 44, 44);
    w.addBuff(v, { key: 'rune', t: 20, invisible: true });
    run(w, 2);
    expect(foe.hp).toBe(foe.maxHp);
    expect(w.canSee(1, v)).toBe(false);
  });

  it('auto attack can be switched off', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    w.applyCommand({ type: 'setAutoAttack', unitId: v.id, enabled: false });
    w.applyCommand({ type: 'setAutoAttack', unitId: foe.id, enabled: false });
    place(v, 40, 40);
    place(foe, 44, 44);
    run(w, 2);
    expect(foe.hp).toBe(foe.maxHp);
  });

  it('assists go to every other enemy hero that recently hurt the victim', () => {
    const { w, hero } = humans();
    const victim = hero(1, 'orin');
    const helper = hero(0, 'brakk');
    const killer = hero(0, 'vexa');
    w.dealDamage(helper.id, victim, 100, 'spell');
    w.dealDamage(killer.id, victim, 99999, 'spell');
    expect(killer.hero!.kills).toBe(1);
    expect(helper.hero!.assists).toBe(1);
    expect(killer.hero!.assists).toBe(0);
  });
});
