import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GameMap, HEROES, TELEPORT, Team, Unit, World, abilityLevel, isHouseWallAt, isInvisible, isNight } from '../sim';
import type { Aim } from './input';
import { Renderer, TEAM_COLORS } from './renderer';
import { JOINTS, Joint, TEAM_HEX, model } from './three/models';
import { Character, character, hasAsset, loadAssets } from './three/assets';
import { Fx3D } from './three/fx';
import type { GameEvent } from '../sim';

/** Ground level per map height (1 = normal, 2 = base plateau, 3 = ward hill), in meters. */
const ELEVATION = [0, 0, 1.1, 2.2];
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
  private trees: { crowns: THREE.InstancedMesh; cells: Int32Array; colors: THREE.Color[] } | null = null;
  private objs = new Map<string, Obj>();
  /** Per-unit animation clocks (walk cycle, attack swing, cast). */
  private anims = new Map<number, Anim>();
  /** Units that just died: they fall over and sink for a moment. */
  private corpses: { o: THREE.Object3D; t: number; joints: Partial<Record<Joint, THREE.Object3D>>; kind?: 'brakk'; x?: number; y?: number; thud?: boolean }[] = [];
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
    // Soft surrounding light for the artist models' metal and leather (computed once, cheap to use).
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
    const geo = new THREE.PlaneGeometry(map.size, map.size, n, n);
    geo.rotateX(-Math.PI / 2);
    geo.translate(map.size / 2, 0, map.size / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.elevationAt(pos.getX(i), pos.getZ(i)));
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
    this.buildHouse(map);
    this.fx3 = new Fx3D(this.scene, (x, y) => this.elevationAt(x, y));
    // Artist models load in the background; compile their shaders as soon as they arrive.
    void loadAssets(import.meta.env.BASE_URL).then(() => this.prewarmAssets());
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

  private prewarmAssets() {
    if (this.destroyed) return;
    const tmp = new THREE.Group();
    for (const k of ['hero:brakk', 'hero:vexa', 'hero:orin', 'hero:syl', 'hero:grom', 'hero:kaela', 'imp', 'brute', 'warden']) {
      const c = character(k);
      if (c) tmp.add(c.root);
    }
    for (const t of TINTS) {
      const c = character('creep', t);
      if (c) tmp.add(c.root);
    }
    tmp.position.set(this.camX, -50, this.camY);
    this.scene.add(tmp);
    this.gl.compile(this.scene, this.camera);
    this.scene.remove(tmp);
  }
  private destroyed = false;

  /** Free the GPU resources (when switching views or starting a new match). */
  destroy() {
    this.destroyed = true;
    this.gl.dispose();
  }

  /** Ground height at a world point (matches the terrain mesh). */
  elevationAt(x: number, y: number): number {
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
  private buildHouse(map: GameMap) {
    const h = map.house;
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
    const put = (k: number, a: number, r: number, len: number, hs: number, w = 1) => {
      const x = h.x + Math.cos(a) * r;
      const y = h.y + Math.sin(a) * r;
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

  private buildTrees(map: GameMap) {
    const n = map.grid;
    const cells: number[] = [];
    for (let i = 0; i < n * n; i++) {
      if (map.walkable[i] || isHouseWallAt(map.house, ((i % n) + 0.5) * map.cell, (Math.floor(i / n) + 0.5) * map.cell)) continue;
      cells.push(i);
    }
    const count = cells.length;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.4, 5);
    trunkGeo.translate(0, 0.7, 0);
    const crownGeo = new THREE.ConeGeometry(1.35, 3.4, 6);
    crownGeo.translate(0, 2.9, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4a3524 }), count);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ flatShading: true }), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const colors: THREE.Color[] = [];
    const palette = [0x2f5a2a, 0x386b2f, 0x2a4f2c, 0x3f7234, 0x274a26];
    cells.forEach((i, k) => {
      const cx = i % n;
      const cy = Math.floor(i / n);
      const h = ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
      const jx = ((h % 100) / 100 - 0.5) * 0.9;
      const jy = (((h >> 8) % 100) / 100 - 0.5) * 0.9;
      const x = (cx + 0.5) * map.cell + jx;
      const y = (cy + 0.5) * map.cell + jy;
      const sc = 0.8 + ((h >> 16) % 50) / 100;
      p.set(x, this.elevationAt(x, y), y);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (h % 628) / 100);
      s.set(sc, sc * (0.9 + ((h >> 4) % 30) / 100), sc);
      m.compose(p, q, s);
      trunks.setMatrixAt(k, m);
      crowns.setMatrixAt(k, m);
      const c = new THREE.Color(palette[h % palette.length]);
      colors.push(c);
      crowns.setColorAt(k, c);
    });
    this.scene.add(trunks, crowns);
    this.trees = { crowns, cells: Int32Array.from(cells), colors };
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
    this.syncUnits(w, alpha, viewTeam);
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
      const { crowns, cells, colors } = this.trees;
      const tmp = new THREE.Color();
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const cx = i % n;
        const cy = (i / n) | 0;
        // A tree is "seen" if any neighbouring walkable cell is in vision.
        let lit = false;
        for (let dy = -1; dy <= 1 && !lit; dy++)
          for (let dx = -1; dx <= 1 && !lit; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x >= 0 && y >= 0 && x < n && y < n && g[y * n + x]) lit = true;
          }
        crowns.setColorAt(k, tmp.copy(colors[k]).multiplyScalar(lit ? 1 : 0.4));
      }
      crowns.instanceColor!.needsUpdate = true;
    }
  }

  private place(key: string, id: string, x: number, y: number, h = 0, rotY = 0, scale = 1): THREE.Object3D {
    return this.placeObj(key, id, x, y, h, rotY, scale).o;
  }

  private placeObj(key: string, id: string, x: number, y: number, h = 0, rotY = 0, scale = 1): Obj {
    let e = this.objs.get(id);
    const ak = assetKey(key);
    // Rebuild when the key changes, or when an artist model finished loading for a placeholder.
    if (!e || e.key !== key || (!e.char && ak && hasAsset(ak))) {
      if (e) this.scene.remove(e.o);
      const ch = ak ? character(ak, creepTint(key)) : null;
      const o = ch ? ch.root : model(key);
      e = { o, seen: 0, key, joints: ch ? {} : jointsOf(o), char: ch ?? undefined };
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

  pushEvents(w: World, events: GameEvent[], meId = -1) {
    super.pushEvents(w, events, meId);
    this.meId = meId;
    for (const e of events) {
      if (e.type === 'attack') {
        const a = this.anim(e.sourceId);
        a.atk = 1;
        a.atkAt = this.clock;
        a.atkTarget = e.targetId;
        a.impactDone = false;
      } else if (e.type === 'cast') {
        const a = this.anim(e.unitId);
        const u = w.unit(e.unitId);
        if (e.slot >= 0) {
          a.cast = 1;
          a.castSlot = e.slot;
          a.castAt = this.clock;
        }
        if (u?.hero?.defId === 'brakk') this.brakkCast(u, e.slot, a);
      } else if (e.type === 'damage' && e.kind === 'spell') {
        // Shield Charge connecting: a shield bash flash on whoever got hit.
        const src = w.unit(e.sourceId);
        const t = w.unit(e.targetId);
        if (src?.hero?.defId === 'brakk' && t && this.clock - this.anim(src.id).castAt < 0.6 && this.anim(src.id).castSlot === 0) {
          this.fx3.sparks(t.x, t.y, 1.6, 10, 0xffe2a0, 6);
          this.fx3.shockwave(t.x, t.y, 2.4, 0xffe2a0, 0.3);
        }
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
        this.corpses.push({ o: live.o, t: 0, joints: live.joints, kind: u.hero?.defId === 'brakk' ? 'brakk' : undefined, x: u.x, y: u.y });
      }
    }
  }

  /** Brakk's spell effects: Shield Charge burst, Earthsplitter leap and slam. */
  private brakkCast(u: Unit, slot: number, a: Anim) {
    if (slot === 0) {
      this.fx3.dust(u.x, u.y, 8, 1.4, 0x9a8466, 1);
      a.trailAt = 0;
    } else if (slot === 2) {
      this.fx3.dust(u.x, u.y, 6, 1.3, 0x9a8466, 0.8);
    } else if (slot === -1) {
      // Earthsplitter lands: shockwaves, flying rocks, a dust ring and a shaking camera.
      a.blastAt = this.clock;
      this.fx3.flash(u.x, u.y, 0.6, 9, 0xffb050, 0.45);
      this.fx3.shockwave(u.x, u.y, 7.5, 0xffb060, 0.5, 0.95);
      this.fx3.shockwave(u.x, u.y, 9, 0x9a8466, 0.9, 0.6);
      this.fx3.debris(u.x, u.y, 18, 3.5, 8);
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2;
        const r = 3 + Math.random() * 3.5;
        this.fx3.dust(u.x + Math.cos(ang) * r, u.y + Math.sin(ang) * r, 2, 2, 0x8a7558, 0.6, 1.3);
      }
      this.fx3.sparks(u.x, u.y, 0.5, 16, 0xffb347, 7);
      const d = Math.hypot(u.x - this.camX, u.y - this.camY);
      this.fx3.shake = Math.max(this.fx3.shake, d < 30 ? 0.75 * (1 - d / 30) + (u.id === this.meId ? 0.25 : 0) : 0);
    }
  }

  /** Teleport beams: at the hero (if you can see them) and at the destination (everyone sees it). */
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
        this.fx3.beam('to' + h.id, dest.x, dest.y, col, k);
      }
    }
  }

  private anim(id: number): Anim {
    let a = this.anims.get(id);
    if (!a)
      this.anims.set(
        id,
        (a = { phase: 0, walk: 0, atk: 0, cast: 0, atkAt: -9, atkTarget: -1, impactDone: true, castAt: -9, castSlot: -1, blastAt: -9, trailAt: 0, stepSign: 1, ironHide: false, glintAt: 0 }),
      );
    return a;
  }

  /** Artist models: their own idle/walk clips where they have them, plus a lean for attacks and casts. */
  private animateChar(c: Character, u: Unit) {
    const a = this.anim(u.id);
    const dt = this.dt;
    const speed = Math.hypot(u.x - u.px, u.y - u.py) * 30;
    const moving = speed > 0.5 && u.stunTimer <= 0;
    a.walk += ((moving ? 1 : 0) - a.walk) * Math.min(1, dt * 8);
    if (moving) a.phase += dt * (5 + speed * 0.9);
    if (a.atk >= 1 && c.attack) c.attack.reset().play();
    a.atk = Math.max(0, a.atk - dt / 0.38);
    a.cast = Math.max(0, a.cast - dt / 0.55);
    const hit = a.atk > 0 ? Math.sin((1 - a.atk) * Math.PI) : 0;
    const cast = a.cast > 0 ? Math.sin((1 - a.cast) * Math.PI) : 0;
    if (c.walk) {
      c.walk.setEffectiveWeight(a.walk);
      c.walk.setEffectiveTimeScale(Math.max(0.6, Math.min(1.6, speed / 5)));
      c.idle?.setEffectiveWeight(1 - a.walk);
    }
    // No walk clip: a step bob and sway instead.
    const bob = c.walk ? 0 : Math.abs(Math.sin(a.phase)) * 0.12 * a.walk;
    const sway = c.walk ? 0 : Math.sin(a.phase) * 0.06 * a.walk;
    c.body.position.y = bob;
    c.body.rotation.set((c.attack ? 0 : hit * 0.35) - cast * 0.18 + (c.walk ? 0 : a.walk * 0.08), 0, sway);
    c.mixer?.update(dt);
  }

  /**
   * Brakk, animated by hand: a heavy stomping walk, breathing idle, an overhead hammer slam,
   * Shield Charge (lean in behind the shield), Earthsplitter (leap, then slam the ground) and a
   * dazed sway while stunned. Each part is a few keyframes per joint, added on top of the stance.
   */
  private animateBrakk(e: Obj, u: Unit, time: number) {
    const a = this.anim(u.id);
    const dt = this.dt;
    const now = this.clock;
    const j = e.joints;
    const speed = Math.hypot(u.x - u.px, u.y - u.py) * 30;
    const dashing = !!u.dash;
    const moving = speed > 0.5 && u.stunTimer <= 0 && !dashing;
    a.walk += ((moving ? 1 : 0) - a.walk) * Math.min(1, dt * 8);
    if (moving || dashing) a.phase += dt * (dashing ? 22 : 4.2 + speed * 0.75);
    const s = Math.sin(a.phase);
    const walk = a.walk;
    // Base: idle breathing, slow look-around, then a heavy walk on top.
    const breathe = Math.sin(time * 1.8 + u.id) * 0.035 * (1 - walk);
    const P = { torso: [breathe + walk * 0.12, s * 0.12 * walk, 0], head: [-walk * 0.08, Math.sin(time * 0.45 + u.id) * 0.18 * (1 - walk), 0], legL: [s * 0.6 * walk, 0, 0], legR: [-s * 0.6 * walk, 0, 0], armL: [s * 0.1 * walk, 0, 0], armR: [-s * 0.35 * walk, 0, 0], weapon: [Math.sin(time * 1.1 + u.id) * 0.05 * (1 - walk) - walk * 0.15, 0, 0] } as Record<string, number[]>;
    let rigY = -Math.abs(s) * 0.1 * walk;
    let rigX = 0;
    const addP = (k: string, x: number, y = 0, z = 0) => {
      P[k][0] += x;
      P[k][1] += y;
      P[k][2] += z;
    };
    // Heavy footfalls: a dust puff (and a thud for your own hero) each time a foot lands.
    const sign = s >= 0 ? 1 : -1;
    if (moving && sign !== a.stepSign && walk > 0.6) {
      const side = sign > 0 ? 1 : -1;
      const fx = u.x + Math.cos(u.facing + Math.PI / 2) * 0.5 * side;
      const fy = u.y + Math.sin(u.facing + Math.PI / 2) * 0.5 * side;
      this.fx3.dust(fx, fy, 2, 0.7, 0x8a7558, 0.25, 0.6);
      if (u.id === this.meId) this.sound?.('stomp', u.x, u.y, 0.5);
    }
    a.stepSign = sign;
    // Hammer slam attack: wind up overhead, smash down, recover. Impact flash at ~0.19 s.
    const ta = now - a.atkAt;
    if (ta < 0.65) {
      addP('armR', track(ta, [[0, 0], [0.12, -2.9], [0.2, -0.75], [0.32, -0.75], [0.62, 0]]));
      addP('weapon', track(ta, [[0, 0], [0.12, -0.4], [0.2, -1.05], [0.32, -1.05], [0.62, 0]]));
      addP('torso', track(ta, [[0, 0], [0.12, -0.22], [0.2, 0.45], [0.32, 0.45], [0.62, 0]]), track(ta, [[0, 0], [0.12, 0.35], [0.2, -0.12], [0.62, 0]]));
      addP('armL', track(ta, [[0, 0], [0.12, 0.25], [0.2, -0.2], [0.62, 0]]));
      rigY += track(ta, [[0, 0], [0.2, -0.12], [0.32, -0.12], [0.62, 0]]);
      if (!a.impactDone && ta >= 0.19) {
        a.impactDone = true;
        const t = this.world?.unit(a.atkTarget);
        const hx = t ? t.x : u.x + Math.cos(u.facing) * 2.2;
        const hy = t ? t.y : u.y + Math.sin(u.facing) * 2.2;
        this.fx3.sparks(hx, hy, 1.1, 7, 0xffd27a, 4);
        this.fx3.dust(hx, hy, 3, 0.9, 0x8a7558, 0.4, 0.6);
      }
    }
    // Shield Charge: lean in behind the raised shield, hammer pulled back, legs pumping.
    const tc = now - a.castAt;
    if (a.castSlot === 0 && (dashing || tc < 0.5)) {
      const c = dashing ? 1 : 1 - Math.min(1, tc / 0.5);
      addP('torso', 0.5 * c);
      addP('head', -0.35 * c);
      addP('armL', -0.55 * c, 0, 0.15 * c);
      addP('armR', 0.75 * c);
      addP('weapon', 0.45 * c);
      addP('legL', Math.sin(a.phase) * 0.9 * c);
      addP('legR', -Math.sin(a.phase) * 0.9 * c);
      rigY += -Math.abs(Math.sin(a.phase)) * 0.12 * c;
      if (dashing && now - a.trailAt > 0.05) {
        a.trailAt = now;
        this.fx3.dust(u.x - Math.cos(u.facing) * 0.8, u.y - Math.sin(u.facing) * 0.8, 2, 1.1, 0x9a8466, 0.4, 0.7);
      }
    }
    // Earthsplitter: crouch, leap with the hammer high, slam down as the ground breaks.
    const te = Math.min(now - a.castAt, a.blastAt > a.castAt ? 0.6 + (now - a.blastAt) : 9);
    if (a.castSlot === 2 && te < 1.35) {
      rigY += track(te, [[0, 0], [0.08, -0.18], [0.34, 1.5], [0.56, 0.4], [0.62, -0.3], [0.95, -0.3], [1.35, 0]]);
      addP('armR', track(te, [[0, 0], [0.3, -3.1], [0.56, -3.25], [0.63, -0.45], [0.95, -0.45], [1.35, 0]]));
      addP('weapon', track(te, [[0, 0], [0.3, -0.2], [0.56, -0.2], [0.63, -1.35], [0.95, -1.35], [1.35, 0]]));
      addP('torso', track(te, [[0, 0], [0.3, -0.38], [0.56, -0.3], [0.63, 0.75], [0.95, 0.75], [1.35, 0]]));
      addP('armL', track(te, [[0, 0], [0.3, 0.45], [0.63, -0.25], [1.35, 0]]));
      const tuck = track(te, [[0, 0], [0.08, 0.25], [0.34, -0.55], [0.56, -0.2], [0.63, 0.35], [0.95, 0.35], [1.35, 0]]);
      addP('legL', tuck);
      addP('legR', tuck * 0.6);
      rigX += track(te, [[0, 0], [0.63, 0.1], [0.95, 0.1], [1.35, 0]]);
    }
    // Stunned: a dazed sway, head down, hammer drooping.
    if (u.stunTimer > 0) {
      addP('torso', 0.12, 0, Math.sin(time * 5) * 0.14);
      addP('head', 0.35, Math.sin(time * 3.3) * 0.2);
      addP('armR', 0.3);
      addP('weapon', 0.5);
    }
    // Iron Hide (below half health): a metal ring when it kicks in, then a glint now and then.
    const iron = abilityLevel(u, 'ironHide') > 0 && u.hp < u.maxHp * 0.5;
    if (iron && !a.ironHide) {
      this.fx3.flash(u.x, u.y, 2, 5, 0xc9d6e3, 0.4);
      this.fx3.shockwave(u.x, u.y, 2.6, 0xc9d6e3, 0.35);
      this.sound?.('ironClang', u.x, u.y, 1);
    }
    if (iron && now - a.glintAt > 1.6) {
      a.glintAt = now;
      this.fx3.sparks(u.x, u.y, 2.2, 4, 0xe2e8f0, 2.5);
    }
    a.ironHide = iron;
    for (const k of ['torso', 'head', 'legL', 'legR', 'armL', 'armR', 'weapon'] as const) pose(j[k], P[k][0], P[k][1], P[k][2]);
    if (j.rig) {
      const rp = j.rig.userData.restPos as number[];
      j.rig.position.set(rp[0], rp[1] + rigY, rp[2]);
      pose(j.rig, rigX, 0, 0);
    }
  }

  /** Walk cycle, attack swing and casting pose, layered on the model's rest pose. */
  private animate(e: Obj, u: Unit, time: number) {
    if (e.char) return this.animateChar(e.char, u);
    if (e.key === 'hero:brakk') return this.animateBrakk(e, u, time);
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
      if (c.kind === 'brakk') return this.brakkCorpse(c);
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

  /** Brakk falls to his knees, the hammer drops, then he topples forward with a thud of dust. */
  private brakkCorpse(c: { o: THREE.Object3D; t: number; joints: Partial<Record<Joint, THREE.Object3D>>; x?: number; y?: number; thud?: boolean }): boolean {
    const t = c.t;
    const j = c.joints;
    pose(j.torso, track(t, [[0, 0], [0.35, 0.45], [0.9, 0.3]]), 0, 0);
    pose(j.head, track(t, [[0, 0], [0.35, 0.45]]), 0, 0);
    pose(j.armR, track(t, [[0, 0], [0.35, 0.5]]), 0, 0.3);
    pose(j.weapon, track(t, [[0, 0], [0.4, 1.4]]), 0, 0);
    pose(j.armL, track(t, [[0, 0], [0.35, 0.3]]), 0, 0);
    pose(j.legL, track(t, [[0, 0], [0.3, -1.1]]), 0, 0);
    pose(j.legR, track(t, [[0, 0], [0.3, -1.0]]), 0, 0);
    if (j.rig) {
      const rp = j.rig.userData.restPos as number[];
      j.rig.position.set(rp[0], rp[1] + track(t, [[0, 0], [0.3, -0.55]]), rp[2]);
    }
    c.o.rotation.order = 'YXZ';
    c.o.rotation.x = track(t, [[0, 0], [0.45, 0], [0.85, 1.3]]);
    if (!c.thud && t > 0.85 && c.x !== undefined && c.y !== undefined) {
      c.thud = true;
      this.fx3.dust(c.x, c.y, 7, 1.5, 0x8a7558, 1.2, 1);
      this.sound?.('armorFall', c.x, c.y, 1);
    }
    if (t > 2.2) c.o.position.y -= this.dt * 1.4;
    if (t > 3) {
      this.scene.remove(c.o);
      return false;
    }
    return true;
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
        if (u.kind === 'hero') setOpacity(e.o, isInvisible(u) ? 0.45 : 1);
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
      this.place(p.spell ? 'shot:spell' : `shot:shot${p.team === 1 ? 1 : 0}`, 'p' + p.id, x, y, 1.6);
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
  /** Set when the unit uses an artist model instead of the placeholder. */
  char?: Character;
}

/** Which artist model replaces a placeholder key (lane creeps of both teams share one model). */
function assetKey(key: string): string | null {
  if (key.startsWith('hero:')) return key;
  if (key.startsWith('creep:')) return 'creep';
  if (key === 'imp' || key === 'brute' || key === 'warden') return key;
  return null;
}
const TINTS = [new THREE.Color(0x1d4fd8), new THREE.Color(0xb91c1c)];
/** Lane creeps share one model, so they get a glow in their team's colour. */
function creepTint(key: string): THREE.Color | undefined {
  return key.startsWith('creep:') ? TINTS[Number(key.split(':')[2]) || 0] : undefined;
}
interface Anim {
  phase: number;
  walk: number;
  atk: number;
  cast: number;
  /** Renderer clock times of the last attack, cast and Earthsplitter blast. */
  atkAt: number;
  atkTarget: number;
  impactDone: boolean;
  castAt: number;
  castSlot: number;
  blastAt: number;
  trailAt: number;
  stepSign: number;
  ironHide: boolean;
  glintAt: number;
}

/** Where a teleport lands: on the home side of the target building (same rule as the simulation). */
function tpLanding(w: World, team: Team, t: Unit) {
  const f = w.map.fountains[team];
  const d = Math.hypot(t.x - f.x, t.y - f.y) || 1;
  const off = t.radius + TELEPORT.offset;
  return { x: t.x + ((f.x - t.x) / d) * off, y: t.y + ((f.y - t.y) / d) * off };
}

/** Smooth value along keyframes [time, value] (holds the ends). */
function track(t: number, keys: [number, number][]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const k = (t - t0) / (t1 - t0 || 1);
      const e = k * k * (3 - 2 * k);
      return v0 + (v1 - v0) * e;
    }
  }
  return keys[keys.length - 1][1];
}
function jointsOf(o: THREE.Object3D): Partial<Record<Joint, THREE.Object3D>> {
  const j: Partial<Record<Joint, THREE.Object3D>> = {};
  for (const n of JOINTS) {
    const x = o.getObjectByName(n);
    if (x) j[n] = x;
  }
  return j;
}
const qa = new THREE.Quaternion();
const ea = new THREE.Euler();
/** Rest pose of a joint, then turned by (x, y, z) radians in its own frame. */
function pose(o: THREE.Object3D | undefined, x: number, y: number, z: number) {
  if (!o) return;
  o.quaternion.fromArray(o.userData.rest as number[]).multiply(qa.setFromEuler(ea.set(x, y, z)));
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
