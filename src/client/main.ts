import './style.css';
import { DT, HEROES, HERO_IDS, HeroId, LANE_IDS, LaneId, PlayerSlot, Team, World } from '../sim';
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
      slots.push({ team, heroId: heroes.shift()!, controller: 'bot', lane: lanePool.shift()! });
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
const muteBtn = $<HTMLElement>('#btn-mute');
const syncMute = () => (muteBtn.textContent = sfx.muted ? '🔇' : '🔊');
syncMute();
onTap('#btn-mute', () => {
  sfx.unlock();
  sfx.setMuted(!sfx.muted);
  syncMute();
});
// Any UI tap gets a soft click (and keeps the audio context alive on iOS).
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
      } else if (u?.hero && w.unit(e.killerId)?.hero) {
        hud.toast(`${name(e.killerId!)} killed ${name(e.unitId)}`, u.team === myTeam ? '#ff7b7f' : '#6fb0ff');
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
  if (world && renderer && input) {
    while (acc >= DT) {
      input.flush(world);
      world.step();
      renderer.pushEvents(world, world.events, myHeroId);
      playEvents(sfx, world, world.events, myHeroId, myTeam, { x: renderer.camX, y: renderer.camY });
      announce(world, world.events);
      acc -= DT;
    }
    const me = world.unit(myHeroId)!;
    // Back from the dead (or done peeking): camera returns to the hero.
    if (me.alive && renderer.freeCamera && !input.peeking) renderer.follow();
    renderer.render(world, acc / DT, me, myTeam, input.aim);
    hud.update(world, me, myTeam);
    itemsUi.update();
  } else acc = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for console / automated tests.
(window as unknown as { game: unknown }).game = { get world() { return world; }, get heroId() { return myHeroId; } };
