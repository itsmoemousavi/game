#!/usr/bin/env python3
"""Ovra's sound set: CC0 recordings layered with modelled natural sounds. Nothing electric, no footsteps.

Run with numpy, scipy, soundfile and ffmpeg. Writes one leveled MP3 per game sound into the output folder.
Attack sounds keep LEAD seconds of swing before the impact, so the game can land the impact on the hit frame.
"""
import hashlib, json, os, re, subprocess, sys
import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
LEAD = 0.08
TARGET = -21.0
LIMIT = 0.79
HERE = os.path.dirname(os.path.abspath(__file__))
DL = os.environ.get('SFX_SOURCES', os.path.join(HERE, 'dl'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'final')
rng = np.random.default_rng(1)

M, E, S = 'combat/x/01_combat_melee/', 'combat/x/03_explosions_destruction/', 'combat/x/04_magic_spells/'
R = 'combat/x/02_combat_ranged/'
RP, CR, MW, SX, S2, WA, BR, UI, KE = 'rpg/x/', 'creature/x/', 'metalwood/x/', 'sfx100/x/', 'sfx2/x/sfx100v2_', 'water/x/', 'breaking/x/', 'ui/x/', 'kenney/x/OGG/'

# ------------------------------------------------------------------ building blocks

def src(pat, pitch=1.0):
    """A recording, mono, silence cut from its start. pitch < 1 plays it slower and deeper, like a bigger object."""
    import glob
    hits = sorted(h for h in glob.glob(glob.escape(os.path.join(DL, pat)) + '*') if h.lower().endswith(('.wav', '.ogg', '.mp3')))
    if not hits: sys.exit('missing ' + pat)
    x, rate = sf.read(hits[0], always_2d=True)
    x = x.mean(axis=1)
    x = x / (np.max(np.abs(x)) + 1e-9)
    on = np.argmax(np.abs(x) > 0.02)
    x = x[max(0, on - 8):]
    rate = rate * pitch
    n = int(len(x) * SR / rate)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)

def sec(t): return int(t * SR)
def noise(t): return rng.standard_normal(sec(t)) * 0.3
def lp(x, f, o=2): return sosfilt(butter(o, min(f, SR / 2.2), 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a, min(b, SR / 2.2)], 'band', fs=SR, output='sos'), x)

def mix(*parts):
    """(signal, start seconds, gain) layers on one timeline."""
    end = max(sec(s) + len(x) for x, s, _ in parts)
    y = np.zeros(end)
    for x, s, g in parts:
        y[sec(s):sec(s) + len(x)] += x * g
    return y

def env(n, a, d, curve=3.0):
    """Quick rise then a natural decay over n samples."""
    t = np.arange(n) / SR
    rise = np.clip(t / max(a, 1e-4), 0, 1)
    return rise * np.exp(-curve * np.clip(t - a, 0, None) / max(d, 1e-4))

def fade(x, t=0.03):
    n = min(sec(t), len(x))
    y = x.copy(); y[-n:] *= np.linspace(1, 0, n)
    return y

def sweep_filter(x, f0, f1, q=0.9, curve=1.0):
    """Band of noise moving from f0 to f1: wind, air, rushing water."""
    y = np.zeros(len(x)); lo = band = 0.0
    n = len(x); damp = 1.0 / q
    for i in range(n):
        k = (i / n) ** curve
        g = 2 * np.sin(np.pi * min(f0 * (f1 / f0) ** k, SR / 6) / SR)
        lo += g * band
        hi = x[i] - lo - damp * band
        band += g * hi
        y[i] = band
    return y

def whoosh(t, f0, f1, q=1.2, peak=0.6):
    """Air moving past: a swing, a thrown thing."""
    n = sec(t)
    u = np.arange(n) / n
    shape = np.sin(np.pi * np.clip(u / peak, 0, 1) / 2) ** 2 * np.clip((1 - u) / (1 - peak), 0, 1) ** 2
    return lp(sweep_filter(noise(t), f0, f1, q), max(f0, f1) * 2.2, 2) * shape * 2.2

def boom(t, f0=85, f1=34, level=1.0, rumble=0.5):
    """The low body of something big landing."""
    n = sec(t)
    u = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-u * 9)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.003, t * 0.55)
    roar = lp(noise(t), 170, 3) * 3.2 * env(n, 0.01, t * 0.7)
    return (body + rumble * roar) * level

