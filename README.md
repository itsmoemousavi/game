# Shrinefall (prototype)

Mobile 3v3 lane-strategy game in the spirit of Dota 2. Destroy the enemy towers, break a barracks, take down the two shrine towers, then destroy the enemy **Shrine**. Empty slots are filled with bots.

See **[docs/DESIGN.md](docs/DESIGN.md)** for the full design, tech plan and roadmap, and **[docs/3D-PLAN.md](docs/3D-PLAN.md)** for how the 3D version will work.

**Branches:** `main` is the stable 2D game. New work happens on a working branch and arrives through a pull request; every push to that branch redeploys the test build below.

## Play it

**On your phone (or any browser):** https://itsmoemousavi.github.io/game/ (turn the phone to landscape).
Every push to the main development branch is tested, built and redeployed automatically by `.github/workflows/deploy-pages.yml`.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173 (also reachable from a phone on the same Wi-Fi)
npm test           # unit + full bot-match tests
npm run build      # production bundle in dist/
npx vite-node scripts/simulate.ts [seed] [minutes]   # headless all-bot match log
```

## Controls

| | Phone (landscape) | Desktop |
|---|---|---|
| Move | Drag anywhere on the left half (virtual joystick) · tap an enemy to attack it · while holding the minimap, tap the map to walk there | Arrow keys, or right-click the ground |
| Attack | **Hold Attack** (works together with the joystick: hits what's in range, otherwise you keep walking) · tap an enemy to attack it | Hold Space, or click an enemy |
| Abilities | **Hold** Q/W/R: arrow appears · **drag** any direction to aim · release to cast · release on ✕ Cancel to abort | Q / W / R cast at the cursor |
| Items | Tap an item to use it (salves) · **ward**: tap its slot, then tap the ground · 🛒 opens the shop (buy at base) · **TP** slot: tap, then pick a friendly building (teleports are bought in the shop) | same (click) |
| Deny | Tap one of your own creeps below half health (or your own tower below 10%) | Click it |
| Team | 🛡 under the minimap: tower shield · 📍 ping (pick one, then tap the map/minimap) · **Buy back** in the respawn banner | same (click) |
| Info | Tap the **top bar** for the scoreboard · tap your **portrait (ⓘ)** for hero stats · **long-press** an ability for its details | same (click / hold) |
| Menu | **⏸** pause (resume / surrender) · **⚙** settings: graphics (3D / 2D), auto attack, sound, auto-learn, left-handed, vibration, joystick size, camera zoom | same (click) |
| Shopping | 🛒 opens the shop (at base, or anywhere while dead): pick a tab, tap an item, then **BUY**. To sell, tap one of your items, then **SELL** (full refund within 10 s of buying, half price after) | same (click) |
| Learn ability | Tap the yellow **+** next to the button | Ctrl + Q / W / R |
| Camera | Hold/drag the minimap to look (while looking, the joystick is off and taps on the map are orders); release to return · while dead, drag anywhere to look around | Hold minimap to look, right-click minimap to walk there, wheel to zoom |

Start screen: **Play vs Bots** (pick bot difficulty), **Practice** (alone, with level/gold/dummy tools) or **Tutorial** (guided first steps).

The game always plays in landscape: on a phone held upright the game is shown sideways, so just turn the phone.

## Layout

```
src/sim/        deterministic game simulation (no rendering), reusable on a future server
  data/         heroes, creeps, structures (all balance numbers)
  abilities.ts  how every ability works (numbers live in data/heroes.ts)
  inventory.ts  shop, items, teleport (numbers live in data/items.ts)
  vision.ts     fog of war (trees block sight), day/night, invisibility
  objectives.ts power-ups, boss, wards, buyback, tower shield, backdoor protection
  ai/bots.ts    bot heroes
  map.ts        map, lanes, maze, structure placement
  world.ts      units, combat, creep waves, protection rules, win condition
src/client/     3D renderer (renderer3d.ts + three/ models), 2D renderer, touch/keyboard input, HUD, sound effects (audio.ts), landscape lock (renderer to be replaced by 3D later)
tests/          vitest suites
```
