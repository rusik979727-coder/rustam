#!/usr/bin/env python3
"""logo.jpg (white background) -> project/assets/logo.png with alpha, cropped to content.
Alpha comes from distance to white, so antialiased edges stay soft; colour is un-premultiplied from white."""
import sys
import numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float64) / 255
dist = 1 - im.min(axis=2)                     # 0 on pure white
a = np.clip((dist - 0.04) / 0.30, 0, 1)       # jpeg noise below 4% -> transparent
rgb = np.where(a[..., None] > 0, 1 - (1 - im) / np.maximum(a[..., None], 1e-6), 1)
rgb = np.clip(rgb, 0, 1)
out = np.dstack([rgb, a])
ys, xs = np.where(a > 0.05)
out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
Image.fromarray((out * 255).round().astype(np.uint8), "RGBA").save(dst)
print("size", out.shape[1], "x", out.shape[0])
