# Shrinefall: project notes for Claude

Read this first. It carries the context of the earlier (cloud) sessions: what the game is,
how we work, what the owner decided, and what is still open. Details live in
`docs/DESIGN.md` (design + balance numbers), `docs/3D-PLAN.md` (3D notes) and `README.md` (controls).

## The game

Mobile 3v3 lane-strategy game in the spirit of Dota 2 (original names and art, no Dota assets).
Destroy towers → barracks → shrine towers → the enemy **Shrine**. Empty slots are bots.
Offline vs bots for now; multiplayer and app-store release later (Capacitor planned).

- **Always landscape** (on a phone held upright the whole UI is rotated, `src/client/screen.ts`).
- The owner tests on an **iPhone** through the GitHub Pages build: https://itsmoemousavi.github.io/game/
  Settings → Graphics shows `build <sha>`: ask them to check it (Safari caches old builds).
- **3D is the default view** (Three.js); 2D stays as a "low graphics" setting and as the fallback
  if WebGL fails (the reason is shown in a toast and under Settings → Graphics).

## Workflow

- Work on branch `claude/dota-like-game-design-slf3o9`; PR #1 merges it into `main`
  (`main` = last stable 2D version). Don't push to other branches or merge without being asked.
- Every push to the branch runs tests + build and deploys Pages (`.github/workflows/deploy-pages.yml`).
  **If any test fails or the runner errors, the site does not update**: check the Actions run after pushing.
- Commit messages: plain English, what changed and why. Never put model names in commits/PRs.
- The owner wants short, plain-language updates (they are not a programmer): what changed,
  what to test on the phone, what is still open. Ask before big direction changes.

## Commands

```bash
npm install
npm run dev                      # local dev server (phone on same Wi-Fi: use the printed network URL)
npm test                         # vitest (sim unit tests + full bot matches; ~2 min)
npm run build
npx tsc --noEmit
npx vite-node scripts/simulate.ts [seed] [minutes]           # headless all-bot match log
npx vite-node scripts/hero-winrates.ts [firstSeed] [matches] # random 3v3 bot lineups → win % per hero
python3 scripts/tune-hero.py 'vexa.baseDamage=35' 'brakk.ironHide.block=[5, 8, 11, 14]'   # edit hero numbers
```

Run several `hero-winrates.ts` processes in parallel with different seeds (e.g. 12 × 6 matches) for balance checks;
with ~100 matches a hero's win rate still swings about ±5% from luck.

## Code map

- `src/sim/` deterministic 30 Hz simulation, no DOM. Commands pattern (players and bots send the same `Command`s).
  `world.ts` (units, combat, waves, structure rules), `map.ts` (layout written for 200 m and scaled by
  `MAP_SIZE / 200`, now 300 m), `abilities.ts`, `inventory.ts` (shop, sell refund window), `objectives.ts`
  (runes, Warden boss, wards, glyph, backdoor), `vision.ts` (fog, trees block sight, high ground, day/night),
  `ai/bots.ts` (team plans: farm / push / defend; difficulty easy/normal/hard), `data/*` (all numbers).
- `src/client/` `main.ts` (menus, settings, loop), `renderer.ts` (2D; in 3D mode it draws only the ground
  layer into a texture), `renderer3d.ts` (Three.js view, animations, overlay bars/text, picking),
  `three/hero-models.ts` + `three/models.ts` (low-poly placeholder models, baked into few meshes with
  animatable joints), `menu3d.ts` (start screen 3D hero + portraits), `hud.ts`, `input.ts`, `items-ui.ts`
  (shop), `audio.ts` (synthesized sounds), `tutorial.ts`.
- `tests/` vitest. Positions in tests are on the 300 m map. Long full-match tests must `await` a
  `setTimeout(0)` now and then, or vitest's worker heartbeat times out on CI.

## Decisions the owner made (keep them)

- 6 heroes (Brakk, Vexa, Orin, Syl, Grom, Kaela), 3 abilities each (R = ultimate). **No talents.**
- Balance goal: no hero is a must-pick (every hero ≈45–55% win rate in random bot lineups);
  team play decides games. Last full check (200 m map): all 45–57%. Needs a re-check on the new map.
- Map 1.5× bigger (300 m). Per lane: tier-1 near the river, tier-2, tier-3 at the gate with **two barracks**
  (melee: tougher; ranged). A fallen barracks powers up only that creep type of the attackers.
  Shrine towers 11 m from the Shrine. Glyph = invulnerable buildings + 2× tower attack speed.
  Fountain shoots heroes anywhere in its healing area.
- Controls: joystick moves; holding Attack while steering attacks **on the move**; tapping the ground does
  **not** walk (only while holding the minimap, or with a mouse); tap an enemy to attack it.
- Shop: tabs + grid + detail panel with BUY/SELL; taps only select (no accidental buys when scrolling);
  sell = full refund within 10 s, then half; dead heroes can shop; **no quick-buy**.
- Match start: menu has no heroes; **draft inside the match** (1 ban per team, picks 1-2-2-1, then 30 s warm-up).
- Warden: walled house on the river (bot/mid side), seen and fought only from inside, slam stun, charm anyone can grab.
- Dying costs gold; buyback exists. Android build: not now. App stores: later.

## Open items / next steps

1. **Phone feedback on 3D**: frame rate / freezes, animations, unit sizes, camera. Ask for it.
2. **Hard bots vs easy bots** on the big map: hard won 4/6 last check (they still lose lanes while grouped).
   Improve lane defence; the CI test plays seeds 7, 8, 9 and expects ≥2 hard wins.
3. **Hero balance re-check** on the 300 m map with 3 towers + 2 barracks per lane (avg match ≈24 min).
4. 3D polish: real art/animations (asset packs with commercial licences, or an artist), spell effects in 3D.
5. Later: multiplayer, Capacitor app builds, store release.

## Gotchas

- Don't `pkill -f <pattern>` where the pattern matches your own shell command (it kills the shell).
- Headless screenshots: Playwright Chromium with `--use-gl=angle --use-angle=swiftshader` renders WebGL
  (slowly; fps numbers there mean nothing).
- iPhone Safari keeps old builds: have the owner reopen the tab and check the build id in Settings.
