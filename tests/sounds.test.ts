/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { SOUND_NAMES, Sfx } from '../src/client/audio';
import { playEvents } from '../src/client/sound-events';
import { buyback } from '../src/sim/objectives';
import { newWorld } from './helpers';
import soundEvents from '../src/client/sound-events.ts?raw';
import main from '../src/client/main.ts?raw';
import heroAnims from '../src/client/three/hero-anims.ts?raw';
import monsterAnims from '../src/client/three/monster-anims.ts?raw';
import spellFx from '../src/client/three/spell-fx.ts?raw';

describe('sounds', () => {
  it('every sound has a file, and every file is a sound', () => {
    const files = Object.keys(import.meta.glob('../public/sfx/*')).map((f) => f.split('/').pop()!);
    expect(files.sort()).toEqual(SOUND_NAMES.map((n) => `${n}.mp3`).sort());
  });

  it('every sound the game asks for exists', () => {
    const known = new Set<string>(SOUND_NAMES);
    for (const src of [soundEvents, main, heroAnims, monsterAnims, spellFx]) {
      for (const m of src.matchAll(/(?:sfx\.play|c\.sound)\('([a-zA-Z]+)'/g)) expect(known.has(m[1]), m[1]).toBe(true);
    }
  });

  it('the owner chose silence for these', () => {
    for (const name of ['heroDeath', 'bodyFall', 'arrowHit', 'fireHit', 'treeFall', 'splash', 'winSong', 'loseSong']) {
      expect(SOUND_NAMES as readonly string[]).not.toContain(name);
    }
  });

  it('the end song is the same whoever wins', () => {
    expect(main).toMatch(/sfx\.play\('endSong'/);
    expect(main).not.toMatch(/won \? '[a-zA-Z]+Song'/);
  });

  describe('coming back from death', () => {
    const played = (run: 'wait' | 'buyback', me = true) => {
      const w = newWorld();
      const hero = w.heroes[0];
      const names: string[] = [];
      const sfx = { muted: false, play: (n: string) => (names.push(n), null), playHit: () => null, stop: () => {} } as unknown as Sfx;
      hero.alive = false;
      hero.hp = 0;
      hero.hero!.respawnTimer = 0.05;
      if (run === 'buyback') {
        hero.hero!.gold = 1e5;
        hero.hero!.respawnTimer = 50;
        expect(buyback(w, hero)).toBe(true);
      }
      for (let i = 0; i < 5; i++) {
        w.step();
        playEvents(sfx, w, w.events, me ? hero.id : w.heroes[1].id, 0, { x: hero.x, y: hero.y });
      }
      expect(hero.alive).toBe(true);
      return names;
    };
    it('your own hero respawning plays the harp', () => expect(played('wait')).toContain('respawn'));
    it("someone else's respawn is silent", () => expect(played('wait', false)).not.toContain('respawn'));
    it('a buyback does not also play it', () => expect(played('buyback')).not.toContain('respawn'));
  });

  it('walking stays silent', () => {
    expect(heroAnims).not.toMatch(/sound\('(step|treeStep|stomp)'/);
    expect(SOUND_NAMES as readonly string[]).not.toContain('step');
  });
});
