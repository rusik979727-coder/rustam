#!/usr/bin/env python3
"""Адамды әдемілеу + қайта жарықтандыру + кино-грейд.
beauty.py SRC.mp4 OUT.mp4 SEG_MODEL "0-4.067,26.9-99" [--test t1,t2,...]"""
import sys, subprocess
import cv2, numpy as np
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

src, out, model, ranges = sys.argv[1:5]
TEST = [float(x) for x in sys.argv[6].split(",")] if len(sys.argv) > 6 else None
RANGES = [tuple(map(float, r.split("-"))) for r in ranges.split(",")]
seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
    base_options=BaseOptions(model_asset_path=model), output_category_mask=False, output_confidence_masks=True))

W, H = 1080, 1920
DESK_Y = 1250  # үстел беті шамамен
yy, xx = np.mgrid[:H, :W].astype(np.float32)

def curve(x):  # жұмсақ S-қисық, қара сәл көтерілген (кино)
    x = np.clip(x, 0, 1)
    s = x + 0.26 * x * (1 - x) * (2 * x - 1) * 2.4
    return 0.035 + 0.94 * np.clip(s, 0, 1)

def cine(f):
    """табиғи жарық сақталады: тек сәл контраст"""
    return np.clip((f - 0.5) * 1.04 + 0.5, 0, 1)

class Masks:
    def __init__(self): self.prev = None
    def __call__(self, bgr):
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        res = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        cm = [m.numpy_view().astype(np.float32) for m in res.confidence_masks]
        cm = [c if c.ndim == 2 else c[..., 0] for c in cm]
        cm = [cv2.resize(c, (W, H), interpolation=cv2.INTER_LINEAR) for c in cm]
        person = np.clip(1 - cm[0], 0, 1)
        skin = np.clip(cm[2] + cm[3], 0, 1); face = cm[3]
        cur = np.stack([person, skin, face])
        if self.prev is not None: cur = 0.55 * cur + 0.45 * self.prev   # уақыт бойынша тегістеу (дірілсіз)
        self.prev = cur
        p = cv2.GaussianBlur(cur[0], (0, 0), 6)
        s = cv2.GaussianBlur(cur[1], (0, 0), 3)
        fc = cv2.GaussianBlur(cur[2], (0, 0), 8)
        return p, s, fc

def beauty(bgr, masks):
    person, skin, face = masks
    f = bgr.astype(np.float32) / 255
    # 1) тері: жиілік бөлу — тегіс тон + нәзік текстура қалады
    low = cv2.bilateralFilter(bgr, 0, 28, 7).astype(np.float32) / 255
    low = cv2.GaussianBlur(low, (0, 0), 1.6)
    high = f - cv2.GaussianBlur(f, (0, 0), 1.2)
    smooth = low + 0.45 * high
    k = (skin * 0.75)[..., None]
    f = f * (1 - k) + smooth * k
    # 2) тері тонын тегістеу: қызарғанды сәл басу, жылы-ашық
    fk = face[..., None]
    f = f + fk * np.array([0.0, 0.012, 0.0]) * 1.0
    # 3) адамды сәл өткірлеу (тері емес — көз, шаш, киім)
    sharp = f + 0.45 * (f - cv2.GaussianBlur(f, (0, 0), 2.0))
    ks = (person * (1 - skin * 0.9))[..., None]
    f = f * (1 - ks) + sharp * ks
    return f

def in_ranges(t): return any(a <= t < b for a, b in RANGES)

cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS)
mk = Masks()
if TEST:
    outs = []
    for t in TEST:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000); ok, fr = cap.read(); mk.prev = None
        g = beauty(fr, mk(fr)) if in_ranges(t) else fr.astype(np.float32) / 255
        res = (cine(g) * 255).astype(np.uint8)
        outs.append(np.hstack([cv2.resize(fr, (540, 960)), cv2.resize(res, (540, 960))]))
    cv2.imwrite(out, np.vstack(outs) if len(outs) < 3 else np.hstack(outs)); sys.exit()

ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps),
                       "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
i = 0
while True:
    ok, fr = cap.read()
    if not ok: break
    t = i / fps
    if in_ranges(t): g = beauty(fr, mk(fr))
    else: mk.prev = None; g = fr.astype(np.float32) / 255
    ff.stdin.write((cine(g) * 255 + 0.5).astype(np.uint8).tobytes()); i += 1
    if i % 150 == 0: print(i, flush=True)
ff.stdin.close(); ff.wait(); print("beauty ok", i)
