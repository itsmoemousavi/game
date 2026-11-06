import * as THREE from 'three';
import { HeroId, Unit, World, abilityLevel } from '../../sim';
import type { Fx3D } from './fx';
import type { Joint } from './models';
import type { MonsterKind } from './monster-anims';

/**
 * Hand-made animation for the six heroes: idle, walk, attacks, every spell, buffs and deaths.
 * Each hero is posed by adding small rotations (radians) to its joints on top of the model's
 * rest stance, from a few keyframes per move. Effects (dust, sparks, slashes, roots…) come from
 * Fx3D; sounds tied to the motion (impacts) go through `ctx.sound`.
 */

/** What the animations need from the renderer. */
export interface AnimCtx {
  fx: Fx3D;
  /** Renderer clock (seconds) and frame time. */
  clock: number;
  dt: number;
  world: World | null;
  meId: number;
  camX: number;
  camY: number;
  sound(name: string, x: number, y: number, volume: number): void;
}

/** Per-unit animation state (renderer clock times; -9 = long ago). */
export interface Anim {
  phase: number;
  walk: number;
  atk: number;
  cast: number;
  atkAt: number;
  atkTarget: number;
  impactDone: boolean;
  castAt: number;
  castSlot: number;
  blastAt: number;
  trailAt: number;
  stepSign: number;
  ironHide: boolean;
  glintAt: number;
  /** Alternating attack side (dual daggers, left/right punches). */
  side: number;
  /** Bow / spell aim blend 0..1. */
  aim: number;
  /** Last time an idle or buff particle was spawned. */
  moteAt: number;
  buffAt: number;
  critAt: number;
  castDone: boolean;
}

export function newAnim(): Anim {
  return { phase: 0, walk: 0, atk: 0, cast: 0, atkAt: -9, atkTarget: -1, impactDone: true, castAt: -9, castSlot: -1, blastAt: -9, trailAt: 0, stepSign: 1, ironHide: false, glintAt: 0, side: 1, aim: 0, moteAt: 0, buffAt: 0, critAt: -9, castDone: true };
}

export type Joints = Partial<Record<Joint, THREE.Object3D>>;

/** Smooth value along keyframes [time, value] (holds the ends). */
export function track(t: number, keys: [number, number][]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const k = (t - t0) / (t1 - t0 || 1);
      const e = k * k * (3 - 2 * k);
      return v0 + (v1 - v0) * e;
    }
  }
  return keys[keys.length - 1][1];
}

const qa = new THREE.Quaternion();
const ea = new THREE.Euler();
/** Rest pose of a joint, then turned by (x, y, z) radians in its own frame. */
export function pose(o: THREE.Object3D | undefined, x: number, y: number, z: number) {
  if (!o) return;
  o.quaternion.fromArray(o.userData.rest as number[]).multiply(qa.setFromEuler(ea.set(x, y, z)));
}

const BONES = ['torso', 'head', 'legL', 'legR', 'armL', 'armR', 'weapon'] as const;
type Bone = (typeof BONES)[number];

/** Collects joint offsets for one frame, then applies them. */
export class Pose {
  p: Record<Bone, [number, number, number]> = { torso: [0, 0, 0], head: [0, 0, 0], legL: [0, 0, 0], legR: [0, 0, 0], armL: [0, 0, 0], armR: [0, 0, 0], weapon: [0, 0, 0] };
  rigY = 0;
  rigX = 0;
  rigZ = 0;
  add(k: Bone, x: number, y = 0, z = 0) {
    const v = this.p[k];
    v[0] += x;
    v[1] += y;
    v[2] += z;
  }
  apply(j: Joints) {
    for (const k of BONES) pose(j[k], this.p[k][0], this.p[k][1], this.p[k][2]);
    if (j.rig) {
      const rp = j.rig.userData.restPos as number[];
      j.rig.position.set(rp[0], rp[1] + this.rigY, rp[2]);
      pose(j.rig, this.rigX, 0, this.rigZ);
    }
  }
}

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** World position of a point given in a joint's own coordinates (call after posing). */
export function at(root: THREE.Object3D, j: THREE.Object3D | undefined, x: number, y: number, z: number): THREE.Vector3 {
  if (!j) return root.getWorldPosition(v3()).add(v3(0, 2, 0));
  root.updateMatrixWorld(true);
  return j.localToWorld(v3(x, y, z));
}
/** World point beside the unit on the ground: `fwd` meters ahead, `side` to the right. */
export function near(_c: AnimCtx, u: Unit, fwd: number, side = 0): [number, number] {
  const f = u.facing;
  return [u.x + Math.cos(f) * fwd - Math.sin(f) * side, u.y + Math.sin(f) * fwd + Math.cos(f) * side];
}

interface Walk {
  /** sin of the step cycle, walk blend 0..1, moving now. */
  s: number;
  walk: number;
  moving: boolean;
  speed: number;
}

/** Shared walk cycle + footstep detection (for dust: walking makes no sound, for anyone). `cadence` = cycle speed at rest, `perMs` per m/s. */
export function locomotion(c: AnimCtx, u: Unit, a: Anim, cadence: number, perMs: number, onStep?: (side: number) => void): Walk {
  const speed = Math.hypot(u.x - u.px, u.y - u.py) * 30;
  const dashing = !!u.dash;
  const moving = speed > 0.5 && u.stunTimer <= 0 && !dashing;
  a.walk += ((moving ? 1 : 0) - a.walk) * Math.min(1, c.dt * 8);
  if (moving || dashing) a.phase += c.dt * (dashing ? 22 : cadence + speed * perMs);
  const s = Math.sin(a.phase);
  const sign = s >= 0 ? 1 : -1;
  if (onStep && moving && sign !== a.stepSign && a.walk > 0.6) onStep(sign);
  a.stepSign = sign;
  return { s, walk: a.walk, moving, speed };
}

/** A footstep puff at the foot that just landed. */
export function footDust(c: AnimCtx, u: Unit, side: number, color = 0x8a7558, size = 0.6) {
  const [x, y] = near(c, u, 0, side * 0.4);
  c.fx.dust(x, y, 1, size, color, 0.2, 0.5);
}

/** Stunned: dazed sway and drooping head, on any hero. */
export function stunned(P: Pose, u: Unit, time: number) {
  if (u.stunTimer <= 0) return;
  P.add('torso', 0.15, 0, Math.sin(time * 5) * 0.14);
  P.add('head', 0.35, Math.sin(time * 3.3) * 0.2);
  P.add('armL', 0.25);
  P.add('armR', 0.25);
}

/** Turn the weapon joint so it points the way the whole model faces (bows, trident), blended by k. */
const qw = new THREE.Quaternion();
const qr = new THREE.Quaternion();
const qt = new THREE.Quaternion();
function aimWeapon(root: THREE.Object3D, j: Joints, k: number, pitch = 0, roll = 0) {
  const w = j.weapon;
  if (!w || !w.parent || k <= 0.001) return;
  root.updateMatrixWorld(true);
  w.parent.getWorldQuaternion(qw).invert();
  root.getWorldQuaternion(qr);
  qt.copy(qw).multiply(qr).multiply(qa.setFromEuler(ea.set(pitch, 0, roll)));
  w.quaternion.slerp(qt, Math.min(1, k));
}

// ======================================================================== per hero

type Animator = (c: AnimCtx, o: THREE.Object3D, j: Joints, u: Unit, a: Anim, time: number) => void;

/**
 * Brakk: a heavy stomping walk, breathing idle, an overhead hammer slam, Shield Charge (lean in
 * behind the shield), Earthsplitter (leap, then slam the ground), Iron Hide clang and glints.
 */
