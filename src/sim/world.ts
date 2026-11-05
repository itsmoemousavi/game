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
  DEATH_GOLD,
  MULTI_KILL_WINDOW,
  UPHILL_MISS_CHANCE,
  CREEP_GROWTH_PER_5MIN,
  CHARM_DURATION,
  DENY_CREEP,
  DENY_TOWER,
  DENY_XP_SHARE,
  BACKDOOR_DAMAGE_MULT,
  BOSS_RESPAWN,
  REVIVE_DELAY,
  RUNE_FIRST,
  CAMP_RESPAWN,
  NEUTRAL_LEASH,
  WARDEN_GOLD,
  WARDEN_LEASH,
  WARDEN_SLAM,
  Side,
  Team,
  VISION_HZ,
  XP_SHARE_RADIUS,
  XP_TABLE,
  otherTeam,
} from './constants';
import { HEROES, HeroId, maxAbilityLevel } from './data/heroes';
import { BARRACKS, CREEPS, CombatStats, HERO_VISION, MEGA_CREEP_MULT, NEUTRALS, STRUCTURES, SUPER_CREEP_MULT } from './data/units';
import { ITEMS, ItemId, ItemStats, TELEPORT } from './data/items';
import { GroundItem, ItemSlot, charmSlot, updateItemAuras, buyItem, buyTeleport, dropItem, emptyInventory, expireGroundItems, itemBonuses, pickUpItem, sellCourierItem, sellItem, startTeleport, swapItems, updateChannel, useItem } from './inventory';
import { CourierState, courierGround, dropCourierItem, newCourier, sendCourier, updateCouriers } from './courier';
import { Vision, isInvisible } from './vision';
import { Rune, activateGlyph, buyback, onHillTop, placeWard, spawnBoss, updateObjectives } from './objectives';
import { GameMap, LaneId, StructureTier, createMap, fits, heightAt, inHouse, isWalkable, lineClear, teamLanePath } from './map';
import { Vec2, dist, distV } from './math';

const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / l2));
  return dist(px, py, ax + abx * t, ay + aby * t);
};
import { cellCenter, findPath, nearestWalkableCell } from './pathfinding';
import { Rng } from './rng';
import { BOT_THINK_INTERVAL, BotDifficulty, botThink, botWhileDead } from './ai/bots';
import { applyAttackPassives, botLearn, castAbility, damageAfterPassives, passiveArmor, resolveCast } from './abilities';

export type UnitKind = 'hero' | 'creep' | 'neutral' | 'structure' | 'ward';
export type Controller = 'human' | 'bot';

export type Order =
  | { type: 'idle' }
  | { type: 'dir'; dx: number; dy: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'attack'; targetId: number; leash?: boolean; reached?: boolean }
  | { type: 'attackOnce'; targetId: number }
  | { type: 'cast'; slot: number; targetId?: number; x?: number; y?: number }
  | { type: 'ward'; slot: number; x: number; y: number }
  | { type: 'pickUp'; groundId: number };

/** Every way a player (human or bot, local or remote) can influence the game. */
export type Command =
  | { type: 'moveDir'; unitId: number; dx: number; dy: number }
  | { type: 'moveTo'; unitId: number; x: number; y: number }
  | { type: 'attack'; unitId: number; targetId: number; priority?: boolean }
  | { type: 'attackNearest'; unitId: number }
  /**
   * Attack button held (mobile): while steering (joystick or a walk order), hit the best enemy
   * in reach on the move. Holding it while standing still only aims (the client picks the target
   * and sends 'attack' on release), so nothing is attacked before the player lets go.
   */
  /** One attack (auto attack off, and every deny): the nearest target if none is given. Ignored while the attack is cooling down. */
  | { type: 'attackOnce'; unitId: number; targetId?: number }
  /** Cancel a teleport in progress (the X on the teleport slot). */
  | { type: 'cancelChannel'; unitId: number }
  /** Player setting: automatically attack enemies that come into range while idle. */
  | { type: 'setAutoAttack'; unitId: number; enabled: boolean }
  /** Player setting: spend skill points automatically (ultimate first). */
  | { type: 'setAutoLearn'; unitId: number; enabled: boolean }
  /** Give up: the other team wins. */
  | { type: 'surrender'; unitId: number }
  /** Team ping on the map (bots on your team react to it). */
  | { type: 'ping'; unitId: number; kind: PingKind; x: number; y: number }
  | { type: 'stop'; unitId: number }
  /** Use ability `slot` (0 = Q, 1 = W, 2 = R). Give targetId for unit-target abilities, x/y otherwise. */
  | { type: 'cast'; unitId: number; slot: number; targetId?: number; x?: number; y?: number }
  /** Spend a skill point on ability `slot`. */
  | { type: 'learn'; unitId: number; slot: number }
  /** Shop (only near your fountain). */
  | { type: 'buy'; unitId: number; itemId: ItemId }
  | { type: 'sell'; unitId: number; slot: number }
  | { type: 'buyTp'; unitId: number }
  /** Send your courier with its items (it fetches anything waiting at the base first). */
  | { type: 'courier'; unitId: number }
  /** Sell / drop an item from a courier slot. */
  | { type: 'sellCourier'; unitId: number; slot: number }
  | { type: 'dropCourier'; unitId: number; slot: number }
  /** Re-order: swap two inventory slots, or two courier slots. */
  | { type: 'swapItems'; unitId: number; courier: boolean; a: number; b: number }
  /** Use the item in inventory slot `slot` (consumables, items with a button; blink takes x/y). */
  | { type: 'useItem'; unitId: number; slot: number; x?: number; y?: number }
  /** Channel a teleport to an allied building. Moving or being stunned cancels it. */
  | { type: 'teleport'; unitId: number; targetId: number }
  /** Place the ward in inventory slot `slot` at (x, y); walks into range first. */
  | { type: 'placeWard'; unitId: number; slot: number; x: number; y: number }
  /** Pay gold to respawn immediately (while dead). */
  | { type: 'buyback'; unitId: number }
  /** Drop the item in `slot` on the ground in front of the hero. */
  | { type: 'dropItem'; unitId: number; slot: number }
  /** Pick up a dropped item (walks there first). Only your own items, or an ally's wards. */
  | { type: 'pickUp'; unitId: number; groundId: number }
  /** Team tower shield: every allied building invulnerable for a few seconds. */
  | { type: 'glyph'; unitId: number };

export interface AbilityState {
  level: number;
  cooldown: number;
}

/** Sunder Pike: how long the lowered armor lasts. Storm Blade: lightning damage and how far it jumps. */
const SUNDER_SECONDS = 4;
/** A single attack tap this close to the swing being ready still counts (fingers aren't perfect). */
const ONCE_GRACE = 0.1;
/** Morra's wolves: how far they stray from her. Red Wolf: her reach while she's melee. */
const SUMMON_LEASH = 14;
const ATTACK_TOWER_REVEAL = 3;
const SUMMON_BUILDING_MULT = 0.5;
const WOLF_FORM_RANGE = 1.6;
/** Rhen's Bolt Storm: one bolt this often, at enemies within this range. */
const BOLT_EVERY = 0.28;
const BOLT_RADIUS = 11;
const CHAIN_DAMAGE = 80;
const CHAIN_RADIUS = 7;

/** Timed effect on a unit (slows, speed boosts, heals/damage over time...). */
export interface Buff {
  key: string;
  t: number;
  sourceId?: number;
  slowPct?: number;
  moveSpeedPct?: number;
  armor?: number;
  healPerSec?: number;
  manaPerSec?: number;
  damagePerSec?: number;
  /** Attack damage multiplier (double damage power-up). */
  damageMult?: number;
  /** Invisible until it expires or the unit attacks / casts. */
  invisible?: boolean;
  /** Immune to abilities: no spell damage, stuns or slows. */
  spellImmune?: boolean;
  /** Can't cast abilities (items still work). */
  silenced?: boolean;
  /** Soaks up this much damage of any kind, then it's gone (Aegis). */
  absorb?: number;
  /** +% attack speed while it lasts. */
  attackSpeedPct?: number;
  /** Extra chance (%) of a critical hit, on top of items (Red Wolf). */
  critChance?: number;
  /** Extra attack damage while it lasts (Red Wolf). */
  formDamage?: number;
  /** Fires a bolt at a nearby enemy every BOLT_EVERY seconds (Bolt Storm). */
  boltDamage?: number;
  boltTimer?: number;
}

/** Lingering ground area that ticks damage / slow on enemies inside (Arrow Storm, burning ground). */
export interface Zone {
  id: number;
  kind: 'arrowStorm' | 'burn' | 'maelstrom' | 'sanctuary';
  team: Side;
  sourceId: number;
  x: number;
  y: number;
  radius: number;
  t: number;
  duration: number;
  dps: number;
  slowPct: number;
  /** Allied heroes inside take this % less damage (Sanctuary). */
  reduction?: number;
}

/** Delayed one-shot area effect (Earthsplitter wind-up, Cataclysm meteor). */
export interface Blast {
  id: number;
  kind: 'earthsplitter' | 'cataclysm' | 'rootSnare' | 'overgrowth';
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
  kind: 'piercingArrow' | 'fireball' | 'tidalWave' | 'rebuke';
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
  /** Slow applied to everything hit. */
  slow?: { pct: number; t: number };
}

