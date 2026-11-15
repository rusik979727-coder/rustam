#!/usr/bin/env python3
"""Оригинал музыка (100 BPM) + SFX синтезі, дауыспен ducking-микс. audio.py WORKDIR"""
import json, os, subprocess, sys, wave
import numpy as np

WD = sys.argv[1]
SPEC = json.load(open(os.path.join(WD, "spec.json"), encoding="utf-8"))
SR = 48000
SRC = SPEC["src_duration"]; TOTAL = SRC + SPEC["end_duration"]
N = int(TOTAL * SR)
rng = np.random.default_rng(7)
BEAT = 0.6; PHASE = 4.067 % BEAT   # 4.067 және 26.9 кесулері битке түседі

def t_arr(d): return np.arange(int(d * SR)) / SR
def add(buf, sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N: return
    if i < 0: sig = sig[-i:]; i = 0
    sig = sig[:N - i]
    l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
    buf[i:i + len(sig), 0] += sig * gain * l * 1.414
    buf[i:i + len(sig), 1] += sig * gain * r * 1.414

def lp(x, a):  # бір полюсті lowpass
    y = np.empty_like(x); acc = 0.0
    from itertools import accumulate
    # жылдам: scipy жоқ болса да жұмыс істейді
    b = 1 - a
    y = np.frombuffer(np.array(list(accumulate(x * b, lambda p, v: p * a + v)), np.float64), np.float64)
    return y

def kick():
    t = t_arr(0.45); f = 45 + 95 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7) + 0.3 * np.sin(ph * 2) * np.exp(-t * 30)

def hat():
    t = t_arr(0.07); n = rng.standard_normal(len(t))
    n = n - lp(n, 0.6)  # highpass
    return n * np.exp(-t * 60) * 0.5

def clap():
    t = t_arr(0.25); n = rng.standard_normal(len(t))
    n = lp(n, 0.3) - lp(n, 0.85)
    env = np.exp(-t * 18) * (1 + 0.6 * (np.sin(2 * np.pi * 90 * t) > 0) * (t < 0.03))
    return n * env * 0.6

def pad_note(freq, dur):
    t = t_arr(dur); s = np.zeros_like(t)
    for det in (-0.12, 0.0, 0.12):
        f = freq * 2 ** (det / 12)
        for h in range(1, 7):
            s += np.sin(2 * np.pi * f * h * t + h) / (h ** 1.6)
    env = np.minimum(1, t / 0.35) * np.minimum(1, (dur - t) / 0.4)
    return s * env / 6

def pluck(freq):
    t = t_arr(0.5)
    s = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) + 0.1 * np.sin(6 * np.pi * freq * t)
    return s * np.exp(-t * 9) * np.minimum(1, t / 0.004)

def sub(freq, dur):
    t = t_arr(dur)
    return np.sin(2 * np.pi * freq * t) * np.minimum(1, t / 0.02) * np.minimum(1, (dur - t) / 0.05)

def whoosh(d=0.42, up=True):
    t = t_arr(d); n = rng.standard_normal(len(t))
    x = t / d
    env = (x ** 2 if up else (1 - x) ** 2) * np.sin(np.pi * np.minimum(x * 1.05, 1)) ** 0.5
    a = 0.98 - 0.25 * (x if up else 1 - x)
    out = np.zeros_like(n); acc = 0.0
    for i in range(len(n)):  # айнымалы lowpass — дыбыс "ұшады"
        acc = a[i] * acc + (1 - a[i]) * n[i]; out[i] = acc
    out = out - lp(out, 0.995)
    return out / (np.abs(out).max() + 1e-9) * env

def impact():
    t = t_arr(1.4); f = 38 + 80 * np.exp(-t * 14)
    b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2)
    n = rng.standard_normal(len(t)); n = lp(n, 0.9) * np.exp(-t * 9)
    return b + 0.5 * n

def boom():
    t = t_arr(1.0); f = 32 + 40 * np.exp(-t * 10)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4)

def tick(freq=1500, d=0.05):
    t = t_arr(d); return np.sin(2 * np.pi * freq * t) * np.exp(-t * 90)

def pop():
    t = t_arr(0.12); f = 500 + 900 * np.exp(-t * 40)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 30)

def riser(d):
    t = t_arr(d); f = 200 * 2 ** (3 * t / d)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.4
    n = rng.standard_normal(len(t)); n = n - lp(n, 0.7)
    return (s + 0.3 * n) * (t / d) ** 2

def chime(freq):
    t = t_arr(1.6); s = sum(np.sin(2 * np.pi * freq * k * t) / k ** 2 for k in (1, 2, 3, 4.2))
    return s * np.exp(-t * 3) * np.minimum(1, t / 0.003)

