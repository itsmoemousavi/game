import { describe, expect, it } from 'vitest';
import { GLYPH_DURATION, HERO_IDS, LANE_IDS, PlayerSlot, RUNE_FIRST, TICK_RATE, Team, Unit, World, buybackCost } from '../src/sim';
import { onRiver } from './helpers';

function humans() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
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
    const r0 = onRiver(w.map, 192);
    const r1 = onRiver(w.map, 192, 5);
    const r2 = onRiver(w.map, 192, 16);
    place(o, r0.x, r0.y); // on the river near the enemy jungle junction
    w.applyCommand({ type: 'placeWard', unitId: o.id, slot, x: r1.x, y: r1.y });
    const ward = w.units.find((u) => u.ward)!;
    expect(ward.ward!.kind).toBe('observer');
    place(o, 20, 186); // walk away: the ward keeps watching
    const foe = hero(1, 'vexa');
    place(foe, r2.x, r2.y); // further down the river, in the ward's sight
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(true);
    expect(w.canSee(1, ward)).toBe(false); // enemy can't see the ward...
    foe.hero!.gold = 1000;
    place(foe, 283, 17); // at their fountain shop
    w.applyCommand({ type: 'buy', unitId: foe.id, itemId: 'sentryWard' });
    place(foe, r1.x + 2, r1.y + 2);
    const s = foe.hero!.items.findIndex((x) => x?.id === 'sentryWard');
    w.applyCommand({ type: 'placeWard', unitId: foe.id, slot: s, x: r1.x + 1, y: r1.y + 1 });
    run(w, 0.2);
    expect(w.canSee(1, ward)).toBe(true); // ...until a sentry reveals it
  });

  it('walks into range to place a far-away ward', () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'observerWard' });
    w.applyCommand({ type: 'placeWard', unitId: o.id, slot: 0, x: 60, y: 240 });
    expect(o.hero!.order.type).toBe('ward');
    run(w, 14);
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
    const a = onRiver(w.map, 40);
    const c = onRiver(w.map, 40, 8.5);
    place(v, a.x, a.y);
    place(foe, c.x, c.y); // just outside Vexa's attack range, inside her vision
    w.addBuff(v, { key: 'rune', t: 20, invisible: true });
    run(w, 0.2);
    expect(w.canSee(1, v)).toBe(false);
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: foe.id });
    run(w, 0.8);
    expect(w.canSee(1, v)).toBe(true);
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
  it('holding attack while steering hits enemies in range on the move, and keeps walking', () => {
    const { w, hero } = humans();
    const b = hero(1, 'brakk');
    const foe = hero(0, 'vexa');
    const a = onRiver(w.map, 40);
    place(b, a.x, a.y);
    place(foe, a.x, a.y + 3);
    foe.maxHp = foe.hp = 1e5;
    run(w, 0.2);
    const y = b.y;
    w.applyCommand({ type: 'moveDir', unitId: b.id, dx: 0, dy: 1 }); // walking past the enemy
    w.applyCommand({ type: 'attackHold', unitId: b.id, held: true });
    run(w, 0.6);
    expect(foe.hp).toBeLessThan(foe.maxHp); // hit on the way...
    expect(b.y).toBeGreaterThan(y + 1); // ...without stopping
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
    const a = onRiver(w.map, 40);
    const c = onRiver(w.map, 40, 12.7);
    place(b, a.x, a.y);
    place(v, c.x, c.y); // in Brakk's vision...
    run(w, 0.2);
    w.time = 181; // ...but at night (10 m vision) she'd be hidden at 12.7 m
    place(v, c.x, c.y);
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

describe('settings & match controls', () => {
  it('surrender ends the match for the other team', () => {
    const { w, hero } = humans();
    w.applyCommand({ type: 'surrender', unitId: hero(0, 'vexa').id });
    expect(w.winner).toBe(1);
  });

  it('auto-learn spends skill points (ultimate first)', () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    w.applyCommand({ type: 'setAutoLearn', unitId: o.id, enabled: true });
    w.giveXp(o, 2300); // level 6
    run(w, 0.1);
    expect(o.hero!.skillPoints).toBe(0);
    expect(o.hero!.abilities[2].level).toBe(1);
  });

  it('spells and critical hits emit damage events for floating numbers', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const e = hero(1, 'brakk');
    const events: string[] = [];
    place(v, 72, 156);
    place(e, 78, 156);
    run(w, 0.2);
    w.applyCommand({ type: 'learn', unitId: v.id, slot: 0 });
    w.applyCommand({ type: 'cast', unitId: v.id, slot: 0, x: 86, y: 156 });
    for (let i = 0; i < 30; i++) {
      w.step();
      for (const ev of w.events) if (ev.type === 'damage') events.push(ev.kind);
    }
    expect(events).toContain('spell');
  });
});

