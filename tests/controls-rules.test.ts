import { describe, expect, it } from 'vitest';
import { CREEPS, HEROES, HeroId, ITEMS, fits, isWalkable, trueSightRadius, LANE_IDS, PlayerSlot, TICK_RATE, TELEPORT, Team, Unit, World, teleportTargets, tpBuyBlocker } from '../src/sim';
import { onHillTop } from '../src/sim/objectives';
import { SUMMONS, WARDS } from '../src/sim/data/units';
import { spawnDummy } from '../src/client/tutorial';

function arena(a: HeroId[], b: HeroId[]) {
  const slots: PlayerSlot[] = [];
  a.forEach((heroId, i) => slots.push({ team: 0, heroId, controller: 'human', lane: LANE_IDS[i] }));
  b.forEach((heroId, i) => slots.push({ team: 1, heroId, controller: 'human', lane: LANE_IDS[i] }));
  const w = new World({ seed: 5, slots });
  return { w, hero: (t: Team, id: string) => w.heroes.find((h) => h.team === t && h.hero!.defId === id)! };
}
const place = (u: Unit, x: number, y: number) => {
  u.x = u.px = x;
  u.y = u.py = y;
};
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * TICK_RATE); i++) w.step();
};
const SPOT = { x: 150, y: 150 };
/** Tough enemy creep at a spot. */
const dummy = (w: World, x: number, y: number, team: Team = 1) => {
  const d = spawnDummy(w, x, y, team);
  d.maxHp = d.hp = 1e5;
  return d;
};
const tough = (u: Unit) => {
  u.maxHp = u.hp = 1e5;
  u.damage = 0;
};

describe('auto attack on', () => {
  it('hits the nearest target in range without being asked', () => {
    const { w, hero } = arena(['vexa'], ['brakk']);
    const v = hero(0, 'vexa');
    place(v, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    const near = dummy(w, SPOT.x + 3, SPOT.y);
    const far = dummy(w, SPOT.x + 5, SPOT.y);
    run(w, 3);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });

  it('never denies', () => {
    const { w, hero } = arena(['vexa'], ['brakk']);
    const v = hero(0, 'vexa');
    place(v, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    const mine = dummy(w, SPOT.x + 3, SPOT.y, 0);
    mine.hp = mine.maxHp * 0.3;
    const hp = mine.hp;
    run(w, 3);
    expect(mine.hp).toBe(hp);
  });

  it('a picked target comes first; when it leaves range it goes back to the nearest', () => {
    const { w, hero } = arena(['vexa'], ['brakk']);
    const v = hero(0, 'vexa');
    place(v, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    const near = dummy(w, SPOT.x + 3, SPOT.y);
    const picked = dummy(w, SPOT.x + 5, SPOT.y);
    v.hero!.autoAttack = false;
    run(w, 0.2);
    v.hero!.autoAttack = true;
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: picked.id, priority: true });
    run(w, 3);
    expect(picked.hp).toBeLessThan(picked.maxHp);
    expect(near.hp).toBe(near.maxHp);
    place(picked, 20, 25);
    picked.creep = undefined;
    run(w, 3);
    expect(near.hp).toBeLessThan(near.maxHp);
  });

  it('walking: shoots on the move and keeps the same target past a group of creeps', () => {
    const { w, hero } = arena(['vexa'], ['brakk']);
    const v = hero(0, 'vexa');
    const foe = hero(1, 'brakk');
    tough(foe);
    place(v, SPOT.x, SPOT.y);
    place(foe, SPOT.x + 5, SPOT.y);
    run(w, 0.3);
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: foe.id, priority: true });
    run(w, 0.1);
    w.applyCommand({ type: 'moveDir', unitId: v.id, dx: 0, dy: 1 });
    const creep = dummy(w, SPOT.x, SPOT.y + 3);
    const y = v.y;
    run(w, 1.4);
    expect(v.y).toBeGreaterThan(y + 2); // never stopped
    expect(v.hero!.order.type).toBe('dir');
    expect(foe.hp).toBeLessThan(foe.maxHp);
    expect(creep.hp).toBe(creep.maxHp); // walked past it, still on the hero
  });

  it('walking with nothing locked: hits whatever is nearest in range, and stays on it', () => {
    const { w, hero } = arena(['vexa'], ['brakk']);
    const v = hero(0, 'vexa');
    place(v, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    const c = dummy(w, SPOT.x, SPOT.y + 4);
    w.applyCommand({ type: 'moveDir', unitId: v.id, dx: 0, dy: 1 });
    run(w, 1.2);
    expect(c.hp).toBeLessThan(c.maxHp);
  });

  it("doesn't wake up jungle camps by itself", () => {
    const { w, hero } = arena(['vexa'], ['brakk']);
    const v = hero(0, 'vexa');
    place(hero(1, 'brakk'), 20, 20);
    w.time = 60;
    const n = w.spawnUnit('neutral', 2, { x: SPOT.x + 3, y: SPOT.y }, { hp: 500, armor: 0, damage: 0, attackInterval: 1, attackRange: 1, projectileSpeed: 0, moveSpeed: 0, radius: 0.8, acquireRange: 0, bountyGold: 0, bountyXp: 0 });
    n.neutral = { camp: 0, homeX: n.x, homeY: n.y, aggroUntil: -1e9 } as Unit['neutral'];
    place(v, SPOT.x, SPOT.y);
    run(w, 1.5);
    expect(n.hp).toBe(n.maxHp);
  });
});

