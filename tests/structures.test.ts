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

  it('opens tier-2 and barracks of a lane only when that lane tier-1 falls', () => {
    const w = newWorld();
    destroy(w, get(w, 1, 'tower1', 'top')[0]);
    expect(get(w, 1, 'tower2', 'top')[0].structure!.vulnerable).toBe(true);
    expect(get(w, 1, 'barracks', 'top')[0].structure!.vulnerable).toBe(true);
    expect(get(w, 1, 'tower2', 'mid')[0].structure!.vulnerable).toBe(false);
    expect(get(w, 1, 'shrineTower')[0].structure!.vulnerable).toBe(false);
  });

  it('opens shrine towers after any barracks, and the shrine after both shrine towers', () => {
    const w = newWorld();
    destroy(w, get(w, 1, 'tower1', 'bot')[0]);
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

  it('never lets the fountain be damaged', () => {
    const w = newWorld();
    const f = get(w, 1, 'fountain')[0];
    w.dealDamage(w.heroes[0].id, f, 1e9);
    expect(f.alive).toBe(true);
  });
});
