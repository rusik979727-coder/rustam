#!/usr/bin/env python3
"""Align the human-approved text (edl_spans.json) to whisper word timings of the cut.

Whisper word starts are averaged over the two runs (turbo + full model, both with -dtw),
then the approved words get times by character-level alignment (kk letters folded).
Only START times are meaningful with -ml 1; a word's end = next start, capped at the end
of the speech run it sits in (from the envelope of the cut).

usage: words.py [--runs .tmp/words_cut.json .tmp/words_cut_full.json] [--env .tmp/env_cut.json]
                [--out .tmp/words_aligned.json]
"""
import argparse, difflib, json, re

FOLD = str.maketrans({"ә": "а", "ғ": "г", "қ": "к", "ң": "н", "ө": "о", "ұ": "у", "ү": "у", "һ": "х",
                      "і": "и", "ы": "и", "й": "и", "ё": "е",
                      "b": "б", "e": "е", "l": "л", "s": "с"})


def fold(s):
    return re.sub(r"[^\w]", "", s.lower()).translate(FOLD)


def strip_edge(s):
    return re.sub(r"^[^\w]+|[^\w]+$", "", s)


def whisper_words(path):
    d = json.load(open(path))
    return [(t["text"].strip(), t["offsets"]["from"] / 1000) for t in d["transcription"] if t["text"].strip()]


def avg_runs(paths):
    runs = [whisper_words(p) for p in paths]
    base = runs[0]
    out = []
    for i, (w, t) in enumerate(base):
        ts = [t]
        for r in runs[1:]:
            # same position & similar text -> average
            if i < len(r) and difflib.SequenceMatcher(None, fold(w), fold(r[i][0])).ratio() > 0.5:
                ts.append(r[i][1])
        out.append((w, sum(ts) / len(ts)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", default=[".tmp/words_cut.json", ".tmp/words_cut_full.json"])
    ap.add_argument("--edl", default="edl_spans.json")
    ap.add_argument("--env", default=".tmp/env_cut.json")
    ap.add_argument("--out", default=".tmp/words_aligned.json")
    ap.add_argument("--media-end", type=float, default=None,
                    help="cut length; the last word (quiet kk ending) is held to media_end-0.05")
    a = ap.parse_args()

    ww = avg_runs(a.runs)
    # character stream of whisper words with per-char time
    wchars, wtime = [], []
    for k, (w, t) in enumerate(ww):
        f = fold(w)
        nxt = ww[k + 1][1] if k + 1 < len(ww) else t + 0.5
        for j, ch in enumerate(f):
            wchars.append(ch)
            wtime.append(t + (nxt - t) * j / max(1, len(f)))

    edl = json.load(open(a.edl))
    approved = []
    for sp in edl["spans"]:
        toks = [x for x in sp["text"].split() if strip_edge(x)]
        for j, x in enumerate(toks):
            approved.append({"text": x, "span": sp["id"], "sent_end": bool(re.search(r"[.!?]$", x)),
                             "comma": x.endswith(","), "span_end": j == len(toks) - 1})
    achars, aowner = [], []
    for i, w in enumerate(approved):
        for ch in fold(w["text"]):
            achars.append(ch)
            aowner.append(i)

    sm = difflib.SequenceMatcher(None, "".join(achars), "".join(wchars), autojunk=False)
    amap = {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            amap[blk.a + k] = blk.b + k
    starts = [None] * len(approved)
    for ci, owner in enumerate(aowner):
        if starts[owner] is None and ci in amap:
            # offset back by the position of this char within the word
            starts[owner] = wtime[amap[ci]]
    # interpolate missing
    for i in range(len(starts)):
        if starts[i] is None:
            prev = next((starts[j] for j in range(i - 1, -1, -1) if starts[j] is not None), 0.0)
            nxt = next((starts[j] for j in range(i + 1, len(starts)) if starts[j] is not None), prev + 0.4)
            starts[i] = (prev + nxt) / 2
    for i in range(1, len(starts)):
        starts[i] = max(starts[i], starts[i - 1] + 0.05)

    speech = json.load(open(a.env))["speech"]

    def run_end(t):
        for s, e in speech:
            if s - 0.15 <= t < e:
                return e
        return t + 0.4

    out = []
    for i, w in enumerate(approved):
        st = round(starts[i], 3)
        nx = starts[i + 1] if i + 1 < len(approved) else run_end(st)
        en = round(min(nx, run_end(st)) if i + 1 < len(approved) else nx, 3)
        if i + 1 == len(approved) and a.media_end:
            en = round(max(en, a.media_end - 0.05), 3)
        if en <= st:
            en = round(st + 0.12, 3)
        out.append({"id": f"w{i}", "text": w["text"], "start": st, "end": en, "span": w["span"],
                    "sent_end": w["sent_end"], "comma": w["comma"]})
    json.dump(out, open(a.out, "w"), ensure_ascii=False, indent=1)
    for w in out:
        print(f"{w['id']:>4} {w['start']:6.2f}-{w['end']:6.2f} {w['text']}")


if __name__ == "__main__":
    main()
