import type { Team } from '../constants';
import { teamLanePath } from '../map';
import { dist, pointAlong, polylineLength, projectOnPolyline } from '../math';
import type { Unit, World } from '../world';
import { abilityDef, botLearn, castBlocker } from '../abilities';
import { BUILDS, ITEMS, TELEPORT } from '../data/items';
import { buyBlocker, inShop, teleportTargets, tpBlocker } from '../inventory';

/**
 * Bot heroes. Bots issue the exact same Commands a human does, so later on a bot
 * slot can be handed to an online player (or vice versa) without special cases.
 *
 * Current behaviour:
 *  - Learn abilities as they level (ultimate first) and use them on enemy heroes;
 *    use area spells to farm creep waves when mana is high; heal hurt allies.
 *  - Retreat to fountain below 30% HP, return at 90%.
 *  - Back off when an enemy tower is shooting at us.
 *  - Fight: last-hit/kill creeps, attack weak enemy heroes, siege structures only
 *    when friendly creeps are tanking the tower.
 *  - Otherwise follow the front of our creep wave in the assigned lane.
 *  - Shop at the fountain (fixed build per hero, always carry a teleport) and
 *    teleport back to the lane after respawning / healing.
 *  - Bots only react to enemies they can actually see (fog of war).
 *  - Fight back if a jungle camp attacks them.
 * Coordinated team fights and ganking come in a later milestone.
 */
export function botThink(w: World, me: Unit) {
  const h = me.hero!;
  const hpRatio = me.hp / me.maxHp;
  if (h.skillPoints > 0) botLearn(w, me);
  if (h.channel) return; // teleporting
  if (inShop(w, me)) shop(w, me);
  if (hpRatio < 0.45) useSalve(w, me);
  maybeGlyph(w, me);
  if (supportAllies(w, me)) return;

  if (hpRatio < 0.3) h.bot.retreating = true;
  if (h.bot.retreating && hpRatio > 0.9) h.bot.retreating = false;
  if (h.bot.retreating) {
    const f = w.respawnPoint(me.team as Team, h.slot);
    if (dist(me.x, me.y, f.x, f.y) > 2) w.applyCommand({ type: 'moveTo', unitId: me.id, x: f.x, y: f.y });
    return;
  }

  const path = teamLanePath(w.map, me.team as Team, h.lane);
  const myProgress = projectOnPolyline(path, me);
  if (inShop(w, me) && hpRatio > 0.85 && teleportToLane(w, me, path)) return;

  // Under fire from a tower with nothing else to soak it? Step back.
  const shootingMe = w.units.find(
    (t) => t.structure && t.alive && t.team !== me.team && t.targetId === me.id && t.attackInterval > 0,
  );
  if (shootingMe) {
    const back = pointAlong(path, Math.max(0, myProgress - 14));
    w.applyCommand({ type: 'moveTo', unitId: me.id, x: back.x, y: back.y });
    return;
  }

  const target = chooseTarget(w, me, hpRatio);
  if (target && useAbilities(w, me, target)) return;
  if (!target && (grabRune(w, me) || plantWard(w, me, path))) return;
  if (target) {
    if (me.hero!.order.type !== 'attack' || me.hero!.order.targetId !== target.id) {
      w.applyCommand({ type: 'attack', unitId: me.id, targetId: target.id });
    }
    return;
  }

  // Follow our lane's front line.
  let front = -1;
  for (const c of w.units) {
    if (!c.creep || !c.alive || c.team !== me.team || c.creep.lane !== h.lane) continue;
    front = Math.max(front, projectOnPolyline(path, c));
  }
  if (front < 0) {
    // No creeps: hold near our furthest living tower in this lane.
    for (const t of w.units) {
      if (t.structure && t.alive && t.team === me.team && t.structure.lane === h.lane && t.attackInterval > 0) {
        front = Math.max(front, projectOnPolyline(path, t) + 4);
      }
    }
    if (front < 0) front = 10;
  }
  const spot = pointAlong(path, Math.max(0, front - 4));
  if (dist(me.x, me.y, spot.x, spot.y) > 2.5) {
    w.applyCommand({ type: 'moveTo', unitId: me.id, x: spot.x, y: spot.y });
  } else if (me.hero!.order.type === 'move') {
    w.applyCommand({ type: 'stop', unitId: me.id });
  }
}

/** Enemy tower that would shoot at a unit standing at (x, y), if any. */
function dangerousTower(w: World, me: Unit, x: number, y: number): Unit | undefined {
  return w.units.find(
    (t) =>
      t.structure &&
      t.alive &&
      t.team !== me.team &&
      t.attackInterval > 0 &&
      dist(x, y, t.x, t.y) <= t.attackRange + t.radius + me.radius + 1.5,
  );
}

function isSafe(w: World, me: Unit, x: number, y: number): boolean {
  const tower = dangerousTower(w, me, x, y);
  if (!tower) return true;
  if (tower.targetId === me.id) return false;
  const tanks = w.units.filter(
    (c) => c.creep && c.alive && c.team === me.team && dist(c.x, c.y, tower.x, tower.y) <= tower.attackRange + 2,
  ).length;
  return tanks >= 2;
}

