/**
 * 第 66 批（docs/49）：**PSD 模板库** —— 软件侧核心模块（插件联动三）。
 *
 * 定位：一个**专存参考线打好的 PSD 模板**的分区，给 PS 插件的「新建稿」工具页用 ——
 * 用户在插件里选一份模板 → `app.open` 打开成一张新稿（**不是**置入到当前画布）。
 *
 * 磁盘结构（用户拍板「单列一个分区」+ 多层目录）：
 * ```
 * <工作区>\_PSD模板库\
 *   易拉宝\2026春季\海南\易拉宝 80×180.psd     ← 分组最多 5 层（契约 §5.3）
 *   xx.psd                                   ← 直接躺在根下 = 未分组（folder_id = NULL）
 * ```
 *
 * 三条铁律（沿用本项目既有约定）：
 * 1. **本地磁盘是唯一真相**：软件里建/改名/删组都同步磁盘；反过来在资源管理器手建文件夹，
 *    下次扫描自动认领 —— 保住「软件视图 = 磁盘现实」。
 * 2. **绝不静默扔用户的东西**：删组 = 组内文件**移到「未分组」**；移除单个模板 = 文件**进 `_回收站`**；
 *    不收录的文件（超 20 MB / 读不到尺寸 / 不是 PSD / 超过 5 层）**不删不动**，只进「未收录名单」交给界面提示。
 * 3. **不依赖 electron**：所有函数收 `workspaceRoot` 参数，于是 `accept.ts` 能直接跑。
 *
 * 与「通用素材库」（`brandLib.ts`）的关系：**同构**（两张独立表 + 独立扫描），但有三处不同：
 * · 分组**层数 ≤5**（通用库当时封顶 2 层；模板场景两层明显不够）；
 * · **收录时就卡口**：≤20 MB、必须读到画布尺寸、只收 `psd` / `psb`；
 * · 多存 `resolution`（ppi）与 `guides`（参考线条数），供插件筛排、并让用户看出"线到底打没打"。
 *
 * ⚠️ 本库**刻意不复用 `assets` / `brand_assets`**（docs/46 §3.1 的同一理由）。
 */
import { join, basename, extname, dirname, relative } from 'path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  renameSync,
  rmdirSync,
  unlinkSync
} from 'fs'
import { createHash } from 'crypto'
import type { TplCardData } from '../shared/tplCardMarkup'
import { getDb } from './db'
import { TRASH_DIR, scanAll } from './workspace'
import { ensureAnyThumb, readPsdMeta, readPsdExtra, isPsd } from './thumbs'
import {
  safeFolderName,
  safeBaseName,
  uniqueDir,
  uniqueFile,
  type BulkCopyResult,
  type MoveAssetsResult,
  type SeqRenameResult
} from './brandLib'

/** 模板库根目录名（下划线开头 → 任务扫描自动跳过，与 `_通用素材库` 同一路数） */
export const TPL_ROOT_DIR = '_PSD模板库'
/** 分组深度上限（契约 §5.3 第 1 条；第 6 层不产出） */
export const TPL_MAX_DEPTH = 5
/** 单个模板 PSD 体积上限（用户 2026-10-17 拍板：20 MB，收录时就拒） */
export const TPL_MAX_BYTES = 20 * 1024 * 1024
/** 只收 Photoshop 文档（`psb` 是 PS 的大文档格式，同一套解析器） */
export const TPL_EXTS: ReadonlySet<string> = new Set(['psd', 'psb'])

function nowIso(): string {
  return new Date().toISOString()
}

export function tplRootPath(workspaceRoot: string): string {
  return join(workspaceRoot, TPL_ROOT_DIR)
}

// ---------------------------------------------------------------- 行类型

export interface TplFolderRow {
  id: number
  parent_id: number | null
  name: string
  sort_order: number
  rel_path: string
  created_at: string
}

export interface TplFolderNode extends TplFolderRow {
  /** 1 = 顶层，5 = 最深 */
  depth: number
  /** 直属模板数 */
  assetCount: number
  /** 含所有子层的模板总数 */
  totalCount: number
  /** 还能不能再往下建（depth < TPL_MAX_DEPTH） */
  canAddChild: boolean
}

export interface TplAssetRow {
  id: number
  folder_id: number | null
  file_name: string
  ext: string
  size: number
  abs_path: string
  rel_path: string
  thumb_path: string | null
  width: number | null
  height: number | null
  color_mode: string | null
  resolution: number | null
  guides: number | null
  /**
   * 第 69 批（docs/51）：PSD 关键词（JSON 数组字符串）。
   * NULL = 还没读过；'[]' = 读过了但没有；否则是 `["80cm×180cm","bleed:5mm"]`。
   */
  keywords: string | null
  /** 第 69 批（docs/53）：信息卡渲染图（给 PS 插件用）的相对路径 */
  card_path: string | null
  missing_at: string | null
  created_at: string
  modified_at: string
  scanned_at: string
}

export interface TplAssetListItem extends TplAssetRow {
  folderName: string | null
  /** 从顶层到所在组的名字链（面包屑用）；未分组 = [] */
  folderPath: string[]
}

export interface TplOpResult<T = unknown> {
  ok: boolean
  error?: string
  value?: T
}

/** 未收录原因（界面按这个映射文案） */
export type TplRejectReason = 'not-psd' | 'too-large' | 'no-size' | 'too-deep'

export interface TplRejected {
  name: string
  abs: string
  reason: TplRejectReason
}

// ---------------------------------------------------------------- 根

/** 建 `<工作区>\_PSD模板库\`。幂等。**不预置任何分组**（模板库不像通用库有固定顶层）。 */
export function ensureTplRoot(workspaceRoot: string): void {
  mkdirSync(tplRootPath(workspaceRoot), { recursive: true })
}

// ---------------------------------------------------------------- 分组：读

function allFolderRows(): TplFolderRow[] {
  return getDb().prepare('SELECT * FROM tpl_folders').all() as TplFolderRow[]
}

function folderById(rows: TplFolderRow[], id: number | null): TplFolderRow | undefined {
  if (id === null) return undefined
  return rows.find((r) => r.id === id)
}

