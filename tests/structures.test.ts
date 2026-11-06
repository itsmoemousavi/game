import { describe, expect, it } from 'vitest';
import { FOUNTAIN_HEAL_RADIUS, TICK_RATE, Team, Unit, World, dHypot, teamLanePath } from '../src/sim';
import { newWorld } from './helpers';

const get = (w: World, team: Team, tier: string, lane: string | null = null) =>
  w.structures.filter((s) => s.team === team && s.structure!.tier === tier && (lane === null || s.structure!.lane === lane));

function destroy(w: World, u: Unit) {
  const enemyHero = w.heroes.find((h) => h.team !== u.team)!;
  w.dealDamage(enemyHero.id, u, 1e9);
  expect(u.alive).toBe(false);
}

describe('rules from playing it', () => {
  it('a melee barracks regenerates 5 health a second and a ranged one does not', () => {
    const w = newWorld();
    const [melee, ranged] = ['melee', 'ranged'].map((k) => get(w, 1, 'barracks', 'top').find((r) => r.structure!.rax === k)!);
    melee.hp = ranged.hp = 1000;
    for (let i = 0; i < 2 * TICK_RATE; i++) w.step();
    expect(melee.hp).toBeCloseTo(1010, 3);
    expect(ranged.hp).toBe(1000);
  });

  it("the fountain covers its healing area and its doorway, and never shoots past its wall", () => {
    const w = newWorld();
    const f = get(w, 0, 'fountain')[0];
    const yard = w.map.fountainYards[0];
    const foe = w.heroes.find((h) => h.team === 1)!;
    const at = (d: number, angle = 0) => {
      foe.x = f.x + Math.cos(angle) * d;
      foe.y = f.y + Math.sin(angle) * d;
      return w.inReach(f, foe);
    };
    expect(at(FOUNTAIN_HEAL_RADIUS)).toBe(true);
    expect(at(yard.outer)).toBe(false);
    expect(at(yard.outer + 1)).toBe(false);
  });

  it('after one Shrine tower falls, creeps walk over to the other one and take it down', () => {
    const w = newWorld();
    for (const s of w.structures) {
      if (s.team !== 1 || !['tower1', 'tower2', 'tower3', 'barracks'].includes(s.structure!.tier)) continue;
      s.alive = false;
      s.hp = 0;
    }
    w.rebuildNav();
    w.refreshVulnerability();
    const path = teamLanePath(w.map, 0, 'bot');
    const end = path[path.length - 1];
    const [far, close] = get(w, 1, 'shrineTower').sort((a, b) => dHypot(b.x - path[path.length - 2].x, b.y - path[path.length - 2].y) - dHypot(a.x - path[path.length - 2].x, a.y - path[path.length - 2].y));
    destroy(w, close);
    w.heroes.forEach((h) => { h.x = 20; h.y = 20; });
    const start = path[path.length - 2];
    const creepOf = () => w.units.find((u) => u.alive && u.creep && u.team === 0 && u.creep.lane === 'bot');
    while (!creepOf()) w.step();
    const creep = creepOf()!;
    const others = () => w.units.filter((u) => u !== creep && u.creep).forEach((u) => w.expire(u));
    creep.x = start.x;
    creep.y = start.y;
    creep.creep!.wp = path.length - 1;
    creep.hp = creep.maxHp = 1e6;
    let attacked = false;
    for (let i = 0; i < 40 * TICK_RATE && !attacked; i++) {
      others();
      w.step();
      attacked = creep.targetId === far.id;
    }
    expect(attacked, `creep ended at ${creep.x.toFixed(0)},${creep.y.toFixed(0)}, Shrine at ${end.x},${end.y}`).toBe(true);
  });
});

