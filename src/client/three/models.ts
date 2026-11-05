import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HeroId, RuneKind, StructureTier } from '../../sim';
import { HERO_BUILDERS, M, add, redWolf, wolf, box, cloth, cone, cyl, glow, grp, hood, humanoid, lathe, lumpy, mesh, resetFx, rot, skirt, sph, taper } from './hero-models';

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
export function bake(top: THREE.Object3D, finish: Finish = FINISH.unit): THREE.Group {
  top.updateMatrixWorld(true);
  // Height range of the whole model, for the grime that climbs up from the ground.
  let minY = Infinity;
  let maxY = -Infinity;
  top.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !isShown(m)) return;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    minY = Math.min(minY, b.min.y);
    maxY = Math.max(maxY, b.max.y);
  });
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
    g.userData.worldFromJoint = j.matrixWorld;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const glowing = mat.emissive && mat.emissiveIntensity > 0.5 && mat.emissive.getHex() !== 0;
    const c = (glowing ? mat.emissive : mat.color).clone();
    if (glowing) c.multiplyScalar(Math.min(1.6, 0.6 + mat.emissiveIntensity * 0.3));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const clear = mat.transparent && mat.opacity < 0.9;
    if (clear) for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    else if (glowing) {
      // Facets catch the light differently, so a gem reads as a solid gem and not a flat shape.
      const nor = g.attributes.normal;
      const lit = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const k = 0.42 + 0.78 * Math.max(0, nor.getX(i) * 0.5 + nor.getY(i) * 0.62 + nor.getZ(i) * 0.6);
        lit.copy(c).multiplyScalar(k).toArray(col, i * 3);
      }
    }
    else paintFinish(g, c, col, finish, minY, maxY);
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
      if (material === LIT) softenNormals(merged, finish.soft ?? 0.62);
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

/**
 * The shared paint finish. Every model goes through this, which is what makes heroes, creeps,
 * monsters and buildings belong to the same painted world as the map: muted colours, blotchy
 * hand-painted variation, grime climbing up from the ground and (buildings) moss on upward faces.
 */
export interface Finish {
  /** 0 = colours as modelled, 1 = grey. */
  mute: number;
  /** Overall brightness. */
  value: number;
  /** How strong the hand-painted blotches are. */
  blotch: number;
  /** How dark the model gets where it meets the ground, and how far up that reaches (0–1 of its height). */
  grime: number;
  grimeHeight: number;
  /** Moss on upward faces (0 = none). */
  moss: number;
  /** How soft the shading is, 0 = hard facets (chiselled stone) to 1 = fully smooth. */
  soft?: number;
}
export const FINISH = {
  hero: { mute: 0.14, value: 0.95, blotch: 0.1, grime: 0.34, grimeHeight: 0.3, moss: 0 },
  unit: { mute: 0.24, value: 0.86, blotch: 0.14, grime: 0.4, grimeHeight: 0.35, moss: 0 },
  monster: { mute: 0.1, value: 0.86, blotch: 0.2, grime: 0.42, grimeHeight: 0.4, moss: 0.14 },
  stone: { mute: 0.1, value: 1, blotch: 0.2, grime: 0.42, grimeHeight: 0.4, moss: 0.1, soft: 0.12 },
  building: { mute: 0.12, value: 1, blotch: 0.24, grime: 0.55, grimeHeight: 0.3, moss: 0.5 },
} satisfies Record<string, Finish>;

const MOSS = new THREE.Color(0x2e3d1f);
/** Smooth, position-based value that varies over about a meter (the same on every model). */
function blotchAt(x: number, y: number, z: number): number {
  return 0.5 + 0.25 * Math.sin(x * 2.3 + y * 1.7) * Math.cos(z * 2.1 - y * 1.3) + 0.25 * Math.sin(x * 5.1 - z * 4.3 + y * 3.7);
}
function paintFinish(g: THREE.BufferGeometry, base: THREE.Color, col: Float32Array, f: Finish, minY: number, maxY: number) {
  const lum = base.r * 0.3 + base.g * 0.59 + base.b * 0.11;
  const muted = base.clone().lerp(new THREE.Color(lum, lum, lum), f.mute).multiplyScalar(f.value);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const c = new THREE.Color();
  // Positions are in the joint's space by now; the grime and blotches work in the whole model's.
  const toModel = g.userData.worldFromJoint as THREE.Matrix4 | undefined;
  const v = new THREE.Vector3();
  const span = Math.max(0.001, maxY - minY);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (toModel) v.applyMatrix4(toModel);
    const h = (v.y - minY) / span;
    const shade = 1 + (blotchAt(v.x, v.y, v.z) - 0.5) * 2 * f.blotch;
    const t = Math.min(1, h / f.grimeHeight);
    const grime = 1 - f.grime * (1 - t * t * (3 - 2 * t));
    c.copy(muted).multiplyScalar(shade * grime);
    if (f.moss > 0 && n.getY(i) > 0.55) {
      const patch = Math.max(0, blotchAt(v.x * 1.6 + 3, v.y, v.z * 1.6 - 2) - 0.48) * 3.4;
      c.lerp(MOSS, Math.min(0.85, patch * f.moss * (1.25 - h * 0.6)));
    }
    c.toArray(col, i * 3);
  }
}

