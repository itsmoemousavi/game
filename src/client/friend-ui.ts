import { TEAM_NAMES } from '../sim';
import type { BotDifficulty } from '../sim';
import type { HostSession, LobbyState, Session } from '../net/session';
import { botName, esc } from './player-names';

const LANES = ['Top', 'Mid', 'Bot'];

/** Play with Friend: choose Local or Online, host or join, then the lobby. */
export class FriendUi {
  onHost: () => void = () => {};
  onJoin: (code: string) => void = () => {};
  onRejoin: () => void = () => {};
  /** Tapped Change next to their name. */
  onProfile: () => void = () => {};
  onBack: () => void = () => {};
  onStart: () => void = () => {};
  onLeaveLobby: () => void = () => {};
  private session: Session | null = null;
  private clock: HTMLElement;
  private clockTimer = 0;

  constructor(
    private menu: HTMLElement,
    private friend: HTMLElement,
    private lobby: HTMLElement,
  ) {
    friend.innerHTML = `
      <div class="fr-title">Play with Friend</div>
      <div class="fr-name"><span>Playing as <b id="fr-name"></b></span><button id="fr-profile" class="textlink">Change</button></div>
      <div class="fr-cards">
        <div class="fr-card">
          <h3>Local</h3>
          <p>One player hosts, friends join with the code. Bots fill empty seats.</p>
          <button id="fr-host" class="primary">Host a game</button>
          <div class="fr-join"><input id="fr-code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="CODE" /><button id="fr-join">Join</button></div>
        </div>
        <div class="fr-card locked">
          <h3>Online</h3>
          <p>Invite up to 2 friends and find a match against other players. No bots.</p>
          <button id="fr-online" class="locked">Find Match<small>Coming soon</small></button>
        </div>
      </div>
      <button id="fr-rejoin" class="hidden">Rejoin your last match</button>
      <div id="fr-error"></div>
      <button id="fr-back" class="textlink">Back</button>`;
    lobby.innerHTML = `
      <div class="lb-head"><div><small>Game code</small><b id="lb-code"></b></div><p>Friends open the game, tap Play with Friend, and enter this code.</p></div>
      <div class="lb-teams"><div class="lb-team t0" data-team="0"></div><div class="lb-team t1" data-team="1"></div></div>
      <div class="lb-foot">
        <div class="lb-diff"><span>Bots</span><div id="lb-diff" class="seg"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></div></div>
        <span id="lb-wait">Waiting for the host to start</span>
        <button id="lb-leave">Leave</button>
        <button id="lb-start" class="primary">Start</button>
      </div>`;
    this.clock = document.createElement('div');
    this.clock.id = 'countdown';
    this.clock.className = 'hidden';
    const marks = Array.from({ length: 12 }, (_, i) => `<line x1="50" y1="${i % 4 === 0 ? 7 : 6}" x2="50" y2="${i % 4 === 0 ? 15 : 11}" class="${i % 4 === 0 ? 'big' : ''}" transform="rotate(${i * 30} 50 50)"/>`).join('');
    this.clock.innerHTML = `<small>Match starting</small><div class="cd-clock"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/>${marks}<line class="cd-hand" x1="50" y1="56" x2="50" y2="12"/></svg><b></b></div>`;
    lobby.parentElement!.appendChild(this.clock);
    const on = (root: HTMLElement, sel: string, f: () => void) => root.querySelector<HTMLElement>(sel)!.addEventListener('click', f);
    on(friend, '#fr-host', () => this.onHost());
    on(friend, '#fr-join', () => {
      const code = friend.querySelector<HTMLInputElement>('#fr-code')!.value.trim().toUpperCase();
      if (code.length !== 4) this.error('Enter the 4 letter code');
      else this.onJoin(code);
    });
    on(friend, '#fr-rejoin', () => this.onRejoin());
    on(friend, '#fr-profile', () => this.onProfile());
    on(friend, '#fr-back', () => this.onBack());
    on(friend, '#fr-online', () => {
      const b = friend.querySelector<HTMLElement>('#fr-online small')!;
      b.textContent = 'Not ready yet';
      setTimeout(() => (b.textContent = 'Coming soon'), 1500);
    });
    on(lobby, '#lb-start', () => this.onStart());
    on(lobby, '#lb-leave', () => this.onLeaveLobby());
    lobby.querySelectorAll<HTMLElement>('#lb-diff button').forEach((b) =>
      b.addEventListener('click', () => (this.session as HostSession | null)?.setDifficulty?.(b.dataset.v as BotDifficulty)),
    );
    lobby.addEventListener('click', (e) => {
      const seat = (e.target as HTMLElement).closest<HTMLElement>('[data-seat]');
      if (seat) this.session?.sit(Number(seat.dataset.seat));
    });
  }

