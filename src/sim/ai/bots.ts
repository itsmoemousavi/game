import { teamLanePath } from '../map';
import { dist, pointAlong, projectOnPolyline } from '../math';
import type { Unit, World } from '../world';

/**
 * Bot heroes. Bots issue the exact same Commands a human does, so later on a bot
 * slot can be handed to an online player (or vice versa) without special cases.
 *
 * Current behaviour (milestone 2):
 *  - Retreat to fountain below 30% HP, return at 90%.
 *  - Back off when an enemy tower is shooting at us.
 *  - Fight: last-hit/kill creeps, attack weak enemy heroes, siege structures only
 *    when friendly creeps are tanking the tower.
 *  - Otherwise follow the front of our creep wave in the assigned lane.
 * Abilities, items and team fights come in later milestones.
 */
export function botThink(w: World, me: Unit) {
  const h = me.hero!;
  const hpRatio = me.hp / me.maxHp;

  if (hpRatio < 0.3) h.bot.retreating = true;
  if (h.bot.retreating && hpRatio > 0.9) h.bot.retreating = false;
  if (h.bot.retreating) {
    const f = w.map.fountains[me.team];
    w.applyCommand({ type: 'moveTo', unitId: me.id, x: f.x, y: f.y });
    return;
  }

  const path = teamLanePath(w.map, me.team, h.lane);
  const myProgress = projectOnPolyline(path, me);

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
  const enemies = w.enemiesNear(me, me.x, me.y, scan);
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
