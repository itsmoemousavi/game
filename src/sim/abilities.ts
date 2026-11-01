import { AbilityDef, AbilityId, HEROES } from './data/heroes';
import { dist } from './math';
import type { DamageKind, Order, Unit, World } from './world';

/**
 * Ability behaviour. Numbers live in data/heroes.ts; this file is the "how".
 * Every ability is cast through `castAbility`, for humans and bots alike.
 */

export type CastResult = 'cast' | 'approach' | 'fail';

export interface CastRequest {
  slot: number;
  targetId?: number;
  x?: number;
  y?: number;
}

const CAST_POINT = 0.15;

export function abilityDef(u: Unit, slot: number): AbilityDef | undefined {
  return u.hero ? HEROES[u.hero.defId].abilities[slot] : undefined;
}

/** Level of an ability by id (0 if the hero doesn't have it or hasn't learned it). */
export function abilityLevel(u: Unit, id: AbilityId): number {
  if (!u.hero) return 0;
  const i = HEROES[u.hero.defId].abilities.findIndex((a) => a.id === id);
  return i < 0 ? 0 : u.hero.abilities[i].level;
}

const val = (def: AbilityDef, key: string, level: number) => def.values[key][level - 1];

/** Crown of Ascension: ultimates hit 25% harder. */
const ultMult = (u: Unit, def: AbilityDef) => (def.ultimate && u.hero?.bonus.ultUpgrade ? 1.25 : 1);

/** Final cooldown after item cooldown reduction (and the Crown for ultimates). */
export function effectiveCooldown(u: Unit, def: AbilityDef, level: number): number {
  const b = u.hero!.bonus;
  return def.cooldown[level - 1] * (1 - b.cdrPct / 100) * (def.ultimate && b.ultUpgrade ? 0.7 : 1);
}

/** Why an ability can't be used right now, or null if it can. */
export function castBlocker(u: Unit, slot: number): 'unlearned' | 'passive' | 'cooldown' | 'mana' | 'stunned' | null {
  const def = abilityDef(u, slot);
  const st = u.hero?.abilities[slot];
  if (!def || !st || st.level === 0) return 'unlearned';
  if (def.targeting === 'passive') return 'passive';
  if (st.cooldown > 0) return 'cooldown';
  if (u.mana < def.manaCost[st.level - 1]) return 'mana';
  if (!u.alive || u.stunTimer > 0 || u.dash) return 'stunned';
  return null;
}

/** Fill in a target when the player just tapped the button (mobile quick-cast). */
function autoTarget(w: World, u: Unit, def: AbilityDef, req: CastRequest) {
  const byDist = (a: Unit, b: Unit) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y);
  const enemies = (r: number) =>
    w.units.filter(
      (e) => e.alive && e.team !== u.team && e.kind !== 'structure' && w.canSee(u.team, e) && dist(u.x, u.y, e.x, e.y) <= r + e.radius,
    );

  switch (def.targeting) {
    case 'enemy':
      if (req.targetId === undefined) {
        const r = def.castRange + 3;
        const t = enemies(r).filter((e) => e.kind === 'hero').sort(byDist)[0] ?? enemies(def.castRange).sort(byDist)[0];
        if (t) req.targetId = t.id;
      }
      break;
    case 'ally':
      if (req.targetId === undefined) {
        const allies = w.units.filter(
          (a) => a.alive && a.hero && a.team === u.team && dist(u.x, u.y, a.x, a.y) <= def.castRange,
        );
        allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
        req.targetId = (allies[0] ?? u).id;
      }
      break;
    case 'direction':
    case 'point':
      if (req.x === undefined || req.y === undefined) {
        const t = enemies(def.castRange + 2).filter((e) => e.kind === 'hero').sort(byDist)[0] ?? enemies(def.castRange).sort(byDist)[0];
        if (t) {
          req.x = t.x;
          req.y = t.y;
        } else {
          req.x = u.x + Math.cos(u.facing) * def.castRange;
          req.y = u.y + Math.sin(u.facing) * def.castRange;
        }
      }
      break;
  }
}

