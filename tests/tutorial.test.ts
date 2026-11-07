/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { HERO_IDS, Team, World } from '../src/sim';
import { LESSONS, Tutorial, openSpot, practiceGround, roomAt, spawnDummy } from '../src/client/tutorial';
import indexHtml from '../index.html?raw';

const box = () => ({ innerHTML: '', className: '', classList: { add() {}, remove() {} }, ownerDocument: { querySelectorAll: () => [] }, querySelector: () => null }) as unknown as HTMLElement;

function setup(heroId: (typeof HERO_IDS)[number] = 'brakk') {
  const w = new World({ seed: 7, slots: [{ team: 0 as Team, heroId, controller: 'human', lane: 'mid' }], warmup: 0 });
  const me = w.heroes[0];
  const t = new Tutorial(box(), () => {}, () => {});
  return { w, me, t };
}

const play = (t: Tutorial, lessonId: string) => {
  (t as unknown as { lesson: unknown; i: number; started: boolean }).lesson = LESSONS.find((l) => l.id === lessonId);
  (t as unknown as { i: number }).i = 0;
  (t as unknown as { started: boolean }).started = false;
};
const stepIndex = (t: Tutorial) => (t as unknown as { i: number }).i;

describe('tutorial', () => {
  it('covers everything the owner listed', () => {
    const all = LESSONS.flatMap((l) => l.steps.map((s) => s.text)).join(' ').toLowerCase();
    for (const word of ['shrine', 'barracks', 'mega creeps', 'creeps', 'joystick', 'attack', 'auto attack', 'deny', 'minimap', 'ping', 'pause', 'river', 'rune', 'pocket', 'mountain', 'warden', 'fountain', 'night', 'fog', 'tower shield', 'a quarter of the damage', 'last hit', 'shop', 'courier', 'teleport', 'wayfarer boots', 'dying costs gold', 'buy back', 'watcher', 'seer', 'invisible', 'trees', 'dusk', 'charm']) {
      expect(all, word).toContain(word);
    }
  });

  it('keeps each step short enough for a phone', () => {
    for (const l of LESSONS) for (const s of l.steps) expect(s.text.length, s.text).toBeLessThanOrEqual(205);
  });

  it('only points at controls that exist', () => {
    for (const l of LESSONS) {
      for (const s of l.steps) {
        for (const spot of s.spot ?? []) {
          const id = spot.match(/#([\w-]+)/)![1];
          expect(indexHtml, spot).toContain(`id="${id}"`);
        }
      }
    }
  });

  it('every step starts without a problem and leaves the hero somewhere it can stand', () => {
    const { w, me, t } = setup();
    for (const l of LESSONS) {
      for (const s of l.steps) {
        expect(() => s.enter?.(w, me, t)).not.toThrow();
        expect(() => s.marker?.(w, me, t)).not.toThrow();
        const c = w.nav.cell;
        expect(w.nav.walkable[Math.floor(me.y / c) * w.nav.grid + Math.floor(me.x / c)], `${l.id}: ${s.text}`).toBe(1);
        w.step();
      }
    }
  });

  it('every place a lesson puts you has open ground around it, never a gap in the trees', () => {
    const { w, me, t } = setup();
    for (const l of LESSONS) {
      for (const s of l.steps) {
        if (!s.enter) continue;
        s.enter(w, me, t);
        expect(roomAt(w, me.x, me.y), `${l.id}: ${s.text.slice(0, 40)}`).toBeGreaterThanOrEqual(2);
        w.step();
      }
    }
  });

  it('buildings a lesson talks about show below the hero, clear of the lesson text', () => {
    const { w, me, t } = setup();
    for (const l of LESSONS) {
      for (const s of l.steps) {
        if (!s.enter || !s.marker) continue;
        s.enter(w, me, t);
        const m = s.marker(w, me, t)!;
        expect(m.y, `${l.id}: ${s.text.slice(0, 40)}`).toBeGreaterThan(me.y);
        expect(Math.hypot(m.x - me.x, m.y - me.y), `${l.id}: ${s.text.slice(0, 40)}`).toBeLessThan(13);
        w.step();
      }
    }
  });

  it('the practice ground is a roomy clearing, on your side, far from lanes, towers and camps', () => {
    const { w } = setup();
    for (const team of [0, 1]) {
      const p = practiceGround(w, team);
      expect(roomAt(w, p.x, p.y)).toBeGreaterThanOrEqual(6);
      const d = (f: { x: number; y: number }) => Math.hypot(p.x - f.x, p.y - f.y);
      expect(d(w.map.fountains[team as 0 | 1])).toBeLessThan(d(w.map.fountains[team === 0 ? 1 : 0]));
      for (const b of w.map.structures) expect(d(b.pos)).toBeGreaterThanOrEqual(22);
      for (const c of w.map.camps) expect(d(c)).toBeGreaterThanOrEqual(14);
    }
  });

  it('a step you read waits for Next, and a step you do finishes by itself', () => {
    const { w, me, t } = setup();
    play(t, 'moving');
    t.update(w, me); // enters the walk step
    const goal = t.goal!;
    expect(stepIndex(t)).toBe(0);
    me.x = me.px = goal.x;
    me.y = me.py = goal.y;
    t.update(w, me);
    expect(stepIndex(t)).toBe(1);
    play(t, 'goal');
    for (let i = 0; i < 5; i++) t.update(w, me);
    expect(stepIndex(t)).toBe(0);
  });

  it.each(HERO_IDS.map((h) => [h]))('the spell step can be finished with %s', (heroId) => {
    const { w, me, t } = setup(heroId);
    play(t, 'fighting');
    t.update(w, me);
    me.hero!.abilities[0].level = 1;
    t.update(w, me);
    expect(stepIndex(t)).toBe(1);
    t.update(w, me);
    for (let i = 0; i < 20; i++) w.step(); // the hero has seen the dummy
    w.enqueue({ type: 'cast', unitId: me.id, slot: 0 }); // a quick tap, which aims by itself
    let done = false;
    for (let i = 0; i < 90 && !done; i++) {
      w.step();
      t.update(w, me);
      done = stepIndex(t) === 2;
    }
    expect(done).toBe(true);
  });

  it('a practice dummy on quiet ground is left alone, so you can do the step yourself', () => {
    const { w, me, t } = setup();
    play(t, 'fighting');
    t.update(w, me);
    me.hero!.abilities[0].level = 1;
    t.update(w, me);
    t.update(w, me);
    const d = w.unit(t.dummyId)!;
    const hp = d.hp;
    for (let i = 0; i < 300; i++) w.step();
    expect(d.hp).toBe(hp);
  });

  it('the fighting lesson turns auto attack off and gives it back', () => {
    const { w, me, t } = setup();
    me.hero!.autoAttack = true;
    play(t, 'fighting');
    t.update(w, me);
    w.step();
    expect(me.hero!.autoAttack).toBe(false);
    (t as unknown as { closeLesson(): void }).closeLesson();
    w.step();
    expect(me.hero!.autoAttack).toBe(true);
  });

  it('a tap on Attack gets the last hit, and an aimed attack denies your own creep', () => {
    const { w, me } = setup();
    const p = openSpot(w, me.x + 2, me.y);
    me.hero!.autoAttack = false;
    const foe = spawnDummy(w, p.x, p.y, 1, 5);
    w.enqueue({ type: 'attackOnce', unitId: me.id });
    for (let i = 0; i < 60 && foe.alive; i++) w.step();
    expect(me.hero!.lastHits).toBe(1);
    for (let i = 0; i < 60; i++) w.step(); // the swing is ready again
    const mine = spawnDummy(w, p.x, p.y, 0, 5);
    w.enqueue({ type: 'attackOnce', unitId: me.id, targetId: mine.id });
    for (let i = 0; i < 60 && mine.alive; i++) w.step();
    expect(me.hero!.denies).toBe(1);
  });
});
