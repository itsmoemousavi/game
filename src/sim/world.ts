import {
  CREEP_WAVE_INTERVAL,
  DT,
  FIRST_WAVE_TIME,
  FOUNTAIN_HEAL_RADIUS,
  MAX_LEVEL,
  MELEE_PER_WAVE,
  PASSIVE_GOLD_PER_SEC,
  RANGED_PER_WAVE,
  STARTING_GOLD,
  CAMP_FIRST_SPAWN,
  CAMP_RESPAWN,
  NEUTRAL_LEASH,
  Side,
  Team,
  VISION_HZ,
  XP_SHARE_RADIUS,
  XP_TABLE,
  otherTeam,
} from './constants';
import { HEROES, HeroId, maxAbilityLevel } from './data/heroes';
import { CREEPS, CombatStats, HERO_VISION, NEUTRALS, STRUCTURES, SUPER_CREEP_MULT } from './data/units';
import { ItemId, ItemStats } from './data/items';
import { ItemSlot, buyItem, buyTeleport, emptyInventory, itemBonuses, sellItem, startTeleport, updateChannel, useItem } from './inventory';
import { Vision } from './vision';
import { GameMap, LaneId, StructureTier, createMap, fits, isWalkable, lineClear, teamLanePath } from './map';
import { Vec2, dist, distV } from './math';

const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / l2));
  return dist(px, py, ax + abx * t, ay + aby * t);
};
import { findPath } from './pathfinding';
import { Rng } from './rng';
import { botThink } from './ai/bots';
import { applyAttackPassives, castAbility, damageAfterPassives, passiveArmor, resolveCast } from './abilities';

export type UnitKind = 'hero' | 'creep' | 'neutral' | 'structure';
export type Controller = 'human' | 'bot';

export type Order =
  | { type: 'idle' }
  | { type: 'dir'; dx: number; dy: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'attack'; targetId: number }
  | { type: 'cast'; slot: number; targetId?: number; x?: number; y?: number };

/** Every way a player (human or bot, local or remote) can influence the game. */
export type Command =
  | { type: 'moveDir'; unitId: number; dx: number; dy: number }
  | { type: 'moveTo'; unitId: number; x: number; y: number }
  | { type: 'attack'; unitId: number; targetId: number }
  | { type: 'attackNearest'; unitId: number }
  | { type: 'stop'; unitId: number }
  /** Use ability `slot` (0 = Q, 1 = W, 2 = R). Give targetId for unit-target abilities, x/y otherwise. */
  | { type: 'cast'; unitId: number; slot: number; targetId?: number; x?: number; y?: number }
  /** Spend a skill point on ability `slot`. */
  | { type: 'learn'; unitId: number; slot: number }
  /** Shop (only near your fountain). */
  | { type: 'buy'; unitId: number; itemId: ItemId }
  | { type: 'sell'; unitId: number; slot: number }
  | { type: 'buyTp'; unitId: number }
  /** Use a consumable in inventory slot `slot`. */
  | { type: 'useItem'; unitId: number; slot: number }
  /** Channel a teleport to an allied building. Moving or being stunned cancels it. */
  | { type: 'teleport'; unitId: number; targetId: number };

export interface AbilityState {
  level: number;
  cooldown: number;
}

/** Timed effect on a unit (slows, speed boosts, heals/damage over time...). */
export interface Buff {
  key: string;
  t: number;
  sourceId?: number;
  slowPct?: number;
  moveSpeedPct?: number;
  armor?: number;
  healPerSec?: number;
  damagePerSec?: number;
}

/** Lingering ground area that ticks damage / slow on enemies inside (Arrow Storm, burning ground). */
export interface Zone {
  id: number;
  kind: 'arrowStorm' | 'burn';
  team: Side;
  sourceId: number;
  x: number;
  y: number;
  radius: number;
  t: number;
  duration: number;
  dps: number;
  slowPct: number;
}

/** Delayed one-shot area effect (Earthsplitter wind-up, Cataclysm meteor). */
export interface Blast {
  id: number;
  kind: 'earthsplitter' | 'cataclysm';
  team: Side;
  sourceId: number;
  x: number;
  y: number;
  radius: number;
  t: number;
  delay: number;
  damage: number;
  stun: number;
  burn?: { dps: number; duration: number };
}

/** Non-homing projectile travelling in a straight line (Piercing Arrow). */
export interface Skillshot {
  id: number;
  kind: 'piercingArrow' | 'fireball';
  team: Side;
  sourceId: number;
  x: number;
  y: number;
  px: number;
  py: number;
  dx: number;
  dy: number;
  speed: number;
  remaining: number;
  width: number;
  damage: number;
  hit: number[];
  /** If set: stop at the first enemy hit (or at max range) and explode in this radius. */
  explode?: number;
}

export interface Dash {
  dx: number;
  dy: number;
  speed: number;
  remaining: number;
  damage: number;
  stun: number;
  hit: number[];
}

export interface HeroState {
  defId: HeroId;
  controller: Controller;
  slot: number;
  lane: LaneId;
  level: number;
  xp: number;
  gold: number;
  kills: number;
  deaths: number;
  lastHits: number;
  respawnTimer: number;
  order: Order;
  abilities: AbilityState[];
  skillPoints: number;
  /** Attacks made, for "every Nth attack" passives. */
  attackCount: number;
  /** 6 item slots (null = empty). */
  items: (ItemSlot | null)[];
  /** Teleport scrolls carried (separate slot, unlimited). */
  tpCount: number;
  tpCooldown: number;
  channel: { kind: 'tp'; t: number; total: number; targetId: number } | null;
  /** Item bonuses currently applied (cooldown reduction, spell amp, lifesteal, ult upgrade...). */
  bonus: Required<ItemStats>;
  bot: { thinkTimer: number; retreating: boolean; buildIndex: number };
}

export interface NeutralState {
  camp: number;
  homeX: number;
  homeY: number;
}

export interface CreepState {
  type: 'melee' | 'ranged';
  lane: LaneId;
  path: Vec2[];
  wp: number;
  super: boolean;
}