/**
 * Try to cast. Returns 'approach' when the target is out of range; the caller then
 * stores a cast order and the hero walks into range (see `resolveCast`).
 */
export function castAbility(w: World, u: Unit, slot: number, req: CastRequest): CastResult {
  if (castBlocker(u, slot)) return 'fail';
  if (u.castLock > 0) return 'fail';
  const def = abilityDef(u, slot)!;
  autoTarget(w, u, def, req);

  if (def.targeting === 'enemy' || def.targeting === 'ally') {
    const t = w.unit(req.targetId);
    if (!t || !t.alive || t.kind === 'structure') return 'fail';
    if (def.targeting === 'enemy' && t.team === u.team) return 'fail';
    if (def.targeting === 'ally' && (t.team !== u.team || !t.hero)) return 'fail';
    if (dist(u.x, u.y, t.x, t.y) > def.castRange + u.radius + t.radius) return 'approach';
    execute(w, u, slot, def, t.x, t.y, t);
    return 'cast';
  }

  let x = req.x ?? u.x;
  let y = req.y ?? u.y;
  if (def.targeting === 'point') {
    // Mobile-friendly: clamp ground targets to max range instead of walking.
    const d = dist(u.x, u.y, x, y);
    if (d > def.castRange) {
      x = u.x + ((x - u.x) / d) * def.castRange;
      y = u.y + ((y - u.y) / d) * def.castRange;
    }
  }
  execute(w, u, slot, def, x, y, undefined);
  return 'cast';
}

/** Continue a cast order: walk toward the target until in range, then cast. */
export function resolveCast(w: World, u: Unit, o: Extract<Order, { type: 'cast' }>): CastResult {
  const def = abilityDef(u, o.slot);
  if (!def || castBlocker(u, o.slot)) return 'fail';
  const t = w.unit(o.targetId);
  if (!t || !t.alive) return 'fail';
  const r = castAbility(w, u, o.slot, { slot: o.slot, targetId: o.targetId });
  if (r === 'approach') w.navigate(u, t.x, t.y, def.castRange + u.radius + t.radius - 0.5);
  return r;
}

