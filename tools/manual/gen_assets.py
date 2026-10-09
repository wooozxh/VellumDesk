# -*- coding: utf-8 -*-
"""
给「Vellum工作台 使用手册」造一批**真实可看的演示素材**（不是文本占位）。
生成物落在 D:\\_accept_ws\\_manual_assets\\，由 _shotapp 的 manual 场景拷进演示工作区。
只写 D:\\_accept_ws 下的东西，绝不碰用户真实工作区。
"""
import os, sys, math, struct, zlib, random

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = r"D:\_accept_ws\_manual_assets"
os.makedirs(OUT, exist_ok=True)

FONTS = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]


def font(size, bold=False):
    order = ([FONTS[1], FONTS[0], FONTS[2], FONTS[3]] if bold
             else [FONTS[0], FONTS[2], FONTS[3]])
    for p in order:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def vgrad(w, h, c1, c2):
    img = Image.new("RGB", (w, h), c1)
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(c1, c2, y / max(1, h - 1)))
    return img


def dgrad(w, h, c1, c2):
    """对角渐变"""
    img = Image.new("RGB", (w, h), c1)
    px = img.load()
    for y in range(h):
        for x in range(0, w, 2):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2
            c = lerp(c1, c2, t)
            px[x, y] = c
            if x + 1 < w:
                px[x + 1, y] = c
    return img


def center(d, box, text, f, fill):
    x0, y0, x1, y1 = box
    bb = d.textbbox((0, 0), text, font=f)
    d.text((x0 + (x1 - x0 - (bb[2] - bb[0])) / 2 - bb[0],
            y0 + (y1 - y0 - (bb[3] - bb[1])) / 2 - bb[1]), text, font=f, fill=fill)


def wrap_cjk(d, text, f, maxw):
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur); cur = ""; continue
        t = cur + ch
        if d.textlength(t, font=f) > maxw and cur:
            lines.append(cur); cur = ch
        else:
            cur = t
    if cur:
        lines.append(cur)
    return lines


def poster(path, w, h, c1, c2, title, sub, tag, accent=(255, 255, 255), dark=False):
    img = dgrad(w, h, c1, c2)
    d = ImageDraw.Draw(img, "RGBA")
    # 装饰：大圆 / 斜带
    d.ellipse([w * 0.55, -h * 0.12, w * 1.45, h * 0.42], fill=accent + (26,))
    d.ellipse([-w * 0.35, h * 0.62, w * 0.5, h * 1.25], fill=accent + (20,))
    d.polygon([(0, h * 0.80), (w, h * 0.68), (w, h), (0, h)], fill=accent + (16,))
    # 顶部细线
    d.rectangle([w * 0.08, h * 0.075, w * 0.08 + 74, h * 0.075 + 7], fill=accent + (235,))

    f_tag = font(int(h * 0.026), True)
    d.text((w * 0.08, h * 0.115), tag, font=f_tag, fill=accent + (215,))

    f_title = font(int(h * 0.072), True)
    lines = wrap_cjk(d, title, f_title, w * 0.84)
    y = h * 0.30
    for ln in lines[:4]:
        d.text((w * 0.08, y), ln, font=f_title, fill=(255, 255, 255))
        y += int(h * 0.088)

    f_sub = font(int(h * 0.028))
    y += int(h * 0.02)
    for ln in wrap_cjk(d, sub, f_sub, w * 0.72)[:3]:
        d.text((w * 0.08, y), ln, font=f_sub, fill=(255, 255, 255, 230) if dark else lerp(accent, (255, 255, 255), 0.75))
        y += int(h * 0.042)

    # 底部信息条
    d.rectangle([0, h - int(h * 0.085), w, h], fill=(0, 0, 0, 70))
    center(d, (0, h - int(h * 0.085), w, h), "海南升学规划中心 · 2026 秋季", font(int(h * 0.022)), (255, 255, 255, 210))
    img.save(path, quality=92)
    return path


def kv(path, w, h, c1, c2, title, sub):
    img = dgrad(w, h, c1, c2)
    d = ImageDraw.Draw(img, "RGBA")
    for i in range(9):
        d.ellipse([w * (0.62 + i * 0.028), h * 0.12 + i * 14, w * (0.78 + i * 0.028), h * 0.36 + i * 14],
                  outline=(255, 255, 255, 26), width=2)
    d.rectangle([w * 0.09, h * 0.40, w * 0.09 + 96, h * 0.40 + 8], fill=(255, 255, 255, 230))
    d.text((w * 0.09, h * 0.46), title, font=font(int(h * 0.115), True), fill=(255, 255, 255))
    d.text((w * 0.09, h * 0.64), sub, font=font(int(h * 0.038)), fill=(214, 226, 238))
    img.save(path, quality=92)
    return path


