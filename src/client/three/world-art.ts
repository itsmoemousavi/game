import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GameMap, House, LANE_IDS, LANE_WIDTH } from '../../sim';

/**
 * The painted look of the 3D map: textured ground, flowing river, foliage that sways, carved
 * rocks and stone walls, undergrowth and night fireflies. All of it is our own, made in code.
 *
 * Rule for everything here: it is decoration only. Nothing moves or lights up in response to
 * units, so nothing can give away a hidden hero; wind, water and fireflies run on the clock alone,
 * and props stand where they can't hide anybody (low grass, or inside cells nobody can walk on).
 */

/** How much of the living world to draw (battery): Low keeps only what costs almost nothing. */
export interface ArtLevel {
  /** Tiling ground detail, cloud shadows. */
  groundDetail: boolean;
  /** Wind in trees and grass. */
  sway: boolean;
  /** Pine layers per tree (more = fuller trees). */
  pineTiers: number;
  /** Grass tufts on the whole map. */
  tufts: number;
  /** Fireflies on the whole map at night. */
  fireflies: number;
}
export const ART_LEVEL: Record<'low' | 'medium' | 'high', ArtLevel> = {
  low: { groundDetail: false, sway: false, pineTiers: 3, tufts: 0, fireflies: 800 },
  medium: { groundDetail: true, sway: true, pineTiers: 4, tufts: 9000, fireflies: 1800 },
  high: { groundDetail: true, sway: true, pineTiers: 5, tufts: 18000, fireflies: 2600 },
};

/** Instanced props are split into map tiles of this size, so off-screen tiles aren't drawn. */
const TILE = 60;

const rnd = (a: number, b = 0, c = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rgb = (hex: number) => new THREE.Color(hex);

/** Give a geometry per-vertex colours from a function. */
function paint(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, c: THREE.Color) => void) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Merge parts that each have position + normal + color. */
function merge(parts: THREE.BufferGeometry[]) {
  const flat = parts.map((p) => {
    const f = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') f.deleteAttribute(k);
    return f;
  });
  return mergeGeometries(flat)!;
}

// ------------------------------------------------------------------ foliage shapes

function trunkPart(h: number, r0: number, r1: number, hex: number) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 5, 1, true).translate(0, h / 2, 0);
  const a = rgb(hex).multiplyScalar(0.55);
  const b = rgb(hex);
  return paint(g, (_x, y, _z, c) => c.copy(a).lerp(b, smooth(0, h, y)));
}

/** Layered pine: each layer has a jagged, drooping rim, dark near the trunk and sunlit at the tips. */
function pineGeo(seed: number, tiers: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [trunkPart(1.8, 0.28, 0.16, 0x4a3524)];
  const segs = 9;
  const inner = rgb(0x0b1812);
  const outer = rgb(0x24402a);
  const top = rgb(0x3a5a34);
  for (let i = 0; i < tiers; i++) {
    const t = tiers > 1 ? i / (tiers - 1) : 0;
    const radius = lerp(1.62, 0.42, t);
    const height = lerp(1.7, 1.15, t);
    const y0 = lerp(1.1, 5.0, t);
    const cone = new THREE.ConeGeometry(radius, height, segs, 1, true);
    const p = cone.attributes.position;
    const n = cone.attributes.normal;
    const turn = rnd(seed, i) * 6.28;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v);
      const y = p.getY(v);
      const z = p.getZ(v);
      if (y < 0) {
        // Rim: every other point sticks out and droops, which breaks the perfect cone.
        const ang = Math.atan2(z, x);
        const k = Math.round(((ang + Math.PI) / (Math.PI * 2)) * segs) % segs;
        const out = 1 + (k % 2 ? 0.24 : -0.16) + (rnd(seed, i, k) - 0.5) * 0.2;
        p.setXYZ(v, x * out, y - (k % 2 ? 0.2 : 0) - rnd(seed, i, k + 40) * 0.12, z * out);
      }
      // Soft, rounded shading instead of hard facets.
      const nx = x;
      const nz = z;
      const l = Math.hypot(nx, 0.8, nz) || 1;
      n.setXYZ(v, nx / l, 0.8 / l, nz / l);
    }
    cone.rotateY(turn).translate(0, y0, 0);
    const mid = y0;
    parts.push(
      paint(cone, (x, y, z, c) => {
        const rim = 1 - smooth(mid - height / 2 - 0.2, mid + height / 2, y);
        c.copy(inner).lerp(outer, rim);
        c.lerp(top, t * 0.5 * rim);
        c.multiplyScalar(0.86 + rnd(x * 9, y * 9, z * 9) * 0.28);
      }),
    );
  }
  return merge(parts);
}

/** Broadleaf: overlapping rounded clumps, shadowed below and warm where the sun lands on top. */
function oakGeo(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [trunkPart(2.5, 0.3, 0.17, 0x47341f)];
  const low = rgb(0x0e160c);
  const mid = rgb(0x213219);
  const high = rgb(0x435428);
  const count = 8;
  for (let i = 0; i < count; i++) {
    const a = (i / (count - 1)) * 6.28 + rnd(seed, i) * 1.1;
    const ring = i === 0 ? 0 : 0.75 + rnd(seed, i, 1) * 0.55;
    const cx = Math.cos(a) * ring;
    const cz = Math.sin(a) * ring;
    const cy = i === 0 ? 4.1 : 3.05 + rnd(seed, i, 2) * 1.15;
    const r = i === 0 ? 1.25 : 0.72 + rnd(seed, i, 3) * 0.45;
    const g = new THREE.IcosahedronGeometry(r, 0);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v);
      const y = p.getY(v);
      const z = p.getZ(v);
      const l = Math.hypot(x, y, z) || 1;
      n.setXYZ(v, x / l, y / l, z / l);
      const out = 1 + (rnd(x * 5 + i, y * 5, z * 5) - 0.5) * 0.28;
      p.setXYZ(v, x * out, y * out * 0.86, z * out);
    }
    g.translate(cx, cy, cz);
    parts.push(
      paint(g, (x, y, z, c) => {
        const h = smooth(2.3, 5.2, y);
        const up = (y - cy) / r;
        c.copy(low).lerp(mid, smooth(-0.9, 0.2, up)).lerp(high, smooth(0.15, 1, up) * (0.45 + h * 0.55));
        c.multiplyScalar(0.84 + rnd(x * 7, y * 7, z * 7) * 0.3);
      }),
    );
  }
  return merge(parts);
}

