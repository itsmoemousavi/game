/// <reference types="vite/client" />
import './style.css';
import { BotDifficulty, DRAFT_TIME, DT, Draft, DraftStep, HeroId, LANE_IDS, LaneId, PlayerSlot, Team, WARMUP_SECONDS, World, XP_TABLE } from '../sim';
import { DraftUi } from './draft-ui';
import { Hud, heroCards, heroPortraits } from './hud';
import { Input } from './input';
import { ItemsUi } from './items-ui';
import { Sfx, SoundName } from './audio';
import { Tutorial, spawnDummy } from './tutorial';
import { playEvents } from './sound-events';
import { ScreenFx } from './screen-fx';
import { EndScreen } from './end-screen';
import { GameEvent, HERO_IDS, HEROES as HERO_DEFS, PingKind, RUNE_INFO, RuneKind, TEAM_NAMES } from '../sim';
import { PING_STYLE } from './renderer';
import { Renderer } from './renderer';
import { GraphicsOptions, PRESETS, Quality, Renderer3D } from './renderer3d';
import { MenuShowcase } from './menu3d';
import { enterImmersive, setupLandscape } from './screen';
import { FriendUi } from './friend-ui';
import { loadProfile, phoneStorage, setDisplayName, shownName } from './profile';
import { botName, seatNames, seatOf, setHeroNames } from './player-names';
import { GuestSession, HostSession, MatchInfo, Session } from '../net/session';
import { HostPeer, hostPeer, joinPeer } from '../net/peer';
import type { Link } from '../net/link';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const canvas = $<HTMLCanvasElement>('#game');
let canvas3d = $<HTMLCanvasElement>('#game3d');
const screenFx = new ScreenFx(canvas); // after both canvases (#game3d comes first in the page)
declare const __BUILD__: string;
declare const __VERSION__: string;
const app = $<HTMLElement>('#app');
const select = $<HTMLElement>('#select');

let world: World | null = null;
let renderer: Renderer | null = null;
let input: Input | null = null;
let myHeroId = 0;
/** The side this phone plays and sees. Azure offline; in a multiplayer match, wherever their seat is. */
let myTeam: Team = 0;
let devPick: HeroId | null = null;
// Local dev server only (never in the published game): lets test scripts look at the match.
if (import.meta.env.DEV) Object.assign(window, { dbg: { world: () => world, me: () => world?.unit(myHeroId), pick: (h: HeroId) => (devPick = h), renderer: () => renderer, net: () => net, draft: () => draftUi, sfx: () => sfx } });
const profile = loadProfile(phoneStorage);
let pickedLane: LaneId = 'mid';
let pickedDifficulty: BotDifficulty = 'normal';
try {
  pickedDifficulty = (localStorage.getItem('shrinefall-difficulty') as BotDifficulty) || 'normal';
} catch {
  /* storage unavailable */
}

// ------------------------------------------------------------- menu & draft

// ------------------------------------------------------------- loading screen

const loadingEl = $<HTMLElement>('#loading');
function showLoading(text: string, pct: number) {
  loadingEl.classList.remove('done');
  $<HTMLElement>('#l-text').textContent = text;
  $<HTMLElement>('#l-fill').style.width = `${pct}%`;
}
/** Give the browser a moment to draw the loading screen before the next heavy step. */
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// The 3D hero models are rendered once into headshots and draft cards, a hero at a time so the
// loading bar keeps moving. Then the start screen's picture.
async function boot() {
  try {
    const showcase = new MenuShowcase($<HTMLCanvasElement>('#menu3d'));
    for (const [i, id] of HERO_IDS.entries()) {
      showLoading(`Summoning ${HERO_DEFS[id].name}`, 8 + (i / HERO_IDS.length) * 72);
      await nextPaint();
      Object.assign(heroPortraits, showcase.portraits([id]));
      Object.assign(heroCards, showcase.cards([id]));
    }
    showLoading('Lighting the Shrines', 86);
    await nextPaint();
    const art = showcase.backdrop(1400, 646);
    $<HTMLElement>('#menu-art').style.backgroundImage = `url(${art})`;
    showcase.dispose();
  } catch (err) {
    console.warn('Hero pictures unavailable', err);
  }
  // Every sound ready before the menu, so none is ever late. A very slow connection doesn't hold up the game.
  showLoading('Tuning the horns', 94);
  await Promise.race([sfxLoaded, new Promise((r) => setTimeout(r, 6000))]);
  showLoading('Ready', 100);
  await nextPaint();
  loadingEl.classList.add('done');
}
void boot();

// A few embers rising past the start screen (only CSS, nothing to redraw).
{
  const embers = $<HTMLElement>('#menu-embers');
  for (let i = 0; i < 16; i++) {
    const e = document.createElement('i');
    e.style.left = `${28 + Math.random() * 70}%`;
    e.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    e.style.animationDuration = `${7 + Math.random() * 9}s`;
    e.style.animationDelay = `${-Math.random() * 14}s`;
    embers.appendChild(e);
  }
}

const draftUi = new DraftUi($<HTMLElement>('#draft'));

// ------------------------------------------------------------- play with friend