describe('auto attack off', () => {
  const off = () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const b = hero(0, 'brakk');
    place(b, SPOT.x, SPOT.y);
    place(hero(1, 'orin'), 20, 20);
    w.applyCommand({ type: 'setAutoAttack', unitId: b.id, enabled: false });
    return { w, b };
  };

  it('does nothing by itself', () => {
    const { w, b } = off();
    const c = dummy(w, b.x + 1.5, b.y);
    run(w, 2);
    expect(c.hp).toBe(c.maxHp);
  });

  it('one tap is one attack, then it stands still', () => {
    const { w, b } = off();
    const c = dummy(w, b.x + 1.5, b.y);
    run(w, 0.2);
    w.applyCommand({ type: 'attackOnce', unitId: b.id });
    run(w, 0.2);
    const once = c.maxHp - c.hp;
    expect(once).toBeGreaterThan(0);
    run(w, 4);
    expect(c.maxHp - c.hp).toBe(once);
    expect(b.hero!.order.type).toBe('idle');
  });

  it('tapping ten times in a second still swings at attack speed', () => {
    const { w, b } = off();
    const c = dummy(w, b.x + 1.5, b.y);
    run(w, 0.2);
    let swings = 0;
    for (let i = 0; i < TICK_RATE; i++) {
      if (i % 3 === 0) w.applyCommand({ type: 'attackOnce', unitId: b.id });
      w.step();
      swings += w.events.filter((e) => e.type === 'attack' && e.sourceId === b.id).length;
    }
    expect(swings).toBe(1);
    expect(c.hp).toBeLessThan(c.maxHp);
  });

  it('denies one attack at a time, and only low-health allies', () => {
    const { w, b } = off();
    const ally = dummy(w, b.x + 1.5, b.y, 0);
    w.applyCommand({ type: 'attackOnce', unitId: b.id, targetId: ally.id });
    run(w, 0.3);
    expect(ally.hp).toBe(ally.maxHp); // too healthy to deny
    ally.hp = ally.maxHp * 0.3;
    const hp = ally.hp;
    run(w, 2);
    w.applyCommand({ type: 'attackOnce', unitId: b.id, targetId: ally.id });
    run(w, 0.3);
    expect(ally.hp).toBeLessThan(hp);
  });

  it('a tap while walking swings in range without stopping', () => {
    const { w, b } = off();
    const c = dummy(w, b.x + 1.2, b.y + 1);
    run(w, 0.2);
    w.applyCommand({ type: 'moveDir', unitId: b.id, dx: 0, dy: 1 });
    run(w, 0.05);
    w.applyCommand({ type: 'attackOnce', unitId: b.id, targetId: c.id });
    const y = b.y;
    run(w, 0.3);
    expect(c.hp).toBeLessThan(c.maxHp);
    expect(b.y).toBeGreaterThan(y);
    expect(b.hero!.order.type).toBe('dir');
  });
});

