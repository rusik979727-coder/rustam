"""BELES Reels: «Қайырлы күн» clinic-entrance clip, rebuilt in the BELES brand system.

Usage:  python3 render.py SOURCE.mov ASSETS_DIR OUT.mp4

Timeline (30 fps):
  0.00–1.70  hook: fade from navy + zoom-out reveal from the BELES sign to the full entrance
  0.35–2.40  branded info panel builds (headline word-by-word, line draw, two info chips)
  1.70–7.05  slow cinematic push-in
  7.05–7.65  transition: frame scales up and dissolves into the end card
  7.65–10.0  end card: original logo, CTA pill, address line
"""
import math, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC, ASSETS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
W, H, FPS = 1080, 1920, 30
SRC_DUR = 7.5
T_TRANS, T_CARD, DUR = 7.05, 7.65, 10.0
N = int(DUR * FPS)

TURQ = (0, 191, 196); NAVY = (6, 43, 80); DARK = (2, 11, 22)
BLUE2 = (8, 124, 155); WHITE = (255, 255, 255); LGRAY = (234, 241, 244)

def font(name, size):
    return ImageFont.truetype(f"{ASSETS}/Inter-{name}.otf", size)

def clamp(x): return max(0.0, min(1.0, x))
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_io(x): x = clamp(x); return 3 * x * x - 2 * x * x * x
def prog(t, a, b): return clamp((t - a) / (b - a))

# ---------- source frames (graded by ffmpeg) ----------
grade = ",".join([
    "fps=30", "scale=1080:1920:flags=lanczos",
    "hqdn3d=1.2:1.2:4:4",
    # cinematic grade: cool teal shadows, clean neutral highlights, gentle S-curve
    "colorbalance=rs=-0.04:gs=0.0:bs=0.05:rm=-0.02:bm=0.02:rh=0.01:gh=0.0:bh=-0.01",
    "curves=all='0/0.02 0.25/0.22 0.5/0.5 0.75/0.79 1/0.98'",
    "eq=saturation=0.9:contrast=1.04",
    "unsharp=5:5:0.45",
])
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", SRC, "-vf", grade, "-f", "rawvideo",
                      "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
fsz = W * H * 3
frames = [raw[i:i + fsz] for i in range(0, len(raw) - fsz + 1, fsz)]

# vignette (soft, multiplicative)
yy, xx = np.mgrid[0:H, 0:W]
d = np.sqrt(((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H * 0.42) / (H * 0.75)) ** 2)
VIG = (1 - 0.28 * np.clip(d - 0.35, 0, 1) ** 1.6)[..., None].astype(np.float32)

SIGN = (530, 560)  # BELES sign centre in the source frame

def source_frame(t):
    i = min(int(round(t * FPS)), len(frames) - 1)
    img = Image.frombytes("RGB", (W, H), frames[i])
    if t < 1.7:
        z = 1.42 - 0.42 * ease_out(t / 1.7)
    else:
        z = 1.0 + 0.06 * ease_io((t - 1.7) / (T_CARD - 1.7))
    # zoom anchored on the sign so the burned-in source text is pushed down and out
    px, py = SIGN
    cw, ch = W / z, H / z
    x0 = min(max(px * (1 - 1 / z), 0), W - cw); y0 = min(max(py * (1 - 1 / z), 0), H - ch)
    img = img.resize((W, H), Image.LANCZOS, box=(x0, y0, x0 + cw, y0 + ch))
    a = np.asarray(img, np.float32) * VIG
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

