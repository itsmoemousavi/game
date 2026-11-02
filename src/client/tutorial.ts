import { CREEPS, Team, Unit, World } from '../sim';

/** Spawn a stationary training dummy for the enemy team (doesn't fight back, gives no gold). */
export function spawnDummy(w: World, x: number, y: number, team: Team = 1): Unit {
  const d = w.spawnUnit('creep', team, { x, y }, { ...CREEPS.melee, hp: 1200, damage: 0, acquireRange: 0, bountyGold: 0, bountyXp: 20 });
  d.creep = { type: 'melee', lane: 'mid', path: [{ x, y }], wp: 1, super: false };
  d.visionDay = d.visionNight = 0;
  return d;
}

interface Step {
  text: string;
  /** World point to highlight (optional). */
  marker?: (w: World, me: Unit) => { x: number; y: number } | null;
  /** Called once when the step starts. */
  enter?: (w: World, me: Unit, t: Tutorial) => void;
  done: (w: World, me: Unit, t: Tutorial) => boolean;
}

/**
 * Guided first match: a handful of short steps with a marker on the map. Each step
 * completes as soon as the player has done the thing; "Skip" ends the tutorial.
 */
export class Tutorial {
  private i = 0;
  private started = false;
  dummyId: number | null = null;
  peeked = false;
  spellHit = false;
  private steps: Step[];

  constructor(
    private box: HTMLElement,
    private onFinish: () => void,
  ) {
    const exit = (w: World) => {
      const lane = w.map.lanes.mid;
      return { x: lane[0].x + 10, y: lane[0].y - 10 };
    };
    this.steps = [
      {
        text: 'Drag on the left side of the screen to move (the joystick). Walk to the glowing marker.',
        marker: (w) => exit(w),
        done: (w, me) => {
          const p = exit(w);
          return Math.hypot(me.x - p.x, me.y - p.y) < 4;
        },
      },
      {
        text: 'Tap the yellow + next to Q to learn your first ability.',
        done: (_w, me) => me.hero!.abilities[0].level > 0,
      },
      {
        text: 'Hold Q, drag toward the training dummy to aim, and let go to cast. (A quick tap aims at it for you.)',
        enter: (w, me, t) => {
          const d = spawnDummy(w, me.x + 6, me.y - 4);
          t.dummyId = d.id;
          me.mana = me.maxMana;
        },
        marker: (w, _me) => w.unit(this.dummyId) ?? null,
        done: (_w, _me, t) => t.spellHit,
      },
      {
        text: 'Now hold the Attack button until the dummy falls. You can keep steering with the joystick while you hold it.',
        marker: (w) => w.unit(this.dummyId) ?? null,
        done: (w) => !w.unit(this.dummyId)?.alive,
      },
      {
        text: 'Head back to your base and open the shop 🛒. Tap the Healing Salve, then tap BUY.',
        marker: (w) => w.map.fountains[0],
        done: (_w, me) => me.hero!.items.some((s) => s?.id === 'healingSalve'),
      },
      {
        text: 'Hold your finger on the minimap (top left) to look around the map, then let go to return to your hero.',
        done: (_w, _me, t) => t.peeked,
      },
      {
        text: 'Creeps give gold only if you land the killing blow (a "last hit"). A white frame on a creep means your next hit kills it. Get 2 last hits in a lane.',
        done: (_w, me) => me.hero!.lastHits >= 2,
      },
      {
        text: 'You’re ready! Destroy towers, break a barracks, then the two shrine towers and the enemy Shrine to win. Keep practicing here, or go back and play against bots.',
        done: () => false,
      },
    ];
  }

  get marker(): ((w: World, me: Unit) => { x: number; y: number } | null) | undefined {
    return this.steps[this.i]?.marker;
  }

  update(w: World, me: Unit) {
    const step = this.steps[this.i];
    if (!step) return;
    if (!this.started) {
      this.started = true;
      step.enter?.(w, me, this);
      this.render();
    }
    // Spell damage from me to the dummy completes the "cast" step.
    for (const e of w.events) if (e.type === 'damage' && e.sourceId === me.id && e.targetId === this.dummyId) this.spellHit = true;
    if (step.done(w, me, this)) {
      this.i++;
      this.started = false;
    }
  }

  private render() {
    const step = this.steps[this.i];
    const last = this.i === this.steps.length - 1;
    this.box.innerHTML = `<div class="tut-step">Step ${Math.min(this.i + 1, this.steps.length)} / ${this.steps.length}</div><p>${step.text}</p><button id="tut-skip">${last ? 'Finish' : 'Skip tutorial'}</button>`;
    this.box.classList.remove('hidden');
    this.box.querySelector('#tut-skip')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.box.classList.add('hidden');
      this.onFinish();
    });
  }

  hide() {
    this.box.classList.add('hidden');
  }
}