describe('teleporting', () => {
  const tower = (w: World, team: Team) => w.structures.find((s) => s.team === team && s.structure!.tier === 'tower2')!;

  it('freezes the hero: no moving, attacking or casting until it lands or is cancelled', () => {
    const { w, hero } = arena(['vexa'], ['brakk']);
    const v = hero(0, 'vexa');
    place(v, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: tower(w, 0).id });
    const c = dummy(w, v.x + 3, v.y);
    w.applyCommand({ type: 'moveDir', unitId: v.id, dx: 1, dy: 0 });
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: c.id });
    run(w, 1);
    expect(v.x).toBe(SPOT.x);
    expect(c.hp).toBe(c.maxHp);
    expect(v.hero!.channel).not.toBeNull();
  });

  it('still lands where the tower stood if it falls during the channel', () => {
    const { w, hero } = arena(['vexa'], ['brakk']);
    const v = hero(0, 'vexa');
    const t = tower(w, 0);
    const [tx, ty] = [t.x, t.y];
    place(v, SPOT.x, SPOT.y);
    place(hero(1, 'brakk'), 20, 20);
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: t.id });
    run(w, 1);
    t.hp = 1;
    t.structure!.vulnerable = true;
    w.dealDamage(hero(1, 'brakk').id, t, 1e6, 'attack');
    expect(t.alive).toBe(false);
    run(w, TELEPORT.channel);
    expect(Math.hypot(v.x - tx, v.y - ty)).toBeLessThan(12);
  });
});

describe('Wayfarer Boots', () => {
  const withBoots = () => {
    const { w, hero } = arena(['vexa', 'brakk'], ['orin']);
    const v = hero(0, 'vexa');
    v.hero!.tpCount = 3;
    v.hero!.items[0] = { id: 'wayfarerBoots', count: 1 };
    w.applyHeroStats(v);
    return { w, v, ally: hero(0, 'brakk'), foe: hero(1, 'orin') };
  };

  it('always one teleport, never used up, 30 s cooldown; the fastest boots', () => {
    const { w, v } = withBoots();
    expect(v.hero!.tpCount).toBe(1);
    expect(ITEMS.wayfarerBoots.stats.moveSpeedPct!).toBeGreaterThan(ITEMS.fleetBoots.stats.moveSpeedPct!);
    place(v, SPOT.x, SPOT.y);
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: w.structures.find((s) => s.team === 0)!.id });
    run(w, TELEPORT.channel + 0.1);
    expect(v.hero!.tpCount).toBe(1);
    expect(v.hero!.tpCooldown).toBeGreaterThan(TELEPORT.bootsCooldown - 1);
    expect(v.hero!.tpCooldown).toBeLessThanOrEqual(TELEPORT.bootsCooldown);
  });

  it('you can reach allied heroes and creeps, and arrive beside them even if they moved', () => {
    const { w, v, ally } = withBoots();
    expect(teleportTargets(w, 0, true)).toContain(ally);
    expect(teleportTargets(w, 0, false)).not.toContain(ally);
    place(v, SPOT.x, SPOT.y);
    place(ally, SPOT.x + 40, SPOT.y - 20);
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: ally.id });
    run(w, 1);
    place(ally, SPOT.x - 40, SPOT.y + 20);
    run(w, TELEPORT.channel);
    expect(Math.hypot(v.x - ally.x, v.y - ally.y)).toBeLessThan(8);
  });

  it("you can't buy scrolls with them; drop them and you keep 1, which then runs out", () => {
    const { w, v } = withBoots();
    expect(tpBuyBlocker(w, v)).toBe('boots');
    v.hero!.items[0] = null;
    w.applyHeroStats(v);
    expect(v.hero!.tpCount).toBe(1);
    v.hero!.tpCooldown = 0;
    expect(tpBuyBlocker(w, v)).not.toBe('boots');
    place(v, SPOT.x, SPOT.y);
    w.applyCommand({ type: 'teleport', unitId: v.id, targetId: w.structures.find((s) => s.team === 0)!.id });
    run(w, TELEPORT.channel + 0.1);
    expect(v.hero!.tpCount).toBe(0);
    expect(v.hero!.tpCooldown).toBeGreaterThan(TELEPORT.bootsCooldown);
  });
});

