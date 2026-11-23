"""«ОМЫРТҚА ӘЛЕМІ» · 1-серия — музыка мен дыбыс эффектілерін синтездеу (numpy ғана).

Тайм-кодтар: series/inside-the-spine/episode-01/05-sound-design.md және 06-music.md.
Шығыс: out/audio.wav (48 кГц, стерео). Қаттылықты соңында ffmpeg loudnorm −14 LUFS-ке келтіреді.
"""
import os
import wave
import numpy as np

SR = 48000
DUR = 60.0
N = int(SR * DUR)
rs = np.random.default_rng(1979)
L = np.zeros(N)
Rr = np.zeros(N)


# ---------------------------------------------------------------- негіздер
def t_arr(d):
    return np.arange(int(SR * d)) / SR


def env(d, a=0.01, r=0.2, curve=1.0):
    n = int(SR * d)
    e = np.ones(n)
    na, nr = max(1, int(SR * a)), max(1, int(SR * r))
    e[:na] = np.linspace(0, 1, na) ** curve
    if nr < n:
        e[-nr:] *= np.linspace(1, 0, nr) ** curve
    return e


def expdec(d, k):
    return np.exp(-t_arr(d) * k)


def lowpass(x, fc):
    """FFT арқылы жұмсақ төменгі жиілік сүзгісі."""
    if len(x) < 4:
        return x
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x))


def highpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (fc / np.maximum(f, 1)) ** 4)
    return np.fft.irfft(X, len(x))


def bandpass(x, f1, f2):
    return lowpass(highpass(x, f1), f2)


def add(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    gl = gain * np.sqrt((1 - pan) / 2)
    gr = gain * np.sqrt((1 + pan) / 2)
    L[i : i + len(sig)] += sig * gl
    Rr[i : i + len(sig)] += sig * gr


def hz(note):
    """'D4' → Гц."""
    names = {'C': -9, 'C#': -8, 'Db': -8, 'D': -7, 'D#': -6, 'Eb': -6, 'E': -5, 'F': -4, 'F#': -3, 'Gb': -3,
             'G': -2, 'G#': -1, 'Ab': -1, 'A': 0, 'A#': 1, 'Bb': 1, 'B': 2}
    n, o = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[n] + (o - 4) * 12) / 12)


def tone(f, d, harm=(1.0,), vib=0.0, vibf=5.0, detune=0.0):
    t = t_arr(d)
    ph = 2 * np.pi * f * t + (vib * np.sin(2 * np.pi * vibf * t) if vib else 0)
    out = np.zeros_like(t)
    for k, a in enumerate(harm, 1):
        out += a * np.sin(ph * k)
        if detune:
            out += a * 0.6 * np.sin(ph * k * (1 + detune))
    return out


def saw(f, d, nh=24, detune=0.004):
    t = t_arr(d)
    out = np.zeros_like(t)
    for dt in (-detune, 0, detune):
        for k in range(1, nh + 1):
            if f * k * (1 + dt) > SR / 2.2:
                break
            out += np.sin(2 * np.pi * f * (1 + dt) * k * t) / k
    return out / 3


def pluck(f, d, bright=0.5, decay=0.996):
    """Karplus–Strong (пиццикато / домбыра шертпесі)."""
    n = int(SR * d)
    p = max(2, int(SR / f))
    buf = rs.uniform(-1, 1, p)
    buf = lowpass(buf, 800 + bright * 6000) if p > 8 else buf
    out = np.zeros(n)
    cur = buf.copy()
    i = 0
    while i < n:
        m = min(p, n - i)
        out[i : i + m] = cur[:m]
        nxt = decay * 0.5 * (cur + np.roll(cur, 1))
        cur = nxt
        i += p
    return out * env(d, 0.002, 0.05)


def noise(d):
    return rs.uniform(-1, 1, int(SR * d))


