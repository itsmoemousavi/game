import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HeroId, RuneKind, StructureTier } from '../../sim';
import { HERO_BUILDERS, M, add, box, cone, cyl, glow, grp, humanoid, mesh, resetFx, rot, sph } from './hero-models';

export const TEAM_HEX = [0x3d8bfd, 0xe5484d] as const;

// ------------------------------------------------------------------ baking

/** Joints that animate, in parent → child order. */
export const JOINTS = ['rig', 'torso', 'head', 'legL', 'legR', 'armL', 'armR', 'weapon'] as const;
export type Joint = (typeof JOINTS)[number];

/**
 * Merge a model made of many small meshes into a few meshes per joint (lit, glowing,
 * see-through), with the part colors stored per vertex. Humanoids keep their joints
 * (body, legs, arms) as separate pieces so they can be animated; everything else becomes
 * one piece. Keeps draw calls low on phones.
 */
export function bake(top: THREE.Object3D): THREE.Group {
  top.updateMatrixWorld(true);
  const rig = top.getObjectByName('rig');
  // Props held near a hand (weapons, shields, bows, orbs) move with that arm.
  if (rig) {
    const hands = (['handL', 'handR'] as const).map((n) => rig.getObjectByName(n)!);
    const arms = (['armL', 'armR'] as const).map((n) => rig.getObjectByName(n)!);
    const hp = hands.map((h) => h.getWorldPosition(new THREE.Vector3()));
    for (const child of [...rig.children]) {
      if (child.name) continue;
      const p = child.getWorldPosition(new THREE.Vector3());
      const d = hp.map((h) => h.distanceTo(p));
      const i = d[0] < d[1] ? 0 : 1;
      if (d[i] < 0.75) arms[i].attach(child);
    }
    top.updateMatrixWorld(true);
  }
  const jointOf = (o: THREE.Object3D): THREE.Object3D => {
    for (let p: THREE.Object3D | null = o.parent; p && p !== top; p = p.parent) if ((JOINTS as readonly string[]).includes(p.name)) return p;
    return top;
  };
  const pieces = new Map<THREE.Object3D, Record<'lit' | 'glow' | 'clear', THREE.BufferGeometry[]>>();
  const inv = new THREE.Matrix4();
  top.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !isShown(m)) return;
    const j = jointOf(m);
    let parts = pieces.get(j);
    if (!parts) pieces.set(j, (parts = { lit: [], glow: [], clear: [] }));
    const mat = m.material as THREE.MeshStandardMaterial;
    let g = m.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    inv.copy(j.matrixWorld).invert();
    g.applyMatrix4(inv.multiply(m.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const glowing = mat.emissive && mat.emissiveIntensity > 0.5 && mat.emissive.getHex() !== 0;
    const c = (glowing ? mat.emissive : mat.color).clone();
    if (glowing) c.multiplyScalar(Math.min(1.6, 0.6 + mat.emissiveIntensity * 0.3));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (mat.transparent && mat.opacity < 0.9 ? parts.clear : glowing ? parts.glow : parts.lit).push(g);
  });
  // Rebuild the joint tree with the same rest pose; each joint holds its merged meshes.
  const out = new THREE.Group();
  // When the model's top is the body joint itself (humanoids), keep it as a named child so the
  // renderer can move the body (bob, leap, fall) without touching the unit's own position.
  let base: THREE.Object3D = out;
  if (rig && rig === top) {
    base = new THREE.Group();
    base.name = 'rig';
    base.userData.rest = base.quaternion.toArray();
    base.userData.restPos = base.position.toArray();
    out.add(base);
  }
  const made = new Map<THREE.Object3D, THREE.Object3D>([[top, base]]);
  const nodeFor = (j: THREE.Object3D): THREE.Object3D => {
    let node = made.get(j);
    if (node) return node;
    const parentJoint = jointOf(j);
    const parentNode = nodeFor(parentJoint);
    node = new THREE.Group();
    node.name = j.name;
    const local = new THREE.Matrix4().copy(parentJoint.matrixWorld).invert().multiply(j.matrixWorld);
    local.decompose(node.position, node.quaternion, node.scale);
    node.userData.rest = node.quaternion.toArray();
    node.userData.restPos = node.position.toArray();
    parentNode.add(node);
    made.set(j, node);
    return node;
  };
  if (rig) for (const name of JOINTS) {
    const j = rig.name === name ? rig : rig.getObjectByName(name);
    if (j) nodeFor(j);
  }
  for (const [j, parts] of pieces) {
    const node = nodeFor(j);
    const make = (list: THREE.BufferGeometry[], material: THREE.Material, shadow: boolean) => {
      if (!list.length) return;
      const merged = mergeGeometries(list, false)!;
      merged.computeBoundingSphere();
      const me = new THREE.Mesh(merged, material);
      me.castShadow = shadow;
      node.add(me);
    };
    make(parts.lit, LIT, true);
    make(parts.glow, GLOW, false);
    make(parts.clear, CLEAR, false);
  }
  return out;
}
function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
const LIT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
const CLEAR = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false });

