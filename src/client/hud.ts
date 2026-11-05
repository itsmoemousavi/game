import {
  AbilityDef,
  HeroId,
  HEROES,
  ITEMS,
  TELEPORT,
  effectiveCooldown,
  MAX_LEVEL,
  STATUS_INFO,
  Status,
  statusEffects,
  TEAM_NAMES,
  Team,
  Unit,
  World,
  XP_TABLE,
  buybackBlocker,
  buybackCost,
  castBlocker,
  isNight,
  maxAbilityLevel,
} from '../sim';

import { abilityIcon, itemIcon, statusIcon } from './icons';

const fmtTime = (t: number) => {
  // The 30 s warm-up counts down to 0:00, then the match clock counts up from there.
  const a = t < 0 ? Math.ceil(-t) : Math.floor(t);
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
};

/** Hero headshots (image URLs), filled in by main.ts once the 3D portraits are rendered. */
export const heroPortraits: Partial<Record<HeroId, string>> = {};
/** Tall chest-up pictures for the draft cards. */
export const heroCards: Partial<Record<HeroId, string>> = {};

/** DOM overlay: scores, timer, hero status, ability buttons, respawn + game-over screens. */
export class Hud {
  private el: Record<string, HTMLElement> = {};
  private lastKey = '';
  private abilityKeys = ['', '', ''];
  private buttons: HTMLElement[] = [];
  private learnButtons: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    for (const id of [
      'score-0',
      'score-1',
      'clock',
      'hp-fill',
      'hp-text',
      'mana-fill',
      'mana-text',
      'xp-fill',
      'level',
      'gold',
      'kda',
      'portrait',
      'channel-bar',
      'channel-fill',
      'channel-text',
      'respawn',
      'respawn-time',
      'daynight',
      'btn-buyback',
      'buyback-cost',
      'btn-glyph',
      'status-row',
      'toasts',
      'killfeed',
    ]) {
      this.el[id] = root.querySelector(`#${id}`)!;
    }
    for (let i = 0; i < 3; i++) {
      this.buttons.push(root.querySelector(`[data-slot="${i}"]`)!);
      this.learnButtons.push(root.querySelector(`[data-learn="${i}"]`)!);
    }
  }

  setHero(me: Unit) {
    const def = HEROES[me.hero!.defId];
    const face = this.el.portrait.querySelector<HTMLElement>('.face')!;
    const pic = heroPortraits[me.hero!.defId];
    face.innerHTML = pic ? `<img alt="" src="${pic}">` : def.name[0];
    this.el.portrait.style.background = `radial-gradient(circle at 50% 38%, color-mix(in srgb, ${def.color} 48%, #14171a) 0%, #14171a 82%)`;
    this.el.portrait.style.borderColor = `color-mix(in srgb, ${def.color} 62%, #c9c2ad)`;
    def.abilities.forEach((a, i) => {
      const b = this.buttons[i];
      b.querySelector('.pic')!.innerHTML = abilityIcon(a.id);
      b.title = `${a.name}${a.ultimate ? ' (Ultimate)' : ''}: ${a.summary}`;
      b.classList.toggle('passive', a.targeting === 'passive');
      const pips = b.querySelector('.pips')!;
      pips.innerHTML = '<i></i>'.repeat(a.manaCost.length);
    });
    this.abilityKeys = ['', '', ''];
    this.endShown = false;
  }

  private teamKey = '';

  /** Buyback, tower shield and active-effect chips. */
  private updateTeamButtons(w: World, me: Unit, team: Team) {
    const h = me.hero!;
    const bb = buybackBlocker(w, me);
    const cost = buybackCost(h.level, w.time / 60);
    const gcd = Math.ceil(w.glyphCooldown[team]);
    const key = `${bb}|${cost}|${Math.ceil(h.buybackCooldown)}|${gcd}`;
    if (key === this.teamKey) return;
    this.teamKey = key;
    this.el['buyback-cost'].textContent = bb === 'cooldown' ? `${Math.ceil(h.buybackCooldown)}s` : String(cost);
    this.el['btn-buyback'].classList.toggle('off', bb !== null);
    this.el['btn-glyph'].querySelector('.cd')!.textContent = gcd > 0 ? `${Math.floor(gcd / 60)}:${String(gcd % 60).padStart(2, '0')}` : '';
  }

  private statusKey = '';
  private statusList: Status[] = [];
  /** Full duration of each showing effect (for the time-left sweep). */
  private statusTotal = new Map<string, { total: number; left: number }>();
  private statusTip: { el: HTMLElement; until: number; id: string } | null = null;

  /**
   * Status icons above the hero bar: green border = helpful, red = harmful. A dark sweep
   * shows how much time is left; counters (Vexa's attacks) show their number, and the
   * icon glows when the next attack will be a critical hit. Tap an icon to see what it is.
   */
  private updateStatus(w: World, me: Unit) {
    const list = statusEffects(w, me);
    const row = this.el['status-row'];
    const key = list.map((s) => `${s.id}:${s.count ?? ''}`).join();
    if (key !== this.statusKey) {
      this.statusKey = key;
      row.innerHTML = list
        .map(
          (s, i) =>
            `<button class="st ${s.good ? 'good' : 'bad'}${s.id === 'rhythmCount' && s.count === 3 ? ' ready' : ''}" data-i="${i}"><span class="ic">${statusIcon(s.id)}</span><span class="tm"></span>${s.count ? `<b>${s.count}</b>` : ''}</button>`,
        )
        .join('');
      row.querySelectorAll<HTMLElement>('.st').forEach((el) =>
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const s = this.statusList[Number(el.dataset.i)];
          if (s) this.showStatusTip(s, el);
        }),
      );
    }
    this.statusList = list;
    // Time-left sweep (remember each effect's full length: the longest time left we saw).
    const seen = new Set<string>();
    row.querySelectorAll<HTMLElement>('.st').forEach((el, i) => {
      const s = list[i];
      if (!s) return;
      seen.add(s.id);
      const tm = el.querySelector<HTMLElement>('.tm')!;
      if (s.left === undefined) {
        tm.style.background = '';
        return;
      }
      const prev = this.statusTotal.get(s.id);
      const rec = !prev || s.left > prev.left + 0.05 ? { total: Math.max(s.left, 0.01), left: s.left } : { total: prev.total, left: s.left };
      this.statusTotal.set(s.id, rec);
      const gone = Math.round((1 - s.left / rec.total) * 100);
      tm.style.background = gone > 0 ? `conic-gradient(rgba(0,0,0,0.62) 0 ${gone}%, transparent ${gone}% 100%)` : '';
    });
    for (const k of [...this.statusTotal.keys()]) if (!seen.has(k)) this.statusTotal.delete(k);
    if (this.statusTip) {
      const s = list.find((x) => x.id === this.statusTip!.id);
      if (!s || performance.now() > this.statusTip.until) {
        this.statusTip.el.remove();
        this.statusTip = null;
      } else this.statusTip.el.textContent = this.statusText(s);
    }
  }

  private statusText(s: Status) {
    const t = s.left !== undefined && s.left > 0 ? Math.ceil(s.left) : null;
    const time = t === null ? '' : t >= 60 ? ` · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : ` · ${t}s`;
    const count = s.id === 'rhythmCount' ? ` (${s.count}/4${s.count === 3 ? ': next hit crits!' : ''})` : '';
    return STATUS_INFO[s.id].name + count + time;
  }

  private showStatusTip(s: Status, at: HTMLElement) {
    this.statusTip?.el.remove();
    const el = document.createElement('div');
    el.id = 'status-tip';
    el.className = s.good ? 'good' : 'bad';
    el.textContent = this.statusText(s);
    el.style.left = `${at.offsetLeft}px`;
    this.el['status-row'].parentElement!.appendChild(el);
    this.statusTip = { el, until: performance.now() + 2500, id: s.id };
  }

  /** Cooldowns, mana, levels and learn buttons. Cheap: only touches the DOM on change. */
  private updateAbilities(me: Unit) {
    const h = me.hero!;
    const def = HEROES[h.defId];
    def.abilities.forEach((a, i) => {
      const st = h.abilities[i];
      const blocker = castBlocker(me, i);
      const canLearn = h.skillPoints > 0 && st.level < maxAbilityLevel(a, h.level);
      const cd = Math.ceil(st.cooldown);
      const cost = a.manaCost[Math.max(0, st.level - 1)];
      // Short of mana shows even while the spell is cooling down, so you know before it's ready.
      const lowMana = st.level > 0 && a.targeting !== 'passive' && me.mana < cost;
      const key = `${st.level}|${blocker}|${cd}|${canLearn}|${lowMana}`;
      if (key === this.abilityKeys[i]) return;
      this.abilityKeys[i] = key;
      const b = this.buttons[i];
      b.classList.toggle('unlearned', st.level === 0);
      b.classList.toggle('nomana', lowMana);
      b.classList.toggle('cooling', blocker === 'cooldown');
      b.classList.toggle('silenced', blocker === 'silenced');
      b.querySelector('.cd')!.textContent = blocker === 'cooldown' ? String(cd) : '';
      b.querySelectorAll('.pips i').forEach((p, k) => p.classList.toggle('on', k < st.level));
      b.querySelector('.mana')!.textContent = a.targeting === 'passive' ? '' : String(cost);
      this.learnButtons[i].classList.toggle('show', canLearn);
    });
  }

  /**
   * Kill feed (top right): "Killer ⚔ Victim" with team colours. Killers that aren't
   * heroes show as Tower / Creeps / Camp / Warden / Fountain.
   */
  killFeed(w: World, victim: Unit, killer: Unit | undefined, meId: number) {
    const color = (u: Unit | undefined) => (u && u.team !== 2 ? (u.team === 0 ? '#6fb0ff' : '#ff7b7f') : '#d9a25f');
    const label = (u: Unit | undefined) => {
      if (!u) return 'Unknown';
      if (u.hero) return HEROES[u.hero.defId].name;
      if (u.structure) return u.structure.tier === 'fountain' ? 'Fountain' : u.structure.tier === 'shrineTower' ? 'Shrine tower' : 'Tower';
      if (u.neutral?.boss) return 'Warden';
      if (u.neutral) return 'Jungle camp';
      return 'Creeps';
    };
    const d = document.createElement('div');
    if (victim.id === meId || killer?.id === meId) d.className = 'me';
    const k = document.createElement('span');
    k.textContent = label(killer);
    k.style.color = color(killer);
    const vs = document.createElement('span');
    vs.className = 'vs';
    vs.textContent = '⚔';
    const v = document.createElement('span');
    v.textContent = label(victim);
    v.style.color = color(victim);
    d.append(k, vs, v);
    this.el.killfeed.appendChild(d);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstElementChild!.remove();
    setTimeout(() => d.remove(), 9200);
    void w;
  }

  private statsKey = '';

  /** Hero stats panel (tap the portrait). */
  updateStats(w: World, me: Unit) {
    const h = me.hero!;
    const def = HEROES[h.defId];
    const b = h.bonus;
    const armor = w.armorOf(me);
    const reduction = (0.06 * armor) / (1 + 0.06 * Math.abs(armor));
    let dmgMult = 1;
    for (const x of me.buffs) if (x.damageMult) dmgMult *= x.damageMult;
    let regenBuff = 0;
    let manaBuff = 0;
    for (const x of me.buffs) {
      regenBuff += x.healPerSec ?? 0;
      manaBuff += x.manaPerSec ?? 0;
    }
    const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
    const rows: [string, string][] = [];
    const sec = (t: string) => rows.push(['#', t]);
    sec('Attack');
    rows.push(['Damage', `${Math.round(me.damage * dmgMult)}${dmgMult > 1 ? ' (×2 rune)' : ''}`]);
    rows.push(['Attack speed', `${f1(1 / me.attackInterval)} /s`]);
    rows.push(['Attack time', `${f1(me.attackInterval)} s`]);
    rows.push(['Attack range', `${f1(me.attackRange)} m${me.projectileSpeed ? '' : ' (melee)'}`]);
    rows.push(['Lifesteal', `${b.lifestealPct}%`]);
    rows.push(['Spell damage', `+${b.spellAmpPct}%`]);
    rows.push(['Cooldowns', `−${b.cdrPct}%${b.ultUpgrade ? ' · Ultimate upgraded' : ''}`]);
    sec('Defense & movement');
    rows.push(['Armor', `${f1(armor)} (−${Math.round(reduction * 100)}% attack damage)`]);
    rows.push(['Move speed', `${f1(w.speedOf(me))} m/s`]);
    rows.push(['Health', `${Math.ceil(me.hp)} / ${Math.round(me.maxHp)}`]);
    rows.push(['Health regen', `${f1(me.hpRegen + regenBuff)} /s`]);
    rows.push(['Mana', `${Math.floor(me.mana)} / ${Math.round(me.maxMana)}`]);
    rows.push(['Mana regen', `${f1(me.manaRegen + manaBuff)} /s`]);
    sec('Match');
    rows.push(['K / D / A', `${h.kills} / ${h.deaths} / ${h.assists}`]);
    rows.push(['Last hits / Denies', `${h.lastHits} / ${h.denies}`]);
    rows.push(['Gold', `${Math.floor(h.gold)}`]);
    rows.push(['Gold per minute', `${w.time > 30 ? Math.round(h.goldEarned / (w.time / 60)) : 0}`]);
    rows.push(['Level', `${h.level}${h.level < MAX_LEVEL ? ` (${Math.floor(h.xp)} / ${XP_TABLE[h.level]} XP)` : ' (max)'}`]);
    rows.push(['Teleports', `${h.tpCount}`]);
    const key = rows.map((r) => r[1]).join('|');
    if (key === this.statsKey) return;
    this.statsKey = key;
    const root = this.el.toasts.ownerDocument;
    root.getElementById('stats-title')!.textContent = `${def.name} ${def.title} · Level ${h.level}`;
    root.getElementById('stats-body')!.innerHTML = rows
      .map(([k, v]) => (k === '#' ? `<h4>${v}</h4>` : `<div><span>${k}</span><b>${v}</b></div>`))
      .join('');
  }

  private scoreKey = '';

  /** Scoreboard (tap the top bar): both teams' heroes, K/D/A, farm, net worth and items. */
  updateScoreboard(w: World, myTeam: Team, meId: number) {
    const rows = w.heroes.map((u) => {
      const h = u.hero!;
      const worth = Math.floor(h.gold) + h.items.reduce((s, it) => s + (it ? ITEMS[it.id].cost * it.count : 0), 0) + h.tpCount * TELEPORT.cost;
      return { u, h, worth };
    });
    const key = rows
      .map((r) => `${r.h.level}${r.h.kills}${r.h.deaths}${r.h.assists}${r.h.lastHits}${r.h.denies}${Math.floor(r.worth / 10)}${r.u.alive}${Math.ceil(r.h.respawnTimer)}${r.h.items.map((i) => i?.id ?? '-').join()}`)
      .join('|');
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    const esc = (t: string) => t.replace(/[<>&]/g, '');
    let html = '<table><tr><th>Hero</th><th>K / D / A</th><th>LH / DN</th><th>Net worth</th><th>Items</th></tr>';
    for (const team of [myTeam, (1 - myTeam) as Team]) {
      const total = rows.filter((r) => r.u.team === team).reduce((s, r) => s + r.worth, 0);
      html += `<tr><td class="team" colspan="5" style="color:${team === 0 ? '#6fb0ff' : '#ff7b7f'}">${TEAM_NAMES[team]}${team === myTeam ? ' (you)' : ''} · ${w.teamKills[team]} kills · ${total} worth</td></tr>`;
      for (const r of rows.filter((x) => x.u.team === team).sort((a, b) => b.worth - a.worth)) {
        const def = HEROES[r.h.defId];
        const items = r.h.items
          .map((it) => (it ? `<i title="${esc(ITEMS[it.id].name)}">${itemIcon(it.id)}${it.count > 1 ? `<b>${it.count}</b>` : ''}</i>` : '<i class="empty"></i>'))
          .join('');
        const status = r.u.alive ? '' : ` <span class="dead">☠ ${Math.ceil(r.h.respawnTimer)}s</span>`;
        html += `<tr class="${r.u.id === meId ? 'me' : ''}">
          <td><span class="hero"><span class="dot" style="background:${def.color}">${r.h.level}</span>${esc(def.name)}${r.h.controller === 'bot' ? ' <small>(bot)</small>' : ''}${status}</span></td>
          <td>${r.h.kills} / ${r.h.deaths} / ${r.h.assists}</td>
          <td>${r.h.lastHits} / ${r.h.denies}</td>
          <td>${r.worth}</td>
          <td><span class="items">${items}</span>${team === myTeam ? ` <small>TP×${r.h.tpCount}</small>` : ''}</td>
        </tr>`;
      }
    }
    this.el.toasts.ownerDocument.getElementById('score-body')!.innerHTML = html + '</table>';
  }

  /** Ability info card (long-press an ability button). */
  showAbilityTip(me: Unit, slot: number | null) {
    const tip = this.el.toasts.ownerDocument.getElementById('ability-tip')!;
    if (slot === null) {
      tip.classList.add('hidden');
      return;
    }
    const h = me.hero!;
    const def: AbilityDef = HEROES[h.defId].abilities[slot];
    const lvl = h.abilities[slot].level;
    const levels = def.manaCost.length;
    const perLevel = (vals: number[], fmt = (v: number) => String(Math.round(v * 10) / 10)) =>
      vals.map((v, i) => (i === lvl - 1 ? `<span class="cur">${fmt(v)}</span>` : fmt(v))).join(' / ');
    const labels: Record<string, string> = {
      damage: 'Damage',
      stun: 'Stun (s)',
      block: 'Damage blocked per attack',
      lowHpArmor: 'Armor below 50% HP',
      windup: 'Wind-up (s)',
      critMult: 'Critical multiplier',
      speedPct: 'Speed bonus %',
      dps: 'Damage per second',
      slowPct: 'Slow %',
      duration: 'Duration (s)',
      heal: 'Total heal',
      delay: 'Delay (s)',
      burnDps: 'Burn damage per second',
      burnDuration: 'Burn duration (s)',
    };
    const kind =
      def.targeting === 'passive'
        ? 'Passive'
        : { none: 'Active · around you', direction: 'Active · aimed direction', point: 'Active · aimed area', enemy: 'Active · enemy', ally: 'Active · ally' }[def.targeting];
    let html = `<h3>${def.name}${def.ultimate ? ' <small>(Ultimate)</small>' : ''}</h3><div class="tag">${kind} · Level ${lvl}/${levels}</div><p>${def.summary}</p>`;
    for (const [k, vals] of Object.entries(def.values)) html += `<div class="row"><b>${labels[k] ?? k}</b><span>${perLevel(vals)}</span></div>`;
    if (def.targeting !== 'passive') {
      html += `<div class="row"><b>Mana</b><span>${perLevel(def.manaCost)}</span></div>`;
      html += `<div class="row"><b>Cooldown (s)</b><span>${perLevel(def.cooldown.map((_, i) => effectiveCooldown(me, def, i + 1)))}</span></div>`;
      if (def.castRange) html += `<div class="row"><b>Range</b><span>${def.castRange} m</span></div>`;
      if (def.radius && def.targeting !== 'direction') html += `<div class="row"><b>Radius</b><span>${def.radius} m</span></div>`;
    }
    tip.innerHTML = html;
    tip.classList.remove('hidden');
  }

  /** Big announcer banner: first blood, multi-kills, streaks, shutdowns. */
  announce(w: World, e: { unitId: number; firstBlood: boolean; multi: number; streak: number; shutdown: number }, myTeam: Team): boolean {
    const u = w.unit(e.unitId);
    if (!u?.hero) return false;
    const multi = ['', '', 'Double Kill!', 'Triple Kill!'][Math.min(e.multi, 3)];
    const streak = e.streak >= 6 ? 'Legendary!' : ['', '', '', 'Hot Streak!', 'Blazing!', 'Inferno!'][e.streak] ?? '';
    const lines: string[] = [];
    if (e.firstBlood) lines.push('First Blood!');
    if (multi) lines.push(e.multi >= 3 ? 'Triple Kill — Team Wipe!' : multi);
    else if (streak) lines.push(streak);
    if (e.shutdown > 0) lines.push(`Shutdown! +${e.shutdown}`);
    if (!lines.length) return false;
    const d = document.createElement('div');
    d.style.color = u.team === myTeam ? '#8cc4ff' : '#ff8f92';
    d.textContent = lines[0];
    const sub = document.createElement('small');
    sub.textContent = `${HEROES[u.hero.defId].name}${lines.length > 1 ? ' · ' + lines.slice(1).join(' · ') : ''}`;
    d.appendChild(sub);
    const box = this.el.toasts.ownerDocument.getElementById('announce')!;
    box.replaceChildren(d);
    setTimeout(() => d.remove(), 2500);
    return true;
  }

  private endShown = false;
  /** The match just ended (shown once per match). */
  onGameOver: (w: World) => void = () => {};

  /** End-of-match table: everyone's numbers, with the MVP highlighted. */
  /** Short announcement under the top bar. */
  toast(text: string, color = '#fff') {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.color = color;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild!.remove();
    setTimeout(() => d.remove(), 3300);
  }

  /** The bar over the health bar: anything being charged up (a teleport, a spell's wind-up). */
  private updateChannelBar(me: Unit) {
    const h = me.hero!;
    const bar = this.el['channel-bar'];
    const c = h.channel;
    const wind = h.windup && me.castLock > 0 ? h.windup : null;
    const left = c ? c.t : wind ? me.castLock : 0;
    const total = c ? c.total : (wind?.total ?? 1);
    const show = me.alive && left > 0;
    bar.classList.toggle('hidden', !show);
    if (!show) return;
    this.el['channel-fill'].style.width = `${Math.min(100, (1 - left / total) * 100)}%`;
    this.el['channel-text'].textContent = `${c ? 'Teleporting' : wind!.name}  ${left.toFixed(1)}`;
  }

  update(w: World, me: Unit, myTeam: Team) {
    const h = me.hero!;
    this.updateAbilities(me);
    this.updateTeamButtons(w, me, myTeam);
    this.updateStatus(w, me);
    this.updateChannelBar(me);
    const key = [
      w.teamKills[0],
      w.teamKills[1],
      Math.floor(w.time),
      Math.round(me.hp),
      Math.round(me.mana),
      Math.floor(h.gold),
      h.level,
      Math.floor(h.xp),
      h.kills,
      h.deaths,
      h.lastHits,
      h.denies,
      h.assists,
      me.alive,
      Math.ceil(h.respawnTimer),
      w.winner,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.el['score-0'].textContent = String(w.teamKills[0]);
    this.el['score-1'].textContent = String(w.teamKills[1]);
    this.el.clock.textContent = fmtTime(w.time);
    this.el['hp-fill'].style.width = `${(me.hp / me.maxHp) * 100}%`;
    this.el['hp-text'].textContent = `${Math.ceil(me.hp)} / ${Math.round(me.maxHp)}`;
    this.el['mana-fill'].style.width = `${(me.mana / Math.max(1, me.maxMana)) * 100}%`;
    this.el['mana-text'].textContent = `${Math.floor(me.mana)} / ${Math.round(me.maxMana)}`;
    const cur = XP_TABLE[h.level - 1];
    const next = h.level < MAX_LEVEL ? XP_TABLE[h.level] : cur + 1;
    this.el['xp-fill'].style.width = h.level >= MAX_LEVEL ? '100%' : `${((h.xp - cur) / (next - cur)) * 100}%`;
    this.el.level.textContent = String(h.level);
    this.el.gold.textContent = String(Math.floor(h.gold));
    const kda = `<span>K/D/A ${h.kills}/${h.deaths}/${h.assists}</span><span>LH/D ${h.lastHits}/${h.denies}</span>`;
    if (this.el.kda.innerHTML !== kda) this.el.kda.innerHTML = kda;

    this.el.respawn.style.display = !me.alive && w.winner === null ? 'block' : 'none';
    const night = isNight(w.time);
    this.el.daynight.textContent = night ? '☾' : '☀';
    this.el.daynight.classList.toggle('night', night);
    this.el.daynight.title = night ? 'Night: everyone sees less' : 'Day';
    this.el['respawn-time'].textContent = String(Math.max(0, Math.ceil(h.respawnTimer)));

    if (w.winner !== null && !this.endShown) {
      this.endShown = true;
      this.onGameOver(w);
    }
  }
}
