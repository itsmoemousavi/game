import './style.css';
import { DT, HEROES, HERO_IDS, HeroId, LANE_IDS, LaneId, PlayerSlot, Team, World } from '../sim';
import { Hud } from './hud';
import { Input } from './input';
import { ItemsUi } from './items-ui';
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

const itemsUi = new ItemsUi(
  app,
  (cmd) => world?.enqueue(cmd),
  () => (world && renderer ? { w: world, me: world.unit(myHeroId)!, team: myTeam, terrain: renderer.terrain } : null),
);

function startMatch() {
  select.classList.add('hidden');
  app.classList.remove('hidden');
  world = new World({ seed: (Date.now() & 0xffff) + 1, slots: buildSlots() });
  myHeroId = world.heroes.find((h) => h.hero!.controller === 'human')!.id;
  renderer = new Renderer(canvas, world.map);
  input?.destroy();
  input = new Input(canvas, renderer, () => world!, () => myHeroId, app);
  hud.setHero(world.unit(myHeroId)!);
  itemsUi.reset();
  void enterImmersive();
}

setupLandscape($<HTMLElement>('#root'), () => renderer?.resize());

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
      renderer.pushEvents(world, world.events);
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