def debris(t, density=30, seed=0):
    """Small stones and grit falling after an impact."""
    r = np.random.default_rng(seed + 7)
    y = np.zeros(sec(t))
    for _ in range(int(density * t)):
        s = int(len(y) * r.random() ** 1.5)
        ln = int(SR * r.uniform(0.008, 0.035))
        if s + ln >= len(y): continue
        g = r.uniform(0.2, 1) * (1 - s / len(y))
        tick = r.standard_normal(ln) * np.exp(-np.arange(ln) / (ln / 4))
        y[s:s + ln] += tick * g
    return bp(y, 450, 3200)

def crackle(t, rate=45, seed=0):
    """Fire: dry little snaps."""
    r = np.random.default_rng(seed + 11)
    y = np.zeros(sec(t))
    for _ in range(int(rate * t)):
        s = r.integers(0, len(y) - 300)
        ln = int(r.uniform(15, 200))
        y[s:s + ln] += r.standard_normal(ln) * np.exp(-np.arange(ln) / (ln / 3)) * r.uniform(0.2, 1) ** 2
    return bp(y, 900, 5200)

def flame(t, f=480):
    """Fire: the soft body of the flame."""
    n = sec(t)
    x = lp(noise(t), f, 2)
    wobble = 1 + 0.45 * np.interp(np.arange(n), np.linspace(0, n, max(4, int(t * 14))), rng.uniform(-1, 1, max(4, int(t * 14))))
    return x * 3 * wobble

def bubbles(t, count, f0=500, f1=1700, tail=0.05, rise=0.14, seed=0):
    """Water, modelled the way water sounds: each bubble rings at a pitch that rises as it closes."""
    r = np.random.default_rng(seed + 23)
    y = np.zeros(sec(t) + sec(0.3))
    for _ in range(count):
        s = int(r.random() ** 1.3 * sec(t))
        f = np.exp(r.uniform(np.log(f0), np.log(f1)))
        tau = tail * (900 / f) ** 0.7 * r.uniform(0.6, 1.3)
        ln = int(min(tau * 6, 0.25) * SR)
        u = np.arange(ln) / SR
        ping = np.sin(2 * np.pi * f * (u + rise * u * u / (2 * tau))) * np.exp(-u / tau) * (1 - np.exp(-u / 0.0008))
        y[s:s + ln] += ping * r.uniform(0.15, 1)
    return y

def surf(t, f0=350, f1=1200, swell=0.5):
    """A rolling mass of water: dark wash with hiss on top, rising and falling."""
    n = sec(t)
    u = np.arange(n) / n
    shape = np.sin(np.pi * np.clip(u / swell, 0, 1) / 2) ** 2 * np.clip((1 - u) / (1 - swell), 0, 1) ** 1.5
    body = lp(sweep_filter(noise(t), f0, f1, 0.5), max(f0, f1) * 2.5, 2) * 2.2
    hiss = bp(noise(t), 2200, 6000) * 0.09
    gust = 1 + 0.25 * np.interp(np.arange(n), np.linspace(0, n, max(4, int(t * 9))), rng.uniform(-1, 1, max(4, int(t * 9))))
    return (body + hiss) * shape * gust

def reverb(x, t=1.2, mix_=0.25, bright=4500, pre=0.012):
    """A large stone hall, made from decaying filtered noise."""
    n = sec(t)
    ir = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / n)
    ir = lp(ir, bright)
    ir = np.concatenate([np.zeros(sec(pre)), ir])
    wet = fftconvolve(np.concatenate([x, np.zeros(n)]), ir)[: len(x) + n]
    wet *= np.sqrt(np.sum(x ** 2) + 1e-9) / (np.sqrt(np.sum(wet ** 2)) + 1e-9)
    return np.concatenate([x, np.zeros(n)]) + wet * mix_

def bell(f, t=1.6, partials=((1, 1), (2.0, 0.6), (2.76, 0.28), (5.4, 0.12), (8.9, 0.05)), a=0.002):
    """A struck bell or chime."""
    n = sec(t); u = np.arange(n) / SR; y = np.zeros(n)
    for ratio, g in partials:
        y += g * np.sin(2 * np.pi * f * ratio * u) * np.exp(-u * (2.5 + ratio * 1.8) / (t / 1.6))
    return y * np.clip(u / a, 0, 1)

SOFT = ((1, 1), (2.0, 0.28), (3.0, 0.08), (4.2, 0.03))

def chimes(notes, gap=0.09, t=1.2, a=0.012, soft=True):
    """Soft glass chimes, one after another."""
    return mix(*[(bell(f, t, SOFT if soft else ((1, 1), (2.0, 0.6), (2.76, 0.28), (5.4, 0.12)), a), i * gap, 1 - 0.05 * i) for i, f in enumerate(notes)])