function execute(w: World, u: Unit, slot: number, def: AbilityDef, x: number, y: number, target: Unit | undefined) {
  const h = u.hero!;
  const st = h.abilities[slot];
  const lvl = st.level;
  w.breakInvisibility(u);
  w.reveal(u);
  u.mana -= def.manaCost[lvl - 1];
  st.cooldown = effectiveCooldown(u, def, lvl);
  const m = ultMult(u, def);
  u.castLock = CAST_POINT;
  u.path = null;
  const dx = x - u.x;
  const dy = y - u.y;
  const len = Math.hypot(dx, dy) || 1;
  if (len > 0.01) u.facing = Math.atan2(dy, dx);
  w.events.push({ type: 'cast', unitId: u.id, slot });

  switch (def.id) {
    case 'shieldCharge':
      u.castLock = 0;
      u.dash = {
        dx: dx / len,
        dy: dy / len,
        speed: 30,
        remaining: def.castRange,
        damage: val(def, 'damage', lvl),
        stun: val(def, 'stun', lvl),
        hit: [],
      };
      break;
    case 'earthsplitter': {
      const windup = val(def, 'windup', lvl);
      u.castLock = windup;
      w.blasts.push({
        id: w.newId(),
        kind: 'earthsplitter',
        team: u.team,
        sourceId: u.id,
        x: u.x,
        y: u.y,
        radius: def.radius,
        t: 0,
        delay: windup,
        damage: val(def, 'damage', lvl) * m,
        stun: val(def, 'stun', lvl),
      });
      break;
    }
    case 'piercingArrow':
      w.skillshots.push({
        id: w.newId(),
        kind: 'piercingArrow',
        team: u.team,
        sourceId: u.id,
        x: u.x,
        y: u.y,
        px: u.x,
        py: u.y,
        dx: dx / len,
        dy: dy / len,
        speed: 34,
        remaining: def.castRange,
        width: def.radius * 2,
        damage: val(def, 'damage', lvl),
        hit: [],
      });
      break;
    case 'arrowStorm':
      w.zones.push({
        id: w.newId(),
        kind: 'arrowStorm',
        team: u.team,
        sourceId: u.id,
        x,
        y,
        radius: def.radius,
        t: 0,
        duration: val(def, 'duration', lvl),
        dps: val(def, 'dps', lvl) * m,
        slowPct: val(def, 'slowPct', lvl),
      });
      break;
    case 'fireball':
      w.skillshots.push({
        id: w.newId(),
        kind: 'fireball',
        team: u.team,
        sourceId: u.id,
        x: u.x,
        y: u.y,
        px: u.x,
        py: u.y,
        dx: dx / len,
        dy: dy / len,
        speed: 24,
        remaining: def.castRange,
        width: 1.4,
        damage: val(def, 'damage', lvl),
        hit: [],
        explode: def.radius,
      });
      break;
    case 'mendingFlame': {
      const dur = val(def, 'duration', lvl);
      w.addBuff(target!, { key: 'mendingFlame', t: dur, healPerSec: val(def, 'heal', lvl) / dur, sourceId: u.id });
      w.events.push({ type: 'heal', unitId: target!.id, amount: val(def, 'heal', lvl) });
      break;
    }
    case 'shadowLunge': {
      // Land right next to the target (on our side of it) and strike.
      const t = target!;
      const d = Math.hypot(t.x - u.x, t.y - u.y) || 1;
      const off = t.radius + u.radius + 0.2;
      const lx = t.x - ((t.x - u.x) / d) * off;
      const ly = t.y - ((t.y - u.y) / d) * off;
      w.events.push({ type: 'blink', unitId: u.id, fromX: u.x, fromY: u.y });
      u.x = u.px = lx;
      u.y = u.py = ly;
      u.facing = Math.atan2(t.y - u.y, t.x - u.x);
      w.dealDamage(u.id, t, val(def, 'damage', lvl), 'spell');
      u.hero!.order = { type: 'attack', targetId: t.id };
      break;
    }
    case 'veil': {
      const dur = val(def, 'duration', lvl);
      // Cast first, then vanish (casting itself would reveal).
      u.revealUntil = 0;
      w.addBuff(u, { key: 'veil', t: dur, invisible: true, moveSpeedPct: val(def, 'speedPct', lvl) });
      break;
    }
    case 'execution': {
      const t = target!;
      const missing = t.maxHp - t.hp;
      w.dealDamage(u.id, t, val(def, 'damage', lvl) * m + (missing * val(def, 'missingPct', lvl)) / 100, 'spell');
      w.events.push({ type: 'explosion', x: t.x, y: t.y, radius: 1.5 });
      break;
    }
    case 'rootSnare':
      w.blasts.push({
        id: w.newId(),
        kind: 'rootSnare',
        team: u.team,
        sourceId: u.id,
        x,
        y,
        radius: def.radius,
        t: 0,
        delay: 0.4,
        damage: val(def, 'damage', lvl),
        stun: val(def, 'stun', lvl),
      });
      break;
    case 'barkSkin':
      w.addBuff(u, { key: 'barkSkin', t: val(def, 'duration', lvl), armor: val(def, 'armor', lvl), healPerSec: val(def, 'regen', lvl) });
      break;
    case 'overgrowth':
      w.blasts.push({
        id: w.newId(),
        kind: 'overgrowth',
        team: u.team,
        sourceId: u.id,
        x: u.x,
        y: u.y,
        radius: def.radius,
        t: 0,
        delay: 0.1,
        damage: 0,
        stun: val(def, 'stun', lvl),
        burn: { dps: val(def, 'dps', lvl) * m, duration: val(def, 'duration', lvl) },
      });
      break;
    case 'tidalWave':
      w.skillshots.push({
        id: w.newId(),
        kind: 'tidalWave',
        team: u.team,
        sourceId: u.id,
        x: u.x,
        y: u.y,
        px: u.x,
        py: u.y,
        dx: dx / len,
        dy: dy / len,
        speed: 22,
        remaining: def.castRange,
        width: def.radius * 2,
        damage: val(def, 'damage', lvl),
        hit: [],
        slow: { pct: val(def, 'slowPct', lvl), t: 2 },
      });
      break;
    case 'brineVeil': {
      const t = target!;
      w.heal(t, val(def, 'heal', lvl));
      u.hero!.stats.healing += val(def, 'heal', lvl);
      w.addBuff(t, { key: 'brineVeil', t: 5, armor: val(def, 'armor', lvl), moveSpeedPct: val(def, 'speedPct', lvl) });
      w.events.push({ type: 'heal', unitId: t.id, amount: val(def, 'heal', lvl) });
      break;
    }
    case 'maelstrom':
      w.zones.push({
        id: w.newId(),
        kind: 'maelstrom',
        team: u.team,
        sourceId: u.id,
        x,
        y,
        radius: def.radius,
        t: 0,
        duration: val(def, 'duration', lvl),
        dps: val(def, 'dps', lvl) * m,
        slowPct: val(def, 'slowPct', lvl),
      });
      break;
    case 'cataclysm':
      w.blasts.push({
        id: w.newId(),
        kind: 'cataclysm',
        team: u.team,
        sourceId: u.id,
        x,
        y,
        radius: def.radius,
        t: 0,
        delay: val(def, 'delay', lvl),
        damage: val(def, 'damage', lvl) * m,
        stun: 0,
        burn: { dps: val(def, 'burnDps', lvl) * m, duration: val(def, 'burnDuration', lvl) },
      });
      break;
    case 'ironHide':
    case 'huntersRhythm':
      break;
  }
}

