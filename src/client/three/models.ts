import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HeroId, RuneKind, StructureTier } from '../../sim';
import { HERO_BUILDERS, M, add, box, cone, cyl, glow, grp, humanoid, mesh, resetFx, rot, sph } from './hero-models';

export const TEAM_HEX = [0x3d8bfd, 0xe5484d] as const;

// ------------------------------------------------------------------ baking

/** Joints that animate, in parent → child order. */
export const JOINTS = ['rig', 'torso', 'legL', 'legR', 'armL', 'armR'] as const;
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
  const made = new Map<THREE.Object3D, THREE.Object3D>([[top, out]]);
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
  const [kind, a, b] = key.split(':');
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
      return structure(a as StructureTier, Number(b) as 0 | 1);
    case 'rubble':
      return rubble(Number(a));
    case 'ward':
      return ward(a as 'observer' | 'sentry');
    case 'rune':
      return rune(a as RuneKind);
    case 'shot':
      return shot(a);
  }
  return new THREE.Group();
}

// ------------------------------------------------------------------ creeps

function creep(type: 'melee' | 'ranged', team: 0 | 1): THREE.Object3D {
  const tc = TEAM_HEX[team];
  const dark = team === 0 ? 0x1e3a6e : 0x6e1e22;
  const b = humanoid({ skin: 0xc9a27e, cloth: tc, cloth2: dark, boots: 0x2a2a2a, hip: 0.8, slim: 0.9 });
  const steel = M(0xa0a8b0, { metalness: 0.6 });
  add(b.head, mesh(sph(0.23, 0), steel), 0, 0.06, 0).scale.set(1, 0.85, 1);
  if (type === 'melee') {
    rot(b.armR, -0.9, 0, 0);
    add(b.handR, rot(mesh(box(0.06, 0.8, 0.12), steel), 0.9, 0, 0), 0, -0.05, 0.35);
    rot(b.armL, -0.5, 0, 0.2);
    add(b.handL, rot(mesh(cyl(0.32, 0.32, 0.07, 8), M(tc)), Math.PI / 2 - 0.5, 0, 0), 0.05, 0, 0.1);
  } else {
    add(b.root, mesh(cone(0.42, 0.85, 8), M(dark)), 0, 0.42, 0);
    b.legL.visible = b.legR.visible = false;
    rot(b.armR, -0.4, 0, 0);
    const st = add(b.handR, rot(grp(), 0.4, 0, 0), 0, 0, 0);
    add(st, mesh(cyl(0.03, 0.03, 1.5, 5), M(0x5a3d26)), 0, 0.3, 0);
    add(st, mesh(sph(0.11, 0), glow(team === 0 ? 0x9ccbff : 0xffa3a3, 2.5)), 0, 1.08, 0);
  }
  const g = grp();
  g.add(b.root);
  g.scale.setScalar(0.72);
  return g;
}

// ------------------------------------------------------------------ jungle

function brute(): THREE.Object3D {
  const b = humanoid({ skin: 0x7c6a58, cloth: 0x5b4a3a, cloth2: 0x4a3c30, boots: 0x2e251d, bulk: 1.5, hip: 0.7, torsoH: 0.75, eyes: 0xffb347 });
  b.torso.rotation.x = 0.35;
  for (const s of [-1, 1]) add(b.head, rot(mesh(cone(0.06, 0.3, 5), M(0xe8dcc0)), 0, 0, -s * 0.8), s * 0.2, 0.15, 0);
  rot(b.armL, -0.3, 0, -0.2);
  rot(b.armR, -0.3, 0, 0.2);
  add(b.handR, rot(mesh(cyl(0.1, 0.16, 0.9, 6), M(0x5a3d26)), 0.3, 0, 0), 0, -0.3, 0.1);
  return b.root;
}

function imp(): THREE.Object3D {
  const b = humanoid({ skin: 0x8fae5a, cloth: 0x6b4f2a, cloth2: 0x4a3a20, boots: 0x2e251d, hip: 0.55, torsoH: 0.5, slim: 0.8, eyes: 0xffe066 });
  for (const s of [-1, 1]) add(b.head, rot(mesh(cone(0.07, 0.35, 4), M(0x8fae5a)), 0, 0, -s * 1.3), s * 0.27, 0.05, 0);
  rot(b.armR, -1.0, 0, 0);
  add(b.handR, rot(mesh(cone(0.04, 0.35, 4), M(0xb0b0b0)), Math.PI / 2 + 1.0, 0, 0), 0, 0, 0.18);
  return b.root;
}

