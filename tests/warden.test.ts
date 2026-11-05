import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, WARDEN_MOVE_SECONDS, CHARM_DURATION, HERO_IDS, LANE_IDS, PlayerSlot, TICK_RATE, Team, Unit, WARDEN_GOLD, WARDEN_LEASH, World, inHouse, isWalkable } from '../src/sim';
import { moveWardenTo } from '../src/sim/objectives';

function humans() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 11, slots });
  moveWardenTo(w, w.units.find((u) => u.neutral?.boss)!, 0);
  const hero = (team: Team, id: string) => w.heroes.find((h) => h.team === team && h.hero!.defId === id)!;
  const boss = () => w.units.find((u) => u.neutral?.boss && u.alive)!;
  return { w, hero, boss, slots };
}
const place = (u: Unit, x: number, y: number) => {
  u.x = u.px = x;
  u.y = u.py = y;
};
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * TICK_RATE); i++) w.step();
};
/** A spot `d` meters from the house centre, out through the doorway (d > outer = outside). */
const doorway = (w: World, d: number) => ({ x: w.map.house.x + w.map.house.door.x * d, y: w.map.house.y + w.map.house.door.y * d });

describe("the Warden's house", () => {
  it('is a walled room with one doorway', () => {
    const { w } = humans();
    const h = w.map.house;
    let gaps = 0;
    let opens = 0;
    let prevOpen = false;
    // Walk round the middle of the wall: it is solid except for one doorway.
    for (let a = 0; a < 360; a += 2) {
      const r = (a * Math.PI) / 180;
      const open = isWalkable(w.map, h.x + Math.cos(r) * ((h.inner + h.outer) / 2), h.y + Math.sin(r) * ((h.inner + h.outer) / 2));
      if (open && !prevOpen) gaps++;
      if (open) opens++;
      prevOpen = open;
    }
    expect(gaps).toBe(1);
    expect(opens).toBeLessThan(180 * 0.3); // (an all-open ring would also count as "one gap")
    expect(inHouse(w.map, h.x + 4, h.y)).toBe(true);
    expect(inHouse(w.map, doorway(w, 10.5).x, doorway(w, 14).y)).toBe(false);
  });

  it('is dark from outside, even from the doorway; you see the Warden only from inside', () => {
    const { w, hero, boss } = humans();
    const v = hero(0, 'vexa');
    const out = doorway(w, 10.5);
    place(v, out.x, out.y);
    run(w, 0.3);
    expect(w.canSee(0, boss())).toBe(false);
    const inside = doorway(w, 4);
    place(v, inside.x, inside.y);
    run(w, 0.3);
    expect(w.canSee(0, boss())).toBe(true);
    expect(w.canSee(1, boss())).toBe(false); // the other team still sees nothing
  });

  it('can only be hurt from inside; heroes outside walk in to attack', () => {
    const { w, hero, boss } = humans();
    const v = hero(0, 'vexa');
    const out = doorway(w, 10.5);
    place(v, out.x, out.y);
    const hp = boss().hp;
    w.dealDamage(v.id, boss(), 500, 'spell');
    expect(boss().hp).toBe(hp);
    // Ordered to attack from inside vision range: it walks in through the door first.
    const inside = doorway(w, 4);
    place(v, inside.x, inside.y);
    run(w, 0.3);
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: boss().id });
    run(w, 3);
    expect(boss().hp).toBeLessThan(hp);
    expect(inHouse(w.map, v.x, v.y)).toBe(true);
  });

  it('slams the ground every few seconds and stuns everyone close by', () => {
    const { w, hero, boss } = humans();
    const b = hero(0, 'brakk');
    b.maxHp = b.hp = 1e6;
    place(b, boss().x - 3.5, boss().y);
    run(w, 0.3);
    w.applyCommand({ type: 'attack', unitId: b.id, targetId: boss().id });
    let stuns = 0;
    let wasStunned = false;
    for (let i = 0; i < 20 * TICK_RATE; i++) {
      w.step();
      const s = b.stunTimer > 0;
      if (s && !wasStunned) stuns++;
      wasStunned = s;
    }
    expect(stuns).toBeGreaterThanOrEqual(2);
    expect(stuns).toBeLessThanOrEqual(3);
  });

  it('chases attackers only so far, then goes home', () => {
    const { w, hero, boss } = humans();
    const v = hero(0, 'vexa');
    v.maxHp = v.hp = 1e6;
    const home = { x: boss().x, y: boss().y };
    const inside = doorway(w, 4);
    place(v, inside.x, inside.y);
    run(w, 0.3);
    w.dealDamage(v.id, boss(), 100, 'attack');
    expect(boss().targetId).toBe(v.id);
    // Run far away out of the door.
    const far = doorway(w, WARDEN_LEASH + 12);
    w.applyCommand({ type: 'moveTo', unitId: v.id, x: far.x, y: far.y });
    let maxAway = 0;
    for (let i = 0; i < 15 * TICK_RATE; i++) {
      w.step();
      maxAway = Math.max(maxAway, Math.hypot(boss().x - home.x, boss().y - home.y));
    }
    expect(maxAway).toBeGreaterThan(5); // it did come after her
    expect(maxAway).toBeLessThan(WARDEN_LEASH + 1);
    run(w, 10);
    expect(Math.hypot(boss().x - home.x, boss().y - home.y)).toBeLessThan(1);
  });
});