/** Dead tree: grey trunk and bare branches. */
function deadGeo(): THREE.BufferGeometry {
  const bark = 0x5f5548;
  const branch = (len: number, r: number, rz: number, rx: number, x: number, y: number, z: number) =>
    paint(new THREE.CylinderGeometry(r * 0.35, r, len, 4, 1, true).rotateZ(rz).rotateX(rx).translate(x, y, z), (_a, b, _c, c) => c.set(bark).multiplyScalar(0.7 + clamp01(b / 5) * 0.5));
  return merge([
    trunkPart(3.3, 0.27, 0.11, bark),
    branch(1.7, 0.1, 0.75, 0, 0.58, 3.0, 0),
    branch(1.4, 0.09, -0.85, 0.1, -0.5, 3.2, 0.1),
    branch(1.2, 0.07, 0.1, 0.8, 0, 3.55, 0.4),
    branch(0.8, 0.05, 1.2, -0.5, 0.9, 3.7, -0.15),
  ]);
}

/** Low bush at the forest edge. */
function bushGeo(seed: number): THREE.BufferGeometry {
  const low = rgb(0x0f1a10);
  const high = rgb(0x2f4524);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = rnd(seed, i) * 6.28;
    const r = 0.42 + rnd(seed, i, 1) * 0.3;
    const cx = Math.cos(a) * (i ? 0.45 : 0);
    const cz = Math.sin(a) * (i ? 0.45 : 0);
    const g = new THREE.IcosahedronGeometry(r, 0);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let v = 0; v < p.count; v++) {
      const l = Math.hypot(p.getX(v), p.getY(v), p.getZ(v)) || 1;
      n.setXYZ(v, p.getX(v) / l, p.getY(v) / l, p.getZ(v) / l);
    }
    g.scale(1, 0.72, 1).translate(cx, r * 0.55, cz);
    parts.push(paint(g, (x, y, z, c) => c.copy(low).lerp(high, smooth(0, 0.95, y)).multiplyScalar(0.85 + rnd(x * 8, y * 8, z * 8) * 0.3)));
  }
  return merge(parts);
}

/** Tuft of grass: a few thin blades, dark at the root and pale at the tip. */
function tuftGeo(blades: number, height: number, root: number, tip: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const a = rgb(root);
  const b = rgb(tip);
  for (let i = 0; i < blades; i++) {
    const ang = rnd(i, 3) * 6.28;
    const dist = rnd(i, 4) * 0.28;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const w = 0.04 + rnd(i, 5) * 0.03;
    const h = height * (0.65 + rnd(i, 6) * 0.45);
    const lean = 0.12 + rnd(i, 7) * 0.2;
    const sx = Math.cos(ang + 1.57) * w;
    const sz = Math.sin(ang + 1.57) * w;
    pos.push(x - sx, 0, z - sz, x + sx, 0, z + sz, x + Math.cos(ang) * lean, h, z + Math.sin(ang) * lean);
    col.push(a.r, a.g, a.b, a.r, a.g, a.b, b.r, b.g, b.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Lit from above like the ground it grows on.
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** Small flower head: two crossed petals. */
function flowerGeo(hex: number): THREE.BufferGeometry {
  const s = 0.11;
  const y = 0.34;
  const g = new THREE.BufferGeometry();
  const pos = [-s, y, -s, s, y, -s, s, y, s, -s, y, -s, s, y, s, -s, y, s, 0, 0, -0.02, 0.02, 0, 0.02, 0, y, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const c = rgb(hex);
  const stem = rgb(0x2e4524);
  const col: number[] = [];
  for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
  for (let i = 0; i < 3; i++) col.push(stem.r, stem.g, stem.b);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** Weathered rock: lumpy, smooth-shaded, mossy on top and dark where it meets the ground. */
function rockGeo(seed: number, detail: number, moss = 0.5): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const g = mergeVertices(base, 1e-3);
  const p = g.attributes.position;
  for (let v = 0; v < p.count; v++) {
    const x = p.getX(v);
    const y = p.getY(v);
    const z = p.getZ(v);
    const big = rnd(Math.round(x * 2) + seed, Math.round(y * 2), Math.round(z * 2));
    const out = 0.74 + big * 0.42 + rnd(x * 6 + seed, y * 6, z * 6) * 0.1;
    p.setXYZ(v, x * out * 1.1, y * out * 0.8, z * out);
  }
  g.computeVertexNormals();
  const dark = rgb(0x171613);
  const grey = rgb(0x3e3b34);
  const light = rgb(0x5a564c);
  const mossy = rgb(0x2c3a1c);
  return paint(g, (x, y, z, c) => {
    const up = y / 0.8;
    const n = rnd(Math.round(x * 3) + seed, Math.round(y * 3), Math.round(z * 3));
    c.copy(dark).lerp(grey, smooth(-0.8, 0.1, up)).lerp(light, smooth(0.05, 0.8, up) * (0.3 + n * 0.5));
    if (up > 0.25 && n < moss) c.lerp(mossy, smooth(0.25, 0.75, up) * 0.75);
  });
}

/**
 * One stretch of dry-stone wall (1 m long, 1 m thick, scaled to fit): courses of uneven stones up
 * the sides and a broken cap of slabs on top, so it reads as masonry from the game camera.
 */
function wallGeo(height: number, seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stone = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, k: number, moss: number) => {
    const box = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const tone = 0.78 + rnd(seed, k, 4) * 0.4;
    const warm = (rnd(seed, k, 5) - 0.5) * 0.02;
    const isMoss = rnd(seed, k, 6) < moss;
    const m = rgb(0x1e2a15);
    parts.push(
      paint(box, (_x, y, _z, c) => {
        const shade = lerp(0.5, 1, smooth(0, height, y));
        c.setRGB((0.092 + warm) * tone * shade, 0.086 * tone * shade, (0.074 - warm) * tone * shade);
        if (isMoss && y > y0 + (y1 - y0) * 0.4) c.lerp(m, 0.55);
      }),
    );
  };
  const rows = 3;
  const capH = height * 0.2;
  const rowH = (height - capH) / rows;
  let k = 0;
  for (let r = 0; r < rows; r++) {
    // Staggered joints on both faces.
    for (const [z0, z1] of [[-0.5, -0.1], [0.1, 0.5], [-0.1, 0.1]]) {
      let x = -0.5;
      const count = 2 + ((r + seed) % 2);
      for (let s = 0; s < count; s++) {
        const w = s === count - 1 ? 0.5 - x : (1 / count) * (0.75 + rnd(seed, ++k) * 0.5);
        const inset = 0.015 + rnd(seed, ++k) * 0.03;
        stone(x, x + w - 0.012, r * rowH, (r + 1) * rowH - 0.012, z0 + inset, z1 - inset, ++k, r === 0 ? 0.3 : 0.1);
        x += w;
      }
    }
  }
  // Cap: two rows of slabs of different lengths, sitting at slightly different heights.
  for (const [z0, z1] of [[-0.52, -0.02], [0.02, 0.52]]) {
    let x = -0.5;
    while (x < 0.49) {
      const w = Math.min(0.5 - x, 0.22 + rnd(seed, ++k) * 0.34);
      const top = height - rnd(seed, ++k) * 0.14;
      stone(x + 0.008, x + w - 0.008, height - capH, top, z0, z1, ++k, 0.1);
      x += w;
    }
  }
  return merge(parts);
}

// ------------------------------------------------------------------ painted tiling textures

/** A tiling image: everything drawn wraps at the edges. */
function tile(size: number, draw: (g: CanvasRenderingContext2D, wrap: (x: number, y: number, r: number, fn: (x: number, y: number) => void) => void) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const wrap = (x: number, y: number, r: number, fn: (x: number, y: number) => void) => {
    for (const ox of x < r ? [0, size] : x > size - r ? [0, -size] : [0]) for (const oy of y < r ? [0, size] : y > size - r ? [0, -size] : [0]) fn(x + ox, y + oy);
  };
  draw(g, wrap);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** Grass: thousands of short brush strokes around mid grey (multiplied onto the painted map). */
function grassTile() {
  return tile(512, (g, wrap) => {
    g.fillStyle = '#7c7f78';
    g.fillRect(0, 0, 512, 512);
    g.lineCap = 'round';
    for (let i = 0; i < 9000; i++) {
      const x = rnd(i, 1) * 512;
      const y = rnd(i, 2) * 512;
      const a = -1.57 + (rnd(i, 3) - 0.5) * 1.9;
      const l = 7 + rnd(i, 4) * 15;
      const v = rnd(i, 5);
      const lum = v < 0.5 ? 58 + v * 90 : 130 + (v - 0.5) * 170;
      g.strokeStyle = `rgba(${lum + rnd(i, 6) * 14},${lum + 10},${lum - 14},${0.42 + rnd(i, 7) * 0.4})`;
      g.lineWidth = 0.9 + rnd(i, 8) * 1.6;
      wrap(x, y, 24, (px, py) => {
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
        g.stroke();
      });
    }
  });
}

/** Earth: speckled grit with small stones and dark cracks. */
function dirtTile() {
  return tile(512, (g, wrap) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 14000; i++) {
      const x = rnd(i, 11) * 512;
      const y = rnd(i, 12) * 512;
      const l = 80 + rnd(i, 13) * 96;
      g.fillStyle = `rgba(${l},${l - 3},${l - 8},0.5)`;
      const s = 1 + rnd(i, 14) * 2.4;
      g.fillRect(x, y, s, s * 0.8);
    }
    for (let i = 0; i < 420; i++) {
      const x = rnd(i, 15) * 512;
      const y = rnd(i, 16) * 512;
      const r = 1.6 + rnd(i, 17) * 4.6;
      const l = 96 + rnd(i, 18) * 76;
      wrap(x, y, 8, (px, py) => {
        g.fillStyle = 'rgba(30,26,20,0.5)';
        g.beginPath();
        g.ellipse(px + 0.8, py + 1.2, r, r * 0.74, 0.4, 0, 6.28);
        g.fill();
        g.fillStyle = `rgb(${l},${l - 2},${l - 8})`;
        g.beginPath();
        g.ellipse(px, py, r, r * 0.74, 0.4, 0, 6.28);
        g.fill();
      });
    }
    g.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      let x = rnd(i, 19) * 512;
      let y = rnd(i, 20) * 512;
      g.strokeStyle = 'rgba(40,34,26,0.34)';
      g.lineWidth = 0.8 + rnd(i, 21) * 1.1;
      for (let k = 0; k < 5; k++) {
        const a = rnd(i, k, 22) * 6.28;
        const nx = x + Math.cos(a) * 15;
        const ny = y + Math.sin(a) * 15;
        const fromX = x;
        const fromY = y;
        wrap(x, y, 20, (px, py) => {
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + nx - fromX, py + ny - fromY);
          g.stroke();
        });
        x = (nx + 512) % 512;
        y = (ny + 512) % 512;
      }
    }
  });
}

