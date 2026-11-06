import type { World } from './world';

const buf = new DataView(new ArrayBuffer(8));

/**
 * A fingerprint of the match so far, down to the last bit of every number. Two devices playing the same
 * match must get the same value at the same tick; a difference means they have drifted apart.
 */
export function stateHash(w: World): number {
  let h = 2166136261 | 0;
  const num = (v: number) => {
    buf.setFloat64(0, v);
    h = Math.imul(h ^ buf.getInt32(0), 16777619);
    h = Math.imul(h ^ buf.getInt32(4), 16777619);
  };
  num(w.tick);
  num(w.time);
  num(w.teamKills[0]);
  num(w.teamKills[1]);
  num(w.units.length);
  for (const u of w.units) {
    num(u.id);
    num(u.x);
    num(u.y);
    num(u.hp);
    num(u.mana);
    num(u.facing);
    if (u.hero) {
      num(u.hero.gold);
      num(u.hero.xp);
    }
  }
  return h >>> 0;
}
