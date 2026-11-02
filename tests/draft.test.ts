import { describe, expect, it } from 'vitest';
import { DRAFT_TIME, Draft, FIRST_WAVE_TIME, HERO_IDS, LANE_IDS, PlayerSlot, Rng, TICK_RATE, Team, WARMUP_SECONDS, World } from '../src/sim';

const seeded = (s: number) => {
  const r = new Rng(s);
  return () => r.next();
};
const runDraft = (d: Draft, seconds: number) => {
  for (let t = 0; t < seconds && !d.done; t += 0.1) d.update(0.1);
};

describe('draft', () => {
  it('bans one hero per team, then everyone picks; banned heroes are never picked', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const d = new Draft(null, undefined, seeded(seed));
      runDraft(d, 60);
      expect(d.done).toBe(true);
      expect(d.bans).toHaveLength(2);
      expect(d.bans[0]).not.toBe(d.bans[1]);
      for (const team of [0, 1] as Team[]) {
        expect(d.picks[team]).toHaveLength(3);
        expect(new Set(d.picks[team]).size).toBe(3); // no hero twice on one team
        for (const id of d.picks[team]) expect(d.bans).not.toContain(id);
      }
    }
  });

  it('waits for the human on their turn, and their choice counts', () => {
    const d = new Draft({ team: 0, seat: 1 }, undefined, seeded(3));
    expect(d.humanTurn()).toBe(true); // team 0 bans first
    runDraft(d, DRAFT_TIME.ban - 2);
    expect(d.step).toBe(0); // still waiting
    expect(d.choose('syl')).toBe(true);
    expect(d.allowed('syl')).toBe(false); // banned for everyone
    // Enemy bans, ally picks seat 0, enemy picks twice: then it's the human's seat.
    runDraft(d, 20);
    expect(d.humanTurn()).toBe(true);
    expect(d.picks[0]).toHaveLength(1);
    const pick = d.choices().find((id) => !d.picks[1].includes(id))!;
    d.choose(pick);
    expect(d.picks[0][1]).toBe(pick);
    runDraft(d, 20);
    expect(d.done).toBe(true);
  });

  it('a human who runs out of time gets no ban, and a random pick', () => {
    const d = new Draft({ team: 0, seat: 0 }, undefined, seeded(9));
    runDraft(d, DRAFT_TIME.ban + 1);
    expect(d.bans[0]).toBeNull();
    runDraft(d, 5);
    expect(d.humanTurn()).toBe(true);
    for (let t = 0; t < DRAFT_TIME.pick + 1 && d.picks[0].length === 0; t += 0.1) d.update(0.1);
    expect(d.picks[0]).toHaveLength(1);
    expect(HERO_IDS).toContain(d.picks[0][0]);
  });
});

describe('warm-up', () => {
  it('the clock starts below zero; no creeps and no passive gold until 0:00', () => {
    const slots: PlayerSlot[] = [];
    for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
    const w = new World({ seed: 4, slots, warmup: WARMUP_SECONDS });
    expect(w.time).toBe(-30);
    const gold = w.heroes[0].hero!.gold;
    for (let i = 0; i < (WARMUP_SECONDS + FIRST_WAVE_TIME - 0.5) * TICK_RATE; i++) w.step();
    expect(w.units.some((u) => u.creep)).toBe(false);
    expect(w.heroes[0].hero!.gold).toBeLessThan(gold + 10);
    for (let i = 0; i < 1 * TICK_RATE; i++) w.step();
    expect(w.units.some((u) => u.creep)).toBe(true);
  });

  it('during the warm-up enemies stay hidden in the fog, and the Warden is calm', () => {
    const slots: PlayerSlot[] = [];
    for (const team of [0, 1] as Team[]) HERO_IDS.slice(0, 3).forEach((heroId, i) => slots.push({ team, heroId, controller: 'human', lane: LANE_IDS[i] }));
    const w = new World({ seed: 4, slots, warmup: WARMUP_SECONDS });
    for (let i = 0; i < 2 * TICK_RATE; i++) w.step();
    expect(w.time).toBeLessThan(0);
    for (const foe of w.heroes.filter((h) => h.team === 1)) expect(w.canSee(0, foe)).toBe(false);
    const boss = w.units.find((u) => u.neutral?.boss)!;
    expect(w.canSee(0, boss)).toBe(false);
    expect(w.time < boss.neutral!.aggroUntil).toBe(false);
  });
});
