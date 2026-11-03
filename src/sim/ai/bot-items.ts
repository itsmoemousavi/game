import type { HeroId } from '../data/heroes';
import { ITEMS, ItemId } from '../data/items';
import type { Unit, World } from '../world';

/**
 * What a bot buys next. Instead of one fixed list per hero, each bot plans its finished items
 * from its role and from the enemy lineup, then buys them part by part:
 *  - armor (Stoneskin Amulet / Plated Boots) against teams that hit with attacks,
 *  - the spell-immunity cloak against teams full of spells and stuns,
 *  - only one Banner of Valor per team (its aura doesn't stack),
 *  - sentry totems when the enemy has an invisible hero (Syl),
 *  - a hero that keeps dying picks the defensive option sooner.
 */

/** How much of each enemy hero's damage comes from attacks (the rest is spells). */
const PHYSICAL: Record<HeroId, number> = { vexa: 0.85, syl: 0.75, brakk: 0.55, grom: 0.45, kaela: 0.25, orin: 0.15 };
/** Stuns / roots / slows each hero brings (spell-immunity is worth more against these). */
const DISABLE: Record<HeroId, number> = { brakk: 1, grom: 1, kaela: 0.8, orin: 0.3, vexa: 0.4, syl: 0.1 };

type Pick = ItemId | ((ctx: Ctx) => ItemId | null);

interface Ctx {
  me: Unit;
  physical: number; // 0..3: how attack-heavy the enemy team is
  disable: number; // 0..3
  invisibleEnemy: boolean;
  /** An ally already has (or plans) the Banner. */
  allyBanner: boolean;
  struggling: boolean;
}

const defensive = (c: Ctx): ItemId => (c.disable > 1.9 && c.physical < 1.7 ? 'wardedCloak' : 'stoneskinAmulet');
const defensiveIfNeeded = (c: Ctx): ItemId | null => (c.struggling || c.physical > 1.8 || c.disable > 2.1 ? defensive(c) : null);
const banner = (c: Ctx): ItemId | null => (c.allyBanner ? null : 'bannerOfValor');

/** Finished items in order, per hero. Functions decide situational slots (null = skip). */
const PLANS: Record<HeroId, Pick[]> = {
  brakk: ['platedBoots', 'vitalStone', defensiveIfNeeded, 'shadowStep', banner, 'cleavingAxe', 'crownOfAscension', defensive, 'titanHeart'],
  grom: ['platedBoots', 'vitalStone', banner, defensiveIfNeeded, 'frostHorn', 'crownOfAscension', 'titanHeart', defensive],
  vexa: ['fleetBoots', 'twinBlades', defensiveIfNeeded, 'keenEdge', 'reaperEdge', 'crownOfAscension', 'lifedrinker', defensive],
  syl: ['fleetBoots', 'keenEdge', 'shadowStep', defensiveIfNeeded, 'reaperEdge', 'lifedrinker', 'crownOfAscension', defensive],
  orin: ['arcaneBoots', 'soulChalice', defensiveIfNeeded, 'focusLens', 'arcaneAmplifier', 'crownOfAscension', 'archmageStaff', defensive],
  kaela: ['arcaneBoots', banner, 'focusLens', defensiveIfNeeded, 'frostHorn', 'crownOfAscension', 'archmageStaff', defensive],
};

/** Plays the support role: buys the team's totems. */
const SUPPORTS: HeroId[] = ['orin', 'kaela', 'grom', 'brakk', 'vexa', 'syl'];

function context(w: World, me: Unit): Ctx {
  const enemies = w.heroes.filter((h) => h.team !== me.team);
  const allies = w.heroes.filter((h) => h.team === me.team && h.id !== me.id);
  const h = me.hero!;
  // The Banner belongs to the first ally (in slot order) whose plan has it.
  const allyBanner = allies.some(
    (a) => a.hero!.items.some((s) => s?.id === 'bannerOfValor') || (a.hero!.slot < h.slot && PLANS[a.hero!.defId].includes(banner)),
  );
  return {
    me,
    physical: enemies.reduce((s, e) => s + PHYSICAL[e.hero!.defId], 0),
    disable: enemies.reduce((s, e) => s + DISABLE[e.hero!.defId], 0),
    invisibleEnemy: enemies.some((e) => e.hero!.defId === 'syl'),
    allyBanner,
    struggling: h.deaths >= h.kills + h.assists / 2 + 3,
  };
}

/** Has `id`, or something built from it (in the bag or on the courier). */
const owns = (me: Unit, id: ItemId): boolean => {
  const h = me.hero!;
  const has = (x: { id: string; parts?: ItemId[] } | null) =>
    !!x && x.id !== 'tp' && (x.id === id || upgradeOf(x.id as ItemId, id) || !!x.parts?.includes(id));
  return h.items.some(has) || h.courier.bag.some(has);
};

/** `big` was built from `small` (directly or deeper). */
function upgradeOf(big: ItemId, small: ItemId): boolean {
  const r = ITEMS[big].recipe;
  return !!r && (r.includes(small) || r.some((p) => upgradeOf(p, small)));
}

/** True if this hero is the team's totem buyer (the ally earliest in SUPPORTS order). */
export function isTeamSupport(w: World, me: Unit): boolean {
  const team = w.heroes.filter((h) => h.team === me.team);
  const rank = (u: Unit) => SUPPORTS.indexOf(u.hero!.defId) * 10 + u.hero!.slot;
  return team.every((u) => rank(me) <= rank(u));
}

/** Sentry totems wanted right now (support only, enemy has an invisible hero, none carried). */
export function wantsSentry(w: World, me: Unit): boolean {
  const h = me.hero!;
  if (!isTeamSupport(w, me) || w.time < 240) return false;
  if (!w.heroes.some((e) => e.team !== me.team && e.hero!.defId === 'syl')) return false;
  return !h.items.some((s) => s?.id === 'sentryWard') && !h.courier.bag.some((s) => s?.id === 'sentryWard');
}

/**
 * The next item to buy: the first planned finished item not owned yet. If it's too expensive,
 * buy one of its missing parts instead (cheapest first) so the stats arrive sooner.
 * Returns null when everything planned is owned.
 */
export function nextBotItem(w: World, me: Unit): ItemId | null {
  const h = me.hero!;
  if (w.time < 30 && !owns(me, 'healingSalve') && h.gold >= ITEMS.healingSalve.cost + ITEMS.swiftBoots.cost) return 'healingSalve';
  const ctx = context(w, me);
  for (const p of PLANS[h.defId]) {
    const id = typeof p === 'function' ? p(ctx) : p;
    if (!id || owns(me, id)) continue;
    return partToBuy(me, id);
  }
  return null;
}

/** The item itself if affordable, otherwise its cheapest missing part (recursively). */
function partToBuy(me: Unit, id: ItemId): ItemId {
  const recipe = ITEMS[id].recipe;
  if (!recipe || me.hero!.gold >= ITEMS[id].cost) return id;
  const missing = recipe.filter((p) => !owns(me, p));
  if (!missing.length) return id; // all parts owned: pay the rest
  const cheapest = missing.sort((a, b) => ITEMS[a].cost - ITEMS[b].cost)[0];
  return partToBuy(me, cheapest);
}
