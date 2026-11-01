import './style.css';
import { BotDifficulty, DT, HEROES, HERO_IDS, HeroId, LANE_IDS, LaneId, PlayerSlot, Team, World } from '../sim';
import { Hud } from './hud';
import { Input } from './input';
import { ItemsUi } from './items-ui';
import { Sfx } from './audio';
import { playEvents } from './sound-events';
import { GameEvent, HEROES as HERO_DEFS, RUNE_INFO, RuneKind, TEAM_NAMES } from '../sim';
import { Renderer } from './renderer';
import { enterImmersive, setupLandscape } from './screen';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const canvas = $<HTMLCanvasElement>('#game');
const app = $<HTMLElement>('#app');
const select = $<HTMLElement>('#select');

let world: World | null = null;
let renderer: Renderer | null = null;
let input: Input | null = null;
let myHeroId = 0;
const myTeam: Team = 0;
let pickedHero: HeroId = 'brakk';
let pickedLane: LaneId = 'mid';
let pickedDifficulty: BotDifficulty = 'normal';
try {
  pickedDifficulty = (localStorage.getItem('shrinefall-difficulty') as BotDifficulty) || 'normal';
} catch {
  /* storage unavailable */
}

// ------------------------------------------------------------- hero select

const cards = $<HTMLElement>('#hero-cards');
for (const id of HERO_IDS) {
  const d = HEROES[id];
  const card = document.createElement('button');
  card.className = 'hero-card';
  card.dataset.hero = id;
  card.innerHTML = `
    <div class="portrait" style="background:${d.color}">${d.name[0]}</div>
    <div class="info">
      <div class="hname">${d.name} <span>${d.title}</span></div>
      <div class="role">${d.role} · ${d.projectileSpeed ? 'Ranged' : 'Melee'}</div>
      <ul>${d.abilities
        .map((a) => `<li><b>${a.slot}${a.ultimate ? ' (Ult)' : ''}</b> ${a.name}${a.targeting === 'passive' ? ' <i>passive</i>' : ''}</li>`)
        .join('')}</ul>
    </div>`;
  card.addEventListener('click', () => {
    pickedHero = id;
    cards.querySelectorAll('.hero-card').forEach((c) => c.classList.toggle('picked', c === card));
  });
  cards.appendChild(card);
}
(cards.firstElementChild as HTMLElement).classList.add('picked');

const lanes = $<HTMLElement>('#lane-pick');
for (const l of LANE_IDS) {
  const b = document.createElement('button');
  b.textContent = l[0].toUpperCase() + l.slice(1);
  b.classList.toggle('picked', l === pickedLane);
  b.addEventListener('click', () => {
    pickedLane = l;
    lanes.querySelectorAll('button').forEach((x) => x.classList.toggle('picked', x === b));
  });
  lanes.appendChild(b);
}

const diffs = $<HTMLElement>('#diff-pick');
for (const d of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
  const b = document.createElement('button');
  b.textContent = d[0].toUpperCase() + d.slice(1);
  b.classList.toggle('picked', d === pickedDifficulty);
  b.addEventListener('click', () => {
    pickedDifficulty = d;
    try {
      localStorage.setItem('shrinefall-difficulty', d);
    } catch {
      /* storage unavailable */
    }
    diffs.querySelectorAll('button').forEach((x) => x.classList.toggle('picked', x === b));
  });
  diffs.appendChild(b);
}

$<HTMLButtonElement>('#btn-play').addEventListener('click', () => startMatch());

// ------------------------------------------------------------- match setup

/** Fill a 3v3: the human takes one slot, bots take every empty one. */
function buildSlots(): PlayerSlot[] {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) {
    const heroes = [...HERO_IDS];
    const lanePool = [...LANE_IDS];
    if (team === myTeam) {
      heroes.splice(heroes.indexOf(pickedHero), 1);
      lanePool.splice(lanePool.indexOf(pickedLane), 1);
      slots.push({ team, heroId: pickedHero, controller: 'human', lane: pickedLane });
    }
    while (slots.filter((s) => s.team === team).length < 3) {
      slots.push({ team, heroId: heroes.shift()!, controller: 'bot', lane: lanePool.shift()!, difficulty: pickedDifficulty });
    }
  }
  return slots;
}