export interface StructureState {
  tier: StructureTier;
  lane: LaneId | null;
  vulnerable: boolean;
  aggroId: number | null;
  aggroTimer: number;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  team: Side;
  x: number;
  y: number;
  /** Position at the previous tick, for render interpolation. */
  px: number;
  py: number;
  radius: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  hpRegen: number;
  mana: number;
  maxMana: number;
  manaRegen: number;
  armor: number;
  damage: number;
  attackInterval: number;
  attackRange: number;
  attackTimer: number;
  projectileSpeed: number;
  moveSpeed: number;
  acquireRange: number;
  bountyGold: number;
  bountyXp: number;
  visionDay: number;
  visionNight: number;
  targetId: number | null;
  facing: number;
  path: Vec2[] | null;
  pathGoal: Vec2 | null;
  repathAt: number;
  /** Which way we're steering around a structure (0 = not avoiding). */
  avoidSide: number;
  /** Seconds of stun left: no moving, attacking or casting. */
  stunTimer: number;
  /** Seconds the unit is busy casting (cannot act). */
  castLock: number;
  buffs: Buff[];
  dash: Dash | null;
  hero?: HeroState;
  creep?: CreepState;
  structure?: StructureState;
  neutral?: NeutralState;
}

export interface Projectile {
  id: number;
  team: Side;
  x: number;
  y: number;
  px: number;
  py: number;
  sourceId: number;
  targetId: number;
  speed: number;
  damage: number;
  /** Spell projectiles deal spell damage (and may explode). */
  spell?: { kind: 'fireball'; aoe: number };
}

export type GameEvent =
  | { type: 'attack'; sourceId: number; targetId: number }
  | { type: 'death'; unitId: number; killerId: number | null }
  | { type: 'gold'; unitId: number; amount: number }
  | { type: 'levelUp'; unitId: number; level: number }
  | { type: 'gameOver'; winner: Team }
  | { type: 'cast'; unitId: number; slot: number }
  | { type: 'heal'; unitId: number; amount: number }
  | { type: 'teleport'; unitId: number }
  | { type: 'explosion'; x: number; y: number; radius: number };

export type DamageKind = 'attack' | 'spell';

export interface PlayerSlot {
  team: Team;
  heroId: HeroId;
  controller: Controller;
  lane: LaneId;
}

export interface WorldOptions {
  seed: number;
  slots: PlayerSlot[];
  map?: GameMap;
}

const armorMultiplier = (armor: number) => 1 - (0.06 * armor) / (1 + 0.06 * Math.abs(armor));

export class World {
  readonly map: GameMap;
  /** Map + footprints of standing structures; used for pathing and movement. */
  nav: GameMap;
  readonly rng: Rng;
  tick = 0;
  time = 0;
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  skillshots: Skillshot[] = [];
  zones: Zone[] = [];
  blasts: Blast[] = [];
  events: GameEvent[] = [];
  winner: Team | null = null;
  teamKills: [number, number] = [0, 0];
  readonly vision: Vision;
  nextId = 1;
  private nextCampSpawn = CAMP_FIRST_SPAWN;
  private nextWave = FIRST_WAVE_TIME;
  private pending: Command[] = [];
  private byId = new Map<number, Unit>();

  constructor(opts: WorldOptions) {
    this.map = opts.map ?? createMap();
    this.nav = { ...this.map, walkable: new Uint8Array(this.map.walkable) };
    this.rng = new Rng(opts.seed);
    this.vision = new Vision(this.map.grid, this.map.cell);
    for (const s of this.map.structures) this.spawnStructure(s.team, s.tier, s.lane, s.pos);
    this.refreshVulnerability();
    this.rebuildNav();
    opts.slots.forEach((slot, i) => this.spawnHero(slot, i));
    this.vision.update(this);
  }

  /** Whether `team` can currently see unit `u` (fog of war). */
  canSee(team: Side, u: Unit): boolean {
    if (team === 2) return true;
    return this.vision.sees(team, u);
  }

  // ---------------------------------------------------------------- queries

  get heroes(): Unit[] {
    return this.units.filter((u) => u.kind === 'hero');
  }

  get structures(): Unit[] {
    return this.units.filter((u) => u.kind === 'structure');
  }

  unit(id: number | null | undefined): Unit | undefined {
    return id == null ? undefined : this.byId.get(id);
  }

  findStructure(team: Side, tier: StructureTier, lane: LaneId | null = null): Unit[] {
    return this.units.filter(
      (u) => u.structure && u.team === team && u.structure.tier === tier && (lane === null || u.structure.lane === lane),
    );
  }

  /** Whether `a` may currently attack `b`. */
  canAttack(a: Unit, b: Unit | undefined): b is Unit {
    if (!b || !b.alive || b.team === a.team) return false;
    if (b.structure && !b.structure.vulnerable) return false;
    return true;
  }

  enemiesNear(u: Unit, x: number, y: number, r: number, filter?: (e: Unit) => boolean): Unit[] {
    const out: Unit[] = [];
    for (const e of this.units) {
      if (!this.canAttack(u, e)) continue;
      if (dist(x, y, e.x, e.y) - e.radius > r) continue;
      if (filter && !filter(e)) continue;
      out.push(e);
    }
    return out;
  }

  // ---------------------------------------------------------------- commands

  enqueue(cmd: Command) {
    this.pending.push(cmd);
  }

