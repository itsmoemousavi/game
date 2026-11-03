import * as THREE from 'three';
import type { Unit } from '../../sim';
import { Anim, AnimCtx, Joints, Pose, at, footDust, locomotion, near, shake, stunned, track, v3 } from './hero-anims';

/**
 * Animation for everything that isn't a hero: lane creeps (soldiers and casters), the jungle
 * goblins and brutes, and the Warden. Same approach as the heroes: small joint rotations from a
 * few keyframes, on top of the model's rest stance, with dust, sparks and shockwaves from Fx3D.
 */
export type MonsterKind = 'creepMelee' | 'creepRanged' | 'imp' | 'brute' | 'warden';

/** Which animation a model key uses (null for things that don't move). */
export function monsterKind(key: string): MonsterKind | null {
  if (key.startsWith('creep:melee')) return 'creepMelee';
  if (key.startsWith('creep:ranged')) return 'creepRanged';
  if (key === 'imp' || key === 'brute' || key === 'warden') return key;
  return null;
}

/** Lane creeps are many: only show their small hit effects near the camera. */
const closeToCamera = (c: AnimCtx, u: Unit) => Math.hypot(u.x - c.camX, u.y - c.camY) < 28;

export function animateMonster(c: AnimCtx, kind: MonsterKind, o: THREE.Object3D, j: Joints, u: Unit, a: Anim, time: number) {
  const now = c.clock;
  const ta = now - a.atkAt;
  const P = new Pose();
  switch (kind) {
    case 'creepMelee': {
      // A soldier's march; a quick overhead sword cut (hit at 0.14 s).
      const { s, walk } = locomotion(c, u, a, 5.5, 0.9);
      P.add('torso', walk * 0.08 + Math.sin(time * 2 + u.id) * 0.02 * (1 - walk), s * 0.1 * walk);
      P.add('legL', s * 0.65 * walk);
      P.add('legR', -s * 0.65 * walk);
      P.add('armL', s * 0.15 * walk);
      P.add('armR', -s * 0.35 * walk);
      P.rigY = -Math.abs(s) * 0.06 * walk;
      if (ta < 0.45) {
        P.add('armR', track(ta, [[0, 0], [0.08, -2.2], [0.16, -0.5], [0.45, 0]]));
        P.add('weapon', track(ta, [[0, 0], [0.08, -0.4], [0.16, -0.9], [0.45, 0]]));
        P.add('torso', track(ta, [[0, 0], [0.08, -0.1], [0.16, 0.25], [0.45, 0]]), track(ta, [[0, 0], [0.08, 0.3], [0.16, -0.2], [0.45, 0]]));
        P.add('armL', track(ta, [[0, 0], [0.16, -0.3], [0.45, 0]]));
        if (!a.impactDone && ta >= 0.14) {
          a.impactDone = true;
          if (closeToCamera(c, u)) {
            const [x, y] = near(c, u, 1.4);
            c.fx.sparks(x, y, 1.0, 3, 0xffe2a0, 2.5);
          }
        }
      }
      break;
    }
    case 'creepRanged': {
      // A caster gliding in its robe; points the staff and looses a bolt.
      const { s, walk } = locomotion(c, u, a, 4, 0.6);
      P.add('torso', walk * 0.08 + Math.sin(time * 1.8 + u.id) * 0.03, 0, s * 0.04 * walk);
      P.rigY = Math.sin(a.phase * 2) * 0.03 * walk;
      P.add('armL', s * 0.2 * walk);
      if (ta < 0.5) {
        P.add('armR', track(ta, [[0, -1.3], [0.08, -1.4], [0.5, 0]]));
        P.add('weapon', track(ta, [[0, 1.0], [0.5, 0]]));
        if (!a.impactDone) {
          a.impactDone = true;
          if (closeToCamera(c, u)) c.fx.flashAt(at(o, j.weapon, 0, 1.1, 0), 1.4, u.team === 1 ? 0xffa3a3 : 0x9ccbff, 0.18);
        }
      }
      break;
    }
    case 'imp': {
      // Wiry and twitchy: a crouched skitter, a fast spear jab.
      const { s, walk } = locomotion(c, u, a, 7, 1.1);
      const idle = 1 - walk;
      P.add('torso', 0.2 + walk * 0.15 + Math.sin(time * 5 + u.id) * 0.04 * idle, s * 0.15 * walk);
      P.add('head', Math.sin(time * 3.1 + u.id) * 0.15 * idle, Math.sin(time * 1.7 + u.id) * 0.4 * idle);
      P.add('legL', -0.3 + s * 0.8 * walk);
      P.add('legR', -0.3 - s * 0.8 * walk);
      P.add('armL', -0.3 + s * 0.4 * walk);
      P.rigY = -0.08 - Math.abs(s) * 0.08 * walk + Math.abs(Math.sin(time * 5 + u.id)) * 0.03 * idle;
      if (ta < 0.4) {
        P.add('armR', track(ta, [[0, 0], [0.07, 0.5], [0.13, -1.2], [0.4, 0]]));
        P.add('weapon', track(ta, [[0, 0], [0.13, -0.5], [0.4, 0]]));
        P.add('torso', track(ta, [[0, 0], [0.07, -0.15], [0.13, 0.35], [0.4, 0]]));
        if (!a.impactDone && ta >= 0.12) {
          a.impactDone = true;
          const [x, y] = near(c, u, 1.8);
          c.fx.sparks(x, y, 0.9, 3, 0xd9f99d, 2.5);
        }
      }
      break;
    }
    case 'brute': {
      // Heavy, hunched, swaying; a two-handed overhead club smash (hit at 0.3 s) that kicks up dust.
      const { s, walk } = locomotion(c, u, a, 3.4, 0.6, (side) => footDust(c, u, side, 0x7a6448, 0.7));
      const idle = 1 - walk;
      P.add('torso', Math.sin(time * 1.4 + u.id) * 0.04 * idle + walk * 0.08, s * 0.15 * walk, s * 0.05 * walk);
      P.add('head', 0, Math.sin(time * 0.6 + u.id) * 0.25 * idle);
      P.add('legL', s * 0.5 * walk);
      P.add('legR', -s * 0.5 * walk);
      P.add('armL', -s * 0.25 * walk);
      P.add('armR', s * 0.25 * walk);
      P.rigY = -Math.abs(s) * 0.1 * walk;
      P.rigZ = s * 0.05 * walk;
      if (ta < 0.8) {
        P.add('armR', track(ta, [[0, 0], [0.2, -2.8], [0.3, -0.6], [0.5, -0.6], [0.8, 0]]));
        P.add('armL', track(ta, [[0, 0], [0.2, -2.2], [0.3, -0.5], [0.5, -0.5], [0.8, 0]]));
        P.add('weapon', track(ta, [[0, 0], [0.2, -0.3], [0.3, -1.0], [0.5, -1.0], [0.8, 0]]));
        P.add('torso', track(ta, [[0, 0], [0.2, -0.3], [0.3, 0.45], [0.5, 0.45], [0.8, 0]]));
        P.rigY += track(ta, [[0, 0], [0.3, -0.12], [0.5, -0.12], [0.8, 0]]);
        if (!a.impactDone && ta >= 0.3) {
          a.impactDone = true;
          const [x, y] = near(c, u, 2.4);
          c.fx.dust(x, y, 4, 1.1, 0x7a6448, 0.6, 0.7);
          c.fx.shockwave(x, y, 2, 0xc8b89a, 0.3, 0.6);
          c.sound('woodPunch', x, y, 0.35);
        }
      }
      break;
    }
    case 'warden': {
      // A slow, ground-shaking stride; alternating stone-fist punches; the ground slam: arms up
      // during the wind-up, then both fists down as the shockwave goes out.
      const { s, walk } = locomotion(c, u, a, 2.8, 0.5, (side) => {
        footDust(c, u, side, 0x6a6080, 1.1);
        shake(c, u.x, u.y, 0.12, 0);
      });
      const idle = 1 - walk;
      P.add('torso', Math.sin(time * 1.1 + u.id) * 0.05 * idle + walk * 0.08, s * 0.12 * walk);
      P.add('head', Math.sin(time * 0.7) * 0.05 * idle, Math.sin(time * 0.4 + u.id) * 0.3 * idle);
      P.add('legL', s * 0.4 * walk);
      P.add('legR', -s * 0.4 * walk);
      P.add('armL', -s * 0.2 * walk + Math.sin(time * 1.1) * 0.05 * idle);
      P.add('armR', s * 0.2 * walk - Math.sin(time * 1.1) * 0.05 * idle);
      P.rigY = -Math.abs(s) * 0.1 * walk;
      P.rigZ = s * 0.06 * walk;
      if (ta < 0.8 && a.castAt < a.atkAt) {
        const arm = a.side > 0 ? 'armR' : 'armL';
        const sg = a.side;
        P.add(arm, track(ta, [[0, 0], [0.18, -2.3], [0.3, -1.2], [0.45, -1.2], [0.8, 0]]), 0, sg * track(ta, [[0, 0], [0.18, 0.3], [0.3, -0.2], [0.8, 0]]));
        P.add('torso', track(ta, [[0, 0], [0.18, -0.15], [0.3, 0.35], [0.45, 0.35], [0.8, 0]]), sg * track(ta, [[0, 0], [0.18, 0.4], [0.3, -0.25], [0.8, 0]]));
        if (!a.impactDone && ta >= 0.3) {
          a.impactDone = true;
          const [x, y] = near(c, u, 3);
          c.fx.dust(x, y, 4, 1.3, 0x6a6080, 0.6, 0.7);
          c.fx.sparks(x, y, 1.8, 6, 0xd8b4fe, 3);
        }
      }
      // Slam: wind-up starts at castAt, the fists land at blastAt (from the simulation's events).
      const tw = now - a.castAt;
      const landed = a.blastAt > a.castAt;
      const te = landed ? 0.8 + (now - a.blastAt) : Math.min(tw, 0.8);
      if (a.castSlot === 9 && te < 1.6) {
        const up = track(te, [[0, 0], [0.6, 1], [0.8, 1], [0.88, -0.2], [1.25, -0.2], [1.6, 0]]);
        // Arms raised overhead while `up` > 0, then slammed forward and down (up < 0).
        const armX = up >= 0 ? -2.9 * up : 4 * up;
        P.add('armL', armX, 0, -0.3 * Math.max(0, up));
        P.add('armR', armX, 0, 0.3 * Math.max(0, up));
        P.add('torso', track(te, [[0, 0], [0.6, -0.35], [0.8, -0.4], [0.88, 0.6], [1.25, 0.6], [1.6, 0]]));
        P.add('head', track(te, [[0, 0], [0.6, -0.5], [0.88, 0.3], [1.6, 0]]));
        P.rigY += track(te, [[0, 0], [0.6, 0.25], [0.8, 0.3], [0.88, -0.3], [1.25, -0.3], [1.6, 0]]);
        // Crystals flare while it gathers strength.
        if (!landed && tw < 0.8 && now - a.moteAt > 0.06) {
          a.moteAt = now;
          const p = at(o, j.torso, (Math.random() - 0.5) * 1.4, 1.1, -0.2);
          c.fx.particle(p, 0xd8b4fe, 0.5, 0.5, { vel: v3(0, 2.5, 0) });
        }
      }
      break;
    }
  }
  stunned(P, u, time);
  P.apply(j);
}