const hud = new Hud(app, () => {
  app.classList.add('hidden');
  select.classList.remove('hidden');
  world = null;
});

const sfx = new Sfx();
const itemsUi = new ItemsUi(
  app,
  (cmd) => world?.enqueue(cmd),
  () => (world && renderer ? { w: world, me: world.unit(myHeroId)!, team: myTeam, terrain: renderer.terrain } : null),
  (slot) => {
    if (input) input.wardSlot = slot;
    if (renderer) renderer.wardMode = slot;
  },
  (text) => hud.toast(text, '#ffd23f'),
);

// Team buttons.
const onTap = (sel: string, fn: () => void) =>
  $<HTMLElement>(sel).addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
onTap('#btn-glyph', () => world?.enqueue({ type: 'glyph', unitId: myHeroId }));
onTap('#btn-buyback', () => world?.enqueue({ type: 'buyback', unitId: myHeroId }));
// ------------------------------------------------------------- settings

interface Settings {
  autoAttack: boolean;
  sound: boolean;
  autoLearn: boolean;
  leftHanded: boolean;
  vibrate: boolean;
  joystick: 'S' | 'M' | 'L';
  zoom: number;
}
const settings: Settings = { autoAttack: true, sound: true, autoLearn: false, leftHanded: false, vibrate: true, joystick: 'M', zoom: 1 };
const JOY_RADIUS = { S: 42, M: 55, L: 72 };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('shrinefall-settings') ?? '{}'));
} catch {
  /* storage unavailable */
}
const saveSettings = () => {
  try {
    localStorage.setItem('shrinefall-settings', JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
};
const autoBox = $<HTMLInputElement>('#set-autoattack');
const soundBox = $<HTMLInputElement>('#set-sound');
autoBox.checked = settings.autoAttack;
soundBox.checked = settings.sound;
sfx.setMuted(!settings.sound);
autoBox.addEventListener('change', () => {
  settings.autoAttack = autoBox.checked;
  saveSettings();
  world?.enqueue({ type: 'setAutoAttack', unitId: myHeroId, enabled: settings.autoAttack });
});
soundBox.addEventListener('change', () => {
  settings.sound = soundBox.checked;
  saveSettings();
  sfx.setMuted(!settings.sound);
});
const bindToggle = (sel: string, key: 'autoLearn' | 'leftHanded' | 'vibrate', apply: () => void) => {
  const box = $<HTMLInputElement>(sel);
  box.checked = settings[key];
  box.addEventListener('change', () => {
    settings[key] = box.checked;
    saveSettings();
    apply();
  });
};
/** Push the current settings into the running game. */
function applySettings() {
  app.classList.toggle('lefty', settings.leftHanded);
  if (input) {
    input.leftHanded = settings.leftHanded;
    input.setJoystickSize(JOY_RADIUS[settings.joystick]);
  }
  renderer?.setZoomFactor(settings.zoom);
  world?.enqueue({ type: 'setAutoLearn', unitId: myHeroId, enabled: settings.autoLearn });
  document.querySelectorAll<HTMLElement>('#set-joy button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.joystick));
}
bindToggle('#set-autolearn', 'autoLearn', applySettings);
bindToggle('#set-lefty', 'leftHanded', applySettings);
bindToggle('#set-vibrate', 'vibrate', () => {});
document.querySelectorAll<HTMLElement>('#set-joy button').forEach((b) =>
  b.addEventListener('click', () => {
    settings.joystick = b.dataset.v as Settings['joystick'];
    saveSettings();
    applySettings();
  }),
);
const zoomInput = $<HTMLInputElement>('#set-zoom');
zoomInput.value = String(settings.zoom);
zoomInput.addEventListener('input', () => {
  settings.zoom = Number(zoomInput.value);
  saveSettings();
  renderer?.setZoomFactor(settings.zoom);
});

/** Short vibration (Android; iPhones ignore it). */
let lastBuzz = 0;
function buzz(pattern: number | number[], minGap = 250) {
  if (!settings.vibrate || !navigator.vibrate) return;
  const now = performance.now();
  if (now - lastBuzz < minGap) return;
  lastBuzz = now;
  navigator.vibrate(pattern);
}

// ------------------------------------------------------------- pause / surrender
let paused = false;
const pauseEl = $<HTMLElement>('#pause');
const surrenderBtn = $<HTMLElement>('#btn-surrender');
function setPaused(p: boolean) {
  paused = p;
  pauseEl.classList.toggle('hidden', !p);
  surrenderBtn.classList.remove('confirm');
  surrenderBtn.textContent = 'Surrender';
}
setPaused(false);

const settingsPanel = $<HTMLElement>('#settings');
const statsPanel = $<HTMLElement>('#stats');
const scorePanel = $<HTMLElement>('#scoreboard');
onTap('#btn-settings', () => settingsPanel.classList.toggle('hidden'));
onTap('#portrait', () => statsPanel.classList.toggle('hidden'));
onTap('#topbar', () => scorePanel.classList.toggle('hidden'));
onTap('#btn-pause', () => setPaused(true));
onTap('#btn-resume', () => setPaused(false));
onTap('#btn-surrender', () => {
  if (!surrenderBtn.classList.contains('confirm')) {
    surrenderBtn.classList.add('confirm');
    surrenderBtn.textContent = 'Tap again to surrender';
    return;
  }
  world?.applyCommand({ type: 'surrender', unitId: myHeroId });
  if (world) hud.update(world, world.unit(myHeroId)!, myTeam);
  setPaused(false);
});
document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) =>
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $<HTMLElement>(`#${b.dataset.close}`).classList.add('hidden');
  }),
);
// Panels swallow touches so they don't move the hero underneath.
for (const p of [settingsPanel, statsPanel, scorePanel, pauseEl]) p.addEventListener('pointerdown', (e) => e.stopPropagation());
// Every gesture (re)unlocks audio: iOS only starts/resumes sound inside a user gesture,
// and may suspend it again after a call, a notification or switching apps.
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
  window.addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true });
}
// Any UI tap gets a soft click.
app.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button')) sfx.play('click', 0.6);
});

