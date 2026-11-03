import * as THREE from 'three';
import type { HeroId } from '../../sim';

/**
 * Low-poly 3D models built from simple shapes (placeholder art). Each hero builder makes
 * the same model as the 3D concept viewer. Models face +z; the renderer bakes each one
 * into a couple of merged meshes so a whole unit costs 1-3 draw calls.
 */

/** Scene extras from the concept builders (aura rings etc.) land here and are not used in game. */
let fx = new THREE.Group();
function point(_p: THREE.Object3D, _c: THREE.ColorRepresentation, _k: number, _x: number, _y: number, _z: number, _d = 6) {
  return null;
}

// ------------------------------------------------------------ helpers
const M = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, ...o });
const glow = (color: THREE.ColorRepresentation, k = 2.5, opacity = 1) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, transparent: opacity < 1, opacity, flatShading: true });
function add<T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T {
  o.position.set(x, y, z);
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  parent.add(o);
  return o;
}
const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => new THREE.Mesh(g, m);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, s = 7) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cone = (r: number, h: number, s = 7) => new THREE.ConeGeometry(r, h, s);
const grp = () => new THREE.Group();
function rot(o: THREE.Object3D, x = 0, y = 0, z = 0) {
  o.rotation.set(x, y, z);
  return o;
}

interface Body {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
}
interface BodyOpts {
  skin: number;
  cloth: number;
  cloth2: number;
  boots: number;
  bulk?: number;
  hip?: number;
  torsoH?: number;
  eyes?: number;
  slim?: number;
}
function humanoid(o: BodyOpts): Body {
  const b = o.bulk ?? 1;
  const hip = o.hip ?? 0.95;
  const th = o.torsoH ?? 0.72;
  const slim = o.slim ?? 1;
  const root = grp();
  const legs = [-1, 1].map((s) => {
    const g = add(root, grp(), s * 0.16 * b, hip, 0);
    add(g, mesh(cyl(0.11 * b * slim, 0.09 * b * slim, hip - 0.12), M(o.cloth2)), 0, -(hip - 0.12) / 2, 0);
    add(g, mesh(box(0.2 * b, 0.16, 0.32 * b), M(o.boots)), 0, -hip + 0.08, 0.05);
    return g;
  });
  const torso = add(root, grp(), 0, hip, 0);
  add(torso, mesh(cyl(0.33 * b * slim, 0.24 * b * slim, th, 8), M(o.cloth)), 0, th / 2, 0);
  add(torso, mesh(cyl(0.26 * b * slim, 0.26 * b * slim, 0.1, 8), M(o.boots)), 0, 0.04, 0); // belt
  const head = add(torso, grp(), 0, th + 0.24, 0);
  add(head, mesh(sph(0.21, 1), M(o.skin)), 0, 0, 0);
  add(head, mesh(cyl(0.08, 0.1, 0.12), M(o.skin)), 0, -0.2, 0);
  const eye = o.eyes !== undefined ? glow(o.eyes, 3) : M(0x1b1b1b);
  for (const s of [-1, 1]) add(head, mesh(box(0.05, 0.035, 0.02), eye), s * 0.075, 0.02, 0.195);
  const arms = [-1, 1].map((s) => {
    const g = add(torso, grp(), s * 0.39 * b * slim, th - 0.1, 0);
    add(g, mesh(sph(0.11 * b, 0), M(o.cloth)), 0, 0, 0);
    add(g, mesh(cyl(0.085 * b, 0.07 * b, 0.6), M(o.skin)), 0, -0.3, 0);
    const h = add(g, grp(), 0, -0.62, 0);
    add(h, mesh(sph(0.085 * b, 0), M(o.skin)), 0, 0, 0);
    return { g, h };
  });
  // Named joints: the renderer animates these (walk, attack, cast, death).
  root.name = 'rig';
  torso.name = 'torso';
  head.name = 'head';
  legs[0].name = 'legL';
  legs[1].name = 'legR';
  arms[0].g.name = 'armL';
  arms[1].g.name = 'armR';
  arms[0].h.name = 'handL';
  arms[1].h.name = 'handR';
  return { root, torso, head, legL: legs[0], legR: legs[1], armL: arms[0].g, armR: arms[1].g, handL: arms[0].h, handR: arms[1].h };
}