/**
 * 算某组的深度（顶层 = 1）。
 * 带 `visited` 防成环 —— 脏数据（A 父 B、B 父 A）不会把这里转成死循环。
 */
function depthOf(rows: TplFolderRow[], id: number | null): number {
  let depth = 0
  let cur = folderById(rows, id)
  const visited = new Set<number>()
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id)
    depth += 1
    cur = folderById(rows, cur.parent_id)
  }
  return depth
}

export function getTplFolder(id: number): TplFolderRow | undefined {
  return getDb().prepare('SELECT * FROM tpl_folders WHERE id = ?').get(id) as
    | TplFolderRow
    | undefined
}

/** 某组的绝对目录 */
export function tplFolderDir(workspaceRoot: string, id: number): string | null {
  const f = getTplFolder(id)
  return f ? join(workspaceRoot, f.rel_path) : null
}

/** 某组的所有后代 id（含自己）—— 含子层筛选 / 删除时的统一口径 */
function descendants(rows: TplFolderRow[], id: number): number[] {
  const out = [id]
  const queue = [id]
  const seen = new Set<number>([id])
  while (queue.length) {
    const cur = queue.shift() as number
    for (const r of rows) {
      if (r.parent_id === cur && !seen.has(r.id)) {
        seen.add(r.id)
        out.push(r.id)
        queue.push(r.id)
      }
    }
  }
  return out
}

/** 从顶层到该组（含）的名字链 —— 面包屑用 */
export function tplFolderChain(id: number): string[] {
  const rows = allFolderRows()
  const chain: string[] = []
  let cur = folderById(rows, id)
  const visited = new Set<number>()
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id)
    chain.unshift(cur.name)
    cur = folderById(rows, cur.parent_id)
  }
  return chain
}

/** 组树（含 depth / 计数 / 能否再建子层）。按「先顶层、各自按 sort_order」排。 */
export function listTplFolders(): TplFolderNode[] {
  const rows = allFolderRows()
  const counts = new Map<number, number>()
  for (const a of getDb()
    .prepare('SELECT folder_id, COUNT(*) AS c FROM tpl_assets GROUP BY folder_id')
    .all() as Array<{ folder_id: number | null; c: number }>) {
    if (a.folder_id !== null) counts.set(a.folder_id, a.c)
  }
  const node = (r: TplFolderRow): TplFolderNode => {
    const depth = depthOf(rows, r.id)
    const kids = rows.filter((x) => x.parent_id === r.id)
    const direct = counts.get(r.id) ?? 0
    return {
      ...r,
      depth,
      assetCount: direct,
      totalCount: direct + kids.reduce((n, k) => n + (counts.get(k.id) ?? 0), 0),
      canAddChild: depth < TPL_MAX_DEPTH
    }
  }
  const all = rows.map(node)
  // 顶层在前；子层按父组 id、再按 sort_order —— 与 left 树的缩进渲染顺序一致
  return all.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth
    if (a.depth === 1) return a.sort_order - b.sort_order || a.id - b.id
    if (a.parent_id !== b.parent_id) return (a.parent_id ?? 0) - (b.parent_id ?? 0)
    return a.sort_order - b.sort_order || a.id - b.id
  })
}

// ---------------------------------------------------------------- 分组：增 / 改名 / 删 / 排序

/**
 * 新建分组。
 * · `parentId = null` → 顶层组；否则建子组
 * · **深度上限 5**：父组已经是第 5 层 → 拒绝（`error: 'depth'`）
 * · **同层不允许同名**：注意 SQLite 的 `UNIQUE(parent_id, name)` 对 `parent_id IS NULL`
 *   **不去重**（NULL 互不相等），所以这里显式查一遍 —— 顶层也拦得住。
 */