// ------------------------------------------------------------------ catalogue

const cache = new Map<string, THREE.Group>();
/** A fresh copy of a model (geometry and materials are shared between copies). */
export function model(key: string): THREE.Group {
  let t = cache.get(key);
  if (!t) {
    t = bake(build(key));
    cache.set(key, t);
  }
  return t.clone();
}

function build(key: string): THREE.Object3D {
  const [kind, a, b, c] = key.split(':');
  resetFx();
  switch (kind) {
    case 'hero':
      return HERO_BUILDERS[a as HeroId]();
    case 'creep':
      return creep(a as 'melee' | 'ranged', Number(b) as 0 | 1);
    case 'brute':
      return brute();
    case 'imp':
      return imp();
    case 'warden':
      return warden();
    case 'structure':
      return structure(a as StructureTier, Number(b) as 0 | 1, c as 'melee' | 'ranged' | undefined);
    case 'rubble':
      return rubble(Number(a));
    case 'ward':
      return ward(a as 'observer' | 'sentry');
    case 'courier':
      return courier(a === 'fly', Number(b) as 0 | 1);
    case 'rune':
      return rune(a as RuneKind);
    case 'shot':
      return shot(a);
  }
  return new THREE.Group();
}

// ------------------------------------------------------------------ creeps

/**
 * Lane creeps: helmeted soldiers in the team colour (sword and round shield), and robed
 * casters with a crystal staff. Weapons are the 'weapon' joint so attacks can swing them.
 */
function creep(type: 'melee' | 'ranged', team: 0 | 1): THREE.Object3D {
  const tc = TEAM_HEX[team];
  const dark = team === 0 ? 0x1c3566 : 0x661c20;
  const b = humanoid({ skin: 0xb89272, cloth: dark, cloth2: 0x2e2a26, boots: 0x221e1a, hip: 0.8, slim: 0.9 });
  const steel = M(0x8d959e, { metalness: 0.65, roughness: 0.4 });
  const iron = M(0x4b5058, { metalness: 0.6 });
  const leather = M(0x4a3524);
  if (type === 'melee') {
    add(b.head, mesh(sph(0.24, 0), steel), 0, 0.07, 0).scale.set(1, 0.85, 1.05);
    add(b.head, mesh(box(0.05, 0.22, 0.06), iron), 0, -0.02, 0.22);
    add(b.torso, mesh(cyl(0.3, 0.25, 0.42, 8), steel), 0, 0.46, 0);
    add(b.torso, mesh(box(0.32, 0.5, 0.04), M(tc)), 0, 0.05, 0.25);
    for (const arm of [b.armL, b.armR]) add(arm, mesh(sph(0.13, 0), iron), 0, 0.03, 0).scale.set(1.2, 0.8, 1.1);
    const w = add(b.armR, grp(), 0, -0.62, 0.02);
    w.name = 'weapon';
    add(w, mesh(box(0.05, 0.14, 0.05), leather), 0, 0, 0);
    add(w, mesh(box(0.22, 0.04, 0.06), iron), 0, 0.09, 0);
    add(w, mesh(box(0.06, 0.72, 0.03), steel), 0, 0.47, 0);
    add(w, mesh(cone(0.04, 0.12, 4), steel), 0, 0.89, 0);
    rot(w, 0.6, 0, 0);
    rot(b.armR, -0.35, 0, 0.08);
    const sh = add(b.armL, grp(), 0.02, -0.45, 0.14);
    add(sh, rot(mesh(cyl(0.34, 0.34, 0.06, 10), M(tc)), Math.PI / 2, 0, 0), 0, 0, 0);
    add(sh, rot(mesh(cyl(0.36, 0.36, 0.04, 10), iron), Math.PI / 2, 0, 0), 0, 0, -0.02);
    add(sh, mesh(sph(0.07, 0), steel), 0, 0, 0.05);
    rot(b.armL, -0.6, 0, -0.15);
  } else {
    add(b.root, mesh(cone(0.42, 0.85, 8), M(dark)), 0, 0.42, 0);
    b.legL.visible = b.legR.visible = false;
    add(b.head, mesh(sph(0.25, 1), M(dark)), 0, 0.05, -0.05).scale.set(1, 1.05, 1.1);
    add(b.head, rot(mesh(cone(0.12, 0.3, 6), M(dark)), -1.2, 0, 0), 0, 0.12, -0.25);
    add(b.torso, mesh(cyl(0.27, 0.24, 0.5, 8), M(dark)), 0, 0.38, 0);
    add(b.torso, mesh(box(0.08, 0.45, 0.04), M(tc)), 0, 0.38, 0.25);
    const w = add(b.armR, grp(), 0, -0.62, 0.02);
    w.name = 'weapon';
    add(w, mesh(cyl(0.03, 0.035, 1.5, 5), M(0x4a3020)), 0, 0.3, 0);
    add(w, mesh(new THREE.OctahedronGeometry(0.11), glow(team === 0 ? 0x9ccbff : 0xffa3a3, 2.5)), 0, 1.1, 0).scale.set(1, 1.5, 1);
    rot(b.armR, -0.3, 0, 0.1);
    rot(w, 0.3, 0, 0);
  }
  const g = grp();
  g.add(b.root);
  g.scale.setScalar(0.72);
  return g;
}

