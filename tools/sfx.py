#!/usr/bin/env python3
"""Build the SFX bus from cues.json "sfx" (times come from the resolved cues, never typed by hand).

Each effect is placed so its loudest 10 ms lands one frame after its cue (sound after light).
Files come from the HyperFrames bundled library (Pixabay Content License) and are copied to
project/assets/sfx/. Output: .tmp/sfx_bus.wav (mono 48 kHz, length END) + a placement table.

usage: sfx.py [--lib /root/.claude/skills/media-use/audio/assets/sfx]
"""
import argparse, json, pathlib, shutil, subprocess, wave
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR, FRAME = 48000, 1 / 30


def read(path):
    raw = subprocess.check_output(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-ac", "1",
                                   "-ar", str(SR), "-f", "s16le", "-"])
    return np.frombuffer(raw, np.int16).astype(np.float64) / 32768


def peak_time(x):
    h = int(0.01 * SR)
    n = len(x) // h
    rms = np.sqrt((x[: n * h].reshape(n, h) ** 2).mean(1))
    # first bin within 3 dB of the loudest: the perceived hit (double-transient clicks land on the first)
    first = int(np.argmax(rms >= rms.max() * 10 ** (-3 / 20)))
    return (first + 0.5) * h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lib", default="/root/.claude/skills/media-use/audio/assets/sfx")
    a = ap.parse_args()
    cfg = json.load(open(ROOT / "cues.json"))
    cues = json.load(open(ROOT / ".tmp/cues_resolved.json"))
    END = cues["END"]
    bus = np.zeros(int(END * SR))
    dst = ROOT / "project/assets/sfx"
    dst.mkdir(parents=True, exist_ok=True)
    print(f"{'cue':8} {'file':14} {'cue t':>7} {'peak t':>7} {'start':>7}  peak dBFS")
    for e in cfg["sfx"]:
        src = pathlib.Path(a.lib) / f"{e['file']}.mp3"
        shutil.copy(src, dst / src.name)
        x = read(src)
        if e.get("tail"):
            x = x[-int(e["tail"] * SR):]
            x = x * np.linspace(0, 1, len(x)) ** 1.5  # fade the cut-in so the tail grows from nothing
        x = x * (10 ** (e["peak_dbfs"] / 20) / max(np.abs(x).max(), 1e-9))
        t = cues[e["cue"]] + FRAME
        if e.get("align") == "end":
            pk = len(x)
        else:
            pk = peak_time(x)
        s = int(round(t * SR - pk))
        if e.get("end_by"):
            stop = int((cues[e["end_by"]] - 0.02) * SR) - s
            if 0 < stop < len(x):
                f = min(int(0.03 * SR), stop)
                x = x[:stop].copy(); x[-f:] *= np.linspace(1, 0, f)
        a0, b0 = max(0, s), min(len(bus), s + len(x))
        bus[a0:b0] += x[a0 - s:b0 - s]
        print(f"{e['cue']:8} {e['file']:14} {cues[e['cue']]:7.3f} {t:7.3f} {s/SR:7.3f}  {e['peak_dbfs']}")
    with wave.open(str(ROOT / ".tmp/sfx_bus.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(bus, -1, 1) * 32767).astype(np.int16).tobytes())
    (dst / "CREDITS.md").write_text(
        "# SFX credits\n\nFrom the HyperFrames bundled library, sourced from Pixabay (https://pixabay.com/sound-effects/), "
        "Pixabay Content License: commercial use allowed, no attribution required.\n\n"
        + "\n".join(f"- {e['file']}.mp3 — on cue `{e['cue']}`" for e in cfg["sfx"]) + "\n")
    print(f"wrote .tmp/sfx_bus.wav ({len(bus)/SR:.2f}s)")


if __name__ == "__main__":
    main()