export interface Dash {
  dx: number;
  dy: number;
  speed: number;
  remaining: number;
  damage: number;
  stun: number;
  hit: number[];
  /** Passes through everything without hitting (Gale Step). */
  phase?: boolean;
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
  assists: number;
  lastHits: number;
  /** Who last hurt this hero, and when (their wolves turn on that unit). */
  lastHurtBy: number | null;
  lastHurtAt: number;
  denies: number;
  hadTeleportBoots?: boolean;
  /** Morra is the Red Wolf right now. */
  wolfForm?: boolean;
  /** All gold earned this match (for gold-per-minute). */
  goldEarned: number;
  /** Hero kills since this hero last died. */
  streak: number;
  lastPingAt: number;
  /** Kills in quick succession (multi-kills) and when the last one happened. */
  multi: number;
  lastKillAt: number;
  /** End-of-match stats. */
  stats: { heroDamage: number; buildingDamage: number; healing: number; damageTaken: number };
  /** Auto-attack enemies in range while idle (player setting). */
  autoAttack: boolean;
  /** Spend skill points automatically (player setting). */
  autoLearn: boolean;
  /** Whether the last attack was a critical hit. */
  lastCrit: boolean;
  /** Enemy heroes that recently damaged this hero (for assists): heroId → time. */
  damagedBy: Map<number, number>;
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
  /** This hero's courier and its 3 slots. */
  courier: CourierState;
  tpCooldown: number;
  channel: { kind: 'tp'; t: number; total: number; targetId: number; x: number; y: number } | null;
  /** A spell being wound up that shows on the channel bar. */
  windup: { name: string; total: number } | null;
  /** Item bonuses currently applied (cooldown reduction, spell amp, lifesteal, ult upgrade...). */
  bonus: Required<ItemStats>;
  /** One attack queued while steering (see Command 'attackOnce'). */
  onceTarget: number | null;
  buybackCooldown: number;
  /** Set when a revive charm saves the hero: respawn here instead of the fountain. */
  reviveAt: Vec2 | null;
  bot: { thinkTimer: number; retreating: boolean; buildIndex: number; difficulty: BotDifficulty; holdBackUntil?: number };
}

export interface NeutralState {
  /** Jungle camp index, or -1 for the boss. */
  camp: number;
  homeX: number;
  homeY: number;
  boss?: boolean;
  /** The Warden is teleporting to its other house and arrives at this time. */
  moveAt?: number | null;
  /** Stays angry until this time (refreshed whenever it is hit). */
  aggroUntil: number;
  /** Warden: when its next ground slam may start. */
  nextSlam?: number;
  /** Warden: while winding up a ground slam, the time it lands. */
  slamLand?: number | null;
}

export interface WardState {
  kind: 'observer' | 'sentry';
  expires: number;
  placedAt: number;
}

export interface CreepState {
  type: 'melee' | 'ranged';
  lane: LaneId;
  path: Vec2[];
  wp: number;
  super: boolean;
  /** All enemy barracks are down: a Mega Creep. */
  mega: boolean;
}

export interface StructureState {
  tier: StructureTier;
  lane: LaneId | null;
  vulnerable: boolean;
  aggroId: number | null;
  aggroTimer: number;
  /** Seconds of team-shield invulnerability left. */
  glyph: number;
  /** No enemy creeps nearby: takes reduced damage and regenerates. */
  backdoor: boolean;
  /** Last time it was hit while backdoor-protected. */
  backdoorHitAt: number;
  /** Barracks: powers up the enemy's melee or ranged creeps when it falls. */
  rax?: 'melee' | 'ranged';
}

export interface SummonState {
  kind: 'wolf';
  ownerId: number;
  expires: number;
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
  /** Seconds of stun left: no moving, attacking or casting. */
  stunTimer: number;
  /** Attacking or casting reveals the unit (even from the fog) until this time. */
  revealUntil: number;
  /** Seconds the unit is busy casting (cannot act). */
  castLock: number;
  buffs: Buff[];
  dash: Dash | null;
  hero?: HeroState;
  creep?: CreepState;
  /** A creature called by a hero (Morra's wolves). */
  summon?: SummonState;
  /** Watches for getting nowhere; see goingAround. */
  stuckWatch?: { t: number; last: number; x: number; y: number; until: number; side: number };
  structure?: StructureState;
  neutral?: NeutralState;
  ward?: WardState;
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
  crit?: boolean;
  /** Uphill attack that will miss. */
  miss?: boolean;
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
  /** A hero started channelling a teleport to building `targetId` (everyone can see where). */
  | { type: 'teleportStart'; unitId: number; targetId: number }
  | { type: 'explosion'; x: number; y: number; radius: number }
  | { type: 'deny'; unitId: number; killerId: number }
  | { type: 'rune'; unitId: number; kind: string }
  | { type: 'buyback'; unitId: number }
  | { type: 'glyph'; team: Team }
  | { type: 'ward'; unitId: number }
  | { type: 'bossKilled'; killerId: number | null; team: Side }
  | { type: 'revive'; unitId: number }
  | { type: 'purchase'; unitId: number }
  | { type: 'courierSend'; unitId: number }
  | { type: 'courierDeliver'; unitId: number }
  | { type: 'itemDrop'; unitId: number }
  | { type: 'itemPickUp'; unitId: number; itemId?: ItemId }
  | { type: 'itemExpire'; unitId: number; itemId: ItemId }
  /** The Warden's ground slam: 'windup' when it raises its arms, 'hit' when it lands. */
  | { type: 'wardenSlam'; unitId: number; phase: 'windup' | 'hit'; x: number; y: number; radius: number }
  | { type: 'wardenMove'; unitId: number; phase: 'start' | 'stopped' | 'arrive'; x: number; y: number; fromX: number; fromY: number; watched: [boolean, boolean] }
  | { type: 'goldLost'; unitId: number; amount: number }
  | { type: 'ping'; ping: Ping }
  | { type: 'blink'; unitId: number; fromX: number; fromY: number }
  /** Announcer moments: first blood, multi-kills, kill streaks, shutdowns. */
  | { type: 'announce'; unitId: number; victimId: number; firstBlood: boolean; multi: number; streak: number; shutdown: number }
  | { type: 'immunity'; unitId: number }
  /** An item button was used (Arcane Boots, Frost Horn, Stoneskin Amulet). */
  | { type: 'itemActive'; unitId: number; kind: 'manaBurst' | 'frostNova' | 'stoneskin' | 'silence' | 'teamHeal' | 'vanish' | 'mire'; targetId?: number }
  | { type: 'chainLightning'; sourceId: number; targetIds: number[] }
  | { type: 'shieldBreak'; unitId: number }
  | { type: 'megaCreeps'; team: Team }
  | { type: 'summon'; unitId: number; kind: 'wolf' }
  | { type: 'wolfForm'; unitId: number; on: boolean }
  | { type: 'feralBond'; unitId: number; ids: number[] }
  | { type: 'miss'; sourceId: number; targetId: number }
  /** Notable damage (spells, critical hits) for floating numbers. */
  | { type: 'damage'; sourceId: number; targetId: number; amount: number; kind: DamageKind; crit: boolean };

export type DamageKind = 'attack' | 'spell';

export type PingKind = 'attack' | 'retreat' | 'defend' | 'missing' | 'gather';
export interface Ping {
  id: number;
  team: Team;
  kind: PingKind;
  x: number;
  y: number;
  fromId: number;
  at: number;
}
/** Pings stay on the map this long; a hero can ping at most this often. */
export const PING_DURATION = 6;
export const PING_COOLDOWN = 1.2;

export interface PlayerSlot {
  team: Team;
  heroId: HeroId;
  controller: Controller;
  lane: LaneId;
  /** Bot skill (default normal). */
  difficulty?: BotDifficulty;
}

export interface WorldOptions {
  seed: number;
  slots: PlayerSlot[];
  map?: GameMap;
  /** Seconds of warm-up before the clock reaches 0:00 (the match starts at -warmup; no creeps or passive gold before 0:00). */
  warmup?: number;
}

/** Cleave reaches enemies this far from the attack's target (meters). */
const CLEAVE_RADIUS = 3;
const armorMultiplier = (armor: number) => 1 - (0.06 * armor) / (1 + 0.06 * Math.abs(armor));

export class World {
  readonly map: GameMap;
  /** Map + footprints of standing structures; used for pathing and movement. */
  nav: GameMap;
  /** Where a walking courier may go (lanes and bases, minus buildings). */
  courierNav: GameMap;
  private courierLand: Uint8Array;
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
  firstBlood = false;
  pings: Ping[] = [];
  /** Set when the match ended by surrender (the team that gave up). */
  surrendered: Team | null = null;
  private nextCampSpawn = CAMP_FIRST_SPAWN;
  private megaAnnounced: [boolean, boolean] = [false, false];
  runes: Rune[] = [];
  /** Items heroes dropped on the ground. */
  groundItems: GroundItem[] = [];
  nextRune = RUNE_FIRST;
  bossRespawnAt: number | null = null;
  /** Which house the Warden lives in right now. */
  wardenHouse = 0;
  /** Night last tick (the Warden moves as day turns to night). */
  wasNight = false;
  glyphCooldown: [number, number] = [0, 0];
  private nextWave = FIRST_WAVE_TIME;
  private pending: Command[] = [];
  private byId = new Map<number, Unit>();

