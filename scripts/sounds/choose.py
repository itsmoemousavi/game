#!/usr/bin/env python3
"""The listening sheet's options: real CC0 recordings, cleaned and leveled the same way. No electric sources.

Each option is a reference to part of a source's file name, with optional settings:
  dur=  longest length, seconds    at=  start, seconds    p=  slower and deeper (<1)    loud=1  start at the loudest part
Writes options/<sound>-<letter>.mp3 and options/list.json.
"""
import json, os, subprocess, sys, tempfile
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

SR, TARGET, LIMIT = 44100, -21.0, 0.79
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'options')
ROOTS = ['dl', 'dl2', 'dl3']

def O(ref, **k): return (ref, k)

G = [
 ('Match start', [
  ('matchHorn', 'War horn at -3 seconds, before the battle begins', 5, ['392180', '539956', '501030', 'theircoming3_0', O('714562', dur=5), O('512490', dur=5, loud=1), O('war_horns.wav', dur=5, loud=1), O('264486', dur=5, loud=1)]),
  ('clockTick', 'Lobby countdown tick', 1, ['metalClick', 'various-sound-effects-0/tick', 'ui/x/click2', 'snd_menu_move']),
  ('clockTock', 'Lobby countdown tock', 1, ['ui/x/click4', 'metalLatch', 'ui/x/click5', 'tap_stone']),
  ('clockGo', 'Lobby countdown ends', 1.6, ['sfx100/x/bell_01', 'sfx100/x/gong_02', 'ding.3', 'correct-bell/bell', 'point-bell/sd_0']),
 ]),
 ('Music', [
  ('deathSong', 'When your hero dies: a little piece of music', 5, ['betterluck_0', 'total fail_0', 'mystery_sting', O('No Hope.ogg', dur=5), O('medieval-defeat-theme/defeat_0', dur=5), 'abyss_0', O('piano_sting', dur=5), O('609656', dur=5)]),
  ('winSong', 'Victory: short song behind the end of the match', 12, ['Heavy_ConceptB', 'victory-4/victory_0', 'victory sting_0', 'just-a-random-fanfare/fanfare_0', 'the-war-over/win_1', O('Victory1_1', dur=12), 'winneris_0', O('orcs_victorious_original_0', dur=12)]),
  ('loseSong', 'Defeat: short song behind the end of the match', 12, ['No Hope.ogg', O('medieval-defeat-theme/defeat_0', dur=12), O('the-war-over/lose_3', dur=12), O('bad_thing_0', dur=12), O('609656', dur=12, at=5), O('piano_sting', dur=12), '368367']),
  ('shrineBoom', 'The Shrine exploding at the end', 6, [O('834213', dur=6, loud=1), '513110', O('ship_destroyed_short', dur=6), 'Chunky Explosion', O('156500', dur=6, loud=1), 'Muffled Distant Explosion', 'cave_in']),
 ]),
 ('Everyday combat', [
  ('hit', 'Getting hit', 1, ['impact_punch_medium_000', 'bfh1_hit_01', 'punch/qubodupPunch01', 'impact/qubodupImpactMeat01', 'player_hit']),
  ('creep', 'Melee creep attacking', 1, ['impact_punch_medium_003', 'punch/qubodupPunch03', 'sword.6', 'melee sound', 'sword sound']),
  ('shoot', 'Ranged creep shot', 1, ['snd_throw', '384907', '384910', 'swish-7', 'tube-plastic-whoosh-01']),
  ('tower', 'Tower firing', 1.5, ['384906', '384905', 'HeavyShot_01', O('cannon_fire_0', dur=1.5), 'impact/qubodupImpactStone']),
  ('deny', 'Denying a creep', 1, ['metalwood/x/wood_hit_03', 'impact/qubodupImpactWood', 'small_rock_impact', 'tap_stone']),
  ('heroDeath', 'A hero dies (the voice or thud)', 2.5, ['creature/x/hurt_01', 'snd_death1', 'various-sound-effects-0/death_2', 'various-sound-effects-0/moan', 'various-sound-effects-0/uff', 'creature_die_01', 'scream_01']),
  ('bodyFall', 'A body falling', 1.5, ['bfh1_falling_01', 'various-sound-effects-0/fall_0', '364690', 'snd_enemyland', 'metal-impact-sounds/thud2']),
  ('armorFall', 'Armor falling', 1.5, ['bfh1_metal_falling_01', 'metal_falling_01', 'metal_falling_02', 'bfh1_metal_falling_03']),
  ('collapse', 'A tower or barracks collapsing', 3, ['703248', 'bfh1_rock_falling_01', 'cave_in', O('ship_destroyed_short', dur=3), 'break_stone']),
 ]),
 ('Brakk (hammer and shield)', [
  ('hammerAttack', 'Hammer attack (also Seren)', 1, ['impact_punch_heavy_000', '640204', 'metal-hammer-hit-01', 'impact/qubodupImpactMetal', 'metal-impact-sounds/thud3', '10-impactshield-blocks/impact.3']),
  ('shieldCharge', 'Shield charge starts', 1.2, ['Wind Spell Impact 1', O('384909', p=0.6), 'sheath-squeeze-01', 'chain_01', '202-more-sound-effects/Cloth_01']),
  ('shieldBash', 'Shield charge hits', 1.2, ['10-impactshield-blocks/impact.1', '10-impactshield-blocks/impact.4', 'sword_clash.1', 'metal_slam_01', '505669']),
  ('quakeCharge', 'Winding up the ground smash', 1.6, [O('222521', dur=1.6), 'Earth Spell Impact 3', 'Earth Element Magic Spell_0', 'stones_02', 'bfh1_rock_falling_03']),
  ('earthsplitter', 'Ground smash lands (also the Warden)', 3, ['513110', '587886', '258195', '703248', 'BlastImpact_01', 'Earth Spell Impact 4']),
  ('slam', 'Heavy slam', 2, ['BlastImpact_03', O('640204', p=0.7), '332058', 'cannon_hit_wall_no_splash', 'bfh1_rock_hit_01', O('364690', p=0.6)]),
  ('ironClang', 'Iron Hide and metal buffs', 1, ['ding.4', 'metalwood/x/metal_hit_02', 'clink1_0', 'bing1', 'sword_clash.5', 'sfx100/x/metal_01']),
 ]),
 ('Vexa and Rhen (bow)', [
  ('bowShot', 'Bow shot', 1, ['384915', '384916', '384917', '384918', '384906']),
  ('arrowHit', 'Arrow hits', 1, ['384914', '384913', '384912', '384911', 'kenney/x/OGG/chop']),
  ('piercingShot', 'Piercing shot', 1.5, ['384918', '384905', '384919', '384909']),
  ('critPing', 'Critical hit', 1, ['item_gem_01', 'metalwood/x/metal_hit_03', 'clink2', 'sword.3', '442769']),
  ('arrowRain', 'Rain of arrows', 2.2, [O('388036', dur=2.2, loud=1), O('388036', dur=2.2, at=6), '384910', 'Wind Spell Impact 4', 'Wind Spell Impact 5']),
 ]),
 ('Orin (fire)', [
  ('fireBolt', 'Fire attack (also Morra)', 1.2, ['267887', 'flame_0', 'Fire Spell Impact 1', 'spell_fire_01', 'spell_fire_02', 'ignition']),
  ('fireHit', 'Fire attack hits', 1, ['Fire Spell Impact 2', 'spell_fire_03', O('fire-crackling/fire-1.', dur=1), 'Fire Spell Impact 4']),
  ('fireballCast', 'Casting a fireball', 2, ['244926', '260554', '522705', '267887', 'spell_fire_04', O('LEGIT_FIR_Fire_Staff 1-', dur=2)]),
  ('fireBlast', 'Fireball explosion', 2.5, ['587886', '258195', 'explosion_crunch_000', 'explosion-0/explosion', 'Chunky Explosion', 'dull_explosion']),
  ('mendFlame', 'Healing flame', 2, ['Healing Spell Impact 1', 'Healing Spell Impact 2', 'Cure1', 'health_restore', '562292']),
  ('meteorFall', 'Meteor falling', 2.5, ['522705', '260554', O('244926', p=0.8), 'Fire Spell Impact 3']),
  ('meteorImpact', 'Meteor lands', 3, ['513110', 'Chunky Explosion', O('587886', p=0.85), 'explosion_crunch_004', 'cannon_hit_1', 'Muffled Distant Explosion']),
 ]),
 ('Syl (daggers)', [
  ('daggerSlash', 'Dagger attack', 1, ['knife_slice2', 'knife_slice_48', '20-sword-sound-effects-attacks-and-clashes/sword.1.', 'swish-1.', 'rpg/x/blade_03', 'knife-unsheathe-02']),
  ('shadowStep', 'Shadow step (also blink items)', 1.2, ['swish-9', O('384909', p=0.7), 'Wind Spell Impact 3', '202-more-sound-effects/Cloth_04', 'snd_batwings']),
  ('vanish', 'Going invisible', 1.6, ['Wind Spell Impact 5', '202-more-sound-effects/Cloth_07', 'magical_6_0', 'various-sound-effects-0/steal']),
  ('execute', 'Execute', 1.2, ['knife_slice_48', 'sword.9', 'sword_clash.6', 'impact_punch_heavy_001', 'sword-knife-clash-10']),
 ]),
 ('Grom (nature)', [
  ('woodPunch', 'Wooden punch (also big jungle creatures)', 1, ['metalwood/x/wood_hit_02', 'wood_slam_01', 'impact/qubodupImpactWood', 'impact_punch_heavy_004', 'impactwood14', 'wood-and-metal-sound-effects-volume-2/wood_and_metal_vol.2_0.zip_x/wood1.aif']),
  ('rootSnare', 'Root snare', 1.2, ['Plant Spell Impact 1', O('crack01', dur=1.2), 'wood_cracking_01', 'Plant Spell Impact 3']),
  ('rootsErupt', 'Roots erupting', 1.8, ['Plant Spell Impact 2', O('impactwood01', dur=1.8), O('crack03', dur=1.8), 'wood_breaking_02', 'Earth Spell Impact 5']),
  ('barkSkin', 'Bark skin', 1.5, ['Plant Spell Impact 4', 'wood_squeak_01', 'wood_misc_02', 'floor-creak-01', O('crack05', dur=1.5)]),
  ('overgrowth', 'Overgrowth', 2.2, ['Plant Spell Impact 5', O('crack04', dur=2.2), O('impactwood05', dur=2.2), 'rustling_of_the_weeds']),
  ('treeFall', 'Grom falling', 2.5, [O('impactwood06', dur=2.5), 'metalwood/x/wood_falling_01', 'bfh1_wood_falling_01', O('impactwood21', dur=2.5), 'metalwood/x/wood_breaking_01']),
 ]),
 ('Kaela (water)', [
  ('waterBolt', 'Water attack', 1, ['364700', 'water/x/splash_03', 'Water Spell Impact 1', 'various-sound-effects-0/swim', 'water/x/splash_07']),
  ('splash', 'Water attack hits', 1.5, ['442773', '210428', 'water/x/splash_02', 'Water Spell Impact 2', 'snd_splat']),
  ('tidalWave', 'Tidal wave', 3, ['wave_01_cc0-18363', 'wave_04_cc0-18363', 'wave_02_cc0-11505', O('235725', dur=3, loud=1), O('563021', dur=3, loud=1), O('273223', dur=3, loud=1)]),
  ('brineVeil', 'Brine veil', 1.6, ['Water Spell Impact 4', 'water/x/bubble_01', O('Shallow Bubbles', dur=1.6), O('water_flowing', dur=1.6)]),
  ('maelstrom', 'Whirlpool', 2.6, [O('loop_water_01', dur=2.6), O('water_flowing', dur=2.6), O('273223', dur=2.6, at=5), O('random-sfx/Background/Falls', dur=2.6), O('loop_water_03', dur=2.6)]),
 ]),
 ('Healing and holy', [
  ('salve', 'Using a Herbal Poultice', 1.5, ['202-more-sound-effects/Drink_01', '202-more-sound-effects/Drink_03', '202-more-sound-effects/Drink_06', 'bottle-glass-uncork-01', 'vial-glass-round-uncork-01', 'various-sound-effects-0/glug']),
  ('heal', 'Healing items', 2, ['562292', 'Cure1', 'Cure2', 'Cure3', 'health_restore', 'Healing Spell Impact 5', O('554312', dur=2)]),
  ('teleport', 'Teleport arrives (heavenly)', 2.8, ['608892', O('466829', dur=2.8, loud=1), O('274121', dur=2.8), O('434700', dur=2.8), 'teleport-spell/teleport', 'magical_4', 'Cure6']),
  ('tpChannel', 'Teleport charging (heavenly)', 3.2, [O('466829', dur=3.2), O('274121', dur=3.2), O('434700', dur=3.2, at=4), O('808032', dur=3.2, at=10), O('554312', dur=3.2), O('211624', dur=3.2)]),
  ('revive', 'Revived by the charm', 2.6, ['608892', 'Healing Spell Impact 11', O('274121', dur=2.6), 'Cure7', 'magic_words']),
  ('levelUp', 'Level up', 1.6, ['Healing Spell Impact 14', 'magical_1_0', 'correct-bell/bell', 'point-bell/sd_0', 'get_important_item', 'snd_getpowerup']),
  ('cast', 'A spell being cast', 1.6, ['magical_2', 'magical_3', 'magical_5', 'Healing Spell Impact 3', O('fantasy_magic_button_1', dur=1.6), 'Wind Spell Impact 2']),
  ('glyph', 'Tower shield', 2, ['Healing Spell Impact 7', O('ding.1', dur=2), O('bong1', dur=2), 'Earth Spell Impact 1', O('sfx100/x/gong_01', dur=2)]),
  ('rune', 'Picking up a rune', 1, ['item_gem_02', 'item_gem_04', 'magical_7_0', 'small_amber', 'big_amber']),
  ('buyback', 'Buying back', 1.6, ['Healing Spell Impact 12', 'gold_sack', 'coins-shake-01', 'magical_2']),
 ]),
 ('Other items', [
  ('frostNova', 'Frost items', 1.6, ['freeze-spell-0/freeze', 'Ice Spell Impact 1', 'Ice Spell Impact 2', 'Ice Spell Impact 3', 'Ice Spell Impact 4', 'sfx100v2_glass_03']),
  ('bellToll', 'Silence bell', 2.4, ['sfx100/x/bell_01', 'sfx100/x/gong_01', 'sfx100/x/gong_02', O('bong1', dur=2.4), O('ding.2', dur=2.4)]),
  ('zap', 'Storm blade (natural: thunder, wind, crack)', 1.6, [O('sfx100v2_thunder_01', dur=1.6), 'Wind Spell Impact 2', 'Wind Spell Impact 4', O('crack07', dur=1.2), 'cannon_miss_1']),
 ]),
 ('Warden and jungle', [
  ('wardenPunch', 'Warden hit', 1.2, ['impact_punch_heavy_002', 'bfh1_rock_hit_01', 'impact/qubodupImpactStone', O('640204', p=0.75), '332058', 'break_stone']),
  ('impStab', 'Small creatures and wolf bite', 1, ['draw_knife2', 'animal melee sound', 'impact_punch_medium_002', 'spit_01', 'various-sound-effects-0/nom']),
  ('roar', 'Wolf howl and Warden wind-up', 2.2, ['creature/x/howl', 'creature/x/roar_01', 'creature_roar_01', 'creature/x/monster_01', 'TRex Moan', 'troll_01']),
  ('stoneCrumble', 'Warden crumbling', 2.5, ['bfh1_rock_breaking_01', 'break_stone', 'rpg/x/stones_01', 'cave_in', 'bfh1_rock_falling_02']),
 ]),
 ('Gold and menus', [
  ('coin', 'Getting gold', 1, ['12-coin-sound-effects/coin.1.', '12-coin-sound-effects/coin.5', '12-coin-sound-effects/coin.8', 'soundpack-02/coin01', 'soundpack-04/coin02', 'coinflip-01', 'coinsplash_0']),
  ('purchase', 'Buying an item', 1.2, ['handleCoins2', 'gold_sack', 'coins-shake-02', '12-coin-sound-effects/coin.11', 'Money_01']),
  ('itemDrop', 'Dropping an item', 1, ['item_misc_01', 'dropLeather', '202-more-sound-effects/Cloth_05', 'wood-bowl-put-wood-01']),
  ('itemPickUp', 'Picking up an item', 1, ['item_misc_02', 'cloth-pouch-shake-01', 'handleSmallLeather.', 'belt-buckle-01', 'quiver-leather-squeeze-07']),
  ('ward', 'Planting a totem', 1, ['item_wood_01', 'wood-bowl-put-wood-02', 'dropLeather', 'wood_misc_03']),
  ('click', 'Button tap', 0.6, ['ui/x/click3', 'ui/x/click1', 'ui/x/switch1', 'snd_menu_select', 'various-sound-effects-0/tick']),
  ('ping', 'Ping on the map', 1.2, ['item_gem_03', 'correct-bell/bell', 'point-bell/sd_0', 'sfx100/x/bell_03', 'ding.4']),
 ]),
]

