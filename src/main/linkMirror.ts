/**
 * 第 62 批（docs/45）：插件联动（一）—— **生成并写镜像**。
 *
 * 把软件里的「任务库」导出成一份**只读镜像**（`manifest.json` + `task.json` + `thumb\t<id>.png|jpg`），
 * 写进 PS 插件的 `PluginData\library\`。契约 `vellum-link/1`，唯一权威源 `D:\vellum-link\LINK-CONTRACT.md`。
 *
 * 设计约束（照 `thumbs.ts` 的路数）：**本文件不依赖 electron** —— appData 根目录由调用方传入，
 * 于是 `accept.ts` 能用「假插件目录」桩直接跑（契约 §十一 要求的自测桩），不必装 PS。
 *
 * 核心取舍（docs/45，用户 2026-10-10 拍板）：
 * · 缩略图：只**读** `_thumbs\*.webp` → **转码成 png**（保透明）；视频的 `.jpg` 原样拷。**不动 `_thumbs` 本身**。
 * · 命名空间：任务库 `t<id>.png`（契约加法 ②，防与通用库 `b<id>` 撞名）。
 * · `revision` 单调递增；用**内容签名短路** —— 内容没变就**整文件不重写**（省 IO，插件也不抖动）。
 * · 所有 JSON **原子写**（先写 `.tmp` 再 `rename`）—— 插件每 3 秒 stat 一次，绝不能读到半个文件。
 */
import { join, extname } from 'path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  statSync
} from 'fs'
import { createHash } from 'crypto'
import { getDb, getMeta, setMeta } from './db'
import { isImage, isVideo, isPsd, isPdf, ensureAnyThumb } from './thumbs'

// ---------------------------------------------------------------- 契约常量（两侧代码里都应是常量）
export const CONTRACT_VERSION = 'vellum-link/1'
export const PLUGIN_ID = 'com.vellum.toolbox'
export const MIRROR_DIR = 'library'
export const MANIFEST_FILE = 'manifest.json'
export const TASK_FILE = 'task.json'
export const THUMB_DIR = 'thumb'
export const HANDOFF_DIR = 'handoff'
export const LAYOUT_VERSION = '3'

// meta 键（照 report.ts / tickets.ts 的路数集中定义）
const META_REV = 'plugin_rev_task'
const META_SIG = 'plugin_sig_task'

/** 图片/PSD/PDF 的镜像缩略图统一落 png，视频落 jpg（契约 §5.5：只允许 png / jpg） */
const PNG_EXTS = new Set(['png'])

// ---------------------------------------------------------------- 工具

/** ISO 8601 带本地时区偏移（如 `2026-10-10T23:20:00+08:00`）—— 契约 §五 要求 */
export function isoLocal(d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(offMin) / 60))
  const om = pad(Math.abs(offMin) % 60)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
  )
}

/** 原子写 JSON：先写 `.tmp` 再 `rename` 覆盖（Windows 上 rename 会替换已存在文件） */
function atomicWriteJson(file: string, obj: unknown): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8')
  renameSync(tmp, file)
}

/** 契约里的 `kind`：软件侧归好类，插件不猜 */
function kindOf(ext: string): string {
  if (isVideo(ext)) return 'video'
  if (isPsd(ext)) return 'psd'
  if (isPdf(ext)) return 'pdf'
  if (isImage(ext)) return 'image'
  return 'other'
}

/** 缩略图在镜像里的文件名（命名空间 + id）：`t12.png` / `t12.jpg` */
function mirrorThumbName(id: number, srcExt: string): string {
  const e = srcExt.replace(/^\./, '').toLowerCase()
  const out = e === 'jpg' || e === 'jpeg' ? 'jpg' : 'png'
  return `t${id}.${out}`
}

// ---------------------------------------------------------------- 路径发现（契约 §七）

export interface MirrorTarget {
  psMajor: string
  pluginDataDir: string
}