/** The multiplayer session in progress, if any. */
let net: (Session & { attachWorld(w: World): void }) | null = null;
let netPeer: HostPeer | null = null;
const friendUi = new FriendUi($<HTMLElement>('.menu-panel'), $<HTMLElement>('#friend-panel'), $<HTMLElement>('#lobby-panel'));
/** What we need to find our way back into a match we dropped out of. */
const REJOIN_KEY = 'ovra-rejoin';
const savedRejoin = (): { code: string; token: string } | null => {
  try {
    return JSON.parse(localStorage.getItem(REJOIN_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const saveRejoin = (v: { code: string; token: string } | null) => {
  try {
    if (v) localStorage.setItem(REJOIN_KEY, JSON.stringify(v));
    else localStorage.removeItem(REJOIN_KEY);
  } catch {
    /* storage unavailable */
  }
};
// Keeps the host's turns going and guests' commands flowing even if drawing is slow.
setInterval(() => net?.update(performance.now()), 25);

/** Common wiring for a host or guest session. */
function useSession(s: Session & { attachWorld(w: World): void }) {
  net = s;
  s.onLobby = (state) => friendUi.renderLobby(state);
  s.onCountdown = (seconds) =>
    friendUi.showCountdown(seconds, (left) => sfx.play(left % 2 ? 'clockTick' : 'clockTock'));
  s.onNote = (t) => hud.toast(t, '#f3dc9f');
  s.onPause = (on, by) => {
    setPaused(on);
    $<HTMLElement>('#pause-title').textContent = on ? `Paused by ${by}` : 'Paused';
  };
  s.onDesync = (tick) => {
    console.warn('Match out of sync at tick', tick);
    hud.toast('Players have gone out of sync: this match may look different on each phone', '#ffb4b4');
  };
  s.onDraftStart = (d) => {
    friendUi.hideCountdown();
    sfx.play('clockGo');
    friendUi.hideAll();
    select.classList.add('hidden');
    const names = seatNames(s.state.seats, s.state.players);
    draftUi.start(d, (team, seat) => names[seatOf(team, seat)], (done) => {
      if (s instanceof HostSession) void startMatch('friend', done, s.draftDone(done));
      else if ((s as GuestSession).matchInfo) void startMatch('friend', done, (s as GuestSession).matchInfo!);
      else draftOver = done;
    });
  };
  let draftOver: Draft | null = null;
  s.onMatch = (info, _seat, catchUp) => {
    if (catchUp) {
      draftUi.cancel();
      friendUi.hideAll();
      void startMatch('friend', new Draft(null), info, true);
    } else if (draftOver) void startMatch('friend', draftOver, info);
  };
  s.onEnd = (why) => leaveToMenu(why);
}

/** Out of the multiplayer game and back to the menu. */
function leaveToMenu(why: string) {
  const s = net;
  net = null;
  if (s) saveRejoin(null);
  netPeer?.close();
  netPeer = null;
  if (s) draftUi.cancel();
  myTeam = 0;
  friendUi.hideCountdown();
  stopEndSong();
  settingsPanel.classList.add('hidden');
  app.classList.add('hidden');
  app.classList.remove('net');
  endScreen.hide();
  world = null;
  select.classList.remove('hidden');
  if (why) {
    friendUi.showFriend(false, shownName(profile));
    friendUi.error(why);
  } else friendUi.showMenu();
}

/** Guests: the connection dropped. Keep trying for a little while. */
function retryLink(g: GuestSession, code: string) {
  if (net !== g) return; // we left on purpose
  let tries = 6;
  const again = () => {
    if (net !== g) return;
    joinPeer(code, 6000).then(
      (link: Link) => {
        if (net === g) g.reconnect(link);
        else link.close();
      },
      () => {
        if (--tries > 0) setTimeout(again, 2000);
        else leaveToMenu('Lost the connection to the host');
      },
    );
  };
  hud.toast('Connection lost: trying to get back in', '#ffb4b4');
  again();
}

function startGuest(link: Link, code: string, token: string) {
  const g = new GuestSession(link, token, shownName(profile));
  useSession(g);
  g.onLinkLost = () => retryLink(g, code);
  saveRejoin({ code, token });
  g.state.code = code;
  friendUi.showLobby(g);
}

friendUi.onHost = () => {
  friendUi.busy(true);
  hostPeer().then(
    (peer) => {
      friendUi.busy(false);
      netPeer = peer;
      const h = new HostSession(peer.code, shownName(profile));
      peer.onLink = (link) => h.addLink(link);
      useSession(h);
      friendUi.showLobby(h);
    },
    (err: Error) => {
      friendUi.busy(false);
      friendUi.error(err.message);
    },
  );
};
const joinWith = (code: string, token: string) => {
  friendUi.busy(true);
  joinPeer(code).then(
    (link) => {
      friendUi.busy(false);
      startGuest(link, code, token);
    },
    (err: Error) => {
      friendUi.busy(false);
      friendUi.error(err.message);
    },
  );
};
friendUi.onJoin = (code) => joinWith(code, Math.random().toString(36).slice(2) + Date.now().toString(36));
friendUi.onRejoin = () => {
  const r = savedRejoin();
  if (r) joinWith(r.code, r.token);
};
friendUi.onBack = () => friendUi.showMenu();
friendUi.onStart = () => (net as HostSession | null)?.startCountdown?.();
friendUi.onProfile = () => openSettings('profile');
friendUi.onLeaveLobby = () => {
  net?.leave();
};
$<HTMLButtonElement>('#btn-friend').addEventListener('click', () => friendUi.showFriend(!!savedRejoin(), shownName(profile)));

/** Play → the draft (bans, then picks) → the match. Practice and the tutorial only pick your hero. */
function startDraft(m: Mode) {
  select.classList.add('hidden');
  const seat = m === 'bots' ? Math.floor(Math.random() * 3) : 0;
  const order: DraftStep[] | undefined = m === 'bots' ? undefined : [{ kind: 'pick', team: myTeam }];
  const d = new Draft({ team: myTeam, seat }, order);
  if (devPick) {
    // Test scripts: finish the draft at once with the requested hero.
    while (!d.done) {
      if (d.humanTurn()) d.choose(d.current!.kind === 'ban' ? null : d.allowed(devPick) ? devPick : d.choices()[0]);
      else d.update(DRAFT_TIME.bot + 0.01);
    }
  }
  const me = shownName(profile);
  draftUi.start(d, (team, s) => (team === myTeam && s === seat ? me : botName(seatOf(team, s))), (done) => startMatch(m, done));
}

const lanes = $<HTMLElement>('#lane-pick');
for (const l of LANE_IDS) {
  const b = document.createElement('button');
  b.textContent = l[0].toUpperCase() + l.slice(1);
  b.classList.toggle('picked', l === pickedLane);
  b.addEventListener('click', () => {
    pickedLane = l;
    lanes.querySelectorAll('button').forEach((x) => x.classList.toggle('picked', x === b));
  });
  lanes.appendChild(b);
}

const diffs = $<HTMLElement>('#diff-pick');
for (const d of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
  const b = document.createElement('button');
  b.textContent = d[0].toUpperCase() + d.slice(1);
  b.classList.toggle('picked', d === pickedDifficulty);
  b.addEventListener('click', () => {
    pickedDifficulty = d;
    try {
      localStorage.setItem('shrinefall-difficulty', d);
    } catch {
      /* storage unavailable */
    }
    diffs.querySelectorAll('button').forEach((x) => x.classList.toggle('picked', x === b));
  });
  diffs.appendChild(b);
}

$<HTMLButtonElement>('#btn-play').addEventListener('click', () => startDraft('bots'));
$<HTMLButtonElement>('#btn-practice').addEventListener('click', () => startDraft('practice'));
$<HTMLButtonElement>('#btn-tutorial').addEventListener('click', () => startDraft('tutorial'));

// ------------------------------------------------------------- match setup

/** Turn the draft into the 3v3: the human's seat gets their lane, bots take the other lanes. */
function buildSlots(d: Draft): PlayerSlot[] {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) {
    const lanePool = [...LANE_IDS].sort(() => Math.random() - 0.5);
    if (team === myTeam) lanePool.splice(lanePool.indexOf(pickedLane), 1);
    d.picks[team].forEach((heroId, seat) => {
      const human = d.human?.team === team && d.human.seat === seat;
      slots.push(
        human
          ? { team, heroId, controller: 'human', lane: pickedLane }
          : { team, heroId, controller: 'bot', lane: lanePool.shift()!, difficulty: pickedDifficulty },
      );
    });
  }
  return slots;
}

const hud = new Hud(app);
/** The last match's mode and line-ups, for "play again with the same heroes". */
let lastMatch: { m: Mode; d: Draft } | null = null;
const endScreen = new EndScreen(
  app,
  () => {
    stopEndSong();
    if (lastMatch) void startMatch(lastMatch.m, lastMatch.d);
  },
  () => {
    stopEndSong();
    if (net) {
      net.leave();
      return;
    }
    app.classList.add('hidden');
    select.classList.remove('hidden');
    world = null;
  },
);
hud.onGameOver = (w) => playEnding(w);

/**
 * The end of a match: everything stops, the camera glides to the fallen Shrine, it blows apart,
 * the result comes up, and then the end screen.
 */
let ending = false;
/** The song behind the end of the match, kept so leaving the end screen can stop it. */
let endSong: ReturnType<Sfx['play']> = null;
function stopEndSong() {
  sfx.stop(endSong);
  endSong = null;
}
function playEnding(w: World) {
  ending = true;
  app.classList.add('ending');
  settingsPanel.classList.add('hidden');
  itemsUi.toggleShop(false);
  const show = () => {
    $<HTMLElement>('#victory').classList.add('hidden');
    endScreen.show(w, myTeam, myHeroId);
  };
  const won = w.winner === myTeam;
  // The same song for both teams, from the moment the match ends and the camera sets off for the Shrine.
  endSong = sfx.play('endSong', 0.8);
  const banner = () => {
    const v = $<HTMLElement>('#victory');
    v.classList.remove('hidden');
    v.classList.toggle('lost', !won);
    v.querySelector('b')!.textContent = won ? 'VICTORY' : 'DEFEAT';
    v.querySelector('small')!.textContent = `${TEAM_NAMES[w.winner as Team]} destroyed the enemy Shrine`;
  };
  if (!(renderer instanceof Renderer3D)) {
    sfx.play('shrineBoom');
    banner();
    setTimeout(show, 2200);
    return;
  }
  const flash = $<HTMLElement>('#end-flash');
  renderer.playEnding(w, {
    onBoom: () => {
      sfx.play('shrineBoom');
      flash.classList.remove('go');
      void flash.offsetWidth;
      flash.classList.add('go');
      buzz([120, 50, 200], 0);
    },
    onBanner: banner,
    onDone: show,
  });
}

const sfx = new Sfx();
const sfxLoaded = sfx.load();
const itemsUi = new ItemsUi(
  app,
  (cmd) => world?.enqueue(cmd),
  () => (world && renderer ? { w: world, me: world.unit(myHeroId)!, team: myTeam, terrain: renderer.terrain } : null),
  (slot) => {
    if (input) input.wardSlot = slot;
    if (renderer) renderer.wardMode = slot;
  },
  (text) => hud.toast(text, '#ffd23f'),
);

// Team buttons.
const onTap = (sel: string, fn: () => void) =>
  $<HTMLElement>(sel).addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
onTap('#btn-glyph', () => world?.enqueue({ type: 'glyph', unitId: myHeroId }));
// Pings: open the menu, pick a ping, then tap the map or minimap to place it.
const pingMenu = $<HTMLElement>('#ping-menu');
const pingBtn = $<HTMLElement>('#btn-ping');
onTap('#btn-ping', () => {
  if (input?.pingKind) {
    input.pingKind = null;
    pingBtn.classList.remove('armed');
    return;
  }
  pingMenu.classList.toggle('hidden');
});
pingMenu.querySelectorAll<HTMLElement>('[data-ping]').forEach((b) =>
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!input) return;
    input.pingKind = b.dataset.ping as PingKind;
    input.onPingPlaced = () => pingBtn.classList.remove('armed');
    pingMenu.classList.add('hidden');
    pingBtn.classList.add('armed');
    hud.toast('Tap the map or minimap to place the ping', '#f59e0b');
  }),
);
onTap('#btn-buyback', () => world?.enqueue({ type: 'buyback', unitId: myHeroId }));
// ------------------------------------------------------------- settings

