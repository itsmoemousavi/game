# Where the game's sounds come from

Every file in `public/sfx` is made by `scripts/sounds/design.py`, which layers recordings with natural sounds it models
itself (explosion bodies, water, fire, strings, chimes, choir). All recordings used are **CC0** (free for commercial
use, no credit needed), from these packs on OpenGameArt:

- [150 Combat Sound Effects](https://opengameart.org/content/150-combat-sound-effects) (per-file sources in its LICENSES.txt)
- [80 CC0 RPG SFX](https://opengameart.org/content/80-cc0-rpg-sfx)
- [80 CC0 Creature SFX](https://opengameart.org/content/80-cc0-creature-sfx)
- [100 CC0 Metal and Wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx)
- [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2)
- [40 CC0 Water SFX](https://opengameart.org/content/40-cc0-water-splash-slime-sfx)
- [75 CC0 Breaking and Falling SFX](https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx)
- [50 RPG Sound Effects](https://opengameart.org/content/50-rpg-sound-effects)
- [51 UI Sound Effects](https://opengameart.org/content/51-ui-sound-effects-buttons-switches-and-clicks)

To rebuild: unzip each pack as `<folder>/x/` under one directory (folder names are at the top of `design.py`), then

```bash
pip install numpy scipy soundfile   # plus ffmpeg
SFX_SOURCES=/path/to/packs python3 scripts/sounds/design.py public/sfx
```