function chooseTarget(w: World, me: Unit, hpRatio: number): Unit | undefined {
  const scan = Math.max(me.attackRange + 6, 11);
  // Only what we can see; neutrals only if they're already fighting us.
  const enemies = w.enemiesNear(
    me,
    me.x,
    me.y,
    scan,
    (e) => w.canSee(me.team, e) && e.kind !== 'ward' && (e.kind !== 'neutral' || e.targetId === me.id),
  );
  // Own creeps we can deny (only worth it when this hit kills).
  const denies = w.units.filter(
    (c) => c.creep && w.canDeny(me, c) && c.hp <= me.damage * 1.1 && dist(c.x, c.y, me.x, me.y) <= scan,
  );
  enemies.push(...denies);
  if (!enemies.length) return undefined;

  const alliedHeroes = w.units.filter((u) => u.hero && u.alive && u.team === me.team && dist(u.x, u.y, me.x, me.y) < 15).length;
  const enemyHeroes = enemies.filter((e) => e.hero).length;

  let best: Unit | undefined;
  let bestScore = -Infinity;
  for (const e of enemies) {
    // Where would we stand to hit it? Roughly at max range on the line between us.
    const d = dist(me.x, me.y, e.x, e.y);
    const reach = me.attackRange + me.radius + e.radius;
    const t = d > reach ? (d - reach) / d : 0;
    const sx = me.x + (e.x - me.x) * t;
    const sy = me.y + (e.y - me.y) * t;
    if (!isSafe(w, me, sx, sy)) continue;

    let score: number;
    if (e.hero) {
      if (hpRatio < 0.45 || enemyHeroes > alliedHeroes + 1) continue;
      const theirRatio = e.hp / e.maxHp;
      score = 70 + (1 - theirRatio) * 60 + (hpRatio - theirRatio) * 30;
    } else if (e.creep && e.team === me.team) {
      score = 80; // deny
    } else if (e.creep) {
      const killable = e.hp <= me.damage * 1.3;
      score = 50 + (killable ? 40 : 0) - (e.hp / e.maxHp) * 20;
    } else {
      score = 45;
    }
    score -= d * 0.8;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

const ready = (me: Unit, slot: number) => castBlocker(me, slot) === null;

/** Healer bots top up hurt allies first. */
function supportAllies(w: World, me: Unit): boolean {
  const def = abilityDef(me, 1);
  if (!def || def.targeting !== 'ally' || !ready(me, 1)) return false;
  const hurt = w.units
    .filter((a) => a.hero && a.alive && a.team === me.team && a.hp / a.maxHp < 0.55 && dist(a.x, a.y, me.x, me.y) <= def.castRange + 4)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (!hurt) return false;
  w.applyCommand({ type: 'cast', unitId: me.id, slot: 1, targetId: hurt.id });
  return true;
}

function cast(w: World, me: Unit, slot: number, t: Unit) {
  const def = abilityDef(me, slot)!;
  if (def.targeting === 'enemy') w.applyCommand({ type: 'cast', unitId: me.id, slot, targetId: t.id });
  else w.applyCommand({ type: 'cast', unitId: me.id, slot, x: t.x, y: t.y });
}

/** Returns true if a spell was cast this think. */
function useAbilities(w: World, me: Unit, target: Unit): boolean {
  const d = dist(me.x, me.y, target.x, target.y);
  if (target.hero) {
    for (const slot of [2, 0]) {
      if (!ready(me, slot)) continue;
      const def = abilityDef(me, slot)!;
      if (def.targeting === 'passive' || def.targeting === 'ally') continue;
      const range = def.targeting === 'none' ? def.radius - 1 : def.castRange;
      if (d > range) continue;
      // Save ultimates for a real fight: weakened target, or several enemies clumped.
      if (def.ultimate) {
        const clumped = w.units.filter((e) => e.hero && e.alive && e.team !== me.team && dist(e.x, e.y, target.x, target.y) < def.radius).length;
        if (target.hp / target.maxHp > 0.75 && clumped < 2) continue;
      }
      cast(w, me, slot, target);
      return true;
    }
    return false;
  }
  // Farming: blast creep waves with the basic nuke when mana is plentiful.
  if (target.creep && me.mana > me.maxMana * 0.7 && ready(me, 0)) {
    const def = abilityDef(me, 0)!;
    if ((def.targeting === 'enemy' || (def.targeting === 'direction' && def.id === 'piercingArrow')) && d <= def.castRange) {
      const pack = w.units.filter((c) => c.creep && c.alive && c.team !== me.team && dist(c.x, c.y, target.x, target.y) < 4).length;
      if (pack >= 3) {
        cast(w, me, 0, target);
        return true;
      }
    }
  }
  return false;
}

/** Buy along the hero's build; keep one teleport scroll. */
function shop(w: World, me: Unit) {
  const h = me.hero!;
  if (h.tpCount === 0 && h.gold >= TELEPORT.cost) w.applyCommand({ type: 'buyTp', unitId: me.id });
  // Supports keep an observer ward on them.
  if (h.defId === 'orin' && h.gold > 400 && !h.items.some((s) => s?.id === 'observerWard')) {
    w.applyCommand({ type: 'buy', unitId: me.id, itemId: 'observerWard' });
  }
  const build = BUILDS[h.defId];
  for (let guard = 0; guard < 3 && h.bot.buildIndex < build.length; guard++) {
    const next = build[h.bot.buildIndex];
    const blocked = buyBlocker(w, me, next);
    if (blocked === 'gold') return;
    if (blocked === 'full') {
      // Make room by selling the cheapest item (never the Crown).
      let cheapest = -1;
      h.items.forEach((s, i) => {
        if (s && s.id !== 'crownOfAscension' && (cheapest < 0 || ITEMS[s.id].cost < ITEMS[h.items[cheapest]!.id].cost)) cheapest = i;
      });
      if (cheapest < 0 || ITEMS[h.items[cheapest]!.id].cost >= ITEMS[next].cost) {
        h.bot.buildIndex++;
        continue;
      }
      w.applyCommand({ type: 'sell', unitId: me.id, slot: cheapest });
    }
    w.applyCommand({ type: 'buy', unitId: me.id, itemId: next });
    h.bot.buildIndex++;
  }
}

function useSalve(w: World, me: Unit) {
  if (me.buffs.some((b) => b.key === 'salve')) return;
  const slot = me.hero!.items.findIndex((s) => s?.id === 'healingSalve');
  if (slot >= 0) w.applyCommand({ type: 'useItem', unitId: me.id, slot });
}

/** From the fountain, teleport to our furthest standing building in our lane. */
function teleportToLane(w: World, me: Unit, path: { x: number; y: number }[]): boolean {
  if (tpBlocker(me)) return false;
  const lane = me.hero!.lane;
  const targets = teleportTargets(w, me.team as Team).filter((s) => s.structure!.lane === lane);
  if (!targets.length) return false;
  const best = targets.sort((a, b) => projectOnPolyline(path, b) - projectOnPolyline(path, a))[0];
  if (dist(me.x, me.y, best.x, best.y) < 50) return false;
  w.applyCommand({ type: 'teleport', unitId: me.id, targetId: best.id });
  return true;
}

/** Pop the team tower shield when one of our towers is about to fall. */
function maybeGlyph(w: World, me: Unit) {
  if (w.glyphCooldown[me.team as Team] > 0) return;
  const endangered = w.units.some(
    (t) =>
      t.structure &&
      t.alive &&
      t.team === me.team &&
      t.structure.vulnerable &&
      t.hp < t.maxHp * 0.3 &&
      w.units.some((e) => e.alive && e.team !== me.team && e.team !== 2 && !e.structure && dist(e.x, e.y, t.x, t.y) < 12),
  );
  if (endangered) w.applyCommand({ type: 'glyph', unitId: me.id });
}

/** Detour for a power-up if one is close and no enemy hero is around. */
function grabRune(w: World, me: Unit): boolean {
  const r = w.runes.find((q) => dist(q.x, q.y, me.x, me.y) < 28 && w.vision.seesPoint(me.team as Team, q.x, q.y));
  if (!r) return false;
  const danger = w.units.some((e) => e.hero && e.alive && e.team !== me.team && w.canSee(me.team, e) && dist(e.x, e.y, r.x, r.y) < 12);
  if (danger) return false;
  w.applyCommand({ type: 'moveTo', unitId: me.id, x: r.x, y: r.y });
  return true;
}

/** Plant an observer ward where our lane meets the river, if none of ours is there. */
function plantWard(w: World, me: Unit, path: { x: number; y: number }[]): boolean {
  const slot = me.hero!.items.findIndex((s) => s?.id === 'observerWard');
  if (slot < 0) return false;
  // Prefer a hill on our side (sees over the trees), otherwise where the lane meets the river.
  const laneSpot = pointAlong(path, polylineLength(path) * 0.42);
  const ownSide = (p: { x: number; y: number }) => (me.team === 0 ? p.y > p.x : p.y < p.x);
  const hill = w.map.hills.filter(ownSide).sort((a, b) => dist(a.x, a.y, laneSpot.x, laneSpot.y) - dist(b.x, b.y, laneSpot.x, laneSpot.y))[0];
  const spot = hill && dist(hill.x, hill.y, laneSpot.x, laneSpot.y) < 45 ? hill : laneSpot;
  const covered = w.units.some((u) => u.ward && u.alive && u.team === me.team && dist(u.x, u.y, spot.x, spot.y) < 15);
  if (covered || dist(me.x, me.y, spot.x, spot.y) > 30) return false;
  w.applyCommand({ type: 'placeWard', unitId: me.id, slot, x: spot.x, y: spot.y });
  return true;
}

/** Dead bots: buy back if our base is under attack. */
export function botWhileDead(w: World, me: Unit) {
  const base = w.map.shrines[me.team as Team];
  const threat = w.units.some((e) => e.alive && e.team !== me.team && e.team !== 2 && (e.hero || e.creep) && dist(e.x, e.y, base.x, base.y) < 28);
  if (threat && me.hero!.respawnTimer > 8) w.applyCommand({ type: 'buyback', unitId: me.id });
}