const brakk: Animator = (c, _o, j, u, a, time) => {
  const now = c.clock;
  const dashing = !!u.dash;
  const { s, walk } = locomotion(c, u, a, 4.2, 0.75, (side) => {
    footDust(c, u, side, 0x8a7558, 0.7);
  });
  const P = new Pose();
  const breathe = Math.sin(time * 1.8 + u.id) * 0.035 * (1 - walk);
  P.add('torso', breathe + walk * 0.12, s * 0.12 * walk);
  P.add('head', -walk * 0.08, Math.sin(time * 0.45 + u.id) * 0.18 * (1 - walk));
  P.add('legL', s * 0.6 * walk);
  P.add('legR', -s * 0.6 * walk);
  P.add('armL', s * 0.1 * walk);
  P.add('armR', -s * 0.35 * walk);
  P.add('weapon', Math.sin(time * 1.1 + u.id) * 0.05 * (1 - walk) - walk * 0.15);
  P.rigY = -Math.abs(s) * 0.1 * walk;
  // Hammer slam attack: wind up overhead, smash down, recover. Impact at ~0.19 s.
  const ta = now - a.atkAt;
  if (ta < 0.65) {
    P.add('armR', track(ta, [[0, 0], [0.12, -2.9], [0.2, -0.75], [0.32, -0.75], [0.62, 0]]));
    P.add('weapon', track(ta, [[0, 0], [0.12, -0.4], [0.2, -1.05], [0.32, -1.05], [0.62, 0]]));
    P.add('torso', track(ta, [[0, 0], [0.12, -0.22], [0.2, 0.45], [0.32, 0.45], [0.62, 0]]), track(ta, [[0, 0], [0.12, 0.35], [0.2, -0.12], [0.62, 0]]));
    P.add('armL', track(ta, [[0, 0], [0.12, 0.25], [0.2, -0.2], [0.62, 0]]));
    P.rigY += track(ta, [[0, 0], [0.2, -0.12], [0.32, -0.12], [0.62, 0]]);
    if (!a.impactDone && ta >= 0.19) {
      a.impactDone = true;
      const [hx, hy] = targetPoint(c, u, a, 2.2);
      c.fx.sparks(hx, hy, 1.1, 7, 0xffd27a, 4);
      c.fx.dust(hx, hy, 3, 0.9, 0x8a7558, 0.4, 0.6);
    }
  }
  // Shield Charge: lean in behind the raised shield, hammer pulled back, legs pumping.
  const tc = now - a.castAt;
  if (a.castSlot === 0 && (dashing || tc < 0.5)) {
    const k = dashing ? 1 : 1 - Math.min(1, tc / 0.5);
    P.add('torso', 0.5 * k);
    P.add('head', -0.35 * k);
    P.add('armL', -0.55 * k, 0, 0.15 * k);
    P.add('armR', 0.75 * k);
    P.add('weapon', 0.45 * k);
    P.add('legL', Math.sin(a.phase) * 0.9 * k);
    P.add('legR', -Math.sin(a.phase) * 0.9 * k);
    P.rigY += -Math.abs(Math.sin(a.phase)) * 0.12 * k;
    if (dashing && now - a.trailAt > 0.05) {
      a.trailAt = now;
      const [x, y] = near(c, u, -0.8);
      c.fx.dust(x, y, 2, 1.1, 0x9a8466, 0.4, 0.7);
    }
  }
  // Earthsplitter: crouch, leap with the hammer high, slam down as the ground breaks.
  const te = Math.min(now - a.castAt, a.blastAt > a.castAt ? 0.6 + (now - a.blastAt) : 9);
  if (a.castSlot === 2 && te < 1.35) {
    P.rigY += track(te, [[0, 0], [0.08, -0.18], [0.34, 1.5], [0.56, 0.4], [0.62, -0.3], [0.95, -0.3], [1.35, 0]]);
    P.add('armR', track(te, [[0, 0], [0.3, -3.1], [0.56, -3.25], [0.63, -0.45], [0.95, -0.45], [1.35, 0]]));
    P.add('weapon', track(te, [[0, 0], [0.3, -0.2], [0.56, -0.2], [0.63, -1.35], [0.95, -1.35], [1.35, 0]]));
    P.add('torso', track(te, [[0, 0], [0.3, -0.38], [0.56, -0.3], [0.63, 0.75], [0.95, 0.75], [1.35, 0]]));
    P.add('armL', track(te, [[0, 0], [0.3, 0.45], [0.63, -0.25], [1.35, 0]]));
    const tuck = track(te, [[0, 0], [0.08, 0.25], [0.34, -0.55], [0.56, -0.2], [0.63, 0.35], [0.95, 0.35], [1.35, 0]]);
    P.add('legL', tuck);
    P.add('legR', tuck * 0.6);
    P.rigX += track(te, [[0, 0], [0.63, 0.1], [0.95, 0.1], [1.35, 0]]);
  }
  stunned(P, u, time);
  P.add('weapon', u.stunTimer > 0 ? 0.5 : 0);
  // Iron Hide (below half health): a metal ring when it kicks in, then a glint now and then.
  const iron = abilityLevel(u, 'ironHide') > 0 && u.hp < u.maxHp * 0.5;
  if (iron && !a.ironHide) {
    c.fx.flash(u.x, u.y, 2, 5, 0xc9d6e3, 0.4);
    c.fx.shockwave(u.x, u.y, 2.6, 0xc9d6e3, 0.35);
    c.sound('ironClang', u.x, u.y, 1);
  }
  if (iron && now - a.glintAt > 1.6) {
    a.glintAt = now;
    c.fx.sparks(u.x, u.y, 2.2, 4, 0xe2e8f0, 2.5);
  }
  a.ironHide = iron;
  P.apply(j);
};

/**
 * Vexa: light quick strides with the bow held low; when shooting she turns side-on, raises the
 * bow and draws. Each shot snaps the string hand back, then she nocks the next arrow.
 */
const vexa: Animator = (c, o, j, u, a, time) => {
  const now = c.clock;
  const { s, walk } = locomotion(c, u, a, 5.2, 0.95, (side) => {
    footDust(c, u, side, 0x8a7558, 0.45);
  });
  const P = new Pose();
  const ta = now - a.atkAt;
  const tc = now - a.castAt;
  const shooting = ta < 1.5 || (a.castSlot !== 1 && tc < 0.8);
  a.aim += ((shooting ? 1 : 0) - a.aim) * Math.min(1, c.dt * (shooting ? 14 : 4));
  const k = a.aim;
  const free = 1 - k;
  P.add('torso', Math.sin(time * 2 + u.id) * 0.03 * (1 - walk) + walk * 0.1 * free, s * 0.1 * walk * free);
  P.add('head', 0, Math.sin(time * 0.6 + u.id) * 0.25 * (1 - walk) * free);
  P.add('legL', s * 0.7 * walk);
  P.add('legR', -s * 0.7 * walk);
  P.add('armL', s * 0.15 * walk * free);
  P.add('armR', -s * 0.45 * walk * free);
  P.rigY = -Math.abs(s) * 0.07 * walk;
  // Side-on archer stance (left shoulder to the target), bow raised and drawn.
  P.add('torso', 0, 1.1 * k);
  P.add('head', 0, -1.0 * k);
  P.add('armL', 0.35 * k, 0, -1.4 * k);
  P.add('armR', 0.1 * k, 0, -1.2 * k);
  P.add('legL', 0, 0, 0.12 * k * (1 - walk));
  P.add('legR', 0, 0, -0.12 * k * (1 - walk));
  // Each shot: the string hand snaps back, then reaches for the next arrow and draws again.
  if (ta < 0.8) P.add('armR', 0, 0, track(ta, [[0, 0], [0.05, 0.45], [0.22, 0.45], [0.45, -0.35], [0.75, 0]]) * k);
  let pitch = 0;
  // Piercing Arrow: a deeper draw and a hard recoil.
  if (a.castSlot === 0 && tc < 0.8) {
    P.add('armR', 0, 0, track(tc, [[0, 0.1], [0.05, 0.6], [0.3, 0.6], [0.8, 0]]));
    P.add('torso', track(tc, [[0, -0.15], [0.06, -0.25], [0.8, 0]]));
    if (!a.castDone) {
      a.castDone = true;
      const tip = at(o, j.weapon, 0, 0, 0.6);
      c.fx.flashAt(tip, 3.5, 0x9fffc8, 0.35);
      c.fx.burst(tip, 12, 0x9fffc8, 7, 0.35, 0.4, 2);
      c.fx.shockwave(u.x, u.y, 2.2, 0x9fffc8, 0.35);
    }
  }
  // Arrow Storm: aim high and loose a volley into the sky.
  if (a.castSlot === 2 && tc < 1.0) {
    const up = track(tc, [[0, 1], [0.6, 1], [1.0, 0]]);
    pitch = -0.95 * up;
    P.add('armL', 0, 0, -0.9 * up);
    P.add('armR', 0, 0, -0.5 * up);
    P.add('torso', -0.25 * up);
    P.add('head', -0.4 * up);
    if (!a.castDone) {
      a.castDone = true;
      const tip = at(o, j.weapon, 0, 0, 0.6);
      c.fx.flashAt(tip, 3, 0xd9fff0, 0.3);
      for (let i = 0; i < 10; i++) c.fx.particle(tip, 0xd9fff0, 0.3, 0.5, { vel: v3((Math.random() - 0.5) * 3, 22 + Math.random() * 6, (Math.random() - 0.5) * 3) });
    }
  }
  // Hunter's Rhythm critical shot: the bow flares green.
  if (now - a.critAt < 0.05 && !a.impactDone) {
    a.impactDone = true;
    const tip = at(o, j.weapon, 0, 0, 0.4);
    c.fx.flashAt(tip, 3, 0x6dff9e, 0.3);
    c.fx.burst(tip, 8, 0x6dff9e, 5, 0.3, 0.35, 3);
  }
  stunned(P, u, time);
  P.apply(j);
  aimWeapon(o, j, k, pitch);
};