def texture(path, w, h, base, shapes=True):
    img = vgrad(w, h, lerp(base, (255, 255, 255), 0.10), lerp(base, (0, 0, 0), 0.16))
    d = ImageDraw.Draw(img, "RGBA")
    random.seed(7)
    if shapes:
        for _ in range(26):
            x, y = random.randint(0, w), random.randint(0, h)
            r = random.randint(int(w * 0.03), int(w * 0.14))
            d.ellipse([x - r, y - r, x + r, y + r],
                      fill=(255, 255, 255, random.randint(6, 18)))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(path, quality=90)
    return path


made = []


def log(p):
    made.append(os.path.basename(p))
    print("  +", os.path.basename(p))


# ---------- 成品图（任务封面 / 文件缩略图） ----------
log(poster(os.path.join(OUT, "海报-秋季招生主视觉.png"), 1080, 1440,
           (16, 48, 96), (10, 120, 140),
           "海南升学\n2026 秋季招生", "面向内陆学子的海南升学通道 · 政策适配 / 学业衔接 / 成长托举",
           "主视觉 KV"))
log(poster(os.path.join(OUT, "海报-初三集训营.png"), 1080, 1440,
           (146, 42, 34), (232, 138, 44),
           "初三集训营\n全闭环提分", "外回考生专属 · 教学—德育—生活一体化培养",
           "招生海报"))
log(poster(os.path.join(OUT, "长图-国庆活动.png"), 1080, 1920,
           (54, 32, 116), (150, 62, 168),
           "国庆\n升学规划节", "7 天免费政策评估 · 限量 50 个名额",
           "朋友圈长图"))
log(poster(os.path.join(OUT, "折页封面-A4三折.png"), 1240, 1754,
           (12, 78, 70), (28, 148, 118),
           "升学规划\n服务手册", "落户指导 · 学籍规划 · 课程过渡",
           "三折页封面"))
log(poster(os.path.join(OUT, "易拉宝-校区门口.png"), 800, 2000,
           (150, 26, 26), (214, 90, 40),
           "海南高考\n分数优势", "同样的分数 · 不一样的录取",
           "易拉宝", accent=(255, 226, 170)))
log(kv(os.path.join(OUT, "KV-电子屏主视觉.png"), 1920, 1080,
       (10, 22, 46), (16, 82, 118),
       "海南升学规划中心", "合规 · 透明 · 可托付 —— 7 年服务 3000+ 家庭"))
log(poster(os.path.join(OUT, "海报-精英先修营.png"), 1080, 1440,
           (18, 40, 88), (60, 96, 170),
           "精英升学\n先修营", "提前一年铺路 · 把起跑线往前挪",
           "系列海报"))

# ---------- 原始素材（02-素材） ----------
log(texture(os.path.join(OUT, "底图-椰林渐变.jpg"), 1600, 1067, (30, 96, 104)))
log(texture(os.path.join(OUT, "素材-几何底纹.jpg"), 1200, 800, (62, 72, 96)))
log(texture(os.path.join(OUT, "素材-暗色渐变.jpg"), 1400, 900, (34, 38, 54), shapes=False))

log(poster(os.path.join(OUT, "海报-寒假班预告.png"), 1080, 1440,
           (28, 30, 86), (92, 54, 154),
           "寒假班\n名额预约中", "1 月开班 · 现在报名可享早鸟价",
           "预告海报"))
log(poster(os.path.join(OUT, "配图-公众号首图.png"), 900, 500,
           (14, 60, 92), (22, 128, 148),
           "海南升学 · 政策速递", "每周一篇，把升学政策讲成大白话",
           "公众号配图"))

# ---------- 视频封面帧（喂给 ffmpeg 生成 mp4） ----------
log(kv(os.path.join(OUT, "_video_frame.png"), 1280, 720,
       (8, 18, 38), (12, 66, 96),
       "海南升学 · 形象片", "15 秒 · 2026 秋季"))

print("assets written ->", OUT)
print("total:", len(made))
