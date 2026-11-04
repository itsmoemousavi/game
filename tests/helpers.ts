import { HERO_IDS, LANE_IDS, PlayerSlot, Team, World } from '../src/sim';

export function botSlots(human = false): PlayerSlot[] {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) {
    HERO_IDS.slice(0, 3).forEach((heroId, i) =>
      slots.push({ team, heroId, controller: human && team === 0 && i === 0 ? 'human' : 'bot', lane: LANE_IDS[i] }),
    );
  }
  return slots;
}

export const newWorld = (seed = 1) => new World({ seed, slots: botSlots() });

/**
 * A point on the (winding) river, `meters` along it from the spot nearest to (d, d) on the
 * diagonal. Tests use it for open ground away from trees and buildings.
 */
export function onRiver(map: { riverPath: { x: number; y: number }[] }, d: number, meters = 0) {
  const p = map.riverPath;
  let i = 0;
  for (let k = 1; k < p.length; k++) if (Math.hypot(p[k].x - d, p[k].y - d) < Math.hypot(p[i].x - d, p[i].y - d)) i = k;
  let left = meters;
  let x = p[i].x;
  let y = p[i].y;
  for (let k = i + 1; k < p.length && left > 0; k++) {
    const seg = Math.hypot(p[k].x - x, p[k].y - y);
    if (seg >= left) return { x: x + ((p[k].x - x) / seg) * left, y: y + ((p[k].y - y) / seg) * left };
    left -= seg;
    x = p[k].x;
    y = p[k].y;
  }
  return { x, y };
}