/**
 * Orin: glides in his robe with the staff swaying; embers drift up from the staff crystal. He
 * flings fire bolts from his right palm, thrusts both hands for Fireball, raises the staff to
 * heal, and levitates with both arms up while calling down Cataclysm.
 */
const orin: Animator = (c, o, j, u, a, time) => {
  const now = c.clock;
  const { s, walk } = locomotion(c, u, a, 3.6, 0.6);
  const P = new Pose();
  P.add('torso', Math.sin(time * 1.6 + u.id) * 0.03 + walk * 0.12, 0, s * 0.04 * walk);
  P.add('head', 0, Math.sin(time * 0.5 + u.id) * 0.2 * (1 - walk));
  P.add('armL', s * 0.1 * walk);
  P.add('armR', -s * 0.25 * walk + Math.sin(time * 1.3) * 0.04);
  P.add('weapon', Math.sin(time * 1.1 + u.id) * 0.05);
  P.rigY = Math.sin(a.phase * 2) * 0.03 * walk;
  P.rigZ = s * 0.05 * walk;
  // Fire bolt: right palm thrust forward.
  const ta = now - a.atkAt;
  if (ta < 0.5) {
    P.add('armR', track(ta, [[0, -1.5], [0.08, -1.55], [0.5, 0]]), 0, track(ta, [[0, -0.2], [0.5, 0]]));
    P.add('torso', 0, track(ta, [[0, -0.3], [0.5, 0]]));
    if (!a.impactDone) {
      a.impactDone = true;
      const p = at(o, j.armR, 0, -0.65, 0.1);
      c.fx.flashAt(p, 1.8, 0xffa040, 0.2);
      c.fx.burst(p, 5, 0xffa040, 3, 0.25, 0.3, -2);
    }
  }
  const tc = now - a.castAt;
  if (a.castSlot === 0 && tc < 0.6) {
    // Fireball: both hands thrust out.
    P.add('armR', track(tc, [[0, -1.6], [0.1, -1.55], [0.6, 0]]), 0, track(tc, [[0, -0.35], [0.6, 0]]));
    P.add('armL', track(tc, [[0, -0.7], [0.6, 0]]), 0, track(tc, [[0, 0.3], [0.6, 0]]));
    P.add('torso', track(tc, [[0, 0.3], [0.6, 0]]));
    if (!a.castDone) {
      a.castDone = true;
      const p = at(o, j.armR, 0, -0.7, 0.1);
      c.fx.flashAt(p, 3.5, 0xffb347, 0.3);
      c.fx.burst(p, 14, 0xff7a2a, 6, 0.45, 0.45, -1);
    }
  } else if (a.castSlot === 1 && tc < 0.7) {
    // Mending Flame: staff raised.
    P.add('armL', track(tc, [[0, -1.3], [0.2, -1.45], [0.7, 0]]));
    P.add('weapon', track(tc, [[0, 1.0], [0.7, 0]]));
    P.add('head', track(tc, [[0, -0.2], [0.7, 0]]));
    if (!a.castDone) {
      a.castDone = true;
      const p = at(o, j.weapon, 0, 1.33, 0);
      c.fx.flashAt(p, 3, 0xffd27a, 0.4);
      c.fx.burst(p, 10, 0xffd27a, 3, 0.3, 0.6, -1.5);
    }
  } else if (a.castSlot === 2) {
    // Cataclysm: levitate with both arms raised while the meteor falls, then bring them down.
    const te = a.blastAt > a.castAt ? 1.2 + (now - a.blastAt) : tc;
    if (te < 1.9) {
      const up = track(te, [[0, 0], [0.25, 1], [1.2, 1], [1.35, 0.2], [1.9, 0]]);
      P.add('armL', -2.5 * up, 0, -0.3 * up);
      P.add('armR', -2.7 * up, 0, 0.3 * up);
      P.add('weapon', 0.6 * up);
      P.add('torso', -0.25 * up);
      P.add('head', -0.45 * up);
      P.rigY += 0.35 * up;
      P.add('torso', track(te, [[1.2, 0], [1.3, 0.45], [1.9, 0]]));
      if (te < 1.2 && now - a.moteAt > 0.04) {
        a.moteAt = now;
        const ang = time * 6;
        const p = o.getWorldPosition(v3()).add(v3(Math.cos(ang) * 1.6, 0.5 + Math.random() * 3, Math.sin(ang) * 1.6));
        c.fx.particle(p, Math.random() < 0.5 ? 0xffa040 : 0xff5a1a, 0.5, 0.6, { vel: v3(0, 2.5, 0) });
        if (Math.random() < 0.3) c.fx.flashAt(at(o, j.weapon, 0, 1.33, 0), 2.6, 0xff7a2a, 0.2);
      }
    }
  }
  // Embers drifting up from the staff crystal.
  if (now - a.moteAt > 0.22) {
    a.moteAt = now;
    const p = at(o, j.weapon, (Math.random() - 0.5) * 0.15, 1.4, (Math.random() - 0.5) * 0.15);
    c.fx.particle(p, Math.random() < 0.6 ? 0xffa040 : 0xffd27a, 0.22, 0.9, { vel: v3((Math.random() - 0.5) * 0.4, 1.4, (Math.random() - 0.5) * 0.4) });
  }
  stunned(P, u, time);
  P.apply(j);
};

/**
 * Syl: crouched and springy, daggers ready. Attacks alternate left and right slashes; Shadow
 * Lunge is a smoky dash and a double stab; Veil vanishes in a puff of shadow; Execution is a
 * leap and a crossing overhead strike.
 */