const settingsPanel = $<HTMLElement>('#settings');
interface Settings {
  autoAttack: boolean;
  sound: boolean;
  autoLearn: boolean;
  leftHanded: boolean;
  vibrate: boolean;
  joystick: 'S' | 'M' | 'L';
  zoom: number;
  graphics: '3d' | '2d';
  /** The last preset chosen. */
  quality: Quality;
  /** What is actually in use: a preset's values, possibly changed one by one. */
  gfx: GraphicsOptions;
}
const settings: Settings = { autoAttack: true, sound: true, autoLearn: false, leftHanded: false, vibrate: true, joystick: 'M', zoom: 1, graphics: '3d', quality: 'medium', gfx: { ...PRESETS.medium } };
const JOY_RADIUS = { S: 38, M: 58, L: 84 };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('shrinefall-settings') ?? '{}'));
} catch {
  /* storage unavailable */
}
if (!PRESETS[settings.quality]) settings.quality = 'medium';
settings.gfx = { ...PRESETS[settings.quality], ...settings.gfx };
const saveSettings = () => {
  try {
    localStorage.setItem('shrinefall-settings', JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
};
const autoBox = $<HTMLInputElement>('#set-autoattack');
const soundBox = $<HTMLInputElement>('#set-sound');
autoBox.checked = settings.autoAttack;
soundBox.checked = settings.sound;
sfx.setMuted(!settings.sound);
autoBox.addEventListener('change', () => {
  settings.autoAttack = autoBox.checked;
  saveSettings();
  world?.enqueue({ type: 'setAutoAttack', unitId: myHeroId, enabled: settings.autoAttack });
});
soundBox.addEventListener('change', () => {
  settings.sound = soundBox.checked;
  saveSettings();
  sfx.setMuted(!settings.sound);
});
const bindToggle = (sel: string, key: 'autoLearn' | 'leftHanded' | 'vibrate', apply: () => void) => {
  const box = $<HTMLInputElement>(sel);
  box.checked = settings[key];
  box.addEventListener('change', () => {
    settings[key] = box.checked;
    saveSettings();
    apply();
  });
};
/** Push the current settings into the running game. */
function applySettings() {
  app.classList.toggle('lefty', settings.leftHanded);
  if (input) {
    input.leftHanded = settings.leftHanded;
    input.setJoystickSize(JOY_RADIUS[settings.joystick]);
  }
  renderer?.setZoomFactor(settings.zoom);
  world?.enqueue({ type: 'setAutoLearn', unitId: myHeroId, enabled: settings.autoLearn });
  document.querySelectorAll<HTMLElement>('#set-joy button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.joystick));
  document.querySelectorAll<HTMLElement>('#set-gfx button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.graphics));
  const same = (a: GraphicsOptions, b: GraphicsOptions) => (Object.keys(a) as (keyof GraphicsOptions)[]).every((k) => a[k] === b[k]);
  const preset = (Object.keys(PRESETS) as Quality[]).find((q) => same(PRESETS[q], settings.gfx));
  document.querySelectorAll<HTMLElement>('#set-quality button').forEach((b) => b.classList.toggle('on', b.dataset.v === preset));
  $<HTMLElement>('#gfx-preset-note').textContent = preset ? 'Sets everything below. Low saves the most battery' : 'Custom: you changed the options below';
  for (const key of ['fps', 'sharpness', 'shadows', 'shadowRate', 'detail'] as const) {
    document.querySelectorAll<HTMLElement>(`#set-${key} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === String(settings.gfx[key])));
  }
  $<HTMLInputElement>('#set-smoothing').checked = settings.gfx.smoothing;
  $<HTMLElement>('#settings').classList.toggle('view-2d', settings.graphics === '2d');
}

/** 3D view, or the lighter top-down 2D view. Falls back to 2D if WebGL isn't available. */
let gfxNote = '';
function makeRenderer(map: World['map']): Renderer {
  // The old view gives up its graphics memory. Its canvas can't be reused after that (and a new
  // canvas is the only way to change Smooth edges), so the next view gets a fresh one.
  if (renderer instanceof Renderer3D) {
    renderer.destroy();
    const fresh = canvas3d.cloneNode() as HTMLCanvasElement;
    canvas3d.replaceWith(fresh);
    canvas3d = fresh;
  }
  if (settings.graphics === '3d') {
    try {
      canvas3d.classList.remove('hidden');
      const r = new Renderer3D(canvas, canvas3d, map, settings.gfx);
      // Animation sounds (Iron Hide, falling armor) fade with distance from the camera.
      r.sound = (name, x, y, volume) => {
        const d = Math.hypot(x - r.camX, y - r.camY);
        sfx.play(name as SoundName, volume * (d < 22 ? 1 : Math.max(0, 1 - (d - 22) / 25)));
      };
      showGfx('3D');
      return r;
    } catch (err) {
      gfx3dFailed(err);
    }
  }
  canvas3d.classList.add('hidden');
  if (settings.graphics === '2d') showGfx('2D');
  return new Renderer(canvas, map);
}
function showGfx(view: string) {
  $<HTMLElement>('#gfx-status').textContent = `Showing: ${view}${gfxNote ? ` (${gfxNote})` : ''} · v${__VERSION__} build ${__BUILD__}`;
}
/** 3D couldn't start or crashed: carry on in 2D and say why. */
function gfx3dFailed(err: unknown) {
  console.warn('3D view unavailable, using 2D', err);
  gfxNote = `3D failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 140);
  canvas3d.classList.add('hidden');
  showGfx('2D');
  hud.toast(`3D view could not start, showing 2D. ${gfxNote}`, '#ffb4b4');
}
let forceDraw = false;
/** Rebuild the view (after changing 3D/2D or the quality), keeping the camera where it was. */
async function rebuildView() {
  if (!world || !renderer) return;
  showLoading('Applying graphics', 70);
  await nextPaint();
  const prev = renderer;
  renderer = makeRenderer(world.map);
  renderer.setZoomFactor(settings.zoom);
  renderer.camX = prev.camX;
  renderer.camY = prev.camY;
  if (input) input.renderer = renderer;
  forceDraw = true; // show the new view even while paused
  loadingEl.classList.add('done');
}
document.querySelectorAll<HTMLElement>('#set-quality button').forEach((b) =>
  b.addEventListener('click', () => {
    settings.quality = b.dataset.v as Quality;
    settings.gfx = { ...PRESETS[settings.quality] };
    saveSettings();
    applySettings();
    if (settings.graphics === '3d') void rebuildView();
  }),
);
// One option at a time. Frame rate and shadow updates apply at once; the rest need a rebuilt view.
for (const key of ['fps', 'sharpness', 'shadows', 'shadowRate', 'detail'] as const) {
  document.querySelectorAll<HTMLElement>(`#set-${key} button`).forEach((b) =>
    b.addEventListener('click', () => {
      if (String(settings.gfx[key]) === b.dataset.v) return;
      (settings.gfx as unknown as Record<string, unknown>)[key] = key === 'fps' ? Number(b.dataset.v) : b.dataset.v;
      saveSettings();
      applySettings();
      if (key === 'shadowRate') (renderer as Renderer3D | null)?.setShadowRate?.(settings.gfx.shadowRate);
      else if (key !== 'fps' && settings.graphics === '3d') void rebuildView();
    }),
  );
}
$<HTMLInputElement>('#set-smoothing').addEventListener('change', (e) => {
  settings.gfx.smoothing = (e.target as HTMLInputElement).checked;
  saveSettings();
  if (settings.graphics === '3d') void rebuildView();
});
function showSettingsTab(tab: string) {
  document.querySelectorAll<HTMLElement>('.set-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>('.set-pages section').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== tab));
}
function openSettings(tab: string) {
  showSettingsTab(tab);
  refreshProfile();
  settingsPanel.classList.remove('hidden');
}
document.querySelectorAll<HTMLElement>('.set-tabs button').forEach((b) => b.addEventListener('click', () => showSettingsTab(b.dataset.tab!)));

// Profile: the name can only be edited from the start menu, never during a match.
const nameModal = $<HTMLElement>('#name-modal');
const nameInput = $<HTMLInputElement>('#name-input');
const editNameBtn = $<HTMLButtonElement>('#btn-edit-name');
$<HTMLElement>('#set-id').textContent = `ovra-${profile.id}`;
function refreshProfile() {
  $<HTMLElement>('#set-name').textContent = shownName(profile);
  editNameBtn.disabled = !app.classList.contains('hidden');
}
refreshProfile();
editNameBtn.addEventListener('click', () => {
  nameInput.value = shownName(profile);
  nameModal.classList.remove('hidden');
  nameInput.focus();
  nameInput.select();
});
const closeNameModal = () => {
  nameInput.blur(); // puts the phone's keyboard away
  nameModal.classList.add('hidden');
};
$<HTMLElement>('#name-cancel').addEventListener('click', closeNameModal);
// Save button, or Enter on the keyboard.
nameModal.querySelector('form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  setDisplayName(profile, nameInput.value, phoneStorage);
  refreshProfile();
  friendUi.showName(shownName(profile));
  closeNameModal();
});
document.querySelectorAll<HTMLElement>('#set-gfx button').forEach((b) =>
  b.addEventListener('click', () => {
    settings.graphics = b.dataset.v as Settings['graphics'];
    saveSettings();
    void rebuildView();
    applySettings();
  }),
);
bindToggle('#set-autolearn', 'autoLearn', applySettings);
bindToggle('#set-lefty', 'leftHanded', applySettings);
bindToggle('#set-vibrate', 'vibrate', () => {});
document.querySelectorAll<HTMLElement>('#set-joy button').forEach((b) =>
  b.addEventListener('click', () => {
    settings.joystick = b.dataset.v as Settings['joystick'];
    saveSettings();
    applySettings();
    input?.previewJoystick();
  }),
);
const zoomInput = $<HTMLInputElement>('#set-zoom');
settings.zoom = Math.max(1, settings.zoom); // saved by older versions, which could zoom out further
zoomInput.value = String(settings.zoom);
zoomInput.addEventListener('input', () => {
  settings.zoom = Number(zoomInput.value);
  saveSettings();
  renderer?.setZoomFactor(settings.zoom);
});

/** Short vibration (Android; iPhones ignore it). */
let lastBuzz = 0;
function buzz(pattern: number | number[], minGap = 250) {
  if (!settings.vibrate || !navigator.vibrate) return;
  const now = performance.now();
  if (now - lastBuzz < minGap) return;
  lastBuzz = now;
  navigator.vibrate(pattern);
}

// Settings can be opened from the start menu, before any match has set them up.
applySettings();
showGfx(settings.graphics.toUpperCase());

// ------------------------------------------------------------- pause / surrender
let paused = false;
const pauseEl = $<HTMLElement>('#pause');
const surrenderBtn = $<HTMLElement>('#btn-surrender');
function setPaused(p: boolean) {
  paused = p;
  pauseEl.classList.toggle('hidden', !p);
  surrenderBtn.classList.remove('confirm');
  surrenderBtn.textContent = net ? 'Leave match' : 'Surrender';
}
setPaused(false);

const statsPanel = $<HTMLElement>('#stats');
const scorePanel = $<HTMLElement>('#scoreboard');
onTap('#btn-settings', () => {
  refreshProfile();
  settingsPanel.classList.toggle('hidden');
});
$<HTMLElement>('#btn-menu-settings').addEventListener('click', () => openSettings('profile'));
// On the start menu the panel doesn't cover everything: a tap beside it just closes it.
select.addEventListener(
  'click',
  (e) => {
    if (settingsPanel.classList.contains('hidden')) return;
    e.stopPropagation();
    settingsPanel.classList.add('hidden');
  },
  { capture: true },
);
onTap('#btn-stats', () => statsPanel.classList.toggle('hidden'));
onTap('#topbar', () => scorePanel.classList.toggle('hidden'));
onTap('#btn-pause', () => (net ? net.setPaused(true) : setPaused(true)));
onTap('#btn-resume', () => (net ? net.setPaused(false) : setPaused(false)));
onTap('#btn-surrender', () => {
  if (!surrenderBtn.classList.contains('confirm')) {
    surrenderBtn.classList.add('confirm');
    surrenderBtn.textContent = net ? 'Tap again to leave' : 'Tap again to surrender';
    return;
  }
  if (net) {
    net.leave();
    return;
  }
  world?.applyCommand({ type: 'surrender', unitId: myHeroId });
  if (world) hud.update(world, world.unit(myHeroId)!, myTeam);
  setPaused(false);
});
document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) =>
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $<HTMLElement>(`#${b.dataset.close}`).classList.add('hidden');
  }),
);
// Panels swallow touches so they don't move the hero underneath.
for (const p of [settingsPanel, statsPanel, scorePanel, pauseEl]) p.addEventListener('pointerdown', (e) => e.stopPropagation());
// Every gesture (re)unlocks audio: iOS only starts/resumes sound inside a user gesture,
// and may suspend it again after a call, a notification or switching apps.
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
  window.addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true });
}
// Any UI tap gets a soft click.
app.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button')) sfx.play('click', 0.6);
});

