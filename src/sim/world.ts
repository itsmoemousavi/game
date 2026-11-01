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
  Team,
  XP_SHARE_RADIUS,
  XP_TABLE,
  otherTeam,
} from './constants';
import { HEROES, HeroId } from './data/heroes';
import { CREEPS, STRUCTURES, SUPER_CREEP_MULT } from './data/units';
import { GameMap, LaneId, StructureTier, createMap, fits, lineClear, teamLanePath } from './map';
import { Vec2, dist, distV } from './math';
import { findPath } from './pathfinding';
import { Rng } from './rng';
import { botThink } from './ai/bots';

export type UnitKind = 'hero' | 'creep' | 'structure';
export type Controller = 'human' | 'bot';

export type Order =
  | { type: 'idle' }
  | { type: 'dir'; dx: number; dy: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'attack'; targetId: number };

/** Every way a player (human or bot, local or remote) can influence the game. */
export type Command =
  | { type: 'moveDir'; unitId: number; dx: number; dy: number }
  | { type: 'moveTo'; unitId: number; x: number; y: number }
  | { type: 'attack'; unitId: number; targetId: number }
  | { type: 'attackNearest'; unitId: number }
  | { type: 'stop'; unitId: number };

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
  bot: { thinkTimer: number; retreating: boolean };
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
  team: Team;
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
  targetId: number | null;
  facing: number;
  path: Vec2[] | null;
  pathGoal: Vec2 | null;
  repathAt: number;
  hero?: HeroState;
  creep?: CreepState;
  structure?: StructureState;
}

export interface Projectile {
  id: number;
  team: Team;
  x: number;
  y: number;
  px: number;
  py: number;
  sourceId: number;
  targetId: number;
  speed: number;
  damage: number;
}