# ---------- info panel (covers the old burned-in text) ----------
PANEL_TOP = 1250
def panel_base():
    p = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    a = np.zeros((H, W), np.float32)
    ramp = np.clip((np.arange(H) - PANEL_TOP) / 180, 0, 1)
    a[:] = (ramp ** 1.4)[:, None]
    arr = np.zeros((H, W, 4), np.uint8)
    g = np.clip((np.arange(H) - PANEL_TOP) / (H - PANEL_TOP), 0, 1)[:, None]
    for c in range(3):
        arr[..., c] = (NAVY[c] * (1 - g) + DARK[c] * g).astype(np.uint8)
    arr[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")
PANEL = panel_base()

F_HEAD = font("ExtraBold", 104); F_LBL = font("Medium", 34); F_VAL = font("Bold", 50)
F_SM = font("SemiBold", 30)

def icon_clock(d, x, y, r, col):
    d.ellipse([x - r, y - r, x + r, y + r], outline=col, width=5)
    d.line([x, y, x, y - r * 0.55], fill=col, width=5); d.line([x, y, x + r * 0.45, y], fill=col, width=5)

def icon_pin(d, x, y, r, col):
    d.ellipse([x - r, y - r * 1.35, x + r, y + r * 0.65], fill=col)
    d.polygon([(x - r * 0.78, y - r * 0.05), (x + r * 0.78, y - r * 0.05), (x, y + r * 1.25)], fill=col)
    d.ellipse([x - r * 0.38, y - r * 0.73, x + r * 0.38, y + r * 0.03], fill=NAVY)

def chip(label, value, icon, w=470, h=170):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, w - 1, h - 1], 34, fill=(255, 255, 255, 22), outline=(0, 191, 196, 120), width=2)
    d.ellipse([28, h / 2 - 38, 104, h / 2 + 38], fill=(0, 191, 196, 255))
    icon(d, 66, h / 2, 17, NAVY)
    d.text((126, 40), label, font=F_LBL, fill=(234, 241, 244, 200))
    d.text((126, 84), value, font=F_VAL, fill=WHITE)
    return im
CHIP1 = chip("Жұмыс уақыты", "9:00–18:00", icon_clock, w=420)
CHIP2 = chip("Мекенжай", "Тәуелсіздік 24", icon_pin, w=530)

def paste(base, im, x, y, alpha):
    if alpha <= 0: return
    if alpha < 1:
        im = im.copy(); im.putalpha(im.getchannel("A").point(lambda v: int(v * alpha)))
    base.alpha_composite(im, (int(x), int(y)))

def overlay(t):
    o = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pp = ease_out(prog(t, 0.0, 0.7))
    o.alpha_composite(PANEL, (0, int((1 - pp) * 420)))
    d = ImageDraw.Draw(o)
    # headline, word by word
    words = ["Қайырлы", "күн!"]; x = 70
    for k, wd in enumerate(words):
        p = ease_out(prog(t, 0.45 + 0.22 * k, 0.95 + 0.22 * k))
        if p > 0:
            col = WHITE if k == 0 else TURQ
            layer = Image.new("RGBA", (W, 160), (0, 0, 0, 0))
            ImageDraw.Draw(layer).text((x, 10), wd, font=F_HEAD, fill=col + (int(255 * p),))
            o.alpha_composite(layer, (0, int(1470 + (1 - p) * 50)))
        x += F_HEAD.getlength(wd + " ")
    # accent line draws left→right
    lp = ease_io(prog(t, 1.05, 1.6))
    if lp > 0:
        d.rounded_rectangle([72, 1612, 72 + 140 * lp, 1620], 4, fill=TURQ)
    # chips
    for k, (c, cx) in enumerate([(CHIP1, 60), (CHIP2, 500)]):
        p = ease_out(prog(t, 1.35 + 0.25 * k, 1.95 + 0.25 * k))
        paste(o, c, cx, 1668 + (1 - p) * 60, p)
    return o

# ---------- end card ----------
LOGO = Image.open(f"{ASSETS}/logo.png").convert("RGBA")
def end_card_base():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    g = np.clip(yy / H, 0, 1)[..., None]
    bg = np.array(WHITE, np.float32) * (1 - g) + np.array(LGRAY, np.float32) * g
    glow = np.exp(-(((xx - W / 2) / 520) ** 2 + ((yy - 760) / 520) ** 2))[..., None]
    bg = bg * (1 - 0.16 * glow) + np.array(TURQ, np.float32) * 0.16 * glow
    return Image.fromarray(bg.astype(np.uint8)).convert("RGBA")
CARD_BG = end_card_base()
F_CTA = font("Bold", 50); F_CTA_SUB = font("Medium", 36); F_INFO = font("SemiBold", 34)