/**
 * 在给定 appData 根下发现所有插件的 PluginData 目录（契约 §7.1：**命中多个全部返回**，由调用方全写）。
 * `base = <appData>\Adobe\UXP\PluginsStorage\PHSP\<数字版本>\{Developer,External,Plugins}\<PLUGIN_ID>\PluginData`
 */
export function discoverPluginDataDirs(appDataDir: string): MirrorTarget[] {
  const base = join(appDataDir, 'Adobe', 'UXP', 'PluginsStorage', 'PHSP')
  if (!existsSync(base)) return []
  const hits: MirrorTarget[] = []
  let versions: string[]
  try {
    versions = readdirSync(base)
  } catch {
    return []
  }
  for (const v of versions) {
    if (!/^\d+$/.test(v)) continue
    for (const container of ['Developer', 'External', 'Plugins']) {
      const pd = join(base, v, container, PLUGIN_ID, 'PluginData')
      if (existsSync(pd)) hits.push({ psMajor: v, pluginDataDir: pd })
    }
  }
  return hits
}

// ---------------------------------------------------------------- 组装 task.json 内容

interface TaskContent {
  contract: string
  scope: 'task'
  projects: unknown[]
}

/** 单条素材 → 契约 §5.4 的 asset 结构 */
function assetToJson(a: {
  id: number
  file_name: string
  ext: string
  role: string
  size: number
  width: number | null
  height: number | null
  version_id: number | null
  thumb_path: string | null
  missing_at: string | null
  missing_ignored_at: string | null
  modified_at: string
  abs_path: string
}): Record<string, unknown> {
  // thumb 为镜像内相对路径；命名空间取真实落盘扩展名（webp/图片→png，视频 jpg→jpg）
  const srcExt = a.thumb_path ? extname(a.thumb_path).replace(/^\./, '') : ''
  const thumb = a.thumb_path ? `${THUMB_DIR}/${mirrorThumbName(a.id, srcExt)}` : null
  const tags = (
    getDb()
      .prepare(
        `SELECT t.name AS name FROM asset_tags at JOIN tags t ON t.id = at.tag_id
         WHERE at.asset_id = ? ORDER BY t.sort_order, t.id`
      )
      .all(a.id) as Array<{ name: string }>
  ).map((r) => r.name)
  return {
    id: a.id,
    name: a.file_name,
    ext: a.ext.replace(/^\./, '').toLowerCase(),
    kind: kindOf(a.ext),
    role: a.role,
    size: a.size,
    width: a.width,
    height: a.height,
    versionId: a.version_id,
    thumb,
    // 「与界面同口径」：已忽略（missing_ignored_at 非空）的不算丢失
    missing: a.missing_at !== null && a.missing_ignored_at === null,
    modifiedAt: a.modified_at,
    absPath: a.abs_path,
    tags
  }
}