/**
 * Half-way between hard facets and fully smooth: corners stay readable but light rolls softly
 * around them, the way a painted surface looks. Points at the same place share their direction.
 */
function softenNormals(g: THREE.BufferGeometry, amount = 0.62) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const sum = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${Math.round(p.getX(i) * 200)},${Math.round(p.getY(i) * 200)},${Math.round(p.getZ(i) * 200)}`;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    tmp.fromBufferAttribute(n, i);
    const s = sum.get(k);
    if (s) s.add(tmp);
    else sum.set(k, tmp.clone());
  }
  for (const s of sum.values()) s.normalize();
  const out = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    out.fromBufferAttribute(n, i).lerp(sum.get(key(i))!, amount).normalize();
    n.setXYZ(i, out.x, out.y, out.z);
  }
}

const LIT = new THREE.MeshLambertMaterial({ vertexColors: true });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
const CLEAR = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false });

// ------------------------------------------------------------------ catalogue

const cache = new Map<string, THREE.Group>();
/** A fresh copy of a model (geometry and materials are shared between copies). */
export function model(key: string): THREE.Group {
  let t = cache.get(key);
  if (!t) {
    t = bake(build(key), finishOf(key));
    cache.set(key, t);
  }
  return t.clone();
}

function finishOf(key: string): Finish {
  const kind = key.split(':')[0];
  if (kind === 'hero') return FINISH.hero;
  if (kind === 'structure' || kind === 'rubble') return FINISH.building;
  if (kind === 'warden') return FINISH.stone;
  if (kind === 'brute' || kind === 'imp' || kind === 'wolf' || kind === 'redwolf') return FINISH.monster;
  return FINISH.unit;
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
    case 'wolf':
      return wolf(Number(a) as 0 | 1);
    case 'redwolf':
      return redWolf(Number(a) as 0 | 1);
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
  const b = humanoid({ skin: 0xb89272, cloth: dark, cloth2: 0x2e2a26, boots: 0x221e1a, hip: 0.8, slim: 0.9, sculpt: true, lite: true });
  const steel = M(0x7c848d, { metalness: 0.65, roughness: 0.4 });
  const iron = M(0x3f4349, { metalness: 0.6 });
  const leather = M(0x4a3524);
  const team1 = M(tc);
  if (type === 'melee') {
    // Rounded helm with a nose guard, breastplate, team tabard.
    add(b.head, mesh(lathe([[0.001, 0.27], [0.12, 0.23], [0.215, 0.1], [0.235, -0.02], [0.215, -0.07]], 8), steel), 0, 0, 0);
    add(b.head, mesh(box(0.05, 0.2, 0.05), iron), 0, -0.01, 0.215);
    add(b.torso, mesh(lathe([[0.235, 0.22], [0.3, 0.46], [0.315, 0.56], [0.2, 0.68]], 8), steel), 0, 0, 0).scale.set(1, 1, 0.78);
    add(b.torso, mesh(cloth(0.3, 0.72, 1, 3, (_x, y) => [0, 0, (1 - y) * 0.07]), team1), 0, -0.05, 0.215);
    for (const arm of [b.armL, b.armR]) add(arm, mesh(new THREE.SphereGeometry(0.15, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), iron), 0, 0.03, 0).scale.set(1.15, 0.75, 1.05);
    // Short sword with a guard.
    const w = add(b.armR, grp(), 0, -0.62, 0.02);
    w.name = 'weapon';
    add(w, mesh(cyl(0.024, 0.028, 0.15, 5), leather), 0, 0, 0);
    add(w, mesh(box(0.22, 0.035, 0.05), iron), 0, 0.09, 0);
    add(w, mesh(lathe([[0.001, 0.92], [0.038, 0.8], [0.042, 0.1]], 4), steel), 0, 0, 0).scale.set(1, 1, 0.3);
    rot(w, 0.6, 0, 0);
    rot(b.armR, -0.35, 0, 0.08);
    // Round shield in the team colour with an iron rim and boss.
    const sh = add(b.armL, grp(), 0.02, -0.45, 0.14);
    add(sh, rot(mesh(lathe([[0.001, 0.05], [0.26, 0.03], [0.33, -0.015]], 9), team1), Math.PI / 2, 0, 0), 0, 0, 0);
    add(sh, mesh(new THREE.TorusGeometry(0.335, 0.025, 4, 12), iron), 0, 0, -0.015);
    add(sh, mesh(sph(0.075, 0), steel), 0, 0, 0.05);
    rot(b.armL, -0.6, 0, -0.15);
  } else {
    // Casters: hooded robe with team bands and a crystal staff.
    add(b.root, mesh(skirt(0.21, 0.44, 0.86, 6, 0.08, 12), M(dark)), 0, 0, 0);
    b.legL.visible = b.legR.visible = false;
    hood(b.head, 0.25, M(dark), M(0x0c0a0a), 0.58, 0.3);
    add(b.torso, mesh(lathe([[0.22, 0.1], [0.24, 0.3], [0.29, 0.52], [0.18, 0.66]], 8), M(dark)), 0, 0, 0).scale.set(1, 1, 0.82);
    add(b.torso, mesh(cloth(0.09, 0.56, 1, 2, () => [0, 0, 0]), team1), 0, 0.36, 0.23);
    for (const arm of [b.armL, b.armR]) add(arm, mesh(lathe([[0.09, 0], [0.1, -0.2], [0.14, -0.5], [0.15, -0.55]], 7), M(dark)), 0, 0, 0);
    const w = add(b.armR, grp(), 0, -0.62, 0.02);
    w.name = 'weapon';
    add(w, mesh(taper([[0, -0.45, 0], [0.015, 0.3, 0], [0, 1.03, 0]], 0.028, 0.038, 6, 5), M(0x3d2819)), 0, 0, 0);
    add(w, mesh(new THREE.OctahedronGeometry(0.11), glow(team === 0 ? 0x62aef0 : 0xf07a5a, 2.3)), 0, 1.13, 0).scale.set(1, 1.5, 1);
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
  const skin = 0x665745;
  const b = humanoid({ skin, cloth: 0x4a3d30, cloth2: 0x3a3028, boots: 0x2e251d, bulk: 1.5, hip: 0.7, torsoH: 0.75, eyes: 0xffb347, sculpt: true, lite: true });
  const hide = M(0x4e3b28);
  b.torso.rotation.x = 0.35;
  // Heavy chest and belly, a hump of hair and a hide loincloth.
  add(b.torso, mesh(lathe([[0.42, 0.1], [0.46, 0.28], [0.58, 0.55], [0.6, 0.68], [0.4, 0.85]], 10), M(skin)), 0, 0, 0.03).scale.set(1, 1, 0.85);
  add(b.torso, mesh(cloth(0.62, 0.48, 3, 3, (x, y) => [0, 0, (1 - y) * 0.08 + Math.sin(x * 9) * 0.015]), hide), 0, -0.16, 0.32);
  add(b.torso, mesh(lumpy(new THREE.IcosahedronGeometry(0.32, 1), 0.2, 2), M(0x4a3d2e)), 0, 0.74, -0.2).scale.set(1.5, 0.72, 1);
  for (const s of [-1, 1]) {
    add(b.head, mesh(taper([[s * 0.1, -0.12, 0.17], [s * 0.15, -0.08, 0.28], [s * 0.13, 0.12, 0.31]], 0.05, 0.006, 5, 5), M(0xbdb092)), 0, 0, 0);
    add(b.head, mesh(taper([[s * 0.18, 0.12, 0], [s * 0.3, 0.22, 0.02], [s * 0.34, 0.36, 0]], 0.05, 0.006, 4, 4), M(0xa89c80)), 0, 0, 0);
  }
  add(b.head, mesh(taper([[-0.17, 0.09, 0.14], [0, 0.11, 0.21], [0.17, 0.09, 0.14]], 0.05, 0.05, 5, 4), M(0x4e4236)), 0, 0, 0);
  // Knotted club studded with iron.
  const w = add(b.armR, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  add(w, mesh(lumpy(lathe([[0.075, -0.05], [0.09, 0.3], [0.17, 0.72], [0.15, 0.96], [0.03, 1.02]], 8), 0.06, 3), M(0x43301f)), 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(w, rot(mesh(cone(0.04, 0.16, 4), M(0x70757a, { metalness: 0.6 })), 0, 0, Math.PI / 2), Math.cos(a) * 0.16, 0.7 + (i % 2) * 0.14, Math.sin(a) * 0.16).lookAt(Math.cos(a) * 2, 0.8, Math.sin(a) * 2);
  }
  rot(w, 0.4, 0, 0);
  rot(b.armL, -0.3, 0, -0.2);
  rot(b.armR, -0.3, 0, 0.2);
  return b.root;
}

/** Jungle goblin: small, wiry, long ears, a crude spear ('weapon'). */
function imp(): THREE.Object3D {
  const skin = 0x667f44;
  const b = humanoid({ skin, cloth: 0x5a4226, cloth2: 0x3e3020, boots: 0x2e251d, hip: 0.55, torsoH: 0.5, slim: 0.8, eyes: 0xffe066, sculpt: true, lite: true });
  for (const s of [-1, 1]) add(b.head, mesh(taper([[s * 0.17, 0.03, -0.01], [s * 0.33, 0.1, -0.04], [s * 0.5, 0.2, -0.08]], 0.075, 0.006, 5, 4), M(skin)), 0, 0, 0).scale.set(1, 1, 0.5);
  add(b.head, mesh(taper([[0, 0, 0.19], [0, -0.03, 0.29], [0, -0.07, 0.34]], 0.05, 0.008, 3, 4), M(0x5a7338)), 0, 0, 0);
  add(b.torso, mesh(cloth(0.34, 0.42, 2, 2, (_x, y) => [0, 0, (1 - y) * 0.05]), M(0x4a3620)), 0, 0.17, 0.17);
  add(b.torso, mesh(lathe([[0.19, -0.03], [0.21, 0.05], [0.19, 0.09]], 8), M(0x2e2214)), 0, 0, 0).scale.set(1, 1, 0.8);
  const w = add(b.armR, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  add(w, mesh(taper([[0, -0.35, 0], [0.012, 0.3, 0], [0, 0.97, 0]], 0.022, 0.02, 5, 4), M(0x4e3522)), 0, 0, 0);
  add(w, mesh(lathe([[0.001, 1.2], [0.052, 1.02], [0.018, 0.94]], 4), M(0x7f8084, { metalness: 0.5 })), 0, 0, 0).scale.set(1, 1, 0.4);
  rot(b.armR, -0.6, 0, 0.1);
  rot(w, 0.9, 0, 0);
  return b.root;
}

/** The Warden: a towering stone golem with violet crystals growing from its back and shoulders. */
function warden(): THREE.Object3D {
  const stone = 0x4b4560;
  const b = humanoid({ skin: stone, cloth: 0x3b3550, cloth2: 0x332e45, boots: 0x2a2638, bulk: 1.9, hip: 1.0, torsoH: 1.0, eyes: 0xd8b4fe, sculpt: true });
  const crystal = glow(0xa78bfa, 2.2);
  const rock = M(0x3e3952);
  const slab = (r: number, seed: number) => lumpy(new THREE.DodecahedronGeometry(r, 0), 0.08, seed);
  // Chest of fitted stone slabs.
  add(b.torso, mesh(slab(0.74, 3), M(stone)), 0, 0.6, 0).scale.set(1.05, 0.92, 0.76);
  add(b.torso, mesh(slab(0.32, 5), rock), -0.24, 0.72, 0.42).scale.set(1, 0.72, 0.5);
  add(b.torso, mesh(slab(0.32, 6), rock), 0.26, 0.74, 0.42).scale.set(1, 0.7, 0.5);
  add(b.torso, mesh(slab(0.4, 7), rock), 0, 0.14, 0.2).scale.set(1.25, 0.7, 0.85);
  add(b.torso, mesh(new THREE.OctahedronGeometry(0.18), crystal), 0, 0.5, 0.58).scale.set(0.8, 1.3, 0.4);
  for (const s of [-1, 1]) {
    add(b.torso, rot(mesh(new THREE.OctahedronGeometry(0.34), crystal), 0, 0, s * 0.4), s * 0.78, 1.28, 0).scale.set(0.6, 1.6, 0.6);
    add(b.torso, rot(mesh(new THREE.OctahedronGeometry(0.24), crystal), 0.3, 0, s * 0.7), s * 0.55, 1.34, -0.28).scale.set(0.6, 1.5, 0.6);
    add(b.torso, rot(mesh(new THREE.OctahedronGeometry(0.28), crystal), -0.4, 0, s * 0.3), s * 0.3, 1.1, -0.56).scale.set(0.6, 1.7, 0.6);
  }
  for (const arm of [b.armL, b.armR]) {
    add(arm, mesh(slab(0.36, 2), rock), 0, 0.05, 0).scale.set(1.2, 0.9, 1.1);
    add(arm, mesh(slab(0.25, 4), rock), 0, -0.34, 0).scale.set(1, 1.3, 1);
  }
  add(b.head, mesh(slab(0.31, 8), rock), 0, 0.02, 0).scale.set(1.2, 0.9, 1);
  add(b.head, mesh(new THREE.TorusGeometry(0.24, 0.035, 5, 14), M(0x7c6130, { metalness: 0.6 })), 0, 0.14, 0).rotation.x = Math.PI / 2;
  for (let i = -1; i <= 1; i++) add(b.head, mesh(taper([[i * 0.13, 0.16, 0.1], [i * 0.15, 0.3, 0.11], [i * 0.16, 0.44 - Math.abs(i) * 0.07, 0.1]], 0.05, 0.005, 3, 4), M(0x96753a, { metalness: 0.6 })), 0, 0, 0);
  rot(b.armL, -0.3, 0, -0.25);
  rot(b.armR, -0.3, 0, 0.25);
  for (const h of [b.handL, b.handR]) add(h, mesh(slab(0.36, 9), M(stone)), 0, -0.05, 0);
  for (const leg of [b.legL, b.legR]) {
    add(leg, mesh(slab(0.34, 3), rock), 0, -0.3, 0).scale.set(1, 1.1, 1);
    add(leg, mesh(slab(0.36, 5), rock), 0, -0.74, 0.05).scale.set(1, 0.85, 1.15);
  }
  const g = grp();
  g.add(b.root);
  g.scale.setScalar(1.25);
  return g;
}

// ------------------------------------------------------------------ buildings

/** Small repeatable random number from any numbers (same building, same stones, every match). */
const hash = (a: number, b = 0, c = 0) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Buildings: real stonework in the same weathered stone as the map's walls and river stones,
 * slate roofs, dark timber and tarnished bronze. The only bright things are the team's crystal and
 * banners, so a building's team reads at a glance. Tower tiers grow taller and more decorated.
 */
function structure(tier: StructureTier, team: 0 | 1, rax?: 'melee' | 'ranged'): THREE.Object3D {
  const tc = TEAM_HEX[team];
  const cloth = M(team === 0 ? 0x234f96 : 0x96272b);
  const clothDark = M(team === 0 ? 0x16335f : 0x5f1a1d);
  const stones = [0x6a665c, 0x5c584f, 0x757065, 0x524f47].map((c) => M(c));
  const stone2 = M(0x4c4942);
  const stoneDark = M(0x322f2a);
  const iron = M(0x26282b, { metalness: 0.7, roughness: 0.45 });
  const bronze = M(0x7c6130, { metalness: 0.65, roughness: 0.4 });
  const wood = M(0x35261a);
  const slate = [0x2c3036, 0x26292e, 0x33373d].map((c) => M(c));
  const crystal = glow(team === 0 ? 0x4fa8f0 : 0xf0602e, 2.2);
  const g = grp();
  const stoneAt = (k: number) => stones[Math.floor(hash(k, 3) * stones.length)];

  /** One course of stones around a circle. */
  const ring = (y: number, h: number, r: number, count: number, seed: number, depth = 0.34) => {
    for (let i = 0; i < count; i++) {
      const a = ((i + (seed % 2) * 0.5) / count) * Math.PI * 2;
      const w = ((Math.PI * 2 * r) / count) * (0.93 + hash(seed, i) * 0.09);
      const out = (hash(seed, i, 2) - 0.5) * 0.07;
      add(g, rot(mesh(box(w, h * (0.92 + hash(seed, i, 3) * 0.07), depth), stoneAt(seed * 31 + i)), 0, -a + Math.PI / 2, 0), Math.cos(a) * (r + out), y + h / 2, Math.sin(a) * (r + out));
    }
  };
  /** A round wall built up from courses of stone, on a dark core so no gaps show through. */
  const masonry = (y0: number, height: number, r0: number, r1: number, courses: number, count: number, seed: number) => {
    add(g, mesh(cyl(r1 - 0.14, r0 - 0.14, height, count), stoneDark), 0, y0 + height / 2, 0);
    const h = height / courses;
    for (let c = 0; c < courses; c++) ring(y0 + c * h, h, r0 + (r1 - r0) * ((c + 0.5) / courses), count, seed + c);
  };
  /** A straight wall of stone courses, x0→x1 at depth z (or along z when `sideways`). */
  const wall = (x0: number, x1: number, z: number, y0: number, height: number, courses: number, seed: number, sideways = false) => {
    const h = height / courses;
    for (let c = 0; c < courses; c++) {
      let x = x0 - (c % 2 ? 0.35 : 0);
      let i = 0;
      while (x < x1 - 0.02) {
        const w = Math.min(x1 - x, 0.62 + hash(seed, c, i) * 0.55);
        const left = Math.max(x, x0);
        const width = x + w - left;
        if (width > 0.05) {
          const mid = left + width / 2;
          const stoneBox = box(sideways ? 0.3 : width - 0.03, h * 0.95, sideways ? width - 0.03 : 0.3);
          const stick = (hash(seed, c, i + 40) - 0.5) * 0.06;
          add(g, mesh(stoneBox, stoneAt(seed * 17 + c * 7 + i)), sideways ? z + stick : mid, y0 + c * h + h / 2, sideways ? mid : z + stick);
        }
        x += w;
        i++;
      }
    }
  };
  /** A cone roof as overlapping rows of slates. */
  const roofCone = (y: number, r: number, height: number, rows: number, seg: number) => {
    for (let i = 0; i < rows; i++) {
      const t0 = i / rows;
      const t1 = (i + 1) / rows;
      const rowH = (height / rows) * 1.28;
      add(g, mesh(new THREE.CylinderGeometry(r * (1 - t1) + 0.03, r * (1 - t0) + 0.1, rowH, seg, 1, true), slate[i % slate.length]), 0, y + height * t0 + rowH / 2, 0);
    }
    add(g, mesh(cone(0.16, 0.45, 6), iron), 0, y + height + 0.12, 0);
  };
  /** Loose stones around the foot of a building, so it grows out of the ground. */
  const footing = (r: number, count: number, seed: number) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + hash(seed, i) * 0.5;
      const s = 0.2 + hash(seed, i, 1) * 0.3;
      add(g, rot(mesh(sph(s, 0), i % 3 ? stone2 : stoneDark), hash(seed, i, 2) * 3, hash(seed, i, 3) * 3, 0), Math.cos(a) * r, s * 0.4, Math.sin(a) * r).scale.set(1.25, 0.7, 1);
    }
  };
  /** A hanging banner on a bronze rod, facing out from the centre at angle a. */
  const banner = (a: number, r: number, y: number, h: number, w = 0.9) => {
    const b = add(g, grp(), Math.cos(a) * r, y, Math.sin(a) * r);
    b.rotation.y = -a + Math.PI / 2;
    add(b, rot(mesh(cyl(0.035, 0.035, w + 0.25, 5), bronze), 0, 0, Math.PI / 2), 0, 0, 0);
    add(b, mesh(box(w, h, 0.05), cloth), 0, -h / 2, 0.02);
    add(b, mesh(box(w * 0.7, 0.06, 0.06), bronze), 0, -h * 0.2, 0.03);
    add(b, rot(mesh(cone(w * 0.36, 0.32, 3), clothDark), Math.PI, 0, 0), 0, -h - 0.1, 0.02).scale.set(1.4, 1, 0.15);
    add(b, mesh(new THREE.OctahedronGeometry(0.11), bronze), 0, -h * 0.5, 0.06);
  };

  if (tier === 'tower1' || tier === 'tower2' || tier === 'tower3' || tier === 'shrineTower') {
    const lvl = tier === 'tower1' ? 0 : tier === 'tower2' ? 1 : tier === 'tower3' ? 2 : 3;
    const h = 4.8 + lvl * 0.6;
    // Stepped plinth with loose stones around it.
    add(g, mesh(cyl(2.2, 2.45, 0.5, 12), stoneDark), 0, 0.25, 0);
    add(g, mesh(cyl(1.92, 2.12, 0.45, 12), stone2), 0, 0.72, 0);
    footing(2.55, 9, lvl + 1);
    // Tapered shaft of stone courses, with a band of darker stone for each tier.
    masonry(0.95, h, 1.5, 1.12, 6 + lvl, 12, lvl * 11 + 2);
    for (let i = 0; i <= lvl; i++) add(g, mesh(cyl(1.47 - i * 0.05, 1.5 - i * 0.05, 0.16, 12), stone2), 0, 1.65 + (i * h) / (lvl + 2), 0);
    add(g, mesh(cyl(1.32, 1.32, 0.12, 12), bronze), 0, 0.95 + h - 0.6, 0);
    // Arrow slits.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      add(g, rot(mesh(box(0.15, 0.72, 0.12), M(0x0f0d0b)), 0, -a + Math.PI / 2, 0), Math.cos(a) * 1.36, 0.95 + h * 0.6, Math.sin(a) * 1.36);
    }
    // Overhanging top with battlements.
    const top = 0.95 + h;
    add(g, mesh(cyl(1.78, 1.28, 0.55, 12), stone2), 0, top + 0.27, 0);
    add(g, mesh(cyl(1.5, 1.5, 0.05, 12), stoneDark), 0, top + 0.56, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      add(g, rot(mesh(box(0.5, 0.46 + hash(lvl, i) * 0.14, 0.34), stoneAt(i + lvl * 5)), 0, -a + Math.PI / 2, 0), Math.cos(a) * 1.58, top + 0.8, Math.sin(a) * 1.58);
    }
    // Iron brazier on legs, crystal floating in it.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(g, rot(mesh(cyl(0.05, 0.07, 1.1, 4), iron), Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35), Math.cos(a) * 0.5, top + 0.95, Math.sin(a) * 0.5);
    }
    add(g, mesh(cyl(0.78, 0.45, 0.4, 10), iron), 0, top + 1.5, 0);
    add(g, mesh(new THREE.OctahedronGeometry(0.6), crystal), 0, top + 2.35, 0).scale.set(0.75, 1.45, 0.75);
    // Banners: two on lower tiers, four on the gate and shrine towers; iron spikes on high tiers.
    const nb = lvl >= 2 ? 4 : 2;
    for (let i = 0; i < nb; i++) banner((i / nb) * Math.PI * 2 + Math.PI / 4, 1.66, top - 0.1, 1.6 + lvl * 0.2);
    if (lvl >= 2) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      add(g, mesh(cone(0.08, 0.5, 4), iron), Math.cos(a) * 1.75, top + 1.25, Math.sin(a) * 1.75);
    }
    if (lvl === 3) add(g, mesh(new THREE.TorusGeometry(1.8, 0.07, 5, 24), bronze), 0, top + 0.56, 0).rotation.x = Math.PI / 2;
  } else if (tier === 'barracks' && rax === 'ranged') {
    // Archers' hall: a round stone keep with a slate roof, banners and target dummies.
    add(g, mesh(cyl(2.7, 2.95, 0.5, 14), stoneDark), 0, 0.25, 0);
    footing(3.0, 12, 21);
    masonry(0.5, 2.75, 2.42, 2.28, 5, 16, 23);
    add(g, mesh(cyl(2.58, 2.46, 0.3, 14), stone2), 0, 3.4, 0);
    roofCone(3.5, 2.95, 2.75, 5, 14);
    add(g, mesh(cyl(0.04, 0.04, 1.3, 4), iron), 0, 6.75, 0);
    add(g, mesh(box(0.85, 0.48, 0.04), cloth), 0.45, 7.05, 0);
    add(g, mesh(box(1.14, 1.75, 0.3), wood), 0, 1.38, 2.42);
    for (const sx of [-1, 1]) add(g, mesh(box(0.2, 1.95, 0.42), stone2), sx * 0.67, 1.45, 2.4);
    add(g, mesh(box(1.55, 0.24, 0.42), stone2), 0, 2.4, 2.42);
    for (const a of [Math.PI * 0.25, Math.PI * 0.75]) banner(a + Math.PI / 2, 2.56, 3.15, 1.5);
    for (const sx of [-1, 1]) {
      const t = add(g, grp(), sx * 3.3, 0, 1.8);
      add(t, mesh(cyl(0.05, 0.06, 1.4, 4), wood), 0, 0.7, 0);
      add(t, rot(mesh(cyl(0.44, 0.44, 0.12, 12), M(0x8f8467)), Math.PI / 2, 0, 0), 0, 1.35, 0);
      add(t, rot(mesh(cyl(0.21, 0.21, 0.13, 12), cloth), Math.PI / 2, 0, 0), 0, 1.35, 0.01);
    }
    add(g, mesh(new THREE.OctahedronGeometry(0.28), crystal), 0, 2.85, 2.62);
  } else if (tier === 'barracks') {
    // Soldiers' hall: long stone walls, timber posts, a slate roof, a big door and banners.
    add(g, mesh(box(5.2, 0.5, 4.6), stoneDark), 0, 0.25, 0);
    footing(3.05, 14, 31);
    add(g, mesh(box(4.3, 2.9, 3.7), stoneDark), 0, 1.95, 0);
    wall(-2.3, 2.3, 2.0, 0.5, 2.85, 6, 33);
    wall(-2.3, 2.3, -2.0, 0.5, 2.85, 6, 34);
    wall(-2.0, 2.0, -2.3, 0.5, 2.85, 6, 35, true);
    wall(-2.0, 2.0, 2.3, 0.5, 2.85, 6, 36, true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, mesh(box(0.55, 3.05, 0.55), stone2), sx * 2.36, 1.85, sz * 2.06);
    // Gable ends: stone triangles under the roof.
    for (const sx of [-1, 1]) add(g, rot(mesh(cyl(2.0, 2.0, 0.3, 3), stone2), 0, 0, Math.PI / 2), sx * 2.2, 3.72, 0).scale.set(0.75, 1, 1);
    // Pitched roof: rows of slates on both sides, a ridge beam on top.
    const rows = 6;
    const slope = Math.atan2(1.75, 2.45);
    for (const side of [-1, 1]) {
      for (let i = 0; i < rows; i++) {
        const t = (i + 0.5) / rows;
        const z = side * (2.5 - t * 2.45);
        const y = 3.28 + t * 1.75;
        add(g, rot(mesh(box(5.0 - (i % 2) * 0.1, 0.1, 3.02 / rows + 0.14), slate[i % slate.length]), side * slope, 0, 0), 0, y, z);
      }
    }
    add(g, mesh(box(5.1, 0.2, 0.28), wood), 0, 5.12, 0);
    // Door with a stone arch.
    add(g, mesh(box(1.4, 2.0, 0.25), wood), 0, 1.5, 2.13);
    add(g, rot(mesh(cyl(0.7, 0.7, 0.25, 12), wood), Math.PI / 2, 0, 0), 0, 2.5, 2.13).scale.set(1, 1, 0.5);
    for (const sx of [-1, 1]) add(g, mesh(box(0.24, 2.15, 0.36), stone2), sx * 0.83, 1.58, 2.14);
    add(g, mesh(box(1.9, 0.26, 0.38), stone2), 0, 2.72, 2.14);
    for (const y of [1.0, 1.9]) add(g, mesh(box(1.32, 0.07, 0.06), iron), 0, y, 2.27);
    for (const sx of [-1, 1]) {
      const b = add(g, grp(), sx * 1.62, 3.05, 2.2);
      add(b, rot(mesh(cyl(0.035, 0.035, 0.95, 5), bronze), 0, 0, Math.PI / 2), 0, 0, 0);
      add(b, mesh(box(0.74, 1.7, 0.05), cloth), 0, -0.85, 0.02);
      add(b, mesh(new THREE.OctahedronGeometry(0.13), bronze), 0, -0.75, 0.06);
    }
  } else if (tier === 'shrine') {
    // The Shrine: a stepped stone dais, a ring of pillars with braziers, a great floating crystal.
    add(g, mesh(cyl(5.0, 5.4, 0.7, 18), stoneDark), 0, 0.35, 0);
    footing(5.5, 18, 41);
    ring(0.7, 0.6, 4.35, 22, 43, 0.7);
    add(g, mesh(cyl(4.0, 4.4, 0.58, 18), stone2), 0, 1.0, 0);
    ring(1.28, 0.46, 3.32, 18, 44, 0.6);
    add(g, mesh(cyl(3.05, 3.4, 0.46, 18), stone2), 0, 1.5, 0);
    add(g, mesh(new THREE.TorusGeometry(2.6, 0.1, 6, 36), glow(tc, 1.5)), 0, 1.76, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 3.8;
      const z = Math.sin(a) * 3.8;
      // Pillar of stacked drums, a little uneven.
      for (let d = 0; d < 5; d++) {
        const r = 0.4 - d * 0.02;
        add(g, rot(mesh(cyl(r - 0.02, r, 0.74, 8), stoneAt(i * 7 + d)), 0, hash(i, d) * 3, 0), x + (hash(i, d, 1) - 0.5) * 0.05, 1.5 + d * 0.74 + 0.37, z + (hash(i, d, 2) - 0.5) * 0.05);
      }
      add(g, mesh(cyl(0.5, 0.42, 0.25, 8), stone2), x, 5.3, z);
      add(g, mesh(cyl(0.35, 0.2, 0.3, 8), iron), x, 5.58, z);
      add(g, mesh(sph(0.22, 0), crystal), x, 5.85, z);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(g, rot(mesh(box(0.22, 2.6, 0.22), bronze), 0.3 * Math.cos(a), 0, 0.3 * Math.sin(a)), Math.cos(a) * 0.9, 3.0, Math.sin(a) * 0.9);
    }
    add(g, mesh(new THREE.OctahedronGeometry(1.5), crystal), 0, 5.6, 0).scale.set(0.75, 1.9, 0.75);
    for (let i = 0; i < 6; i++) banner((i / 6) * Math.PI * 2 + Math.PI / 6, 4.75, 1.25, 0.85, 0.8);
  } else {
    // Fountain: a round stone basin of glowing water around a crystal on a carved pillar.
    add(g, mesh(cyl(3.1, 3.2, 0.68, 16), stoneDark), 0, 0.34, 0);
    footing(3.6, 14, 51);
    ring(0.02, 0.68, 3.28, 20, 53, 0.42);
    add(g, mesh(cyl(2.92, 2.92, 0.1, 18), stoneDark), 0, 0.68, 0);
    add(g, mesh(cyl(2.76, 2.76, 0.1, 18), glow(team === 0 ? 0x1d5a8c : 0x8c3a24, 1)), 0, 0.71, 0);
    for (let d = 0; d < 4; d++) add(g, mesh(cyl(0.68 - d * 0.05, 0.75 - d * 0.05, 0.6, 8), stoneAt(d + 60)), 0, 0.7 + d * 0.6 + 0.3, 0);
    add(g, mesh(cyl(0.9, 0.6, 0.35, 10), iron), 0, 3.25, 0);
    add(g, mesh(new THREE.OctahedronGeometry(0.75), crystal), 0, 4.05, 0).scale.set(0.8, 1.4, 0.8);
  }
  return g;
}

function rubble(radius: number): THREE.Object3D {
  const g = grp();
  const tones = [0x5c584f, 0x4c4942, 0x6a665c, 0x322f2a].map((c) => M(c));
  for (let i = 0; i < 16; i++) {
    const a = i * 2.2;
    const r = radius * (0.12 + (i % 5) * 0.2);
    const b = 0.45 + hash(i, 7) * 0.6;
    add(g, rot(mesh(i % 3 ? box(b * 1.3, b * 0.7, b) : sph(b * 0.6, 0), tones[i % tones.length]), a, a * 2, hash(i, 8)), Math.cos(a) * r, 0.2, Math.sin(a) * r);
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
  } else if (kind === 'rebuke') {
    // Seren's lance of light.
    add(g, rot(mesh(cone(0.34, 1.9, 6), glow(0xfff1c2, 2.6)), Math.PI / 2, 0, 0), 0, 0, 0.3);
    add(g, rot(mesh(cone(0.6, 2.6, 8), glow(0xffd98a, 1.3, 0.35)), Math.PI / 2, 0, 0), 0, 0, 0.1);
    add(g, mesh(new THREE.TorusGeometry(0.45, 0.04, 4, 16), glow(0xfff1c2, 1.8, 0.8)), 0, 0, -0.5);
  } else if (kind === 'spiritbolt') {
    // Morra's attack: a little spirit wisp with a tail.
    add(g, mesh(sph(0.18, 1), glow(0xffc247, 2.6)), 0, 0, 0);
    add(g, mesh(sph(0.32, 1), glow(0xd2691e, 1.3, 0.4)), 0, 0, -0.06);
    add(g, rot(mesh(cone(0.2, 0.7, 5), glow(0xffa64a, 1.4, 0.5)), -Math.PI / 2, 0, 0), 0, 0, -0.42);
  } else if (kind === 'crossbolt') {
    // Rhen's short heavy bolt.
    add(g, rot(mesh(cyl(0.035, 0.035, 0.9, 4), M(0xb8aa86)), Math.PI / 2, 0, 0), 0, 0, 0);
    add(g, rot(mesh(cone(0.075, 0.24, 4), M(0xc9d2d8, { metalness: 0.7 })), Math.PI / 2, 0, 0), 0, 0, 0.55);
    for (const s of [-1, 1]) add(g, mesh(box(0.02, 0.13, 0.17), M(0x9aa84e)), s * 0.03, 0, -0.38);
    add(g, rot(mesh(cone(0.09, 0.5, 5), glow(0xe8efc0, 1, 0.3)), -Math.PI / 2, 0, 0), 0, 0, -0.5);
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
