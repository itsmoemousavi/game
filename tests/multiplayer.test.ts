import { describe, expect, it } from 'vitest';
import { Draft, World, stateHash } from '../src/sim';
import { linkPair } from '../src/net/link';
import { COUNTDOWN_SECONDS, GuestSession, HostDraft, HostSession, MatchInfo, Session } from '../src/net/session';

const pause = () => new Promise((r) => setTimeout(r, 0));

/** A fake clock, so a whole lobby can run in a test. */
function realNowStub() {
  let t = 1000;
  const real = performance.now.bind(performance);
  performance.now = () => t;
  return { advance: (ms: number) => (t += ms), restore: () => (performance.now = real), now: () => t };
}

function lobby(guestCount: number) {
  const host = new HostSession('TEST', 'Host', 4242);
  const links: ReturnType<typeof linkPair>[] = [];
  const guests: GuestSession[] = [];
  for (let i = 0; i < guestCount; i++) {
    const pair = linkPair();
    links.push(pair);
    host.addLink(pair[0]);
    guests.push(new GuestSession(pair[1], `token-${i}`, `Guest${i}`));
  }
  return { host, guests, links };
}

/** Everyone picks the first thing allowed, until the draft is done. */
function finishDraft(host: HostSession, guests: GuestSession[]) {
  let hostDraft: Draft | null = null;
  const guestDrafts: Draft[] = [];
  host.onDraftStart = (d) => (hostDraft = d);
  guests.forEach((g) => (g.onDraftStart = (d) => guestDrafts.push(d)));
  let info: MatchInfo | null = null;
  guests.forEach((g) => (g.onMatch = (m) => (info = m)));
  host.startDraft();
  const d = hostDraft! as HostDraft;
  for (let i = 0; i < 2000 && !d.done; i++) {
    const all = [d, ...guestDrafts];
    const turn = all.find((x) => x.humanTurn());
    if (turn) turn.choose(turn.current!.kind === 'ban' ? null : turn.choices()[0]);
    else d.update(0.5);
  }
  expect(guestDrafts.every((g) => g.step === d.step && JSON.stringify(g.picks) === JSON.stringify(d.picks))).toBe(true);
  const hostInfo = host.draftDone(d);
  expect(info).toEqual(hostInfo);
  return hostInfo;
}

const makeWorld = (i: MatchInfo, s: Session & { attachWorld(w: World): void }) => {
  const w = new World({ seed: i.seed, slots: i.slots, warmup: 30 });
  s.attachWorld(w);
  return w;
};