/** Announcements for big moments. */
function announceMega(team: Team) {
  hud.toast(team === myTeam ? 'All enemy barracks are down: your creeps are now Mega Creeps!' : 'All your barracks are down: the enemy now sends Mega Creeps!', team === myTeam ? '#ffd23f' : '#ff7b7f');
}

function announce(w: World, events: GameEvent[]) {
  const name = (id: number) => {
    const u = w.unit(id);
    return u?.hero ? HERO_DEFS[u.hero.defId].name : 'Someone';
  };
  for (const e of events) {
    if (e.type === 'megaCreeps') announceMega(e.team);
    if (e.type === 'goldLost') continue;
    if (e.type === 'wardenMove') continue;
    if (e.type === 'ping') {
      if (e.ping.team !== myTeam) continue;
      const st = PING_STYLE[e.ping.kind];
      hud.toast(`${name(e.ping.fromId)}: ${st.label}`, st.color);
      sfx.play('ping');
      continue;
    }
    if (e.type === 'announce') {
      if (hud.announce(w, e, myTeam)) sfx.play(w.unit(e.unitId)?.team === myTeam ? 'levelUp' : 'glyph', 0.6);
      continue;
    }
    if (e.type === 'bossKilled') {
      // Told to everyone, enemies included: who landed the killing blow, and for which team.
      const killer = e.killerId !== null ? w.unit(e.killerId) : undefined;
      const who = killer?.hero ? `${name(killer.id)} (${TEAM_NAMES[e.team as Team]})` : e.team === 2 ? null : TEAM_NAMES[e.team as Team];
      hud.toast(`${who ? `${who} slew the Warden` : 'The Warden fell'}. It dropped a revive charm: anyone can grab it!`, e.team === myTeam ? '#ffd23f' : e.team === 2 ? '#c4b5fd' : '#ff7b7f');
    } else if (e.type === 'itemPickUp' && e.itemId === 'wardenCharm') {
      const u = w.unit(e.unitId);
      hud.toast(`${name(e.unitId)} took the Warden's charm`, u?.team === myTeam ? '#ffd23f' : '#ff7b7f');
    } else if (e.type === 'itemExpire' && e.itemId === 'wardenCharm') {
      if (e.unitId === myHeroId || w.unit(e.unitId)?.team === myTeam) hud.toast(`The Warden's charm crumbled`, '#c4b5fd');
    } else if (e.type === 'rune') {
      const u = w.unit(e.unitId);
      if (u?.team === myTeam) hud.toast(`${name(e.unitId)} picked up ${RUNE_INFO[e.kind as RuneKind].name}`, RUNE_INFO[e.kind as RuneKind].color);
    } else if (e.type === 'glyph') {
      hud.toast(e.team === myTeam ? 'Tower shield activated!' : 'Enemy activated their tower shield', '#8cc4ff');
    } else if (e.type === 'buyback') {
      hud.toast(`${name(e.unitId)} bought back!`, '#ffd23f');
    } else if (e.type === 'revive') {
      hud.toast(`${name(e.unitId)} revived by the charm`, '#ffd23f');
    } else if (e.type === 'death') {
      const u = w.unit(e.unitId);
      if (u?.structure && u.structure.tier !== 'fountain') {
        const tier = { tower1: 'tier-1 tower', tower2: 'tier-2 tower', tower3: 'tier-3 tower', barracks: 'barracks', shrineTower: 'shrine tower', shrine: 'Shrine' }[u.structure.tier as string];
        hud.toast(`${TEAM_NAMES[u.team as Team]} ${u.structure.lane ?? ''} ${tier} destroyed`, u.team === myTeam ? '#ff7b7f' : '#6fb0ff');
      } else if (u?.hero) {
        hud.killFeed(w, u, w.unit(e.killerId), myHeroId);
      }
    }
  }
}