const syl: Animator = (c, _o, j, u, a, time) => {
  const now = c.clock;
  const { s, walk } = locomotion(c, u, a, 6, 1.0, (side) => {
    void side;
  });
  const P = new Pose();
  const idle = 1 - walk;
  P.add('torso', walk * 0.25 + Math.sin(time * 2.6 + u.id) * 0.03 * idle, s * 0.15 * walk);
  P.add('head', -walk * 0.15, Math.sin(time * 0.8 + u.id) * 0.3 * idle);
  P.add('legL', s * 0.85 * walk);
  P.add('legR', -s * 0.85 * walk);
  P.add('armL', -s * 0.5 * walk);
  P.add('armR', s * 0.5 * walk);
  P.add('weapon', 0, Math.sin(time * 3 + u.id) * 0.4 * idle);
  P.rigY = -Math.abs(s) * 0.08 * walk + Math.sin(time * 2.6 + u.id) * 0.03 * idle;
  // Slashes: alternate sides; the blade arc appears as the cut lands (~0.1 s).
  const ta = now - a.atkAt;
  if (ta < 0.45) {
    const arm = a.side > 0 ? 'armR' : 'armL';
    const sg = a.side;
    P.add(arm, track(ta, [[0, -0.4], [0.06, -1.9], [0.14, -0.7], [0.45, 0]]), 0, sg * track(ta, [[0, 0.3], [0.06, 0.9], [0.14, -0.7], [0.45, 0]]));
    P.add('torso', track(ta, [[0, 0], [0.12, 0.25], [0.45, 0]]), sg * track(ta, [[0, 0.3], [0.06, 0.45], [0.14, -0.4], [0.45, 0]]));
    if (!a.impactDone && ta >= 0.09) {
      a.impactDone = true;
      c.fx.slash(u.x, u.y, 1.5, u.facing, 0xc4a6ff, 2.4, sg * 0.75, 0.18);
      const [hx, hy] = targetPoint(c, u, a, 2);
      c.fx.sparks(hx, hy, 1.4, 4, 0xd8c8ff, 3);
    }
  }
  const tc = now - a.castAt;
  if (a.castSlot === 0 && tc < 0.5) {
    // Shadow Lunge: both daggers driven forward.
    P.add('armL', track(tc, [[0, -1.6], [0.12, -1.6], [0.5, 0]]), 0, track(tc, [[0, 0.35], [0.5, 0]]));
    P.add('armR', track(tc, [[0, -1.6], [0.12, -1.6], [0.5, 0]]), 0, track(tc, [[0, -0.35], [0.5, 0]]));
    P.add('torso', track(tc, [[0, 0.5], [0.5, 0]]));
    P.add('legL', track(tc, [[0, -0.8], [0.5, 0]]));
    P.add('legR', track(tc, [[0, 0.6], [0.5, 0]]));
  } else if (a.castSlot === 1 && tc < 0.4) {
    // Veil: a spin into the shadows.
    P.add('torso', 0.3 * (1 - tc / 0.4), tc * 15);
    P.add('armL', -1.2 * (1 - tc / 0.4), 0, -0.8 * (1 - tc / 0.4));
    P.add('armR', -1.2 * (1 - tc / 0.4), 0, 0.8 * (1 - tc / 0.4));
  } else if (a.castSlot === 2 && tc < 0.7) {
    // Execution: leap, both daggers overhead, crossing strike down.
    P.rigY += track(tc, [[0, 0.1], [0.1, 0.7], [0.2, 0], [0.7, 0]]);
    P.add('armL', track(tc, [[0, -2.6], [0.1, -2.9], [0.2, -0.5], [0.35, -0.5], [0.7, 0]]), 0, track(tc, [[0, 0], [0.2, 0.5], [0.7, 0]]));
    P.add('armR', track(tc, [[0, -2.6], [0.1, -2.9], [0.2, -0.5], [0.35, -0.5], [0.7, 0]]), 0, track(tc, [[0, 0], [0.2, -0.5], [0.7, 0]]));
    P.add('torso', track(tc, [[0, -0.3], [0.1, -0.35], [0.2, 0.6], [0.35, 0.6], [0.7, 0]]));
    const tuck = track(tc, [[0, 0], [0.1, -0.7], [0.2, 0.2], [0.7, 0]]);
    P.add('legL', tuck);
    P.add('legR', tuck * 0.5);
  }
  stunned(P, u, time);
  P.apply(j);
};

/**
 * Grom: a slow, swaying, heavy walk that shakes the ground; leaves drift off him. He swings his
 * root fists one after the other, slams the ground for Root Snare, braces for Bark Skin and roars
 * with arms wide for Overgrowth.
 */
const grom: Animator = (c, o, j, u, a, time) => {
  const now = c.clock;
  const { s, walk } = locomotion(c, u, a, 3.2, 0.55, (side) => {
    footDust(c, u, side, 0x7a6448, 0.9);
  });
  const P = new Pose();
  const idle = 1 - walk;
  P.add('torso', Math.sin(time * 1.2 + u.id) * 0.04 * idle + walk * 0.1, s * 0.15 * walk, Math.sin(time * 0.7 + u.id) * 0.04 * idle);
  P.add('head', 0, Math.sin(time * 0.35 + u.id) * 0.25 * idle);
  P.add('legL', s * 0.45 * walk);
  P.add('legR', -s * 0.45 * walk);
  P.add('armL', s * 0.3 * walk + Math.sin(time * 1.2) * 0.04 * idle);
  P.add('armR', -s * 0.3 * walk - Math.sin(time * 1.2) * 0.04 * idle);
  P.rigY = -Math.abs(s) * 0.12 * walk;
  P.rigZ = s * 0.06 * walk;
  // Fist swings, alternating; impact at 0.22 s.
  const ta = now - a.atkAt;
  if (ta < 0.7) {
    const arm = a.side > 0 ? 'armR' : 'armL';
    const sg = a.side;
    P.add(arm, track(ta, [[0, 0], [0.13, -2.5], [0.22, -1.0], [0.38, -1.0], [0.7, 0]]), 0, sg * track(ta, [[0, 0], [0.13, 0.3], [0.22, -0.25], [0.7, 0]]));
    P.add('torso', track(ta, [[0, 0], [0.13, -0.2], [0.22, 0.4], [0.38, 0.4], [0.7, 0]]), sg * track(ta, [[0, 0], [0.13, 0.35], [0.22, -0.2], [0.7, 0]]));
    P.rigY += track(ta, [[0, 0], [0.22, -0.1], [0.38, -0.1], [0.7, 0]]);
    if (!a.impactDone && ta >= 0.22) {
      a.impactDone = true;
      const [hx, hy] = targetPoint(c, u, a, 2.4);
      c.fx.dust(hx, hy, 3, 1, 0x7a6448, 0.5, 0.6);
      c.fx.burst(v3(hx, groundAt(c, hx, hy) + 1.4, hy), 6, 0x6a9a2a, 4, 0.22, 0.6, 8, false);
    }
  }
  const tc = now - a.castAt;
  if (a.castSlot === 0 && tc < 0.8) {
    // Root Snare: hammer a fist into the ground.
    P.add('armR', track(tc, [[0, -2.4], [0.1, -0.5], [0.45, -0.5], [0.8, 0]]));
    P.add('torso', track(tc, [[0, -0.2], [0.1, 0.65], [0.45, 0.65], [0.8, 0]]));
    P.rigY += track(tc, [[0, 0], [0.1, -0.2], [0.45, -0.2], [0.8, 0]]);
    if (!a.castDone && tc >= 0.1) {
      a.castDone = true;
      const [x, y] = near(c, u, 1.6);
      c.fx.dust(x, y, 5, 1.2, 0x7a6448, 0.6, 0.8);
      c.fx.shockwave(x, y, 2.2, 0x9dff5a, 0.3, 0.6);
    }
  } else if (a.castSlot === 1 && tc < 0.9) {
    // Bark Skin: brace, arms crossed, bark hardening.
    const k = track(tc, [[0, 0], [0.12, 1], [0.6, 1], [0.9, 0]]);
    P.add('armL', -1.3 * k, 0, 0.7 * k);
    P.add('armR', -1.3 * k, 0, -0.7 * k);
    P.add('torso', 0.2 * k);
    P.add('head', 0.25 * k);
    P.rigY -= 0.12 * k;
    if (!a.castDone) {
      a.castDone = true;
      c.fx.shockwave(u.x, u.y, 3, 0x9dff5a, 0.4, 0.7);
      c.fx.burst(at(o, j.torso, 0, 0.5, 0), 14, 0x6a9a2a, 4, 0.25, 0.8, 4, false);
    }
  } else if (a.castSlot === 2 && tc < 1.3) {
    // Overgrowth: rear up and roar with arms wide, then stomp.
    const k = track(tc, [[0, 0], [0.15, 1], [0.7, 1], [1.3, 0]]);
    P.add('armL', -1.6 * k, 0, -0.9 * k);
    P.add('armR', -1.6 * k, 0, 0.9 * k);
    P.add('torso', -0.35 * k);
    P.add('head', -0.5 * k + Math.sin(time * 40) * 0.03 * k);
    P.rigY += 0.15 * k;
  }
  // Leaves drift off now and then.
  if (now - a.moteAt > 1.3) {
    a.moteAt = now + Math.random() * 0.8;
    const p = at(o, j.torso, (Math.random() - 0.5) * 1.2, 0.95, (Math.random() - 0.5) * 0.4);
    c.fx.particle(p, 0x5f8f24, 0.25, 2.2, { vel: v3((Math.random() - 0.5) * 0.6, -0.6, (Math.random() - 0.5) * 0.6), additive: false });
  }
  stunned(P, u, time);
  P.apply(j);
};

