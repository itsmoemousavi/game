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
  /** Sculpted anatomy (tapered limbs, shaped torso, head with a face, real hands). Same joints either way. */
  sculpt?: boolean;
}

/** A turned shape from [radius, height] points, in either direction. */
function lathe(pts: [number, number][], seg = 12) {
  // Points must run upward or the surface faces inward and can't be seen from outside.
  const up = pts[0][1] <= pts[pts.length - 1][1] ? pts : [...pts].reverse();
  return new THREE.LatheGeometry(up.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg);
}
/** A curved tube that narrows along its length (horns, tusks, fur tufts). */
function taper(pts: [number, number, number][], r0: number, r1: number, seg = 10, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, seg, 1, radial);
  const p = g.attributes.position;
  const c = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const r = r0 + (r1 - r0) * (i / seg);
    for (let k = 0; k <= radial; k++) {
      const v = i * (radial + 1) + k;
      p.setXYZ(v, c.x + (p.getX(v) - c.x) * r, c.y + (p.getY(v) - c.y) * r, c.z + (p.getZ(v) - c.z) * r);
    }
  }
  return g;
}
/** A flat shape with a depth and softened edges (shields, hammer faces). */
function plate(shape: THREE.Shape, depth: number, bevel = 0.02) {
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 8, steps: 1 }).translate(0, 0, -depth / 2);
}
/** A rounded box with a fold or bulge: `shape` moves each corner point (cloaks, tabards). */
function cloth(w: number, h: number, sx: number, sy: number, shape: (x: number, y: number) => [number, number, number]) {
  const g = new THREE.BoxGeometry(w, h, 0.035, sx, sy, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const [dx, dy, dz] = shape(p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
    p.setXYZ(i, p.getX(i) + dx, p.getY(i) + dy, p.getZ(i) + dz);
  }
  g.computeVertexNormals();
  return g;
}

/** A head with a real shape: narrower jaw, brow, cheekbones, nose and ears. */
function sculptedHead(parent: THREE.Object3D, skin: THREE.Material) {
  const g = new THREE.IcosahedronGeometry(0.21, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const below = Math.max(0, -y);
    const jaw = 1 - below * 1.5;
    const brow = z > 0.08 && y > 0.02 && y < 0.09 ? 1.06 : 1;
    p.setXYZ(i, x * jaw * 0.93, y * 1.14, z * jaw * brow);
  }
  g.computeVertexNormals();
  add(parent, mesh(g, skin), 0, 0, 0);
  add(parent, mesh(lathe([[0.1, 0], [0.085, -0.08], [0.1, -0.17], [0.13, -0.2]], 8), skin), 0, -0.13, -0.01);
  add(parent, rot(mesh(cone(0.032, 0.09, 5), skin), -0.35, 0, 0), 0, -0.025, 0.205);
  for (const s of [-1, 1]) add(parent, mesh(sph(0.04, 0), skin), s * 0.19, 0, -0.01).scale.set(0.45, 1, 0.8);
}

/** A hand: palm, four fingers curled around a grip, and a thumb. */
function sculptedHand(parent: THREE.Object3D, b: number, skin: THREE.Material) {
  add(parent, mesh(sph(0.075 * b, 1), skin), 0, 0, 0).scale.set(0.82, 1, 1.05);
  for (let i = 0; i < 4; i++) add(parent, rot(mesh(cyl(0.019 * b, 0.022 * b, 0.1 * b, 5), skin), 0.75, 0, 0), (i - 1.5) * 0.031 * b, -0.075 * b, 0.05 * b);
  add(parent, rot(mesh(cyl(0.021 * b, 0.025 * b, 0.08 * b, 5), skin), 0.4, 0, -0.8), 0.06 * b, -0.015 * b, 0.05 * b);
}

function humanoid(o: BodyOpts): Body {
  if (o.sculpt) return sculptedHumanoid(o);
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

/** The same skeleton as the plain body (joints in the same places), with real anatomy on it. */
function sculptedHumanoid(o: BodyOpts): Body {
  const b = o.bulk ?? 1;
  const hip = o.hip ?? 0.95;
  const th = o.torsoH ?? 0.72;
  const slim = o.slim ?? 1;
  const w = b * slim;
  const root = grp();
  const skin = M(o.skin);
  const legs = [-1, 1].map((s) => {
    const g = add(root, grp(), s * 0.16 * b, hip, 0);
    const L = hip - 0.12;
    // Thigh, knee and calf, in one turned shape.
    add(g, mesh(lathe([[0.001, 0.07], [0.12 * w, 0.03], [0.135 * w, -L * 0.14], [0.115 * w, -L * 0.42], [0.09 * w, -L * 0.52], [0.098 * w, -L * 0.6], [0.105 * w, -L * 0.72], [0.075 * w, -L * 0.96], [0.07 * w, -L]], 10), M(o.cloth2)), 0, 0, 0);
    // Boot: an ankle cuff and a rounded foot.
    add(g, mesh(lathe([[0.085 * b, -L + 0.14], [0.095 * b, -L + 0.02], [0.1 * b, -L - 0.03]], 8), M(o.boots)), 0, 0, 0);
    add(g, mesh(sph(1, 1), M(o.boots)), 0, -hip + 0.075, 0.05 * b).scale.set(0.105 * b, 0.08, 0.17 * b);
    add(g, mesh(cyl(1, 1, 0.03, 9), M(0x1a1612)), 0, -hip + 0.018, 0.05 * b).scale.set(0.095 * b, 1, 0.165 * b);
    return g;
  });
  const torso = add(root, grp(), 0, hip, 0);
  // Pelvis, waist, ribs, chest and shoulders; flattened front to back.
  add(torso, mesh(lathe([[0.001, -0.06], [0.24 * w, -0.05], [0.25 * w, 0.03], [0.215 * w, th * 0.3], [0.285 * w, th * 0.62], [0.33 * w, th * 0.82], [0.27 * w, th * 0.97], [0.1, th + 0.03]], 12), M(o.cloth)), 0, 0, 0).scale.set(1, 1, 0.74);
  add(torso, mesh(lathe([[0.25 * w, 0.0], [0.262 * w, 0.03], [0.262 * w, 0.08], [0.25 * w, 0.11]], 12), M(o.boots)), 0, 0, 0).scale.set(1, 1, 0.78);
  const head = add(torso, grp(), 0, th + 0.24, 0);
  sculptedHead(head, skin);
  const eye = o.eyes !== undefined ? glow(o.eyes, 3) : M(0x1b1b1b);
  for (const s of [-1, 1]) add(head, mesh(box(0.045, 0.024, 0.02), eye), s * 0.075, 0.02, 0.19);
  const arms = [-1, 1].map((s) => {
    const g = add(torso, grp(), s * 0.39 * b * slim, th - 0.1, 0);
    add(g, mesh(sph(0.115 * b, 1), M(o.cloth)), 0, 0, 0);
    // Upper arm, elbow and forearm.
    add(g, mesh(lathe([[0.075 * b, 0.02], [0.092 * b, -0.1], [0.078 * b, -0.27], [0.066 * b, -0.31], [0.08 * b, -0.38], [0.07 * b, -0.5], [0.052 * b, -0.6]], 8), skin), 0, 0, 0);
    const h = add(g, grp(), 0, -0.62, 0);
    sculptedHand(h, b, skin);
    return { g, h };
  });
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
  const b = humanoid({ skin: 0x9c7558, cloth: 0x3f3226, cloth2: 0x352c25, boots: 0x2a241f, bulk: 1.4, hip: 0.88, torsoH: 0.78, sculpt: true });
  const steel = M(0x7c848d, { metalness: 0.75, roughness: 0.35 });
  const iron = M(0x3f4349, { metalness: 0.7, roughness: 0.45 });
  const bronze = M(0x96753a, { metalness: 0.7, roughness: 0.35 });
  const leather = M(0x4a321f);
  const furs = [0x5a4936, 0x4c3d2d, 0x665340].map((c) => M(c, { roughness: 0.95 }));
  const bone = M(0xbdb092);
  const red = M(0x4d1b1b);
  // Breastplate: a shaped chest with a raised centre ridge and a bronze collar.
  add(b.torso, mesh(lathe([[0.385, 0.3], [0.43, 0.42], [0.51, 0.62], [0.53, 0.72], [0.46, 0.84], [0.26, 0.9]], 14), steel), 0, 0, 0.02).scale.set(1, 1, 0.8);
  add(b.torso, mesh(box(0.05, 0.5, 0.05), steel), 0, 0.6, 0.41).rotation.x = -0.1;
  add(b.torso, mesh(lathe([[0.37, 0.84], [0.4, 0.86], [0.3, 0.92], [0.27, 0.91]], 14), bronze), 0, 0, 0.02).scale.set(1, 1, 0.82);
  // Overlapping belly plates.
  for (let i = 0; i < 3; i++) add(b.torso, mesh(lathe([[0.36 + i * 0.012, 0.09 + i * 0.075], [0.385 + i * 0.012, 0.13 + i * 0.075], [0.37 + i * 0.012, 0.2 + i * 0.075]], 14), i % 2 ? iron : steel), 0, 0, 0.01).scale.set(1, 1, 0.8);
  // Belt with a bronze buckle.
  add(b.torso, mesh(lathe([[0.385, 0.01], [0.405, 0.04], [0.405, 0.1], [0.385, 0.13]], 14), leather), 0, 0, 0).scale.set(1, 1, 0.82);
  add(b.torso, mesh(box(0.17, 0.13, 0.05), bronze), 0, 0.07, 0.34);
  // Fur mantle: a thick collar of overlapping lumps with short shaggy tufts at its edge.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const lump = new THREE.IcosahedronGeometry(0.15 + (i % 3) * 0.018, 1);
    const lp = lump.attributes.position;
    for (let v = 0; v < lp.count; v++) {
      const k = 1 + 0.2 * Math.sin(lp.getX(v) * 41 + i) * Math.cos(lp.getZ(v) * 37 + lp.getY(v) * 29);
      lp.setXYZ(v, lp.getX(v) * k, lp.getY(v) * k, lp.getZ(v) * k);
    }
    add(b.torso, mesh(lump, furs[i % furs.length]), Math.cos(a) * 0.4, 0.9 + (i % 2) * 0.03, Math.sin(a) * 0.31).scale.set(1.15, 0.72, 1.05);
    const px = Math.cos(a + 0.17) * 0.47;
    const pz = Math.sin(a + 0.17) * 0.37;
    add(b.torso, mesh(taper([[px * 0.92, 0.88, pz * 0.92], [px * 1.04, 0.8, pz * 1.04], [px * 1.08, 0.7, pz * 1.08]], 0.06, 0.008, 3, 5), furs[(i + 1) % furs.length]), 0, 0, 0);
  }
  // Tabard in front, cloak behind, both with soft folds.
  add(b.torso, mesh(cloth(0.42, 0.72, 4, 7, (x, y) => [0, 0, Math.sin(x * 9) * 0.012 + (1 - y) * 0.08]), red), 0, -0.3, 0.33);
  add(b.torso, mesh(box(0.42, 0.045, 0.05), bronze), 0, 0.04, 0.34);
  // A cloak hangs from under the fur: narrow at the shoulders, wide and torn at the hem, deep folds.
  add(b.torso, mesh(cloth(0.74, 1.4, 10, 10, (x, y) => {
    const fall = 1 - y;
    const u = x - 0.5;
    const hem = fall > 0.9 ? Math.sin(x * 31) * 0.05 : 0;
    return [u * (-0.26 + fall * 0.36), hem, -fall * 0.09 + Math.sin(x * 22) * (0.012 + fall * 0.04)];
  }), M(0x5a2a22)), 0, 0.2, -0.37);
  // Pauldrons of layered plates with a bronze edge; forearm guards and gauntlets.
  for (const [arm, s] of [[b.armL, -1], [b.armR, 1]] as const) {
    for (let i = 0; i < 3; i++) {
      const dome = new THREE.SphereGeometry(0.31 - i * 0.03, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.52);
      add(arm, mesh(dome, i === 1 ? steel : iron), s * (0.03 - i * 0.015), 0.1 - i * 0.075, 0).scale.set(1.08, 0.72, 1.02);
    }
    add(arm, mesh(new THREE.TorusGeometry(0.28, 0.022, 5, 18), bronze), s * 0.02, 0.08, 0).rotation.x = Math.PI / 2;
    add(arm, rot(mesh(taper([[0, 0, 0], [s * 0.05, 0.13, 0], [s * 0.13, 0.25, 0]], 0.06, 0.005, 5, 5), steel), 0, 0, 0), s * 0.13, 0.25, 0.05);
    add(arm, mesh(lathe([[0.125, -0.32], [0.14, -0.4], [0.125, -0.52], [0.145, -0.6], [0.12, -0.63]], 10), iron), 0, 0, 0);
    add(arm, mesh(new THREE.TorusGeometry(0.134, 0.015, 4, 12), bronze), 0, -0.36, 0).rotation.x = Math.PI / 2;
    add(arm, mesh(sph(0.1, 1), iron), 0, -0.68, 0.015).scale.set(1, 0.75, 1.1);
  }
  // Greaves, knee guards and plated boots.
  for (const leg of [b.legL, b.legR]) {
    add(leg, mesh(lathe([[0.15, -0.28], [0.17, -0.42], [0.155, -0.6], [0.125, -0.74]], 10), iron), 0, 0, 0.01);
    add(leg, mesh(new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), steel), 0, -0.33, 0.07).rotation.x = 1.1;
    add(leg, mesh(new THREE.TorusGeometry(0.128, 0.014, 4, 12), bronze), 0, -0.74, 0.01).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) add(leg, mesh(sph(1, 1), i % 2 ? steel : iron), 0, -0.77 - i * 0.012, 0.09 + i * 0.08).scale.set(0.15 - i * 0.012, 0.09 - i * 0.008, 0.11);
  }
  // Helm: a dome with a brow band, nose guard and cheek plates; long curved horns; braided beard.
  add(b.head, mesh(lathe([[0.001, 0.31], [0.1, 0.295], [0.19, 0.23], [0.245, 0.12], [0.255, 0.02], [0.25, -0.07]], 14), iron), 0, 0, 0);
  add(b.head, mesh(new THREE.TorusGeometry(0.256, 0.024, 5, 20), bronze), 0, 0.05, 0).rotation.x = Math.PI / 2;
  add(b.head, mesh(box(0.05, 0.27, 0.06), bronze), 0, 0.03, 0.245);
  add(b.head, mesh(box(0.05, 0.2, 0.03), steel), 0, 0.2, 0.2).rotation.x = -0.55;
  for (const s of [-1, 1]) {
    add(b.head, rot(mesh(box(0.13, 0.25, 0.05), iron), 0, s * 0.45, s * -0.08), s * 0.15, -0.1, 0.19);
    add(b.head, mesh(taper([[s * 0.22, 0.13, 0], [s * 0.42, 0.18, 0.02], [s * 0.57, 0.33, 0.04], [s * 0.6, 0.55, 0.03]], 0.078, 0.006, 10, 7), bone), 0, 0, 0);
    add(b.head, mesh(new THREE.TorusGeometry(0.075, 0.012, 4, 10), bronze), s * 0.28, 0.135, 0).rotation.y = Math.PI / 2 - s * 0.2;
  }
  add(b.head, mesh(box(0.24, 0.032, 0.025), glow(0xffb347, 2.2)), 0, 0.0, 0.232);
  const beard = M(0x6b4e33);
  for (let i = 0; i < 9; i++) {
    const a = ((i - 4) / 4) * 0.8;
    add(b.head, mesh(taper([[Math.sin(a) * 0.17, -0.14, 0.15 + Math.cos(a) * 0.04], [Math.sin(a) * 0.13, -0.27, 0.19], [Math.sin(a) * 0.05, -0.42 - (i % 2) * 0.05, 0.17]], 0.052, 0.008, 5, 5), beard), 0, 0, 0);
  }
  // Tower shield: a rounded, pointed plate with a bronze rim, a riveted boss and a chevron.
  const sh = add(b.armL, grp(), 0.02, -0.46, 0.31);
  rot(sh, 0.7, 0, 0);
  const shieldShape = (k: number) => {
    const w = 0.4 * k;
    const h = 0.56 * k;
    const s0 = new THREE.Shape();
    s0.moveTo(-w, h * 0.72);
    s0.quadraticCurveTo(0, h * 1.06, w, h * 0.72);
    s0.lineTo(w, -h * 0.42);
    s0.quadraticCurveTo(w * 0.72, -h * 0.85, 0, -h * 1.02);
    s0.quadraticCurveTo(-w * 0.72, -h * 0.85, -w, -h * 0.42);
    s0.closePath();
    return s0;
  };
  add(sh, mesh(plate(shieldShape(1.07), 0.07, 0.015), bronze), 0, 0, -0.012);
  add(sh, mesh(plate(shieldShape(0.98), 0.09, 0.012), iron), 0, 0, 0.012);
  add(sh, mesh(new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), steel), 0, 0.1, 0.06).rotation.x = Math.PI / 2;
  add(sh, mesh(new THREE.TorusGeometry(0.135, 0.018, 4, 16), bronze), 0, 0.1, 0.065);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add(sh, mesh(sph(0.018, 0), bronze), Math.cos(a) * 0.33, 0.04 + Math.sin(a) * 0.45, 0.07);
  }
  for (const s of [-1, 1]) add(sh, rot(mesh(box(0.28, 0.05, 0.03), bronze), 0, 0, s * 0.6), s * 0.11, -0.2, 0.065);
  // War hammer: wrapped haft, an eight-sided head with bronze bands, a back spike and a top spike.
  const w = add(b.armR, grp(), 0, -0.62, 0.04);
  w.name = 'weapon';
  add(w, mesh(lathe([[0.05, -0.3], [0.052, 0], [0.048, 0.5], [0.056, 1.04]], 7), leather), 0, 0, 0);
  add(w, mesh(sph(0.07, 1), bronze), 0, -0.32, 0);
  for (let i = 0; i < 6; i++) add(w, rot(mesh(cyl(0.057, 0.057, 0.025, 7), M(0x2b1d12)), 0.14, 0, 0), 0, -0.14 + i * 0.05, 0);
  for (const y of [0.1, 0.78]) add(w, mesh(cyl(0.064, 0.064, 0.05, 7), bronze), 0, y, 0);
  const headShape = new THREE.Shape();
  const hx = 0.19;
  const hc = 0.07;
  headShape.moveTo(-hx + hc, -hx);
  headShape.lineTo(hx - hc, -hx);
  headShape.lineTo(hx, -hx + hc);
  headShape.lineTo(hx, hx - hc);
  headShape.lineTo(hx - hc, hx);
  headShape.lineTo(-hx + hc, hx);
  headShape.lineTo(-hx, hx - hc);
  headShape.lineTo(-hx, -hx + hc);
  headShape.closePath();
  const hammerHead = plate(headShape, 0.56, 0.018).rotateY(Math.PI / 2);
  add(w, mesh(hammerHead, iron), 0, 1.08, 0);
  for (const x of [-0.19, 0.17]) add(w, rot(mesh(cyl(0.2, 0.2, 0.045, 8), bronze), 0, 0, Math.PI / 2), x, 1.08, 0).rotation.y = 0;
  add(w, rot(mesh(cyl(0.17, 0.2, 0.08, 8), steel), 0, 0, Math.PI / 2), -0.33, 1.08, 0);
  add(w, rot(mesh(taper([[0, 0, 0], [0.13, 0.015, 0], [0.26, 0.05, 0]], 0.1, 0.008, 5, 6), steel), 0, 0, 0), 0.28, 1.08, 0);
  add(w, mesh(taper([[0, 0, 0], [0, 0.13, 0], [0, 0.24, 0]], 0.065, 0.006, 4, 6), steel), 0, 1.27, 0);
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