describe('other new items', () => {
  it('Clearwater Flask restores mana over time and is used up', () => {
    const { w, hero } = arena(['orin'], ['brakk']);
    const o = hero(0, 'orin');
    o.hero!.items[0] = { id: 'manaFlask', count: 1 };
    o.mana = 10;
    o.manaRegen = 0;
    w.applyCommand({ type: 'useItem', unitId: o.id, slot: 0 });
    expect(o.hero!.items[0]).toBeNull();
    run(w, 8.2);
    expect(o.mana).toBeGreaterThan(140);
  });

  it('Long Scope adds range to ranged heroes only, attack speed to both', () => {
    const { w, hero } = arena(['vexa', 'brakk'], ['orin']);
    const v = hero(0, 'vexa');
    const b = hero(0, 'brakk');
    const [rv, rb, iv] = [v.attackRange, b.attackRange, v.attackInterval];
    for (const u of [v, b]) {
      u.hero!.items[0] = { id: 'longScope', count: 1 };
      w.applyHeroStats(u);
    }
    expect(v.attackRange).toBe(rv + 1.5);
    expect(b.attackRange).toBe(rb);
    expect(v.attackInterval).toBeLessThan(iv);
  });
});

describe('Mega Creeps', () => {
  it('only when all of the enemy barracks are down, and they are far stronger', () => {
    const { w } = arena(['vexa'], ['brakk']);
    const down = (n: number) => w.findStructure(1, 'barracks').slice(0, n).forEach((r) => (r.alive = false));
    w.time = 1;
    const wave = () => {
      const before = new Set(w.units);
      (w as unknown as { spawnWave(): void }).spawnWave();
      return w.units.filter((u) => !before.has(u) && u.creep && u.team === 0);
    };
    const normal = wave()[0];
    expect(normal.creep!.mega).toBe(false);
    down(5);
    const almost = wave();
    expect(almost.every((c) => !c.creep!.mega)).toBe(true);
    down(6);
    w.events.length = 0;
    const mega = wave();
    expect(mega.every((c) => c.creep!.mega)).toBe(true);
    expect(mega[0].maxHp).toBeGreaterThan(normal.maxHp * 2.5);
    expect(mega[0].damage).toBeGreaterThan(normal.damage * 2.5);
    expect(w.events.some((e) => e.type === 'megaCreeps' && e.team === 0)).toBe(true);
  });

  it('melee barracks are tougher than ranged ones', () => {
    const { w } = arena(['vexa'], ['brakk']);
    const r = w.findStructure(0, 'barracks');
    const hp = (k: string) => r.find((x) => x.structure!.rax === k)!.maxHp;
    expect(hp('melee')).toBeGreaterThan(hp('ranged'));
  });
});

describe('mountains and hiding spots', () => {
  it('melee can only hit someone on a mountain from up there; ranged can if they see them', () => {
    const { w, hero } = arena(['vexa', 'brakk'], ['orin', 'syl']);
    const hill = w.map.hills[0];
    const [v, b] = [hero(0, 'vexa'), hero(0, 'brakk')];
    const target = hero(1, 'orin');
    place(target, hill.x, hill.y);
    place(b, hill.x + 6.5, hill.y);
    place(v, hill.x + 7, hill.y + 1);
    expect(w.canAttack(v, target)).toBe(true);
    expect(w.canAttack(b, target)).toBe(false);
    place(b, hill.x + 1, hill.y);
    expect(w.canAttack(b, target)).toBe(true);
  });

  it('nobody walks up or down a mountain', () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const hill = w.map.hills[0];
    const b = hero(0, 'brakk');
    place(hero(1, 'orin'), 20, 20);
    place(b, hill.x, hill.y);
    run(w, 1);
    expect(Math.hypot(b.x - hill.x, b.y - hill.y)).toBeLessThan(1);
    w.applyCommand({ type: 'moveDir', unitId: b.id, dx: 1, dy: 0 });
    run(w, 3);
    expect(Math.hypot(b.x - hill.x, b.y - hill.y)).toBeLessThanOrEqual(6);
    expect(onHillTop(w, b.x, b.y)).toBe(true);
    place(b, hill.x + 7, hill.y);
    w.applyCommand({ type: 'moveDir', unitId: b.id, dx: -1, dy: 0 });
    run(w, 3);
    expect(onHillTop(w, b.x, b.y)).toBe(false);
  });

  it('the woods have hiding spots you can blink into, and no walking path out of', () => {
    const { w } = arena(['brakk'], ['orin']);
    const m = w.map;
    let pockets = 0;
    for (let i = 0; i < m.walkable.length; i++) if (m.walkable[i] && !m.reachable[i]) pockets++;
    expect(pockets).toBeGreaterThan(10);
  });

  it('a lone tree does not stand against the river rocks near the Warden', () => {
    const { w } = arena(['brakk'], ['orin']);
    for (const [x, y] of [[216.7, 193.2], [83.3, 106.8]]) {
      expect(w.map.trees.some((t) => Math.hypot(t.x - x, t.y - y) < 1)).toBe(false);
    }
  });
});

