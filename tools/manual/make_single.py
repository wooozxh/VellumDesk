# -*- coding: utf-8 -*-
"""把 docs/manual/index.html 打成**单文件便携版**：所有图片 base64 内联，双击即可打开、可直接转发。"""
import base64, os, re, sys, mimetypes
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = r"D:\proj_media\docs\manual"
SRC = os.path.join(BASE, "index.html")
DST = os.path.join(BASE, "Vellum工作台-使用手册（单文件）.html")

html = open(SRC, encoding="utf-8").read()
cache = {}


def data_uri(rel):
    if rel in cache:
        return cache[rel]
    p = os.path.join(BASE, rel.replace("/", os.sep))
    mime = mimetypes.guess_type(p)[0] or "application/octet-stream"
    with open(p, "rb") as f:
        b = base64.b64encode(f.read()).decode("ascii")
    uri = "data:%s;base64,%s" % (mime, b)
    cache[rel] = uri
    return uri


out = re.sub(r'(src|href)="(images/[^"]+)"', lambda m: '%s="%s"' % (m.group(1), data_uri(m.group(2))), html)

# 样式表也要内联 —— 样式现在在 manual.css 里（单一来源），但单文件版必须自包含
CSS = os.path.join(BASE, "manual.css")
if os.path.isfile(CSS):
    css = open(CSS, encoding="utf-8").read()
    out = out.replace('<link rel="stylesheet" href="manual.css" />', "<style>\n" + css + "</style>")
    print("样式已内联：manual.css（%d 行）" % (css.count("\n") + 1))
else:
    print("!! 找不到 manual.css —— 单文件版会丢样式")
print("仍指向外部的样式:", len(re.findall(r'href="manual\.css"', out)), "(应为 0)")

# 单文件版加一句提示（只在文件版里出现）
out = out.replace(
    "<title>Vellum工作台 · 用户使用手册</title>",
    "<title>Vellum工作台 · 用户使用手册（单文件版）</title>",
)

open(DST, "w", encoding="utf-8", newline="\n").write(out)
print("单文件版 ->", DST)
print("大小 %.1f MB（内联 %d 张图）" % (os.path.getsize(DST) / 1048576, len(cache)))
n_left = len(re.findall(r'src="images/', out))
print("仍指向外部的图片:", n_left, "(应为 0)")