export function createTplFolder(input: {
  workspaceRoot: string
  name: string
  parentId?: number | null
}): TplOpResult<TplFolderRow> {
  const { workspaceRoot } = input
  ensureTplRoot(workspaceRoot)
  const db = getDb()
  const name = safeFolderName(input.name)
  const parentId = input.parentId ?? null
  const rows = allFolderRows()

  if (parentId !== null) {
    const parent = folderById(rows, parentId)
    if (!parent) return { ok: false, error: 'no-parent' }
    if (depthOf(rows, parentId) >= TPL_MAX_DEPTH) return { ok: false, error: 'depth' }
  }
  const dup = rows.find((r) => r.parent_id === parentId && r.name === name)
  if (dup) return { ok: false, error: 'duplicate' }

  const baseDir = parentId === null ? tplRootPath(workspaceRoot) : tplFolderDir(workspaceRoot, parentId)!
  const dir = uniqueDir(baseDir, name)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return { ok: false, error: 'mkdir' }
  }
  const rel = relative(workspaceRoot, dir)
  const maxOrder = (
    db
      .prepare(
        parentId === null
          ? 'SELECT COALESCE(MAX(sort_order), -1) AS m FROM tpl_folders WHERE parent_id IS NULL'
          : 'SELECT COALESCE(MAX(sort_order), -1) AS m FROM tpl_folders WHERE parent_id = ?'
      )
      .get(...(parentId === null ? [] : [parentId])) as { m: number }
  ).m
  const info = db
    .prepare(
      `INSERT INTO tpl_folders (parent_id, name, sort_order, rel_path, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(parentId, name, maxOrder + 1, rel, nowIso())
  return { ok: true, value: getTplFolder(Number(info.lastInsertRowid))! }
}

/** 改名：**连带改磁盘文件夹名**（子组的 rel_path、组内模板的 abs/rel_path 一起改，单事务） */
export function renameTplFolder(input: {
  workspaceRoot: string
  id: number
  name: string
}): TplOpResult<TplFolderRow> {
  const { workspaceRoot, id } = input
  const f = getTplFolder(id)
  if (!f) return { ok: false, error: 'not-found' }
  const db = getDb()
  const name = safeFolderName(input.name)
  if (name === f.name) return { ok: true, value: f }

  const rows = allFolderRows()
  const dup = rows.find((r) => r.parent_id === f.parent_id && r.name === name && r.id !== id)
  if (dup) return { ok: false, error: 'duplicate' }

  const oldAbs = join(workspaceRoot, f.rel_path)
  const newAbs = uniqueDir(dirname(oldAbs), name)
  try {
    if (existsSync(oldAbs)) renameSync(oldAbs, newAbs)
  } catch {
    return { ok: false, error: 'rename' }
  }
  const newRel = relative(workspaceRoot, newAbs)
  const tx = db.transaction(() => {
    db.prepare('UPDATE tpl_folders SET name = ?, rel_path = ? WHERE id = ?').run(name, newRel, id)
    // 后代组的 rel_path 前缀跟着改（多层 ⇒ 用外层前缀替换，不能只改直接子级）
    const allFolders = db.prepare('SELECT id, rel_path FROM tpl_folders').all() as Array<{
      id: number
      rel_path: string
    }>
    for (const r of allFolders) {
      if (r.id === id) continue
      if (r.rel_path.toLowerCase().startsWith(f.rel_path.toLowerCase() + '\\')) {
        const patched = newRel + r.rel_path.slice(f.rel_path.length)
        db.prepare('UPDATE tpl_folders SET rel_path = ? WHERE id = ?').run(patched, r.id)
      }
    }
    /**
     * 组内模板的路径一起改。
     * ⚠️ **不用 `LIKE ... ESCAPE`** —— 那玩意儿要同时处理 `\`（Windows 分隔符）与 `%`（通配符）两层转义，
     * 少写一个反斜杠就变成"匹配字面量 %"，**一条都改不到**（本批第一次跑 accept 就栽在这，2 条断言红）。
     * 直接取出来在 JS 里比前缀：路径条数很少（一个库的模板量级），可读性还高。
     */
    const allAssets = db
      .prepare('SELECT id, abs_path, rel_path FROM tpl_assets')
      .all() as Array<{ id: number; abs_path: string; rel_path: string }>
    const oldPrefix = (oldAbs + '\\').toLowerCase()
    for (const a of allAssets) {
      if (!a.abs_path.toLowerCase().startsWith(oldPrefix)) continue
      const nextAbs = newAbs + a.abs_path.slice(oldAbs.length)
      const nextRel = newRel + a.rel_path.slice(f.rel_path.length)
      db.prepare('UPDATE tpl_assets SET abs_path = ?, rel_path = ? WHERE id = ?').run(
        nextAbs,
        nextRel,
        a.id
      )
    }
  })
  tx()
  return { ok: true, value: getTplFolder(id)! }
}

/** 排序：同层内改成指定序号（界面"上移/下移"用；保证同层单调，不跨层混排） */
export function setTplFolderOrder(id: number, sortOrder: number): TplOpResult {
  const f = getTplFolder(id)
  if (!f) return { ok: false, error: 'not-found' }
  getDb().prepare('UPDATE tpl_folders SET sort_order = ? WHERE id = ?').run(sortOrder, id)
  return { ok: true }
}

/**
 * 删组：**组内文件（含所有子层）移到「未分组」，绝不删文件**（沿用通用库口径）。
 * 「未分组」= 直接躺在 `<根>\` 下的文件（folder_id = NULL）。
 */
export function deleteTplFolder(input: {
  workspaceRoot: string
  id: number
}): TplOpResult<{ moved: number }> {
  const { workspaceRoot, id } = input
  const f = getTplFolder(id)
  if (!f) return { ok: false, error: 'not-found' }
  const db = getDb()
  const rows = allFolderRows()
  const root = tplRootPath(workspaceRoot)
  const ids = descendants(rows, id)

  // ⚠️ 要清的目录必须**提前**算好 —— 记录一删 `tplFolderDir` 就查不到了
  const dirsToClean = ids
    .map((fid) => {
      const row = rows.find((x) => x.id === fid)
      return row ? join(workspaceRoot, row.rel_path) : ''
    })
    .filter(Boolean)
    .sort((a, b) => b.length - a.length) // 深的先删

  const assets = db
    .prepare(`SELECT * FROM tpl_assets WHERE folder_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as TplAssetRow[]

  let moved = 0
  const tx = db.transaction(() => {
    for (const a of assets) {
      let dest = uniqueFile(root, a.file_name)
      try {
        if (existsSync(a.abs_path)) renameSync(a.abs_path, dest)
        else dest = a.abs_path
      } catch {
        // 挪不动就保留原路径（至少不丢记录）
        dest = a.abs_path
      }
      db.prepare('UPDATE tpl_assets SET folder_id = NULL, abs_path = ?, rel_path = ? WHERE id = ?')
        .run(dest, relative(workspaceRoot, dest), a.id)
      moved += 1
    }
    for (const fid of ids) {
      if (fid === id) continue
      db.prepare('DELETE FROM tpl_folders WHERE id = ?').run(fid)
    }
    db.prepare('DELETE FROM tpl_folders WHERE id = ?').run(id)
  })
  tx()

  // 磁盘目录：只剩空目录才清（尽力而为）
  for (const dir of dirsToClean) {
    if (!existsSync(dir)) continue
    try {
      // ⚠️ 要的是"非空就不删"的语义 ⇒ `rmdirSync`，不是 `rmSync`
      if (readdirSync(dir).length === 0) rmdirSync(dir)
    } catch {
      /* 非空 / 被占用就留着 */
    }
  }
  return { ok: true, value: { moved } }
}

// ---------------------------------------------------------------- 模板：读

export interface TplScanResult {
  folders: number
  assets: number
  newAssets: number
  missing: number
  /** 超过 5 层被跳过的目录数 */
  skippedDeep: number
  /** 未收录的文件（超限 / 非 PSD / 读不到尺寸） */
  rejected: TplRejected[]
  thumbs: number
  /** 第 69 批：本次渲染/命中的信息卡图张数（给插件用） */
  cards: number
}

/**
 * 列模板。`folderId`：
 * · 传数字 → 该组 **及其所有子层**（点父组看全部，与通用库一致）
 * · 传 -1  → 只看「未分组」
 * · 不传   → 全库
 */