describe('spells go through trees, walls and buildings', () => {
  const charge = (w: World, b: Unit, dx: number, dy: number) => {
    b.hero!.abilities[0].level = 1;
    b.mana = b.maxMana;
    w.applyCommand({ type: 'cast', unitId: b.id, slot: 0, x: b.x + dx, y: b.y + dy });
  };
  /** A straight line of `len` m with a tree or wall partway along it, starting and ending in the open. */
  const lineThroughBlock = (w: World, len: number) => {
    const m = w.map;
    for (let y = 40; y < 260; y += 2) {
      for (let x = 40; x < 240; x += 2) {
        if (!fits(w.nav, x, y, 1) || !fits(w.nav, x + len, y, 1) || onHillTop(w, x + len, y)) continue;
        let blocked = false;
        for (let k = 2; k < len - 2; k++) if (!isWalkable(m, x + k, y) && !onHillTop(w, x + k, y)) blocked = true;
        if (blocked) return { x, y };
      }
    }
    throw new Error('no such line');
  };

  it("Brakk's charge goes its full distance through trees", () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const b = hero(0, 'brakk');
    place(hero(1, 'orin'), 20, 20);
    const range = HEROES.brakk.abilities[0].castRange;
    const s = lineThroughBlock(w, range);
    place(b, s.x, s.y);
    charge(w, b, 1, 0);
    run(w, 2);
    expect(b.x - s.x).toBeGreaterThan(range - 1);
    expect(fits(w.nav, b.x, b.y, b.radius)).toBe(true);
  });

  it('a charge that ends inside something comes out at the nearest open spot', () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const b = hero(0, 'brakk');
    place(hero(1, 'orin'), 20, 20);
    const range = HEROES.brakk.abilities[0].castRange;
    let start: { x: number; y: number } | null = null;
    for (let y = 40; y < 260 && !start; y += 2) {
      for (let x = 40; x < 240 && !start; x += 2) {
        if (fits(w.nav, x, y, 1) && !isWalkable(w.map, x + range, y) && !onHillTop(w, x + range, y)) start = { x, y };
      }
    }
    place(b, start!.x, start!.y);
    charge(w, b, 1, 0);
    run(w, 2);
    expect(fits(w.nav, b.x, b.y, b.radius)).toBe(true);
    expect(Math.hypot(b.x - start!.x - range, b.y - start!.y)).toBeLessThan(14);
  });

  it('a charge can land on a mountain, and can leave one', () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const hill = w.map.hills[0];
    const b = hero(0, 'brakk');
    place(hero(1, 'orin'), 20, 20);
    const range = HEROES.brakk.abilities[0].castRange;
    place(b, hill.x - range, hill.y);
    charge(w, b, 1, 0);
    run(w, 2);
    expect(onHillTop(w, b.x, b.y)).toBe(true);
    b.hero!.abilities[0].cooldown = 0;
    charge(w, b, 1, 0);
    run(w, 2);
    expect(onHillTop(w, b.x, b.y)).toBe(false);
  });
});

