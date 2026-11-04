# Ovra: patch notes

Every change to the game, newest first. Each change has its own version number:

- the **middle number** (0.**9**.0) goes up with each big milestone,
- the **last number** (0.9.**3**) goes up with every change inside that milestone.

The version you're playing is shown in **Settings → View** in the game.

| Version | Milestone | Date |
|---|---|---|
| [0.10.x](#010x--ovra) | Ovra: new name, app icon, patch notes | 2026-11-04 |
| [0.9.x](#09x--courier-and-polish) | Courier and polish | 2026-11-03 |
| [0.8.x](#08x--new-map-look) | New map look: winding river, woods, painted ground | 2026-11-02 to 11-03 |
| [0.7.x](#07x--animated-heroes) | Animated heroes and spell effects | 2026-11-02 |
| [0.6.x](#06x--draft-hud-and-the-warden) | Draft, HUD and the Warden | 2026-11-02 |
| [0.5.x](#05x--bigger-map-and-new-buildings) | Bigger map and new buildings | 2026-11-02 |
| [0.4.x](#04x--3d) | 3D | 2026-11-02 |
| [0.3.x](#03x--hero-balance) | Hero balance | 2026-11-01 |
| [0.2.x](#02x--six-heroes-and-smarter-bots) | Six heroes and smarter bots | 2026-11-01 |
| [0.1.x](#01x--first-playable-prototype) | First playable prototype (2D) | 2026-11-01 |

---

## 0.10.x · Ovra

### 0.10.7
*2026-11-04*
- Behind the scenes: removed the icon test page again. The missing iPhone home-screen icon was fixed by an iOS update.

### 0.10.6
*2026-11-04*
- Behind the scenes: a small test page (`icon-test.html`) to find out why the iPhone home-screen icon is missing.

### 0.10.5
*2026-11-04*
- Fix, second try: iPhone home-screen icon. The icon files have new names so the phone can't reuse an old saved copy.

### 0.10.4
*2026-11-04*
- Fix: "Add to Home Screen" on iPhone now uses the Ovra icon.

### 0.10.3
*2026-11-04*
- The project moved to a new address: **https://github.com/itsmoemousavi/ovra-game**.
- The game is now played at **https://itsmoemousavi.github.io/ovra-game/** (the old link no longer works).

### 0.10.2
*2026-11-04*
- The game's final name is **Ovra** (the name Emberwake was already taken).
- New logo on the start screen. The app icon stays the same.

### 0.10.1
*2026-11-04*
- Behind the scenes: the `main` branch now only runs the tests and build (the website is published from the dev branch).
- `main` is the branch visitors see first on GitHub.

### 0.10.0
*2026-11-04*

- The game got its first name, **Emberwake** (it was called Shrinefall while in development).
- New app icon: one tower split between the blue and red teams, with embers bursting from the crack.
- The icon shows in the browser tab and on the iPhone home screen ("Add to Home Screen").
- The version number now shows in Settings, next to the build id.
- New README and these patch notes.
- The latest game is now on the `main` branch, so anyone who downloads the project can play it on their own computer.

---

## 0.9.x · Courier and polish

### 0.9.6
*2026-11-03*
- Behind the scenes: project notes updated with the open items list.

### 0.9.5
*2026-11-03*
- **Attack button:** holding it while standing still now only aims, and the attack starts when you let go.
- The target you pick is attacked until it dies, disappears or you walk away.
- Every hero starts the match with **one teleport scroll**.

### 0.9.4
*2026-11-03*
- New **end-of-match screen** with stats.
- Hit feedback: you can see and feel when you land a hit.
- Redesigned draft screen.
- Hero auras.
- Bot fix.

### 0.9.3
*2026-11-03*
- Behind the scenes: long automatic tests take more breaks so the test server doesn't time out.

### 0.9.2
*2026-11-03*
- **Hero balance** checked again on the bigger map (all heroes win 46–54% of bot matches).
- Smarter bots.
- Teammates can walk through each other.

### 0.9.1
*2026-11-03*
- The courier button shows arrows instead of words.
- New map-check tool for testing.

### 0.9.0
*2026-11-03*
- **Courier:** items you buy away from base go on your courier (3 slots). Send it out and it delivers whatever fits in your bag. It walks the lanes until 6:00, then flies.

---

## 0.8.x · New map look

### 0.8.9
*2026-11-03*
- The easy lane's first towers (blue bottom, red top) moved to the outer side of the road.

### 0.8.8
*2026-11-03*
- Wider river (18 m) and wider lanes (14 m).

### 0.8.7
*2026-11-03*
- Fix: water no longer shows up painted on the side lanes where the river ends.

### 0.8.6
*2026-11-03*
- Side lanes are solid ground.
- The hard lane's tower is near the corner.
- The Warden's walls are solid.

### 0.8.5
*2026-11-03*
- Game rules fixed to match the design.
- Names cleaned up: every item and place now has its own original name.

### 0.8.4
*2026-11-03*
- Arrows and fog now show over the river.
- The tops of slopes count as river bank.
- New side-lane tower spots.
- The Warden, jungle monsters and lane creeps are animated.

### 0.8.3
*2026-11-03*
- **Map round 3:** the river ends past the side lanes.
- Walkways from mid to the runes, and cliff ward hills (reachable only with Blink).
- Wider jungle trail entrances, and shrine towers closer to the Shrine.
- Hold Attack to aim at a target.
- Teleport arrivals stay hidden in enemy fog.

### 0.8.2
*2026-11-03*
- Behind the scenes: project notes describe the new map look and river rules.

### 0.8.1
*2026-11-03*
- **River banks:** the river is low ground behind stone curbs, with slopes at the lanes, the runes, the Warden and jungle trails.
- Bridges removed.

### 0.8.0
*2026-11-02*
- **Map rework preview:** a winding river, spread-out woods, painted ground, new building models, tower bolts and a tower shield dome.

---

## 0.7.x · Animated heroes

### 0.7.4
*2026-11-02*
- **Ten new items.**
- Each tower tier is tougher than the one before it.
- The teleport map shows units.
- K/D/A is shown on two lines.

### 0.7.3
*2026-11-02*
- **All six heroes are fully animated**, with spell effects and sounds.

### 0.7.2
*2026-11-02*
- Brakk is fully animated, with effects and sounds.
- Everyone can see teleport beams.
- A warning shows when you're low on mana.

### 0.7.1
*2026-11-02*
- Back to our own 3D models (the trial artist models were switched off).

### 0.7.0
*2026-11-02*
- Trial of semi-realistic models for heroes, skeleton creeps, jungle monsters and the Warden.

---

## 0.6.x · Draft, HUD and the Warden

### 0.6.11
*2026-11-02*
- Behind the scenes: a long bot-match test takes breaks so the test server doesn't time out.

### 0.6.10
*2026-11-02*
- Lanes are back to 13 m wide so towers cover the whole lane.

### 0.6.9
*2026-11-02*
- Wider lanes and jungle paths.
- Towers sit at the lane edge.
- Smaller Warden house with a wider door.
- Fix: the warm-up no longer reveals everyone.

### 0.6.8
*2026-11-02*
- HUD: short K/D/A and last-hit/deny line.
- Blink lock countdown.
- Courier button placeholder.
- The draft button fits on screen.

### 0.6.7
*2026-11-02*
- Smaller Warden house.
- Bigger bottom panel with a fixed size.
- The draft layout no longer jumps around.

### 0.6.6
*2026-11-02*
- **Graphics quality** setting: Low / Medium / High.
- 3D uses less battery.

### 0.6.5
*2026-11-02*
- HUD: kills/deaths and last hits/denies under the bars.
- Gold shows with a coin icon.
- Round shop button on the corner of the panel.

### 0.6.4
*2026-11-02*
- **Draft inside the match:** each team bans one hero, picks go 1-2-2-1, then a 30-second warm-up.

### 0.6.3
*2026-11-02*
- Smaller Warden house and wider river.
- Pictures on the ability buttons.
- Hero headshot in the HUD.
- Tidier bottom panel.

### 0.6.2
*2026-11-02*
- **Warden rework:** it lives in a walled house, has a stunning slam, and drops a charm anyone can grab.
- One glass panel for the bottom HUD.

### 0.6.1
*2026-11-02*
- Status icons above the health bar.
- Items moved next to the hero bar.

### 0.6.0
*2026-11-02*
- Item bar is 2 rows of 3.
- Drop items on the ground and pick them back up.

---

## 0.5.x · Bigger map and new buildings

### 0.5.7
*2026-11-02*
- Behind the scenes: project notes and a hero tuning tool.

### 0.5.6
*2026-11-02*
- **Two barracks per lane** (melee and ranged).
- Shrine towers closer together.
- The tower shield makes towers attack faster.
- The fountain shoots enemy heroes.
- **New shop** with tabs, a grid and a detail panel.

### 0.5.5
*2026-11-02*
- Bots: each push decides once who joins it.
- Heroes stuck in trees get freed.

### 0.5.4
*2026-11-02*
- Bots stay in a lane that's being pushed instead of joining a group push.

### 0.5.3
*2026-11-02*
- **Move and attack at the same time.**
- A third tower in each lane.

### 0.5.2
*2026-11-02*
- Behind the scenes: long bot matches in the tests take breaks (fixes the website update).

### 0.5.1
*2026-11-02*
- **New start screen** with a live 3D hero.

### 0.5.0
*2026-11-02*
- **The map is 1.5× bigger** (300 m).
- Bots stick to their plans on the bigger map.

---

## 0.4.x · 3D

### 0.4.3
*2026-11-02*
- 3D animations, bigger units and smoother frames.
- Tapping the ground no longer walks.

### 0.4.2
*2026-11-02*
- If 3D can't run, Settings explains why the game switched to 2D, and shows the build id.

### 0.4.1
*2026-11-02*
- Behind the scenes: tests allow slow full-match simulations (fixes the website update).

### 0.4.0
*2026-11-02*
- **First playable 3D view.** The 2D view stays as a setting.

---

## 0.3.x · Hero balance

Goal: no hero is a must-pick. After the balance passes below, every hero won 45–57% of random bot matches.

### 0.3.12
*2026-11-02*
- The mid-side jungle camp moved off the mid lane.

### 0.3.11
*2026-11-01*
- Balance results: all heroes win 45–57% of matches.

### 0.3.10
*2026-11-01*
- Vexa: less range and damage. Syl and Grom: buffed. Earthsplitter's stun is shorter.

### 0.3.9
*2026-11-01*
- Syl: a little more HP. Vexa: a little less base damage.

### 0.3.8
*2026-11-01*
- Orin: more damage, faster Cataclysm. Kaela: smaller heal.

### 0.3.7
*2026-11-01*
- Vexa: a little less HP. Orin: tougher. Grom: more damage.

### 0.3.6
*2026-11-01*
- Vexa's critical hits no longer hit buildings. Brakk: nerfed. Grom and Syl: buffed.

### 0.3.5
*2026-11-01*
- Brakk and Vexa: nerfed. Orin, Grom and Syl: buffed.

### 0.3.4
*2026-11-01*
- Kaela: better control and heals. Vexa: less range and HP.

### 0.3.3
*2026-11-01*
- Vexa: slower attacks, less damage. Syl and Kaela: buffed.

### 0.3.2
*2026-11-01*
- Vexa and Brakk: nerfed again. Kaela and Orin: buffed.

### 0.3.1
*2026-11-01*
- Vexa and Brakk: nerfed. Kaela, Syl and Grom: buffed.

### 0.3.0
*2026-11-01*
- New tool that plays many bot matches and reports each hero's win rate.

---

## 0.2.x · Six heroes and smarter bots

### 0.2.6
*2026-11-01*
- **Pings**, **practice mode** and a **tutorial**.

### 0.2.5
*2026-11-01*
- **Three new heroes:** Syl (assassin), Grom (bruiser) and Kaela (support).

### 0.2.4
*2026-11-01*
- Dying costs gold: 25 plus 2.5% of your net worth, taken only from unspent gold.

### 0.2.3
*2026-11-01*
- Kill streaks, bounties, an announcer and end-of-match stats.

### 0.2.2
*2026-11-01*
- Balance pass aiming for 15–20 minute matches.

### 0.2.1
*2026-11-01*
- **Smarter bots:** team plans (defend or push), ganks and difficulty levels.

### 0.2.0
*2026-11-01*
- Items that combine into bigger items, and items with a button to use them.

---

## 0.1.x · First playable prototype

### 0.1.12
*2026-11-01*
- Docs: high ground, forest paths, how jungle camps behave, tap controls and item icons.

### 0.1.11
*2026-11-01*
- Fixes for jungle camps and the Warden.
- Tap controls and item icons.
- Forest paths and high ground.

### 0.1.10
*2026-11-01*
- The 3D plan is on hold until the 2D game is finished.

### 0.1.9
*2026-11-01*
- 3D plan and concept pictures.

### 0.1.8
*2026-11-01*
- Scoreboard, damage numbers, ability details, more settings and pause.

### 0.1.7
*2026-11-01*
- Settings, a hero stats panel and assists.
- Attackers are revealed from the fog.
- Creeps grow stronger over time.

### 0.1.6
*2026-11-01*
- Fix: sounds play on iPhone.
- Kill feed.
- Walk while attacking.
- New building layout.

### 0.1.5
*2026-11-01*
- Deny, wards, river power-ups, a boss, buyback, tower shield, backdoor protection and sounds.

### 0.1.4
*2026-11-01*
- Trees block sight.
- Creeps walk around buildings.
- Dashes go through buildings.

### 0.1.3
*2026-11-01*
- Items, shop, teleport, jungle camps, fog of war, day/night and a free camera.

### 0.1.2
*2026-11-01*
- Abilities for all 3 heroes.
- Drag-to-aim casting on phones.
- The game always plays in landscape.

### 0.1.1
*2026-11-01*
- The game is playable online (GitHub Pages), updated on every change.

### 0.1.0
*2026-11-01*
- **First prototype:** 3v3 lane battles with towers, creep waves and the Shrine.