/**
 * Kaela: glides with a slight float, leaving ripples; water drips from the orb at her hand. She
 * looses water bolts from the orb, sweeps the trident for Tidal Wave, reaches toward an ally
 * for Brine Veil and raises the trident overhead to call the Maelstrom.
 */
const kaela: Animator = (c, o, j, u, a, time) => {
  const now = c.clock;
  const { s, walk } = locomotion(c, u, a, 3.6, 0.6);
  const P = new Pose();
  P.add('torso', Math.sin(time * 1.5 + u.id) * 0.03 + walk * 0.1, 0, s * 0.04 * walk);
  P.add('head', 0, Math.sin(time * 0.55 + u.id) * 0.2 * (1 - walk));
  P.add('armL', -s * 0.12 * walk + Math.sin(time * 1.5) * 0.05);
  P.add('armR', s * 0.08 * walk);
  P.rigY = Math.sin(time * 1.5 + u.id) * 0.04 + Math.sin(a.phase * 2) * 0.02 * walk;
  P.rigZ = s * 0.04 * walk;
  if (walk > 0.5 && now - a.trailAt > 0.35) {
    a.trailAt = now;
    c.fx.shockwave(u.x, u.y, 1.3, 0x5fe0f5, 0.6, 0.35);
  }
  const ta = now - a.atkAt;
  if (ta < 0.5) {
    // Water bolt from the orb hand.
    P.add('armL', track(ta, [[0, -1.5], [0.08, -1.5], [0.5, 0]]), 0, track(ta, [[0, 0.25], [0.5, 0]]));
    P.add('torso', 0, track(ta, [[0, 0.3], [0.5, 0]]));
    if (!a.impactDone) {
      a.impactDone = true;
      const p = at(o, j.armL, 0, -0.75, 0.08);
      c.fx.burst(p, 6, 0x9ff0ff, 3, 0.22, 0.35, 8);
    }
  }
  const tc = now - a.castAt;
  if (a.castSlot === 0 && tc < 0.7) {
    // Tidal Wave: sweep the trident forward and across.
    const arm = track(tc, [[0, -2.4], [0.12, -1.3], [0.7, 0]]);
    P.add('armR', arm, 0, track(tc, [[0, 0.4], [0.12, -0.3], [0.7, 0]]));
    P.add('weapon', -arm * 0.6); // keep the prongs pointing up and forward
    P.add('torso', track(tc, [[0, -0.15], [0.12, 0.35], [0.7, 0]]), track(tc, [[0, 0.35], [0.12, -0.3], [0.7, 0]]));
    if (!a.castDone) {
      a.castDone = true;
      const [x, y] = near(c, u, 1.8);
      c.fx.shockwave(x, y, 2.6, 0x5fe0f5, 0.4, 0.8);
      c.fx.burst(v3(x, groundAt(c, x, y) + 0.5, y), 16, 0xc8f6ff, 6, 0.3, 0.6, 12, false);
    }
  } else if (a.castSlot === 1 && tc < 0.7) {
    // Brine Veil: reach out with the orb.
    P.add('armL', track(tc, [[0, -1.4], [0.2, -1.5], [0.7, 0]]), 0, track(tc, [[0, -0.3], [0.7, 0]]));
    P.add('head', track(tc, [[0, 0.15], [0.7, 0]]));
  } else if (a.castSlot === 2 && tc < 1.1) {
    // Maelstrom: trident raised overhead, the orb hand stirring.
    const k = track(tc, [[0, 0.4], [0.15, 1], [0.7, 1], [1.1, 0]]);
    P.add('armR', -2.8 * k);
    P.add('weapon', 2.55 * k); // trident held upright above her head
    P.add('armL', -1.6 * k, 0, -0.4 * k + Math.sin(time * 9) * 0.25 * k);
    P.add('torso', -0.2 * k, Math.sin(time * 4) * 0.15 * k);
    P.add('head', -0.3 * k);
    if (!a.castDone) {
      a.castDone = true;
      const p = at(o, j.weapon, 0, 1.5, 0);
      c.fx.flashAt(p, 4, 0x5fe0f5, 0.45);
      c.fx.burst(p, 14, 0xc8f6ff, 5, 0.3, 0.7, 9, false);
    }
  }
  // Drips from the orb.
  if (now - a.moteAt > 0.3) {
    a.moteAt = now;
    const p = at(o, j.armL, (Math.random() - 0.5) * 0.15, -0.8, 0.08);
    c.fx.particle(p, 0x9ff0ff, 0.16, 0.6, { vel: v3(0, -0.5, 0), gravity: 6 });
  }
  stunned(P, u, time);
  P.apply(j);
};

/**
 * Morra: a watchful, loose-limbed walk with the staff swinging; flicks spirit wisps from the staff,
 * plants it and throws both arms up to call her wolves, and howls for Feral Bond. As the Red Wolf
 * she is animated like her wolves (see monster-anims.ts).
 */
const morra: Animator = (c, o, j, u, a, time) => {
  const now = c.clock;
  const { s, walk } = locomotion(c, u, a, 4.8, 0.85, (side) => footDust(c, u, side, 0x8a7558, 0.4));
  const P = new Pose();
  const ta = now - a.atkAt;
  const tc = now - a.castAt;
  P.add('torso', walk * 0.08 + Math.sin(time * 1.9 + u.id) * 0.03 * (1 - walk), s * 0.09 * walk);
  P.add('head', Math.sin(time * 1.1 + u.id) * 0.04, Math.sin(time * 0.55 + u.id) * 0.3 * (1 - walk));
  P.add('legL', s * 0.65 * walk);
  P.add('legR', -s * 0.65 * walk);
  P.add('armL', s * 0.5 * walk + Math.sin(time * 1.3 + u.id) * 0.04);
  P.add('armR', -s * 0.18 * walk);
  P.rigY = -Math.abs(s) * 0.06 * walk;
  if (ta < 0.55) {
    P.add('armR', track(ta, [[0, 0], [0.1, -1.3], [0.2, -0.3], [0.55, 0]]));
    P.add('weapon', track(ta, [[0, 0], [0.1, -0.4], [0.2, 0.9], [0.55, 0]]));
    P.add('torso', track(ta, [[0, 0], [0.1, -0.1], [0.2, 0.2], [0.55, 0]]), track(ta, [[0, 0], [0.1, 0.25], [0.2, -0.2], [0.55, 0]]));
  }
  if (tc < 1.05 && a.castSlot === 0) {
    // Calling: staff high, the other arm flung up, chest open to the sky.
    const up = track(tc, [[0, 0], [0.22, 1], [0.7, 1], [1.05, 0]]);
    P.add('armR', -2.1 * up, 0, -0.15 * up);
    P.add('armL', -2.6 * up, 0, -0.35 * up);
    P.add('torso', -0.26 * up);
    P.add('head', -0.45 * up);
    P.add('weapon', 0.5 * up);
    if (!a.castDone && tc > 0.22) {
      a.castDone = true;
      const tip = at(o, j.weapon, 0, 1.35, 0);
      c.fx.flashAt(tip, 3, 0xffa64a, 0.4);
      c.fx.burst(tip, 12, 0xffc247, 5, 0.3, 0.6, 2);
    }
  }
  if (tc < 0.8 && a.castSlot === 1) {
    // Feral Bond: a howl, head thrown back, arms low and wide.
    const up = track(tc, [[0, 0], [0.15, 1], [0.55, 1], [0.8, 0]]);
    P.add('head', -0.8 * up);
    P.add('torso', -0.18 * up);
    P.add('armL', 0.35 * up, 0, -0.6 * up);
    P.add('armR', 0.2 * up, 0, 0.5 * up);
  }
  stunned(P, u, time);
  P.apply(j);
};

