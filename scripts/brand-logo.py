#!/usr/bin/env python3
"""Rebuilds every raster brand file from the owner-supplied logo image (stacked, on white).

Usage: python3 scripts/brand-logo.py path/to/kaayra-logo-original.png
Needs Pillow and numpy. Writes into public/: brand/kaayra-{horizontal,stacked,icon}-{light,dark,mono}.png,
brand/kaayra-logo-square.png (Organization.logo), favicons, apple-touch-icon.png and og-image.png.
The horizontal lockup is the supplied K mark and wordmark re-arranged side by side; no artwork is redrawn.
"""
import sys, os
import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'design/brand/kaayra-logo-original.png'
PUB = 'public'
OUT = f'{PUB}/brand'
IVORY, GREEN, PARCH = (247, 245, 239), (23, 58, 45), (247, 245, 239)

im = np.array(Image.open(SRC).convert('RGB')).astype(float)
d = 254 - im.min(axis=2)
alpha = np.clip((d - 3) / 37, 0, 1)
a = np.maximum(alpha, 1e-3)[..., None]
col = np.clip((im - (1 - a) * 254) / a, 0, 255)
col[alpha < 0.02] = 0
full = Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8), 'RGBA')

def trim(img):
    return img.crop(img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())

icon = trim(full.crop((600, 100, 1030, 555)))
word = trim(full.crop((255, 580, 1310, 770)))
herb = trim(full.crop((255, 795, 1310, 875)))
stacked = trim(full.crop((250, 100, 1310, 880)))
gap = int(word.height * 0.28)
block = Image.new('RGBA', (word.width, word.height + gap + herb.height), (0, 0, 0, 0))
block.paste(word, (0, 0)); block.paste(herb, ((word.width - herb.width) // 2, word.height + gap))
H = int(block.height / 0.70)
ic = icon.resize((int(icon.width * H / icon.height), H), Image.LANCZOS)
gx = int(H * 0.10)
hor = Image.new('RGBA', (ic.width + gx + block.width, H), (0, 0, 0, 0))
hor.paste(ic, (0, 0)); hor.paste(block, (ic.width + gx, (H - block.height) // 2))
hor = trim(hor)

def recolor(img, rgb):
    o = Image.new('RGBA', img.size, rgb + (0,)); o.putalpha(img.getchannel('A')); return o

def save(img, name, w):
    img.resize((w, round(img.height * w / img.width)), Image.LANCZOS).save(f'{OUT}/{name}.png', optimize=True)

for kind, img, w in (('horizontal', hor, 720), ('stacked', stacked, 640), ('icon', icon, 360)):
    save(img, f'kaayra-{kind}-light', w)
    save(recolor(img, IVORY), f'kaayra-{kind}-dark', w)
    save(recolor(img, GREEN), f'kaayra-{kind}-mono', w)

def on_bg(img, size, bg, frac):
    c = Image.new('RGB', size, bg); t = img.copy(); t.thumbnail((int(size[0] * frac), int(size[1] * frac)), Image.LANCZOS)
    c.paste(t, ((size[0] - t.width) // 2, (size[1] - t.height) // 2), t); return c

on_bg(stacked, (1200, 1200), (255, 255, 255), 0.82).save(f'{OUT}/kaayra-logo-square.png', optimize=True)
# Favicons and touch icon: the K mark only (the wordmark is unreadable at 16-48 px), centred with breathing room.
fav = on_bg(icon, (512, 512), (255, 255, 255), 0.84)
for n, s in (('favicon-48x48', 48), ('favicon-96x96', 96), ('favicon-192x192', 192)):
    fav.resize((s, s), Image.LANCZOS).save(f'{PUB}/{n}.png', optimize=True)
fav.resize((180, 180), Image.LANCZOS).save(f'{PUB}/apple-touch-icon.png', optimize=True)
fav.save(f'{PUB}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
# Share image 1200x630: stacked logo centred on Warm Ivory with clear space on every side.
og = Image.new('RGB', (1200, 630), PARCH); t = stacked.copy(); t.thumbnail((760, 470), Image.LANCZOS)
og.paste(t, ((1200 - t.width) // 2, (630 - t.height) // 2), t); og.save(f'{PUB}/og-image.png', optimize=True)
print('brand files written')
