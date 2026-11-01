# Shrinefall — Game Design & Technical Plan

> Working title. A mobile 3v3 lane-strategy game in the spirit of Dota 2, with original heroes, names and art.

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Platform | **Mobile first** (iOS + Android, landscape), released on app stores after testing. Desktop browser is used for development/testing. |
| Visuals | **2D top-down now, 3D later.** Game logic is fully separate from rendering so the 2D renderer can be replaced without touching gameplay. |
| Mode | 3v3. Empty slots are filled with bots. Phase 1 is offline (you + 5 bots). |
| Heroes | 3 to start (proposals below, expected to change). Each has 3 abilities; one is always the Ultimate. Abilities can be active or passive. |
| Structure order | Like Dota 2 (see §3). |
| Creeps | Yes. Lane creep waves are core. Neutral jungle camps are planned for the jungle rooms. |

## 2. Technology

- **TypeScript** everywhere, built with **Vite**, tested with **Vitest**.
- **Simulation (`src/sim`)**: pure TypeScript with no DOM or rendering. Fixed 30 Hz tick, seeded RNG, deterministic (covered by a test). Everything a player does is a `Command` (`moveDir`, `moveTo`, `attack`, `attackNearest`, `stop`). Bots issue the same commands as humans.
- **Client (`src/client`)**: renderer (Canvas 2D for now), input (touch joystick + buttons; keyboard/mouse for desktop testing) and HUD (DOM overlay).
- **Mobile packaging (planned):** wrap the web build with **Capacitor** to produce native iOS/Android apps for the App Store and Play Store. `vite.config.ts` already uses a relative base for this.
- **3D (planned):** replace `renderer.ts` with a **Three.js** (or Babylon.js) renderer. World `(x, y)` maps to the 3D ground plane `(x, z)`. Low-poly art keeps it fast on mid-range phones.
- **Online (phase 2):** run the same `src/sim` on a Node server (for example with Colyseus) as the authority. Clients send `Command`s and receive state, with client-side prediction for your own hero.

### Why not Unity / Godot?
Unity is the industry standard for 3D mobile MOBAs and is a valid alternative. It has the best mobile 3D performance and tooling. The trade-offs:
- The TypeScript route lets the same game code run on the client **and** the online server.
- It iterates fastest, can be tested headlessly, and is shareable via a link.

If 3D performance in a Capacitor WebView ever becomes a blocker, the simulation is data-driven and engine-independent, so porting it to Unity C# is mechanical. Re-evaluate at the start of the 3D milestone with a performance test on a low-end Android phone.

## 3. Map

- 200 × 200 m, split diagonally by a river. **Azure** (team 0) owns the bottom-left triangle; **Crimson** (team 1) owns the top-right. The map is point-symmetric, so both sides are identical (enforced by a test).
- **3 lanes:** top (left edge → top edge), mid (diagonal), bottom (bottom edge → right edge).
- **Maze:** the space between lanes is walls (forest) carved with narrow jungle corridors and rooms. Rooms will hold neutral camps.
- **Per team:**
  - each lane: Tier‑1 tower → Tier‑2 tower + Barracks
  - base: 2 Shrine towers → Shrine
  - Fountain: spawn, healing, very strong defence, invulnerable
- **Protection rules** (structures are invulnerable until their turn; shown in-game by a dashed gold ring):
  1. Tier‑1 towers: always attackable.
  2. Tier‑2 tower **and** barracks of a lane: after that lane's Tier‑1 falls.
  3. Both Shrine towers: after **any** barracks of that team falls.
  4. Shrine: after **both** Shrine towers fall. **Destroying the Shrine wins.**
- Losing a barracks makes the enemy's creeps in that lane **super creeps** (×1.6 HP/damage).

## 4. Units & economy (current numbers, all in `src/sim/data`)

- **Creep waves:** every 30 s per lane: 3 melee + 1 ranged.
- **Towers:**
  - prefer creeps
  - switch to an enemy hero who attacks an allied hero in range
  - 100–140 damage per shot
- **Gold:**
  - 600 at start, plus 2/s passive
  - last hits: 38–48
  - hero kill: 150 + 10 × victim level
  - each destroyed structure pays every enemy hero 120–200
