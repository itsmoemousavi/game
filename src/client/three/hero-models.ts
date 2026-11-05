import * as THREE from 'three';
import type { HeroId } from '../../sim';

/**
 * Our own hero models, sculpted in code from turned shapes, tapered tubes and draped cloth.
 * Models face +z; the renderer bakes each one into a couple of merged meshes per joint, so a
 * whole unit costs a handful of draw calls.
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
  /** Fewer polygons for units seen in large numbers: same shapes, no fingers. */
  lite?: boolean;
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
function sculptedHead(parent: THREE.Object3D, skin: THREE.Material, detail = 2) {
  const g = new THREE.IcosahedronGeometry(0.21, detail);
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
  const lite = !!o.lite;
  const seg = (n: number) => (lite ? Math.max(5, Math.round(n * 0.6)) : n);
  const legs = [-1, 1].map((s) => {
    const g = add(root, grp(), s * 0.16 * b, hip, 0);
    const L = hip - 0.12;
    // Thigh, knee and calf, in one turned shape.
    add(g, mesh(lathe([[0.001, 0.07], [0.12 * w, 0.03], [0.135 * w, -L * 0.14], [0.115 * w, -L * 0.42], [0.09 * w, -L * 0.52], [0.098 * w, -L * 0.6], [0.105 * w, -L * 0.72], [0.075 * w, -L * 0.96], [0.07 * w, -L]], seg(10)), M(o.cloth2)), 0, 0, 0);
    // Boot: an ankle cuff and a rounded foot.
    add(g, mesh(lathe([[0.085 * b, -L + 0.14], [0.095 * b, -L + 0.02], [0.1 * b, -L - 0.03]], seg(8)), M(o.boots)), 0, 0, 0);
    add(g, mesh(sph(1, lite ? 0 : 1), M(o.boots)), 0, -hip + 0.075, 0.05 * b).scale.set(0.105 * b, 0.08, 0.17 * b);
    if (!lite) add(g, mesh(cyl(1, 1, 0.03, 9), M(0x1a1612)), 0, -hip + 0.018, 0.05 * b).scale.set(0.095 * b, 1, 0.165 * b);
    return g;
  });
  const torso = add(root, grp(), 0, hip, 0);
  // Pelvis, waist, ribs, chest and shoulders; flattened front to back.
  add(torso, mesh(lathe([[0.001, -0.06], [0.24 * w, -0.05], [0.25 * w, 0.03], [0.215 * w, th * 0.3], [0.285 * w, th * 0.62], [0.33 * w, th * 0.82], [0.27 * w, th * 0.97], [0.1, th + 0.03]], seg(12)), M(o.cloth)), 0, 0, 0).scale.set(1, 1, 0.74);
  add(torso, mesh(lathe([[0.25 * w, 0.0], [0.262 * w, 0.03], [0.262 * w, 0.08], [0.25 * w, 0.11]], seg(12)), M(o.boots)), 0, 0, 0).scale.set(1, 1, 0.78);
  const head = add(torso, grp(), 0, th + 0.24, 0);
  sculptedHead(head, skin, lite ? 1 : 2);
  const eye = o.eyes !== undefined ? glow(o.eyes, 3) : M(0x1b1b1b);
  for (const s of [-1, 1]) add(head, mesh(box(0.045, 0.024, 0.02), eye), s * 0.075, 0.02, 0.19);
  const arms = [-1, 1].map((s) => {
    const g = add(torso, grp(), s * 0.39 * b * slim, th - 0.1, 0);
    add(g, mesh(sph(0.115 * b, lite ? 0 : 1), M(o.cloth)), 0, 0, 0);
    // Upper arm, elbow and forearm.
    add(g, mesh(lathe([[0.075 * b, 0.02], [0.092 * b, -0.1], [0.078 * b, -0.27], [0.066 * b, -0.31], [0.08 * b, -0.38], [0.07 * b, -0.5], [0.052 * b, -0.6]], seg(8)), skin), 0, 0, 0);
    const h = add(g, grp(), 0, -0.62, 0);
    if (lite) add(h, mesh(sph(0.08 * b, 0), skin), 0, 0, 0);
    else sculptedHand(h, b, skin);
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

/** Sags and folds a robe: a turned skirt whose hem ripples, more so toward the floor. */
function skirt(top: number, bottom: number, h: number, folds = 9, depth = 0.09, seg = 24) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push([bottom + (top - bottom) * Math.pow(t, 0.8), t * h]);
  }
  const g = lathe(pts, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const t = p.getY(i) / h;
    const k = 1 + Math.sin(a * folds) * depth * (1 - t);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) - (t < 0.02 ? Math.abs(Math.sin(a * folds * 1.5)) * 0.03 : 0), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
/** Lumps on a rounded shape (foliage, rock, bark knots). */
function lumpy(g: THREE.BufferGeometry, amp = 0.2, seed = 1) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + amp * Math.sin(x * 19 + seed) * Math.cos(z * 17 + y * 13 + seed);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}
/** A hood: a shell open at the front so the face shows, with a shadowed inside and a pointed back. */
function hood(parent: THREE.Object3D, r: number, outer: THREE.Material, inner: THREE.Material, open = 0.95, tail = 0.3) {
  const shell = () => new THREE.SphereGeometry(r, 16, 10, Math.PI / 2 + open, Math.PI * 2 - open * 2, 0, Math.PI * 0.72);
  const out = add(parent, mesh(shell(), outer), 0, 0.05, -0.03);
  out.scale.set(1, 1.08, 1.12);
  const inGeo = shell();
  inGeo.scale(-0.96, 0.96, 0.96);
  inGeo.computeVertexNormals();
  const ins = add(parent, mesh(inGeo, inner), 0, 0.05, -0.03);
  ins.scale.set(1, 1.08, 1.12);
  add(parent, mesh(taper([[0, r * 0.75, -r * 0.55], [0, r * 0.55, -r * 1.25], [0, r * 0.1, -r * (1.25 + tail * 2)]], r * 0.45, 0.012, 6, 7), outer), 0, 0.05, -0.03);
  // The brim over the forehead: only the face below the brow shows.
  const brim = add(parent, mesh(new THREE.SphereGeometry(r * 1.01, 12, 5, Math.PI / 2 - open - 0.05, open * 2 + 0.1, 0, 0.9), outer), 0, 0.05, -0.03);
  brim.scale.set(1, 1.08, 1.12);
  add(parent, mesh(new THREE.TorusGeometry(r * 0.72, r * 0.075, 5, 12, Math.PI * 0.8), outer), 0, 0.11, r * 0.42).rotation.z = Math.PI * 0.1;
}

/**
 * Vexa the ranger: hooded, dark leather, cloak and quiver on her back, a recurve longbow in
 * the left hand (the 'weapon' joint, so the renderer can raise and aim it).
 */
function vexa() {
  const b = humanoid({ skin: 0xc99a7c, cloth: 0x2d4632, cloth2: 0x35302a, boots: 0x3b2a1c, hip: 1.0, slim: 0.82, sculpt: true });
  const leather = M(0x543722);
  const dark = M(0x2a1d14);
  const green = M(0x1e3a29);
  const greenDark = M(0x0f1d14);
  const bronze = M(0x8f7136, { metalness: 0.6, roughness: 0.35 });
  // Fitted jerkin with a raised collar, chest strap and buckle.
  add(b.torso, mesh(lathe([[0.2, 0.1], [0.195, 0.24], [0.245, 0.46], [0.275, 0.6], [0.235, 0.7], [0.13, 0.76]], 12), M(0x3a5240)), 0, 0, 0).scale.set(1, 1, 0.76);
  add(b.torso, rot(mesh(box(0.06, 0.82, 0.035), leather), 0, 0, 0.72), 0, 0.42, 0.205);
  add(b.torso, mesh(box(0.09, 0.07, 0.04), bronze), 0, 0.42, 0.23);
  // Belt with pouches and a skirt of leather strips.
  add(b.torso, mesh(lathe([[0.215, -0.02], [0.225, 0.02], [0.225, 0.07], [0.215, 0.1]], 12), leather), 0, 0, 0).scale.set(1, 1, 0.8);
  for (const s of [-1, 1]) add(b.torso, mesh(sph(0.075, 1), leather), s * 0.18, -0.01, 0.13).scale.set(1, 1.1, 0.7);
  for (let i = 0; i < 7; i++) {
    const a = ((i - 3) * Math.PI) / 5;
    add(b.torso, rot(mesh(cloth(0.1, 0.32, 1, 3, (_x, y) => [0, 0, (1 - y) * 0.05]), dark), 0, a, 0), Math.sin(a) * 0.205, -0.15, Math.cos(a) * 0.17);
  }
  // Hood with a face scarf; short hair under it.
  hood(b.head, 0.255, green, greenDark, 0.8, 0.28);
  add(b.head, mesh(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, Math.PI * 0.56, Math.PI * 0.3), M(0x23382a)), 0, 0.01, 0.025).scale.set(1, 1.1, 1.08);
  for (const s of [-1, 1]) add(b.head, rot(mesh(box(0.07, 0.016, 0.02), M(0x2a1c12)), 0, 0, s * -0.16), s * 0.076, 0.052, 0.185);
  add(b.torso, mesh(lathe([[0.17, 0.68], [0.2, 0.74], [0.15, 0.85]], 12), green), 0, 0, -0.02);
  // Cloak falling from the shoulders, split at the hem.
  add(b.torso, mesh(cloth(0.55, 1.34, 8, 10, (x, y) => {
    const fall = 1 - y;
    return [(x - 0.5) * (-0.2 + fall * 0.26), fall > 0.9 ? Math.sin(x * 27) * 0.04 : 0, -fall * 0.09 + Math.sin(x * 20) * (0.01 + fall * 0.035)];
  }), green), 0, 0.08, -0.26);
  // Quiver across the back with fletched arrows.
  const q = add(b.torso, rot(grp(), 0.25, 0, 0.45), 0.12, 0.45, -0.28);
  add(q, mesh(lathe([[0.045, -0.31], [0.075, -0.28], [0.085, 0.24], [0.078, 0.27]], 8), leather), 0, 0, 0);
  add(q, mesh(new THREE.TorusGeometry(0.083, 0.012, 4, 10), bronze), 0, 0.26, 0).rotation.x = Math.PI / 2;
  add(q, mesh(new THREE.TorusGeometry(0.083, 0.01, 4, 10), bronze), 0, -0.2, 0).rotation.x = Math.PI / 2;
  for (let i = 0; i < 5; i++) {
    const x = -0.04 + (i % 3) * 0.04;
    const z = -0.03 + (i >> 1) * 0.03;
    add(q, mesh(cyl(0.007, 0.007, 0.2, 4), M(0xb8aa86)), x, 0.38, z);
    add(q, mesh(cone(0.026, 0.11, 4), M(0x2f5a3a)), x, 0.47, z).scale.set(1, 1, 0.3);
  }
  // Bracers, a shoulder guard on the bow arm, tall boots with folded cuffs.
  for (const arm of [b.armL, b.armR]) {
    add(arm, mesh(lathe([[0.066, -0.33], [0.08, -0.38], [0.07, -0.5], [0.062, -0.58]], 8), dark), 0, 0, 0);
    add(arm, mesh(new THREE.TorusGeometry(0.066, 0.008, 4, 10), bronze), 0, -0.56, 0).rotation.x = Math.PI / 2;
  }
  add(b.armL, mesh(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), leather), -0.01, 0.03, 0).scale.set(1.08, 0.75, 1.02);
  add(b.armL, mesh(new THREE.TorusGeometry(0.145, 0.01, 4, 12), bronze), -0.01, 0.03, 0).rotation.x = Math.PI / 2;
  for (const leg of [b.legL, b.legR]) {
    add(leg, mesh(lathe([[0.105, -0.5], [0.1, -0.53], [0.087, -0.68], [0.08, -0.88]], 8), M(0x3b2a1c)), 0, 0, 0);
    add(leg, mesh(new THREE.TorusGeometry(0.1, 0.018, 5, 10), M(0x2a1d14)), 0, -0.5, 0).rotation.x = Math.PI / 2;
  }
  // Recurve longbow: limbs thin toward the tips, a wrapped grip, bone tips, nocked arrow.
  const w = add(b.armL, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  const wood = M(0x3d2614);
  add(w, mesh(taper([[0, 0, 0.06], [0, 0.32, -0.04], [0, 0.62, -0.2], [0, 0.72, -0.1]], 0.034, 0.011, 10, 6), wood), 0, 0, 0);
  add(w, mesh(taper([[0, 0, 0.06], [0, -0.32, -0.04], [0, -0.62, -0.2], [0, -0.72, -0.1]], 0.034, 0.011, 10, 6), wood), 0, 0, 0);
  add(w, mesh(cyl(0.039, 0.039, 0.18, 6), M(0x1a120c)), 0, 0, 0.05);
  for (const y of [-0.72, 0.72]) add(w, mesh(sph(0.026, 0), M(0xbdb092)), 0, y, -0.1);
  add(w, mesh(tube([[0, -0.68, -0.17], [0, 0, -0.17], [0, 0.68, -0.17]], 0.005, 2, 3), M(0xbcb8a4)), 0, 0, 0);
  add(w, rot(mesh(cyl(0.009, 0.009, 0.8, 4), M(0xb8aa86)), Math.PI / 2, 0, 0), 0, 0.02, 0.22);
  add(w, rot(mesh(cone(0.028, 0.1, 4), M(0xa8b0b6, { metalness: 0.7 })), Math.PI / 2, 0, 0), 0, 0.02, 0.66);
  add(w, rot(mesh(cone(0.032, 0.12, 4), M(0x2f5a3a)), -Math.PI / 2, 0, 0), 0, 0.02, -0.12).scale.set(1, 1, 0.3);
  // Ready stance: bow held low and angled forward.
  rot(b.armL, -0.35, 0, -0.12);
  rot(w, 0.9, 0, 0);
  rot(b.armR, -0.1, 0, 0.1);
  return b.root;
}

