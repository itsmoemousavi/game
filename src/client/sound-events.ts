import { GameEvent, HEROES, Team, Unit, World } from '../sim';
import { Sfx, SoundName } from './audio';

/** When each Brakk last started a Shield Charge (to give its hits a shield-bash sound). */
const chargeAt = new Map<number, number>();

const CAST_SOUNDS: Record<string, SoundName> = {
  shieldCharge: 'shieldCharge',
  earthsplitter: 'quakeCharge',
  piercingArrow: 'piercingShot',
  arrowStorm: 'arrowRain',
  fireball: 'fireballCast',
  mendingFlame: 'mendFlame',
  cataclysm: 'meteorFall',
  shadowLunge: 'shadowStep',
  veil: 'vanish',
  execution: 'execute',
  rootSnare: 'rootSnare',
  barkSkin: 'barkSkin',
  overgrowth: 'overgrowth',
  tidalWave: 'tidalWave',
  brineVeil: 'brineVeil',
  maelstrom: 'maelstrom',
};

/** Each hero's basic attack. */
const ATTACK_SOUNDS: Record<string, SoundName> = {
  brakk: 'hammerAttack',
  vexa: 'bowShot',
  orin: 'fireBolt',
  syl: 'daggerSlash',
  grom: 'woodPunch',
  kaela: 'waterBolt',
};

/** A hero's delayed blast landing (Earthsplitter, Cataclysm, Root Snare / Overgrowth). */
const BLAST_SOUNDS: Record<string, SoundName> = {
  brakk: 'earthsplitter',
  orin: 'meteorImpact',
  grom: 'rootsErupt',
};

/**
 * Turns simulation events into sounds. Your own hero is always full volume; other
 * things fade with distance from the camera and are silent if your team can't see them.
 */
