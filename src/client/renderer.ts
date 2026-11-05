import { trueSightRadius, GameEvent, groundItemExpiry, GameMap, HEROES, ITEMS, canPickUp, PING_DURATION, PingKind, RUNE_INFO, Side, Team, Unit, WARD_CAST_RANGE, WARDEN_SLAM, World, isInvisible, isNight } from '../sim';
import { ATTACK_AIM, type Aim } from './input';
import { itemImage } from './icons';
import { bakeMap } from './map-art';

/** How many meters of the map fit top to bottom at the default zoom (bigger = farther out). */
const DEFAULT_VIEW_METERS = 52;

/**
 * 2D top-down renderer. It only READS the simulation; swapping it for a 3D renderer
 * (Three.js / Babylon.js) later does not touch game logic. World (x, y) maps to the
 * 3D ground plane (x, z).
 */
export const TEAM_COLORS: Record<Side, string> = { 0: '#3d8bfd', 1: '#e5484d', 2: '#b08a55' };
const TEAM_DARK: Record<Side, string> = { 0: '#1d4f9e', 1: '#8f2226', 2: '#6b5232' };
export const PING_STYLE: Record<PingKind, { color: string; icon: string; label: string }> = {
  attack: { color: '#ef4444', icon: '⚔', label: 'Attack!' },
  defend: { color: '#3b82f6', icon: '⛨', label: 'Defend!' },
  gather: { color: '#22c55e', icon: '⚑', label: 'Gather here!' },
  retreat: { color: '#facc15', icon: '⟲', label: 'Retreat!' },
  missing: { color: '#c084fc', icon: '?', label: 'Enemy missing!' },
};