type HeroChannel = NonNullable<Unit['hero']>['channel'];

describe('true sight', () => {
  const veil = (u: Unit) => u.buffs.push({ key: 'veil', t: 60, invisible: true } as Unit['buffs'][number]);

  const zoneSpot = (w: World, tower: Unit, r: number, u: Unit) => {
    for (let a = 0; a < 6.3; a += 0.1) {
      const x = tower.x + Math.cos(a) * r;
      const y = tower.y + Math.sin(a) * r;
      w.vision.update(w);
      if (fits(w.nav, x, y, u.radius) && (r > trueSightRadius(tower) || w.vision.inTowerZone(tower.team as Team, x, y))) return { x, y };
    }
    throw new Error('no spot');
  };

  it('anyone in a tower attack zone is seen by its team and shot, invisible or not; outside it they are not', () => {
    const { w, hero } = arena(['brakk'], ['syl']);
    const tower = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1')!;
    const syl = hero(1, 'syl');
    place(hero(0, 'brakk'), 20, 250);
    veil(syl);
    const r = trueSightRadius(tower);
    let p = zoneSpot(w, tower, r - 2.5, syl);
    place(syl, p.x, p.y);
    w.vision.update(w);
    expect(w.vision.seesPoint(0, p.x, p.y)).toBe(false);
    expect(w.canSee(0, syl)).toBe(true);
    const hp = syl.hp;
    run(w, 2);
    expect(syl.hp).toBeLessThan(hp);
    p = zoneSpot(w, tower, r + 3, syl);
    place(syl, p.x, p.y);
    w.vision.update(w);
    expect(w.canSee(0, syl)).toBe(false);
    syl.buffs.length = 0;
    w.vision.update(w);
    expect(w.canSee(0, syl)).toBe(false);
  });

  it('trees hide you from a tower, until your enemies can see you there', () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const tower = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1')!;
    const o = hero(1, 'orin');
    place(hero(0, 'brakk'), 20, 250);
    const r = trueSightRadius(tower);
    w.vision.update(w);
    let spot: { x: number; y: number } | null = null;
    for (let a = 0; a < 6.3 && !spot; a += 0.05) {
      for (let d = 5; d < r - 1 && !spot; d += 1) {
        const x = tower.x + Math.cos(a) * d;
        const y = tower.y + Math.sin(a) * d;
        if (fits(w.nav, x, y, o.radius) && !w.vision.inTowerZone(0, x, y)) spot = { x, y };
      }
    }
    expect(spot).not.toBeNull();
    place(o, spot!.x, spot!.y);
    o.hero!.autoAttack = false;
    const hp = o.hp;
    w.vision.update(w);
    expect(w.canSee(0, o)).toBe(false);
    run(w, 1);
    place(o, spot!.x, spot!.y);
    expect(o.hp).toBe(hp);
    // A ward nearby gives vision, and now the tower shoots.
    const ward = w.spawnUnit('ward', 0, { x: spot!.x + 1, y: spot!.y }, WARDS.observer);
    ward.ward = { kind: 'observer', expires: 1e9, placedAt: 0 };
    w.vision.update(w);
    expect(w.canSee(0, o)).toBe(true);
    run(w, 2);
    expect(o.hp).toBeLessThan(hp);
  });

  it('wards in a tower zone are seen too', () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const tower = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1')!;
    place(hero(0, 'brakk'), 20, 250);
    const ward = w.spawnUnit('ward', 1, { x: tower.x + 4, y: tower.y }, WARDS.observer);
    ward.ward = { kind: 'observer', expires: 1e9, placedAt: 0 };
    w.vision.update(w);
    expect(w.canSee(0, ward)).toBe(true);
  });

  it('attacking a building reveals you with nobody around', () => {
    const { w, hero } = arena(['brakk'], ['vexa']);
    const tower = w.structures.find((s) => s.team === 0 && s.structure!.tier === 'tower1')!;
    const v = hero(1, 'vexa');
    place(hero(0, 'brakk'), 20, 250);
    const p = zoneSpot(w, tower, v.attackRange + tower.radius - 0.5, v);
    place(v, p.x, p.y);
    tower.structure!.vulnerable = true;
    w.vision.update(w);
    w.applyCommand({ type: 'attack', unitId: v.id, targetId: tower.id, priority: true });
    run(w, 1);
    expect(w.canSee(0, v)).toBe(true);
    expect(v.revealUntil).toBeGreaterThan(w.time + 1);
  });

  it('a stun cancels a teleport', () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const b = hero(0, 'brakk');
    place(hero(1, 'orin'), 20, 20);
    b.hero!.channel = { kind: 'tp', t: 3, total: 3, targetId: 0, x: 40, y: 260 } as unknown as HeroChannel;
    w.step();
    expect(b.hero!.channel).not.toBeNull();
    w.stun(b, 1);
    w.step();
    expect(b.hero!.channel).toBeNull();
  });

  it('towers give no vision; barracks, Shrine and fountain do. Only towers, fountain and sentries wear the eye', () => {
    const { w } = arena(['brakk'], ['syl']);
    w.vision.update(w);
    const tier = (t: string) => w.structures.find((s) => s.team === 0 && s.structure!.tier === t)!;
    for (const t of ['tower1', 'tower2', 'tower3', 'shrineTower']) expect(trueSightRadius(tier(t))).toBeGreaterThan(5);
    expect(trueSightRadius(tier('shrine'))).toBe(0);
    expect(trueSightRadius(tier('barracks'))).toBe(0);
    expect(trueSightRadius(tier('fountain'))).toBeGreaterThan(0);
    const t1 = tier('tower1');
    expect(w.vision.seesPoint(0, t1.x + 3, t1.y + 3)).toBe(false);
    for (const t of ['barracks', 'shrine', 'fountain']) expect(w.vision.seesPoint(0, tier(t).x, tier(t).y)).toBe(true);
  });

  it('a Watcher totem sees much farther from a mountain', () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const hill = w.map.hills[0];
    const count = () => {
      w.vision.update(w);
      return w.vision.grids[0].reduce((n, c) => n + c, 0);
    };
    place(hero(0, 'brakk'), 20, 250);
    const base = count();
    const ward = w.spawnUnit('ward', 0, { x: hill.x + 7, y: hill.y }, WARDS.observer);
    ward.ward = { kind: 'observer', expires: 1e9, placedAt: 0 };
    const ground = count() - base;
    ward.x = hill.x;
    const top = count() - base;
    expect(top).toBeGreaterThan(ground * 1.5);
  });

  it('a sentry on a mountain shows the enemy observer for 5 seconds, then you need vision of your own', () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const hill = w.map.hills[0];
    const mine = hero(0, 'brakk');
    const enemy = hero(1, 'orin');
    mine.hero!.gold = enemy.hero!.gold = 2000;
    w.applyCommand({ type: 'buy', unitId: enemy.id, itemId: 'observerWard' });
    w.applyCommand({ type: 'buy', unitId: mine.id, itemId: 'sentryWard' });
    const slot = (u: Unit, id: string) => u.hero!.items.findIndex((s) => s?.id === id);
    place(enemy, hill.x + 1, hill.y);
    w.applyCommand({ type: 'placeWard', unitId: enemy.id, slot: slot(enemy, 'observerWard'), x: hill.x, y: hill.y + 2 });
    place(enemy, 280, 40);
    const observer = w.units.find((u) => u.ward?.kind === 'observer')!;
    // Planted from the foot of the mountain.
    place(mine, hill.x + 6.5, hill.y);
    w.applyCommand({ type: 'placeWard', unitId: mine.id, slot: slot(mine, 'sentryWard'), x: hill.x + 1, y: hill.y });
    const sentry = w.units.find((u) => u.ward?.kind === 'sentry')!;
    w.vision.update(w);
    expect(w.canSee(0, observer)).toBe(true);
    const t0 = w.time;
    while (w.time < t0 + 5.5) w.step();
    place(mine, hill.x + 6.5, hill.y);
    w.vision.update(w);
    expect(sentry.alive).toBe(true);
    expect(w.canSee(0, observer)).toBe(false);
    // Jumping on top brings vision, and the sentry still unmasks the ward.
    place(mine, hill.x, hill.y);
    w.vision.update(w);
    expect(w.canSee(0, observer)).toBe(true);
  });
});