export function listTplAssets(opts?: { folderId?: number; keyword?: string }): TplAssetListItem[] {
  const o = opts ?? {}
  const kw = (o.keyword ?? '').trim().toLowerCase()
  let rows = getDb()
    .prepare('SELECT * FROM tpl_assets ORDER BY modified_at DESC, id DESC')
    .all() as TplAssetRow[]

  if (o.folderId === -1) {
    rows = rows.filter((r) => r.folder_id === null)
  } else if (typeof o.folderId === 'number') {
    const ids = new Set(descendants(allFolderRows(), o.folderId))
    rows = rows.filter((r) => r.folder_id !== null && ids.has(r.folder_id))
  }

  if (kw) {
    rows = rows.filter(
      (r) => r.file_name.toLowerCase().includes(kw) || r.ext.toLowerCase().includes(kw)
    )
  }

  const nameById = new Map(allFolderRows().map((f) => [f.id, f.name]))
  return rows.map((r) => ({
    ...r,
    folderName: r.folder_id === null ? null : (nameById.get(r.folder_id) ?? null),
    folderPath: r.folder_id === null ? [] : tplFolderChain(r.folder_id)
  }))
}

export function tplStats(): {
  folders: number
  assets: number
  unsorted: number
  missing: number
  noGuides: number
} {
  const db = getDb()
  const folders = (db.prepare('SELECT COUNT(*) AS c FROM tpl_folders').get() as { c: number }).c
  const assets = (db.prepare('SELECT COUNT(*) AS c FROM tpl_assets').get() as { c: number }).c
  const unsorted = (
    db.prepare('SELECT COUNT(*) AS c FROM tpl_assets WHERE folder_id IS NULL').get() as { c: number }
  ).c
  const missing = (
    db.prepare('SELECT COUNT(*) AS c FROM tpl_assets WHERE missing_at IS NOT NULL').get() as {
      c: number
    }
  ).c
  const noGuides = (
    db.prepare('SELECT COUNT(*) AS c FROM tpl_assets WHERE guides = 0').get() as { c: number }
  ).c
  return { folders, assets, unsorted, missing, noGuides }
}

// ---------------------------------------------------------------- 收录卡口（三件事都在这里）

export interface TplFileCheck {
  ok: boolean
  reason?: TplRejectReason
  size: number
  width: number | null
  height: number | null
  colorMode: string | null
}

/**
 * 收录前的统一体检（**导入与扫描共用同一套判据**）：
 * ① 扩展名必须 `psd` / `psb`；② 体积 ≤ 20 MB；③ **必须读到画布尺寸**（读不到就不收 ——
 * 尺寸是列表上唯一能让人分辨模板的信息，读不到等于收了个说不出是什么的东西）。
 * ⚠️ 顺序：**先体检、后复制**（导入时复制在前会留下"复制进来又被拒"的半成品）。
 */
export async function checkTplFile(absPath: string): Promise<TplFileCheck> {
  const ext = extname(absPath).replace(/^\./, '').toLowerCase()
  let size = 0
  try {
    size = statSync(absPath).size
  } catch {
    return { ok: false, reason: 'no-size', size: 0, width: null, height: null, colorMode: null }
  }
  if (!TPL_EXTS.has(ext)) {
    return { ok: false, reason: 'not-psd', size, width: null, height: null, colorMode: null }
  }
  if (size > TPL_MAX_BYTES) {
    return { ok: false, reason: 'too-large', size, width: null, height: null, colorMode: null }
  }
  const meta = await readPsdMeta(absPath)
  if (meta.width === null || meta.height === null) {
    return { ok: false, reason: 'no-size', size, width: null, height: null, colorMode: null }
  }
  return { ok: true, size, width: meta.width, height: meta.height, colorMode: meta.colorMode }
}

// ---------------------------------------------------------------- 扫描（磁盘 → 库）

/**
 * 扫 `<根>`（≤5 层）→ 认领分组与模板。**只登记，永不删用户文件。**
 * · 顶层目录（不以 `_` / `.` 开头）→ 第 1 层分组；逐层往下，**第 6 层起跳过并计数**（不登记、不进库）
 * · 直接躺在根下 / 组目录下的文件 → 记为该组模板（根下的 folder_id = NULL = 未分组）
 * · 不收录的文件（非 PSD / 超 20 MB / 读不到尺寸）→ **进 `rejected` 名单交给界面提示**，磁盘不动
 * · 磁盘上已不存在的记录 → 打 `missing_at`（照第 8 批口径，**不删记录**）
 */
