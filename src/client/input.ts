import { Command, HEROES, ITEMS, PingKind, Unit, World, abilityDef, canPickUp, castBlocker } from '../sim';
import type { Renderer } from './renderer';
import { toLocal } from './screen';

/** What the player is currently aiming (drawn by the renderer). */
export interface Aim {
  /** Ability slot, or ATTACK_AIM for the attack button's target arrow. */
  slot: number;
  /** Aimed world point. */
  x: number;
  y: number;
  /** Unit that will be targeted (enemy/ally abilities). */
  targetId?: number;
  cancel: boolean;
}

const MAX_DRAG = 90;
/** `Aim.slot` while aiming the Attack button at a target. */
export const ATTACK_AIM = -1;
/** How far the attack arrow reaches (meters): well past attack range, the hero walks over. */
const ATTACK_AIM_REACH = 18;
const TAP_SLOP = 12;

/**
 * Turns touch / mouse / keyboard into simulation Commands.
 *
 * Mobile (primary):
 *  - Left half of the screen: floating virtual joystick.
 *  - Attack button: tap = nearest target; hold = aim with an arrow, the attack happens on release.
 *    Auto attack on: a picked enemy comes first until it dies or leaves range. Off: one attack per
 *    tap or release. Denies are always one attack. Tap an enemy to attack it.
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
  private joy: { id: number; ox: number; oy: number; dx: number; dy: number; at: number; moved: boolean } | null = null;
  private drag: { id: number; slot: number; ox: number; oy: number; moved: boolean } | null = null;
  /** Finger/mouse held on the minimap: camera peeks there until released. */
  private peek: number | null = null;
  /** Settings: joystick on the right half (left-handed), joystick radius in px. */
  leftHanded = false;
  joyRadius = 55;
  /** Long-press info card for an ability (null hides it). */
  onTip: (slot: number | null) => void = () => {};
  private tip: { pointer: number; timer: ReturnType<typeof setTimeout> | null; shown: boolean } | null = null;

  /** A ping waiting to be placed: the next tap on the map or minimap places it. */
  pingKind: PingKind | null = null;
  onPingPlaced: () => void = () => {};

  /** Inventory slot of a ward waiting to be placed: the next tap on the field places it. */
  wardSlot: number | null = null;
  onWardPlaced: () => void = () => {};
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
    public renderer: Renderer,
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
    // Attack: press-and-hold. Works together with the joystick (multi-touch):
    // hold Attack while steering to hit anything in range and keep walking otherwise.
    press(root.querySelector('#btn-attack')!, (e) => this.attackDown(e.pointerId, toLocal(e.clientX, e.clientY)));
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

  private attackPointer: number | null = null;

  /** Attack button held: where it was pressed (for aiming by dragging) and whether it moved. */
  private attackDrag: { ox: number; oy: number; moved: boolean } | null = null;

  private attackDown(pointerId: number, at?: { x: number; y: number }) {
    this.attackPointer = pointerId;
    // Holding only aims: an arrow at the nearest target, drag it to pick another one. The attack
    // happens when the finger lets go.
    if (at) {
      this.attackDrag = { ox: at.x, oy: at.y, moved: false };
      const w = this.world();
      const me = w.unit(this.heroId());
      const t = me && w.nearestAttackTarget(me);
      if (me && t) this.aimAttack(t.x - me.x, t.y - me.y, Math.min(1, Math.hypot(t.x - me.x, t.y - me.y) / ATTACK_AIM_REACH), false);
    }
  }

  /**
   * Point the attack arrow: direction (dx, dy), `t` 0..1 of the full reach. The target is the
   * attackable (or deniable) unit nearest the arrow's tip: enemy heroes, creeps and buildings,
   * your own creeps and towers when low enough to deny.
   */
  private aimAttack(dx: number, dy: number, t: number, cancel: boolean) {
    const w = this.world();
    const me = w.unit(this.heroId());
    if (!me) return;
    const len = Math.hypot(dx, dy);
    const ux = len > 0.001 ? dx / len : Math.cos(me.facing);
    const uy = len > 0.001 ? dy / len : Math.sin(me.facing);
    const reach = Math.max(1.5, ATTACK_AIM_REACH * Math.min(1, t));
    const tip = { x: me.x + ux * reach, y: me.y + uy * reach };
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const u of w.units) {
      if (u === me || u.ward || !u.alive) continue;
      if (!((w.canAttack(me, u) && w.canSee(me.team, u)) || w.canDeny(me, u))) continue;
      const d = Math.hypot(u.x - tip.x, u.y - tip.y) - u.radius;
      if (d < bestD && d < 4.5) {
        bestD = d;
        best = u;
      }
    }
    this.aim = { slot: ATTACK_AIM, x: tip.x, y: tip.y, targetId: best?.id, cancel };
  }

  private attackUp(cancelled = false) {
    this.attackPointer = null;
    const aim = this.aim?.slot === ATTACK_AIM ? this.aim : null;
    const moved = !!this.attackDrag?.moved;
    this.aim = null;
    this.attackDrag = null;
    this.cancelZone.classList.remove('show');
    if (cancelled || aim?.cancel) return;
    const w = this.world();
    const me = w.unit(this.heroId());
    if (!me?.hero) return;
    // Pointed at someone with the arrow: them. A plain tap: the nearest target.
    let target = aim?.targetId !== undefined ? w.unit(aim.targetId) : undefined;
    if (!target && !moved) target = w.nearestAttackTarget(me);
    if (!target) {
      // Nothing to aim at yet: let the game pick the nearest when the swing is ready.
      if (!moved && !me.hero.autoAttack) this.queue.push({ type: 'attackOnce', unitId: me.id });
      return;
    }
    // Auto attack on: an enemy you pick comes first until it dies or leaves your range. Denies, and
    // everything with auto attack off, are one attack per tap or release.
    if (me.hero.autoAttack && target.team !== me.team) this.queue.push({ type: 'attack', unitId: me.id, targetId: target.id, priority: true });
    else this.queue.push({ type: 'attackOnce', unitId: me.id, targetId: target.id });
  }

  /** Joystick radius in px (settings: S / M / L). */
  setJoystickSize(radius: number) {
    this.joyRadius = radius;
    const size = radius * 2 + 10;
    this.joyBase.style.width = this.joyBase.style.height = `${size}px`;
    this.joyBase.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
    const knob = Math.round(radius * 0.9);
    this.joyKnob.style.width = this.joyKnob.style.height = `${knob}px`;
    this.joyKnob.style.left = this.joyKnob.style.top = `${(size - knob) / 2 - 2}px`;
  }

  /** Show the joystick for a moment beside the settings, so a new size can be seen straight away. */
  previewJoystick() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.joyBase.style.zIndex = '40';
    this.showJoystick(this.canvas.clientWidth * 0.14, this.canvas.clientHeight * 0.5, 0, 0);
    this.previewTimer = setTimeout(() => {
      this.joyBase.style.zIndex = '';
      if (!this.joy) this.joyBase.style.display = 'none';
    }, 1600);
  }
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  private hideTip() {
    if (!this.tip) return;
    if (this.tip.timer) clearTimeout(this.tip.timer);
    if (this.tip.shown) this.onTip(null);
    this.tip = null;
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
    // Teleporting: the hero is frozen. Once it's over, a held stick starts walking straight away.
    if (w.unit(id)?.hero?.channel) {
      this.lastDir = { dx: 0, dy: 0 };
      for (const c of this.queue) w.enqueue(c);
      this.queue.length = 0;
      return;
    }
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
        this.attackDown(-1);
        return;
      }
      if (k === 'h') this.queue.push({ type: 'stop', unitId: this.heroId() });
    }
    if (!down && k === ' ') this.attackUp();
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
    const onMinimap = sx >= mm.x && sy >= mm.y && sx <= mm.x + mm.size && sy <= mm.y + mm.size;
    // Placing a ping: this tap (on the map or the minimap) chooses where.
    if (this.pingKind) {
      const k = this.world().map.size / mm.size;
      const p = onMinimap ? { x: (sx - mm.x) * k, y: (sy - mm.y) * k } : this.renderer.screenToWorld(sx, sy);
      this.queue.push({ type: 'ping', unitId: this.heroId(), kind: this.pingKind, x: p.x, y: p.y });
      this.pingKind = null;
      this.onPingPlaced();
      return;
    }
    if (onMinimap) {
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

    // Placing a ward: this tap chooses the spot (the hero walks into range if needed).
    if (this.wardSlot !== null) {
      const p = this.renderer.screenToWorld(sx, sy);
      const item = this.world().unit(this.heroId())?.hero?.items[this.wardSlot];
      const aimed = item && ITEMS[item.id].active?.kind;
      if (aimed === 'blink' || aimed === 'mire') {
        this.queue.push({ type: 'useItem', unitId: this.heroId(), slot: this.wardSlot, x: p.x, y: p.y });
      } else {
        this.queue.push({ type: 'placeWard', unitId: this.heroId(), slot: this.wardSlot, x: p.x, y: p.y });
      }
      this.wardSlot = null;
      this.renderer.wardMode = null;
      this.onWardPlaced();
      return;
    }

    // Dead: the whole field becomes a camera drag surface.
    const me = this.world().unit(this.heroId());
    if (me && !me.alive) {
      this.camDrag = { id: e.pointerId, x: sx, y: sy };
      return;
    }

    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      // Looking around with the minimap: the joystick is off and taps on the map are orders
      // (walk there / attack that). Letting go of the minimap brings the joystick back.
      if (this.peek !== null) {
        this.commandAt(sx, sy, true);
        return;
      }
      const onJoySide = this.leftHanded ? sx > this.canvas.clientWidth * 0.5 : sx < this.canvas.clientWidth * 0.5;
      // A tap right on a dropped item picks it up, even on the joystick side.
      const item = me ? this.groundItemAt(this.world(), me, sx, sy, Math.max(26, 1.1 * this.renderer.zoom)) : undefined;
      if (item && me) {
        this.queue.push({ type: 'pickUp', unitId: me.id, groundId: item.id });
        return;
      }
      if (onJoySide && !this.joy) {
        this.joy = { id: e.pointerId, ox: sx, oy: sy, dx: 0, dy: 0, at: performance.now(), moved: false };
        this.showJoystick(sx, sy, 0, 0);
      } else {
        this.commandAt(sx, sy);
      }
      return;
    }
    if (e.button === 2 || e.button === 0) this.commandAt(sx, sy, true);
  }

  private onAbilityDown(e: PointerEvent, slot: number) {
    const w = this.world();
    const me = w.unit(this.heroId());
    if (!me) return;
    // Long-press (without dragging) shows the ability's info card instead of casting.
    // Passive / not-yet-learned abilities show it straight away.
    const blocked = castBlocker(me, slot);
    this.hideTip();
    if (blocked === 'passive' || blocked === 'unlearned') {
      this.tip = { pointer: e.pointerId, timer: null, shown: true };
      this.onTip(slot);
      return;
    }
    this.tip = {
      pointer: e.pointerId,
      timer: setTimeout(() => {
        if (this.tip && (!this.drag || !this.drag.moved)) {
          this.tip.shown = true;
          this.aim = null;
          this.onTip(slot);
        }
      }, 450),
      shown: false,
    };
    if (blocked !== null) return;
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

  /**
   * Tap/click on an enemy = attack it. Tapping the ground only walks there when that's
   * clearly meant: while looking around with the minimap, or with a mouse (right/left click).
   * On a touch screen the joystick moves the hero, so stray taps don't send it walking.
   */
  /** A dropped item you may take (yours, or an ally's ward) under the finger. */
  private groundItemAt(w: World, me: Unit, sx: number, sy: number, reach: number) {
    const tapDist = (g: { x: number; y: number }) => {
      const s = this.renderer.screenOf(g.x, g.y, 0);
      return Math.hypot(s.x - sx, s.y - sy);
    };
    return w.groundItems.filter((g) => canPickUp(me, g) && tapDist(g) < reach).sort((a, b) => tapDist(a) - tapDist(b))[0];
  }

  private commandAt(sx: number, sy: number, walk = false) {
    const w = this.world();
    const me = w.unit(this.heroId());
    if (!me) return;
    // Pick by what's under the finger on screen (3D models stand up off the ground).
    const near = (u: Unit) => {
      const s = this.renderer.screenOf(u.x, u.y, u.kind === 'structure' ? 2.5 : 1.2);
      return Math.hypot(s.x - sx, s.y - sy);
    };
    const reach = (u: Unit) => Math.max(34, (u.radius + 0.8) * this.renderer.zoom);
    const enemy = w.units
      .filter((u) => u.alive && w.canAttack(me, u) && near(u) < reach(u))
      .sort((a, b) => near(a) - near(b))[0];
    const item = this.groundItemAt(w, me, sx, sy, Math.max(34, 1.3 * this.renderer.zoom));
    if (enemy) this.queue.push(me.hero?.autoAttack ? { type: 'attack', unitId: me.id, targetId: enemy.id } : { type: 'attackOnce', unitId: me.id, targetId: enemy.id });
    else if (item) this.queue.push({ type: 'pickUp', unitId: me.id, groundId: item.id });
    else if (walk) {
      const p = this.renderer.screenToWorld(sx, sy);
      this.queue.push({ type: 'moveTo', unitId: me.id, x: p.x, y: p.y });
    }
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
    if (this.attackDrag && e.pointerId === this.attackPointer) {
      const dx = local.x - this.attackDrag.ox;
      const dy = local.y - this.attackDrag.oy;
      if (!this.attackDrag.moved && Math.hypot(dx, dy) > TAP_SLOP) {
        this.attackDrag.moved = true;
        this.cancelZone.classList.add('show');
      }
      if (this.attackDrag.moved) this.aimAttack(dx, dy, Math.hypot(dx, dy) / (MAX_DRAG * 1.4), this.overCancel(e));
      return;
    }
    if (this.joy && e.pointerId === this.joy.id) {
      let dx = local.x - this.joy.ox;
      let dy = local.y - this.joy.oy;
      const max = this.joyRadius;
      const l = Math.hypot(dx, dy);
      if (l > 10) this.joy.moved = true;
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
        this.hideTip(); // dragging means aiming, not reading
      }
      if (this.drag.moved) this.updateAim(dx, dy, this.overCancel(e));
    }
  }

  private onPointerUp(e: PointerEvent, cancelled = false) {
    if (this.attackPointer === e.pointerId) this.attackUp(cancelled);
    if (this.peek === e.pointerId) {
      this.peek = null;
      const me = this.world().unit(this.heroId());
      if (me?.alive) this.renderer.follow();
    }
    if (this.camDrag?.id === e.pointerId) this.camDrag = null;
    if (this.joy && e.pointerId === this.joy.id) {
      // A quick tap (no drag) on the joystick side is a tap-to-move / tap-to-attack.
      const tap = !this.joy.moved && performance.now() - this.joy.at < 260;
      const { ox, oy } = this.joy;
      this.joy = null;
      this.joyBase.style.display = 'none';
      if (tap && !cancelled) this.commandAt(ox, oy);
    }
    let tipWasShown = false;
    if (this.tip && this.tip.pointer === e.pointerId) {
      tipWasShown = this.tip.shown;
      this.hideTip();
    }
    if (this.drag && e.pointerId === this.drag.id) {
      const { slot, moved } = this.drag;
      if (tipWasShown && !moved) {
        // It was a long-press to read the info card: don't cast.
        this.drag = null;
        this.aim = null;
        this.cancelZone.classList.remove('show');
        return;
      }
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