ALL = []
for root in ROOTS:
    for r, _, fs in os.walk(os.path.join(HERE, root)):
        if '__MACOSX' in r: continue
        for f in fs:
            if f.lower().endswith(('.wav', '.ogg', '.mp3', '.flac', '.aif', '.aiff')) and not f.startswith('._'):
                ALL.append(os.path.join(r, f))
ALL.sort()

def find(ref):
    if ref.isdigit():
        return os.path.join(HERE, 'dl3', ref + '.mp3')
    parts = ref.lower().split('/')
    def fits(p):
        rel, at = os.path.relpath(p, HERE).lower(), 0
        for part in parts:
            at = rel.find(part, at)
            if at < 0: return False
            at += len(part)
        return True
    hits = [p for p in ALL if fits(p)]
    if not hits:
        raise SystemExit('no file for ' + ref)
    # Prefer lossless, then the shortest path.
    return sorted(hits, key=lambda p: (not p.lower().endswith(('.wav', '.flac', '.aif')), len(p)))[0]

def read(path):
    with tempfile.NamedTemporaryFile(suffix='.wav') as t:
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), t.name], check=True)
        x, _ = sf.read(t.name)
    return x

def measure(x):
    y = sosfilt(butter(2, 80, 'high', fs=SR, output='sos'), x)
    y = y + 0.6 * sosfilt(butter(1, 1500, 'high', fs=SR, output='sos'), y)
    n = int(0.1 * SR)
    e = np.convolve(y ** 2, np.ones(n) / n, mode='full')
    return 10 * np.log10(np.max(e) * n / min(n, len(y)) + 1e-12)