def harp(notes, gap=0.07, t=1.5):
    """A plucked string for each note: a heavenly run."""
    return mix(*[(pluck(f, t, 0.5), i * gap, 1) for i, f in enumerate(notes)])

def pluck(f, t=0.5, soft=0.5, seed=0, die=4.0):
    """A real plucked-string model: bowstrings and harps."""
    r = np.random.default_rng(seed + int(f))
    period = int(SR / f)
    n = sec(t)
    y = np.zeros(n)
    y[:period] = lp(r.standard_normal(period + 64), 2500 + 6000 * (1 - soft))[64:] if period > 0 else 0
    loss = 0.5 * (0.994 + 0.0055 * (1 - soft))
    for i in range(period + 1, n):
        y[i] = loss * (y[i - period] + y[i - period - 1])
    return y * np.exp(-np.arange(n) / SR * die)

FORMANTS = ((730, 90, 1.0), (1090, 110, 0.5), (2440, 170, 0.22), (3400, 250, 0.08))  # the vowel "ah"

def choir(notes, t, attack=0.5, release=0.8, voices=5):
    """A sung chord: several slightly unsteady voices through vowel shapes, like a choir in a hall."""
    n = sec(t); u = np.arange(n) / SR; total = np.zeros(n)
    for f in notes:
        for v in range(voices):
            drift = 1 + rng.uniform(-0.006, 0.006) + 0.0035 * np.sin(2 * np.pi * rng.uniform(4.2, 5.6) * u + rng.uniform(0, 6))
            phase = 2 * np.pi * np.cumsum(f * drift) / SR + rng.uniform(0, 6)
            voice = sum(np.sin(k * phase) / k for k in range(1, 16))
            total += voice
    y = sum(g * bp(total, c - w, c + w) for c, w, g in FORMANTS)
    shape = np.clip(u / attack, 0, 1) ** 1.5 * np.clip((t - u) / release, 0, 1) ** 1.5
    return y * shape

def horn(notes, t, attack=0.08, release=0.5, cutoff=1400):
    """Warm brass: a chord of sawtooth-rich tones, opened up by the breath."""
    n = sec(t); u = np.arange(n) / SR; y = np.zeros(n)
    for f in notes:
        for det in (-0.003, 0, 0.003):
            ph = 2 * np.pi * f * (1 + det) * u + rng.uniform(0, 6)
            y += sum(np.sin(k * ph) / k ** 1.25 for k in range(1, 14))
    return lp(y, cutoff, 2) * np.clip(u / attack, 0, 1) * np.clip((t - u) / release, 0, 1) ** 1.3

def drum(f=70, t=0.9):
    """A big orchestral drum."""
    n = sec(t); u = np.arange(n) / SR
    tone = np.sin(2 * np.pi * np.cumsum(f + 60 * np.exp(-u * 30)) / SR) * np.exp(-u * 4.5)
    return tone + 0.3 * lp(noise(t), 900) * np.exp(-u * 26)

def coin(f, t=0.4, seed=0):
    """A coin: high, metallic, uneven partials."""
    r = np.random.default_rng(seed)
    n = sec(t); u = np.arange(n) / SR; y = np.zeros(n)
    for ratio in (1, 1.51, 2.27, 2.9, 3.74):
        y += np.sin(2 * np.pi * f * ratio * r.uniform(0.99, 1.01) * u) * np.exp(-u * r.uniform(9, 22)) / ratio ** 0.6
    return y * np.clip(u / 0.0006, 0, 1)

def after(lead_part, hit, lead=LEAD, g=0.6):
    """A swing leading exactly `lead` seconds into the impact."""
    return mix((lead_part[-sec(lead):] if len(lead_part) > sec(lead) else lead_part, 0, g), (hit, lead, 1))

def melee(hit, f0=500, f1=2100, g=0.55):
    return after(whoosh(LEAD, f0, f1, 1.2, 0.85), hit, LEAD, g)

A3, Cs4, E4, Fs4, A4, B4, Cs5, E5, Fs5, A5, B5, Cs6, E6, Fs6, A6 = 220, 277.2, 329.6, 370, 440, 493.9, 554.4, 659.3, 740, 880, 987.8, 1108.7, 1318.5, 1480, 1760

# ------------------------------------------------------------------ the sounds

