/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { Announcer, killLines } from '../src/client/announcer';
import { VOICE_NAMES, VoiceName } from '../src/client/audio';
import { GameEvent, Team, Unit, World } from '../src/sim';
import { newWorld } from './helpers';
import main from '../src/client/main.ts?raw';

/** A voice on a pretend clock: every line lasts one second. */
function setup(team: Team = 0) {
  const w = newWorld();
  const said: VoiceName[] = [];
  const voice = {
    clock: 0,
    speak(line: VoiceName) {
      said.push(line);
      return 1;
    },
  };
  const a = new Announcer(voice);
  const run = (...events: GameEvent[]) => a.onStep(w, w.time, events, team);
  /** Let the voice speak everything waiting, as frames would. */
  const finish = () => {
    for (let i = 0; i < 40; i++) {
      a.update();
      voice.clock += 0.25;
    }
  };
  return { w, a, voice, said, run, finish };
}

const hitBy = (w: World, target: Unit): GameEvent => {
  const source = w.heroes.find((h) => h.team !== target.team)!;
  return { type: 'attack', sourceId: source.id, targetId: target.id } as GameEvent;
};
const fell = (u: Unit): GameEvent => ({ type: 'death', unitId: u.id, killerId: null });
const towerOf = (w: World, team: Team, lane: 'top' | 'mid' | 'bot') => w.findStructure(team, 'tower1', lane)[0];