function warden(): THREE.Object3D {
  const stone = 0x4b4560;
  const b = humanoid({ skin: stone, cloth: 0x3b3550, cloth2: 0x332e45, boots: 0x2a2638, bulk: 1.9, hip: 1.0, torsoH: 1.0, eyes: 0xd8b4fe });
  const crystal = glow(0xa78bfa, 2.2);
  for (const s of [-1, 1]) {
    add(b.torso, rot(mesh(new THREE.OctahedronGeometry(0.28), crystal), 0, 0, s * 0.4), s * 0.75, 1.15, 0).scale.set(0.6, 1.4, 0.6);
    add(b.torso, rot(mesh(new THREE.OctahedronGeometry(0.18), crystal), 0.3, 0, s * 0.7), s * 0.55, 1.25, -0.25).scale.set(0.6, 1.4, 0.6);
  }
  for (let i = -1; i <= 1; i++) add(b.head, mesh(cone(0.07, 0.3, 4), M(0xffd23f, { metalness: 0.6 })), i * 0.12, 0.3, 0);
  rot(b.armL, -0.3, 0, -0.25);
  rot(b.armR, -0.3, 0, 0.25);
  for (const h of [b.handL, b.handR]) add(h, mesh(sph(0.3, 0), M(stone)), 0, -0.05, 0);
  const g = grp();
  g.add(b.root);
  g.scale.setScalar(1.25);
  return g;
}

// ------------------------------------------------------------------ buildings

function structure(tier: StructureTier, team: 0 | 1): THREE.Object3D {
  const tc = TEAM_HEX[team];
  const stone = M(team === 0 ? 0x9aa3b5 : 0xa89a96);
  const stone2 = M(team === 0 ? 0x6b7487 : 0x7a6a66);
  const trim = M(tc);
  const crystal = glow(team === 0 ? 0x7cc0ff : 0xff8a8a, 2.4);
  const g = grp();
  if (tier === 'tower1' || tier === 'tower2' || tier === 'shrineTower') {
    const h = tier === 'tower1' ? 5.2 : tier === 'tower2' ? 5.8 : 6.4;
    add(g, mesh(cyl(1.9, 2.2, 0.8, 8), stone2), 0, 0.4, 0);
    add(g, mesh(cyl(1.15, 1.55, h, 8), stone), 0, 0.8 + h / 2, 0);
    for (let i = 0; i < 3; i++) add(g, mesh(cyl(1.6 - i * 0.05, 1.6 - i * 0.05, 0.18, 8), trim), 0, 1.6 + i * (h / 3), 0);
    const top = 0.8 + h;
    add(g, mesh(cyl(1.7, 1.3, 0.5, 8), stone2), 0, top + 0.25, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(g, mesh(box(0.35, 0.5, 0.35), stone2), Math.cos(a) * 1.5, top + 0.75, Math.sin(a) * 1.5);
    }
    add(g, mesh(new THREE.OctahedronGeometry(0.75), crystal), 0, top + 1.6, 0).scale.set(0.8, 1.5, 0.8);
  } else if (tier === 'barracks') {
    add(g, mesh(box(5, 0.6, 4.4), stone2), 0, 0.3, 0);
    add(g, mesh(box(4.4, 2.8, 3.8), stone), 0, 2, 0);
    add(g, rot(mesh(cone(3.6, 2.2, 4), trim), 0, Math.PI / 4, 0), 0, 4.5, 0).scale.set(1, 1, 0.85);
    add(g, mesh(box(1.2, 1.8, 0.2), M(0x3a2a1a)), 0, 1.5, 1.95);
    for (const s of [-1, 1]) {
      add(g, mesh(cyl(0.06, 0.06, 2.6, 4), M(0x5a3d26)), s * 1.6, 4.4, 1.6);
      add(g, mesh(box(0.7, 0.9, 0.04), trim), s * 1.6 + 0.37, 5.1, 1.6);
    }
  } else if (tier === 'shrine') {
    add(g, mesh(cyl(4.4, 4.9, 0.9, 10), stone2), 0, 0.45, 0);
    add(g, mesh(cyl(3.5, 4.0, 0.8, 10), stone), 0, 1.3, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(g, mesh(cyl(0.3, 0.38, 3.6, 6), stone), Math.cos(a) * 3.2, 3.5, Math.sin(a) * 3.2);
      add(g, mesh(sph(0.3, 0), crystal), Math.cos(a) * 3.2, 5.5, Math.sin(a) * 3.2);
    }
    add(g, mesh(new THREE.TorusGeometry(2.2, 0.15, 6, 24), trim), 0, 1.8, 0).rotation.x = Math.PI / 2;
    add(g, mesh(new THREE.OctahedronGeometry(1.5), crystal), 0, 5.5, 0).scale.set(0.8, 1.9, 0.8);
  } else {
    // fountain
    add(g, mesh(cyl(3.2, 3.4, 0.6, 12), stone2), 0, 0.3, 0);
    add(g, mesh(cyl(2.7, 2.7, 0.2, 12), glow(team === 0 ? 0x4fa3ff : 0xff6b6b, 1.2)), 0, 0.62, 0);
    add(g, mesh(cyl(0.5, 0.7, 2.2, 8), stone), 0, 1.6, 0);
    add(g, mesh(new THREE.OctahedronGeometry(0.7), crystal), 0, 3.3, 0);
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
    add(g, mesh(box(3, 0.9, 0.6), glow(0x67e8f9, 1.6)), 0, 0, 0);
  } else if (kind === 'spell') {
    add(g, mesh(sph(0.4, 1), glow(0xffb347, 3)), 0, 0, 0);
  } else {
    add(g, mesh(sph(0.2, 0), glow(kind === 'shot0' ? 0xbfe0ff : 0xffc9c9, 2.5)), 0, 0, 0);
  }
  return g;
}
