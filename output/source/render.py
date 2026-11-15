#!/usr/bin/env python3
"""BELES Reels: камера + субтитр + callout + бренд + end-card. Пайдалану: render.py WORKDIR OUT_SILENT.mp4"""
import json, math, os, subprocess, sys
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

WD = sys.argv[1]; OUT = sys.argv[2]
SPEC = json.load(open(os.path.join(WD, "spec.json"), encoding="utf-8"))
W, H, FPS = 1080, 1920, 30
SRC_DUR = SPEC["src_duration"]; END_DUR = SPEC["end_duration"]
TOTAL = SRC_DUR + END_DUR; NF = int(round(TOTAL * FPS))
YELLOW, WHITE, TEAL, NAVY, TEAL_L = (255, 222, 40), (255, 255, 255), (47, 110, 110), (27, 42, 64), (95, 190, 185)
FONT = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
FONT_B = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
FONT_SB = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
PINK = (255, 95, 200)
_fc = {}
def font(sz, p=FONT):
    if (sz, p) not in _fc: _fc[(sz, p)] = ImageFont.truetype(p, sz)
    return _fc[(sz, p)]

def smooth(x): x = min(max(x, 0), 1); return x * x * (3 - 2 * x)
def ease_out(x): x = min(max(x, 0), 1); return 1 - (1 - x) ** 3
def back_out(x, s=1.9):
    x = min(max(x, 0), 1) - 1; return x * x * ((s + 1) * x + s) + 1

# ---------------- бренд ассеттері ----------------
def brand_assets():
    lg = Image.open(os.path.join(WD, "logo.jpg")).convert("RGB")
    a = np.asarray(lg).astype(np.float32)
    # эмблема: шеңбер маскасы
    cx, cy, r = 291.5, 147.5, 107
    em = lg.crop((int(cx - r), int(cy - r), int(cx + r), int(cy + r))).convert("RGBA")
    S = 4; m = Image.new("L", (em.width * S, em.height * S), 0)
    ImageDraw.Draw(m).ellipse((0, 0, em.width * S - 1, em.height * S - 1), fill=255)
    em.putalpha(m.resize(em.size, Image.LANCZOS))
    em = em.resize((600, 600), Image.LANCZOS)
    # сөз белгісі: қараңғылық -> альфа, қайта бояу (BEL ақ, ES ашық бирюза)
    def recolor(y0, y1, x0, x1, split=None):
        sub = a[y0:y1, x0:x1]; alpha = np.clip((255 - sub.min(2)) * 1.25, 0, 255)
        rgb = np.zeros(sub.shape, np.float32); rgb[:] = WHITE
        if split:
            rgb[:, split - x0:] = TEAL_L
        out = np.dstack([rgb, alpha]).astype(np.uint8)
        return Image.fromarray(out, "RGBA")
    word = recolor(282, 388, 60, 524, split=350)
    tag = recolor(409, 440, 130, 452)
    return em, word, tag

EMB, WORD, TAG = brand_assets()

