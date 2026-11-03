import type { GameEvent, Unit, World } from '../sim';

/**
 * Screen-edge feedback for your own hero (drawn over the game, under the HUD):
 *  - red edges that flash when you take damage (stronger for bigger hits),
 *  - a slow red heartbeat pulse while your health is below 25%,
 *  - a golden flash when you kill an enemy hero,
 *  - a bright gold flash on level-up (the glow around your hero is in the 3D view).
 * Only you see any of this.
 */
export class ScreenFx {
  private el: HTMLDivElement;
  private hurt: HTMLDivElement;
  private low: HTMLDivElement;
  private gold: HTMLDivElement;
  private hurtLevel = 0;
  private goldLevel = 0;
  private last = performance.now();

  /** Placed right after the game canvas, so the HUD (later in the page) stays on top. */
  constructor(canvas: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'screen-fx';
    this.hurt = this.layer('hurt');
    this.low = this.layer('low');
    this.gold = this.layer('gold');
    canvas.after(this.el);
  }

  private layer(cls: string) {
    const d = document.createElement('div');
    d.className = cls;
    this.el.appendChild(d);
    return d;
  }

  onEvents(w: World, events: GameEvent[], meId: number) {
    const me = w.unit(meId);
    if (!me) return;
    for (const e of events) {
      if (e.type === 'damage' && e.targetId === meId && e.amount > 0) {
        // A hit of 10% of your health is a clear flash; tiny creep hits barely tint the edges.
        const k = Math.min(1, 0.25 + (e.amount / me.maxHp) * 6);
        this.hurtLevel = Math.max(this.hurtLevel, k);
      } else if (e.type === 'death' && e.killerId === meId && w.unit(e.unitId)?.hero && w.unit(e.unitId)!.team !== me.team) {
        this.goldLevel = 1;
      } else if (e.type === 'levelUp' && e.unitId === meId) {
        this.goldLevel = Math.max(this.goldLevel, 0.6);
      } else if (e.type === 'death' && e.unitId === meId) {
        this.hurtLevel = 1;
      }
    }
  }

  frame(me: Unit | undefined) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 2.2);
    this.goldLevel = Math.max(0, this.goldLevel - dt * 1.4);
    this.hurt.style.opacity = this.hurtLevel.toFixed(3);
    this.gold.style.opacity = this.goldLevel.toFixed(3);
    const lowHp = !!me && me.alive && me.hp < me.maxHp * 0.25;
    this.low.classList.toggle('on', lowHp);
  }

  clear() {
    this.hurtLevel = this.goldLevel = 0;
    this.low.classList.remove('on');
  }
}
