/**
 * 第 58 批（docs/43）：任务备份打包。
 *
 * 语义与第 15 批「交付打包」（`exportPack.ts`）**完全不同** —— 这是「原样存档」：
 *   · 包内保持任务文件夹的原始目录层级与文件名（不改名、不按成品/素材/工程重排）
 *   · 一次可打包多个任务（交付打包一次一个）
 *   · 打完只标「已备份」，**绝不写 `delivery_records`、绝不碰 `pack_versions.delivered_at`**
 *     （那是给客户交付用的，备份混进去以后就分不清"这任务到底交付出去了没有"）
 *
 * 为什么独立成文件而不是塞进 `exportPack.ts`：放一起以后必然有人误调用
 * `executePackExport`（它会挂「已交付」徽标）。这里只依赖 archiver 与 db。
 *
 * 「软件管一半、人管一半」：本文件**不碰任何网盘协议**，只负责把任务打成 zip；
 * 上传网盘由用户手动完成（见 docs/43 §1.1）。
 */

import { COPY, fmt } from '../shared/copy'
import { taskCode } from '../shared/taskCode'
import { getDb } from './db'
import { isCoverFileName } from './workspace'
import { ensureAnyThumb } from './thumbs'
import { join } from 'path'
import {
  createWriteStream,
  existsSync,
  statSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'fs'
import { ZipArchive } from 'archiver'
import type { Archiver } from 'archiver'
import type { PackBackupInput, PackBackupItemResult, PackBackupResult } from '../shared/types'
// 复用交付打包踩过坑的两个工具函数（文件名清洗 / 重名去重）—— 不重写
import { sanitizeFileName, uniqueFileName } from './exportPack'

function nowIso(): string {
  return new Date().toISOString()
}

/** 备份清单里的一行 */
interface ManifestRow {
  code: string
  name: string
  project: string
  time: string
  /** 相对输出目录的文件路径：`项目名/文件名.zip`（用 / 分隔） */
  file: string
}

/**
 * 递归收集任务文件夹里的文件（原样）。
 * 过滤规则与 `workspace.ts collectFiles` **完全一致**：
 * `_` / `.` 开头的一律跳过（`_thumbs` 之类），**但封面文件 `_封面.jpg/.png` 例外**
 * —— 那是用户真放进去的文件，该进包。
 * 返回相对任务文件夹的路径（用 `/` 分隔，直接当 zip 内路径）。
 */
function collectBackupFiles(dir: string, base = '', out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if ((name.startsWith('_') || name.startsWith('.')) && !isCoverFileName(name)) continue
    const abs = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) collectBackupFiles(abs, rel, out)
    else if (st.isFile()) out.push(rel)
  }
  return out
}

/**
 * 把一个文件夹打成 zip（原样，顶层套一层任务名文件夹，解压不散落）。
 *
 * 沿用 `exportPack.ts` 那套**防空窗期崩软件**的写法：`createWriteStream` 之后**同步**
 * 挂 `error` 监听（挂晚了 = 无监听的 error = uncaughtException）。
 * 失败时清掉半成品 zip。
 */
async function zipFolder(
  folder: string,
  taskFolderName: string,
  outputPath: string,
  relFiles: string[]
): Promise<{ ok: boolean; fileCount: number; totalSize: number; error?: string }> {
  // error listener 必须紧跟 createWriteStream 同步挂上（理由见 exportPack.ts 同处注释）
  const outputStream = createWriteStream(outputPath)
  let streamError: Error | null = null
  const streamClosed = new Promise<void>((resolve) => {
    outputStream.on('close', () => resolve())
    outputStream.on('error', (err) => {
      streamError = err
      resolve()
    })
  })

  const archive: Archiver = new ZipArchive({ zlib: { level: 6 } })
  let archiveError: Error | null = null
  archive.on('error', (err: Error) => {
    archiveError = err
  })
  archive.pipe(outputStream)

  for (const rel of relFiles) {
    if (archiveError) break
    // zip 内统一用 / 分隔；顶层套任务名文件夹
    archive.file(join(folder, rel), { name: `${taskFolderName}/${rel}` })
  }

  try {
    await archive.finalize()
  } catch (e) {
    archiveError = e as Error
  }

  await streamClosed

  const failure = streamError ?? archiveError
  if (failure) {
    try {
      unlinkSync(outputPath)
    } catch {
      /* 清不掉就随它去 */
    }
    return { ok: false, fileCount: 0, totalSize: 0, error: fmt(COPY.backup.errZip, { msg: failure.message }) }
  }

  let totalSize = 0
  try {
    totalSize = statSync(outputPath).size
  } catch {
    /* ignore */
  }
  return { ok: true, fileCount: relFiles.length, totalSize }
}

