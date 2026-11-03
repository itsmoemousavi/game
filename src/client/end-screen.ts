import { HEROES, TEAM_NAMES, Team, Unit, World } from '../sim';
import { heroCards, heroPortraits } from './hud';
import { itemIcon } from './icons';

/** One sample of the match every few seconds: each team's total gold earned and experience. */
interface Sample {
  t: number;
  gold: [number, number];
  xp: [number, number];
}

const SAMPLE_EVERY = 10;
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const n = (v: number) => Math.round(v).toLocaleString();

/**
 * End-of-match screen: Victory / Defeat, the match MVP, and three tabs:
 *  - Scoreboard: both teams, K/D/A, last hits, gold, items,
 *  - Gold & XP: who was ahead over time (a lead line; above the middle = Azure ahead),
 *  - Damage: hero damage per hero (with building damage and healing beside it).
 * Buttons: play again with the same heroes, or back to the menu.
 */
export class EndScreen {
  private el: HTMLDivElement;
  private samples: Sample[] = [];
  private next = 0;
  private tab: 'score' | 'graph' | 'dmg' = 'score';
  private metric: 'gold' | 'xp' = 'gold';
  private world: World | null = null;
  private myTeam: Team = 0;
  private meId = -1;

  constructor(parent: HTMLElement, onAgain: () => void, onMenu: () => void) {
    this.el = document.createElement('div');
    this.el.id = 'endscreen';
    this.el.className = 'hidden';
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      const act = t.dataset.act!;
      if (act === 'again') {
        this.hide();
        onAgain();
      } else if (act === 'menu') {
        this.hide();
        onMenu();
      } else if (act === 'score' || act === 'graph' || act === 'dmg') {
        this.tab = act;
        this.renderBody();
      } else if (act === 'gold' || act === 'xp') {
        this.metric = act;
        this.renderBody();
      }
    });
  }

  /** Start of a match: forget the last one's history. */
  reset() {
    this.samples = [];
    this.next = 0;
    this.hide();
  }

  /** Called every frame: keeps a sample every SAMPLE_EVERY seconds of match time. */
  record(w: World) {
    if (w.time < this.next || w.winner !== null) return;
    this.next = Math.max(0, Math.floor(w.time / SAMPLE_EVERY) * SAMPLE_EVERY) + SAMPLE_EVERY;
    this.samples.push(this.sample(w));
  }

  private sample(w: World): Sample {
    const s: Sample = { t: Math.max(0, w.time), gold: [0, 0], xp: [0, 0] };
    for (const h of w.heroes) {
      s.gold[h.team as Team] += h.hero!.goldEarned;
      s.xp[h.team as Team] += h.hero!.xp;
    }
    return s;
  }

  hide() {
    this.el.classList.add('hidden');
  }

  show(w: World, myTeam: Team, meId: number) {
    this.world = w;
    this.myTeam = myTeam;
    this.meId = meId;
    this.samples.push(this.sample(w));
    this.tab = 'score';
    const won = w.winner === myTeam;
    const how =
      w.surrendered !== null
        ? `${TEAM_NAMES[w.surrendered]} surrendered`
        : `${TEAM_NAMES[w.winner ?? 0]} destroyed the enemy Shrine`;
    const mvp = this.mvp(w);
    const mh = mvp.hero!;
    const card = heroCards[mh.defId] ?? heroPortraits[mh.defId];
    this.el.innerHTML = `
      <div class="es-head">
        <div class="es-title ${won ? 'win' : 'lose'}"><h2>${won ? 'Victory' : 'Defeat'}</h2><p>${how} · ${fmtTime(w.time)}</p></div>
        <div class="es-btns"><button data-act="again" class="es-again">PLAY AGAIN<small>same heroes</small></button><button data-act="menu" class="es-menu">MENU</button></div>
      </div>
      <div class="es-main">
        <div class="es-mvp t${mvp.team}" style="--c:${HEROES[mh.defId].color}">
          ${card ? `<img alt="" src="${card}">` : ''}
          <span class="es-star">★ MVP</span>
          <div class="es-mvp-plate"><b>${HEROES[mh.defId].name}</b><small>${mvp.id === meId ? 'You' : mh.controller === 'bot' ? 'Bot' : 'Player'} · ${TEAM_NAMES[mvp.team as Team]}</small>
          <div class="es-mvp-stats"><span><b>${mh.kills}/${mh.deaths}/${mh.assists}</b><small>K/D/A</small></span><span><b>${n(mh.stats.heroDamage)}</b><small>hero dmg</small></span></div></div>
        </div>
        <div class="es-panel">
          <div class="es-tabs"></div>
          <div class="es-body"></div>
        </div>
      </div>`;
    this.renderBody();
    this.el.classList.remove('hidden');
  }

  private score(h: NonNullable<Unit['hero']>) {
    return h.kills * 3 + h.assists * 1.5 - h.deaths + h.stats.heroDamage / 400 + h.stats.buildingDamage / 600 + h.stats.healing / 300 + h.lastHits / 10;
  }

  private mvp(w: World): Unit {
    return [...w.heroes].sort((a, b) => this.score(b.hero!) - this.score(a.hero!))[0];
  }

  private renderBody() {
    const tabs = this.el.querySelector('.es-tabs')!;
    const tabBtn = (id: string, label: string) => `<button data-act="${id}" class="${this.tab === id ? 'on' : ''}">${label}</button>`;
    tabs.innerHTML = tabBtn('score', 'Scoreboard') + tabBtn('graph', 'Gold & XP') + tabBtn('dmg', 'Damage');
    const body = this.el.querySelector<HTMLElement>('.es-body')!;
    if (this.tab === 'score') body.innerHTML = this.scoreboard();
    else if (this.tab === 'dmg') body.innerHTML = this.damage();
    else {
      body.innerHTML = this.graph(Math.max(300, body.clientWidth), Math.max(120, body.clientHeight - 34));
      this.wireGraph(body);
    }
  }

  private heroesByTeam(): Unit[][] {
    const w = this.world!;
    const order = [this.myTeam, (1 - this.myTeam) as Team];
    return order.map((t) => w.heroes.filter((h) => h.team === t).sort((a, b) => this.score(b.hero!) - this.score(a.hero!)));
  }

  private who(u: Unit) {
    return u.id === this.meId ? '<em class="you">You</em>' : u.hero!.controller === 'bot' ? '<em>Bot</em>' : '';
  }

  private scoreboard(): string {
    const mvp = this.mvp(this.world!);
    return this.heroesByTeam()
      .map((team) => {
        const t = team[0]?.team ?? 0;
        const rows = team
          .map((u) => {
            const h = u.hero!;
            const pic = heroPortraits[h.defId];
            const items = h.items.map((it) => `<i>${it ? itemIcon(it.id) : ''}</i>`).join('');
            return `<tr class="${u.id === this.meId ? 'me' : ''}">
              <td class="hn"><span class="pf" style="--c:${HEROES[h.defId].color}">${pic ? `<img alt="" src="${pic}">` : ''}</span><span><b>${HEROES[h.defId].name}${u === mvp ? ' <span class="star">★</span>' : ''}</b>${this.who(u)}</span></td>
              <td>${h.level}</td><td>${h.kills}/${h.deaths}/${h.assists}</td><td>${h.lastHits}/${h.denies}</td><td>${n(h.goldEarned)}</td>
              <td class="its"><span>${items}</span></td></tr>`;
          })
          .join('');
        return `<table class="t${t}"><tr><th class="tn">${TEAM_NAMES[t as Team]}${this.world!.winner === t ? ' <span class="wonby">WON</span>' : ''}</th><th>Lv</th><th>K/D/A</th><th>LH/DN</th><th>Gold</th><th>Items</th></tr>${rows}</table>`;
      })
      .join('');
  }

  private damage(): string {
    const all = this.heroesByTeam().flat();
    const max = Math.max(1, ...all.map((u) => u.hero!.stats.heroDamage));
    return `<div class="es-bars">${all
      .sort((a, b) => b.hero!.stats.heroDamage - a.hero!.stats.heroDamage)
      .map((u) => {
        const h = u.hero!;
        const pct = (100 * h.stats.heroDamage) / max;
        return `<div class="bar-row${u.id === this.meId ? ' me' : ''}" title="${HEROES[h.defId].name}: ${n(h.stats.heroDamage)} damage to heroes">
          <span class="bn"><b>${HEROES[h.defId].name}</b>${this.who(u)}</span>
          <span class="track"><span class="fill t${u.team}" style="width:${pct.toFixed(1)}%"></span></span>
          <span class="bv"><b>${n(h.stats.heroDamage)}</b><small>bldg ${n(h.stats.buildingDamage)} · heal ${n(h.stats.healing)}</small></span>
        </div>`;
      })
      .join('')}</div><p class="es-note">Damage dealt to enemy heroes. Bars: <span class="key t0"></span> ${TEAM_NAMES[0]} · <span class="key t1"></span> ${TEAM_NAMES[1]}</p>`;
  }

  /** Lead line: Azure's total minus Crimson's, above the middle line = Azure ahead. */
  private graph(W: number, H: number): string {
    const pts = this.samples.map((s) => ({ t: s.t, v: s[this.metric][0] - s[this.metric][1] }));
    const padL = 44;
    const padR = 10;
    const padT = 14;
    const padB = 20;
    const tMax = Math.max(60, pts[pts.length - 1]?.t ?? 60);
    const vMax = Math.max(500, ...pts.map((p) => Math.abs(p.v))) * 1.1;
    const x = (t: number) => padL + (t / tMax) * (W - padL - padR);
    const y = (v: number) => padT + ((vMax - v) / (2 * vMax)) * (H - padT - padB);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = pts.length ? `${line}L${x(pts[pts.length - 1].t).toFixed(1)},${y(0)}L${x(pts[0].t).toFixed(1)},${y(0)}Z` : '';
    const ticks: string[] = [];
    const step = tMax > 1800 ? 600 : tMax > 600 ? 300 : 60;
    for (let t = 0; t <= tMax; t += step) ticks.push(`<text x="${x(t)}" y="${H - 5}" class="ax" text-anchor="middle">${Math.round(t / 60)}m</text>`);
    const lead = pts.length ? pts[pts.length - 1].v : 0;
    const peak = (sign: number) => pts.reduce((m, p) => (sign * p.v > sign * m.v ? p : m), { t: 0, v: 0 });
    const peaks = [peak(1), peak(-1)].filter((p) => Math.abs(p.v) > vMax * 0.15);
    const label = this.metric === 'gold' ? 'gold' : 'XP';
    this.graphData = { pts, x, y, W, H, padL, padR };
    return `
      <div class="es-graph-top">
        <div class="es-chips"><button data-act="gold" class="${this.metric === 'gold' ? 'on' : ''}">Gold lead</button><button data-act="xp" class="${this.metric === 'xp' ? 'on' : ''}">XP lead</button></div>
        <span class="es-final">At the end: <b>${lead === 0 ? 'even' : `${TEAM_NAMES[lead > 0 ? 0 : 1]} +${n(Math.abs(lead))} ${label}`}</b></span>
      </div>
      <div class="es-chart">
        <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label} lead over time">
          <defs>
            <clipPath id="es-above"><rect x="0" y="0" width="${W}" height="${y(0)}"/></clipPath>
            <clipPath id="es-below"><rect x="0" y="${y(0)}" width="${W}" height="${H}"/></clipPath>
          </defs>
          <line x1="${padL}" x2="${W - padR}" y1="${y(vMax / 1.1 / 2)}" y2="${y(vMax / 1.1 / 2)}" class="grid"/>
          <line x1="${padL}" x2="${W - padR}" y1="${y(-vMax / 1.1 / 2)}" y2="${y(-vMax / 1.1 / 2)}" class="grid"/>
          <text x="${padL - 6}" y="${y(vMax / 1.1 / 2) + 3}" class="ax" text-anchor="end">+${n(vMax / 1.1 / 2)}</text>
          <text x="${padL - 6}" y="${y(-vMax / 1.1 / 2) + 3}" class="ax" text-anchor="end">−${n(vMax / 1.1 / 2)}</text>
          <path d="${area}" class="area t0" clip-path="url(#es-above)"/>
          <path d="${area}" class="area t1" clip-path="url(#es-below)"/>
          <line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" class="zero"/>
          <path d="${line}" class="lead t0" clip-path="url(#es-above)"/>
          <path d="${line}" class="lead t1" clip-path="url(#es-below)"/>
          ${peaks.map((p) => `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="4" class="dot t${p.v > 0 ? 0 : 1}"/><text x="${Math.min(W - padR - 4, Math.max(padL + 4, x(p.t)))}" y="${y(p.v) + (p.v > 0 ? -8 : 15)}" class="pk" text-anchor="middle">${p.v > 0 ? '+' : '−'}${n(Math.abs(p.v))}</text>`).join('')}
          <text x="${padL + 6}" y="${padT + 8}" class="side t0">${TEAM_NAMES[0]} ahead</text>
          <text x="${padL + 6}" y="${H - padB - 6}" class="side t1">${TEAM_NAMES[1]} ahead</text>
          ${ticks.join('')}
          <line class="xhair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>
        </svg>
        <div class="es-tip hidden"></div>
      </div>`;
  }

  private graphData: { pts: { t: number; v: number }[]; x: (t: number) => number; y: (v: number) => number; W: number; H: number; padL: number; padR: number } | null = null;

  /** Crosshair + tooltip: drag or hover over the chart to read the lead at any minute. */
  private wireGraph(body: HTMLElement) {
    const chart = body.querySelector<HTMLElement>('.es-chart')!;
    const svg = chart.querySelector('svg')!;
    const hair = svg.querySelector<SVGLineElement>('.xhair')!;
    const tip = chart.querySelector<HTMLElement>('.es-tip')!;
    const g = this.graphData!;
    const label = this.metric === 'gold' ? 'gold' : 'XP';
    const move = (e: PointerEvent) => {
      if (!g.pts.length) return;
      const r = svg.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * g.W;
      const p = g.pts.reduce((best, q) => (Math.abs(g.x(q.t) - sx) < Math.abs(g.x(best.t) - sx) ? q : best), g.pts[0]);
      const px = g.x(p.t);
      hair.setAttribute('x1', String(px));
      hair.setAttribute('x2', String(px));
      hair.setAttribute('visibility', 'visible');
      tip.classList.remove('hidden');
      tip.replaceChildren();
      const v = document.createElement('b');
      v.textContent = p.v === 0 ? 'Even' : `+${n(Math.abs(p.v))} ${label}`;
      const s = document.createElement('small');
      s.textContent = p.v === 0 ? fmtTime(p.t) : `${TEAM_NAMES[p.v > 0 ? 0 : 1]} ahead · ${fmtTime(p.t)}`;
      tip.append(v, s);
      tip.className = `es-tip t${p.v >= 0 ? 0 : 1}`;
      const left = (px / g.W) * r.width;
      tip.style.left = `${Math.min(r.width - 90, Math.max(0, left - 45))}px`;
    };
    const leave = () => {
      hair.setAttribute('visibility', 'hidden');
      tip.classList.add('hidden');
    };
    chart.addEventListener('pointermove', move);
    chart.addEventListener('pointerdown', move);
    chart.addEventListener('pointerleave', leave);
  }
}