- **XP:** shared among enemy heroes within 30 m. Level cap 15. Ultimate unlocks at level 6.
- **Respawn:** 4 + 2 × level seconds.
- **Damage:** armor reduction `1 − 0.06a / (1 + 0.06|a|)`.

## 5. Heroes (proposals, will change)

| Hero | Role | Q | W | R (Ultimate) |
|---|---|---|---|---|
| **Brakk, the Bulwark** | Melee tank / initiator | *Shield Charge*: dash, stun first hero hit | *Iron Hide* (passive): flat damage block, bonus armor below 50% HP | *Earthsplitter*: wind-up, then big AoE damage + stun |
| **Vexa, the Gale Archer** | Ranged carry | *Piercing Arrow*: line skillshot | *Hunter's Rhythm* (passive): every 4th attack crits + speed burst | *Arrow Storm*: 3 s area barrage, damage + slow |
| **Orin, the Emberseer** | Mage / support | *Fireball*: targeted AoE nuke | *Mending Flame*: heal an ally over time | *Cataclysm*: delayed meteor, huge damage + burning ground |

Ability levels: basic abilities max level 4, ultimate max level 3 (learnable at levels 6 / 10 / 14). One skill point per level.

### Mobile ability controls
- **Tap:** quick-cast on an auto-selected target.
- **Drag the button:** aim (skillshots/areas) and release to cast; drag to the cancel zone to abort.
- **Passive abilities:** shown with a dashed border.

## 6. Items (proposal)

6 inventory slots. Buying is only allowed in the base (near the fountain). A "recommended build" quick-buy button keeps it touch-friendly.

| Item | Effect |
|---|---|
| Swift Boots | +move speed |
| Iron Blade | +attack damage |
| Vital Stone | +max HP |
| Mana Crystal | +mana, +mana regen |
| Quick Gloves | +attack speed |
| Guard Plate | +armor |
| Focus Lens | −15% ability cooldowns |
| Arcane Amplifier | +15% ability damage |
| Lifedrinker | attack lifesteal |
| **Crown of Ascension** | upgrades the hero's Ultimate (stronger effect, −30% cooldown) |
| Healing Salve | consumable, heal over time |

## 7. Bots

- Bots use the same commands as players, so a bot slot can later be handed to an online player.
- **Current (milestone 2):**
  - lane assignment
  - follow the creep wave
  - last-hit / harass
  - siege only when creeps tank the tower
  - back off from tower fire
  - retreat to the fountain below 30% HP
- **Later:** ability use, item builds, grouping and pushing, difficulty levels (reaction time, aim error).

## 8. Milestones

1. ✅ Project setup, map + maze, camera, touch joystick / click-to-move, pathfinding
2. ✅ Combat, creep waves, towers + protection rules, barracks → super creeps, shrine win condition, basic bots, hero select, HUD, minimap
3. Abilities for the 3 heroes (data-driven ability system, buffs/debuffs, stuns, slows, projectiles, areas), skill points, mobile aim-and-release casting
4. Items, shop UI, gold sinks; neutral jungle camps
5. Smarter bots: abilities, items, teamfights, difficulty settings
6. Polish: sound, effects, fog of war, scoreboard, settings, tutorial; **balance target: 15–20 min matches** (an all-bot match currently takes ~40 min with no abilities or items)
7. Capacitor packaging, on-device performance tests (low-end Android), test builds via TestFlight / Play internal testing
8. 3D renderer (Three.js), art direction, animations
9. Phase 2: online multiplayer (authoritative server, matchmaking, reconnect), accounts

## 9. Things to plan for before the store release

- **Performance budget:** 60 fps rendering, 30 Hz simulation on a mid-range 2021 Android phone; watch draw calls in 3D; battery/thermal limits in long sessions.
- **Mobile UX:** landscape lock, safe areas (notch), large touch targets (≥ 44 pt), pausing on app background (offline only), haptics.
- **Stores:** privacy policy, age rating questionnaires, data-collection disclosures, app icons/screenshots, in-app purchase rules if cosmetics are sold (Apple/Google take a cut and require their billing).
- **Online phase:** cheat prevention through an authoritative server, latency compensation, servers in your players' regions, reconnects, AFK/leaver handling (a bot takes over).
- **Legal/IP:** keep heroes, names, icons and map art original. The genre is fine; copying Dota assets or names is not.
