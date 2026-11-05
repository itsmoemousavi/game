import {
  BACKDOOR_RADIUS,
  BACKDOOR_REGEN,
  BOSS_RESPAWN,
  BUYBACK_COOLDOWN,
  DT,
  GLYPH_COOLDOWN,
  GLYPH_DURATION,
  RUNE_INTERVAL,
  Team,
  WARD_CAST_RANGE,
  WARD_DURATION,
  buybackCost,
  WARDEN_MOVE_SECONDS,
} from './constants';
import { BOSS, WARDS } from './data/units';
import { inHouse, isWalkable } from './map';
import { dist } from './math';
import { isNight } from './vision';
import type { Unit, World } from './world';

/**
 * Map objectives and team mechanics: river power-ups (runes), the boss, wards,
 * buyback, the team tower shield (glyph) and backdoor protection.
 */

export type RuneKind = 'haste' | 'doubleDamage' | 'regen' | 'invisibility' | 'bounty';
export const RUNE_KINDS: RuneKind[] = ['haste', 'doubleDamage', 'regen', 'invisibility', 'bounty'];

export const RUNE_INFO: Record<RuneKind, { name: string; color: string; summary: string }> = {
  haste: { name: 'Haste', color: '#ff5d5d', summary: 'Maximum move speed for 15 s' },
  doubleDamage: { name: 'Double Damage', color: '#4aa8ff', summary: 'Double attack damage for 25 s' },
  regen: { name: 'Regeneration', color: '#4ade80', summary: 'Rapid health and mana regeneration for 15 s' },
  invisibility: { name: 'Invisibility', color: '#c4b5fd', summary: 'Invisible for 20 s (attacking or casting reveals you)' },
  bounty: { name: 'Bounty', color: '#ffd23f', summary: 'Gold for you and your team' },
};

export interface Rune {
  id: number;
  kind: RuneKind;
  x: number;
  y: number;
}

/** Called once per tick from World.step. */
export function updateObjectives(w: World) {
  // Power-ups: replace whatever is on the map on schedule.
  if (w.time >= w.nextRune) {
    w.runes = [];
    const spot = w.map.runeSpots[Math.floor(w.rng.next() * 2)];
    const kind = RUNE_KINDS[Math.floor(w.rng.next() * RUNE_KINDS.length)];
    w.runes.push({ id: w.newId(), kind, x: spot.x, y: spot.y });
    w.nextRune += RUNE_INTERVAL;
  }
  if (w.runes.length) {
    for (const h of w.units) {
      if (!h.hero || !h.alive) continue;
      const r = w.runes.find((q) => dist(q.x, q.y, h.x, h.y) < h.radius + 1);
      if (r) {
        pickRune(w, h, r);
        w.runes = w.runes.filter((q) => q !== r);
      }
    }
  }

  updateWardenMove(w);

  // Boss respawn.
  if (w.bossRespawnAt !== null && w.time >= w.bossRespawnAt) {
    spawnBoss(w);
    w.bossRespawnAt = null;
  }

  for (const t of [0, 1] as Team[]) if (w.glyphCooldown[t] > 0) w.glyphCooldown[t] = Math.max(0, w.glyphCooldown[t] - DT);

  for (const u of w.units) {
    if (u.structure && u.structure.glyph > 0) u.structure.glyph = Math.max(0, u.structure.glyph - DT);
    if (u.hero && u.hero.buybackCooldown > 0) u.hero.buybackCooldown = Math.max(0, u.hero.buybackCooldown - DT);
    if (u.ward && u.alive && w.time >= u.ward.expires) w.expire(u);
  }

  // Backdoor protection: refresh twice a second, regenerate while protected.
  if (w.tick % 15 === 0) {
    for (const s of w.units) {
      if (!s.structure || !s.alive) continue;
      const tier = s.structure.tier;
      if (tier === 'tower1' || tier === 'fountain') {
        s.structure.backdoor = false;
        continue;
      }
      s.structure.backdoor = !w.units.some(
        (c) => c.creep && c.alive && c.team !== s.team && dist(c.x, c.y, s.x, s.y) <= BACKDOOR_RADIUS + s.radius,
      );
    }
  }
  for (const s of w.units) {
    // Regenerate only to undo a hero-only "backdoor" attack, not normal creep pushes.
    if (s.structure?.backdoor && s.alive && s.hp < s.maxHp && w.time - s.structure.backdoorHitAt < 15) {
      s.hp = Math.min(s.maxHp, s.hp + BACKDOOR_REGEN * DT);
    }
  }
}

function pickRune(w: World, h: Unit, r: Rune) {
  switch (r.kind) {
    case 'haste':
      w.addBuff(h, { key: 'rune', t: 15, moveSpeedPct: 60 });
      break;
    case 'doubleDamage':
      w.addBuff(h, { key: 'rune', t: 25, damageMult: 2 });
      break;
    case 'regen':
      w.addBuff(h, { key: 'rune', t: 15, healPerSec: h.maxHp * 0.07, manaPerSec: h.maxMana * 0.07 });
      break;
    case 'invisibility':
      w.addBuff(h, { key: 'rune', t: 20, invisible: true });
      break;
    case 'bounty': {
      const gold = 80 + Math.floor(w.time / 60) * 6;
      for (const ally of w.units) if (ally.hero && ally.team === h.team) w.giveGold(ally, ally === h ? gold : Math.round(gold / 2));
      break;
    }
  }
  w.events.push({ type: 'rune', unitId: h.id, kind: r.kind });
}

