#!/usr/bin/env python3
"""Generate the HyperFrames composition from cues.json + aligned words.

- resolves every cue to a time on the cut (word start + offset)
- renders tools/templates/*.html -> project/ ; {{ expr }} is evaluated with cue names and consts
  (e.g. data-start="{{ disc - S2 }}"), /*FONTS*/ is replaced by the @font-face block
- builds project/compositions/captions.html (karaoke groups) from the words, skipping the
  full-screen windows where the card itself shows the words
After any re-cut: tools/cut.py -> whisper -> tools/words.py -> tools/gen.py, and graphics follow.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from words import fold  # noqa: E402

FONTS = """
@font-face{font-family:"BelesSans";src:url("assets/fonts/Inter-Regular.otf");font-weight:400}
@font-face{font-family:"BelesSans";src:url("assets/fonts/Inter-Medium.otf");font-weight:500}
@font-face{font-family:"BelesSans";src:url("assets/fonts/Inter-SemiBold.otf");font-weight:600}
@font-face{font-family:"BelesSans";src:url("assets/fonts/Inter-Bold.otf");font-weight:700}
@font-face{font-family:"BelesSans";src:url("assets/fonts/Inter-ExtraBold.otf");font-weight:800}
"""


def resolve(cfg, words):
    t = dict(cfg.get("consts", {}))
    for name, c in cfg["cues"].items():
        target, n = fold(c["word"]), c.get("n", 1)
        hits = [w for w in words if fold(w["text"]) == target]
        if len(hits) < n:
            sys.exit(f"cue {name}: word '{c['word']}' #{n} not found ({len(hits)} hits)")
        t[name] = round(hits[n - 1]["start"] + c.get("offset", 0.0), 3)
    return t


def render(text, env):
    def sub(m):
        v = eval(m.group(1), {"__builtins__": {"round": round, "max": max, "min": min}}, env)
        return f"{v:.3f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)
    return re.sub(r"\{\{\s*(.+?)\s*\}\}", sub, text.replace("/*FONTS*/", FONTS))


def caption_groups(words, fullscreen, maxw=4, maxchars=26):
    def hidden(w):
        return any(a - 0.05 <= w["start"] < b for a, b in fullscreen)
    groups, cur = [], []
    for i, w in enumerate(words):
        if hidden(w):
            if cur:
                groups.append(cur); cur = []
            continue
        if cur:
            chars = sum(len(x["text"]) + 1 for x in cur) + len(w["text"])
            gap = w["start"] - cur[-1]["end"]
            if len(cur) >= maxw or chars > maxchars or gap >= 0.15:
                groups.append(cur); cur = []
        cur.append(w)
        if w["sent_end"] or (w["comma"] and len(cur) >= 2):
            groups.append(cur); cur = []
    if cur:
        groups.append(cur)
    return groups


def build_captions(words, fullscreen, end):
    groups = caption_groups(words, fullscreen)
    html, js = [], []
    for gi, g in enumerate(groups):
        gs = max(0.1, round(g[0]["start"] - 0.06, 3))
        nxt = groups[gi + 1][0]["start"] - 0.06 if gi + 1 < len(groups) else end
        ge = round(min(max(g[-1]["end"] + 0.15, g[-1]["start"] + 0.3), nxt), 3)
        # never run into a full-screen card
        for a, b in fullscreen:
            if gs < a < ge:
                ge = round(a, 3)
        spans = "".join(f'<span class="w" id="cw{w["id"][1:]}">{w["text"]}</span>' for w in g)
        html.append(f'    <div id="cg{gi}" class="clip cap" data-layout-allow-caption-zone data-start="{gs}" data-duration="{round(ge - gs, 3)}" '
                    f'data-track-index="{gi % 8}">\n      <div class="cap-in" id="cgi{gi}">{spans}</div>\n    </div>')
        js.append(f'  tl.fromTo("#cgi{gi}", {{opacity:0, y:18}}, {{opacity:1, y:0, duration:0.16, ease:"power3.out"}}, {gs});')
        for w in g:
            ws, we = w["start"], min(w["end"], ge - 0.02)
            js.append(f'  tl.fromTo("#cw{w["id"][1:]}", {{color:INK}}, {{color:ACC, duration:0.07, ease:"power2.out"}}, {ws:.3f});')
            js.append(f'  tl.to("#cw{w["id"][1:]}", {{color:INK, duration:0.1, ease:"power2.in"}}, {max(ws + 0.08, we - 0.1):.3f});')
        js.append(f'  tl.to("#cgi{gi}", {{opacity:0, duration:0.1, ease:"power2.in"}}, {ge - 0.1:.3f});')
        js.append(f'  tl.set("#cgi{gi}", {{opacity:0}}, {ge:.3f});')
    return groups, "\n".join(html), "\n".join(js)


def main():
    cfg = json.load(open(ROOT / "cues.json"))
    words = json.load(open(ROOT / ".tmp/words_aligned.json"))
    env = resolve(cfg, words)
    fs = [(env[a], env[b]) for a, b in cfg["fullscreen"]]
    groups, cap_html, cap_js = build_captions(words, fs, env["END"])
    env["CAP_HTML"] = cap_html
    env["CAP_JS"] = cap_js
    tdir = ROOT / "tools/templates"
    for tpl in sorted(tdir.rglob("*.html")):
        rel = tpl.relative_to(tdir)
        text = tpl.read_text()
        text = text.replace("<!--CAP_HTML-->", cap_html).replace("/*CAP_JS*/", cap_js)
        out = ROOT / "project" / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render(text, env))
        print("wrote", out.relative_to(ROOT))
    json.dump({k: v for k, v in env.items() if isinstance(v, (int, float))},
              open(ROOT / ".tmp/cues_resolved.json", "w"), indent=1)
    print("cues:", ", ".join(f"{k}={v}" for k, v in env.items() if isinstance(v, (int, float))))
    print(f"caption groups: {len(groups)}")
    for g in groups:
        print(f"  {g[0]['start']:6.2f}  {' '.join(w['text'] for w in g)}")


if __name__ == "__main__":
    main()
