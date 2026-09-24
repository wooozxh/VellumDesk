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
const THUMB_SIZE = 320

export function isImage(ext: string): boolean {
  return IMAGE_EXTS.has(ext.replace(/^\./, '').toLowerCase())
}

export function isVideo(ext: string): boolean {
  return VIDEO_EXTS.has(ext.replace(/^\./, '').toLowerCase())
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

/** 批量生成缩略图，只处理尚无缩略图记录的行；图片走 sharp，视频走 FFmpeg 抽帧 */
export async function ensureThumbsForAssets(
  workspaceRoot: string,
  rows: Array<{ id: number; abs_path: string; size: number; ext: string; thumb_path: string | null; modified_at: string }>,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const db = getDb()
  const upd = db.prepare('UPDATE assets SET thumb_path = ? WHERE id = ?')

  const pending = rows.filter((r) => !r.thumb_path && (isImage(r.ext) || isVideo(r.ext)))
  let done = 0
  for (const r of pending) {
    try {
      const mtimeMs = new Date(r.modified_at).getTime()
      const rel = isVideo(r.ext)
        ? await ensureVideoThumb(workspaceRoot, r.abs_path, r.size, mtimeMs)
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