def marimba(f, d=0.6):
    return (tone(f, d, (1.0,)) + 0.35 * tone(f * 4.0, d) * expdec(d, 30)) * expdec(d, 7) * env(d, 0.002, 0.05)


def piano(f, d=2.5):
    s = tone(f, d, (1.0, 0.45, 0.25, 0.12, 0.06), detune=0.0012)
    return s * (0.6 * expdec(d, 1.6) + 0.4 * expdec(d, 5)) * env(d, 0.003, 0.3)


def pad(freqs, d, a=0.8, r=1.0, fc=1800):
    s = sum(saw(f, d, nh=14, detune=0.006) for f in freqs) / len(freqs)
    return lowpass(s, fc) * env(d, a, r)


def choir(freqs, d, a=0.6, r=0.8):
    s = sum(tone(f, d, (1.0, 0.5, 0.33, 0.2, 0.12), vib=0.8, vibf=5.2, detune=0.003) for f in freqs) / len(freqs)
    return bandpass(s, 200, 3200) * env(d, a, r)


def horn(f, d):
    s = saw(f, d, nh=10, detune=0.002)
    s = lowpass(s, 900 + 600 * 1)
    return s * env(d, 0.08, 0.25)


def kick(d=0.35, f0=110, f1=42, k=9):
    t = t_arr(d)
    f = f1 + (f0 - f1) * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * k)


# ---------------------------------------------------------------- SFX
def heartbeat(at, gain=1.0, slow=1.0):
    add(kick(0.4, 70, 38, 10), at, 1.0 * gain)
    add(kick(0.35, 65, 36, 12), at + 0.22 * slow, 0.7 * gain)


def whoosh(at, d=0.9, f1=300, f2=3000, gain=0.6, pan=0.0, rise=True):
    n = noise(d)
    lo = lowpass(n, f1)
    hi = lowpass(n, f2)
    t = np.linspace(0, 1, len(n))
    m = t if rise else 1 - t
    s = lo * (1 - m) + hi * m
    e = np.sin(np.pi * t) ** 1.5
    add(s * e, at, gain, pan)


def ting(at, f=2600, gain=0.25, d=1.2, pan=0.0):
    s = tone(f, d, (1.0, 0.0, 0.3)) * expdec(d, 4.5) + 0.4 * tone(f * 1.5, d) * expdec(d, 7)
    add(s * env(d, 0.002, 0.1), at, gain, pan)


def tick(at, f=900, gain=0.25, pan=0.0):
    d = 0.08
    s = bandpass(noise(d), f * 0.7, f * 1.6) * expdec(d, 60) + 0.5 * tone(f, d) * expdec(d, 70)
    add(s, at, gain, pan)


def boing(at, gain=0.6, f0=180, f1=520, d=0.55):
    t = t_arr(d)
    f = f0 + (f1 - f0) * (1 - np.exp(-t * 8)) + 25 * np.sin(2 * np.pi * 14 * t) * np.exp(-t * 4)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5)
    add(s * env(d, 0.003, 0.08), at, gain)


def bloop(at, f=320, gain=0.35, d=0.18, pan=0.0):
    t = t_arr(d)
    fr = f * (1 + 0.6 * np.exp(-t * 25))
    s = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 18)
    add(s, at, gain, pan)


def squish(at, gain=0.3, d=0.3):
    s = bandpass(noise(d), 400, 2400)
    t = t_arr(d)
    s *= (0.5 + 0.5 * np.sin(2 * np.pi * 22 * t)) * np.exp(-t * 8)
    add(s, at, gain)


def doom(at, gain=0.9, d=1.6):
    s = kick(d, 80, 28, 2.4) + 0.4 * lowpass(noise(d), 160) * expdec(d, 3)
    add(s, at, gain)


def crack(at, gain=1.0):
    d = 0.25
    s = highpass(noise(d), 1500) * expdec(d, 35)
    s += 0.6 * lowpass(noise(d), 600) * expdec(d, 22)
    s[: int(0.004 * SR)] *= 2.0
    add(np.tanh(s * 2.5), at, gain)