/** Where a hand is, in the body root's own coordinates (call before rotating the root). */
function at(b: Body, hand: THREE.Object3D): THREE.Vector3 {
  b.root.updateMatrixWorld(true);
  return b.root.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
}

// ------------------------------------------------------------ heroes
/**
 * Brakk the Bulwark: a heavy armored warrior with a tower shield on the left arm and a war
 * hammer in the right hand. Built in a neutral stance; the renderer animates the joints
 * (rig, torso, head, legs, arms and the hammer as its own 'weapon' joint).
 */
function brakk() {
  const b = humanoid({ skin: 0x9c7558, cloth: 0x4a3a2c, cloth2: 0x3a3029, boots: 0x2e2722, bulk: 1.4, hip: 0.88, torsoH: 0.78 });
  const steel = M(0x8a929c, { metalness: 0.75, roughness: 0.35 });
  const iron = M(0x4b5058, { metalness: 0.7, roughness: 0.45 });
  const gold = M(0xb8902c, { metalness: 0.7, roughness: 0.3 });
  const leather = M(0x5a3d26);
  const fur = M(0x6e5a44, { roughness: 0.95 });
  const bone = M(0xd9ccb0);
  // Breastplate with a gold rim, fur mantle on the shoulders, belt and a hanging tabard.
  add(b.torso, mesh(cyl(0.52, 0.4, 0.56, 8), steel), 0, 0.52, 0.02);
  add(b.torso, mesh(box(0.08, 0.5, 0.06), gold), 0, 0.5, 0.45);
  add(b.torso, mesh(box(0.52, 0.07, 0.08), gold), 0, 0.3, 0.42);
  add(b.torso, mesh(cyl(0.58, 0.52, 0.2, 10), fur), 0, 0.86, -0.03).scale.set(1, 1, 0.85);
  add(b.torso, mesh(cyl(0.42, 0.42, 0.13, 8), leather), 0, 0.06, 0);
  add(b.torso, mesh(box(0.2, 0.15, 0.07), gold), 0, 0.06, 0.41);
  add(b.torso, mesh(box(0.44, 0.62, 0.05), M(0x4d1b1b)), 0, -0.3, 0.33);
  add(b.torso, mesh(box(0.44, 0.06, 0.06), gold), 0, -0.6, 0.34);
  add(b.torso, rot(mesh(box(0.55, 0.7, 0.05), M(0x3f2a1e)), 0.15, 0, 0), 0, 0.35, -0.42); // back cloak piece
  // Pauldrons with spikes and gauntlets: on the arms, so they move with them.
  for (const [arm, s] of [[b.armL, -1], [b.armR, 1]] as const) {
    add(arm, mesh(sph(0.27, 0), iron), 0, 0.04, 0).scale.set(1.3, 0.85, 1.15);
    add(arm, mesh(box(0.46, 0.06, 0.42), gold), 0, 0.2, 0);
    for (const k of [-1, 1]) add(arm, rot(mesh(cone(0.055, 0.28, 5), steel), 0, 0, -s * 0.45), s * 0.16, 0.26, k * 0.12);
    add(arm, mesh(cyl(0.12, 0.14, 0.28, 7), iron), 0, -0.5, 0);
    add(arm, mesh(cyl(0.135, 0.135, 0.05, 7), gold), 0, -0.36, 0);
  }
  // Greaves, knee guards and armored boots.
  for (const leg of [b.legL, b.legR]) {
    add(leg, mesh(cyl(0.16, 0.14, 0.42, 7), iron), 0, -0.55, 0.02);
    add(leg, mesh(sph(0.13, 0), steel), 0, -0.3, 0.1);
    add(leg, mesh(box(0.3, 0.13, 0.42), iron), 0, -0.82, 0.06);
  }
  // Horned helm with a face guard and glowing eye slit; braided beard below.
  add(b.head, mesh(sph(0.26, 1), iron), 0, 0.05, 0).scale.set(1, 0.95, 1.05);
  add(b.head, mesh(box(0.32, 0.22, 0.08), iron), 0, -0.07, 0.2);
  add(b.head, mesh(box(0.24, 0.035, 0.02), glow(0xffb347, 2.2)), 0, 0.0, 0.245);
  add(b.head, mesh(box(0.05, 0.32, 0.06), gold), 0, 0.05, 0.235);
  for (const s of [-1, 1]) {
    add(b.head, rot(mesh(cone(0.075, 0.42, 6), bone), 0, 0, -s * 1.05), s * 0.33, 0.2, 0);
    add(b.head, rot(mesh(cone(0.045, 0.22, 5), bone), 0, 0, -s * 0.15), s * 0.55, 0.42, 0);
  }
  add(b.head, rot(mesh(cone(0.11, 0.32, 5), M(0x7a5a3a)), Math.PI, 0, 0), 0, -0.3, 0.17);
  // Tower shield strapped to the left forearm, facing forward.
  const sh = add(b.armL, grp(), 0.02, -0.46, 0.2);
  rot(sh, 0.7, 0, 0);
  add(sh, mesh(box(0.78, 1.1, 0.1), iron), 0, 0, 0);
  add(sh, mesh(box(0.86, 0.09, 0.13), gold), 0, 0.53, 0);
  add(sh, mesh(box(0.86, 0.09, 0.13), gold), 0, -0.53, 0);
  for (const s of [-1, 1]) add(sh, mesh(box(0.09, 1.1, 0.13), gold), s * 0.4, 0, 0);
  add(sh, mesh(sph(0.15, 0), steel), 0, 0.06, 0.08);
  add(sh, rot(mesh(cone(0.2, 0.36, 3), gold), Math.PI / 2, 0, 0), 0, -0.22, 0.06);
  // War hammer in the right hand, held upright at rest: its own joint so it can swing.
  const w = add(b.armR, grp(), 0, -0.62, 0.04);
  w.name = 'weapon';
  add(w, mesh(cyl(0.05, 0.055, 1.35), leather), 0, 0.38, 0);
  add(w, mesh(sph(0.08, 0), gold), 0, -0.3, 0);
  for (const y of [0.05, 0.75]) add(w, mesh(cyl(0.065, 0.065, 0.06), gold), 0, y, 0);
  add(w, mesh(box(0.66, 0.38, 0.38), iron), 0, 1.08, 0);
  add(w, mesh(box(0.7, 0.08, 0.4), gold), 0, 1.08, 0);
  add(w, mesh(box(0.12, 0.42, 0.42), steel), -0.34, 1.08, 0);
  add(w, rot(mesh(cone(0.1, 0.28, 5), steel), 0, 0, Math.PI / 2), 0.46, 1.08, 0);
  add(w, mesh(cone(0.08, 0.24, 5), steel), 0, 1.38, 0);
  // Neutral stance: shield arm forward, hammer arm relaxed slightly out.
  rot(b.armL, -0.75, 0, -0.18);
  rot(b.armR, -0.15, 0, 0.16);
  return b.root;
}

