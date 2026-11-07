#!/usr/bin/env python3
"""The owner's announcer lines: trims the silence around each one and levels it like every other sound.

Usage: voices.py <folder with the owner's mp3 files> <output folder>
Same loudness measure and limiter as choose.py, so a voice is as loud as a sword.
"""
import os, subprocess, sys, tempfile
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

SR, TARGET, LIMIT = 44100, -21.0, 0.79

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

def make(path):
    x = sosfilt(butter(2, 50, 'high', fs=SR, output='sos'), read(path))
    x = x / (np.max(np.abs(x)) + 1e-9)
    a = np.abs(x)
    on = int(np.argmax(a > 0.01))
    # Keep the last breath of a word: only silence below -50 dB counts as the end.
    end = len(a) - int(np.argmax(a[::-1] > 10 ** (-50 / 20)))
    x = x[max(0, on - int(0.01 * SR)):min(len(x), end + int(0.04 * SR))].copy()
    n = int(0.03 * SR)
    x[-n:] *= np.linspace(1, 0, n) ** 1.5
    g = 1.0
    for _ in range(14):
        y = np.tanh(x * g / LIMIT) * LIMIT
        gap = TARGET - measure(y)
        if abs(gap) < 0.15: break
        g *= 10 ** (gap / 20)
    return y

def main(src, out):
    levels, total, names = [], 0, sorted(f for f in os.listdir(src) if f.endswith('.mp3'))
    for f in names:
        y = make(os.path.join(src, f))
        levels.append(measure(y))
        with tempfile.NamedTemporaryFile(suffix='.wav') as t:
            sf.write(t.name, y, SR, subtype='PCM_16')
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', t.name, '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '80k', '-ac', '1', os.path.join(out, f)], check=True)
        total += len(y) / SR
    size = sum(os.path.getsize(os.path.join(out, f)) for f in names)
    print(len(names), 'lines', round(total, 1), 's', round(size / 1e6, 2), 'MB', 'level', round(min(levels), 1), round(max(levels), 1))

main(sys.argv[1], sys.argv[2])