// ------------------------------------------------------------------ jungle

/** Jungle brute: a hunched ogre with tusks, a hide loincloth and a spiked club ('weapon'). */
function brute(): THREE.Object3D {
  const b = humanoid({ skin: 0x6e5e4c, cloth: 0x4a3d30, cloth2: 0x3a3028, boots: 0x2e251d, bulk: 1.5, hip: 0.7, torsoH: 0.75, eyes: 0xffb347 });
  const hide = M(0x5a4530);
  b.torso.rotation.x = 0.35;
  add(b.torso, mesh(cyl(0.55, 0.42, 0.6, 8), M(0x6e5e4c)), 0, 0.42, 0.04).scale.set(1, 1, 0.9);
  add(b.torso, mesh(box(0.6, 0.4, 0.05), hide), 0, -0.1, 0.32);
  add(b.torso, mesh(sph(0.3, 0), M(0x5e4f40)), 0, 0.72, -0.2).scale.set(1.5, 0.7, 1);
  for (const s of [-1, 1]) {
    add(b.head, rot(mesh(cone(0.06, 0.3, 5), M(0xe8dcc0)), -0.6, 0, -s * 0.5), s * 0.12, -0.12, 0.18);
    add(b.head, rot(mesh(cone(0.05, 0.22, 4), M(0xcfc3a6)), 0, 0, -s * 0.9), s * 0.22, 0.14, 0);
  }
  add(b.head, mesh(box(0.34, 0.07, 0.1), M(0x4e4236)), 0, 0.08, 0.17);
  const w = add(b.armR, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  add(w, mesh(cyl(0.09, 0.17, 1.0, 7), M(0x4a3524)), 0, 0.45, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(w, rot(mesh(cone(0.04, 0.16, 4), M(0x9aa0a6, { metalness: 0.6 })), 0, 0, Math.PI / 2), Math.cos(a) * 0.16, 0.75 + (i % 2) * 0.12, Math.sin(a) * 0.16).lookAt(Math.cos(a) * 2, 0.8, Math.sin(a) * 2);
  }
  rot(w, 0.4, 0, 0);
  rot(b.armL, -0.3, 0, -0.2);
  rot(b.armR, -0.3, 0, 0.2);
  return b.root;
}

/** Jungle goblin: small, wiry, long ears, a crude spear ('weapon'). */
function imp(): THREE.Object3D {
  const b = humanoid({ skin: 0x7a9650, cloth: 0x5a4226, cloth2: 0x3e3020, boots: 0x2e251d, hip: 0.55, torsoH: 0.5, slim: 0.8, eyes: 0xffe066 });
  for (const s of [-1, 1]) add(b.head, rot(mesh(cone(0.07, 0.35, 4), M(0x7a9650)), 0, 0, -s * 1.3), s * 0.27, 0.05, 0);
  add(b.head, rot(mesh(cone(0.06, 0.16, 4), M(0x6a8444)), Math.PI / 2, 0, 0), 0, -0.02, 0.24);
  add(b.torso, mesh(box(0.36, 0.3, 0.26), M(0x4a3620)), 0, 0.2, 0);
  const w = add(b.armR, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  add(w, mesh(cyl(0.025, 0.025, 1.3, 4), M(0x5a3d26)), 0, 0.3, 0);
  add(w, mesh(cone(0.05, 0.22, 4), M(0xa0a0a0, { metalness: 0.5 })), 0, 1.05, 0);
  rot(b.armR, -0.6, 0, 0.1);
  rot(w, 0.9, 0, 0);
  return b.root;
}

/** The Warden: a towering stone golem with violet crystals growing from its back and shoulders. */
function warden(): THREE.Object3D {
  const stone = 0x4b4560;
  const b = humanoid({ skin: stone, cloth: 0x3b3550, cloth2: 0x332e45, boots: 0x2a2638, bulk: 1.9, hip: 1.0, torsoH: 1.0, eyes: 0xd8b4fe });
  const crystal = glow(0xa78bfa, 2.2);
  const rock = M(0x3e3952);
  add(b.torso, mesh(cyl(0.75, 0.55, 0.9, 7), M(stone)), 0, 0.55, 0);
  add(b.torso, mesh(new THREE.OctahedronGeometry(0.18), crystal), 0, 0.6, 0.6).scale.set(0.8, 1.3, 0.4);
  for (const s of [-1, 1]) {
    add(b.torso, rot(mesh(new THREE.OctahedronGeometry(0.28), crystal), 0, 0, s * 0.4), s * 0.75, 1.15, 0).scale.set(0.6, 1.4, 0.6);
    add(b.torso, rot(mesh(new THREE.OctahedronGeometry(0.18), crystal), 0.3, 0, s * 0.7), s * 0.55, 1.25, -0.25).scale.set(0.6, 1.4, 0.6);
    add(b.torso, rot(mesh(new THREE.OctahedronGeometry(0.22), crystal), -0.4, 0, s * 0.3), s * 0.3, 1.0, -0.5).scale.set(0.6, 1.6, 0.6);
  }
  for (const arm of [b.armL, b.armR]) {
    add(arm, mesh(sph(0.34, 0), rock), 0, 0.05, 0).scale.set(1.2, 0.9, 1.1);
    add(arm, mesh(cyl(0.2, 0.25, 0.45, 6), rock), 0, -0.4, 0);
  }
  add(b.head, mesh(sph(0.3, 0), rock), 0, 0.02, 0).scale.set(1.2, 0.9, 1);
  for (let i = -1; i <= 1; i++) add(b.head, mesh(cone(0.07, 0.3, 4), M(0xffd23f, { metalness: 0.6 })), i * 0.12, 0.3, 0);
  rot(b.armL, -0.3, 0, -0.25);
  rot(b.armR, -0.3, 0, 0.25);
  for (const h of [b.handL, b.handR]) add(h, mesh(sph(0.34, 0), M(stone)), 0, -0.05, 0);
  for (const leg of [b.legL, b.legR]) add(leg, mesh(cyl(0.3, 0.34, 0.5, 6), rock), 0, -0.6, 0);
  const g = grp();
  g.add(b.root);
  g.scale.setScalar(1.25);
  return g;
}

// ------------------------------------------------------------------ buildings

/**
 * Buildings in the darker painted style: weathered stone with carved bands, iron braziers
 * holding a team crystal (icy blue / ember red), cloth banners in the team colour. Tower tiers
 * grow taller and more decorated, so you can tell them apart at a glance.
 */
function structure(tier: StructureTier, team: 0 | 1, rax?: 'melee' | 'ranged'): THREE.Object3D {
  const tc = TEAM_HEX[team];
  const cloth = M(team === 0 ? 0x1f4f9e : 0x9e1f24);
  const clothDark = M(team === 0 ? 0x16386e : 0x6e1619);
  const stone = M(0x8b857a);
  const stone2 = M(0x6a655c);
  const stoneDark = M(0x4c4842);
  const iron = M(0x3a3d42, { metalness: 0.7, roughness: 0.45 });
  const gold = M(0xb08a3a, { metalness: 0.65, roughness: 0.35 });
  const wood = M(0x4a3524);
  const roof = M(0x3a3f47);
  const crystal = glow(team === 0 ? 0x8fd3ff : 0xff7a4a, 2.6);
  const g = grp();
  /** A hanging banner with a gold rod, facing out from the centre at angle a. */
  const banner = (a: number, r: number, y: number, h: number, w = 0.9) => {
    const b = add(g, grp(), Math.cos(a) * r, y, Math.sin(a) * r);
    b.rotation.y = -a + Math.PI / 2;
    add(b, rot(mesh(cyl(0.04, 0.04, w + 0.3, 5), gold), 0, 0, Math.PI / 2), 0, 0, 0);
    add(b, mesh(box(w, h, 0.05), cloth), 0, -h / 2, 0.02);
    add(b, mesh(box(w, 0.08, 0.06), gold), 0, -0.25, 0.03);
    add(b, rot(mesh(cone(w * 0.36, 0.35, 3), clothDark), Math.PI, 0, 0), 0, -h - 0.12, 0.02).scale.set(1.4, 1, 0.15);
    add(b, mesh(new THREE.OctahedronGeometry(0.13), gold), 0, -h * 0.45, 0.06);
  };
  if (tier === 'tower1' || tier === 'tower2' || tier === 'tower3' || tier === 'shrineTower') {
    const lvl = tier === 'tower1' ? 0 : tier === 'tower2' ? 1 : tier === 'tower3' ? 2 : 3;
    const h = 4.8 + lvl * 0.6;
    // Stepped plinth.
    add(g, mesh(cyl(2.25, 2.45, 0.5, 8), stoneDark), 0, 0.25, 0);
    add(g, mesh(cyl(1.95, 2.15, 0.45, 8), stone2), 0, 0.72, 0);
    // Tapered shaft with corner buttresses and carved bands.
    add(g, mesh(cyl(1.15, 1.5, h, 8), stone), 0, 0.95 + h / 2, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      add(g, rot(mesh(box(0.45, h * 0.75, 0.55), stone2), 0.08, -a, 0), Math.cos(a) * 1.35, 0.95 + h * 0.37, Math.sin(a) * 1.35).lookAt(0, 0.95 + h * 0.37, 0);
    }
    for (let i = 0; i <= lvl; i++) add(g, mesh(cyl(1.42 - i * 0.04, 1.42 - i * 0.04, 0.2, 8), stoneDark), 0, 1.6 + (i * h) / (lvl + 2), 0);
    add(g, mesh(cyl(1.3, 1.3, 0.16, 8), gold), 0, 0.95 + h - 0.6, 0);
    // Arrow slits.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      add(g, rot(mesh(box(0.14, 0.7, 0.1), M(0x1a1714)), 0, -a, 0), Math.cos(a) * 1.28, 0.95 + h * 0.6, Math.sin(a) * 1.28);
    }
    // Crenellated top platform.
    const top = 0.95 + h;
    add(g, mesh(cyl(1.75, 1.3, 0.55, 8), stone2), 0, top + 0.27, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(g, mesh(box(0.42, 0.55, 0.42), stone), Math.cos(a) * 1.55, top + 0.82, Math.sin(a) * 1.55);
    }
    // Iron brazier on legs, crystal floating in it.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(g, rot(mesh(cyl(0.06, 0.08, 1.1, 4), iron), Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35), Math.cos(a) * 0.5, top + 0.95, Math.sin(a) * 0.5);
    }
    add(g, mesh(cyl(0.8, 0.45, 0.4, 8), iron), 0, top + 1.5, 0);
    add(g, mesh(new THREE.OctahedronGeometry(0.6), crystal), 0, top + 2.35, 0).scale.set(0.75, 1.45, 0.75);
    // Banners: two on lower tiers, four on the outer gate and shrine towers; spikes on high tiers.
    const nb = lvl >= 2 ? 4 : 2;
    for (let i = 0; i < nb; i++) banner((i / nb) * Math.PI * 2 + Math.PI / 4, 1.62, top - 0.1, 1.6 + lvl * 0.2);
    if (lvl >= 2) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      add(g, mesh(cone(0.1, 0.5, 4), iron), Math.cos(a) * 1.75, top + 1.25, Math.sin(a) * 1.75);
    }
    if (lvl === 3) add(g, mesh(cyl(1.8, 1.8, 0.12, 8), gold), 0, top + 0.56, 0);
  } else if (tier === 'barracks' && rax === 'ranged') {
    // Archers' hall: a round stone keep with a slate cone roof, banners and target dummies.
    add(g, mesh(cyl(2.7, 2.95, 0.5, 10), stoneDark), 0, 0.25, 0);
    add(g, mesh(cyl(2.25, 2.4, 2.8, 10), stone), 0, 1.9, 0);
    add(g, mesh(cyl(2.35, 2.35, 0.2, 10), stone2), 0, 1.2, 0);
    add(g, mesh(cyl(2.55, 2.45, 0.3, 10), stone2), 0, 3.4, 0);
    add(g, mesh(cone(2.9, 2.6, 10), roof), 0, 4.85, 0);
    add(g, mesh(cyl(0.05, 0.05, 1.4, 4), iron), 0, 6.6, 0);
    add(g, rot(mesh(box(0.9, 0.5, 0.04), cloth), 0, 0, 0), 0.45, 7.0, 0);
    add(g, mesh(box(1.1, 1.7, 0.25), wood), 0, 1.35, 2.3);
    add(g, mesh(box(1.3, 0.15, 0.3), stone2), 0, 2.25, 2.32);
    for (const a of [Math.PI * 0.25, Math.PI * 0.75]) banner(a + Math.PI / 2, 2.45, 3.1, 1.5);
    for (const sx of [-1, 1]) {
      const t = add(g, grp(), sx * 3.3, 0, 1.8);
      add(t, mesh(cyl(0.06, 0.06, 1.4, 4), wood), 0, 0.7, 0);
      add(t, rot(mesh(cyl(0.45, 0.45, 0.12, 12), M(0xd6c7a1)), Math.PI / 2, 0, 0), 0, 1.35, 0);
      add(t, rot(mesh(cyl(0.22, 0.22, 0.13, 12), cloth), Math.PI / 2, 0, 0), 0, 1.35, 0.01);
    }
    add(g, mesh(new THREE.OctahedronGeometry(0.3), crystal), 0, 2.6, 2.4);
  } else if (tier === 'barracks') {
    // Soldiers' hall: a long stone hall with buttresses, a slate roof, a big door and banners.
    add(g, mesh(box(5.2, 0.5, 4.6), stoneDark), 0, 0.25, 0);
    add(g, mesh(box(4.6, 2.9, 4.0), stone), 0, 1.95, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, mesh(box(0.55, 3.0, 0.55), stone2), sx * 2.35, 1.8, sz * 2.05);
    // Pitched slate roof: a square beam turned on its edge, half of it sunk into the walls.
    add(g, rot(mesh(box(4.9, 3.1, 3.1), roof), Math.PI / 4, 0, 0), 0, 3.4, 0).scale.set(1, 0.8, 1);
    add(g, rot(mesh(box(4.6, 2.7, 2.7), stone), Math.PI / 4, 0, 0), 0, 3.38, 0).scale.set(1, 0.8, 1);
    add(g, mesh(box(5.0, 0.22, 0.22), stoneDark), 0, 5.15, 0);
    add(g, mesh(box(1.4, 2.0, 0.25), wood), 0, 1.5, 2.05);
    add(g, rot(mesh(cyl(0.7, 0.7, 0.25, 10, ), wood), Math.PI / 2, 0, 0), 0, 2.5, 2.05).scale.set(1, 1, 0.5);
    for (const sx of [-1, 1]) {
      const b = add(g, grp(), sx * 1.55, 3.25, 2.15);
      add(b, rot(mesh(cyl(0.04, 0.04, 1.0, 5), gold), 0, 0, Math.PI / 2), 0, 0, 0);
      add(b, mesh(box(0.8, 1.8, 0.05), cloth), 0, -0.9, 0.02);
      add(b, mesh(new THREE.OctahedronGeometry(0.14), gold), 0, -0.8, 0.06);
    }
    // Shield emblem over the door.
    add(g, mesh(box(0.8, 0.9, 0.1), gold), 0, 3.05, 2.06);
    add(g, mesh(box(0.6, 0.7, 0.12), cloth), 0, 3.05, 2.07);
  } else if (tier === 'shrine') {
    // The Shrine: a stepped stone dais, a ring of pillars with braziers, a great floating crystal.
    add(g, mesh(cyl(5.0, 5.4, 0.7, 12), stoneDark), 0, 0.35, 0);
    add(g, mesh(cyl(4.2, 4.6, 0.6, 12), stone2), 0, 1.0, 0);
    add(g, mesh(cyl(3.2, 3.6, 0.5, 12), stone), 0, 1.5, 0);
    add(g, mesh(new THREE.TorusGeometry(2.6, 0.12, 6, 32), glow(tc, 1.6)), 0, 1.78, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 3.8;
      const z = Math.sin(a) * 3.8;
      add(g, mesh(cyl(0.3, 0.4, 3.8, 6), stone), x, 3.0, z);
      add(g, mesh(cyl(0.45, 0.45, 0.25, 6), stone2), x, 4.95, z);
      add(g, mesh(cyl(0.35, 0.2, 0.3, 6), iron), x, 5.25, z);
      add(g, mesh(sph(0.22, 0), crystal), x, 5.5, z);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(g, rot(mesh(box(0.25, 2.6, 0.25), gold), 0.3 * Math.cos(a), 0, 0.3 * Math.sin(a)), Math.cos(a) * 0.9, 3.0, Math.sin(a) * 0.9);
    }
    add(g, mesh(new THREE.OctahedronGeometry(1.5), crystal), 0, 5.6, 0).scale.set(0.75, 1.9, 0.75);
    for (let i = 0; i < 6; i++) banner((i / 6) * Math.PI * 2 + Math.PI / 6, 4.75, 1.3, 0.9, 0.8);
  } else {
    // Fountain: a round stone basin of glowing water around a crystal on a pillar.
    add(g, mesh(cyl(3.3, 3.5, 0.7, 14), stone2), 0, 0.35, 0);
    add(g, mesh(cyl(3.0, 3.0, 0.1, 14), stoneDark), 0, 0.72, 0);
    add(g, mesh(cyl(2.8, 2.8, 0.12, 14), glow(team === 0 ? 0x3a8fe0 : 0xe05a3a, 1.1)), 0, 0.68, 0);
    add(g, mesh(cyl(0.55, 0.8, 2.4, 8), stone), 0, 1.6, 0);
    add(g, mesh(cyl(0.9, 0.6, 0.35, 8), iron), 0, 2.9, 0);
    add(g, mesh(new THREE.OctahedronGeometry(0.75), crystal), 0, 3.7, 0).scale.set(0.8, 1.4, 0.8);
  }
  return g;
}