  applyCommand(cmd: Command) {
    const u = this.unit(cmd.unitId);
    if (!u || !u.hero) return;
    const h = u.hero;
    // Shopping works while dead (you respawn at the fountain); everything else needs a living hero.
    if (!u.alive && cmd.type !== 'buy' && cmd.type !== 'sell' && cmd.type !== 'buyTp' && cmd.type !== 'learn') return;
    if (h.channel && (cmd.type === 'moveDir' || cmd.type === 'moveTo' || cmd.type === 'attack' || cmd.type === 'attackNearest' || cmd.type === 'cast' || cmd.type === 'stop')) {
      if (cmd.type !== 'moveDir' || Math.hypot(cmd.dx, cmd.dy) >= 0.15) h.channel = null;
    }
    switch (cmd.type) {
      case 'moveDir': {
        const l = Math.hypot(cmd.dx, cmd.dy);
        if (l < 0.15) {
          if (h.order.type === 'dir') h.order = { type: 'idle' };
        } else {
          h.order = { type: 'dir', dx: cmd.dx / l, dy: cmd.dy / l };
        }
        break;
      }
      case 'moveTo':
        h.order = { type: 'move', x: cmd.x, y: cmd.y };
        u.path = null;
        break;
      case 'attack': {
        const t = this.unit(cmd.targetId);
        if (this.canAttack(u, t) && this.canSee(u.team, t)) h.order = { type: 'attack', targetId: cmd.targetId };
        break;
      }
      case 'attackNearest': {
        const t = this.pickAutoTarget(u);
        h.order = t ? { type: 'attack', targetId: t.id } : { type: 'idle' };
        break;
      }
      case 'stop':
        h.order = { type: 'idle' };
        break;
      case 'cast':
        if (castAbility(this, u, cmd.slot, cmd) === 'approach') {
          h.order = { type: 'cast', slot: cmd.slot, targetId: cmd.targetId, x: cmd.x, y: cmd.y };
        }
        break;
      case 'buy':
        buyItem(this, u, cmd.itemId);
        break;
      case 'sell':
        sellItem(this, u, cmd.slot);
        break;
      case 'buyTp':
        buyTeleport(this, u);
        break;
      case 'useItem':
        useItem(this, u, cmd.slot);
        break;
      case 'teleport':
        startTeleport(this, u, cmd.targetId);
        break;
      case 'learn': {
        const def = HEROES[h.defId].abilities[cmd.slot];
        const st = h.abilities[cmd.slot];
        if (!def || h.skillPoints <= 0 || st.level >= maxAbilityLevel(def, h.level)) break;
        st.level++;
        h.skillPoints--;
        break;
      }
    }
  }

  /** Can `u` act this tick (not stunned / mid-cast)? */
  canAct(u: Unit): boolean {
    return u.stunTimer <= 0 && u.castLock <= 0 && !u.dash;
  }

  speedOf(u: Unit): number {
    let pct = 0;
    let slow = 0;
    for (const b of u.buffs) {
      if (b.moveSpeedPct) pct += b.moveSpeedPct;
      if (b.slowPct) slow = Math.max(slow, b.slowPct);
    }
    return u.moveSpeed * (1 + pct / 100) * (1 - slow / 100);
  }

  armorOf(u: Unit): number {
    let a = u.armor + passiveArmor(u);
    for (const b of u.buffs) if (b.armor) a += b.armor;
    return a;
  }

  /** Add or refresh a buff (same key = refresh, keeping the strongest duration). */
  addBuff(u: Unit, b: Buff) {
    const i = u.buffs.findIndex((x) => x.key === b.key);
    if (i >= 0) u.buffs[i] = { ...b, t: Math.max(b.t, u.buffs[i].t) };
    else u.buffs.push(b);
  }

  stun(u: Unit, seconds: number) {
    if (!u.alive || u.kind === 'structure') return;
    u.stunTimer = Math.max(u.stunTimer, seconds);
    u.dash = null;
  }

  heal(u: Unit, amount: number) {
    if (!u.alive) return;
    u.hp = Math.min(u.maxHp, u.hp + amount);
  }

  newId() {
    return this.nextId++;
  }