type Mode = 'bots' | 'practice' | 'tutorial' | 'friend';
let tutorial: Tutorial | null = null;
const practicePanel = $<HTMLElement>('#practice');

// Practice tools (offline only: they change the simulation directly).
practicePanel.querySelectorAll<HTMLElement>('[data-cheat]').forEach((b) =>
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const me = world?.unit(myHeroId);
    if (!world || !me?.hero) return;
    const h = me.hero;
    switch (b.dataset.cheat) {
      case 'level':
        if (h.level < 15) world.giveXp(me, XP_TABLE[h.level] - h.xp);
        break;
      case 'gold':
        h.gold += 1000;
        break;
      case 'refresh':
        for (const a of h.abilities) a.cooldown = 0;
        for (const it of h.items) if (it) it.cooldown = 0;
        me.hp = me.maxHp;
        me.mana = me.maxMana;
        break;
      case 'dummy':
        spawnDummy(world, me.x + Math.cos(me.facing) * 6, me.y + Math.sin(me.facing) * 6);
        break;
    }
  }),
);

/** `info`: a multiplayer match. `catchUp`: we dropped out and are replaying it to get back in. */
async function startMatch(m: Mode, d: Draft, info?: MatchInfo, catchUp = false) {
  showLoading('Preparing the battlefield', 55);
  await nextPaint();
  ending = false;
  app.classList.remove('ending');
  $<HTMLElement>('#victory').classList.add('hidden');
  screenFx.clear();
  endScreen.reset();
  lastMatch = { m, d };
  select.classList.add('hidden');
  app.classList.remove('hidden');
  app.classList.toggle('net', !!info);
  const slots = info ? info.slots : m === 'bots' ? buildSlots(d) : [{ team: myTeam, heroId: d.picks[myTeam][0], controller: 'human' as const, lane: pickedLane }];
  // Vs bots: a 30 s warm-up (the clock counts up from -0:30) to shop and walk to lane before creeps come.
  world = new World({ seed: info ? info.seed : (Date.now() & 0xffff) + 1, slots, warmup: m === 'bots' || info ? WARMUP_SECONDS : 0 });
  if (info && net) myTeam = net.mySeat < 3 ? 0 : 1;
  // Who plays each hero, in the order of the world's heroes (which is seat order).
  const me = shownName(profile);
  setHeroNames(world.heroes, info && net ? seatNames(info.seats, net.state.players) : slots.map((s, i) => (s.controller === 'human' ? me : botName(i))));
  if (info && net) {
    net.attachWorld(world);
    if (catchUp) {
      // Rebuild the match by replaying every turn so far, a slice at a time.
      const w = world;
      const total = () => net!.ticksAvailable(w) + w.tick;
      while (net && net.ticksAvailable(w) > 3) {
        for (let i = 0; i < 300 && net.ticksAvailable(w) > 0; i++) {
          net.beforeStep(w);
          w.step();
        }
        showLoading('Getting back into the match', Math.round((w.tick / total()) * 100));
        await nextPaint();
      }
      if (!net || world !== w) return;
    }
  }
  if (m === 'bots' || (info && !catchUp)) hud.toast(`Creeps arrive in ${WARMUP_SECONDS} s: buy items and head to your lane`, '#ffd23f');
  practicePanel.classList.toggle('hidden', m !== 'practice');
  tutorial?.hide();
  tutorial = m === 'tutorial' ? new Tutorial($<HTMLElement>('#tutorial'), () => (tutorial = null)) : null;
  myHeroId = info && net ? world.heroes[net.mySeat].id : world.heroes.find((h) => h.hero!.controller === 'human')!.id;
  renderer = makeRenderer(world.map);
  input?.destroy();
  input = new Input(canvas, renderer, () => world!, () => myHeroId, app);
  input.onWardPlaced = () => {
    itemsUi.placingSlot = null;
  };
  sfx.unlock();
  const mm = renderer.minimapRect();
  $<HTMLElement>('#btn-glyph').style.top = `${mm.y + mm.size + 10}px`;
  $<HTMLElement>('#btn-ping').style.top = `${mm.y + mm.size + 58}px`;
  $<HTMLElement>('#ping-menu').style.top = `${mm.y + mm.size + 10}px`;
  hud.setHero(world.unit(myHeroId)!);
  world.enqueue({ type: 'setAutoAttack', unitId: myHeroId, enabled: settings.autoAttack });
  settingsPanel.classList.add('hidden');
  showSettingsTab('general');
  statsPanel.classList.add('hidden');
  scorePanel.classList.add('hidden');
  setPaused(false);
  input.onTip = (slot) => hud.showAbilityTip(world!.unit(myHeroId)!, slot);
  applySettings();
  itemsUi.reset();
  void enterImmersive();
  showLoading('Ready', 100);
  await nextPaint();
  loadingEl.classList.add('done');
  if (info && !catchUp) net?.ready();
  if (info && net?.paused) setPaused(true);
}