def braam(at, gain=0.9, d=3.0):
    f = hz('D1')
    s = saw(f, d, nh=40, detune=0.01) + saw(f * 2, d, nh=30, detune=0.008) * 0.7 + saw(hz('A1'), d, nh=30) * 0.5
    s = np.tanh(lowpass(s, 600) * 2.2) * env(d, 0.02, 1.6, 1.5)
    s += kick(d, 60, 30, 1.8) * 0.8
    add(s, at, gain)


def zap(at, gain=0.25, f0=300, f1=1800, d=0.5):
    t = t_arr(d)
    f = f0 + (f1 - f0) * (t / d) ** 1.5
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / d)
    add(lowpass(s, 4000), at, gain)


# ================================================================ МУЗЫКА
# 0–3.5: құпия — sub дрон + жоғары ішек тремоло
d = 3.6
t = t_arr(d)
sub = tone(hz('D1'), d) * np.linspace(0.2, 1.0, len(t))
add(sub * env(d, 0.3, 0.3), 0.0, 0.5)
trem = (tone(hz('A5'), d, (1, 0.3)) + tone(hz('D6'), d, (1, 0.2))) * (0.6 + 0.4 * np.sin(2 * np.pi * 13 * t))
add(lowpass(trem, 4000) * np.linspace(0, 1, len(t)) ** 2 * env(d, 0.5, 0.2), 0.0, 0.05)

# 3.5–5: ашылу — хор + арфа глиссандосы
add(choir([hz('D3'), hz('A3'), hz('D4'), hz('F#4'), hz('A4')], 3.2, a=0.25, r=1.6), 3.45, 0.42)
add(pad([hz('D2'), hz('A2'), hz('D3')], 3.0, a=0.2, r=1.4, fc=1200), 3.45, 0.32)
scale = ['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5', 'E5', 'F#5', 'A5', 'D6']
for i, nme in enumerate(scale):
    add(pluck(hz(nme), 1.2, 0.8, 0.997), 3.5 + i * 0.045, 0.16, -0.6 + i * 0.1)

# 5–22: Омыртқа тақырыбы, D major ~100 BPM
BPM = 100
beat = 60 / BPM
start = 5.6
prog = [('D', ['D3', 'F#3', 'A3']), ('G', ['G2', 'B2', 'D3']), ('A', ['A2', 'C#3', 'E3']), ('D', ['D3', 'F#3', 'A3'])]
# лейтмотив (валторна): D – F# – A – D'
def leitmotif(at, octave=4, gain=0.3, lens=(0.35, 0.35, 0.35, 1.2)):
    notes = [f'D{octave}', f'F#{octave}', f'A{octave}', f'D{octave + 1}']
    tt = at
    for nme, ln in zip(notes, lens):
        add(horn(hz(nme), ln + 0.15), tt, gain)
        tt += ln

leitmotif(5.62, 3, 0.26)
ti = start
bar = 0
while ti < 21.8:
    chord = prog[bar % 4][1]
    dbar = beat * 4
    # пиццикато (домбыра) — 8-лік ырғақ
    pattern = [0, 2, 1, 2, 0, 2, 1, 2]
    for k, idx in enumerate(pattern):
        tt = ti + k * beat / 2
        if tt >= 21.9:
            break
        f = hz(chord[idx]) * (2 if k % 2 else 1)
        add(pluck(f, 0.6, 0.55, 0.993), tt, 0.13 if k % 2 else 0.18, -0.35 if k % 2 else 0.25)
    add(pad([hz(c) for c in chord], min(dbar + 0.4, 22.0 - ti), a=0.4, r=0.4, fc=1400), ti, 0.12)
    # бас
    add(pluck(hz(chord[0]) / 2, dbar * 0.9, 0.3, 0.998), ti, 0.22)
    # перкуссия (12 с-тан кейін, жұмыс бөлімі)
    if ti >= 11.5:
        for k in range(4):
            tt = ti + k * beat
            if tt < 21.9:
                add(kick(0.25, 120, 50, 14), tt, 0.28)
                add(highpass(noise(0.05), 6000) * expdec(0.05, 70), tt + beat / 2, 0.08, 0.4)
    ti += dbar
    bar += 1
