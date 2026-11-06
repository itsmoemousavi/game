# Ovra: patch notes

Every change to the game, newest first. Each change has its own version number:

- the **middle number** (0.**9**.0) goes up with each big milestone,
- the **last number** (0.9.**3**) goes up with every change inside that milestone.

The version you're playing is shown in **Settings → View** in the game.

| Version | Milestone | Date |
|---|---|---|
| [0.15.x](#015x--a-real-start-and-finish) | A real start and finish | 2026-11-05 |
| [0.14.x](#014x--new-controls-and-rules) | New controls and rules | 2026-11-05 |
| [0.13.x](#013x--three-new-heroes) | Three new heroes | 2026-11-05 |
| [0.12.x](#012x--new-items) | 8 new items | 2026-11-05 |
| [0.11.x](#011x--new-map-art) | New map art and a living world | 2026-11-05 |
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

## 0.15.x · A real start and finish

### 0.15.8
*2026-11-06*

- Fixed the bottom panel, bars and item slots looking squeezed when the phone's rotation lock is on. Everything now sizes itself to the sideways game, so the screen matches a true landscape view.

### 0.15.7
*2026-11-06*

- The courier button moved to the end of the bottom panel, right above the shop button.
- The panel moved further left, and the health, mana and XP bars got their extra width back.

### 0.15.6
*2026-11-06*

- The bottom panel moved further left and has more space between the hero picture, bars, items and courier.
- The shop button has its own spot at the end of the panel and no longer covers the courier slots.

### 0.15.5
*2026-11-05*

- The spells are back beside the Attack button.
- The health, items and hero panel now stops just short of the first spell on every screen size, and the item slots are slightly smaller so everything fits.

### 0.15.4
*2026-11-05*

- The health, items and hero panel now sits near the middle of the screen, 28 px left of centre.
- The health, mana and XP bars are wider, with a little more space above the XP bar.
- The gold amount is centred.
- The three spells moved up to sit in an arc above the Attack button, so the panel doesn't cover them.


### 0.15.3
*2026-11-05*

- The channel bar now fits its text on one line, and runs from full to empty as the seconds count down.
- The health, items and hero panel moved back to the right a little.
- Removed the Warden messages. Its teleport effect shows what is happening.

### 0.15.2
*2026-11-05*

**The Warden now has two houses:**
- There is a house at the top and one at the bottom. The Warden starts in one of them at random.
- When day turns to night it spends 4 seconds gathering itself, then teleports to the other house. A bar over it shows the time left.
- Stun it during those seconds and it stays where it is until the next nightfall. If nobody does, chase it to the other house and finish the fight there.

**Towers:**
- Trees now block a tower's sight. If you stand behind trees it won't see or shoot you, unless the enemy has vision of you some other way, like a ward or a hero nearby.
- Towers also show enemy wards inside their range.
- Anyone who attacks a building is revealed for 3 seconds, even with nobody around.

**Screen:**
- The clock and sun or moon now stack in a circle at the top centre, with the team scores on either side.
- The loading screen is now sideways when the phone is held upright.
- The health, items and hero panel sits further left.
- The game asks for full screen where the phone allows it. On iPhone, a web page cannot always hide the top bar.

**Map:**
- Each lane's two barracks stand closer together, and the tier-3 tower stands closer to the middle of the road.

### 0.15.1
*2026-11-05*

**Towers see differently:**
- Towers no longer light up the map. The ground around them stays in fog, so only heroes, creeps and totems give vision on the lanes. Barracks, the Shrine and the fountain still give vision.
- Anyone who steps into a tower's attack zone is seen by that tower's whole team and gets shot, even in fog and even invisible. Leave the zone and you are hidden again.

**Morra's wolves are easier to use:**
- They attack whatever Morra attacks, with auto attack too, including jungle camps.
- They turn on whoever hits her.
- They stay closer to her, and don't dive under towers or attack buildings on their own.
- They last 35 s instead of 22 s and are slightly weaker to make up for it.
- Red Wolf form is faster: 30/35/40% move speed instead of 20/25/30%.

**Watcher totems see farther:** 24 m by day and 18 m at night, and 34 m and 26 m from on top of a mountain.

**Screen:**
- The match starts with a 30 second countdown, then the clock counts up from 0:00, with no minus sign.
- The Attack button is bigger, and Attack and the spells sit a little further left.
- When you die you only see the respawn countdown and the buyback button.
- The channel bar has more room around it and around its text.
- The Shrine no longer has true sight or a green eye, and the extra eye painted on the ground is gone.

**Going around things:** bots, creeps and wolves now notice when they aren't getting anywhere and walk around whatever is blocking them. They only stand still if there is truly no way through.

### 0.15.0
*2026-11-05*

**Start and finish**
- New loading screen, with a bar that moves while the game gets ready.
- New start menu: Play with Bots, Practice, and Play with Friend (coming soon).
- The match now ends properly: everything freezes, the camera glides to the fallen Shrine, it blows apart in fire and flying stones, the result comes up, and then the end screen with the leaderboard and MVP.

**Spells ignore trees, walls and buildings**
- Charges and dashes such as Brakk's now go straight through trees, walls, buildings and mountains. Only walking is blocked.
- If a charge ends inside something, you come out at the nearest open spot.
- A charge can land you on a mountain, take you off one, get you in or out of a hiding spot, or carry you into the Warden's house.

**Mountains and forest**
- Ward spots are now tall rock mountains, moved off the lanes and trails into the woods between forests. Open ground all around lets you walk to the foot and plant a ward on top.
- Nobody can walk up or down a mountain. Get up or down with a blink, a teleport or a charge.
- Melee heroes can only hit someone on a mountain from up there; ranged heroes can if they have vision.
- About half as many trees, so nothing feels crowded. The woods now hide small pockets you can only get in or out of with a blink, a charge or a teleport.
- Removed the single tree near the rocks by the Warden's house, on both sides.

**True sight**
- Towers, the Shrine and the fountain always show invisible enemies inside their range. Step out and you are hidden again.
- Sentry totems now give normal vision for only their first 5 seconds. After that they show invisible things only where your team already has vision. Vision is the Watcher totem's job.
- Everything with true sight wears a green eye on top.

**Look**
- The courier is now a proper pack mule that grows feathered wings when it starts flying.
- All item and spell icons share calmer colours and a thin gold edge.

**Behind the scenes**
- Bots that end up on a mountain or in a hiding spot are lifted out, because they can't use the escape routes yet.
- The hard-bot test now checks kills only, because hard bots still don't win more matches than easy ones.

## 0.14.x · New controls and rules

### 0.14.0
*2026-11-05*

**Attacking works in a new way:**
- **Auto attack on:** your hero hits the nearest target in range by itself, also while walking, and stays on it while it's in range. Pick another enemy by holding Attack and dragging: it comes first until it dies or leaves your range. Auto attack never denies and doesn't wake up jungle camps.
- **Auto attack off:** one attack per tap. Holding Attack only aims, and the attack happens when you let go. Tapping faster than your attack speed does nothing extra.
- **Denies** are always one attack, in both modes.

**Teleporting:**
- A bar over your health bar shows anything charging up: teleports and long spell wind-ups.
- Moving no longer cancels a teleport. Your hero stays frozen until it lands, or until you tap the new X on the teleport slot.
- If the tower you're teleporting to falls, you still arrive there.

**New items:**
- **Wayfarer Boots:** the fastest boots. You always have 1 teleport that's never used up, with half the cooldown, and you can teleport to allied heroes and creeps too. You can't buy scrolls while you have them; drop them and you keep 1.
- **Clearwater Flask:** restores mana over time.
- **Long Scope:** a cheap early item: more attack range for ranged heroes, and a little attack speed.

**Also:**
- **Mega Creeps:** when all 6 of a team's barracks have fallen, the enemy sends huge horned creeps that are far stronger.
- The camera starts further out, and that's now the furthest it goes: you can only zoom in.
- The minimap marks jungle camps, and shows couriers out on the map as small dots.
- Joystick sizes are further apart, and the joystick shows on screen when you pick a size in Settings.

---

## 0.13.x · Three new heroes

### 0.13.0
*2026-11-05*

**Morra the Beastcaller**, a summoner:
- **Call the Pack:** calls a wolf, or two from level 3, that fights for you for 22 seconds.
- **Feral Bond:** your wolves heal, hit harder and run faster. Morra gets the speed too, unless she is the Red Wolf.
- **Red Wolf (ultimate):** for 14 seconds Morra becomes a big red wolf and fights in melee, with more attack speed, damage and move speed and a small chance of critical hits.

**Seren the Aegis**, a sturdy protector:
- **Aegis:** a shield on an ally or herself soaks up damage for 3 seconds.
- **Rebuke:** a lance of light damages and slows everything in its line.
- **Sanctuary (ultimate):** a golden dome: allies inside take much less damage and enemies inside are slowed.

**Rhen the Galewalker**, a fast ranged fighter:
- **Gale Step:** dashes straight through enemies, then attacks faster for 3 seconds.
- **Hawk Mark:** an enemy loses armor and can't hide, even by turning invisible.
- **Bolt Storm (ultimate):** fires a stream of bolts at nearby enemies while Rhen keeps moving.

Also:
- The draft screen shows all 9 heroes in one row.
- Grom hits a little harder (64 starting damage, was 60).

---

## 0.12.x · New items

### 0.12.0
*2026-11-05*

Eight new items:

- **Sunder Pike:** your attacks lower the target's armor.
- **Storm Blade:** attacks sometimes throw lightning at the target and up to 2 enemies near it.
- **Siege Maul:** your attacks hit buildings much harder.
- **Ghost Shroud:** use it to turn invisible and move faster for a few seconds.
- **Bramble Mail:** melee attackers take part of the damage they deal to you.
- **Mender's Censer:** use it to heal yourself and allied heroes nearby.
- **Hush Bell:** use it to stop nearby enemy heroes casting abilities for 3 seconds. Items still work, and spell immunity protects them.
- **Mire Staff:** use it on an enemy for damage and a heavy slow.

Bots use most of them too. Hero win rates stayed balanced, all between 45% and 55% over 120 bot matches.

---

## 0.11.x · New map art

### 0.11.3
*2026-11-05*
- **Every unit has a new body:** Vexa, Orin, Syl, Grom, Kaela, lane soldiers and casters, the jungle brute and goblin, and the Warden. Their animations, sizes and stats are the same.
- Hooded heroes now show a face under a proper hood, and Orin has a real beard.

### 0.11.2
*2026-11-05*
- **New shop:** clearer tabs, every item shows its name, and items are sorted into basic and combined. One row at the bottom holds your items, scrolls and courier.
- **Teleport scroll** is now a normal shop item: tap it, then Buy. With no scrolls left, tapping the TP slot opens the shop with the scroll already picked.
- **Brakk has a new body and armour**, with the same animations.
- Hero pictures now show the hero's head properly.
- Darker fountain water, and no more pale edges under the stone walls.

### 0.11.1
*2026-11-05*
- **Everything matches now:** heroes, creeps, monsters and buildings share the map's painted look, with soft shading, muted colours and grime near the ground.
- **Buildings rebuilt:** towers, barracks, the Shrine and fountains are real stonework in the same stone as the map's walls, and they stand in worn earth instead of sitting on top of the ground.
- **Crystals** look like solid gems in the team's colour.
- Your hero's picture has a dark backdrop instead of a bright disc.

### 0.11.0
*2026-11-05*
- **New map art:** painted grass and earth, roads with worn edges, new trees and undergrowth, weathered river stones and real stone walls at the Warden's house and the fountain yards.
- **The river flows:** the current follows the bends and foam laps at the shore.
- **A living world:** wind moves the trees and grass, cloud shadows drift over the ground, and fireflies come out at night. None of it reacts to units, so it can't give away a hidden hero.
- **Fog of war** has smooth edges, and rocks and plants now darken inside it.
- **Watcher Totem** sees further: 19 m by day and 14 m at night (was 16 m and 12 m).
- Graphics quality Low skips the wind, grass and ground detail to save battery.
- Behind the scenes: hidden parts of the forest are no longer drawn, so the map draws about half as many triangles.

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