  constructor(opts: WorldOptions) {
    this.map = opts.map ?? createMap();
    this.nav = { ...this.map, walkable: new Uint8Array(this.map.walkable) };
    this.courierLand = courierGround(this.map);
    this.courierNav = { ...this.map, walkable: new Uint8Array(this.map.walkable) };
    this.rng = new Rng(opts.seed);
    this.time = -(opts.warmup ?? 0);
    // River curbs and hilltops block walking but not sight.
    const seeThrough = new Uint8Array(this.map.walkable);
    this.map.cliff.forEach((c, i) => c && (seeThrough[i] = 1));
    this.map.hillTop.forEach((c, i) => c && (seeThrough[i] = 1));
    this.vision = new Vision(this.map.grid, this.map.cell, seeThrough, this.map.height, this.map.houses);
    for (const s of this.map.structures) this.spawnStructure(s.team, s.tier, s.lane, s.pos, s.rax);
    this.refreshVulnerability();
    this.rebuildNav();
    opts.slots.forEach((slot, i) => this.spawnHero(slot, i));
    spawnBoss(this);
    this.vision.update(this);
  }

  /** Whether `team` can currently see unit `u` (fog of war). */
  canSee(team: Side, u: Unit): boolean {
    if (team === 2) return true;
    // Attacking or casting gives away your position for a moment, even from the fog.
    // Not from inside the Warden's house, though: its walls hide everything within.
    if (u.revealUntil > this.time && !isInvisible(u) && !inHouse(this.map, u.x, u.y)) return true;
    // Hawk Mark: the marked enemy can't hide, not even by turning invisible.
    if (u.team !== team && u.buffs.some((b) => b.key === 'hawkMark') && !inHouse(this.map, u.x, u.y)) return true;
    return this.vision.sees(team, u);
  }

  /** Mark a unit as revealed (it just attacked or cast something). */
  reveal(u: Unit, seconds = 1.5) {
    u.revealUntil = Math.max(u.revealUntil, this.time + seconds);
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

  /** Whether `a` may currently attack `b` (an enemy). */
  canAttack(a: Unit, b: Unit | undefined): b is Unit {
    if (!b || !b.alive || b.team === a.team) return false;
    if (b.structure && !b.structure.vulnerable) return false;
    // On top of a mountain: melee can only reach you from up there too.
    if (a.projectileSpeed === 0 && a.attackRange > 0 && onHillTop(this, b.x, b.y) !== onHillTop(this, a.x, a.y)) return false;
    return true;
  }

  /** Denying: a hero may last-hit its own creeps below 50% and own towers below 10%. */
  canDeny(a: Unit, b: Unit | undefined): b is Unit {
    if (!a.hero || !b || !b.alive || b.team !== a.team || b === a) return false;
    if (b.creep) return b.hp < b.maxHp * DENY_CREEP;
    if (b.structure) {
      const t = b.structure.tier;
      return (t === 'tower1' || t === 'tower2' || t === 'tower3' || t === 'shrineTower') && b.structure.vulnerable && b.hp < b.maxHp * DENY_TOWER;
    }
    return false;
  }

  /** Spawn any unit (used by objectives: boss, wards). */
  spawnUnit(kind: UnitKind, team: Side, pos: Vec2, stats: CombatStats): Unit {
    return this.newUnit(kind, team, pos, stats);
  }

  /** Remove a unit with no rewards (expired ward). */
  expire(u: Unit) {
    u.alive = false;
    u.hp = 0;
  }

  /** Attacking or casting reveals an invisible hero. */
  breakInvisibility(u: Unit) {
    if (u.buffs.some((b) => b.invisible)) u.buffs = u.buffs.filter((b) => !b.invisible);
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
    const whileDead = ['buy', 'sell', 'buyTp', 'sellCourier', 'dropCourier', 'swapItems', 'learn', 'buyback', 'glyph', 'surrender', 'setAutoAttack', 'setAutoLearn', 'ping'];
    if (!u.alive && !whileDead.includes(cmd.type)) return;
    // Teleporting: the hero is frozen in place. Only the X on the teleport slot stops it.
    if (h.channel && ['moveDir', 'moveTo', 'attack', 'attackOnce', 'attackNearest', 'cast', 'stop', 'useItem', 'placeWard', 'pickUp', 'teleport'].includes(cmd.type)) return;
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
        // Steering: that target simply comes first while it stays in range.
        if (cmd.priority && h.order.type === 'dir') {
          if (this.canAttack(u, t) && this.canSee(u.team, t)) u.targetId = t.id;
          break;
        }
        if ((this.canAttack(u, t) && this.canSee(u.team, t)) || this.canDeny(u, t)) h.order = { type: 'attack', leash: cmd.priority, targetId: cmd.targetId };
        break;
      }
      case 'attackNearest': {
        const t = this.pickAutoTarget(u);
        h.order = t ? { type: 'attack', targetId: t.id } : { type: 'idle' };
        break;
      }
      case 'setAutoAttack':
        h.autoAttack = cmd.enabled;
        break;
      case 'ping': {
        if (this.time - h.lastPingAt < PING_COOLDOWN) break;
        h.lastPingAt = this.time;
        const ping: Ping = { id: this.newId(), team: u.team as Team, kind: cmd.kind, x: cmd.x, y: cmd.y, fromId: u.id, at: this.time };
        this.pings = this.pings.filter((p) => this.time - p.at < PING_DURATION && p.fromId !== u.id).concat(ping);
        this.events.push({ type: 'ping', ping });
        break;
      }
      case 'setAutoLearn':
        h.autoLearn = cmd.enabled;
        break;
      case 'surrender':
        if (this.winner === null) {
          this.surrendered = u.team as Team;
          this.winner = otherTeam(u.team as Team);
          this.events.push({ type: 'gameOver', winner: this.winner });
        }
        break;
      case 'cancelChannel':
        h.channel = null;
        break;
      case 'attackOnce': {
        // Tapping faster than the attack speed does nothing: the swing has to be ready.
        if (u.attackTimer > ONCE_GRACE) break;
        const t = cmd.targetId !== undefined ? this.unit(cmd.targetId) : this.nearestAttackTarget(u);
        if (!t || !((this.canAttack(u, t) && this.canSee(u.team, t)) || this.canDeny(u, t))) break;
        if (h.order.type === 'dir') h.onceTarget = t.id;
        else h.order = { type: 'attackOnce', targetId: t.id };
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
      case 'courier':
        sendCourier(this, u);
        break;
      case 'sellCourier':
        sellCourierItem(this, u, cmd.slot);
        break;
      case 'dropCourier':
        dropCourierItem(this, u, cmd.slot);
        break;
      case 'swapItems':
        swapItems(u, cmd.courier, cmd.a, cmd.b);
        break;
      case 'useItem':
        useItem(this, u, cmd.slot, cmd.x, cmd.y);
        break;
      case 'teleport':
        startTeleport(this, u, cmd.targetId);
        break;
      case 'placeWard':
        if (placeWard(this, u, cmd.slot, cmd.x, cmd.y) === 'approach') {
          h.order = { type: 'ward', slot: cmd.slot, x: cmd.x, y: cmd.y };
          u.path = null;
        }
        break;
      case 'buyback':
        buyback(this, u);
        break;
      case 'dropItem':
        dropItem(this, u, cmd.slot);
        break;
      case 'pickUp':
        if (pickUpItem(this, u, cmd.groundId) === 'approach') {
          h.order = { type: 'pickUp', groundId: cmd.groundId };
          u.path = null;
        }
        break;
      case 'glyph':
        activateGlyph(this, u.team as Team);
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

  isSpellImmune(u: Unit) {
    return u.buffs.some((b) => b.spellImmune);
  }

  /** Add or refresh a buff (same key = refresh, keeping the strongest duration). */
  addBuff(u: Unit, b: Buff) {
    if (b.slowPct && this.isSpellImmune(u)) return;
    const i = u.buffs.findIndex((x) => x.key === b.key);
    if (i >= 0) u.buffs[i] = { ...b, t: Math.max(b.t, u.buffs[i].t) };
    else u.buffs.push(b);
  }

  stun(u: Unit, seconds: number) {
    if (!u.alive || u.kind === 'structure' || this.isSpellImmune(u)) return;
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
  /**
   * Auto attack's choice: the target it already has while that stays in range, otherwise the
   * nearest one in range. It never denies, and doesn't wake up jungle camps by itself.
   */
  autoTarget(u: Unit): Unit | undefined {
    const cur = this.unit(u.targetId);
    if (this.canAttack(u, cur) && !cur.ward && this.canSee(u.team, cur) && this.inReach(u, cur)) return cur;
    return this.enemiesNear(u, u.x, u.y, u.attackRange + u.radius + 3, (e) => e.kind !== 'ward' && this.canSee(u.team, e) && (e.kind !== 'neutral' || (e.neutral?.aggroUntil ?? -1e9) > this.time))
      .filter((e) => this.inReach(u, e))
      .sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y))[0];
  }

  /** The Attack button's choice: the nearest target in range (jungle monsters too), else the best one close by. */
  nearestAttackTarget(u: Unit): Unit | undefined {
    const inRange = this.enemiesNear(u, u.x, u.y, u.attackRange + u.radius + 3, (e) => e.kind !== 'ward' && this.canSee(u.team, e))
      .filter((e) => this.inReach(u, e))
      .sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y))[0];
    return inRange ?? this.pickAutoTarget(u);
  }

