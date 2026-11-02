import { Draft, HEROES, HERO_IDS, HeroId, TEAM_NAMES, Team } from '../sim';
import { heroPortraits } from './hud';
import { abilityIcon } from './icons';

/**
 * The draft screen shown when a match starts: each team bans a hero, then the teams pick
 * in turns. Tapping a hero only selects it; the big button bans or locks it in.
 */
export class DraftUi {
  private draft: Draft | null = null;
  private sel: HeroId | null = null;
  private key = '';
  private raf = 0;
  private last = 0;
  private finishAt = 0;
  private onDone: (d: Draft) => void = () => {};

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <header class="draft-head"><div id="draft-phase"></div><div id="draft-timer"></div></header>
      <div class="draft-main">
        <div class="draft-team t0"><h3>${TEAM_NAMES[0]}</h3><div class="slots"></div><div class="ban"></div></div>
        <div class="draft-center"><div id="draft-grid"></div><div id="draft-detail"></div></div>
        <div class="draft-team t1"><h3>${TEAM_NAMES[1]}</h3><div class="slots"></div><div class="ban"></div></div>
      </div>`;
    const grid = root.querySelector('#draft-grid')!;
    for (const id of HERO_IDS) {
      const b = document.createElement('button');
      b.className = 'dh';
      b.dataset.hero = id;
      b.style.setProperty('--c', HEROES[id].color);
      b.addEventListener('click', () => {
        this.sel = id;
        this.key = '';
      });
      grid.appendChild(b);
    }
  }

  start(draft: Draft, onDone: (d: Draft) => void) {
    this.draft = draft;
    this.onDone = onDone;
    this.sel = null;
    this.key = '';
    this.finishAt = 0;
    this.root.classList.remove('hidden');
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      const d = this.draft!;
      d.update(dt);
      this.render();
      if (d.done) {
        // A moment to look at both line-ups before the match starts.
        this.finishAt ||= now + 1800;
        if (now >= this.finishAt) {
          this.root.classList.add('hidden');
          this.onDone(d);
          return;
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.root.classList.add('hidden');
    this.draft = null;
  }

  private face(id: HeroId) {
    const pic = heroPortraits[id];
    return pic ? `<img alt="" src="${pic}">` : HEROES[id].name[0];
  }

  private render() {
    const d = this.draft!;
    const step = d.current;
    const mine = d.humanTurn();
    // On your turn, drop a selection that can't be chosen any more (while waiting you can still read about any hero).
    if (this.sel && mine && !d.allowed(this.sel)) this.sel = null;
    const timer = this.root.querySelector<HTMLElement>('#draft-timer')!;
    timer.textContent = mine ? String(Math.ceil(d.timeLeft)) : '';
    timer.classList.toggle('low', mine && d.timeLeft <= 5);

    const key = `${d.step}|${this.sel}|${mine}`;
    if (key === this.key) return;
    this.key = key;
    const human = d.human;

    const phase = this.root.querySelector<HTMLElement>('#draft-phase')!;
    phase.className = step ? `t${step.team}` : '';
    phase.textContent = !step
      ? 'Line-ups are set. Get ready!'
      : mine
        ? step.kind === 'ban'
          ? 'Ban a hero: nobody can play it this match'
          : 'Your turn: pick your hero'
        : `${TEAM_NAMES[step.team]} ${step.kind === 'ban' ? 'is banning' : 'is picking'}…`;

    // Team columns.
    const banOf = (team: Team) => {
      const i = d.order.filter((s) => s.kind === 'ban').findIndex((s) => s.team === team);
      return i >= 0 && i < d.bans.length ? (d.bans[i] ?? 'none') : null;
    };
    for (const team of [0, 1] as Team[]) {
      const col = this.root.querySelector<HTMLElement>(`.draft-team.t${team}`)!;
      const picking = step?.kind === 'pick' && step.team === team ? d.picks[team].length : -1;
      col.querySelector('.slots')!.innerHTML = [0, 1, 2]
        .map((i) => {
          const id = d.picks[team][i];
          const you = human?.team === team && human.seat === i;
          const who = you ? 'You' : 'Bot';
          if (id) return `<div class="slot done" style="--c:${HEROES[id].color}"><span class="pf">${this.face(id)}</span><span><b>${HEROES[id].name}</b><small>${who}</small></span></div>`;
          return `<div class="slot${i === picking ? ' now' : ''}${you ? ' you' : ''}"><span class="pf">?</span><span><b>${i === picking ? 'Picking…' : '—'}</b><small>${who}</small></span></div>`;
        })
        .join('');
      const ban = banOf(team);
      const banStep = d.order.some((s) => s.kind === 'ban' && s.team === team);
      col.querySelector('.ban')!.innerHTML = !banStep
        ? ''
        : ban === null
          ? '<small>Ban</small><span class="bx">…</span>'
          : ban === 'none'
            ? '<small>Ban</small><span class="bx">none</span>'
            : `<small>Ban</small><span class="bx banned">${this.face(ban)}</span>${HEROES[ban].name}`;
    }

    // Hero grid.
    this.root.querySelectorAll<HTMLElement>('.dh').forEach((b) => {
      const id = b.dataset.hero as HeroId;
      const banned = d.isBanned(id);
      const ownTeam = human ? d.picks[human.team].includes(id) : false;
      const enemyHas = human ? d.picks[(1 - human.team) as Team].includes(id) : false;
      b.classList.toggle('banned', banned);
      b.classList.toggle('taken', ownTeam);
      b.classList.toggle('sel', this.sel === id);
      b.classList.toggle('can', mine && d.allowed(id));
      b.innerHTML = `<span class="pf">${this.face(id)}</span><b>${HEROES[id].name}</b><small>${HEROES[id].role}</small>${
        banned ? '<i class="tag ban">BANNED</i>' : ownTeam ? '<i class="tag">YOUR TEAM</i>' : enemyHas ? '<i class="tag foe">ENEMY HAS</i>' : ''
      }`;
    });

    // Detail + action button.
    const det = this.root.querySelector<HTMLElement>('#draft-detail')!;
    const show = this.sel;
    if (!show) {
      det.innerHTML = `<p class="hint">${mine ? 'Tap a hero to see its abilities.' : step ? 'Wait for your turn. Tap heroes to read about them.' : ''}</p>`;
      return;
    }
    const h = HEROES[show];
    const verb = step?.kind === 'ban' ? 'BAN' : 'LOCK IN';
    det.innerHTML = `
      <div class="dinfo"><b style="color:${h.color}">${h.name}</b> <small>${h.title} · ${h.projectileSpeed ? 'ranged' : 'melee'}</small></div>
      <div class="dab">${h.abilities.map((a) => `<span>${abilityIcon(a.id)}<small>${a.name}${a.ultimate ? ' <em>ULT</em>' : ''}</small><p>${a.summary}</p></span>`).join('')}</div>
      <button id="draft-go" class="${step?.kind === 'ban' ? 'ban' : ''}" ${mine && d.allowed(show) ? '' : 'disabled'}>${verb} ${h.name.toUpperCase()}</button>`;
    det.querySelector('#draft-go')!.addEventListener('click', () => {
      if (this.draft?.humanTurn() && this.sel) this.draft.choose(this.sel);
      this.sel = null;
      this.key = '';
    });
  }
}
