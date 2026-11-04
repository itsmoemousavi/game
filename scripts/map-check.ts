/**
 * Balance + map check: bots-only matches with random 3v3 lineups. Prints one JSON line per match
 * (each lineup twice, sides swapped; winner, length, heroes, when each building fell, places where heroes got stuck).
 *   npx vite-node scripts/map-check.ts [firstSeed] [matches] > out.jsonl
 * Summarise many files with: npx vite-node scripts/map-check-report.ts out*.jsonl
 */
import { HERO_IDS, HeroId, LANE_IDS, PlayerSlot, Rng, Team, World } from '../src/sim';

const first = Number(process.argv[2] ?? 100);
const count = Number(process.argv[3] ?? 6);

// Each lineup is played twice, the second time with the teams swapped (odd "seeds"), so side
// differences can't come from which heroes happened to land where.
for (let game = first * 2; game < (first + count) * 2; game++) {
  const seed = game >> 1;
  const rng = new Rng(seed * 7919);
  const pool = [...HERO_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1)); // fair shuffle
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const teams: HeroId[][] = game % 2 === 0 ? [pool.slice(0, 3), pool.slice(3, 6)] : [pool.slice(3, 6), pool.slice(0, 3)];
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) teams[team].forEach((heroId, i) => slots.push({ team, heroId, controller: 'bot', lane: LANE_IDS[i] }));
  const w = new World({ seed, slots });

  const byId = new Map(w.units.map((u) => [u.id, u]));
  const buildings: { t: number; team: number; tier: string; lane: string | null; rax?: string }[] = [];
  const stuck: { t: number; hero: string; x: number; y: number; secs: number }[] = [];
  let firstBlood: number | null = null;
  let wardenKills = 0;
  // Stuck check: sampled every second; a living, unstunned hero with somewhere to go that moved < 1 m in 8 s.
  const last = new Map<number, { x: number; y: number; since: number; reported: boolean }>();
  let nextSample = 0;

  while (w.winner === null && w.time < 60 * 60) {
    w.step();
    for (const e of w.events) {
      if (e.type === 'death') {
        const u = byId.get(e.unitId) ?? w.units.find((v) => v.id === e.unitId);
        if (u?.structure) buildings.push({ t: Math.round(w.time), team: u.team, tier: u.structure.tier, lane: u.structure.lane, rax: u.structure.rax });
        if (u?.hero && firstBlood === null && e.killerId !== null) firstBlood = Math.round(w.time);
      } else if (e.type === 'bossKilled') wardenKills++;
    }
    if (w.time >= nextSample) {
      nextSample += 1;
      for (const u of w.units) if (!byId.has(u.id)) byId.set(u.id, u);
      for (const h of w.heroes) {
        const prev = last.get(h.id);
        const wantsToMove = h.alive && h.stunTimer <= 0 && h.castLock <= 0 && h.hero!.order.type === 'move' && h.targetId === null;
        if (!prev || !wantsToMove || Math.hypot(h.x - prev.x, h.y - prev.y) > 1) {
          last.set(h.id, { x: h.x, y: h.y, since: w.time, reported: false });
        } else if (!prev.reported && w.time - prev.since >= 8) {
          prev.reported = true;
          stuck.push({ t: Math.round(w.time), hero: h.hero!.defId, x: Math.round(h.x), y: Math.round(h.y), secs: 8 });
        }
      }
    }
  }

  const heroes = w.heroes.map((h) => {
    const s = h.hero!;
    return {
      id: s.defId, team: h.team, lane: s.lane, level: s.level, k: s.kills, d: s.deaths, a: s.assists,
      gold: s.goldEarned, heroDmg: Math.round(s.stats.heroDamage), bldDmg: Math.round(s.stats.buildingDamage),
      items: s.items.filter(Boolean).map((it) => it!.id),
    };
  });
  console.log(JSON.stringify({ seed, swapped: game % 2 === 1, winner: w.winner, minutes: +(w.time / 60).toFixed(1), firstBlood, wardenKills, teamKills: w.teamKills, heroes, buildings, stuck }));
  await new Promise((r) => setTimeout(r, 0));
}
