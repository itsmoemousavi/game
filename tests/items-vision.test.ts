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
  heightAt,
  CREEPS,
  isWalkable,
  lineClear,
} from '../src/sim';

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
    expect(b.hero!.items[0]).toMatchObject({ id: 'healingSalve', count: 3 });
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
    place(me, 78, 156);
    place(foe, 204, 90); // the enemy's jungle: none of our units or buildings see it
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(false);
    w.applyCommand({ type: 'attack', unitId: me.id, targetId: foe.id });
    expect(me.hero!.order.type).not.toBe('attack');
    place(foe, 84, 156);
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(true);
  });

  it('night shrinks hero vision', () => {
    const { w, hero } = humans();
    const me = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    // Along the open river, 14 m apart, away from towers: inside day vision (17), outside night vision (10).
    place(me, 40, 40);
    place(foe, 50, 50);
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(true);
    w.time = DAY_SECONDS + 1;
    expect(isNight(w.time)).toBe(true);
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(false);
  });
});

describe('high ground', () => {
  it('cannot see up onto a base plateau from below, but can see down from it', () => {
    const { w, hero } = humans();
    const me = hero(1, 'vexa'); // enemy approaching Azure's base
    const foe = hero(0, 'brakk');
    const shrine = w.map.shrines[0];
    place(foe, shrine.x + 26, shrine.y - 26); // on Azure's plateau
    place(me, shrine.x + 33, shrine.y - 33); // down the mid lane, ~10 m away
    expect(heightAt(w.map, foe.x, foe.y)).toBe(2);
    expect(heightAt(w.map, me.x, me.y)).toBe(1);
    run(w, 0.2);
    expect(w.canSee(1, foe)).toBe(false); // can't see up
    expect(w.canSee(0, me)).toBe(true); // but they see down
  });

  it('a ward on a hill sees over the forest into the paths', () => {
    const { w, hero } = humans();
    const hill = w.map.hills[0];
    expect(heightAt(w.map, hill.x, hill.y)).toBe(3);
    const o = hero(0, 'orin');
    o.hero!.gold = 500;
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'observerWard' });
    place(o, hill.x, hill.y);
    w.applyCommand({ type: 'placeWard', unitId: o.id, slot: 0, x: hill.x, y: hill.y });
    place(o, 20, 186);
    // Find a spot 10–14 m from the hill that a ground-level viewer couldn't see (trees in between).
    let spot: { x: number; y: number } | null = null;
    for (let a = 0; a < 360 && !spot; a += 7) {
      for (const r of [10, 12, 14]) {
        const p = { x: hill.x + Math.cos((a * Math.PI) / 180) * r, y: hill.y + Math.sin((a * Math.PI) / 180) * r };
        if (isWalkable(w.map, p.x, p.y) && heightAt(w.map, p.x, p.y) === 1 && !lineClear(w.map, hill, p)) {
          spot = p;
          break;
        }
      }
    }
    expect(spot).not.toBeNull();
    const foe = hero(1, 'vexa');
    place(foe, spot!.x, spot!.y);
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(true);
  });
});

describe('trees block sight', () => {
  it('cannot see through the forest, but can see along an open lane at the same distance', () => {
    const { w, hero } = humans();
    const me = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    // Jungle room (78,156) and a point 12 m away in a direction blocked by solid forest.
    place(me, 78, 156);
    let blocked: { x: number; y: number } | null = null;
    for (let a = 0; a < 360 && !blocked; a += 5) {
      const p = { x: 78 + Math.cos((a * Math.PI) / 180) * 12, y: 156 + Math.sin((a * Math.PI) / 180) * 12 };
      // Clearly behind trees: blocked even with the line shifted 1.5 m either side.
      const shifted = [-1.5, 0, 1.5].every((o) => !lineClear(w.map, { x: me.x + o, y: me.y + o }, { x: p.x + o, y: p.y - o }));
      if (shifted && isWalkable(w.map, p.x, p.y)) blocked = p;
    }
    expect(blocked).not.toBeNull();
    place(foe, blocked!.x, blocked!.y);
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(false);
    // Same 12 m but along the open corridor toward the river.
    place(foe, 78 + 12 * 0.41, 156 - 12 * 0.91);
    run(w, 0.2);
    expect(w.canSee(0, foe)).toBe(true);
  });
});