export function spawnBoss(w: World) {
  w.wardenHouse = w.rng.next() < 0.5 ? 0 : 1;
  const p = w.map.houses[w.wardenHouse];
  const u = w.spawnUnit('neutral', 2, { x: p.x, y: p.y }, BOSS);
  u.neutral = { camp: -1, homeX: p.x, homeY: p.y, boss: true, aggroUntil: -1e9 };
}

/** Put the Warden in a house at once, calm again. */
export function moveWardenTo(w: World, u: Unit, house: number) {
  const p = w.map.houses[house];
  const n = u.neutral!;
  w.wardenHouse = house;
  u.x = u.px = p.x;
  u.y = u.py = p.y;
  u.path = null;
  u.targetId = null;
  n.homeX = p.x;
  n.homeY = p.y;
  n.aggroUntil = -1e9;
  n.moveAt = null;
  n.slamLand = null;
}

/**
 * As day turns to night the Warden teleports to its other house. A stun during those few seconds
 * stops it and it stays where it is until the next nightfall; otherwise the fight has to follow it.
 */
function updateWardenMove(w: World) {
  const night = isNight(w.time);
  const dusk = night && !w.wasNight;
  w.wasNight = night;
  const u = w.units.find((e) => e.alive && e.neutral?.boss);
  if (!u) return;
  const n = u.neutral!;
  const watched = (): [boolean, boolean] => [0, 1].map((t) => w.units.some((e) => e.alive && e.team === t && e.kind === 'hero' && dist(e.x, e.y, u.x, u.y) < 25)) as [boolean, boolean];
  const event = (phase: 'start' | 'stopped' | 'arrive', fromX: number, fromY: number, seen: [boolean, boolean]) =>
    w.events.push({ type: 'wardenMove', unitId: u.id, phase, x: u.x, y: u.y, fromX, fromY, watched: seen });
  if (dusk && n.moveAt == null) {
    n.moveAt = w.time + WARDEN_MOVE_SECONDS;
    n.slamLand = null;
    u.targetId = null;
    event('start', u.x, u.y, watched());
  }
  if (n.moveAt == null) return;
  if (u.stunTimer > 0) {
    n.moveAt = null;
    event('stopped', u.x, u.y, watched());
  } else if (w.time >= n.moveAt) {
    const fromX = u.x;
    const fromY = u.y;
    const seen = watched();
    moveWardenTo(w, u, w.wardenHouse === 0 ? 1 : 0);
    event('arrive', fromX, fromY, seen);
  }
}

// ------------------------------------------------------------------ wards

/** True on a ward hill's top (too high to walk onto; wards and blinks can go there). */
export function onHillTop(w: World, x: number, y: number): boolean {
  const m = w.map;
  const cx = Math.floor(x / m.cell);
  const cy = Math.floor(y / m.cell);
  return cx >= 0 && cy >= 0 && cx < m.grid && cy < m.grid && m.hillTop[cy * m.grid + cx] === 1;
}

export function placeWard(w: World, u: Unit, slot: number, x: number, y: number): 'placed' | 'approach' | 'fail' {
  const h = u.hero!;
  const s = h.items[slot];
  if (!s || (s.id !== 'observerWard' && s.id !== 'sentryWard') || !u.alive) return 'fail';
  if (!isWalkable(w.map, x, y) && !onHillTop(w, x, y)) return 'fail';
  // No wards inside the Warden's house (you need someone outside for outside vision).
  if (inHouse(w.map, x, y)) return 'fail';
  if (dist(u.x, u.y, x, y) > WARD_CAST_RANGE) return 'approach';
  const kind = s.id === 'observerWard' ? 'observer' : 'sentry';
  const ward = w.spawnUnit('ward', u.team, { x, y }, WARDS[kind]);
  ward.ward = { kind, expires: w.time + WARD_DURATION, placedAt: w.time };
  s.count--;
  if (s.count <= 0) h.items[slot] = null;
  w.events.push({ type: 'ward', unitId: ward.id });
  return 'placed';
}

// ------------------------------------------------------------------ team actions

export function buybackBlocker(w: World, u: Unit): 'alive' | 'cooldown' | 'gold' | null {
  const h = u.hero!;
  if (u.alive) return 'alive';
  if (h.buybackCooldown > 0) return 'cooldown';
  if (h.gold < buybackCost(h.level, w.time / 60)) return 'gold';
  return null;
}

export function buyback(w: World, u: Unit): boolean {
  if (buybackBlocker(w, u)) return false;
  const h = u.hero!;
  h.gold -= buybackCost(h.level, w.time / 60);
  h.buybackCooldown = BUYBACK_COOLDOWN;
  h.respawnTimer = 0;
  h.reviveAt = null;
  w.events.push({ type: 'buyback', unitId: u.id });
  return true;
}

export function activateGlyph(w: World, team: Team): boolean {
  if (w.glyphCooldown[team] > 0) return false;
  w.glyphCooldown[team] = GLYPH_COOLDOWN;
  for (const s of w.units) if (s.structure && s.alive && s.team === team) s.structure.glyph = GLYPH_DURATION;
  w.events.push({ type: 'glyph', team });
  return true;
}

export const BOSS_STATS = BOSS;
export { BOSS_RESPAWN };