export async function scanTpl(workspaceRoot: string): Promise<TplScanResult> {
  ensureTplRoot(workspaceRoot)
  const db = getDb()
  const root = tplRootPath(workspaceRoot)
  const ts = nowIso()
  const out: TplScanResult = {
    folders: 0,
    assets: 0,
    newAssets: 0,
    missing: 0,
    skippedDeep: 0,
    rejected: [],
    thumbs: 0,
    cards: 0
  }

  const skipHidden = (n: string): boolean => n.startsWith('_') || n.startsWith('.')
  const listDirs = (p: string): string[] => {
    if (!existsSync(p)) return []
    try {
      return readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return []
    }
  }
  const listFiles = (p: string): string[] => {
    if (!existsSync(p)) return []
    try {
      return readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => join(p, d.name))
    } catch {
      return []
    }
  }

  const folderByRel = new Map(allFolderRows().map((f) => [f.rel_path.toLowerCase(), f]))
  const insFolder = db.prepare(
    `INSERT INTO tpl_folders (parent_id, name, sort_order, rel_path, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
  const ensureFolder = (parentId: number | null, name: string, rel: string, order: number): number => {
    const hit = folderByRel.get(rel.toLowerCase())
    if (hit) return hit.id
    const info = insFolder.run(parentId, name, order, rel, ts)
    const id = Number(info.lastInsertRowid)
    folderByRel.set(
      rel.toLowerCase(),
      { id, parent_id: parentId, name, sort_order: order, rel_path: rel, created_at: ts } as TplFolderRow
    )
    out.folders += 1
    return id
  }

  // 收集候选：{ abs, folderId }
  const files: Array<{ abs: string; folderId: number | null }> = []
  const walk = (dir: string, parentId: number | null, level: number): void => {
    for (const abs of listFiles(dir)) files.push({ abs, folderId: parentId })
    let order = 0
    for (const name of listDirs(dir)) {
      if (skipHidden(name)) continue
      if (level + 1 > TPL_MAX_DEPTH) {
        out.skippedDeep += 1
        continue // 第 6 层起：不登记、也不再往下
      }
      const sub = join(dir, name)
      const subRel = relative(workspaceRoot, sub)
      // 同层按磁盘出现顺序给序号（保持"同层 sort_order 单调"这条契约约束）
      const id = ensureFolder(parentId, name, subRel, order++)
      walk(sub, id, level + 1)
    }
  }
  walk(root, null, 0)
  out.folders = (db.prepare('SELECT COUNT(*) AS c FROM tpl_folders').get() as { c: number }).c

  // 体检 + 落库（不收录的不落库，只记进 rejected）
  const existsStmt = db.prepare('SELECT id FROM tpl_assets WHERE abs_path = ?')
  const upsert = db.prepare(
    `INSERT INTO tpl_assets
       (folder_id, file_name, ext, size, abs_path, rel_path, created_at, modified_at, scanned_at)
     VALUES (@folder_id, @file_name, @ext, @size, @abs_path, @rel_path, @created_at, @modified_at, @scanned_at)
     ON CONFLICT(abs_path) DO UPDATE SET
       folder_id   = excluded.folder_id,
       file_name   = excluded.file_name,
       ext         = excluded.ext,
       size        = excluded.size,
       rel_path    = excluded.rel_path,
       modified_at = excluded.modified_at,
       scanned_at  = excluded.scanned_at,
       missing_at  = NULL`
  )
  for (const item of files) {
    const check = await checkTplFile(item.abs)
    if (!check.ok) {
      out.rejected.push({
        name: basename(item.abs),
        abs: item.abs,
        reason: check.reason ?? 'no-size'
      })
      continue
    }
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(item.abs)
    } catch {
      continue
    }
    if (!existsStmt.get(item.abs)) out.newAssets += 1
    upsert.run({
      folder_id: item.folderId,
      file_name: basename(item.abs),
      ext: extname(item.abs).replace(/^\./, '').toLowerCase(),
      size: st.size,
      abs_path: item.abs,
      rel_path: relative(workspaceRoot, item.abs),
      created_at: st.birthtime.toISOString(),
      modified_at: st.mtime.toISOString(),
      scanned_at: ts
    })
  }

  // 失效检查：磁盘上已无 → 打标记（不删记录）
  for (const a of db.prepare('SELECT id, abs_path, missing_at FROM tpl_assets').all() as Array<{
    id: number
    abs_path: string
    missing_at: string | null
  }>) {
    const gone = !existsSync(a.abs_path)
    if (gone && a.missing_at === null) {
      db.prepare('UPDATE tpl_assets SET missing_at = ? WHERE id = ?').run(ts, a.id)
      out.missing += 1
    }
  }

  out.assets = (db.prepare('SELECT COUNT(*) AS c FROM tpl_assets').get() as { c: number }).c
  out.thumbs = await ensureTplThumbsAndMeta(workspaceRoot)
  // 第 69 批：再渲染一遍信息卡图（缓存命中就跳过，所以重复扫描几乎零耗时）
  out.cards = await ensureTplCardImages(workspaceRoot)
  return out
}

/** 补缩略图 + 画布尺寸 / 色彩模式 / ppi / 参考线条数（已填过的不重复读） */
export async function ensureTplThumbsAndMeta(workspaceRoot: string): Promise<number> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, abs_path, ext, size, thumb_path, width, resolution, guides, keywords, modified_at
         FROM tpl_assets`
    )
    .all() as Array<{
    id: number
    abs_path: string
    ext: string
    size: number
    thumb_path: string | null
    width: number | null
    resolution: number | null
    guides: number | null
    keywords: string | null
    modified_at: string
  }>
  let n = 0
  const updThumb = db.prepare('UPDATE tpl_assets SET thumb_path = ? WHERE id = ?')
  const updMeta = db.prepare(
    `UPDATE tpl_assets
        SET width = ?, height = ?, color_mode = ?, resolution = ?, guides = ?, keywords = ?
      WHERE id = ?`
  )
  for (const r of rows) {
    if (!existsSync(r.abs_path)) continue
    if (!r.thumb_path && isPsd(r.ext)) {
      const rel = await ensureAnyThumb(
        workspaceRoot,
        r.abs_path,
        r.size,
        r.ext,
        new Date(r.modified_at).getTime()
      )
      if (rel) {
        updThumb.run(rel, r.id)
        n += 1
      }
    }
    // 任一没探到就补一次（`guides = null` 才是"没探到"，0 是"确认没有线"；
    // `keywords = null` 是"还没读过" —— 读过但没有也存 '[]'，免得每次扫描重读）
    if (r.width === null || r.resolution === null || r.guides === null || r.keywords === null) {
      try {
        const meta = await readPsdMeta(r.abs_path)
        const extra = await readPsdExtra(r.abs_path)
        updMeta.run(
          meta.width,
          meta.height,
          meta.colorMode,
          extra.resolution ?? r.resolution,
          extra.guides ?? r.guides,
          // 读失败（extra.keywords 为 null）也落 '[]'：区分不了"没写"和"读不出"，
          // 但继续重试的代价（每轮扫描重读全部模板）远大于收益
          JSON.stringify(extra.keywords ?? []),
          r.id
        )
      } catch {
        /* 元信息失败不阻断 */
      }
    }
  }
  return n
}

// ---------------------------------------------------------------- 第 69 批：信息卡渲染图（给插件）

/** 信息卡渲染图存放目录（工作区内，`_` 开头 → 任务扫描自动跳过） */
export const TPL_CARD_DIR = '_thumbs/tpl-card'

type TplCardRenderer = (data: TplCardData, outAbs: string) => Promise<boolean>
let cardRenderer: TplCardRenderer | null = null

/**
 * 第 69 批（docs/53）：由 ipc 层注入离屏渲染器。
 *
 * 为什么用注入而不是直接 import：渲染要用 Electron 的 BrowserWindow，而 `tplLib` 刻意
 * **不依赖 electron**（accept 才能纯 node 跑）。没注入时本模块静默跳过渲染。
 */
export function setTplCardRenderer(fn: TplCardRenderer | null): void {
  cardRenderer = fn
}

