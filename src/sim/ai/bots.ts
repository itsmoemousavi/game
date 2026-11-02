import type { Team } from '../constants';
import { LaneId, teamLanePath } from '../map';
import { dist, pointAlong, polylineLength, projectOnPolyline } from '../math';
import type { Unit, World } from '../world';
import { abilityDef, botLearn, castBlocker } from '../abilities';
import { BUILDS, ITEMS, TELEPORT } from '../data/items';
import { buyBlocker, inShop, itemBlocker, teleportTargets, tpBlocker } from '../inventory';

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
 *  - Team plan (shared by a team's bots, refreshed every 2 s):
 *      defend: a building is under attack → go there (teleport if far);
 *      push:   after 6 minutes, when we're not outnumbered → group up in the
 *              lane with the weakest enemy defenses and push together;
 *      farm:   otherwise each bot keeps its own lane.
 *  - Gank: chase a visible, weakened enemy hero within ~30 m.
 *  - Difficulty (easy / normal / hard): how fast bots react, how well they aim,
 *    and whether they gank and group up.
 */

export type BotDifficulty = 'easy' | 'normal' | 'hard';
export const BOT_THINK_INTERVAL: Record<BotDifficulty, number> = { easy: 0.6, normal: 0.25, hard: 0.15 };
/** Spell aim error in meters, and how likely a bot is to use a spell when it could. */
const AIM: Record<BotDifficulty, { error: number; castChance: number }> = {
  easy: { error: 3, castChance: 0.45 },
  normal: { error: 1, castChance: 0.85 },
  hard: { error: 0, castChance: 1 },
};

/** Bots start grouping up to push after this many seconds (when not outnumbered). */
const PUSH_AFTER = 360;

interface TeamPlan {
  mode: 'farm' | 'push' | 'defend';
  lane?: 'top' | 'mid' | 'bot';
  structureId?: number;
  until: number;
  /** When the current push started. */
  since?: number;
  /** Heroes taking part in the push. */
  members?: number[];
}

/** What a team's bots should be doing together. */
function teamPlan(w: World, team: Team): TeamPlan {
  const cache = (w as unknown as { botPlans?: Record<number, TeamPlan> }).botPlans ??= {};
  const cur = cache[team];
  if (cur && w.time < cur.until) return cur;
  const until = w.time + 2;
  // Keep defending while enemies are still at that building (don't turn back halfway).
  if (cur?.mode === 'defend') {
    const s = w.unit(cur.structureId);
    const still = s?.alive && w.units.some((e) => e.alive && e.team !== team && e.team !== 2 && !e.structure && dist(e.x, e.y, s.x, s.y) < 18);
    if (still) return (cache[team] = { ...cur, until });
  }
  // Defend a building that enemies are hitting (heroes, or several creeps on an inner building).
  let defend: { s: Unit; threat: number } | null = null;
  for (const s of w.units) {
    if (!s.structure || !s.alive || s.team !== team || s.structure.tier === 'fountain') continue;
    let threat = 0;
    for (const e of w.units) {
      if (!e.alive || e.team === team || e.team === 2 || e.structure || dist(e.x, e.y, s.x, s.y) > 14) continue;
      threat += e.hero ? 3 : 1;
    }
    const important = s.structure.tier !== 'tower1' ? 2 : 0;
    if (threat >= 3 && (!defend || threat + important > defend.threat)) defend = { s, threat: threat + important };
  }
  // Commit to a defence for a while (on the big map, flip-flopping wastes the whole walk).
  if (defend) return (cache[team] = { mode: 'defend', structureId: defend.s.id, lane: defend.s.structure!.lane ?? 'mid', until: w.time + 6 });
  // Push together when we have the upper hand.
  const alive = (t: Team) => w.units.filter((h) => h.hero && h.alive && h.team === t).length;
  if (w.time > PUSH_AFTER && alive(team) >= 2 && alive(team) >= alive((1 - team) as Team)) {
    let best: { lane: 'top' | 'mid' | 'bot'; hp: number } | null = null;
    for (const s of w.units) {
      if (!s.structure || !s.alive || s.team === team || !s.structure.vulnerable || !s.structure.lane) continue;
      if (!best || s.hp < best.hp) best = { lane: s.structure.lane, hp: s.hp };
    }
    // Stay on the lane we're already pushing (for 25 s) while it still has a target.
    const lanes = new Set(w.units.filter((s) => s.structure && s.alive && s.team !== team && s.structure.vulnerable).map((s) => s.structure!.lane));
    if (cur?.mode === 'push' && cur.lane && lanes.has(cur.lane) && w.time < (cur.since ?? 0) + 25) {
      return (cache[team] = { ...cur, until });
    }
    if (best) {
      // Who joins: everyone except bots whose own lane has enemy creeps on our half right
      // now (on the big map an empty lane gets pushed to the base before the group returns).
      // Decided once per push so nobody walks back and forth.
      const lane = best.lane;
      const members = w.units
        .filter((h) => h.hero && h.team === team && (h.hero.lane === lane || !laneUnderPressure(w, team, h.hero.lane)))
        .map((h) => h.id);
      return (cache[team] = { mode: 'push', lane, until, since: w.time, members });
    }
  }
  return (cache[team] = { mode: 'farm', until });
}
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

  const diff = h.bot.difficulty;
  let plan: TeamPlan = diff === 'easy' ? { mode: 'farm' as const, until: 0 } : teamPlan(w, me.team as Team);
  // Bots left out of a push (their own lane was being pushed when it started) keep farming it.
  if (plan.mode === 'push' && plan.members && !plan.members.includes(me.id)) plan = { mode: 'farm', until: 0 };
  // Defending / pushing bots work in the plan's lane instead of their own.
  const lane = plan.mode === 'farm' ? h.lane : plan.lane ?? h.lane;
  const path = teamLanePath(w.map, me.team as Team, lane);
  const myProgress = projectOnPolyline(path, me);
  if (plan.mode === 'defend' && defend(w, me, plan)) return;
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

  // Team pings: "retreat" near us → fall back; "enemy missing" → no chasing for a while.
  const pings = w.pings.filter((p) => p.team === me.team && p.fromId !== me.id && w.time - p.at < 20); // long enough to walk across the map
  const retreat = pings.find((p) => p.kind === 'retreat' && dist(p.x, p.y, me.x, me.y) < 35 && w.time - p.at < 5);
  if (retreat) {
    const back = pointAlong(path, Math.max(0, myProgress - 25));
    w.applyCommand({ type: 'moveTo', unitId: me.id, x: back.x, y: back.y });
    return;
  }
  const careful = pings.some((p) => p.kind === 'missing');
  const target = chooseTarget(w, me, hpRatio) ?? (diff !== 'easy' && !careful ? gankTarget(w, me, hpRatio) : undefined);
  if (target && useAbilities(w, me, target)) return;
  if (!target && answerPing(w, me, pings)) return;
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
    if (!c.creep || !c.alive || c.team !== me.team || c.creep.lane !== lane) continue;
    front = Math.max(front, projectOnPolyline(path, c));
  }
  if (front < 0) {
    // No creeps: hold near our furthest living tower in this lane.
    for (const t of w.units) {
      if (t.structure && t.alive && t.team === me.team && t.structure.lane === lane && t.attackInterval > 0) {
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

/** Enemy creeps have pushed past the middle of this lane (onto our half). */
function laneUnderPressure(w: World, team: Team, lane: LaneId): boolean {
  const path = teamLanePath(w.map, team, lane);
  const half = polylineLength(path) / 2;
  let n = 0;
  for (const c of w.units) {
    if (!c.creep || !c.alive || c.team === team || c.creep.lane !== lane) continue;
    if (projectOnPolyline(path, c) < half) n++;
  }
  return n >= 2;
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
  const aim = AIM[me.hero!.bot.difficulty];
  if (def.targeting === 'enemy') {
    w.applyCommand({ type: 'cast', unitId: me.id, slot, targetId: t.id });
    return;
  }
  // Aim error (easy bots miss more); hard bots lead moving targets a little.
  const lead = me.hero!.bot.difficulty === 'hard' ? 0.25 * w.speedOf(t) : 0;
  const ex = (w.rng.next() - 0.5) * 2 * aim.error;
  const ey = (w.rng.next() - 0.5) * 2 * aim.error;
  w.applyCommand({ type: 'cast', unitId: me.id, slot, x: t.x + Math.cos(t.facing) * lead + ex, y: t.y + Math.sin(t.facing) * lead + ey });
}

/** Item buttons: cloak up when hurt in a fight, blink onto a hero we want to fight. */
function useItems(w: World, me: Unit, target: Unit, d: number): boolean {
  const h = me.hero!;
  const slotOf = (id: string) => h.items.findIndex((s) => s?.id === id);
  const cloak = slotOf('wardedCloak');
  if (cloak >= 0 && !itemBlocker(w, me, cloak) && me.hp < me.maxHp * 0.55 && target.hero) {
    w.applyCommand({ type: 'useItem', unitId: me.id, slot: cloak });
    return true;
  }
  const step = slotOf('shadowStep');
  if (step >= 0 && target.hero && d > me.attackRange + 3 && d < 12 && me.hp > me.maxHp * 0.6 && !itemBlocker(w, me, step)) {
    w.applyCommand({ type: 'useItem', unitId: me.id, slot: step, x: target.x, y: target.y });
    return true;
  }
  return false;
}

/** Returns true if a spell was cast this think. */
function useAbilities(w: World, me: Unit, target: Unit): boolean {
  const d = dist(me.x, me.y, target.x, target.y);
  if (useItems(w, me, target, d)) return false; // keep fighting after the item
  if (w.rng.next() > AIM[me.hero!.bot.difficulty].castChance) return false;
  if (target.hero) {
    for (const slot of [2, 0, 1]) {
      if (!ready(me, slot)) continue;
      const def = abilityDef(me, slot)!;
      if (def.targeting === 'passive' || def.targeting === 'ally') continue;
      // Self-buffs (no radius): use them when a fight is on.
      if (def.targeting === 'none' && def.radius === 0) {
        if (d < 9) {
          w.applyCommand({ type: 'cast', unitId: me.id, slot });
          return true;
        }
        continue;
      }
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

/** Go help a building under attack: teleport if far, otherwise walk. Returns true if acting. */
function defend(w: World, me: Unit, plan: TeamPlan): boolean {
  const s = w.unit(plan.structureId);
  if (!s || !s.alive) return false;
  const d = dist(me.x, me.y, s.x, s.y);
  if (d < 16) {
    // Close enough: fight whoever is attacking it, otherwise hold here (don't wander off
    // down the lane and walk straight back).
    const attackers = w.units.filter(
      (e) => e.alive && e.team !== me.team && e.team !== 2 && !e.structure && dist(e.x, e.y, s.x, s.y) < 18 && w.canAttack(me, e),
    );
    if (!attackers.length) {
      if (me.hero!.order.type === 'move') w.applyCommand({ type: 'stop', unitId: me.id });
      return true;
    }
    // Spells and focus on heroes are handled by the normal fight logic when one is in reach.
    const near = attackers.sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0) || dist(a.x, a.y, me.x, me.y) - dist(b.x, b.y, me.x, me.y))[0];
    if (useAbilities(w, me, near)) return true;
    const o = me.hero!.order;
    if (o.type !== 'attack' || o.targetId !== near.id) w.applyCommand({ type: 'attack', unitId: me.id, targetId: near.id });
    return true;
  }
  if (d > 60 && !tpBlocker(me)) {
    w.applyCommand({ type: 'teleport', unitId: me.id, targetId: s.id });
    return true;
  }
  if (d > 75) return false; // too far to matter on foot
  w.applyCommand({ type: 'moveTo', unitId: me.id, x: s.x, y: s.y });
  return true;
}

/** A visible, weakened enemy hero worth chasing (not under its towers). */
function gankTarget(w: World, me: Unit, hpRatio: number): Unit | undefined {
  const brave = me.hero!.bot.difficulty === 'hard' ? 0.5 : 0.4;
  if (hpRatio < 0.6) return undefined;
  return w.units
    .filter(
      (e) =>
        e.hero &&
        e.alive &&
        e.team !== me.team &&
        w.canSee(me.team, e) &&
        e.hp / e.maxHp < brave &&
        dist(e.x, e.y, me.x, me.y) < 30 &&
        isSafe(w, me, e.x, e.y),
    )
    .sort((a, b) => a.hp - b.hp)[0];
}

/** "Attack / Defend / Gather here" from a teammate: go there (teleport if far). */
function answerPing(w: World, me: Unit, pings: { kind: string; x: number; y: number }[]): boolean {
  const call = pings.filter((p) => p.kind === 'attack' || p.kind === 'defend' || p.kind === 'gather').pop();
  if (!call || me.hp < me.maxHp * 0.45) return false;
  const d = dist(me.x, me.y, call.x, call.y);
  if (d < 8) return false;
  if (d > 60 && !tpBlocker(me)) {
    const near = teleportTargets(w, me.team as Team).sort((a, b) => dist(a.x, a.y, call.x, call.y) - dist(b.x, b.y, call.x, call.y))[0];
    if (near && dist(near.x, near.y, call.x, call.y) < d - 25) {
      w.applyCommand({ type: 'teleport', unitId: me.id, targetId: near.id });
      return true;
    }
  }
  w.applyCommand({ type: 'moveTo', unitId: me.id, x: call.x, y: call.y });
  return true;
}
