"""Composes the background music for the how-to video: calm, warm and slightly cinematic, written in code
(no samples, no third-party audio), so it is free to use anywhere.

Usage (repo root):  python website/beta/myvisionvault/tools/make_music.py <out.wav> [seconds]
Needs numpy. The piece follows the video: a soft opening, a steady middle with a light pulse
while the screens play, a lifted section for the technology scenes, and a resolved ending.

Harmony: A minor -> F -> C -> G (i-VI-III-VII), 84 BPM, one chord per bar.
Layers: string-like pad (detuned saws, low-passed), music-box arpeggio, sub bass, soft heartbeat
pulse, and a shimmer of high harmonics in the lifted section. A simple FFT reverb glues it together.
"""
import sys, wave
import numpy as np

OUT = sys.argv[1]
LENGTH = float(sys.argv[2]) if len(sys.argv) > 2 else 100.0
SR = 44100
BPM = 84
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(11)

N = int(LENGTH * SR)
mixL = np.zeros(N); mixR = np.zeros(N)

def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)

# A minor, F, C, G (the last bar of the piece resolves to A minor).
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
BASS = [45, 41, 36, 43]

def env(n, a, r, sustain=1.0):
    e = np.ones(n) * sustain
    na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    if na: e[:na] = np.linspace(0, sustain, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e

def lowpass(x, cutoff):
    # One-pole low-pass, run forwards and backwards (zero phase, gentle).
    a = np.exp(-2 * np.pi * cutoff / SR)
    def run(v):
        y = np.empty_like(v); acc = 0.0
        # vectorised enough for our lengths via lfilter-style recursion in chunks
        for i in range(len(v)):
            acc = (1 - a) * v[i] + a * acc
            y[i] = acc
        return y
    return run(run(x)[::-1])[::-1]

def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N: return
    sig = sig[: N - i]
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    mixL[i:i + len(sig)] += sig * gain * l
    mixR[i:i + len(sig)] += sig * gain * r

def saw(f, n, detune=0.0):
    t = np.arange(n) / SR
    ph = (f * (1 + detune)) * t + rng.random()
    return 2 * (ph % 1) - 1

def pad_note(m, dur):
    n = int(dur * SR)
    s = sum(saw(midi(m), n, d) for d in (-0.004, 0.0, 0.0045)) / 3
    return s * env(n, 1.6, 1.8, 1.0)

def bell(m, dur=2.2):
    n = int(dur * SR); t = np.arange(n) / SR; f = midi(m)
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6)
         + 0.12 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t * 9))
    return s * np.exp(-t * 2.4) * env(n, 0.004, 0.2)

def bass_note(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR; f = midi(m)
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    return np.tanh(1.4 * s) * env(n, 0.08, 0.6, 0.9)

def pulse(dur=0.5):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 60 * np.exp(-t * 18) + 42
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)

# Section plan in bars (BAR ~ 2.86 s): intro 0-4, verse 4-16, lift 16-24, outro 24-end.
bars = int(np.ceil(LENGTH / BAR))
lift_start, lift_end = 16, 24
for b in range(bars):
    t0 = b * BAR
    last = b == bars - 1
    ci = 0 if last else b % 4
    chord = CHORDS[ci]
    in_lift = lift_start <= b < lift_end
    # Pad: always, a little brighter (octave doubling) in the lift.
    pad = sum(pad_note(m, BAR + 1.8) for m in chord)
    if in_lift: pad = pad + 0.5 * pad_note(chord[-1] + 12, BAR + 1.8)
    add(lowpass(pad, 900 if in_lift else 650) / 3, t0, 0.32, 0.0)
    # Sub bass from bar 2.
    if b >= 2:
        add(bass_note(BASS[ci], BAR), t0, 0.22, 0.0)
    # Music-box arpeggio from bar 4: eighth notes walking up the chord, an octave above.
    if 4 <= b < bars - 1:
        notes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24, chord[2] + 12, chord[1] + 12, chord[0] + 24, chord[2] + 12]
        for k, m in enumerate(notes):
            if not in_lift and k % 2: continue  # quarter notes in the verse, eighths in the lift
            add(bell(m), t0 + k * BEAT / 2, 0.11 if in_lift else 0.13, -0.35 + 0.1 * (k % 4))
    # Heartbeat pulse in the verse and lift.
    if 6 <= b < lift_end:
        for k in (0, 2):
            add(pulse(), t0 + k * BEAT, 0.20, 0.0)
    # Shimmer in the lift.
    if in_lift:
        n = int(BAR * SR); t = np.arange(n) / SR
        sh = sum(np.sin(2 * np.pi * midi(m + 36) * t + rng.random() * 6) for m in chord) / 3
        add(sh * env(n, 1.2, 1.2) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t)), t0, 0.025, 0.4)
    # Final chord rings out.
    if last:
        for m in chord: add(bell(m + 12, 4.0), t0, 0.12, 0.2)

# Reverb: convolve with ~2.4 s of decaying stereo noise (FFT).
def reverb(x, seed):
    r = np.random.default_rng(seed)
    n = int(2.4 * SR); t = np.arange(n) / SR
    ir = r.standard_normal(n) * np.exp(-t * 2.6); ir[0] = 0; ir /= np.sqrt(np.sum(ir ** 2))
    L = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, L) * np.fft.rfft(ir, L), L)[: len(x)]
    return y

wetL, wetR = reverb(mixL, 1), reverb(mixR, 2)
L = 0.78 * mixL + 0.32 * wetL
R = 0.78 * mixR + 0.32 * wetR

# Fade in 2 s, fade out 4 s, normalise to -1 dBFS peak.
fade = np.ones(N)
fade[: 2 * SR] = np.linspace(0, 1, 2 * SR)
fade[-4 * SR:] = np.linspace(1, 0, 4 * SR) ** 1.5
L *= fade; R *= fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.89, R / peak * 0.89
pcm = (np.stack([L, R], axis=1) * 32767).astype('<i2')
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote', OUT, f'{LENGTH:.1f}s')