function rubble(radius: number): THREE.Object3D {
  const g = grp();
  for (let i = 0; i < 9; i++) {
    const a = i * 2.2;
    const r = radius * (0.2 + (i % 4) * 0.2);
    add(g, rot(mesh(box(0.9, 0.5 + (i % 3) * 0.3, 0.8), M(i % 2 ? 0x6b6b6b : 0x585450)), a, a * 2, 0), Math.cos(a) * r, 0.25, Math.sin(a) * r);
  }
  return g;
}

// ------------------------------------------------------------------ small things

function ward(kind: 'observer' | 'sentry'): THREE.Object3D {
  const g = grp();
  add(g, mesh(cyl(0.05, 0.08, 1.4, 5), M(0x5a3d26)), 0, 0.7, 0);
  add(g, mesh(sph(0.22, 1), glow(kind === 'observer' ? 0xffd23f : 0x60a5fa, 2.5)), 0, 1.55, 0);
  add(g, mesh(new THREE.TorusGeometry(0.28, 0.04, 4, 12), M(0x8a6a3a)), 0, 1.55, 0);
  return g;
}

/**
 * Courier: a small pack mule with saddlebags in the team colour (faces +z). After 6:00 it grows
 * feathered wings and flies. Placeholder look, our own.
 */
function courier(fly: boolean, team: 0 | 1): THREE.Object3D {
  const g = grp();
  const fur = M(0x7a6248);
  const dark = M(0x3b2d22);
  const tc = M(TEAM_HEX[team]);
  add(g, mesh(box(0.55, 0.45, 1.0), fur), 0, 0.75, 0);
  add(g, mesh(box(0.32, 0.34, 0.42), fur), 0, 1.05, 0.62).rotation.x = -0.5;
  add(g, mesh(box(0.26, 0.26, 0.36), fur), 0, 1.12, 0.92);
  add(g, mesh(box(0.2, 0.14, 0.14), dark), 0, 1.06, 1.12);
  for (const sx of [-1, 1]) {
    add(g, mesh(cone(0.06, 0.32, 4), fur), sx * 0.1, 1.36, 0.85).rotation.z = sx * -0.3;
    for (const z of [-0.36, 0.36]) add(g, mesh(cyl(0.06, 0.05, 0.55, 5), dark), sx * 0.2, 0.28, z);
    // Saddlebags.
    add(g, mesh(box(0.14, 0.34, 0.42), tc), sx * 0.34, 0.78, -0.05);
  }
  add(g, mesh(box(0.5, 0.12, 0.6), M(0x5a3d26)), 0, 1.0, -0.05);
  add(g, mesh(cyl(0.03, 0.05, 0.35, 4), dark), 0, 0.85, -0.6).rotation.x = 0.6;
  if (fly) {
    const feather = M(0xe9e4d8);
    for (const sx of [-1, 1]) {
      const wing = add(g, grp(), sx * 0.3, 1.05, 0.05);
      wing.rotation.z = sx * 0.35;
      add(wing, mesh(box(0.9, 0.05, 0.5), feather), sx * 0.45, 0, 0);
      add(wing, mesh(box(0.55, 0.04, 0.35), feather), sx * 1.05, 0.05, -0.08);
    }
  }
  return g;
}

