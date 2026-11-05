// Dev-only close-up preview of hero animations (not part of the game build).
import * as THREE from 'three';
import { model } from '../client/three/models';
import { Fx3D } from '../client/three/fx';
import { AnimCtx, animateHero, heroAttack, heroCast, heroCorpse, newAnim, Corpse, buffFx } from '../client/three/hero-anims';
import type { HeroId } from '../sim';
import { SpellFx } from '../client/three/spell-fx';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const W = 900, H = 600;
const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
gl.setSize(W, H);
gl.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2018);
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x3a4a30, 1.6));
const sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
sun.position.set(10, 20, 12);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6b5a45 }));
scene.add(ground);
const cam = new THREE.PerspectiveCamera(35, W / H, 0.5, 200);
const fx = new Fx3D(scene, () => 0);

/** Triangles per model (for checking the phone budget). */
(window as any).tris = (key: string) => {
  let n = 0;
  model(key).traverse((c) => {
    const g = (c as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
};
(window as any).run = (hero: HeroId, scenario: string, t: number, view = 'front', slotArg = 0) => {
  for (const c of [...scene.children]) if (c.userData.hero) scene.remove(c);
  const o = model(`hero:${hero}`);
  o.userData.hero = true;
  o.scale.setScalar(2);
  scene.add(o);
  const jn: any = {};
  for (const n of ['rig', 'torso', 'head', 'legL', 'legR', 'armL', 'armR', 'weapon']) { const x = o.getObjectByName(n); if (x) jn[n] = x; }
  const u: any = { id: 1, x: 0, y: 0, px: 0, py: 0, facing: 0, stunTimer: 0, dash: null, hp: 100, maxHp: 100, buffs: [], hero: { defId: hero, lastCrit: false, abilities: [{ level: 1 }, { level: 1 }, { level: 1 }] }, team: 0, alive: true };
  const foe: any = { id: 2, x: 4, y: 0, alive: true };
  const world: any = { unit: (id: number) => (id === 2 ? foe : id === 1 ? u : undefined) };
  const ctx: AnimCtx = { fx, clock: 0, dt: 1 / 60, world, meId: -5, camX: 0, camY: 0, sound: () => {} };
  const a = newAnim();
  o.rotation.y = Math.PI / 2 - u.facing;
  const steps = Math.round(t * 60) + 60;
  let corpse: Corpse | null = null;
  for (let i = 0; i < steps; i++) {
    ctx.clock = i / 60;
    if (i === 60) {
      if (scenario === 'attack' || scenario === 'crit') { if (scenario === 'crit') u.hero.lastCrit = true; a.atk = 1; a.atkAt = ctx.clock; a.atkTarget = 2; a.impactDone = false; heroAttack(ctx, u, a); }
      if (scenario === 'cast') { a.cast = 1; a.castSlot = slotArg; a.castAt = ctx.clock; heroCast(ctx, u, slotArg, a); }
      if (scenario === 'stun') u.stunTimer = 5;
      if (scenario === 'die') corpse = { o, t: 0, joints: jn, kind: hero, x: 0, y: 0 };
    }
    if (scenario === 'cast' && slotArg === 2 && hero === 'orin' && i === 60 + 72) heroCast(ctx, u, -1, a);
    if (scenario === 'cast' && slotArg === 2 && hero === 'brakk' && i === 60 + 36) heroCast(ctx, u, -1, a);
    if (scenario === 'walk') { u.px = u.x - 0.15; }
    if (scenario === 'buff') u.buffs = [{ key: { orin: 'mendingFlame', kaela: 'brineVeil', grom: 'barkSkin', vexa: 'huntersRhythm', syl: 'veil', brakk: 'x' }[hero] }];
    if (corpse) { corpse.t += 1 / 60; heroCorpse(ctx, corpse); }
    else animateHero(ctx, o, jn, u, a, i / 60);
    buffFx(ctx, o, u, a);
    fx.update(1 / 60, i / 60);
  }
  const views: any = { front: [9, 3.4, 1.5], side: [0.5, 3.4, 9], game: [0, 14, 9.5], back: [-7, 3.5, 6], three: [7.2, 5.4, 7.4], hammer: [7.6, 5.0, -6.6] };
  const v = views[view];
  cam.position.set(v[0], v[1], v[2]);
  cam.lookAt(0, 2, 0);
  gl.render(scene, cam);
  return { rigY: jn.rig?.position.y, castSlot: a.castSlot, castAt: a.castAt, clock: ctx.clock };
};
/** Area spells: kind = arrowStorm | maelstrom | burnOrin | burnGrom | cataclysm | rootSnare | overgrowth | fireball | tidalWave | piercingArrow */
(window as any).area = (kind: string, t: number) => {
  for (const c of [...scene.children]) if (c.userData.hero) scene.remove(c);
  const sf = new SpellFx(() => 0);
  const src: any = { id: 1, hero: { defId: kind === 'burnGrom' || kind === 'rootSnare' || kind === 'overgrowth' ? 'grom' : kind === 'maelstrom' || kind === 'tidalWave' ? 'kaela' : kind === 'arrowStorm' || kind === 'piercingArrow' ? 'vexa' : 'orin' } };
  const w: any = { projectiles: [], skillshots: [], zones: [], blasts: [], vision: { seesPoint: () => true }, unit: (id: number) => (id === 1 ? src : undefined) };
  const zone = (k: string, r: number, d: number) => w.zones.push({ id: 5, kind: k, team: 0, sourceId: 1, x: 0, y: 0, radius: r, t: 0, duration: d });
  const blast = (k: string, r: number, d: number) => w.blasts.push({ id: 6, kind: k, team: 0, sourceId: 1, x: 0, y: 0, radius: r, t: 0, delay: d });
  if (kind === 'arrowStorm') zone('arrowStorm', 6, 3);
  if (kind === 'maelstrom') zone('maelstrom', 6, 4);
  if (kind === 'burnOrin' || kind === 'burnGrom') zone('burn', 5, 3);
  if (kind === 'cataclysm') blast('cataclysm', 5, 1.2);
  if (kind === 'rootSnare') blast('rootSnare', 3, 0.4);
  if (kind === 'overgrowth') blast('overgrowth', 9, 0.1);
  if (kind === 'fireball' || kind === 'tidalWave' || kind === 'piercingArrow') w.skillshots.push({ id: 7, kind, team: 0, sourceId: 1, x: -8, y: 0, px: -8, py: 0, dx: 1, dy: 0 });
  const ctx: AnimCtx = { fx, clock: 0, dt: 1 / 60, world: w, meId: -5, camX: 0, camY: 0, sound: () => {} };
  const steps = Math.round(t * 60);
  for (let i = 0; i < steps; i++) {
    ctx.clock = i / 60;
    for (const z of w.zones) z.t += 1 / 60;
    w.zones = w.zones.filter((z: any) => z.t < z.duration);
    for (const b of w.blasts) b.t += 1 / 60;
    w.blasts = w.blasts.filter((b: any) => b.t < b.delay);
    for (const s of w.skillshots) { s.px = s.x; s.py = s.y; s.x += 0.5; }
    sf.update(ctx, w, 0 as any, 1);
    fx.update(1 / 60, i / 60);
  }
  for (const s of w.skillshots) {
    const m = model('shot:' + s.kind);
    m.userData.hero = true;
    m.position.set(s.x, s.kind === 'tidalWave' ? 0.45 : 1.4, s.y);
    m.rotation.y = Math.atan2(s.dx, s.dy);
    scene.add(m);
  }
  fx.shake = 0;
  cam.position.set(0, 22, 17);
  cam.lookAt(0, 0, 0);
  gl.render(scene, cam);
};
(window as any).ready = true;
/** Show any model by key (e.g. 'structure:tower2:0'), seen from the given distance. */
(window as any).showModel = (key: string, dist = 22, h = 6) => {
  for (const c of [...scene.children]) if (c.userData.hero) scene.remove(c);
  const o = model(key);
  o.userData.hero = true;
  scene.add(o);
  cam.position.set(dist * 0.75, h + dist * 0.45, dist * 0.65);
  cam.lookAt(0, h * 0.6, 0);
  gl.render(scene, cam);
  let meshes = 0;
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) meshes++; });
  return meshes;
};
import { animateMonster, monsterCorpse, monsterKind } from '../client/three/monster-anims';
/** Monsters: key = 'creep:melee:0' | 'creep:ranged:1' | 'imp' | 'brute' | 'warden'; scenario idle|walk|attack|slam|die. */
(window as any).runM = (key: string, scenario: string, t: number, view = 'front', scale = 1.6) => {
  for (const c of [...scene.children]) if (c.userData.hero) scene.remove(c);
  const o = model(key);
  o.userData.hero = true;
  o.scale.setScalar(scale);
  scene.add(o);
  const jn: any = {};
  for (const n of ['rig', 'torso', 'head', 'legL', 'legR', 'armL', 'armR', 'weapon']) { const x = o.getObjectByName(n); if (x) jn[n] = x; }
  const kind = monsterKind(key)!;
  const u: any = { id: 3, x: 0, y: 0, px: 0, py: 0, facing: 0, stunTimer: 0, hp: 100, maxHp: 100, buffs: [], team: 0, alive: true };
  const ctx: AnimCtx = { fx, clock: 0, dt: 1 / 60, world: { unit: () => undefined } as any, meId: -5, camX: 0, camY: 0, sound: () => {} };
  const a = newAnim();
  o.rotation.y = Math.PI / 2;
  const steps = Math.round(t * 60) + 60;
  let corpse: any = null;
  for (let i = 0; i < steps; i++) {
    ctx.clock = i / 60;
    if (i === 60) {
      if (scenario === 'attack') { a.atkAt = ctx.clock; a.impactDone = false; }
      if (scenario === 'slam') { a.castAt = ctx.clock; a.castSlot = 9; }
      if (scenario === 'die') corpse = { o, t: 0, joints: jn, mkind: kind, x: 0, y: 0 };
    }
    if (scenario === 'slam' && i === 60 + 48) a.blastAt = ctx.clock;
    if (scenario === 'walk') u.px = u.x - 0.12;
    if (corpse) { corpse.t += 1 / 60; monsterCorpse(ctx, corpse); }
    else animateMonster(ctx, kind, o, jn, u, a, i / 60);
    fx.update(1 / 60, i / 60);
  }
  const k = key === 'warden' ? 1.6 : 1;
  const views: any = { front: [9 * k, 3.4 * k, 1.5 * k], side: [0.5, 3.4 * k, 9 * k], three: [7.2 * k, 5 * k, 6.6 * k] };
  const v = views[view];
  cam.position.set(v[0], v[1], v[2]);
  cam.lookAt(0, 1.6 * k, 0);
  gl.render(scene, cam);
  return true;
};
