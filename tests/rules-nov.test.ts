import { describe, expect, it } from 'vitest';
import { HERO_IDS, LANE_IDS, PlayerSlot, TICK_RATE, Team, Unit, World, heightAt, isWalkable, pointAlong, polylineLength } from '../src/sim';

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

describe('uphill misses', () => {
  it('melee attacks never miss uphill', () => {
    const { w, hero } = humans();
    const b = hero(1, 'brakk');
    const v = hero(0, 'vexa');
    // Find the plateau edge on the way out of team 0's base: high ground right next to low ground.
    const s = w.map.shrines[0];
    let hi = { x: 0, y: 0 };
    let lo = { x: 0, y: 0 };
    for (let d = 20; d < 60; d += 0.25) {
      const a = { x: s.x + d * Math.SQRT1_2, y: s.y - d * Math.SQRT1_2 };
      const c = { x: a.x + 0.25 * Math.SQRT1_2, y: a.y - 0.25 * Math.SQRT1_2 };
      if (heightAt(w.map, a.x, a.y) > heightAt(w.map, c.x, c.y) && isWalkable(w.map, a.x, a.y) && isWalkable(w.map, c.x, c.y)) {
        hi = { x: a.x - 0.5 * Math.SQRT1_2, y: a.y + 0.5 * Math.SQRT1_2 };
        lo = { x: c.x + 0.5 * Math.SQRT1_2, y: c.y - 0.5 * Math.SQRT1_2 };
        break;
      }
    }
    expect(heightAt(w.map, lo.x, lo.y)).toBeLessThan(heightAt(w.map, hi.x, hi.y));
    place(v, hi.x, hi.y);
    place(b, lo.x, lo.y);
    v.maxHp = v.hp = 1e6;
    b.maxHp = b.hp = 1e6;
    v.moveSpeed = 0;
    let misses = 0;
    let attacks = 0;
    for (let i = 0; i < 20 * TICK_RATE; i++) {
      place(v, hi.x, hi.y);
      w.applyCommand({ type: 'attack', unitId: b.id, targetId: v.id });
      w.step();
      for (const e of w.events) {
        if (e.type === 'miss' && e.sourceId === b.id) misses++;
        if (e.type === 'attack' && e.sourceId === b.id) attacks++;
      }
    }
    expect(attacks).toBeGreaterThan(10);
    expect(misses).toBe(0);
  });
});

describe('wards', () => {
  it('die to exactly two attacks and ignore spells', () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    const foe = hero(1, 'brakk');
    const ward = w.spawnUnit('ward', 0, { x: 150, y: 120 }, { hp: 200, armor: 0, damage: 0, attackInterval: 0, attackRange: 0, projectileSpeed: 0, moveSpeed: 0, radius: 0.6, acquireRange: 0, bountyGold: 50, bountyXp: 50 });
    ward.ward = { kind: 'observer', expires: 1e9 };
    void o;
    w.dealDamage(foe.id, ward, 9999, 'spell');
    expect(ward.hp).toBe(ward.maxHp);
    w.dealDamage(foe.id, ward, 1, 'attack');
    expect(ward.alive).toBe(true);
    expect(ward.hp).toBeCloseTo(ward.maxHp / 2);
    w.dealDamage(foe.id, ward, 1, 'attack');
    run(w, 0.1);
    expect(ward.alive).toBe(false);
  });

  it("can't be placed inside the Warden's house", () => {
    const { w, hero } = humans();
    const o = hero(0, 'orin');
    o.hero!.gold = 1000;
    w.applyCommand({ type: 'buy', unitId: o.id, itemId: 'observerWard' });
    const slot = o.hero!.items.findIndex((s) => s?.id === 'observerWard');
    const h = w.map.house;
    place(o, h.x + 2, h.y);
    w.applyCommand({ type: 'placeWard', unitId: o.id, slot, x: h.x - 2, y: h.y });
    run(w, 0.5);
    expect(w.units.some((u) => u.ward && u.alive)).toBe(false);
  });
});

describe("the Warden's house walls", () => {
  it('block sight from inside too: heroes in the house see nothing outside', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    const h = w.map.house;
    place(v, h.x + h.door.x * 3, h.y + h.door.y * 3);
    place(foe, h.x + h.door.x * 11, h.y + h.door.y * 11); // right outside the doorway
    run(w, 0.3);
    expect(w.canSee(0, foe)).toBe(false);
    place(v, h.x + h.door.x * 14, h.y + h.door.y * 14); // step out: now visible
    run(w, 0.3);
    expect(w.canSee(0, foe)).toBe(true);
  });

  it('respawns the Warden a random 8-11 minutes after it dies', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const boss = w.units.find((u) => u.neutral?.boss)!;
    place(v, w.map.house.x + 2, w.map.house.y);
    v.maxHp = v.hp = 1e7;
    w.dealDamage(v.id, boss, 1e7, 'spell');
    run(w, 0.1);
    expect(boss.alive).toBe(false);
    expect(w.bossRespawnAt! - w.time).toBeGreaterThanOrEqual(8 * 60 - 1);
    expect(w.bossRespawnAt! - w.time).toBeLessThanOrEqual(11 * 60);
  });
});

