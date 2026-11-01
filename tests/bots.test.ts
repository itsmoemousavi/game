import { describe, expect, it } from 'vitest';
import { BotDifficulty, HERO_IDS, LANE_IDS, PlayerSlot, TICK_RATE, Team, World } from '../src/sim';

const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * TICK_RATE) && w.winner === null; i++) w.step();
};

describe('smarter bots', () => {
  it('bots come to defend a tower that enemy heroes are attacking', () => {
    const slots: PlayerSlot[] = [];
    // Azure: bots. Crimson: idle "humans" that we park at Azure's top tier-1 tower.
    for (const team of [0, 1] as Team[])
      HERO_IDS.forEach((heroId, i) => slots.push({ team, heroId, controller: team === 0 ? 'bot' : 'human', lane: LANE_IDS[i] }));
    const w = new World({ seed: 31, slots });
    run(w, 20);
    const t1 = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1' && s.structure!.lane === 'bot')!;
    for (const e of w.heroes.filter((h) => h.team === 1)) {
      e.x = e.px = t1.x + 6;
      e.y = e.py = t1.y - 3;
      e.maxHp = e.hp = 1e6;
      w.applyCommand({ type: 'attack', unitId: e.id, targetId: t1.id });
    }
    run(w, 25);
    const helpers = w.heroes.filter((h) => h.team === 0 && h.alive && Math.hypot(h.x - t1.x, h.y - t1.y) < 20);
    expect(helpers.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it('hard bots beat easy bots', () => {
    const slots: PlayerSlot[] = [];
    const diff: BotDifficulty[] = ['hard', 'easy'];
    for (const team of [0, 1] as Team[])
      HERO_IDS.forEach((heroId, i) => slots.push({ team, heroId, controller: 'bot', lane: LANE_IDS[i], difficulty: diff[team] }));
    const w = new World({ seed: 7, slots });
    run(w, 50 * 60);
    expect(w.winner).toBe(0);
    expect(w.teamKills[0]).toBeGreaterThan(w.teamKills[1]);
  }, 120_000);
});