def sounds():
    S_ = {}
    # Attacks: LEAD seconds of swing, then the impact.
    S_['swing'] = melee(src(RP + 'blade_01'))
    S_['hit'] = src(BR + 'bfh1_hit_01')
    S_['hammerAttack'] = melee(mix((src(M + 'impact_punch_heavy_000', 0.85), 0, 1), (src(MW + 'metal_hit_01', 0.7), 0, 0.35), (boom(0.3, 95, 45, 0.5), 0, 1)), 350, 1500)
    S_['daggerSlash'] = melee(mix((src(M + 'knife_slice2'), 0, 1), (src(M + 'impact_punch_medium_001', 1.3), 0, 0.3)), 1500, 5500)
    S_['woodPunch'] = melee(mix((src(MW + 'wood_hit_02', 0.75), 0, 1), (src(M + 'impact_punch_heavy_004', 0.9), 0, 0.5), (boom(0.28, 90, 50, 0.4), 0, 1)), 300, 1100)
    S_['creep'] = melee(mix((src(M + 'impact_punch_medium_003'), 0, 0.8), (src(MW + 'metal_hit_03', 1.2), 0, 0.22)), 700, 2600, 0.4)
    S_['impStab'] = melee(mix((src(M + 'impact_punch_medium_002', 1.2), 0, 1), (src(CR + 'grunt_02', 1.3), 0, 0.15)), 900, 3000, 0.4)
    S_['wardenPunch'] = melee(mix((src(BR + 'bfh1_rock_hit_01', 0.7), 0, 0.9), (src(M + 'impact_punch_heavy_002', 0.72), 0, 1), (boom(0.55, 80, 36, 0.9), 0, 1), (debris(0.5, 22, 3), 0.03, 0.3)), 200, 900, 0.5)
    S_['deny'] = src(MW + 'wood_hit_03')
    S_['tower'] = mix((src(R + 'HeavyShot_01', 0.8), 0, 0.3), (whoosh(0.22, 900, 2600, 1.0, 0.2), 0, 0.8), (boom(0.2, 130, 60, 0.6), 0, 1))
    # Thrown and shot things.
    S_['shoot'] = mix((whoosh(0.2, 700, 3000, 1.0, 0.3), 0, 1), (src(KE + 'cloth1', 1.2), 0, 0.2))
    S_['bowShot'] = mix((lp(pluck(155, 0.3, 0.6, 1, 22), 2600), 0, 0.8), (lp(pluck(310, 0.16, 0.6, 2, 34), 3200), 0, 0.3), (whoosh(0.2, 1500, 5500, 1.3, 0.25), 0.012, 0.8), (src(MW + 'wood_hit_05', 1.5), 0, 0.14))
    S_['arrowHit'] = mix((src(KE + 'chop'), 0, 1), (src(MW + 'wood_hit_01', 1.2), 0, 0.35))
    S_['piercingShot'] = reverb(mix((lp(pluck(120, 0.45, 0.6, 3, 13), 2400), 0, 0.9), (whoosh(0.5, 900, 6500, 1.4, 0.2), 0.012, 1.1), (boom(0.2, 150, 70, 0.3), 0, 1)), 0.5, 0.18)
    S_['critPing'] = mix((src(MW + 'metal_hit_03', 1.1), 0, 0.5), (bell(1900, 0.35, SOFT), 0, 0.5))
    def rain():
        parts = [(whoosh(0.28, 1000, 4500, 1.5, 0.5), 0.08 * i + rng.uniform(0, 0.04), rng.uniform(0.5, 1)) for i in range(10)]
        parts += [(src(KE + 'chop', rng.uniform(0.9, 1.3)), 0.55 + 0.1 * i + rng.uniform(0, 0.05), rng.uniform(0.2, 0.5)) for i in range(7)]
        return mix(*parts)
    S_['arrowRain'] = reverb(rain(), 0.5, 0.12)
    # Fire.
    S_['fireBolt'] = mix((whoosh(0.3, 350, 1300, 0.8, 0.3), 0, 1), (flame(0.3), 0, 0.3), (crackle(0.3, 50), 0, 0.5))
    S_['fireHit'] = mix((flame(0.3, 700) * env(sec(0.3), 0.004, 0.2), 0, 1), (crackle(0.35, 90, 1), 0, 0.8), (boom(0.2, 110, 55, 0.5), 0, 1))
    S_['fireballCast'] = mix((whoosh(0.75, 220, 1500, 0.7, 0.45), 0, 1.1), (flame(0.75, 500) * env(sec(0.75), 0.18, 0.4), 0, 0.6), (crackle(0.75, 40, 2), 0.1, 0.5))
    S_['fireBlast'] = reverb(mix((boom(1.0, 105, 36, 1.1, 0.8), 0, 1), (src(E + 'explosion_crunch_000', 0.75), 0, 0.65), (flame(0.9, 900) * env(sec(0.9), 0.006, 0.55), 0, 0.55), (crackle(1.2, 45, 3), 0.05, 0.5), (debris(0.9, 18, 4), 0.1, 0.2)), 0.9, 0.2)
    S_['mendFlame'] = reverb(mix((chimes([Cs5, E5, A5, Cs6], 0.11, 1.0, 0.03), 0, 0.5), (flame(1.0, 420) * env(sec(1.0), 0.25, 0.5), 0, 0.35), (crackle(0.8, 10, 5), 0.1, 0.2)), 1.2, 0.3)
    S_['meteorFall'] = reverb(mix((whoosh(1.5, 180, 1300, 0.6, 0.9), 0, 1.2), (flame(1.5, 650) * np.linspace(0.2, 1, sec(1.5)), 0, 0.5), (crackle(1.5, 30, 6), 0, 0.3)), 0.6, 0.12)
    S_['meteorImpact'] = reverb(mix((boom(1.5, 90, 28, 1.3, 1.0), 0, 1), (src(E + 'explosion_crunch_004', 0.7), 0, 0.7), (src(BR + 'bfh1_rock_breaking_01', 0.75), 0, 0.5), (debris(1.5, 30, 7), 0.1, 0.35), (crackle(1.4, 35, 8), 0.1, 0.35)), 1.3, 0.25)
    # Ground.
    S_['slam'] = reverb(mix((boom(0.9, 80, 30, 1.2, 0.8), 0, 1), (src(BR + 'bfh1_rock_hit_01', 0.6), 0, 0.9), (src(M + 'impact_punch_heavy_000', 0.65), 0, 0.8), (debris(0.8, 26, 9), 0.03, 0.35)), 0.8, 0.18)
    S_['earthsplitter'] = reverb(mix((boom(1.5, 74, 26, 1.4, 1.2), 0, 1), (src(BR + 'bfh1_rock_breaking_02', 0.6), 0, 0.9), (src(BR + 'bfh1_rock_hit_01', 0.5), 0, 0.8), (src(RP + 'stones_01', 0.8), 0.14, 0.45), (debris(1.5, 34, 10), 0.08, 0.4)), 1.1, 0.2)
    S_['quakeCharge'] = mix((lp(noise(1.0), 130, 3) * 5 * np.linspace(0, 1, sec(1.0)) ** 1.5, 0, 1), (whoosh(1.0, 120, 500, 0.7, 0.95), 0, 0.8), (src(RP + 'stones_02', 0.75), 0.35, 0.3), (debris(0.9, 18, 11) * np.linspace(0.2, 1, sec(0.9)), 0.1, 0.25))
    S_['shieldCharge'] = mix((whoosh(0.55, 260, 1100, 0.7, 0.4), 0, 1.1), (src(RP + 'chain_01'), 0, 0.3), (src(MW + 'metal_sheet_01', 0.85), 0.04, 0.2))
    S_['shieldBash'] = mix((src(MW + 'metal_slam_01', 0.8), 0, 0.9), (src(M + 'impact_punch_heavy_001', 0.8), 0, 0.7), (boom(0.35, 110, 50, 0.7), 0, 1))
    S_['ironClang'] = reverb(mix((src(MW + 'metal_hit_02', 0.85), 0, 1), (bell(520, 0.6, ((1, 1), (2.76, 0.4), (5.4, 0.15))), 0, 0.18)), 0.5, 0.15)
    S_['armorFall'] = src(BR + 'bfh1_metal_falling_01')
    S_['bodyFall'] = src(BR + 'bfh1_falling_01')
    S_['treeFall'] = src(BR + 'bfh1_wood_falling_01')
    S_['heroDeath'] = reverb(src(CR + 'hurt_01'), 0.6, 0.15)
    S_['stoneCrumble'] = reverb(mix((src(BR + 'bfh1_rock_breaking_03', 0.75), 0, 1), (src(BR + 'bfh1_rock_falling_02', 0.8), 0.18, 0.8), (src(RP + 'stones_03', 0.85), 0.42, 0.5), (boom(1.0, 70, 30, 0.8), 0, 1), (debris(1.6, 26, 12), 0.1, 0.35)), 0.8, 0.15)
    S_['collapse'] = reverb(mix((boom(1.6, 72, 26, 1.3, 1.1), 0, 1), (src(BR + 'bfh1_rock_falling_01', 0.75), 0, 1), (src(BR + 'bfh1_rock_breaking_01', 0.7), 0.12, 0.8), (src(MW + 'wood_breaking_01', 0.8), 0.25, 0.4), (debris(1.8, 34, 13), 0.1, 0.4)), 1.1, 0.2)
    # Syl.
    S_['shadowStep'] = reverb(mix((whoosh(0.45, 260, 2600, 1.0, 0.4), 0, 1.1), (src(KE + 'cloth2', 0.85), 0.03, 0.3)), 0.4, 0.18)
    S_['vanish'] = reverb(mix((whoosh(0.7, 1600, 300, 0.8, 0.3), 0, 1), (src(KE + 'cloth3', 0.9), 0, 0.3)), 0.8, 0.3)
    S_['execute'] = mix((whoosh(0.2, 800, 5000, 1.2, 0.8), 0, 1), (src(M + 'knife_slice_'), 0.14, 1), (src(M + 'impact_punch_heavy_001'), 0.16, 0.8), (boom(0.28, 100, 48, 0.5), 0.16, 1))
    # Grom.
    S_['rootSnare'] = mix((src(MW + 'wood_cracking_01', 0.8), 0, 1), (src(MW + 'wood_cracking_02', 0.7), 0.1, 0.8), (boom(0.3, 90, 45, 0.5), 0, 1), (debris(0.4, 20, 14), 0.02, 0.3))
    S_['rootsErupt'] = reverb(mix((boom(0.8, 72, 32, 1.0, 0.9), 0, 1), (src(MW + 'wood_breaking_02', 0.75), 0, 1), (src(MW + 'wood_cracking_03', 0.7), 0.07, 0.8), (src(RP + 'stones_04', 0.85), 0.05, 0.45), (debris(0.8, 24, 15), 0.05, 0.3)), 0.6, 0.15)
    S_['barkSkin'] = mix((src(MW + 'wood_squeak_01', 0.8), 0, 0.9), (src(MW + 'wood_cracking_04', 0.8), 0.08, 0.7), (src(MW + 'wood_misc_02', 0.85), 0.05, 0.4))
    S_['overgrowth'] = reverb(mix((boom(1.0, 70, 30, 0.9, 1.0), 0, 1), (src(MW + 'wood_breaking_01', 0.7), 0, 1), (src(MW + 'wood_cracking_01', 0.6), 0.2, 0.9), (src(MW + 'wood_cracking_03', 0.65), 0.42, 0.7), (surf(1.1, 500, 1400, 0.3), 0.05, 0.25)), 0.8, 0.18)
    # Kaela: modelled water and real splashes only, no zaps.
    S_['waterBolt'] = mix((surf(0.28, 500, 1900, 0.4), 0, 0.9), (bubbles(0.2, 18, 500, 1600, seed=1), 0.02, 0.4))
    S_['splash'] = reverb(mix((surf(0.42, 1600, 500, 0.12), 0, 1), (bubbles(0.32, 34, 450, 1800, seed=2), 0.02, 0.5), (lp(src(WA + 'splash_02'), 5000), 0, 0.3)), 0.35, 0.1)
    S_['tidalWave'] = reverb(mix((surf(1.7, 220, 1100, 0.55), 0, 1.3), (bp(noise(1.7), 1500, 4500) * np.sin(np.pi * np.linspace(0, 1, sec(1.7))) ** 3, 0, 0.14), (boom(1.5, 60, 30, 0.45, 1.1), 0.1, 1), (bubbles(0.9, 60, 300, 1400, seed=3), 0.75, 0.3)), 0.9, 0.2)
    S_['brineVeil'] = reverb(mix((surf(0.75, 900, 2200, 0.35), 0, 0.55), (bubbles(0.65, 36, 700, 2300, tail=0.04, seed=4), 0, 0.55)), 0.9, 0.28)
    def swirl():
        t = 2.0; n = sec(t); u = np.arange(n) / SR
        body = sweep_filter(noise(t), 170, 700, 0.8) * (1 + 0.45 * np.sin(2 * np.pi * (1.2 + u * 1.3) * u))
        return mix((body * np.sin(np.pi * u / t) ** 0.6, 0, 1.2), (bubbles(1.8, 90, 250, 1100, seed=5), 0, 0.3), (boom(1.9, 52, 34, 0.35, 1.2), 0, 1))
    S_['maelstrom'] = reverb(swirl(), 0.9, 0.18)
    # Weather, natural: wind and thunder instead of anything electric.
    S_['zap'] = reverb(mix((bp(noise(0.08), 700, 4200) * env(sec(0.08), 0.001, 0.025), 0, 1.2), (lp(noise(0.5), 400, 2) * 3 * env(sec(0.5), 0.006, 0.28), 0.004, 1), (boom(0.45, 95, 40, 0.5), 0.004, 1)), 0.7, 0.28)
    # Calm and holy: chimes, harp and choir.
    S_['heal'] = reverb(mix((chimes([E5, A5, B5, E6], 0.1, 1.1, 0.02), 0, 0.8), (bubbles(0.4, 10, 900, 2100, tail=0.035, seed=6), 0.02, 0.12)), 1.3, 0.32)
    S_['cast'] = reverb(mix((whoosh(0.34, 500, 1900, 0.9, 0.5), 0, 0.8), (bell(A5, 0.5, SOFT, 0.02), 0.12, 0.28)), 0.6, 0.22)
    S_['glyph'] = reverb(mix((bell(330, 1.3, SOFT, 0.012), 0, 0.8), (bell(494, 1.1, SOFT, 0.012), 0.03, 0.5), (boom(0.4, 90, 50, 0.4), 0, 1)), 1.2, 0.3)
    S_['frostNova'] = reverb(mix((src(S2 + 'glass_03', 0.9), 0, 0.8), (src(S2 + 'glass_01', 0.75), 0.03, 0.6), (whoosh(0.45, 1800, 5500, 1.0, 0.15), 0, 0.4), (chimes([B5, E6, Fs6], 0.05, 0.6, 0.002), 0.01, 0.1)), 0.7, 0.22)
    S_['bellToll'] = reverb(bell(196, 2.2, ((0.5, 0.5), (1, 1), (1.19, 0.5), (1.5, 0.35), (2.0, 0.3), (2.51, 0.14), (3.01, 0.07), (4.1, 0.03))), 1.3, 0.22)
    S_['tpChannel'] = reverb(mix((choir([A3, E4, A4, Cs5], 2.9, 1.2, 0.5), 0, 1), (harp([A4, Cs5, E5, A5, Cs6, E6], 0.42, 1.2), 0.2, 0.09)), 1.5, 0.3, 5000)
    S_['teleport'] = reverb(mix((choir([A3, E4, A4, Cs5, E5], 1.5, 0.05, 1.1), 0, 1), (harp([A4, Cs5, E5, A5, Cs6, E6, A6], 0.045, 1.3), 0, 0.2), (bell(A5, 1.2, SOFT, 0.004), 0.02, 0.12)), 1.6, 0.35, 5000)
    S_['revive'] = reverb(mix((choir([A3, E4, Cs5], 1.5, 0.3, 0.9), 0, 0.8), (chimes([A5, Cs6, E6, A6], 0.13, 1.0, 0.012), 0.1, 0.12)), 1.5, 0.32)
    S_['levelUp'] = reverb(mix((chimes([A5, Cs6, E6, A6], 0.085, 1.0, 0.004), 0, 0.5), (horn([A4, E5], 0.5, 0.03, 0.35, 2300), 0, 0.05)), 1.0, 0.25)
    S_['rune'] = reverb(chimes([E6, A6], 0.07, 0.6, 0.003), 0.6, 0.22)
    S_['buyback'] = reverb(mix((coin(3100, 0.3, 1), 0, 0.3), (coin(3700, 0.3, 2), 0.07, 0.3), (chimes([E5, A5, Cs6], 0.09, 0.9, 0.012), 0.05, 0.5)), 0.9, 0.25)
    # Gold and menus.
    S_['coin'] = mix((coin(3400, 0.24, 3), 0, 0.5), (coin(4100, 0.22, 4), 0.05, 0.42), (src(KE + 'handleCoins'), 0.02, 0.28))
    S_['purchase'] = src(KE + 'handleCoins2')
    S_['itemDrop'] = src(RP + 'item_misc_01')
    S_['itemPickUp'] = src(RP + 'item_misc_02')
    S_['ward'] = src(RP + 'item_wood_01')
    S_['click'] = src(UI + 'click3')
    S_['clockTick'] = src(KE + 'metalClick')
    S_['clockTock'] = src(UI + 'click4')
    S_['clockGo'] = reverb(bell(A5, 1.0, SOFT, 0.004), 0.9, 0.25)
    S_['ping'] = src(RP + 'item_gem_03')
    S_['roar'] = src(CR + 'howl')
    # The end of the match.
    S_['victory'] = reverb(mix((drum(62), 0, 0.5), (drum(62), 0.26, 0.4), (horn([A3, E4, A4], 0.55, 0.04, 0.2, 1700), 0, 0.5), (horn([Cs4, E4, Cs5], 0.28, 0.03, 0.12, 1800), 0.5, 0.5), (horn([A3, E4, A4, E5], 1.9, 0.05, 1.0, 2300), 0.76, 0.55), (choir([A3, E4, A4, Cs5], 2.4, 0.3, 1.2), 0.5, 0.12), (chimes([A5, Cs6, E6], 0.08, 1.1, 0.004), 0.78, 0.12)), 1.8, 0.28)
    S_['defeat'] = reverb(mix((drum(46, 1.4), 0, 0.6), (horn([110, 165, 196], 2.3, 0.3, 1.2, 800), 0.12, 0.65), (drum(46, 1.4), 1.25, 0.4), (choir([110, 165, 262], 2.5, 0.8, 1.3), 0.2, 0.1)), 1.8, 0.28)
    return S_