function vexa() {
  const b = humanoid({ skin: 0xe6b996, cloth: 0x2f6b4a, cloth2: 0x3b3a2e, boots: 0x4a3524, hip: 1.0, slim: 0.82 });
  const leather = M(0x7a5232);
  const hood = add(b.head, mesh(sph(0.25, 1), M(0x2a5a3e)), 0, 0.05, -0.04);
  hood.scale.set(1, 1.05, 1.1);
  add(b.head, rot(mesh(cone(0.15, 0.3, 6), M(0x2a5a3e)), -1.3, 0, 0), 0, 0.1, -0.25);
  add(b.head, mesh(box(0.3, 0.14, 0.1), M(0xe6b996)), 0, -0.03, 0.17);
  for (const s of [-1, 1]) add(b.head, mesh(box(0.05, 0.035, 0.02), M(0x163b20)), s * 0.07, 0.0, 0.225);
  add(b.torso, rot(mesh(box(0.62, 1.35, 0.04), M(0x245039, { side: THREE.DoubleSide })), 0.28, 0, 0), 0, 0.15, -0.3);
  const q = add(b.torso, rot(grp(), 0.2, 0, 0.5), 0.15, 0.45, -0.28);
  add(q, mesh(cyl(0.09, 0.08, 0.6), leather), 0, 0, 0);
  for (let i = 0; i < 4; i++) add(q, mesh(cone(0.04, 0.12, 4), M(0xe8e0d0)), -0.04 + (i % 2) * 0.06, 0.36, -0.03 + (i >> 1) * 0.05);
  // side-on archer stance: left shoulder toward the target
  b.torso.rotation.y = 1.15;
  b.head.rotation.y = -0.9;
  rot(b.armL, 0, 0, -1.5);
  rot(b.armR, 0.1, 0, -1.25);
  rot(b.legL, 0, 0, 0.18);
  rot(b.legR, 0, 0, -0.18);
  const grip = at(b, b.handL);
  const draw = at(b, b.handR);
  const aim = grip.clone().sub(draw).setY(0).normalize();
  const bow = add(b.root, grp(), 0, 0, 0);
  bow.position.copy(grip);
  bow.lookAt(grip.clone().add(aim));
  const R = 0.62;
  const arc = add(bow, mesh(new THREE.TorusGeometry(R, 0.035, 5, 20, Math.PI * 0.9), M(0x5c3b1e)), 0, 0, -R + 0.05);
  rot(arc, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 0.05);
  const tipY = R * Math.sin(Math.PI * 0.45);
  const tipZ = -R + 0.05 + R * Math.cos(Math.PI * 0.45);
  const dl = bow.worldToLocal(b.root.localToWorld(draw.clone()));
  for (const sy of [-1, 1]) {
    const a = new THREE.Vector3(0, sy * tipY, tipZ);
    const len = a.distanceTo(dl);
    const st = add(bow, mesh(cyl(0.006, 0.006, len, 3), M(0xf2f2e0)), (a.x + dl.x) / 2, (a.y + dl.y) / 2, (a.z + dl.z) / 2);
    st.lookAt(bow.localToWorld(a.clone()));
    st.rotateX(Math.PI / 2);
  }
  const arrow = add(bow, grp(), 0, dl.y, 0);
  const alen = 0.35 - dl.z;
  add(arrow, rot(mesh(cyl(0.012, 0.012, alen, 4), M(0xd8c8a0)), Math.PI / 2, 0, 0), 0, 0, dl.z + alen / 2);
  add(arrow, rot(mesh(cone(0.035, 0.12, 4), glow(0x9fffc8, 2)), Math.PI / 2, 0, 0), 0, 0, 0.4);
  b.root.rotation.y = -0.35;
  for (let i = 0; i < 3; i++) {
    const t = add(fx, mesh(new THREE.TorusGeometry(0.9 + i * 0.25, 0.012, 4, 40, Math.PI * 1.2), glow(0xa8ffd0, 1.5, 0.6)), 0, 0.5 + i * 0.55, 0);
    t.rotation.set(Math.PI / 2 + 0.15 * (i - 1), 0, i * 2);
  }
  for (let i = 0; i < 12; i++) {
    const a = i * 1.7;
    add(fx, rot(mesh(box(0.12, 0.01, 0.06), M(0x6fcf5a)), a, a, a), Math.cos(a) * (1 + (i % 3) * 0.3), 0.4 + (i % 5) * 0.35, Math.sin(a) * (1 + (i % 3) * 0.3));
  }
  return b.root;
}

