/**
 * Average bots-only match length (to check that tougher buildings don't drag games out).
 *   npx vite-node scripts/match-length.ts [firstSeed] [matches]
 */
import { HERO_IDS, HeroId, LANE_IDS, PlayerSlot, Rng, Team, World } from '../src/sim';
import { STRUCTURES } from '../src/sim/data/units';

// Try other tower numbers without editing the data: TOWERS="hp,damage,armor;..." for tiers 1, 2, 3, shrine.
if (process.env.TOWERS) {
  const tiers = ['tower1', 'tower2', 'tower3', 'shrineTower'] as const;
  process.env.TOWERS.split(';').forEach((t, i) => {
    const [hp, damage, armor] = t.split(',').map(Number);
    Object.assign(STRUCTURES[tiers[i]], { hp, damage, armor });
  });
}

const first = Number(process.argv[2] ?? 100);
const count = Number(process.argv[3] ?? 6);
const times: number[] = [];
let unfinished = 0;
for (let seed = first; seed < first + count; seed++) {
  const rng = new Rng(seed * 7919);
  const pool = [...HERO_IDS].sort(() => rng.next() - 0.5);
  const teams: HeroId[][] = [pool.slice(0, 3), pool.slice(3, 6)];
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) teams[team].forEach((heroId, i) => slots.push({ team, heroId, controller: 'bot', lane: LANE_IDS[i] }));
  const w = new World({ seed, slots });
  while (w.winner === null && w.time < 50 * 60) w.step();
  if (w.winner === null) unfinished++;
  times.push(w.time / 60);
}
console.log(`matches ${count}  avg ${(times.reduce((a, b) => a + b, 0) / count).toFixed(1)} min  unfinished ${unfinished}  [${times.map((t) => t.toFixed(0)).join(' ')}]`);
