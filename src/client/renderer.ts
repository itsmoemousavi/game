import { GameMap, HEROES, LANE_IDS, Team, Unit, World } from '../sim';

/**
 * 2D top-down renderer. It only READS the simulation; swapping it for a 3D renderer
 * (Three.js / Babylon.js) later does not touch game logic. World (x, y) maps to the
 * 3D ground plane (x, z).
 */
export const TEAM_COLORS: Record<Team, string> = { 0: '#3d8bfd', 1: '#e5484d' };
const TEAM_DARK: Record<Team, string> = { 0: '#1d4f9e', 1: '#8f2226' };
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
  /** Recent attack flashes for melee swings. */
  private flashes: { x: number; y: number; t: number }[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    map: GameMap,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.mapImage = bakeMap(map);
    this.resize();
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

  render(w: World, alpha: number, focus: Unit | undefined, viewTeam: Team) {
    const ctx = this.ctx;
    const lerp = (u: { x: number; y: number; px: number; py: number }) => ({
      x: u.px + (u.x - u.px) * alpha,
      y: u.py + (u.y - u.py) * alpha,
    });

    // Camera follows the player's hero (or their fountain while dead).
    const anchor = focus && focus.alive ? lerp(focus) : w.map.fountains[viewTeam];
    this.camX += (anchor.x - this.camX) * 0.25;
    this.camY += (anchor.y - this.camY) * 0.25;

    for (const e of w.events) {
      if (e.type !== 'attack') continue;
      const src = w.unit(e.sourceId);
      const tgt = w.unit(e.targetId);
      if (src && tgt && src.projectileSpeed === 0) this.flashes.push({ x: tgt.x, y: tgt.y, t: 0.15 });
    }

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
    const creeps = w.units.filter((u) => u.kind === 'creep' && u.alive);
    const heroes = w.units.filter((u) => u.kind === 'hero' && u.alive);

    for (const s of structures) this.drawStructure(s);
    for (const c of creeps) {
      const p = lerp(c);
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
      if (c.hp < c.maxHp) this.hpBar(p.x, p.y - c.radius - 0.5, 1.8, 0.28, c.hp / c.maxHp, TEAM_COLORS[c.team]);
    }

    for (const h of heroes) {
      const p = lerp(h);
      const def = HEROES[h.hero!.defId];
      const isMe = h === focus;
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
    }

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
      ctx.fillStyle = pr.team === 0 ? '#bfe0ff' : '#ffc9c9';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    this.flashes = this.flashes.filter((f) => (f.t -= 1 / 60) > 0);
    for (const f of this.flashes) {
      ctx.strokeStyle = `rgba(255,255,255,${f.t * 5})`;
      ctx.lineWidth = 0.15;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.2 - f.t * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    this.drawMinimap(w, focus);
  }

  private drawStructure(s: Unit) {
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

  private drawMinimap(w: World, focus: Unit | undefined) {
    const ctx = this.ctx;
    const { x, y, size } = this.minimapRect();
    const k = size / w.map.size;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
    ctx.drawImage(this.mapImage, x, y, size, size);
    ctx.globalAlpha = 1;
    for (const u of w.units) {
      if (!u.alive && u.kind !== 'structure') continue;
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
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
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
  return c;
}
