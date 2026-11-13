# Writes an original ambient background track for the how-to video (no samples, no third-party audio).
# Usage: python3 make_music.py <out.wav> <seconds>
# A minor, 80 BPM: Am9 - Fmaj7 - Cmaj7 - G6/9, 3 s per chord. Pad intro, plucked arpeggio from 12 s,
# soft pulse and bass from 30 s, gentle fade at the end. Reverb and loudness are added by make_video.js.
import sys, math
import numpy as np

SR = 44100
out, dur = sys.argv[1], float(sys.argv[2])
N = int(SR * dur)
mix = np.zeros((2, N))
t_all = np.arange(N) / SR

def hz(n):  # MIDI note -> Hz
    return 440.0 * 2 ** ((n - 69) / 12)

CHORDS = [  # (bass, pad notes, arpeggio notes)
    (45, [57, 60, 64, 67, 71], [69, 72, 76, 79, 71, 76]),   # Am9
    (41, [53, 57, 60, 64, 67], [65, 69, 72, 76, 67, 72]),   # Fmaj7
    (48, [55, 60, 64, 67, 71], [67, 72, 76, 79, 71, 76]),   # Cmaj7
    (43, [55, 59, 62, 64, 69], [67, 71, 74, 76, 69, 74]),   # G6/9
]
BAR = 3.0
BEAT = BAR / 4

def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i < 0: sig, i = sig[-i:], 0
    if i >= N: return
    sig = sig[: N - i] * gain
    l, r = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
    mix[0, i:i + len(sig)] += sig * l
    mix[1, i:i + len(sig)] += sig * r

def pad(f, length):
    t = np.arange(int(length * SR)) / SR
    s = np.zeros_like(t)
    for det in (-0.12, 0.0, 0.12):  # slight detune for width
        ff = f * 2 ** (det / 12)
        for h, a in ((1, 1.0), (2, 0.35), (3, 0.15), (4, 0.07)):
            s += a * np.sin(2 * np.pi * ff * h * t + h)
    env = np.minimum(1, t / 1.2) * np.minimum(1, (length - t) / 1.2)
    return s * env * (1 + 0.08 * np.sin(2 * np.pi * 0.2 * t))

def pluck(f, length=1.6):
    t = np.arange(int(length * SR)) / SR
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6)
    return s * np.exp(-t * 3.2) * np.minimum(1, t / 0.004)

def kick():
    t = np.arange(int(0.45 * SR)) / SR
    f = 45 + 70 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)

def bass(f, length):
    t = np.arange(int(length * SR)) / SR
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    return s * np.minimum(1, t / 0.05) * np.exp(-t * 0.9)

bars = int(math.ceil(dur / BAR))
for b in range(bars):
    st = b * BAR
    bn, pn, an = CHORDS[b % 4]
    for k, n in enumerate(pn):
        add(pad(hz(n), BAR + 1.2), st - 0.3, pan=(k - 2) * 0.3, gain=0.04)
    if st >= 12:
        for i in range(8):  # eighth-note arpeggio
            n = an[i % len(an)] + (12 if i == 7 else 0)
            g = 0.20 if st >= 30 else 0.15
            add(pluck(hz(n)), st + i * BEAT / 2, pan=0.5 * math.sin(i), gain=g * (1.0 if i % 2 == 0 else 0.7))
    if st >= 30 and st < dur - 9:
        for i in range(4):
            add(kick(), st + i * BEAT, gain=0.22 if i % 2 == 0 else 0.12)
        add(bass(hz(bn), BAR), st, gain=0.16)

fade = np.ones(N)
fi, fo = int(2 * SR), int(6 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.linspace(1, 0, fo)
mix *= fade
mix /= np.max(np.abs(mix)) * 1.12
pcm = (mix.T * 32767).astype('<i2')

import wave
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote', out, round(dur, 1), 's')
