import type { Command, World } from '../sim';
import type { Renderer } from './renderer';

/**
 * Turns touch / mouse / keyboard into simulation Commands.
 *
 * Mobile (primary): floating virtual joystick on the left half of the screen,
 * Attack + ability buttons bottom-right (standard mobile-MOBA layout).
 * Desktop (for testing): WASD / arrows to move, right-click to move or attack,
 * Space = attack nearest, H = stop, mouse wheel = zoom.
 */
export class Input {
  private keys = new Set<string>();
  private joy: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private lastDir = { dx: 0, dy: 0 };
  private queue: Command[] = [];
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;
  private abort = new AbortController();

  constructor(
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
    private world: () => World,
    private heroId: () => number,
    root: HTMLElement,
  ) {
    this.joyBase = root.querySelector('#joy-base')!;
    this.joyKnob = root.querySelector('#joy-knob')!;
    const opt = { signal: this.abort.signal };

    window.addEventListener('keydown', (e) => this.onKey(e, true), opt);
    window.addEventListener('keyup', (e) => this.onKey(e, false), opt);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opt);
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e), opt);
    window.addEventListener('pointermove', (e) => this.onPointerMove(e), opt);
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), opt);
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), opt);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.renderer.setZoomFactor(this.renderer.zoomFactor * (e.deltaY > 0 ? 0.9 : 1.1));
      },
      { passive: false, signal: this.abort.signal },
    );

    const tap = (sel: string, fn: () => void) =>
      root.querySelector(sel)!.addEventListener(
        'pointerdown',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        },
        opt,
      );
    tap('#btn-attack', () => this.queue.push({ type: 'attackNearest', unitId: this.heroId() }));
  }

  destroy() {
    this.abort.abort();
  }

  /** Called once per simulation tick. */
  flush(w: World) {
    const id = this.heroId();
    let dx = 0;
    let dy = 0;
    if (this.joy) {
      dx = this.joy.dx;
      dy = this.joy.dy;
    } else {
      if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    }
    const moving = Math.hypot(dx, dy) > 0.15;
    const wasMoving = Math.hypot(this.lastDir.dx, this.lastDir.dy) > 0.15;
    if (moving && (Math.abs(dx - this.lastDir.dx) > 0.05 || Math.abs(dy - this.lastDir.dy) > 0.05)) {
      w.enqueue({ type: 'moveDir', unitId: id, dx, dy });
      this.lastDir = { dx, dy };
    } else if (!moving && wasMoving) {
      w.enqueue({ type: 'moveDir', unitId: id, dx: 0, dy: 0 });
      this.lastDir = { dx: 0, dy: 0 };
    }
    for (const c of this.queue) w.enqueue(c);
    this.queue.length = 0;
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    if (down) {
      if (k === ' ') {
        e.preventDefault();
        this.queue.push({ type: 'attackNearest', unitId: this.heroId() });
        return;
      }
      if (k === 'h') this.queue.push({ type: 'stop', unitId: this.heroId() });
      this.keys.add(k);
    } else this.keys.delete(k);
  }

  private onPointerDown(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Minimap tap/click: move there.
    const mm = this.renderer.minimapRect();
    if (sx >= mm.x && sy >= mm.y && sx <= mm.x + mm.size && sy <= mm.y + mm.size) {
      const w = this.world();
      const k = w.map.size / mm.size;
      this.queue.push({ type: 'moveTo', unitId: this.heroId(), x: (sx - mm.x) * k, y: (sy - mm.y) * k });
      return;
    }

    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (sx < rect.width * 0.5 && !this.joy) {
        this.joy = { id: e.pointerId, ox: sx, oy: sy, dx: 0, dy: 0 };
        this.showJoystick(sx, sy, 0, 0);
      } else {
        this.commandAt(sx, sy);
      }
      return;
    }
    // Mouse: right or left click on the field.
    if (e.button === 2 || e.button === 0) this.commandAt(sx, sy);
  }

  /** Tap/click on an enemy = attack it; on ground = walk there. */
  private commandAt(sx: number, sy: number) {
    const w = this.world();
    const p = this.renderer.screenToWorld(sx, sy);
    const me = w.unit(this.heroId());
    if (!me) return;
    const enemy = w.units
      .filter((u) => u.alive && w.canAttack(me, u) && Math.hypot(u.x - p.x, u.y - p.y) < u.radius + 1)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (enemy) this.queue.push({ type: 'attack', unitId: me.id, targetId: enemy.id });
    else this.queue.push({ type: 'moveTo', unitId: me.id, x: p.x, y: p.y });
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.joy || e.pointerId !== this.joy.id) return;
    const rect = this.canvas.getBoundingClientRect();
    const max = 55;
    let dx = e.clientX - rect.left - this.joy.ox;
    let dy = e.clientY - rect.top - this.joy.oy;
    const l = Math.hypot(dx, dy);
    if (l > max) {
      dx = (dx / l) * max;
      dy = (dy / l) * max;
    }
    this.joy.dx = dx / max;
    this.joy.dy = dy / max;
    this.showJoystick(this.joy.ox, this.joy.oy, dx, dy);
  }

  private onPointerUp(e: PointerEvent) {
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null;
      this.joyBase.style.display = 'none';
    }
  }

  private showJoystick(x: number, y: number, kx: number, ky: number) {
    this.joyBase.style.display = 'block';
    this.joyBase.style.left = `${x}px`;
    this.joyBase.style.top = `${y}px`;
    this.joyKnob.style.transform = `translate(${kx}px, ${ky}px)`;
  }
}
