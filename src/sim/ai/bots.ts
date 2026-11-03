import type { Team } from '../constants';
import { LaneId, teamLanePath } from '../map';
import { dist, pointAlong, polylineLength, projectOnPolyline } from '../math';
import type { Unit, World } from '../world';
import { inHouse } from '../map';
import { isInvisible } from '../vision';
import { abilityDef, botLearn, castBlocker } from '../abilities';
import { ITEMS, ItemId, TELEPORT } from '../data/items';
import { isTeamSupport, nextBotItem, wantsSentry } from './bot-items';
import { buyBlocker, buyDestination, inShop, itemBlocker, recipeSources, teleportTargets, tpBlocker } from '../inventory';
import { courierBlocker } from '../courier';

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
 *  - Shop anywhere (items planned from the hero's role and the enemy lineup, see
 *    bot-items.ts; the courier brings them), always carry a teleport, and teleport
 *    back to the lane after respawning / healing.
 *  - Outnumbered in lane: wait near our own tower instead of at the front.
 *  - The team's support carries totems; sentries go where an enemy hero vanished.
 *  - Warden (normal/hard, from ~14–17 min): all three go in together when healthy
 *    and not outnumbered; the best-farmed hero grabs the charm. After a kill they
 *    check the house again from minute 8 (its return isn't announced).
 *  - Bots only react to enemies they can actually see (fog of war).
 *  - Fight back if a jungle camp attacks them.
 *  - Team plan (shared by a team's bots, refreshed every 2 s):
 *      defend: a building is under attack → go there (teleport if far);
 *      warden: take the Warden together;
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
  mode: 'farm' | 'push' | 'defend' | 'warden';
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
  if (wantWarden(w, team, cur, alive(team), alive((1 - team) as Team))) {
    return (cache[team] = { mode: 'warden', until, since: cur?.mode === 'warden' ? cur.since : w.time });
  }
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
  shop(w, me);
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
  if (plan.mode === 'warden' && fightWarden(w, me, hpRatio)) return;
  if (grabCharm(w, me)) return;
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
  if (plantSentry(w, me)) return;
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
  // Outnumbered in lane (more enemy heroes in sight than allies with us)? Wait near our tower
  // instead of standing at the front where they can gang up on us.
  if (plan.mode === 'farm') {
    const seen = w.heroes.filter((e) => e.alive && e.team !== me.team && w.canSee(me.team, e) && dist(e.x, e.y, me.x, me.y) < 22).length;
    const withMe = w.heroes.filter((a) => a.alive && a.team === me.team && dist(a.x, a.y, me.x, me.y) < 15).length;
    if (seen > withMe || (seen >= 1 && hpRatio < 0.55)) {
      let tower = -1;
      for (const t of w.units) {
        if (t.structure && t.alive && t.team === me.team && t.structure.lane === lane && t.attackInterval > 0) {
          const p = projectOnPolyline(path, t);
          if (p <= front + 2) tower = Math.max(tower, p);
        }
      }
      if (tower >= 0) front = Math.min(front, tower + 6);
    }
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
  const ready = (i: number) => i >= 0 && !itemBlocker(w, me, i);
  const horn = slotOf('frostHorn');
  if (ready(horn) && target.hero && d < 5) {
    w.applyCommand({ type: 'useItem', unitId: me.id, slot: horn });
    return true;
  }
  const stone = slotOf('stoneskinAmulet');
  if (ready(stone) && target.hero && d < 6 && me.hp < me.maxHp * 0.5) {
    w.applyCommand({ type: 'useItem', unitId: me.id, slot: stone });
    return true;
  }
  const boots = slotOf('arcaneBoots');
  if (ready(boots) && me.mana < me.maxMana * 0.55) {
    w.applyCommand({ type: 'useItem', unitId: me.id, slot: boots });
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

/**
 * Buy along the hero's build; keep one teleport scroll. Away from the shop the purchases go on
 * the courier, which the bot sends out right away (bots only walk home to heal).
 */
function shop(w: World, me: Unit) {
  const h = me.hero!;
  const atShop = inShop(w, me);
  const tpOnCourier = h.courier.bag.some((s) => s?.id === 'tp');
  if (h.tpCount === 0 && !tpOnCourier && h.gold >= TELEPORT.cost) w.applyCommand({ type: 'buyTp', unitId: me.id });
  // The team's support keeps an observer totem (and sentries when the enemy has an invisible hero).
  const carries = (id: ItemId) => h.items.some((s) => s?.id === id) || h.courier.bag.some((s) => s?.id === id);
  const freeSlot = h.items.some((x) => !x);
  if (isTeamSupport(w, me) && freeSlot && h.gold > 400 && !carries('observerWard')) w.applyCommand({ type: 'buy', unitId: me.id, itemId: 'observerWard' });
  if (wantsSentry(w, me) && freeSlot && h.gold > 300) w.applyCommand({ type: 'buy', unitId: me.id, itemId: 'sentryWard' });
  // Items: planned from the hero's role and the enemy lineup (see bot-items.ts).
  for (let guard = 0; guard < 3; guard++) {
    const next = nextBotItem(w, me);
    if (!next) break;
    const blocked = buyBlocker(w, me, next);
    if (blocked === 'gold' || blocked === 'courierFull' || blocked === 'shop') break;
    // Away from base, only buy what will fit in the bag on delivery (otherwise wait for the shop).
    if (!atShop && buyDestination(w, me, next) === 'courier') {
      const def = ITEMS[next];
      const pending = h.courier.bag.filter((x) => x && x.id !== 'tp' && !x.parts?.length).length;
      const free = h.items.filter((x) => !x).length - pending;
      const stack = def.consumable && h.items.some((x) => x?.id === next && x.count < def.consumable!.maxStack);
      if (!stack && recipeSources(h, next).inv.length === 0 && free <= 0) break;
    }
    if (blocked === 'full') {
      // Make room by selling the cheapest item that isn't a part of what we're buying (never the Crown).
      const parts = new Set(recipeSources(h, next).inv);
      let cheapest = -1;
      h.items.forEach((s, i) => {
        if (s && !parts.has(i) && !s.reserved && s.id !== 'crownOfAscension' && !ITEMS[s.id].consumable && (cheapest < 0 || ITEMS[s.id].cost < ITEMS[h.items[cheapest]!.id].cost)) cheapest = i;
      });
      if (cheapest < 0 || ITEMS[h.items[cheapest]!.id].cost >= ITEMS[next].cost) break;
      w.applyCommand({ type: 'sell', unitId: me.id, slot: cheapest });
    }
    const before = h.gold;
    w.applyCommand({ type: 'buy', unitId: me.id, itemId: next });
    if (h.gold === before) break; // didn't go through
  }
  // Courier: send it whenever something is waiting for us.
  if (!atShop && !courierBlocker(me)) w.applyCommand({ type: 'courier', unitId: me.id });
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

// ------------------------------------------------------------------ the Warden

interface WardenMemory {
  /** The Warden was alive the last time we looked at the world (its death is announced to everyone). */
  wasAlive: boolean;
  /** When it died (or when we last found the house empty). */
  goneAt: number | null;
}

function wardenMemory(w: World, team: Team): WardenMemory {
  const all = ((w as unknown as { botWarden?: Record<number, WardenMemory> }).botWarden ??= {});
  const m = (all[team] ??= { wasAlive: true, goneAt: null });
  const alive = !!theWarden(w);
  if (m.wasAlive && !alive) m.goneAt = w.time; // "the Warden was slain" is announced to both teams
  m.wasAlive = alive;
  return m;
}

const theWarden = (w: World) => w.units.find((u) => u.alive && u.neutral?.boss);

/** It respawns 8–11 minutes after dying, unannounced: bots go and check from minute 8. */
const WARDEN_CHECK_AFTER = 8 * 60;

/**
 * Take the Warden together: late enough, everyone alive and healthy, not outnumbered.
 * Once started, keep going while at least two of us can still fight.
 */
function wantWarden(w: World, team: Team, cur: TeamPlan | undefined, ours: number, theirs: number): boolean {
  const mem = wardenMemory(w, team);
  if (mem.goneAt !== null && w.time - mem.goneAt < WARDEN_CHECK_AFTER) return false;
  const heroes = w.heroes.filter((h) => h.team === team);
  if (heroes.some((h) => h.hero!.bot.difficulty === 'easy')) return false;
  if (cur?.mode === 'warden') {
    const fit = heroes.filter((h) => h.alive && h.hp > h.maxHp * 0.4).length;
    const enemiesNear = w.heroes.filter((e) => e.alive && e.team !== team && w.canSee(team, e) && dist(e.x, e.y, w.map.bossPit.x, w.map.bossPit.y) < 25).length;
    return fit >= 2 && enemiesNear <= fit && w.time < (cur.since ?? 0) + 90;
  }
  const hard = heroes.some((h) => h.hero!.bot.difficulty === 'hard');
  if (w.time < (hard ? 14 : 17) * 60 || ours < 3 || theirs > ours - (w.time > 24 * 60 ? 0 : 1)) return false;
  const avgLevel = heroes.reduce((s, h) => s + h.hero!.level, 0) / heroes.length;
  return avgLevel >= 11 && heroes.every((h) => h.hp > h.maxHp * 0.75);
}

/** Walk into the house and hit the Warden (enemy heroes in reach come first). */
function fightWarden(w: World, me: Unit, hpRatio: number): boolean {
  const pit = w.map.bossPit;
  const boss = theWarden(w);
  const inside = inHouse(w.map, me.x, me.y);
  if (inside && !boss) {
    // Not back yet: remember, and look again in a minute.
    wardenMemory(w, me.team as Team).goneAt = w.time - WARDEN_CHECK_AFTER + 60;
    return false;
  }
  const enemy = chooseTarget(w, me, hpRatio);
  // Enemy heroes, and creeps in the way or hitting us: the normal fight logic takes over.
  if (enemy && !enemy.neutral && (enemy.hero || dist(enemy.x, enemy.y, me.x, me.y) < 5 || enemy.targetId === me.id)) return false;
  if (!inside || !boss || !w.canSee(me.team, boss)) {
    if (dist(me.x, me.y, pit.x, pit.y) > 2.5) w.applyCommand({ type: 'moveTo', unitId: me.id, x: pit.x, y: pit.y });
    return true;
  }
  // Damage spells on the boss when mana allows (keep enough for a fight with heroes).
  if (me.mana > me.maxMana * 0.5 && ready(me, 0)) {
    const def = abilityDef(me, 0)!;
    if (def.targeting !== 'ally' && def.targeting !== 'passive' && def.targeting !== 'none' && dist(me.x, me.y, boss.x, boss.y) <= def.castRange) {
      cast(w, me, 0, boss);
      return true;
    }
  }
  const o = me.hero!.order;
  if (o.type !== 'attack' || o.targetId !== boss.id) w.applyCommand({ type: 'attack', unitId: me.id, targetId: boss.id });
  return true;
}

/** The Warden's Charm on the ground: our best-farmed hero with a free slot nearby goes for it. */
function grabCharm(w: World, me: Unit): boolean {
  const charm = w.groundItems.find((g) => g.item.id === 'wardenCharm' && dist(g.x, g.y, me.x, me.y) < 30);
  if (!charm) return false;
  const takers = w.heroes
    .filter((a) => a.alive && a.team === me.team && a.hero!.items.some((s) => !s) && dist(a.x, a.y, charm.x, charm.y) < 30)
    .sort((a, b) => b.hero!.goldEarned - a.hero!.goldEarned);
  if (takers[0] !== me) return false;
  const o = me.hero!.order;
  if (o.type !== 'pickUp' || o.groundId !== charm.id) w.applyCommand({ type: 'pickUp', unitId: me.id, groundId: charm.id });
  return true;
}

// ------------------------------------------------------------------ sentry totems

/** Where an enemy hero vanished from sight next to us (likely went invisible), per bot. */
function plantSentry(w: World, me: Unit): boolean {
  const slot = me.hero!.items.findIndex((s) => s?.id === 'sentryWard');
  const mem = ((w as unknown as { botSeen?: Record<number, { id: number; x: number; y: number; at: number }[]> }).botSeen ??= {});
  const seen = (mem[me.id] ??= []);
  // Remember enemy heroes seen close by in the last couple of seconds.
  for (const e of w.heroes) {
    if (e.team === me.team || !e.alive || !w.canSee(me.team, e) || dist(e.x, e.y, me.x, me.y) > 14) continue;
    const r = seen.find((q) => q.id === e.id);
    if (r) Object.assign(r, { x: e.x, y: e.y, at: w.time });
    else seen.push({ id: e.id, x: e.x, y: e.y, at: w.time });
  }
  if (slot < 0) return false;
  const covered = (x: number, y: number) => w.units.some((u) => u.ward?.kind === 'sentry' && u.alive && u.team === me.team && dist(u.x, u.y, x, y) < 10);
  for (const r of seen) {
    const e = w.unit(r.id);
    if (!e || !e.alive || w.canSee(me.team, e) || w.time - r.at > 2.5 || !isInvisible(e)) continue;
    // isInvisible is only used to skip heroes that simply walked into the fog: a bot that just saw
    // a hero disappear from right in front of it would guess the same.
    if (dist(r.x, r.y, me.x, me.y) > 10 || covered(r.x, r.y)) continue;
    w.applyCommand({ type: 'placeWard', unitId: me.id, slot, x: r.x, y: r.y });
    r.at = -1e9;
    return true;
  }
  return false;
}