  /** Show the Local / Online choice. */
  showFriend(canRejoin: boolean, name: string) {
    this.showName(name);
    this.menu.classList.add('hidden');
    this.lobby.classList.add('hidden');
    this.friend.classList.remove('hidden');
    this.friend.querySelector('#fr-rejoin')!.classList.toggle('hidden', !canRejoin);
    this.error('');
  }
  /** Their name changed. */
  showName(name: string) {
    this.friend.querySelector('#fr-name')!.textContent = name;
  }
  showMenu() {
    this.friend.classList.add('hidden');
    this.lobby.classList.add('hidden');
    this.menu.classList.remove('hidden');
    this.session = null;
  }
  showLobby(session: Session) {
    this.session = session;
    this.menu.classList.add('hidden');
    this.friend.classList.add('hidden');
    this.lobby.classList.remove('hidden');
    this.renderLobby(session.state);
  }
  error(text: string) {
    this.friend.querySelector('#fr-error')!.textContent = text;
  }
  busy(on: boolean) {
    this.friend.querySelectorAll('button').forEach((b) => (b.disabled = on));
    if (on) this.error('Connecting…');
  }

  renderLobby(s: LobbyState) {
    const me = this.session!;
    this.lobby.querySelector('#lb-code')!.textContent = s.code;
    this.lobby.querySelectorAll<HTMLElement>('.lb-team').forEach((el) => {
      const team = Number(el.dataset.team);
      el.innerHTML =
        `<h4>${TEAM_NAMES[team as 0 | 1]}</h4>` +
        LANES.map((lane, i) => {
          const seat = team * 3 + i;
          const id = s.seats[seat];
          const player = s.players.find((p) => p.id === id);
          const label = player ? esc(player.name) + (id === me.myId ? ' (you)' : '') : botName(seat);
          return `<button class="lb-seat ${player ? 'taken' : ''} ${id === me.myId ? 'me' : ''}" data-seat="${seat}"><small>${lane}</small><span>${label}</span></button>`;
        }).join('');
    });
    this.lobby.querySelector('#lb-start')!.classList.toggle('hidden', !me.isHost);
    this.lobby.querySelector('#lb-wait')!.classList.toggle('hidden', me.isHost);
    const diff = this.lobby.querySelector<HTMLElement>('.lb-diff')!;
    diff.classList.toggle('readonly', !me.isHost);
    diff.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('picked', b.dataset.v === s.difficulty));
  }

  /** A clock counting down, with `onTick` on each second it shows. It waits at 1 for `hideCountdown`. */
  showCountdown(seconds: number, onTick: (left: number) => void) {
    this.hideCountdown();
    this.clock.classList.remove('hidden');
    const hand = this.clock.querySelector<SVGElement>('.cd-hand')!;
    const num = this.clock.querySelector<HTMLElement>('b')!;
    let left = seconds;
    const tick = () => {
      num.textContent = String(left);
      // Restart the number's little jump.
      num.classList.remove('go');
      void num.offsetWidth;
      num.classList.add('go');
      hand.style.transform = `rotate(${((seconds - left) * 360) / seconds}deg)`;
      onTick(left);
      if (--left < 1) clearInterval(this.clockTimer);
    };
    tick();
    this.clockTimer = window.setInterval(tick, 1000);
  }
  hideCountdown() {
    clearInterval(this.clockTimer);
    this.clock.classList.add('hidden');
  }

  hideAll() {
    this.friend.classList.add('hidden');
    this.lobby.classList.add('hidden');
  }
}
