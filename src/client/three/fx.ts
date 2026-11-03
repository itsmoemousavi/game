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

  /**
   * One free particle at a world point: an (optionally additive) dot with a velocity, gravity,
   * growth and fade. The building block for embers, droplets, leaves, smoke and motes.
   */
  particle(p: THREE.Vector3, color: THREE.ColorRepresentation, size: number, dur: number, o: { vel?: THREE.Vector3; gravity?: number; grow?: number; opacity?: number; additive?: boolean; drag?: number } = {}) {
    const s = this.sprite(color, o.opacity ?? 0.9, o.additive ?? true);
    s.position.copy(p);
    s.scale.setScalar(size);
    const v = o.vel ? o.vel.clone() : new THREE.Vector3();
    const op = o.opacity ?? 0.9;
    const grow = o.grow ?? 0;
    const g = o.gravity ?? 0;
    const drag = o.drag ?? 0;
    this.add(s, dur, (k, dt) => {
      v.y -= g * dt;
      if (drag) v.multiplyScalar(Math.max(0, 1 - drag * dt));
      s.position.addScaledVector(v, dt);
      s.scale.setScalar(size * (1 + grow * k));
      (s.material as THREE.SpriteMaterial).opacity = op * (1 - k);
    });
  }

  /** A burst of particles from a world point. */
  burst(p: THREE.Vector3, n: number, color: THREE.ColorRepresentation, speed: number, size = 0.3, dur = 0.45, gravity = 10, additive = true) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 1.2 - 0.2;
      const v = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.7));
      this.particle(p, color, size * (0.7 + Math.random() * 0.6), dur * (0.7 + Math.random() * 0.6), { vel: v, gravity, additive });
    }
  }

  /** A bright glow at a world point. */
  flashAt(p: THREE.Vector3, size: number, color: THREE.ColorRepresentation, dur = 0.25) {
    const s = this.sprite(color, 1, true);
    s.position.copy(p);
    this.add(s, dur, (k) => {
      s.scale.setScalar(size * (0.6 + k * 0.8));
      (s.material as THREE.SpriteMaterial).opacity = 1 - k;
    });
  }

  private slashGeo = new THREE.RingGeometry(0.78, 1, 20, 1, -Math.PI * 0.45, Math.PI * 0.9);
  /**
   * A blade slash: a glowing crescent around (x, y) at radius `size` that sweeps and fades.
   * `angle` is the map direction it faces, `tilt` rolls it (0 = flat sweep, ±1.2 = diagonal cut).
   */
  slash(x: number, y: number, h: number, angle: number, color: THREE.ColorRepresentation, size = 1.6, tilt = 0, dur = 0.2) {
    const m = new THREE.Mesh(this.slashGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(x, this.ground(x, y) + h, y);
    // Lay the crescent flat (it opens toward +x), roll it by `tilt` around that direction, then
    // turn it to face `angle`; spinning it in its own plane makes the sweep.
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2 + tilt, -angle, 0);
    this.add(m, dur, (k) => {
      m.scale.setScalar(size * (0.85 + k * 0.25));
      m.rotation.z = (k - 0.5) * 0.9;
      (m.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k * k);
    });
  }

  private spikeGeo = new THREE.ConeGeometry(0.2, 1, 5).translate(0, 0.5, 0);
  private spikeMat = new THREE.MeshLambertMaterial({ color: 0x4e3622, flatShading: true });
  private leafMat = new THREE.MeshLambertMaterial({ color: 0x4f7a1e, flatShading: true });
  /**
   * Roots (or spikes) bursting out of the ground in a circle, rippling out from the middle,
   * holding for `hold` seconds, then sinking back.
   */
  roots(x: number, y: number, radius: number, n: number, height = 1.6, hold = 1.2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      const m = new THREE.Mesh(this.spikeGeo, i % 4 === 0 ? this.leafMat : this.spikeMat);
      m.castShadow = false;
      m.position.set(px, this.ground(px, py) - 0.05, py);
      m.rotation.set(Math.cos(a) * 0.45 * (r / radius) + (Math.random() - 0.5) * 0.3, Math.random() * 6, -Math.sin(a) * 0.45 * (r / radius));
      const hgt = height * (0.6 + Math.random() * 0.7);
      const wid = 0.8 + Math.random() * 0.8;
      const delay = (r / Math.max(1, radius)) * 0.18;
      const dur = delay + 0.15 + hold + 0.35;
      m.scale.set(wid, 0.01, wid);
      this.add(m, dur, (k) => {
        const t = k * dur;
        const up = t < delay ? 0 : t < delay + 0.15 ? (t - delay) / 0.15 : t < dur - 0.35 ? 1 : (dur - t) / 0.35;
        const e = up < 1 ? 1 - (1 - up) * (1 - up) : 1;
        m.scale.set(wid, Math.max(0.01, hgt * e), wid);
      });
    }
  }

  private meteorGeo = new THREE.IcosahedronGeometry(0.9, 1);
  /** A burning rock falling from the sky onto (x, y) over `dur` seconds, trailing fire and smoke. */
  meteor(x: number, y: number, dur: number) {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(this.meteorGeo, new THREE.MeshBasicMaterial({ color: 0xffb04a }));
    g.add(rock);
    const halo = this.sprite(0xff5a1a, 0.9, true);
    halo.scale.setScalar(4);
    g.add(halo);
    const gy = this.ground(x, y);
    const from = new THREE.Vector3(x - 9, gy + 30, y - 6);
    const to = new THREE.Vector3(x, gy + 0.6, y);
    let trail = 0;
    this.add(g, dur, (k, dt) => {
      const e = k * k;
      g.position.lerpVectors(from, to, e);
      rock.rotation.x += dt * 6;
      rock.rotation.y += dt * 4;
      halo.scale.setScalar(3 + k * 2.5);
      trail += dt;
      while (trail > 0.025) {
        trail -= 0.025;
        const p = g.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8));
        this.particle(p, Math.random() < 0.5 ? 0xffa040 : 0xff5a1a, 1.4, 0.35, { grow: 0.6 });
        if (Math.random() < 0.4) this.particle(p, 0x3a3030, 1.6, 0.9, { grow: 1.5, opacity: 0.5, additive: false, vel: new THREE.Vector3(0, 1, 0) });
      }
    });
  }

  private arrowGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 4).translate(0, 0.8, 0);
  private arrowMat = new THREE.MeshBasicMaterial({ color: 0xeafff4 });
  /** An arrow dropping out of the sky, sticking in the ground for a moment, then sinking. */
  fallingArrow(x: number, y: number) {
    const m = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    const gy = this.ground(x, y);
    const tilt = (Math.random() - 0.5) * 0.5;
    m.rotation.set(tilt, 0, 0.35 + Math.random() * 0.2);
    const from = new THREE.Vector3(x - 4, gy + 14, y);
    const to = new THREE.Vector3(x, gy - 0.25, y);
    let landed = false;
    this.add(m, 0.85, (k) => {
      const t = k * 0.85;
      if (t < 0.18) m.position.lerpVectors(from, to, t / 0.18);
      else {
        if (!landed) {
          landed = true;
          this.dust(x, y, 1, 0.6, 0x9a8466, 0.1, 0.4);
        }
        m.position.copy(to);
        if (t > 0.6) m.position.y -= (t - 0.6) * 4;
      }
    });
  }

  /**
   * A persistent effect kept alive while `keep()` is called every frame with the same id
   * (whirlpools, auras); `make` builds it once, `update` animates it with strength 0..1.
   */
  keep(id: string, x: number, y: number, strength: number, make: () => { o: THREE.Object3D; update: (dt: number, time: number, s: number) => void }) {
    let b = this.kept.get(id);
    if (!b) {
      const m = make();
      this.scene.add(m.o);
      b = { ...m, strength, seen: true };
      this.kept.set(id, b);
    }
    b.seen = true;
    b.strength = strength;
    b.o.position.set(x, this.ground(x, y), y);
  }
  private kept = new Map<string, { o: THREE.Object3D; update: (dt: number, time: number, s: number) => void; strength: number; seen: boolean }>();

  /** Thin open rings (most of a circle) for the whirlpool. */
  private swirlGeo = new THREE.RingGeometry(0.9, 1, 40, 1, 0, Math.PI * 1.4);
  /** Maelstrom: a swirling whirlpool of water rings, spiralling droplets and spray. */
  whirlpool(id: string, x: number, y: number, radius: number, strength: number) {
    this.keep(id, x, y, strength, () => {
      const o = new THREE.Group();
      const rings: THREE.Mesh[] = [];
      for (let i = 0; i < 6; i++) {
        const r = new THREE.Mesh(this.swirlGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0x5fe0f5 : 0x1fa3c4, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        r.rotation.x = -Math.PI / 2;
        r.position.y = 0.15 + i * 0.03;
        o.add(r);
        rings.push(r);
      }
      const core = this.sprite(0x1fa3c4, 0.7, true);
      core.position.y = 0.4;
      o.add(core);
      const motes: THREE.Sprite[] = [];
      for (let i = 0; i < 16; i++) {
        const m = this.sprite(0xc8f6ff, 0.9, true);
        m.userData.a = (i / 16) * Math.PI * 2;
        m.userData.r = Math.random();
        m.scale.setScalar(0.35);
        o.add(m);
        motes.push(m);
      }
      return {
        o,
        update: (dt, time, s) => {
          rings.forEach((r, i) => {
            const rr = radius * (1 - i * 0.15);
            r.scale.setScalar(rr);
            r.rotation.z = time * (1.6 + i * 0.7) + i * 2.1;
            (r.material as THREE.MeshBasicMaterial).opacity = 0.65 * s;
          });
          core.scale.setScalar(radius * 0.9);
          (core.material as THREE.SpriteMaterial).opacity = 0.5 * s;
          for (const m of motes) {
            m.userData.r -= dt * 0.45;
            if (m.userData.r < 0.05) m.userData.r = 1;
            m.userData.a -= dt * (2 + 3 * (1 - m.userData.r));
            const r = m.userData.r * radius;
            m.position.set(Math.cos(m.userData.a) * r, 0.3 + (1 - m.userData.r) * 0.6, Math.sin(m.userData.a) * r);
            (m.material as THREE.SpriteMaterial).opacity = s * 0.9;
          }
        },
      };
    });
  }

  /**
   * Tower shield (glyph): a shimmering golden dome over a building, `r` wide and `h` tall,
   * kept while called each frame; strength 0..1 fades it in and out.
   */
  shield(id: string, x: number, y: number, r: number, h: number, strength: number) {
    this.keep(id, x, y, strength, () => {
      const o = new THREE.Group();
      const add = THREE.AdditiveBlending;
      const dome = new THREE.Mesh(this.domeGeo, new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.16, blending: add, depthWrite: false, side: THREE.DoubleSide }));
      const lattice = new THREE.Mesh(this.latticeGeo, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.35, blending: add, depthWrite: false, wireframe: true }));
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, blending: add, depthWrite: false, side: THREE.DoubleSide }));
      ring.position.y = 0.15;
      for (const m of [dome, lattice]) m.scale.set(r, h, r);
      ring.scale.setScalar(r);
      const glowS = this.sprite(0xffcf5a, 0.5, true);
      glowS.position.y = h * 0.5;
      glowS.scale.setScalar(r * 2.6);
      o.add(dome, lattice, ring, glowS);
      let moteT = 0;
      return {
        o,
        update: (dt, time, s) => {
          const pulse = 0.8 + Math.sin(time * 5) * 0.2;
          (dome.material as THREE.MeshBasicMaterial).opacity = 0.16 * s * pulse;
          (lattice.material as THREE.MeshBasicMaterial).opacity = 0.32 * s * (0.7 + Math.sin(time * 3 + 1) * 0.3);
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * s;
          (glowS.material as THREE.SpriteMaterial).opacity = 0.35 * s * pulse;
          lattice.rotation.y = time * 0.4;
          moteT += dt;
          if (moteT > 0.12 && s > 0.3) {
            moteT = 0;
            const a = Math.random() * Math.PI * 2;
            const p = o.position.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.95, 0.3, Math.sin(a) * r * 0.95));
            this.particle(p, 0xffd36a, 0.35, 1.2, { vel: new THREE.Vector3(0, 2.2, 0) });
          }
        },
      };
    });
  }
  private domeGeo = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  private latticeGeo = new THREE.IcosahedronGeometry(1, 2);

  /** Advance everything; call once per frame. */
  update(dt: number, time: number) {
    this.live = this.live.filter((l) => {
      l.t += dt;
      const k = Math.min(1, l.t / l.dur);
      l.step(k, dt);
      if (k >= 1) {
        this.scene.remove(l.o);
        const m = (l.o as THREE.Mesh | THREE.Sprite).material as THREE.Material | undefined;
        if (m && !this.shared.has(m)) m.dispose();
        l.o.traverse((c) => {
          const cm = (c as THREE.Mesh).material as THREE.Material | undefined;
          if (c !== l.o && cm && !this.shared.has(cm)) cm.dispose();
        });
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
    for (const [id, b] of this.kept) {
      if (!b.seen) {
        this.scene.remove(b.o);
        this.kept.delete(id);
        continue;
      }
      b.seen = false;
      b.update(dt, time, b.strength);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  /** Materials shared between effects (never disposed). */
  private get shared(): Set<THREE.Material> {
    return (this._shared ??= new Set<THREE.Material>([this.rockMat, this.spikeMat, this.leafMat, this.arrowMat]));
  }
  private _shared?: Set<THREE.Material>;

  /** Camera offset for the current shake. */
  shakeOffset(time: number): THREE.Vector3 {
    const s = this.shake * this.shake;
    return new THREE.Vector3(Math.sin(time * 61) * s, Math.sin(time * 47) * s * 0.6, Math.cos(time * 53) * s);
  }
}