describe("the Warden's reward", () => {
  it('killing blow takes full gold, teammates half; the charm drops for anyone to take', () => {
    const { w, hero, boss } = humans();
    const b = hero(0, 'brakk');
    const ally = hero(0, 'vexa');
    const foe = hero(1, 'orin');
    place(b, boss().x - 3.5, boss().y);
    run(w, 0.3);
    const g0 = b.hero!.gold;
    const a0 = ally.hero!.gold;
    const f0 = foe.hero!.gold;
    boss().hp = 1;
    w.applyCommand({ type: 'attack', unitId: b.id, targetId: boss().id });
    run(w, 2);
    expect(w.units.some((u) => u.neutral?.boss && u.alive)).toBe(false);
    // Everyone gets the same passive gold, so compare against the enemy.
    const passive = foe.hero!.gold - f0;
    expect(b.hero!.gold - g0 - passive).toBe(WARDEN_GOLD);
    expect(ally.hero!.gold - a0 - passive).toBe(WARDEN_GOLD / 2);
    const charm = w.groundItems.find((g) => g.item.id === 'wardenCharm')!;
    expect(charm).toBeDefined();
    // An enemy walks in and steals it.
    place(foe, charm.x + 4, charm.y);
    w.applyCommand({ type: 'pickUp', unitId: foe.id, groundId: charm.id });
    run(w, 3);
    expect(foe.hero!.items.some((s) => s?.id === 'wardenCharm')).toBe(true);
    // It can't be sold.
    w.applyCommand({ type: 'sell', unitId: foe.id, slot: foe.hero!.items.findIndex((s) => s?.id === 'wardenCharm') });
    expect(foe.hero!.items.some((s) => s?.id === 'wardenCharm')).toBe(true);
    // The holder dies: back on their feet on the spot, the charm used up, no gold lost.
    const deathAt = { x: foe.x, y: foe.y };
    const gold = foe.hero!.gold;
    w.dealDamage(b.id, foe, 1e6, 'spell');
    expect(foe.alive).toBe(false);
    expect(foe.hero!.gold).toBe(gold);
    run(w, 3.2);
    expect(foe.alive).toBe(true);
    expect(Math.hypot(foe.x - deathAt.x, foe.y - deathAt.y)).toBeLessThan(1);
    expect(foe.hero!.items.some((s) => s?.id === 'wardenCharm')).toBe(false);
  });

  it('the charm crumbles 5 minutes after the Warden falls if nobody died with it', () => {
    const { w, hero, boss } = humans();
    const b = hero(0, 'brakk');
    place(b, boss().x - 3.5, boss().y);
    run(w, 0.3);
    boss().hp = 1;
    w.applyCommand({ type: 'attack', unitId: b.id, targetId: boss().id });
    run(w, 2);
    const charm = w.groundItems.find((g) => g.item.id === 'wardenCharm')!;
    w.applyCommand({ type: 'pickUp', unitId: b.id, groundId: charm.id });
    run(w, 2);
    expect(b.hero!.items.some((s) => s?.id === 'wardenCharm')).toBe(true);
    expect(CHARM_DURATION).toBe(300);
    run(w, CHARM_DURATION - 6);
    expect(b.hero!.items.some((s) => s?.id === 'wardenCharm')).toBe(true);
    run(w, 3);
    expect(b.hero!.items.some((s) => s?.id === 'wardenCharm')).toBe(false);
  });
});

describe('two houses', () => {
  const boss = (w: World) => w.units.find((u) => u.alive && u.neutral?.boss)!;
  const dusk = (w: World) => {
    w.time = DAY_SECONDS - 0.05;
    w.wasNight = false;
  };

  it('there is a house on each side and the Warden starts in either one', async () => {
    const { w } = humans();
    const [a, b] = w.map.houses;
    expect(a.x + b.x).toBe(w.map.size);
    expect(a.y + b.y).toBe(w.map.size);
    expect(inHouse(w.map, a.x, a.y)).toBe(true);
    expect(inHouse(w.map, b.x, b.y)).toBe(true);
    const seen = new Set<number>();
    const { slots } = humans();
    for (let seed = 1; seed < 9 && seen.size < 2; seed++) {
      seen.add(new World({ seed, slots }).wardenHouse);
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(seen.size).toBe(2);
  });

  it('as night falls it teleports to the other house, keeping its wounds', () => {
    const { w } = humans();
    const u = boss(w);
    u.hp -= 500;
    const hp = u.hp;
    const [, other] = w.map.houses;
    dusk(w);
    run(w, WARDEN_MOVE_SECONDS + 0.5);
    expect(w.wardenHouse).toBe(1);
    expect(Math.hypot(u.x - other.x, u.y - other.y)).toBeLessThan(1);
    expect(u.hp).toBeGreaterThan(hp - 1);
  });

  it('a stun stops the teleport and it stays until the next nightfall', () => {
    const { w } = humans();
    const u = boss(w);
    dusk(w);
    run(w, 1);
    expect(u.neutral!.moveAt).not.toBeNull();
    w.stun(u, 1);
    run(w, WARDEN_MOVE_SECONDS + 2);
    expect(u.neutral!.moveAt).toBeNull();
    expect(w.wardenHouse).toBe(0);
    expect(Math.hypot(u.x - w.map.houses[0].x, u.y - w.map.houses[0].y)).toBeLessThan(6);
  });
});