/**
 * 为每个模板渲染一张**信息卡 png**（512×512），路径写进 `card_path`。
 *
 * 为什么需要它：PS 插件是 UXP，**没有 CSS 引擎**，吃不了界面那套 HTML。
 * 插件读的是镜像里的图片文件，所以软件把卡渲染成图，插件**零改动**就能显示。
 *
 * 缓存策略：文件名里带上**内容签名**（文件名+像素+ppi+色彩模式+关键词+丢失态），
 * 内容没变就直接命中、不重渲染；内容变了自然生成新文件，旧文件由本函数末尾清掉。
 */
export async function ensureTplCardImages(
  workspaceRoot: string,
  opts?: { force?: boolean }
): Promise<number> {
  if (!cardRenderer) return 0
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, file_name, width, height, resolution, color_mode, keywords, missing_at, card_path
         FROM tpl_assets`
    )
    .all() as Array<{
    id: number
    file_name: string
    width: number | null
    height: number | null
    resolution: number | null
    color_mode: string | null
    keywords: string | null
    missing_at: string | null
    card_path: string | null
  }>

  const dir = join(workspaceRoot, TPL_CARD_DIR)
  mkdirSync(dir, { recursive: true })
  const upd = db.prepare('UPDATE tpl_assets SET card_path = ? WHERE id = ?')
  const used = new Set<string>()
  let n = 0

  for (const r of rows) {
    const sig = createHash('sha1')
      .update(
        [
          r.file_name,
          r.width,
          r.height,
          r.resolution,
          r.color_mode,
          r.keywords ?? '',
          r.missing_at ? '1' : '0'
        ].join('|')
      )
      .digest('hex')
      .slice(0, 16)
    const name = `${sig}.png`
    const rel = join(TPL_CARD_DIR, name)
    const abs = join(workspaceRoot, rel)
    used.add(name)

    // `force` = 改完卡片样式后强制重画（文件名仍按内容签名，直接覆盖）
    if (!opts?.force && existsSync(abs)) {
      if (r.card_path !== rel) {
        upd.run(rel, r.id)
        n += 1
      }
      continue
    }

    let kws: string[] = []
    try {
      const v = JSON.parse(r.keywords ?? '[]')
      if (Array.isArray(v)) kws = v.map((x) => String(x))
    } catch {
      /* 坏 JSON 当空关键词，不阻断渲染 */
    }
    const ok = await cardRenderer(
      {
        fileName: r.file_name,
        width: r.width,
        height: r.height,
        resolution: r.resolution,
        colorMode: r.color_mode,
        keywords: kws,
        missing: r.missing_at !== null
      },
      abs
    )
    if (ok) {
      upd.run(rel, r.id)
      n += 1
    }
  }

  // 清掉不再被任何模板引用的旧图（改名/改尺寸/改关键词都会换签名）
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.png')) continue
      if (used.has(f)) continue
      try {
        unlinkSync(join(dir, f))
      } catch {
        /* 占用中就下次再清 */
      }
    }
  } catch {
    /* 清理失败不影响主流程 */
  }

  return n
}

// ---------------------------------------------------------------- 导入 / 改名 / 移除

export interface TplImportResult {
  ok: boolean
  error?: string
  imported: number
  renamed: number
  /** 被卡口拒掉的文件（不落盘、不动源文件） */
  rejected: TplRejected[]
}

/**
 * 批量导入（**复制**，不动源文件）。
 * · 文件 → 复制进 `folderId` 指定组（不传 = 未分组，落根下）
 * · 文件夹 → **按文件夹名在该层下建组**，把里面的 PSD 收进去（一层子目录按同名建子组，最多到第 5 层）
 * ⚠️ **先体检、后复制** —— 否则会留下"复制进来又被拒"的半成品。
 */
export async function importTplPaths(input: {
  workspaceRoot: string
  paths: string[]
  folderId?: number | null
}): Promise<TplImportResult> {
  const { workspaceRoot, paths } = input
  ensureTplRoot(workspaceRoot)
  const out: TplImportResult = { ok: true, imported: 0, renamed: 0, rejected: [] }
  const targetId = input.folderId ?? null
  const rootDir = tplRootPath(workspaceRoot)
  let targetDir = targetId === null ? rootDir : tplFolderDir(workspaceRoot, targetId)
  if (!targetDir) return { ...out, ok: false, error: 'no-target' }
  mkdirSync(targetDir, { recursive: true })

  const copyInto = (dir: string, srcFile: string): void => {
    const dest = uniqueFile(dir, basename(srcFile))
    if (basename(dest) !== basename(srcFile)) out.renamed += 1
    copyFileSync(srcFile, dest)
    out.imported += 1
  }

  // 递归收一个目录（层数用 `room` 卡住，最多到 TPL_MAX_DEPTH）
  const collectDir = async (dir: string, destDir: string, room: number): Promise<void> => {
    mkdirSync(destDir, { recursive: true })
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isFile()) {
        const check = await checkTplFile(abs)
        if (!check.ok) {
          out.rejected.push({ name: entry.name, abs, reason: check.reason ?? 'no-size' })
          continue
        }
        copyInto(destDir, abs)
      } else if (entry.isDirectory()) {
        if (room <= 1) {
          out.rejected.push({ name: entry.name, abs, reason: 'too-deep' })
          continue
        }
        const made = createTplFolder({
          workspaceRoot,
          name: entry.name,
          parentId: folderIdOfRel(workspaceRoot, destDir)
        })
        const sub = made.ok && made.value ? tplFolderDir(workspaceRoot, made.value.id)! : join(destDir, entry.name)
        await collectDir(abs, sub, room - 1)
      }
    }
  }

  /** 反查某个绝对目录对应的分组 id（用于"建子组"时定位父组） */
  const folderIdOfRel = (wsRoot: string, dir: string): number | null => {
    const rel = relative(wsRoot, dir).toLowerCase()
    const hit = allFolderRows().find((f) => f.rel_path.toLowerCase() === rel)
    return hit ? hit.id : null
  }

  for (const p of paths) {
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isFile()) {
      const check = await checkTplFile(p)
      if (!check.ok) {
        out.rejected.push({ name: basename(p), abs: p, reason: check.reason ?? 'no-size' })
        continue
      }
      copyInto(targetDir, p)
      continue
    }
    if (!st.isDirectory()) continue
    // 文件夹：在目标层下按文件夹名建组，再把内容收进去
    const parentId = targetId
    const room = TPL_MAX_DEPTH - (parentId === null ? 0 : tplFolderChain(parentId).length)
    const made = createTplFolder({ workspaceRoot, name: basename(p), parentId })
    if (!made.ok || !made.value) {
      out.rejected.push({ name: basename(p), abs: p, reason: 'too-deep' })
      continue
    }
    await collectDir(p, tplFolderDir(workspaceRoot, made.value.id)!, room - 1)
  }

  // 复制完立刻扫一遍把新文件登记进库（复用审计过的通路，不另写插入逻辑）
  await scanTpl(workspaceRoot)
  return out
}

/** 给一条模板改名（**连带改磁盘文件名**）。保持原扩展名，撞名自动 -2/-3。 */
export function renameTplAsset(input: {
  workspaceRoot: string
  id: number
  name: string
}): TplOpResult<{ abs_path: string; file_name: string }> {
  const { workspaceRoot, id } = input
  const a = getDb().prepare('SELECT * FROM tpl_assets WHERE id = ?').get(id) as
    | TplAssetRow
    | undefined
  if (!a) return { ok: false, error: 'not-found' }
  const oldExt = extname(a.file_name)
  // 用户只填名字时补回原扩展名；如果自己写了扩展名，强制纠正成 psd/psb（模板只允许这两种）
  let stem = basename(String(input.name).trim())
  const givenExt = extname(stem)
  if (givenExt) stem = basename(stem, givenExt)
  stem = safeFolderName(stem)
  if (!stem) return { ok: false, error: 'empty' }
  const wantExt = TPL_EXTS.has(givenExt.replace(/^\./, '').toLowerCase())
    ? givenExt.toLowerCase()
    : oldExt
  const fileName = stem + wantExt
  if (fileName === a.file_name) return { ok: true, value: { abs_path: a.abs_path, file_name: a.file_name } }

  const dir = dirname(a.abs_path)
  const dest = uniqueFile(dir, fileName)
  try {
    if (existsSync(a.abs_path)) renameSync(a.abs_path, dest)
  } catch {
    return { ok: false, error: 'rename' }
  }
  getDb()
    .prepare('UPDATE tpl_assets SET file_name = ?, abs_path = ?, rel_path = ? WHERE id = ?')
    .run(basename(dest), dest, relative(workspaceRoot, dest), id)
  return { ok: true, value: { abs_path: dest, file_name: basename(dest) } }
}

/** 从模板库移除一条 —— 文件**移进 `_回收站`**（软件永不静默删用户东西），再删记录 */
export function removeTplAsset(input: { workspaceRoot: string; id: number }): TplOpResult {
  const { workspaceRoot, id } = input
  const a = getDb().prepare('SELECT * FROM tpl_assets WHERE id = ?').get(id) as
    | TplAssetRow
    | undefined
  if (!a) return { ok: false, error: 'not-found' }
  const trashDir = join(workspaceRoot, TRASH_DIR)
  try {
    mkdirSync(trashDir, { recursive: true })
    if (existsSync(a.abs_path)) {
      renameSync(a.abs_path, uniqueFile(trashDir, a.file_name))
    }
  } catch {
    // 挪不进回收站就**不删记录**（宁可留个记录，也不装作删掉了）
    return { ok: false, error: 'trash-failed' }
  }
  getDb().prepare('DELETE FROM tpl_assets WHERE id = ?').run(id)
  return { ok: true }
}

/** 只删库记录、**保留文件**（"不想让它出现在库里"但不搬走时用） */
export function forgetTplAsset(id: number): TplOpResult {
  const a = getDb().prepare('SELECT id FROM tpl_assets WHERE id = ?').get(id)
  if (!a) return { ok: false, error: 'not-found' }
  getDb().prepare('DELETE FROM tpl_assets WHERE id = ?').run(id)
  return { ok: true }
}

/** 排障/测试用：某组（或根）的目录是否真实存在 */
export function tplDirExists(workspaceRoot: string, folderId: number | null): boolean {
  const dir = folderId === null ? tplRootPath(workspaceRoot) : tplFolderDir(workspaceRoot, folderId)
  return !!dir && existsSync(dir)
}

/**
 * 第 67 批（docs/50）：**批量移动模板到另一个分组**。
 * 与 `brandLib.moveBrandAssets` **同构**（口径、错误码、返回结构完全一致）——
 * 两条库的列表视图用的是同一个批量条，界面不该为两边写两套分支。
 * 详细口径见那边的注释（磁盘先动/同名加序号/丢失只改登记/失败不中断/目标组必须存在）。
 */
export function moveTplAssets(input: {
  workspaceRoot: string
  ids: number[]
  /** **-1 = 移到「未分组」**（库根）；数字 = 目标组 id */
  targetFolderId: number
}): TplOpResult<MoveAssetsResult> {
  const { workspaceRoot, ids } = input
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'empty' }

  const targetId = input.targetFolderId === -1 ? null : input.targetFolderId
  const db = getDb()
  if (targetId !== null && !getTplFolder(targetId)) return { ok: false, error: 'no-target' }

  const targetDir =
    targetId === null ? tplRootPath(workspaceRoot) : tplFolderDir(workspaceRoot, targetId)
  if (!targetDir) return { ok: false, error: 'no-target' }
  mkdirSync(targetDir, { recursive: true })

  let moved = 0
  let skipped = 0
  const failed: MoveAssetsResult['failed'] = []

  for (const id of ids) {
    const a = db.prepare('SELECT * FROM tpl_assets WHERE id = ?').get(id) as
      | TplAssetRow
      | undefined
    if (!a) {
      failed.push({ id, name: `#${id}`, error: 'not-found' })
      continue
    }
    if (a.folder_id === targetId) {
      skipped += 1
      continue
    }

    if (!existsSync(a.abs_path)) {
      db.prepare('UPDATE tpl_assets SET folder_id = ? WHERE id = ?').run(targetId, id)
      moved += 1
      continue
    }

    try {
      const dest = uniqueFile(targetDir, a.file_name)
      renameSync(a.abs_path, dest)
      db.prepare(
        `UPDATE tpl_assets
            SET folder_id = ?, file_name = ?, rel_path = ?, abs_path = ?
          WHERE id = ?`
      ).run(targetId, basename(dest), relative(workspaceRoot, dest), dest, id)
      moved += 1
    } catch (e) {
      failed.push({ id, name: a.file_name, error: (e as Error).message || 'move-failed' })
    }
  }

  return { ok: failed.length === 0, value: { moved, skipped, failed } }
}

