import {
  BUYBACK_COOLDOWN,
  CHARM_DURATION,
  CREEPS,
  DAY_SECONDS,
  GLYPH_COOLDOWN,
  GLYPH_DURATION,
  NIGHT_SECONDS,
  RUNE_FIRST,
  RUNE_INTERVAL,
  SELL_REFUND_WINDOW,
  TELEPORT,
  Team,
  Unit,
  WARD_DURATION,
  WARDEN_SLAM,
  World,
  abilityDef,
} from '../sim';

/** Spawn a stationary training dummy (doesn't fight back, gives no gold). The enemy's unless a team is given. */
export function spawnDummy(w: World, x: number, y: number, team: Team = 1, hp = 1200): Unit {
  const d = w.spawnUnit('creep', team, { x, y }, { ...CREEPS.melee, hp: 1200, damage: 0, acquireRange: 0, bountyGold: 0, bountyXp: 20 });
  d.hp = hp;
  d.creep = { type: 'melee', lane: 'mid', path: [{ x, y }], wp: 1, super: false, mega: false };
  d.visionDay = d.visionNight = 0;
  return d;
}

type Point = { x: number; y: number };
type Tier = Parameters<World['findStructure']>[1];
type LaneName = 'top' | 'mid' | 'bot';

export interface Step {
  text: string;
  /** Screen controls to make pulse. */
  spot?: string[];
  /** Point on the map to highlight. */
  marker?: (w: World, me: Unit, t: Tutorial) => Point | null;
  /** Called once when the step starts. */
  enter?: (w: World, me: Unit, t: Tutorial) => void;
  /** Without it, the step is something to read and has a Next button. */
  done?: (w: World, me: Unit, t: Tutorial) => boolean;
}

export interface Lesson {
  id: string;
  title: string;
  about: string;
  steps: Step[];
}

/** For every cell, how far (in cells) it is to the nearest thing that blocks walking: tree, wall or building. */
const clearances = new WeakMap<World, Int16Array>();
function clearance(w: World): Int16Array {
  const known = clearances.get(w);
  if (known) return known;
  const { grid, walkable } = w.nav;
  const dist = new Int16Array(grid * grid).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < dist.length; i++) {
    if (!walkable[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const cx = i % grid;
    const cy = (i - cx) / grid;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= grid || y >= grid) continue;
      const n = y * grid + x;
      if (dist[n] < 0) {
        dist[n] = dist[i] + 1;
        queue.push(n);
      }
    }
  }
  clearances.set(w, dist);
  return dist;
}