function orin() {
  const b = humanoid({ skin: 0xd9a77e, cloth: 0x7a2e1c, cloth2: 0x5a2416, boots: 0x3a2318, hip: 0.95, slim: 0.9 });
  add(b.root, mesh(cone(0.55, 1.0, 9), M(0x8c3420)), 0, 0.5, 0).scale.set(1, 1, 0.9);
  add(b.root, mesh(cyl(0.56, 0.6, 0.08, 9), M(0xd9a43a, { metalness: 0.5 })), 0, 0.04, 0);
  b.legL.visible = b.legR.visible = false;
  add(b.torso, mesh(box(0.14, 0.72, 0.05), M(0xd9a43a, { metalness: 0.5 })), 0, 0.36, 0.25);
  const hat = add(b.head, grp(), 0, 0.12, -0.02);
  add(hat, mesh(cyl(0.3, 0.32, 0.05, 9), M(0x5a2416)), 0, 0, 0);
  add(hat, rot(mesh(cone(0.22, 0.7, 7), M(0x7a2e1c)), -0.25, 0, 0), 0, 0.33, -0.08);
  add(b.head, rot(mesh(cone(0.13, 0.36, 6), M(0xe8e4dc)), Math.PI + 0.2, 0, 0), 0, -0.25, 0.12);
  // staff planted beside him (left hand)
  rot(b.armL, -0.35, 0, -0.3);
  const g = at(b, b.handL);
  const st = add(b.root, grp(), g.x, 0, g.z);
  add(st, mesh(cyl(0.035, 0.045, 2.15, 6), M(0x4a2e1a)), 0, 1.07, 0);
  add(st, mesh(new THREE.TorusGeometry(0.13, 0.025, 5, 10), M(0xd9a43a, { metalness: 0.6 })), 0, 2.2, 0);
  add(st, mesh(new THREE.OctahedronGeometry(0.12), glow(0xff8a2a, 3)), 0, 2.2, 0);
  point(st, 0xff7a2a, 3, 0, 2.2, 0.3, 4);
  // fireball held up and out to the right
  rot(b.armR, -0.5, 0, 2.2);
  const f = at(b, b.handR);
  const fb = add(b.root, grp(), f.x + 0.05, f.y + 0.28, f.z);
  add(fb, mesh(sph(0.19, 1), glow(0xffd25a, 3)), 0, 0, 0);
  add(fb, mesh(sph(0.28, 1), glow(0xff5a1a, 1.5, 0.35)), 0, 0, 0);
  point(fb, 0xff7a2a, 8, 0, 0, 0.3, 6);
  for (let i = 0; i < 22; i++) {
    const a = i * 2.4;
    const r = 0.8 + (i % 5) * 0.25;
    add(fx, rot(mesh(new THREE.OctahedronGeometry(0.025 + (i % 3) * 0.012), glow(i % 2 ? 0xff9a3a : 0xffd25a, 3)), a, a, 0), Math.cos(a) * r, 0.4 + ((i * 13) % 20) / 10, Math.sin(a) * r);
  }
  b.root.rotation.y = 0.25;
  return b.root;
}