/** Announcements for big moments. */
function announce(w: World, events: GameEvent[]) {
  const name = (id: number) => {
    const u = w.unit(id);
    return u?.hero ? HERO_DEFS[u.hero.defId].name : 'Someone';
  };
  for (const e of events) {
    if (e.type === 'announce') {
      if (hud.announce(w, e, myTeam)) sfx.play(w.unit(e.unitId)?.team === myTeam ? 'victory' : 'defeat', 0.5);
      continue;
    }
    if (e.type === 'gameOver') {
      hud.showEndStats(w, myTeam, myHeroId);
      continue;
    }
    if (e.type === 'bossKilled') {
      hud.toast(e.team === 2 ? 'The Warden fell' : `${TEAM_NAMES[e.team]} slew the Warden — revive charm!`, '#c4b5fd');
    } else if (e.type === 'rune') {
      const u = w.unit(e.unitId);
      if (u?.team === myTeam) hud.toast(`${name(e.unitId)} picked up ${RUNE_INFO[e.kind as RuneKind].name}`, RUNE_INFO[e.kind as RuneKind].color);
    } else if (e.type === 'glyph') {
      hud.toast(e.team === myTeam ? 'Tower shield activated!' : 'Enemy activated their tower shield', '#8cc4ff');
    } else if (e.type === 'buyback') {
      hud.toast(`${name(e.unitId)} bought back!`, '#ffd23f');
    } else if (e.type === 'revive') {
      hud.toast(`${name(e.unitId)} revived by the charm`, '#ffd23f');
    } else if (e.type === 'death') {
      const u = w.unit(e.unitId);
      if (u?.structure && u.structure.tier !== 'fountain') {
        const tier = { tower1: 'tier-1 tower', tower2: 'tier-2 tower', barracks: 'barracks', shrineTower: 'shrine tower', shrine: 'Shrine' }[u.structure.tier as string];
        hud.toast(`${TEAM_NAMES[u.team as Team]} ${u.structure.lane ?? ''} ${tier} destroyed`, u.team === myTeam ? '#ff7b7f' : '#6fb0ff');
      } else if (u?.hero) {
        hud.killFeed(w, u, w.unit(e.killerId), myHeroId);
      }
    }
  }
}