// ------------------------------------------------------------------ passives

/** Called on every attack; returns the damage this attack deals. */
export function applyAttackPassives(w: World, u: Unit, target?: Unit): number {
  if (!u.hero) return u.damage;
  u.hero.attackCount++;
  const lvl = abilityLevel(u, 'huntersRhythm');
  // Critical hits don't work on buildings (keeps Vexa from out-pushing everyone).
  if (lvl > 0 && u.hero.attackCount % 4 === 0 && target?.kind !== 'structure') {
    const def = HEROES.vexa.abilities[1];
    w.addBuff(u, { key: 'huntersRhythm', t: 1.5, moveSpeedPct: val(def, 'speedPct', lvl) });
    u.hero.lastCrit = true;
    return u.damage * val(def, 'critMult', lvl);
  }
  u.hero.lastCrit = false;
  return u.damage;
}

/** Adjusts incoming damage for the target's passives. */
export function damageAfterPassives(_w: World, target: Unit, amount: number, kind: DamageKind): number {
  const lvl = abilityLevel(target, 'ironHide');
  if (lvl > 0 && kind === 'attack') {
    const block = val(HEROES.brakk.abilities[1], 'block', lvl);
    return Math.max(amount * 0.4, amount - block);
  }
  return amount;
}

/** Armor granted by passives right now. */
export function passiveArmor(u: Unit): number {
  const lvl = abilityLevel(u, 'ironHide');
  if (lvl > 0 && u.hp < u.maxHp * 0.5) return val(HEROES.brakk.abilities[1], 'lowHpArmor', lvl);
  return 0;
}

/** Bots: spend skill points (ultimate first, then the lower of Q/W, Q on ties). */
export function botLearn(w: World, u: Unit) {
  const h = u.hero!;
  let guard = 0;
  while (h.skillPoints > 0 && guard++ < 5) {
    const before = h.skillPoints;
    for (const slot of [2, 0, 1].sort((a, b) => (a === 2 ? -1 : b === 2 ? 1 : h.abilities[a].level - h.abilities[b].level))) {
      w.applyCommand({ type: 'learn', unitId: u.id, slot });
      if (h.skillPoints < before) break;
    }
    if (h.skillPoints === before) break;
  }
}