/**
 * 第 68 批（docs/50 §6）：**批量复制模板到任务包**（进 `02-素材`，原文件不动）。
 *
 * 与通用库同构。PSD 复制进任务后由 `scanAll` 认领成任务库的一条素材（`role` 按子文件夹判定）。
 * 同样**只扫一次**（逐条调的话每条都要全盘扫）。
 */
export function copyTplAssetsToPack(input: {
  workspaceRoot: string
  ids: number[]
  packId: number
}): TplOpResult<BulkCopyResult> {
  const { workspaceRoot, ids, packId } = input
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'empty' }
  const db = getDb()
  const pack = db.prepare('SELECT folder_path FROM packs WHERE id = ?').get(packId) as
    | { folder_path: string }
    | undefined
  if (!pack) return { ok: false, error: 'no-pack' }

  const sub = join(pack.folder_path, '02-素材')
  mkdirSync(sub, { recursive: true })

  let copied = 0
  const failed: BulkCopyResult['failed'] = []
  for (const id of ids) {
    const src = db.prepare('SELECT abs_path, file_name FROM tpl_assets WHERE id = ?').get(id) as
      | { abs_path: string; file_name: string }
      | undefined
    if (!src) {
      failed.push({ id, name: `#${id}`, error: 'no-asset' })
      continue
    }
    if (!existsSync(src.abs_path)) {
      failed.push({ id, name: src.file_name, error: 'missing-file' })
      continue
    }
    try {
      copyFileSync(src.abs_path, uniqueFile(sub, src.file_name))
      copied += 1
    } catch (e) {
      failed.push({ id, name: src.file_name, error: (e as Error).message || 'copy-failed' })
    }
  }
  if (copied > 0) scanAll(workspaceRoot)
  return { ok: failed.length === 0, value: { copied, failed } }
}

