# Ovra: project notes for Claude

Read this first. It carries the context of the earlier (cloud) sessions: what the game is,
how we work, what the owner decided, and what is still open. Details live in
`docs/DESIGN.md` (design + balance numbers), `docs/3D-PLAN.md` (3D notes) and `README.md` (controls).

## The game

Mobile 3v3 lane-strategy game in the spirit of Dota 2 (original names and art, no Dota assets).
Name: **Ovra** (an invented word with no meaning, like "Dota"; was Shrinefall, then briefly Emberwake, renamed 2026-11-04
because Emberwake was taken). Icon: split blue/red tower with an ember crack (`public/icon.svg`;
PNGs rendered from it with headless Chromium; 1024 px store version in `docs/icon-1024.png`).
Destroy towers → barracks → shrine towers → the enemy **Shrine**. Empty slots are bots.
Offline vs bots for now; multiplayer and app-store release later (Capacitor planned).

- **Always landscape** (on a phone held upright the whole UI is rotated, `src/client/screen.ts`).
- The owner tests on an **iPhone** through the GitHub Pages build: https://itsmoemousavi.github.io/ovra-game/
  Settings → Graphics shows `build <sha>`: ask them to check it (Safari caches old builds).
- **3D is the default view** (Three.js); 2D stays as a "low graphics" setting and as the fallback
  if WebGL fails (the reason is shown in a toast and under Settings → Graphics).

## Workflow

