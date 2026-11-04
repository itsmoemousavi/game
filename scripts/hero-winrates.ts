/**
 * Hero balance check: bots-only matches with random 3v3 lineups, then win rate and
 * average stats per hero.
 *   npx vite-node scripts/hero-winrates.ts [firstSeed] [matches]
 * A hero clearly above ~55% (or below ~45%) over many matches needs tuning.
 * Bots don't play every hero equally well, so treat this as a first signal.
 */
import { HERO_IDS, HeroId, LANE_IDS, PlayerSlot, Rng, Team, World } from '../src/sim';

const first = Number(process.argv[2] ?? 100);
const count = Number(process.argv[3] ?? 12);
const rows = new Map<HeroId, { games: number; wins: number; k: number; d: number; a: number; dmg: number }>();
for (let seed = first; seed < first + count; seed++) {
  const rng = new Rng(seed * 7919);
  const pool = [...HERO_IDS].sort(() => rng.next() - 0.5);
  const teams: HeroId[][] = [pool.slice(0, 3), pool.slice(3, 6)];
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) teams[team].forEach((heroId, i) => slots.push({ team, heroId, controller: 'bot', lane: LANE_IDS[i] }));
  const w = new World({ seed, slots });
  while (w.winner === null && w.time < 50 * 60) w.step();
  for (const h of w.heroes) {
    const s = h.hero!;
    const r = rows.get(s.defId) ?? { games: 0, wins: 0, k: 0, d: 0, a: 0, dmg: 0 };
    r.games++;
    r.wins += w.winner === h.team ? 1 : w.winner === null ? 0.5 : 0;
    r.k += s.kills;
    r.d += s.deaths;
    r.a += s.assists;
    r.dmg += s.stats.heroDamage;
    rows.set(s.defId, r);
  }
}
console.log('hero     games  win%   K/D/A (avg)      hero dmg (avg)');
for (const [id, r] of [...rows].sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games)) {
  const avg = (n: number) => (n / r.games).toFixed(1);
  console.log(
    `${id.padEnd(8)} ${String(r.games).padStart(5)}  ${((100 * r.wins) / r.games).toFixed(0).padStart(3)}%   ${avg(r.k)}/${avg(r.d)}/${avg(r.a)}`.padEnd(42) +
      Math.round(r.dmg / r.games),
  );
}