/**
 * Seren: an upright, measured walk behind her shield; a downward mace blow; lifts the mace to shield
 * an ally, drives the shield forward to loose the lance, and raises the mace high for Sanctuary.
 */
const seren: Animator = (c, o, j, u, a, time) => {
  const now = c.clock;
  const { s, walk } = locomotion(c, u, a, 4.6, 0.8, (side) => {
    footDust(c, u, side, 0x8a7558, 0.4);
  });
  const P = new Pose();
  const ta = now - a.atkAt;
  const tc = now - a.castAt;
  P.add('torso', walk * 0.04 + Math.sin(time * 1.8 + u.id) * 0.018, s * 0.06 * walk);
  P.add('head', 0, Math.sin(time * 0.5 + u.id) * 0.2 * (1 - walk));
  P.add('legL', s * 0.6 * walk);
  P.add('legR', -s * 0.6 * walk);
  P.add('armL', s * 0.06 * walk);
  P.add('armR', -s * 0.3 * walk);
  P.rigY = -Math.abs(s) * 0.05 * walk;
  if (ta < 0.55) {
    P.add('armR', track(ta, [[0, 0], [0.12, -2.4], [0.24, -0.45], [0.55, 0]]));
    P.add('weapon', track(ta, [[0, 0], [0.12, -0.5], [0.24, -0.8], [0.55, 0]]));
    P.add('torso', track(ta, [[0, 0], [0.12, -0.12], [0.24, 0.26], [0.55, 0]]), track(ta, [[0, 0], [0.12, 0.3], [0.24, -0.25], [0.55, 0]]));
    if (!a.impactDone && ta >= 0.22) {
      a.impactDone = true;
      const [x, y] = near(c, u, 1.7);
      c.fx.sparks(x, y, 1.2, 6, 0xfff1c2, 3.5);
      c.fx.flash(x, y, 1.2, 1.7, 0xffe9a8, 0.14);
      if (u.id === c.meId) c.sound('ironClang', u.x, u.y, 0.4);
    }
  }
  if (a.castSlot === 0 && tc < 0.7) {
    const up = track(tc, [[0, 0], [0.16, 1], [0.45, 1], [0.7, 0]]);
    P.add('armR', -2.3 * up, 0, 0.18 * up);
    P.add('weapon', 0.4 * up);
    P.add('torso', -0.08 * up);
    P.add('head', -0.25 * up);
    if (!a.castDone && tc > 0.16) {
      a.castDone = true;
      const tip = at(o, j.weapon, 0, 1.05, 0);
      c.fx.flashAt(tip, 2.4, 0xfff1c2, 0.35);
      c.fx.burst(tip, 10, 0xffe9a8, 4, 0.25, 0.5, 1);
    }
  }
  if (a.castSlot === 1 && tc < 0.6) {
    const up = track(tc, [[0, 0.3], [0.08, 1], [0.3, 1], [0.6, 0]]);
    P.add('armL', -0.9 * up, 0, -0.1 * up);
    P.add('torso', 0.18 * up, -0.3 * up);
    P.add('armR', 0.25 * up);
    if (!a.castDone) {
      a.castDone = true;
      const [x, y] = near(c, u, 1.2);
      c.fx.flash(x, y, 1.6, 3.8, 0xfff1c2, 0.3);
      c.fx.shockwave(x, y, 2.2, 0xffe9a8, 0.3, 0.7);
    }
  }
  if (a.castSlot === 2 && tc < 1.05) {
    const up = track(tc, [[0, 0], [0.22, 1], [0.75, 1], [1.05, 0]]);
    P.add('armR', -2.8 * up);
    P.add('armL', -0.6 * up);
    P.add('weapon', 0.25 * up);
    P.add('torso', -0.2 * up);
    P.add('head', -0.45 * up);
    if (!a.castDone && tc > 0.22) {
      a.castDone = true;
      const tip = at(o, j.weapon, 0, 1.05, 0);
      c.fx.flashAt(tip, 4, 0xffe9a8, 0.5);
      for (let i = 0; i < 10; i++) c.fx.particle(tip, 0xfff1c2, 0.3, 0.7, { vel: v3((Math.random() - 0.5) * 2, 9 + Math.random() * 7, (Math.random() - 0.5) * 2) });
    }
  }
  stunned(P, u, time);
  P.apply(j);
};

/**
 * Rhen: a quick, light run with the coat tails flying and the crossbow at the hip; shoulders it
 * to fire, jolts with each shot, dives into Gale Step, and in Bolt Storm keeps the bow up and firing.
 */
const rhen: Animator = (c, o, j, u, a, time) => {
  const now = c.clock;
  const { s, walk } = locomotion(c, u, a, 5.8, 1, (side) => {
    footDust(c, u, side, 0x8a7558, 0.4);
  });
  const P = new Pose();
  const ta = now - a.atkAt;
  const tc = now - a.castAt;
  const storm = u.buffs.some((b) => b.key === 'boltStorm');
  const shooting = ta < 1.1 || storm || (a.castSlot === 1 && tc < 0.6);
  a.aim += ((shooting ? 1 : 0) - a.aim) * Math.min(1, c.dt * (shooting ? 14 : 4));
  const k = a.aim;
  const free = 1 - k;
  P.add('torso', walk * 0.15 * free + Math.sin(time * 2.1 + u.id) * 0.02 * (1 - walk), s * 0.1 * walk * free);
  P.add('head', 0, Math.sin(time * 0.6 + u.id) * 0.22 * (1 - walk) * free);
  P.add('legL', s * 0.8 * walk);
  P.add('legR', -s * 0.8 * walk);
  P.add('armL', s * 0.1 * walk * free);
  P.add('armR', -s * 0.08 * walk * free);
  P.rigY = -Math.abs(s) * 0.07 * walk;
  // Shouldered: both arms up to the bow, head down on the sights.
  P.add('armR', -0.8 * k, 0.2 * k, -0.15 * k);
  P.add('armL', -0.5 * k, 0, 0.3 * k);
  P.add('torso', -0.05 * k, 0.28 * k);
  P.add('head', 0.08 * k, -0.28 * k);
  if (ta < 0.3) {
    // Recoil.
    const kick = track(ta, [[0, 0.5], [0.05, 1], [0.3, 0]]);
    P.add('armR', 0.28 * kick * k);
    P.add('armL', 0.2 * kick * k);
    P.add('torso', -0.09 * kick);
    if (!a.impactDone) {
      a.impactDone = true;
      const tip = at(o, j.weapon, 0, 0.08, 0.72);
      c.fx.flashAt(tip, 1.1, 0xe8efc0, 0.1);
    }
  }
  if (u.dash) {
    // Gale Step: a low dive with the coat flat behind.
    P.add('torso', 0.7);
    P.add('legL', -0.9);
    P.add('legR', 0.8);
    P.add('armL', 0.5);
    P.add('armR', 0.6);
    P.rigY -= 0.3;
    if (now - a.trailAt > 0.03) {
      a.trailAt = now;
      c.fx.particle(v3(u.x, groundAt(c, u.x, u.y) + 1.2, u.y), 0xe8efc0, 1.3, 0.35, { grow: 1.1, opacity: 0.4 });
    }
  }
  if (a.castSlot === 1 && tc < 0.4 && !a.castDone) {
    a.castDone = true;
    const tip = at(o, j.weapon, 0, 0.08, 0.72);
    c.fx.flashAt(tip, 2, 0xff8a6a, 0.3);
  }
  stunned(P, u, time);
  P.apply(j);
  aimWeapon(o, j, k);
};