export type GameEvent =
  | { type: 'attack'; sourceId: number; targetId: number }
  | { type: 'death'; unitId: number; killerId: number | null }
  | { type: 'gold'; unitId: number; amount: number }
  | { type: 'levelUp'; unitId: number; level: number }
  | { type: 'gameOver'; winner: Team };

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
  readonly rng: Rng;
  tick = 0;
  time = 0;
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  events: GameEvent[] = [];
  winner: Team | null = null;
  teamKills: [number, number] = [0, 0];
  private nextId = 1;
  private nextWave = FIRST_WAVE_TIME;
  private pending: Command[] = [];
  private byId = new Map<number, Unit>();

  constructor(opts: WorldOptions) {
    this.map = opts.map ?? createMap();
    this.rng = new Rng(opts.seed);
    for (const s of this.map.structures) this.spawnStructure(s.team, s.tier, s.lane, s.pos);
    this.refreshVulnerability();
    opts.slots.forEach((slot, i) => this.spawnHero(slot, i));
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

  findStructure(team: Team, tier: StructureTier, lane: LaneId | null = null): Unit[] {
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
    if (!u || !u.hero || !u.alive) return;
    const h = u.hero;
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
      case 'attack':
        if (this.canAttack(u, this.unit(cmd.targetId))) h.order = { type: 'attack', targetId: cmd.targetId };
        break;
      case 'attackNearest': {
        const t = this.pickAutoTarget(u);
        h.order = t ? { type: 'attack', targetId: t.id } : { type: 'idle' };
        break;
      }
      case 'stop':
        h.order = { type: 'idle' };
        break;
    }
  }

  /** Mobile "attack button" targeting: enemy hero first, then nearest anything. */
  pickAutoTarget(u: Unit): Unit | undefined {
    const reach = Math.max(u.attackRange + 4, 8);
    const near = this.enemiesNear(u, u.x, u.y, reach);
    const byDist = (a: Unit, b: Unit) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y);
    const heroes = near.filter((e) => e.kind === 'hero').sort(byDist);
    if (heroes.length) return heroes[0];
    if (near.length) return near.sort(byDist)[0];
    return this.enemiesNear(u, u.x, u.y, 14).sort(byDist)[0];
  }

  // ---------------------------------------------------------------- spawning

  private newUnit(kind: UnitKind, team: Team, pos: Vec2, s: (typeof CREEPS)['melee']): Unit {
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
      targetId: null,
      facing: team === 0 ? -Math.PI / 4 : (3 * Math.PI) / 4,
      path: null,
      pathGoal: null,
      repathAt: 0,
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
      bot: { thinkTimer: (index % 6) * 0.05, retreating: false },
    };
    this.applyHeroStats(u, true);
  }

  private respawnPoint(team: Team, index: number): Vec2 {
    const f = this.map.fountains[team];
    const a = (index % 3) * ((2 * Math.PI) / 3);
    const dir = team === 0 ? 1 : -1;
    return { x: f.x + dir * (5 + Math.cos(a) * 1.5), y: f.y - dir * (5 + Math.sin(a) * 1.5) };
  }

  /** Recompute hero stats from definition + level (items will hook in here). */
  applyHeroStats(u: Unit, fill = false) {
    const h = u.hero!;
    const def = HEROES[h.defId];
    const lv = h.level - 1;
    const oldMax = u.maxHp;
    const oldMana = u.maxMana;
    u.maxHp = def.baseHp + def.hpPerLevel * lv;
    u.maxMana = def.baseMana + def.manaPerLevel * lv;
    u.hpRegen = def.hpRegen + 0.15 * lv;
    u.manaRegen = def.manaRegen + 0.1 * lv;
    u.armor = def.baseArmor + def.armorPerLevel * lv;
    u.damage = def.baseDamage + def.damagePerLevel * lv;
    u.attackInterval = Math.max(0.6, def.attackInterval - def.attackIntervalPerLevel * lv);
    if (fill) {
      u.hp = u.maxHp;
      u.mana = u.maxMana;
    } else {
      u.hp += u.maxHp - oldMax;
      u.mana += u.maxMana - oldMana;
    }
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

    for (const u of this.units) {
      if (u.attackTimer > 0) u.attackTimer -= DT;
      if (u.hero) this.updateHeroUpkeep(u);
    }
    for (const u of this.units) {
      if (!u.alive) continue;
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
      else if (u.structure) this.updateStructure(u);
    }
    this.updateProjectiles();
    this.separate();

    // Drop dead creeps; heroes respawn and structures stay as ruins.
    this.units = this.units.filter((u) => {
      if (u.kind === 'creep' && !u.alive) {
        this.byId.delete(u.id);
        return false;
      }
      return true;
    });
  }

  private updateHeroUpkeep(u: Unit) {
    const h = u.hero!;
    h.gold += PASSIVE_GOLD_PER_SEC * DT;
    if (!u.alive) {
      h.respawnTimer -= DT;
      if (h.respawnTimer <= 0) {
        const p = this.respawnPoint(u.team, h.slot);
        u.x = u.px = p.x;
        u.y = u.py = p.y;
        u.alive = true;
        u.hp = u.maxHp;
        u.mana = u.maxMana;
        u.path = null;
        h.order = { type: 'idle' };
        h.bot.retreating = false;
      }
      return;
    }
    const f = this.map.fountains[u.team];
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
        this.stepMove(u, o.dx, o.dy, u.moveSpeed * DT);
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
      case 'idle': {
        // Auto-attack anything already in range, without chasing.
        let t = this.unit(u.targetId);
        if (!this.canAttack(u, t) || !this.inReach(u, t)) {
          t = this.enemiesNear(u, u.x, u.y, u.attackRange + u.radius + 0.3).sort(
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
      t = this.enemiesNear(u, u.x, u.y, u.acquireRange).sort(
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
      const near = this.enemiesNear(u, u.x, u.y, u.attackRange + u.radius, (e) => e.kind !== 'structure');
      const byDist = (a: Unit, b: Unit) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y);
      // Towers prefer creeps; heroes are hit when alone or when they attack an allied hero.
      t = near.filter((e) => e.kind === 'creep').sort(byDist)[0] ?? near.sort(byDist)[0];
    }
    u.targetId = t ? t.id : null;
    if (t) this.tryAttack(u, t);
  }

  private updateProjectiles() {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const t = this.unit(p.targetId);
      if (!t || !t.alive) continue;
      const d = dist(p.x, p.y, t.x, t.y);
      const step = p.speed * DT;
      if (d <= step + t.radius * 0.5) {
        this.dealDamage(p.sourceId, t, p.damage);
        continue;
      }
      p.x += ((t.x - p.x) / d) * step;
      p.y += ((t.y - p.y) / d) * step;
      keep.push(p);
    }
    this.projectiles = keep;
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
        damage: u.damage,
      });
    } else {
      this.dealDamage(u.id, t, u.damage);
    }
    return true;
  }

  dealDamage(sourceId: number, target: Unit, raw: number) {
    if (!target.alive) return;
    if (target.structure && !target.structure.vulnerable) return;
    const src = this.unit(sourceId);
    const amount = raw * armorMultiplier(target.armor);
    target.hp -= amount;

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
    this.events.push({ type: 'death', unitId: u.id, killerId: killer?.id ?? null });
    const killerHero = killer?.kind === 'hero' && killer.team !== u.team ? killer : undefined;

    if (u.hero) {
      const h = u.hero;
      h.deaths++;
      h.respawnTimer = 4 + h.level * 2;
      h.order = { type: 'idle' };
      this.teamKills[otherTeam(u.team)]++;
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
    } else if (u.structure) {
      const tier = u.structure.tier;
      for (const h of this.units) {
        if (h.hero && h.team !== u.team) this.giveGold(h, STRUCTURES[tier].teamGold);
      }
      this.refreshVulnerability();
      if (tier === 'shrine') {
        this.winner = otherTeam(u.team);
        this.events.push({ type: 'gameOver', winner: this.winner });
      }
    }
  }

  private giveGold(h: Unit, amount: number) {
    h.hero!.gold += amount;
    this.events.push({ type: 'gold', unitId: h.id, amount });
  }

  private shareXp(dead: Unit, amount: number) {
    const receivers = this.units.filter(
      (h) => h.hero && h.alive && h.team !== dead.team && dist(h.x, h.y, dead.x, dead.y) <= XP_SHARE_RADIUS,
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

  /** Move up to `d` meters in direction (dx, dy), sliding along walls. */
  stepMove(u: Unit, dx: number, dy: number, d: number) {
    const l = Math.hypot(dx, dy);
    if (l === 0 || d <= 0) return;
    dx /= l;
    dy /= l;
    [dx, dy] = this.avoidStructures(u, dx, dy);
    u.facing = Math.atan2(dy, dx);
    const m = this.map;
    const nx = u.x + dx * d;
    const ny = u.y + dy * d;
    if (fits(m, nx, ny, u.radius)) {
      u.x = nx;
      u.y = ny;
      return;
    }
    // Slide along the wall: keep whichever axis component is free.
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (fits(m, nx, u.y, u.radius)) u.x = nx;
      else if (fits(m, u.x, ny, u.radius)) u.y = ny;
    } else {
      if (fits(m, u.x, ny, u.radius)) u.y = ny;
      else if (fits(m, nx, u.y, u.radius)) u.x = nx;
    }
  }

  /** Bend a movement direction around any living structure directly ahead. */
  private avoidStructures(u: Unit, dx: number, dy: number): [number, number] {
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
      // Steer along the tangent on the side we're already leaning toward.
      const sgn = side >= 0 ? 1 : -1;
      const tx = (-ry / d) * sgn;
      const ty = (rx / d) * sgn;
      return [tx, ty];
    }
    return [dx, dy];
  }

  /** Straight-line steering (used by creeps, which live in open lanes). */
  private steerTo(u: Unit, x: number, y: number) {
    const d = dist(u.x, u.y, x, y);
    if (d < 0.05) return;
    this.stepMove(u, x - u.x, y - u.y, Math.min(d, u.moveSpeed * DT));
  }

  /** Path-following movement (heroes). Returns true on arrival. */
  navigate(u: Unit, x: number, y: number, arriveDist: number): boolean {
    const d = dist(u.x, u.y, x, y);
    if (d <= arriveDist + 0.05) {
      u.path = null;
      return true;
    }
    const step = u.moveSpeed * DT;
    if (lineClear(this.map, u, { x, y }, u.radius * 0.7)) {
      u.path = null;
      this.stepMove(u, x - u.x, y - u.y, Math.min(step, d));
      return false;
    }
    if (!u.path || !u.pathGoal || distV(u.pathGoal, { x, y }) > 2 || this.time >= u.repathAt) {
      u.path = findPath(this.map, u, { x, y }, u.radius * 0.7);
      u.pathGoal = { x, y };
      u.repathAt = this.time + 1;
    }
    if (!u.path || u.path.length === 0) {
      this.stepMove(u, x - u.x, y - u.y, Math.min(step, d));
      return false;
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