describe('structure protection rules', () => {
  it('starts with only tier-1 towers attackable', () => {
    const w = newWorld();
    for (const s of w.structures) {
      expect(s.structure!.vulnerable).toBe(s.structure!.tier === 'tower1');
    }
  });

  it('ignores damage to protected structures', () => {
    const w = newWorld();
    const t2 = get(w, 1, 'tower2', 'mid')[0];
    w.dealDamage(w.heroes[0].id, t2, 500);
    expect(t2.hp).toBe(t2.maxHp);
  });

  it('opens a lane tower by tower: tier-2 after tier-1, tier-3 after tier-2, then the barracks after tier-3', () => {
    const w = newWorld();
    destroy(w, get(w, 1, 'tower1', 'top')[0]);
    expect(get(w, 1, 'tower2', 'top')[0].structure!.vulnerable).toBe(true);
    expect(get(w, 1, 'tower3', 'top')[0].structure!.vulnerable).toBe(false);
    expect(get(w, 1, 'barracks', 'top')[0].structure!.vulnerable).toBe(false);
    expect(get(w, 1, 'tower2', 'mid')[0].structure!.vulnerable).toBe(false);
    destroy(w, get(w, 1, 'tower2', 'top')[0]);
    expect(get(w, 1, 'tower3', 'top')[0].structure!.vulnerable).toBe(true);
    expect(get(w, 1, 'barracks', 'top')[0].structure!.vulnerable).toBe(false);
    destroy(w, get(w, 1, 'tower3', 'top')[0]);
    for (const r of get(w, 1, 'barracks', 'top')) expect(r.structure!.vulnerable).toBe(true);
    expect(get(w, 1, 'barracks', 'mid')[0].structure!.vulnerable).toBe(false);
    expect(get(w, 1, 'shrineTower')[0].structure!.vulnerable).toBe(false);
  });

  it('opens shrine towers after any barracks, and the shrine after both shrine towers', () => {
    const w = newWorld();
    destroy(w, get(w, 1, 'tower1', 'bot')[0]);
    destroy(w, get(w, 1, 'tower2', 'bot')[0]);
    destroy(w, get(w, 1, 'tower3', 'bot')[0]);
    destroy(w, get(w, 1, 'barracks', 'bot')[0]);
    const [a, b] = get(w, 1, 'shrineTower');
    expect(a.structure!.vulnerable && b.structure!.vulnerable).toBe(true);
    const shrine = get(w, 1, 'shrine')[0];
    expect(shrine.structure!.vulnerable).toBe(false);
    destroy(w, a);
    expect(shrine.structure!.vulnerable).toBe(false);
    destroy(w, b);
    expect(shrine.structure!.vulnerable).toBe(true);
    destroy(w, shrine);
    expect(w.winner).toBe(0);
  });

  it('each lane has a melee and a ranged barracks; each powers up its own creep type when it falls', () => {
    const w = newWorld();
    const rax = get(w, 1, 'barracks', 'mid');
    expect(rax.map((r) => r.structure!.rax).sort()).toEqual(['melee', 'ranged']);
    const melee = rax.find((r) => r.structure!.rax === 'melee')!;
    const ranged = rax.find((r) => r.structure!.rax === 'ranged')!;
    expect(melee.maxHp).toBeGreaterThan(ranged.maxHp);
    expect(melee.armor).toBeGreaterThan(ranged.armor);
    destroy(w, get(w, 1, 'tower1', 'mid')[0]);
    destroy(w, get(w, 1, 'tower2', 'mid')[0]);
    destroy(w, get(w, 1, 'tower3', 'mid')[0]);
    destroy(w, melee);
    const before = new Set(w.units.map((u) => u.id));
    while (w.units.every((u) => before.has(u.id) || !u.creep)) w.step();
    const wave = w.units.filter((u) => !before.has(u.id) && u.creep && u.team === 0 && u.creep.lane === 'mid');
    expect(wave.filter((c) => c.creep!.type === 'melee').every((c) => c.creep!.super)).toBe(true);
    expect(wave.filter((c) => c.creep!.type === 'ranged').every((c) => !c.creep!.super)).toBe(true);
  });

  it('the tower shield also makes towers attack twice as fast', () => {
    const w = newWorld();
    const t1 = get(w, 0, 'tower1', 'mid')[0];
    const foe = w.heroes.find((h) => h.team === 1)!;
    const shots = (glyph: boolean) => {
      t1.structure!.glyph = glyph ? 999 : 0;
      foe.x = foe.px = t1.x + 3;
      foe.y = foe.py = t1.y;
      foe.maxHp = foe.hp = 1e6;
      let n = 0;
      for (let i = 0; i < 4 * 30; i++) {
        w.step();
        n += w.events.filter((e) => e.type === 'attack' && e.sourceId === t1.id).length;
      }
      return n;
    };
    const normal = shots(false);
    const fast = shots(true);
    expect(fast).toBeGreaterThanOrEqual(normal * 2 - 1);
  });

  it('never lets the fountain be damaged', () => {
    const w = newWorld();
    const f = get(w, 1, 'fountain')[0];
    w.dealDamage(w.heroes[0].id, f, 1e9);
    expect(f.alive).toBe(true);
  });
});
