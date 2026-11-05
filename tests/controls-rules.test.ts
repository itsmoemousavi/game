import { describe, expect, it } from 'vitest';
import { HeroId, ITEMS, LANE_IDS, PlayerSlot, TICK_RATE, TELEPORT, Team, Unit, World, teleportTargets, tpBuyBlocker } from '../src/sim';
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