describe("Morra's wolves", () => {
  const pack = (w: World, m: Unit, x: number, y: number) => {
    const wolf = w.spawnSummon(m, { kind: 'wolf', ownerId: m.id, expires: w.time + 60 }, SUMMONS.wolf, 0);
    wolf.x = wolf.px = x;
    wolf.y = wolf.py = y;
    return wolf;
  };

  it('attack what she attacks with auto attack, and turn on whoever hits her', () => {
    const { w, hero } = arena(['morra'], ['orin', 'syl']);
    const m = hero(0, 'morra');
    const a = hero(1, 'orin');
    const b = hero(1, 'syl');
    place(m, 150, 150);
    place(a, 155, 150);
    place(b, 145, 150);
    const wolf = pack(w, m, 150, 152);
    w.vision.update(w);
    m.targetId = a.id;
    w.step();
    expect(wolf.targetId).toBe(a.id);
    place(a, 190, 150);
    m.targetId = null;
    w.vision.update(w);
    w.step();
    w.dealDamage(b.id, m, 1, 'attack');
    w.step();
    expect(wolf.targetId).toBe(b.id);
  });

  it('do not dive an enemy tower by themselves', () => {
    const { w, hero } = arena(['morra'], ['orin']);
    const m = hero(0, 'morra');
    const o = hero(1, 'orin');
    const tower = w.structures.find((s) => s.team === 1 && s.structure!.tier === 'tower1')!;
    place(o, tower.x + 5, tower.y + 5);
    place(m, tower.x + 16, tower.y + 16);
    const wolf = pack(w, m, tower.x + 15, tower.y + 15);
    w.vision.update(w);
    w.step();
    expect(wolf.targetId).not.toBe(o.id);
    expect(wolf.targetId).not.toBe(tower.id);
  });
});

