import { Draft, HEROES, HERO_IDS, HeroId, TEAM_NAMES, Team } from '../sim';
import { heroCards, heroPortraits } from './hud';
import { abilityIcon } from './icons';
import { MenuShowcase } from './menu3d';

/**
 * The draft screen shown when a match starts: each team bans a hero, then the teams pick
 * in turns. Tapping a hero card only selects it (its 3D model turns on a pedestal and its
 * abilities are listed); the big button bans or locks it in.
 *
 * Layout (landscape):
 *   header:  Azure name · step tracker (ban, ban, 6 picks) with the phase text · Crimson name
 *   middle:  Azure's three seats + ban | six hero cards over the detail panel | Crimson's seats + ban
 */
export class DraftUi {
  private draft: Draft | null = null;
  private sel: HeroId | null = null;
  private key = '';
  private raf = 0;
  private last = 0;
  private finishAt = 0;
  private onDone: (d: Draft) => void = () => {};
  private showcase: MenuShowcase | null = null;
  private shown: HeroId | null = null;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <header class="dr-head">
        <div class="dr-tname t0">${TEAM_NAMES[0]}</div>
        <div class="dr-mid">
          <div id="draft-phase"></div>
          <div id="draft-steps"></div>
        </div>
        <div class="dr-tname t1">${TEAM_NAMES[1]}</div>
        <div id="draft-timer"><svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="17"/><circle class="fg" cx="20" cy="20" r="17"/></svg><b></b></div>
      </header>
      <div class="dr-main">
        <div class="draft-team t0"><div class="slots"></div><div class="ban"></div></div>
        <div class="dr-center">
          <div id="draft-grid"></div>
          <div id="draft-detail">
            <div class="dr-stage"><canvas id="draft3d"></canvas><div class="dr-glow"></div></div>
            <div class="dr-info"></div>
          </div>
        </div>
        <div class="draft-team t1"><div class="slots"></div><div class="ban"></div></div>
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
    this.shown = null;
    this.root.classList.remove('hidden');
    this.startShowcase();
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
        this.finishAt ||= now + 2200;
        if (now >= this.finishAt) {
          this.stopShowcase();
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
    this.stopShowcase();
    this.root.classList.add('hidden');
    this.draft = null;
  }

  /** The turning 3D hero in the detail panel (its own WebGL context, freed when the draft ends). */
  private startShowcase() {
    try {
      const old = this.root.querySelector<HTMLCanvasElement>('#draft3d')!;
      // A disposed canvas loses its context for good: start from a fresh one each draft.
      const canvas = document.createElement('canvas');
      canvas.id = 'draft3d';
      old.replaceWith(canvas);
      this.showcase = new MenuShowcase(canvas);
      this.showcase.start();
    } catch {
      this.showcase = null; // no WebGL: the panel just shows the card picture
    }
  }