/** 组装 task.json 的**内容部分**（不含 revision / generatedAt —— 签名基于它算，签名不含易变字段） */
export function buildTaskContent(workspaceRoot: string): TaskContent {
  void workspaceRoot
  const db = getDb()
  const projects = db
    .prepare('SELECT id, name, color, sort_order, archived FROM projects ORDER BY sort_order, id')
    .all() as Array<{ id: number; name: string; color: string; sort_order: number; archived: number }>
  const packs = db
    .prepare('SELECT id, name, category, channel, grade, folder_path, project_id FROM packs ORDER BY id')
    .all() as Array<{
    id: number
    name: string
    category: string
    channel: string
    grade: string
    folder_path: string
    project_id: number | null
  }>

  const verStmt = db.prepare(
    'SELECT id, seq, folder_name, note, is_current FROM pack_versions WHERE pack_id = ? ORDER BY seq'
  )
  const assetStmt = db.prepare(
    `SELECT id, file_name, ext, role, size, width, height, version_id, thumb_path,
            missing_at, missing_ignored_at, modified_at, abs_path
     FROM assets WHERE pack_id = ? ORDER BY id`
  )

  const packJson = (p: (typeof packs)[number]): Record<string, unknown> => ({
    id: p.id,
    name: p.name,
    category: p.category,
    channel: p.channel,
    folderPath: p.folder_path,
    versions: (
      verStmt.all(p.id) as Array<{
        id: number
        seq: number
        folder_name: string
        note: string
        is_current: number
      }>
    ).map((v) => ({
      id: v.id,
      seq: v.seq,
      isCurrent: v.is_current === 1,
      note: v.note,
      folderName: v.folder_name
    })),
    assets: (
      assetStmt.all(p.id) as Array<Parameters<typeof assetToJson>[0]>
    ).map(assetToJson)
  })

  const out: unknown[] = projects.map((pr) => ({
    id: pr.id,
    name: pr.name,
    color: pr.color,
    sortOrder: pr.sort_order,
    archived: pr.archived === 1,
    packs: packs.filter((p) => p.project_id === pr.id).map(packJson)
  }))

  // 未归类任务（project_id = null，来自磁盘根下的游离文件夹）→ 一个固定伪项目，避免整包丢失
  const loose = packs.filter((p) => p.project_id === null)
  if (loose.length > 0) {
    out.push({
      id: 0,
      name: '未归类任务',
      color: null,
      sortOrder: 999999,
      archived: false,
      packs: loose.map(packJson)
    })
  }

  return { contract: CONTRACT_VERSION, scope: 'task', projects: out }
}

/** 同步前把任务库里缺的缩略图补一遍（图片/视频/PSD/PDF），失败不阻断 */
async function ensureTaskThumbs(workspaceRoot: string): Promise<void> {
  const rows = getDb()
    .prepare(
      `SELECT id, abs_path, ext, size, thumb_path, modified_at FROM assets
       WHERE pack_id IS NOT NULL AND thumb_path IS NULL`
    )
    .all() as Array<{
    id: number
    abs_path: string
    ext: string
    size: number
    thumb_path: string | null
    modified_at: string
  }>
  const upd = getDb().prepare('UPDATE assets SET thumb_path = ? WHERE id = ?')
  for (const r of rows) {
    if (!(isImage(r.ext) || isVideo(r.ext) || isPsd(r.ext) || isPdf(r.ext))) continue
    const rel = await ensureAnyThumb(
      workspaceRoot,
      r.abs_path,
      r.size,
      r.ext,
      new Date(r.modified_at).getTime()
    )
    if (rel) upd.run(rel, r.id)
  }
}

// ---------------------------------------------------------------- 缩略图转码 / 拷贝