# ------------------------------------------------------------------ levelling (same method as the first sheet)

KEEP_LEAD = {'swing', 'hammerAttack', 'daggerSlash', 'woodPunch', 'creep', 'impStab', 'wardenPunch'}
# The owner marked the tower as too loud; it also fires constantly.
TRIM_DB = {'tower': -3.0}

def measure(x):
    """dB of the loudest 100 ms, through a hearing-shaped filter (same measure as the first listening sheet)."""
    y = sosfilt(butter(2, 80, 'high', fs=SR, output='sos'), x)
    b = butter(1, 1500, 'high', fs=SR, output='sos')
    y = y + 0.6 * sosfilt(b, y)
    n = sec(0.1)
    e = np.convolve(y ** 2, np.ones(n) / n, mode='full')
    return 10 * np.log10(np.max(e) * n / min(n, len(y)) + 1e-12)

def soft_limit(x):
    return np.tanh(x / LIMIT) * LIMIT

def finish(name, x):
    x = np.asarray(x, dtype=float)
    x = hp(x, 40)
    # Cut what's left of the silent tail, then fade it.
    a = np.abs(x) / (np.max(np.abs(x)) + 1e-9)
    tail = len(a) - np.argmax(a[::-1] > 10 ** (-58 / 20))
    x = fade(x[:max(tail, sec(0.02))], 0.04 if tail > sec(0.2) else 0.008)
    want = TARGET + TRIM_DB.get(name, 0.0)
    g = 1.0
    for _ in range(14):
        y = soft_limit(x * g)
        gap = want - measure(y)
        if abs(gap) < 0.12: break
        g *= 10 ** (gap / 20)
    return y