function startMatch() {
  select.classList.add('hidden');
  app.classList.remove('hidden');
  world = new World({ seed: (Date.now() & 0xffff) + 1, slots: buildSlots() });
  myHeroId = world.heroes.find((h) => h.hero!.controller === 'human')!.id;
  renderer = new Renderer(canvas, world.map);
  input?.destroy();
  input = new Input(canvas, renderer, () => world!, () => myHeroId, app);
  input.onWardPlaced = () => {
    itemsUi.placingSlot = null;
  };
  sfx.unlock();
  const mm = renderer.minimapRect();
  $<HTMLElement>('#btn-glyph').style.top = `${mm.y + mm.size + 10}px`;
  hud.setHero(world.unit(myHeroId)!);
  world.applyCommand({ type: 'setAutoAttack', unitId: myHeroId, enabled: settings.autoAttack });
  settingsPanel.classList.add('hidden');
  statsPanel.classList.add('hidden');
  scorePanel.classList.add('hidden');
  setPaused(false);
  input.onTip = (slot) => hud.showAbilityTip(world!.unit(myHeroId)!, slot);
  applySettings();
  itemsUi.reset();
  void enterImmersive();
}

setupLandscape($<HTMLElement>('#root'), () => {
  renderer?.resize();
  if (renderer) {
    const mm = renderer.minimapRect();
    $<HTMLElement>('#btn-glyph').style.top = `${mm.y + mm.size + 10}px`;
  }
});

// ------------------------------------------------------------- loop

let acc = 0;
let last = performance.now();
function frame(now: number) {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  if (paused) acc = 0;
  if (world && renderer && input) {
    while (acc >= DT) {
      input.flush(world);
      world.step();
      renderer.pushEvents(world, world.events, myHeroId);
      playEvents(sfx, world, world.events, myHeroId, myTeam, { x: renderer.camX, y: renderer.camY });
      announce(world, world.events);
      for (const e of world.events) {
        if (e.type === 'attack' && e.targetId === myHeroId && world.unit(e.sourceId)?.kind === 'hero') buzz(20);
        else if (e.type === 'damage' && e.targetId === myHeroId) buzz(35);
        else if (e.type === 'death' && e.unitId === myHeroId) buzz([90, 40, 140], 0);
        else if (e.type === 'death' && e.killerId === myHeroId && world.unit(e.unitId)?.hero) buzz([40, 30, 40], 0);
      }
      acc -= DT;
    }
    const me = world.unit(myHeroId)!;
    // Back from the dead (or done peeking): camera returns to the hero.
    if (me.alive && renderer.freeCamera && !input.peeking) renderer.follow();
    renderer.render(world, acc / DT, me, myTeam, input.aim);
    hud.update(world, me, myTeam);
    if (!statsPanel.classList.contains('hidden')) hud.updateStats(world, me);
    if (!scorePanel.classList.contains('hidden')) hud.updateScoreboard(world, myTeam, myHeroId);
    itemsUi.update();
  } else acc = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for console / automated tests.
(window as unknown as { game: unknown }).game = { get world() { return world; }, get heroId() { return myHeroId; }, get renderer() { return renderer; } };