/** 把一个 `_thumbs\*.webp|.jpg` 落到镜像 `thumb\t<id>.png|jpg`；返回镜像内相对路径（失败 null） */
async function writeMirrorThumb(
  workspaceRoot: string,
  thumbDir: string,
  id: number,
  thumbPath: string
): Promise<string | null> {
  const srcAbs = join(workspaceRoot, thumbPath)
  if (!existsSync(srcAbs)) return null
  const srcExt = extname(srcAbs).replace(/^\./, '').toLowerCase()
  const name = mirrorThumbName(id, srcExt)
  const dstAbs = join(thumbDir, name)
  try {
    if (PNG_EXTS.has(srcExt)) {
      // 已经是 png → 直接拷
      copyFileSync(srcAbs, dstAbs)
    } else if (srcExt === 'jpg' || srcExt === 'jpeg') {
      // 视频帧等 jpg → 原样拷（契约允许 jpg）
      copyFileSync(srcAbs, dstAbs)
    } else {
      // webp（及一切其它）→ 转 png，保透明
      const sharp = (await import('sharp')).default
      await sharp(srcAbs).png().toFile(dstAbs)
    }
    return `${THUMB_DIR}/${name}`
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 写镜像（主入口）

export interface MirrorWriteResult {
  ok: boolean
  /** 本次是否真的重写了文件（内容未变 → false） */
  wrote: boolean
  revision: number
  /** 该库素材条数 */
  count: number
  /** 成功落盘的缩略图数 */
  thumbs: number
  targets: Array<{ psMajor: string; pluginDataDir: string }>
  error?: string
}

/**
 * 把「任务库」镜像写进给定的每个插件目录（契约 §7.1：多命中全写）。
 * 内容签名不变 → 整文件不重写、revision 不涨。
 */
export async function syncTaskMirror(
  workspaceRoot: string,
  targets: MirrorTarget[],
  opts: { appVersion: string; force?: boolean }
): Promise<MirrorWriteResult> {
  try {
    await ensureTaskThumbs(workspaceRoot)

    const content = buildTaskContent(workspaceRoot)
    const count = content.projects.reduce<number>(
      (n, pr) =>
        n +
        ((pr as { packs: Array<{ assets: unknown[] }> }).packs || []).reduce<number>(
          (m, pk) => m + (pk.assets?.length || 0),
          0
        ),
      0
    )
    const sig = createHash('sha1').update(JSON.stringify(content)).digest('hex')
    const prevSig = getMeta(META_SIG)
    const prevRev = Number(getMeta(META_REV) || '0')
    const unchanged = !opts.force && prevSig === sig

    if (unchanged) {
      return { ok: true, wrote: false, revision: prevRev, count, thumbs: 0, targets }
    }

    const revision = prevRev + 1
    const generatedAt = isoLocal()

    let thumbs = 0
    for (const t of targets) {
      const lib = join(t.pluginDataDir, MIRROR_DIR)
      const thumbDir = join(lib, THUMB_DIR)
      mkdirSync(thumbDir, { recursive: true })
      mkdirSync(join(lib, HANDOFF_DIR), { recursive: true })

      // 缩略图
      const assetRows = getDb()
        .prepare(
          'SELECT id, thumb_path FROM assets WHERE pack_id IS NOT NULL AND thumb_path IS NOT NULL'
        )
        .all() as Array<{ id: number; thumb_path: string }>
      for (const a of assetRows) {
        const rel = await writeMirrorThumb(workspaceRoot, thumbDir, a.id, a.thumb_path)
        if (rel) thumbs += 1
      }

      // task.json
      const taskJson = { ...content, revision, generatedAt }
      atomicWriteJson(join(lib, TASK_FILE), taskJson)

      // manifest.json
      const manifest = {
        contract: CONTRACT_VERSION,
        generatedAt,
        generator: { app: 'VellumDesk', version: opts.appVersion, layoutVersion: LAYOUT_VERSION },
        workspaceRoot,
        psMajor: t.psMajor,
        scopes: [{ id: 'task', label: '任务库', file: TASK_FILE, revision, count }]
      }
      atomicWriteJson(join(lib, MANIFEST_FILE), manifest)
    }

    setMeta(META_SIG, sig)
    setMeta(META_REV, String(revision))

    return { ok: true, wrote: true, revision, count, thumbs, targets }
  } catch (e) {
    return {
      ok: false,
      wrote: false,
      revision: Number(getMeta(META_REV) || '0'),
      count: 0,
      thumbs: 0,
      targets,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/** 供排障：镜像目录里已有哪些文件（不递归 thumb） */
export function listMirrorEntries(pluginDataDir: string): string[] {
  const lib = join(pluginDataDir, MIRROR_DIR)
  if (!existsSync(lib)) return []
  try {
    return readdirSync(lib)
  } catch {
    return []
  }
}

/** 供测试/排障：判断某文件是否新鲜的 PNG（8 字节魔数） */
export function isPngFile(absPath: string): boolean {
  try {
    const head = readFileSync(absPath).subarray(0, 8)
    return head.toString('hex') === '89504e470d0a1a0a'
  } catch {
    return false
  }
}

/** 供测试/排障：文件 mtime（ms）；不存在返回 -1 */
export function fileMtimeMs(absPath: string): number {
  try {
    return statSync(absPath).mtimeMs
  } catch {
    return -1
  }
}
