import { Command, HEROES, Unit, World, abilityDef, castBlocker } from '../sim';
import type { Renderer } from './renderer';
import { toLocal } from './screen';

/** What the player is currently aiming (drawn by the renderer). */
export interface Aim {
  slot: number;
  /** Aimed world point. */
  x: number;
  y: number;
  /** Unit that will be targeted (enemy/ally abilities). */
  targetId?: number;
  cancel: boolean;
}

const MAX_DRAG = 90;
const TAP_SLOP = 12;

/**
 * Turns touch / mouse / keyboard into simulation Commands.
 *
 * Mobile (primary):
 *  - Left half of the screen: floating virtual joystick.
 *  - Attack button: attack nearest (heroes first). Tap an enemy to attack it.
 *  - Ability buttons: TAP = quick-cast on the best target; DRAG = aim, release to cast,
 *    release over "Cancel" to abort. The small "+" learns the ability.
 *  - Minimap: hold/drag to look somewhere else; release to snap back to your hero.
 *  - While dead: drag anywhere to look around the map.
 * Desktop (testing): arrows / right-click move, Space attack, Q/W/R cast at the cursor,
 * Ctrl+Q/W/R learn, H stop, wheel zoom, right-click minimap = walk there.
 */
export class Input {
  aim: Aim | null = null;
  private keys = new Set<string>();
  private joy: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private drag: { id: number; slot: number; ox: number; oy: number; moved: boolean } | null = null;
  /** Finger/mouse held on the minimap: camera peeks there until released. */
  private peek: number | null = null;
  /** Dragging the field to look around (while dead). */
  private camDrag: { id: number; x: number; y: number } | null = null;
  private lastDir = { dx: 0, dy: 0 };
  private queue: Command[] = [];
  private mouse = { x: 0, y: 0 };
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;
  private cancelZone: HTMLElement;
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
    this.cancelZone = root.querySelector('#cancel-zone')!;
    const opt = { signal: this.abort.signal };

