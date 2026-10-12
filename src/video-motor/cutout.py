# Removes magenta fringe left by the colorkey and crops to the object's bounds.
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
px = im.load()
w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        # Magenta spill: red and blue both well above green.
        spill = min(r, b) - g
        if spill > 30:
            if a < 255 or spill > 90:
                a = max(0, a - spill * 2)
            m = min(r, b) - spill // 2
            r, b = min(r, m + 20), min(b, m + 20)
        px[x, y] = (r, g, b, a)
box = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
(im.crop(box) if box else im).save(dst)
