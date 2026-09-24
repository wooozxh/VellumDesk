import { join, extname, basename } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { getDb } from './db'

/**
 * A-05：图片缩略图生成。
 * 存到工作区 `_thumbs/` 下，按「路径 + 大小 + 修改时间」的哈希命名 ——
 * 第 1 批不做内容指纹（那是第 3 批），但用同样的哈希思路保证同一文件不重复生成。
 * B-02（第 2 批）：视频走 FFmpeg 抽帧，图片走 sharp。FFmpeg 随软件打包（LGPL 版）。
 */

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif'])
const VIDEO_EXTS = new Set([
  'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', 'ts', '3gp'
])
// PSD / PSB（大型文档格式）：不解析图层，读文件头元信息 + 内嵌合成预览图
const PSD_EXTS = new Set(['psd', 'psb'])
// PDF：pdfjs-dist 渲染第 1 页做缩略图（Apache-2.0，无许可风险）
const PDF_EXTS = new Set(['pdf'])
const THUMB_SIZE = 320

export function isImage(ext: string): boolean {
  return IMAGE_EXTS.has(ext.replace(/^\./, '').toLowerCase())
}

export function isVideo(ext: string): boolean {
  return VIDEO_EXTS.has(ext.replace(/^\./, '').toLowerCase())
}

export function isPsd(ext: string): boolean {
  return PSD_EXTS.has(ext.replace(/^\./, '').toLowerCase())
}

export function isPdf(ext: string): boolean {
  return PDF_EXTS.has(ext.replace(/^\./, '').toLowerCase())
}

// ---------------------------------------------------------------- FFmpeg 定位（随软件打包）

/**
 * FFmpeg 所在目录。两级来源：
 * 1. 环境变量 MEDIA_FFMPEG_DIR（测试壳 / 特殊部署用）
 * 2. index.ts / accept.ts 启动时 setFfmpegDir() 显式注入（正式应用主路径）
 */
let ffmpegDir = process.env.MEDIA_FFMPEG_DIR || ''

/**
 * 注入 FFmpeg 所在目录（含 ffmpeg.exe / ffprobe.exe）。
 * 由 index.ts / accept.ts 在启动时调用 —— 本文件保持不依赖 electron。
 */
export function setFfmpegDir(dir: string): void {
  ffmpegDir = dir
}

function ffmpegExe(): string {
  return join(ffmpegDir, 'ffmpeg.exe')
}

function ffprobeExe(): string {
  return join(ffmpegDir, 'ffprobe.exe')
}

export function ffmpegReady(): boolean {
  return ffmpegDir !== '' && existsSync(ffmpegExe()) && existsSync(ffprobeExe())
}

/** 跑一个外部命令，收集 stdout；超时杀掉，绝不挂死主进程 */
function runCmd(
  exe: string,
  args: string[],
  timeoutMs = 20000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let done = false
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(exe, args, { windowsHide: true })
    } catch {
      resolve({ code: -1, stdout: '', stderr: 'spawn failed' })
      return
    }
    const timer = setTimeout(() => {
      if (!done && child) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* 已退出就算了 */
        }
      }
    }, timeoutMs)
    const finish = (code: number) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }
    child.stdout?.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr?.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', () => finish(-1))
    child.on('close', (code) => finish(code ?? -1))
  })
}