describe('jungle camps fight back', () => {
  it('melee heroes can fight a camp and the camp hits back', () => {
    const { w, hero } = humans();
    run(w, 31);
    const camp = w.map.camps[1];
    const b = hero(0, 'brakk');
    place(b, camp.x - 2, camp.y);
    run(w, 0.2);
    const brute = w.units.find((u) => u.neutral?.camp === 1 && u.maxHp > 500)!;
    w.applyCommand({ type: 'attack', unitId: b.id, targetId: brute.id });
    run(w, 3);
    expect(brute.hp).toBeLessThan(brute.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });
});

describe('streaks, bounties and match stats', () => {
  it('first blood, multi-kills, streaks and shutdown bounties', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const announces: { firstBlood: boolean; multi: number; streak: number; shutdown: number }[] = [];
    const kill = (killer: Unit, victim: Unit) => {
      victim.hp = 1;
      w.dealDamage(killer.id, victim, 10, 'spell');
      for (const e of w.events) if (e.type === 'announce') announces.push(e);
      w.events.length = 0;
    };
    kill(v, hero(1, 'brakk'));
    kill(v, hero(1, 'orin'));
    kill(v, hero(1, 'vexa'));
    expect(announces[0].firstBlood).toBe(true);
    expect(announces[1].multi).toBe(2);
    expect(announces[2].multi).toBe(3);
    expect(announces[2].streak).toBe(3);
    // Ending Vexa's 3-kill streak pays a shutdown bounty.
    const gold = hero(1, 'brakk').hero!.gold;
    hero(1, 'brakk').alive = true;
    kill(hero(1, 'brakk'), v);
    expect(announces[3].shutdown).toBeGreaterThan(0);
    expect(hero(1, 'brakk').hero!.gold).toBeGreaterThan(gold + 150);
    expect(v.hero!.streak).toBe(0);
  });

  it('tracks hero damage, building damage and healing', () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    const ally = hero(0, 'brakk');
    w.dealDamage(o.id, hero(1, 'vexa'), 100, 'spell');
    const t1 = w.structures.find((s) => s.team === 1 && s.structure!.tier === 'tower1')!;
    t1.structure!.backdoor = false;
    w.dealDamage(o.id, t1, 100, 'attack');
    ally.hp = 100;
    place(o, 78, 156);
    place(ally, 80, 156);
    w.applyCommand({ type: 'learn', unitId: o.id, slot: 1 });
    w.applyCommand({ type: 'cast', unitId: o.id, slot: 1, targetId: ally.id });
    run(w, 4.2);
    expect(o.hero!.stats.heroDamage).toBeCloseTo(100);
    expect(o.hero!.stats.buildingDamage).toBeGreaterThan(30);
    expect(o.hero!.stats.healing).toBeGreaterThan(100);
  });
});

describe('death costs gold', () => {
  it('lose 25 + 2.5% of net worth, only from pocket gold; not with a revive charm', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    v.hero!.gold = 2000;
    w.dealDamage(foe.id, v, 1e6, 'spell');
    expect(v.hero!.gold).toBe(2000 - Math.round(25 + 2000 * 0.025));
    // Broke heroes can't go below zero.
    const o = hero(0, 'orin');
    o.hero!.gold = 10;
    w.dealDamage(foe.id, o, 1e6, 'spell');
    expect(o.hero!.gold).toBe(0);
    // Revive charm: no loss.
    const b = hero(0, 'brakk');
    b.hero!.gold = 1000;
    b.hero!.items[0] = { id: 'wardenCharm', count: 1, expiresAt: w.time + 300 };
    w.dealDamage(foe.id, b, 1e6, 'spell');
    expect(b.hero!.gold).toBe(1000);
  });
});
