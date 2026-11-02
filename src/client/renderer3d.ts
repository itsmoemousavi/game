import * as THREE from 'three';
import { GameMap, HEROES, Team, Unit, World, isInvisible, isNight } from '../sim';
import type { Aim } from './input';
import { Renderer, TEAM_COLORS } from './renderer';
import { TEAM_HEX, model } from './three/models';

/** Ground level per map height (1 = normal, 2 = base plateau, 3 = ward hill), in meters. */
const ELEVATION = [0, 0, 1.1, 2.2];
/** Camera: looking down at this angle from the horizon, with this field of view. */
const PITCH = (56 * Math.PI) / 180;
const FOV = 38;
/** The ground-effects texture covers this many meters around the camera. */
const FX_SPAN = 96;
const FX_PX = 1024;
/** Heroes are drawn a bit larger than life so they read well on a phone. */
const HERO_SCALE = 1.55;
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
  private terrain3d: THREE.Mesh;
  private fogTex: THREE.DataTexture;
  private fxCanvas = document.createElement('canvas');
  private fxCtx: CanvasRenderingContext2D;
  private fxTex: THREE.CanvasTexture;
  private fxX = 0;
  private fxY = 0;
  private overlay: CanvasRenderingContext2D;
  private trees: { crowns: THREE.InstancedMesh; cells: Int32Array; colors: THREE.Color[] } | null = null;
  private objs = new Map<string, { o: THREE.Object3D; seen: number; key: string }>();
  private frameNo = 0;
  private raycaster = new THREE.Raycaster();
  private night = 0;

  constructor(
    overlay: HTMLCanvasElement,
    glCanvas: HTMLCanvasElement,
    map: GameMap,
  ) {
    super(overlay, map);
    this.flat = false;
    this.overlay = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: dpr < 2, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(dpr);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x0d150f);

    this.sky = new THREE.HemisphereLight(0xdfeeff, 0x3a4a30, 1.5);
    this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    // ---- terrain with height
    this.grid = map.grid;
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
    this.fxCanvas.width = this.fxCanvas.height = FX_PX;
    this.fxCtx = this.fxCanvas.getContext('2d')!;
    this.fxTex = new THREE.CanvasTexture(this.fxCanvas);
    this.fxTex.colorSpace = THREE.SRGBColorSpace;
    this.fxTex.repeat.set(map.size / FX_SPAN, map.size / FX_SPAN);
    const fx = new THREE.Mesh(geo, overlayMaterial(this.fxTex, 2));
    fx.renderOrder = 2;
    this.scene.add(fx);

    this.buildTrees(map);
    this.resize();
  }

  /** Free the GPU resources (when switching views or starting a new match). */
  destroy() {
    this.gl.dispose();
  }

  /** Ground height at a world point (matches the terrain mesh). */
  elevationAt(x: number, y: number): number {
    const n = this.grid;
    const cell = 200 / n;
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

  private buildTrees(map: GameMap) {
    const n = map.grid;
    const cells: number[] = [];
    for (let i = 0; i < n * n; i++) if (!map.walkable[i]) cells.push(i);
    const count = cells.length;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.4, 5);
    trunkGeo.translate(0, 0.7, 0);
    const crownGeo = new THREE.ConeGeometry(1.35, 3.4, 6);
    crownGeo.translate(0, 2.9, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4a3524 }), count);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ flatShading: true }), count);
    crowns.castShadow = true;
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
    const hit = this.raycaster.intersectObject(this.terrain3d, false)[0];
    if (hit) return { x: hit.point.x, y: hit.point.z };
    const r = this.raycaster.ray;
    const t = -r.origin.y / (r.direction.y || -1e-6);
    return { x: r.origin.x + r.direction.x * t, y: r.origin.z + r.direction.z * t };
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
    ctx.clearRect(0, 0, FX_PX, FX_PX);
    ctx.save();
    const k = FX_PX / FX_SPAN;
    ctx.scale(k, k);
    ctx.translate(-this.fxX, -this.fxY);
  }

  render(w: World, alpha: number, focus: Unit | undefined, viewTeam: Team, aim: Aim | null = null) {
    this.frameNo++;
    // 1. Ground effects via the 2D renderer (also moves the camera).
    this.ctx = this.fxCtx;
    super.render(w, alpha, focus, viewTeam, aim);
    this.ctx = this.overlay;
    const c = this.fxCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, FX_PX, 2);
    c.clearRect(0, FX_PX - 2, FX_PX, 2);
    c.clearRect(0, 0, 2, FX_PX);
    c.clearRect(FX_PX - 2, 0, 2, FX_PX);
    this.fxTex.offset.set(-this.fxX / FX_SPAN, 1 - 200 / FX_SPAN + this.fxY / FX_SPAN);
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
    this.sun.position.set(this.camX + 25, 60, this.camY + 18);
    this.sun.target.position.set(this.camX, 0, this.camY - 6);
    this.syncUnits(w, alpha, viewTeam);
    this.gl.render(this.scene, this.camera);

    // 4. Bars, names, numbers and the minimap on top.
    this.drawOverlay(w, alpha, focus, viewTeam);
  }

  private updateFog(w: World, team: Team) {
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
    if (this.trees && this.frameNo % 8 === 0) {
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
    let e = this.objs.get(id);
    if (!e || e.key !== key) {
      if (e) this.scene.remove(e.o);
      e = { o: model(key), seen: 0, key };
      this.scene.add(e.o);
      this.objs.set(id, e);
    }
    e.seen = this.frameNo;
    e.o.position.set(x, this.elevationAt(x, y) + h, y);
    e.o.rotation.y = rotY;
    e.o.scale.setScalar(scale);
    return e.o;
  }

  private syncUnits(w: World, alpha: number, team: Team) {
    const t = w.time;
    const face = (f: number) => Math.PI / 2 - f;
    for (const u of w.units) {
      const id = 'u' + u.id;
      if (u.kind === 'structure') {
        const tier = u.structure!.tier;
        const side = u.team === 1 ? 1 : 0;
        if (u.alive) this.place(`structure:${tier}:${side}`, id, u.x, u.y, 0, side ? Math.PI : 0);
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
      const moving = Math.hypot(u.x - u.px, u.y - u.py) > 0.01;
      const bob = moving ? Math.abs(Math.sin(t * 9 + u.id)) * 0.12 : 0;
      if (u.kind === 'hero') {
        const o = this.place(`hero:${u.hero!.defId}`, id, x, y, bob, face(u.facing), HERO_SCALE);
        setOpacity(o, isInvisible(u) ? 0.45 : 1);
      } else if (u.creep) {
        const side = u.team === 1 ? 1 : 0;
        this.place(`creep:${u.creep.type}:${side}`, id, x, y, bob, face(u.facing), u.creep.super ? 1.6 : 1.3);
      } else if (u.neutral) {
        const key = u.neutral.boss ? 'warden' : u.radius > 0.9 ? 'brute' : 'imp';
        this.place(key, id, x, y, bob * 0.5, face(u.facing), u.neutral.boss ? 1.5 : 1.3);
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
      const h = boss ? 5.2 : u.neutral ? 2.6 : 2.3;
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