  pickAutoTarget(u: Unit): Unit | undefined {
    const reach = Math.max(u.attackRange + 4, 8);
    const seen = (e: Unit) => this.canSee(u.team, e) && e.kind !== 'ward';
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
      repathAt: -1e9,
      stunTimer: 0,
      revealUntil: -1e9, // far in the past (the clock starts below zero during the warm-up)
      castLock: 0,
      buffs: [],
      dash: null,
    };
    this.units.push(u);
    this.byId.set(u.id, u);
    return u;
  }

  private spawnStructure(team: Team, tier: StructureTier, lane: LaneId | null, pos: Vec2, rax?: 'melee' | 'ranged') {
    const stats = rax ? { ...STRUCTURES[tier], ...BARRACKS[rax] } : STRUCTURES[tier];
    const u = this.newUnit('structure', team, pos, stats);
    u.structure = { tier, lane, vulnerable: true, aggroId: null, aggroTimer: 0, glyph: 0, backdoor: true, backdoorHitAt: -999, rax };
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
      assists: 0,
      lastHits: 0,
      lastHurtBy: null,
      lastHurtAt: -999,
      denies: 0,
      goldEarned: 0,
      streak: 0,
      lastPingAt: -99,
      multi: 0,
      lastKillAt: -99,
      stats: { heroDamage: 0, buildingDamage: 0, healing: 0, damageTaken: 0 },
      autoAttack: true,
      autoLearn: false,
      lastCrit: false,
      damagedBy: new Map(),
      respawnTimer: 0,
      order: { type: 'idle' },
      abilities: [0, 1, 2].map(() => ({ level: 0, cooldown: 0 })),
      skillPoints: 1,
      attackCount: 0,
      items: emptyInventory(),
      tpCount: 1, // everyone starts with one teleport scroll
      courier: null as unknown as CourierState,
      tpCooldown: 0,
      channel: null,
      bonus: itemBonuses([]),
      onceTarget: null,
      windup: null,
      buybackCooldown: 0,
      reviveAt: null,
      bot: { thinkTimer: (index % 6) * 0.05, retreating: false, buildIndex: 0, difficulty: slot.difficulty ?? 'normal' },
    };
    u.hero.courier = newCourier(this, u);
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
    // Wayfarer Boots: exactly one teleport while you have them, and one to keep when they go.
    if (b.teleportBoots) {
      h.tpCount = 1;
      h.tpCooldown = Math.min(h.tpCooldown, TELEPORT.bootsCooldown);
    } else if (h.hadTeleportBoots) h.tpCount = 1;
    h.hadTeleportBoots = b.teleportBoots;
    const oldMax = u.maxHp;
    const oldMana = u.maxMana;
    u.maxHp = def.baseHp + def.hpPerLevel * lv + b.hp;
    u.maxMana = def.baseMana + def.manaPerLevel * lv + b.mana;
    u.hpRegen = def.hpRegen + 0.15 * lv + b.hpRegen;
    u.manaRegen = def.manaRegen + 0.1 * lv + b.manaRegen;
    u.armor = def.baseArmor + def.armorPerLevel * lv + b.armor;
    // Red Wolf: Morra fights in melee with extra damage while it lasts.
    const form = u.buffs.find((f) => f.key === 'redWolf');
    h.wolfForm = !!form;
    u.damage = def.baseDamage + def.damagePerLevel * lv + b.damage + (form?.formDamage ?? 0);
    u.attackRange = form ? WOLF_FORM_RANGE : def.attackRange + (def.projectileSpeed > 0 ? b.attackRange : 0);
    u.projectileSpeed = form ? 0 : def.projectileSpeed;
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
        u.neutral = { camp, homeX: u.x, homeY: u.y, aggroUntil: -1e9 };
      }
    });
  }

  private spawnWave() {
    for (const team of [0, 1] as Team[]) {
      for (const lane of ['top', 'mid', 'bot'] as LaneId[]) {
        const path = teamLanePath(this.map, team, lane);
        // Each barracks that falls powers up one kind of the attackers' creeps in that lane.
        const raxDown = (kind: 'melee' | 'ranged') =>
          this.findStructure(otherTeam(team), 'barracks', lane).some((r) => !r.alive && r.structure!.rax === kind);
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
          const enemyRaxDown = raxDown(type);
          const mega = this.findStructure(otherTeam(team), 'barracks').every((r) => !r.alive);
          // Creeps grow stronger as the match goes on, so games can't stall forever.
          const grow = 1 + CREEP_GROWTH_PER_5MIN * Math.floor(this.time / 300);
          u.maxHp = u.hp = Math.round(u.hp * grow);
          u.damage = Math.round(u.damage * grow);
          if (mega) {
            u.maxHp = u.hp = Math.round(u.hp * MEGA_CREEP_MULT.hp);
            u.damage = Math.round(u.damage * MEGA_CREEP_MULT.damage);
            u.bountyGold = Math.round(u.bountyGold * MEGA_CREEP_MULT.gold);
            u.radius *= 1.25;
            if (!this.megaAnnounced[team]) {
              this.megaAnnounced[team] = true;
              this.events.push({ type: 'megaCreeps', team });
            }
          } else if (enemyRaxDown) {
            u.maxHp = u.hp = Math.round(u.hp * SUPER_CREEP_MULT.hp);
            u.damage = Math.round(u.damage * SUPER_CREEP_MULT.damage);
            u.bountyGold = Math.round(u.bountyGold * SUPER_CREEP_MULT.gold);
          }
          u.creep = { type, lane, path, wp: 1, super: enemyRaxDown, mega };
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
    updateObjectives(this);
    expireGroundItems(this);

    for (const u of this.units) {
      if (u.attackTimer > 0) u.attackTimer -= DT;
      if (u.hero) this.updateHeroUpkeep(u);
      if (u.alive) this.updateStatus(u);
    }
    // Units act one after another, and the list starts with Azure's. Going through it backwards
    // every other tick means neither team always gets the first hit (or last hit) in a close call.
    const order = this.tick % 2 === 0 ? this.units : [...this.units].reverse();
    for (const u of order) {
      if (!u.alive) {
        if (u.hero?.controller === 'bot' && this.tick % 15 === 0) botWhileDead(this, u);
        continue;
      }
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
            u.hero.bot.thinkTimer = BOT_THINK_INTERVAL[u.hero.bot.difficulty];
            botThink(this, u);
          }
        }
        // A bot that blinked into a hiding spot in the woods doesn't know how to get out: lift it out.
        if (u.hero.controller === 'bot') this.rescueBot(u);
        this.updateHero(u);
      } else if (u.creep) this.updateCreep(u);
      else if (u.summon) this.updateSummon(u);
      else if (u.neutral?.boss) this.updateWarden(u);
      else if (u.neutral) this.updateNeutral(u);
      else if (u.structure) this.updateStructure(u);
    }
    this.updateProjectiles();
    this.updateSkillshots();
    this.updateAreas();
    updateItemAuras(this);
    updateCouriers(this);
    this.separate();
    if (this.tick % Math.round(1 / (DT * VISION_HZ)) === 0) this.vision.update(this);

    // Drop dead creeps; heroes respawn and structures stay as ruins.
    this.units = this.units.filter((u) => {
      if ((u.kind === 'creep' || u.kind === 'neutral' || u.kind === 'ward') && !u.alive) {
        this.byId.delete(u.id);
        return false;
      }
      return true;
    });
  }

  private updateHeroUpkeep(u: Unit) {
    const h = u.hero!;
    if (this.time >= 0) {
      h.gold += PASSIVE_GOLD_PER_SEC * DT;
      h.goldEarned += PASSIVE_GOLD_PER_SEC * DT;
    }
    for (const a of h.abilities) if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - DT);
    if (h.bonus.teleportBoots) h.tpCount = 1;
    // The Red Wolf ended (time ran out, or she died): back to human, and ranged again.
    if (h.wolfForm && !u.buffs.some((f) => f.key === 'redWolf')) {
      this.applyHeroStats(u);
      this.events.push({ type: 'wolfForm', unitId: u.id, on: false });
    }
    if (h.tpCooldown > 0) h.tpCooldown = Math.max(0, h.tpCooldown - DT);
    for (const it of h.items) if (it?.cooldown) it.cooldown = Math.max(0, it.cooldown - DT);
    if (h.autoLearn && h.skillPoints > 0) botLearn(this, u);
    if (!u.alive) {
      h.respawnTimer -= DT;
      if (h.respawnTimer <= 0) {
        const p = h.reviveAt ?? this.respawnPoint(u.team as Team, h.slot);
        if (h.reviveAt) this.events.push({ type: 'revive', unitId: u.id });
        h.reviveAt = null;
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

  /**
   * Safety net: if a hero ends up inside trees or a building (pushed by a crowd, a dash or
   * a blink), move it to the nearest open ground so it can never be trapped.
   */
  private unstick(u: Unit) {
    const m = this.nav;
    if (onHillTop(this, u.x, u.y) || fits(m, u.x, u.y, u.radius)) return;
    // Standing still and only squeezed against something is fine; inside something is not.
    if (u.hero?.order.type === 'idle' && isWalkable(m, u.x, u.y)) return;
    // First the smallest nudge that frees it (keeps it moving along its way instead of
    // snapping back to a cell centre, which can loop next to a building).
    for (const r of [0.15, 0.3, 0.5, 0.8]) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = u.x + Math.cos(a) * r;
        const y = u.y + Math.sin(a) * r;
        if (fits(m, x, y, u.radius)) {
          u.x = x;
          u.y = y;
          return;
        }
      }
    }
    const cx = Math.floor(u.x / m.cell);
    const cy = Math.floor(u.y / m.cell);
    for (let r = 1; r <= 24; r++) {
      let best: { x: number; y: number; d: number } | null = null;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = (cx + dx + 0.5) * m.cell;
          const y = (cy + dy + 0.5) * m.cell;
          if (!fits(m, x, y, u.radius)) continue;
          const d = dist(x, y, u.x, u.y);
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      if (best) {
        u.x = best.x;
        u.y = best.y;
        u.path = null;
        return;
      }
    }
  }

  private rescueBot(u: Unit) {
    const n = this.map.grid;
    const c = this.map.cell;
    const cx = Math.floor(u.x / c);
    const cy = Math.floor(u.y / c);
    if (this.map.reachable[cy * n + cx]) return;
    for (let r = 1; r < 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const k = (cy + dy) * n + cx + dx;
          if (k < 0 || k >= n * n || !this.map.reachable[k]) continue;
          u.x = u.px = (cx + dx + 0.5) * c;
          u.y = u.py = (cy + dy + 0.5) * c;
          u.path = null;
          return;
        }
      }
    }
  }

  private updateHero(u: Unit) {
    const h = u.hero!;
    this.unstick(u);
    const o = h.order;
    // Walking: shoot on the move at whatever is in range, without stopping (bots walk with a purpose).
    if (o.type === 'dir' || (o.type === 'move' && h.controller === 'human')) {
      let t: Unit | undefined;
      if (h.onceTarget !== null) {
        const q = this.unit(h.onceTarget);
        if (q && ((this.canAttack(u, q) && this.canSee(u.team, q)) || this.canDeny(u, q)) && this.inReach(u, q)) t = q;
        else h.onceTarget = null;
      }
      if (!t && h.autoAttack && !isInvisible(u)) t = this.autoTarget(u);
      u.targetId = t?.id ?? null;
      if (t && u.attackTimer <= 0) {
        this.tryAttack(u, t);
        if (t.id === h.onceTarget) h.onceTarget = null;
      }
      if (o.type === 'dir') this.stepMove(u, o.dx, o.dy, this.speedOf(u) * DT);
      else if (this.navigate(u, o.x, o.y, 0.3)) h.order = { type: 'idle' };
      return;
    }
    switch (o.type) {
      case 'move':
        if (this.navigate(u, o.x, o.y, 0.3)) h.order = { type: 'idle' };
        u.targetId = null;
        break;
      case 'attack': {
        const t = this.unit(o.targetId);
        if (!((this.canAttack(u, t) && this.canSee(u.team, t)) || this.canDeny(u, t))) {
          h.order = { type: 'idle' };
          break;
        }
        u.targetId = t.id;
        // A target picked with the Attack arrow counts until it dies or leaves your range; then back to normal.
        if (o.leash) {
          const reach = this.inReach(u, t);
          if (reach) o.reached = true;
          else if (o.reached) {
            h.order = { type: 'idle' };
            u.targetId = null;
            break;
          }
        }
        if (!this.tryAttack(u, t)) this.navigate(u, t.x, t.y, 0);
        break;
      }
      case 'attackOnce': {
        const t = this.unit(o.targetId);
        if (!((this.canAttack(u, t) && this.canSee(u.team, t)) || this.canDeny(u, t))) {
          h.order = { type: 'idle' };
          break;
        }
        u.targetId = t.id;
        if (!this.inReach(u, t)) {
          this.navigate(u, t.x, t.y, 0);
          break;
        }
        // In range: one swing as soon as it's ready, then stand still.
        u.facing = Math.atan2(t.y - u.y, t.x - u.x);
        u.path = null;
        if (u.attackTimer <= 0) {
          this.tryAttack(u, t);
          h.order = { type: 'idle' };
        }
        break;
      }
      case 'cast': {
        const r = resolveCast(this, u, o);
        if (r !== 'approach') h.order = { type: 'idle' };
        break;
      }
      case 'ward': {
        const r = placeWard(this, u, o.slot, o.x, o.y);
        if (r === 'approach') this.navigate(u, o.x, o.y, 0);
        else h.order = { type: 'idle' };
        break;
      }
      case 'pickUp': {
        const r = pickUpItem(this, u, o.groundId);
        const g = this.groundItems.find((x) => x.id === o.groundId);
        if (r === 'approach' && g) this.navigate(u, g.x, g.y, 0);
        else h.order = { type: 'idle' };
        break;
      }
      case 'idle': {
        // Auto-attack anything already in range, without chasing (unless turned off,
        // or invisible: an invisible hero never gives itself away by itself).
        if (!h.autoAttack || isInvisible(u)) {
          u.targetId = null;
          break;
        }
        const t = this.autoTarget(u);
        u.targetId = t ? t.id : null;
        if (t) this.tryAttack(u, t);
        break;
      }
    }
  }

  private updateCreep(u: Unit) {
    const c = u.creep!;
    let t = this.unit(u.targetId);
    if (!this.canAttack(u, t) || !this.canSee(u.team, t) || dist(u.x, u.y, t.x, t.y) > u.acquireRange + 4) t = undefined;
    if (!t) {
      t = this.enemiesNear(u, u.x, u.y, u.acquireRange, (e) => e.kind !== 'neutral' && e.kind !== 'ward' && this.canSee(u.team, e)).sort(
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

  /** Morra calls a creature: a body of its own, fighting and following on its own. */
  spawnSummon(owner: Unit, s: SummonState, stats: CombatStats, angle: number): Unit {
    const r = 2.5;
    const want = { x: owner.x + Math.cos(angle) * r, y: owner.y + Math.sin(angle) * r };
    const cell = nearestWalkableCell(this.nav, want.x, want.y);
    const pos = cell >= 0 ? cellCenter(this.nav, cell) : { x: owner.x, y: owner.y };
    const u = this.newUnit('creep', owner.team, pos, stats);
    u.summon = s;
    u.facing = owner.facing;
    this.events.push({ type: 'summon', unitId: u.id, kind: s.kind });
    return u;
  }

  /** Wolves hunt what their owner attacks, then whatever is close, and otherwise stay near the owner. */
  private updateSummon(u: Unit) {
    const s = u.summon!;
    if (this.time >= s.expires) {
      this.expire(u);
      return;
    }
    const owner = this.unit(s.ownerId);
    const home = owner?.alive ? owner : undefined;
    let t = this.unit(u.targetId);
    // Whatever Morra is hitting, however she came to hit it (tap, arrow or auto attack).
    const near = (e: Unit | undefined) => !!e && e.team !== u.team && this.canAttack(u, e) && !!home && dist(home.x, home.y, e.x, e.y) < SUMMON_LEASH;
    const hers = home ? this.unit(home.targetId) : undefined;
    const called = near(hers) ? hers : undefined;
    // Whoever is hurting her.
    const hurt = home?.hero && this.time - home.hero.lastHurtAt < 3 ? this.unit(home.hero.lastHurtBy) : undefined;
    const attacker = near(hurt) && this.canSee(u.team, hurt!) ? hurt : undefined;
    if (called) t = called;
    else if (attacker) t = attacker;
    if (!this.canAttack(u, t) || !this.canSee(u.team, t) || (t !== called && dist(u.x, u.y, t.x, t.y) > u.acquireRange + 4)) t = undefined;
    if (home && t && t !== called && dist(u.x, u.y, home.x, home.y) > SUMMON_LEASH) t = undefined;
    // By themselves they stay out of buildings and enemy tower zones.
    const enemy = (u.team === 0 ? 1 : 0) as Team;
    const dive = (e: Unit) => e !== called && e !== attacker && (e.kind === 'structure' || this.vision.inTowerZone(enemy, e.x, e.y));
    if (t && dive(t)) t = undefined;
    if (!t) {
      t = this.enemiesNear(u, u.x, u.y, u.acquireRange, (e) => e.kind !== 'neutral' && e.kind !== 'ward' && !dive(e) && this.canSee(u.team, e)).sort(
        (a, b) => Number(!!b.hero) - Number(!!a.hero) || dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y),
      )[0];
    }
    u.targetId = t ? t.id : null;
    if (t) {
      if (!this.tryAttack(u, t)) this.steerTo(u, t.x, t.y);
      return;
    }
    if (home && dist(u.x, u.y, home.x, home.y) > 4) this.steerTo(u, home.x, home.y);
  }

  private updateStructure(u: Unit) {
    const s = u.structure!;
    if (u.attackInterval <= 0) return;
    if (s.aggroTimer > 0) s.aggroTimer -= DT;
    let t = this.unit(u.targetId);
    const aggro = this.unit(s.aggroId);
    if (s.aggroTimer > 0 && this.canAttack(u, aggro) && this.inReach(u, aggro)) t = aggro;
    if (!this.canAttack(u, t) || !this.inReach(u, t) || !this.canSee(u.team, t)) {
      const near = this.enemiesNear(
        u,
        u.x,
        u.y,
        u.attackRange + u.radius,
        (e) => e.kind !== 'structure' && e.kind !== 'neutral' && e.kind !== 'ward' && this.canSee(u.team, e),
      );
      const byDist = (a: Unit, b: Unit) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y);
      // Towers prefer creeps; heroes are hit when alone or when they attack an allied hero.
      // The fountain shoots heroes first (no camping in the enemy's healing area).
      const first = s.tier === 'fountain' ? 'hero' : 'creep';
      t = near.filter((e) => e.kind === first).sort(byDist)[0] ?? near.sort(byDist)[0];
    }
    u.targetId = t ? t.id : null;
    if (t) this.tryAttack(u, t);
  }

  /** Neutrals idle at camp; when attacked they fight back, but never stray far from home. */
  /**
   * Neutrals idle at camp. When hit they fight back for a while: they chase within their
   * leash range (waiting at the edge if the attacker stands further out), and only heal
   * up once they've been left alone at home.
   */
  private updateNeutral(u: Unit) {
    const n = u.neutral!;
    const angry = this.time < n.aggroUntil;
    let t = this.unit(u.targetId);
    if (t && (!t.alive || !angry)) t = undefined;
    u.targetId = t?.id ?? null;
    if (t) {
      if (this.tryAttack(u, t)) return;
      // Chase, but never further than the leash from home.
      const d = dist(t.x, t.y, n.homeX, n.homeY);
      if (d <= NEUTRAL_LEASH) this.steerTo(u, t.x, t.y);
      else {
        const k = NEUTRAL_LEASH / d;
        this.steerTo(u, n.homeX + (t.x - n.homeX) * k, n.homeY + (t.y - n.homeY) * k);
      }
      return;
    }
    const home = dist(u.x, u.y, n.homeX, n.homeY);
    if (home > 0.3) this.steerTo(u, n.homeX, n.homeY);
    else if (this.time > n.aggroUntil + 2) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.1 * DT); // heal at camp
  }

  /**
   * The Warden guards its house. When hurt it fights back against anyone (it hits from
   * anywhere), chases up to WARDEN_LEASH from home and then gives up, and every few
   * seconds slams the ground, stunning everyone close by after a short wind-up.
   */
  private updateWarden(u: Unit) {
    const n = u.neutral!;
    if (n.moveAt != null) return; // gathering itself to teleport: see objectives.ts
    if (n.slamLand != null) {
      if (this.time < n.slamLand) return; // arms raised: stands still
      n.slamLand = null;
      n.nextSlam = this.time + WARDEN_SLAM.interval;
      for (const e of this.units) {
        if (!e.alive || (e.kind !== 'hero' && e.kind !== 'creep')) continue;
        if (dist(e.x, e.y, u.x, u.y) > WARDEN_SLAM.radius + e.radius) continue;
        this.dealDamage(u.id, e, WARDEN_SLAM.damage, 'spell');
        this.stun(e, WARDEN_SLAM.stun);
      }
      this.events.push({ type: 'wardenSlam', unitId: u.id, phase: 'hit', x: u.x, y: u.y, radius: WARDEN_SLAM.radius });
      return;
    }
    const angry = this.time < n.aggroUntil;
    if (!angry) n.nextSlam = this.time + 3; // the first slam comes a few seconds into a fight
    let t = this.unit(u.targetId);
    if (t && (!t.alive || !angry || t.team === 2)) t = undefined;
    // Gave chase too far: give up and go home.
    if (t && dist(t.x, t.y, n.homeX, n.homeY) > WARDEN_LEASH) {
      t = undefined;
      n.aggroUntil = -1e9;
    }
    // Still angry but its target is gone: anyone in the house will do.
    if (!t && this.time < n.aggroUntil) {
      t = this.units
        .filter((e) => e.alive && (e.kind === 'hero' || e.kind === 'creep') && inHouse(this.map, e.x, e.y))
        .sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y))[0];
    }
    u.targetId = t?.id ?? null;
    if (t) {
      const near = this.units.some((e) => e.alive && e.team !== 2 && (e.kind === 'hero' || e.kind === 'creep') && dist(e.x, e.y, u.x, u.y) <= WARDEN_SLAM.radius + e.radius - 0.5);
      if (near && this.time >= (n.nextSlam ?? 0)) {
        n.slamLand = this.time + WARDEN_SLAM.windup;
        u.path = null;
        this.events.push({ type: 'wardenSlam', unitId: u.id, phase: 'windup', x: u.x, y: u.y, radius: WARDEN_SLAM.radius });
        return;
      }
      if (this.tryAttack(u, t)) return;
      this.steerTo(u, t.x, t.y);
      return;
    }
    const home = dist(u.x, u.y, n.homeX, n.homeY);
    if (home > 0.3) this.steerTo(u, n.homeX, n.homeY);
    else if (this.time > n.aggroUntil + 2) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.05 * DT); // heals at home
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
        } else if (p.miss) this.events.push({ type: 'miss', sourceId: p.sourceId, targetId: t.id });
        else this.dealDamage(p.sourceId, t, p.damage, 'attack', { crit: p.crit });
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
        const before = u.hp;
        this.heal(u, b.healPerSec * DT);
        const healer = this.unit(b.sourceId);
        if (healer?.hero) healer.hero.stats.healing += u.hp - before;
      }
      if (b.manaPerSec) u.mana = Math.min(u.maxMana, u.mana + b.manaPerSec * DT);
      if (b.damagePerSec && b.sourceId !== undefined) this.dealDamage(b.sourceId, u, b.damagePerSec * DT, 'spell', { dot: true });
      if (b.boltDamage) {
        b.boltTimer = (b.boltTimer ?? 0) - DT;
        if (b.boltTimer <= 0 && u.stunTimer <= 0) {
          b.boltTimer = BOLT_EVERY;
          const t = this.enemiesNear(u, u.x, u.y, BOLT_RADIUS, (e) => e.kind !== 'neutral' && e.kind !== 'ward' && e.kind !== 'structure' && this.canSee(u.team, e)).sort(
            (p, q) => Number(!!q.hero) - Number(!!p.hero) || dist(u.x, u.y, p.x, p.y) - dist(u.x, u.y, q.x, q.y),
          )[0];
          if (t) {
            this.projectiles.push({ id: this.nextId++, team: u.team, x: u.x, y: u.y, px: u.x, py: u.y, sourceId: u.id, targetId: t.id, speed: 34, damage: b.boltDamage, spell: { kind: 'fireball', aoe: 0 } });
            this.events.push({ type: 'attack', sourceId: u.id, targetId: t.id });
          }
        }
      }
      if (!u.alive) return;
    }
    u.buffs = u.buffs.filter((b) => b.t > 0);
  }

  private updateDash(u: Unit) {
    const d = u.dash!;
    const step = Math.min(d.remaining, d.speed * DT);
    // Trees, walls, buildings and mountains only stop walking: a charge goes straight through
    // them. If it ends inside one, the hero comes out at the nearest open spot (a mountain top
    // counts as a place to stand).
    const size = this.map.size;
    u.facing = Math.atan2(d.dy, d.dx);
    u.x = Math.max(1, Math.min(size - 1, u.x + d.dx * step));
    u.y = Math.max(1, Math.min(size - 1, u.y + d.dy * step));
    d.remaining -= step;
    for (const e of this.units) {
      if (d.phase) break;
      if (!e.alive || e.team === u.team || e.kind === 'structure' || d.hit.includes(e.id)) continue;
      if (dist(u.x, u.y, e.x, e.y) > u.radius + e.radius + 0.6) continue;
      d.hit.push(e.id);
      this.dealDamage(u.id, e, d.damage, 'spell');
      if (e.kind === 'hero') {
        this.stun(e, d.stun);
        u.dash = null;
        u.hero!.order = { type: 'attack', targetId: e.id };
        this.unstick(u);
        return;
      }
    }
    if (d.remaining <= 0) {
      u.dash = null;
      this.unstick(u);
    }
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
        if (s.slow) this.addBuff(e, { key: `slow:${s.kind}`, t: s.slow.t, slowPct: s.slow.pct });
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
        this.dealDamage(z.sourceId, e, z.dps * DT, 'spell', { dot: true });
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
    // The Warden can only be fought from inside its house.
    if (b.neutral?.boss && !inHouse(this.map, a.x, a.y)) return false;
    return dist(a.x, a.y, b.x, b.y) <= a.attackRange + a.radius + b.radius;
  }

  /** Attack if in reach (returns true), otherwise returns false so the caller can move closer. */
  private tryAttack(u: Unit, t: Unit): boolean {
    if (!this.inReach(u, t)) return false;
    u.facing = Math.atan2(t.y - u.y, t.x - u.x);
    u.path = null;
    if (u.attackTimer > 0) return true;
    // The team shield (glyph) also doubles tower attack speed while it lasts.
    let hurry = 0;
    for (const b of u.buffs) hurry += b.attackSpeedPct ?? 0;
    u.attackTimer = (u.attackInterval / (1 + hurry / 100)) * (u.structure && u.structure.glyph > 0 ? 0.5 : 1);
    this.events.push({ type: 'attack', sourceId: u.id, targetId: t.id });
    this.breakInvisibility(u);
    // Hitting a building gives you away for longer, wherever you stand and whoever is around.
    this.reveal(u, t.structure ? ATTACK_TOWER_REVEAL : 1.5);
    let damage = applyAttackPassives(this, u, t);
    const crit = !!u.hero?.lastCrit;
    // High ground: ranged attacks from lower ground onto higher ground miss 25% of the time (melee never does).
    const miss = u.projectileSpeed > 0 && heightAt(this.map, u.x, u.y) < heightAt(this.map, t.x, t.y) && this.rng.next() < UPHILL_MISS_CHANCE;
    for (const b of u.buffs) if (b.damageMult) damage *= b.damageMult;
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
        crit,
        miss,
      });
    } else if (miss) {
      this.events.push({ type: 'miss', sourceId: u.id, targetId: t.id });
    } else {
      this.dealDamage(u.id, t, damage, 'attack', { crit });
      // Cleave (melee heroes): a share of the hit splashes onto enemies around the target.
      const cleave = u.hero?.bonus.cleavePct ?? 0;
      if (cleave > 0 && u.projectileSpeed === 0 && t.kind !== 'structure') {
        for (const e of this.units) {
          if (e === t || !e.alive || e.team === u.team || e.kind === 'structure' || e.ward) continue;
          if (dist(e.x, e.y, t.x, t.y) > CLEAVE_RADIUS + e.radius) continue;
          this.dealDamage(u.id, e, (damage * cleave) / 100, 'attack', { cleave: true });
        }
      }
    }
    return true;
  }

  /**
   * Attacks are reduced by armor. Spells ignore armor but cannot hurt structures.
   */
  dealDamage(sourceId: number, target: Unit, raw: number, kind: DamageKind = 'attack', opts: { crit?: boolean; dot?: boolean; cleave?: boolean; reflect?: boolean } = {}) {
    if (!target.alive) return;
    if (target.structure && (!target.structure.vulnerable || kind === 'spell' || target.structure.glyph > 0)) return;
    if (kind === 'spell' && this.isSpellImmune(target)) return;
    const dealer = this.unit(sourceId);
    if (target.hero && dealer && !dealer.structure && dealer.team !== target.team) {
      target.hero.lastHurtBy = dealer.id;
      target.hero.lastHurtAt = this.time;
    }
    // A creature's hits count as its owner's for gold, assists and the end-of-match numbers.
    const src = dealer?.summon ? (this.unit(dealer.summon.ownerId) ?? dealer) : dealer;
    if (kind === 'attack' && target.structure && src?.hero && !dealer?.summon) raw *= 1 + src.hero.bonus.buildingDamagePct / 100;
    // Creatures are for fights, not sieges.
    if (target.structure && dealer?.summon) raw *= SUMMON_BUILDING_MULT;
    // Nothing from outside the Warden's house hurts it (spells and arrows included).
    if (target.neutral?.boss && src && src !== target && !inHouse(this.map, src.x, src.y)) return;
    // Wards ignore spells and splash; every direct attack takes exactly half, so two hits kill one.
    if (target.ward) {
      if (kind !== 'attack' || opts.cleave || opts.dot) return;
      raw = target.maxHp / 2;
    }
    let amount = target.ward ? raw : kind === 'attack' ? raw * armorMultiplier(this.armorOf(target)) : raw;
    if (kind === 'spell' && src?.hero && !opts.reflect) amount *= 1 + src.hero.bonus.spellAmpPct / 100;
    if (!target.ward) amount = damageAfterPassives(this, target, amount, kind);
    if (target.hero) {
      // Sanctuary: the best dome you're standing in counts.
      let cut = 0;
      for (const z of this.zones) {
        if (z.reduction && z.team === target.team && dist(z.x, z.y, target.x, target.y) <= z.radius + target.radius) cut = Math.max(cut, z.reduction);
      }
      amount *= 1 - cut / 100;
      // Aegis soaks up what's left, before it reaches your health.
      const shield = target.buffs.find((b) => b.absorb);
      if (shield) {
        const soaked = Math.min(shield.absorb!, amount);
        shield.absorb! -= soaked;
        amount -= soaked;
        if (shield.absorb! <= 0) {
          shield.t = 0;
          this.events.push({ type: 'shieldBreak', unitId: target.id });
        }
      }
    }
    // Backdoor protection: buildings shrug off damage when no enemy creeps are pushing them.
    if (target.structure?.backdoor && src?.team !== target.team) {
      amount *= BACKDOOR_DAMAGE_MULT;
      target.structure.backdoorHitAt = this.time;
    }
    if (amount <= 0) return;
    target.hp -= amount;
    if (target.hero && src?.hero && src.team !== target.team) target.hero.damagedBy.set(src.id, this.time);
    if (src?.hero && src.team !== target.team) {
      if (target.hero) src.hero.stats.heroDamage += Math.min(amount, target.hp + amount);
      else if (target.structure) src.hero.stats.buildingDamage += amount;
    }
    if (target.hero) target.hero.stats.damageTaken += amount;
    if ((kind === 'spell' && !opts.dot) || opts.crit) {
      this.events.push({ type: 'damage', sourceId, targetId: target.id, amount, kind, crit: !!opts.crit });
    }
    if (kind === 'attack' && !opts.cleave && src?.hero && src.hero.bonus.lifestealPct > 0) {
      this.heal(src, (amount * src.hero.bonus.lifestealPct) / 100);
    }
    if (kind === 'spell' && !opts.reflect && src?.hero && src.team !== target.team && src.hero.bonus.spellLifestealPct > 0) {
      this.heal(src, (amount * src.hero.bonus.spellLifestealPct * (target.hero ? 1 : 1 / 3)) / 100);
    }
    // Wake the whole camp when a neutral is hit (and keep it angry while it's being hit).
    if (target.neutral && src && src.team !== 2 && src.kind !== 'structure') {
      for (const n of this.units) {
        if (n.neutral?.camp !== target.neutral.camp || !n.alive) continue;
        n.neutral.aggroUntil = this.time + 5;
        const cur = this.unit(n.targetId);
        if (!cur || !cur.alive || n === target) n.targetId = src.id;
      }
    }

    // Towers punish heroes that attack heroes under them.
    if (src && src.kind === 'hero' && target.kind === 'hero' && !opts.reflect) {
      for (const tw of this.units) {
        if (!tw.structure || !tw.alive || tw.team !== target.team || tw.attackInterval <= 0) continue;
        if (this.inReach(tw, src)) {
          tw.structure.aggroId = src.id;
          tw.structure.aggroTimer = 2;
        }
      }
    }
    if (target.hp <= 0) this.kill(target, dealer);
    if (kind === 'attack' && !opts.cleave) this.attackItemEffects(dealer, target, amount);
  }

  /** What items do when an attack lands: thorns on the target, sundered armor and lightning from the attacker. */
  private attackItemEffects(src: Unit | undefined, target: Unit, amount: number) {
    if (!src || src.team === target.team) return;
    const thorns = target.hero?.bonus.thornsPct ?? 0;
    if (thorns > 0 && src.alive && src.projectileSpeed === 0 && src.kind !== 'structure') {
      this.dealDamage(target.id, src, (amount * thorns) / 100, 'spell', { dot: true, reflect: true });
    }
    const b = src.hero?.bonus;
    if (!b || target.ward) return;
    if (b.sunderArmor > 0 && target.alive) this.addBuff(target, { key: 'sunder', t: SUNDER_SECONDS, armor: -b.sunderArmor });
    if (b.chainChance > 0 && target.kind !== 'structure' && this.rng.next() * 100 < b.chainChance) {
      const near = this.units
        .filter((e) => e !== target && e.alive && e.team !== src.team && e.kind !== 'structure' && !e.ward && dist(e.x, e.y, target.x, target.y) <= CHAIN_RADIUS)
        .sort((p, q) => dist(p.x, p.y, target.x, target.y) - dist(q.x, q.y, target.x, target.y))
        .slice(0, 2);
      const hit = target.alive ? [target, ...near] : near;
      if (!hit.length) return;
      this.events.push({ type: 'chainLightning', sourceId: src.id, targetIds: hit.map((e) => e.id) });
      for (const e of hit) this.dealDamage(src.id, e, CHAIN_DAMAGE, 'spell', { dot: true });
    }
  }

  private kill(u: Unit, by: Unit | undefined) {
    // A creature's kill is its owner's kill.
    const killer = by?.summon ? (this.unit(by.summon.ownerId) ?? by) : by;
    const charmAt = u.hero ? charmSlot(u) : -1;
    const charm = u.hero && (charmAt >= 0 || u.buffs.some((b) => b.key === 'charm'));
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
    const denied = killer?.kind === 'hero' && killer.team === u.team && !u.hero;
    if (denied) {
      killer!.hero!.denies++;
      this.events.push({ type: 'deny', unitId: u.id, killerId: killer!.id });
    }

    if (u.hero) {
      const h = u.hero;
      h.deaths++;
      h.respawnTimer = 3 + h.level * 1.5;
      h.order = { type: 'idle' };
      h.channel = null;
      if (charm) {
        // Revive charm: get back up on the spot after a short delay (the charm is used up).
        if (charmAt >= 0) {
          h.items[charmAt] = null;
          this.applyHeroStats(u);
        }
        h.respawnTimer = REVIVE_DELAY;
        h.reviveAt = { x: u.x, y: u.y };
      } else if (killer && killer.team !== u.team) {
        // Dying costs gold: 25 + 2.5% of net worth, only from gold in your pocket.
        let worth = h.gold + h.tpCount * TELEPORT.cost;
        for (const it of h.items) if (it) worth += ITEMS[it.id].cost * it.count;
        const lost = Math.min(Math.floor(h.gold), Math.round(DEATH_GOLD.base + worth * DEATH_GOLD.share));
        if (lost > 0) {
          h.gold -= lost;
          this.events.push({ type: 'goldLost', unitId: u.id, amount: lost });
        }
      }
      this.teamKills[otherTeam(u.team as Team)]++;
      if (killerHero) {
        const k = killerHero.hero!;
        k.kills++;
        k.streak++;
        k.multi = this.time - k.lastKillAt <= MULTI_KILL_WINDOW ? k.multi + 1 : 1;
        k.lastKillAt = this.time;
        // Shutdown bounty for ending a streak, and a first blood bonus.
        const shutdown = Math.min(400, Math.max(0, h.streak - 2) * 60);
        const firstBlood = !this.firstBlood;
        this.firstBlood = true;
        this.giveGold(killerHero, 150 + h.level * 10 + shutdown + (firstBlood ? 100 : 0));
        this.events.push({ type: 'announce', unitId: killerHero.id, victimId: u.id, firstBlood, multi: k.multi, streak: k.streak, shutdown });
      }
      h.streak = 0;
      // Assists: every other enemy hero that hurt this hero in the last 12 seconds.
      for (const [id, at] of h.damagedBy) {
        const a = this.unit(id);
        if (!a?.hero || a === killerHero || this.time - at > 12) continue;
        a.hero.assists++;
        this.giveGold(a, 40 + h.level * 4);
      }
      h.damagedBy.clear();
      this.shareXp(u, 100 + h.level * 25);
    } else if (u.creep) {
      if (killerHero) {
        killerHero.hero!.lastHits++;
        this.giveGold(killerHero, u.bountyGold);
      }
      this.shareXp(u, denied ? u.bountyXp * DENY_XP_SHARE : u.bountyXp);
    } else if (u.ward) {
      if (killerHero) this.giveGold(killerHero, u.bountyGold);
    } else if (u.neutral?.boss) {
      const team = killer && killer.team !== 2 ? killer.team : null;
      this.bossRespawnAt = this.time + BOSS_RESPAWN[0] + this.rng.next() * (BOSS_RESPAWN[1] - BOSS_RESPAWN[0]);
      this.events.push({ type: 'bossKilled', killerId: killer?.id ?? null, team: team ?? 2 });
      if (team !== null) {
        // The killing blow takes the full reward, teammates get half.
        for (const ally of this.units) if (ally.hero && ally.team === team) this.giveGold(ally, ally === killerHero ? WARDEN_GOLD : WARDEN_GOLD / 2);
        this.shareXp(u, u.bountyXp, team);
      }
      // The revive charm drops where the Warden fell: whoever grabs it first (either team) keeps it.
      this.groundItems.push({
        id: this.newId(),
        item: { id: 'wardenCharm', count: 1, expiresAt: this.time + CHARM_DURATION },
        x: u.x,
        y: u.y,
        ownerId: -1,
        team: 2,
        droppedAt: this.time,
      });
    } else if (u.summon) {
      if (killerHero) {
        this.giveGold(killerHero, u.bountyGold);
        this.shareXp(u, u.bountyXp, killerHero.team);
      }
    } else if (u.neutral) {
      if (killerHero) {
        killerHero.hero!.lastHits++;
        this.giveGold(killerHero, u.bountyGold);
        this.shareXp(u, u.bountyXp, killerHero.team);
      }
    } else if (u.structure) {
      const tier = u.structure.tier;
      for (const h of this.units) {
        // A denied tower only pays the enemy half.
        if (h.hero && h.team !== u.team) this.giveGold(h, Math.round((u.structure!.rax ? BARRACKS[u.structure!.rax].teamGold : STRUCTURES[tier].teamGold) * (denied ? 0.5 : 1)));
      }
      this.refreshVulnerability();
      this.rebuildNav();
      if (tier === 'shrine') {
        this.winner = otherTeam(u.team as Team);
        this.events.push({ type: 'gameOver', winner: this.winner });
      }
    }
  }

  giveGold(h: Unit, amount: number) {
    h.hero!.gold += amount;
    h.hero!.goldEarned += amount;
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
   *  - Tier 2 tower of a lane: after that lane's tier 1 falls.
   *  - Tier 3 tower + barracks of a lane: after that lane's tier 2 falls.
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
          st.vulnerable = this.findStructure(s.team, 'tower1', st.lane).every((t) => !t.alive);
          break;
        case 'tower3':
        case 'barracks':
          st.vulnerable = this.findStructure(s.team, 'tower2', st.lane).every((t) => !t.alive);
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
    const cw = this.courierNav.walkable;
    for (let i = 0; i < cw.length; i++) cw[i] = this.nav.walkable[i] & this.courierLand[i];
  }

  /**
   * Move up to `d` meters in direction (dx, dy), sliding along walls.
   * `throughBuildings` (dashes) only respects trees/walls; the unit is pushed out of
   * any building it ends up overlapping by the collision pass.
   */
  stepMove(u: Unit, dx: number, dy: number, d: number, throughBuildings = false) {
    const l = Math.hypot(dx, dy);
    if (l === 0 || d <= 0) return;
    dx /= l;
    dy /= l;
    u.facing = Math.atan2(dy, dx);
    const nav = throughBuildings ? this.map : this.nav;
    // If we're already squeezed against a wall/footprint, only require the centre to be
    // walkable so the unit can always work itself free.
    // On a mountain top you can only move around up there; nobody walks up or down.
    const high = onHillTop(this, u.x, u.y);
    const ok = high
      ? (x: number, y: number) => onHillTop(this, x, y)
      : fits(nav, u.x, u.y, u.radius)
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
    const x0 = u.x;
    const y0 = u.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (ok(nx, u.y)) u.x = nx;
      else if (ok(u.x, ny)) u.y = ny;
    } else {
      if (ok(u.x, ny)) u.y = ny;
      else if (ok(nx, u.y)) u.x = nx;
    }
    if (Math.abs(u.x - x0) + Math.abs(u.y - y0) > 1e-6) return;
    // Still blocked (e.g. heading straight along a building's edge): try angled directions.
    for (const a of [0.6, -0.6, 1.1, -1.1]) {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const tx = u.x + (dx * c - dy * sn) * d;
      const ty = u.y + (dx * sn + dy * c) * d;
      if (ok(tx, ty)) {
        u.x = tx;
        u.y = ty;
        return;
      }
    }
  }

  /**
   * Creep / neutral movement: walk straight while the way ahead is open, and fall back
   * to pathfinding around towers, barracks and trees when it isn't.
   */
  private steerTo(u: Unit, x: number, y: number) {
    const d = dist(u.x, u.y, x, y);
    if (d < 0.05) return;
    if (this.goingAround(u, x, y)) return;
    const look = Math.min(d, 10);
    const ahead = { x: u.x + ((x - u.x) / d) * look, y: u.y + ((y - u.y) / d) * look };
    if (!u.path && lineClear(this.nav, u, ahead, u.radius * 0.8)) {
      this.stepMove(u, x - u.x, y - u.y, Math.min(d, this.speedOf(u) * DT));
      return;
    }
    if (this.navigate(u, x, y, 0) || (u.path && lineClear(this.nav, u, { x, y }, u.radius * 0.8))) u.path = null;
  }

  /**
   * Everything that isn't a human's hero notices when it has stopped getting anywhere (a building,
   * a corner, a crowd) and walks around: a fresh path, or a side-step if that doesn't help. It only
   * stands still if there is truly nowhere to go. Returns true while it is doing that.
   */
  private goingAround(u: Unit, x: number, y: number): boolean {
    if (u.hero?.controller === 'human') return false;
    const now = this.time;
    const w = u.stuckWatch;
    if (!w || now - w.last > 0.6) {
      u.stuckWatch = { t: now, last: now, x: u.x, y: u.y, until: w?.until ?? 0, side: w?.side ?? 1 };
    } else {
      w.last = now;
      if (now - w.t >= 0.5) {
        if (now >= w.until && dist(u.x, u.y, w.x, w.y) < this.speedOf(u) * 0.5 * 0.2) {
          w.until = now + 1.5;
          w.side = -w.side;
          u.path = findPath(this.nav, u, { x, y }, u.radius);
          u.pathGoal = { x, y };
          u.repathAt = now + 1.5;
        }
        w.t = now;
        w.x = u.x;
        w.y = u.y;
      }
    }
    const s = u.stuckWatch!;
    if (now >= s.until) return false;
    const step = this.speedOf(u) * DT;
    while (u.path && u.path.length > 1 && dist(u.x, u.y, u.path[0].x, u.path[0].y) < 0.6) u.path.shift();
    if (u.path?.length && dist(u.x, u.y, u.path[0].x, u.path[0].y) >= 0.6) {
      this.stepMove(u, u.path[0].x - u.x, u.path[0].y - u.y, step);
    } else {
      const d = dist(u.x, u.y, x, y) || 1;
      this.stepMove(u, (-(y - u.y) / d) * s.side, ((x - u.x) / d) * s.side, step);
    }
    return true;
  }

  /** Path-following movement (heroes). Returns true on arrival. */
  navigate(u: Unit, x: number, y: number, arriveDist: number): boolean {
    const d = dist(u.x, u.y, x, y);
    if (d <= arriveDist + 0.05) {
      u.path = null;
      return true;
    }
    if (this.goingAround(u, x, y)) return false;
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
    const movers = this.units.filter((u) => u.alive && u.kind !== 'structure' && u.kind !== 'ward');
    const solids = this.units.filter((u) => u.alive && u.kind === 'structure');
    for (let i = 0; i < movers.length; i++) {
      const a = movers[i];
      for (let j = i + 1; j < movers.length; j++) {
        const b = movers[j];
        // Jungle monsters only bump into each other, so they never wall off a corridor.
        if ((a.kind === 'neutral') !== (b.kind === 'neutral')) continue;
        // Allied heroes walk through each other: one standing by a wall could otherwise block a
        // teammate for good in a narrow spot.
        if (a.hero && b.hero && a.team === b.team) continue;
        // Gale Step goes straight through whoever is in the way.
        if (a.dash?.phase || b.dash?.phase) continue;
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
        if (a.dash) continue; // dashing through; pushed out once the dash ends
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
