# -*- coding: utf-8 -*-
"""把用户给的 LOGO 处理成两版：完整版（封面用）+ 图标版（顶栏用）。
去白底 → 透明 PNG → 裁边 → 在「图标 / 文字」之间那条空白带切开。"""
import os, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from PIL import Image

SRC = r"C:\Users\30873\.workbuddy\clipboard-images\clipboard-2026-10-09T08-20-17-060Z-c8a49d34.jpg"
DST = r"D:\proj_media\docs\manual\images"
os.makedirs(DST, exist_ok=True)

im = Image.open(SRC).convert("RGB")
w, h = im.size
px = im.load()

# 1) 白底 → 透明（min 通道越接近 255 越透明；软过渡保住抗锯齿边）
out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
op = out.load()
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        d = 255 - min(r, g, b)
        if d <= 6:
            a = 0
        elif d >= 20:
            a = 255
        else:
            a = int((d - 6) / 14 * 255)
        op[x, y] = (r, g, b, a)

# 2) 裁掉四周全透明
bbox = out.getbbox()
full = out.crop(bbox)
full.save(os.path.join(DST, "logo.png"))
print("logo.png", full.size)

# 3) 图标 / 文字之间那条空白带：按行统计不透明像素，找下半部分第一段连续空行
W, H = bbox[2] - bbox[0], bbox[3] - bbox[1]
rows = []
for y in range(H):
    n = 0
    for x in range(0, W, 2):
        if full.getpixel((x, y))[3] > 40:
            n += 1
    rows.append(n)

best, best_len = None, 0
y = int(H * 0.35)
while y < int(H * 0.90):
    if rows[y] == 0:
        s = y
        while y < H and rows[y] == 0:
            y += 1
        if (y - s) > best_len:
            best, best_len = s, y - s
    else:
        y += 1
print("gap band: y", best, "-", best + best_len, "of", H)

if best:
    mark = full.crop((0, 0, W, best))
    # 再裁一次，去掉图标下面可能残留的空行
    mark = mark.crop(mark.getbbox())
    mark.save(os.path.join(DST, "logo-mark.png"))
    print("logo-mark.png", mark.size)

# 4) 顺手出一枚方形 favicon（顶栏/浏览器标签用）
sq = full.copy()
side = max(sq.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(sq, ((side - sq.size[0]) // 2, (side - sq.size[1]) // 2))
canvas.resize((128, 128), Image.LANCZOS).save(os.path.join(DST, "logo-128.png"))
print("logo-128.png")
