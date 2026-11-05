import * as THREE from 'three';
import { HEROES, HERO_IDS, HeroId } from '../sim';
import { JOINTS, model } from './three/models';

/** Heroes whose big gear hides the face get their own portrait angle and a step back. */
const TURN: Partial<Record<HeroId, number>> = { brakk: 0.12, seren: 0.1 };
const BACK: Partial<Record<HeroId, number>> = { brakk: 3.5, seren: 3.35 };
/** Heroes whose raised weapon would cover the face in the small round picture. */
const NO_WEAPON_IN_PORTRAIT: HeroId[] = ['brakk', 'seren'];

/**
 * The hero on the start screen: the picked hero's 3D model on a lit pedestal, turning
 * slowly and breathing (drag to turn it). Also renders the round hero portraits.
 */
export class MenuShowcase {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private stage = new THREE.Group();
  private hero: THREE.Object3D | null = null;
  private ring: THREE.Mesh;
  private rim: THREE.DirectionalLight;
  private running = false;
  private spin = 0;
  private drag: { id: number; x: number } | null = null;
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.shadowMap.enabled = true;
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x30382a, 1.6));
    const key = new THREE.DirectionalLight(0xfff1dd, 2.8);
    key.position.set(4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
    this.scene.add(key);
    this.rim = new THREE.DirectionalLight(0xffffff, 3.5);
    this.rim.position.set(-5, 4, -6);
    this.scene.add(this.rim);

    const stone = new THREE.MeshLambertMaterial({ color: 0x3c4638, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.4, 10), stone);
    base.position.y = -0.2;
    base.receiveShadow = true;
    const step = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.25, 10), new THREE.MeshLambertMaterial({ color: 0x2a3128, flatShading: true }));
    step.position.y = -0.45;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.04, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.01;
    this.stage.add(base, step, this.ring);
    this.scene.add(this.stage);

    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { id: e.pointerId, x: e.clientX };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      this.stage.rotation.y += (e.clientX - this.drag.x) * 0.012;
      this.drag.x = e.clientX;
      this.spin = 0;
    });
    const up = () => (this.drag = null);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  show(id: HeroId) {
    if (this.hero) this.stage.remove(this.hero);
    this.hero = model(`hero:${id}`);
    this.hero.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
    this.stage.add(this.hero);
    const c = new THREE.Color(HEROES[id].color);
    this.rim.color.copy(c);
    (this.ring.material as THREE.MeshBasicMaterial).color.copy(c);
    this.stage.rotation.y = 0.5;
    this.spin = 0;
  }

  /** Round portraits (head and shoulders) for the hero picker, as image URLs. */
  portraits(ids: readonly HeroId[] = HERO_IDS): Partial<Record<HeroId, string>> {
    const out: Partial<Record<HeroId, string>> = {};
    const size = 160;
    const prevStage = this.stage.visible;
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    this.gl.setSize(size, size, false);
    this.stage.visible = false;
    for (const id of ids) {
      const m = model(`hero:${id}`);
      m.rotation.y = TURN[id] ?? 0.35;
      if (NO_WEAPON_IN_PORTRAIT.includes(id)) m.getObjectByName('weapon')!.visible = false;
      this.scene.add(m);
      // Frame the head and shoulders (props like raised hammers would throw off a bounding box).
      m.updateMatrixWorld(true);
      // Aim at the head joint itself: weapons, shields and horns differ per hero, the face is what counts.
      const head = m.getObjectByName('head');
      const headY = head ? head.getWorldPosition(new THREE.Vector3()).y + 0.02 : 1.8;
      cam.position.set(0.62, headY + 0.3, BACK[id] ?? 3.1);
      cam.lookAt(0, headY - 0.1, 0);
      this.rim.color.set(HEROES[id].color);
      this.gl.setClearColor(0x000000, 0);
      this.gl.render(this.scene, cam);
      out[id] = this.canvas.toDataURL('image/png');
      this.scene.remove(m);
    }
    this.stage.visible = prevStage;
    this.resize();
    return out;
  }

  /** Tall card pictures (chest up, 3:4) for the draft screen, as image URLs. */
  cards(ids: readonly HeroId[] = HERO_IDS): Partial<Record<HeroId, string>> {
    const out: Partial<Record<HeroId, string>> = {};
    const w = 210;
    const h = 280;
    const prevStage = this.stage.visible;
    const cam = new THREE.PerspectiveCamera(28, w / h, 0.1, 50);
    this.gl.setSize(w, h, false);
    this.stage.visible = false;
    for (const id of ids) {
      const m = model(`hero:${id}`);
      m.rotation.y = TURN[id] ?? 0.45;
      this.scene.add(m);
      m.updateMatrixWorld(true);
      const torso = m.getObjectByName('torso');
      const chest = torso ? torso.getWorldPosition(new THREE.Vector3()).y + 0.35 : 1.4;
      cam.position.set(1.1, chest + 0.45, 4.6 + (BACK[id] ? 1 : 0));
      cam.lookAt(0, chest + 0.05, 0);
      this.rim.color.set(HEROES[id].color);
      this.gl.setClearColor(0x000000, 0);
      this.gl.render(this.scene, cam);
      out[id] = this.canvas.toDataURL('image/png');
      this.scene.remove(m);
    }
    this.stage.visible = prevStage;
    this.resize();
    return out;
  }

  /**
   * The start screen's picture: the heroes gathered on a stone rise at dusk, lit from behind by a
   * burning Shrine. Drawn once as an image, so the menu costs no battery.
   */
  backdrop(w: number, h: number): string {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x24150d);
    scene.fog = new THREE.Fog(0x2c1a0e, 24, 74);
    scene.add(new THREE.HemisphereLight(0xa9b4d0, 0x4a3320, 1.7));
    const key = new THREE.DirectionalLight(0xffd9a8, 3.3);
    key.position.set(-5, 9, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -14, right: 14, top: 12, bottom: -12, near: 1, far: 40 });
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff6a2a, 3.8);
    rim.position.set(5, 5, -10);
    scene.add(rim);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3a3227 }));
    ground.receiveShadow = true;
    scene.add(ground);
    // Rough stones scattered about, and the Shrine's crystal blazing far behind them.
    const rock = new THREE.IcosahedronGeometry(1, 1);
    const pos = rock.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + 0.22 * Math.sin(pos.getX(i) * 9) * Math.cos(pos.getZ(i) * 7 + pos.getY(i) * 5);
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.7, pos.getZ(i) * k);
    }
    rock.computeVertexNormals();
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x4b453a });
    for (let i = 0; i < 46; i++) {
      const a = i * 2.399;
      const r = 5.5 + (i % 11) * 2.1;
      const m = new THREE.Mesh(rock, stoneMat);
      m.position.set(4 + Math.cos(a) * r, 0.1, -4 + Math.sin(a) * r);
      m.scale.setScalar(0.4 + ((i * 7) % 5) * 0.32);
      m.rotation.y = a;
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }
    const shrine = model('structure:shrine:1');
    shrine.position.set(9, 0, -32);
    shrine.scale.setScalar(1.25);
    scene.add(shrine);
    // The sky burning behind it.
    const glowCv = document.createElement('canvas');
    glowCv.width = glowCv.height = 256;
    const gc = glowCv.getContext('2d')!;
    const grad = gc.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,150,80,0.6)');
    grad.addColorStop(0.35, 'rgba(210,80,35,0.3)');
    grad.addColorStop(1, 'rgba(120,30,10,0)');
    gc.fillStyle = grad;
    gc.fillRect(0, 0, 256, 256);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glowCv), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sky.position.set(9, 7, -40);
    scene.add(sky);
    // Heroes, a little to the right so the buttons have the left side of the screen.
    const cast: [string, number, number, number][] = [
      ['hero:brakk', 3.4, 0.2, 0.3],
      ['hero:seren', 1, -1.5, 0.65],
      ['hero:orin', 6, -1.7, -0.1],
      ['hero:rhen', 8.4, -0.2, -0.45],
      ['hero:vexa', -1.2, -3.6, 0.8],
      ['hero:kaela', 3.4, -3.8, 0.1],
      ['hero:grom', 10.8, -3.4, -0.5],
      ['hero:syl', 7, -4.6, -0.1],
      ['hero:morra', -0.6, 1.2, 0.85],
      ['redwolf:1', 6, 1.8, -0.75],
      ['wolf:1', 0.8, 2.6, 0.7],
    ];
    for (const [key2, x, z, ry] of cast) {
      const m = model(key2);
      m.position.set(x, 0, z);
      m.rotation.y = ry;
      m.scale.setScalar(key2.startsWith('hero:brakk') ? 1.15 : 1);
      m.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
      scene.add(m);
    }
    const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 120);
    cam.position.set(0.2, 2.5, 14.5);
    cam.lookAt(0.2, 3.2, 0);
    this.gl.setPixelRatio(1);
    this.gl.setSize(w, h, false);
    this.gl.setClearColor(0x000000, 1);
    this.gl.render(scene, cam);
    return this.canvas.toDataURL('image/jpeg', 0.86);
  }

  resize() {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Fit the whole hero (about 2.6 m with props) with some room around it; on a narrow
    // canvas (the draft panel) step back so the width still fits.
    const back = Math.max(1, 0.8 / this.camera.aspect);
    this.camera.position.set(2.6 * back, 1.15 + 1.25 * back, 7.6 * back);
    this.camera.lookAt(0, 1.15, 0);
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (!this.drag) {
        this.spin = Math.min(1, this.spin + dt * 0.5);
        this.stage.rotation.y += dt * 0.35 * this.spin;
      }
      // Idle breathing on the torso joint.
      const torso = this.hero?.getObjectByName(JOINTS[1]);
      if (torso?.userData.rest) {
        torso.quaternion.fromArray(torso.userData.rest as number[]);
        torso.rotateX(Math.sin(now / 700) * 0.04);
      }
      this.gl.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  /** Free the WebGL context (once the headshots are made, the menu doesn't need it). */
  dispose() {
    this.running = false;
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.canvas.remove();
  }
}
