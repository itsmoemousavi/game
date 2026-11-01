import {
  HEROES,
  MAX_LEVEL,
  RUNE_INFO,
  RuneKind,
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

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** DOM overlay: scores, timer, hero status, ability buttons, respawn + game-over screens. */
export class Hud {
  private el: Record<string, HTMLElement> = {};
  private lastKey = '';
  private abilityKeys = ['', '', ''];
  private buttons: HTMLElement[] = [];
  private learnButtons: HTMLElement[] = [];

  constructor(
    root: HTMLElement,
    private onRestart: () => void,
  ) {
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
      'respawn',
      'respawn-time',
      'gameover',
      'gameover-title',
      'daynight',
      'btn-buyback',
      'buyback-cost',
      'btn-glyph',
      'buffs',
      'toasts',
      'killfeed',
      'killed-by',
    ]) {
      this.el[id] = root.querySelector(`#${id}`)!;
    }
    for (let i = 0; i < 3; i++) {
      this.buttons.push(root.querySelector(`[data-slot="${i}"]`)!);
      this.learnButtons.push(root.querySelector(`[data-learn="${i}"]`)!);
    }
    root.querySelector('#btn-restart')!.addEventListener('click', () => this.onRestart());
  }

  setHero(me: Unit) {
    const def = HEROES[me.hero!.defId];
    this.el.portrait.textContent = def.name[0];
    this.el.portrait.style.background = def.color;
    def.abilities.forEach((a, i) => {
      const b = this.buttons[i];
      b.querySelector('.name')!.textContent = a.name;
      b.title = `${a.name}${a.ultimate ? ' (Ultimate)' : ''}: ${a.summary}`;
      b.classList.toggle('passive', a.targeting === 'passive');
      const pips = b.querySelector('.pips')!;
      pips.innerHTML = '<i></i>'.repeat(a.manaCost.length);
    });
    this.abilityKeys = ['', '', ''];
    this.el.gameover.style.display = 'none';
  }

  private teamKey = '';

  /** Buyback, tower shield and active-effect chips. */
  private updateTeamButtons(w: World, me: Unit, team: Team) {
    const h = me.hero!;
    const bb = buybackBlocker(w, me);
    const cost = buybackCost(h.level, w.time / 60);
    const gcd = Math.ceil(w.glyphCooldown[team]);
    const buffs = me.buffs
      .filter((b) => b.key === 'charm' || b.key === 'rune' || b.key === 'salve')
      .map((b) => `${b.key}:${Math.ceil(b.t)}`)
      .join();
    const key = `${bb}|${cost}|${Math.ceil(h.buybackCooldown)}|${gcd}|${buffs}`;
    if (key === this.teamKey) return;
    this.teamKey = key;
    this.el['buyback-cost'].textContent = bb === 'cooldown' ? `${Math.ceil(h.buybackCooldown)}s` : String(cost);
    this.el['btn-buyback'].classList.toggle('off', bb !== null);
    this.el['btn-glyph'].querySelector('.cd')!.textContent = gcd > 0 ? `${Math.floor(gcd / 60)}:${String(gcd % 60).padStart(2, '0')}` : '';
    const chips: string[] = [];
    for (const b of me.buffs) {
      const secs = Math.ceil(b.t);
      if (b.key === 'charm') chips.push(`<span style="background:#ffd23f">Revive ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</span>`);
      if (b.key === 'salve') chips.push(`<span style="background:#4ade80">Salve ${secs}</span>`);
      if (b.key === 'rune') {
        const kind: RuneKind = b.invisible ? 'invisibility' : b.damageMult ? 'doubleDamage' : b.moveSpeedPct ? 'haste' : 'regen';
        chips.push(`<span style="background:${RUNE_INFO[kind].color}">${RUNE_INFO[kind].name} ${secs}</span>`);
      }
    }
    this.el.buffs.innerHTML = chips.join('');
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
      const key = `${st.level}|${blocker}|${cd}|${canLearn}`;
      if (key === this.abilityKeys[i]) return;
      this.abilityKeys[i] = key;
      const b = this.buttons[i];
      b.classList.toggle('unlearned', st.level === 0);
      b.classList.toggle('nomana', blocker === 'mana');
      b.classList.toggle('cooling', blocker === 'cooldown');
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
    if (victim.id === meId) this.el['killed-by'].textContent = `Killed by ${label(killer)} ·`;
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

  /** Short announcement under the top bar. */
  toast(text: string, color = '#fff') {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.color = color;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild!.remove();
    setTimeout(() => d.remove(), 3300);
  }

  update(w: World, me: Unit, myTeam: Team) {
    const h = me.hero!;
    this.updateAbilities(me);
    this.updateTeamButtons(w, me, myTeam);
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
    this.el.kda.textContent = `${h.kills} / ${h.deaths} · LH ${h.lastHits}`;

    this.el.respawn.style.display = !me.alive && w.winner === null ? 'block' : 'none';
    const night = isNight(w.time);
    this.el.daynight.textContent = night ? '☾' : '☀';
    if (me.alive) this.el['killed-by'].textContent = '';
    this.el.daynight.classList.toggle('night', night);
    this.el.daynight.title = night ? 'Night: everyone sees less' : 'Day';
    this.el['respawn-time'].textContent = String(Math.max(0, Math.ceil(h.respawnTimer)));

    if (w.winner !== null) {
      this.el.gameover.style.display = 'flex';
      const won = w.winner === myTeam;
      this.el['gameover-title'].textContent = won ? 'Victory' : 'Defeat';
      this.el['gameover-title'].className = won ? 'win' : 'lose';
      this.el.gameover.querySelector('.sub')!.textContent = `${TEAM_NAMES[w.winner]} destroyed the enemy Shrine at ${fmtTime(w.time)}`;
    }
  }
}