/** Cells you can walk to from your fountain, so a lesson never leaves you shut in a forest pocket. */
const reachable = new WeakMap<World, Uint8Array>();
function walkableFromBase(w: World): Uint8Array {
  const known = reachable.get(w);
  if (known) return known;
  const { grid, cell, walkable } = w.nav;
  const seen = new Uint8Array(grid * grid);
  const stack: number[] = [];
  for (const f of w.map.fountains) {
    const c0 = Math.floor(f.x / cell);
    const r0 = Math.floor(f.y / cell);
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const i = (r0 + dy) * grid + c0 + dx;
      if (walkable[i] && !seen[i]) {
        seen[i] = 1;
        stack.push(i);
      }
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const cx = i % grid;
    for (const n of [cx + 1 < grid ? i + 1 : -1, cx > 0 ? i - 1 : -1, i + grid, i - grid]) {
      if (n >= 0 && n < seen.length && walkable[n] && !seen[n]) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  reachable.set(w, seen);
  return seen;
}

/** How clear of trees and walls a spot is, in meters. */
export function roomAt(w: World, x: number, y: number): number {
  const { grid, cell } = w.nav;
  return clearance(w)[Math.floor(y / cell) * grid + Math.floor(x / cell)] * cell;
}

/** The nearest open ground to a point, with this many meters clear all round if it can be had. */
export function openSpot(w: World, x: number, y: number, room = 3.5): Point {
  const { grid, cell } = w.nav;
  const clear = clearance(w);
  const walk = walkableFromBase(w);
  const reach = Math.ceil(30 / cell);
  const c0 = Math.floor(x / cell);
  const r0 = Math.floor(y / cell);
  let best = -1;
  let bestScore = -Infinity;
  for (let cy = Math.max(0, r0 - reach); cy <= Math.min(grid - 1, r0 + reach); cy++) {
    for (let cx = Math.max(0, c0 - reach); cx <= Math.min(grid - 1, c0 + reach); cx++) {
      const i = cy * grid + cx;
      if (!walk[i] || clear[i] < 1) continue;
      // Being short of room costs far more than walking a little further.
      const short = Math.max(0, room - clear[i] * cell);
      const score = -short * 100 - Math.hypot(cx - c0, cy - r0) * cell;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  if (best < 0) return { x, y };
  return { x: ((best % grid) + 0.5) * cell, y: (Math.floor(best / grid) + 0.5) * cell };
}

const distToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - k * dx, p.y - a.y - k * dy);
};

/**
 * The practice ground: the roomiest open clearing in your half of the jungle, away from lanes (creeps), towers and
 * the fountain (they would shoot the dummies) and jungle camps. Worked out once per match.
 */
const practiceGrounds = new WeakMap<World, Map<number, Point>>();
export function practiceGround(w: World, team: number): Point {
  let known = practiceGrounds.get(w);
  if (!known) practiceGrounds.set(w, (known = new Map()));
  const cached = known.get(team);
  if (cached) return cached;
  const { grid, cell, height } = w.nav;
  const clear = clearance(w);
  const walk = walkableFromBase(w);
  const mine = w.map.fountains[team as 0 | 1];
  const theirs = w.map.fountains[team === 0 ? 1 : 0];
  const lanes = Object.values(w.map.lanes);
  const buildings = w.map.structures;
  let best: Point = mine;
  let bestScore = -Infinity;
  // A coarse sweep is plenty: clearings are many meters across.
  const stride = Math.max(1, Math.round(2 / cell));
  for (let cy = 0; cy < grid; cy += stride) {
    for (let cx = 0; cx < grid; cx += stride) {
      const i = cy * grid + cx;
      if (!walk[i] || height[i] !== 1 || clear[i] * cell < 4) continue;
      const p = { x: (cx + 0.5) * cell, y: (cy + 0.5) * cell };
      if (Math.hypot(p.x - mine.x, p.y - mine.y) >= Math.hypot(p.x - theirs.x, p.y - theirs.y)) continue;
      if (buildings.some((b) => Math.hypot(p.x - b.pos.x, p.y - b.pos.y) < 22)) continue;
      if (w.map.camps.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < 14)) continue;
      if (w.map.hills.some((h) => Math.hypot(p.x - h.x, p.y - h.y) < 12)) continue;
      if (lanes.some((l) => l.some((a, k) => k > 0 && distToSegment(p, l[k - 1], a) < 20))) continue;
      const score = Math.min(clear[i] * cell, 9) * 10 - Math.hypot(p.x - mine.x, p.y - mine.y) * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  known.set(team, best);
  return best;
}

/** Lift the hero to a place on the map, standing still. Only the tutorial does this. */
function put(w: World, me: Unit, p: Point, room?: number) {
  const q = openSpot(w, p.x, p.y, room);
  me.x = me.px = q.x;
  me.y = me.py = q.y;
  w.enqueue({ type: 'stop', unitId: me.id });
}

/** Just above a building on screen, so it shows below the hero, clear of the lesson text. */
function beside(me: Unit, b: Unit | undefined): Point {
  if (!b) return { x: me.x, y: me.y };
  return { x: b.x, y: b.y - b.radius - 3 };
}

const atBuilding = (tier: Tier, lane: LaneName | null = 'mid') => (w: World, me: Unit) => put(w, me, beside(me, w.findStructure(me.team, tier, lane)[0]));
const buildingMark = (tier: Tier, lane: LaneName | null = 'mid') => (w: World, me: Unit) => w.findStructure(me.team, tier, lane)[0] ?? null;
const atFountain = (w: World, me: Unit) => put(w, me, w.map.fountains[me.team as 0 | 1]);
/** Your nearest mountain. */
const nearestMountain = (w: World, me: Unit): Point => {
  const f = w.map.fountains[me.team as 0 | 1];
  return [...w.map.hills].sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0];
};
const dummyMark = (w: World, _me: Unit, t: Tutorial) => w.unit(t.dummyId) ?? null;
const hasActiveSpell = (me: Unit) => me.hero!.abilities.some((a, i) => a.level > 0 && abilityDef(me, i)?.targeting !== 'passive');
const minutes = (seconds: number) => `${seconds / 60} min`;

function wardenHouse(w: World) {
  const boss = w.units.find((u) => u.neutral?.boss && u.alive);
  const [a, b] = w.map.houses;
  if (!boss) return a;
  return Math.hypot(boss.x - a.x, boss.y - a.y) < Math.hypot(boss.x - b.x, boss.y - b.y) ? a : b;
}

export const LESSONS: Lesson[] = [
  {
    id: 'goal',
    title: 'The goal',
    about: 'How a match is won',
    steps: [
      { text: 'Two teams of three heroes fight across three lanes. Destroy the enemy Shrine and you win. This is your own Shrine: guard it.', enter: atBuilding('shrine', null), marker: buildingMark('shrine', null) },
      { text: "The Shrine is protected at first. The order is: the towers of a lane, one after another, then that lane's barracks, then the two Shrine towers, then the Shrine." },
      { text: 'Creeps walk down every lane in waves and fight whatever they meet. Towers shoot creeps first, so push a tower together with your creeps.', enter: atBuilding('tower1'), marker: buildingMark('tower1') },
      { text: 'Destroy a barracks and your creeps of that type get stronger. Destroy all six enemy barracks and your creeps all become Mega Creeps.' },
    ],
  },
  {
    id: 'moving',
    title: 'Moving and looking',
    about: 'Joystick, minimap, pings, pause',
    steps: [
      {
        text: 'Drag on the left side of the screen: that is your joystick. Walk to the glowing marker.',
        enter: (w, me, t) => {
          put(w, me, practiceGround(w, me.team));
          t.goal = openSpot(w, me.x + 6, me.y + 4);
        },
        marker: (_w, _me, t) => t.goal,
        done: (_w, me, t) => !!t.goal && Math.hypot(me.x - t.goal.x, me.y - t.goal.y) < 3,
      },
      { text: 'Hold your finger on the minimap, top left, to look around the map. Let go and the camera comes back to your hero.', done: (_w, _me, t) => t.peeked },
      { text: 'Tap Ping, beside the minimap, then tap the map to show your team a spot.', spot: ['#btn-ping'], done: (_w, _me, t) => t.flags.has('ping') },
      { text: "Your health, mana and experience are at the bottom left. The i on your portrait opens your hero's stats. Pause is at the top right.", spot: ['#btn-stats', '#btn-pause'] },
    ],
  },
  {
    id: 'fighting',
    title: 'Fighting',
    about: 'Spells, attacks, last hits, denies',
    steps: [
      {
        text: 'Each level gives you a point to spend on a spell. Tap a + on your spells to learn one. Passive spells work by themselves, so you will get to pick again until you have one to cast.',
        enter: (w, me, t) => {
          put(w, me, practiceGround(w, me.team));
          me.hero!.skillPoints = Math.max(1, me.hero!.skillPoints);
          t.autoAttackOff(w, me);
        },
        done: (_w, me) => {
          if (hasActiveSpell(me)) return true;
          me.hero!.skillPoints = Math.max(1, me.hero!.skillPoints);
          return false;
        },
      },
      {
        text: 'Use a spell: hold its button, drag to aim, and let go. A quick tap aims for you. Drag onto the cancel area to call it off. Hold still to read what the spell does.',
        spot: ['#btn-q', '#btn-w'],
        enter: (w, me, t) => {
          t.addDummy(w, me, 4, 3);
          me.mana = me.maxMana;
          for (const a of me.hero!.abilities) a.cooldown = 0;
        },
        marker: dummyMark,
        done: (_w, _me, t) => t.flags.has('cast'),
      },
      {
        text: 'Tap Attack to hit the nearest target. Hold Attack and drag the arrow to choose someone else, and let go. Destroy the dummy.',
        spot: ['#btn-attack'],
        enter: (w, me, t) => {
          const d = w.unit(t.dummyId);
          if (d?.alive) d.hp = Math.min(d.hp, 260);
          else t.addDummy(w, me, 3, 3, 1, 260);
        },
        marker: dummyMark,
        done: (w, _me, t) => !w.unit(t.dummyId)?.alive,
      },
      { text: 'Auto attack, in Settings, decides how you fight. On: you hit the nearest enemy by yourself, even while walking. Off, as in this lesson: one attack for each tap or each aimed release.', spot: ['#btn-settings'] },
      {
        text: 'Creeps pay gold only to the hero who lands the killing blow: a last hit. This one is nearly dead. Land the last hit.',
        spot: ['#btn-attack'],
        enter: (w, me, t) => {
          t.lastHits = me.hero!.lastHits;
          t.addDummy(w, me, 3, 2, 1, 5);
        },
        marker: dummyMark,
        done: (_w, me, t) => me.hero!.lastHits > t.lastHits,
      },
      {
        text: 'Your own creeps below half health can be finished by you: a deny. The enemy gets no gold and less experience. Auto attack never does this. Hold Attack, drag the arrow onto it, and let go.',
        spot: ['#btn-attack'],
        enter: (w, me, t) => {
          t.denies = me.hero!.denies;
          t.addDummy(w, me, -3, 3, me.team as Team, 5);
        },
        marker: dummyMark,
        done: (_w, me, t) => me.hero!.denies > t.denies,
      },
    ],
  },
  {
    id: 'gold',
    title: 'Gold and items',
    about: 'Shop, courier, teleport, buyback',
    steps: [
      { text: 'Gold comes in by itself, and much faster from last hits, kills and buildings. Spend it at the shop.', enter: atFountain },
      {
        text: 'Open the shop and go to Supplies. Tap Herbal Poultice, then BUY. Tapping only selects, so scrolling never buys by accident.',
        spot: ['#btn-shop'],
        enter: (_w, me, t) => {
          me.hero!.gold = Math.max(me.hero!.gold, 300);
          t.poultices = t.countItem(me, 'healingSalve');
        },
        done: (_w, me, t) => t.countItem(me, 'healingSalve') > t.poultices,
      },
      { text: `Changed your mind? Selling gives everything back for ${SELL_REFUND_WINDOW} s, then half. Tap an item you own while the shop is open to sell it. You can shop while dead, too.` },
      { text: 'Buy away from base and the item waits on your courier, which holds 3. Tap the courier button to send it. It walks the lanes until 6:00, then flies.', spot: ['#btn-courier'] },
      { text: `Every hero starts with a teleport. Tap it and choose an allied building. You stand still for ${TELEPORT.channel} s; only the X or a stun stops it. Wayfarer Boots give you one that is never used up.`, spot: ['#tp-slot'] },
      { text: `Dying costs gold, and you wait to respawn. While you wait you may pay to buy back in at once, but only once every ${minutes(BUYBACK_COOLDOWN)}.` },
    ],
  },
  {
    id: 'buildings',
    title: 'Buildings',
    about: 'Towers, barracks, Shrine, fountain',
    steps: [
      { text: 'Each lane has three towers, and each is tougher than the one before. A tower can only be attacked once the one in front of it has fallen.', enter: atBuilding('tower1'), marker: buildingMark('tower1') },
      { text: 'A tower sees exactly as far as it shoots, unless trees are in the way. It spots anyone in that zone, even invisible, and tells your team. It gives no other sight, so the ground around it stays dark.' },
      { text: 'Past the first towers, heroes alone barely hurt a building: a quarter of the damage. Bring your creeps, or it heals right back. Attacking a building reveals you for 3 s.', enter: atBuilding('tower2'), marker: buildingMark('tower2') },
      { text: "Each lane has two barracks behind its last tower. They can't be hit until that tower falls. The melee one is tougher and heals itself.", enter: atBuilding('barracks'), marker: buildingMark('barracks') },
      { text: 'Once any barracks has fallen the two Shrine towers can be attacked, and when both are gone, the Shrine.', enter: atBuilding('shrineTower', null), marker: buildingMark('shrineTower', null) },
      { text: `The tower shield protects all your buildings for ${GLYPH_DURATION} s and doubles how fast your towers shoot. Your team shares it, once every ${minutes(GLYPH_COOLDOWN)}.`, spot: ['#btn-glyph'] },
      { text: "The fountain heals you inside its walled yard. It shoots enemies anywhere in the yard and doorway, but never past its wall. It can't be destroyed.", enter: atFountain },
    ],
  },
  {
    id: 'map',
    title: 'The map',
    about: 'River, runes, forest, day and night',
    steps: [
      { text: 'Three lanes join the bases: top, middle and bottom. Only the middle lane crosses the river. The side lanes stay high and dry, and you can see down into the river from them.', enter: (w, me) => put(w, me, w.map.runeSpots[me.team as 0 | 1]) },
      { text: `Runes appear on the river at ${RUNE_FIRST / 60}:00 and every ${RUNE_INTERVAL / 60} minutes after. Walk onto one for a burst of speed, double damage, healing, invisibility or gold.`, marker: (w, me) => w.map.runeSpots[me.team as 0 | 1] },
      { text: 'Trees block walking and sight, but never spells. Some forest pockets have no way out on foot: get out with a blink, a charge, or a teleport.' },
      {
        text: "This mountain can't be walked on. You get up or down only by blink, charge or teleport. Anyone can stand at its foot and plant a totem on top.", enter: (w, me) => {
          const m = nearestMountain(w, me);
          put(w, me, { x: m.x, y: m.y - 9 });
        },
        marker: (w, me) => nearestMountain(w, me),
      },
      { text: `Dark areas are fog: you see only what your heroes, creeps and totems see. Day lasts ${DAY_SECONDS / 60} minutes and night ${NIGHT_SECONDS / 60}, and at night everyone sees less far.`, spot: ['#clock-disc'] },
    ],
  },
  {
    id: 'sight',
    title: 'Totems and sight',
    about: 'Watcher, Seer, invisible enemies',
    steps: [
      {
        text: 'A Watcher Totem gives sight where you plant it. You have one now: tap it in your items, then tap the ground nearby.',
        spot: ['#itembar [data-item]'],
        enter: (w, me) => {
          atFountain(w, me);
          me.hero!.gold = Math.max(me.hero!.gold, 300);
          w.enqueue({ type: 'buy', unitId: me.id, itemId: 'observerWard' });
        },
        done: (_w, _me, t) => t.flags.has('ward'),
      },
      { text: `Totems last ${minutes(WARD_DURATION)} and are invisible unless the enemy can reveal them. Two attacks destroy one. Planted on a mountain, a Watcher Totem sees much farther.` },
      { text: 'A Seer Totem reveals invisible enemies and totems, but only where your team can already see. After its first 5 s it gives no sight of its own, so use it with a Watcher.' },
      { text: "Towers, the fountain and Seer Totems can see invisible enemies. They wear a green eye. The Shrine and barracks can't. Trees block sight unless you stand above them." },
    ],
  },
  {
    id: 'warden',
    title: 'The Warden',
    about: 'The boss and its charm',
    steps: [
      {
        text: 'The Warden lives on the river in one of two walled houses, and you can only see or fight it from inside. This is its house. It leaves you alone until someone attacks it.',
        enter: (w, me) => {
          const h = wardenHouse(w);
          put(w, me, { x: h.x, y: h.y - h.inner + 3 }, 2);
        },
        marker: (w) => wardenHouse(w),
      },
      { text: `Bring your team. It slams the ground every ${WARDEN_SLAM.interval} s: its arms go up, then everyone within ${WARDEN_SLAM.radius} m is hurt and stunned. Step away when you see it coming.` },
      { text: 'Every dusk it gathers for a moment, then moves to the other house and keeps its wounds. Stun it during that time and it stays until the next dusk.' },
      { text: `When it dies it drops a charm that anyone can grab, enemies too. Die carrying it and you come back on the spot 3 s later and lose no gold. It crumbles after ${minutes(CHARM_DURATION)}.` },
      { text: 'The Warden comes back 8 to 11 minutes after it dies, in a random house, with no warning.' },
    ],
  },
];

const DONE_KEY = 'ovra-tutorial-done';
function loadDone(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

/**
 * The tutorial: a list of short lessons, played in a quiet match with no enemy heroes. A step you do finishes by
 * itself; a step you read has a Next button. Rule numbers in the text come from the game's own data.
 */
export class Tutorial {
  private lesson: Lesson | null = null;
  private i = 0;
  private started = false;
  private needsMenu = true;
  private doneLessons = loadDone();
  private dummies: number[] = [];
  private spotted: Element[] = [];
  private world: World | null = null;
  private restoreAuto: number | null = null;
  dummyId: number | null = null;
  goal: Point | null = null;
  peeked = false;
  lastHits = 0;
  denies = 0;
  poultices = 0;
  /** Things that have happened in this step. */
  flags = new Set<string>();

  constructor(
    private box: HTMLElement,
    /** They left for the start menu. */
    private onLeave: () => void,
    /** They chose to carry on playing here. */
    private onFinish: () => void,
  ) {}

  /** Off for a lesson, so the hero doesn't do the player's practice by itself. It comes back when the lesson ends. */
  autoAttackOff(w: World, me: Unit) {
    if (me.hero!.autoAttack) this.restoreAuto = me.id;
    w.enqueue({ type: 'setAutoAttack', unitId: me.id, enabled: false });
  }

  /** Make a dummy near the hero (offset in meters). */
  addDummy(w: World, me: Unit, dx: number, dy: number, team: Team = 1, hp = 1200) {
    const p = openSpot(w, me.x + dx, me.y + dy, 2);
    const d = spawnDummy(w, p.x, p.y, team, hp);
    this.dummies.push(d.id);
    this.dummyId = d.id;
  }

  countItem(me: Unit, id: string) {
    return me.hero!.items.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  }

  get marker(): ((w: World, me: Unit) => Point | null) | undefined {
    const m = this.lesson?.steps[this.i]?.marker;
    return m ? (w, me) => m(w, me, this) : undefined;
  }

  update(w: World, me: Unit) {
    this.world = w;
    if (this.needsMenu) {
      this.needsMenu = false;
      this.renderMenu();
    }
    const step = this.lesson?.steps[this.i];
    if (!step) return;
    // Nobody should wait around dead in a lesson.
    if (!me.alive) {
      if (me.hero!.respawnTimer > 1) me.hero!.respawnTimer = 1;
      return;
    }
    if (!this.started) {
      this.started = true;
      this.flags.clear();
      this.peeked = false;
      step.enter?.(w, me, this);
      this.renderStep();
      return;
    }
    for (const e of w.events) {
      if (e.type === 'cast' && e.unitId === me.id && e.slot >= 0) this.flags.add('cast');
      if (e.type === 'ping' && e.ping.fromId === me.id) this.flags.add('ping');
      if (e.type === 'ward' && w.unit(e.unitId)?.team === me.team) this.flags.add('ward');
    }
    if (step.done?.(w, me, this)) this.next();
  }

  private next() {
    if (!this.lesson) return;
    this.i++;
    this.started = false;
    if (this.i < this.lesson.steps.length) return;
    this.doneLessons.add(this.lesson.id);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify([...this.doneLessons]));
    } catch {
      /* storage unavailable */
    }
    this.closeLesson();
    this.renderMenu();
  }

  private closeLesson() {
    this.lesson = null;
    this.setSpots([]);
    for (const id of this.dummies) {
      const d = this.world?.unit(id);
      if (d?.alive) this.world!.expire(d);
    }
    this.dummies = [];
    if (this.restoreAuto !== null) this.world?.enqueue({ type: 'setAutoAttack', unitId: this.restoreAuto, enabled: true });
    this.restoreAuto = null;
    this.dummyId = null;
    this.goal = null;
  }

  private setSpots(selectors: string[]) {
    for (const el of this.spotted) el.classList.remove('tut-spot');
    this.spotted = selectors.flatMap((s) => [...this.box.ownerDocument.querySelectorAll(s)]);
    for (const el of this.spotted) el.classList.add('tut-spot');
  }

  private tap(selector: string, fn: () => void) {
    this.box.querySelector(selector)?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  }

  private renderStep() {
    const lesson = this.lesson!;
    const step = lesson.steps[this.i];
    this.setSpots(step.spot ?? []);
    this.box.className = '';
    const nextLabel = this.i === lesson.steps.length - 1 ? 'Finish' : 'Next';
    this.box.innerHTML = `<div class="tut-text"><div class="tut-step">${lesson.title} · ${this.i + 1} of ${lesson.steps.length}</div><p>${step.text}</p></div><div class="tut-acts">${step.done ? '' : `<button id="tut-next" class="on">${nextLabel}</button>`}<button id="tut-lessons">Lessons</button></div>`;
    this.tap('#tut-lessons', () => {
      this.closeLesson();
      this.renderMenu();
    });
    this.tap('#tut-next', () => this.next());
  }

  private renderMenu() {
    this.setSpots([]);
    this.box.className = 'menu';
    const rows = LESSONS.map((l) => `<button data-lesson="${l.id}"><b>${this.doneLessons.has(l.id) ? '✓ ' : ''}${l.title}</b><small>${l.about}</small></button>`).join('');
    this.box.innerHTML = `<div class="tut-title">Learn to play</div><div class="tut-list">${rows}</div><div class="tut-acts"><button id="tut-play">Keep playing here</button><button id="tut-leave">Back to the menu</button></div>`;
    for (const l of LESSONS) {
      this.tap(`[data-lesson="${l.id}"]`, () => {
        this.lesson = l;
        this.i = 0;
        this.started = false;
        this.box.classList.add('hidden');
      });
    }
    this.tap('#tut-play', () => {
      this.hide();
      this.onFinish();
    });
    this.tap('#tut-leave', () => {
      this.hide();
      this.onLeave();
    });
  }

  hide() {
    this.setSpots([]);
    this.box.classList.add('hidden');
  }
}