setupLandscape($<HTMLElement>('#root'), () => {
  renderer?.resize();
  if (renderer) {
    const mm = renderer.minimapRect();
    $<HTMLElement>('#btn-glyph').style.top = `${mm.y + mm.size + 10}px`;
  $<HTMLElement>('#btn-ping').style.top = `${mm.y + mm.size + 58}px`;
  $<HTMLElement>('#ping-menu').style.top = `${mm.y + mm.size + 10}px`;
  }
});

// ------------------------------------------------------------- loop

let lastTurnSeen = 0;
const netWaitEl = $<HTMLElement>('#net-wait');
function showNetWait(text: string) {
  netWaitEl.classList.toggle('hidden', !text);
  if (text) netWaitEl.textContent = text;
}

let acc = 0;
let last = performance.now();
let lastDraw = 0;
function frame(now: number) {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  if (paused || ending) acc = 0;
  // Battery: never draw faster than the quality's frame rate (phones can refresh at 120 Hz),
  // and don't redraw a paused game.
  const fps = settings.gfx.fps;
  const draw = forceDraw || (!paused && now - lastDraw >= 1000 / fps - 4);
  forceDraw = false;
  if (world && renderer && input && !draw) {
    requestAnimationFrame(frame);
    return;
  }
  if (draw) lastDraw = now;
  if (world && renderer && input) {
    if (net) {
      // Multiplayer: we may only simulate turns the host has sent. Behind by a lot? Hurry to catch up.
      input.flush(world);
      const have = net.ticksAvailable(world);
      if (have > 6 && !paused) acc += Math.min(have - 6, 30) * DT;
      if (have <= 0) {
        acc = Math.min(acc, DT);
        if (now - lastTurnSeen > 1500 && !paused && world.winner === null) showNetWait(world.tick === 0 ? 'Waiting for everyone to load' : 'Waiting for the host');
      } else {
        lastTurnSeen = now;
        showNetWait('');
      }
    }
    while (acc >= DT && (!net || net.ticksAvailable(world) > 0)) {
      if (net) net.beforeStep(world);
      else input.flush(world);
      const before = world.time;
      world.step();
      net?.afterStep(world);
      // The war horn, three seconds before the battle begins.
      if (before < -3 && world.time >= -3) sfx.play('matchHorn');
      if (before < 0 && world.time >= 0) hud.toast('The battle begins: creeps are on their way!', '#ffd23f');
      renderer.pushEvents(world, world.events, myHeroId);
      tutorial?.update(world, world.unit(myHeroId)!);
      playEvents(sfx, world, world.events, myHeroId, myTeam, { x: renderer.camX, y: renderer.camY });
      announce(world, world.events);
      screenFx.onEvents(world, world.events, myHeroId);
      for (const e of world.events) {
        if (e.type === 'attack' && e.targetId === myHeroId && world.unit(e.sourceId)?.kind === 'hero') buzz(20);
        else if (e.type === 'damage' && e.targetId === myHeroId) buzz(35);
        else if (e.type === 'death' && e.unitId === myHeroId) buzz([90, 40, 140], 0);
        else if (e.type === 'death' && e.killerId === myHeroId && world.unit(e.unitId)?.hero) buzz([40, 30, 40], 0);
      }
      acc -= DT;
    }
    const me = world.unit(myHeroId)!;
    if (tutorial) {
      if (input.peeking) tutorial.peeked = true;
      renderer.marker = tutorial.marker?.(world, me) ?? null;
    } else renderer.marker = null;
    // Back from the dead (or done peeking): camera returns to the hero.
    if (me.alive && renderer.freeCamera && !input.peeking && !ending) renderer.follow();
    try {
      renderer.render(world, acc / DT, me, myTeam, input.aim);
    } catch (err) {
      if (!(renderer instanceof Renderer3D)) throw err;
      gfx3dFailed(err);
      const prev = renderer;
      renderer = new Renderer(canvas, world.map);
      renderer.setZoomFactor(settings.zoom);
      renderer.camX = prev.camX;
      renderer.camY = prev.camY;
      input.renderer = renderer;
    }
    if (!ending) screenFx.frame(me);
    endScreen.record(world);
    hud.update(world, me, myTeam);
    if (!statsPanel.classList.contains('hidden')) hud.updateStats(world, me);
    if (!scorePanel.classList.contains('hidden')) hud.updateScoreboard(world, myTeam, myHeroId);
    itemsUi.update();
  } else acc = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for console / automated tests.
(window as unknown as { game: unknown }).game = { get world() { return world; }, get heroId() { return myHeroId; }, get renderer() { return renderer; }, endScreen };