def make(path, limit, at=0, dur=None, p=1.0, loud=0):
    x = read(path)
    if at: x = x[int(at * SR):]
    want = dur or limit
    if p != 1.0:
        x = np.interp(np.linspace(0, len(x) - 1, int(len(x) / p)), np.arange(len(x)), x)
    x = sosfilt(butter(2, 35, 'high', fs=SR, output='sos'), x)
    peak = np.max(np.abs(x)) + 1e-9
    x = x / peak
    if loud:
        w = int(0.5 * SR)
        e = np.convolve(x ** 2, np.ones(w), mode='valid')
        x = x[max(0, int(np.argmax(e)) - int(0.5 * SR)):]
    # Start exactly where the sound starts, so it never feels late.
    on = int(np.argmax(np.abs(x) > 0.01))
    x = x[max(0, on - 16):]
    a = np.abs(x)
    tail = len(a) - int(np.argmax(a[::-1] > 10 ** (-58 / 20)))
    x = x[:max(tail, int(0.02 * SR))]
    if len(x) > want * SR:
        x = x[: int(want * SR)]
        n = int(min(0.6, want * 0.25) * SR)
    else:
        n = int(min(0.03, len(x) / SR / 3) * SR)
    x = x.copy(); x[-n:] *= np.linspace(1, 0, n) ** 1.5
    g = 1.0
    for _ in range(14):
        y = np.tanh(x * g / LIMIT) * LIMIT
        gap = TARGET - measure(y)
        if abs(gap) < 0.15: break
        g *= 10 ** (gap / 20)
    return y

