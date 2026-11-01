# Shrinefall (prototype)

Mobile 3v3 lane-strategy game in the spirit of Dota 2. Destroy the enemy towers, break a barracks, take down the two shrine towers, then destroy the enemy **Shrine**. Empty slots are filled with bots.

See **[docs/DESIGN.md](docs/DESIGN.md)** for the full design, tech plan and roadmap.

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
| Move | Drag anywhere on the left half (virtual joystick) | WASD / arrows, or right-click the ground |
| Attack | **Attack** button (auto-target, heroes first) or tap an enemy | Space, or click an enemy |
| Map | Tap the minimap to walk there | Click the minimap; mouse wheel to zoom |

Q / W / R ability buttons are placeholders until milestone 3.

## Layout

```
src/sim/        deterministic game simulation (no rendering), reusable on a future server
  data/         heroes, creeps, structures (all balance numbers)
  ai/bots.ts    bot heroes
  map.ts        map, lanes, maze, structure placement
  world.ts      units, combat, creep waves, protection rules, win condition
src/client/     2D renderer, touch/keyboard input, HUD (to be replaced by a 3D renderer later)
tests/          vitest suites
```
