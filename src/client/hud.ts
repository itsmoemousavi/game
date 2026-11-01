import { HEROES, MAX_LEVEL, TEAM_NAMES, Team, Unit, World, XP_TABLE, castBlocker, maxAbilityLevel } from '../sim';

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

  /** Cooldowns, mana, levels and learn buttons. Cheap: only touches the DOM on change. */
  private updateAbilities(me: Unit) {
    const h = me.hero!;
    const def = HEROES[h.defId];
    def.abilities.forEach((a, i) => {
      const st = h.abilities[i];
      const blocker = castBlocker(me, i);
      const canLearn = h.skillPoints > 0 && st.level < maxAbilityLevel(a, h.level);
      const cd = Math.ceil(st.cooldown);
      const key = `${st.level}|${blocker}|${cd}|${canLearn}`;
      if (key === this.abilityKeys[i]) return;
      this.abilityKeys[i] = key;
      const b = this.buttons[i];
      b.classList.toggle('unlearned', st.level === 0);
      b.classList.toggle('nomana', blocker === 'mana');
      b.classList.toggle('cooling', blocker === 'cooldown');
      b.querySelector('.cd')!.textContent = blocker === 'cooldown' ? String(cd) : '';
      b.querySelectorAll('.pips i').forEach((p, k) => p.classList.toggle('on', k < st.level));
      this.learnButtons[i].classList.toggle('show', canLearn);
    });
  }

  update(w: World, me: Unit, myTeam: Team) {
    const h = me.hero!;
    this.updateAbilities(me);
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

    this.el.respawn.style.display = !me.alive && w.winner === null ? 'flex' : 'none';
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
