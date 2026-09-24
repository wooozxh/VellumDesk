# FFmpeg（随软件打包，B-02）

此目录在打包分发时随应用一起带上（electron-builder `extraResources`，见 package.json）。

## 内容

- `ffmpeg.exe` — 视频抽帧（生成缩略图）
- `ffprobe.exe` — 读取视频时长 / 编码 / 分辨率 / 帧率
- `LICENSE.txt` — LGPL 许可证文本（分发时必须随附）

两个 exe 均来自 **BtbN FFmpeg Builds 的 win64-lgpl 静态版**（无外部 DLL 依赖）：

```
https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-lgpl.zip
```

## 重建方式

zip 下载解压后，从 `bin/` 里拷出 `ffmpeg.exe` 与 `ffprobe.exe` 放到本目录，并从 zip 根目录拷 `LICENSE.txt`。

**选 LGPL 版的原因**：x264 编码器是 GPL 的，LGPL 版不含；但 H.264/H.265 等**解码器**不受影响——读用户视频的信息、抽帧都正常。本目录的构建含 `libopenh264`（BSD 许可的 H.264 编码器），可用于生成测试视频。

**注意**：exe 不入 git（体积 267 MB），`.gitignore` 已排除；新环境 clone 后按上面方式重建，或直接整目录拷贝。
