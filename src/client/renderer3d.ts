import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLYPH_DURATION, GameMap, HEROES, House, TELEPORT, Team, Unit, World, isInvisible, isNight } from '../sim';
import type { Aim } from './input';
import { Renderer, TEAM_COLORS } from './renderer';
import { JOINTS, Joint, TEAM_HEX, model } from './three/models';
import { Fx3D } from './three/fx';
import { Anim, AnimCtx, Corpse, animateHero, buffFx, heroAttack, heroBlink, heroCast, heroCorpse, newAnim, pose, setGround } from './three/hero-anims';
import { SpellFx } from './three/spell-fx';
import { MonsterCorpse, animateMonster, monsterCorpse, monsterKind, wardenSlamFx } from './three/monster-anims';
import type { GameEvent } from '../sim';

/** Ground level per map height (1 = normal, 2 = base plateau, 3 = ward hill), in meters. */
/** Ground height per map level (0 = river bed, 1 = normal, 2 = base plateau, 3 = ward hill). */
const ELEVATION = [-1.0, 0, 1.1, 3.4];
/** Bridge deck height and the water surface (shallow: about ankle deep over the river bed). */
const BRIDGE_DECK = 0.25;
const WATER_LEVEL = -0.72;
/** Camera: looking down at this angle from the horizon, with this field of view. */
const PITCH = (56 * Math.PI) / 180;
const FOV = 38;
/** The ground-effects texture covers this many meters around the camera. */
const FX_SPAN = 96;
/**
 * Graphics quality. Low/Medium save battery: fewer pixels, no or smaller shadows, a smaller
 * ground-effects image and (Low) 30 frames per second.
 */
export type Quality = 'low' | 'medium' | 'high';
export const QUALITY: Record<Quality, { dpr: number; antialias: boolean; shadows: number; fxPx: number; fps: number }> = {
  low: { dpr: 1, antialias: false, shadows: 0, fxPx: 512, fps: 30 },
  medium: { dpr: 1.25, antialias: true, shadows: 1024, fxPx: 768, fps: 60 },
  high: { dpr: 2, antialias: true, shadows: 2048, fxPx: 1024, fps: 60 },
};
/** Heroes are drawn a bit larger than life so they read well on a phone. */
const HERO_SCALE = 2.0;
const CREEP_SCALE = 1.75;
/** The 3D camera sits a little closer than the 2D view (perspective already shows more ground up top). */
const CLOSER = 0.78;

/**
 * 3D view (Three.js). The simulation and HUD are unchanged; this replaces only what's drawn.
 * - Terrain mesh with real height (base plateaus, ward hills), forest as instanced 3D trees.
 * - Heroes, creeps, monsters, buildings, wards, power-ups and projectiles as low-poly models.
 * - Everything flat on the ground (aim arrows, spell areas, rings, pings, fog of war) is drawn
 *   by the 2D renderer into a texture that is laid over the terrain.
 * - Health bars, names and damage numbers are drawn on top in screen space.
 */