- Work on branch `claude/dota-like-game-design-slf3o9`. `main` is the public showcase branch (README, patch notes,
  playable with `npm install && npm run dev`; the repo's default branch); it was brought up to date on 2026-11-04 (v0.10.0).
  On `main` the workflow only tests + builds (Pages may only deploy from the dev branch); keep `main` in sync by
  fast-forward pushes when the owner asks.
  Don't push to other branches or merge into `main` without being asked.
- **Patch notes:** every change gets an entry in `CHANGELOG.md` (newest first, plain player-facing language) and the
  matching `version` in `package.json` (shown in Settings). Last number = each change, middle number = milestone.
  Internal-only changes go in as "Behind the scenes". Never write "Dota" in README/CHANGELOG (public).
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
npx vite-node scripts/map-check.ts [firstSeed] [matches] > out.jsonl  # per-match JSON: winner, heroes+items, buildings fallen, stuck heroes
# Animation close-ups (dev only): npm run dev, open /anim-preview.html, then in the console
#   run('syl', 'attack', 0.1, 'front')  /  run('orin', 'cast', 0.8, 'game', 2)  /  area('maelstrom', 1.5)
python3 scripts/tune-hero.py 'vexa.baseDamage=35' 'brakk.ironHide.block=[5, 8, 11, 14]'   # edit hero numbers
```

Run several `hero-winrates.ts` processes in parallel with different seeds (e.g. 12 × 6 matches) for balance checks;
with ~100 matches a hero's win rate still swings about ±5% from luck.

## Code map

- `src/sim/` deterministic 30 Hz simulation, no DOM. Commands pattern (players and bots send the same `Command`s).
  `world.ts` (units, combat, waves, structure rules), `map.ts` (layout written for 200 m and scaled by
  `MAP_SIZE / 200`, now 300 m), `abilities.ts`, `inventory.ts` (shop, sell refund window, courier purchases), `courier.ts` (courier movement + delivery), `objectives.ts`
  (runes, Warden boss, wards, glyph, backdoor), `vision.ts` (fog, trees block sight, high ground, day/night),
  `ai/bots.ts` (team plans: farm / push / defend / warden; difficulty easy/normal/hard), `ai/bot-items.ts` (bot item choices from the enemy lineup), `data/*` (all numbers).
- `src/client/` `main.ts` (menus, settings, loop), `renderer.ts` (2D; in 3D mode it draws only the ground
  layer into a texture), `renderer3d.ts` (Three.js view, animations, overlay bars/text, picking),
  `three/hero-anims.ts` (hand-made hero animations: idle, walk,
  attacks, every spell, buffs, deaths), `three/spell-fx.ts` (projectile trails, area spells),
  `three/fx.ts` (dust, sparks, slashes, roots, meteor, whirlpool, camera shake), `three/world-art.ts` (map look: ground detail, flowing river, swaying trees and grass, rocks, walls, fireflies; all decoration, never reacts to units), `three/hero-models.ts` +
  `three/models.ts` (our own models sculpted in code; every model goes through one paint finish when baked into few meshes with animatable joints, so new models match automatically), `menu3d.ts` (start screen 3D hero + portraits), `hud.ts`, `input.ts`, `items-ui.ts`
  (shop), `audio.ts` (synthesized sounds), `tutorial.ts`.
- `tests/` vitest. Positions in tests are on the 300 m map. Long full-match tests must `await` a
  `setTimeout(0)` now and then, or vitest's worker heartbeat times out on CI.

## Decisions the owner made (keep them)

- 9 heroes (Brakk, Vexa, Orin, Syl, Grom, Kaela, Morra, Seren, Rhen), 3 abilities each (R = ultimate). **No talents.**
- Owner's rules for the new heroes (2026-11-05): Aegis lasts 3 s. Morra's first spell calls 1 wolf at levels 1-2 and 2 from level 3 (never more). Her ultimate is a 14 s melee Red Wolf form, bigger than her wolves, with extra attack speed, damage, a little crit and move speed; no bear. Feral Bond boosts Morra only when she isn't the wolf.
- Balance goal: no hero is a must-pick (every hero ≈45–55% win rate in random bot lineups);
  team play decides games. Last full check (200 m map): all 45–57%. Needs a re-check on the new map.
- Map 1.5× bigger (300 m). Per lane: tier-1 near the river, tier-2, tier-3 at the gate with **two barracks**
  (melee: tougher; ranged). A fallen barracks powers up only that creep type of the attackers.
  Shrine towers 11 m from the Shrine. Glyph = invulnerable buildings + 2× tower attack speed.
  Fountain shoots heroes anywhere in its healing area.
- Controls: joystick moves; tapping the ground does **not** walk (only while holding the minimap, or with a mouse); tap an enemy to attack it.
- Attack (owner's spec, 2026-11-05). Auto attack ON: nearest target in range by itself, also while walking, sticks to it while it stays in range (walking past creeps doesn't switch); an enemy picked with the Attack arrow comes first until it dies or leaves range; never denies, doesn't wake jungle camps. Auto attack OFF: one attack per tap (nearest) or per release of a hold (aimed target); tapping faster than attack speed does nothing extra; holding never attacks until release. Denies are one attack per tap/release in both modes.
- Spells vs obstacles (owner, 2026-11-05): trees, walls, buildings and mountains block only walking, never spells. Charges/dashes go through and may end anywhere: on a mountain, off one, in or out of a pocket, into the Warden's house. Ending inside something moves you to the nearest open spot.
- Mountains (owner, 2026-11-05): six, in the woods between forests, never on a lane or trail (`tests/map.test.ts` checks it), open ground all around so anyone can walk to the foot and plant a ward on top. Not walkable at all: up or down only by blink, teleport or charge. Melee can only hit someone up there from up there.
- Forest: no crowded spots; pockets with no walking way out are on purpose (escape with blink, charge, or a TP brought by courier). Bots are lifted out of pockets and off mountains until they can use them.
- Tower sight (owner, 2026-11-05): towers give the team NO vision; the ground around them stays fog, and lanes are lit only by heroes, creeps and wards. Sight = attack range: any enemy hero or creep in a tower's attack zone is seen by that tower's whole team and shot, even in fog and even invisible, until they leave the zone. It doesn't reveal wards. Barracks, Shrine and fountain keep normal team vision.
- True sight: towers, fountain and sentry totems have it and wear a green outlined eye floating on top (never on the ground); the Shrine and barracks do not. A sentry gives vision only for its first 5 s, then only unmasks where the team already sees. Vision is the observer totem's job (24/18 m, 34/26 m on a mountain).
- Morra's wolves need no control: attack what she attacks (any mode, jungle too), turn on whoever hits her, stay within 14 m, don't dive towers or hit buildings by themselves. Non-human units walk around anything blocking them unless there's truly no way (`goingAround` in world.ts).
- Match ending: everything freezes (heroes do not walk), the camera glides to the fallen Shrine, it explodes, result banner, then end screen.
- Menu: Play with Bots, Practice, Play with Friend (locked until multiplayer). Courier art approved: pack mule, winged after 6:00.
- Teleport: hero is frozen while channelling, only the X on the TP slot (or a stun) stops it, no walking cancels it; the destination is fixed when it starts, so a tower falling mid-channel doesn't matter. Channel bar over the health bar shows anything charging. Wayfarer Boots: always 1 TP, never used up, 30 s cooldown, allied heroes and creeps as targets too, can't buy scrolls; drop them and you keep 1.
- Mega Creeps when all 6 enemy barracks are down. Camera: default is the farthest, can only zoom in.
- Every hero starts the match with 1 TP scroll.
- Shop: tabs + grid + detail panel with BUY/SELL; taps only select (no accidental buys when scrolling);
  sell = full refund within 10 s, then half; dead heroes can shop; **no quick-buy**.
- Match start: menu has no heroes; **draft inside the match** (1 ban per team, picks 1-2-2-1, then 30 s warm-up).
- Art style: **semi-realistic, darker, painted** (owner loved Sketchfab "Minotaur Berserker" by Yury Misiyuk).
  All models are our own (the trial Sketchfab models were removed for good, 2026-11-03).
  Rejected: cute kits (KayKit, Kenney), Grab3D, Mixamo realistic humans. Models must be free for commercial use
  (CC0 / CC BY, no fan art of other games). Owner's Sketchfab API token is in `~/.sketchfab-token` (never commit it).
- Warden: walled house on the river (bot/mid side), seen and fought only from inside, slam stun, charm anyone can grab.
- Map look (2026-11-03): winding river is low ground (level 0) behind stone curbs (`map.cliff`: block walking, not sight),
  with slopes at lanes (no bridges), around runes, at the Warden's house and where trails meet it; normal speed in water.
  Only mid crosses water: the river ENDS at each side lane's inner edge with a slope (side lanes = solid ground, high
  ground over the river). Towers sit 3 m off lane centre (inner side) with a lane bulge; hard-lane T1 near the corner + trail
  behind it; easy-lane T1 (blue bottom, red top) on the OUTER side of the road.
  Trees are individual (`map.trees`): thickets, open woods with walkable gaps, glades; solid forest outside the side
  lanes and around bases. Painted ground in `src/client/map-art.ts`.
- Item names must be our own (renamed 2026-11-03: Watcher Totem, Seer Totem, Herbal Poultice, Mystic Treads;
  "Warden's Charm" stays). Never use "Dota" in anything public (store listing, screenshots, ads).
- Each fountain sits in a walled yard with one doorway toward the centre; the Warden's house walls block sight
  both ways; the Warden returns 8–11 min after dying (random, unannounced); wards die to exactly 2 attacks.
- Courier (owner's design, 2026-11-03): 3 slots per hero, buys away from base go on it, delivers in slot order as many as fit,
  walks lanes only until 6:00 then flies, turns back on death, invulnerable for now (killable + bounty = later).
- Dying costs gold; buyback exists. Android build: not now. App stores: later.

## Open items / next steps

1. **Phone feedback on 3D**: frame rate / freezes, animations, unit sizes, camera. Ask for it.
2. **Hard bots (LATER, owner 2026-11-04)**: hard bots win fights (2-5x kills) but only ~half the matches vs easy
   (12 seeds, before and after 2026-11-03 changes): they group-push and leave a lane alone, which gets pushed to the
   barracks; the team plan flips between push and defend and walks across the map. CI test loosened to >=1 win of 3 + 2x kills.
   Also not done: bots using walkways / blinking onto cliff hills, deliberate denies.
3. **Hero balance** on the 300 m map: all 45–55% with the 8 new items (120 matches, 2026-11-05). Bot shopping lists move these numbers a lot:
   adding an item early to a list swung Kaela and Syl by 15-20%. Red ~55% was mostly a biased test shuffle; tick order now alternates. Owner: don't chase it.
4. 3D polish: real art/animations, spell effects in 3D.
5. Living world: shipped in 0.11.0. Phone frame rate and battery with the new art still need the owner's check.
6. More heroes: Morra, Seren and Rhen shipped in 0.13.0. A 4th only if playing them shows a missing role (owner agreed to wait).
   Balance after 0.15.1 is rough (about 45 matches per hero, so ±7-15%; the last two runs differ a lot): Kaela 66%, Seren 55%, Vexa 55%, Syl 54%, Grom 51%, Orin 49%, Brakk 46%, Rhen 36%, Morra 33%. Owner: balance LATER. Re-check with more matches before tuning.
7. Later: multiplayer (first on owner's MacBook, local only), killable courier + bounty, Capacitor app builds, store release.

## Gotchas

- Don't `pkill -f <pattern>` where the pattern matches your own shell command (it kills the shell).
- Headless screenshots: Playwright Chromium with `--use-gl=angle --use-angle=swiftshader` renders WebGL
  (slowly; fps numbers there mean nothing).
- Headless screenshots that hang: kill leftover browsers first (`pkill -f chrome-headless-shell`).
- Missing iPhone home-screen icon (Nov 2026): the icon files were fine; an iOS update fixed it. Ask the owner to
  update iOS first before changing icon files.
- iPhone Safari keeps old builds: have the owner reopen the tab and check the build id in Settings.