const ANIMATORS: Record<HeroId, Animator> = { brakk, vexa, orin, syl, grom, kaela, morra, seren, rhen };

/** Animate one hero model for this frame. */
export function animateHero(c: AnimCtx, o: THREE.Object3D, j: Joints, u: Unit, a: Anim, time: number) {
  ANIMATORS[u.hero!.defId](c, o, j, u, a, time);
}

/** Where an attack lands: the target if it's still there, else a point in front. */
function targetPoint(c: AnimCtx, u: Unit, a: Anim, dist: number): [number, number] {
  const t = c.world?.unit(a.atkTarget);
  if (t && t.alive) return [t.x, t.y];
  return near(c, u, dist);
}

// ======================================================================== spell events

/** A hero attacked (the sim already launched the projectile or dealt the hit). */
export function heroAttack(_c: AnimCtx, u: Unit, a: Anim) {
  a.side = -a.side;
  if (u.hero?.defId === 'vexa' && u.hero.lastCrit) a.critAt = _c.clock;
}

/**
 * A hero cast a spell (slot 0-2) or a delayed blast of theirs landed (slot -1). Effects that
 * belong to the moment of casting; the spells' own objects (projectiles, areas) are handled
 * by SpellFx.
 */
export function heroCast(c: AnimCtx, u: Unit, slot: number, a: Anim) {
  const id = u.hero!.defId;
  if (slot >= 0) a.castDone = false;
  if (id === 'brakk') {
    if (slot === 0) {
      c.fx.dust(u.x, u.y, 8, 1.4, 0x9a8466, 1);
      a.trailAt = 0;
    } else if (slot === 2) {
      c.fx.dust(u.x, u.y, 6, 1.3, 0x9a8466, 0.8);
    } else if (slot === -1) {
      // Earthsplitter lands: shockwaves, flying rocks, a dust ring and a shaking camera.
      a.blastAt = c.clock;
      c.fx.flash(u.x, u.y, 0.6, 9, 0xffb050, 0.45);
      c.fx.shockwave(u.x, u.y, 7.5, 0xffb060, 0.5, 0.95);
      c.fx.shockwave(u.x, u.y, 9, 0x9a8466, 0.9, 0.6);
      c.fx.debris(u.x, u.y, 18, 3.5, 8);
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2;
        const r = 3 + Math.random() * 3.5;
        c.fx.dust(u.x + Math.cos(ang) * r, u.y + Math.sin(ang) * r, 2, 2, 0x8a7558, 0.6, 1.3);
      }
      c.fx.sparks(u.x, u.y, 0.5, 16, 0xffb347, 7);
      shake(c, u.x, u.y, 0.75, u.id === c.meId ? 0.25 : 0);
    }
  } else if (id === 'orin' && slot === -1) {
    a.blastAt = c.clock;
  } else if (id === 'syl' && slot === 1) {
    // Veil: a puff of shadow.
    c.fx.dust(u.x, u.y, 10, 1.6, 0x2a1f3d, 1, 1.1);
    c.fx.sparks(u.x, u.y, 1.2, 10, 0xb69bff, 4);
    c.fx.flash(u.x, u.y, 1.4, 4, 0x6a4bd0, 0.3);
  } else if (id === 'grom' && slot === 2) {
    c.fx.shockwave(u.x, u.y, 4, 0x9dff5a, 0.4, 0.7);
  } else if (id === 'morra' && slot === 1) {
    c.fx.shockwave(u.x, u.y, 14, 0xffa64a, 0.55, 0.6);
    c.fx.sparks(u.x, u.y, 1.6, 10, 0xffc247, 4);
  } else if (id === 'rhen' && slot === 0) {
    c.fx.dust(u.x, u.y, 8, 1.4, 0xb8b48c, 1, 0.7);
    c.fx.shockwave(u.x, u.y, 3, 0xe8efc0, 0.3, 0.6);
    a.trailAt = 0;
  } else if (id === 'rhen' && slot === 2) {
    c.fx.shockwave(u.x, u.y, 11, 0xe8efc0, 0.5, 0.45);
  }
}

/** Shadow Lunge: smoke where Syl left, a streak of shadow, a flash where she lands. */
export function heroBlink(c: AnimCtx, u: Unit, fromX: number, fromY: number) {
  if (u.hero?.defId !== 'syl') return;
  c.fx.dust(fromX, fromY, 7, 1.4, 0x2a1f3d, 0.8, 0.9);
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const px = fromX + (u.x - fromX) * k;
    const py = fromY + (u.y - fromY) * k;
    c.fx.particle(v3(px, groundAt(c, px, py) + 1.5, py), 0x8b6cff, 0.9, 0.35 + k * 0.2, { grow: 0.5, opacity: 0.6 });
  }
  c.fx.flash(u.x, u.y, 1.6, 4, 0xb69bff, 0.3);
  c.fx.slash(u.x, u.y, 1.6, u.facing, 0xd8c8ff, 2.2, 0.9, 0.2);
  c.fx.slash(u.x, u.y, 1.6, u.facing, 0xd8c8ff, 2.2, -0.9, 0.2);
}

/** Execution: a crossing blood-violet cut on the target. */
export function executionFx(c: AnimCtx, x: number, y: number, u: Unit | undefined) {
  const ang = u ? u.facing : 0;
  const ox = u ? u.x : x;
  const oy = u ? u.y : y;
  c.fx.slash(ox, oy, 1.7, ang, 0xff4d6d, 2.8, 1.0, 0.3);
  c.fx.slash(ox, oy, 1.7, ang, 0xc4a6ff, 2.8, -1.0, 0.3);
  c.fx.flash(x, y, 1.4, 5, 0xff4d6d, 0.35);
  c.fx.sparks(x, y, 1.4, 14, 0xff8fa3, 6);
  c.fx.shockwave(x, y, 2.5, 0xff4d6d, 0.3);
  shake(c, x, y, 0.3, 0);
}

/** Shake the camera, less the farther the event is from it. */
export function shake(c: AnimCtx, x: number, y: number, power: number, extra: number) {
  const d = Math.hypot(x - c.camX, y - c.camY);
  c.fx.shake = Math.max(c.fx.shake, d < 30 ? power * (1 - d / 30) + extra : 0);
}

let groundFn: ((x: number, y: number) => number) | null = null;
/** The renderer passes its ground height lookup once. */
export function setGround(fn: (x: number, y: number) => number) {
  groundFn = fn;
}
export function groundAt(_c: AnimCtx, x: number, y: number) {
  return groundFn ? groundFn(x, y) : 0;
}

// ======================================================================== buffs