export class Renderer3D extends Renderer {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 260);
  private sun: THREE.DirectionalLight;
  private sky: THREE.HemisphereLight;
  private elev: Float32Array;
  private grid: number;
  private mapSize: number;
  private terrain3d: THREE.Mesh;
  private fogTex: THREE.DataTexture;
  private fxCanvas = document.createElement('canvas');
  private fxCtx: CanvasRenderingContext2D;
  private fxTex: THREE.CanvasTexture;
  private fxX = 0;
  private fxPx: number;
  /** Vision grid version the fog texture was last built from (rebuilt only when vision changes). */
  private fogKey = '';
  private lastTreeShade = 0;
  private fxY = 0;
  private overlay: CanvasRenderingContext2D;
  private trees: { meshes: THREE.InstancedMesh[]; entries: { mesh: number; k: number; cell: number; color: THREE.Color }[] } | null = null;
  private objs = new Map<string, Obj>();
  /** Per-unit animation clocks (walk cycle, attack swing, cast). */
  private anims = new Map<number, Anim>();
  /** Units that just died: they fall over and sink for a moment. */
  private corpses: Corpse[] = [];
  private lastFrame = performance.now();
  private dt = 1 / 60;
  private frameNo = 0;
  private raycaster = new THREE.Raycaster();
  private night = 0;
  private fx3!: Fx3D;
  /** Seconds, for animation timelines (independent of the simulation clock). */
  private clock = 0;
  private meId = -1;
  /** Plays a sound at a map point (set by the game; volume already includes distance). */
  sound: ((name: string, x: number, y: number, volume: number) => void) | null = null;
  /** Where each hero started channelling a teleport (for the departure flash). */
  private tpFrom = new Map<number, { x: number; y: number }>();
  private world: World | null = null;
  private bridges: (GameMap['bridges'][number] & { c: number; s: number })[] = [];
  private spells!: SpellFx;
  /** Team whose view is drawn (set each frame; effects follow its vision). */
  private viewTeam: Team = 0 as Team;
  /** Shared state handed to the hero animations each frame. */
  private actx: AnimCtx = {
    fx: null as unknown as Fx3D,
    clock: 0,
    dt: 1 / 60,
    world: null,
    meId: -1,
    camX: 0,
    camY: 0,
    sound: (n, x, y, v) => this.sound?.(n, x, y, v),
  };

  constructor(
    overlay: HTMLCanvasElement,
    glCanvas: HTMLCanvasElement,
    map: GameMap,
    readonly quality: Quality = 'medium',
  ) {
    super(overlay, map);
    const q = QUALITY[quality];
    this.fxPx = q.fxPx;
    this.flat = false;
    this.overlay = this.ctx;
    // Phones have 3x screens; drawing fewer pixels is the biggest battery saver.
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    this.gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: q.antialias, powerPreference: quality === 'high' ? 'high-performance' : 'low-power' });
    this.gl.setPixelRatio(dpr);
    this.gl.shadowMap.enabled = q.shadows > 0;
    this.gl.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x0d150f);

    this.sky = new THREE.HemisphereLight(0xdfeeff, 0x3a4a30, 1.5);
    this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
    this.sun.castShadow = q.shadows > 0;
    this.sun.shadow.mapSize.set(Math.max(512, q.shadows), Math.max(512, q.shadows));
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    // Soft surrounding light for shiny materials (computed once, cheap to use).
    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    // ---- terrain with height
    this.grid = map.grid;
    this.mapSize = map.size;
    const n = map.grid;
    this.elev = new Float32Array((n + 1) * (n + 1));
    for (let vy = 0; vy <= n; vy++) {
      for (let vx = 0; vx <= n; vx++) {
        let sum = 0;
        let cnt = 0;
        for (const [cx, cy] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]]) {
          if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
          sum += ELEVATION[map.height[cy * n + cx]] ?? 0;
          cnt++;
        }
        this.elev[vy * (n + 1) + vx] = cnt ? sum / cnt : 0;
      }
    }
    this.bridges = map.bridges.map((b) => ({ ...b, c: Math.cos(b.angle), s: Math.sin(b.angle) }));
    const geo = new THREE.PlaneGeometry(map.size, map.size, n, n);
    geo.rotateX(-Math.PI / 2);
    geo.translate(map.size / 2, 0, map.size / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.terrainAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const groundTex = new THREE.CanvasTexture(this.mapImage);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = 4;
    const groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
    groundMat.color.setScalar(1.9); // the baked 2D map is dark; lift it under the 3D lighting
    this.terrain3d = new THREE.Mesh(geo, groundMat);
    this.terrain3d.receiveShadow = true;
    this.scene.add(this.terrain3d);

    // Fog of war: one texel per map cell, smoothed by the GPU, laid over the whole map.
    this.fogTex = new THREE.DataTexture(new Uint8Array(n * n * 4), n, n);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    const fog = new THREE.Mesh(geo, overlayMaterial(this.fogTex, 1));
    fog.renderOrder = 1;
    this.scene.add(fog);

    // Ground effects (aim, spell areas, rings, pings): the 2D renderer draws them into a
    // canvas covering the area around the camera.
    this.fxCanvas.width = this.fxCanvas.height = this.fxPx;
    this.fxCtx = this.fxCanvas.getContext('2d')!;
    this.fxTex = new THREE.CanvasTexture(this.fxCanvas);
    this.fxTex.colorSpace = THREE.SRGBColorSpace;
    this.fxTex.repeat.set(map.size / FX_SPAN, map.size / FX_SPAN);
    const fx = new THREE.Mesh(geo, overlayMaterial(this.fxTex, 2));
    fx.renderOrder = 2;
    this.scene.add(fx);

    this.buildTrees(map);
    this.buildWater(map);
    this.buildBridges(map);
    this.buildCurbs(map);
    this.buildRocks(map);
    this.buildHouse(map.house);
    // Fountain yards: the same stone ring, only where it stands on open ground (forest closes the rest).
    for (const yard of map.fountainYards) {
      this.buildHouse(yard, (x, y) => {
        const cx = Math.floor(x / map.cell);
        const cy = Math.floor(y / map.cell);
        return cx >= 0 && cy >= 0 && cx < map.grid && cy < map.grid && map.fountainWall[cy * map.grid + cx] === 1;
      });
    }
    this.fx3 = new Fx3D(this.scene, (x, y) => this.elevationAt(x, y));
    this.spells = new SpellFx((x, y) => this.elevationAt(x, y));
    setGround((x, y) => this.elevationAt(x, y));
    this.actx.fx = this.fx3;
    this.resize();
    this.prewarm();
  }

  /**
   * Build every model and compile every shader before the match starts, so nothing
   * stalls the first time a creep, spell or projectile shows up.
   */
  private prewarm() {
    const keys = [
      ...['brakk', 'vexa', 'orin', 'syl', 'grom', 'kaela'].map((h) => `hero:${h}`),
      ...[0, 1].flatMap((t) => [`creep:melee:${t}`, `creep:ranged:${t}`]),
      'brute', 'imp', 'warden', 'ward:observer', 'ward:sentry',
      ...['haste', 'doubleDamage', 'regen', 'invisibility', 'bounty'].map((r) => `rune:${r}`),
      'shot:fireball', 'shot:piercingArrow', 'shot:tidalWave', 'shot:spell', 'shot:shot0', 'shot:shot1',
      'shot:arrow', 'shot:arrowCrit', 'shot:firebolt', 'shot:waterbolt',
      'rubble:2.2', 'rubble:3', 'rubble:4.5',
    ];
    const tmp = new THREE.Group();
    for (const k of keys) {
      const o = model(k);
      o.position.set(this.camX, -50, this.camY);
      tmp.add(o);
      // also the see-through copy used for invisible heroes
      if (k.startsWith('hero:')) {
        const f = model(k);
        setOpacity(f, 0.45);
        f.position.copy(o.position);
        tmp.add(f);
      }
    }
    this.scene.add(tmp);
    this.placeCamera();
    this.gl.compile(this.scene, this.camera);
    this.scene.remove(tmp);
  }


  /** Free the GPU resources (when switching views or starting a new match). */
  destroy() {
    this.gl.dispose();
  }

  /** Ground height at a world point (matches the terrain mesh). */
  elevationAt(x: number, y: number): number {
    const t = this.terrainAt(x, y);
    // On a bridge deck: stand on the planks, not in the river.
    for (const b of this.bridges) {
      const dx = x - b.x;
      const dy = y - b.y;
      const along = dx * b.c + dy * b.s;
      const across = -dx * b.s + dy * b.c;
      if (Math.abs(along) < b.length / 2 && Math.abs(across) < b.width / 2) return Math.max(t, BRIDGE_DECK);
    }
    return t;
  }

  /** Height of the terrain mesh itself (river bed included, bridges not). */
  private terrainAt(x: number, y: number): number {
    const n = this.grid;
    const cell = this.mapSize / n;
    const fx = Math.max(0, Math.min(n - 0.001, x / cell));
    const fy = Math.max(0, Math.min(n - 0.001, y / cell));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const e = this.elev;
    const r = n + 1;
    const a = e[iy * r + ix] * (1 - tx) + e[iy * r + ix + 1] * tx;
    const b = e[(iy + 1) * r + ix] * (1 - tx) + e[(iy + 1) * r + ix + 1] * tx;
    return a * (1 - ty) + b * ty;
  }

  /** The Warden's house: a ring of low stone wall blocks with a doorway, and two gate pillars. */
  private buildHouse(h: House, keep?: (x: number, y: number) => boolean) {
    const mid = (h.inner + h.outer) / 2;
    const thick = h.outer - h.inner;
    const doorAng = Math.atan2(h.door.y, h.door.x);
    const gap = Math.asin(Math.min(1, (h.doorHalf + 0.3) / mid));
    const span = Math.PI * 2 - gap * 2;
    const count = Math.ceil((span * mid) / 2.4);
    const step = span / count;
    const height = 2.4;
    const geo = new THREE.BoxGeometry(1, height, thick);
    geo.translate(0, height / 2, 0);
    const blocks = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), count + 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const shades = [0x8a857a, 0x7c776d, 0x938d80, 0x726d64];
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const put = (k: number, a: number, r: number, len: number, hs: number, w = 1) => {
      const x = h.x + Math.cos(a) * r;
      const y = h.y + Math.sin(a) * r;
      if (keep && !keep(x, y)) {
        blocks.setMatrixAt(k, hide);
        blocks.setColorAt(k, new THREE.Color(0));
        return;
      }
      q.setFromAxisAngle(up, -a + Math.PI / 2);
      m.compose(new THREE.Vector3(x, this.elevationAt(x, y) - 0.1, y), q, new THREE.Vector3(len, hs, w));
      blocks.setMatrixAt(k, m);
      blocks.setColorAt(k, new THREE.Color(shades[k % shades.length]));
    };
    for (let k = 0; k < count; k++) {
      const a = doorAng + gap + step * (k + 0.5);
      put(k, a, mid, step * mid + 0.15, 0.9 + ((k * 37) % 5) * 0.06);
    }
    // Gate pillars on both sides of the doorway.
    put(count, doorAng + gap, mid, thick * 0.9, 1.45, 1.1);
    put(count + 1, doorAng - gap, mid, thick * 0.9, 1.45, 1.1);
    this.scene.add(blocks);
  }

  /**
   * The forest: one 3D tree per tree in the map (pines, broad oaks and a few dead trees),
   * drawn as instanced meshes (a handful of draw calls for thousands of trees).
   */
  private buildTrees(map: GameMap) {
    const n = map.grid;
    const kinds = ['pine', 'oak', 'dead'] as const;
    const list = kinds.map((k) => map.trees.filter((t) => t.kind === k));
    const merge = (parts: THREE.BufferGeometry[]) => {
      const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
      for (const f of flat) for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'normal') f.deleteAttribute(k);
      return mergeGeometries(flat)!;
    };
    // Pine: three stacked cones on a short trunk.
    const pine = merge([0, 1, 2].map((i) => new THREE.ConeGeometry(1.7 - i * 0.42, 2.3 - i * 0.3, 7).translate(0, 2.2 + i * 1.25, 0)));
    // Oak: a cluster of rounded clumps on a taller trunk.
    const oak = merge([
      new THREE.IcosahedronGeometry(1.5, 0).translate(0, 3.6, 0),
      new THREE.IcosahedronGeometry(1.1, 0).translate(0.9, 3.1, 0.3),
      new THREE.IcosahedronGeometry(1.0, 0).translate(-0.8, 3.2, -0.4),
      new THREE.IcosahedronGeometry(0.9, 0).translate(0.1, 4.5, -0.2),
    ]);
    // Dead tree: bare branches.
    const dead = merge([
      new THREE.CylinderGeometry(0.05, 0.12, 1.6, 4).rotateZ(0.7).translate(0.55, 2.6, 0),
      new THREE.CylinderGeometry(0.05, 0.1, 1.3, 4).rotateZ(-0.8).translate(-0.45, 2.9, 0.1),
      new THREE.CylinderGeometry(0.04, 0.08, 1.1, 4).rotateX(0.7).translate(0, 3.3, 0.35),
    ]);
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.26, 2.6, 5).translate(0, 1.3, 0);
    const crownMat = new THREE.MeshLambertMaterial({ flatShading: true });
    const geos = [pine, oak, dead];
    const palettes = [
      [0x1f3d24, 0x264a2a, 0x1b3520, 0x2c5230],
      [0x3b5226, 0x46602c, 0x354a22, 0x52662f],
      [0x5a4a3a, 0x4f4234, 0x62513e, 0x564636],
    ];
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x3e2d1f }), map.trees.length);
    const meshes: THREE.InstancedMesh[] = [];
    const entries: { mesh: number; k: number; cell: number; color: THREE.Color }[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let ti = 0;
    list.forEach((trees, kind) => {
      const mesh = new THREE.InstancedMesh(geos[kind], kind === 2 ? new THREE.MeshLambertMaterial({ flatShading: true }) : crownMat, Math.max(1, trees.length));
      mesh.count = trees.length;
      meshes.push(mesh);
      trees.forEach((t, k) => {
        const h = Math.abs(Math.sin(t.x * 12.9898 + t.y * 78.233)) * 1000;
        p.set(t.x, this.terrainAt(t.x, t.y) - 0.1, t.y);
        q.setFromAxisAngle(up, h % 6.28);
        const tall = 0.85 + ((h * 7) % 1) * 0.35;
        sc.set(t.s, t.s * tall, t.s);
        m.compose(p, q, sc);
        mesh.setMatrixAt(k, m);
        trunks.setMatrixAt(ti++, m);
        const pal = palettes[kind];
        const color = new THREE.Color(pal[Math.floor(h) % pal.length]);
        mesh.setColorAt(k, color);
        const cell = Math.floor(t.y / map.cell) * n + Math.floor(t.x / map.cell);
        entries.push({ mesh: kind, k, cell, color });
      });
    });
    this.scene.add(trunks, ...meshes);
    this.trees = { meshes, entries };
  }

  /** Water surface along the river: a ribbon a little below the banks. */
  private buildWater(map: GameMap) {
    const rp = map.riverPath;
    const half = map.riverWidth / 2 + 1.5;
    const pos: number[] = [];
    const idx: number[] = [];
    rp.forEach((p, i) => {
      const a = rp[Math.max(0, i - 1)];
      const b = rp[Math.min(rp.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / l;
      const ny = (b.x - a.x) / l;
      pos.push(p.x + nx * half, WATER_LEVEL, p.y + ny * half, p.x - nx * half, WATER_LEVEL, p.y - ny * half);
      if (i) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Drawn before the ground overlays and without writing depth, so the fog, aim arrows and
    // spell markings painted on the river bed show on top of the water.
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1a3d48, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }));
    water.renderOrder = -1;
    this.scene.add(water);
  }

  /** Stone-footed plank bridges where the roads cross the river. */
  private buildBridges(map: GameMap) {
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4f33, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x4a3524, flatShading: true });
    const stone = new THREE.MeshLambertMaterial({ color: 0x6f6a62, flatShading: true });
    for (const b of map.bridges) {
      const g = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(b.length, 0.3, b.width), wood);
      deck.position.y = BRIDGE_DECK - 0.15;
      deck.receiveShadow = true;
      g.add(deck);
      for (let x = -b.length / 2 + 0.6; x < b.length / 2; x += 1.2) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, b.width), dark);
        plank.position.set(x, BRIDGE_DECK + 0.01, 0);
        g.add(plank);
      }
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(b.length, 0.18, 0.2), dark);
        rail.position.set(0, BRIDGE_DECK + 0.9, side * (b.width / 2 - 0.1));
        rail.castShadow = true;
        g.add(rail);
        for (let x = -b.length / 2 + 0.3; x <= b.length / 2; x += 2.4) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.0, 0.24), dark);
          post.position.set(x, BRIDGE_DECK + 0.4, side * (b.width / 2 - 0.1));
          g.add(post);
        }
        for (const end of [-1, 1]) {
          const pier = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 1.4), stone);
          pier.position.set(end * (b.length / 2 - 0.6), -0.9, side * (b.width / 2 - 0.4));
          g.add(pier);
        }
      }
      for (const x of [-b.length / 6, b.length / 6]) {
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 2, 7), stone);
        pier.position.set(x, -0.9, 0);
        g.add(pier);
      }
      g.position.set(b.x, 0, b.y);
      g.rotation.y = -b.angle;
      this.scene.add(g);
    }
  }

  /** River curbs: a low wall of rough stones along the banks wherever you can't walk down. */
  private buildCurbs(map: GameMap) {
    const n = map.grid;
    const cells: number[] = [];
    map.cliff.forEach((c, i) => c && cells.push(i));
    // The rim of each ward hill: a ring of rock (you can't climb up there).
    map.hillTop.forEach((c, i) => {
      if (!c) return;
      const edge = [i - 1, i + 1, i - n, i + n].some((k) => !map.hillTop[k]);
      if (edge) cells.push(i);
    });
    if (!cells.length) return;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), cells.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    let k = 0;
    for (const i of cells) {
      const cx = i % n;
      const cy = (i - cx) / n;
      for (let j = 0; j < 2; j++) {
        const h = Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1;
        const x = (cx + 0.3 + j * 0.4 + (h - 0.5) * 0.3) * map.cell;
        const y = (cy + 0.3 + j * 0.4 + (((h * 7) % 1) - 0.5) * 0.3) * map.cell;
        e.set(h * 3, h * 5, h * 2);
        q.setFromEuler(e);
        const sz = 0.75 + h * 0.4;
        m.compose(new THREE.Vector3(x, this.terrainAt(x, y) - 0.25, y), q, new THREE.Vector3(sz * 1.2, sz * 0.9, sz * 1.2));
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k++, new THREE.Color().setHSL(0.08, 0.08, 0.13 + h * 0.08));
      }
    }
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.scene.add(mesh);
  }

  /** Boulders and stones in the woods and along the river banks. */
  private buildRocks(map: GameMap) {
    const n = map.grid;
    const spots: { x: number; y: number; s: number }[] = [];
    for (let i = 0; i < 900 && spots.length < 260; i++) {
      const h = (k: number) => Math.abs(Math.sin(i * 91.7 + k * 47.3) * 43758.5453) % 1;
      const x = 6 + h(1) * (map.size - 12);
      const y = 6 + h(2) * (map.size - 12);
      const cx = Math.floor(x / map.cell);
      const cy = Math.floor(y / map.cell);
      // Only in the woods: next to trees, never on roads or lanes.
      if (map.walkable[cy * n + cx]) continue;
      if (map.trees.length && !map.walkable[cy * n + cx] && h(3) < 0.4) spots.push({ x, y, s: 0.4 + h(4) * 0.9 });
    }
    // Banks: a line of stones along both sides of the river.
    map.riverPath.forEach((p, i) => {
      if (i % 3) return;
      const a = map.riverPath[Math.max(0, i - 1)];
      const b = map.riverPath[Math.min(map.riverPath.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const side = i % 2 ? 1 : -1;
      const off = map.riverWidth / 2 + 0.8;
      spots.push({ x: p.x + (-(b.y - a.y) / l) * off * side, y: p.y + ((b.x - a.x) / l) * off * side, s: 0.5 + ((i * 0.37) % 1) * 0.7 });
    });
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.8, 0), new THREE.MeshLambertMaterial({ color: 0x6d6860, flatShading: true }), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((r, k) => {
      q.setFromEuler(new THREE.Euler(r.x % 1, r.y % 3, 0));
      m.compose(new THREE.Vector3(r.x, this.terrainAt(r.x, r.y) + 0.1 * r.s, r.y), q, new THREE.Vector3(r.s * 1.3, r.s * 0.75, r.s));
      rocks.setMatrixAt(k, m);
    });
    rocks.receiveShadow = true;
    this.scene.add(rocks);
  }

  // ------------------------------------------------------------------ camera & input

  resize() {
    super.resize();
    if (!this.gl) return;
    this.gl.setSize(this.cssW, this.cssH, false);
    this.camera.aspect = this.cssW / Math.max(1, this.cssH);
    this.camera.updateProjectionMatrix();
  }

  /** Where on the ground the screen point is (ray against the terrain). */
  screenToWorld(sx: number, sy: number) {
    this.placeCamera();
    const ndc = new THREE.Vector2((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const r = this.raycaster.ray;
    // Step along the ray until it dips below the ground (cheap; no triangle tests).
    const d = r.direction;
    const o = r.origin;
    let prev = 0;
    for (let t = 0; t < 400; t += 0.5) {
      const x = o.x + d.x * t;
      const z = o.z + d.z * t;
      if (o.y + d.y * t <= this.elevationAt(x, z)) {
        const tt = (prev + t) / 2;
        return { x: o.x + d.x * tt, y: o.z + d.z * tt };
      }
      prev = t;
    }
    const t = -o.y / (d.y || -1e-6);
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  private placeCamera() {
    // Same scale at the screen centre as the 2D view (this.zoom = pixels per meter).
    const span = (this.cssH / Math.max(1, this.zoom)) * CLOSER;
    const dist = (span * Math.sin(PITCH)) / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));
    const gy = this.elevationAt(this.camX, this.camY);
    this.camera.position.set(this.camX, gy + dist * Math.sin(PITCH), this.camY + dist * Math.cos(PITCH));
    this.camera.lookAt(this.camX, gy, this.camY);
    this.camera.updateMatrixWorld();
  }

  screenOf(x: number, y: number, h = 0) {
    return this.toScreen(x, y, h);
  }

  /** Screen position (CSS pixels) of a point `h` meters above the ground. */
  private toScreen(x: number, y: number, h: number) {
    const v = new THREE.Vector3(x, this.elevationAt(x, y) + h, y).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.cssW, y: ((1 - v.y) / 2) * this.cssH, on: v.z < 1 };
  }

  // ------------------------------------------------------------------ frame

  /** Ground layer: the 2D renderer draws into the effects texture instead of the screen. */
  protected beginWorld(_w: World) {
    const ctx = this.ctx;
    // Centre the effects area a little ahead of the camera (the view reaches further up).
    this.fxX = this.camX - FX_SPAN / 2;
    this.fxY = this.camY - 6 - FX_SPAN / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fxPx, this.fxPx);
    ctx.save();
    const k = this.fxPx / FX_SPAN;
    ctx.scale(k, k);
    ctx.translate(-this.fxX, -this.fxY);
  }

  render(w: World, alpha: number, focus: Unit | undefined, viewTeam: Team, aim: Aim | null = null) {
    this.frameNo++;
    const now = performance.now();
    this.dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // 1. Ground effects via the 2D renderer (also moves the camera).
    this.ctx = this.fxCtx;
    super.render(w, alpha, focus, viewTeam, aim);
    this.ctx = this.overlay;
    const c = this.fxCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.fxPx, 2);
    c.clearRect(0, this.fxPx - 2, this.fxPx, 2);
    c.clearRect(0, 0, 2, this.fxPx);
    c.clearRect(this.fxPx - 2, 0, 2, this.fxPx);
    this.fxTex.offset.set(-this.fxX / FX_SPAN, 1 - this.mapSize / FX_SPAN + this.fxY / FX_SPAN);
    this.fxTex.needsUpdate = true;

    // 2. Fog of war + trees in fog + day/night.
    this.updateFog(w, viewTeam);
    const nightTarget = isNight(w.time) ? 1 : 0;
    this.night += (nightTarget - this.night) * 0.03;
    this.sky.intensity = 1.5 - this.night * 0.75;
    this.sun.intensity = 2.4 - this.night * 1.6;
    this.sun.color.setRGB(1, 0.95 - this.night * 0.2, 0.87 + this.night * 0.1);

    // 3. Units and buildings.
    this.placeCamera();
    this.camera.position.add(this.fx3.shakeOffset(this.clock));
    this.sun.position.set(this.camX + 25, 60, this.camY + 18);
    this.sun.target.position.set(this.camX, 0, this.camY - 6);
    this.clock += this.dt;
    this.world = w;
    this.viewTeam = viewTeam;
    this.syncCtx();
    this.syncUnits(w, alpha, viewTeam);
    this.spells.update(this.actx, w, viewTeam, alpha);
    this.updateTeleports(w, viewTeam);
    this.updateCorpses();
    this.fx3.update(this.dt, this.clock);
    this.gl.render(this.scene, this.camera);

    // 4. Bars, names, numbers and the minimap on top.
    this.drawOverlay(w, alpha, focus, viewTeam);
  }

  private updateFog(w: World, team: Team) {
    // Vision only changes a few times a second: rebuild the fog texture only then.
    const key = `${w.vision.version}|${team}|${isNight(w.time)}`;
    if (key === this.fogKey) return;
    this.fogKey = key;
    const g = w.vision.grids[team];
    const n = this.grid;
    const d = this.fogTex.image.data as Uint8Array;
    const a = isNight(w.time) ? 175 : 145;
    for (let cy = 0; cy < n; cy++) {
      const row = (n - 1 - cy) * n; // texture rows run bottom-up
      for (let cx = 0; cx < n; cx++) {
        const o = (row + cx) * 4;
        d[o] = 6;
        d[o + 1] = 10;
        d[o + 2] = 18;
        d[o + 3] = g[cy * n + cx] ? 0 : a;
      }
    }
    this.fogTex.needsUpdate = true;
    // Trees outside vision get darker (a few times per second is enough).
    const now = performance.now();
    if (this.trees && now - this.lastTreeShade > 250) {
      this.lastTreeShade = now;
      const { meshes, entries } = this.trees;
      const tmp = new THREE.Color();
      for (const e of entries) {
        const cx = e.cell % n;
        const cy = (e.cell / n) | 0;
        // A tree is "seen" if any neighbouring cell is in vision.
        let lit = false;
        for (let dy = -1; dy <= 1 && !lit; dy++)
          for (let dx = -1; dx <= 1 && !lit; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x >= 0 && y >= 0 && x < n && y < n && g[y * n + x]) lit = true;
          }
        meshes[e.mesh].setColorAt(e.k, tmp.copy(e.color).multiplyScalar(lit ? 1 : 0.4));
      }
      for (const mesh of meshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private place(key: string, id: string, x: number, y: number, h = 0, rotY = 0, scale = 1): THREE.Object3D {
    return this.placeObj(key, id, x, y, h, rotY, scale).o;
  }

  private placeObj(key: string, id: string, x: number, y: number, h = 0, rotY = 0, scale = 1): Obj {
    let e = this.objs.get(id);
    // Rebuild when the key changes.
    if (!e || e.key !== key) {
      if (e) this.scene.remove(e.o);
      const o = model(key);
      e = { o, seen: 0, key, joints: jointsOf(o) };
      this.scene.add(o);
      this.objs.set(id, e);
    }
    e.seen = this.frameNo;
    e.o.position.set(x, this.elevationAt(x, y) + h, y);
    e.o.rotation.y = rotY;
    e.o.scale.setScalar(scale);
    return e;
  }

  /** Model key for a unit (same model is used for its death animation). */
  private keyOf(u: Unit): { key: string; scale: number } | null {
    if (u.kind === 'hero') return { key: `hero:${u.hero!.defId}`, scale: HERO_SCALE };
    if (u.creep) return { key: `creep:${u.creep.type}:${u.team === 1 ? 1 : 0}`, scale: u.creep.super ? CREEP_SCALE * 1.2 : CREEP_SCALE };
    if (u.neutral) return { key: u.neutral.boss ? 'warden' : u.radius > 0.9 ? 'brute' : 'imp', scale: u.neutral.boss ? 1.8 : 1.6 };
    return null;
  }

  /** Copy the renderer's frame state into the animation context. */
  private syncCtx() {
    const c = this.actx;
    c.clock = this.clock;
    c.dt = this.dt;
    c.world = this.world;
    c.meId = this.meId;
    c.camX = this.camX;
    c.camY = this.camY;
  }

  pushEvents(w: World, events: GameEvent[], meId = -1) {
    super.pushEvents(w, events, meId);
    this.meId = meId;
    this.world = w;
    this.syncCtx();
    const c = this.actx;
    /** Syl's Execution this batch (its explosion event follows the cast). */
    let exec = -1;
    for (const e of events) {
      if (e.type === 'glyph') {
        for (const u of w.units) {
          if (!u.alive || !u.structure || u.team !== e.team || u.structure.glyph <= 0) continue;
          this.fx3.flash(u.x, u.y, 4, u.radius * 4, 0xffd36a, 0.5);
          this.fx3.shockwave(u.x, u.y, u.radius + 4, 0xffd36a, 0.5);
        }
      } else if (e.type === 'attack') {
        const src = w.unit(e.sourceId);
        if (src?.structure && w.canSee(this.viewTeam, src)) {
          // The tower's crystal flares as it fires.
          this.fx3.flash(src.x, src.y, towerTop(src.structure.tier) + 2.35, 3.2, TEAM_HEX[src.team === 1 ? 1 : 0], 0.25);
        }
        const a = this.anim(e.sourceId);
        a.atk = 1;
        a.atkAt = this.clock;
        a.atkTarget = e.targetId;
        a.impactDone = false;
        const u = w.unit(e.sourceId);
        if (u?.hero) heroAttack(c, u, a);
        else a.side = -a.side;
      } else if (e.type === 'cast') {
        const a = this.anim(e.unitId);
        const u = w.unit(e.unitId);
        if (e.slot >= 0) {
          a.cast = 1;
          a.castSlot = e.slot;
          a.castAt = this.clock;
        }
        if (!u?.hero) continue;
        if (u.hero.defId === 'syl' && e.slot === 2) exec = u.id;
        if (w.canSee(this.viewTeam, u)) heroCast(c, u, e.slot, a);
        else if (e.slot === -1) a.blastAt = this.clock;
      } else if (e.type === 'damage' && e.kind === 'spell') {
        const src = w.unit(e.sourceId);
        const t = w.unit(e.targetId);
        if (!src?.hero || !t || !w.canSee(this.viewTeam, t)) continue;
        // Shield Charge connecting: a shield bash flash on whoever got hit.
        if (src.hero.defId === 'brakk' && this.clock - this.anim(src.id).castAt < 0.6 && this.anim(src.id).castSlot === 0) {
          this.fx3.sparks(t.x, t.y, 1.6, 10, 0xffe2a0, 6);
          this.fx3.shockwave(t.x, t.y, 2.4, 0xffe2a0, 0.3);
        } else this.spells.onSpellHit(c, src.hero.defId, t.x, t.y);
      } else if (e.type === 'explosion') {
        this.spells.onExplosion(c, w, this.viewTeam, e.x, e.y, e.radius, e.radius < 2 ? exec : -1);
      } else if (e.type === 'wardenSlam') {
        const a = this.anim(e.unitId);
        const u = w.unit(e.unitId);
        if (e.phase === 'windup') {
          a.castAt = this.clock;
          a.castSlot = 9;
        } else {
          a.blastAt = this.clock;
          if (u && w.canSee(this.viewTeam, u)) wardenSlamFx(c, e.x, e.y, e.radius);
        }
      } else if (e.type === 'itemActive') {
        const u = w.unit(e.unitId);
        if (!u || !w.canSee(this.viewTeam, u)) continue;
        if (e.kind === 'manaBurst') {
          this.fx3.shockwave(u.x, u.y, 10, 0x60a5fa, 0.5, 0.8);
          this.fx3.sparks(u.x, u.y, 1, 14, 0xbfdbfe, 4);
        } else if (e.kind === 'frostNova') {
          this.fx3.shockwave(u.x, u.y, 6.5, 0xbae6fd, 0.4, 0.95);
          this.fx3.shockwave(u.x, u.y, 5, 0xffffff, 0.3, 0.6);
          this.fx3.dust(u.x, u.y, 10, 1.4, 0xe0f2fe, 4, 0.8);
          this.fx3.sparks(u.x, u.y, 1, 18, 0xe0f2fe, 7);
        } else {
          this.fx3.flash(u.x, u.y, 2, 5, 0xd6d3d1, 0.4);
          this.fx3.shockwave(u.x, u.y, 2.6, 0xa8a29e, 0.35);
        }
      } else if (e.type === 'blink') {
        const u = w.unit(e.unitId);
        if (u && w.canSee(this.viewTeam, u)) heroBlink(c, u, e.fromX, e.fromY);
      } else if (e.type === 'teleport') {
        const u = w.unit(e.unitId);
        const from = this.tpFrom.get(e.unitId);
        const col = TEAM_HEX[u?.team === 1 ? 1 : 0];
        if (u) {
          this.fx3.flash(u.x, u.y, 1.5, 7, col, 0.5);
          this.fx3.shockwave(u.x, u.y, 4, col, 0.5);
          this.fx3.sparks(u.x, u.y, 1, 14, 0xffffff, 6);
        }
        if (from) {
          this.fx3.flash(from.x, from.y, 1.5, 6, col, 0.45);
          this.fx3.dust(from.x, from.y, 6, 1.2, 0xbcd7ff, 1);
        }
        this.tpFrom.delete(e.unitId);
      } else if (e.type === 'death') {
        const u = w.unit(e.unitId);
        const k = u && this.keyOf(u);
        const live = this.objs.get('u' + e.unitId);
        if (!u || !k || !live) continue;
        // Reuse the live model as the corpse.
        this.objs.delete('u' + e.unitId);
        this.anims.delete(e.unitId);
        const mk = live.joints.rig && !u.hero ? monsterKind(live.key) : null;
        this.corpses.push({ o: live.o, t: 0, joints: live.joints, kind: live.joints.rig && u.hero ? u.hero.defId : undefined, mkind: mk ?? undefined, x: u.x, y: u.y });
      }
    }
  }

  /** Teleport beams: at the hero (if you can see them) and at the destination (if you can see that spot). */
  private updateTeleports(w: World, team: Team) {
    for (const h of w.heroes) {
      const c = h.hero!.channel;
      if (!c || c.kind !== 'tp' || !h.alive) continue;
      const k = 1 - c.t / c.total;
      const col = TEAM_HEX[h.team === 1 ? 1 : 0];
      if (!this.tpFrom.has(h.id)) this.tpFrom.set(h.id, { x: h.x, y: h.y });
      if (w.canSee(team, h)) this.fx3.beam('from' + h.id, h.x, h.y, col, k);
      const t = w.unit(c.targetId);
      if (t) {
        const dest = tpLanding(w, h.team as Team, t);
        // Enemies only see the arrival beam if that spot is outside their fog.
        if (h.team === team || w.vision.seesPoint(team, dest.x, dest.y)) this.fx3.beam('to' + h.id, dest.x, dest.y, col, k);
      }
    }
  }

  private anim(id: number): Anim {
    let a = this.anims.get(id);
    if (!a) this.anims.set(id, (a = newAnim()));
    return a;
  }

  /** Walk cycle, attack swing and casting pose, layered on the model's rest pose. */
  private animate(e: Obj, u: Unit, time: number) {
    if (u.hero && e.joints.rig) return animateHero(this.actx, e.o, e.joints, u, this.anim(u.id), time);
    const mk = e.joints.rig ? monsterKind(e.key) : null;
    if (mk) return animateMonster(this.actx, mk, e.o, e.joints, u, this.anim(u.id), time);
    const a = this.anim(u.id);
    const dt = this.dt;
    const speed = Math.hypot(u.x - u.px, u.y - u.py) * 30; // meters per second
    const moving = speed > 0.5 && u.stunTimer <= 0;
    a.walk += ((moving ? 1 : 0) - a.walk) * Math.min(1, dt * 10);
    if (moving) a.phase += dt * (5 + speed * 0.9);
    a.atk = Math.max(0, a.atk - dt / 0.38);
    a.cast = Math.max(0, a.cast - dt / 0.55);
    const swing = Math.sin(a.phase) * 0.75 * a.walk;
    const hit = a.atk > 0 ? Math.sin((1 - a.atk) * Math.PI) : 0;
    const cast = a.cast > 0 ? Math.sin((1 - a.cast) * Math.PI) : 0;
    const breathe = Math.sin(time * 2.2 + u.id) * 0.03 * (1 - a.walk);
    const j = e.joints;
    pose(j.legL, swing, 0, 0);
    pose(j.legR, -swing, 0, 0);
    pose(j.armL, -swing * 0.6 - cast * 1.9 - hit * 0.5, 0, -cast * 0.4);
    pose(j.armR, swing * 0.6 - cast * 1.9 - hit * 2.0, 0, cast * 0.4);
    pose(j.torso, breathe + hit * 0.25 - cast * 0.15, hit * 0.35, 0);
    if (j.rig) {
      const rp = j.rig.userData.restPos as number[];
      j.rig.position.set(rp[0], rp[1] + Math.abs(Math.sin(a.phase)) * 0.09 * a.walk, rp[2]);
    }
  }

  private updateCorpses() {
    this.corpses = this.corpses.filter((c) => {
      c.t += this.dt;
      if (c.kind || c.mkind) {
        const keep = c.mkind ? monsterCorpse(this.actx, c as MonsterCorpse) : heroCorpse(this.actx, c);
        if (!keep) this.scene.remove(c.o);
        return keep;
      }
      const fall = Math.min(1, c.t / 0.45);
      c.o.rotation.order = 'YXZ';
      c.o.rotation.x = -fall * fall * (Math.PI / 2) * 0.95;
      pose(c.joints.armL, -1.2 * fall, 0, -0.5 * fall);
      pose(c.joints.armR, -1.2 * fall, 0, 0.5 * fall);
      if (c.t > 1.1) c.o.position.y -= this.dt * 1.6;
      if (c.t > 2) {
        this.scene.remove(c.o);
        return false;
      }
      return true;
    });
  }

  private syncUnits(w: World, alpha: number, team: Team) {
    const t = w.time;
    const face = (f: number) => Math.PI / 2 - f;
    for (const u of w.units) {
      const id = 'u' + u.id;
      if (u.kind === 'structure') {
        const tier = u.structure!.tier;
        const side = u.team === 1 ? 1 : 0;
        if (u.alive) this.place(`structure:${tier}:${side}${u.structure!.rax ? ':' + u.structure!.rax : ''}`, id, u.x, u.y, 0, side ? Math.PI : 0);
        else this.place(`rubble:${u.radius}`, id, u.x, u.y);
        // Tower shield (glyph): a golden dome over every shielded building, seen by everyone.
        const gl = u.structure!.glyph;
        if (u.alive && gl > 0) {
          const k = Math.min(1, gl / 0.6, (GLYPH_DURATION - gl) / 0.3 + 0.2);
          const tall = tier === 'barracks' ? 6.5 : tier === 'shrine' ? 9 : 10;
          this.fx3.shield('glyph' + u.id, u.x, u.y, u.radius + 1.8, tall, Math.max(0, k));
        }
        continue;
      }
      if (!u.alive || !w.canSee(team, u)) continue;
      let x = u.px + (u.x - u.px) * alpha;
      let y = u.py + (u.y - u.py) * alpha;
      const l = this.lunges.get(u.id);
      if (l) {
        const push = Math.sin((l.t / 0.16) * Math.PI) * 0.45;
        x += Math.cos(l.ang) * push;
        y += Math.sin(l.ang) * push;
      }
      const k = this.keyOf(u);
      if (k) {
        const e = this.placeObj(k.key, id, x, y, 0, face(u.facing), k.scale);
        this.animate(e, u, t);
        if (u.kind === 'hero') {
          setOpacity(e.o, isInvisible(u) ? 0.45 : 1);
          buffFx(this.actx, e.o, u, this.anim(u.id));
        }
      } else if (u.ward) {
        this.place(`ward:${u.ward.kind}`, id, u.x, u.y);
      }
    }
    for (const r of w.runes) {
      if (!w.vision.seesPoint(team, r.x, r.y)) continue;
      this.place(`rune:${r.kind}`, 'r' + r.id, r.x, r.y, Math.sin(t * 2) * 0.2, t);
    }
    for (const p of w.projectiles) {
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      if (p.team !== team && !w.vision.seesPoint(team, x, y)) continue;
      // Arrows and bolts point the way they fly; tower bolts drop from the crystal onto the target.
      const dir = Math.atan2(p.x - p.px, p.y - p.py);
      const src = w.unit(p.sourceId);
      let h = 1.6;
      if (src?.structure) {
        const t = w.unit(p.targetId);
        const left = t ? Math.hypot(t.x - x, t.y - y) : 0;
        h = 1.4 + Math.min(1, left / 11) * (towerTop(src.structure.tier) + 1);
      }
      this.place(p.spell ? 'shot:spell' : SpellFx.shotKey(w, p.sourceId, !!p.crit, p.team), 'p' + p.id, x, y, h, dir);
    }
    for (const s of w.skillshots) {
      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha;
      if (s.team !== team && !w.vision.seesPoint(team, x, y)) continue;
      this.place(`shot:${s.kind}`, 's' + s.id, x, y, s.kind === 'tidalWave' ? 0.45 : 1.4, Math.atan2(s.dx, s.dy));
    }
    for (const [id, e] of this.objs) {
      if (e.seen !== this.frameNo) {
        this.scene.remove(e.o);
        this.objs.delete(id);
      }
    }
  }

  // ------------------------------------------------------------------ screen overlay

  private drawOverlay(w: World, alpha: number, focus: Unit | undefined, team: Team) {
    const ctx = this.overlay;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    const bar = (x: number, y: number, wd: number, ht: number, ratio: number, color: string) => {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - wd / 2 - 1, y - 1, wd + 2, ht + 2);
      ctx.fillStyle = color;
      ctx.fillRect(x - wd / 2, y, wd * Math.max(0, Math.min(1, ratio)), ht);
    };
    ctx.textAlign = 'center';
    for (const u of w.units) {
      if (!u.alive) continue;
      if (u.kind === 'structure') {
        if (u.hp >= u.maxHp) continue;
        const p = this.toScreen(u.x, u.y, u.structure!.tier === 'barracks' ? 6 : 8.5);
        bar(p.x, p.y, 64, 6, u.hp / u.maxHp, TEAM_COLORS[u.team]);
        continue;
      }
      if (u.ward || !w.canSee(team, u)) continue;
      const x = u.px + (u.x - u.px) * alpha;
      const y = u.py + (u.y - u.py) * alpha;
      if (u.kind === 'hero') {
        const p = this.toScreen(x, y, 2.3 * HERO_SCALE);
        const def = HEROES[u.hero!.defId];
        bar(p.x, p.y, 50, 6, u.hp / u.maxHp, TEAM_COLORS[u.team]);
        bar(p.x, p.y + 8, 50, 3, u.mana / Math.max(1, u.maxMana), '#5aa9ff');
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.fillStyle = u === focus ? '#ffe066' : '#fff';
        const label = `${u.hero!.level} ${def.name}`;
        ctx.strokeText(label, p.x, p.y - 4);
        ctx.fillText(label, p.x, p.y - 4);
        if (u.stunTimer > 0) this.stars(p.x, p.y - 20, w.time);
        continue;
      }
      const boss = !!u.neutral?.boss;
      const h = boss ? 6 : u.neutral ? 3 : 2.9;
      if (u.stunTimer > 0) {
        const p = this.toScreen(x, y, h + 0.4);
        this.stars(p.x, p.y - 8, w.time);
      }
      if (u.hp >= u.maxHp && !boss) continue;
      const p = this.toScreen(x, y, h);
      const color = u.neutral ? (boss ? '#a78bfa' : '#d9a25f') : TEAM_COLORS[u.team];
      const wd = boss ? 70 : 26;
      bar(p.x, p.y, wd, boss ? 6 : 4, u.hp / u.maxHp, color);
      if (boss) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillStyle = '#e9d5ff';
        ctx.fillText('Warden', p.x, p.y - 4);
      } else if (u.creep && focus?.alive && this.oneHitKills(w, focus, u)) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - wd / 2 - 3, p.y - 3, wd + 6, 10);
      }
    }
    for (const f of this.floaters) {
      const p = this.toScreen(f.x, f.y + 1.6, 2.6 + (1 - f.t) * 1.4);
      ctx.globalAlpha = Math.min(1, f.t * 2);
      ctx.font = `bold ${f.big ? 18 : 13}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.fillStyle = f.color;
      ctx.strokeText(f.text, p.x, p.y);
      ctx.fillText(f.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    this.drawMinimap(w, focus, team);
  }

  private stars(x: number, y: number, time: number) {
    const ctx = this.overlay;
    ctx.fillStyle = '#ffe066';
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 12, y + Math.sin(a) * 4, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

interface Obj {
  o: THREE.Object3D;
  seen: number;
  key: string;
  joints: Partial<Record<Joint, THREE.Object3D>>;
}

/** Where a teleport lands: on the home side of the target building (same rule as the simulation). */
function tpLanding(w: World, team: Team, t: Unit) {
  const f = w.map.fountains[team];
  const d = Math.hypot(t.x - f.x, t.y - f.y) || 1;
  const off = t.radius + TELEPORT.offset;
  return { x: t.x + ((f.x - t.x) / d) * off, y: t.y + ((f.y - t.y) / d) * off };
}

function jointsOf(o: THREE.Object3D): Partial<Record<Joint, THREE.Object3D>> {
  const j: Partial<Record<Joint, THREE.Object3D>> = {};
  for (const n of JOINTS) {
    const x = o.getObjectByName(n);
    if (x) j[n] = x;
  }
  return j;
}
function overlayMaterial(map: THREE.Texture, order: number) {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -order,
    polygonOffsetUnits: -order * 2,
    toneMapped: false,
  });
}

/** See-through heroes (invisible allies). Materials are shared, so swap in a faded copy. */
const faded = new WeakMap<THREE.Material, THREE.Material>();
function setOpacity(o: THREE.Object3D, a: number) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const base = (m.userData.base as THREE.Material) ?? m.material;
    m.userData.base = base;
    if (a >= 1) {
      m.material = base;
      return;
    }
    let f = faded.get(base);
    if (!f) {
      f = (base as THREE.Material).clone();
      f.transparent = true;
      f.opacity = 0.45;
      f.depthWrite = false;
      faded.set(base, f);
    }
    m.material = f;
  });
}

export { TEAM_HEX };

/** Height of a tower's top platform (matches the models: the crystal floats 2.35 m above it). */
function towerTop(tier: string): number {
  const lvl = tier === 'tower1' ? 0 : tier === 'tower2' ? 1 : tier === 'tower3' ? 2 : tier === 'shrineTower' ? 3 : 1;
  return 0.95 + 4.8 + lvl * 0.6;
}