function syl() {
  const b = humanoid({ skin: 0xc7a3c9, cloth: 0x2b2340, cloth2: 0x1f1a2e, boots: 0x15121f, hip: 0.82, slim: 0.8, eyes: 0xc4a6ff });
  // mask + hood
  const hood = add(b.head, mesh(sph(0.25, 1), M(0x221b33)), 0, 0.04, -0.04);
  hood.scale.set(1, 1.05, 1.1);
  add(b.head, mesh(box(0.3, 0.13, 0.08), M(0x15121f)), 0, -0.07, 0.17);
  // trailing scarf
  add(b.torso, mesh(cyl(0.2, 0.24, 0.1, 8), M(0x7c5cd6)), 0, 0.72, 0);
  for (let i = 0; i < 4; i++) add(b.torso, rot(mesh(box(0.1, 0.03, 0.26), M(0x7c5cd6)), 0.2 + i * 0.1, 0, 0), 0.1 + i * 0.03, 0.72 - i * 0.05, -0.28 - i * 0.24);
  // crouched lunge pose with twin daggers
  b.torso.rotation.x = 0.35;
  b.torso.position.z = 0.1;
  rot(b.legL, -0.9, 0, 0.1);
  rot(b.legR, 0.7, 0, -0.1);
  b.root.position.y = -0.12;
  const dagger = (h: THREE.Group, flip: number) => {
    const d = add(h, grp(), 0, -0.04, 0);
    rot(d, flip, 0, 0);
    add(d, mesh(box(0.04, 0.16, 0.05), M(0x2a2a2a)), 0, 0, 0);
    add(d, mesh(box(0.14, 0.03, 0.05), M(0xa78bfa, { metalness: 0.6 })), 0, 0.09, 0);
    add(d, rot(mesh(cone(0.05, 0.5, 4), glow(0xcab8ff, 1.2)), 0, Math.PI / 4, 0), 0, 0.35, 0).scale.set(1, 1, 0.3);
  };
  rot(b.armR, -1.6, 0, -0.5);
  dagger(b.handR, 1.6);
  rot(b.armL, 0.9, 0, 0.9);
  dagger(b.handL, -1.4);
  b.root.rotation.y = -0.45;
  // shadow afterimages (Shadow Lunge / Veil)
  const ghost = (dx: number, dz: number, op: number) => {
    const g = b.root.clone(true);
    g.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        (c as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color: 0x8b6cff, emissive: 0x4b2a9a, emissiveIntensity: 1.2, transparent: true, opacity: op, depthWrite: false });
        c.castShadow = false;
      }
    });
    g.position.set(dx, b.root.position.y, dz);
    fx.add(g);
  };
  ghost(-0.85, -0.9, 0.22);
  ghost(-1.6, -1.8, 0.1);
  for (let i = 0; i < 16; i++) {
    const a = i * 2.1;
    add(fx, mesh(sph(0.12 + (i % 4) * 0.05, 0), new THREE.MeshStandardMaterial({ color: 0x3a2a66, transparent: true, opacity: 0.35, depthWrite: false })), -0.6 + Math.cos(a) * 0.9, 0.12 + (i % 3) * 0.1, -0.7 + Math.sin(a) * 0.9);
  }
  return b.root;
}