  private stopShowcase() {
    this.showcase?.dispose();
    this.showcase = null;
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

    // Countdown ring (only on your turn).
    const timer = this.root.querySelector<HTMLElement>('#draft-timer')!;
    const total = step?.kind === 'ban' ? 20 : 30;
    timer.classList.toggle('off', !mine);
    timer.classList.toggle('low', mine && d.timeLeft <= 5);
    timer.querySelector('b')!.textContent = mine ? String(Math.ceil(d.timeLeft)) : '';
    (timer.querySelector('.fg') as SVGCircleElement).style.strokeDashoffset = String(106.8 * (1 - Math.max(0, d.timeLeft) / total));

    const key = `${d.step}|${this.sel}|${mine}`;
    if (key === this.key) return;
    this.key = key;
    const human = d.human;

    const phase = this.root.querySelector<HTMLElement>('#draft-phase')!;
    phase.className = step ? `t${step.team}` : 'done';
    phase.textContent = !step
      ? 'Line-ups are set. Get ready!'
      : mine
        ? step.kind === 'ban'
          ? 'Ban a hero: nobody can play it this match'
          : 'Your turn: pick your hero'
        : `${TEAM_NAMES[step.team]} ${step.kind === 'ban' ? 'is banning' : 'is picking'}…`;

    // Step tracker: one marker per ban / pick, in order, coloured by team.
    this.root.querySelector('#draft-steps')!.innerHTML = d.order
      .map((s, i) => {
        const state = i < d.step ? 'past' : i === d.step ? 'now' : '';
        return `<i class="st t${s.team} ${s.kind} ${state}">${s.kind === 'ban' ? '✕' : ''}</i>`;
      })
      .join('');

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
          if (id) {
            const pic = heroCards[id] ?? heroPortraits[id];
            return `<div class="slot done${you ? ' you' : ''}" style="--c:${HEROES[id].color}">${pic ? `<img alt="" src="${pic}">` : ''}<span class="nm"><b>${HEROES[id].name}</b><small>${who}</small></span></div>`;
          }
          return `<div class="slot${i === picking ? ' now' : ''}${you ? ' you' : ''}"><span class="q">?</span><span class="nm"><b>${i === picking ? 'Picking…' : ''}</b><small>${who}</small></span></div>`;
        })
        .join('');
      const ban = banOf(team);
      const banStep = d.order.some((s) => s.kind === 'ban' && s.team === team);
      col.querySelector('.ban')!.innerHTML = !banStep
        ? ''
        : ban === null
          ? `<span class="bx${step?.kind === 'ban' && step.team === team ? ' now' : ''}"></span><small>Ban</small>`
          : ban === 'none'
            ? '<span class="bx"></span><small>No ban</small>'
            : `<span class="bx banned">${this.face(ban)}</span><small>${HEROES[ban].name}</small>`;
    }

    // Hero cards.
    this.root.querySelectorAll<HTMLElement>('.dh').forEach((b) => {
      const id = b.dataset.hero as HeroId;
      const banned = d.isBanned(id);
      const ownTeam = human ? d.picks[human.team].includes(id) : false;
      const enemyHas = human ? d.picks[(1 - human.team) as Team].includes(id) : false;
      b.classList.toggle('banned', banned);
      b.classList.toggle('taken', ownTeam);
      b.classList.toggle('sel', this.sel === id);
      b.classList.toggle('can', mine && d.allowed(id));
      const h = HEROES[id];
      const pic = heroCards[id] ?? heroPortraits[id];
      const tagged = banned || ownTeam || enemyHas;
      b.innerHTML = `${pic ? `<img alt="" src="${pic}">` : ''}${tagged ? '' : `<span class="kind">${h.projectileSpeed ? 'Ranged' : 'Melee'}</span>`}<span class="plate"><b>${h.name}</b><small>${h.role}</small></span>${
        banned ? '<i class="tag ban">BANNED</i>' : ownTeam ? '<i class="tag">YOUR TEAM</i>' : enemyHas ? '<i class="tag foe">ENEMY HAS</i>' : ''
      }`;
    });

    // Detail panel: the 3D hero and its abilities, plus the action button.
    const info = this.root.querySelector<HTMLElement>('#draft-detail .dr-info')!;
    const stage = this.root.querySelector<HTMLElement>('#draft-detail .dr-stage')!;
    const show = this.sel;
    stage.parentElement!.classList.toggle('empty', !show);
    if (show && show !== this.shown) {
      this.showcase?.resize(); // the panel has its real size now
      this.showcase?.show(show);
      this.shown = show;
      stage.style.setProperty('--c', HEROES[show].color);
    }
    if (!show) {
      info.innerHTML = `<p class="hint">${mine ? (step?.kind === 'ban' ? 'Tap a hero to ban it.' : 'Tap a hero to see its abilities.') : step ? 'Wait for your turn. Tap heroes to read about them.' : ''}</p>`;
      return;
    }
    const h = HEROES[show];
    const verb = step?.kind === 'ban' ? 'BAN' : 'LOCK IN';
    info.innerHTML = `
      <div class="dname"><b style="color:${h.color}">${h.name}</b><small>${h.title}</small></div>
      <div class="dtags"><span>${h.role}</span><span>${h.projectileSpeed ? 'Ranged' : 'Melee'}</span></div>
      <div class="dab">${h.abilities
        .map((a) => `<div class="ab">${abilityIcon(a.id)}<div><b>${a.name}${a.ultimate ? ' <em>ULT</em>' : a.targeting === 'passive' ? ' <em class="ps">PASSIVE</em>' : ''}</b><p>${a.summary}</p></div></div>`)
        .join('')}</div>
      <button id="draft-go" class="${step?.kind === 'ban' ? 'ban' : ''}" ${mine && d.allowed(show) ? '' : 'disabled'}>${mine ? `${verb} ${h.name.toUpperCase()}` : 'WAIT FOR YOUR TURN'}</button>`;
    info.querySelector('#draft-go')!.addEventListener('click', () => {
      if (this.draft?.humanTurn() && this.sel) this.draft.choose(this.sel);
      this.sel = null;
      this.key = '';
    });
  }
}
