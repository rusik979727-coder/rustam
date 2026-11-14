#!/usr/bin/env python3
"""Make one word as clear as the rest: fill a digital-silence hole before it with room tone,
lift its onset (the swallowed first consonant) and add presence (2–5 kHz) over the word.

The source had a hard edit right before «BELES»: ~120 ms of true digital zero, then the word
starts abruptly with a weak «Б» (whisper heard «Елес»).

usage: word_fix.py --in .tmp/cut.mp4 --out .tmp/cut_fixed.wav --at 14.28 [--dur 0.34]
                   [--onset-db 5] [--onset-len 0.08] [--presence-db 3]
                   [--tone-src raw.mp4 --tone-at 20.3 --tone-len 0.5]
"""
import argparse, subprocess, wave
import numpy as np

SR = 48000


def read(path):
    raw = subprocess.check_output(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-ac", "1",
                                   "-ar", str(SR), "-f", "s16le", "-"])
    return np.frombuffer(raw, np.int16).astype(np.float64) / 32768


def ffmpeg_filter(x, af):
    p = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-af", af, "-f", "s16le", "-"],
                       input=(np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.int16).astype(np.float64) / 32768


def ramp_mask(n, a, b, r):
    """1 inside [a,b) samples, raised-cosine ramps of r samples outside."""
    m = np.zeros(n)
    a0, b1 = max(0, a - r), min(n, b + r)
    m[a:b] = 1
    if a > a0:
        m[a0:a] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a - a0))
    if b1 > b:
        m[b:b1] = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, b1 - b))
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--at", type=float, required=True, help="approximate word start (cue)")
    ap.add_argument("--dur", type=float, default=0.34)
    ap.add_argument("--onset-db", type=float, default=5)
    ap.add_argument("--onset-len", type=float, default=0.08)
    ap.add_argument("--presence-db", type=float, default=3)
    ap.add_argument("--tone-src", default="raw.mp4")
    ap.add_argument("--tone-at", type=float, default=20.3)
    ap.add_argument("--tone-len", type=float, default=0.5)
    a = ap.parse_args()

    x = read(a.inp)
    n = len(x)
    # 1) the hole: longest run of |x| < 2 LSB in [at-0.25, at+0.05]
    lo, hi = int((a.at - 0.25) * SR), int((a.at + 0.05) * SR)
    quiet = np.abs(x[lo:hi]) < 2 / 32768
    best, cur, start = (0, 0), 0, 0
    for i, q in enumerate(quiet):
        if q:
            if cur == 0:
                start = i
            cur += 1
            if cur > best[1] - best[0]:
                best = (start, i + 1)
        else:
            cur = 0
    h0, h1 = lo + best[0], lo + best[1]
    onset = h1  # the word starts where the hole ends
    print(f"hole {h0/SR:.3f}-{h1/SR:.3f}s ({(h1-h0)/SR*1000:.0f} ms)  word onset {onset/SR:.3f}s")

    # 2) room tone fill, level-matched to the surrounding pause (−39 dBFS measured), 5 ms fades
    if h1 - h0 > SR * 0.005:
        tone = read(a.tone_src)[int(a.tone_at * SR):int((a.tone_at + a.tone_len) * SR)]
        need = h1 - h0 + int(0.01 * SR)
        tone = np.tile(tone, need // len(tone) + 1)[:need]
        m = ramp_mask(n, h0, h1, int(0.005 * SR))
        fill = np.zeros(n)
        seg = tone[: min(need, n - max(0, h0 - int(0.005 * SR)))]
        s0 = max(0, h0 - int(0.005 * SR))
        fill[s0:s0 + len(seg)] = seg
        x = x + fill * m * (np.abs(x) < 2 / 32768 + 0.0)  # only where the source is silent

    # 3) onset lift (first consonant) — gain envelope with 10 ms ramps
    g_on = 10 ** (a.onset_db / 20) - 1
    x = x * (1 + g_on * ramp_mask(n, onset, onset + int(a.onset_len * SR), int(0.01 * SR)))

    # 4) presence over the whole word, blended in with 15 ms ramps
    pres = ffmpeg_filter(x, f"equalizer=f=3200:t=q:w=0.9:g={a.presence_db}")[:n]
    if len(pres) < n:
        pres = np.pad(pres, (0, n - len(pres)))
    m = ramp_mask(n, onset, onset + int(a.dur * SR), int(0.015 * SR))
    x = x * (1 - m) + pres * m

    peak = np.abs(x).max()
    if peak > 0.999:
        x *= 0.999 / peak
    with wave.open(a.out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    print("wrote", a.out)


if __name__ == "__main__":
    main()