function grom() {
  const bark = 0x6b4a2e;
  const b = humanoid({ skin: bark, cloth: 0x5a3e26, cloth2: 0x4a3420, boots: 0x3a2a1a, bulk: 1.6, hip: 0.9, torsoH: 0.85, eyes: 0x9dff5a });
  const moss = M(0x65a30d);
  const moss2 = M(0x4d7c0f);
  // bark ridges on the trunk
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(b.torso, rot(mesh(box(0.08, 0.8, 0.08), M(0x4a321e)), 0, a, 0), Math.sin(a) * 0.46, 0.45, Math.cos(a) * 0.4);
  }
  // mossy shoulders + head canopy with branch antlers
  for (const s of [-1, 1]) {
    add(b.torso, mesh(sph(0.3, 0), moss), s * 0.6, 0.85, 0).scale.set(1.2, 0.8, 1.1);
    add(b.torso, mesh(sph(0.2, 0), moss2), s * 0.5, 0.95, -0.15);
  }
  add(b.head, mesh(sph(0.26, 0), M(bark)), 0, 0, 0).scale.set(1.15, 1, 1);
  for (const s of [-1, 1]) {
    const br = add(b.head, rot(grp(), 0, 0, -s * 0.6), s * 0.15, 0.18, -0.05);
    add(br, mesh(cyl(0.025, 0.05, 0.6, 5), M(0x4a321e)), 0, 0.3, 0);
    add(br, rot(mesh(cyl(0.018, 0.03, 0.3, 5), M(0x4a321e)), 0, 0, s * 0.9), s * 0.1, 0.45, 0);
    add(br, mesh(sph(0.12, 0), moss), 0, 0.62, 0);
    add(br, mesh(sph(0.09, 0), moss2), s * 0.2, 0.55, 0);
  }
  // huge root fists
  for (const [arm, h, s] of [[b.armL, b.handL, -1], [b.armR, b.handR, 1]] as const) {
    rot(arm, -0.5, 0, s * 0.35);
    add(h, mesh(sph(0.24, 0), M(0x5a3e26)), 0, -0.05, 0);
    for (let i = 0; i < 3; i++) add(h, rot(mesh(cone(0.05, 0.3, 4), M(0x4a321e)), Math.PI, 0, (i - 1) * 0.4), (i - 1) * 0.1, -0.3, 0.05);
  }
  rot(b.armR, -0.9, 0, 0.45);
  rot(b.legL, -0.15, 0, 0.12);
  rot(b.legR, 0.15, 0, -0.12);
  b.root.rotation.y = 0.2;
  // roots bursting from the ground (Root Snare / Overgrowth)
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    const r = 1.2 + (i % 3) * 0.3;
    const g = add(fx, grp(), Math.cos(a) * r, 0, Math.sin(a) * r);
    rot(g, 0, -a, 0.35 + (i % 2) * 0.2);
    add(g, mesh(cone(0.09, 0.7 + (i % 3) * 0.3, 5), M(0x5a3e26)), 0, 0.3, 0);
    if (i % 2) add(g, mesh(sph(0.08, 0), moss), 0, 0.5, 0);
  }
  for (let i = 0; i < 14; i++) {
    const a = i * 1.9;
    add(fx, mesh(new THREE.OctahedronGeometry(0.03), glow(0xb6ff6a, 2.5)), Math.cos(a) * 1.0, 0.5 + (i % 6) * 0.3, Math.sin(a) * 1.0);
  }
  return b.root;
}