  /** Mobile "attack button" targeting: enemy hero first, then nearest anything. */
  pickAutoTarget(u: Unit): Unit | undefined {
    const reach = Math.max(u.attackRange + 4, 8);
    const seen = (e: Unit) => this.canSee(u.team, e);
    const near = this.enemiesNear(u, u.x, u.y, reach, seen);
    const byDist = (a: Unit, b: Unit) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y);
    const heroes = near.filter((e) => e.kind === 'hero').sort(byDist);
    if (heroes.length) return heroes[0];
    if (near.length) return near.sort(byDist)[0];
    return this.enemiesNear(u, u.x, u.y, 14, seen).sort(byDist)[0];
  }

  // ---------------------------------------------------------------- spawning

  private newUnit(kind: UnitKind, team: Side, pos: Vec2, s: CombatStats): Unit {
    const u: Unit = {
      id: this.nextId++,
      kind,
      team,
      x: pos.x,
      y: pos.y,
      px: pos.x,
      py: pos.y,
      radius: s.radius,
      alive: true,
      hp: s.hp,
      maxHp: s.hp,
      hpRegen: 0,
      mana: 0,
      maxMana: 0,
      manaRegen: 0,
      armor: s.armor,
      damage: s.damage,
      attackInterval: s.attackInterval,
      attackRange: s.attackRange,
      attackTimer: 0,
      projectileSpeed: s.projectileSpeed,
      moveSpeed: s.moveSpeed,
      acquireRange: s.acquireRange,
      bountyGold: s.bountyGold,
      bountyXp: s.bountyXp,
      visionDay: s.vision?.[0] ?? 0,
      visionNight: s.vision?.[1] ?? 0,
      targetId: null,
      facing: team === 0 ? -Math.PI / 4 : (3 * Math.PI) / 4,
      path: null,
      pathGoal: null,
      repathAt: 0,
      avoidSide: 0,
      stunTimer: 0,
      castLock: 0,
      buffs: [],
      dash: null,
    };
    this.units.push(u);
    this.byId.set(u.id, u);
    return u;
  }

  private spawnStructure(team: Team, tier: StructureTier, lane: LaneId | null, pos: Vec2) {
    const u = this.newUnit('structure', team, pos, STRUCTURES[tier]);
    u.structure = { tier, lane, vulnerable: true, aggroId: null, aggroTimer: 0 };
  }

  private spawnHero(slot: PlayerSlot, index: number) {
    const def = HEROES[slot.heroId];
    const u = this.newUnit('hero', slot.team, this.respawnPoint(slot.team, index), {
      hp: def.baseHp,
      armor: def.baseArmor,
      damage: def.baseDamage,
      attackInterval: def.attackInterval,
      attackRange: def.attackRange,
      projectileSpeed: def.projectileSpeed,
      moveSpeed: def.moveSpeed,
      radius: 1,
      acquireRange: Math.max(def.attackRange + 2, 6),
      bountyGold: 0,
      bountyXp: 0,
      vision: HERO_VISION,
    });
    u.hero = {
      defId: slot.heroId,
      controller: slot.controller,
      slot: index,
      lane: slot.lane,
      level: 1,
      xp: 0,
      gold: STARTING_GOLD,
      kills: 0,
      deaths: 0,
      lastHits: 0,
      respawnTimer: 0,
      order: { type: 'idle' },
      abilities: [0, 1, 2].map(() => ({ level: 0, cooldown: 0 })),
      skillPoints: 1,
      attackCount: 0,
      items: emptyInventory(),
      tpCount: 0,
      tpCooldown: 0,
      channel: null,
      bonus: itemBonuses([]),
      bot: { thinkTimer: (index % 6) * 0.05, retreating: false, buildIndex: 0 },
    };
    this.applyHeroStats(u, true);
  }

  respawnPoint(team: Team, index: number): Vec2 {
    const f = this.map.fountains[team];
    const a = (index % 3) * ((2 * Math.PI) / 3);
    const dir = team === 0 ? 1 : -1;
    return { x: f.x + dir * (5 + Math.cos(a) * 1.5), y: f.y - dir * (5 + Math.sin(a) * 1.5) };
  }

  /** Recompute hero stats from definition + level + items. */
  applyHeroStats(u: Unit, fill = false) {
    const h = u.hero!;
    const def = HEROES[h.defId];
    const lv = h.level - 1;
    const b = (h.bonus = itemBonuses(h.items));
    const oldMax = u.maxHp;
    const oldMana = u.maxMana;
    u.maxHp = def.baseHp + def.hpPerLevel * lv + b.hp;
    u.maxMana = def.baseMana + def.manaPerLevel * lv + b.mana;
    u.hpRegen = def.hpRegen + 0.15 * lv + b.hpRegen;
    u.manaRegen = def.manaRegen + 0.1 * lv + b.manaRegen;
    u.armor = def.baseArmor + def.armorPerLevel * lv + b.armor;
    u.damage = def.baseDamage + def.damagePerLevel * lv + b.damage;
    u.attackInterval = Math.max(0.45, (def.attackInterval - def.attackIntervalPerLevel * lv) / (1 + b.attackSpeedPct / 100));
    u.moveSpeed = def.moveSpeed * (1 + b.moveSpeedPct / 100);
    if (fill) {
      u.hp = u.maxHp;
      u.mana = u.maxMana;
    } else {
      u.hp = Math.min(u.maxHp, Math.max(1, u.hp + u.maxHp - oldMax));
      u.mana = Math.min(u.maxMana, Math.max(0, u.mana + u.maxMana - oldMana));
    }
  }

  /** Jungle camps: refill every empty camp on the minute. */
  private spawnCamps() {
    this.map.camps.forEach((c, camp) => {
      if (this.units.some((u) => u.neutral?.camp === camp && u.alive)) return;
      const pack: ['brute' | 'imp', number, number][] = [
        ['brute', 0, 0],
        ['imp', 1.8, 1.2],
        ['imp', -1.6, 1.4],
      ];
      for (const [kind, ox, oy] of pack) {
        const u = this.newUnit('neutral', 2, { x: c.x + ox, y: c.y + oy }, NEUTRALS[kind]);
        u.neutral = { camp, homeX: u.x, homeY: u.y };
      }
    });
  }

  private spawnWave() {
    for (const team of [0, 1] as Team[]) {
      for (const lane of ['top', 'mid', 'bot'] as LaneId[]) {
        const path = teamLanePath(this.map, team, lane);
        const enemyRaxDown = this.findStructure(otherTeam(team), 'barracks', lane).some((r) => !r.alive);
        const start = path[0];
        const dx = path[1].x - start.x;
        const dy = path[1].y - start.y;
        const l = Math.hypot(dx, dy);
        const types: ('melee' | 'ranged')[] = [
          ...Array<'melee'>(MELEE_PER_WAVE).fill('melee'),
          ...Array<'ranged'>(RANGED_PER_WAVE).fill('ranged'),
        ];
        types.forEach((type, i) => {
          const back = i * 1.8;
          const side = ((i % 2) * 2 - 1) * 1.2;
          const pos = {
            x: start.x - (dx / l) * back + (-dy / l) * side,
            y: start.y - (dy / l) * back + (dx / l) * side,
          };
          const u = this.newUnit('creep', team, pos, CREEPS[type]);
          if (enemyRaxDown) {
            u.maxHp = u.hp = Math.round(u.hp * SUPER_CREEP_MULT.hp);
            u.damage = Math.round(u.damage * SUPER_CREEP_MULT.damage);
            u.bountyGold = Math.round(u.bountyGold * SUPER_CREEP_MULT.gold);
          }
          u.creep = { type, lane, path, wp: 1, super: enemyRaxDown };
          u.facing = Math.atan2(dy, dx);
        });
      }
    }
  }

  // ---------------------------------------------------------------- main step

  step() {
    this.events = [];
    if (this.winner !== null) return;
    this.tick++;
    this.time += DT;

    for (const u of this.units) {
      u.px = u.x;
      u.py = u.y;
    }
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
    }

    for (const c of this.pending) this.applyCommand(c);
    this.pending.length = 0;

    if (this.time >= this.nextWave) {
      this.spawnWave();
      this.nextWave += CREEP_WAVE_INTERVAL;
    }

    if (this.time >= this.nextCampSpawn) {
      this.spawnCamps();
      this.nextCampSpawn += CAMP_RESPAWN;
    }

    for (const u of this.units) {
      if (u.attackTimer > 0) u.attackTimer -= DT;
      if (u.hero) this.updateHeroUpkeep(u);
      if (u.alive) this.updateStatus(u);
    }
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.dash) {
        this.updateDash(u);
        continue;
      }
      if (u.hero?.channel && updateChannel(this, u, DT)) continue;
      if (u.stunTimer > 0 || u.castLock > 0) continue;
      if (u.hero) {
        if (u.hero.controller === 'bot') {
          u.hero.bot.thinkTimer -= DT;
          if (u.hero.bot.thinkTimer <= 0) {
            u.hero.bot.thinkTimer = 0.25;
            botThink(this, u);
          }
        }
        this.updateHero(u);
      } else if (u.creep) this.updateCreep(u);
      else if (u.neutral) this.updateNeutral(u);
      else if (u.structure) this.updateStructure(u);
    }
    this.updateProjectiles();
    this.updateSkillshots();
    this.updateAreas();
    this.separate();
    if (this.tick % Math.round(1 / (DT * VISION_HZ)) === 0) this.vision.update(this);

    // Drop dead creeps; heroes respawn and structures stay as ruins.
    this.units = this.units.filter((u) => {
      if ((u.kind === 'creep' || u.kind === 'neutral') && !u.alive) {
        this.byId.delete(u.id);
        return false;
      }
      return true;
    });
  }

  private updateHeroUpkeep(u: Unit) {
    const h = u.hero!;
    h.gold += PASSIVE_GOLD_PER_SEC * DT;
    for (const a of h.abilities) if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - DT);
    if (h.tpCooldown > 0) h.tpCooldown = Math.max(0, h.tpCooldown - DT);
    if (!u.alive) {
      h.respawnTimer -= DT;
      if (h.respawnTimer <= 0) {
        const p = this.respawnPoint(u.team as Team, h.slot);
        u.x = u.px = p.x;
        u.y = u.py = p.y;
        u.alive = true;
        u.hp = u.maxHp;
        u.mana = u.maxMana;
        u.path = null;
        u.buffs = [];
        u.stunTimer = 0;
        u.castLock = 0;
        u.dash = null;
        h.order = { type: 'idle' };
        h.bot.retreating = false;
      }
      return;
    }
    const f = this.map.fountains[u.team as Team];
    const inFountain = dist(u.x, u.y, f.x, f.y) < FOUNTAIN_HEAL_RADIUS;
    const hpRegen = u.hpRegen + (inFountain ? u.maxHp * 0.1 : 0);
    const manaRegen = u.manaRegen + (inFountain ? u.maxMana * 0.1 : 0);
    u.hp = Math.min(u.maxHp, u.hp + hpRegen * DT);
    u.mana = Math.min(u.maxMana, u.mana + manaRegen * DT);
  }

  private updateHero(u: Unit) {
    const h = u.hero!;
    const o = h.order;
    switch (o.type) {
      case 'dir':
        this.stepMove(u, o.dx, o.dy, this.speedOf(u) * DT);
        u.targetId = null;
        break;
      case 'move':
        if (this.navigate(u, o.x, o.y, 0.3)) h.order = { type: 'idle' };
        u.targetId = null;
        break;
      case 'attack': {
        const t = this.unit(o.targetId);
        if (!this.canAttack(u, t)) {
          h.order = { type: 'idle' };
          break;
        }
        u.targetId = t.id;
        if (!this.tryAttack(u, t)) this.navigate(u, t.x, t.y, 0);
        break;
      }
      case 'cast': {
        const r = resolveCast(this, u, o);
        if (r !== 'approach') h.order = { type: 'idle' };
        break;
      }
      case 'idle': {
        // Auto-attack anything already in range, without chasing.
        let t = this.unit(u.targetId);
        if (!this.canAttack(u, t) || !this.inReach(u, t)) {
          t = this.enemiesNear(u, u.x, u.y, u.attackRange + u.radius + 0.3, (e) => e.kind !== 'neutral' && this.canSee(u.team, e)).sort(
            (a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y),
          )[0];
        }
        u.targetId = t ? t.id : null;
        if (t) this.tryAttack(u, t);
        break;
      }
    }
  }

  private updateCreep(u: Unit) {
    const c = u.creep!;
    let t = this.unit(u.targetId);
    if (!this.canAttack(u, t) || dist(u.x, u.y, t.x, t.y) > u.acquireRange + 4) t = undefined;
    if (!t) {
      t = this.enemiesNear(u, u.x, u.y, u.acquireRange, (e) => e.kind !== 'neutral').sort(
        (a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y),
      )[0];
    }
    u.targetId = t ? t.id : null;
    if (t) {
      if (!this.tryAttack(u, t)) this.steerTo(u, t.x, t.y);
      return;
    }
    // March along the lane.
    while (c.wp < c.path.length && dist(u.x, u.y, c.path[c.wp].x, c.path[c.wp].y) < 2.5) c.wp++;
    if (c.wp >= c.path.length) return;
    const wp = c.path[c.wp];
    this.steerTo(u, wp.x, wp.y);
  }

  private updateStructure(u: Unit) {
    const s = u.structure!;
    if (u.attackInterval <= 0) return;
    if (s.aggroTimer > 0) s.aggroTimer -= DT;
    let t = this.unit(u.targetId);
    const aggro = this.unit(s.aggroId);
    if (s.aggroTimer > 0 && this.canAttack(u, aggro) && this.inReach(u, aggro)) t = aggro;
    if (!this.canAttack(u, t) || !this.inReach(u, t)) {
      const near = this.enemiesNear(u, u.x, u.y, u.attackRange + u.radius, (e) => e.kind !== 'structure' && e.kind !== 'neutral');
      const byDist = (a: Unit, b: Unit) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y);
      // Towers prefer creeps; heroes are hit when alone or when they attack an allied hero.
      t = near.filter((e) => e.kind === 'creep').sort(byDist)[0] ?? near.sort(byDist)[0];
    }
    u.targetId = t ? t.id : null;
    if (t) this.tryAttack(u, t);
  }

  /** Neutrals idle at camp; when attacked they fight back, but never stray far from home. */
  private updateNeutral(u: Unit) {
    const n = u.neutral!;
    const home = dist(u.x, u.y, n.homeX, n.homeY);
    let t = this.unit(u.targetId);
    if (t && (!t.alive || home > NEUTRAL_LEASH || dist(t.x, t.y, n.homeX, n.homeY) > NEUTRAL_LEASH + 3)) {
      u.targetId = null;
      t = undefined;
    }
    if (t) {
      if (!this.tryAttack(u, t)) this.steerTo(u, t.x, t.y);
      return;
    }
    if (home > 0.3) this.steerTo(u, n.homeX, n.homeY);
    else u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.1 * DT); // regenerate quickly at camp
  }

  private updateProjectiles() {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const t = this.unit(p.targetId);
      if (!t || !t.alive) continue;
      const d = dist(p.x, p.y, t.x, t.y);
      const step = p.speed * DT;
      if (d <= step + t.radius * 0.5) {
        if (p.spell) {
          for (const e of this.units) {
            if (e.alive && e.team !== p.team && e.kind !== 'structure' && dist(e.x, e.y, t.x, t.y) <= p.spell.aoe + e.radius) {
              this.dealDamage(p.sourceId, e, p.damage, 'spell');
            }
          }
        } else this.dealDamage(p.sourceId, t, p.damage, 'attack');
        continue;
      }
      p.x += ((t.x - p.x) / d) * step;
      p.y += ((t.y - p.y) / d) * step;
      keep.push(p);
    }
    this.projectiles = keep;
  }

  // ---------------------------------------------------------------- status & spells

  private updateStatus(u: Unit) {
    if (u.stunTimer > 0) u.stunTimer = Math.max(0, u.stunTimer - DT);
    if (u.castLock > 0) u.castLock = Math.max(0, u.castLock - DT);
    if (!u.buffs.length) return;
    for (const b of u.buffs) {
      b.t -= DT;
      if (b.healPerSec) {
        this.heal(u, b.healPerSec * DT);
      }
      if (b.damagePerSec && b.sourceId !== undefined) this.dealDamage(b.sourceId, u, b.damagePerSec * DT, 'spell');
      if (!u.alive) return;
    }
    u.buffs = u.buffs.filter((b) => b.t > 0);
  }

  private updateDash(u: Unit) {
    const d = u.dash!;
    const step = Math.min(d.remaining, d.speed * DT);
    const bx = u.x;
    const by = u.y;
    this.stepMove(u, d.dx, d.dy, step);
    const moved = Math.hypot(u.x - bx, u.y - by);
    d.remaining -= step;
    for (const e of this.units) {
      if (!e.alive || e.team === u.team || e.kind === 'structure' || d.hit.includes(e.id)) continue;
      if (dist(u.x, u.y, e.x, e.y) > u.radius + e.radius + 0.6) continue;
      d.hit.push(e.id);
      this.dealDamage(u.id, e, d.damage, 'spell');
      if (e.kind === 'hero') {
        this.stun(e, d.stun);
        u.dash = null;
        u.hero!.order = { type: 'attack', targetId: e.id };
        return;
      }
    }
    if (d.remaining <= 0 || moved < step * 0.3) u.dash = null;
  }

  private updateSkillshots() {
    const keep: Skillshot[] = [];
    for (const s of this.skillshots) {
      s.px = s.x;
      s.py = s.y;
      const step = Math.min(s.remaining, s.speed * DT);
      s.x += s.dx * step;
      s.y += s.dy * step;
      s.remaining -= step;
      let exploded = false;
      for (const e of this.units) {
        if (!e.alive || e.team === s.team || e.kind === 'structure' || s.hit.includes(e.id)) continue;
        if (distToSeg(e.x, e.y, s.px, s.py, s.x, s.y) > s.width / 2 + e.radius) continue;
        if (s.explode) {
          s.x = e.x;
          s.y = e.y;
          exploded = true;
          break;
        }
        s.hit.push(e.id);
        this.dealDamage(s.sourceId, e, s.damage, 'spell');
      }
      if (s.explode && (exploded || s.remaining <= 0)) {
        for (const e of this.units) {
          if (e.alive && e.team !== s.team && e.kind !== 'structure' && dist(e.x, e.y, s.x, s.y) <= s.explode + e.radius) {
            this.dealDamage(s.sourceId, e, s.damage, 'spell');
          }
        }
        this.events.push({ type: 'explosion', x: s.x, y: s.y, radius: s.explode });
        continue;
      }
      if (s.remaining > 0) keep.push(s);
    }
    this.skillshots = keep;
  }

  private updateAreas() {
    for (const z of this.zones) {
      z.t += DT;
      for (const e of this.units) {
        if (!e.alive || e.team === z.team || e.kind === 'structure') continue;
        if (dist(e.x, e.y, z.x, z.y) > z.radius + e.radius) continue;
        this.dealDamage(z.sourceId, e, z.dps * DT, 'spell');
        if (z.slowPct > 0) this.addBuff(e, { key: `slow:${z.kind}`, t: 0.3, slowPct: z.slowPct });
      }
    }
    this.zones = this.zones.filter((z) => z.t < z.duration);

    const pending: Blast[] = [];
    for (const b of this.blasts) {
      b.t += DT;
      if (b.t < b.delay) {
        pending.push(b);
        continue;
      }
      for (const e of this.units) {
        if (!e.alive || e.team === b.team || e.kind === 'structure') continue;
        if (dist(e.x, e.y, b.x, b.y) > b.radius + e.radius) continue;
        this.dealDamage(b.sourceId, e, b.damage, 'spell');
        if (b.stun > 0) this.stun(e, b.stun);
      }
      if (b.burn) {
        this.zones.push({
          id: this.newId(),
          kind: 'burn',
          team: b.team,
          sourceId: b.sourceId,
          x: b.x,
          y: b.y,
          radius: b.radius,
          t: 0,
          duration: b.burn.duration,
          dps: b.burn.dps,
          slowPct: 0,
        });
      }
      this.events.push({ type: 'cast', unitId: b.sourceId, slot: -1 });
    }
    this.blasts = pending;
  }

  // ---------------------------------------------------------------- combat

  inReach(a: Unit, b: Unit): boolean {
    return dist(a.x, a.y, b.x, b.y) <= a.attackRange + a.radius + b.radius;
  }

  /** Attack if in reach (returns true), otherwise returns false so the caller can move closer. */
  private tryAttack(u: Unit, t: Unit): boolean {
    if (!this.inReach(u, t)) return false;
    u.facing = Math.atan2(t.y - u.y, t.x - u.x);
    u.path = null;
    if (u.attackTimer > 0) return true;
    u.attackTimer = u.attackInterval;
    this.events.push({ type: 'attack', sourceId: u.id, targetId: t.id });
    const damage = applyAttackPassives(this, u);
    if (u.projectileSpeed > 0) {
      this.projectiles.push({
        id: this.nextId++,
        team: u.team,
        x: u.x,
        y: u.y,
        px: u.x,
        py: u.y,
        sourceId: u.id,
        targetId: t.id,
        speed: u.projectileSpeed,
        damage,
      });
    } else {
      this.dealDamage(u.id, t, damage, 'attack');
    }
    return true;
  }

  /**
   * Attacks are reduced by armor. Spells ignore armor but cannot hurt structures.
   */
  dealDamage(sourceId: number, target: Unit, raw: number, kind: DamageKind = 'attack') {
    if (!target.alive) return;
    if (target.structure && (!target.structure.vulnerable || kind === 'spell')) return;
    const src = this.unit(sourceId);
    let amount = kind === 'attack' ? raw * armorMultiplier(this.armorOf(target)) : raw;
    if (kind === 'spell' && src?.hero) amount *= 1 + src.hero.bonus.spellAmpPct / 100;
    amount = damageAfterPassives(this, target, amount, kind);
    if (amount <= 0) return;
    target.hp -= amount;
    if (kind === 'attack' && src?.hero && src.hero.bonus.lifestealPct > 0) {
      this.heal(src, (amount * src.hero.bonus.lifestealPct) / 100);
    }
    // Wake the whole camp when a neutral is hit.
    if (target.neutral && src && src.team !== 2) {
      for (const n of this.units) {
        if (n.neutral?.camp === target.neutral.camp && n.alive && n.targetId === null) n.targetId = src.id;
      }
    }

    // Towers punish heroes that attack heroes under them.
    if (src && src.kind === 'hero' && target.kind === 'hero') {
      for (const tw of this.units) {
        if (!tw.structure || !tw.alive || tw.team !== target.team || tw.attackInterval <= 0) continue;
        if (this.inReach(tw, src)) {
          tw.structure.aggroId = src.id;
          tw.structure.aggroTimer = 2;
        }
      }
    }
    if (target.hp <= 0) this.kill(target, src);
  }

  private kill(u: Unit, killer: Unit | undefined) {
    u.hp = 0;
    u.alive = false;
    u.targetId = null;
    u.path = null;
    u.dash = null;
    u.buffs = [];
    u.stunTimer = 0;
    u.castLock = 0;
    this.events.push({ type: 'death', unitId: u.id, killerId: killer?.id ?? null });
    const killerHero = killer?.kind === 'hero' && killer.team !== u.team ? killer : undefined;

    if (u.hero) {
      const h = u.hero;
      h.deaths++;
      h.respawnTimer = 4 + h.level * 2;
      h.order = { type: 'idle' };
      this.teamKills[otherTeam(u.team as Team)]++;
      if (killerHero) {
        killerHero.hero!.kills++;
        this.giveGold(killerHero, 150 + h.level * 10);
      }
      this.shareXp(u, 100 + h.level * 25);
    } else if (u.creep) {
      if (killerHero) {
        killerHero.hero!.lastHits++;
        this.giveGold(killerHero, u.bountyGold);
      }
      this.shareXp(u, u.bountyXp);
    } else if (u.neutral) {
      if (killerHero) {
        killerHero.hero!.lastHits++;
        this.giveGold(killerHero, u.bountyGold);
        this.shareXp(u, u.bountyXp, killerHero.team);
      }
    } else if (u.structure) {
      const tier = u.structure.tier;
      for (const h of this.units) {
        if (h.hero && h.team !== u.team) this.giveGold(h, STRUCTURES[tier].teamGold);
      }
      this.refreshVulnerability();
      this.rebuildNav();
      if (tier === 'shrine') {
        this.winner = otherTeam(u.team as Team);
        this.events.push({ type: 'gameOver', winner: this.winner });
      }
    }
  }

  private giveGold(h: Unit, amount: number) {
    h.hero!.gold += amount;
    this.events.push({ type: 'gold', unitId: h.id, amount });
  }

  private shareXp(dead: Unit, amount: number, toTeam?: Side) {
    const receivers = this.units.filter(
      (h) =>
        h.hero &&
        h.alive &&
        (toTeam === undefined ? h.team !== dead.team : h.team === toTeam) &&
        dist(h.x, h.y, dead.x, dead.y) <= XP_SHARE_RADIUS,
    );
    if (!receivers.length) return;
    const each = amount / receivers.length;
    for (const r of receivers) this.giveXp(r, each);
  }

  giveXp(u: Unit, amount: number) {
    const h = u.hero!;
    h.xp += amount;
    while (h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level]) {
      h.level++;
      h.skillPoints++;
      this.applyHeroStats(u);
      this.events.push({ type: 'levelUp', unitId: u.id, level: h.level });
    }
  }

  /**
   * Structure protection rules (Dota-style):
   *  - Tier 1 towers: always attackable.
   *  - Tier 2 tower + barracks of a lane: after that lane's tier 1 falls.
   *  - The two shrine towers: after any barracks of that team falls.
   *  - Shrine: after both shrine towers fall.
   *  - Fountain: never.
   */
  refreshVulnerability() {
    for (const s of this.units) {
      if (!s.structure) continue;
      const st = s.structure;
      switch (st.tier) {
        case 'tower1':
          st.vulnerable = true;
          break;
        case 'tower2':
        case 'barracks':
          st.vulnerable = this.findStructure(s.team, 'tower1', st.lane).every((t) => !t.alive);
          break;
        case 'shrineTower':
          st.vulnerable = this.findStructure(s.team, 'barracks').some((r) => !r.alive);
          break;
        case 'shrine':
          st.vulnerable = this.findStructure(s.team, 'shrineTower').every((t) => !t.alive);
          break;
        case 'fountain':
          st.vulnerable = false;
          break;
      }
    }
  }

  // ---------------------------------------------------------------- movement

  /** Standing structures are solid: carve their footprints out of the nav grid. */
  rebuildNav() {
    const m = this.map;
    const g = m.grid;
    this.nav.walkable.set(m.walkable);
    for (const s of this.units) {
      if (!s.structure || !s.alive) continue;
      const r = s.radius + 0.4;
      const c0 = Math.max(0, Math.floor((s.x - r) / m.cell));
      const c1 = Math.min(g - 1, Math.floor((s.x + r) / m.cell));
      const r0 = Math.max(0, Math.floor((s.y - r) / m.cell));
      const r1 = Math.min(g - 1, Math.floor((s.y + r) / m.cell));
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          if (dist((cx + 0.5) * m.cell, (cy + 0.5) * m.cell, s.x, s.y) <= r) this.nav.walkable[cy * g + cx] = 0;
        }
      }
    }
  }

  /**
   * Move up to `d` meters in direction (dx, dy), sliding along walls.
   * `avoid` bends straight-line movers (creeps) around structures; path-followers
   * don't need it because the nav grid already routes around them.
   */
  stepMove(u: Unit, dx: number, dy: number, d: number, avoid = false) {
    const l = Math.hypot(dx, dy);
    if (l === 0 || d <= 0) return;
    dx /= l;
    dy /= l;
    if (avoid) [dx, dy] = this.avoidStructures(u, dx, dy);
    u.facing = Math.atan2(dy, dx);
    const nav = this.nav;
    // If we're already squeezed against a wall/footprint, only require the centre to be
    // walkable so the unit can always work itself free.
    const ok = fits(nav, u.x, u.y, u.radius)
      ? (x: number, y: number) => fits(nav, x, y, u.radius)
      : (x: number, y: number) => isWalkable(this.map, x, y);
    const nx = u.x + dx * d;
    const ny = u.y + dy * d;
    if (ok(nx, ny)) {
      u.x = nx;
      u.y = ny;
      return;
    }
    // Slide along the wall: keep whichever axis component is free.
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (ok(nx, u.y)) u.x = nx;
      else if (ok(u.x, ny)) u.y = ny;
    } else {
      if (ok(u.x, ny)) u.y = ny;
      else if (ok(nx, u.y)) u.x = nx;
    }
  }

  /** Bend a movement direction around any living structure directly ahead. */
  private avoidStructures(u: Unit, dx: number, dy: number): [number, number] {
    let blocked = false;
    for (const s of this.units) {
      if (s.kind !== 'structure' || !s.alive) continue;
      const rx = s.x - u.x;
      const ry = s.y - u.y;
      const clearance = s.radius + u.radius + 0.3;
      const d = Math.hypot(rx, ry);
      if (d > clearance + 2.5) continue;
      const ahead = rx * dx + ry * dy;
      if (ahead <= 0) continue;
      const side = rx * dy - ry * dx; // perpendicular offset of the obstacle from our heading
      if (Math.abs(side) >= clearance) continue;
      // Steer along a tangent; keep the same side until clear (no jitter).
      blocked = true;
      if (u.avoidSide === 0) u.avoidSide = side >= 0 ? 1 : -1;
      const sgn = u.avoidSide;
      const tx = (-ry / d) * sgn;
      const ty = (rx / d) * sgn;
      return [tx, ty];
    }
    if (!blocked) u.avoidSide = 0;
    return [dx, dy];
  }

  /** Straight-line steering (used by creeps, which live in open lanes). */
  private steerTo(u: Unit, x: number, y: number) {
    const d = dist(u.x, u.y, x, y);
    if (d < 0.05) return;
    this.stepMove(u, x - u.x, y - u.y, Math.min(d, this.speedOf(u) * DT), true);
  }

  /** Path-following movement (heroes). Returns true on arrival. */
  navigate(u: Unit, x: number, y: number, arriveDist: number): boolean {
    const d = dist(u.x, u.y, x, y);
    if (d <= arriveDist + 0.05) {
      u.path = null;
      return true;
    }
    const step = this.speedOf(u) * DT;
    if (lineClear(this.nav, u, { x, y }, u.radius * 0.7)) {
      u.path = null;
      this.stepMove(u, x - u.x, y - u.y, Math.min(step, d));
      return false;
    }
    if (!u.path || !u.pathGoal || distV(u.pathGoal, { x, y }) > 2 || this.time >= u.repathAt) {
      u.path = findPath(this.nav, u, { x, y }, u.radius * 0.7);
      u.pathGoal = { x, y };
      u.repathAt = this.time + 1;
    }
    if (!u.path) {
      this.stepMove(u, x - u.x, y - u.y, Math.min(step, d));
      return false;
    }
    if (u.path.length === 0) {
      // Already at the closest reachable spot (goal is inside a wall or structure).
      u.path = null;
      return true;
    }
    let next = u.path[0];
    while (u.path.length > 1 && dist(u.x, u.y, next.x, next.y) < 0.6) {
      u.path.shift();
      next = u.path[0];
    }
    this.stepMove(u, next.x - u.x, next.y - u.y, Math.min(step, dist(u.x, u.y, next.x, next.y)));
    return false;
  }

  /** Soft collision between moving bodies; hard collision against structures. */
  private separate() {
    const movers = this.units.filter((u) => u.alive && u.kind !== 'structure');
    const solids = this.units.filter((u) => u.alive && u.kind === 'structure');
    for (let i = 0; i < movers.length; i++) {
      const a = movers[i];
      for (let j = i + 1; j < movers.length; j++) {
        const b = movers[j];
        // Jungle monsters only bump into each other, so they never wall off a corridor.
        if ((a.kind === 'neutral') !== (b.kind === 'neutral')) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.radius + b.radius) * 0.9;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * 0.5;
        const nx = d2 === 0 ? 1 : dx / d;
        const ny = d2 === 0 ? 0 : dy / d;
        this.nudge(a, -nx * push, -ny * push);
        this.nudge(b, nx * push, ny * push);
      }
      for (const s of solids) {
        const dx = a.x - s.x;
        const dy = a.y - s.y;
        const min = a.radius + s.radius;
        const d = Math.hypot(dx, dy);
        if (d >= min || d === 0) continue;
        this.nudge(a, (dx / d) * (min - d), (dy / d) * (min - d));
      }
    }
  }

  private nudge(u: Unit, dx: number, dy: number) {
    if (fits(this.map, u.x + dx, u.y + dy, u.radius)) {
      u.x += dx;
      u.y += dy;
    }
  }

}
