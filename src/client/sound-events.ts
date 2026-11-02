import { GameEvent, HEROES, Team, Unit, World } from '../sim';
import { Sfx, SoundName } from './audio';

const CAST_SOUNDS: Record<string, SoundName> = {
  shieldCharge: 'charge',
  earthsplitter: 'cast',
  piercingArrow: 'arrow',
  arrowStorm: 'storm',
  fireball: 'fire',
  mendingFlame: 'heal',
  cataclysm: 'meteor',
  shadowLunge: 'charge',
  veil: 'teleport',
  execution: 'slam',
  rootSnare: 'cast',
  barkSkin: 'glyph',
  overgrowth: 'cast',
  tidalWave: 'storm',
  brineVeil: 'heal',
  maelstrom: 'storm',
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
        else if (s.kind === 'hero') sfx.play(s.projectileSpeed ? 'shoot' : 'swing', near(s));
        else if (s.kind === 'neutral' && s.neutral?.boss) sfx.play('hit', near(s));
        else sfx.play('creep', near(s) * (involvesMe ? 1 : 0.4));
        if (t && t.id === meId && s.projectileSpeed === 0) sfx.play('hit', 0.6);
        break;
      }
      case 'cast': {
        const u = w.unit(e.unitId);
        if (!u?.hero) break;
        if (e.slot < 0) {
          sfx.play('slam', near(u)); // delayed blast landed (Earthsplitter / Cataclysm)
          break;
        }
        const id = HEROES[u.hero.defId].abilities[e.slot]?.id;
        sfx.play(CAST_SOUNDS[id] ?? 'cast', near(u));
        break;
      }
      case 'explosion':
        sfx.play('explosion', near(undefined, e.x, e.y) * 0.8);
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
      case 'immunity':
        sfx.play('glyph', near(w.unit(e.unitId)));
        break;
      case 'purchase':
        if (e.unitId === meId) sfx.play('purchase');
        break;
      case 'wardenSlam': {
        const b = w.unit(e.unitId);
        if (b && w.canSee(team, b)) sfx.play(e.phase === 'hit' ? 'slam' : 'roar', near(b) * (e.phase === 'hit' ? 1 : 0.35));
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
