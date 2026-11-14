#!/usr/bin/env python3
"""RMS envelope (10 ms windows, dBFS) + speech mask, per the editing spec.

usage: envelope.py in.wav out.json [--thr -30] [--minrun 0.11] [--tail 0.25]
Writes {"hop":0.01,"env":[...],"sdb":[...],"speech":[[s,e],...],"noise_floor":dB}
"""
import argparse, json, wave
import numpy as np

HOP = 0.01


def load(path):
    with wave.open(path) as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float64) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


def envelope(x, sr):
    h = int(sr * HOP)
    n = len(x) // h
    frames = x[: n * h].reshape(n, h)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-9))


def running_max(env, r=3):
    pad = np.pad(env, r, constant_values=-120)
    return np.max(np.stack([pad[i : i + len(env)] for i in range(2 * r + 1)]), axis=0)


def speech_mask(sdb, thr=-30.0, minrun=0.11, tail=0.25):
    loud = sdb >= thr
    sp = np.zeros_like(loud)
    i, n = 0, len(loud)
    runs = []
    while i < n:
        if loud[i]:
            j = i
            while j < n and loud[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    for a, b in runs:
        if (b - a) * HOP >= minrun - 1e-9:
            sp[a:b] = True
    # voiceless-ending recovery: extend each speech run to any loud hop within `tail`
    t = int(round(tail / HOP))
    k = 0
    while k < n:
        if sp[k] and (k + 1 >= n or not sp[k + 1]):
            end = k
            for m in range(k + 1, min(n, end + t + 1)):
                if loud[m]:
                    end = m
            sp[k : end + 1] = True
            k = end + 1
        else:
            k += 1
    spans, i = [], 0
    while i < n:
        if sp[i]:
            j = i
            while j < n and sp[j]:
                j += 1
            spans.append([round(i * HOP, 3), round(j * HOP, 3)])
            i = j
        else:
            i += 1
    return spans


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp"); ap.add_argument("out")
    ap.add_argument("--thr", type=float, default=-30)
    ap.add_argument("--minrun", type=float, default=0.11)
    ap.add_argument("--tail", type=float, default=0.25)
    a = ap.parse_args()
    x, sr = load(a.inp)
    env = envelope(x, sr)
    sdb = running_max(env)
    spans = speech_mask(sdb, a.thr, a.minrun, a.tail)
    floor = float(np.percentile(env, 10))
    json.dump({"hop": HOP, "env": [round(v, 1) for v in env], "sdb": [round(v, 1) for v in sdb],
               "speech": spans, "noise_floor": round(floor, 1)}, open(a.out, "w"))
    print(f"duration {len(env)*HOP:.2f}s  speech spans {len(spans)}  noise floor (p10) {floor:.1f} dBFS")
    gaps = [(round(spans[i][1], 2), round(spans[i + 1][0], 2)) for i in range(len(spans) - 1)
            if spans[i + 1][0] - spans[i][1] >= 0.16]
    print("pauses >=160ms:", gaps)


if __name__ == "__main__":
    main()