/**
 * Orin the fire mage: deep hooded robe with ember eyes and a long beard, a gnarled staff with
 * a caged fire crystal in the left hand ('weapon' joint).
 */
function orin() {
  const b = humanoid({ skin: 0xc89a78, cloth: 0x5e1a14, cloth2: 0x4a1410, boots: 0x2a1410, hip: 0.95, slim: 0.9, eyes: 0xff8a2a, sculpt: true });
  const robe = M(0x5a1913);
  const robeDark = M(0x3a0e0a);
  const trim = M(0x8f7136, { metalness: 0.6, roughness: 0.35 });
  const dark = M(0x1d0c09);
  const ember = glow(0xff7a2a, 2.6);
  // Long robe with deep folds (no legs), a bronze hem and a front panel with glowing runes.
  // Named so it stays on the body instead of being attached to the nearest hand when baked.
  const hang = add(b.root, grp(), 0, 0, 0);
  hang.name = 'robe';
  add(hang, mesh(skirt(0.25, 0.6, 1.02, 9, 0.1), robe), 0, 0, 0).scale.set(1, 1, 0.9);
  add(hang, mesh(skirt(0.59, 0.625, 0.07, 9, 0.09), trim), 0, 0.005, 0).scale.set(1, 1, 0.9);
  add(hang, rot(mesh(cloth(0.22, 0.95, 2, 6, (_x, y) => [0, 0, (1 - y) * 0.03]), robeDark), -0.26, 0, 0), 0, 0.49, 0.32);
  for (let i = 0; i < 3; i++) add(hang, mesh(box(0.065, 0.065, 0.02), ember), 0, 0.25 + i * 0.25, 0.37 - i * 0.065).rotation.set(-0.26, 0, Math.PI / 4);
  b.legL.visible = b.legR.visible = false;
  add(b.torso, mesh(lathe([[0.24, 0.04], [0.245, 0.24], [0.3, 0.5], [0.31, 0.62], [0.2, 0.72]], 12), robe), 0, 0, 0).scale.set(1, 1, 0.82);
  // Sash with a knot, mantle and high collar.
  add(b.torso, mesh(lathe([[0.26, 0.04], [0.275, 0.07], [0.27, 0.12], [0.25, 0.15]], 12), M(0x2a120e)), 0, 0, 0).scale.set(1, 1, 0.85);
  add(b.torso, mesh(box(0.1, 0.1, 0.05), trim), 0, 0.09, 0.24);
  add(b.torso, mesh(cloth(0.09, 0.42, 1, 4, (_x, y) => [0, 0, (1 - y) * 0.05]), M(0x2a120e)), 0.07, -0.15, 0.25);
  add(b.torso, mesh(skirt(0.2, 0.46, 0.26, 8, 0.07, 18), robeDark), 0, 0.52, -0.01).scale.set(1, 1, 0.84);
  add(b.torso, mesh(lathe([[0.2, 0.76], [0.25, 0.86], [0.27, 0.96]], 14), robeDark), 0, 0, -0.08).scale.set(1, 1, 0.88);
  // Wide sleeves that hang open at the wrist, small bronze shoulder plates.
  for (const arm of [b.armL, b.armR]) {
    add(arm, mesh(new THREE.SphereGeometry(0.14, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), trim), 0, 0.04, 0).scale.set(1.1, 0.7, 1.1);
    add(arm, mesh(lathe([[0.1, 0.02], [0.1, -0.1], [0.12, -0.3], [0.17, -0.52], [0.18, -0.57]], 10), robe), 0, 0, 0);
    add(arm, mesh(new THREE.TorusGeometry(0.175, 0.014, 4, 12), trim), 0, -0.56, 0).rotation.x = Math.PI / 2;
  }
  // Deep hood, shadowed face, ember eyes and a long grey beard in strands.
  hood(b.head, 0.28, M(0x4a1410), dark, 0.72, 0.42);
  const beard = [0x8d897f, 0x75716a, 0x9c988d].map((c) => M(c));
  // Wide at the jaw, gathering to an uneven point; strands overlap so it reads as one mass.
  for (let i = 0; i < 11; i++) {
    const a = ((i - 5) / 5) * 0.8;
    const len = 0.27 + 0.1 * Math.cos(a * 2) + ((i * 7) % 3) * 0.018;
    const lean = Math.sin(i * 2.3) * 0.022;
    add(b.head, mesh(taper([[Math.sin(a) * 0.15, -0.075, 0.125 + Math.cos(a) * 0.045], [Math.sin(a) * 0.115 + lean, -0.26, 0.195], [Math.sin(a) * 0.04 + lean, -0.1 - len, 0.2]], 0.058, 0.007, 6, 5), beard[i % 3]), 0, 0, 0);
  }
  // Moustache over it.
  for (const s of [-1, 1]) add(b.head, mesh(taper([[s * 0.005, -0.06, 0.218], [s * 0.075, -0.075, 0.205], [s * 0.125, -0.15, 0.16]], 0.022, 0.006, 4, 4), beard[0]), 0, 0, 0);
  // Gnarled staff with knots, an iron cage around a fire crystal.
  const w = add(b.armL, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  const staff = M(0x3a2414);
  add(w, mesh(taper([[0, -1.0, 0], [0.025, -0.4, 0.015], [-0.025, 0.3, -0.01], [0.035, 0.95, 0.015], [0, 1.15, 0]], 0.03, 0.05, 14, 6), staff), 0, 0, 0);
  for (const [y, x] of [[-0.55, 0.02], [0.45, -0.02], [0.78, 0.03]]) add(w, mesh(sph(0.056, 0), staff), x, y, 0).scale.set(1, 0.8, 1);
  add(w, mesh(cyl(0.05, 0.05, 0.16, 6), dark), 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    add(w, mesh(taper([[0, 1.12, 0], [Math.cos(a) * 0.13, 1.25, Math.sin(a) * 0.13], [Math.cos(a) * 0.11, 1.45, Math.sin(a) * 0.11], [Math.cos(a) * 0.02, 1.56, Math.sin(a) * 0.02]], 0.022, 0.01, 7, 4), M(0x2c2c30, { metalness: 0.7 })), 0, 0, 0);
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
  const b = humanoid({ skin: 0x9c7f95, cloth: 0x2e2546, cloth2: 0x262036, boots: 0x15111e, hip: 0.86, slim: 0.78, eyes: 0xc4a6ff, sculpt: true });
  const leather = M(0x3b3058);
  const strap = M(0x1a1524);
  const violet = M(0x5b3fa8);
  const steel = M(0x8a8f99, { metalness: 0.7 });
  // Fitted vest with crossing straps and a belt of throwing knives.
  add(b.torso, mesh(lathe([[0.17, 0.1], [0.17, 0.22], [0.225, 0.46], [0.245, 0.6], [0.19, 0.68], [0.11, 0.72]], 12), leather), 0, 0, 0).scale.set(1, 1, 0.76);
  for (const s of [-1, 1]) add(b.torso, rot(mesh(box(0.045, 0.76, 0.03), strap), 0, 0, s * 0.6), 0, 0.42, 0.185);
  add(b.torso, mesh(lathe([[0.185, 0.02], [0.195, 0.05], [0.195, 0.09], [0.185, 0.12]], 12), strap), 0, 0, 0).scale.set(1, 1, 0.8);
  for (let i = 0; i < 3; i++) {
    add(b.torso, rot(mesh(box(0.025, 0.1, 0.012), steel), 0, 0, 0.3), -0.1 + i * 0.08, 0.02, 0.17);
    add(b.torso, rot(mesh(box(0.03, 0.05, 0.02), strap), 0, 0, 0.3), -0.113 + i * 0.08, 0.08, 0.17);
  }
  // Masked hood; the eyes come from the body. The mask covers nose and mouth.
  hood(b.head, 0.25, M(0x1b1626), M(0x08060c), 0.72, 0.26);
  add(b.head, mesh(new THREE.SphereGeometry(0.205, 12, 6, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.38), M(0x0e0b14)), 0, 0, 0.025).scale.set(1, 1.1, 1.1);
  // Violet scarf at the neck, two long tails streaming behind her.
  add(b.torso, mesh(lathe([[0.15, 0.66], [0.2, 0.72], [0.19, 0.8], [0.12, 0.84]], 12), violet), 0, 0, 0);
  for (const s of [-1, 1]) add(b.torso, mesh(cloth(0.11, 1.05, 1, 9, (_x, y) => {
    const fall = 1 - y;
    return [Math.sin(fall * 5) * 0.04 * s, fall * 0.12, -fall * 0.82 + Math.sin(fall * 7) * 0.05];
  }), violet), s * 0.07, 0.2, -0.17);
  // Shoulder guards, arm wraps with ridges, wrapped shins, soft boots.
  for (const arm of [b.armL, b.armR]) {
    add(arm, mesh(new THREE.SphereGeometry(0.11, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), leather), 0, 0.03, 0).scale.set(1.1, 0.7, 1.05);
    for (let i = 0; i < 4; i++) add(arm, mesh(new THREE.TorusGeometry(0.063 - i * 0.002, 0.012, 4, 9), strap), 0, -0.36 - i * 0.06, 0).rotation.x = Math.PI / 2 - 0.15;
  }
  for (const leg of [b.legL, b.legR]) {
    add(leg, mesh(new THREE.SphereGeometry(0.09, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.6), strap), 0, -0.34, 0.05).rotation.x = 1.1;
    for (let i = 0; i < 5; i++) add(leg, mesh(new THREE.TorusGeometry(0.073 - i * 0.003, 0.012, 4, 9), strap), 0, -0.45 - i * 0.055, 0).rotation.x = Math.PI / 2 + 0.15;
  }
  // Curved daggers with a guard and a glowing edge, held point-forward.
  const dagger = (h: THREE.Object3D) => {
    const d = add(h, grp(), 0, 0, 0);
    add(d, rot(mesh(cyl(0.022, 0.024, 0.15, 6), strap), Math.PI / 2, 0, 0), 0, 0, 0);
    add(d, rot(mesh(taper([[-0.08, 0, 0], [0, 0, 0.015], [0.08, 0, 0]], 0.022, 0.012, 4, 5), M(0x6f5cb0, { metalness: 0.6 })), 0, 0, 0), 0, 0, 0.085);
    const blade = new THREE.Shape();
    blade.moveTo(0, 0);
    blade.quadraticCurveTo(0.03, 0.3, 0.17, 0.62);
    blade.quadraticCurveTo(-0.02, 0.36, -0.045, 0);
    blade.closePath();
    add(d, rot(mesh(plate(blade, 0.008, 0.005), M(0x9c98b8, { metalness: 0.8, roughness: 0.25 })), Math.PI / 2, Math.PI / 2, 0), 0, 0, 0.09);
    add(d, mesh(tube([[0, 0.012, 0.13], [0, 0.05, 0.42], [0, 0.16, 0.7]], 0.009, 6, 3), glow(0xb69bff, 1.6)), 0, 0, 0);
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
  const bark = 0x4f3724;
  const b = humanoid({ skin: bark, cloth: 0x4e3622, cloth2: 0x3e2b1a, boots: 0x2e2014, bulk: 1.6, hip: 0.9, torsoH: 0.85, eyes: 0x9dff5a, sculpt: true });
  const ridges = [0x352414, 0x402c19, 0x2d1e11].map((c) => M(c));
  const ridge = ridges[0];
  const leaves = [0x35501b, 0x2a4217, 0x405c20].map((c) => M(c));
  const sap = glow(0x9dff5a, 2.2);
  // Trunk: bark plates running up and down, with cracks showing the glowing heart.
  add(b.torso, mesh(lathe([[0.45, 0.06], [0.44, 0.24], [0.5, 0.5], [0.58, 0.72], [0.5, 0.9]], 14), M(0x4a3320)), 0, 0, 0).scale.set(1, 1, 0.88);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.22 && Math.cos(a) > 0) continue; // the crack in front
    const r = 0.5 + (i % 3) * 0.015;
    add(b.torso, mesh(taper([[Math.sin(a) * (r - 0.05), 0.05, Math.cos(a) * (r - 0.05) * 0.88], [Math.sin(a) * r, 0.45, Math.cos(a) * r * 0.88], [Math.sin(a) * (r + 0.07), 0.82, Math.cos(a) * (r + 0.07) * 0.88]], 0.07, 0.035, 5, 5), ridges[i % 3]), 0, 0, 0);
  }
  add(b.torso, mesh(new THREE.OctahedronGeometry(0.13), sap), 0, 0.55, 0.46).scale.set(0.8, 1.4, 0.5);
  for (const s of [-1, 1]) add(b.torso, mesh(taper([[s * 0.04, 0.52, 0.46], [s * 0.11, 0.33, 0.45], [s * 0.1, 0.16, 0.42]], 0.018, 0.004, 5, 4), sap), 0, 0, 0);
  add(b.torso, mesh(taper([[0, 0.6, 0.46], [0.02, 0.76, 0.46]], 0.02, 0.004, 3, 4), sap), 0, 0, 0);
  // Leafy clumps on the shoulders and back, with hanging vines.
  for (const s of [-1, 1]) {
    add(b.torso, mesh(lumpy(new THREE.IcosahedronGeometry(0.32, 1), 0.2, s), leaves[0]), s * 0.58, 0.88, 0).scale.set(1.15, 0.72, 1.1);
    add(b.torso, mesh(lumpy(new THREE.IcosahedronGeometry(0.22, 1), 0.22, s + 3), leaves[1]), s * 0.42, 0.97, -0.2);
    add(b.torso, mesh(lumpy(new THREE.IcosahedronGeometry(0.17, 1), 0.22, s + 5), leaves[2]), s * 0.72, 0.98, 0.1);
    add(b.torso, mesh(taper([[s * 0.7, 0.8, 0.12], [s * 0.76, 0.5, 0.17], [s * 0.72, 0.2, 0.1]], 0.02, 0.006, 5, 4), leaves[1]), 0, 0, 0);
  }
  add(b.torso, mesh(lumpy(new THREE.IcosahedronGeometry(0.3, 1), 0.22, 7), leaves[1]), 0, 0.78, -0.4).scale.set(1.4, 0.75, 0.62);
  // Head: a knotted bark mask with a heavy brow, beard of roots and branching antlers with leaves.
  add(b.head, mesh(lumpy(new THREE.IcosahedronGeometry(0.27, 2), 0.09, 4), M(bark)), 0, 0, 0).scale.set(1.12, 1.02, 1);
  add(b.head, mesh(taper([[-0.24, 0.05, 0.13], [0, 0.095, 0.225], [0.24, 0.05, 0.13]], 0.055, 0.055, 7, 5), ridge), 0, 0, 0);
  for (let i = 0; i < 5; i++) add(b.head, mesh(taper([[(i - 2) * 0.07, -0.16, 0.17], [(i - 2) * 0.075, -0.3, 0.2], [(i - 2) * 0.05, -0.42 - (i % 2) * 0.06, 0.15]], 0.04, 0.006, 4, 4), ridges[i % 3]), 0, 0, 0);
  for (const s of [-1, 1]) {
    const br = add(b.head, rot(grp(), 0, 0, -s * 0.55), s * 0.15, 0.18, -0.05);
    add(br, mesh(taper([[0, 0, 0], [s * 0.05, 0.3, 0], [s * 0.02, 0.64, -0.05]], 0.05, 0.012, 7, 5), ridge), 0, 0, 0);
    add(br, mesh(taper([[s * 0.04, 0.3, 0], [s * 0.2, 0.42, 0.02], [s * 0.3, 0.56, 0]], 0.028, 0.008, 5, 4), ridge), 0, 0, 0);
    add(br, mesh(taper([[-s * 0.0, 0.46, 0], [-s * 0.13, 0.56, -0.02]], 0.02, 0.006, 3, 4), ridge), 0, 0, 0);
    add(br, mesh(lumpy(new THREE.IcosahedronGeometry(0.13, 1), 0.22, s), leaves[0]), 0.01, 0.66, -0.05);
    add(br, mesh(lumpy(new THREE.IcosahedronGeometry(0.1, 1), 0.22, s + 2), leaves[2]), s * 0.31, 0.58, 0);
  }
  // Thick bark forearms and huge root fists with twisted fingers.
  for (const [arm, h] of [[b.armL, b.handL], [b.armR, b.handR]] as const) {
    add(arm, mesh(lathe([[0.15, -0.2], [0.2, -0.36], [0.22, -0.52], [0.18, -0.62]], 9), ridge), 0, 0, 0);
    add(arm, mesh(lumpy(new THREE.IcosahedronGeometry(0.2, 1), 0.2, 2), leaves[0]), 0, 0.08, 0).scale.set(1, 0.6, 1);
    add(h, mesh(lumpy(new THREE.IcosahedronGeometry(0.25, 1), 0.14, 3), M(0x4e3622)), 0, -0.06, 0);
    for (let i = 0; i < 3; i++) add(h, mesh(taper([[(i - 1) * 0.12, -0.16, 0.06], [(i - 1) * 0.17, -0.34, 0.12], [(i - 1) * 0.13, -0.5, 0.05]], 0.065, 0.01, 5, 5), ridge), 0, 0, 0);
    add(h, mesh(taper([[0.15, -0.08, 0.1], [0.26, -0.2, 0.18], [0.22, -0.34, 0.12]], 0.055, 0.01, 4, 5), ridge), 0, 0, 0);
  }
  // Legs of bark, feet spreading into roots.
  for (const leg of [b.legL, b.legR]) {
    add(leg, mesh(lathe([[0.19, -0.26], [0.22, -0.5], [0.25, -0.72], [0.31, -0.86]], 9), ridge), 0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.62;
      add(leg, mesh(taper([[Math.sin(a) * 0.14, -0.78, Math.cos(a) * 0.14], [Math.sin(a) * 0.3, -0.86, Math.cos(a) * 0.3], [Math.sin(a) * 0.44, -0.89, Math.cos(a) * 0.44]], 0.07, 0.012, 4, 5), ridges[i % 3]), 0, 0, 0);
    }
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
  const b = humanoid({ skin: 0xc29676, cloth: 0x0f4c5c, cloth2: 0x0c3a47, boots: 0x0a2a33, hip: 0.95, slim: 0.8, sculpt: true });
  const robe = M(0x0f4c5c);
  const pale = M(0xbfb59b, { metalness: 0.3 });
  const coral = M(0xb4523f);
  const steel = M(0x96aab6, { metalness: 0.75, roughness: 0.3 });
  const water = glow(0x5fe0f5, 1.4, 0.8);
  const hair = M(0x16273d);
  // Flowing robe with deep folds (no legs), a pale hem and overlapping scale panels (named: stays on the body).
  const hang = add(b.root, grp(), 0, 0, 0);
  hang.name = 'robe';
  add(hang, mesh(skirt(0.21, 0.63, 1.05, 11, 0.09), robe), 0, 0, 0).scale.set(1, 1, 0.92);
  add(hang, mesh(skirt(0.62, 0.665, 0.06, 11, 0.08), pale), 0, 0.005, 0).scale.set(1, 1, 0.92);
  for (let i = 0; i < 7; i++) {
    const a = ((i - 3) / 7) * Math.PI;
    add(hang, rot(mesh(cloth(0.15, 0.56, 2, 4, (x, y) => [0, (x - 0.5) * 0, (1 - y) * 0.04]), M(i % 2 ? 0x137a8a : 0x0f6677)), -0.36, a, 0), Math.sin(a) * 0.35, 0.62, Math.cos(a) * 0.33);
  }
  b.legL.visible = b.legR.visible = false;
  add(b.torso, mesh(lathe([[0.19, 0.08], [0.185, 0.2], [0.24, 0.46], [0.26, 0.58], [0.17, 0.68]], 12), M(0x137a8a)), 0, 0, 0).scale.set(1, 1, 0.78);
  add(b.torso, mesh(lathe([[0.2, 0.05], [0.21, 0.08], [0.205, 0.13], [0.19, 0.15]], 12), pale), 0, 0, 0).scale.set(1, 1, 0.8);
  add(b.torso, mesh(lathe([[0.25, 0.6], [0.2, 0.7], [0.11, 0.76]], 12), pale), 0, 0, 0).scale.set(1, 1, 0.8);
  add(b.torso, mesh(sph(0.065, 1), water), 0, 0.55, 0.205);
  add(b.torso, mesh(new THREE.TorusGeometry(0.075, 0.012, 4, 12), pale), 0, 0.55, 0.2);
  // Scallop shells at the shoulders with raised ribs; wrists in pale bands.
  for (const [arm, s] of [[b.armL, -1], [b.armR, 1]] as const) {
    add(arm, mesh(new THREE.SphereGeometry(0.17, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), pale), s * 0.01, 0.03, 0).scale.set(1.08, 0.7, 1.08);
    for (let i = 0; i < 5; i++) {
      const a = ((i - 2) / 2) * 1.05;
      add(arm, mesh(taper([[s * 0.0, 0.15, 0], [s * Math.cos(a) * 0.1, 0.12, Math.sin(a) * 0.1], [s * Math.cos(a) * 0.185, 0.03, Math.sin(a) * 0.185]], 0.016, 0.01, 4, 4), M(0xa1967e)), 0, 0, 0);
    }
    add(arm, mesh(lathe([[0.06, -0.42], [0.076, -0.46], [0.07, -0.54], [0.056, -0.58]], 8), pale), 0, 0, 0);
  }
  // Long hair falling to the back, framing the face; a crown of coral branches.
  add(b.head, mesh(new THREE.SphereGeometry(0.225, 14, 8, Math.PI / 2 + 0.72, Math.PI * 2 - 1.44, 0, Math.PI * 0.7), hair), 0, 0.03, -0.015).scale.set(1.02, 1.05, 1.04);
  add(b.head, mesh(cloth(0.42, 0.82, 6, 7, (x, y) => {
    const fall = 1 - y;
    return [(x - 0.5) * fall * 0.1, fall > 0.85 ? Math.sin(x * 20) * 0.04 : 0, -fall * 0.05 + Math.sin(x * 14) * 0.018];
  }), hair), 0, -0.26, -0.2);
  for (const s of [-1, 1]) add(b.head, mesh(taper([[s * 0.2, 0.03, 0.05], [s * 0.21, -0.2, 0.05], [s * 0.18, -0.42, 0.03]], 0.05, 0.012, 5, 5), hair), 0, 0, 0);
  add(b.head, mesh(new THREE.TorusGeometry(0.205, 0.022, 5, 16), pale), 0, 0.15, 0.0).rotation.x = Math.PI / 2 - 0.12;
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.36;
    const h = 0.25 + (i % 2) * 0.1;
    add(b.head, mesh(taper([[Math.sin(a) * 0.15, 0.17, 0.12], [Math.sin(a) * 0.2, 0.17 + h * 0.6, 0.12], [Math.sin(a) * 0.24, 0.17 + h, 0.1]], 0.024, 0.006, 5, 4), coral), 0, 0, 0);
    add(b.head, mesh(taper([[Math.sin(a) * 0.195, 0.17 + h * 0.5, 0.12], [Math.sin(a) * 0.26 + 0.03, 0.17 + h * 0.75, 0.12]], 0.012, 0.004, 3, 3), coral), 0, 0, 0);
  }
  // Water orb at the left hand.
  add(b.handL, mesh(sph(0.15, 2), water), 0, -0.12, 0.08);
  add(b.handL, mesh(new THREE.TorusGeometry(0.24, 0.018, 4, 20), glow(0xa5f3fc, 1.5, 0.7)), 0, -0.12, 0.08).rotation.x = 1.2;
  // Trident: a bound shaft, curved outer tines, a water gem.
  const w = add(b.armR, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  add(w, mesh(lathe([[0.02, -1.05], [0.03, -0.9], [0.028, 0.6], [0.034, 1.25]], 7), M(0x9a8e6e, { metalness: 0.5 })), 0, 0, 0);
  for (const y of [-0.08, 0.08]) add(w, mesh(cyl(0.045, 0.045, 0.05, 6), M(0x0c3a47)), 0, y, 0);
  add(w, mesh(lathe([[0.034, 1.17], [0.075, 1.24], [0.055, 1.3]], 7), steel), 0, 0, 0);
  add(w, mesh(sph(0.06, 1), water), 0, 1.26, 0.05);
  add(w, mesh(taper([[0, 1.28, 0], [0, 1.5, 0], [0, 1.76, 0]], 0.036, 0.004, 5, 5), steel), 0, 0, 0);
  for (const s of [-1, 1]) add(w, mesh(taper([[0, 1.24, 0], [s * 0.17, 1.27, 0], [s * 0.2, 1.47, 0], [s * 0.15, 1.67, 0]], 0.03, 0.004, 8, 5), steel), 0, 0, 0);
  rot(b.armR, -0.2, 0, 0.12);
  rot(w, 0.2, 0, -0.12);
  rot(b.armL, -0.45, 0, -0.25);
  return b.root;
}


/**
 * Morra the Beastcaller: a wolf's pelt worn as a hood with the jaws over the brow, bone charms,
 * braids, bare arms with bone bangles and a tall staff hung with skulls and feathers ('weapon').
 */
function morra() {
  const b = humanoid({ skin: 0xa87a58, cloth: 0x4f3524, cloth2: 0x3a2a1e, boots: 0x2c2018, hip: 0.95, slim: 0.86, sculpt: true });
  const pelt = [0x5d5245, 0x4c4238, 0x6c6052].map((c) => M(c, { roughness: 0.95 }));
  const leather = M(0x452e1d);
  const bone = M(0xb5a888);
  const hair = M(0x2c1c14);
  const red = M(0x7a2c1c);
  // Hide tunic, a belt of bones, and a skirt of hide strips and fur.
  add(b.torso, mesh(lathe([[0.2, 0.08], [0.2, 0.22], [0.26, 0.48], [0.28, 0.6], [0.2, 0.7], [0.12, 0.76]], 12), leather), 0, 0, 0).scale.set(1, 1, 0.78);
  add(b.torso, mesh(lathe([[0.22, 0], [0.235, 0.03], [0.235, 0.08], [0.22, 0.11]], 12), M(0x2a1b11)), 0, 0, 0).scale.set(1, 1, 0.8);
  for (let i = 0; i < 9; i++) {
    const a = ((i - 4) * Math.PI) / 4.2;
    add(b.torso, rot(mesh(cloth(0.13, 0.5, 1, 4, (x, y) => [0, (x - 0.5) * 0.02, (1 - y) * 0.06 + Math.sin(i + y * 5) * 0.012]), i % 2 ? leather : pelt[i % 3]), 0, a, 0), Math.sin(a) * 0.22, -0.24, Math.cos(a) * 0.18);
  }
  for (let i = 0; i < 5; i++) add(b.torso, mesh(taper([[-0.14 + i * 0.07, 0.02, 0.19], [-0.14 + i * 0.07, -0.08, 0.2]], 0.018, 0.005, 2, 4), bone), 0, 0, 0);
  // Necklace of teeth and a red war-paint sash.
  add(b.torso, mesh(new THREE.TorusGeometry(0.15, 0.009, 4, 16, Math.PI), M(0x2a1b11)), 0, 0.68, 0.11).rotation.set(Math.PI + 0.8, 0, 0);
  for (let i = 0; i < 7; i++) {
    const a = ((i - 3) / 3) * 1.25;
    add(b.torso, mesh(taper([[Math.sin(a) * 0.15, 0.62 - Math.cos(a) * 0.05, 0.2], [Math.sin(a) * 0.15, 0.54 - Math.cos(a) * 0.05, 0.215]], 0.016, 0.003, 2, 4), bone), 0, 0, 0);
  }
  add(b.torso, rot(mesh(box(0.05, 0.6, 0.02), red), 0, 0, -0.65), 0, 0.33, 0.185);
  // The pelt: a shaggy mantle over the shoulders, falling down the back as a cape.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const lump = lumpy(new THREE.IcosahedronGeometry(0.12 + (i % 3) * 0.015, 1), 0.2, i);
    add(b.torso, mesh(lump, pelt[i % 3]), Math.cos(a) * 0.3, 0.76 + (i % 2) * 0.02, Math.sin(a) * 0.23).scale.set(1.15, 0.74, 1.05);
  }
  add(b.torso, mesh(cloth(0.58, 1.22, 8, 10, (x, y) => {
    const fall = 1 - y;
    return [(x - 0.5) * (-0.12 + fall * 0.22), fall > 0.88 ? Math.sin(x * 37) * 0.06 : 0, -fall * 0.1 + Math.sin(x * 24) * (0.01 + fall * 0.035)];
  }), pelt[1]), 0, 0.14, -0.26);
  // Wolf-head hood: skull cap, upper jaw over the brow with teeth, two ears; braids hang in front.
  hood(b.head, 0.24, pelt[0], M(0x14100c), 0.72, 0.05);
  // The wolf's muzzle juts out above her brow; its teeth hang over her eyes, never across them.
  add(b.head, mesh(taper([[0, 0.25, 0.1], [0, 0.26, 0.27], [0, 0.22, 0.42]], 0.105, 0.05, 6, 7), pelt[0]), 0, 0, 0).scale.set(1.1, 0.85, 1);
  add(b.head, mesh(sph(0.03, 0), M(0x14100c)), 0, 0.225, 0.445);
  for (let i = 0; i < 5; i++) add(b.head, mesh(taper([[(i - 2) * 0.034, 0.19, 0.36 - Math.abs(i - 2) * 0.03], [(i - 2) * 0.034, 0.135, 0.36 - Math.abs(i - 2) * 0.03]], 0.012, 0.002, 2, 4), bone), 0, 0, 0);
  for (const s of [-1, 1]) {
    add(b.head, mesh(taper([[s * 0.12, 0.25, -0.03], [s * 0.15, 0.36, -0.03], [s * 0.16, 0.46, -0.05]], 0.06, 0.006, 3, 4), pelt[2]), 0, 0, 0);
    add(b.head, mesh(sph(0.018, 0), glow(0xffb347, 2.2)), s * 0.08, 0.27, 0.27);
    add(b.head, mesh(taper([[s * 0.17, -0.02, 0.09], [s * 0.2, -0.22, 0.1], [s * 0.17, -0.42, 0.09]], 0.04, 0.012, 5, 5), hair), 0, 0, 0);
    add(b.head, mesh(new THREE.TorusGeometry(0.024, 0.008, 3, 8), bone), s * 0.195, -0.28, 0.1).rotation.x = Math.PI / 2;
    add(b.head, mesh(box(0.1, 0.012, 0.012), red), s * 0.095, -0.03, 0.2);
  }
  // Bone bangles, fur on the upper arms, wrapped boots.
  for (const arm of [b.armL, b.armR]) {
    for (let i = 0; i < 3; i++) add(arm, mesh(new THREE.TorusGeometry(0.066, 0.011, 3, 9), bone), 0, -0.42 - i * 0.05, 0).rotation.x = Math.PI / 2;
    add(arm, mesh(lumpy(new THREE.IcosahedronGeometry(0.135, 1), 0.2, 3), pelt[0]), 0, 0.03, 0).scale.set(1.1, 0.8, 1);
  }
  for (const leg of [b.legL, b.legR]) {
    for (let i = 0; i < 5; i++) add(leg, mesh(new THREE.TorusGeometry(0.083 - i * 0.002, 0.012, 3, 9), M(0x2a1b11)), 0, -0.56 - i * 0.055, 0).rotation.x = Math.PI / 2 + 0.12;
  }
  // Staff: a gnarled branch forking at the top around a skull, with feathers and charms.
  const w = add(b.armR, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  const wood = M(0x3a281a);
  add(w, mesh(taper([[0, -0.95, 0], [0.025, -0.3, 0.01], [-0.02, 0.45, -0.01], [0.015, 1.0, 0]], 0.028, 0.044, 12, 6), wood), 0, 0, 0);
  add(w, mesh(taper([[0.015, 1.0, 0], [0.13, 1.25, 0.02], [0.1, 1.55, 0]], 0.04, 0.01, 6, 5), wood), 0, 0, 0);
  add(w, mesh(taper([[0.015, 1.0, 0], [-0.12, 1.28, -0.02], [-0.07, 1.6, 0]], 0.04, 0.01, 6, 5), wood), 0, 0, 0);
  add(w, mesh(sph(0.1, 1), bone), 0, 1.3, 0.01).scale.set(0.9, 1, 1.05);
  add(w, mesh(box(0.1, 0.05, 0.1), bone), 0, 1.22, 0.05);
  for (const s of [-1, 1]) add(w, mesh(sph(0.018, 0), glow(0xffb347, 2.4)), s * 0.034, 1.32, 0.095);
  for (const [x, y, c] of [[0.14, 1.12, 0x7a2c1c], [-0.13, 1.1, 0x6c6052], [0.1, 0.96, 0x4c4238]] as const) {
    add(w, mesh(cloth(0.05, 0.26, 1, 3, (_a, k) => [0, 0, (1 - k) * 0.05]), M(c)), x, y, 0);
  }
  rot(b.armR, -0.25, 0, 0.14);
  rot(w, 0.25, 0, -0.1);
  rot(b.armL, -0.2, 0, -0.14);
  return b.root;
}

/**
 * Seren the Aegis: a guardian in pale silver and white, a floating ring of light over a silver
 * braid, winged pauldrons, a round shield with a glowing sun and a flanged mace ('weapon').
 */
function seren() {
  const b = humanoid({ skin: 0xc9a58a, cloth: 0xb9bcc0, cloth2: 0x8c8f94, boots: 0x6f7277, hip: 0.97, slim: 0.84, sculpt: true });
  const silver = M(0x9aa2aa, { metalness: 0.75, roughness: 0.35 });
  const dark = M(0x5a6068, { metalness: 0.7 });
  const brass = M(0x9c8247, { metalness: 0.7, roughness: 0.35 });
  const white = M(0xc8c6bc);
  const hair = M(0xa7abb0);
  const light = glow(0xffe9a8, 2.4);
  // Breastplate with a raised ridge, plate skirt over a white under-robe.
  add(b.torso, mesh(lathe([[0.215, 0.24], [0.27, 0.46], [0.295, 0.6], [0.22, 0.7], [0.12, 0.76]], 14), silver), 0, 0, 0).scale.set(1, 1, 0.78);
  add(b.torso, mesh(box(0.035, 0.46, 0.04), brass), 0, 0.48, 0.205);
  add(b.torso, mesh(new THREE.OctahedronGeometry(0.055), light), 0, 0.56, 0.235);
  add(b.torso, mesh(lathe([[0.2, 0.1], [0.225, 0.18], [0.215, 0.26]], 14), dark), 0, 0, 0).scale.set(1, 1, 0.8);
  add(b.torso, mesh(lathe([[0.215, 0], [0.23, 0.03], [0.23, 0.09], [0.215, 0.12]], 14), brass), 0, 0, 0).scale.set(1, 1, 0.8);
  add(b.torso, mesh(skirt(0.21, 0.36, 0.62, 8, 0.05, 16), white), 0, -0.6, 0).scale.set(1, 1, 0.84);
  for (let i = 0; i < 6; i++) {
    const a = ((i - 2.5) * Math.PI) / 3;
    add(b.torso, rot(mesh(cloth(0.15, 0.34, 1, 2, (_x, y) => [0, 0, (1 - y) * 0.09]), silver), 0, a, 0), Math.sin(a) * 0.21, -0.16, Math.cos(a) * 0.175);
  }
  // White cape from the shoulders, long and clean, with a brass edge.
  add(b.torso, mesh(cloth(0.6, 1.5, 8, 10, (x, y) => {
    const fall = 1 - y;
    return [(x - 0.5) * (-0.14 + fall * 0.24), 0, -fall * 0.09 + Math.sin(x * 22) * (0.008 + fall * 0.03)];
  }), white), 0, 0.02, -0.25);
  // Winged pauldrons, vambraces, greaves.
  for (const [arm, s] of [[b.armL, -1], [b.armR, 1]] as const) {
    add(arm, mesh(new THREE.SphereGeometry(0.155, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), silver), s * 0.01, 0.03, 0).scale.set(1.1, 0.75, 1.05);
    add(arm, mesh(new THREE.TorusGeometry(0.15, 0.012, 4, 14), brass), s * 0.01, 0.03, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) add(arm, mesh(taper([[s * 0.06, 0.1 - i * 0.03, -0.04], [s * 0.17, 0.2 - i * 0.04, -0.11], [s * (0.27 - i * 0.04), 0.26 - i * 0.07, -0.2]], 0.03, 0.006, 4, 4), i === 1 ? brass : silver), 0, 0, 0);
    add(arm, mesh(lathe([[0.066, -0.34], [0.082, -0.38], [0.072, -0.5], [0.06, -0.59]], 8), silver), 0, 0, 0);
    add(arm, mesh(sph(0.078, 1), dark), 0, -0.67, 0.01).scale.set(0.95, 0.8, 1.1);
  }
  for (const leg of [b.legL, b.legR]) {
    add(leg, mesh(lathe([[0.105, -0.32], [0.112, -0.45], [0.1, -0.64], [0.085, -0.83]], 9), silver), 0, 0, 0.005);
    add(leg, mesh(new THREE.SphereGeometry(0.095, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.6), brass), 0, -0.36, 0.05).rotation.x = 1.1;
  }
  // Silver hair in a long braid, a circlet and a ring of light floating above.
  add(b.head, mesh(new THREE.SphereGeometry(0.222, 14, 8, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.72), hair), 0, 0.025, -0.01).scale.set(1.02, 1.05, 1.04);
  add(b.head, mesh(new THREE.SphereGeometry(0.224, 12, 4, Math.PI / 2 - 0.9, 1.8, 0, 0.82), hair), 0, 0.025, -0.01).scale.set(1.02, 1.05, 1.04);
  add(b.head, mesh(taper([[0, -0.02, -0.2], [0.02, -0.3, -0.24], [-0.01, -0.62, -0.26], [0.01, -0.86, -0.27]], 0.058, 0.014, 8, 6), hair), 0, 0, 0);
  add(b.head, mesh(new THREE.TorusGeometry(0.208, 0.016, 4, 18), brass), 0, 0.09, 0).rotation.x = Math.PI / 2 - 0.2;
  add(b.head, mesh(new THREE.OctahedronGeometry(0.03), light), 0, 0.13, 0.21);
  add(b.head, mesh(new THREE.TorusGeometry(0.2, 0.014, 5, 24), light), 0, 0.42, -0.03).rotation.x = Math.PI / 2 - 0.2;
  // Round shield on the left arm: a dished disc with a brass rim and a sun of light.
  const sh = add(b.armL, grp(), 0.02, -0.46, 0.2);
  rot(sh, 0.7, 0, 0);
  add(sh, rot(mesh(lathe([[0.001, 0.07], [0.2, 0.05], [0.42, -0.012]], 16), silver), Math.PI / 2, 0, 0), 0, 0, 0);
  add(sh, mesh(new THREE.TorusGeometry(0.42, 0.03, 5, 22), brass), 0, 0, -0.012);
  add(sh, rot(mesh(cyl(0.42, 0.42, 0.015, 18), dark), Math.PI / 2, 0, 0), 0, 0, -0.018);
  add(sh, mesh(box(0.05, 0.3, 0.03), M(0x3a2717)), 0, 0, -0.04);
  add(sh, mesh(new THREE.TorusGeometry(0.12, 0.012, 4, 14), light), 0, 0, 0.06);
  add(sh, mesh(sph(0.055, 1), light), 0, 0, 0.075);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add(sh, rot(mesh(box(0.024, i % 2 ? 0.13 : 0.2, 0.012), i % 2 ? brass : light), 0, 0, -a + Math.PI / 2), Math.cos(a) * (i % 2 ? 0.21 : 0.25), Math.sin(a) * (i % 2 ? 0.21 : 0.25), 0.04);
  }
  // Flanged mace.
  const w = add(b.armR, grp(), 0, -0.62, 0.03);
  w.name = 'weapon';
  add(w, mesh(lathe([[0.03, -0.24], [0.034, 0], [0.03, 0.55], [0.036, 0.72]], 7), M(0x3a3024)), 0, 0, 0);
  add(w, mesh(sph(0.052, 0), brass), 0, -0.27, 0);
  for (let i = 0; i < 5; i++) add(w, mesh(cyl(0.037, 0.037, 0.018, 7), dark), 0, -0.1 + i * 0.05, 0);
  add(w, mesh(lathe([[0.04, 0.7], [0.09, 0.82], [0.085, 0.96], [0.02, 1.08]], 8), silver), 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(w, rot(mesh(box(0.14, 0.27, 0.025), i % 2 ? silver : dark), 0, -a, 0), Math.cos(a) * 0.1, 0.88, Math.sin(a) * 0.1);
  }
  add(w, mesh(new THREE.OctahedronGeometry(0.04), light), 0, 1.09, 0);
  rot(b.armL, -0.75, 0, -0.16);
  rot(b.armR, -0.15, 0, 0.14);
  return b.root;
}

/**
 * Rhen the Galewalker: a long weathered coat with tails, a broad hat with a feather, a scarf that
 * trails in the wind, a bandolier of bolts and a heavy crossbow held in both hands ('weapon').
 */
function rhen() {
  const b = humanoid({ skin: 0xb88a64, cloth: 0x4a4a32, cloth2: 0x33302a, boots: 0x2b2118, hip: 0.98, slim: 0.84, sculpt: true });
  const coat = M(0x53502f);
  const coatDark = M(0x3b3a26);
  const leather = M(0x4b3220);
  const dark = M(0x1f1913);
  const scarf = M(0x8c4a2a);
  const brass = M(0x8f7136, { metalness: 0.65, roughness: 0.35 });
  const steel = M(0x868c92, { metalness: 0.75, roughness: 0.3 });
  // Coat body with lapels, a belt, and long tails split at the back.
  add(b.torso, mesh(lathe([[0.2, 0.04], [0.205, 0.22], [0.26, 0.46], [0.285, 0.6], [0.21, 0.7], [0.13, 0.76]], 12), coat), 0, 0, 0).scale.set(1, 1, 0.78);
  add(b.torso, mesh(lathe([[0.215, 0.02], [0.23, 0.05], [0.23, 0.1], [0.215, 0.13]], 12), leather), 0, 0, 0).scale.set(1, 1, 0.8);
  add(b.torso, mesh(box(0.08, 0.08, 0.04), brass), 0, 0.075, 0.185);
  for (const s of [-1, 1]) {
    add(b.torso, rot(mesh(box(0.09, 0.34, 0.03), coatDark), -0.08, 0, s * -0.3), s * 0.1, 0.52, 0.2);
    add(b.torso, mesh(cloth(0.26, 1.06, 3, 9, (x, y) => {
      const fall = 1 - y;
      return [s * fall * 0.1, 0, -fall * 0.22 + Math.sin(x * 9 + y * 2) * 0.016];
    }), s < 0 ? coat : coatDark), s * 0.13, -0.44, -0.16);
    add(b.torso, mesh(cloth(0.2, 0.68, 2, 5, (_x, y) => [s * (1 - y) * 0.08, 0, (1 - y) * 0.04]), coat), s * 0.14, -0.3, 0.14);
    add(b.torso, mesh(sph(0.035, 0), brass), s * 0.06, 0.4 - (s + 1) * 0.0, 0.215);
  }
  // Bandolier of bolts across the chest.
  add(b.torso, rot(mesh(box(0.06, 0.8, 0.03), leather), 0, 0, -0.68), 0, 0.42, 0.195);
  for (let i = 0; i < 6; i++) {
    const k = (i - 2.5) * 0.095;
    add(b.torso, rot(mesh(cyl(0.012, 0.012, 0.13, 4), steel), 0, 0, -0.68), k * 0.63 * 1.25, 0.42 - k * 0.77 * 1.25, 0.215);
  }
  // Scarf at the neck, one long tail streaming behind.
  add(b.torso, mesh(lathe([[0.14, 0.66], [0.2, 0.72], [0.19, 0.8], [0.12, 0.84]], 12), scarf), 0, 0, 0).scale.set(1, 1, 0.9);
  add(b.torso, mesh(cloth(0.15, 1.1, 2, 9, (x, y) => {
    const fall = 1 - y;
    return [Math.sin(fall * 5 + x) * 0.05, fall * 0.28, -fall * 0.86 + Math.sin(fall * 8) * 0.05];
  }), scarf), 0.1, 0.25, -0.15);
  // Broad-brimmed hat, a feather, a short beard; the eyes sit in the brim's shadow.
  add(b.head, mesh(lathe([[0.12, 0.09], [0.205, 0.1], [0.335, 0.05], [0.42, 0.03]], 16), M(0x2f2c1c)), 0, 0.04, 0).scale.set(1, 1, 0.96);
  add(b.head, mesh(lathe([[0.42, 0.015], [0.335, 0.03], [0.2, 0.08]], 16), M(0x201d13)), 0, 0.04, 0).scale.set(1, 1, 0.96);
  add(b.head, mesh(lathe([[0.2, 0.09], [0.19, 0.18], [0.16, 0.27], [0.1, 0.32], [0.001, 0.335]], 12), M(0x38351f)), 0, 0.04, -0.005);
  add(b.head, mesh(new THREE.TorusGeometry(0.195, 0.018, 4, 16), scarf), 0, 0.15, -0.005).rotation.x = Math.PI / 2;
  add(b.head, mesh(cloth(0.05, 0.48, 1, 5, (_x, y) => [0, 0, -y * 0.2]), M(0x9aa84e)), 0.19, 0.31, -0.03).rotation.z = -0.32;
  add(b.head, mesh(new THREE.SphereGeometry(0.2, 12, 5, 0, Math.PI * 2, Math.PI * 0.68, Math.PI * 0.3), M(0x3d2a1b)), 0, 0.005, 0.02).scale.set(0.98, 1.14, 1.06);
  // Gloves, bracers, tall boots with brass buckles.
  for (const arm of [b.armL, b.armR]) {
    add(arm, mesh(lathe([[0.1, 0.03], [0.1, -0.1], [0.085, -0.3], [0.08, -0.42], [0.09, -0.46]], 8), coat), 0, 0, 0);
    add(arm, mesh(sph(0.078, 1), dark), 0, -0.67, 0.01).scale.set(0.95, 0.85, 1.1);
    add(arm, mesh(lathe([[0.062, -0.46], [0.074, -0.5], [0.065, -0.59]], 8), leather), 0, 0, 0);
  }
  for (const leg of [b.legL, b.legR]) {
    add(leg, mesh(lathe([[0.11, -0.46], [0.105, -0.5], [0.092, -0.7], [0.082, -0.92]], 8), leather), 0, 0, 0);
    add(leg, mesh(new THREE.TorusGeometry(0.1, 0.012, 4, 10), brass), 0, -0.62, 0).rotation.x = Math.PI / 2;
  }
  // Heavy crossbow: stock, steel prod with a string, stirrup and a loaded bolt. Faces +z.
  const w = add(b.armR, grp(), 0, -0.62, 0.02);
  w.name = 'weapon';
  add(w, mesh(box(0.07, 0.09, 0.92), M(0x3a2717)), 0, 0.02, 0.2);
  add(w, mesh(box(0.08, 0.15, 0.3), M(0x2b1c11)), 0, -0.03, -0.22);
  add(w, mesh(box(0.05, 0.012, 0.7), M(0x57402a)), 0, 0.072, 0.3);
  for (const s of [-1, 1]) {
    add(w, mesh(taper([[0, 0.05, 0.62], [s * 0.27, 0.05, 0.54], [s * 0.46, 0.05, 0.34]], 0.032, 0.012, 7, 5), steel), 0, 0, 0);
    add(w, mesh(tube([[s * 0.46, 0.05, 0.34], [s * 0.2, 0.075, 0.12], [0, 0.075, 0.03]], 0.005, 3, 3), M(0xb2ae9a)), 0, 0, 0);
  }
  add(w, mesh(new THREE.TorusGeometry(0.08, 0.012, 4, 10), steel), 0, 0.05, 0.71).rotation.x = Math.PI / 2;
  add(w, rot(mesh(cyl(0.011, 0.011, 0.62, 4), M(0xa89f82)), Math.PI / 2, 0, 0), 0, 0.085, 0.34);
  add(w, rot(mesh(cone(0.03, 0.09, 4), steel), Math.PI / 2, 0, 0), 0, 0.085, 0.69);
  for (const y of [0.11, 0.06]) add(w, mesh(box(0.012, 0.05, 0.1), M(0x9aa84e)), 0, y, 0.06);
  rot(b.armR, -0.75, 0, 0.1);
  rot(w, 0.78, 0, -0.05);
  rot(b.armL, -1.0, 0, 0.22);
  return b.root;
}

/**
 * Four-legged creatures on the same joints as everything else: the front legs are the arms, the
 * back legs the legs. Body along +z.
 */
function beast(o: { len: number; high: number; girth: number; fur: number[]; team: number; rune: number; alpha?: boolean; longEars?: boolean }): THREE.Group {
  const f = o.fur.map((c) => M(c, { roughness: 0.95 }));
  const root = grp();
  const torso = add(root, grp(), 0, o.high, 0);
  const g = o.girth;
  const L = o.len;
  // Body: broad at the chest, tucked at the hips.
  const body = lumpy(lathe([[0.001, -L * 0.52], [g * 0.7, -L * 0.42], [g * 0.82, -L * 0.1], [g, L * 0.22], [g * 0.92, L * 0.42], [0.001, L * 0.56]], 10), 0.05, o.len);
  add(torso, rot(mesh(body, f[0]), Math.PI / 2, 0, 0), 0, 0, 0).scale.set(1, 1, 1.02);
  // Shaggy ridge down the spine.
  for (let i = 0; i < 7; i++) {
    const z = (i / 6 - 0.5) * L * 0.9;
    const up = g * (0.82 + (z / L + 0.5) * 0.2);
    const tuft = o.alpha ? 1.2 : 1.06;
    add(torso, mesh(taper([[0, up * 0.72, z + 0.03], [0, up * (tuft - 0.1), z - 0.05], [(i % 2) * 0.02, up * tuft, z - 0.16]], g * 0.26, 0.012, 3, 5), f[i % f.length]), 0, 0, 0);
  }
  if (o.alpha) {
    // A heavy mane over the shoulders and scars of ember down the flanks.
    add(torso, mesh(lumpy(new THREE.IcosahedronGeometry(g * 0.92, 1), 0.14, 5), f[1]), 0, g * 0.3, L * 0.26).scale.set(1.05, 0.95, 1.1);
    for (const s of [-1, 1]) {
      add(torso, rot(mesh(box(0.02, 0.24, 0.07), glow(0xff8a4a, 2)), 0.35, 0, s * 0.42), s * g * 0.9, 0.03, L * 0.02);
      add(torso, rot(mesh(box(0.02, 0.18, 0.06), glow(0xff8a4a, 2)), -0.45, 0, s * 0.42), s * g * 0.86, -0.02, -L * 0.12);
    }
  }
  // Team-coloured collar.
  add(torso, mesh(new THREE.TorusGeometry(g * 0.56, g * 0.1, 5, 14), glow(o.rune, 1.2)), 0, g * 0.14, L * 0.42);
  // Head: skull, muzzle, jaw, ears, teeth and glowing eyes.
  const head = add(torso, grp(), 0, g * 0.38, L * 0.55);
  const hs = 1;
  add(head, mesh(lumpy(new THREE.IcosahedronGeometry(g * 0.56, 1), 0.06, 2), f[0]), 0, 0, 0).scale.set(1, 0.92, 1.08);
  add(head, rot(mesh(lathe([[0.001, 0.56 * g * hs], [g * 0.2, g * 0.46 * hs], [g * 0.3, g * 0.12]], 8), f[2]), Math.PI / 2, 0, 0), 0, -g * 0.08, g * 0.34);
  add(head, mesh(sph(g * 0.09, 0), M(0x14110e)), 0, -g * 0.03, g * (0.92 + (hs - 1) * 0.5));
  add(head, rot(mesh(lathe([[0.001, 0.44 * g * hs], [g * 0.17, g * 0.3 * hs], [g * 0.2, 0]], 7), M(0x241b14)), Math.PI / 2 + 0.2, 0, 0), 0, -g * 0.27, g * 0.3);
  for (const s of [-1, 1]) {
    add(head, mesh(taper((o.longEars ? [[s * g * 0.26, g * 0.38, -g * 0.08], [s * g * 0.38, g * 0.95, -g * 0.18], [s * g * 0.46, g * 1.5, -g * 0.34]] : [[s * g * 0.3, g * 0.38, -g * 0.08], [s * g * 0.36, g * 0.62, -g * 0.1], [s * g * 0.4, g * 0.92, -g * 0.14]]) as [number, number, number][], o.longEars ? g * 0.22 : g * 0.17, 0.012, 3, 4), f[1]), 0, 0, 0);
    add(head, mesh(sph(g * 0.055, 0), glow(0xffc247, 2.4)), s * g * 0.24, g * 0.14, g * 0.46);
    add(head, mesh(taper([[s * g * 0.12, -g * 0.24, g * 0.66], [s * g * 0.12, -g * 0.37, g * 0.66]], g * 0.05, 0.003, 2, 4), M(0xbdb092)), 0, 0, 0);
  }
  // Legs: the two front ones hang off the torso, as arms.
  const leg = (name: string, x: number, z: number, big: number) => {
    const j = add(z > 0 ? torso : root, grp(), x, z > 0 ? -g * 0.2 : o.high - g * 0.25, z);
    j.name = name;
    const H = o.high - (z > 0 ? g * 0.2 : g * 0.25);
    add(j, mesh(lumpy(new THREE.IcosahedronGeometry(g * 0.42 * big, 1), 0.06, x), f[0]), 0, -H * 0.05, 0).scale.set(0.85, 1.25, 1.05);
    add(j, mesh(lathe([[g * 0.3 * big, 0], [g * 0.32 * big, -H * 0.3], [g * 0.2 * big, -H * 0.6], [g * 0.17 * big, -H * 0.9], [g * 0.24 * big, -H]], 7), f[1]), 0, 0, 0);
    add(j, mesh(sph(g * 0.25 * big, 0), f[2]), 0, -H + g * 0.1, g * 0.07).scale.set(1, 0.65, 1.3);
    for (const s of [-1, 0, 1]) add(j, mesh(taper([[s * g * 0.13, -H + g * 0.06, g * 0.22], [s * g * 0.14, -H + g * 0.01, g * 0.36]], g * 0.05, 0.003, 2, 4), M(0x28221c)), 0, 0, 0);
    return j;
  };
  const side = g * 0.7;
  leg('armL', -side, L * 0.32, 1.05);
  leg('armR', side, L * 0.32, 1.05);
  leg('legL', -side * 0.85, -L * 0.34, 1);
  leg('legR', side * 0.85, -L * 0.34, 1);
  // The bake step looks for hand joints on anything with a body; these hold nothing.
  const hl = add(root, grp());
  hl.name = 'handL';
  const hr = add(root, grp());
  hr.name = 'handR';
  // Tail.
  add(torso, mesh(taper([[0, g * 0.3, -L * 0.48], [0, g * 0.5, -L * 0.72], [0, g * 0.15, -L * 0.98]], g * 0.26, 0.015, 5, 5), f[1]), 0, 0, 0);
  root.name = 'rig';
  torso.name = 'torso';
  head.name = 'head';
  return root;
}

function wolf(team: 0 | 1) {
  return beast({ len: 1.5, high: 0.86, girth: 0.3, fur: [0x5f5a52, 0x47433d, 0x77716a], team, rune: team === 0 ? 0x62aef0 : 0xf07a5a });
}
/** Morra as the Red Wolf: blood-red, bigger than her wolves, with a mane and ember scars. */
function redWolf(team: 0 | 1) {
  return beast({ len: 1.75, high: 1.02, girth: 0.37, fur: [0x7a2418, 0x571a12, 0x98321f], team, rune: team === 0 ? 0x62aef0 : 0xf07a5a, alpha: true });
}
export const HERO_BUILDERS: Record<HeroId, () => THREE.Group> = { brakk, vexa, orin, syl, grom, kaela, morra, seren, rhen };
/**
 * The courier: a sturdy pack mule in the team's colours. Long head, long ears, a short stiff mane,
 * hooves, saddlebags, a bedroll and a little lantern. After 6:00 it grows great feathered wings.
 */
function mule(fly: boolean, team: 0 | 1) {
  const coat = M(0x6e5843, { roughness: 0.95 });
  const dark = M(0x3f3126, { roughness: 0.95 });
  const pale = M(0x9c8870, { roughness: 0.95 });
  const hoof = M(0x1e1a16);
  const tc = M(team === 0 ? 0x234f96 : 0x96272b);
  const leather = M(0x3f2c1c);
  const high = 0.8;
  const root = grp();
  const torso = add(root, grp(), 0, high, 0);
  torso.name = 'torso';
  // Barrel of a body, deep at the chest and round at the rump.
  add(torso, rot(mesh(lumpy(lathe([[0.001, -0.56], [0.2, -0.48], [0.27, -0.26], [0.26, 0.05], [0.29, 0.3], [0.2, 0.5], [0.001, 0.58]], 10), 0.025, 3), coat), Math.PI / 2, 0, 0), 0, 0, 0);
  // Neck, carried low and forward, with a stiff dark mane.
  add(torso, mesh(taper([[0, 0.06, 0.4], [0, 0.26, 0.56], [0, 0.42, 0.7]], 0.17, 0.095, 6, 7), coat), 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const k = i / 5;
    add(torso, mesh(box(0.035, 0.1, 0.075), dark), 0, 0.24 + k * 0.28, 0.44 + k * 0.28).rotation.x = -0.65;
  }
  const head = add(torso, grp(), 0, 0.46, 0.74);
  head.name = 'head';
  // Long plain face, pale soft muzzle, dark calm eyes.
  add(head, mesh(taper([[0, 0.02, -0.04], [0, -0.09, 0.17], [0, -0.17, 0.36]], 0.115, 0.075, 6, 7), coat), 0, 0, 0);
  add(head, mesh(sph(0.083, 1), pale), 0, -0.19, 0.39).scale.set(1, 0.85, 1.15);
  for (const s of [-1, 1]) {
    add(head, mesh(sph(0.019, 0), M(0x0d0b09)), s * 0.1, 0, 0.09);
    add(head, mesh(sph(0.012, 0), M(0x14100c)), s * 0.04, -0.17, 0.47);
    // The ears give it away: tall, leaning apart, dark at the tip.
    add(head, mesh(taper([[s * 0.05, 0.08, -0.06], [s * 0.1, 0.27, -0.1], [s * 0.15, 0.46, -0.16]], 0.05, 0.012, 4, 5), coat), 0, 0, 0).scale.z = 0.7;
  }
  // Rope bridle in team colour.
  add(head, rot(mesh(new THREE.TorusGeometry(0.087, 0.012, 4, 12), tc), 0.5, 0, 0), 0, -0.13, 0.28);
  // Legs: straight and thin, knobbly knees, solid hooves.
  const leg = (name: string, x: number, z: number) => {
    const front = z > 0;
    const j = add(front ? torso : root, grp(), x, front ? -0.12 : high - 0.12, z);
    j.name = name;
    const H = high - 0.12;
    add(j, mesh(lumpy(sph(0.14, 1), 0.02, x), coat), 0, -0.05, 0).scale.set(0.85, 1.3, 1.1);
    add(j, mesh(lathe([[0.1, 0], [0.085, -H * 0.42], [0.058, -H * 0.5], [0.05, -H * 0.86], [0.066, -H * 0.9]], 7), coat), 0, 0, 0);
    add(j, mesh(sph(0.06, 0), dark), 0, -H * 0.5, 0.01);
    add(j, mesh(cyl(0.062, 0.085, 0.08, 7), hoof), 0, -H + 0.04, 0.01);
    return j;
  };
  leg('armL', -0.17, 0.32);
  leg('armR', 0.17, 0.32);
  leg('legL', -0.17, -0.36);
  leg('legR', 0.17, -0.36);
  const handL = add(root, grp(), 0, 0, 0);
  handL.name = 'handL';
  const handR = add(root, grp(), 0, 0, 0);
  handR.name = 'handR';
  // Thin tail with a dark brush.
  add(torso, mesh(taper([[0, 0.14, -0.54], [0, 0.0, -0.66], [0, -0.26, -0.7]], 0.032, 0.022, 5, 5), coat), 0, 0, 0);
  add(torso, mesh(taper([[0, -0.22, -0.7], [0, -0.38, -0.71], [0, -0.5, -0.68]], 0.05, 0.012, 3, 5), dark), 0, 0, 0);
  // Blanket, saddle, bedroll, bulging saddlebags and a lantern.
  add(torso, mesh(box(0.44, 0.03, 0.46), tc), 0, 0.27, -0.04);
  for (const s of [-1, 1]) add(torso, rot(mesh(box(0.03, 0.24, 0.46), tc), 0, 0, s * 0.42), s * 0.26, 0.17, -0.04);
  add(torso, mesh(box(0.24, 0.07, 0.34), leather), 0, 0.3, -0.04);
  add(torso, rot(mesh(cyl(0.085, 0.085, 0.46, 8), M(0x7a6a4f)), 0, 0, Math.PI / 2), 0, 0.33, -0.26);
  for (const s of [-1, 1]) {
    add(torso, mesh(lumpy(sph(0.14, 1), 0.03, s), leather), s * 0.3, -0.03, -0.08).scale.set(0.58, 1.1, 1.15);
    add(torso, mesh(box(0.018, 0.08, 0.2), tc), s * 0.385, 0.03, -0.08);
  }
  add(torso, mesh(cyl(0.04, 0.05, 0.09, 6), M(0x2a2622)), 0.32, -0.02, 0.2);
  add(torso, mesh(sph(0.034, 0), glow(0xffc247, 2.6)), 0.32, -0.02, 0.2);
  if (fly) {
    const tones = [0xcdc7b8, 0xb9b2a1, 0xa89f8d].map((c) => M(c, { roughness: 0.9 }));
    for (const s of [-1, 1]) {
      const wing = add(torso, grp(), s * 0.15, 0.25, 0.14);
      wing.rotation.z = s * 0.42;
      // The arm of the wing, then long flight feathers fanning out from it, under shorter coverts.
      add(wing, mesh(taper([[0, 0, 0], [s * 0.42, 0.05, 0.03], [s * 0.86, 0.02, -0.04]], 0.032, 0.012, 5, 5), tones[2]), 0, 0, 0);
      const row = (n: number, len: number, wide: number, y: number, tone: number) => {
        for (let i = 0; i < n; i++) {
          const k = i / (n - 1);
          const l = len * (0.62 + k * 0.5);
          const fan = s * (0.05 + k * k * 0.85);
          const f = add(wing, mesh(sph(1, 1), tones[(i + tone) % 3]), s * (0.06 + k * 0.8) + Math.sin(fan) * l * 0.5, y, -0.02 - Math.cos(fan) * l * 0.5);
          f.scale.set(wide, 0.012, l * 0.5);
          f.rotation.y = -fan;
        }
      };
      row(10, 0.72, 0.06, 0, 0);
      row(8, 0.36, 0.052, 0.02, 1);
    }
  }
  root.name = 'rig';
  return root;
}

export { wolf, redWolf, mule };

/** Everything else: creeps, jungle monsters, buildings, wards, power-ups. */
export { humanoid, M, glow, add, mesh, box, cyl, sph, cone, grp, rot, lathe, taper, plate, cloth, skirt, lumpy, hood };
export type { Body };
/** Kept for the model catalogue (the old concept builders put scene extras in a group). */
export function resetFx() {}
