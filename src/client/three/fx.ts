import * as THREE from 'three';

/**
 * Short-lived 3D effects (dust, shockwaves, flying rocks, sparks, teleport beams) and camera
 * shake. Everything here is cheap: a few sprites and simple meshes per effect, no lights
 * (adding lights would recompile every material on phones), all removed when they finish.
 */
type Ground = (x: number, y: number) => number;

interface Live {
  o: THREE.Object3D;
  t: number;
  dur: number;
  step: (k: number, dt: number) => void;
}

/** Soft round dot, used for dust and glow sprites. */
function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Fx3D {
  private live: Live[] = [];
  private dot = dotTexture();
  private rockGeo = new THREE.DodecahedronGeometry(0.22, 0);
  private rockMat = new THREE.MeshLambertMaterial({ color: 0x6b5a45, flatShading: true });
  private ringGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  private beams = new Map<string, { o: THREE.Group; strength: number; seen: boolean }>();
  /** Camera shake strength (meters), decays by itself. */
  shake = 0;

  constructor(
    private scene: THREE.Scene,
    private ground: Ground,
  ) {}

  private add(o: THREE.Object3D, dur: number, step: Live['step']) {
    this.scene.add(o);
    this.live.push({ o, t: 0, dur, step });
  }

  private sprite(color: THREE.ColorRepresentation, opacity: number, additive = false) {
    return new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.dot, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }),
    );
  }

  /** A puff of dust (or smoke) that rises a little and fades. */
  dust(x: number, y: number, n = 6, size = 1.2, color: THREE.ColorRepresentation = 0x9a8466, spread = 0.8, dur = 0.9) {
    const gy = this.ground(x, y);
    for (let i = 0; i < n; i++) {
      const s = this.sprite(color, 0.55);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const vx = Math.cos(a) * (0.6 + Math.random());
      const vz = Math.sin(a) * (0.6 + Math.random());
      s.position.set(x + Math.cos(a) * r, gy + 0.3 + Math.random() * 0.3, y + Math.sin(a) * r);
      const base = size * (0.7 + Math.random() * 0.6);
      s.scale.setScalar(base);
      this.add(s, dur * (0.8 + Math.random() * 0.4), (k, dt) => {
        s.position.x += vx * dt;
        s.position.z += vz * dt;
        s.position.y += 0.6 * dt;
        s.scale.setScalar(base * (1 + k * 1.4));
        (s.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - k);
      });
    }
  }

  /** A ring that races outward along the ground. */
  shockwave(x: number, y: number, radius: number, color: THREE.ColorRepresentation = 0xffd9a0, dur = 0.45, opacity = 0.85) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(x, this.ground(x, y) + 0.12, y);
    this.add(m, dur, (k) => {
      const e = 1 - (1 - k) * (1 - k);
      m.scale.setScalar(0.3 + radius * e);
      (m.material as THREE.MeshBasicMaterial).opacity = opacity * (1 - k);
    });
  }

  /** Bright sparks (additive dots) bursting from a point at height h. */
  sparks(x: number, y: number, h: number, n = 8, color: THREE.ColorRepresentation = 0xffd27a, speed = 5) {
    const gy = this.ground(x, y);
    for (let i = 0; i < n; i++) {
      const s = this.sprite(color, 1, true);
      const a = Math.random() * Math.PI * 2;
      const up = 0.3 + Math.random();
      const v = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).multiplyScalar(speed * (0.5 + Math.random() * 0.6));
      s.position.set(x, gy + h, y);
      s.scale.setScalar(0.35);
      this.add(s, 0.35 + Math.random() * 0.2, (k, dt) => {
        v.y -= 14 * dt;
        s.position.addScaledVector(v, dt);
        (s.material as THREE.SpriteMaterial).opacity = 1 - k;
      });
    }
  }

  /** Rocks thrown up out of the ground that tumble and fall back. */
  debris(x: number, y: number, n = 10, spread = 2, power = 7) {
    const gy = this.ground(x, y);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.rockGeo, this.rockMat);
      m.castShadow = false;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      m.position.set(x + Math.cos(a) * r, gy + 0.1, y + Math.sin(a) * r);
      const sc = 0.6 + Math.random() * 1.2;
      m.scale.setScalar(sc);
      const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), power * (0.5 + Math.random() * 0.6), Math.sin(a) * (1 + Math.random() * 2));
      const spin = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      this.add(m, 1.1 + Math.random() * 0.4, (k, dt) => {
        v.y -= 20 * dt;
        m.position.addScaledVector(v, dt);
        const floor = this.ground(m.position.x, m.position.z) + 0.1;
        if (m.position.y < floor) {
          m.position.y = floor;
          v.multiplyScalar(0.3);
          v.y = Math.abs(v.y) * 0.4;
        }
        m.rotation.x += spin.x * dt;
        m.rotation.y += spin.y * dt;
        if (k > 0.75) m.scale.setScalar(sc * (1 - (k - 0.75) * 4));
      });
    }
  }

  /** A brief bright glow at a point (no real light: an additive sprite). */
  flash(x: number, y: number, h: number, size: number, color: THREE.ColorRepresentation, dur = 0.3) {
    const s = this.sprite(color, 1, true);
    s.position.set(x, this.ground(x, y) + h, y);
    this.add(s, dur, (k) => {
      s.scale.setScalar(size * (0.6 + k * 0.8));
      (s.material as THREE.SpriteMaterial).opacity = 1 - k;
    });
  }

  /**
   * A teleport beam: a glowing column with spinning rings and rising motes, kept alive while
   * `beam()` is called every frame with the same id; grows with `strength` (0..1).
   */
  beam(id: string, x: number, y: number, color: THREE.ColorRepresentation, strength: number) {
    let b = this.beams.get(id);
    if (!b) {
      const o = new THREE.Group();
      const col = new THREE.Color(color);
      const add = THREE.AdditiveBlending;
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.6, 9, 20, 1, true).translate(0, 4.5, 0),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, blending: add, depthWrite: false, side: THREE.DoubleSide }),
      );
      column.name = 'column';
      o.add(column);
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: add, depthWrite: false, side: THREE.DoubleSide }));
        r.name = 'ring' + i;
        r.scale.setScalar(2 - i * 0.4);
        o.add(r);
      }
      const glowS = this.sprite(col, 0.8, true);
      glowS.name = 'glow';
      glowS.position.y = 0.6;
      o.add(glowS);
      for (let i = 0; i < 10; i++) {
        const m = this.sprite(0xffffff, 0.9, true);
        m.name = 'mote' + i;
        m.userData.a = (i / 10) * Math.PI * 2;
        m.userData.h = Math.random() * 6;
        m.scale.setScalar(0.25);
        o.add(m);
      }
      this.scene.add(o);
      b = { o, strength: 0, seen: true };
      this.beams.set(id, b);
    }
    b.seen = true;
    b.strength = strength;
    b.o.position.set(x, this.ground(x, y), y);
  }

  /** Advance everything; call once per frame. */
  update(dt: number, time: number) {
    this.live = this.live.filter((l) => {
      l.t += dt;
      const k = Math.min(1, l.t / l.dur);
      l.step(k, dt);
      if (k >= 1) {
        this.scene.remove(l.o);
        const m = (l.o as THREE.Mesh | THREE.Sprite).material as THREE.Material | undefined;
        if (m && !(l.o as THREE.Mesh).isMesh) m.dispose();
        else if (m && m !== this.rockMat) m.dispose();
        return false;
      }
      return true;
    });
    for (const [id, b] of this.beams) {
      if (!b.seen) {
        this.scene.remove(b.o);
        this.beams.delete(id);
        continue;
      }
      b.seen = false;
      const s = b.strength;
      const pulse = 0.85 + Math.sin(time * 9) * 0.15;
      (b.o.getObjectByName('column') as THREE.Mesh).scale.set(0.6 + s * 0.4, 0.3 + s * 0.7, 0.6 + s * 0.4);
      ((b.o.getObjectByName('column') as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (0.08 + s * 0.22) * pulse;
      for (let i = 0; i < 3; i++) {
        const r = b.o.getObjectByName('ring' + i)!;
        r.position.y = 0.15 + i * (0.8 + s * 1.2) + Math.sin(time * 3 + i) * 0.15;
        r.rotation.y = time * (1.5 + i) * (i % 2 ? -1 : 1);
        r.scale.setScalar((2.2 - i * 0.45) * (0.7 + s * 0.4));
      }
      const g = b.o.getObjectByName('glow') as THREE.Sprite;
      g.scale.setScalar(2 + s * 2.5 * pulse);
      for (let i = 0; i < 10; i++) {
        const m = b.o.getObjectByName('mote' + i)!;
        m.userData.h = (m.userData.h + dt * (2 + s * 3)) % 7;
        const a = m.userData.a + time * 1.2;
        const r = 1.4 - m.userData.h * 0.12;
        m.position.set(Math.cos(a) * r, m.userData.h, Math.sin(a) * r);
        (((m as THREE.Sprite).material) as THREE.SpriteMaterial).opacity = s * (1 - m.userData.h / 7);
      }
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  /** Camera offset for the current shake. */
  shakeOffset(time: number): THREE.Vector3 {
    const s = this.shake * this.shake;
    return new THREE.Vector3(Math.sin(time * 61) * s, Math.sin(time * 47) * s * 0.6, Math.cos(time * 53) * s);
  }
}
