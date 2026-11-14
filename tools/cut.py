#!/usr/bin/env python3
"""Build keep-segments from edl_spans.json + speech mask, render .tmp/cut.mp4 in one ffmpeg pass.

usage: cut.py [--edl edl_spans.json] [--env .tmp/env_raw.json] [--out .tmp/cut.mp4]
              [--pause 0.16] [--keep 0.05] [--fps 30] [--dry]
Writes .tmp/segments.json: [{src_in, src_out, dst_in, dst_out, span}]
"""
import argparse, json, subprocess


def snap(t, fps):
    return round(round(t * fps) / fps, 6)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edl", default="edl_spans.json")
    ap.add_argument("--env", default=".tmp/env_raw.json")
    ap.add_argument("--out", default=".tmp/cut.mp4")
    ap.add_argument("--pause", type=float, default=0.16)
    ap.add_argument("--keep", type=float, default=0.05)
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    edl = json.load(open(a.edl))
    speech = json.load(open(a.env))["speech"]
    half = a.keep / 2

    segs = []
    for sp in edl["spans"]:
        runs = [[max(s, sp["in"]), min(e, sp["out"])] for s, e in speech if e > sp["in"] and s < sp["out"]]
        if not runs:
            continue
        # merge runs separated by < pause threshold
        merged = [runs[0][:]]
        for s, e in runs[1:]:
            if s - merged[-1][1] < a.pause:
                merged[-1][1] = e
            else:
                merged.append([s, e])
        for i, (s, e) in enumerate(merged):
            si = s - (0.02 if i == 0 else half)
            so = e + (0.03 if i == len(merged) - 1 else half)
            if i == len(merged) - 1 and sp.get("hard_out"):
                so = sp["out"]  # keep quiet tail below mask threshold up to span end
            segs.append({"span": sp["id"], "src_in": max(0, si), "src_out": so})

    for s in segs:
        s["src_in"], s["src_out"] = snap(s["src_in"], a.fps), snap(s["src_out"], a.fps)
    # remove overlaps produced by snapping
    for i in range(1, len(segs)):
        if segs[i]["src_in"] < segs[i - 1]["src_out"]:
            segs[i]["src_in"] = segs[i - 1]["src_out"]
    t = 0.0
    for s in segs:
        s["dst_in"] = round(t, 6)
        t += s["src_out"] - s["src_in"]
        s["dst_out"] = round(t, 6)
    json.dump(segs, open(".tmp/segments.json", "w"), indent=1)
    print(f"{len(segs)} segments, cut duration {t:.3f}s")
    if a.dry:
        return

    fc, cat = [], ""
    f = 0.015
    for i, s in enumerate(segs):
        d = s["src_out"] - s["src_in"]
        fc.append(f"[0:v]trim={s['src_in']}:{s['src_out']},setpts=PTS-STARTPTS[v{i}]")
        fc.append(f"[0:a]atrim={s['src_in']}:{s['src_out']},asetpts=PTS-STARTPTS,"
                  f"afade=t=in:d={f},afade=t=out:st={max(0, d - f):.4f}:d={f}[a{i}]")
        cat += f"[v{i}][a{i}]"
    fc.append(f"{cat}concat=n={len(segs)}:v=1:a=1[v][a]")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", edl["source"], "-filter_complex", ";".join(fc),
           "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "16", "-preset", "medium",
           "-r", str(int(a.fps)), "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-ar", "48000",
           a.out.replace(".mp4", ".mov") if False else a.out]
    # mp4 can't hold pcm; use aac at high bitrate for the working cut
    cmd[cmd.index("pcm_s16le")] = "aac"
    cmd[cmd.index("aac") + 1:cmd.index("aac") + 1] = ["-b:a", "320k"]
    subprocess.run(cmd, check=True)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
