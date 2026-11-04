import { describe, expect, it } from 'vitest';
import { HERO_IDS, LANE_IDS, PlayerSlot, Team, World, statusEffects } from '../src/sim';

function humans() {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 5, slots });
  const hero = (team: Team, id: string) => w.heroes.find((h) => h.team === team && h.hero!.defId === id)!;
  return { w, hero };
}

describe('status icons', () => {
  it("Vexa's crit counter shows 1-3 and is hidden at 0", () => {
    const { w, hero } = humans();
    const v = hero(0, 'vexa');
    const count = () => statusEffects(w, v).find((s) => s.id === 'rhythmCount')?.count;
    v.hero!.attackCount = 1;
    expect(count()).toBeUndefined(); // passive not learned yet
    v.hero!.abilities[1].level = 1;
    const seen = [0, 1, 2, 3, 4, 5].map((n) => {
      v.hero!.attackCount = n;
      return count();
    });
    expect(seen).toEqual([undefined, 1, 2, 3, undefined, 1]);
  });

  it('helpful effects are green, harmful ones red, helpful listed first', () => {
    const { w, hero } = humans();
    const b = hero(0, 'brakk');
    w.addBuff(b, { key: 'slow:tidalWave', t: 2, slowPct: 30 });
    w.addBuff(b, { key: 'salve', t: 8, healPerSec: 10 });
    w.stun(b, 1.5);
    const list = statusEffects(w, b);
    expect(list.map((s) => [s.id, s.good])).toEqual([
      ['salve', true],
      ['stun', false],
      ['slow', false],
    ]);
    expect(list.find((s) => s.id === 'stun')!.left).toBeCloseTo(1.5);
  });
});