/** The Warden's slam lands: violet shockwaves, flying rock, dust and a shaking camera. */
export function wardenSlamFx(c: AnimCtx, x: number, y: number, radius: number) {
  c.fx.flash(x, y, 0.8, radius * 2, 0xc4b5fd, 0.45);
  c.fx.shockwave(x, y, radius * 1.15, 0xc4b5fd, 0.45, 0.95);
  c.fx.shockwave(x, y, radius * 1.5, 0x6a6080, 0.8, 0.6);
  c.fx.debris(x, y, 14, radius * 0.5, 8);
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    c.fx.dust(x + Math.cos(ang) * radius * 0.8, y + Math.sin(ang) * radius * 0.8, 2, 1.8, 0x6a6080, 0.6, 1.1);
  }
  c.fx.sparks(x, y, 0.5, 14, 0xd8b4fe, 7);
  shake(c, x, y, 0.65, 0);
}

export interface MonsterCorpse {
  o: THREE.Object3D;
  t: number;
  joints: Joints;
  mkind: MonsterKind;
  x?: number;
  y?: number;
  thud?: boolean;
}

/** Deaths for creeps, jungle monsters and the Warden; return false when gone. */
export function monsterCorpse(c: AnimCtx, k: MonsterCorpse): boolean {
  const t = k.t;
  const P = new Pose();
  const x = k.x ?? 0;
  const y = k.y ?? 0;
  k.o.rotation.order = 'YXZ';
  let end = 2;
  switch (k.mkind) {
    case 'creepMelee':
    case 'creepRanged':
    case 'imp':
      // Crumple: knees buckle, then a fall backward.
      P.add('legL', track(t, [[0, 0], [0.2, -0.8]]));
      P.add('legR', track(t, [[0, 0], [0.2, -0.6]]));
      P.add('armL', track(t, [[0, 0], [0.3, -1.2]]), 0, -0.4);
      P.add('armR', track(t, [[0, 0], [0.3, -1.2]]), 0, 0.4);
      P.add('weapon', track(t, [[0, 0], [0.3, 1.2]]));
      P.rigY = track(t, [[0, 0], [0.2, -0.3]]);
      k.o.rotation.x = track(t, [[0.1, 0], [0.45, -1.35]]);
      if (t > 1.1) k.o.position.y -= c.dt * 1.6;
      break;
    case 'brute':
      // Staggers, drops to a knee, then crashes forward.
      P.add('torso', track(t, [[0, 0], [0.3, 0.5]]));
      P.add('legL', track(t, [[0, 0], [0.3, -1.0]]));
      P.add('armR', track(t, [[0, 0], [0.4, 0.6]]));
      P.add('weapon', track(t, [[0, 0], [0.4, 1.4]]));
      P.rigY = track(t, [[0, 0], [0.3, -0.4]]);
      k.o.rotation.x = track(t, [[0.35, 0], [0.75, 1.35]]);
      if (!k.thud && t > 0.75) {
        k.thud = true;
        c.fx.dust(x, y, 6, 1.4, 0x7a6448, 1.1, 0.9);
        c.sound('bodyFall', x, y, 0.8);
      }
      if (t > 1.8) k.o.position.y -= c.dt * 1.4;
      end = 2.6;
      break;
    case 'warden': {
      // Crystals go dark, it sags to its knees and crumbles into a pile of rock.
      P.add('torso', track(t, [[0, 0], [0.6, 0.55]]));
      P.add('head', track(t, [[0, 0], [0.6, 0.6]]));
      P.add('armL', track(t, [[0, 0], [0.6, 0.4]]), 0, -0.6);
      P.add('armR', track(t, [[0, 0], [0.6, 0.4]]), 0, 0.6);
      P.add('legL', track(t, [[0, 0], [0.5, -1.1]]));
      P.add('legR', track(t, [[0, 0], [0.5, -1.0]]));
      P.rigY = track(t, [[0, 0], [0.5, -0.8], [1.4, -1.2]]);
      if (!k.thud && t > 0.6) {
        k.thud = true;
        c.fx.debris(x, y, 22, 2.5, 6);
        c.fx.dust(x, y, 12, 2.2, 0x6a6080, 2, 1.4);
        c.fx.sparks(x, y, 2, 24, 0xd8b4fe, 6);
        c.fx.shockwave(x, y, 6, 0xc4b5fd, 0.6, 0.8);
        c.sound('stoneCrumble', x, y, 1);
        shake(c, x, y, 0.5, 0);
      }
      if (t > 1.2) k.o.position.y -= c.dt * 2.2;
      end = 2.8;
      break;
    }
  }
  P.apply(k.joints);
  return t <= end;
}