const RUNE_HEX: Record<RuneKind, number> = { haste: 0xff4d4d, regen: 0x4ade80, doubleDamage: 0x60a5fa, invisibility: 0xc4b5fd, bounty: 0xffd23f };
function rune(kind: RuneKind): THREE.Object3D {
  const g = grp();
  add(g, mesh(new THREE.OctahedronGeometry(0.5), glow(RUNE_HEX[kind] ?? 0xffffff, 2.5)), 0, 1.3, 0).scale.set(1, 1.4, 1);
  add(g, mesh(cyl(0.7, 0.8, 0.15, 8), M(0x6b6b6b)), 0, 0.08, 0);
  return g;
}

function shot(kind: string): THREE.Object3D {
  const g = grp();
  if (kind === 'fireball') {
    add(g, mesh(sph(0.45, 1), glow(0xffb347, 3)), 0, 0, 0);
  } else if (kind === 'piercingArrow') {
    add(g, rot(mesh(cyl(0.05, 0.05, 1.6, 4), glow(0xd9fff0, 2)), Math.PI / 2, 0, 0), 0, 0, 0);
    add(g, rot(mesh(cone(0.16, 0.4, 4), glow(0x9fffc8, 3)), Math.PI / 2, 0, 0), 0, 0, 0.95);
  } else if (kind === 'tidalWave') {
    // A curling wall of water with a foam crest, rolling forward (+z).
    add(g, mesh(box(3.2, 0.8, 1.2), glow(0x1fa3c4, 1.3)), 0, 0, -0.2);
    add(g, rot(mesh(cyl(0.55, 0.55, 3.3, 8), glow(0x5fe0f5, 1.5)), 0, 0, Math.PI / 2), 0, 0.55, 0.15);
    for (let i = 0; i < 9; i++) add(g, mesh(sph(0.2 + (i % 2) * 0.06, 0), glow(0xe8fdff, 1.6)), -1.6 + i * 0.4, 1.05, 0.35 + (i % 2) * 0.1);
  } else if (kind === 'arrow' || kind === 'arrowCrit') {
    const crit = kind === 'arrowCrit';
    add(g, rot(mesh(cyl(0.035, 0.035, 1.3, 4), crit ? glow(0x9fffc8, 1.6) : M(0xd8c8a0)), Math.PI / 2, 0, 0), 0, 0, 0);
    add(g, rot(mesh(cone(0.08, 0.26, 4), crit ? glow(0x6dff9e, 3) : M(0xc9d2d8, { metalness: 0.7 })), Math.PI / 2, 0, 0), 0, 0, 0.75);
    for (const s of [-1, 1]) add(g, mesh(box(0.02, 0.14, 0.22), M(0x2f5a3a)), s * 0.03, 0, -0.55);
    if (crit) add(g, mesh(sph(0.3, 1), glow(0x6dff9e, 1.2, 0.35)), 0, 0, 0.6);
  } else if (kind === 'firebolt') {
    add(g, mesh(sph(0.26, 1), glow(0xffd25a, 3)), 0, 0, 0);
    add(g, mesh(sph(0.42, 1), glow(0xff5a1a, 1.5, 0.4)), 0, 0, -0.1);
    add(g, rot(mesh(cone(0.3, 0.9, 6), glow(0xff7a2a, 1.6, 0.5)), -Math.PI / 2, 0, 0), 0, 0, -0.55);
  } else if (kind === 'waterbolt') {
    add(g, mesh(sph(0.24, 1), glow(0x9ff0ff, 2)), 0, 0, 0);
    add(g, mesh(sph(0.38, 1), glow(0x1fa3c4, 1.3, 0.45)), 0, 0, -0.08);
    add(g, mesh(new THREE.TorusGeometry(0.34, 0.03, 4, 16), glow(0xe8fdff, 1.5, 0.7)), 0, 0, 0);
  } else if (kind === 'spell') {
    add(g, mesh(sph(0.4, 1), glow(0xffb347, 3)), 0, 0, 0);
  } else {
    // Tower bolt: a spinning crystal shard in the team's colour with a soft halo.
    const c = kind === 'shot0' ? 0x8fd3ff : 0xff7a4a;
    add(g, mesh(new THREE.OctahedronGeometry(0.28), glow(c, 3)), 0, 0, 0).scale.set(0.7, 0.7, 1.8);
    add(g, mesh(sph(0.5, 1), glow(c, 1.3, 0.35)), 0, 0, -0.1);
  }
  return g;
}
