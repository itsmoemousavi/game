import { describe, expect, it } from 'vitest';
import { Team, Unit, World } from '../src/sim';
import { newWorld } from './helpers';

const get = (w: World, team: Team, tier: string, lane: string | null = null) =>
  w.structures.filter((s) => s.team === team && s.structure!.tier === tier && (lane === null || s.structure!.lane === lane));

function destroy(w: World, u: Unit) {
  const enemyHero = w.heroes.find((h) => h.team !== u.team)!;
  w.dealDamage(enemyHero.id, u, 1e9);
  expect(u.alive).toBe(false);
}

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

  it('opens a lane tower by tower: tier-2 after tier-1, then tier-3 and barracks after tier-2', () => {
    const w = newWorld();
    destroy(w, get(w, 1, 'tower1', 'top')[0]);
    expect(get(w, 1, 'tower2', 'top')[0].structure!.vulnerable).toBe(true);
    expect(get(w, 1, 'tower3', 'top')[0].structure!.vulnerable).toBe(false);
    expect(get(w, 1, 'barracks', 'top')[0].structure!.vulnerable).toBe(false);
    expect(get(w, 1, 'tower2', 'mid')[0].structure!.vulnerable).toBe(false);
    destroy(w, get(w, 1, 'tower2', 'top')[0]);
    expect(get(w, 1, 'tower3', 'top')[0].structure!.vulnerable).toBe(true);
    expect(get(w, 1, 'barracks', 'top')[0].structure!.vulnerable).toBe(true);
    expect(get(w, 1, 'shrineTower')[0].structure!.vulnerable).toBe(false);
  });

  it('opens shrine towers after any barracks, and the shrine after both shrine towers', () => {
    const w = newWorld();
    destroy(w, get(w, 1, 'tower1', 'bot')[0]);
    destroy(w, get(w, 1, 'tower2', 'bot')[0]);
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