def encode(wav, mp3):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '96k', '-ac', '1', '-ar', '44100', '-write_xing', '1', mp3], check=True)

def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(('.mp3', '.wav')): os.remove(os.path.join(OUT, f))
    rows = {}
    for name, x in sounds().items():
        y = finish(name, x)
        wav = os.path.join(OUT, name + '.wav')
        sf.write(wav, y, SR, subtype='PCM_16')
        encode(wav, os.path.join(OUT, name + '.mp3'))
        os.remove(wav)
        P = np.abs(np.fft.rfft(y)) ** 2; centre = float(np.sum(P * np.fft.rfftfreq(len(y), 1 / SR)) / (np.sum(P) + 1e-9))
        rows[name] = dict(seconds=round(len(y) / SR, 2), level=round(measure(y), 1), peak=round(float(np.max(np.abs(y))), 2), brightness=int(centre), kb=round(os.path.getsize(os.path.join(OUT, name + '.mp3')) / 1000, 1))
    json.dump(rows, open(os.path.join(OUT, 'report.json'), 'w'), indent=0)
    lv = [r['level'] for r in rows.values()]
    print(len(rows), 'sounds', 'KB', round(sum(r['kb'] for r in rows.values())), 'level', min(lv), max(lv), 'longest', max(r['seconds'] for r in rows.values()))
    for k, r in sorted(rows.items(), key=lambda kv: kv[1]['level']):
        print(f"{k:14s} {r['seconds']:5.2f}s level {r['level']:6.1f} peak {r['peak']:.2f} bright {r['brightness']:5d} {r['kb']:5.1f}KB")

main()