def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT): os.remove(os.path.join(OUT, f))
    letters = 'ABCDEFGH'
    out, n, levels, short = [], 0, [], []
    for gname, items in G:
        g = {'name': gname, 'items': []}
        for sid, label, limit, opts in items:
            if len(opts) < 4: short.append(sid)
            it = {'id': sid, 'label': label, 'options': []}
            seen = set()
            for i, o in enumerate(opts):
                ref, k = o if isinstance(o, tuple) else (o, {})
                path = find(ref)
                y = make(path, limit, **k)
                f = f'{sid}-{letters[i]}.mp3'
                with tempfile.NamedTemporaryFile(suffix='.wav') as t:
                    sf.write(t.name, y, SR, subtype='PCM_16')
                    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', t.name, '-c:a', 'libmp3lame', '-b:a', '80k', '-ac', '1', os.path.join(OUT, f)], check=True)
                levels.append(measure(y)); n += 1
                it['options'].append({'file': f, 'source': os.path.relpath(path, HERE), 'seconds': round(len(y) / SR, 2), 'settings': k})
            g['items'].append(it)
        out.append(g)
    json.dump(out, open(os.path.join(OUT, 'list.json'), 'w'), indent=0)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith('.mp3'))
    print(n, 'options', sum(len(g['items']) for g in out), 'sounds', round(size / 1e6, 1), 'MB', 'level', round(min(levels), 1), round(max(levels), 1), 'fewer than 4:', short)

main()