/** Buff effects on any visible hero (heals and shields from allies too). */
export function buffFx(c: AnimCtx, o: THREE.Object3D, u: Unit, a: Anim) {
  const now = c.clock;
  if (now - a.buffAt < 0.12) return;
  let any = false;
  const base = o.getWorldPosition(v3());
  const around = (r: number, h: number) => base.clone().add(v3((Math.random() - 0.5) * r, h, (Math.random() - 0.5) * r));
  for (const b of u.buffs) {
    if (b.key === 'mendingFlame') {
      c.fx.particle(around(1.4, 0.4 + Math.random() * 1.5), Math.random() < 0.5 ? 0xffd27a : 0xffa040, 0.3, 0.8, { vel: v3(0, 2.2, 0) });
      any = true;
    } else if (b.key === 'brineVeil') {
      c.fx.particle(around(1.6, 0.3 + Math.random() * 2), 0xc8f6ff, 0.22, 0.9, { vel: v3(0, 1.6, 0), opacity: 0.8 });
      any = true;
    } else if (b.key === 'barkSkin') {
      c.fx.particle(around(1.8, 0.5 + Math.random() * 2.5), 0x9dff5a, 0.2, 0.9, { vel: v3(0, 1.2, 0), opacity: 0.8 });
      any = true;
    } else if (b.key === 'huntersRhythm' && Math.hypot(u.x - u.px, u.y - u.py) > 0.01) {
      c.fx.particle(around(0.8, 0.3), 0x9fffc8, 0.5, 0.35, { grow: 1, opacity: 0.5 });
      any = true;
    } else if (b.key === 'slow:frostHorn') {
      c.fx.particle(around(1.2, 0.3 + Math.random() * 1.5), 0xe0f2fe, 0.25, 0.7, { vel: v3(0, -0.6, 0), opacity: 0.8 });
      any = true;
    } else if (b.key === 'stoneskin') {
      c.fx.particle(around(1.4, 0.5 + Math.random() * 2), 0xd6d3d1, 0.3, 0.4, { opacity: 0.9 });
      any = true;
    } else if (b.key === 'veil') {
      c.fx.particle(around(1.0, 0.3), 0x2a1f3d, 0.8, 0.6, { grow: 1, opacity: 0.35, additive: false, vel: v3(0, 0.6, 0) });
      any = true;
    }
  }
  if (any) a.buffAt = now;
}

// ======================================================================== deaths

export interface Corpse {
  o: THREE.Object3D;
  t: number;
  joints: Joints;
  kind?: HeroId;
  /** Creeps, jungle monsters and the Warden. */
  mkind?: MonsterKind;
  x?: number;
  y?: number;
  thud?: boolean;
}

/** Hero death animations; return false when the corpse is gone. */
export function heroCorpse(c: AnimCtx, k: Corpse): boolean {
  const t = k.t;
  const j = k.joints;
  const P = new Pose();
  const x = k.x ?? 0;
  const y = k.y ?? 0;
  let sinkAt = 2.2;
  let end = 3;
  k.o.rotation.order = 'YXZ';
  switch (k.kind) {
    case 'brakk':
      // Falls to his knees, the hammer drops, then he topples forward with a thud of dust.
      P.add('torso', track(t, [[0, 0], [0.35, 0.45], [0.9, 0.3]]));
      P.add('head', track(t, [[0, 0], [0.35, 0.45]]));
      P.add('armR', track(t, [[0, 0], [0.35, 0.5]]), 0, 0.3);
      P.add('weapon', track(t, [[0, 0], [0.4, 1.4]]));
      P.add('armL', track(t, [[0, 0], [0.35, 0.3]]));
      P.add('legL', track(t, [[0, 0], [0.3, -1.1]]));
      P.add('legR', track(t, [[0, 0], [0.3, -1.0]]));
      P.rigY = track(t, [[0, 0], [0.3, -0.55]]);
      k.o.rotation.x = track(t, [[0, 0], [0.45, 0], [0.85, 1.3]]);
      if (!k.thud && t > 0.85) {
        k.thud = true;
        c.fx.dust(x, y, 7, 1.5, 0x8a7558, 1.2, 1);
        c.sound('armorFall', x, y, 1);
      }
      break;
    case 'grom':
      // Creaks and topples like a felled tree; leaves burst when he hits the ground.
      P.add('armL', track(t, [[0, 0], [0.4, -0.8]]), 0, -0.4);
      P.add('armR', track(t, [[0, 0], [0.4, -0.6]]), 0, 0.5);
      P.add('head', track(t, [[0, 0], [0.5, -0.4]]));
      k.o.rotation.x = track(t, [[0, 0], [0.3, -0.08], [1.25, 1.45]]);
      if (!k.thud && t > 1.25) {
        k.thud = true;
        c.fx.dust(x, y, 9, 1.8, 0x7a6448, 1.6, 1.1);
        c.fx.burst(v3(x, groundAt(c, x, y) + 1, y), 18, 0x5f8f24, 5, 0.3, 1.2, 6, false);
        c.sound('treeFall', x, y, 1);
        shake(c, x, y, 0.35, 0);
      }
      sinkAt = 2.6;
      end = 3.4;
      break;
    case 'seren':
      // Sinks to her knees with the mace falling away, then forward onto the shield.
      P.add('legL', track(t, [[0, 0], [0.35, -1.05]]));
      P.add('legR', track(t, [[0, 0], [0.35, -1.0]]));
      P.add('torso', track(t, [[0, 0], [0.35, 0.4]]));
      P.add('head', track(t, [[0, 0], [0.45, 0.5]]));
      P.add('armR', track(t, [[0, 0], [0.4, 0.5]]), 0, 0.3);
      P.add('weapon', track(t, [[0, 0], [0.45, 1.4]]));
      P.rigY = track(t, [[0, 0], [0.35, -0.55]]);
      k.o.rotation.x = track(t, [[0.5, 0], [0.95, 1.3]]);
      if (!k.thud && t > 0.95) {
        k.thud = true;
        c.fx.dust(x, y, 6, 1.3, 0x8a7558, 1, 0.9);
        c.fx.sparks(x, y, 1, 10, 0xffe9a8, 3);
        c.sound('armorFall', x, y, 0.8);
      }
      break;
    case 'orin':
    case 'kaela': {
      // The robe crumples: slump forward and sink, the staff / trident falls.
      const water = k.kind === 'kaela';
      P.add('torso', track(t, [[0, 0], [0.5, 0.7]]));
      P.add('head', track(t, [[0, 0], [0.5, 0.5]]));
      P.add('armL', track(t, [[0, 0], [0.5, 0.4]]), 0, -0.3);
      P.add('armR', track(t, [[0, 0], [0.5, 0.4]]), 0, 0.3);
      P.add('weapon', track(t, [[0, 0], [0.6, water ? -1.3 : 1.3]]));
      P.rigY = track(t, [[0, 0], [0.7, -0.75]]);
      k.o.rotation.x = track(t, [[0.4, 0], [1.0, 0.5]]);
      if (!k.thud && t > 0.7) {
        k.thud = true;
        if (water) {
          c.fx.shockwave(x, y, 3, 0x5fe0f5, 0.5);
          c.fx.burst(v3(x, groundAt(c, x, y) + 0.5, y), 16, 0xc8f6ff, 5, 0.3, 0.6, 12, false);
        } else {
          c.fx.dust(x, y, 6, 1.3, 0x5a4a40, 0.8, 1);
          c.fx.burst(v3(x, groundAt(c, x, y) + 1, y), 10, 0xff7a2a, 3, 0.25, 0.8, -1);
        }
        c.sound('bodyFall', x, y, 0.8);
      }
      break;
    }
    default: {
      // Vexa / Syl: knees buckle, then a fall to the side.
      P.add('legL', track(t, [[0, 0], [0.3, -0.9]]));
      P.add('legR', track(t, [[0, 0], [0.3, -0.7]]));
      P.add('torso', track(t, [[0, 0], [0.3, 0.4]]));
      P.add('head', track(t, [[0, 0], [0.4, 0.5]]));
      P.add('armL', track(t, [[0, 0], [0.5, -0.6]]), 0, -0.5);
      P.add('armR', track(t, [[0, 0], [0.5, -0.4]]), 0, 0.6);
      P.rigY = track(t, [[0, 0], [0.3, -0.45]]);
      k.o.rotation.z = track(t, [[0.25, 0], [0.75, 1.35]]);
      if (!k.thud && t > 0.75) {
        k.thud = true;
        c.fx.dust(x, y, 4, 1.1, k.kind === 'syl' ? 0x2a1f3d : 0x8a7558, 0.8, 0.9);
        c.sound('bodyFall', x, y, 0.7);
      }
    }
  }
  P.apply(j);
  if (t > sinkAt) k.o.position.y -= c.dt * 1.4;
  return t <= end;
}
