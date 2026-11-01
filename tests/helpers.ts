import { HERO_IDS, LANE_IDS, PlayerSlot, Team, World } from '../src/sim';

export function botSlots(human = false): PlayerSlot[] {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) {
    HERO_IDS.forEach((heroId, i) =>
      slots.push({ team, heroId, controller: human && team === 0 && i === 0 ? 'human' : 'bot', lane: LANE_IDS[i] }),
    );
  }
  return slots;
}

export const newWorld = (seed = 1) => new World({ seed, slots: botSlots() });