/** Smooth tiling noise, used for ripples, cloud shadows and to break up straight edges. */
function noiseTile() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const lattice = (x: number, y: number, per: number, k: number) => rnd(((x % per) + per) % per, ((y % per) + per) % per, k);
  const value = (x: number, y: number, per: number, k: number) => {
    const fx = (x / N) * per;
    const fy = (y / N) * per;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = lerp(lattice(x0, y0, per, k), lattice(x0 + 1, y0, per, k), sx);
    const b = lerp(lattice(x0, y0 + 1, per, k), lattice(x0 + 1, y0 + 1, per, k), sx);
    return lerp(a, b, sy);
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = value(x, y, 8, 1) * 0.5 + value(x, y, 16, 2) * 0.3 + value(x, y, 32, 3) * 0.2;
      const o = (y * N + x) * 4;
      const b = Math.round(v * 255);
      img.data[o] = img.data[o + 1] = img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Where earth (red) and paving (green) lie on the map: 1 pixel per meter, smoothed by the GPU. */
function bakeSplat(map: GameMap) {
  const c = document.createElement('canvas');
  c.width = c.height = map.size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, map.size, map.size);
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (pts: { x: number; y: number }[], w: number) => {
    g.lineWidth = w;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
  };
  g.strokeStyle = 'rgba(255,0,0,0.75)';
  for (const p of map.forestPaths) stroke(p, 4.5);
  g.strokeStyle = 'rgb(255,0,0)';
  for (const id of LANE_IDS) stroke(map.lanes[id], 8.5);
  const n = map.grid;
  const cs = map.cell;
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cy * n + cx;
      if (map.height[i] === 0) {
        g.fillStyle = 'rgb(255,0,0)';
        g.fillRect(cx * cs, cy * cs, cs, cs);
      } else if (map.height[i] === 2 && map.walkable[i]) {
        g.fillStyle = 'rgb(0,255,0)';
        g.fillRect(cx * cs, cy * cs, cs, cs);
      }
    }
  }
  g.fillStyle = 'rgb(0,255,0)';
  for (const h of map.houses) {
    g.beginPath();
    g.arc(h.x, h.y, h.inner, 0, 6.28);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

// ------------------------------------------------------------------ the art itself

interface TreeBatch {
  mesh: THREE.InstancedMesh;
  /** World tile centre (only tiles near the camera get their fog shade updated). */
  x: number;
  y: number;
  entries: { cell: number; color: THREE.Color }[];
}

export class WorldArt {
  private shared = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uFogMap: { value: null as THREE.Texture | null },
    uMapSize: { value: 300 },
    uCell: { value: 1 / 150 },
  };
  private batches: TreeBatch[] = [];
  private fireflies: THREE.Points | null = null;
  private level: ArtLevel;
  private noise: THREE.Texture;

  constructor(
    private scene: THREE.Scene,
    private map: GameMap,
    private terrainAt: (x: number, y: number) => number,
    private dpr: number,
    quality: 'low' | 'medium' | 'high',
    fogTex: THREE.Texture,
    waterLevel: number,
    private mountain: { height: number; top: number; foot: number },
  ) {
    this.level = ART_LEVEL[quality];
    this.shared.uFogMap.value = fogTex;
    this.shared.uMapSize.value = map.size;
    this.shared.uCell.value = 1 / map.grid;
    this.noise = noiseTile();
    this.buildTrees();
    this.buildWater(waterLevel);
    this.buildCurbs();
    this.buildMountains();
    this.buildRocks();
    this.buildUndergrowth();
    this.buildFireflies();
  }

  /** Called every frame. */
  update(dt: number, night: number) {
    this.shared.uTime.value += dt;
    this.shared.uNight.value = night;
    if (this.fireflies) this.fireflies.visible = night > 0.02;
  }

  /**
   * Adds wind and fog-of-war darkening to an instanced prop material. Darkening is done by the GPU
   * from the fog texture, looking at the prop's base and around it (`fogReach` cells), so a prop at
   * the edge of what you can see counts as seen.
   */
  private enhance<T extends THREE.Material>(mat: T, opts: { wind?: number; fogReach?: number } = {}): T {
    const wind = this.level.sway ? (opts.wind ?? 0) : 0;
    const reach = opts.fogReach ?? 1;
    const { shared } = this;
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = shared.uTime;
      s.uniforms.uFogMap = shared.uFogMap;
      s.uniforms.uMapSize = shared.uMapSize;
      s.uniforms.uCell = shared.uCell;
      s.vertexShader =
        `uniform float uTime; uniform sampler2D uFogMap; uniform float uMapSize; uniform float uCell; varying float vSeen;\n` +
        s.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 ibase = instanceMatrix[3].xyz;
          ${
            wind > 0
              ? `float wp = ibase.x * 0.31 + ibase.z * 0.23;
          float wh = position.y * position.y * ${wind.toFixed(4)};
          transformed.x += wh * (sin(uTime * 0.9 + wp) + 0.45 * sin(uTime * 2.1 + wp * 1.7 + position.y));
          transformed.z += wh * 0.7 * cos(uTime * 0.74 + wp * 1.3);`
              : ''
          }
          vec2 fc = vec2(ibase.x / uMapSize, 1.0 - ibase.z / uMapSize);
          float fr = uCell * ${reach.toFixed(1)};
          float fa = min(texture2D(uFogMap, fc).a, min(min(texture2D(uFogMap, fc + vec2(fr, 0.0)).a, texture2D(uFogMap, fc - vec2(fr, 0.0)).a), min(texture2D(uFogMap, fc + vec2(0.0, fr)).a, texture2D(uFogMap, fc - vec2(0.0, fr)).a)));
          vSeen = 1.0 - 0.9 * smoothstep(0.0, 0.45, fa);`,
        );
      s.fragmentShader = `varying float vSeen;\n` + s.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight *= vSeen;\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = () => `art-${wind.toFixed(4)}-${reach}`;
    return mat;
  }

  /** Splits instances into map tiles (off-screen tiles aren't drawn at all). */
  private instanced<T extends { x: number; y: number }>(items: T[], geo: THREE.BufferGeometry, mat: THREE.Material, place: (it: T, m: THREE.Matrix4, c: THREE.Color) => void, opts: { shadow?: boolean } = {}) {
    const tiles = new Map<number, T[]>();
    for (const it of items) {
      const k = Math.floor(it.y / TILE) * 1000 + Math.floor(it.x / TILE);
      (tiles.get(k) ?? tiles.set(k, []).get(k)!).push(it);
    }
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const out: { mesh: THREE.InstancedMesh; items: T[] }[] = [];
    for (const list of tiles.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, k) => {
        c.setRGB(1, 1, 1);
        place(it, m, c);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, c);
      });
      mesh.receiveShadow = !!opts.shadow;
      mesh.castShadow = !!opts.shadow;
      this.scene.add(mesh);
      out.push({ mesh, items: list });
    }
    return out;
  }

  // ---------------------------------------------------------------- trees

  private buildTrees() {
    const { map, terrainAt } = this;
    const tiers = this.level.pineTiers;
    const geos = [pineGeo(1, tiers), pineGeo(2, tiers), oakGeo(1), oakGeo(2), deadGeo()];
    // Tree fog stays on the CPU (shadeTrees): many more vertices, and trees block sight themselves.
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = this.level.sway
      ? (s) => {
          s.uniforms.uTime = this.shared.uTime;
          s.vertexShader =
            `uniform float uTime;\n` +
            s.vertexShader.replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
              vec3 ibase = instanceMatrix[3].xyz;
              float wp = ibase.x * 0.19 + ibase.z * 0.13;
              float wh = position.y * position.y * 0.0042;
              transformed.x += wh * (sin(uTime * 0.8 + wp) + 0.4 * sin(uTime * 1.9 + wp * 2.1 + position.z * 1.5));
              transformed.z += wh * 0.7 * cos(uTime * 0.63 + wp * 1.4 + position.x * 1.2);`,
            );
        }
      : () => {};
    mat.customProgramCacheKey = () => `tree-${this.level.sway}`;
    const n = map.grid;
    const v = [0, 1, 2, 3, 4].map(() => [] as typeof map.trees);
    for (const t of map.trees) {
      const h = rnd(t.x, t.y);
      v[t.kind === 'dead' ? 4 : (t.kind === 'pine' ? 0 : 2) + (h < 0.5 ? 0 : 1)].push(t);
    }
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    v.forEach((trees, kind) => {
      const batches = this.instanced(trees, geos[kind], mat, (t, m, c) => {
        const h = rnd(t.x * 3, t.y * 3);
        const h2 = rnd(t.y * 5, t.x * 5);
        p.set(t.x, terrainAt(t.x, t.y) - 0.1, t.y);
        q.setFromAxisAngle(up, h * 6.28);
        sc.set(t.s, t.s * (0.85 + h2 * 0.35), t.s);
        m.compose(p, q, sc);
        // Each tree a little different in brightness and hue: some cool, some warm.
        const warm = (h2 - 0.5) * 0.3;
        const lum = 0.74 + h * 0.36;
        c.setRGB(lum * (1 + warm), lum, lum * (1 - warm));
      });
      for (const b of batches) {
        const entries = b.items.map((t, k) => {
          const color = new THREE.Color();
          b.mesh.getColorAt(k, color);
          return { cell: Math.floor(t.y / map.cell) * n + Math.floor(t.x / map.cell), color };
        });
        this.batches.push({ mesh: b.mesh, x: (Math.floor(b.items[0].x / TILE) + 0.5) * TILE, y: (Math.floor(b.items[0].y / TILE) + 0.5) * TILE, entries });
      }
    });
  }

  /** Trees out of vision are darker. Only tiles near the camera need updating. */
  shadeTrees(g: Uint8Array, camX: number, camY: number) {
    const n = this.map.grid;
    const tmp = new THREE.Color();
    for (const b of this.batches) {
      if (Math.abs(b.x - camX) > 90 + TILE / 2 || Math.abs(b.y - camY) > 90 + TILE / 2) continue;
      b.entries.forEach((e, k) => {
        const cx = e.cell % n;
        const cy = (e.cell / n) | 0;
        let lit = false;
        for (let dy = -1; dy <= 1 && !lit; dy++)
          for (let dx = -1; dx <= 1 && !lit; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x >= 0 && y >= 0 && x < n && y < n && g[y * n + x]) lit = true;
          }
        b.mesh.setColorAt(k, tmp.copy(e.color).multiplyScalar(lit ? 1 : 0.4));
      });
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- water

  private buildWater(level: number) {
    const { map, terrainAt } = this;
    const rp = map.riverPath;
    const half = map.riverWidth / 2 + 2;
    const pos: number[] = [];
    const flow: number[] = [];
    const idx: number[] = [];
    let along = 0;
    rp.forEach((p, i) => {
      const a = rp[Math.max(0, i - 1)];
      const b = rp[Math.min(rp.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / l;
      const ny = (b.x - a.x) / l;
      if (i) along += Math.hypot(p.x - rp[i - 1].x, p.y - rp[i - 1].y);
      pos.push(p.x + nx * half, level, p.y + ny * half, p.x - nx * half, level, p.y - ny * half);
      flow.push(along, half, along, -half);
      if (i) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
    geo.setIndex(idx);

    // How deep the water is at each meter: drives the shallows and the foam at the banks.
    const size = map.size;
    const depth = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        depth[y * size + x] = Math.round(clamp01((level - terrainAt(x + 0.5, y + 0.5)) / 0.28) * 255);
      }
    }
    const depthTex = new THREE.DataTexture(depth, size, size, THREE.RedFormat);
    depthTex.magFilter = THREE.LinearFilter;
    depthTex.minFilter = THREE.LinearFilter;
    depthTex.needsUpdate = true;

    const water = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uTime: this.shared.uTime, uNight: this.shared.uNight, uNoise: { value: this.noise }, uDepth: { value: depthTex }, uSize: { value: size } },
        vertexShader: `
          attribute vec2 flow;
          varying vec2 vFlow;
          varying vec3 vWorld;
          void main() {
            vFlow = flow;
            vWorld = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform float uTime, uNight, uSize;
          uniform sampler2D uNoise, uDepth;
          varying vec2 vFlow;
          varying vec3 vWorld;
          void main() {
            float d = texture2D(uDepth, vWorld.xz / uSize).r;
            vec2 f = vFlow;
            // Ripples run along the river; the middle flows a little faster than the edges.
            float speed = 0.75 + 0.45 * (1.0 - abs(f.y) / 11.0);
            float n1 = texture2D(uNoise, vec2(f.x * 0.018 - uTime * 0.016 * speed, f.y * 0.05)).r;
            float n2 = texture2D(uNoise, vec2(f.x * 0.052 - uTime * 0.034 * speed, f.y * 0.12 + 0.37)).r;
            float n3 = texture2D(uNoise, vec2(f.x * 0.14 - uTime * 0.07 * speed, f.y * 0.31 + 0.71)).r;
            float n4 = texture2D(uNoise, vec2(f.x * 0.05 + uTime * 0.012, f.y * 0.2 + 0.13)).r;
            vec3 N = normalize(vec3((n2 - 0.5) * 0.55 + (n3 - 0.5) * 0.4, 1.0, (n1 - 0.5) * 0.5 + (n4 - 0.5) * 0.5));
            vec3 V = normalize(cameraPosition - vWorld);
            vec3 L = normalize(vec3(0.42, 0.82, 0.3));
            float spec = pow(max(dot(N, normalize(L + V)), 0.0), 320.0);
            float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
            vec3 deep = vec3(0.008, 0.034, 0.046);
            vec3 mid = vec3(0.016, 0.066, 0.076);
            vec3 shallow = vec3(0.07, 0.125, 0.105);
            float center = smoothstep(2.0, 9.0, 11.0 - abs(f.y));
            vec3 col = mix(shallow, mid, smoothstep(0.08, 0.9, d));
            col = mix(col, deep, center * (0.55 + n1 * 0.5));
            // Long streaks of current.
            float streak = smoothstep(0.5, 0.72, n2) * smoothstep(0.4, 0.7, n3);
            col += vec3(0.014, 0.03, 0.033) * streak;
            col = mix(col, vec3(0.2, 0.28, 0.32), fres * 0.4);
            col += vec3(1.0, 0.93, 0.8) * spec * 0.22;
            // Foam: lapping lines where the water meets the shore, moving with the current.
            float shore = 1.0 - smoothstep(0.0, 0.46, d + (n3 - 0.5) * 0.3);
            float lap = 0.5 + 0.5 * sin(d * 19.0 - uTime * 1.1 + n1 * 9.0);
            float foam = shore * (0.28 + 0.72 * lap) * smoothstep(0.32, 0.62, n2 + n3 * 0.3);
            col = mix(col, vec3(0.42, 0.48, 0.46), foam * 0.55);
            // Night: cooler and darker.
            col = mix(col, col * vec3(0.3, 0.38, 0.55), uNight);
            float alpha = mix(0.5, 0.95, smoothstep(0.0, 0.5, d));
            gl_FragColor = vec4(col, max(alpha, foam * 0.75));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    // Drawn before the ground overlays and without writing depth, so the fog, aim arrows and
    // spell markings painted on the river bed show on top of the water.
    water.renderOrder = -1;
    this.scene.add(water);
  }

  // ---------------------------------------------------------------- stone

  /** River curbs: rough stone banks you can't walk through. */
  private buildCurbs() {
    const { map, terrainAt } = this;
    const n = map.grid;
    const stones: { x: number; y: number; s: number; h: number; v: number }[] = [];
    const add = (i: number) => {
      const cx = i % n;
      const cy = (i - cx) / n;
      for (let j = 0; j < 3; j++) {
        const h = rnd(i, j);
        const x = (cx + 0.2 + j * 0.3 + (h - 0.5) * 0.25) * map.cell;
        const y = (cy + 0.2 + j * 0.3 + (rnd(i, j, 1) - 0.5) * 0.25) * map.cell;
        // A big stone and two small ones fill gaps, so the bank reads as a wall, not as loose rocks.
        stones.push({ x, y, s: j === 1 ? 0.78 + h * 0.5 : 0.36 + h * 0.34, h, v: rnd(i, j, 2) });
      }
    };
    map.cliff.forEach((c, i) => c && add(i));
    if (!stones.length) return;
    const mat = this.enhance(new THREE.MeshLambertMaterial({ vertexColors: true }), { fogReach: 2 });
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    [0, 1, 2].forEach((variant) => {
      const list = stones.filter((s) => Math.floor(s.v * 3) === variant);
      this.instanced(
        list,
        rockGeo(variant + 3, 1, 0.55),
        mat,
        (r, m, c) => {
          e.set((r.h - 0.5) * 0.7, r.h * 6.28, (r.v - 0.5) * 0.7);
          q.setFromEuler(e);
          p.set(r.x, terrainAt(r.x, r.y) - 0.12, r.y);
          sc.set(r.s * 1.25, r.s * 0.95, r.s * 1.1);
          m.compose(p, q, sc);
          const l = 0.74 + r.v * 0.36;
          c.setRGB(l * 1.02, l, l * 0.95);
        },
        { shadow: true },
      );
    });
  }

  /**
   * Ward mountains: craggy stacks of big boulders up the steep sides, smaller stones around the
   * flat top, so they read as a real mountain you could only get onto with a blink.
   */
  private buildMountains() {
    const { map, terrainAt, mountain } = this;
    const stones: { x: number; y: number; h: number; s: number; v: number; up: number }[] = [];
    map.hills.forEach((hill, hi) => {
      const put = (r: number, count: number, size: number, tier: number, up: number) => {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + rnd(hi, tier, i) * 0.5;
          const rr = r + (rnd(hi, tier, i + 40) - 0.5) * 0.7;
          const x = hill.x + Math.cos(a) * rr;
          const y = hill.y + Math.sin(a) * rr;
          stones.push({ x, y, h: terrainAt(x, y), s: size * (0.72 + rnd(hi, tier, i + 80) * 0.6), v: rnd(hi, tier, i + 120), up });
        }
      };
      // Bottom to top: wide footing, the steep cliffs, a jagged crown around the flat top.
      put(mountain.foot - 0.1, 18, 1.5, 1, 1.05);
      put(mountain.foot - 1.2, 15, 1.9, 2, 1.55);
      put(mountain.top + 1.1, 12, 1.65, 3, 1.5);
      put(mountain.top + 0.15, 11, 0.8, 4, 1.25);
    });
    if (!stones.length) return;
    const mat = this.enhance(new THREE.MeshLambertMaterial({ vertexColors: true }), { fogReach: 4 });
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    [0, 1, 2].forEach((variant) => {
      this.instanced(
        stones.filter((s) => Math.floor(s.v * 3) === variant),
        rockGeo(variant + 21, 1, 0.42),
        mat,
        (r, m, c) => {
          e.set((r.v - 0.5) * 0.6, r.v * 40, (r.s % 1) * 0.5);
          q.setFromEuler(e);
          m.compose(new THREE.Vector3(r.x, r.h - 0.2, r.y), q, new THREE.Vector3(r.s * 1.05, r.s * r.up, r.s));
          const l = 0.78 + r.v * 0.3;
          c.setRGB(l * 1.02, l, l * 0.94);
        },
        { shadow: true },
      );
    });
  }

  /** Boulders in the woods. */
  private buildRocks() {
    const { map, terrainAt } = this;
    const n = map.grid;
    const spots: { x: number; y: number; s: number; v: number }[] = [];
    for (let i = 0; i < 1200 && spots.length < 300; i++) {
      const x = 6 + rnd(i, 1) * (map.size - 12);
      const y = 6 + rnd(i, 2) * (map.size - 12);
      const cell = Math.floor(y / map.cell) * n + Math.floor(x / map.cell);
      // Only where nobody can walk: the woods, never roads or lanes.
      if (map.walkable[cell] || map.cliff[cell] || map.height[cell] !== 1) continue;
      if (rnd(i, 3) < 0.4) spots.push({ x, y, s: 0.45 + rnd(i, 4) * 0.95, v: rnd(i, 5) });
    }
    const mat = this.enhance(new THREE.MeshLambertMaterial({ vertexColors: true }), { fogReach: 2 });
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    [0, 1].forEach((variant) => {
      this.instanced(spots.filter((s) => Math.floor(s.v * 2) === variant), rockGeo(variant + 11, 1, 0.75), mat, (r, m, c) => {
        e.set(r.x % 0.5, r.y % 6.28, 0);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(r.x, terrainAt(r.x, r.y) + 0.05 * r.s, r.y), q, new THREE.Vector3(r.s * 1.2, r.s * 0.8, r.s));
        const l = 0.72 + r.v * 0.34;
        c.setRGB(l, l, l * 0.96);
      });
    });
  }

  /** A ring of dry-stone wall with a doorway and two gate pillars (Warden's house, fountain yards). */
  buildWall(h: House, keep?: (x: number, y: number) => boolean) {
    const { terrainAt } = this;
    const mid = (h.inner + h.outer) / 2;
    const thick = h.outer - h.inner;
    const doorAng = Math.atan2(h.door.y, h.door.x);
    const gap = Math.asin(Math.min(1, (h.doorHalf + 0.3) / mid));
    const span = Math.PI * 2 - gap * 2;
    const count = Math.ceil((span * mid) / 2.4);
    const step = span / count;
    const height = 2.3;
    const up = new THREE.Vector3(0, 1, 0);
    const mat = this.enhance(new THREE.MeshLambertMaterial({ vertexColors: true }), { fogReach: 3 });
    const items: { a: number; len: number; hs: number; w: number; k: number; x: number; y: number }[] = [];
    const push = (k: number, a: number, len: number, hs: number, w: number) => {
      const x = h.x + Math.cos(a) * mid;
      const y = h.y + Math.sin(a) * mid;
      if (!keep || keep(x, y)) items.push({ a, len, hs, w, k, x, y });
    };
    for (let k = 0; k < count; k++) push(k, doorAng + gap + step * (k + 0.5), step * mid + 0.12, 0.92 + rnd(k, 8) * 0.14, thick);
    push(count, doorAng + gap, thick * 0.9, 1.5, thick * 1.1);
    push(count + 1, doorAng - gap, thick * 0.9, 1.5, thick * 1.1);
    const q = new THREE.Quaternion();
    [0, 1, 2].forEach((variant) => {
      this.instanced(
        items.filter((it) => it.k % 3 === variant),
        wallGeo(height, variant + 1),
        mat,
        (it, m, c) => {
          q.setFromAxisAngle(up, -it.a + Math.PI / 2);
          m.compose(new THREE.Vector3(it.x, terrainAt(it.x, it.y) - 0.1, it.y), q, new THREE.Vector3(it.len, it.hs, it.w));
          const l = 0.9 + rnd(it.k, 9) * 0.22;
          c.setRGB(l, l, l);
        },
        { shadow: true },
      );
    });
  }

  // ---------------------------------------------------------------- undergrowth

  private buildUndergrowth() {
    const { map, terrainAt } = this;
    const n = map.grid;
    // Which cells are a road (no grass on them).
    const road = new Uint8Array(n * n);
    const markRoad = (pts: { x: number; y: number }[], halfW: number) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let t = 0; t <= len; t += map.cell * 0.5) {
          const x = a.x + ((b.x - a.x) * t) / (len || 1);
          const y = a.y + ((b.y - a.y) * t) / (len || 1);
          const r = Math.ceil(halfW / map.cell);
          for (let oy = -r; oy <= r; oy++)
            for (let ox = -r; ox <= r; ox++) {
              const cx = Math.floor(x / map.cell) + ox;
              const cy = Math.floor(y / map.cell) + oy;
              if (cx >= 0 && cy >= 0 && cx < n && cy < n && Math.hypot(ox, oy) * map.cell <= halfW) road[cy * n + cx] = 1;
            }
        }
      }
    };
    for (const id of LANE_IDS) markRoad(map.lanes[id], LANE_WIDTH / 2);
    for (const p of map.forestPaths) markRoad(p, 2.2);
    const grassCell = (cell: number) => map.walkable[cell] === 1 && map.height[cell] === 1 && !road[cell];

    const treeCells = new Set(map.trees.map((t) => Math.floor(t.y / map.cell) * n + Math.floor(t.x / map.cell)));
    // Bushes: thicken the edge of the woods so trees don't stand on bare ground. Only in cells
    // nobody can walk on, so they can't hide anybody.
    const bushes: { x: number; y: number; s: number; v: number }[] = [];
    for (let cy = 1; cy < n - 1; cy++) {
      for (let cx = 1; cx < n - 1; cx++) {
        const i = cy * n + cx;
        if (map.walkable[i] || map.height[i] !== 1 || map.cliff[i] || map.fountainWall[i]) continue;
        const edge = map.walkable[i - 1] || map.walkable[i + 1] || map.walkable[i - n] || map.walkable[i + n];
        // Woods without a tree in a cell are undergrowth, so it's clear you can't walk through.
        const open = !treeCells.has(i);
        if (!(edge && rnd(cx, cy, 31) <= 0.55) && !(open && rnd(cx, cy, 36) <= 0.5)) continue;
        bushes.push({ x: (cx + 0.2 + rnd(cx, cy, 32) * 0.6) * map.cell, y: (cy + 0.2 + rnd(cx, cy, 33) * 0.6) * map.cell, s: 0.8 + rnd(cx, cy, 34) * 0.7, v: rnd(cx, cy, 35) });
      }
    }
    const leaf = this.enhance(new THREE.MeshLambertMaterial({ vertexColors: true }), { wind: 0.05, fogReach: 2 });
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    [0, 1].forEach((variant) => {
      this.instanced(bushes.filter((b) => Math.floor(b.v * 2) === variant), bushGeo(variant + 21), leaf, (b, m, c) => {
        q.setFromAxisAngle(up, b.v * 40);
        m.compose(new THREE.Vector3(b.x, terrainAt(b.x, b.y) - 0.05, b.y), q, new THREE.Vector3(b.s, b.s * (0.8 + b.v * 0.4), b.s));
        const l = 0.8 + b.v * 0.4;
        c.setRGB(l, l, l * 0.9);
      });
    });

    if (this.level.tufts <= 0) return;

    // Grass tufts and a few wildflowers on open ground: ankle high, so they hide nothing.
    const tufts: { x: number; y: number; s: number; v: number }[] = [];
    const flowers: { x: number; y: number; s: number; v: number }[] = [];
    for (let i = 0; i < this.level.tufts * 5 && tufts.length < this.level.tufts; i++) {
      const x = rnd(i, 41) * map.size;
      const y = rnd(i, 42) * map.size;
      const cell = Math.floor(y / map.cell) * n + Math.floor(x / map.cell);
      if (!grassCell(cell)) continue;
      // In patches, not evenly sprayed.
      const patch = Math.sin(x * 0.17 + Math.sin(y * 0.11) * 2) * Math.sin(y * 0.15 + Math.sin(x * 0.09) * 2);
      if (patch < -0.15 && rnd(i, 43) > 0.15) continue;
      const v = rnd(i, 44);
      tufts.push({ x, y, s: 0.75 + rnd(i, 45) * 0.7, v });
      if (rnd(i, 46) < 0.055 && patch > 0.25) flowers.push({ x: x + 0.3, y: y - 0.2, s: 0.8 + rnd(i, 47) * 0.5, v: rnd(i, 48) });
    }
    const grassMat = this.enhance(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { wind: 0.3, fogReach: 1 });
    [tuftGeo(7, 0.42, 0x26331b, 0x4b5c30), tuftGeo(6, 0.5, 0x243219, 0x425634), tuftGeo(8, 0.36, 0x2b3119, 0x5c5e34)].forEach((geo, variant) => {
      this.instanced(tufts.filter((t) => Math.floor(t.v * 3) === variant), geo, grassMat, (t, m, c) => {
        q.setFromAxisAngle(up, t.v * 50);
        m.compose(new THREE.Vector3(t.x, terrainAt(t.x, t.y), t.y), q, new THREE.Vector3(t.s, t.s, t.s));
        const l = 0.75 + t.v * 0.4;
        c.setRGB(l, l, l);
      });
    });
    [0x8d8ba8, 0x9c8a48, 0x8f6b74].forEach((hex, variant) => {
      this.instanced(flowers.filter((t) => Math.floor(t.v * 3) === variant), flowerGeo(hex), grassMat, (t, m) => {
        q.setFromAxisAngle(up, t.v * 50);
        m.compose(new THREE.Vector3(t.x, terrainAt(t.x, t.y), t.y), q, new THREE.Vector3(t.s, t.s, t.s));
      });
    });
  }

  // ---------------------------------------------------------------- fireflies

  private buildFireflies() {
    const { map, terrainAt } = this;
    const n = map.grid;
    const pos: number[] = [];
    const seed: number[] = [];
    for (let i = 0; i < this.level.fireflies * 8 && pos.length / 3 < this.level.fireflies; i++) {
      const x = rnd(i, 51) * map.size;
      const y = rnd(i, 52) * map.size;
      const cell = Math.floor(y / map.cell) * n + Math.floor(x / map.cell);
      // Fixed places in the woods and glades, along the river too; never on bases.
      if (map.height[cell] === 2) continue;
      if (map.walkable[cell] && rnd(i, 53) > 0.45) continue;
      pos.push(x, terrainAt(x, y) + 0.7 + rnd(i, 54) * 1.9, y);
      seed.push(rnd(i, 55) * 100);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
    const { uTime, uNight, uFogMap, uMapSize } = this.shared;
    const pts = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime, uNight, uFogMap, uMapSize, uPx: { value: this.dpr } },
        vertexShader: `
          attribute float seed;
          uniform float uTime, uNight, uMapSize, uPx;
          uniform sampler2D uFogMap;
          varying float vGlow;
          void main() {
            vec3 p = position;
            // Slow wandering around a fixed spot.
            p.x += sin(uTime * 0.31 + seed) * 1.1 + sin(uTime * 0.83 + seed * 2.3) * 0.35;
            p.z += cos(uTime * 0.27 + seed * 1.7) * 1.1;
            p.y += sin(uTime * 0.5 + seed * 3.1) * 0.5;
            // Each one blinks on its own rhythm.
            float blink = smoothstep(0.25, 0.95, 0.5 + 0.5 * sin(uTime * (0.7 + mod(seed, 1.0) * 0.9) + seed * 6.0));
            // Only inside what you can see, so they can never be mistaken for anything in the fog.
            vec2 fc = vec2(position.x / uMapSize, 1.0 - position.z / uMapSize);
            float seen = 1.0 - smoothstep(0.02, 0.3, texture2D(uFogMap, fc).a);
            vGlow = blink * uNight * seen;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uPx * (46.0 / max(1.0, -mv.z)) * 22.0;
          }`,
        fragmentShader: `
          varying float vGlow;
          void main() {
            if (vGlow < 0.01) discard;
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float core = smoothstep(0.17, 0.0, d);
            float halo = pow(max(0.0, 1.0 - d), 2.6) * 0.5;
            gl_FragColor = vec4(vec3(0.82, 1.0, 0.36) * (core * 1.3 + halo) * vGlow, 1.0);
          }`,
      }),
    );
    pts.frustumCulled = false;
    pts.visible = false;
    pts.renderOrder = 3;
    this.scene.add(pts);
    this.fireflies = pts;
  }

  // ---------------------------------------------------------------- ground

  /**
   * Fine detail on the painted ground: tiling grass and earth textures laid over it, road edges
   * broken up by noise and slow cloud shadows drifting across the map.
   */
  detailGround(mat: THREE.MeshLambertMaterial) {
    if (!this.level.groundDetail) return;
    const grass = grassTile();
    const dirt = dirtTile();
    const splat = bakeSplat(this.map);
    const { uTime } = this.shared;
    const noise = this.noise;
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, { uTime, uGrass: { value: grass }, uDirt: { value: dirt }, uSplat: { value: splat }, uNoise: { value: noise } });
      s.vertexShader = `varying vec2 vWorldXZ;\n` + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = position.xz;');
      s.fragmentShader =
        `uniform float uTime; uniform sampler2D uGrass, uDirt, uSplat, uNoise; varying vec2 vWorldXZ;\n` +
        s.fragmentShader
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            float big = texture2D(uNoise, vWorldXZ / 53.0).r;
            float fine = texture2D(uNoise, vWorldXZ / 7.0).r;
            // Road edges wander instead of following a clean line.
            vec4 sp = texture2D(uSplat, vMapUv + (vec2(fine, big) - 0.46) * 0.014);
            float earth = smoothstep(0.32, 0.62, sp.r + (fine - 0.5) * 0.3);
            vec3 g1 = texture2D(uGrass, vWorldXZ / 7.5).rgb;
            vec3 g2 = texture2D(uGrass, vWorldXZ.yx / 19.0 + 0.31).rgb;
            vec3 d1 = texture2D(uDirt, vWorldXZ / 8.5).rgb;
            float d1l = dot(d1, vec3(0.333));
            vec3 detail = mix(g1 * g2 * 2.0, d1, earth);
            detail = mix(detail, vec3(mix(1.0, d1l * 2.0, 0.5)) * 0.5, sp.g);
            diffuseColor.rgb *= detail * 2.05;
            // Large, soft variation in the colour of the ground.
            diffuseColor.rgb *= 0.86 + big * 0.3;`,
          )
          .replace(
            '#include <opaque_fragment>',
            `float cloud = smoothstep(0.42, 0.68, texture2D(uNoise, vWorldXZ / 170.0 + vec2(uTime * 0.0035, uTime * 0.0021)).r);
            outgoingLight *= 1.0 - cloud * 0.16;
            #include <opaque_fragment>`,
          );
    };
    mat.customProgramCacheKey = () => 'ground-detail';
  }

  /** Softens the fog-of-war edge (a few samples around each point, so no blocky steps). */
  softFog(mat: THREE.MeshBasicMaterial, cells: number) {
    mat.onBeforeCompile = (s) => {
      s.uniforms.uStep = { value: 1 / cells };
      s.fragmentShader =
        `uniform float uStep;\n` +
        s.fragmentShader.replace(
          '#include <map_fragment>',
          `vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          float fa = sampledDiffuseColor.a * 0.28;
          fa += texture2D(map, vMapUv + vec2(uStep, uStep) * 0.9).a * 0.18;
          fa += texture2D(map, vMapUv + vec2(-uStep, uStep) * 0.9).a * 0.18;
          fa += texture2D(map, vMapUv + vec2(uStep, -uStep) * 0.9).a * 0.18;
          fa += texture2D(map, vMapUv + vec2(-uStep, -uStep) * 0.9).a * 0.18;
          sampledDiffuseColor.a = fa;
          diffuseColor *= sampledDiffuseColor;`,
        );
    };
    mat.customProgramCacheKey = () => 'soft-fog';
  }
}
