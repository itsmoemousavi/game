import * as THREE from 'three';
import type { HeroId, Team, World } from '../../sim';
import { AnimCtx, executionFx, shake } from './hero-anims';

/**
 * Effects for spells and shots while they exist in the world: trails behind projectiles and
 * skillshots, splashes where they land, arrows raining in Arrow Storm, the Maelstrom whirlpool,
 * Cataclysm's meteor and burning ground, roots bursting out for Root Snare and Overgrowth.
 * Only things the viewing team can see are shown.
 */
type ShotKind = HeroId | 'tower';

export class SpellFx {
  private shots = new Map<number, { x: number; y: number; kind: ShotKind; crit: boolean; mine: boolean; targetId: number }>();
  private skill = new Map<number, { x: number; y: number; kind: string }>();
  private blasts = new Map<number, { x: number; y: number; kind: string; radius: number; mine: boolean }>();
  private trailT = 0;
  private zoneT = new Map<number, number>();

  constructor(private ground: (x: number, y: number) => number) {}

  /** Model key for a hero's basic-attack projectile. */
  static shotKey(w: World, sourceId: number, crit: boolean, team: number): string {
    const id = w.unit(sourceId)?.hero?.defId;
    if (id === 'vexa') return crit ? 'shot:arrowCrit' : 'shot:arrow';
    if (id === 'orin') return 'shot:firebolt';
    if (id === 'kaela') return 'shot:waterbolt';
    return `shot:shot${team === 1 ? 1 : 0}`;
  }