# hero-сәт: 11.0 канал импульсі, 19.5 команда
leitmotif(11.0, 4, 0.28, (0.2, 0.2, 0.2, 0.9))
add(choir([hz('D4'), hz('F#4'), hz('A4'), hz('D5')], 2.6, a=0.5, r=0.9), 19.4, 0.3)
leitmotif(19.5, 3, 0.3, (0.3, 0.3, 0.3, 1.4))

# 22–32: Диск тақырыбы — G major 115 BPM, маримба
BPM2 = 115
b2 = 60 / BPM2
mel = ['G5', 'B5', 'D6', 'B5', 'C6', 'A5', 'B5', 'G5', 'E5', 'G5', 'A5', 'B5', 'D6', 'B5', 'A5', 'G5']
chords2 = [['G3', 'B3', 'D4'], ['C3', 'E3', 'G3'], ['D3', 'F#3', 'A3'], ['G3', 'B3', 'D4']]
ti = 23.0
k = 0
while ti < 31.9:
    nme = mel[k % len(mel)]
    if k % 8 != 7:
        add(marimba(hz(nme), 0.5), ti, 0.2, 0.3 * np.sin(k))
    if k % 4 == 0:
        ch = chords2[(k // 4) % 4]
        for j, c in enumerate(ch):
            add(pluck(hz(c), 0.5, 0.7, 0.992), ti + j * 0.015, 0.12, -0.3)
        add(pluck(hz(ch[0]) / 2, 0.4, 0.3, 0.995), ti, 0.25)
        add(pluck(hz(ch[0]) / 2 * 1.5, 0.3, 0.3, 0.995), ti + b2, 0.18)
    if k % 2 == 1:
        add(highpass(noise(0.04), 5000) * expdec(0.04, 80), ti, 0.07, 0.5)  # саусақ шырт
    ti += b2 / 2
    k += 1
# 30.8 — жылы шырқау
add(choir([hz('G3'), hz('D4'), hz('G4'), hz('B4'), hz('D5')], 2.4, a=0.15, r=1.4), 30.75, 0.4)
add(pad([hz('G2'), hz('D3'), hz('G3'), hz('B3')], 2.6, a=0.1, r=1.6, fc=2200), 30.75, 0.18)

# 32–45: бұрылыс — ұзын нота → D minor, фортепиано, виолончель дрон
add(tone(hz('B4'), 3.0, (1, 0.3, 0.1), vib=0.6) * env(3.0, 0.05, 2.0), 32.0, 0.08)
add(pad([hz('D2'), hz('F2'), hz('A2')], 13.2, a=2.5, r=1.5, fc=500), 33.0, 0.22)
cello = lowpass(saw(hz('D2'), 12.0, nh=20, detune=0.003), 700) * env(12.0, 3.0, 1.0)
add(cello, 33.5, 0.14)
for at, nme in [(34.0, 'D5'), (35.4, 'A4'), (36.6, 'F4'), (38.2, 'E4'), (40.0, 'D4'), (41.2, 'A4'), (42.6, 'C#5'), (43.8, 'D5')]:
    add(piano(hz(nme), 2.6), at, 0.2, 0.2)
# «бұзылған» лейтмотив (бір нотасы жарты тонға төмен) — celesta
for i, (nme, ln) in enumerate([('D5', 0.4), ('F5', 0.4), ('Ab5', 0.4), ('D6', 1.0)]):
    add(tone(hz(nme), 1.4, (1, 0, 0.25)) * expdec(1.4, 3) * env(1.4, 0.002, 0.3), 37.0 + i * 0.4, 0.12, -0.2)

# 45–51: диск ішіндегі кернеу — көтерілетін ішектер, литавра
d = 6.0
t = t_arr(d)
rise = np.zeros_like(t)
for base in (hz('D3'), hz('A3'), hz('D4')):
    f = base * 2 ** (t / d * 0.6)
    rise += np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.7 + 0.3 * np.sin(2 * np.pi * 11 * t))
add(lowpass(rise, 2500) * (t / d) ** 1.6, 45.0, 0.16)
for k in range(24):
    tt = 45.0 + k * 0.25
    add(kick(0.3, 90, 55, 10), tt, 0.05 + 0.25 * (k / 24) ** 2)
for k in range(5):
    heartbeat(45.2 + k * 1.15, 0.45, 1.2)

# 0:51 — БАРЛЫҒЫ ТОҚТАЙДЫ (төменде кесіледі)

# 55.5 BRAAM, 57.5 аяқталмаған фортепиано фразасы
braam(55.5, 0.85)
for at, nme in [(57.6, 'D4'), (58.15, 'F#4'), (58.7, 'A4')]:  # соңғы D5 ойналмайды
    add(piano(hz(nme), 1.8), at, 0.22)

# ================================================================ SFX
heartbeat(0.05, 1.0)
heartbeat(0.95, 1.0)
heartbeat(1.85, 0.6)
whoosh(1.0, 1.4, 200, 1200, 0.18)  # ауа ағыны / тыныс
whoosh(2.45, 1.1, 250, 5000, 0.75)  # тері арқылы сүңгу
ting(3.5, 3200, 0.22, 1.6)  # shimmer
ting(3.55, 4100, 0.12, 1.6, 0.4)
for k in range(10):  # нерв импульстері
    ting(3.6 + k * 0.14 + rs.uniform(0, 0.05), rs.uniform(2200, 4200), 0.05, 0.5, rs.uniform(-0.8, 0.8))
whoosh(5.0, 0.5, 400, 1500, 0.2, rise=False)
ting(5.6, 2400, 0.3, 1.5)  # көз ашылу
for k in range(9):  # сегменттер оянуы (төменнен жоғары)
    tick(6.0 + k * 0.08, 500 + k * 90, 0.22, -0.3 + k * 0.07)
for at in (9.05, 9.7, 10.35):
    boing(at, 0.18, 150, 260, 0.3)
zap(11.0, 0.25, 250, 1400, 0.9)
# 3-кадр: қадамдар + ішкі «тум»
for k in range(4):
    tt = 12.05 + k * 0.75
    if tt < 13.8:
        add(highpass(noise(0.08), 300) * expdec(0.08, 50), tt, 0.18, 0.3)
        add(kick(0.2, 80, 50, 18), tt + 0.02, 0.25, -0.2)
add(lowpass(noise(2.0), 800) * 0.4 * env(2.0, 0.3, 0.3), 12.0, 0.08, 0.5)  # қала атмосферасы
squish(14.4, 0.25)
add(bandpass(noise(0.3), 120, 700) * expdec(0.3, 9), 14.5, 0.35)  # қорап
tick(15.0, 300, 0.22)  # жұмсақ «қырт»
squish(15.05, 0.22)
whoosh(14.8, 0.6, 600, 4000, 0.2)  # wipe
for k in range(3):
    whoosh(19.5 + k * 0.6, 0.8, 80, 400, 0.18, pan=-0.5 + k * 0.5)  # бұлшықеттер тартылуы
for i in range(8):  # дискілердің жануы — D major бойынша төмен
    ting(20.0 + i * 0.22, hz(['D7', 'A6', 'F#6', 'D6', 'A5', 'F#5', 'D5', 'A4'][i]), 0.12, 0.8, 0.4 - i * 0.1)
# 4-кадр
boing(22.0, 0.55)
whoosh(22.25, 0.35, 800, 6000, 0.25, 0.5)
for k in range(3):
    bloop(22.75 + k * 0.13, 300 - k * 40, 0.32 - k * 0.06)
squish(24.5, 0.28)
doom(26.85, 0.7)
whoosh(27.0, 1.4, 300, 2500, 0.3, rise=False)
bloop(28.4, 520, 0.3)
bloop(29.6, 420, 0.18)
zap(29.62, 0.1, 900, 500, 0.3)
for k in range(10):
    ting(30.85 + k * 0.11, rs.uniform(2500, 4500), 0.05, 0.4, rs.uniform(-0.7, 0.7))
# смех (дауыссыз — тек ойнақы «хи-хи» синтез үндері)
for k in range(5):
    bloop(30.9 + k * 0.2, 240, 0.08, 0.12, -0.3)
    bloop(31.0 + k * 0.17, 560, 0.07, 0.1, 0.4)
# 5-кадр
add(lowpass(noise(13.0), 300) * env(13.0, 3.0, 1.0), 32.0, 0.06)  # суық атмосфера
add(highpass(noise(0.12), 2000) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 50 * t_arr(0.12)))) * 0.3, 35.15, 0.12)  # бзз
bloop(35.6, 1400, 0.1, 0.25)  # су тамшысы «тып»
tick(38.1, 260, 0.2, -0.3)  # бұрылу
d = 5.0
dr = lowpass(saw(hz('D1'), d, nh=12), 200) * np.linspace(0.2, 1, int(SR * d))
add(dr * env(d, 1.0, 0.4), 40.0, 0.35)
for at in (41.05, 42.25, 43.85):
    ting(at, 5200, 0.09, 0.9, 0.2)
