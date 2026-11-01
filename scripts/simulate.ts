/** Headless all-bot match: `npx vite-node scripts/simulate.ts [seed] [maxMinutes]` */
import { World, HERO_IDS, LANE_IDS, TICK_RATE, PlayerSlot, Team } from '../src/sim';

const seed = Number(process.argv[2] ?? 1);
const maxMin = Number(process.argv[3] ?? 40);
const slots: PlayerSlot[] = [];
for (const team of [0, 1] as Team[]) HERO_IDS.forEach((heroId, i) => slots.push({ team, heroId, controller: 'bot', lane: LANE_IDS[i] }));
const w = new World({ seed, slots });
const t0 = performance.now();
let lastMin = -1;
while (w.winner === null && w.time < maxMin * 60) {
  w.step();
  for (const e of w.events) {
    if (e.type === 'death') {
      const u = w.unit(e.unitId);
      if (u?.structure) console.log(`${fmt(w.time)} ${['Azure','Crimson'][u.team]} ${u.structure.tier} ${u.structure.lane ?? ''} destroyed`);
    }
  }
  const m = Math.floor(w.time / 60);
  if (m !== lastMin && m % 5 === 0) {
    lastMin = m;
    console.log(`${fmt(w.time)} kills ${w.teamKills.join('-')} units=${w.units.length} ` + w.heroes.map(h => `${h.hero!.defId}${h.team}:L${h.hero!.level}/${h.hero!.kills}-${h.hero!.deaths}/lh${h.hero!.lastHits}`).join(' '));
  }
}
console.log(`winner=${w.winner === null ? 'none' : ['Azure','Crimson'][w.winner]} at ${fmt(w.time)}; ${w.tick} ticks in ${(performance.now()-t0).toFixed(0)}ms (${(w.tick/TICK_RATE/((performance.now()-t0)/1000)).toFixed(0)}x realtime)`);
function fmt(t: number) { return `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`; }
