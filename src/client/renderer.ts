import { GameEvent, GameMap, HEROES, ITEMS, LANE_IDS, RUNE_INFO, Side, Team, Unit, WARD_CAST_RANGE, World, isInvisible, isNight } from '../sim';
import type { Aim } from './input';

/**
 * 2D top-down renderer. It only READS the simulation; swapping it for a 3D renderer
 * (Three.js / Babylon.js) later does not touch game logic. World (x, y) maps to the
 * 3D ground plane (x, z).
 */
export const TEAM_COLORS: Record<Side, string> = { 0: '#3d8bfd', 1: '#e5484d', 2: '#b08a55' };
const TEAM_DARK: Record<Side, string> = { 0: '#1d4f9e', 1: '#8f2226', 2: '#6b5232' };
const PX_PER_UNIT_BAKED = 6;

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private mapImage: HTMLCanvasElement;
  camX = 100;
  camY = 100;
  /** CSS pixels per world meter. */
  zoom = 10;
  zoomFactor = 1;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  /** Melee swing arcs (attacker position, direction, reach). */
  private swings: { x: number; y: number; ang: number; reach: number; t: number; color: string }[] = [];
  private lunges = new Map<number, { ang: number; t: number }>();
  private blasts: { x: number; y: number; r: number; t: number; color: string }[] = [];
  /** Floating text: "Denied!", "+38" gold... */
  private floaters: { x: number; y: number; t: number; text: string; color: string; big?: boolean }[] = [];
  /** Inventory slot of a ward being placed (shows the placement range). */
  wardMode: number | null = null;
  /** Free camera: set while dead, or while the player holds the minimap. */
  private lookTarget: { x: number; y: number } | null = null;
  private fogCanvas: HTMLCanvasElement;
  private fogData: ImageData;

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
        if (u) this.floaters.push({ x: u.x, y: u.y - 1, t: 1, text: '!', color: '#ffffff' });
        if (u && e.killerId === meId) this.floaters.push({ x: u.x, y: u.y - 2.2, t: 1.2, text: 'Denied!', color: '#e5e7eb' });
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
    this.zoom = (Math.min(this.cssH, this.cssW * 0.75) / 44) * this.zoomFactor;
  }

  setZoomFactor(f: number) {
    this.zoomFactor = Math.max(0.5, Math.min(2.2, f));
    this.resize();
  }

  screenToWorld(sx: number, sy: number) {
    return { x: this.camX + (sx - this.cssW / 2) / this.zoom, y: this.camY + (sy - this.cssH / 2) / this.zoom };
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

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0d150f';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    ctx.save();
    ctx.translate(this.cssW / 2, this.cssH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapImage, 0, 0, w.map.size, w.map.size);

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

    for (const s of structures) this.drawStructure(s, w.time);
    this.drawAreas(w, seesPoint);
    this.drawRunes(w, viewTeam);
    for (const u of w.units) if (u.ward && u.alive && sees(u)) this.drawWard(u, viewTeam);
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
    for (const c of creeps) {
      const p = at(c);
      if (c.neutral) {
        this.drawNeutral(c, p);
        continue;
      }
      ctx.fillStyle = c.creep!.super ? TEAM_DARK[c.team] : TEAM_COLORS[c.team];
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      if (c.creep!.type === 'ranged') {
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

    for (const pr of w.projectiles) {
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
      ctx.strokeStyle = '#d9fff0';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(p.x - sk.dx * 2.5, p.y - sk.dy * 2.5);
      ctx.lineTo(p.x + sk.dx * 0.8, p.y + sk.dy * 0.8);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(63,191,127,0.4)';
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
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.min(1, f.t * 2);
      ctx.fillStyle = f.color;
      ctx.font = `bold ${f.big ? 1.5 : 1.05}px system-ui, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 0.18;
      ctx.strokeText(f.text, f.x, f.y - (1 - f.t) * 1.5);
      ctx.fillText(f.text, f.x, f.y - (1 - f.t) * 1.5);
    }
    ctx.globalAlpha = 1;

    this.drawFog(w, viewTeam);
    if (aim && focus && focus.alive) this.drawAim(w, focus, lerp(focus), aim);
    ctx.restore();
    if (isNight(w.time)) {
      ctx.fillStyle = 'rgba(10,20,60,0.22)';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }

    this.drawMinimap(w, focus, viewTeam);
  }

  private oneHitKills(w: World, me: Unit, c: Unit): boolean {
    if (c.team === me.team && !w.canDeny(me, c)) return false;
    let dmg = me.damage;
    for (const b of me.buffs) if (b.damageMult) dmg *= b.damageMult;
    const armor = w.armorOf(c);
    dmg *= 1 - (0.06 * armor) / (1 + 0.06 * Math.abs(armor));
    if (c.structure?.backdoor) return false;
    return c.hp <= dmg;
  }

  /** Darken everything outside the team's vision (smoothly upscaled from the vision grid). */
  private drawFog(w: World, team: Team) {
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

  private drawSwings() {
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

  private drawRunes(w: World, team: Team) {
    const ctx = this.ctx;
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

  private drawWard(u: Unit, viewTeam: Team) {
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

  private drawNeutral(c: Unit, p: { x: number; y: number }) {
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
  private drawTeleports(w: World, viewTeam: Team) {
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
      if (t && (h.team === viewTeam || visible)) {
        ctx.fillStyle = `rgba(140,200,255,${0.15 + 0.2 * k})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius + 3 + Math.sin(w.time * 8) * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawAreas(w: World, seesPoint: (team: Side, x: number, y: number) => boolean) {
    const ctx = this.ctx;
    for (const z of w.zones) {
      if (!seesPoint(z.team, z.x, z.y)) continue;
      const fade = Math.min(1, (z.duration - z.t) * 3);
      ctx.globalAlpha = fade;
      if (z.kind === 'arrowStorm') {
        ctx.fillStyle = 'rgba(63,191,127,0.18)';
        ctx.strokeStyle = 'rgba(160,255,200,0.7)';
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
      ctx.strokeStyle = b.kind === 'cataclysm' ? 'rgba(255,90,40,0.9)' : 'rgba(230,190,90,0.9)';
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = b.kind === 'cataclysm' ? 'rgba(255,90,40,0.3)' : 'rgba(230,190,90,0.3)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStatus(u: Unit, p: { x: number; y: number }, time: number) {
    const ctx = this.ctx;
    if (u.stunTimer > 0) {
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
  private drawAim(w: World, me: Unit, p: { x: number; y: number }, aim: Aim) {
    const ctx = this.ctx;
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

  private arrow(x0: number, y0: number, x1: number, y1: number, rgb: string) {
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

  private drawStructure(s: Unit, time: number) {
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
        ctx.fillText(st.tier === 'tower1' ? '1' : st.tier === 'tower2' ? '2' : 'S', s.x, s.y + 0.05);
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

  private hpBar(x: number, y: number, w: number, h: number, ratio: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - w / 2 - 0.05, y - h / 2 - 0.05, w + 0.1, h + 0.1);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y - h / 2, w * Math.max(0, ratio), h);
  }

  private drawMinimap(w: World, focus: Unit | undefined, viewTeam: Team) {
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
    const vw = (this.cssW / this.zoom) * k;
    const vh = (this.cssH / this.zoom) * k;
    ctx.strokeStyle = this.lookTarget ? '#ffe066' : 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + this.camX * k - vw / 2, y + this.camY * k - vh / 2, vw, vh);
    ctx.restore();
  }
}

/** Pre-render static terrain once to an offscreen canvas. */
function bakeMap(map: GameMap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const px = PX_PER_UNIT_BAKED;
  c.width = c.height = map.size * px;
  const g = c.getContext('2d')!;
  // Team territory tint (diagonal split).
  g.fillStyle = '#25321f';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(61,139,253,0.06)';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, c.height);
  g.lineTo(c.width, c.height);
  g.fill();
  g.fillStyle = 'rgba(229,72,77,0.06)';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(c.width, 0);
  g.lineTo(c.width, c.height);
  g.fill();

  // River.
  g.strokeStyle = '#2b5f7c';
  g.lineCap = 'round';
  g.lineWidth = 9 * px;
  g.beginPath();
  g.moveTo(map.river[0].x * px, map.river[0].y * px);
  g.lineTo(map.river[1].x * px, map.river[1].y * px);
  g.stroke();

  // Lanes.
  g.strokeStyle = '#6b5a3e';
  g.lineJoin = 'round';
  g.lineWidth = 7 * px;
  for (const id of LANE_IDS) {
    g.beginPath();
    map.lanes[id].forEach((p, i) => (i ? g.lineTo(p.x * px, p.y * px) : g.moveTo(p.x * px, p.y * px)));
    g.stroke();
  }

  // Walls (the maze): dark forest with deterministic "tree" speckles.
  const cs = map.cell * px;
  for (let cy = 0; cy < map.grid; cy++) {
    for (let cx = 0; cx < map.grid; cx++) {
      if (map.walkable[cy * map.grid + cx]) continue;
      g.fillStyle = '#0f1a10';
      g.fillRect(cx * cs, cy * cs, cs + 0.5, cs + 0.5);
      const hsh = ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
      if (hsh % 3 === 0) {
        g.fillStyle = hsh % 2 ? '#1a2e18' : '#16261a';
        g.beginPath();
        g.arc(cx * cs + cs / 2, cy * cs + cs / 2, cs * 0.6, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // Forest paths: faint trails so the escape routes read on the map.
  g.strokeStyle = 'rgba(120,100,70,0.35)';
  g.lineWidth = 1.6 * px;
  g.setLineDash([2 * px, 1.5 * px]);
  for (const path of map.forestPaths) {
    g.beginPath();
    path.forEach((p, i) => (i ? g.lineTo(p.x * px, p.y * px) : g.moveTo(p.x * px, p.y * px)));
    g.stroke();
  }
  g.setLineDash([]);

  // High ground: lighter ground on plateaus / hills (drawn as one mask, so no seams),
  // with a dark cliff edge where the ground drops to a lower level.
  const n = map.grid;
  for (const level of [2, 3]) {
    const mask = document.createElement('canvas');
    mask.width = mask.height = c.width;
    const mg = mask.getContext('2d')!;
    mg.fillStyle = level >= 3 ? 'rgb(235,225,180)' : 'rgb(220,210,190)';
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        if (map.height[cy * n + cx] === level && map.walkable[cy * n + cx]) mg.fillRect(cx * cs, cy * cs, cs + 1, cs + 1);
      }
    }
    g.globalAlpha = level >= 3 ? 0.22 : 0.1;
    g.drawImage(mask, 0, 0);
    g.globalAlpha = 1;
  }
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const hgt = map.height[cy * n + cx];
      if (hgt <= 1) continue;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      const edge = Math.max(1.5, cs * 0.18);
      const lower = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && map.height[y * n + x] < hgt;
      if (lower(cx, cy + 1)) g.fillRect(cx * cs, (cy + 1) * cs - edge, cs, edge);
      if (lower(cx + 1, cy)) g.fillRect((cx + 1) * cs - edge, cy * cs, edge, cs);
      if (lower(cx, cy - 1)) g.fillRect(cx * cs, cy * cs, cs, edge * 0.6);
      if (lower(cx - 1, cy)) g.fillRect(cx * cs, cy * cs, edge * 0.6, cs);
    }
  }
  for (const h of map.hills) {
    g.strokeStyle = 'rgba(255,240,190,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(h.x * px, h.y * px, 3.2 * px, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}