/**
 * 第 68 批（docs/50 §6）：**序号化批量改名**（收模板的主场景：`易拉宝-01.psd`）。
 *
 * 两阶段改名的理由与通用库那份完全相同（详见 `brandLib.renameBrandAssetsSeq` 的注释）：
 * 直接逐条改会在"名字互换"时互相覆盖。
 */
export function renameTplAssetsSeq(input: {
  workspaceRoot: string
  ids: number[]
  prefix: string
  start: number
  pad: number
}): TplOpResult<SeqRenameResult> {
  const { workspaceRoot, ids } = input
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'empty' }
  const base = safeBaseName(input.prefix)
  const start = Math.max(0, Math.min(9999, Math.floor(input.start || 1)))
  const pad = Math.max(1, Math.min(4, Math.floor(input.pad || 2)))

  const db = getDb()
  const rows: TplAssetRow[] = []
  const failed: SeqRenameResult['failed'] = []
  for (const id of ids) {
    const a = db.prepare('SELECT * FROM tpl_assets WHERE id = ?').get(id) as TplAssetRow | undefined
    if (!a) {
      failed.push({ id, name: `#${id}`, error: 'not-found' })
      continue
    }
    if (!existsSync(a.abs_path)) {
      failed.push({ id, name: a.file_name, error: 'missing-file' })
      continue
    }
    rows.push(a)
  }
  if (rows.length === 0) return { ok: failed.length === 0, value: { renamed: 0, skipped: 0, failed } }

  const wantName = (i: number, ext: string): string =>
    `${base}-${String(start + i).padStart(pad, '0')}${ext}`
  const takeSuffix = `${Date.now().toString(36)}`

  // 阶段一：临时名 + **同步写登记**（理由见 brandLib 那份注释：不同步会撞 abs_path UNIQUE）
  const stage: Array<{ row: TplAssetRow; tmp: string }> = []
  for (let i = 0; i < rows.length; i += 1) {
    const a = rows[i]
    const ext = extname(a.file_name)
    const tmp = join(dirname(a.abs_path), `~seq-${takeSuffix}-${i}${ext}`)
    try {
      renameSync(a.abs_path, tmp)
      db.prepare('UPDATE tpl_assets SET file_name = ?, abs_path = ?, rel_path = ? WHERE id = ?').run(
        basename(tmp),
        tmp,
        relative(workspaceRoot, tmp),
        a.id
      )
      stage.push({ row: a, tmp })
    } catch (e) {
      failed.push({ id: a.id, name: a.file_name, error: (e as Error).message || 'rename-failed' })
    }
  }

  let renamed = 0
  let skipped = 0
  let seq = 0
  for (const { row: a, tmp } of stage) {
    const ext = extname(a.file_name)
    const wanted = wantName(seq, ext)
    seq += 1
    const dest = uniqueFile(dirname(tmp), wanted)
    try {
      renameSync(tmp, dest)
      db.prepare('UPDATE tpl_assets SET file_name = ?, abs_path = ?, rel_path = ? WHERE id = ?').run(
        basename(dest),
        dest,
        relative(workspaceRoot, dest),
        a.id
      )
      if (basename(dest) === a.file_name) skipped += 1
      else renamed += 1
    } catch (e) {
      try {
        const back = join(dirname(tmp), a.file_name)
        renameSync(tmp, back)
        db.prepare(
          'UPDATE tpl_assets SET file_name = ?, abs_path = ?, rel_path = ? WHERE id = ?'
        ).run(a.file_name, back, relative(workspaceRoot, back), a.id)
      } catch {
        /* 尽力而为 */
      }
      failed.push({ id: a.id, name: a.file_name, error: (e as Error).message || 'rename-failed' })
    }
  }

  return { ok: failed.length === 0, value: { renamed, skipped, failed } }
}