# ---------------- музыка ----------------
music = np.zeros((N, 2))
CH = [  # (bass, chord tones)
    (110.0, [220.0, 261.63, 329.63]), (87.31, [174.61, 220.0, 261.63]),
    (130.81, [261.63, 329.63, 392.0]), (98.0, [196.0, 246.94, 293.66])]
KICK, HAT, CLAP = kick(), hat(), clap()
beat_t = PHASE - BEAT
k = -1
while beat_t < TOTAL:
    if beat_t >= 0:
        bar_beat = k % 4
        bass, chord = CH[(k // 4) % 4]
        full = 4.0 <= beat_t < SRC - 0.05
        if bar_beat == 0:
            dur = BEAT * 4
            for f in chord: add(music, pad_note(f, dur + 0.3), beat_t, 0.16 if full else 0.22, pan=rng.uniform(-0.4, 0.4))
            if full: add(music, sub(bass / 2 if bass > 100 else bass, dur - 0.05), beat_t, 0.32)
        if full:
            if bar_beat in (0, 2): add(music, KICK, beat_t, 0.85)
            if bar_beat in (1, 3): add(music, CLAP, beat_t, 0.35, pan=0.1)
            add(music, HAT, beat_t + BEAT / 2, 0.30, pan=0.35)
            add(music, HAT, beat_t, 0.12, pan=-0.3)
            for j in range(2):  # 8-шы пульсті арпеджио
                f = chord[(bar_beat * 2 + j) % 3] * 2
                add(music, pluck(f), beat_t + j * BEAT / 2, 0.10, pan=-0.5 if j else 0.5)
        else:
            add(music, HAT, beat_t + BEAT / 2, 0.12, pan=0.3)
    beat_t += BEAT; k += 1

# end-card: соңғы аккорд, сөнеді
add(music, sum(pad_note(f, 2.9) for f in [220.0, 261.63, 329.63, 440.0]), SRC, 0.22)
add(music, sub(55.0, 2.6), SRC, 0.4)

# ---------------- SFX ----------------
sfx = np.zeros((N, 2))
add(sfx, impact(), 0.0, 0.55)
add(sfx, whoosh(0.4), 0.45, 0.35, pan=-0.4)
for tr in SPEC["transitions"]:
    ty, t0 = tr["type"], tr["t"]
    if ty == "flash":
        add(sfx, whoosh(0.25), t0 - 0.2, 0.28); add(sfx, tick(2200, 0.06), t0, 0.15)
    else:
        add(sfx, whoosh(0.42), t0 - 0.36, 0.5, pan=(-0.5 if ty == "whip" else 0.0))
        add(sfx, whoosh(0.3, up=False), t0 + 0.02, 0.25, pan=(0.5 if ty == "whip" else 0.0))
add(sfx, boom(), 24.133, 0.6); add(sfx, boom(), 25.9, 0.55)
for c in SPEC["callouts"]:
    if c.get("kind") == "pulse": continue
    add(sfx, tick(1800, 0.05), c["start"], 0.18)
    add(sfx, pop(), c["start"] + 0.5, 0.3, pan=0.3)
for c in SPEC["captions"]:
    toks = [w for ln in c["lines"] for w in ln.split()]
    for tok, tm in zip(toks, c["times"]):
        if tok[0] in "!~": add(sfx, tick(1100, 0.04), tm, 0.12); add(sfx, pop(), tm, 0.06)
add(sfx, riser(1.0), SRC - 1.0, 0.22)
add(sfx, impact(), SRC, 0.6)
add(sfx, chime(1046.5), SRC + 0.55, 0.12); add(sfx, chime(1318.5), SRC + 1.25, 0.12)

# ---------------- микс ----------------
def read_wav(p):
    w = wave.open(p); a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float64) / 32768
    return a.reshape(-1, w.getnchannels())

voice_p = os.path.join(WD, "voice48.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(WD, "src.mp4"), "-vn", "-ac", "2", "-ar", str(SR),
                "-af", "highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,volume=4dB", voice_p], check=True)
v = read_wav(voice_p); voice = np.zeros((N, 2)); voice[:min(N, len(v))] = v[:N]
# ducking конверті
env = np.sqrt(np.convolve((voice ** 2).mean(1), np.ones(2400) / 2400, mode="same"))
on = (env > 0.02).astype(np.float64)
att = np.convolve(on, np.ones(9600) / 9600, mode="same")  # ~0.2 с жұмсақ
duck = 1 - 0.68 * np.clip(att * 1.6, 0, 1)
music_g = music / (np.abs(music).max() + 1e-9) * 0.26
mix = voice + music_g * duck[:, None] + sfx * 0.9
for name, arr in (("music_only.wav", music_g * duck[:, None]), ("mix_raw.wav", mix)):
    a = np.clip(arr, -1, 1)
    with wave.open(os.path.join(WD, name), "w") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((a * 32767).astype(np.int16).tobytes())
print("peak", np.abs(mix).max())
