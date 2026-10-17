"""
把 `docs/更新说明-vX.Y.Z.md` 渲染成一份**独立单文件 HTML**（无外部依赖，双击就能看、能打印、能发人）。

样式沿用使用手册（`docs/manual/manual.css`）的同一套设计语言：
同一组配色变量、同一种表格与代码块观感 —— 但不需要侧边目录，单栏居中即可。

用法：python tools/make_release_notes_html.py
"""
import io
import os
import re

import base64

import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', '更新说明-v1.11.0.md')
OUT = os.path.join(ROOT, 'docs', '更新说明-v1.11.0.html')

md_text = io.open(SRC, encoding='utf-8').read()

# 标题（第一行 # xxx）单独做成 hero 区，正文里不再重复
m = re.search(r'^#\s+(.+)$', md_text, re.M)
title = m.group(1).strip() if m else '更新说明'
body_md = re.sub(r'^#\s+.+\n', '', md_text, count=1, flags=re.M)

# 顶部那段「上一版 → 本版」的引用，抽出来做副标题
sub = ''
sm = re.search(r'^>\s*上一版：(.+?)　→　本版：(.+?)$', body_md, re.M)
if sm:
    sub = f'{sm.group(1).strip()} → {sm.group(2).strip()}'
    body_md = body_md.replace(sm.group(0), '')

html_body = markdown.markdown(
    body_md, extensions=['tables', 'fenced_code', 'sane_lists', 'nl2br']
)

# 在「卡片上写的是什么」那节末尾插一张真实卡片截图（单文件 ⇒ base64 内联）
CARD = os.path.join(ROOT, 'docs', 'manual', 'images', '50-模板信息卡.png')
if os.path.exists(CARD):
    b64 = base64.b64encode(open(CARD, 'rb').read()).decode('ascii')
    fig = (
        '<figure class="shot"><img src="data:image/png;base64,' + b64 + '" alt="模板信息卡">'
        '<figcaption>模板卡的实际样子（这张图就是软件里看到的，也是发给 PS 插件的同一张）</figcaption>'
        '</figure>'
    )
    # 插在「一、模板库」这一节的末尾（即「二、卡片 / 列表双视图」之前）。
    # ⚠️ 别用正文里的短语当锚点：md 里是中文引号「」，转成 HTML 后和源码看起来一样但极易拼错（踩过）。
    idx = html_body.find('二、新增：卡片')
    if idx > 0:
        h2 = html_body.rfind('<h2>', 0, idx)
        html_body = html_body[:h2] + fig + html_body[h2:]
    else:
        html_body = fig + html_body

CSS = """
:root{
  --ink:#111827; --ink-2:#374151; --ink-3:#7b8494;
  --bg:#f7f8fa; --card:#ffffff; --line:#e5e7eb; --line-2:#d1d5db;
  --accent:#1a56db; --accent-2:#0f7b52; --accent-bg:#eef2ff;
  --warn:#a16207; --warn-bg:#fffbeb; --danger:#b91c1c; --danger-bg:#fef2f2;
  --mono:ui-monospace,Consolas,"Cascadia Mono",monospace;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font:14.5px/1.78 "PingFang SC","Microsoft YaHei","Hiragino Sans GB",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}

/* ---------- 顶部 ---------- */
.hero{
  background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#1a56db 100%);
  color:#fff; padding:44px 0 38px;
}
.wrap{max-width:880px; margin:0 auto; padding:0 28px}
.hero .tag{
  display:inline-block; font:600 11px var(--mono); letter-spacing:.14em;
  background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.24);
  padding:5px 11px; border-radius:999px; margin-bottom:16px;
}
.hero h1{margin:0 0 10px; font-size:30px; line-height:1.3; letter-spacing:-.01em; font-weight:800}
.hero .sub{font-size:14px; color:rgba(255,255,255,.78)}
.hero .sub b{color:#fff; font-weight:600}

/* 截图 */
figure.shot{margin:20px 0; text-align:center}
figure.shot img{
  width:300px; max-width:100%; border-radius:10px;
  border:1px solid var(--line); box-shadow:0 8px 26px rgba(15,23,42,.12);
}
figure.shot figcaption{font-size:12.5px; color:var(--ink-3); margin-top:9px}

/* ---------- 正文 ---------- */
main{max-width:880px; margin:0 auto; padding:34px 28px 70px}
article{
  background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:34px 40px 42px; box-shadow:0 1px 2px rgba(15,23,42,.04),0 12px 32px rgba(15,23,42,.05);
}

h2{
  font-size:19px; line-height:1.35; margin:38px 0 14px; padding:10px 0 10px 14px;
  border-left:4px solid var(--accent); background:linear-gradient(90deg,var(--accent-bg),transparent 70%);
  border-radius:0 6px 6px 0; font-weight:800;
}
h2:first-of-type{margin-top:4px}
h3{font-size:15.5px; margin:26px 0 10px; font-weight:700; color:var(--ink)}
p{margin:10px 0}
ul,ol{margin:10px 0; padding-left:22px}
li{margin:5px 0}
strong{font-weight:700}
a{color:var(--accent); text-decoration:none; border-bottom:1px solid rgba(26,86,219,.3)}
a:hover{border-bottom-color:var(--accent)}

blockquote{
  margin:14px 0; padding:12px 16px; background:var(--accent-bg);
  border-left:3px solid var(--accent); border-radius:0 8px 8px 0; color:var(--ink-2);
}
blockquote p{margin:4px 0}

code{
  font:12.8px/1.5 var(--mono); background:#f2f4f7; border:1px solid var(--line);
  padding:1px 5px; border-radius:4px; color:#b42318;
}
pre{
  background:#0f172a; color:#e2e8f0; padding:16px 18px; border-radius:10px;
  overflow:auto; margin:14px 0; font:12.8px/1.7 var(--mono);
}
pre code{background:none; border:0; padding:0; color:inherit; font-size:12.8px}

table{
  width:100%; border-collapse:separate; border-spacing:0; margin:16px 0;
  border:1px solid var(--line); border-radius:10px; overflow:hidden; font-size:13.6px;
}
thead th{
  background:#f3f5f9; text-align:left; font-weight:700; color:var(--ink-2);
  padding:10px 13px; border-bottom:1px solid var(--line); white-space:nowrap;
}
tbody td{padding:9px 13px; border-bottom:1px solid #f0f2f6; vertical-align:top}
tbody tr:last-child td{border-bottom:0}
tbody tr:nth-child(even){background:#fafbfd}

hr{border:0; border-top:1px solid var(--line); margin:34px 0}
footer{max-width:880px; margin:0 auto; padding:0 28px 40px; color:var(--ink-3); font-size:12.5px; text-align:center}

@media print{
  body{background:#fff}
  .hero{background:#0f172a !important; -webkit-print-color-adjust:exact; print-color-adjust:exact}
  article{box-shadow:none; border:0; padding:0}
  main{padding-top:18px}
  h2{break-after:avoid}
  table,pre,blockquote{break-inside:avoid}
}
"""

html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>{CSS}</style>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <span class="tag">RELEASE NOTES</span>
    <h1>{title}</h1>
    <div class="sub">{sub}</div>
  </div>
</header>
<main>
  <article>
{html_body}
  </article>
</main>
<footer>Vellum工作台 · 更新说明 · 内部使用</footer>
</body>
</html>
"""

io.open(OUT, 'w', encoding='utf-8', newline='\n').write(html)
print('written:', OUT, f'{os.path.getsize(OUT)//1024} KB')