export function playEvents(sfx: Sfx, w: World, events: GameEvent[], meId: number, team: Team, cam: { x: number; y: number }) {
  if (sfx.muted) return;
  const near = (u: Unit | undefined, x = u?.x ?? 0, y = u?.y ?? 0) => {
    if (u && u.id === meId) return 1;
    if (u && !w.canSee(team, u) && u.kind !== 'structure') return 0;
    const d = Math.hypot(x - cam.x, y - cam.y);
    return d < 22 ? 1 : Math.max(0, 1 - (d - 22) / 25);
  };
  for (const e of events) {
    switch (e.type) {
      case 'attack': {
        const s = w.unit(e.sourceId);
        const t = w.unit(e.targetId);
        if (!s) break;
        const involvesMe = s.id === meId || t?.id === meId;
        if (s.kind === 'structure') sfx.play('tower', near(s) * (involvesMe ? 1 : 0.5));
        else if (s.hero) {
          sfx.play(ATTACK_SOUNDS[s.hero.defId] ?? 'swing', near(s));
          if (s.hero.defId === 'vexa' && s.hero.lastCrit) sfx.play('critPing', near(s));
        }
        else if (s.kind === 'neutral' && s.neutral?.boss) sfx.play('wardenPunch', near(s));
        else if (s.kind === 'neutral') sfx.play(s.radius > 0.9 ? 'woodPunch' : 'impStab', near(s) * (involvesMe ? 0.9 : 0.5));
        else sfx.play('creep', near(s) * (involvesMe ? 1 : 0.4));
        if (t && t.id === meId && s.projectileSpeed === 0) sfx.play('hit', 0.6);
        break;
      }
      case 'cast': {
        const u = w.unit(e.unitId);
        if (!u?.hero) break;
        if (e.slot < 0) {
          // Delayed blast landed (Earthsplitter / Cataclysm / roots), heard where it lands.
          sfx.play(BLAST_SOUNDS[u.hero.defId] ?? 'slam', u.team === team || u.id === meId ? near(u) : near(undefined, u.x, u.y));
          break;
        }
        const id = HEROES[u.hero.defId].abilities[e.slot]?.id;
        if (id === 'shieldCharge') chargeAt.set(u.id, w.time);
        sfx.play(CAST_SOUNDS[id] ?? 'cast', near(u));
        break;
      }
      case 'explosion':
        // Fireball bursting (Execution has its own sound when cast).
        if (e.radius >= 2) sfx.play('fireBlast', near(undefined, e.x, e.y) * 0.9);
        break;
      case 'death': {
        const u = w.unit(e.unitId);
        if (!u) break;
        if (u.kind === 'hero') sfx.play('heroDeath', u.id === meId ? 1 : near(u));
        else if (u.kind === 'structure') sfx.play('collapse', Math.max(0.35, near(u)));
        break;
      }
      case 'gold':
        if (e.unitId === meId && e.amount >= 20) sfx.play('coin', 0.8);
        break;
      case 'levelUp':
        if (e.unitId === meId) sfx.play('levelUp');
        break;
      case 'teleport':
        sfx.play('teleport', near(w.unit(e.unitId)));
        break;
      case 'teleportStart': {
        // Heard at the hero (if you can see them) and at the destination (if your team can see it).
        const u = w.unit(e.unitId);
        const t = w.unit(e.targetId);
        const destHeard = t && (u?.team === team || w.vision.seesPoint(team, t.x, t.y)) ? near(undefined, t.x, t.y) : 0;
        sfx.play('tpChannel', Math.max(near(u), destHeard));
        break;
      }
      case 'damage': {
        // Shield Charge connecting with someone.
        const s = w.unit(e.sourceId);
        if (e.kind === 'spell' && s?.hero?.defId === 'brakk' && w.time - (chargeAt.get(s.id) ?? -9) < 0.6) sfx.play('shieldBash', near(s));
        break;
      }
      case 'deny':
        sfx.play('deny', e.killerId === meId ? 1 : near(w.unit(e.killerId)) * 0.6);
        break;
      case 'rune':
        sfx.play('rune', near(w.unit(e.unitId)));
        break;
      case 'buyback':
        sfx.play('buyback', 0.8);
        break;
      case 'glyph':
        sfx.play('glyph', e.team === team ? 1 : 0.5);
        break;
      case 'ward': {
        const u = w.unit(e.unitId);
        if (u && u.team === team) sfx.play('ward', near(u));
        break;
      }
      case 'bossKilled':
        sfx.play('roar', 0.9);
        break;
      case 'revive':
        sfx.play('revive', near(w.unit(e.unitId)));
        break;
      case 'blink':
        sfx.play('teleport', near(w.unit(e.unitId)) * 0.7);
        break;
      case 'itemActive':
        sfx.play(e.kind === 'manaBurst' ? 'brineVeil' : e.kind === 'frostNova' ? 'frostNova' : 'ironClang', near(w.unit(e.unitId)));
        break;
      case 'immunity':
        sfx.play('glyph', near(w.unit(e.unitId)));
        break;
      case 'purchase':
        if (e.unitId === meId) sfx.play('purchase');
        break;
      case 'courierSend':
        if (e.unitId === meId) sfx.play('click');
        break;
      case 'courierDeliver':
        if (e.unitId === meId) sfx.play('itemPickUp');
        break;
      case 'wardenSlam': {
        const b = w.unit(e.unitId);
        if (b && w.canSee(team, b)) sfx.play(e.phase === 'hit' ? 'earthsplitter' : 'roar', near(b) * (e.phase === 'hit' ? 0.85 : 0.6));
        break;
      }
      case 'itemDrop':
        if (e.unitId === meId) sfx.play('itemDrop');
        break;
      case 'itemPickUp':
        if (e.unitId === meId) sfx.play('itemPickUp');
        break;
      case 'gameOver':
        sfx.play(e.winner === team ? 'victory' : 'defeat');
        break;
    }
  }
}