    window.addEventListener('keydown', (e) => this.onKey(e, true), opt);
    window.addEventListener('keyup', (e) => this.onKey(e, false), opt);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opt);
    canvas.addEventListener('pointerdown', (e) => this.onCanvasDown(e), opt);
    window.addEventListener('pointermove', (e) => this.onPointerMove(e), opt);
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), opt);
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e, true), opt);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.renderer.setZoomFactor(this.renderer.zoomFactor * (e.deltaY > 0 ? 0.9 : 1.1));
      },
      { passive: false, signal: this.abort.signal },
    );

    const press = (el: Element, fn: (e: PointerEvent) => void) =>
      el.addEventListener(
        'pointerdown',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn(e as PointerEvent);
        },
        opt,
      );
    press(root.querySelector('#btn-attack')!, () => this.queue.push({ type: 'attackNearest', unitId: this.heroId() }));
    root.querySelectorAll<HTMLElement>('[data-slot]').forEach((btn) => {
      const slot = Number(btn.dataset.slot);
      press(btn, (e) => this.onAbilityDown(e, slot));
    });
    root.querySelectorAll<HTMLElement>('[data-learn]').forEach((btn) => {
      press(btn, () => this.queue.push({ type: 'learn', unitId: this.heroId(), slot: Number(btn.dataset.learn) }));
    });
  }

  destroy() {
    this.abort.abort();
  }

  get peeking() {
    return this.peek !== null || this.camDrag !== null;
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
      if (this.keys.has('arrowleft')) dx -= 1;
      if (this.keys.has('arrowright')) dx += 1;
      if (this.keys.has('arrowup')) dy -= 1;
      if (this.keys.has('arrowdown')) dy += 1;
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

  // ---------------------------------------------------------------- keyboard

  private onKey(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    if (down && !e.repeat) {
      const slot = k === 'q' ? 0 : k === 'w' ? 1 : k === 'r' ? 2 : -1;
      if (slot >= 0) {
        e.preventDefault();
        if (e.ctrlKey || e.altKey) this.queue.push({ type: 'learn', unitId: this.heroId(), slot });
        else this.castAt(slot, this.renderer.screenToWorld(this.mouse.x, this.mouse.y));
        return;
      }
      if (k === ' ') {
        e.preventDefault();
        this.queue.push({ type: 'attackNearest', unitId: this.heroId() });
        return;
      }
      if (k === 'h') this.queue.push({ type: 'stop', unitId: this.heroId() });
    }
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  }

  /** Desktop quick-cast at the cursor (picks the unit under the cursor for unit spells). */
  private castAt(slot: number, p: { x: number; y: number }) {
    const w = this.world();
    const me = w.unit(this.heroId());
    if (!me) return;
    const def = abilityDef(me, slot);
    if (!def) return;
    if (def.targeting === 'enemy' || def.targeting === 'ally') {
      const t = this.pickUnit(w, me, def.targeting, p.x, p.y, 3);
      this.queue.push({ type: 'cast', unitId: me.id, slot, targetId: t?.id });
    } else {
      this.queue.push({ type: 'cast', unitId: me.id, slot, x: p.x, y: p.y });
    }
  }

  // ---------------------------------------------------------------- pointer

  private onCanvasDown(e: PointerEvent) {
    const { x: sx, y: sy } = toLocal(e.clientX, e.clientY);

    const mm = this.renderer.minimapRect();
    if (sx >= mm.x && sy >= mm.y && sx <= mm.x + mm.size && sy <= mm.y + mm.size) {
      const k = this.world().map.size / mm.size;
      const wx = (sx - mm.x) * k;
      const wy = (sy - mm.y) * k;
      if (e.pointerType === 'mouse' && e.button === 2) {
        this.queue.push({ type: 'moveTo', unitId: this.heroId(), x: wx, y: wy });
      } else {
        this.peek = e.pointerId;
        this.renderer.lookAt(wx, wy);
      }
      return;
    }

    // Dead: the whole field becomes a camera drag surface.
    const me = this.world().unit(this.heroId());
    if (me && !me.alive) {
      this.camDrag = { id: e.pointerId, x: sx, y: sy };
      return;
    }

    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (sx < this.canvas.clientWidth * 0.5 && !this.joy) {
        this.joy = { id: e.pointerId, ox: sx, oy: sy, dx: 0, dy: 0 };
        this.showJoystick(sx, sy, 0, 0);
      } else {
        this.commandAt(sx, sy);
      }
      return;
    }
    if (e.button === 2 || e.button === 0) this.commandAt(sx, sy);
  }

  private onAbilityDown(e: PointerEvent, slot: number) {
    const w = this.world();
    const me = w.unit(this.heroId());
    if (!me || castBlocker(me, slot) !== null) return;
    const { x, y } = toLocal(e.clientX, e.clientY);
    this.drag = { id: e.pointerId, slot, ox: x, oy: y, moved: false };
    // Show the arrow right away, pointing where a quick-cast would go.
    const def = abilityDef(me, slot)!;
    if (def.targeting === 'passive') return;
    const auto = this.autoAim(w, me, def.targeting, def.castRange);
    this.aimToward(auto.x - me.x, auto.y - me.y, 1, false);
  }

  /** Where a quick-cast would aim: nearest visible enemy hero, else nearest enemy, else ahead. */
  private autoAim(w: World, me: Unit, targeting: string, range: number) {
    if (targeting === 'ally') {
      const ally = w.units
        .filter((a) => a.hero && a.alive && a.team === me.team && a !== me && Math.hypot(a.x - me.x, a.y - me.y) <= range)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (ally && ally.hp / ally.maxHp < me.hp / me.maxHp) return { x: ally.x, y: ally.y };
      return { x: me.x, y: me.y }; // heal yourself
    }
    const enemies = w.units.filter(
      (u) => u.alive && u.team !== me.team && u.kind !== 'structure' && w.canSee(me.team, u) && Math.hypot(u.x - me.x, u.y - me.y) <= range + 2,
    );
    const d = (u: Unit) => Math.hypot(u.x - me.x, u.y - me.y);
    const t = enemies.filter((u) => u.kind === 'hero').sort((a, b) => d(a) - d(b))[0] ?? enemies.sort((a, b) => d(a) - d(b))[0];
    if (t) return { x: t.x, y: t.y };
    return { x: me.x + Math.cos(me.facing) * range, y: me.y + Math.sin(me.facing) * range };
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
    const local = toLocal(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') this.mouse = local;
    if (this.peek === e.pointerId) {
      const mm = this.renderer.minimapRect();
      const k = this.world().map.size / mm.size;
      const cx = Math.max(0, Math.min(mm.size, local.x - mm.x));
      const cy = Math.max(0, Math.min(mm.size, local.y - mm.y));
      this.renderer.lookAt(cx * k, cy * k);
      return;
    }
    if (this.camDrag && this.camDrag.id === e.pointerId) {
      this.renderer.pan(local.x - this.camDrag.x, local.y - this.camDrag.y);
      this.camDrag.x = local.x;
      this.camDrag.y = local.y;
      return;
    }
    if (this.joy && e.pointerId === this.joy.id) {
      let dx = local.x - this.joy.ox;
      let dy = local.y - this.joy.oy;
      const max = 55;
      const l = Math.hypot(dx, dy);
      if (l > max) {
        dx = (dx / l) * max;
        dy = (dy / l) * max;
      }
      this.joy.dx = dx / max;
      this.joy.dy = dy / max;
      this.showJoystick(this.joy.ox, this.joy.oy, dx, dy);
      return;
    }
    if (this.drag && e.pointerId === this.drag.id) {
      const dx = local.x - this.drag.ox;
      const dy = local.y - this.drag.oy;
      if (!this.drag.moved && Math.hypot(dx, dy) > TAP_SLOP) {
        this.drag.moved = true;
        this.cancelZone.classList.add('show');
      }
      if (this.drag.moved) this.updateAim(dx, dy, this.overCancel(e));
    }
  }

  private onPointerUp(e: PointerEvent, cancelled = false) {
    if (this.peek === e.pointerId) {
      this.peek = null;
      const me = this.world().unit(this.heroId());
      if (me?.alive) this.renderer.follow();
    }
    if (this.camDrag?.id === e.pointerId) this.camDrag = null;
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null;
      this.joyBase.style.display = 'none';
    }
    if (this.drag && e.pointerId === this.drag.id) {
      const { slot, moved } = this.drag;
      const aim = this.aim;
      this.drag = null;
      this.aim = null;
      this.cancelZone.classList.remove('show');
      if (cancelled) return;
      const id = this.heroId();
      if (!moved && !aim) {
        this.queue.push({ type: 'cast', unitId: id, slot }); // passive / no preview: let the sim decide
      } else if (aim && !aim.cancel) {
        this.queue.push(
          aim.targetId !== undefined
            ? { type: 'cast', unitId: id, slot, targetId: aim.targetId }
            : { type: 'cast', unitId: id, slot, x: aim.x, y: aim.y },
        );
      }
    }
  }

  private overCancel(e: PointerEvent) {
    const r = this.cancelZone.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  /** Map a drag from the ability button to an aimed world point / unit. */
  private updateAim(dx: number, dy: number, cancel: boolean) {
    const t = Math.min(1, Math.hypot(dx, dy) / MAX_DRAG);
    this.aimToward(dx, dy, t, cancel);
  }

  /**
   * Aim in direction (dx, dy) — any direction, including behind the hero.
   * `t` (0..1) scales the distance for ground-targeted abilities.
   */
  private aimToward(dx: number, dy: number, t: number, cancel: boolean) {
    const w = this.world();
    const me = w.unit(this.heroId());
    if (!me || !this.drag) return;
    const def = HEROES[me.hero!.defId].abilities[this.drag.slot];
    const len = Math.hypot(dx, dy);
    const ux = len > 0.001 ? dx / len : Math.cos(me.facing);
    const uy = len > 0.001 ? dy / len : Math.sin(me.facing);
    const reach = def.targeting === 'point' ? def.castRange * Math.max(0.05, Math.min(1, t)) : def.castRange;
    const aim: Aim = { slot: this.drag.slot, x: me.x + ux * reach, y: me.y + uy * reach, cancel };
    if (def.targeting === 'none') {
      aim.x = me.x;
      aim.y = me.y;
    } else if (def.targeting === 'ally' || def.targeting === 'enemy') {
      // The unit closest to the arrow (within a 30° cone) gets it; allies fall back to yourself.
      const cone = Math.cos(Math.PI / 6);
      const cands = w.units.filter(
        (u) =>
          u.alive &&
          u !== me &&
          u.kind !== 'structure' &&
          (def.targeting === 'ally' ? u.team === me.team && !!u.hero : u.team !== me.team && w.canSee(me.team, u)) &&
          Math.hypot(u.x - me.x, u.y - me.y) <= def.castRange + 2,
      );
      let best: Unit | undefined;
      let bestDot = cone;
      for (const u of cands) {
        const d = Math.hypot(u.x - me.x, u.y - me.y) || 1;
        const dot = ((u.x - me.x) * ux + (u.y - me.y) * uy) / d;
        if (dot > bestDot) {
          bestDot = dot;
          best = u;
        }
      }
      if (len < 0.001 && def.targeting === 'ally') best = undefined;
      aim.targetId = best?.id ?? (def.targeting === 'ally' ? me.id : undefined);
    }
    this.aim = aim;
  }

  private pickUnit(w: World, me: Unit, kind: 'enemy' | 'ally', x: number, y: number, r: number): Unit | undefined {
    return w.units
      .filter(
        (u) =>
          u.alive &&
          u.kind !== 'structure' &&
          (kind === 'enemy' ? u.team !== me.team : u.team === me.team && !!u.hero) &&
          Math.hypot(u.x - x, u.y - y) < r + u.radius,
      )
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  }

  private showJoystick(x: number, y: number, kx: number, ky: number) {
    this.joyBase.style.display = 'block';
    this.joyBase.style.left = `${x}px`;
    this.joyBase.style.top = `${y}px`;
    this.joyKnob.style.transform = `translate(${kx}px, ${ky}px)`;
  }
}