describe('movement around buildings', () => {
  it('creeps never get stuck on towers or barracks over a long game', () => {
    const slots: PlayerSlot[] = [];
    for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'bot', lane: LANE_IDS[i] }));
    const w = new World({ seed: 9, slots });
    // Per creep: where it was when it last had nothing to do (no fight, no crowd).
    const idleSince = new Map<number, { x: number; y: number; t: number }>();
    for (let i = 0; i < 12 * 60 * TICK_RATE; i++) {
      w.step();
      for (const c of w.units) {
        if (!c.creep || !c.alive) continue;
        const busy =
          c.targetId !== null ||
          c.stunTimer > 0 ||
          c.creep.wp >= c.creep.path.length ||
          // Waiting behind other units (a creep queue at a fight) isn't being stuck on a building.
          w.units.some((o) => o !== c && o.alive && !o.structure && Math.hypot(o.x - c.x, o.y - c.y) < 3);
        const prev = idleSince.get(c.id);
        if (busy || !prev) {
          idleSince.set(c.id, { x: c.x, y: c.y, t: w.time });
          continue;
        }
        if (w.time - prev.t < 5) continue;
        // Idle for 5 s next to a building: it must have made progress.
        const near = w.units.some((s) => s.structure && s.alive && Math.hypot(s.x - c.x, s.y - c.y) < s.radius + 3);
        if (near) expect(Math.hypot(c.x - prev.x, c.y - prev.y), `creep stuck at ${c.x.toFixed(1)},${c.y.toFixed(1)}`).toBeGreaterThan(1);
        idleSince.set(c.id, { x: c.x, y: c.y, t: w.time });
      }
    }
  }, 60_000);

  it('Shield Charge dashes past buildings instead of stopping at them', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    const t1 = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1' && s.structure!.lane === 'mid')!;
    // Stand 4 m before our own mid tower and charge straight through it along the lane.
    const dir = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    place(b, t1.x - dir.x * 4, t1.y - dir.y * 4);
    w.applyCommand({ type: 'learn', unitId: b.id, slot: 0 });
    w.applyCommand({ type: 'cast', unitId: b.id, slot: 0, x: t1.x + dir.x * 10, y: t1.y + dir.y * 10 });
    run(w, 0.6);
    const along = (b.x - t1.x) * dir.x + (b.y - t1.y) * dir.y;
    expect(along).toBeGreaterThan(2); // ended up beyond the tower
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

describe('uphill attacks', () => {
  it('attacks from low ground onto high ground sometimes miss', () => {
    const { w, hero } = humans();
    const v = hero(1, 'vexa');
    const b = hero(0, 'brakk');
    const shrine = w.map.shrines[0];
    place(b, shrine.x + 29.5, shrine.y - 29.5); // on the plateau edge
    place(v, shrine.x + 33.5, shrine.y - 33.5); // below, in range
    b.maxHp = b.hp = 1e6;
    v.maxHp = v.hp = 1e6; // (the base towers shoot at her)
    // Vexa's team needs vision up there (a ward or a creep would provide it).
    w.spawnUnit('creep', 1, { x: shrine.x + 30, y: shrine.y - 30 }, CREEPS.melee).hp = 1e6;
    let misses = 0;
    let hits = 0;
    run(w, 0.2);
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: b.id });
    for (let i = 0; i < 40 * TICK_RATE; i++) {
      w.step();
      for (const e of w.events) {
        if (e.type === 'miss' && e.sourceId === v.id) misses++;
        if (e.type === 'attack' && e.sourceId === v.id) hits++;
      }
    }
    expect(hits).toBeGreaterThan(15);
    expect(misses).toBeGreaterThan(0);
    expect(misses).toBeLessThan(hits * 0.5);
  });
});