describe('announcer', () => {
  it('every line has a file, and every file is a line', () => {
    const files = Object.keys(import.meta.glob('../public/sfx/voice/*')).map((f) => f.split('/').pop()!);
    expect(files.sort()).toEqual(VOICE_NAMES.map((n) => `${n}.mp3`).sort());
  });

  it('every line can really be said', () => {
    const { w, a, voice, said, run, finish } = setup();
    const bothSides = (u: (t: Team) => Unit) => [0, 1].map((t) => u(t as Team));
    for (const lane of ['top', 'mid', 'bot'] as const) {
      run(hitBy(w, towerOf(w, 0, lane)));
      finish();
      for (const u of bothSides((t) => towerOf(w, t, lane))) run(fell(u));
      for (const u of bothSides((t) => w.findStructure(t, 'barracks', lane)[0])) run(fell(u));
      finish();
    }
    run(hitBy(w, w.findStructure(0, 'barracks', 'mid')[0]), hitBy(w, w.findStructure(0, 'shrineTower')[0]), hitBy(w, w.findStructure(0, 'shrine')[0]));
    finish();
    for (const u of bothSides((t) => w.findStructure(t, 'shrineTower')[0])) run(fell(u));
    finish();
    run({ type: 'megaCreeps', team: 0 }, { type: 'megaCreeps', team: 1 }, { type: 'bossKilled', killerId: null, team: 2 });
    finish();
    for (const k of killLines({ firstBlood: true, multi: 2, streak: 0, shutdown: 100 })) said.push(k);
    for (const m of [{ multi: 3, streak: 0 }, { multi: 1, streak: 3 }, { multi: 1, streak: 4 }, { multi: 1, streak: 5 }, { multi: 1, streak: 6 }]) {
      said.push(...killLines({ firstBlood: false, shutdown: 0, ...m }));
    }
    for (const h of w.heroes.filter((u) => u.team === 1)) h.alive = false;
    run(fell(w.heroes.find((u) => u.team === 1)!));
    finish();
    w.time = -14.99;
    a.onStep(w, -15.01, [], 0);
    finish();
    w.time = 0.01;
    a.onStep(w, -0.01, [], 0);
    finish();
    a.refused('mana');
    finish();
    voice.clock += 5;
    a.refused('cooldown');
    finish();
    expect([...new Set(said)].sort()).toEqual([...VOICE_NAMES].sort());
  });

  it.each([[0], [1], [2]] as const)('the Warden falling is told whoever killed it (side %i), on both teams', (side) => {
    for (const team of [0, 1] as Team[]) {
      const { said, run, finish } = setup(team);
      run({ type: 'bossKilled', killerId: null, team: side });
      finish();
      expect(said).toEqual(['warden_fallen']);
    }
  });

  it('lines never overlap', () => {
    const { w, voice, a, run } = setup();
    const started: number[] = [];
    const speak = voice.speak;
    voice.speak = (l) => (started.push(voice.clock), speak(l));
    run(fell(towerOf(w, 1, 'top')), fell(towerOf(w, 1, 'mid')), fell(towerOf(w, 1, 'bot')));
    for (let i = 0; i < 40; i++) {
      a.update();
      voice.clock += 0.1;
    }
    expect(started.length).toBe(3);
    for (let i = 1; i < started.length; i++) expect(started[i] - started[i - 1]).toBeGreaterThanOrEqual(1);
  });

  it('old news is dropped', () => {
    const { w, voice, a, said, run } = setup();
    a.update();
    run(fell(towerOf(w, 1, 'top')));
    voice.clock += 60;
    a.update();
    expect(said).toEqual([]);
  });

  it('the bigger news goes first', () => {
    const { w, said, run, finish } = setup();
    run(hitBy(w, towerOf(w, 0, 'top')), { type: 'bossKilled', killerId: null, team: 2 });
    finish();
    expect(said).toEqual(['warden_fallen', 'your_top_tower_attacked']);
  });

  it('a building under attack waits 30 s of match time to say it again, each tower on its own timer', () => {
    const { w, said, run, finish } = setup();
    const top = towerOf(w, 0, 'top');
    run(hitBy(w, top));
    finish();
    run(hitBy(w, top));
    finish();
    expect(said).toEqual(['your_top_tower_attacked']);
    run(hitBy(w, towerOf(w, 0, 'bot')));
    finish();
    expect(said).toEqual(['your_top_tower_attacked', 'your_bot_tower_attacked']);
    w.time += 31;
    run(hitBy(w, top));
    finish();
    expect(said.length).toBe(3);
  });

  it('two barracks side by side share one timer', () => {
    const { w, said, run, finish } = setup();
    const [a, b] = w.findStructure(0, 'barracks', 'top');
    run(hitBy(w, a));
    finish();
    run(hitBy(w, b));
    finish();
    expect(said).toEqual(['your_barracks_attacked']);
  });

  it('only your own side is told about attacks, and a deny is not one', () => {
    const { w, said, run, finish } = setup();
    run(hitBy(w, towerOf(w, 1, 'top')));
    const mine = towerOf(w, 0, 'top');
    run({ type: 'attack', sourceId: w.heroes.find((h) => h.team === 0)!.id, targetId: mine.id } as GameEvent);
    finish();
    expect(said).toEqual([]);
  });

  it('a tower that falls before its attack line is heard only says it fell', () => {
    const { w, a, said, run, voice } = setup();
    run({ type: 'bossKilled', killerId: null, team: 2 });
    a.update();
    const top = towerOf(w, 0, 'top');
    run(hitBy(w, top));
    run(fell(top));
    for (let i = 0; i < 40; i++) {
      a.update();
      voice.clock += 0.25;
    }
    expect(said).toEqual(['warden_fallen', 'your_top_tower_fallen']);
  });

  it('kill lines match the banner', () => {
    expect(killLines({ firstBlood: true, multi: 1, streak: 1, shutdown: 0 })).toEqual(['first_blood']);
    expect(killLines({ firstBlood: false, multi: 2, streak: 3, shutdown: 120 })).toEqual(['double_kill', 'shutdown']);
    expect(killLines({ firstBlood: false, multi: 1, streak: 2, shutdown: 0 })).toEqual([]);
    expect(killLines({ firstBlood: false, multi: 1, streak: 9, shutdown: 0 })).toEqual(['legendary']);
  });

  it('team wipe needs all three heroes of a team down', () => {
    const { w, said, run, finish } = setup();
    const foes = w.heroes.filter((h) => h.team === 1);
    foes[0].alive = false;
    run(fell(foes[0]));
    finish();
    expect(said).toEqual([]);
    foes[1].alive = foes[2].alive = false;
    run(fell(foes[1]), fell(foes[2]));
    finish();
    expect(said).toEqual(['team_wipe']);
  });

  it('tapping a spell that is not ready is not repeated while tapping, and waits for silence', () => {
    const { w, a, voice, said, run, finish } = setup();
    a.refused('cooldown');
    a.refused('cooldown');
    finish();
    expect(said).toEqual(['on_cooldown']);
    voice.clock += 5;
    run(fell(towerOf(w, 1, 'top')));
    a.refused('mana');
    finish();
    expect(said).toEqual(['on_cooldown', 'enemy_top_tower_fallen']);
  });

  it('nothing more is said once the match is over', () => {
    const { w, said, run, finish } = setup();
    w.winner = 0;
    run({ type: 'bossKilled', killerId: null, team: 2 });
    finish();
    expect(said).toEqual([]);
    expect(main).toMatch(/ending = true;\n\s*announcer\.reset\(\)/);
  });
});
