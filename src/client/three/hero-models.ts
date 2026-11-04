import * as THREE from 'three';
import type { HeroId } from '../../sim';

/**
 * Low-poly 3D models built from simple shapes (placeholder art). Each hero builder makes
 * the same model as the 3D concept viewer. Models face +z; the renderer bakes each one
 * into a couple of merged meshes so a whole unit costs 1-3 draw calls.
 */

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

/** A bent tube through the given points (bows, branches, scarves). */
function tube(pts: [number, number, number][], r: number, seg = 10, radial = 5) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, radial);
}

/**
 * Vexa the ranger: hooded, dark leather, cloak and quiver on her back, a recurve longbow in
 * the left hand (the 'weapon' joint, so the renderer can raise and aim it).
 */
function vexa() {
  const b = humanoid({ skin: 0xc99a7c, cloth: 0x2d4632, cloth2: 0x35302a, boots: 0x3b2a1c, hip: 1.0, slim: 0.82 });
  const leather = M(0x5a3b22);
  const dark = M(0x2a1d14);
  const green = M(0x1e3a29, { side: THREE.DoubleSide });
  const gold = M(0xb8902c, { metalness: 0.6, roughness: 0.35 });
  // Jerkin, chest strap, belt pouches, short skirt of leather strips.
  add(b.torso, mesh(cyl(0.29, 0.23, 0.5, 8), M(0x3a5240)), 0, 0.46, 0.0);
  add(b.torso, rot(mesh(box(0.07, 0.86, 0.04), leather), 0, 0, 0.72), 0, 0.44, 0.27);
  add(b.torso, mesh(box(0.1, 0.07, 0.05), gold), 0, 0.44, 0.29);
  for (const s of [-1, 1]) add(b.torso, mesh(box(0.11, 0.12, 0.08), leather), s * 0.19, 0.0, 0.17);
  for (let i = 0; i < 5; i++) add(b.torso, rot(mesh(box(0.11, 0.3, 0.03), dark), 0.15, ((i - 2) * Math.PI) / 5, 0), Math.sin(((i - 2) * Math.PI) / 5) * 0.21, -0.14, Math.cos(((i - 2) * Math.PI) / 5) * 0.21);
  // Hood and cloak.
  const hood = add(b.head, mesh(sph(0.25, 1), green), 0, 0.05, -0.06);
  hood.scale.set(1, 1.05, 1.1);
  add(b.head, rot(mesh(cone(0.15, 0.32, 6), green), -1.3, 0, 0), 0, 0.08, -0.29);
  add(b.head, mesh(box(0.27, 0.16, 0.1), M(0xc99a7c)), 0, -0.02, 0.15);
  for (const s of [-1, 1]) add(b.head, mesh(box(0.05, 0.03, 0.02), M(0x1d3b26)), s * 0.07, 0.01, 0.205);
  add(b.head, mesh(box(0.28, 0.09, 0.06), M(0x23382a)), 0, -0.11, 0.17); // face scarf
  add(b.torso, mesh(cyl(0.3, 0.33, 0.1, 8), green), 0, 0.72, -0.02); // hood collar
  add(b.torso, rot(mesh(box(0.62, 1.3, 0.04), green), 0.2, 0, 0), 0, 0.12, -0.31);
  // Quiver of arrows across the back.
  const q = add(b.torso, rot(grp(), 0.25, 0, 0.45), 0.12, 0.45, -0.3);
  add(q, mesh(cyl(0.085, 0.07, 0.62), leather), 0, 0, 0);
  add(q, mesh(cyl(0.09, 0.09, 0.05), gold), 0, 0.28, 0);
  for (let i = 0; i < 5; i++) {
    add(q, mesh(cyl(0.008, 0.008, 0.2, 3), M(0xd8c8a0)), -0.04 + (i % 3) * 0.04, 0.38, -0.03 + (i >> 1) * 0.03);
    add(q, mesh(cone(0.03, 0.1, 3), M(0x2f5a3a)), -0.04 + (i % 3) * 0.04, 0.47, -0.03 + (i >> 1) * 0.03);
  }
  // Bracers, a shoulder guard on the bow arm, tall boots.
  for (const arm of [b.armL, b.armR]) add(arm, mesh(cyl(0.08, 0.075, 0.24, 7), dark), 0, -0.46, 0);
  add(b.armL, mesh(sph(0.14, 0), leather), 0, 0.03, 0).scale.set(1.2, 0.8, 1.1);
  for (const leg of [b.legL, b.legR]) add(leg, mesh(cyl(0.1, 0.09, 0.34, 7), M(0x3b2a1c)), 0, -0.7, 0);
  // Recurve longbow in the left hand: built standing up, grip at the hand, string toward her.
  const w = add(b.armL, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  const wood = M(0x3d2614);
  add(w, mesh(tube([[0, -0.72, -0.1], [0, -0.62, -0.2], [0, -0.32, -0.04], [0, 0, 0.06], [0, 0.32, -0.04], [0, 0.62, -0.2], [0, 0.72, -0.1]], 0.026, 14), wood), 0, 0, 0);
  add(w, mesh(cyl(0.038, 0.038, 0.18, 6), M(0x1a120c)), 0, 0, 0.05);
  for (const y of [-0.72, 0.72]) add(w, mesh(sph(0.035, 0), gold), 0, y, -0.1);
  add(w, mesh(tube([[0, -0.68, -0.17], [0, 0, -0.17], [0, 0.68, -0.17]], 0.006, 2, 3), M(0xe8e4d0)), 0, 0, 0);
  add(w, rot(mesh(cyl(0.01, 0.01, 0.8, 3), M(0xd8c8a0)), Math.PI / 2, 0, 0), 0, 0.02, 0.22);
  add(w, rot(mesh(cone(0.03, 0.1, 4), M(0xc9d2d8, { metalness: 0.7 })), Math.PI / 2, 0, 0), 0, 0.02, 0.66);
  add(w, rot(mesh(cone(0.035, 0.12, 3), M(0x2f5a3a)), -Math.PI / 2, 0, 0), 0, 0.02, -0.12);
  // Ready stance: bow held low and angled forward.
  rot(b.armL, -0.35, 0, -0.12);
  rot(w, 0.9, 0, 0);
  rot(b.armR, -0.1, 0, 0.1);
  return b.root;
}

/**
 * Orin the fire mage: deep hooded robe with ember eyes and a long beard, a gnarled staff with
 * a caged fire crystal in the left hand ('weapon' joint), embers glowing in the right palm.
 */
function orin() {
  const b = humanoid({ skin: 0xc89a78, cloth: 0x5e1a14, cloth2: 0x4a1410, boots: 0x2a1410, hip: 0.95, slim: 0.9, eyes: 0xff8a2a });
  const robe = M(0x5a1913);
  const trim = M(0xb8902c, { metalness: 0.6, roughness: 0.35 });
  const dark = M(0x2a120e);
  const ember = glow(0xff7a2a, 2.6);
  // Long robe (no legs), gold hem, sash and front panel with runes. Named so it stays on the
  // body instead of being attached to the nearest hand when the model is baked.
  const skirt = add(b.root, grp(), 0, 0, 0);
  skirt.name = 'robe';
  add(skirt, mesh(cone(0.58, 1.02, 10), robe), 0, 0.5, 0).scale.set(1, 1, 0.9);
  add(skirt, mesh(cyl(0.585, 0.62, 0.07, 10), trim), 0, 0.04, 0);
  add(skirt, mesh(box(0.22, 0.9, 0.04), M(0x3a0e0a)), 0, 0.48, 0.3).rotation.x = -0.25;
  for (let i = 0; i < 3; i++) add(skirt, mesh(box(0.07, 0.07, 0.02), ember), 0, 0.25 + i * 0.25, 0.34 - i * 0.06).rotation.set(-0.25, 0, Math.PI / 4);
  b.legL.visible = b.legR.visible = false;
  add(b.torso, mesh(cyl(0.3, 0.26, 0.6, 8), robe), 0, 0.4, 0);
  add(b.torso, mesh(cyl(0.27, 0.27, 0.1, 8), M(0x2a120e)), 0, 0.08, 0);
  add(b.torso, mesh(box(0.1, 0.1, 0.05), trim), 0, 0.08, 0.27);
  // Mantle with a high collar and small gold shoulder plates.
  add(b.torso, mesh(cyl(0.42, 0.36, 0.16, 9), M(0x3a0e0a)), 0, 0.68, -0.02);
  add(b.torso, rot(mesh(cyl(0.3, 0.36, 0.3, 9, ), M(0x3a0e0a)), -0.2, 0, 0), 0, 0.84, -0.1);
  for (const arm of [b.armL, b.armR]) {
    add(arm, mesh(sph(0.15, 0), trim), 0, 0.04, 0).scale.set(1.1, 0.7, 1.1);
    add(arm, mesh(cyl(0.11, 0.17, 0.42, 7), robe), 0, -0.36, 0); // wide sleeve
  }
  // Deep hood, shadowed face, ember eyes (from the base body) and a long grey beard.
  const hood = add(b.head, mesh(sph(0.27, 1), M(0x4a1410)), 0, 0.06, -0.05);
  hood.scale.set(1, 1.1, 1.15);
  add(b.head, rot(mesh(cone(0.2, 0.45, 7), M(0x4a1410)), -0.9, 0, 0), 0, 0.12, -0.3);
  add(b.head, mesh(box(0.26, 0.2, 0.08), dark), 0, 0.0, 0.15);
  add(b.head, rot(mesh(cone(0.14, 0.5, 6), M(0xb9b3a8)), Math.PI + 0.15, 0, 0), 0, -0.3, 0.14);
  // Gnarled staff with an iron cage around a fire crystal.
  const w = add(b.armL, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  add(w, mesh(tube([[0, -1.0, 0], [0.02, -0.4, 0.01], [-0.02, 0.3, 0], [0.03, 0.95, 0.01], [0, 1.15, 0]], 0.04, 10), M(0x3a2414)), 0, 0, 0);
  add(w, mesh(cyl(0.05, 0.05, 0.16, 6), dark), 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    add(w, mesh(tube([[0, 1.12, 0], [Math.cos(a) * 0.12, 1.25, Math.sin(a) * 0.12], [Math.cos(a) * 0.1, 1.45, Math.sin(a) * 0.1], [Math.cos(a) * 0.03, 1.55, Math.sin(a) * 0.03]], 0.018, 6, 4), M(0x3b3b40, { metalness: 0.7 })), 0, 0, 0);
  }
  add(w, mesh(new THREE.OctahedronGeometry(0.12), glow(0xffa040, 3)), 0, 1.33, 0).scale.set(1, 1.4, 1);
  add(w, mesh(sph(0.2, 1), glow(0xff5a1a, 1.5, 0.3)), 0, 1.33, 0);
  rot(b.armL, -0.3, 0, -0.15);
  rot(w, 0.3, 0, 0.15);
  rot(b.armR, -0.15, 0, 0.12);
  return b.root;
}

/**
 * Syl the assassin: lean, crouched, dark leathers, masked hood with violet eyes, a trailing
 * scarf, and a curved dagger in each hand (the right one is the 'weapon' joint).
 */
function syl() {
  const b = humanoid({ skin: 0x9c7f95, cloth: 0x2e2546, cloth2: 0x262036, boots: 0x15111e, hip: 0.86, slim: 0.78, eyes: 0xc4a6ff });
  const leather = M(0x3b3058);
  const strap = M(0x1a1524);
  const violet = M(0x5b3fa8);
  // Armored leather vest with crossing straps and a belt of knives.
  add(b.torso, mesh(cyl(0.27, 0.21, 0.48, 8), leather), 0, 0.44, 0);
  for (const s of [-1, 1]) add(b.torso, rot(mesh(box(0.05, 0.8, 0.03), strap), 0, 0, s * 0.6), 0, 0.42, 0.24);
  for (let i = 0; i < 3; i++) add(b.torso, rot(mesh(box(0.03, 0.14, 0.03), M(0x9aa0aa, { metalness: 0.7 })), 0, 0, 0.3), -0.1 + i * 0.08, 0.05, 0.21);
  // Masked hood, glowing eyes from the body; scarf around the neck that trails behind.
  const hood = add(b.head, mesh(sph(0.25, 1), M(0x1b1626)), 0, 0.05, -0.04);
  hood.scale.set(1, 1.05, 1.1);
  add(b.head, rot(mesh(cone(0.13, 0.3, 6), M(0x1b1626)), -1.4, 0, 0), 0, 0.12, -0.27);
  add(b.head, mesh(box(0.3, 0.14, 0.08), M(0x0e0b14)), 0, -0.08, 0.17);
  add(b.torso, mesh(cyl(0.2, 0.24, 0.12, 8), violet), 0, 0.74, 0);
  for (let i = 0; i < 4; i++) add(b.torso, rot(mesh(box(0.13 - i * 0.015, 0.03, 0.3), violet), 0.35 + i * 0.12, 0, 0.1 * i), 0.1 + i * 0.03, 0.68 - i * 0.1, -0.3 - i * 0.26);
  // Arm wraps, shin guards.
  for (const arm of [b.armL, b.armR]) add(arm, mesh(cyl(0.075, 0.07, 0.3, 6), strap), 0, -0.42, 0);
  for (const leg of [b.legL, b.legR]) add(leg, mesh(cyl(0.09, 0.08, 0.32, 6), strap), 0, -0.6, 0.02);
  // Daggers held point-forward.
  const dagger = (h: THREE.Object3D) => {
    const d = add(h, grp(), 0, 0, 0);
    add(d, mesh(box(0.04, 0.05, 0.16), M(0x1a1a1a)), 0, 0, 0);
    add(d, mesh(box(0.14, 0.03, 0.04), M(0x8f78d8, { metalness: 0.6 })), 0, 0, 0.09);
    add(d, mesh(tube([[0, 0, 0.1], [0, 0.04, 0.4], [0, 0.13, 0.7]], 0.04, 6, 3), M(0xc9c3e8, { metalness: 0.8, roughness: 0.25 })), 0, 0, 0).scale.set(0.5, 1, 1);
    add(d, mesh(tube([[0, 0.01, 0.12], [0, 0.05, 0.42], [0, 0.13, 0.7]], 0.016, 6, 3), glow(0xb69bff, 1.6)), 0, 0, 0);
    return d;
  };
  const w = add(b.armR, grp(), 0, -0.62, 0);
  w.name = 'weapon';
  dagger(w);
  dagger(b.handL);
  // Crouched, ready to strike.
  b.torso.rotation.x = 0.25;
  rot(b.armL, -0.55, 0, -0.25);
  rot(b.armR, -0.45, 0, 0.25);
  rot(b.legL, -0.35, 0, 0.08);
  rot(b.legR, 0.2, 0, -0.08);
  b.root.position.y = -0.08;
  return b.root;
}

/**
 * Grom the treant: a hulking body of bark with moss on the shoulders, branch antlers, a
 * glowing green heart showing through cracks in the trunk, and huge root fists.
 */
function grom() {
  const bark = 0x5a3d26;
  const b = humanoid({ skin: bark, cloth: 0x4e3622, cloth2: 0x3e2b1a, boots: 0x2e2014, bulk: 1.6, hip: 0.9, torsoH: 0.85, eyes: 0x9dff5a });
  const ridge = M(0x3a2716);
  const moss = M(0x4f7a1e);
  const moss2 = M(0x3a5c16);
  const sap = glow(0x9dff5a, 2.2);
  // Trunk with bark ridges and a glowing heart in the cracks.
  add(b.torso, mesh(cyl(0.56, 0.44, 0.72, 9), M(0x4e3622)), 0, 0.46, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    add(b.torso, rot(mesh(box(0.09, 0.82, 0.1), ridge), 0.05 * Math.sin(i), a, 0), Math.sin(a) * 0.52, 0.46, Math.cos(a) * 0.5);
  }
  add(b.torso, mesh(new THREE.OctahedronGeometry(0.13), sap), 0, 0.55, 0.52).scale.set(0.8, 1.4, 0.5);
  for (const s of [-1, 1]) add(b.torso, rot(mesh(box(0.025, 0.35, 0.03), sap), 0, 0, s * 0.5), s * 0.1, 0.45, 0.55);
  // Moss on the shoulders and back, a few hanging vines.
  for (const s of [-1, 1]) {
    add(b.torso, mesh(sph(0.32, 0), moss), s * 0.6, 0.86, 0).scale.set(1.2, 0.75, 1.1);
    add(b.torso, mesh(sph(0.22, 0), moss2), s * 0.45, 0.95, -0.2);
    add(b.torso, mesh(tube([[s * 0.7, 0.8, 0.1], [s * 0.75, 0.5, 0.15], [s * 0.72, 0.25, 0.1]], 0.025, 4, 3), moss2), 0, 0, 0);
  }
  add(b.torso, mesh(sph(0.3, 0), moss2), 0, 0.75, -0.42).scale.set(1.4, 0.8, 0.6);
  // Head: a bark knot with glowing eyes, a jutting brow and branch antlers with leaves.
  add(b.head, mesh(sph(0.27, 0), M(bark)), 0, 0, 0).scale.set(1.15, 1, 1);
  add(b.head, mesh(box(0.44, 0.08, 0.12), ridge), 0, 0.08, 0.18);
  add(b.head, rot(mesh(cone(0.12, 0.3, 5), ridge), Math.PI + 0.3, 0, 0), 0, -0.25, 0.1);
  for (const s of [-1, 1]) {
    const br = add(b.head, rot(grp(), 0, 0, -s * 0.55), s * 0.15, 0.18, -0.05);
    add(br, mesh(tube([[0, 0, 0], [s * 0.05, 0.3, 0], [s * 0.02, 0.62, -0.05]], 0.04, 6, 5), ridge), 0, 0, 0);
    add(br, mesh(tube([[s * 0.04, 0.3, 0], [s * 0.2, 0.42, 0.02], [s * 0.3, 0.55, 0]], 0.025, 5, 4), ridge), 0, 0, 0);
    add(br, mesh(sph(0.13, 0), moss), 0, 0.64, -0.05);
    add(br, mesh(sph(0.1, 0), moss2), s * 0.3, 0.58, 0);
  }
  // Huge root fists with twisted fingers; thick bark on the forearms.
  for (const [arm, h] of [[b.armL, b.handL], [b.armR, b.handR]] as const) {
    add(arm, mesh(cyl(0.16, 0.2, 0.36, 7), ridge), 0, -0.42, 0);
    add(arm, mesh(sph(0.2, 0), moss), 0, 0.08, 0).scale.set(1, 0.6, 1);
    add(h, mesh(sph(0.25, 0), M(0x4e3622)), 0, -0.06, 0);
    for (let i = 0; i < 3; i++) add(h, rot(mesh(cone(0.06, 0.32, 4), ridge), Math.PI - 0.2, 0, (i - 1) * 0.4), (i - 1) * 0.11, -0.3, 0.08);
  }
  // Root feet.
  for (const leg of [b.legL, b.legR]) {
    add(leg, mesh(cyl(0.2, 0.24, 0.5, 7), ridge), 0, -0.55, 0);
    for (let i = 0; i < 3; i++) add(leg, rot(mesh(cone(0.06, 0.3, 4), ridge), Math.PI / 2 + 0.3, (i - 1) * 0.6, 0), (i - 1) * 0.12, -0.84, 0.22);
  }
  rot(b.armL, -0.25, 0, -0.3);
  rot(b.armR, -0.25, 0, 0.3);
  return b.root;
}

/**
 * Kaela the tide priestess: sea-green robes with shell shoulders, a coral crown on long dark
 * hair, a trident in the right hand ('weapon' joint) and a swirling water orb at her left hand.
 */
function kaela() {
  const b = humanoid({ skin: 0xc29676, cloth: 0x0f4c5c, cloth2: 0x0c3a47, boots: 0x0a2a33, hip: 0.95, slim: 0.8 });
  const robe = M(0x0f4c5c);
  const pale = M(0xe6dcc0, { metalness: 0.3 });
  const coral = M(0xd8604e);
  const steel = M(0xbfd8e6, { metalness: 0.75, roughness: 0.3 });
  const water = glow(0x5fe0f5, 1.4, 0.8);
  // Long robe (no legs) with a pale hem and hanging scale panels (named: stays on the body).
  const skirt = add(b.root, grp(), 0, 0, 0);
  skirt.name = 'robe';
  add(skirt, mesh(cone(0.6, 1.05, 10), robe), 0, 0.52, 0);
  add(skirt, mesh(cyl(0.6, 0.66, 0.06, 10), pale), 0, 0.03, 0);
  for (let i = 0; i < 6; i++) {
    const a = ((i - 2.5) / 6) * Math.PI;
    add(skirt, rot(mesh(box(0.14, 0.5, 0.03), M(0x137a8a)), -0.35, a, 0), Math.sin(a) * 0.36, 0.62, Math.cos(a) * 0.36);
  }
  b.legL.visible = b.legR.visible = false;
  add(b.torso, mesh(cyl(0.28, 0.24, 0.5, 8), M(0x137a8a)), 0, 0.42, 0);
  add(b.torso, mesh(cyl(0.12, 0.26, 0.12, 8), pale), 0, 0.68, 0);
  add(b.torso, mesh(sph(0.07, 1), water), 0, 0.56, 0.25);
  // Shell shoulders.
  for (const arm of [b.armL, b.armR]) {
    add(arm, mesh(sph(0.17, 0), pale), 0, 0.05, 0).scale.set(1.1, 0.7, 1.1);
    for (let i = 0; i < 3; i++) add(arm, rot(mesh(box(0.03, 0.02, 0.3), M(0xc9bda0)), 0, (i - 1) * 0.5, 0), 0, 0.14, 0);
    add(arm, mesh(cyl(0.08, 0.075, 0.2, 7), pale), 0, -0.48, 0);
  }
  // Long hair, coral crown.
  add(b.head, mesh(box(0.4, 0.72, 0.14), M(0x16273d)), 0, -0.22, -0.17);
  add(b.head, mesh(sph(0.225, 1), M(0x16273d)), 0, 0.08, -0.08).scale.set(1.05, 1, 1);
  for (let i = 0; i < 5; i++) add(b.head, rot(mesh(cone(0.035, 0.24 + (i % 2) * 0.12, 5), coral), 0, 0, (i - 2) * 0.35), (i - 2) * 0.08, 0.28, 0.05);
  add(b.head, mesh(new THREE.TorusGeometry(0.2, 0.025, 4, 14), pale), 0, 0.17, 0.02).rotation.x = Math.PI / 2;
  // Water orb at the left hand.
  add(b.handL, mesh(sph(0.15, 2), water), 0, -0.12, 0.08);
  add(b.handL, mesh(new THREE.TorusGeometry(0.24, 0.018, 4, 20), glow(0xa5f3fc, 1.5, 0.7)), 0, -0.12, 0.08).rotation.x = 1.2;
  // Trident in the right hand.
  const w = add(b.armR, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  add(w, mesh(cyl(0.03, 0.03, 2.3, 6), M(0xd6c9a0, { metalness: 0.5 })), 0, 0.1, 0);
  add(w, mesh(cyl(0.045, 0.045, 0.14, 6), M(0x0c3a47)), 0, 0, 0);
  add(w, mesh(box(0.38, 0.05, 0.05), steel), 0, 1.25, 0);
  add(w, mesh(sph(0.06, 1), water), 0, 1.25, 0.03);
  for (const x of [-0.17, 0, 0.17]) {
    add(w, mesh(cyl(0.02, 0.02, 0.22, 5), steel), x, 1.36, 0);
    add(w, mesh(cone(0.04, 0.2, 4), steel), x, 1.56 + (x === 0 ? 0.06 : 0), 0);
  }
  rot(b.armR, -0.2, 0, 0.12);
  rot(w, 0.2, 0, -0.12);
  rot(b.armL, -0.45, 0, -0.25);
  return b.root;
}


export const HERO_BUILDERS: Record<HeroId, () => THREE.Group> = { brakk, vexa, orin, syl, grom, kaela };

/** Everything else: creeps, jungle monsters, buildings, wards, power-ups. */
export { humanoid, M, glow, add, mesh, box, cyl, sph, cone, grp, rot };
export type { Body };
/** Kept for the model catalogue (the old concept builders put scene extras in a group). */
export function resetFx() {}