/** The sign for true sight: a green outlined eye. (x, y) is its centre, `size` its width. */
export function drawTrueSightEye(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const w = size / 2;
  const h = size * 0.3;
  const lens = () => {
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x, y - h * 1.7, x + w, y);
    ctx.quadraticCurveTo(x, y + h * 1.7, x - w, y);
    ctx.closePath();
  };
  ctx.save();
  ctx.lineJoin = 'round';
  lens();
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = size * 0.26;
  ctx.stroke();
  lens();
  ctx.strokeStyle = '#5dff8f';
  ctx.lineWidth = size * 0.11;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, size * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = '#5dff8f';
  ctx.fill();
  ctx.restore();
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  /** true: draw everything top-down (2D). false: draw only the ground layer (the 3D view adds the rest). */
  protected flat = true;
  protected mapImage: HTMLCanvasElement;
  camX = 150;
  camY = 150;
  /** CSS pixels per world meter. */
  zoom = 10;
  zoomFactor = 1;
  protected dpr = 1;
  protected cssW = 0;
  protected cssH = 0;
  /** Melee swing arcs (attacker position, direction, reach). */
  protected swings: { x: number; y: number; ang: number; reach: number; t: number; color: string }[] = [];
  protected lunges = new Map<number, { ang: number; t: number }>();
  protected blasts: { x: number; y: number; r: number; t: number; color: string }[] = [];
  /** Ground cracks left by Earthsplitter (drawn on the ground in both views). */
  protected cracks: { x: number; y: number; r: number; t: number; seed: number }[] = [];
  /** Floating text: "Denied!", "+38" gold... */
  protected floaters: { x: number; y: number; t: number; text: string; color: string; big?: boolean }[] = [];
  /** Inventory slot of a ward being placed (shows the placement range). */
  wardMode: number | null = null;
  /** Tutorial highlight on the map. */
  marker: { x: number; y: number } | null = null;
  /** Free camera: set while dead, or while the player holds the minimap. */
  protected lookTarget: { x: number; y: number } | null = null;
  protected fogCanvas: HTMLCanvasElement;
  protected fogData: ImageData;

  constructor(
    readonly canvas: HTMLCanvasElement,
    map: GameMap,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.mapImage = bakeMap(map);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = map.grid;
    this.fogData = this.fogCanvas.getContext('2d')!.createImageData(map.grid, map.grid);
    this.resize();
  }

  get terrain(): HTMLCanvasElement {
    return this.mapImage;
  }

  /** Point the camera somewhere else (minimap peek / looking around while dead). */
  lookAt(x: number, y: number) {
    this.lookTarget = { x, y };
  }

  /** Pan the free camera by a screen-space delta. */
  pan(dxPx: number, dyPx: number) {
    const base = this.lookTarget ?? { x: this.camX, y: this.camY };
    this.lookTarget = { x: base.x - dxPx / this.zoom, y: base.y - dyPx / this.zoom };
  }

  /** Return the camera to the hero. */
  follow() {
    this.lookTarget = null;
  }

  get freeCamera() {
    return this.lookTarget !== null;
  }

  /** Feed every simulation step's events (several steps can run per frame). */
  pushEvents(w: World, events: GameEvent[], meId = -1) {
    for (const e of events) {
      if (e.type === 'deny') {
        const u = w.unit(e.unitId);
        // "!" over every denied creep; a big "DENIED" when you did it, so it reads at a glance.
        if (u) this.floaters.push({ x: u.x, y: u.y - 1, t: 1.1, text: '!', color: '#7dd3fc', big: true });
        if (u && e.killerId === meId) this.floaters.push({ x: u.x, y: u.y - 2.4, t: 1.4, text: 'DENIED', color: '#7dd3fc', big: true });
        continue;
      }
      if (e.type === 'gold' && e.unitId === meId && e.amount >= 20) {
        const u = w.unit(meId);
        if (u) this.floaters.push({ x: u.x, y: u.y - 2.4, t: 1, text: `+${Math.round(e.amount)}`, color: '#ffd23f' });
        continue;
      }
      if (e.type === 'miss') {
        const t = w.unit(e.targetId);
        if (t && (e.sourceId === meId || e.targetId === meId)) this.floaters.push({ x: t.x, y: t.y - 1.6, t: 0.8, text: 'miss', color: '#d1d5db' });
        continue;
      }
      if (e.type === 'damage') {
        const t = w.unit(e.targetId);
        if (!t || (e.sourceId !== meId && e.targetId !== meId && !e.crit)) continue;
        const color = e.crit ? '#ff5d5d' : e.targetId === meId ? '#ff9b9b' : '#c4b5fd';
        const text = `${Math.round(e.amount)}${e.crit ? '!' : ''}`;
        const jitter = ((e.targetId * 7 + this.floaters.length * 13) % 10) / 10 - 0.5;
        this.floaters.push({ x: t.x + jitter, y: t.y - 1.6, t: 0.9, text, color, big: e.crit });
        continue;
      }
      if (e.type === 'blink') {
        const u = w.unit(e.unitId);
        this.blasts.push({ x: e.fromX, y: e.fromY, r: 1.6, t: 0.35, color: '165,180,252' });
        if (u) this.blasts.push({ x: u.x, y: u.y, r: 2, t: 0.4, color: '165,180,252' });
        continue;
      }
      if (e.type === 'revive') {
        const u = w.unit(e.unitId);
        if (u) this.blasts.push({ x: u.x, y: u.y, r: 4, t: 0.6, color: '255,215,90' });
        continue;
      }
      if (e.type === 'attack') {
        const src = w.unit(e.sourceId);
        const tgt = w.unit(e.targetId);
        // Swing effect for melee heroes only (creeps and camps would just add noise).
        if (!src || !tgt || src.projectileSpeed !== 0 || src.kind !== 'hero') continue;
        const ang = Math.atan2(tgt.y - src.y, tgt.x - src.x);
        const color = '#ffffff';
        this.swings.push({ x: src.x, y: src.y, ang, reach: src.radius + src.attackRange + tgt.radius * 0.5, t: 0.2, color });
        this.lunges.set(src.id, { ang, t: 0.16 });
      } else if (e.type === 'cast' && e.slot === -1 && w.unit(e.unitId)?.hero?.defId === 'brakk') {
        const u = w.unit(e.unitId)!;
        this.cracks.push({ x: u.x, y: u.y, r: 7, t: 0, seed: (u.x * 7 + u.y * 13) | 0 });
      } else if (e.type === 'wardenSlam' && e.phase === 'hit') {
        this.blasts.push({ x: e.x, y: e.y, r: e.radius * 1.4, t: 0.45, color: '196,181,253' });
      } else if (e.type === 'explosion') {
        this.blasts.push({ x: e.x, y: e.y, r: e.radius, t: 0.35, color: '255,140,40' });
      } else if (e.type === 'teleport') {
        const u = w.unit(e.unitId);
        if (u) this.blasts.push({ x: u.x, y: u.y, r: 3, t: 0.5, color: '140,200,255' });
      }
    }
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    // Show ~44 m vertically on any screen (phone landscape ≈ 9 px/m).
    this.zoom = (Math.min(this.cssH, this.cssW * 0.75) / DEFAULT_VIEW_METERS) * this.zoomFactor;
  }

  setZoomFactor(f: number) {
    // 1 is the default view, the farthest out you can go; you can only zoom in from there.
    this.zoomFactor = Math.max(1, Math.min(2.2, f));
    this.resize();
  }

  screenToWorld(sx: number, sy: number) {
    return { x: this.camX + (sx - this.cssW / 2) / this.zoom, y: this.camY + (sy - this.cssH / 2) / this.zoom };
  }

  /** Screen position (CSS pixels) of a world point `h` meters above the ground. */
  screenOf(x: number, y: number, _h = 0) {
    return { x: (x - this.camX) * this.zoom + this.cssW / 2, y: (y - this.camY) * this.zoom + this.cssH / 2 };
  }

  minimapRect() {
    const size = Math.round(Math.min(170, this.cssH * 0.34));
    return { x: 8, y: 8, size };
  }

  render(w: World, alpha: number, focus: Unit | undefined, viewTeam: Team, aim: Aim | null = null) {
    const ctx = this.ctx;
    const lerp = (u: { x: number; y: number; px: number; py: number }) => ({
      x: u.px + (u.x - u.px) * alpha,
      y: u.py + (u.y - u.py) * alpha,
    });

    // Camera follows the hero, unless the player is looking around (minimap / while dead).
    const anchor = this.lookTarget ?? (focus && focus.alive ? lerp(focus) : { x: this.camX, y: this.camY });
    const k = this.lookTarget ? 0.35 : 0.25;
    this.camX += (Math.max(0, Math.min(w.map.size, anchor.x)) - this.camX) * k;
    this.camY += (Math.max(0, Math.min(w.map.size, anchor.y)) - this.camY) * k;
    const sees = (u: Unit) => w.canSee(viewTeam, u);
    const seesPoint = (team: Side, x: number, y: number) => team === viewTeam || w.vision.seesPoint(viewTeam, x, y);

    this.beginWorld(w);

    if (focus && focus.alive) {
      const p = lerp(focus);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, focus.attackRange + focus.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    const structures = w.units.filter((u) => u.kind === 'structure');
    const creeps = w.units.filter((u) => (u.kind === 'creep' || u.kind === 'neutral') && u.alive && sees(u));
    const heroes = w.units.filter((u) => u.kind === 'hero' && u.alive && sees(u));
    const at = (u: Unit) => {
      const p = lerp(u);
      const l = this.lunges.get(u.id);
      if (l) {
        const push = Math.sin((l.t / 0.16) * Math.PI) * 0.45;
        p.x += Math.cos(l.ang) * push;
        p.y += Math.sin(l.ang) * push;
      }
      return p;
    };

    if (this.flat) for (const s of structures) this.drawStructure(s, w.time);
    this.drawAreas(w, seesPoint);
    this.drawCracks();
    this.drawRunes(w, viewTeam);
    this.drawGroundItems(w, viewTeam, focus);
    this.drawWardenSlam(w, sees);
    for (const u of w.units) if (u.ward && u.alive && sees(u)) this.drawWard(u, viewTeam);
    for (const u of w.units) {
      if (trueSightRadius(u) > 0 && sees(u)) drawTrueSightEye(this.ctx, u.x, u.y - u.radius - 1.6, 2.6);
    }
    if (this.wardMode !== null && focus?.alive) {
      const p = lerp(focus);
      ctx.strokeStyle = 'rgba(250,204,21,0.8)';
      ctx.setLineDash([0.6, 0.4]);
      ctx.lineWidth = 0.18;
      ctx.beginPath();
      const it = focus.hero!.items[this.wardMode];
      const range = it ? (ITEMS[it.id].active?.range ?? WARD_CAST_RANGE) : WARD_CAST_RANGE;
      ctx.arc(p.x, p.y, range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    this.drawTeleports(w, viewTeam);
    for (const c of this.flat ? creeps : []) {
      const p = at(c);
      if (c.neutral) {
        this.drawNeutral(c, p);
        continue;
      }
      ctx.fillStyle = c.creep?.super ? TEAM_DARK[c.team] : TEAM_COLORS[c.team];
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      if (c.creep?.type === 'ranged') {
        ctx.moveTo(p.x + Math.cos(c.facing) * c.radius * 1.3, p.y + Math.sin(c.facing) * c.radius * 1.3);
        ctx.lineTo(p.x + Math.cos(c.facing + 2.4) * c.radius, p.y + Math.sin(c.facing + 2.4) * c.radius);
        ctx.lineTo(p.x + Math.cos(c.facing - 2.4) * c.radius, p.y + Math.sin(c.facing - 2.4) * c.radius);
        ctx.closePath();
      } else {
        ctx.arc(p.x, p.y, c.radius, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      if (c.hp < c.maxHp) {
        // Last-hit helper: a bright frame when your next hit kills (or denies) this creep.
        if (focus?.alive && this.oneHitKills(w, focus, c)) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.14;
          ctx.strokeRect(p.x - 1.05, p.y - c.radius - 0.5 - 0.25, 2.1, 0.5);
        }
        this.hpBar(p.x, p.y - c.radius - 0.5, 1.8, 0.28, c.hp / c.maxHp, TEAM_COLORS[c.team]);
      }
    }

    for (const h of heroes) {
      const p = at(h);
      const def = HEROES[h.hero!.defId];
      const isMe = h === focus;
      // Invisible allies (incl. you) are drawn see-through; enemies wouldn't be drawn at all.
      ctx.globalAlpha = isInvisible(h) ? 0.4 : 1;
      if (h.buffs.some((b) => b.spellImmune)) {
        ctx.fillStyle = `rgba(250,204,21,${0.25 + Math.sin(w.time * 9) * 0.08})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, h.radius + 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      if (h.buffs.some((b) => b.key === 'charm')) {
        ctx.strokeStyle = 'rgba(255,215,90,0.8)';
        ctx.lineWidth = 0.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, h.radius + 0.75 + Math.sin(w.time * 4) * 0.08, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (!this.flat) {
        // 3D view: only the rings on the ground (team ring, and yours in yellow).
        ctx.strokeStyle = TEAM_COLORS[h.team];
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.arc(p.x, p.y, h.radius + 0.15, 0, Math.PI * 2);
        ctx.stroke();
        if (isMe) {
          ctx.strokeStyle = '#ffe066';
          ctx.lineWidth = 0.15;
          ctx.beginPath();
          ctx.arc(p.x, p.y, h.radius + 0.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 0.35, h.radius * 1.1, h.radius * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 0.3;
      ctx.strokeStyle = TEAM_COLORS[h.team];
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, h.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Facing nub.
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(h.facing) * h.radius * 0.65, p.y + Math.sin(h.facing) * h.radius * 0.65, 0.22, 0, Math.PI * 2);
      ctx.fill();
      if (isMe) {
        ctx.strokeStyle = '#ffe066';
        ctx.lineWidth = 0.15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, h.radius + 0.45, 0, Math.PI * 2);
        ctx.stroke();
      }
      this.hpBar(p.x, p.y - h.radius - 0.9, 3, 0.45, h.hp / h.maxHp, TEAM_COLORS[h.team]);
      this.hpBar(p.x, p.y - h.radius - 0.4, 3, 0.22, h.mana / Math.max(1, h.maxMana), '#5aa9ff');
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 0.8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${h.hero!.level} ${def.name}`, p.x, p.y - h.radius - 1.2);
      ctx.globalAlpha = 1;
    }

    for (const u of [...creeps, ...heroes]) this.drawStatus(u, at(u), w.time);
    this.drawSwings();

    // Target marker for the player's current target.
    const tgt = focus ? w.unit(focus.targetId) : undefined;
    if (tgt && tgt.alive) {
      const p = lerp(tgt);
      ctx.strokeStyle = '#ff4d4f';
      ctx.lineWidth = 0.15;
      ctx.setLineDash([0.5, 0.35]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, tgt.radius + 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const pr of this.flat ? w.projectiles : []) {
      const p = lerp(pr);
      if (!seesPoint(pr.team, p.x, p.y)) continue;
      if (pr.spell) {
        ctx.fillStyle = 'rgba(255,140,40,0.35)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffcf5a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.55, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = pr.team === 0 ? '#bfe0ff' : '#ffc9c9';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const sk of w.skillshots) {
      const p = lerp(sk);
      if (!seesPoint(sk.team, p.x, p.y)) continue;
      if (sk.kind === 'fireball') {
        ctx.strokeStyle = 'rgba(255,120,30,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x - sk.dx * 2.2, p.y - sk.dy * 2.2);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,140,40,0.4)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd36a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.6, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const wave = sk.kind === 'tidalWave';
      ctx.strokeStyle = wave ? '#cffafe' : '#d9fff0';
      ctx.lineWidth = wave ? 0.8 : 0.35;
      ctx.beginPath();
      ctx.moveTo(p.x - sk.dx * 2.5, p.y - sk.dy * 2.5);
      ctx.lineTo(p.x + sk.dx * 0.8, p.y + sk.dy * 0.8);
      ctx.stroke();
      ctx.strokeStyle = wave ? 'rgba(6,182,212,0.45)' : 'rgba(63,191,127,0.4)';
      ctx.lineWidth = sk.width;
      ctx.beginPath();
      ctx.moveTo(p.x - sk.dx * 4, p.y - sk.dy * 4);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    this.blasts = this.blasts.filter((b) => (b.t -= 1 / 60) > 0);
    for (const b of this.blasts) {
      const k = 1 - b.t / 0.4;
      ctx.strokeStyle = `rgba(${b.color},${Math.min(1, b.t * 3)})`;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.4 + k * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }

    this.floaters = this.floaters.filter((f) => (f.t -= 1 / 60) > 0);
    ctx.textAlign = 'center';
    for (const f of this.flat ? this.floaters : []) {
      ctx.globalAlpha = Math.min(1, f.t * 2);
      ctx.fillStyle = f.color;
      ctx.font = `bold ${f.big ? 1.5 : 1.05}px system-ui, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 0.18;
      ctx.strokeText(f.text, f.x, f.y - (1 - f.t) * 1.5);
      ctx.fillText(f.text, f.x, f.y - (1 - f.t) * 1.5);
    }
    ctx.globalAlpha = 1;

    if (this.flat) this.drawFog(w, viewTeam);
    this.drawPings(w, viewTeam);
    if (this.marker) {
      const pulse = (((w.time * 1.2) % 1) + 1) % 1;
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 0.35;
      ctx.globalAlpha = 1 - pulse * 0.7;
      ctx.beginPath();
      ctx.arc(this.marker.x, this.marker.y, 1.5 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (focus?.alive) {
        // Arrow from the hero toward the marker when it's further away.
        const dx = this.marker.x - focus.x;
        const dy = this.marker.y - focus.y;
        const d = Math.hypot(dx, dy);
        if (d > 6) this.arrow(focus.x + (dx / d) * 2, focus.y + (dy / d) * 2, focus.x + (dx / d) * 5, focus.y + (dy / d) * 5, '255,210,63');
      }
    }
    if (aim && focus && focus.alive) this.drawAim(w, focus, lerp(focus), aim);
    ctx.restore();
    if (!this.flat) return;
    if (isNight(w.time)) {
      ctx.fillStyle = 'rgba(10,20,60,0.22)';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }

    this.drawMinimap(w, focus, viewTeam);
  }

  /** Clear the screen and set the world → screen transform (the 3D renderer overrides this). */
  protected beginWorld(w: World) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0d150f';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.save();
    ctx.translate(this.cssW / 2, this.cssH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapImage, 0, 0, w.map.size, w.map.size);
  }

  protected oneHitKills(w: World, me: Unit, c: Unit): boolean {
    if (c.team === me.team && !w.canDeny(me, c)) return false;
    let dmg = me.damage;
    for (const b of me.buffs) if (b.damageMult) dmg *= b.damageMult;
    const armor = w.armorOf(c);
    dmg *= 1 - (0.06 * armor) / (1 + 0.06 * Math.abs(armor));
    if (c.structure?.backdoor) return false;
    return c.hp <= dmg;
  }

  /** Darken everything outside the team's vision (smoothly upscaled from the vision grid). */
  protected drawFog(w: World, team: Team) {
    const g = w.vision.grids[team];
    const d = this.fogData.data;
    const a = isNight(w.time) ? 175 : 140;
    for (let i = 0; i < g.length; i++) {
      d[i * 4] = 8;
      d[i * 4 + 1] = 12;
      d[i * 4 + 2] = 20;
      d[i * 4 + 3] = g[i] ? 0 : a;
    }
    this.fogCanvas.getContext('2d')!.putImageData(this.fogData, 0, 0);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, 0, 0, w.map.size, w.map.size);
  }

  protected drawPings(w: World, team: Team) {
    const ctx = this.ctx;
    for (const p of w.pings) {
      if (p.team !== team) continue;
      const age = w.time - p.at;
      if (age > PING_DURATION) continue;
      const st = PING_STYLE[p.kind];
      const pulse = (age * 1.6) % 1;
      ctx.strokeStyle = st.color;
      ctx.globalAlpha = 1 - pulse;
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = st.color;
      ctx.font = 'bold 2.2px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.icon, p.x, p.y);
      ctx.textBaseline = 'alphabetic';
    }
  }

  protected drawSwings() {
    const ctx = this.ctx;
    this.swings = this.swings.filter((s) => (s.t -= 1 / 60) > 0);
    for (const [id, l] of this.lunges) if ((l.t -= 1 / 60) <= 0) this.lunges.delete(id);
    for (const s of this.swings) {
      const k = 1 - s.t / 0.2; // 0 → 1 over the swing
      const sweep = Math.PI * 0.75;
      const a0 = s.ang - sweep / 2 + sweep * Math.max(0, k - 0.35);
      const a1 = s.ang - sweep / 2 + sweep * Math.min(1, k + 0.15);
      ctx.globalAlpha = Math.min(1, s.t * 7);
      // Faint wedge + bright arc so the swing reads clearly on a small phone screen.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.arc(s.x, s.y, s.reach, a0, a1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 0.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.reach * 0.85, a0, a1);
      ctx.stroke();
      // Impact spark at the end of the swing.
      if (k > 0.5) {
        const ix = s.x + Math.cos(s.ang) * s.reach;
        const iy = s.y + Math.sin(s.ang) * s.reach;
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath();
        ctx.arc(ix, iy, 0.35 * (1 - k) + 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }
  }

  /**
   * Dropped items: the item's icon flat on the ground. A gold ring marks items you can
   * pick up (yours, or an ally's ward); the ring empties as the item's 2 minutes run out.
   */
  protected drawGroundItems(w: World, team: Team, me: Unit | undefined) {
    const ctx = this.ctx;
    for (const g of w.groundItems) {
      if (g.team !== team && !w.vision.seesPoint(team, g.x, g.y)) continue;
      const mine = !!me && canPickUp(me, g);
      const left = (groundItemExpiry(g) - w.time) / (groundItemExpiry(g) - g.droppedAt);
      const r = 1.25;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(g.x, g.y, r + 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mine ? '#facc15' : 'rgba(200,200,200,0.6)';
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.arc(g.x, g.y, r + 0.12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.stroke();
      const img = itemImage(g.item.id);
      if (img.complete) ctx.drawImage(img, g.x - r * 0.8, g.y - r * 0.8, r * 1.6, r * 1.6);
      if (g.item.count > 1) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 0.6px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(g.item.count), g.x + r * 0.55, g.y + r * 0.8);
      }
    }
  }

  /** The Warden winding up its ground slam: a red circle that fills until it lands. */
  protected drawWardenSlam(w: World, sees: (u: Unit) => boolean) {
    const ctx = this.ctx;
    for (const u of w.units) {
      const n = u.neutral;
      if (!n?.boss || !u.alive || n.slamLand == null || !sees(u)) continue;
      const k = Math.max(0, Math.min(1, 1 - (n.slamLand - w.time) / WARDEN_SLAM.windup));
      ctx.fillStyle = `rgba(239,68,68,${0.12 + 0.2 * k})`;
      ctx.beginPath();
      ctx.arc(u.x, u.y, WARDEN_SLAM.radius * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(248,113,113,0.9)';
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.arc(u.x, u.y, WARDEN_SLAM.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  protected drawRunes(w: World, team: Team) {
    const ctx = this.ctx;
    // Couriers: a small brown body with saddlebags in the team colour (yours always, enemies' in vision).
    for (const hu of w.heroes) {
      const c = hu.hero!.courier;
      if (hu.team !== team && !w.vision.seesPoint(team, c.x, c.y)) continue;
      ctx.fillStyle = '#7a6248';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 0.75, 0.5, c.facing, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = TEAM_COLORS[hu.team];
      ctx.beginPath();
      ctx.arc(c.x, c.y, 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const r of w.runes) {
      if (!w.vision.seesPoint(team, r.x, r.y)) continue;
      const info = RUNE_INFO[r.kind];
      const pulse = 1 + Math.sin(w.time * 5) * 0.12;
      ctx.fillStyle = info.color;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 1.6 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y - 1 * pulse);
      ctx.lineTo(r.x + 0.7 * pulse, r.y);
      ctx.lineTo(r.x, r.y + 1 * pulse);
      ctx.lineTo(r.x - 0.7 * pulse, r.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.1;
      ctx.stroke();
    }
  }

  protected drawWard(u: Unit, viewTeam: Team) {
    const ctx = this.ctx;
    const sentry = u.ward!.kind === 'sentry';
    const own = u.team === viewTeam;
    ctx.globalAlpha = own ? 0.9 : 1;
    ctx.fillStyle = sentry ? '#60a5fa' : '#facc15';
    ctx.strokeStyle = TEAM_COLORS[u.team];
    ctx.lineWidth = 0.2;
    // A little eye.
    ctx.beginPath();
    ctx.ellipse(u.x, u.y, 0.8, 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(u.x, u.y, 0.22, 0, Math.PI * 2);
    ctx.fill();
    if (!own) this.hpBar(u.x, u.y - 1, 1.6, 0.25, u.hp / u.maxHp, TEAM_COLORS[u.team]);
    ctx.globalAlpha = 1;
  }

  protected drawNeutral(c: Unit, p: { x: number; y: number }) {
    const ctx = this.ctx;
    if (c.neutral?.boss) {
      // The river boss: big, purple, crowned.
      ctx.fillStyle = 'rgba(120,60,200,0.25)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, c.radius + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7c3aed';
      ctx.strokeStyle = '#1e1033';
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      ctx.arc(p.x, p.y, c.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(p.x + i * 0.7 - 0.3, p.y - c.radius + 0.2);
        ctx.lineTo(p.x + i * 0.7, p.y - c.radius - 0.7);
        ctx.lineTo(p.x + i * 0.7 + 0.3, p.y - c.radius + 0.2);
        ctx.fill();
      }
      this.hpBar(p.x, p.y - c.radius - 1.3, 5, 0.5, c.hp / c.maxHp, '#a78bfa');
      ctx.fillStyle = '#e9d5ff';
      ctx.font = 'bold 0.8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Warden', p.x, p.y - c.radius - 1.8);
      return;
    }
    ctx.fillStyle = TEAM_COLORS[2];
    ctx.strokeStyle = '#2b2116';
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    // Spiky silhouette so jungle monsters read differently from lane creeps.
    const spikes = 7;
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 + c.facing;
      const r = i % 2 ? c.radius * 0.75 : c.radius * 1.1;
      ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (c.hp < c.maxHp) this.hpBar(p.x, p.y - c.radius - 0.6, 2.2, 0.3, c.hp / c.maxHp, '#d9a25f');
  }

  /** Channelling teleports: ring around the hero and a marker on the destination. */
  /** Jagged cracks radiating from Earthsplitter: glowing at first, then dark scars that fade. */
  protected drawCracks() {
    const ctx = this.ctx;
    this.cracks = this.cracks.filter((c) => (c.t += 1 / 60) < 3.2);
    for (const c of this.cracks) {
      let r = c.seed;
      const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const fade = Math.min(1, (3.2 - c.t) / 1.2);
      const hot = Math.max(0, 1 - c.t / 1.1);
      const grow = Math.min(1, c.t / 0.18);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < 11; i++) {
        const a0 = (i / 11) * Math.PI * 2 + rnd() * 0.4;
        const len = c.r * (0.55 + rnd() * 0.45) * grow;
        const pts: [number, number][] = [[c.x, c.y]];
        let a = a0;
        for (let s = 1; s <= 5; s++) {
          a += (rnd() - 0.5) * 0.7;
          const d = (len * s) / 5;
          pts.push([c.x + Math.cos(a) * d, c.y + Math.sin(a) * d]);
        }
        const path = () => {
          ctx.beginPath();
          pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        };
        ctx.strokeStyle = `rgba(20,14,8,${0.75 * fade})`;
        ctx.lineWidth = 0.42;
        path();
        ctx.stroke();
        if (hot > 0) {
          ctx.strokeStyle = `rgba(255,150,40,${0.95 * hot})`;
          ctx.lineWidth = 0.16;
          path();
          ctx.stroke();
        }
      }
    }
  }

  protected drawTeleports(w: World, viewTeam: Team) {
    const ctx = this.ctx;
    for (const h of w.units) {
      const c = h.hero?.channel;
      if (!c || !h.alive) continue;
      const k = 1 - c.t / c.total;
      const visible = w.canSee(viewTeam, h);
      if (visible) {
        ctx.strokeStyle = 'rgba(140,200,255,0.9)';
        ctx.lineWidth = 0.25;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 1.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
        ctx.stroke();
      }
      const t = w.unit(c.targetId);
      // Allies always see where a hero is teleporting; enemies only if they can see that spot.
      if (t && (h.team === viewTeam || w.vision.seesPoint(viewTeam, t.x, t.y))) {
        ctx.fillStyle = h.team === 0 ? `rgba(110,170,255,${0.18 + 0.25 * k})` : `rgba(255,110,110,${0.18 + 0.25 * k})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius + 3 + Math.sin(w.time * 8) * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  protected drawAreas(w: World, seesPoint: (team: Side, x: number, y: number) => boolean) {
    const ctx = this.ctx;
    for (const z of w.zones) {
      if (!seesPoint(z.team, z.x, z.y)) continue;
      const fade = Math.min(1, (z.duration - z.t) * 3);
      ctx.globalAlpha = fade;
      if (z.kind === 'arrowStorm') {
        ctx.fillStyle = 'rgba(63,191,127,0.18)';
        ctx.strokeStyle = 'rgba(160,255,200,0.7)';
      } else if (z.kind === 'maelstrom') {
        ctx.fillStyle = 'rgba(6,182,212,0.22)';
        ctx.strokeStyle = 'rgba(165,243,252,0.8)';
      } else {
        ctx.fillStyle = 'rgba(255,110,30,0.25)';
        ctx.strokeStyle = 'rgba(255,170,60,0.7)';
      }
      ctx.lineWidth = 0.2;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Falling arrows / flickering embers: deterministic pseudo-random positions.
      ctx.fillStyle = z.kind === 'arrowStorm' ? '#e6fff2' : '#ffb347';
      const n = 14;
      for (let i = 0; i < n; i++) {
        const seed = (i * 97 + Math.floor(z.t * 8) * 31) % 101;
        const a = (seed / 101) * Math.PI * 2;
        const r = (((i * 53) % 17) / 17) * z.radius * 0.95;
        ctx.fillRect(z.x + Math.cos(a) * r - 0.1, z.y + Math.sin(a) * r - 0.45, 0.2, 0.9);
      }
      ctx.globalAlpha = 1;
    }
    for (const b of w.blasts) {
      if (!seesPoint(b.team, b.x, b.y)) continue;
      const k = Math.min(1, b.t / b.delay);
      const green = b.kind === 'rootSnare' || b.kind === 'overgrowth';
      ctx.strokeStyle = b.kind === 'cataclysm' ? 'rgba(255,90,40,0.9)' : green ? 'rgba(132,204,22,0.9)' : 'rgba(230,190,90,0.9)';
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = b.kind === 'cataclysm' ? 'rgba(255,90,40,0.3)' : green ? 'rgba(132,204,22,0.3)' : 'rgba(230,190,90,0.3)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  protected drawStatus(u: Unit, p: { x: number; y: number }, time: number) {
    const ctx = this.ctx;
    if (u.stunTimer > 0 && this.flat) {
      ctx.fillStyle = '#ffe066';
      for (let i = 0; i < 3; i++) {
        const a = time * 5 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * (u.radius + 0.2), p.y - u.radius - 0.2 + Math.sin(a) * 0.35, 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const b of u.buffs) {
      if (b.slowPct) {
        ctx.strokeStyle = 'rgba(120,200,255,0.8)';
        ctx.lineWidth = 0.15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, u.radius + 0.25, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (b.healPerSec) {
        ctx.fillStyle = 'rgba(80,255,120,0.25)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, u.radius + 0.5 + Math.sin(time * 6) * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      if (b.key === 'stoneskin') {
        ctx.strokeStyle = 'rgba(168,162,158,0.9)';
        ctx.lineWidth = 0.35;
        ctx.setLineDash([0.5, 0.25]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, u.radius + 0.45, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.damageMult) {
        ctx.fillStyle = `rgba(255,77,77,${0.22 + Math.sin(time * 8) * 0.08})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, u.radius + 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      if (b.moveSpeedPct) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(u.facing) * 1.5, p.y - Math.sin(u.facing) * 1.5);
        ctx.lineTo(p.x - Math.cos(u.facing) * 2.5, p.y - Math.sin(u.facing) * 2.5);
        ctx.stroke();
      }
    }
    if (u.dash) {
      ctx.strokeStyle = 'rgba(255,224,102,0.6)';
      ctx.lineWidth = u.radius * 1.6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - u.dash.dx * 3, p.y - u.dash.dy * 3);
      ctx.stroke();
    }
    if (u.castLock > 0.2) {
      ctx.strokeStyle = 'rgba(230,190,90,0.9)';
      ctx.lineWidth = 0.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, u.radius + 0.6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - u.castLock / 0.6));
      ctx.stroke();
    }
  }

  /**
   * Aim indicator while an ability button is held: range circle, an arrow from the
   * hero toward the aim (works in any direction, including backwards), and the
   * ability's footprint (line width, area, or the ally that will be targeted).
   */
  protected drawAim(w: World, me: Unit, p: { x: number; y: number }, aim: Aim) {
    const ctx = this.ctx;
    if (aim.slot === ATTACK_AIM) {
      // Attack arrow: from the hero to the chosen target (or the tip), target ringed.
      const t = aim.targetId !== undefined ? w.unit(aim.targetId) : undefined;
      const own = t && t.team === me.team; // a deny
      const rgb = aim.cancel ? '255,80,80' : own ? '255,210,63' : '255,120,90';
      const ex = t ? t.x : aim.x;
      const ey = t ? t.y : aim.y;
      ctx.lineWidth = 0.15;
      ctx.strokeStyle = `rgba(${rgb},0.35)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, me.attackRange + me.radius, 0, Math.PI * 2);
      ctx.stroke();
      this.arrow(p.x, p.y, ex, ey, rgb);
      if (t) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
        ctx.strokeStyle = `rgba(${rgb},0.95)`;
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius + 0.6 + pulse * 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }
    const def = HEROES[me.hero!.defId].abilities[aim.slot];
    const rgb = aim.cancel ? '255,80,80' : '120,200,255';
    ctx.lineWidth = 0.15;
    if (def.castRange > 0) {
      ctx.strokeStyle = `rgba(${rgb},0.55)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, def.castRange, 0, Math.PI * 2);
      ctx.stroke();
    }
    const dx = aim.x - p.x;
    const dy = aim.y - p.y;
    const l = Math.hypot(dx, dy);
    const ux = l > 0.01 ? dx / l : Math.cos(me.facing);
    const uy = l > 0.01 ? dy / l : Math.sin(me.facing);
    ctx.fillStyle = `rgba(${rgb},0.22)`;
    ctx.strokeStyle = `rgba(${rgb},0.9)`;

    if (def.targeting === 'direction') {
      // Footprint of the skillshot / dash, then the arrow on top.
      const hw = def.id === 'fireball' ? 0.7 : def.radius;
      const nx = -uy;
      const ny = ux;
      const ex = p.x + ux * def.castRange;
      const ey = p.y + uy * def.castRange;
      ctx.beginPath();
      ctx.moveTo(p.x + nx * hw, p.y + ny * hw);
      ctx.lineTo(ex + nx * hw, ey + ny * hw);
      ctx.lineTo(ex - nx * hw, ey - ny * hw);
      ctx.lineTo(p.x - nx * hw, p.y - ny * hw);
      ctx.closePath();
      ctx.fill();
      if (def.id === 'fireball') {
        ctx.beginPath();
        ctx.arc(ex, ey, def.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      this.arrow(p.x, p.y, ex, ey, rgb);
      return;
    }
    if (def.targeting === 'point') {
      this.arrow(p.x, p.y, aim.x, aim.y, rgb);
      ctx.fillStyle = `rgba(${rgb},0.22)`;
      ctx.strokeStyle = `rgba(${rgb},0.9)`;
      ctx.lineWidth = 0.15;
      ctx.beginPath();
      ctx.arc(aim.x, aim.y, def.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    if (def.targeting === 'none') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, def.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    // Unit-targeted (ally / enemy): arrow toward the aim, ring on the unit it will hit.
    const t = w.unit(aim.targetId);
    const end = t ? { x: t.x, y: t.y } : { x: p.x + ux * def.castRange, y: p.y + uy * def.castRange };
    if (!t || t !== me) this.arrow(p.x, p.y, end.x, end.y, rgb);
    if (t) {
      ctx.strokeStyle = `rgba(${rgb},1)`;
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.radius + 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  protected arrow(x0: number, y0: number, x1: number, y1: number, rgb: string) {
    const ctx = this.ctx;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    if (l < 0.5) return;
    const ux = dx / l;
    const uy = dy / l;
    const head = Math.min(2.2, l * 0.35);
    const start = 1.4; // start just outside the hero
    ctx.strokeStyle = `rgba(${rgb},0.95)`;
    ctx.lineWidth = 0.45;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0 + ux * start, y0 + uy * start);
    ctx.lineTo(x1 - ux * head * 0.6, y1 - uy * head * 0.6);
    ctx.stroke();
    ctx.fillStyle = `rgba(${rgb},0.95)`;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * head - uy * head * 0.6, y1 - uy * head + ux * head * 0.6);
    ctx.lineTo(x1 - ux * head + uy * head * 0.6, y1 - uy * head - ux * head * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.lineCap = 'butt';
  }

  protected drawStructure(s: Unit, time: number) {
    const ctx = this.ctx;
    const st = s.structure!;
    const r = s.radius;
    if (!s.alive) {
      ctx.fillStyle = 'rgba(80,80,80,0.6)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const color = TEAM_COLORS[s.team];
    ctx.lineWidth = 0.25;
    ctx.strokeStyle = '#111';
    ctx.fillStyle = TEAM_DARK[s.team];
    switch (st.tier) {
      case 'shrine':
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          ctx.lineTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'barracks':
        ctx.fillRect(s.x - r, s.y - r * 0.7, r * 2, r * 1.4);
        ctx.strokeRect(s.x - r, s.y - r * 0.7, r * 2, r * 1.4);
        ctx.fillStyle = color;
        ctx.fillRect(s.x - r * 0.6, s.y - r * 0.3, r * 1.2, r * 0.6);
        break;
      case 'fountain':
        ctx.fillStyle = 'rgba(120,220,255,0.15)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        return;
      default: {
        // Towers: square base with a colored top.
        ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
        ctx.strokeRect(s.x - r, s.y - r, r * 2, r * 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 1.1px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.tier === 'tower1' ? '1' : st.tier === 'tower2' ? '2' : st.tier === 'tower3' ? '3' : 'S', s.x, s.y + 0.05);
        ctx.textBaseline = 'alphabetic';
      }
    }
    if (st.glyph > 0) {
      ctx.fillStyle = `rgba(120,220,255,${0.25 + Math.sin(time * 10) * 0.08})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 1.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (st.backdoor && time - st.backdoorHitAt < 1.5) {
      // Backdoor protection soaking a hero-only attack.
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 0.25;
      ctx.setLineDash([0.3, 0.3]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 1.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!st.vulnerable) {
      // Protected: show a shield ring.
      ctx.strokeStyle = 'rgba(255,215,90,0.85)';
      ctx.lineWidth = 0.2;
      ctx.setLineDash([0.6, 0.4]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    this.hpBar(s.x, s.y - r - 1, r * 2.2, 0.5, s.hp / s.maxHp, color);
  }

  protected hpBar(x: number, y: number, w: number, h: number, ratio: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - w / 2 - 0.05, y - h / 2 - 0.05, w + 0.1, h + 0.1);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y - h / 2, w * Math.max(0, ratio), h);
  }

  protected drawMinimap(w: World, focus: Unit | undefined, viewTeam: Team) {
    const ctx = this.ctx;
    const { x, y, size } = this.minimapRect();
    const k = size / w.map.size;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
    ctx.drawImage(this.mapImage, x, y, size, size);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, x, y, size, size);
    // Jungle camps: a small marker, always shown, so they're easy to find.
    ctx.fillStyle = '#e8c872';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 0.8;
    for (const c of w.map.camps) {
      const cx = x + c.x * k;
      const cy = y + c.y * k;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 2.6);
      ctx.lineTo(cx + 2.6, cy);
      ctx.lineTo(cx, cy + 2.6);
      ctx.lineTo(cx - 2.6, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    for (const u of w.units) {
      if (!u.alive && u.kind !== 'structure') continue;
      if (!w.canSee(viewTeam, u)) continue;
      if (u.kind === 'neutral') continue;
      const ux = x + u.x * k;
      const uy = y + u.y * k;
      ctx.fillStyle = u.alive ? TEAM_COLORS[u.team] : '#555';
      if (u.kind === 'structure') ctx.fillRect(ux - 2.5, uy - 2.5, 5, 5);
      else if (u.kind === 'hero') {
        ctx.beginPath();
        ctx.arc(ux, uy, u === focus ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = u === focus ? '#ffe066' : '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else ctx.fillRect(ux - 1, uy - 1, 2, 2);
    }
    // Couriers out on the map: a dot smaller than a creep's (enemies only see those outside their fog).
    for (const h of w.heroes) {
      const c = h.hero!.courier;
      if (c.mode === 'home' || (h.team !== viewTeam && !w.vision.seesPoint(viewTeam, c.x, c.y))) continue;
      ctx.fillStyle = h === focus ? '#ffe066' : TEAM_COLORS[h.team];
      ctx.beginPath();
      ctx.arc(x + c.x * k, y + c.y * k, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // Teleports in progress: a pulsing marker where the hero will arrive (enemies see it only outside their fog).
    for (const h of w.heroes) {
      const c = h.hero!.channel;
      const t = c?.kind === 'tp' && h.alive ? { x: c.x, y: c.y } : undefined;
      if (!t || (h.team !== viewTeam && !w.vision.seesPoint(viewTeam, t.x, t.y))) continue;
      const pulse = (((w.time * 2) % 1) + 1) % 1; // the clock is negative during the warm-up
      ctx.strokeStyle = TEAM_COLORS[h.team];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + t.x * k, y + t.y * k, 4 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = TEAM_COLORS[h.team];
      ctx.beginPath();
      ctx.arc(x + t.x * k, y + t.y * k, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of w.pings) {
      if (p.team !== viewTeam || w.time - p.at > PING_DURATION) continue;
      const pulse = ((w.time - p.at) * 1.6) % 1;
      ctx.strokeStyle = PING_STYLE[p.kind].color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + p.x * k, y + p.y * k, 3 + pulse * 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    const vw = (this.cssW / this.zoom) * k;
    const vh = (this.cssH / this.zoom) * k;
    ctx.strokeStyle = this.lookTarget ? '#ffe066' : 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + this.camX * k - vw / 2, y + this.camY * k - vh / 2, vw, vh);
    ctx.restore();
  }
}