function thumbKey(absPath: string, size: number, mtimeMs: number): string {
  return createHash('sha1')
    .update(`${absPath}|${size}|${Math.floor(mtimeMs)}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * 生成（或复用）缩略图。返回相对工作区根目录的路径，可直接拼给渲染进程。
 * 失败一律返回 null —— 缩略图坏掉绝不能阻断入库。
 */
export async function ensureThumb(
  workspaceRoot: string,
  absPath: string,
  size: number,
  mtimeMs: number
): Promise<string | null> {
  const ext = extname(absPath).replace(/^\./, '').toLowerCase()
  if (!isImage(ext)) return null

  const thumbsDir = join(workspaceRoot, '_thumbs')
  mkdirSync(thumbsDir, { recursive: true })

  const key = thumbKey(absPath, size, mtimeMs)
  const fileName = `${key}.webp`
  const full = join(thumbsDir, fileName)

  if (existsSync(full)) return join('_thumbs', fileName)

  try {
    // sharp 是原生模块，动态载入避免影响启动
    const sharp = (await import('sharp')).default
    await sharp(absPath, { failOn: 'none' })
      .rotate() // 尊重 EXIF 方向
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(full)
    return join('_thumbs', fileName)
  } catch {
    return null
  }
}

/** 批量生成缩略图；图片走 sharp，视频走 FFmpeg 抽帧，PSD 走内嵌预览图，PDF 走 pdfjs 渲染 */
export async function ensureThumbsForAssets(
  workspaceRoot: string,
  rows: Array<{ id: number; abs_path: string; size: number; ext: string; thumb_path: string | null; modified_at: string }>,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const db = getDb()
  const upd = db.prepare('UPDATE assets SET thumb_path = ? WHERE id = ?')

  const pending = rows.filter(
    (r) =>
      !r.thumb_path &&
      (isImage(r.ext) || isVideo(r.ext) || isPsd(r.ext) || isPdf(r.ext))
  )
  let done = 0
  for (const r of pending) {
    try {
      const mtimeMs = new Date(r.modified_at).getTime()
      const rel = isVideo(r.ext)
        ? await ensureVideoThumb(workspaceRoot, r.abs_path, r.size, mtimeMs)
        : isPsd(r.ext)
          ? await ensurePsdThumb(workspaceRoot, r.abs_path, r.size, mtimeMs)
          : isPdf(r.ext)
            ? await ensurePdfThumb(workspaceRoot, r.abs_path, r.size, mtimeMs)
            : await ensureThumb(workspaceRoot, r.abs_path, r.size, mtimeMs)
      if (rel) {
        upd.run(rel, r.id)
        done += 1
      }
    } catch {
      // 单个失败不影响整批
    }
    onProgress?.(done, pending.length)
  }
  return done
}

// ---------------------------------------------------------------- B-01 图片尺寸与色彩模式

export interface ImageMeta {
  width: number | null
  height: number | null
  colorMode: string | null
}

/** sharp 的 space → 中文可读色彩模式 */
function readableColorMode(space: string | undefined, channels: number | undefined): string | null {
  if (!space) return null
  const s = space.toLowerCase()
  if (s.includes('cmyk')) return 'CMYK'
  if (s.includes('srgb')) return channels === 4 ? 'RGBA' : 'RGB'
  if (s.includes('rgb')) return channels === 4 ? 'RGBA' : 'RGB'
  if (s.includes('b-w') || s.includes('bw') || s.includes('grey') || s.includes('gray')) return '灰度'
  if (s.includes('scrgb')) return 'RGB'
  if (s.includes('lab')) return 'Lab'
  if (s.includes('cmyk')) return 'CMYK'
  return space
}

/**
 * B-01：读图片的尺寸与色彩模式。
 * 失败返回全 null —— 绝不阻断入库。
 */
export async function readImageMeta(absPath: string): Promise<ImageMeta> {
  const empty: ImageMeta = { width: null, height: null, colorMode: null }
  try {
    const sharp = (await import('sharp')).default
    const m = await sharp(absPath, { failOn: 'none' }).metadata()
    return {
      width: m.width ?? null,
      height: m.height ?? null,
      colorMode: readableColorMode(m.space, m.channels)
    }
  } catch {
    return empty
  }
}

/** 批量补图片元信息（只处理缺 width 的图片行） */
export async function ensureImageMetaForAssets(
  rows: Array<{ id: number; abs_path: string; ext: string; width: number | null }>
): Promise<number> {
  const db = getDb()
  const upd = db.prepare('UPDATE assets SET width = ?, height = ?, color_mode = ? WHERE id = ?')

  const pending = rows.filter((r) => r.width === null && isImage(r.ext))
  let done = 0
  for (const r of pending) {
    const meta = await readImageMeta(r.abs_path)
    if (meta.width !== null || meta.height !== null) {
      upd.run(meta.width, meta.height, meta.colorMode, r.id)
      done += 1
    }
  }
  return done
}

/**
 * 便捷入口：直接把库里所有还没补元信息的图片补一遍。
 * 启动时调一次，保证界面上就有尺寸 —— 不必等用户手动点「刷新扫描」。
 */
export async function enrichAllImageMeta(): Promise<number> {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, abs_path, ext, width FROM assets')
    .all() as Array<{ id: number; abs_path: string; ext: string; width: number | null }>
  return ensureImageMetaForAssets(rows)
}

// ---------------------------------------------------------------- B-02 视频探测（ffprobe）

export interface VideoMeta {
  width: number | null
  height: number | null
  durationMs: number | null
  videoCodec: string | null
  probeInfo: string | null // 精简 JSON：fps / 音频编码 / 总码率
}

/** ffprobe 输出的 JSON 形状（只取用到的字段） */
interface ProbeJson {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    avg_frame_rate?: string
  }>
  format?: { duration?: string; bit_rate?: string }
}

function parseFps(rate: string | undefined): string | null {
  if (!rate) return null
  const m = rate.match(/^(\d+)\/(\d+)$/)
  if (!m) return null
  const den = Number(m[2])
  if (!den) return null
  const fps = Number(m[1]) / den
  if (!Number.isFinite(fps) || fps <= 0) return null
  return fps.toFixed(fps >= 100 ? 0 : 2).replace(/\.?0+$/, '')
}

/**
 * B-02：ffprobe 读视频信息。失败返回全 null —— 绝不阻断入库。
 */
export async function readVideoMeta(absPath: string): Promise<VideoMeta> {
  const empty: VideoMeta = {
    width: null,
    height: null,
    durationMs: null,
    videoCodec: null,
    probeInfo: null
  }
  if (!ffmpegReady()) return empty

  const { code, stdout } = await runCmd(
    ffprobeExe(),
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', absPath],
    15000
  )
  if (code !== 0 || !stdout.trim()) return empty

  try {
    const j = JSON.parse(stdout) as ProbeJson
    const v = j.streams?.find((s) => s.codec_type === 'video')
    const a = j.streams?.find((s) => s.codec_type === 'audio')
    const durSec = j.format?.duration ? Number(j.format.duration) : NaN

    const probeInfo: Record<string, string> = {}
    const fps = parseFps(v?.avg_frame_rate)
    if (fps) probeInfo.fps = fps
    if (a?.codec_name) probeInfo.acodec = a.codec_name
    if (j.format?.bit_rate) probeInfo.bitrate = j.format.bit_rate

    return {
      width: v?.width ?? null,
      height: v?.height ?? null,
      durationMs: Number.isFinite(durSec) ? Math.round(durSec * 1000) : null,
      videoCodec: v?.codec_name ?? null,
      probeInfo: Object.keys(probeInfo).length ? JSON.stringify(probeInfo) : null
    }
  } catch {
    return empty
  }
}

/** 批量补视频元信息（只处理缺 duration_ms 的视频行） */
export async function ensureVideoMetaForAssets(
  rows: Array<{
    id: number
    abs_path: string
    ext: string
    duration_ms: number | null
  }>
): Promise<number> {
  const db = getDb()
  const upd = db.prepare(
    'UPDATE assets SET width = ?, height = ?, duration_ms = ?, video_codec = ?, probe_info = ? WHERE id = ?'
  )

  if (!ffmpegReady()) return 0
  const pending = rows.filter((r) => r.duration_ms === null && isVideo(r.ext))
  let done = 0
  for (const r of pending) {
    const meta = await readVideoMeta(r.abs_path)
    if (meta.durationMs !== null || meta.width !== null) {
      upd.run(meta.width, meta.height, meta.durationMs, meta.videoCodec, meta.probeInfo, r.id)
      done += 1
    }
  }
  return done
}

/**
 * 便捷入口：把库里所有还没补元信息的视频补一遍（启动时调）。
 */
export async function enrichAllVideoMeta(): Promise<number> {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, abs_path, ext, duration_ms FROM assets')
    .all() as Array<{ id: number; abs_path: string; ext: string; duration_ms: number | null }>
  return ensureVideoMetaForAssets(rows)
}

// ---------------------------------------------------------------- B-04 PSD（内嵌预览图 + 文件头元信息）

/**
 * PSD 规范（Adobe Photoshop File Formats Specification）：
 * - 文件头 26 字节：签名 8BPS、版本（1=PSD 2=PSB）、…、行数=高(14)、列数=宽(18)、位深(22)、色彩模式(24)
 * - 头后是「颜色模式数据段」（4 字节长度 + 数据）→「图像资源段」（4 字节长度 + N 个 8BIM 块）
 * - 资源块：签名 8BIM(4) + id(2) + 名称（1 字节长度 + Pascal 串 + 补齐偶数）+ 数据长度(4) + 数据（补齐偶数）
 * - id 1036 = 合成缩略图（PS4+，新）；id 1033 = 老版缩略图。数据前 28 字节是缩略图头，
 *   其后是标准 JPEG（Photoshop 保存时自动生成的合成预览，CMYK 文档里也是转好的 RGB JPEG）
 */

/** PSD 文件头色彩模式代码 → 可读文本 */
function psdColorMode(code: number): string | null {
  switch (code) {
    case 0: return '位图'
    case 1: return '灰度'
    case 2: return '索引'
    case 3: return 'RGB'
    case 4: return 'CMYK'
    case 7: return '多通道'
    case 8: return '双色调'
    case 9: return 'Lab'
    default: return null
  }
}

export interface PsdMeta {
  width: number | null
  height: number | null
  colorMode: string | null
}

/**
 * B-04：读 PSD 文件头（只读 26 字节），拿画布尺寸与色彩模式。
 * 头部布局：签名(4) 版本(2) 保留(6) 通道(2) 高(4) 宽(4) 位深(2) 色彩模式(2)。
 * 带合理性校验（版本/通道/位深/尺寸），文本冒充的假文件直接拒。
 * 失败返回全 null —— 绝不阻断入库。
 */
export async function readPsdMeta(absPath: string): Promise<PsdMeta> {
  const empty: PsdMeta = { width: null, height: null, colorMode: null }
  try {
    const fs = await import('fs')
    const head = Buffer.alloc(26)
    const fd = fs.openSync(absPath, 'r')
    try {
      fs.readSync(fd, head, 0, 26, 0)
    } finally {
      fs.closeSync(fd)
    }
    if (head.slice(0, 4).toString('ascii') !== '8BPS') return empty
    const version = head.readUInt16BE(4)
    if (version !== 1 && version !== 2) return empty
    const channels = head.readUInt16BE(12)
    const height = head.readUInt32BE(14)
    const width = head.readUInt32BE(18)
    const depth = head.readUInt16BE(22)
    const mode = head.readUInt16BE(24)
    // 合理性：通道 1-56；位深 1/8/16/32；尺寸 1-300000（PSB 上限 30 万像素）
    if (channels < 1 || channels > 56) return empty
    if (depth !== 1 && depth !== 8 && depth !== 16 && depth !== 32) return empty
    if (width < 1 || width > 300000 || height < 1 || height > 300000) return empty
    return {
      width,
      height,
      colorMode: psdColorMode(mode)
    }
  } catch {
    return empty
  }
}

/**
 * B-04：从图像资源段提取内嵌合成预览 JPG。
 * 优先 id 1036（新），回退 1033（老）。失败返回 null —— 绝不阻断入库。
 */
export async function extractPsdPreviewJpg(absPath: string): Promise<Buffer | null> {
  try {
    const fs = await import('fs')
    const fd = fs.openSync(absPath, 'r')
    const readAt = (buf: Buffer, pos: number): number => fs.readSync(fd, buf, 0, buf.length, pos)

    try {
      // 头 26 字节 + 校验签名
      const head = Buffer.alloc(26)
      readAt(head, 0)
      if (head.slice(0, 4).toString('ascii') !== '8BPS') return null

      // 颜色模式数据段
      const lenBuf = Buffer.alloc(4)
      readAt(lenBuf, 26)
      let off = 30 + lenBuf.readUInt32BE(0)

      // 图像资源段
      readAt(lenBuf, off)
      const irLen = lenBuf.readUInt32BE(0)
      off += 4
      const end = off + irLen

      let preview1036: Buffer | null = null
      let preview1033: Buffer | null = null

      while (off + 12 <= end) {
        const sig = Buffer.alloc(4)
        readAt(sig, off)
        if (sig.toString('ascii') !== '8BIM') break

        const idHead = Buffer.alloc(2)
        readAt(idHead, off + 4)
        const id = idHead.readUInt16BE(0)

        const nameLenBuf = Buffer.alloc(1)
        readAt(nameLenBuf, off + 6)
        // 名称字段：1 字节长度 + 内容 + 补齐到偶数（长度字段本身算 1 字节，PS 规范里存储长度= nlen+1 再补偶）
        const nameFieldLen = 1 + nameLenBuf[0] + ((1 + nameLenBuf[0]) % 2)

        const szBuf = Buffer.alloc(4)
        readAt(szBuf, off + 6 + nameFieldLen)
        const dsize = szBuf.readUInt32BE(0)
        const dataOff = off + 6 + nameFieldLen + 4

        if (dsize > 28 && (id === 1036 || id === 1033)) {
          const data = Buffer.alloc(Math.min(dsize, end - dataOff))
          readAt(data, dataOff)
          // 缩略图头 28 字节后应紧跟 JPEG。注意：实测 PS 写的 compression 字段并不总是 1，
          // 不可信 —— 只认数据区的 JPEG 签名（ffd8ff），签名不对就放弃该块
          if (data.slice(28, 31).toString('hex') === 'ffd8ff') {
            const jpg = data.slice(28)
            // 以 JPEG 结束标记截断，防止尾部脏数据
            const eoi = jpg.lastIndexOf(Buffer.from([0xff, 0xd9]))
            const clean = eoi > 0 ? jpg.slice(0, eoi + 2) : jpg
            if (id === 1036) preview1036 = clean
            else preview1033 = clean
          }
        }

        off = dataOff + dsize + (dsize % 2)
        if (preview1036) break // 拿到新版就够了
      }

      return preview1036 ?? preview1033
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

/**
 * B-04：PSD 缩略图 = 内嵌预览 JPG → sharp 转 320 宽 webp。
 * 预览图很小（典型 160px 级），withoutEnlargement 保证不放大糊化。
 */
async function ensurePsdThumb(
  workspaceRoot: string,
  absPath: string,
  size: number,
  mtimeMs: number
): Promise<string | null> {
  const thumbsDir = join(workspaceRoot, '_thumbs')
  mkdirSync(thumbsDir, { recursive: true })

  const key = thumbKey(absPath, size, mtimeMs)
  const fileName = `${key}.webp`
  const full = join(thumbsDir, fileName)

  if (existsSync(full)) return join('_thumbs', fileName)

  try {
    const jpg = await extractPsdPreviewJpg(absPath)
    if (!jpg) return null
    const sharp = (await import('sharp')).default
    await sharp(jpg)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(full)
    return join('_thumbs', fileName)
  } catch {
    return null
  }
}

/** 批量补 PSD 元信息（只处理缺 width 的 psd/psb 行） */
export async function ensurePsdMetaForAssets(
  rows: Array<{ id: number; abs_path: string; ext: string; width: number | null }>
): Promise<number> {
  const db = getDb()
  const upd = db.prepare('UPDATE assets SET width = ?, height = ?, color_mode = ? WHERE id = ?')

  const pending = rows.filter((r) => r.width === null && isPsd(r.ext))
  let done = 0
  for (const r of pending) {
    const meta = await readPsdMeta(r.abs_path)
    if (meta.width !== null || meta.height !== null) {
      upd.run(meta.width, meta.height, meta.colorMode, r.id)
      done += 1
    }
  }
  return done
}

/**
 * 便捷入口：把库里所有还没补元信息的 PSD 补一遍（启动时调）。
 */
export async function enrichAllPsdMeta(): Promise<number> {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, abs_path, ext, width FROM assets')
    .all() as Array<{ id: number; abs_path: string; ext: string; width: number | null }>
  return ensurePsdMetaForAssets(rows)
}

// ---------------------------------------------------------------- B-03 PDF（pdfjs 渲染首页 + 页数）

/**
 * PDF 缩略图：pdfjs-dist（Apache-2.0）渲染第 1 页 → @napi-rs/canvas（MIT）画布 → sharp 转 webp。
 * 选型说明：首选的 mupdf 是 AGPL-3.0（强传染，分发需开源或买商业授权），换 pdfjs。
 * 页数存进 probe_info（JSON {"pages":N}）；页面尺寸是 pt 单位，不写 width/height 以免误导。
 * 失败返回 null —— 绝不阻断入库。
 */
async function ensurePdfThumb(
  workspaceRoot: string,
  absPath: string,
  size: number,
  mtimeMs: number
): Promise<string | null> {
  const thumbsDir = join(workspaceRoot, '_thumbs')
  mkdirSync(thumbsDir, { recursive: true })

  const key = thumbKey(absPath, size, mtimeMs)
  const fileName = `${key}.webp`
  const full = join(thumbsDir, fileName)

  if (existsSync(full)) return join('_thumbs', fileName)

  try {
    const png = await renderPdfFirstPage(absPath, THUMB_SIZE)
    if (!png) return null
    const sharp = (await import('sharp')).default
    await sharp(png)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(full)
    return join('_thumbs', fileName)
  } catch {
    return null
  }
}

/** 渲染 PDF 第 1 页为 PNG Buffer（宽约 targetW，画布最长边封顶 1600 防超大页） */
async function renderPdfFirstPage(absPath: string, targetW: number): Promise<Buffer | null> {
  const fs = await import('fs')
  const data = new Uint8Array(fs.readFileSync(absPath))
  // legacy build：Node 环境无 DOM，用同步 fake worker 渲染
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true
  })

  try {
    const doc = await loadingTask.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(targetW / base.width, 1600 / Math.max(base.width, base.height))
    const vp = page.getViewport({ scale })
    const { createCanvas } = await import('@napi-rs/canvas')
    const canvas = createCanvas(Math.max(1, Math.ceil(vp.width)), Math.max(1, Math.ceil(vp.height)))
    const ctx = canvas.getContext('2d')
    // 白底：透明页在深色界面里会看不清
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // @napi-rs/canvas 的类型与 DOM Canvas 不完全一致（结构兼容，渲染够用），断言绕过
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: vp
    }).promise
    return canvas.toBuffer('image/png')
  } finally {
    try {
      void loadingTask.destroy()
    } catch {
      /* 已销毁就算了 */
    }
  }
}

/** 批量补 PDF 页数（probe_info = {"pages":N}，只处理还没有 probe_info 的 pdf 行） */
export async function ensurePdfMetaForAssets(
  rows: Array<{ id: number; abs_path: string; ext: string; probe_info: string | null }>
): Promise<number> {
  const db = getDb()
  const upd = db.prepare('UPDATE assets SET probe_info = ? WHERE id = ?')

  const pending = rows.filter((r) => r.probe_info === null && isPdf(r.ext))
  let done = 0
  for (const r of pending) {
    try {
      const fs = await import('fs')
      const data = new Uint8Array(fs.readFileSync(r.abs_path))
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const loadingTask = pdfjs.getDocument({
        data,
        useSystemFonts: false,
        disableFontFace: true
      })
      let pages = 0
      try {
        const doc = await loadingTask.promise
        pages = doc.numPages
      } finally {
        try {
          void loadingTask.destroy()
        } catch {
          /* 忽略 */
        }
      }
      if (pages > 0) {
        upd.run(JSON.stringify({ pages }), r.id)
        done += 1
      }
    } catch {
      // 单个失败不影响整批
    }
  }
  return done
}

/**
 * 便捷入口：把库里所有还没补页数的 PDF 补一遍（启动时调）。
 */
export async function enrichAllPdfMeta(): Promise<number> {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, abs_path, ext, probe_info FROM assets')
    .all() as Array<{ id: number; abs_path: string; ext: string; probe_info: string | null }>
  return ensurePdfMetaForAssets(rows)
}

// ---------------------------------------------------------------- B-02 视频缩略图（ffmpeg 抽帧）

/**
 * 视频抽帧做缩略图：-ss 1 秒处抓一帧，缩到 320 宽。
 * 太短的视频（<1s）第一遍抓不到帧，自动回退 -ss 0 重试一次。
 * 失败返回 null —— 绝不阻断入库。
 */
async function ensureVideoThumb(
  workspaceRoot: string,
  absPath: string,
  size: number,
  mtimeMs: number
): Promise<string | null> {
  if (!ffmpegReady()) return null

  const thumbsDir = join(workspaceRoot, '_thumbs')
  mkdirSync(thumbsDir, { recursive: true })

  const key = thumbKey(absPath, size, mtimeMs)
  const fileName = `${key}.jpg`
  const full = join(thumbsDir, fileName)

  if (existsSync(full)) return join('_thumbs', fileName)

  const vf = `scale='min(${THUMB_SIZE},iw)':-2`
  const attempt = async (seek: string): Promise<boolean> => {
    const { code } = await runCmd(
      ffmpegExe(),
      ['-ss', seek, '-i', absPath, '-vframes', '1', '-vf', vf, '-y', full],
      25000
    )
    return code === 0 && existsSync(full)
  }

  try {
    if (!(await attempt('1'))) {
      // 回退：从 0 秒抓
      if (existsSync(full)) {
        try {
          await import('fs').then((fs) => fs.unlinkSync(full))
        } catch {
          /* 删不掉也无妨，会被覆盖 */
        }
      }
      if (!(await attempt('0'))) return null
    }
    return join('_thumbs', fileName)
  } catch {
    return null
  }
}

/** 给渲染进程用的：读一张图片为 dataURL（用于包卡片封面，避免自定义协议） */
export function readAsDataUrl(absPath: string): string | null {
  try {
    if (!existsSync(absPath)) return null
    const ext = extname(absPath).replace(/^\./, '').toLowerCase()
    const mime =
      ext === 'png'
        ? 'image/png'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'svg'
              ? 'image/svg+xml'
              : 'image/jpeg'
    const buf = readFileSync(absPath)
    if (buf.length > 8 * 1024 * 1024) return null // 太大就不塞进界面
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

export { basename }
