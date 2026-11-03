import * as THREE from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { HeroId } from '../../sim';

/**
 * Character models made by artists (Sketchfab, CC Attribution: credited in Settings → Credits),
 * shrunk for phones and stored in public/models. Each is normalised to stand on the ground,
 * face +Z and be `height` tall (before the renderer's per-kind scale), so it can replace the
 * placeholder model for the same key. Models load in the background; until they're ready (or
 * if one fails) the game keeps using the placeholder.
 */
interface AssetDef {
  file: string;
  height: number;
  /** Clip names (exact or a regex) for standing and walking; missing ones fall back to procedural motion. */
  idle?: RegExp;
  walk?: RegExp;
  attack?: RegExp;
  /** Extra turn (radians) if the artist's model doesn't face +Z. */
  yaw?: number;
}

export const ASSETS: Record<string, AssetDef> = {
  'hero:brakk': { file: 'brakk', height: 2.7, idle: /Warrior_Idle/, walk: /Warrior_Walk/ },
  'hero:vexa': { file: 'vexa', height: 2.6, idle: /Take 001/ },
  'hero:orin': { file: 'orin', height: 2.6, idle: /Take 001/ },
  'hero:syl': { file: 'syl', height: 2.55, idle: /ActionPose/ },
  'hero:grom': { file: 'grom', height: 2.8, idle: /relax/ },
  'hero:kaela': { file: 'kaela', height: 2.6, idle: /^Idle$/, walk: /^Walk$/ },
  creep: { file: 'creep', height: 2.15, idle: /^Idle$/, walk: /^Walk$/, attack: /^Attack$/ },
  imp: { file: 'hound', height: 1.3, idle: /^Idle$/, walk: /^Walk$/ },
  brute: { file: 'golem', height: 2.1 },
  warden: { file: 'warden', height: 2.7, idle: /rigAction/ },
};

export interface Character {
  /** Put this in the scene: position/rotate/scale it like a placeholder model. */
  root: THREE.Group;
  /** The artist's model inside `root` (lean and bob it for attacks and steps). */
  body: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  idle: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
  attack: THREE.AnimationAction | null;
}

const loaded = new Map<string, { gltf: GLTF; scale: number; offset: THREE.Vector3 }>();
let loading: Promise<void> | null = null;

/**
 * Switched off (owner, 2026-11-02): the artist models lacked proper animations (Vexa shooting in
 * her idle clip, sword skeletons as ranged creeps). The game uses the placeholder models until each
 * model has a full set of clips (idle, walk, attack, cast, death) on one shared skeleton.
 */
export const ARTIST_MODELS_ENABLED = false;

/** Start loading every model (safe to call more than once). Resolves when all have loaded or failed. */
export function loadAssets(base: string): Promise<void> {
  if (!ARTIST_MODELS_ENABLED) return (loading ??= Promise.resolve());
  loading ??= Promise.all(
    Object.entries(ASSETS).map(async ([key, def]) => {
      try {
        const gltf = await new GLTFLoader().loadAsync(`${base}models/${def.file}.glb`);
        const o = gltf.scene;
        const idle = def.idle && gltf.animations.find((a) => def.idle!.test(a.name));
        if (idle) {
          // Measure in the standing pose, not the T-pose the file may be stored in.
          const mx = new THREE.AnimationMixer(o);
          mx.clipAction(idle).play();
          mx.update(0);
        }
        o.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(o, true);
        const scale = def.height / Math.max(0.01, box.max.y - box.min.y);
        const offset = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2).multiplyScalar(scale);
        o.traverse((m) => {
          const mesh = m as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.frustumCulled = false; // skinned meshes move away from their bind-pose bounds
        });
        loaded.set(key, { gltf, scale, offset });
      } catch (err) {
        console.warn('model failed to load, keeping the placeholder:', key, err);
      }
    }),
  ).then(() => undefined);
  return loading;
}

export const hasAsset = (key: string) => loaded.has(key);

/** A fresh, animated copy of the artist's model for `key`, or null (use the placeholder). */
export function character(key: string, tint?: THREE.Color): Character | null {
  const a = loaded.get(key);
  if (!a) return null;
  const def = ASSETS[key];
  const body = SkeletonUtils.clone(a.gltf.scene);
  body.scale.setScalar(a.scale);
  body.position.copy(a.offset);
  body.rotation.y = def.yaw ?? 0;
  if (tint) {
    // Team colour for units that share one model (lane creeps): a faint glow in the team's colour.
    body.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      // The bones glow white through an emission texture: dim that and shift the colour.
      mat.color = mat.color.clone().lerp(tint, 0.55);
      if ('emissive' in mat) mat.emissiveIntensity = 0.15;
      mesh.material = mat;
    });
  }
  const root = new THREE.Group();
  const lean = new THREE.Group(); // pivot at the feet for leaning
  lean.add(body);
  root.add(lean);
  if (tint) root.add(teamRing(tint));
  const clips = a.gltf.animations;
  const find = (re?: RegExp) => (re ? clips.find((c) => re.test(c.name)) : undefined);
  let mixer: THREE.AnimationMixer | null = null;
  const act = (re?: RegExp, once = false) => {
    const clip = find(re);
    if (!clip) return null;
    mixer ??= new THREE.AnimationMixer(body);
    const action = mixer.clipAction(clip);
    if (once) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
    }
    return action;
  };
  const idle = act(def.idle);
  const walk = act(def.walk);
  const attack = act(def.attack, true);
  if (idle) {
    idle.play();
    idle.time = Math.random() * idle.getClip().duration;
  }
  if (walk) {
    walk.play();
    walk.setEffectiveWeight(0);
  }
  (mixer as THREE.AnimationMixer | null)?.update(0); // apply the standing pose right away
  return { root, body: lean, mixer, idle, walk, attack };
}

/** Hero keys that have an artist model (for the headshots). */
export const heroAssetKey = (id: HeroId) => `hero:${id}`;

const ringGeo = new THREE.RingGeometry(0.4, 0.52, 32).rotateX(-Math.PI / 2);
const ringMats = new Map<number, THREE.MeshBasicMaterial>();
/** A thin ring on the ground in the team's colour (lane creeps of both teams share one model). */
function teamRing(tint: THREE.Color): THREE.Mesh {
  let m = ringMats.get(tint.getHex());
  if (!m) ringMats.set(tint.getHex(), (m = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.9, depthWrite: false })));
  const r = new THREE.Mesh(ringGeo, m);
  r.position.y = 0.06;
  r.renderOrder = 3;
  return r;
}