# 6-кадр
whoosh(44.9, 1.3, 150, 1200, 0.35)
d = 2.2
t = t_arr(d)
fib = np.sin(2 * np.pi * np.cumsum(180 + 160 * (t / d) ** 2) / SR) * (0.6 + 0.4 * np.sin(2 * np.pi * 31 * t))
add(lowpass(fib, 2500) * (t / d) ** 2, 48.8, 0.16)

# ---------------------------------------------------------------- 0:51 кесу
cut = int(51.0 * SR)
L[cut : int(52.0 * SR)] = 0
Rr[cut : int(52.0 * SR)] = 0
# 51.0-ден кейінгі музыка қалдығын тазарту (52 с-қа дейін тек тыныштық)
crack(51.0, 1.0)
heartbeat(53.0, 0.8)
ting(59.5, 2400, 0.2, 1.4)  # логотип «тинг» (көз ашылу дыбысымен рифма)

# ---------------------------------------------------------------- микс
mix = np.stack([L, Rr], axis=1)
# жұмсақ ревербация (бірнеше кешігу)
rev = np.zeros_like(mix)
for dl, g in [(0.031, 0.25), (0.047, 0.2), (0.071, 0.16), (0.113, 0.12), (0.173, 0.08), (0.241, 0.05)]:
    k = int(dl * SR)
    rev[k:, 0] += mix[:-k, 1] * g
    rev[k:, 1] += mix[:-k, 0] * g
mix = mix + lowpass(rev[:, 0], 5000)[:, None] * np.array([1, 0]) + lowpass(rev[:, 1], 5000)[:, None] * np.array([0, 1])
# 0:51.0–0:52.0 тыныштық + «ҚЫРТ» ғана
crack_seg = slice(int(51.0 * SR), int(51.35 * SR))
keep = mix[crack_seg].copy()
mix[int(51.0 * SR) : int(52.0 * SR)] = 0
mix[crack_seg] = keep
mix = np.tanh(mix * 1.2) / np.tanh(1.2)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.89
mix[-int(0.05 * SR) :] *= np.linspace(1, 0, int(0.05 * SR))[:, None]

os.makedirs('out', exist_ok=True)
pcm = (mix * 32767).astype('<i2')
with wave.open('out/audio.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('out/audio.wav', mix.shape)