describe('going around things', () => {
  it('creeps walk around every building to reach the far side', async () => {
    const { w } = arena(['brakk'], ['orin']);
    const walkers: { c: Unit; x: number; y: number }[] = [];
    for (const s of w.structures) {
      for (let a = 0; a < 6.28; a += 1.57) {
        const r = s.radius + 3;
        const x0 = s.x + Math.cos(a) * r;
        const y0 = s.y + Math.sin(a) * r;
        const x1 = s.x - Math.cos(a) * r;
        const y1 = s.y - Math.sin(a) * r;
        if (!fits(w.nav, x0, y0, 0.7) || !fits(w.nav, x1, y1, 0.7)) continue;
        const c = w.spawnUnit('creep', s.team as Team, { x: x0, y: y0 }, { ...CREEPS.melee, acquireRange: 0, attackRange: 0 });
        c.creep = { type: 'melee', lane: 'mid', path: [{ x: x1, y: y1 }], wp: 0, super: false, mega: false };
        walkers.push({ c, x: x1, y: y1 });
      }
    }
    expect(walkers.length).toBeGreaterThan(30);
    for (let i = 0; i < 16 * TICK_RATE; i++) {
      w.step();
      if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const lost = walkers.filter((k) => k.c.alive && k.c.creep!.wp < 1);
    expect(lost.map((k) => [Math.round(k.c.x), Math.round(k.c.y), Math.round(k.x), Math.round(k.y), k.c.creep!.wp, k.c.targetId])).toEqual([]);
  }, 60000);

  it('a unit with truly nowhere to go just stands there', () => {
    const { w, hero } = arena(['brakk'], ['orin']);
    const b = hero(0, 'brakk');
    const n = w.map.grid;
    const c = w.map.cell;
    const x = 150;
    const y = 150;
    place(b, x, y);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (Math.hypot(dx, dy) > 1.5) w.nav.walkable[(Math.floor(y / c) + dy) * n + Math.floor(x / c) + dx] = 0;
    b.hero!.controller = 'bot';
    for (let i = 0; i < 90; i++) {
      w.time += 1 / 30;
      w.navigate(b, x + 30, y, 0.3);
    }
    expect(Math.hypot(b.x - x, b.y - y)).toBeLessThan(5);
  });
});