/**
 * 确保任务「将来会当封面」的那张图有缩略图缓存（docs/43 §2.7）。
 *
 * 卡片封面取 `thumb_path || abs_path`，而缩略图缓存是**独立文件**（`_thumbs/*.webp`），
 * 项目一贯不删它 —— 所以只要这条 asset 的 `thumb_path` 有值且缓存文件还在，
 * 备份后原文件被删，卡片照样有图。**不必复制原图**（一份 PSD 可能上百 MB，缩略图才几百 KB）。
 *
 * 挑选规则与 `listPacks` 封面 SQL 一致（成品 > 素材 > 其它，跳过已丢失）。
 * 生成失败不阻断备份 —— 卡片显示占位图标即可。
 */
async function ensureCoverThumb(workspaceRoot: string, packId: number): Promise<void> {
  try {
    const db = getDb()
    const row = db
      .prepare(
        `SELECT id, abs_path, ext, size, modified_at, thumb_path FROM assets
          WHERE pack_id = ? AND missing_at IS NULL
            AND (thumb_path IS NOT NULL OR ext IN ('jpg','jpeg','png','webp','gif','bmp'))
          ORDER BY CASE role WHEN '成品' THEN 0 WHEN '素材' THEN 1 ELSE 2 END, id
          LIMIT 1`
      )
      .get(packId) as
      | { id: number; abs_path: string; ext: string; size: number; modified_at: string; thumb_path: string | null }
      | undefined
    if (!row) return
    if (row.thumb_path) return // 已有缓存，不用重做
    if (!existsSync(row.abs_path)) return
    const mtimeMs = new Date(row.modified_at).getTime()
    const rel = await ensureAnyThumb(workspaceRoot, row.abs_path, row.size, row.ext, mtimeMs)
    if (rel) db.prepare('UPDATE assets SET thumb_path = ? WHERE id = ?').run(rel, row.id)
  } catch {
    /* 缩略图坏掉绝不能阻断备份 */
  }
}

// ---------------------------------------------------------------- 备份清单.csv

/** CSV 单元格转义：含逗号 / 引号 / 换行时用双引号包起来，内部引号翻倍 */
function csvCell(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

/** 极简 CSV 单行解析（只支持本文件自己写出来的格式） */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/**
 * 往输出目录根上写 `备份清单.csv` —— **只增不改**，是"打过什么包"的日志。
 *
 * 为什么需要它：两个月后任务记录本身也可能没了（任务被删 / 项目解绑），
 * 那时文件名还在，但你已经不知道 `T0023` 是啥。清单不依赖软件记录，网盘里直接预览。
 * 写入 **UTF-8 带 BOM**（防 Excel 打开中文乱码）。
 * 按文件名去重（重新备份生成 `xxx (1).zip` 属不同文件名 → 照记）。
 * 清单写失败**不阻断备份** —— 主产物 zip 已经落盘。
 */
function appendManifest(outputDir: string, rows: ManifestRow[]): void {
  if (rows.length === 0) return
  const file = join(outputDir, COPY.backup.manifestName)
  const header = '标识,任务名,项目,备份时间,文件名'
  let existingBody = ''
  const seen = new Set<string>()
  if (existsSync(file)) {
    try {
      const raw = readFileSync(file, 'utf-8').replace(/^\ufeff/, '').replace(/\s+$/, '')
      const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '')
      for (const line of lines.slice(1)) {
        const cols = parseCsvLine(line)
        if (cols[4]) seen.add(cols[4])
      }
      existingBody = lines.join('\r\n')
    } catch {
      existingBody = ''
    }
  }
  const fresh: string[] = []
  for (const r of rows) {
    if (seen.has(r.file)) continue
    fresh.push([r.code, r.name, r.project, r.time, r.file].map(csvCell).join(','))
  }
  if (fresh.length === 0) return
  const body = existingBody
    ? existingBody + '\r\n' + fresh.join('\r\n') + '\r\n'
    : header + '\r\n' + fresh.join('\r\n') + '\r\n'
  try {
    writeFileSync(file, '\ufeff' + body, 'utf-8')
  } catch {
    /* 清单写失败不阻断备份 */
  }
}