describe('fountain yards', () => {
  it('are walled all round except one doorway facing the map centre', () => {
    const { w } = humans();
    for (const t of [0, 1] as Team[]) {
      const y = w.map.fountainYards[t];
      const r = (y.inner + y.outer) / 2;
      const openAngles: number[] = [];
      for (let a = 0; a < 360; a += 2) {
        const rad = (a * Math.PI) / 180;
        if (isWalkable(w.map, y.x + Math.cos(rad) * r, y.y + Math.sin(rad) * r)) openAngles.push(rad);
      }
      expect(openAngles.length).toBeGreaterThan(0);
      // Every open spot on the ring is in the doorway (toward the map centre).
      for (const a of openAngles) expect(Math.cos(a) * y.door.x + Math.sin(a) * y.door.y).toBeGreaterThan(0.85);
      const toCentre = { x: w.map.size / 2 - y.x, y: w.map.size / 2 - y.y };
      expect(toCentre.x * y.door.x + toCentre.y * y.door.y).toBeGreaterThan(0);
    }
  });

  it('hide the yard from enemies outside the wall, but not through the doorway', () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    const y = w.map.fountainYards[0];
    const f = w.map.fountains[0];
    foe.maxHp = foe.hp = 1e7;
    place(v, f.x + 6 * y.door.x, f.y + 6 * y.door.y); // in the yard
    // Outside the wall, off to the side of the doorway (still on open ground).
    const side = { x: -y.door.y, y: y.door.x };
    let spot: { x: number; y: number } | null = null;
    for (let d = y.outer + 1; d < y.outer + 6 && !spot; d += 0.5) {
      for (const s of [1, -1]) {
        const a = Math.PI / 4;
        const p = { x: y.x + (Math.cos(a) * y.door.x + s * Math.sin(a) * side.x) * d, y: y.y + (Math.cos(a) * y.door.y + s * Math.sin(a) * side.y) * d };
        if (isWalkable(w.map, p.x, p.y)) spot = p;
      }
    }
    expect(spot).not.toBeNull();
    place(foe, spot!.x, spot!.y);
    run(w, 0.2);
    place(foe, spot!.x, spot!.y);
    expect(w.canSee(1, v)).toBe(false);
    // Standing in the doorway looking in: visible.
    place(foe, y.x + y.door.x * (y.outer + 1), y.y + y.door.y * (y.outer + 1));
    run(w, 0.2);
    expect(w.canSee(1, v)).toBe(true);
  });
});

describe('side lanes and the river', () => {
  it('side lanes are solid ground all the way; only mid crosses water', () => {
    const { w } = humans();
    for (const lane of ['top', 'bot'] as const) {
      const path = w.map.lanes[lane];
      const len = polylineLength(path);
      for (let d = 0; d < len; d += 1) {
        const p = pointAlong(path, d);
        expect(heightAt(w.map, p.x, p.y)).toBeGreaterThanOrEqual(1);
        expect(isWalkable(w.map, p.x, p.y)).toBe(true);
      }
    }
    const mid = w.map.lanes.mid;
    let water = 0;
    for (let d = 0; d < polylineLength(mid); d += 1) {
      const p = pointAlong(mid, d);
      if (heightAt(w.map, p.x, p.y) === 0) water++;
    }
    expect(water).toBeGreaterThan(5);
  });

  it('the river ends at each side lane with a slope you can walk up onto the lane', () => {
    const { w } = humans();
    for (const end of [w.map.riverPath[0], w.map.riverPath[w.map.riverPath.length - 1]]) {
      // Walk from the water toward the river's end: it stays walkable, and climbs to the lane.
      const i = end === w.map.riverPath[0] ? 6 : w.map.riverPath.length - 7;
      const from = w.map.riverPath[i];
      expect(heightAt(w.map, from.x, from.y)).toBe(0);
      const dx = end.x - from.x;
      const dy = end.y - from.y;
      const l = Math.hypot(dx, dy);
      let reachedLane = false;
      for (let t = 0; t <= l + 4; t += 0.5) {
        const x = from.x + (dx / l) * t;
        const y = from.y + (dy / l) * t;
        expect(isWalkable(w.map, x, y)).toBe(true);
        if (heightAt(w.map, x, y) >= 1) reachedLane = true;
      }
      expect(reachedLane).toBe(true);
    }
  });

  it('the hard-lane tier-1 stands near the corner, clear of the water, with a trail behind it', () => {
    const { w } = humans();
    const t1 = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1' && s.structure!.lane === 'top')!;
    expect(t1.y).toBeLessThan(80); // up near the top-left corner
    const end = w.map.riverPath[0];
    expect(Math.hypot(t1.x - end.x, t1.y - end.y)).toBeGreaterThan(18);
    // A trail leaves the lane on the inner side a little behind the tower.
    let open = 0;
    for (let x = t1.x + 6; x < t1.x + 28; x += 1) if (isWalkable(w.map, x, t1.y + 12)) open++;
    expect(open).toBeGreaterThan(14);
  });
});
