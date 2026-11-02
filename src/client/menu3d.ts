import * as THREE from 'three';
import { HEROES, HERO_IDS, HeroId } from '../sim';
import { JOINTS, model } from './three/models';

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
  portraits(): Record<HeroId, string> {
    const out = {} as Record<HeroId, string>;
    const size = 160;
    const prevStage = this.stage.visible;
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    this.gl.setSize(size, size, false);
    this.stage.visible = false;
    for (const id of HERO_IDS) {
      const m = model(`hero:${id}`);
      m.rotation.y = 0.35;
      this.scene.add(m);
      // Frame the head and shoulders (props like raised hammers would throw off a bounding box).
      m.updateMatrixWorld(true);
      const torso = m.getObjectByName('torso');
      const headY = torso ? torso.getWorldPosition(new THREE.Vector3()).y + 0.85 : 1.8;
      cam.position.set(0.8, headY + 0.35, 3.2);
      cam.lookAt(0, headY - 0.12, 0);
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

  resize() {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Fit the whole hero (about 2.6 m with props) with some room around it.
    this.camera.position.set(2.6, 2.4, 7.6);
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
