import { join, extname, basename } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { getDb } from './db'

/**
 * A-05：图片缩略图生成。
 * 存到工作区 `_thumbs/` 下，按「路径 + 大小 + 修改时间」的哈希命名 ——
 * 第 1 批不做内容指纹（那是第 3 批），但用同样的哈希思路保证同一文件不重复生成。
 */

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif'])
const THUMB_SIZE = 320

export function isImage(ext: string): boolean {
  return IMAGE_EXTS.has(ext.replace(/^\./, '').toLowerCase())
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

/** 批量生成缩略图，只处理尚无缩略图记录的图片 */
export async function ensureThumbsForAssets(
  workspaceRoot: string,
  rows: Array<{ id: number; abs_path: string; size: number; ext: string; thumb_path: string | null; modified_at: string }>,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const db = getDb()
  const upd = db.prepare('UPDATE assets SET thumb_path = ? WHERE id = ?')

  const pending = rows.filter((r) => !r.thumb_path && isImage(r.ext))
  let done = 0
  for (const r of pending) {
    try {
      const mtimeMs = new Date(r.modified_at).getTime()
      const rel = await ensureThumb(workspaceRoot, r.abs_path, r.size, mtimeMs)
      if (rel) {
        upd.run(rel, r.id)
        done += 1
      }
    } catch {
      // 单张失败不影响整批
    }
    onProgress?.(done, pending.length)
  }
  return done
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