def cta_pill():
    w, h = 640, 128
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    grad = Image.linear_gradient("L").rotate(90).resize((w, h))
    a = np.asarray(grad, np.float32)[..., None] / 255
    col = np.array(TURQ, np.float32) * (1 - a) + np.array(BLUE2, np.float32) * a
    fill = Image.fromarray(col.astype(np.uint8)).convert("RGBA")
    mask = Image.new("L", (w, h), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], h // 2, fill=255)
    im.paste(fill, (0, 0), mask)
    d = ImageDraw.Draw(im); txt = "Жазылыңыз"
    d.text((w / 2, h / 2), txt, font=F_CTA, fill=WHITE, anchor="mm")
    return im
CTA = cta_pill()
SHADOW = Image.new("RGBA", (CTA.width + 120, CTA.height + 120), (0, 0, 0, 0))
ImageDraw.Draw(SHADOW).rounded_rectangle([60, 80, 60 + CTA.width, 80 + CTA.height], 64, fill=(8, 124, 155, 90))
SHADOW = SHADOW.filter(ImageFilter.GaussianBlur(24))

def end_card(t):
    c = CARD_BG.copy(); lt = t - T_CARD + 0.35
    lp = ease_out(prog(lt, 0.0, 0.8))
    s = 0.86 + 0.14 * lp; lw = int(LOGO.width * 1.55 * s); lh = int(LOGO.height * 1.55 * s)
    paste(c, LOGO.resize((lw, lh), Image.LANCZOS), (W - lw) / 2, 470 + (1.55 * LOGO.height - lh) / 2, lp)
    d = ImageDraw.Draw(c)
    sp = ease_out(prog(lt, 0.45, 1.0))
    if sp > 0:
        sub = "Омыртқа мен буын денсаулығы — сенімді қолда"
        layer = Image.new("RGBA", (W, 80), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((W / 2, 40), sub, font=F_CTA_SUB, fill=NAVY + (int(230 * sp),), anchor="mm")
        c.alpha_composite(layer, (0, int(1150 + (1 - sp) * 30)))
    cp = ease_out(prog(lt, 0.75, 1.3))
    if cp > 0:
        pulse = 1 + 0.025 * math.sin(max(0, lt - 1.3) * 2 * math.pi / 1.2) * (lt > 1.3)
        cw, ch = int(CTA.width * pulse), int(CTA.height * pulse)
        cy = 1290 + (1 - cp) * 50
        paste(c, SHADOW, (W - SHADOW.width) / 2, cy - 60, cp)
        paste(c, CTA.resize((cw, ch), Image.LANCZOS), (W - cw) / 2, cy + (CTA.height - ch) / 2, cp)
    ip = ease_out(prog(lt, 1.05, 1.55))
    if ip > 0:
        layer = Image.new("RGBA", (W, 80), (0, 0, 0, 0)); ld = ImageDraw.Draw(layer)
        ld.text((W / 2, 40), "Тәуелсіздік 24   ·   9:00–18:00", font=F_INFO, fill=BLUE2 + (int(255 * ip),), anchor="mm")
        c.alpha_composite(layer, (0, 1500))
        d.rounded_rectangle([W / 2 - 60 * ip, 1620, W / 2 + 60 * ip, 1626], 3, fill=TURQ)
    return c.convert("RGB")

# ---------- render ----------
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                        "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow",
                        "-crf", "16", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
                        "-colorspace", "bt709", "-movflags", "+faststart", OUT + ".video.mp4"], stdin=subprocess.PIPE)
for n in range(N):
    t = n / FPS
    if t < T_CARD:
        f = source_frame(min(t, SRC_DUR - 1 / FPS)).convert("RGBA")
        f.alpha_composite(overlay(t))
        if t < 0.35:  # fade up from navy
            f = Image.blend(Image.new("RGBA", (W, H), NAVY + (255,)), f, ease_out(t / 0.35))
        frame = f.convert("RGB")
        if t >= T_TRANS:  # scale-up dissolve into the end card
            p = ease_io(prog(t, T_TRANS, T_CARD))
            z = 1 + 0.12 * p
            frame = frame.resize((int(W * z), int(H * z)), Image.BILINEAR).crop(
                (int((W * z - W) / 2), int((H * z - H) / 2), int((W * z - W) / 2) + W, int((H * z - H) / 2) + H))
            frame = frame.filter(ImageFilter.GaussianBlur(6 * p))
            frame = Image.blend(frame, end_card(t), p)
    else:
        frame = end_card(t)
    enc.stdin.write(frame.tobytes())
enc.stdin.close(); enc.wait()