// ---------------------------------------------------------------- 主流程

/**
 * 批量备份。**串行**执行（`for...of` + `await`）：同时开几个 archiver 会抢磁盘 IO，
 * 且失败面变大；一条失败继续下一条，最后汇总。
 *
 * @param input 任务 id 列表 / 输出目录 / 后缀
 * @param workspaceRoot 当前工作区根（生成封面缩略图缓存要用）
 */
export async function backupPacks(
  input: PackBackupInput,
  workspaceRoot: string
): Promise<PackBackupResult> {
  const db = getDb()
  const suffix = input.suffix || '-backup'
  const items: PackBackupItemResult[] = []
  const manifest: ManifestRow[] = []

  const pickPack = db.prepare(
    `SELECT k.id, k.name, k.folder_path, p.name AS projectName,
            (SELECT t.ticket_no FROM tickets t WHERE t.pack_id = k.id ORDER BY t.id LIMIT 1) AS ticketNo
       FROM packs k LEFT JOIN projects p ON p.id = k.project_id
      WHERE k.id = ?`
  )

  for (const packId of input.packIds) {
    const row = pickPack.get(packId) as
      | { id: number; name: string; folder_path: string; projectName: string | null; ticketNo: string | null }
      | undefined
    if (!row) {
      items.push({ packId, packName: '', ok: false, error: COPY.backup.errNoPack })
      continue
    }

    const packName = row.name
    const projectName = (row.projectName ?? '').trim() || COPY.backup.unfiled
    const code = taskCode({ id: row.id, ticketNo: row.ticketNo })

    // 1. 空任务检查（目录不在 / 一个文件都没有）→ 跳过，不阻断其它任务
    if (!existsSync(row.folder_path)) {
      items.push({ packId, packName, ok: false, error: COPY.backup.errEmpty })
      continue
    }
    const relFiles = collectBackupFiles(row.folder_path)
    if (relFiles.length === 0) {
      items.push({ packId, packName, ok: false, error: COPY.backup.errEmpty })
      continue
    }

    // 2. 输出路径：<outputDir>/<项目名>/<标识>-<任务名><后缀>.zip
    const safeProject = sanitizeFileName(projectName) || COPY.backup.unfiled
    const safeName = sanitizeFileName(`${code}-${packName}`) || code
    const dir = join(input.outputDir, safeProject)
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      items.push({ packId, packName, ok: false, error: COPY.backup.errNotWritable })
      continue
    }
    const zipName = uniqueFileName(dir, `${safeName}${suffix}.zip`)
    const outputPath = join(dir, zipName)

    // 3~5. 原样打包（顶层套任务名文件夹）
    const packed = await zipFolder(row.folder_path, packName, outputPath, relFiles)
    if (!packed.ok) {
      items.push({ packId, packName, ok: false, error: packed.error })
      continue
    }

    // 6. 成功 → 一个事务里：盖「已备份」戳 + 清掉该任务残留的丢失标记
    //    （备份前就丢的文件，整份已经存下来了，不该继续挂"丢失"）
    const ts = nowIso()
    db.transaction(() => {
      db.prepare('UPDATE packs SET backed_up_at = ?, backup_path = ? WHERE id = ?').run(ts, outputPath, packId)
      db.prepare('UPDATE assets SET missing_at = NULL, missing_ignored_at = NULL WHERE pack_id = ?').run(packId)
    })()

    // 7. 封面缩略图保障（§2.7）—— 失败不影响备份结果
    await ensureCoverThumb(workspaceRoot, packId)

    manifest.push({ code, name: packName, project: projectName, time: ts, file: `${safeProject}/${zipName}` })
    items.push({
      packId,
      packName,
      ok: true,
      outputPath,
      fileCount: packed.fileCount,
      totalSize: packed.totalSize
    })
  }

  appendManifest(input.outputDir, manifest)

  const okCount = items.filter((i) => i.ok).length
  return { items, okCount, failCount: items.length - okCount }
}
