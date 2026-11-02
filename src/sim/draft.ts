import type { Team } from './constants';
import { HERO_IDS, HeroId } from './data/heroes';

/**
 * Hero draft at the start of a match: each team bans one hero (banned heroes can't be
 * played by anyone), then the teams pick in turns (1-2-2-1). A hero can be on both teams,
 * but only once per team. Bots choose for every seat that isn't a human's.
 */
export interface DraftStep {
  kind: 'ban' | 'pick';
  team: Team;
}

/** Ban, ban, then picks A, B, B, A, A, B. */
export const DRAFT_ORDER: DraftStep[] = [
  { kind: 'ban', team: 0 },
  { kind: 'ban', team: 1 },
  { kind: 'pick', team: 0 },
  { kind: 'pick', team: 1 },
  { kind: 'pick', team: 1 },
  { kind: 'pick', team: 0 },
  { kind: 'pick', team: 0 },
  { kind: 'pick', team: 1 },
];

/** Seconds a human has for a ban or a pick, and how long a bot "thinks". */
export const DRAFT_TIME = { ban: 20, pick: 30, bot: 1.4 };
/** After the draft: this long before the first creeps (heroes can buy and walk to lane). */
export const WARMUP_SECONDS = 30;

export class Draft {
  step = 0;
  /** One entry per ban step (null = no ban: the time ran out). */
  bans: (HeroId | null)[] = [];
  picks: [HeroId[], HeroId[]] = [[], []];
  /** Seconds left in the current turn. */
  timeLeft: number;
  private botWait = DRAFT_TIME.bot;

  constructor(
    /** Which team the human is on, and which of that team's picks (0, 1, 2) is theirs. */
    readonly human: { team: Team; seat: number } | null,
    readonly order: DraftStep[] = DRAFT_ORDER,
    private random: () => number = Math.random,
  ) {
    this.timeLeft = this.turnTime();
  }

  get current(): DraftStep | null {
    return this.order[this.step] ?? null;
  }

  get done() {
    return this.step >= this.order.length;
  }

  /** Is it the human's turn (they ban for their team, and pick in their own seat)? */
  humanTurn(): boolean {
    const s = this.current;
    if (!s || !this.human || s.team !== this.human.team) return false;
    return s.kind === 'ban' || this.picks[s.team].length === this.human.seat;
  }

  isBanned(id: HeroId) {
    return this.bans.includes(id);
  }

  /** Whether `id` can be chosen in the current step. */
  allowed(id: HeroId): boolean {
    const s = this.current;
    if (!s || this.isBanned(id)) return false;
    if (s.kind === 'ban') return !this.picks[0].includes(id) && !this.picks[1].includes(id);
    return !this.picks[s.team].includes(id);
  }

  choices(): HeroId[] {
    return HERO_IDS.filter((id) => this.allowed(id));
  }

  /** Ban or pick `id` for the current step (null skips a ban). */
  choose(id: HeroId | null): boolean {
    const s = this.current;
    if (!s) return false;
    if (id !== null && !this.allowed(id)) return false;
    if (id === null && s.kind === 'pick') return false;
    if (s.kind === 'ban') this.bans.push(id);
    else this.picks[s.team].push(id!);
    this.step++;
    this.timeLeft = this.turnTime();
    this.botWait = DRAFT_TIME.bot;
    return true;
  }

  /** Advance the clock: bots choose after a short pause; a human who runs out of time gets a random pick (or no ban). */
  update(dt: number) {
    if (this.done) return;
    if (!this.humanTurn()) {
      this.botWait -= dt;
      if (this.botWait <= 0) this.choose(this.botChoice());
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) this.choose(this.current!.kind === 'ban' ? null : this.randomChoice());
  }

  private turnTime() {
    return this.current?.kind === 'ban' ? DRAFT_TIME.ban : DRAFT_TIME.pick;
  }

  private randomChoice(): HeroId {
    const c = this.choices();
    return c[Math.floor(this.random() * c.length)];
  }

  /** Bots ban something the other team hasn't taken yet, and pick at random from what's left. */
  private botChoice(): HeroId | null {
    const s = this.current!;
    if (s.kind === 'ban') {
      const c = this.choices();
      return c.length ? c[Math.floor(this.random() * c.length)] : null;
    }
    return this.randomChoice();
  }
}
