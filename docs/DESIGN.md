# Shrinefall — Game Design & Technical Plan

> Working title. A mobile 3v3 lane-strategy game in the spirit of Dota 2, with original heroes, names and art.

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Platform | **Mobile first** (iOS + Android), released on app stores after testing. Desktop browser is used for development/testing. |
| Orientation | **Always landscape.** If the phone is held upright, the whole game is drawn rotated 90° (`src/client/screen.ts`) and touch input is converted to match. Native builds will also lock orientation to landscape in the Capacitor/Xcode/Android settings. |
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

Ability levels: basic abilities max level 4 (and at most ⌈hero level / 2⌉), ultimate max level 3 (learnable at levels 6 / 10 / 14). Heroes start with 1 skill point and gain 1 per level.

**Implemented (milestone 3).** Numbers are in `src/sim/data/heroes.ts`; behaviour is in `src/sim/abilities.ts`.

| Ability | Implementation |
|---|---|
| Shield Charge | dash up to 10 m; damages enemies touched; stops at the first hero and stuns it (1–1.6 s) |
| Iron Hide | blocks 10–34 damage per attack (an attack always deals at least 40%); +4–10 armor below 50% HP |
| Earthsplitter | 0.6 s wind-up (Brakk can't act), then 7 m radius damage 200–400 + stun 1.5–2.1 s |
| Piercing Arrow | 18 m line, hits every enemy, 90–270 damage |
| Hunter's Rhythm | every 4th attack ×1.4–2.0 damage and +15–30% move speed for 1.5 s |
| Arrow Storm | 6 m area for 3 s, 70–140 damage per second, 30–40% slow |
| Fireball | homing, explodes for 80–230 in a 3 m radius |
| Mending Flame | heals an ally 120–300 over 4 s |
| Cataclysm | lands after 1.5 s: 250–500 in 5 m, then burning ground 30–60 damage per second for 3 s |

**Rules:**
- Spells ignore armor but can't damage structures.
- Stunned units can't move, attack or cast.
- Unit-target spells walk into range automatically; ground-target spells are capped at max range.

### Mobile ability controls (implemented)
- **Hold the button:** an arrow appears immediately, pointing where a quick-cast would go.
- **Drag in any direction, including behind you,** to aim. The arrow follows. Release to cast; you can miss.
- **Tap without dragging:** casts where the arrow pointed (enemy heroes first; heals go to the most hurt ally, otherwise yourself).
- **Cancel:** release over **✕ Cancel** to abort.
- **Mana cost** is shown on each button.
- **"+" badge:** shown when a skill point can be spent; tap it to learn the ability.
- **Button states:** cooldown seconds, blue when out of mana, dim until learned, dots for the ability's level, dashed border for passives.
- **Desktop:** Q/W/R cast at the cursor, Ctrl+Q/W/R to learn.

## 6. Items (implemented, milestone 4)

**Inventory and shop:**
- **6 inventory slots, plus a separate Teleport slot.** The TP slot shows how many scrolls you carry, 0 if none. You can buy as many as you like.
- **The 🛒 shop** opens anywhere, but buying and selling only work near your fountain. Selling refunds 50%.
- **Recommended items** for your hero are marked ★ and listed first.
- **Healing Salves** stack up to 3 in one slot; tap the slot to use one.
- **While the shop is open,** tapping one of your items sells it.

**Teleport:**
- 50 gold each.
- Tap the TP slot to open a big map, then tap any friendly building.
- 3 s channel, then you appear on the home side of that building. 60 s cooldown.
- Moving, attacking, casting or being stunned cancels it.
- With 0 scrolls at base, tapping the TP slot buys one.

Item numbers are in `src/sim/data/items.ts`.

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
| Teleport Scroll | own slot, unlimited stack (see above) |

## 6b. Fog of war, day & night, jungle

**Fog of war:**
- Each team only sees what its heroes, creeps and buildings see.
- Enemies outside vision are hidden on screen and on the minimap, and can't be targeted.
- Bots play by the same rules.
- Buildings are always visible.
- **Trees block sight:** you see the edge of the forest but not through it, so the jungle maze is full of blind corners. Buildings don't block sight.

**Day and night:**
- 3 min day, 2 min night.
- At night hero vision drops from 17 m to 10 m, and the screen darkens.
- The top bar shows ☀ or ☾ and the time until the next change.

**Jungle camps:**
- 3 camps per side, in the jungle rooms. Each has 1 brute and 2 imps.
- They spawn at 0:30 and refill every minute when empty.
- They stay passive until attacked, fight back as a group, give up past 11 m from home, and heal at camp.
- Rewards: gold to the killer, XP to the killer's team.

**Camera:**
- Hold or drag on the minimap to look anywhere; release to snap back to your hero.
- While dead, drag anywhere to look around (for example, to see who needs help).

**Combat feedback:**
- Melee **heroes** show a swing arc, a small lunge and an impact spark (creeps don't, to keep lanes readable).
- Fireball explosions and teleport arrivals flash.

**Movement around buildings:**
- Creeps walk straight while the way is open and path around towers, barracks and trees when it isn't.
- Dashes (Shield Charge) go through buildings.

## 6c. Map objectives & team mechanics (implemented, milestone 5)

Numbers are in `src/sim/constants.ts`, `data/units.ts` and `objectives.ts`.

| Feature | How it works |
|---|---|
| **Denying** | Last-hit your own creeps below 50% HP, or your own towers below 10%. The enemy gets no gold and only 30% of the XP; a denied tower pays the enemy half. Shows a floating "!" and "Denied!". |
| **Wards** | Observer Ward (75 gold): invisible, 16 m day / 12 m night vision for 6 min. Sentry Ward (50 gold): reveals invisible enemies (wards, invisible heroes) within 10 m. Tap the ward slot, then tap the ground; the hero walks into range (7 m). Killing an enemy ward pays gold. Fountains also reveal invisible units. |
| **River power-ups** | First at 1:00, then every 2 min, at one of two river junctions. Walk over it to take it. **Haste** (max speed 15 s), **Double Damage** (25 s), **Regeneration** (15 s), **Invisibility** (20 s; attacking or casting reveals you), **Bounty** (gold for you, half for teammates). |
| **The Warden (boss)** | Lives in a pit on the river. 6500 HP, hits hard, leashes home. Killing it: 150 gold to each player on that team, XP, and a **revive charm** (5 min) on the killer. If the holder dies, they get back up on the spot after 3 s. Respawns 5 min after dying. |
| **Buyback** | While dead: pay 150 + 30×level + 8×minutes gold to respawn now. 5 min cooldown. Button in the respawn banner. |
| **Tower shield** | 🛡 button under the minimap: all your buildings invulnerable for 5 s. Shared team cooldown of 5 min. |
| **Backdoor protection** | Tier-2 towers, barracks, shrine towers and the Shrine take 75% less damage when no enemy creeps are within 18 m, and regenerate for a short while after such a hit. Tier-1 towers are not protected. |

**Sound effects:**
- All sounds are synthesized in code (Web Audio API, `src/client/audio.ts`), so there are no audio files to license.
- Covered: attacks (melee swing, ranged shot, tower), each ability, explosions, deaths, collapsing buildings, gold, level up, teleport, deny, power-up, buyback, tower shield, ward, boss, revive, purchases, UI taps, victory/defeat.
- Your own actions play at full volume; everything else fades with distance from the camera and is silent if your team can't see it.
- 🔊 button to mute; the choice is remembered.

**Announcements:** short toasts for hero kills, destroyed buildings, the boss, power-ups your team picks up, buybacks, the tower shield and revives.

## 7. Bots

- Bots use the same commands as players, so a bot slot can later be handed to an online player.
- **Current:**
  - learn abilities (ultimate first)
  - use nukes and stuns on enemy heroes; save ultimates for weakened targets or groups
  - farm creep waves with area spells when mana is high
  - Orin heals hurt allies
  - buy items along a fixed build when at base, always carry a TP, teleport back to their lane after healing, use salves when hurt
  - only react to enemies they can see; fight back against jungle camps
  - deny their own creeps, grab nearby power-ups, use the tower shield when a tower is about to fall, buy back when the base is under attack; Orin keeps an observer ward and plants it where its lane meets the river
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
3. ✅ Abilities for the 3 heroes (data-driven ability system, buffs/debuffs, stuns, slows, projectiles, areas), skill points, mobile aim-and-release casting, bots use abilities, always-landscape
4. ✅ Items, shop, teleport slot, neutral jungle camps, fog of war, day/night, free camera, melee feedback, aimable arrow casting (Fireball is now an aimed shot that can miss)
5. Smarter bots: abilities, items, teamfights, difficulty settings
6. Polish: sound, effects, fog of war, scoreboard, settings, tutorial; **balance target: 15–20 min matches** (an all-bot match currently takes ~30–45 min; items should shorten it)
7. Capacitor packaging, on-device performance tests (low-end Android), test builds via TestFlight / Play internal testing
8. 3D renderer (Three.js), art direction, animations
9. Phase 2: online multiplayer (authoritative server, matchmaking, reconnect), accounts

Milestone 5 (done): denying, wards, river power-ups, the Warden boss + revive charm, buyback, tower shield, backdoor protection, sound effects.

## 8b. Backlog: ideas agreed to revisit

These were proposed and are parked for later:
- **High ground:** bases on a ledge; attacking uphill can miss and needs vision.
- **Talents at levels 10 and 15:** pick one of two bonuses per hero.
- **Item recipes and active items:** components combine into bigger items; items with a button (for example a short blink, or brief spell immunity), all original designs.
- **Kill feed polish, announcer voice, kill streaks and bounties:** extra gold for ending a streak, as a comeback mechanic.
- **End-of-match scoreboard and stats:** damage, gold over time, items.
- **Pings and quick-chat wheel:** "Attack", "Retreat", "Enemy missing".
- **More heroes:** 6–8 for variety.
- **Smarter bots:** ganking, grouping, defending, difficulty levels.
- **Balance:** bots-only test matches currently take 37–52 min; the target is 15–20 min.

## 9. Things to plan for before the store release

- **Performance budget:** 60 fps rendering, 30 Hz simulation on a mid-range 2021 Android phone; watch draw calls in 3D; battery/thermal limits in long sessions.
- **Mobile UX:** landscape lock, safe areas (notch), large touch targets (≥ 44 pt), pausing on app background (offline only), haptics.
- **Stores:** privacy policy, age rating questionnaires, data-collection disclosures, app icons/screenshots, in-app purchase rules if cosmetics are sold (Apple/Google take a cut and require their billing).
- **Online phase:** cheat prevention through an authoritative server, latency compensation, servers in your players' regions, reconnects, AFK/leaver handling (a bot takes over).
- **Legal/IP:** keep heroes, names, icons and map art original. The genre is fine; copying Dota assets or names is not.
