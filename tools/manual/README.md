# 用户使用手册 · 生成工具

**产物在 `docs/manual/`（刻意不入库，是交付给用户的东西）。** 这套脚本用来重做 / 更新它。

## 脚本清单

| 脚本 | 作用 |
| --- | --- |
| `gen_assets.py` | 用 Pillow 生成演示用的「真图片」素材（招生主视觉 / 海报 / 长图 / 易拉宝 / KV…），输出到 `D:\_accept_ws\_manual_assets` |
| `make_logo.py` | 用户给的 logo JPG → 去白底（按最小通道做软过渡，保住抗锯齿边）→ 裁边 → 按"图标 / 字标"之间那条空白带拆成三份 → `docs/manual/images/` |
| `collect_shots.py` | 把场景壳拍的和既有的截图**归集**到 `docs/manual/images/`（带中文名） |
| `shoot_html.cjs` | 用 Electron 给 HTML 截图：`<输出png> <html> <宽> <高> <滚动y>` |
| `shoot_print.cjs` | 同上，但**模拟打印媒体**（用来验 A4 版式，不用翻 PDF） |
| `make_single.py` | 把 `index.html` 的图片全部 base64 内联 → 单文件便携版（可直接发人） |
| `export_pdf.cjs` | 导出 A4 打印版 PDF |

**演示视频**由项目自带的 ffmpeg 生成（不是脚本）：

```
resources/ffmpeg/ffmpeg.exe -y -loop 1 -i _video_frame.png -t 4 -r 25 \
  -vf "scale=1280:720" -c:v mpeg4 -q:v 5 "宣传片-秋季形象片.mp4"
```

## 演示数据从哪来

`_shotapp/v4/main.cjs` 里有一个 **`manual` 场景**（不在常规 13 个场景清单里，要显式指定才跑）：

```
NODE_OPTIONS= CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=20000 node _shotapp/run-verify4.cjs manual
```

它做的事：把素材铺成一个像真在用的工作区（4 个项目 / 7 个任务 / 2 稿 / 20 个素材 / 三维度标签）→ 跑一遍扫描 →
逐屏拍 15 张统一样式的截图（`D:\proj_media\shot-m-*.png`）。

> 跑之前先 `python gen_assets.py` 把素材生成好，并把 `D:\_accept_ws\shot*` 挪走（见 NEXT 第五节）。

## 坑（做手册时踩的，脚本里已绕开）

- **截图窗口必须 `show: true`**。隐藏窗口算"后台页"，JS 会被节流（`setTimeout` 降频甚至冻结）→ 页面里靠定时器算的东西永远不更新，拍到的还是初始态。
- **页面写了 `scroll-behavior: smooth` 时，程序化滚动会变成动画** → 截图前先 `document.documentElement.style.scrollBehavior = 'auto'` 再滚、再等一两帧。
- **Electron 的 `process.argv` 里带着 CLI 开关**（`--no-sandbox` 等），自定义参数**别按下标取**，用 `argv.slice(-N)`。
- **项目自带的 ffmpeg 没有 libx264**，编码要写 `-c:v mpeg4`（别写 `libx264`，会直接报 Unknown encoder）。
- 跑截图 / 导 PDF 用项目自己的 Electron：`node_modules/electron/dist/electron.exe`，并先 `unset ELECTRON_RUN_AS_NODE`。