def shadowed(img, rad=8, off=4, op=160):
    pad = rad * 3
    base = Image.new("RGBA", (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0))
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    blk = Image.new("RGBA", img.size, (0, 0, 0, op)); blk.putalpha(img.split()[3].point(lambda v: v * op // 255))
    sh.paste(blk, (pad, pad + off), blk)
    base = Image.alpha_composite(base, sh.filter(ImageFilter.GaussianBlur(rad)))
    base.alpha_composite(img, (pad, pad))
    return base, pad

# ---------------- субтитр ----------------
def word_style(tok):
    st = {"*": "y", "^": "p", "!": "B", "~": "BY"}.get(tok[0], "w")
    t = tok[1:] if st != "w" else tok
    return {"w": (t.lower(), 52, WHITE), "y": (t.lower(), 58, YELLOW), "p": (t.lower(), 58, PINK),
            "B": (t.upper(), 80, WHITE), "BY": (t.upper(), 80, YELLOW)}[st] + (st,)

def render_word(text, size, col, st):
    f = font(size, FONT_SB if st == "w" else FONT); b = f.getbbox(text)
    w, h = b[2] - b[0], b[3] - b[1]
    img = Image.new("RGBA", (w + 4, int(size * 1.25)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((2 - b[0], int(size * 0.12) - b[1] + int(size * 0.05)), text, font=f, fill=col + (255,),
           stroke_width=0)
    return shadowed(img, 9, 3, 150)

class Caption:
    def __init__(self, c):
        self.start, self.end = c["start"], c["end"]
        lines = [ln.split() for ln in c["lines"]]
        flat = [w for ln in lines for w in ln]
        times = c["times"]; assert len(times) == len(flat), (c, len(flat))
        px, py = c.get("pos", [0.5, 0.62]); gap = 16
        rows, total = [], 0
        for ln in lines:
            items = []
            for tok in ln:
                text, size, col, st = word_style(tok)
                img, pad = render_word(text, size, col, st)
                items.append((img, pad, size, col, st))
            lw = sum(i[0].width - 2 * i[1] for i in items) + gap * (len(items) - 1)
            lh = int(max(i[2] for i in items) * 1.08)
            rows.append((items, lw, lh)); total += lh
        self.words = []; y = py * H - total / 2; k = 0
        for items, lw, lh in rows:
            x = px * W - lw / 2
            for img, pad, size, col, st in items:
                iw = img.width - 2 * pad
                self.words.append(dict(img=img, x=x - pad, y=y + lh - size * 1.2 - pad, w=iw, size=size,
                                       col=col, st=st, t=times[k], cache={}))
                x += iw + gap; k += 1
            y += lh

    def draw(self, canvas, t):
        if not (self.start <= t < self.end): return
        for wd in self.words:
            age = t - wd["t"]
            if age < 0: continue
            p = min(age / 0.24, 1.0); q = int(p * 10)
            if q not in wd["cache"]:
                pp = q / 10
                s = 0.55 + 0.45 * back_out(pp)
                im = wd["img"]
                if s != 1.0:
                    im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.BILINEAR)
                if pp < 1:
                    im = im.filter(ImageFilter.GaussianBlur(9 * (1 - pp)))
                    al = im.split()[3].point(lambda v: int(v * min(1, 0.15 + pp * 1.4)))
                    im.putalpha(al)
                wd["cache"][q] = im
            im = wd["cache"][q]
            cx = wd["x"] + wd["img"].width / 2; cy = wd["y"] + wd["img"].height / 2
            canvas.alpha_composite(im, (int(cx - im.width / 2), int(max(0, cy - im.height / 2))))
            if wd["st"] in ("y", "p"):  # астын сызу жүгіреді
                u = ease_out((age - 0.12) / 0.3)
                if u > 0:
                    d = ImageDraw.Draw(canvas)
                    pad = (wd["img"].width - wd["w"]) / 2
                    x0 = wd["x"] + pad; yb = wd["y"] + pad + wd["size"] * 1.22
                    d.rounded_rectangle((x0, yb, x0 + max(8, wd["w"] * u), yb + 7), 3, fill=wd["col"] + (230,))

# ---------------- секция атауы ----------------
def section_img(num, title):
    f = font(54); n = f"{num}. "; T = title.upper()
    wn = f.getbbox(n)[2]; wt = f.getbbox(T)[2]
    pw, ph = wn + wt + 70, 98
    img = Image.new("RGBA", (pw, ph), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.text((36, 20), n, font=f, fill=YELLOW + (255,)); d.text((36 + wn, 20), T, font=f, fill=WHITE + (255,))
    return shadowed(img, 7, 3, 235)[0]

# ---------------- callout (бастапқы кеңістікте) ----------------
_pill = {}
def pill(text, col):
    if text not in _pill:
        f = font(40); b = f.getbbox(text); w = b[2] - b[0] + 56
        img = Image.new("RGBA", (w, 76), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
        d.rounded_rectangle((0, 0, w - 1, 75), 38, fill=col + (235,))
        d.text((28 - b[0], 38 - (b[1] + b[3]) // 2), text, font=f, fill=WHITE + (255,))
        _pill[text] = shadowed(img, 8, 4, 150)[0]
    return _pill[text]

def draw_callouts(frame_bgr, t):
    active = [c for c in SPEC["callouts"] if c["start"] <= t < c["end"]]
    if not active: return frame_bgr
    canvas = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)).convert("RGBA")
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    for c in active:
        age = t - c["start"]; left = c["end"] - t
        fade = min(1, left / 0.15)
        cx, cy, r = c["center"][0], c["center"][1], c["r"]
        col = tuple(c.get("color", TEAL_L)); a = int(255 * fade)
        if c.get("kind") == "pulse":
            for k in range(3):
                ph = ((age * 1.6) + k / 3) % 1.0
                rr = r * (0.3 + 1.2 * ph)
                d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=col + (int(a * (1 - ph)),), width=8)
            g = int(90 * fade * (0.6 + 0.4 * math.sin(age * 12)))
            for k in range(6, 0, -1):
                rr = r * 0.12 * k
                d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=col + (g // 6,))
            continue
        sweep = 360 * ease_out(age / 0.35)
        d.arc((cx - r, cy - r, cx + r, cy + r), -90, -90 + sweep, fill=col + (a,), width=9)
        ph = (age * 1.2) % 1.0
        rr = r * (1 + 0.35 * ph)
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=col + (int(a * 0.6 * (1 - ph)),), width=5)
        lx, ly = c["label"]
        ang = math.atan2(ly - cy, lx - cx)
        sx, sy = cx + r * math.cos(ang), cy + r * math.sin(ang)
        u = ease_out((age - 0.25) / 0.3)
        if u > 0:
            ex, ey = sx + (lx - sx) * u, sy + (ly - sy) * u
            d.line((sx, sy, ex, ey), fill=WHITE + (a,), width=6)
            d.ellipse((sx - 9, sy - 9, sx + 9, sy + 9), fill=WHITE + (a,))
        v = back_out((age - 0.5) / 0.3)
        if v > 0.02:
            p = pill(c["text"], tuple(c.get("pill", TEAL)))
            pp = p.resize((max(1, int(p.width * v)), max(1, int(p.height * v))), Image.BILINEAR)
            if fade < 1:
                pp.putalpha(pp.split()[3].point(lambda q: int(q * fade)))
            ov.alpha_composite(pp, (int(lx - pp.width / 2), int(ly - pp.height / 2)))
    canvas.alpha_composite(ov)
    return cv2.cvtColor(np.asarray(canvas.convert("RGB")), cv2.COLOR_RGB2BGR)

# ---------------- камера ----------------
SEGS = SPEC["segments"]
def seg_at(t):
    for i, s in enumerate(SEGS):
        if s["start"] <= t < s["end"]: return i, s
    return len(SEGS) - 1, SEGS[-1]

def camera(frame, s, t):
    p = smooth((t - s["start"]) / max(s["end"] - s["start"], 1e-3))
    z0, z1 = s.get("zoom", [1, 1.06]); r0, r1 = s.get("rot", [0, 0])
    pan = s.get("pan", [[0, 0], [0, 0]])
    z = z0 + (z1 - z0) * p; rot = r0 + (r1 - r0) * p
    dx = pan[0][0] + (pan[1][0] - pan[0][0]) * p; dy = pan[0][1] + (pan[1][1] - pan[0][1]) * p
    ax, ay = s.get("anchor", [540, 960])
    M = cv2.getRotationMatrix2D((ax, ay), rot, z)
    M[0, 2] += (W / 2 - ax) * 0 + dx; M[1, 2] += dy
    # anchor экранда өз орнында қалады; жеткіліксіз zoom-да шеттерін reflect толтырады
    return cv2.warpAffine(frame, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

def zoomblur(f, a):
    if a <= 0: return f
    z = 1 + 0.22 * a
    M = cv2.getRotationMatrix2D((W / 2, H / 2), 0, z)
    g = cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REFLECT)
    acc = g.astype(np.float32)
    for k in range(1, 5):
        M = cv2.getRotationMatrix2D((W / 2, H / 2), 0, z * (1 + 0.035 * a * k))
        acc += cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REFLECT)
    return (acc / 5).astype(np.uint8)

def whip(f, a, direction):
    if a <= 0: return f
    L = int(5 + 140 * a); ker = np.full((1, L), 1 / L, np.float32)
    f = cv2.filter2D(f, -1, ker)
    return np.roll(f, int(direction * W * 0.4 * a), axis=1)

def flash(f, a, col=(255, 255, 255)):
    if a <= 0: return f
    c = np.array(col[::-1], np.float32)
    return np.clip(f.astype(np.float32) * (1 - 0.7 * a) + c * 0.7 * a, 0, 255).astype(np.uint8)

_leak = None
def light_leak(f, a, pos):
    global _leak
    if _leak is None:
        yy, xx = np.mgrid[:H, :W].astype(np.float32)
        _leak = (xx, yy)
    xx, yy = _leak
    cx = -300 + pos * (W + 600)
    g = np.exp(-(((xx - cx) / 380) ** 2 + ((yy - H * 0.4) / 900) ** 2))
    col = np.array([185, 200, 110], np.float32)  # BGR: бирюза-жылы
    return np.clip(f.astype(np.float32) + g[..., None] * col * a * 1.1, 0, 255).astype(np.uint8)

VIG = None
def grade(f):
    global VIG
    if VIG is None:
        yy, xx = np.ogrid[:H, :W]
        d = ((xx - W / 2) / (W / 1.25)) ** 2 + ((yy - H / 2) / (H / 1.25)) ** 2
        VIG = (1 - 0.10 * np.clip(d, 0, 1))[..., None].astype(np.float32)
    g = f.astype(np.float32)  # негізгі грейд beauty.py-да; мұнда тек виньетка
    return np.clip(g * VIG, 0, 255).astype(np.uint8)

TR = 5
def transition_fx(f, t):
    gi = t * FPS
    for b in SPEC["transitions"]:
        bf = b["t"] * FPS; k = gi - bf  # k<0: бұрын, k>=0: кейін
        if -TR <= k < TR:
            a = (k + TR + 1) / TR if k < 0 else 1 - k / TR
            a = max(0.0, min(1.0, a))
            ty = b["type"]
            if ty == "zoomblur": f = zoomblur(f, a)
            elif ty == "whip": f = whip(f, a, -1 if k < 0 else 1)
            elif ty == "flash": f = flash(f, a * 0.8)
            elif ty == "redflash": f = flash(zoomblur(f, a * 0.6), a * 0.6, (255, 60, 40))
            elif ty == "leak": f = light_leak(whip(f, a, -1 if k < 0 else 1), a, (k + TR) / (2 * TR))
    return f

# ---------------- логотип: интро + watermark ----------------
def emb_scaled(sz, rot=0, alpha=1.0):
    im = EMB.resize((max(1, int(sz)), max(1, int(sz))), Image.LANCZOS)
    if rot: im = im.rotate(rot, Image.BICUBIC, expand=False)
    if alpha < 1: im.putalpha(im.split()[3].point(lambda v: int(v * alpha)))
    return im

WM_POS, WM_SZ = (112, 118), 104
WM_WORD = WORD.resize((int(WORD.width * 0.36), int(WORD.height * 0.36)), Image.LANCZOS)
WM_WORD_S = shadowed(WM_WORD, 6, 3, 150)

def draw_logo(canvas, t):
    I0, I1, I2 = 0.0, 0.45, 0.85
    if t < I1:
        p = back_out(t / I1, 1.4); sz = 230 * max(p, 0.01)
        im = emb_scaled(sz, rot=-120 * (1 - ease_out(t / I1)), alpha=min(1, t / 0.15))
        canvas.alpha_composite(im, (int(540 - im.width / 2), int(330 - im.height / 2)))
    elif t < I2:
        p = smooth((t - I1) / (I2 - I1))
        for g in range(4, -1, -1):  # motion-blur ізі
            pg = max(0, p - g * 0.05)
            x = 540 + (WM_POS[0] - 540) * pg; y = 330 + (WM_POS[1] - 330) * pg
            sz = 230 + (WM_SZ - 230) * pg
            im = emb_scaled(sz, alpha=1.0 if g == 0 else 0.22)
            canvas.alpha_composite(im, (int(x - im.width / 2), int(y - im.height / 2)))
    elif t < SRC_DUR - 0.1:
        u0 = ease_out((t - I2) / 0.4)
        dd = ImageDraw.Draw(canvas)
        x0 = WM_POS[0] - WM_SZ / 2 - 8; y0 = WM_POS[1] - WM_SZ / 2 - 8
        x1 = WM_POS[0] + WM_SZ / 2 + 8 + (WM_WORD.width + 30) * u0
        dd.rounded_rectangle((x0, y0, x1, y0 + WM_SZ + 16), (WM_SZ + 16) // 2, fill=NAVY + (175,))
        im = emb_scaled(WM_SZ)
        canvas.alpha_composite(im, (int(WM_POS[0] - WM_SZ / 2), int(WM_POS[1] - WM_SZ / 2)))
        u = ease_out((t - I2) / 0.4)
        if u > 0:
            ws, pad = WM_WORD_S
            crop = ws.crop((0, 0, int(pad + WM_WORD.width * u) + pad, ws.height))
            canvas.alpha_composite(crop, (int(WM_POS[0] + WM_SZ / 2 + 14 - pad), int(WM_POS[1] - ws.height / 2)))

# ---------------- end-card ----------------
def end_card(last_bgr, te):
    bg = cv2.GaussianBlur(last_bgr, (0, 0), 30).astype(np.float32)
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    top = np.array(NAVY[::-1], np.float32); bot = np.array(TEAL[::-1], np.float32)
    grad = top * (1 - yy) + bot * yy
    k = smooth(te / 0.35)
    f = bg * (1 - 0.88 * k) + grad * 0.88 * k
    # жұмсақ жарық дақтары
    f = np.clip(f, 0, 255).astype(np.uint8)
    canvas = Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)).convert("RGBA")
    d = ImageDraw.Draw(canvas)
    cy = 700
    # эмблема
    p = back_out((te - 0.1) / 0.55, 1.5)
    if p > 0.01:
        sz = 420 * p
        for g in range(3):
            ph = ((te - 0.6) * 0.8 + g / 3) % 1 if te > 0.6 else None
            if ph is not None:
                rr = 230 + 160 * ph
                d.ellipse((540 - rr, cy - rr, 540 + rr, cy + rr), outline=TEAL_L + (int(140 * (1 - ph)),), width=4)
        im = emb_scaled(sz, rot=-90 * (1 - ease_out((te - 0.1) / 0.55)))
        canvas.alpha_composite(im, (int(540 - im.width / 2), int(cy - im.height / 2)))
    # BELES әріптері кезекпен
    wd = WORD.resize((int(WORD.width * 1.45), int(WORD.height * 1.45)), Image.LANCZOS)
    letters = [0, 0.2, 0.4, 0.6, 0.8, 1.0]
    for i in range(5):
        u = ease_out((te - 0.55 - i * 0.07) / 0.35)
        if u <= 0: continue
        x0 = int(wd.width * letters[i]); x1 = int(wd.width * letters[i + 1])
        piece = wd.crop((x0, 0, x1, wd.height))
        if u < 1: piece.putalpha(piece.split()[3].point(lambda v: int(v * u)))
        canvas.alpha_composite(piece, (int(540 - wd.width / 2 + x0), int(1010 + 60 * (1 - u))))
    u = ease_out((te - 1.0) / 0.4)
    if u > 0:
        tg = TAG.resize((int(TAG.width * 1.45), int(TAG.height * 1.45)), Image.LANCZOS)
        tg.putalpha(tg.split()[3].point(lambda v: int(v * u)))
        canvas.alpha_composite(tg, (int(540 - tg.width / 2), 1180))
    # CTA
    v = back_out((te - 1.25) / 0.35)
    if v > 0.02:
        f1 = font(42); txt = "КОММЕНТКЕ «БЕЛ» ДЕП ЖАЗЫҢЫЗ"
        b = f1.getbbox(txt); w = b[2] - b[0] + 80
        pul = 1 + 0.035 * math.sin(max(0, te - 1.6) * 7)
        img = Image.new("RGBA", (w, 120), (0, 0, 0, 0)); dd = ImageDraw.Draw(img)
        dd.rounded_rectangle((0, 0, w - 1, 119), 60, fill=YELLOW + (255,))
        dd.text((45 - b[0], 60 - (b[1] + b[3]) // 2), txt, font=f1, fill=NAVY + (255,))
        s = v * pul; img = img.resize((int(w * s), int(120 * s)), Image.BILINEAR)
        img, pad = shadowed(img, 12, 6, 150)
        canvas.alpha_composite(img, (int(540 - img.width / 2), int(1400 - img.height / 2)))
    return canvas

# ---------------- негізгі цикл ----------------
def main():
    caps = [Caption(c) for c in SPEC["captions"]]
    secs = [(s, section_img(s["num"], s["title"])) for s in SPEC["sections"]]
    cap = cv2.VideoCapture(os.path.join(WD, SPEC.get("src", "src.mp4")))
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", OUT]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    last = None; last_out = None
    for gi in range(NF):
        t = gi / FPS
        if t < SRC_DUR:
            ok, fr = cap.read()
            if ok: last = fr
            fr = last.copy()
            fr = draw_callouts(fr, t)
            _, s = seg_at(t)
            fr = camera(fr, s, t)
            fr = transition_fx(fr, t)
            fr = grade(fr)
            last_out = fr
            canvas = Image.fromarray(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)).convert("RGBA")
            for s_, img in secs:
                if s_["start"] <= t < s_["end"]:
                    u = ease_out((t - s_["start"]) / 0.35)
                    out = s_["end"] - t
                    if out < 0.12: u = min(u, out / 0.12)
                    crop = img.crop((0, 0, max(1, int(img.width * u)), img.height))
                    canvas.alpha_composite(crop, (int((W - img.width) / 2), int(H * 0.105)))
            for c in caps: c.draw(canvas, t)
            draw_logo(canvas, t)
            out = cv2.cvtColor(np.asarray(canvas.convert("RGB")), cv2.COLOR_RGB2BGR)
        else:
            te = t - SRC_DUR
            canvas = end_card(last_out, te)
            out = cv2.cvtColor(np.asarray(canvas.convert("RGB")), cv2.COLOR_RGB2BGR)
            if te < TR / FPS:  # end-card-қа кіру zoomblur
                out = zoomblur(out, 1 - te * FPS / TR)
        ff.stdin.write(out.tobytes())
        if gi % 150 == 0: print(f"{gi}/{NF}", flush=True)
    ff.stdin.close(); ff.wait(); print("video ok", OUT)

if __name__ == "__main__":
    main()