  update(c: AnimCtx, w: World, team: Team, alpha: number) {
    const fx = c.fx;
    const sees = (t: number, x: number, y: number) => t === team || w.vision.seesPoint(team, x, y);
    const p3 = (x: number, y: number, h: number) => new THREE.Vector3(x, this.ground(x, y) + h, y);
    this.trailT += c.dt;
    const trail = this.trailT > 0.03;
    if (trail) this.trailT = 0;

    // ---- projectiles (basic attacks)
    const live = new Set<number>();
    for (const p of w.projectiles) {
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      if (!sees(p.team, x, y)) continue;
      live.add(p.id);
      let s = this.shots.get(p.id);
      if (!s) {
        const src = w.unit(p.sourceId);
        const kind: ShotKind = src?.hero ? src.hero.defId : 'tower';
        s = { x, y, kind, crit: !!p.crit, mine: p.sourceId === c.meId, targetId: p.targetId };
        this.shots.set(p.id, s);
      }
      s.x = x;
      s.y = y;
      if (!trail) continue;
      if (s.kind === 'orin') fx.particle(p3(x, y, 1.6), Math.random() < 0.5 ? 0xffa040 : 0xff5a1a, 0.45, 0.25, { grow: -0.5 });
      else if (s.kind === 'kaela') fx.particle(p3(x, y, 1.6), 0x9ff0ff, 0.25, 0.35, { gravity: 6, opacity: 0.8, vel: new THREE.Vector3(0, 0.5, 0) });
      else if (s.kind === 'vexa' && s.crit) fx.particle(p3(x, y, 1.6), 0x6dff9e, 0.4, 0.25);
    }
    for (const [id, s] of this.shots) {
      if (live.has(id)) continue;
      this.shots.delete(id);
      const t = w.unit(s.targetId);
      const x = t && t.alive ? t.x : s.x;
      const y = t && t.alive ? t.y : s.y;
      const at = p3(x, y, 1.5);
      if (s.kind === 'orin') {
        fx.flashAt(at, 2.2, 0xff7a2a, 0.22);
        fx.burst(at, 6, 0xffa040, 4, 0.25, 0.35, 4);
        if (s.mine) c.sound('fireHit', x, y, 0.5);
      } else if (s.kind === 'kaela') {
        fx.burst(at, 8, 0xc8f6ff, 4, 0.25, 0.45, 10, false);
        fx.flashAt(at, 1.6, 0x5fe0f5, 0.2);
        if (s.mine) c.sound('splash', x, y, 0.5);
      } else if (s.kind === 'vexa') {
        fx.burst(at, s.crit ? 10 : 4, s.crit ? 0x6dff9e : 0xe8e0d0, s.crit ? 6 : 3, 0.22, 0.3, 8);
        if (s.crit) fx.flashAt(at, 2.5, 0x6dff9e, 0.25);
        if (s.mine) c.sound('arrowHit', x, y, 0.45);
      } else if (s.kind === 'tower') {
        fx.flashAt(at, 1.6, 0xfff1c0, 0.18);
      }
    }

    // ---- skillshots (Piercing Arrow, Fireball, Tidal Wave)
    const liveS = new Set<number>();
    for (const s of w.skillshots) {
      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha;
      if (!sees(s.team, x, y)) continue;
      liveS.add(s.id);
      this.skill.set(s.id, { x, y, kind: s.kind });
      if (!trail) continue;
      if (s.kind === 'fireball') {
        for (let i = 0; i < 2; i++) fx.particle(p3(x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * 0.5, 1.4 + (Math.random() - 0.5) * 0.5), Math.random() < 0.5 ? 0xffa040 : 0xff5a1a, 1.0, 0.35, { grow: 0.4, vel: new THREE.Vector3(0, 1.2, 0) });
        if (Math.random() < 0.4) fx.particle(p3(x, y, 1.6), 0x3a3030, 1.0, 0.8, { grow: 1.4, opacity: 0.4, additive: false, vel: new THREE.Vector3(0, 1.5, 0) });
      } else if (s.kind === 'piercingArrow') {
        fx.particle(p3(x, y, 1.4), 0x9fffc8, 0.7, 0.3, { grow: -0.5 });
      } else if (s.kind === 'tidalWave') {
        const side = (Math.random() - 0.5) * 3;
        const px = x - s.dy * side;
        const py = y + s.dx * side;
        fx.particle(p3(px, py, 0.9), 0xe0fbff, 0.45, 0.5, { gravity: 9, vel: new THREE.Vector3(s.dx * 3, 3 + Math.random() * 2, s.dy * 3), additive: false, opacity: 0.85 });
      }
    }
    for (const [id, s] of this.skill) {
      if (liveS.has(id)) continue;
      this.skill.delete(id);
      if (s.kind === 'tidalWave') {
        fx.burst(p3(s.x, s.y, 0.6), 14, 0xe0fbff, 5, 0.35, 0.6, 10, false);
        fx.shockwave(s.x, s.y, 2.5, 0x5fe0f5, 0.4, 0.6);
      } else if (s.kind === 'piercingArrow') {
        fx.flashAt(p3(s.x, s.y, 1.4), 1.8, 0x9fffc8, 0.2);
      }
    }

    // ---- areas that last (Arrow Storm, Maelstrom, burning ground)
    const liveZ = new Set<number>();
    for (const z of w.zones) {
      if (!sees(z.team, z.x, z.y)) continue;
      liveZ.add(z.id);
      const fade = Math.min(1, z.t / 0.3, (z.duration - z.t) / 0.4);
      const src = w.unit(z.sourceId)?.hero?.defId;
      let acc = (this.zoneT.get(z.id) ?? 0) + c.dt;
      const rand = () => {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * z.radius;
        return [z.x + Math.cos(a) * r, z.y + Math.sin(a) * r];
      };
      if (z.kind === 'arrowStorm') {
        while (acc > 0.04) {
          acc -= 0.04;
          const [x, y] = rand();
          fx.fallingArrow(x, y);
        }
      } else if (z.kind === 'maelstrom') {
        fx.whirlpool('mael' + z.id, z.x, z.y, z.radius, Math.max(0, fade));
        while (acc > 0.07) {
          acc -= 0.07;
          const [x, y] = rand();
          fx.particle(p3(x, y, 0.3), 0xe0fbff, 0.4, 0.6, { gravity: 8, vel: new THREE.Vector3(0, 3 + Math.random() * 2, 0), additive: false, opacity: 0.8 });
        }
      } else if (z.kind === 'burn' && src === 'orin') {
        while (acc > 0.025) {
          acc -= 0.025;
          const [x, y] = rand();
          fx.particle(p3(x, y, 0.3), Math.random() < 0.5 ? 0xffa040 : 0xff5a1a, 1.3, 0.55, { grow: -0.4, vel: new THREE.Vector3(0, 2.8, 0) });
          if (Math.random() < 0.25) fx.particle(p3(x, y, 1), 0x3a3030, 1.2, 1, { grow: 1.2, opacity: 0.35, additive: false, vel: new THREE.Vector3(0, 1.5, 0) });
        }
      } else if (z.kind === 'burn' && src === 'grom') {
        while (acc > 0.06) {
          acc -= 0.06;
          const [x, y] = rand();
          fx.particle(p3(x, y, 0.3), 0x9dff5a, 0.25, 1, { vel: new THREE.Vector3(0, 1.4, 0), opacity: 0.8 });
        }
      }
      this.zoneT.set(z.id, acc);
    }
    for (const id of this.zoneT.keys()) if (!liveZ.has(id)) this.zoneT.delete(id);

    // ---- delayed blasts (Cataclysm, Root Snare, Overgrowth; Earthsplitter is Brakk's own)
    const liveB = new Set<number>();
    for (const b of w.blasts) {
      if (b.kind === 'earthsplitter' || !sees(b.team, b.x, b.y)) continue;
      liveB.add(b.id);
      if (this.blasts.has(b.id)) continue;
      this.blasts.set(b.id, { x: b.x, y: b.y, kind: b.kind, radius: b.radius, mine: b.sourceId === c.meId });
      if (b.kind === 'cataclysm') fx.meteor(b.x, b.y, Math.max(0.2, b.delay - b.t));
      else if (b.kind === 'rootSnare') {
        fx.dust(b.x, b.y, 5, 1.2, 0x7a6448, b.radius * 0.6, 0.6);
        fx.burst(p3(b.x, b.y, 0.3), 10, 0x9dff5a, 3, 0.25, 0.5, 2);
      }
    }
    for (const [id, b] of this.blasts) {
      if (liveB.has(id)) continue;
      this.blasts.delete(id);
      if (b.kind === 'cataclysm') {
        fx.flash(b.x, b.y, 1, 12, 0xffa040, 0.5);
        fx.shockwave(b.x, b.y, b.radius * 1.3, 0xff7a2a, 0.5, 0.95);
        fx.shockwave(b.x, b.y, b.radius * 1.7, 0x5a4a40, 0.9, 0.5);
        fx.debris(b.x, b.y, 14, 2, 9);
        fx.burst(p3(b.x, b.y, 0.6), 30, 0xffa040, 9, 0.5, 0.7, 6);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          fx.dust(b.x + Math.cos(a) * b.radius * 0.7, b.y + Math.sin(a) * b.radius * 0.7, 2, 2.2, 0x3a3030, 0.6, 1.6);
        }
        shake(c, b.x, b.y, 0.85, b.mine ? 0.2 : 0);
      } else if (b.kind === 'rootSnare') {
        fx.roots(b.x, b.y, b.radius, 14, 1.8, 1.1);
        fx.shockwave(b.x, b.y, b.radius + 1, 0x9dff5a, 0.35, 0.7);
        fx.dust(b.x, b.y, 6, 1.3, 0x7a6448, b.radius * 0.7, 0.8);
        fx.burst(p3(b.x, b.y, 0.5), 10, 0x5f8f24, 4, 0.25, 0.8, 7, false);
      } else if (b.kind === 'overgrowth') {
        fx.roots(b.x, b.y, b.radius, 34, 2.6, 2.2);
        fx.shockwave(b.x, b.y, b.radius + 1.5, 0x9dff5a, 0.55, 0.8);
        fx.shockwave(b.x, b.y, b.radius, 0x7a6448, 0.8, 0.5);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          fx.dust(b.x + Math.cos(a) * b.radius * 0.8, b.y + Math.sin(a) * b.radius * 0.8, 2, 1.8, 0x7a6448, 0.6, 1.2);
        }
        fx.burst(p3(b.x, b.y, 1), 24, 0x5f8f24, 7, 0.3, 1.1, 6, false);
        shake(c, b.x, b.y, 0.6, b.mine ? 0.15 : 0);
      }
    }
  }

  /** Simulation events with a spot on the map (explosions, spell hits). */
  onExplosion(c: AnimCtx, w: World, team: Team, x: number, y: number, radius: number, execSource: number) {
    if (!w.vision.seesPoint(team, x, y)) return;
    if (execSource >= 0) return executionFx(c, x, y, w.unit(execSource));
    // Fireball bursting.
    const fx = c.fx;
    const p = new THREE.Vector3(x, this.ground(x, y) + 1.2, y);
    fx.flashAt(p, radius * 3, 0xffa040, 0.35);
    fx.shockwave(x, y, radius * 1.2, 0xff7a2a, 0.4, 0.9);
    fx.burst(p, 22, 0xffa040, 7, 0.45, 0.55, 3);
    fx.dust(x, y, 6, 1.5, 0x3a3030, radius * 0.5, 1.2);
    shake(c, x, y, 0.25, 0);
  }

  /** A spell hit someone (Piercing Arrow passing through, Tidal Wave). */
  onSpellHit(c: AnimCtx, src: HeroId, x: number, y: number) {
    const p = new THREE.Vector3(x, this.ground(x, y) + 1.5, y);
    if (src === 'vexa') {
      c.fx.burst(p, 8, 0x9fffc8, 5, 0.3, 0.35, 6);
      c.fx.flashAt(p, 2, 0x9fffc8, 0.2);
    } else if (src === 'kaela') {
      c.fx.burst(p, 8, 0xe0fbff, 4, 0.3, 0.5, 10, false);
    }
  }
}