function kaela() {
  const b = humanoid({ skin: 0xb98a6a, cloth: 0x0e7490, cloth2: 0x155e75, boots: 0x123c4a, hip: 0.95, slim: 0.8 });
  add(b.root, mesh(cone(0.6, 1.05, 10), M(0x0891b2)), 0, 0.52, 0);
  add(b.root, mesh(cyl(0.6, 0.66, 0.06, 10), M(0xe8f8ff)), 0, 0.03, 0);
  b.legL.visible = b.legR.visible = false;
  add(b.torso, mesh(cyl(0.12, 0.26, 0.12, 8), M(0xf0e6c8, { metalness: 0.4 })), 0, 0.68, 0.0);
  add(b.head, mesh(box(0.42, 0.75, 0.16), M(0x1e3a5f)), 0, -0.22, -0.13);
  add(b.head, mesh(sph(0.225, 1), M(0x1e3a5f)), 0, 0.05, -0.03);
  for (let i = 0; i < 5; i++) add(b.head, rot(mesh(cone(0.035, 0.22 + (i % 2) * 0.1, 5), M(0xff7f6e)), 0, 0, (i - 2) * 0.35), (i - 2) * 0.08, 0.27, 0.05);
  // trident planted at her right side
  rot(b.armR, -0.2, 0, 0.35);
  const g = at(b, b.handR);
  const tr = add(b.root, grp(), g.x + 0.05, 0, g.z);
  add(tr, mesh(cyl(0.03, 0.03, 2.25, 6), M(0xd6c9a0, { metalness: 0.5 })), 0, 1.12, 0);
  add(tr, mesh(box(0.34, 0.04, 0.05), M(0xcfe8ff, { metalness: 0.7 })), 0, 2.25, 0);
  for (const x of [-0.15, 0, 0.15]) add(tr, mesh(cone(0.035, 0.3, 4), M(0xcfe8ff, { metalness: 0.7, roughness: 0.25 })), x, 2.4 + (x === 0 ? 0.06 : 0), 0);
  // left hand out to the side, conjuring water
  rot(b.armL, -0.6, 0, -1.2);
  const o = at(b, b.handL);
  const orb = add(b.root, grp(), o.x - 0.12, o.y + 0.12, o.z + 0.05);
  add(orb, mesh(sph(0.16, 2), glow(0x67e8f9, 1.4, 0.85)), 0, 0, 0);
  add(orb, mesh(new THREE.TorusGeometry(0.26, 0.02, 4, 24), glow(0xa5f3fc, 1.5, 0.7)), 0, 0, 0).rotation.x = 1.2;
  point(orb, 0x22d3ee, 5, 0, 0, 0.3, 5);
  for (let i = 0; i < 3; i++) {
    const t = add(fx, mesh(new THREE.TorusGeometry(1.0 + i * 0.35, 0.035 - i * 0.008, 5, 48), glow(0x22d3ee, 1.4, 0.7 - i * 0.15)), 0, 0.06 + i * 0.04, 0);
    t.rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 18; i++) {
    const a = i * 0.9;
    const r = 1.1 + (i % 4) * 0.25;
    add(fx, mesh(sph(0.03 + (i % 3) * 0.012, 1), glow(0xa5f3fc, 1.3, 0.8)), Math.cos(a) * r, 0.15 + ((i * 7) % 12) / 10, Math.sin(a) * r);
  }
  b.root.rotation.y = 0.3;
  return b.root;
}


export const HERO_BUILDERS: Record<HeroId, () => THREE.Group> = { brakk, vexa, orin, syl, grom, kaela };

/** Everything else: creeps, jungle monsters, buildings, wards, power-ups. */
export { humanoid, M, glow, add, mesh, box, cyl, sph, cone, grp, rot };
export type { Body };
export function resetFx() {
  fx = new THREE.Group();
}
