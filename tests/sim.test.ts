import { describe, expect, it } from 'vitest';
import { ITEMS, TICK_RATE, World } from '../src/sim';
import { botSlots, newWorld } from './helpers';

const run = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * TICK_RATE && w.winner === null; i++) w.step();
};

const snapshot = (w: World) =>
  JSON.stringify(w.units.map((u) => [u.id, u.x.toFixed(3), u.y.toFixed(3), u.hp.toFixed(2), u.alive]));

describe('simulation', () => {
  it('spawns 6 heroes and 32 structures', () => {
    const w = newWorld();
    expect(w.heroes.length).toBe(6);
    expect(w.structures.length).toBe(32);
  });

  it('spawns creep waves in all 3 lanes for both teams', () => {
    const w = newWorld();
    run(w, 5);
    const creeps = w.units.filter((u) => u.creep);
    expect(creeps.length).toBe(24);
    for (const team of [0, 1]) {
      for (const lane of ['top', 'mid', 'bot']) {
        expect(creeps.filter((c) => c.team === team && c.creep!.lane === lane).length).toBe(4);
      }
    }
  });

  it('is deterministic for the same seed and inputs', () => {
    const a = newWorld(7);
    const b = newWorld(7);
    run(a, 120);
    run(b, 120);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it('human hero obeys movement and attack commands', () => {
    const w = new World({ seed: 1, slots: botSlots(true) });
    const me = w.heroes.find((h) => h.hero!.controller === 'human')!;
    const start = { x: me.x, y: me.y };
    w.enqueue({ type: 'moveDir', unitId: me.id, dx: 1, dy: -1 });
    run(w, 1);
    expect(me.x).toBeGreaterThan(start.x);
    expect(me.y).toBeLessThan(start.y);
    // A jungle room in our own half: reaching it requires pathing through the maze.
    w.enqueue({ type: 'moveTo', unitId: me.id, x: 78, y: 156 });
    run(w, 38);
    expect(Math.hypot(me.x - 78, me.y - 156)).toBeLessThan(2);
    expect(me.hero!.order.type).toBe('idle');
  });

  it('heroes gain gold and xp over time, and nothing becomes NaN', () => {
    const w = newWorld();
    run(w, 180);
    for (const h of w.heroes) {
      // Bots spend gold, so count what they own too.
      const owned = h.hero!.items.reduce((sum, it) => sum + (it ? ITEMS[it.id].cost * it.count : 0), 0) + h.hero!.tpCount * 50;
      expect(h.hero!.gold + owned).toBeGreaterThan(600);
      expect(Number.isFinite(h.x) && Number.isFinite(h.y)).toBe(true);
    }
    expect(w.heroes.some((h) => h.hero!.level > 1)).toBe(true);
  });

  it('an all-bot match is won by destroying a shrine, bots use abilities and never get stuck', async () => {
    const w = newWorld();
    // Stuck detector: a living hero that has had a move order for 10 s straight must have moved.
    const streak = new Map<number, { x: number; y: number; t: number }>();
    let casts = 0;
    let n = 0;
    while (w.winner === null && w.time < 75 * 60) {
      w.step();
      // Let the test runner breathe now and then (long synchronous runs time out its heartbeat).
      if (++n % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
      casts += w.events.filter((e) => e.type === 'cast').length;
      for (const h of w.heroes) {
        const moving = h.alive && h.hero!.order.type === 'move' && h.stunTimer <= 0;
        const s = streak.get(h.id);
        if (!moving) {
          streak.delete(h.id);
        } else if (!s) {
          streak.set(h.id, { x: h.x, y: h.y, t: w.time });
        } else if (w.time - s.t >= 10) {
          expect(Math.hypot(h.x - s.x, h.y - s.y), `hero ${h.hero!.defId}${h.team} stuck at ${h.x},${h.y} t=${w.time}`).toBeGreaterThan(2);
          streak.set(h.id, { x: h.x, y: h.y, t: w.time });
        }
      }
    }
    expect(w.winner).not.toBeNull();
    expect(casts).toBeGreaterThan(50);
    for (const h of w.heroes) expect(h.hero!.abilities.every((a) => a.level > 0)).toBe(true);
  }, 150_000);
});
