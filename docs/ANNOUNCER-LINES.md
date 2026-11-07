# Announcer lines

The owner's 36 voice lines, made in ElevenLabs. The originals are cleaned and leveled by `scripts/sounds/voices.py` into
`public/sfx/voice`. To add or replace a line: same file name, then add new names to `VOICE_NAMES` in `src/client/audio.ts`.
Which line plays when is in `src/client/announcer.ts`. "Your" and "enemy" are heard from each player's own side.

Lines never overlap. They wait their turn, most important first, and a line still waiting after 10 seconds is dropped.

## The match

| File | Line | Plays |
|---|---|---|
| `battle_soon` | Fifteen seconds until the battle begins. | at -0:15 |
| `battle_begins` | The battle begins! | at 0:00 |

## Towers

| File | Line |
|---|---|
| `your_top_tower_attacked` | Your top tower is under attack! |
| `your_mid_tower_attacked` | Your middle tower is under attack! |
| `your_bot_tower_attacked` | Your bottom tower is under attack! |
| `your_top_tower_fallen` | Your top tower has fallen. |
| `your_mid_tower_fallen` | Your middle tower has fallen. |
| `your_bot_tower_fallen` | Your bottom tower has fallen. |
| `enemy_top_tower_fallen` | The enemy's top tower has fallen! |
| `enemy_mid_tower_fallen` | The enemy's middle tower has fallen! |
| `enemy_bot_tower_fallen` | The enemy's bottom tower has fallen! |
| `your_shrine_tower_attacked` | Your Shrine tower is under attack! |
| `your_shrine_tower_fallen` | Your Shrine tower has fallen. |
| `enemy_shrine_tower_fallen` | An enemy Shrine tower has fallen! |

An "under attack" line repeats for the same building only after 30 seconds of match time. Each tower has its own timer;
a lane's two barracks share one, and so do the two Shrine towers. Your team's own denies don't count.

## Barracks and Mega Creeps

| File | Line |
|---|---|
| `your_barracks_attacked` | Your barracks are under attack! |
| `your_top_barracks_fallen` | Your top barracks has fallen. |
| `your_mid_barracks_fallen` | Your middle barracks has fallen. |
| `your_bot_barracks_fallen` | Your bottom barracks has fallen. |
| `enemy_top_barracks_fallen` | The enemy's top barracks has fallen! |
| `enemy_mid_barracks_fallen` | The enemy's middle barracks has fallen! |
| `enemy_bot_barracks_fallen` | The enemy's bottom barracks has fallen! |
| `your_mega_creeps` | Your creeps are now Mega Creeps! |
| `enemy_mega_creeps` | The enemy now has Mega Creeps! |

## The Shrine

| File | Line |
|---|---|
| `your_shrine_attacked` | Your Shrine is under attack! |

## Kills

Everyone hears these, whichever team made the kill.

| File | Line | Plays |
|---|---|---|
| `first_blood` | First blood! | the match's first hero kill |
| `double_kill` | Double kill! | one hero, two kills in a row |
| `triple_kill` | Triple kill! | one hero, three kills in a row |
| `team_wipe` | Team wipe! | all three heroes of a team are dead, whoever killed them |
| `hot_streak` | Hot streak! | 3 kills without dying |
| `blazing` | Blazing! | 4 kills without dying |
| `inferno` | Inferno! | 5 kills without dying |
| `legendary` | Legendary! | 6 or more kills without dying |
| `shutdown` | Shutdown! | a hero on a streak is killed |

## The Warden

| File | Plays |
|---|---|
| `warden_fallen` | every time the Warden dies, whoever killed it, on both teams |

## Your hero

Only when you tap a spell that can't go yet, only when nothing else is being said, and at most once every 3 seconds.

| File | Line |
|---|---|
| `not_enough_mana` | Not enough mana. |
| `on_cooldown` | Not ready yet. |