describe('multiplayer', () => {
  it('counts down on every phone, freezes the lobby, then starts the draft', () => {
    const clock = realNowStub();
    try {
      const { host, guests } = lobby(1);
      const counted: number[] = [];
      let hostDraft = 0;
      let guestDraft = 0;
      host.onCountdown = (s) => counted.push(s);
      guests[0].onCountdown = (s) => counted.push(s);
      host.onDraftStart = () => hostDraft++;
      guests[0].onDraftStart = () => guestDraft++;

      host.startCountdown();
      host.startCountdown(); // a second tap changes nothing
      expect(counted).toEqual([COUNTDOWN_SECONDS, COUNTDOWN_SECONDS]);

      // Too late to join or to change seats.
      const pair = linkPair();
      host.addLink(pair[0]);
      new GuestSession(pair[1], 'late', 'Late');
      const seats = [...host.state.seats];
      guests[0].sit(5);
      expect(host.state.seats).toEqual(seats);
      expect(host.state.players.length).toBe(2);

      clock.advance(COUNTDOWN_SECONDS * 1000 - 1);
      host.update(clock.now());
      expect(hostDraft).toBe(0);
      clock.advance(1);
      host.update(clock.now());
      expect(hostDraft).toBe(1);
      expect(guestDraft).toBe(1);
      host.update(clock.now() + 5000);
      expect(hostDraft).toBe(1);
    } finally {
      clock.restore();
    }
  });

  it('seats players on both teams, and frees a seat when someone leaves the lobby', () => {
    const { host, guests, links } = lobby(2);
    expect(host.state.players.length).toBe(3);
    expect(host.state.seats).toEqual([1, 3, null, 2, null, null]);
    expect(guests[0].state.seats).toEqual(host.state.seats);
    guests[1].sit(5);
    expect(host.state.seats[5]).toBe(3);
    links[0][1].close();
    expect(host.state.seats).toEqual([1, null, null, null, null, 3]);
    expect(guests[1].state.players.length).toBe(2);
  });

  it('bots fill the empty seats, and each person chooses only for their own seat', () => {
    const { host, guests } = lobby(1);
    const info = finishDraft(host, guests);
    expect(info.slots.length).toBe(6);
    expect(info.slots.filter((s) => s.controller === 'human').length).toBe(2);
    expect(info.slots.filter((s) => s.controller === 'bot').every((s) => s.difficulty === 'normal')).toBe(true);
  });

  it('every phone stays identical through a match, with commands, one phone lagging behind', async () => {
    const clock = realNowStub();
    try {
      const { host, guests } = lobby(2);
      const info = finishDraft(host, guests);
      const hw = makeWorld(info, host);
      const gw = guests.map((g) => makeWorld(info, g));
      let desynced = false;
      host.onDesync = () => (desynced = true);
      host.ready();
      guests.forEach((g) => g.ready());
      const seatOf = (s: Session) => s.mySeat;
      const step = (w: World, s: Session) => {
        while (s.ticksAvailable(w) > 0 && w.winner === null) {
          s.beforeStep(w);
          w.step();
          s.afterStep(w);
        }
      };
      for (let t = 0; t < 900; t++) {
        clock.advance(100);
        const now = clock.now();
        if (t % 20 === 0) {
          // Everyone gives their hero something to do.
          const a = (w: World, s: Session) => {
            const hero = w.heroes[seatOf(s)];
            w.enqueue({ type: 'moveTo', unitId: hero.id, x: 120 + (t % 60), y: 150 });
          };
          a(hw, host);
          guests.forEach((g, i) => a(gw[i], g));
        }
        guests.forEach((g) => g.update(now));
        host.update(now);
        step(hw, host);
        step(gw[0], guests[0]);
        if (t % 7 === 0) step(gw[1], guests[1]); // this phone is slow
        if (t % 50 === 0) await pause();
      }
      step(gw[1], guests[1]);
      expect(hw.tick).toBeGreaterThan(2000);
      expect(gw[0].tick).toBe(hw.tick);
      expect(gw[1].tick).toBe(hw.tick);
      expect(stateHash(gw[0])).toBe(stateHash(hw));
      expect(stateHash(gw[1])).toBe(stateHash(hw));
      expect(desynced).toBe(false);
    } finally {
      clock.restore();
    }
  }, 120000);

  it('a player who drops goes inactive at base, and can rejoin by replaying the match', async () => {
    const clock = realNowStub();
    try {
      const { host, guests, links } = lobby(1);
      const info = finishDraft(host, guests);
      const hw = makeWorld(info, host);
      const gw = makeWorld(info, guests[0]);
      host.ready();
      guests[0].ready();
      const run = (w: World, s: Session) => {
        while (s.ticksAvailable(w) > 0 && w.winner === null) {
          s.beforeStep(w);
          w.step();
          s.afterStep(w);
        }
      };
      const tickAll = (n: number, withGuest = true) => {
        for (let t = 0; t < n; t++) {
          clock.advance(100);
          if (withGuest) guests[0].update(clock.now());
          host.update(clock.now());
          run(hw, host);
          if (withGuest) run(gw, guests[0]);
        }
      };
      tickAll(60);
      const seat = guests[0].mySeat;
      const hero = hw.heroes[seat];
      gw.enqueue({ type: 'moveTo', unitId: gw.heroes[seat].id, x: 150, y: 150 });
      tickAll(60);
      const walked = Math.hypot(hero.x - hw.map.fountains[hero.team as 0 | 1].x, hero.y - hw.map.fountains[hero.team as 0 | 1].y);
      expect(walked).toBeGreaterThan(10);
      links[0][1].close();
      tickAll(20, false);
      expect(hero.hero!.away).toBe(true);
      const home = Math.hypot(hero.x - hw.map.fountains[hero.team as 0 | 1].x, hero.y - hw.map.fountains[hero.team as 0 | 1].y);
      expect(home).toBeLessThan(20);
      await pause();
      const hx = hero.x;
      tickAll(30, false);
      expect(hero.x).toBe(hx);
      // Come back: same token, same hero.
      const pair = linkPair();
      host.addLink(pair[0]);
      const back = new GuestSession(pair[1], 'token-0', 'Guest0');
      expect(back.catchingUp).toBe(true);
      expect(back.matchInfo).toEqual(info);
      const nw = new World({ seed: info.seed, slots: info.slots, warmup: 30 });
      back.attachWorld(nw);
      clock.advance(100);
      host.update(clock.now());
      run(nw, back);
      run(hw, host);
      expect(nw.tick).toBe(hw.tick);
      expect(stateHash(nw)).toBe(stateHash(hw));
      expect(hero.hero!.away).toBe(false);
    } finally {
      clock.restore();
    }
  }, 120000);

  it('a guest cannot command someone else, and pauses are limited', () => {
    const clock = realNowStub();
    try {
      const { host, guests } = lobby(1);
      const info = finishDraft(host, guests);
      const hw = makeWorld(info, host);
      makeWorld(info, guests[0]);
      host.ready();
      guests[0].ready();
      const hostHero = hw.heroes[host.mySeat];
      guests[0].send({ type: 'moveTo', unitId: hostHero.id, x: 150, y: 150 });
      clock.advance(100);
      guests[0].update(clock.now());
      host.update(clock.now());
      while (host.ticksAvailable(hw) > 0) {
        host.beforeStep(hw);
        hw.step();
      }
      expect(hostHero.hero!.order.type).toBe('idle');
      const notes: string[] = [];
      guests[0].onNote = (t) => notes.push(t);
      for (let i = 0; i < 4; i++) {
        guests[0].setPaused(true);
        expect(host.paused).toBe(i < 3);
        guests[0].setPaused(false);
      }
      expect(notes.length).toBe(1);
    } finally {
      clock.restore();
    }
  });
});
