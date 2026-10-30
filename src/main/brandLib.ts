/**
 * 第 62 批（docs/46）：**通用素材库**（插件联动二）—— 软件侧的核心模块。
 *
 * 定位：一个**不属于任何任务**的素材池 —— 公司通用素材（logo / 字体 / 教材封面…）
 * **＋** 设计师个人收藏。与任务库的本质差别是**归属**：任务库素材挂在「项目/任务包」下，
 * 通用库素材**不挂任何任务**。按**两层分组**组织，随镜像的 `brand.json` 进 PS 插件。
 *
 * 磁盘结构（用户拍板「工作区内、资源管理器可见」）：
 * ```
 * <工作区>\_通用素材库\
 *   公司素材\品牌logo\*.png      ← 顶层组 / 子组（两层封顶）
 *   个人收藏\背景\*.png
 *   （直接躺在根下的文件 = 「未分组」，folder_id = NULL，**不进插件镜像**）
 * ```
 *
 * 三条铁律（沿用本项目既有约定）：
 * 1. **本地磁盘是唯一真相**：软件里建/改名/删组都同步磁盘；反过来在资源管理器手建文件夹，
 *    下次扫描自动认领 —— 保住「软件视图 = 磁盘现实」。
 * 2. **绝不静默删用户文件**：删组 = 组内文件**移到「未分组」**；删单个素材 = 文件**进 `_回收站`**。
 * 3. **不依赖 electron**：appData 不由本模块提供，所有函数收 `workspaceRoot` 参数，
 *    于是 `accept.ts` 能直接跑（与 `workspace.ts` / `linkMirror.ts` 同一路数）。
 *
 * ⚠️ 本库**刻意不复用 `assets` 表**（docs/46 §3.1）：复用会毒害未归属池/文件视图/统计/标签计数一大票查询。
 */
import { join, basename, extname, dirname, relative } from 'path'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  renameSync,
  rmdirSync
} from 'fs'
import { getDb } from './db'
import { TRASH_DIR, scanAll } from './workspace'
import {
  ensureAnyThumb,
  readImageMeta,
  readPsdMeta,
  readVideoMeta,
  isImage,
  isVideo,
  isPsd,
  isPdf
} from './thumbs'

/** 通用素材库的根目录名（下划线开头 → 任务扫描自动跳过，见 `collectFiles`） */
export const BRAND_ROOT_DIR = '_通用素材库'
/** 顶层固定两块（可改名；用 source 记来源，不靠名字判断） */
export const BRAND_TOP_COMPANY = '公司素材'
export const BRAND_TOP_USER = '个人收藏'
/**
 * 分组深度上限 = 5（契约 §5.3 第 1 条，2026-10-17 由「两层」放宽，**不升版本**）。
 * ⚠️ 与模板库（`tplLib.TPL_MAX_DEPTH`）保持一致；两侧都拦，第 6 层不产出。
 */
export const BRAND_MAX_DEPTH = 5

function nowIso(): string {
  return new Date().toISOString()
}

export function brandRootPath(workspaceRoot: string): string {
  return join(workspaceRoot, BRAND_ROOT_DIR)
}

// ---------------------------------------------------------------- 文件夹名（照 workspace.ts 的 sanitize 规则）

/**
 * 文件夹名消毒：去 Windows 非法字符；开头的 `.` / `_` 改写成 `-`
 * （否则会被扫描当"软件自用目录"跳过 —— 通用库的根自己就是靠这条隐身的，
 * 组名若也以 `_` 开头，该组会永远扫不到）。
 */
export function safeFolderName(name: string): string {
  const cleaned = String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^[._]+/, '-')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned || '未命名'
}

/** 磁盘上找一个不撞名的目录（组名重复时自动 -2 -3）。第 66 批起 `tplLib` 也复用。 */
export function uniqueDir(baseDir: string, name: string): string {
  let p = join(baseDir, name)
  let i = 2
  while (existsSync(p)) {
    p = join(baseDir, `${name}-${i}`)
    i += 1
  }
  return p
}

/**
 * 隐藏名判定（第 65 批提成单一来源）：`_` / `.` 开头。
 * 覆盖 macOS AppleDouble `._xxx`、`.DS_Store`，以及软件自己的 `_thumbs` / `_system` / 两个收纳区。
 * ⚠️ 扫描、清理、删组三处都用它 —— 判据只能有一份，别再各写一遍（本项目栽过「两套清单对不上」的跟头）。
 */
export const isHiddenName = (n: string): boolean => n.startsWith('_') || n.startsWith('.')

/** 磁盘上找一个不撞名的文件名（导入同名文件时自动 -2 -3）。第 66 批起 `tplLib` 也复用。 */
export function uniqueFile(dir: string, fileName: string): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let p = join(dir, fileName)
  let i = 2
  while (existsSync(p)) {
    p = join(dir, `${stem}-${i}${ext}`)
    i += 1
  }
  return p
}

// ---------------------------------------------------------------- 行类型

export interface BrandFolderRow {
  id: number
  parent_id: number | null
  name: string
  sort_order: number
  rel_path: string
  sync_to_plugin: number
  source: string
  created_at: string
}

export interface BrandFolderNode extends BrandFolderRow {
  /** 1 = 顶层，5 = 最深 */
  depth: number
  /** 生效同步 = 自身与所有祖先都为 1（父关则子关） */
  effectiveSync: boolean
  /** 直属素材数 */
  assetCount: number
  /** 含所有子层的素材总数 */
  totalCount: number
  /** 还能不能再往下建（depth < BRAND_MAX_DEPTH）—— 界面据此隐藏"新建子分组" */
  canAddChild: boolean
}

export interface BrandAssetRow {
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
  source: string
  missing_at: string | null
  modified_at: string
}

// ---------------------------------------------------------------- 根与顶层组（首次使用自动建）

/** 建 `<工作区>\_通用素材库\`；库里一条顶层组都没有时，落「公司素材 / 个人收藏」两块。幂等。 */
export function ensureBrandRoot(workspaceRoot: string): void {
  const root = brandRootPath(workspaceRoot)
  mkdirSync(root, { recursive: true })
  const db = getDb()
  const n = (
    db.prepare('SELECT COUNT(*) AS c FROM brand_folders WHERE parent_id IS NULL').get() as {
      c: number
    }
  ).c
  if (n > 0) return
  const ts = nowIso()
  const ins = db.prepare(
    `INSERT INTO brand_folders (parent_id, name, sort_order, rel_path, sync_to_plugin, source, created_at)
     VALUES (NULL, ?, ?, ?, 1, ?, ?)`
  )
  const seeds: Array<[string, string]> = [
    [BRAND_TOP_COMPANY, 'company'],
    [BRAND_TOP_USER, 'user']
  ]
  seeds.forEach(([name, source], i) => {
    const rel = relative(workspaceRoot, join(root, name))
    ins.run(name, i, rel, source, ts)
    mkdirSync(join(root, name), { recursive: true })
  })
}

// ---------------------------------------------------------------- 读

function allFolderRows(): BrandFolderRow[] {
  return getDb()
    .prepare('SELECT * FROM brand_folders')
    .all() as BrandFolderRow[]
}

/**
 * 算某组的深度（顶层 = 1）。带 `visited` 防成环 ——
 * 脏数据（A 父 B、B 父 A）不会把这里转成死循环。
 */
function depthOfFolder(rows: BrandFolderRow[], id: number | null): number {
  let depth = 0
  let cur = id === null ? undefined : rows.find((r) => r.id === id)
  const visited = new Set<number>()
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id)
    depth += 1
    cur = cur.parent_id === null ? undefined : rows.find((r) => r.id === cur!.parent_id)
  }
  return depth
}

/** 某组的所有后代 id（不含自己）—— 多层下"含子层"的统一口径 */
function descendantFolderIds(rows: BrandFolderRow[], id: number): number[] {
  const out: number[] = []
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

/** 组树（含 depth / 生效同步 / 素材计数）。按「浅层在前、各自按 sort_order」排。 */
export function listBrandFolders(): BrandFolderNode[] {
  const rows = allFolderRows()
  const byId = new Map(rows.map((r) => [r.id, r]))
  const depthCache = new Map<number, number>()
  const depthOf = (r: BrandFolderRow): number => {
    const hit = depthCache.get(r.id)
    if (hit !== undefined) return hit
    const v = depthOfFolder(rows, r.id)
    depthCache.set(r.id, v)
    return v
  }
  const effective = (r: BrandFolderRow): boolean => {
    if (r.sync_to_plugin !== 1) return false
    if (r.parent_id === null) return true
    const p = byId.get(r.parent_id)
    return p ? effective(p) : false
  }
  const counts = new Map<number, number>()
  for (const a of getDb()
    .prepare('SELECT folder_id, COUNT(*) AS c FROM brand_assets GROUP BY folder_id')
    .all() as Array<{ folder_id: number | null; c: number }>) {
    if (a.folder_id !== null) counts.set(a.folder_id, a.c)
  }
  const kids = new Map<number | null, BrandFolderRow[]>()
  for (const r of rows) {
    const list = kids.get(r.parent_id) ?? []
    list.push(r)
    kids.set(r.parent_id, list)
  }
  /** 含所有子层的素材总数（任意层，递归） */
  const totalOf = (r: BrandFolderRow, guard = new Set<number>()): number => {
    if (guard.has(r.id)) return 0 // 防成环
    guard.add(r.id)
    let n = counts.get(r.id) ?? 0
    for (const c of kids.get(r.id) ?? []) n += totalOf(c, guard)
    return n
  }
  const self: BrandFolderNode[] = rows.map((r) => ({
    ...r,
    depth: depthOf(r),
    effectiveSync: effective(r),
    assetCount: counts.get(r.id) ?? 0,
    totalCount: totalOf(r, new Set<number>()),
    canAddChild: depthOf(r) < BRAND_MAX_DEPTH
  }))
  // 浅层在前（父永远在子之前）；同层按 sort_order
  return self.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth
    const ra = a.parent_id ?? 0
    const rb = b.parent_id ?? 0
    // 同一层里先按父组、再按 sort_order；顶层（parent_id = null）按 sort_order
    if (a.depth > 1 && ra !== rb) return ra - rb
    return a.sort_order - b.sort_order || a.id - b.id
  })
}

export function getBrandFolder(id: number): BrandFolderRow | undefined {
  return getDb().prepare('SELECT * FROM brand_folders WHERE id = ?').get(id) as
    | BrandFolderRow
    | undefined
}

/** 某组的绝对目录；顶层组在根下，子组在父组下 */
export function brandFolderDir(workspaceRoot: string, id: number): string | null {
  const f = getBrandFolder(id)
  if (!f) return null
  return join(workspaceRoot, f.rel_path)
}

export interface BrandAssetListItem extends BrandAssetRow {
  folderName: string | null
  /** 供界面显示：缩略图或原图的 dataURL 由调用方（ipc）填 */
}

/**
 * 列素材。`folderId`：
 *  · 传数字 → 只看该组（**含子组**，方便点父组看全部）
 *  · 传 -1   → 只看「未分组」（folder_id IS NULL）
 *  · 不传    → 全库
 */
export function listBrandAssets(opts?: {
  folderId?: number
  keyword?: string
}): BrandAssetListItem[] {
  const o = opts ?? {}
  const kw = (o.keyword ?? '').trim().toLowerCase()
  let rows = getDb()
    .prepare('SELECT * FROM brand_assets ORDER BY modified_at DESC, id DESC')
    .all() as BrandAssetRow[]

  if (o.folderId === -1) {
    rows = rows.filter((r) => r.folder_id === null)
  } else if (typeof o.folderId === 'number') {
    // 点父组看全部：**含所有子层**（多层后必须递归，不能只看直接子级）
    const ids = new Set<number>([o.folderId, ...descendantFolderIds(allFolderRows(), o.folderId)])
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
    folderName: r.folder_id === null ? null : (nameById.get(r.folder_id) ?? null)
  }))
}

/** 全库统计（给入口徽标 / 视图抬头用） */
export function brandStats(): { folders: number; assets: number; unsorted: number; missing: number } {
  const db = getDb()
  const folders = (db.prepare('SELECT COUNT(*) AS c FROM brand_folders').get() as { c: number }).c
  const assets = (db.prepare('SELECT COUNT(*) AS c FROM brand_assets').get() as { c: number }).c
  const unsorted = (
    db.prepare('SELECT COUNT(*) AS c FROM brand_assets WHERE folder_id IS NULL').get() as {
      c: number
    }
  ).c
  const missing = (
    db.prepare('SELECT COUNT(*) AS c FROM brand_assets WHERE missing_at IS NOT NULL').get() as {
      c: number
    }
  ).c
  return { folders, assets, unsorted, missing }
}

// ---------------------------------------------------------------- 组：增 / 改 / 删 / 排序 / 同步开关

export interface BrandOpResult<T = unknown> {
  ok: boolean
  error?: string
  value?: T
}

/** 新建组。`parentId = null` 建顶层组；否则建子组（**深度上限 5**，契约 §5.3-1）。 */
export function createBrandFolder(input: {
  workspaceRoot: string
  name: string
  parentId?: number | null
}): BrandOpResult<BrandFolderRow> {
  const { workspaceRoot } = input
  ensureBrandRoot(workspaceRoot)
  const db = getDb()
  const name = safeFolderName(input.name)
  const parentId = input.parentId ?? null
  const rows = allFolderRows()

  if (parentId !== null) {
    const parent = rows.find((r) => r.id === parentId)
    if (!parent) return { ok: false, error: 'no-parent' }
    // ⚠️ 原来是"父组本身还有父组就拒"（＝两层封顶）；2026-10-17 放开到 ≤5 层
    if (depthOfFolder(rows, parentId) >= BRAND_MAX_DEPTH) return { ok: false, error: 'depth' }
  }
  // 同层不允许同名。⚠️ SQLite 的 UNIQUE 对 NULL **不去重**（NULL 互不相等）⇒ 顶层必须显式查
  const dup = rows.find((r) => r.parent_id === parentId && r.name === name)
  if (dup) return { ok: false, error: 'duplicate' }

  const baseDir = parentId === null ? brandRootPath(workspaceRoot) : brandFolderDir(workspaceRoot, parentId)!
  const dir = uniqueDir(baseDir, name)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return { ok: false, error: 'mkdir' }
  }
  const rel = relative(workspaceRoot, dir)
  // 来源继承父组；顶层组默认 user（公司/个人由 seeds 定，之后新建的顶层归「个人收藏」语义）
  const source = parentId === null ? 'user' : (getBrandFolder(parentId)?.source ?? 'user')
  const maxOrder = (
    db
      .prepare(
        parentId === null
          ? 'SELECT COALESCE(MAX(sort_order), -1) AS m FROM brand_folders WHERE parent_id IS NULL'
          : 'SELECT COALESCE(MAX(sort_order), -1) AS m FROM brand_folders WHERE parent_id = ?'
      )
      .get(...(parentId === null ? [] : [parentId])) as { m: number }
  ).m
  const info = db
    .prepare(
      `INSERT INTO brand_folders (parent_id, name, sort_order, rel_path, sync_to_plugin, source, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
    .run(parentId, name, maxOrder + 1, rel, source, nowIso())
  return { ok: true, value: getBrandFolder(Number(info.lastInsertRowid))! }
}

/** 改名：**连带改磁盘文件夹名**（照 projects.folder_name 的路数）。 */
export function renameBrandFolder(input: {
  workspaceRoot: string
  id: number
  name: string
}): BrandOpResult<BrandFolderRow> {
  const { workspaceRoot, id } = input
  const f = getBrandFolder(id)
  if (!f) return { ok: false, error: 'not-found' }
  const db = getDb()
  const name = safeFolderName(input.name)
  if (name === f.name) return { ok: true, value: f }
  const dup = db
    .prepare(
      f.parent_id === null
        ? 'SELECT id FROM brand_folders WHERE parent_id IS NULL AND name = ? AND id <> ?'
        : 'SELECT id FROM brand_folders WHERE parent_id = ? AND name = ? AND id <> ?'
    )
    .get(...(f.parent_id === null ? [name, id] : [f.parent_id, name, id]))
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
    db.prepare('UPDATE brand_folders SET name = ?, rel_path = ? WHERE id = ?').run(name, newRel, id)
    /** 后代组的 rel_path 前缀一起改（多层 ⇒ 按前缀匹配，不能只改直接子级） */
    const allFolders = db.prepare('SELECT id, rel_path FROM brand_folders').all() as Array<{
      id: number
      rel_path: string
    }>
    const oldFolderPrefix = (f.rel_path + '\\').toLowerCase()
    for (const r of allFolders) {
      if (r.id === id) continue
      if (!r.rel_path.toLowerCase().startsWith(oldFolderPrefix)) continue
      const patched = newRel + r.rel_path.slice(f.rel_path.length)
      db.prepare('UPDATE brand_folders SET rel_path = ? WHERE id = ?').run(patched, r.id)
    }
    /**
     * 组内素材的路径一起改。
     * ⚠️ **不能用 `LIKE ? ESCAPE '\'`** —— Windows 路径分隔符与 LIKE 通配符是同一个字符族，
     * 转义少一层就变成"匹配字面量 %"，**一条都改不到**（第 66 批在 `tplLib` 上踩过，2 条断言红）。
     * 取出来在 JS 里比前缀，路径条数很少，稳且好读。
     */
    const allAssets = db
      .prepare('SELECT id, abs_path, rel_path FROM brand_assets')
      .all() as Array<{ id: number; abs_path: string; rel_path: string }>
    const oldAssetPrefix = (oldAbs + '\\').toLowerCase()
    for (const a of allAssets) {
      if (!a.abs_path.toLowerCase().startsWith(oldAssetPrefix)) continue
      const nextAbs = newAbs + a.abs_path.slice(oldAbs.length)
      const nextRel = newRel + a.rel_path.slice(f.rel_path.length)
      db.prepare('UPDATE brand_assets SET abs_path = ?, rel_path = ? WHERE id = ?').run(
        nextAbs,
        nextRel,
        a.id
      )
    }
  })
  tx()
  return { ok: true, value: getBrandFolder(id)! }
}

/** 排序：把某组挪到同层指定序号（「置顶」= 设成最小） */
export function setBrandFolderOrder(id: number, sortOrder: number): BrandOpResult {
  const f = getBrandFolder(id)
  if (!f) return { ok: false, error: 'not-found' }
  getDb().prepare('UPDATE brand_folders SET sort_order = ? WHERE id = ?').run(sortOrder, id)
  return { ok: true }
}

/** 置顶：把该组排到同层最前（同层其它组顺延） */
export function pinBrandFolder(workspaceRoot: string, id: number): BrandOpResult {
  void workspaceRoot
  const f = getBrandFolder(id)
  if (!f) return { ok: false, error: 'not-found' }
  const db = getDb()
  const sibs = db
    .prepare(
      f.parent_id === null
        ? 'SELECT id FROM brand_folders WHERE parent_id IS NULL AND id <> ? ORDER BY sort_order, id'
        : 'SELECT id FROM brand_folders WHERE parent_id = ? AND id <> ? ORDER BY sort_order, id'
    )
    .all(...(f.parent_id === null ? [id] : [f.parent_id, id])) as Array<{ id: number }>
  const tx = db.transaction(() => {
    db.prepare('UPDATE brand_folders SET sort_order = 0 WHERE id = ?').run(id)
    sibs.forEach((s, i) =>
      db.prepare('UPDATE brand_folders SET sort_order = ? WHERE id = ?').run(i + 1, s.id)
    )
  })
  tx()
  return { ok: true }
}

/** 分组级同步开关（只改这一条；生效值在 listBrandFolders 里按祖先链算） */
export function setBrandFolderSync(id: number, on: boolean): BrandOpResult {
  const f = getBrandFolder(id)
  if (!f) return { ok: false, error: 'not-found' }
  getDb()
    .prepare('UPDATE brand_folders SET sync_to_plugin = ? WHERE id = ?')
    .run(on ? 1 : 0, id)
  return { ok: true }
}

/**
 * 删组：**组内文件（含子组）移到「未分组」，绝不删文件**（用户拍板 #2）。
 * 「未分组」= 直接躺在 `<根>\` 下的文件（folder_id = NULL，不进插件镜像）。
 */
export function deleteBrandFolder(input: {
  workspaceRoot: string
  id: number
}): BrandOpResult<{ moved: number }> {
  const { workspaceRoot, id } = input
  const f = getBrandFolder(id)
  if (!f) return { ok: false, error: 'not-found' }
  const db = getDb()
  const root = brandRootPath(workspaceRoot)

  const ids = [id, ...descendantFolderIds(allFolderRows(), id)]
  // ⚠️ 要清的目录路径必须**提前**算好 —— 记录一删，`brandFolderDir` 就查不到了（子组会漏清）
  const dirsToClean = ids
    .map((fid) => {
      const row = allFolderRows().find((x) => x.id === fid)
      return row ? join(workspaceRoot, row.rel_path) : ''
    })
    .filter(Boolean)
    .sort((a, b) => b.length - a.length) // 深的先删（子组在父组之内）
  const rows = db
    .prepare(`SELECT * FROM brand_assets WHERE folder_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as BrandAssetRow[]

  let moved = 0
  const tx = db.transaction(() => {
    for (const a of rows) {
      let dest = uniqueFile(root, a.file_name)
      try {
        if (existsSync(a.abs_path)) renameSync(a.abs_path, dest)
        else dest = a.abs_path
      } catch {
        // 挪不动就保留原路径（至少不丢记录）
        dest = a.abs_path
      }
      db.prepare('UPDATE brand_assets SET folder_id = NULL, abs_path = ?, rel_path = ? WHERE id = ?')
        .run(dest, relative(workspaceRoot, dest), a.id)
      moved += 1
    }
    // 后代组先删（深的先删），再删自己（记录级：素材已挪走，不会被 CASCADE 带走）
    for (const fid of ids) {
      if (fid === id) continue
      db.prepare('DELETE FROM brand_folders WHERE id = ?').run(fid)
    }
    db.prepare('DELETE FROM brand_folders WHERE id = ?').run(id)
  })
  tx()

  // 磁盘目录：只剩空目录才清（尽力而为，失败不影响记录）
  for (const dir of dirsToClean) {
    if (!existsSync(dir)) continue
    try {
      // 第 65 批：目录里可能只剩**被忽略的隐藏名文件**（macOS `._xxx` / `.DS_Store`）——
      // 它们不归库管（扫描不登记），但挡着 `rmdirSync` 会让目录删不掉 → 下次扫描又把它认领回来，
      // 「删组」等于白删。先把它们挪进 `_回收站`（**不删文件**，与「移出素材」同一去处），再删空目录。
      const left = readdirSync(dir)
      const ignoredOnly = left.length > 0 && left.every((n) => isHiddenName(n))
      if (ignoredOnly) {
        const trashDir = join(workspaceRoot, TRASH_DIR)
        mkdirSync(trashDir, { recursive: true })
        for (const n of left) {
          try {
            renameSync(join(dir, n), uniqueFile(trashDir, n))
          } catch {
            /* 挪不动就留着，目录也就留着（宁可留目录，也不删文件） */
          }
        }
      }
      // ⚠️ `rmSync` 删目录必须 recursive；这里要的是"非空就不删"的语义 → 用 rmdirSync
      if (readdirSync(dir).length === 0) rmdirSync(dir)
    } catch {
      /* 非空 / 被占用就留着 */
    }
  }
  return { ok: true, value: { moved } }
}

// ---------------------------------------------------------------- 扫描（磁盘 → 库）

export interface BrandScanResult {
  folders: number
  assets: number
  newAssets: number
  missing: number
  /** 被跳过的三层以上目录数（只做两层，给它一个提示口径） */
  skippedDeep: number
  /** 本次清理掉的隐藏名脏记录数（macOS `._xxx` / `.DS_Store`；只清记录、磁盘零改动） */
  pruned: number
  thumbs: number
}

/**
 * 扫 `<根>`（两层）→ 认领文件夹与素材。**只登记，永不删用户文件。**
 * 规则：
 *  · 顶层目录（不以 `_` / `.` 开头）→ 顶层组；其子目录 → 子组；**再往下跳过**并计数。
 *  · 直接躺在根下 / 组目录下的文件 → 记为该组素材（根下的 folder_id = NULL = 未分组）。
 *  · 磁盘上已不存在的记录 → 打 `missing_at`（照第 8 批口径，**不删记录**）。
 *
 * ⚠️ **第 65 批 bug 修复**：文件名以 `_` / `.` 开头的**一律不算素材**（`listFiles` 里已过滤）——
 * macOS 把文件拷到 exFAT / 网络盘时，会给每个文件配一个 `._xxx.jpg`（AppleDouble 副作用文件，
 * 固定 4096 字节、内容是资源分支元数据，跟真实素材无关），`.DS_Store` 同理；不挡的话它们会顶满素材墙。
 * （与任务库 `collectFiles` 同一口径。）库里**已登记的**同类脏记录也在本次扫描一并摘掉（只摘记录、磁盘零改动）。
 */
export async function scanBrand(workspaceRoot: string): Promise<BrandScanResult> {
  ensureBrandRoot(workspaceRoot)
  const db = getDb()
  const root = brandRootPath(workspaceRoot)
  const ts = nowIso()
  const out: BrandScanResult = {
    folders: 0,
    assets: 0,
    newAssets: 0,
    missing: 0,
    skippedDeep: 0,
    pruned: 0,
    thumbs: 0
  }

  const skipHidden = isHiddenName
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
        // 第 65 批：隐藏名文件（`._xxx` AppleDouble / `.DS_Store`）不是素材，不收
        .filter((d) => d.isFile() && !skipHidden(d.name))
        .map((d) => join(p, d.name))
    } catch {
      return []
    }
  }

  const folderByRel = new Map(allFolderRows().map((f) => [f.rel_path.toLowerCase(), f]))
  const insFolder = db.prepare(
    `INSERT INTO brand_folders (parent_id, name, sort_order, rel_path, sync_to_plugin, source, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  )
  const ensureFolder = (
    parentId: number | null,
    name: string,
    rel: string,
    order: number,
    source: string
  ): BrandFolderRow => {
    const hit = folderByRel.get(rel.toLowerCase())
    if (hit) return hit
    const info = insFolder.run(parentId, name, order, rel, source, ts)
    const row = getBrandFolder(Number(info.lastInsertRowid))!
    folderByRel.set(rel.toLowerCase(), row)
    out.folders += 1
    return row
  }

  const files: Array<{ abs: string; folderId: number | null; source: string }> = []
  /**
   * 递归认领（**任意层，上限 BRAND_MAX_DEPTH**）。
   * 2026-10-17 前这里是写死的两层 + 「三层及以上跳过」—— 放开多层后改成递归，
   * 超过 5 层的目录仍然跳过并计数（`skippedDeep`，界面会提示）。
   */
  const walk = (
    dir: string,
    parentId: number | null,
    parentSource: string,
    level: number
  ): void => {
    const source = parentId === null ? 'user' : parentSource
    for (const abs of listFiles(dir)) files.push({ abs, folderId: parentId, source })
    let order = 0
    for (const name of listDirs(dir)) {
      if (skipHidden(name)) continue
      if (level + 1 > BRAND_MAX_DEPTH) {
        out.skippedDeep += 1
        continue // 超过 5 层：不登记，也不再往下
      }
      const sub = join(dir, name)
      const subRel = relative(workspaceRoot, sub)
      const row = ensureFolder(parentId, name, subRel, order++, source)
      walk(sub, row.id, row.source, level + 1)
    }
  }
  walk(root, null, 'user', 0)

  const existsStmt = db.prepare('SELECT id FROM brand_assets WHERE abs_path = ?')
  const upsert = db.prepare(
    `INSERT INTO brand_assets
       (folder_id, file_name, ext, size, abs_path, rel_path, source, created_at, modified_at, scanned_at)
     VALUES (@folder_id, @file_name, @ext, @size, @abs_path, @rel_path, @source, @created_at, @modified_at, @scanned_at)
     ON CONFLICT(abs_path) DO UPDATE SET
       folder_id   = excluded.folder_id,
       file_name   = excluded.file_name,
       ext         = excluded.ext,
       size        = excluded.size,
       rel_path    = excluded.rel_path,
       source      = excluded.source,
       modified_at = excluded.modified_at,
       scanned_at  = excluded.scanned_at,
       missing_at  = NULL`
  )
  const tx = db.transaction((list: typeof files) => {
    for (const item of list) {
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
        source: item.source,
        created_at: st.birthtime.toISOString(),
        modified_at: st.mtime.toISOString(),
        scanned_at: ts
      })
    }
  })
  tx(files)

  // 第 65 批：清理隐藏名脏记录（macOS `._xxx.jpg` / `.DS_Store` 之类）。
  // `._xxx` 是 macOS 给每个文件配的 AppleDouble 副作用文件，从来不是素材 —— 扫描已不再登记它们
  // （见 `listFiles`）；库里**修复前已登记的**同类记录也一并摘掉，否则它们会以「文件已丢失」
  // 的形态继续显示在素材墙上。与第 7 批「包记录清理」同一规矩：**只摘记录、磁盘零改动**，摘前留痕。
  const junkRows = (
    db
      .prepare('SELECT id, file_name, abs_path, rel_path, ext, size FROM brand_assets')
      .all() as Array<{
      id: number
      file_name: string
      abs_path: string
      rel_path: string
      ext: string
      size: number
    }>
  ).filter((r) => skipHidden(r.file_name))
  if (junkRows.length) {
    try {
      const bkDir = join(workspaceRoot, '_system', 'backup')
      mkdirSync(bkDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      writeFileSync(
        join(bkDir, `brand-junk-${stamp}.json`),
        JSON.stringify(
          { at: ts, reason: 'hidden-name', count: junkRows.length, records: junkRows },
          null,
          2
        ),
        'utf-8'
      )
    } catch {
      /* 留痕失败不拦住清理本身（记录本来就该走） */
    }
    const del = db.prepare('DELETE FROM brand_assets WHERE id = ?')
    const txDel = db.transaction((ids: number[]) => {
      for (const id of ids) del.run(id)
    })
    txDel(junkRows.map((r) => r.id))
    out.pruned = junkRows.length
  }

  // 失效检查：磁盘上已无 → 打标记（不删记录）
  for (const a of db.prepare('SELECT id, abs_path, missing_at FROM brand_assets').all() as Array<{
    id: number
    abs_path: string
    missing_at: string | null
  }>) {
    const gone = !existsSync(a.abs_path)
    if (gone && a.missing_at === null) {
      db.prepare('UPDATE brand_assets SET missing_at = ? WHERE id = ?').run(ts, a.id)
      out.missing += 1
    }
  }
  out.assets = (db.prepare('SELECT COUNT(*) AS c FROM brand_assets').get() as { c: number }).c

  out.thumbs = await ensureBrandThumbsAndMeta(workspaceRoot)
  return out
}

/** 补缩略图 + 位图/视频元信息（图片尺寸、PSD 画布、视频时长） */
export async function ensureBrandThumbsAndMeta(workspaceRoot: string): Promise<number> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, abs_path, ext, size, thumb_path, width, duration_ms, modified_at
         FROM brand_assets`
    )
    .all() as Array<{
    id: number
    abs_path: string
    ext: string
    size: number
    thumb_path: string | null
    width: number | null
    duration_ms: number | null
    modified_at: string
  }>
  let n = 0
  const updThumb = db.prepare('UPDATE brand_assets SET thumb_path = ? WHERE id = ?')
  const updMeta = db.prepare(
    'UPDATE brand_assets SET width = ?, height = ?, color_mode = ?, duration_ms = ?, video_codec = ?, probe_info = ? WHERE id = ?'
  )
  for (const r of rows) {
    if (!r.thumb_path && (isImage(r.ext) || isVideo(r.ext) || isPsd(r.ext) || isPdf(r.ext))) {
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
    if (r.width === null) {
      try {
        if (isImage(r.ext)) {
          const m = await readImageMeta(r.abs_path)
          updMeta.run(m.width, m.height, m.colorMode, null, null, null, r.id)
        } else if (isPsd(r.ext)) {
          const m = await readPsdMeta(r.abs_path)
          updMeta.run(m.width, m.height, m.colorMode, null, null, null, r.id)
        }
      } catch {
        /* 元信息失败不阻断 */
      }
    }
    if (r.duration_ms === null && isVideo(r.ext)) {
      try {
        const m = await readVideoMeta(r.abs_path)
        updMeta.run(
          m.width,
          m.height,
          null,
          m.durationMs,
          m.videoCodec,
          m.probeInfo,
          r.id
        )
      } catch {
        /* 忽略 */
      }
    }
  }
  return n
}

// ---------------------------------------------------------------- 导入 / 提升 / 复制到任务 / 移除

export interface BrandImportResult {
  ok: boolean
  error?: string
  /** 复制进来的文件数 */
  imported: number
  /** 因为同名而自动改名（-2 -3）的文件数 */
  renamed: number
  /** 新建的组数（拖入文件夹时） */
  createdFolders: number
}

/**
 * 批量导入（复制，**不动源文件**）。
 * · 文件 → 复制进 `folderId` 指定组（不传 = 未分组，直接落根下）
 * · 文件夹 → **按文件夹名建组**：目标组是顶层组时建成它的子组，否则建成顶层组
 */
export function importBrandPaths(input: {
  workspaceRoot: string
  paths: string[]
  folderId?: number | null
}): BrandImportResult {
  const { workspaceRoot, paths } = input
  ensureBrandRoot(workspaceRoot)
  const out: BrandImportResult = { ok: true, imported: 0, renamed: 0, createdFolders: 0 }
  const targetId = input.folderId ?? null
  let targetDir = targetId === null ? brandRootPath(workspaceRoot) : brandFolderDir(workspaceRoot, targetId)
  if (!targetDir) return { ...out, ok: false, error: 'no-target' }
  mkdirSync(targetDir, { recursive: true })

  const copyInto = (dir: string, srcFile: string): void => {
    const dest = uniqueFile(dir, basename(srcFile))
    if (basename(dest) !== basename(srcFile)) out.renamed += 1
    copyFileSync(srcFile, dest)
    out.imported += 1
  }

  for (const p of paths) {
    // 第 65 批：导入时也跳过隐藏名条目（macOS `._xxx` / `.DS_Store`）——
    // 否则「从 Mac 导文件夹」会把同批垃圾一并复制进库（虽然扫描不收，但白占磁盘）。
    if (isHiddenName(basename(p))) continue
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isFile()) {
      copyInto(targetDir, p)
      continue
    }
    if (!st.isDirectory()) continue
    // 文件夹：建组 + 把里面的文件（含一层子目录）搬进来
    const target = getBrandFolder(targetId ?? -1)
    const parentId = target && target.parent_id === null ? target.id : null
    const made = createBrandFolder({
      workspaceRoot,
      name: basename(p),
      parentId
    })
    if (!made.ok || !made.value) continue
    out.createdFolders += 1
    const groupDir = brandFolderDir(workspaceRoot, made.value.id)!
    mkdirSync(groupDir, { recursive: true })
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      if (isHiddenName(entry.name)) continue
      const abs = join(p, entry.name)
      if (entry.isFile()) copyInto(groupDir, abs)
      else if (entry.isDirectory()) {
        const sub = createBrandFolder({ workspaceRoot, name: entry.name, parentId: made.value.id })
        if (sub.ok && sub.value) {
          out.createdFolders += 1
          const subDir = brandFolderDir(workspaceRoot, sub.value.id)!
          mkdirSync(subDir, { recursive: true })
          for (const f of readdirSync(abs, { withFileTypes: true })) {
            if (isHiddenName(f.name)) continue
            if (f.isFile()) copyInto(subDir, join(abs, f.name))
          }
        }
      }
    }
  }
  void ensureBrandThumbsAndMeta(workspaceRoot)
  return out
}

/**
 * 【提升】把任务库里的一条素材**复制**一份进通用库（不动原文件）。
 * `source` 由目标组决定（顶层「公司素材」下 = company，其余 = user）。
 * ⚠️ 复制完请调用方再跑一次 `scanBrand()` 把新文件登记进来（本函数只负责落文件）。
 */
export function promoteAssetToBrand(input: {
  workspaceRoot: string
  assetId: number
  folderId: number
}): BrandOpResult {
  const { workspaceRoot, assetId, folderId } = input
  ensureBrandRoot(workspaceRoot)
  const src = getDb()
    .prepare('SELECT id, abs_path, file_name FROM assets WHERE id = ?')
    .get(assetId) as { id: number; abs_path: string; file_name: string } | undefined
  if (!src) return { ok: false, error: 'no-asset' }
  const folder = getBrandFolder(folderId)
  if (!folder) return { ok: false, error: 'no-folder' }
  const dir = brandFolderDir(workspaceRoot, folderId)!
  if (!existsSync(src.abs_path)) return { ok: false, error: 'missing-file' }
  mkdirSync(dir, { recursive: true })
  copyFileSync(src.abs_path, uniqueFile(dir, src.file_name))
  return { ok: true }
}

/** 【复制到任务】把通用库的一条素材复制进某个任务包的 `02-素材`；然后整库扫一遍把新文件登记进 `assets`。 */
export function copyBrandAssetToPack(input: {
  workspaceRoot: string
  brandAssetId: number
  packId: number
}): BrandOpResult<{ dest: string }> {
  const { workspaceRoot, brandAssetId, packId } = input
  const src = getDb()
    .prepare('SELECT abs_path, file_name FROM brand_assets WHERE id = ?')
    .get(brandAssetId) as { abs_path: string; file_name: string } | undefined
  if (!src) return { ok: false, error: 'no-asset' }
  const pack = getDb()
    .prepare('SELECT folder_path FROM packs WHERE id = ?')
    .get(packId) as { folder_path: string } | undefined
  if (!pack) return { ok: false, error: 'no-pack' }
  if (!existsSync(src.abs_path)) return { ok: false, error: 'missing-file' }
  const sub = join(pack.folder_path, '02-素材')
  mkdirSync(sub, { recursive: true })
  const dest = uniqueFile(sub, src.file_name)
  copyFileSync(src.abs_path, dest)
  // 让既有扫描把新文件登记进 assets（复用审计过的通路，不另写一遍插入逻辑）
  scanAll(workspaceRoot)
  return { ok: true, value: { dest } }
}

/**
 * 从通用库移除一条素材 —— 文件**移进 `_回收站`**（软件永不静默删用户东西），再删记录。
 */
export function removeBrandAsset(input: {
  workspaceRoot: string
  id: number
}): BrandOpResult {
  const { workspaceRoot, id } = input
  const a = getDb().prepare('SELECT * FROM brand_assets WHERE id = ?').get(id) as
    | BrandAssetRow
    | undefined
  if (!a) return { ok: false, error: 'not-found' }
  const trashDir = join(workspaceRoot, TRASH_DIR)
  try {
    mkdirSync(trashDir, { recursive: true })
    if (existsSync(a.abs_path)) {
      const dest = uniqueFile(trashDir, a.file_name)
      renameSync(a.abs_path, dest)
    }
  } catch {
    // 挪不进回收站就**不删记录**（宁可留个记录，也不装作删掉了）
    return { ok: false, error: 'trash-failed' }
  }
  getDb().prepare('DELETE FROM brand_assets WHERE id = ?').run(id)
  return { ok: true }
}

/** 删除一条素材的库记录但**保留文件**（给"只是不想让它出现在库里"用） */
export function forgetBrandAsset(id: number): BrandOpResult {
  const a = getDb().prepare('SELECT id FROM brand_assets WHERE id = ?').get(id)
  if (!a) return { ok: false, error: 'not-found' }
  getDb().prepare('DELETE FROM brand_assets WHERE id = ?').run(id)
  return { ok: true }
}

/** 排障/测试用：检查某组（或根）的目录是否真实存在 */
export function brandDirExists(workspaceRoot: string, folderId: number | null): boolean {
  const dir =
    folderId === null ? brandRootPath(workspaceRoot) : brandFolderDir(workspaceRoot, folderId)
  return !!dir && existsSync(dir)
}

/** 第 67 批（docs/50 §6）批量移动的结果 —— 三段分开报，界面才能说清"到底发生了什么" */
export interface MoveAssetsResult {
  /** 真的搬走了几条（含"文件已丢、只改登记"的） */
  moved: number
  /** 本来就在目标分组，跳过 */
  skipped: number
  /** 失败的逐条带上原因（不中断整批） */
  failed: Array<{ id: number; name: string; error: string }>
}

/**
 * 第 67 批（docs/50）：**批量移动素材到另一个分组**（列表视图勾选后的主操作）。
 *
 * 这是本批唯一会**同时改磁盘和数据库**的动作，几条口径必须钉死：
 * 1. **磁盘先动、登记后改**：`rename` 成功才更新 `folder_id / file_name / rel_path / abs_path`。
 *    反过来（先改登记再搬文件）一旦搬失败，就会出现"登记说在 A 组、文件还在 B 组"的幽灵记录。
 * 2. **同名自动加序号**（复用导入那套 `uniqueFile`）：目标组里已有同名文件时改成 `x-2.png`，
 *    **并把新的 file_name 写回登记** —— 否则界面上显示的名字和磁盘对不上。
 * 3. **文件已丢失的只改登记**：不报错、不动磁盘；重新扫描时它会按新位置重新认领。
 * 4. **逐条做、失败不中断**：一条被 PS 占用（EPERM/EBUSY）不该让剩下 20 条都不动。
 *    ⇒ 返回 `{ moved, skipped, failed[] }`，界面按"成功 N / 失败 M + 第一条原因"提示。
 * 5. **目标组必须真实存在**：组被删了 / 传了脏 id ⇒ 整批拒绝（`no-target`），
 *    绝不把文件搬进一个"磁盘上没有对应组的目录"。
 *
 * 跨盘不是问题：库根与所有分组都在 `_通用素材库\` 下，天然同盘。
 */
export function moveBrandAssets(input: {
  workspaceRoot: string
  ids: number[]
  /** **-1 = 移到「未分组」**（库根）；数字 = 目标组 id（与 `listBrandAssets` 的约定一致） */
  targetFolderId: number
}): BrandOpResult<MoveAssetsResult> {
  const { workspaceRoot, ids } = input
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'empty' }

  const targetId = input.targetFolderId === -1 ? null : input.targetFolderId
  const db = getDb()
  if (targetId !== null && !getBrandFolder(targetId)) return { ok: false, error: 'no-target' }

  const targetDir =
    targetId === null ? brandRootPath(workspaceRoot) : brandFolderDir(workspaceRoot, targetId)
  if (!targetDir) return { ok: false, error: 'no-target' }
  mkdirSync(targetDir, { recursive: true })

  let moved = 0
  let skipped = 0
  const failed: MoveAssetsResult['failed'] = []

  for (const id of ids) {
    const a = db.prepare('SELECT * FROM brand_assets WHERE id = ?').get(id) as
      | BrandAssetRow
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
      // 记录在、文件没了（缺失态）：只改登记，等下次扫描按新位置认领
      db.prepare('UPDATE brand_assets SET folder_id = ? WHERE id = ?').run(targetId, id)
      moved += 1
      continue
    }

    try {
      const dest = uniqueFile(targetDir, a.file_name)
      renameSync(a.abs_path, dest)
      db.prepare(
        `UPDATE brand_assets
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

/** 批量「复制到任务」的结果（第 68 批 · docs/50 §6） */
export interface BulkCopyResult {
  copied: number
  failed: Array<{ id: number; name: string; error: string }>
}

/**
 * 第 68 批（docs/50 §6）：**批量复制到任务包**（复制进任务的 `02-素材`，原文件不动）。
 *
 * 为什么不直接循环调 `copyBrandAssetToPack`：那条**每调一次就 `scanAll` 全盘扫一遍** ——
 * 勾 20 条就是 20 次全盘扫描，工作区几千文件时会卡到没法用。
 * 这里一次复制完，**只扫一次**，把新文件登记进任务库的 `assets`。
 */
export function copyBrandAssetsToPack(input: {
  workspaceRoot: string
  ids: number[]
  packId: number
}): BrandOpResult<BulkCopyResult> {
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
    const src = db.prepare('SELECT abs_path, file_name FROM brand_assets WHERE id = ?').get(id) as
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
  // 只扫一次（有复制才扫）
  if (copied > 0) scanAll(workspaceRoot)
  return { ok: failed.length === 0, value: { copied, failed } }
}

/** 序号化改名的结果 */
export interface SeqRenameResult {
  renamed: number
  /** 名字已经是目标样子的（没动） */
  skipped: number
  failed: Array<{ id: number; name: string; error: string }>
}

/** 文件名里不能出现的字符（Windows）+ 前后空格；空则退回「素材」。模板库也用它 */
export function safeBaseName(raw: string): string {
  const t = raw
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.+$/, '')
    .trim()
  return t || '素材'
}

/**
 * 第 68 批（docs/50 §6）：**序号化批量改名**（模板库收模板的主场景）。
 *
 * 目标名 = `<前缀>-<序号><原扩展名>`，序号从 `start` 起、按传入顺序排、左补 0 到 `pad` 位。
 *
 * 🔴 **必须两阶段**：先把这批文件都改成临时名，再改成目标名。
 * 否则"A 要改成 B、B 要改成 C"时，A 会先覆盖掉 B —— 文件名互换是最经典的覆盖事故。
 *
 * 其它口径：
 * · 只动**没丢失**的文件；丢失的只改登记里的 `file_name`（等重扫时按新名字找不到也没关系，
 *   因为文件本身就不在了）—— 实际上丢失的**直接跳过**更安全，免得制造"名字对不上"的假记录。
 * · 目标名如果被**本批之外**的文件占着 ⇒ 加 `-2`/`-3`（不覆盖别人）。
 * · 中途失败会尽力把临时名改回去，最后如实报告。
 */
export function renameBrandAssetsSeq(input: {
  workspaceRoot: string
  ids: number[]
  prefix: string
  start: number
  pad: number
}): BrandOpResult<SeqRenameResult> {
  const { workspaceRoot, ids } = input
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'empty' }
  const base = safeBaseName(input.prefix)
  const start = Math.max(0, Math.min(9999, Math.floor(input.start || 1)))
  const pad = Math.max(1, Math.min(4, Math.floor(input.pad || 2)))

  const db = getDb()
  const rows: BrandAssetRow[] = []
  const failed: SeqRenameResult['failed'] = []
  for (const id of ids) {
    const a = db.prepare('SELECT * FROM brand_assets WHERE id = ?').get(id) as
      | BrandAssetRow
      | undefined
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

  // ---- 阶段一：全部先改成临时名（同目录，不跨盘） ----
  // 🔴 临时名**必须同步写进 DB**：只改磁盘不改登记的话，阶段二把 `素材-03` 改成 `素材-01` 时，
  //    登记里还留着一条旧 `素材-01` ⇒ `abs_path` 撞 UNIQUE（实测报 UNIQUE constraint failed）。
  // 临时名用 `~seq-` 而不是 `.seq-`：`.` 开头的文件会被扫描跳过，中途崩了就成了"隐身文件"；
  // `~` 开头会被正常认领，至少能看见、能找回。
  const stage: Array<{ row: BrandAssetRow; tmp: string }> = []
  for (let i = 0; i < rows.length; i += 1) {
    const a = rows[i]
    const ext = extname(a.file_name)
    const tmp = join(dirname(a.abs_path), `~seq-${takeSuffix}-${i}${ext}`)
    try {
      renameSync(a.abs_path, tmp)
      db.prepare(
        'UPDATE brand_assets SET file_name = ?, abs_path = ?, rel_path = ? WHERE id = ?'
      ).run(basename(tmp), tmp, relative(workspaceRoot, tmp), a.id)
      stage.push({ row: a, tmp })
    } catch (e) {
      failed.push({ id: a.id, name: a.file_name, error: (e as Error).message || 'rename-failed' })
    }
  }

  // ---- 阶段二：临时名 → 目标名 ----
  let renamed = 0
  let skipped = 0
  /** 序号按**实际处理的顺序**连续走（不按 ids 下标）—— 中间有失败的不该留下空号 */
  let seq = 0
  for (const { row: a, tmp } of stage) {
    const ext = extname(a.file_name)
    const wanted = wantName(seq, ext)
    seq += 1
    const dest = uniqueFile(dirname(tmp), wanted)
    try {
      renameSync(tmp, dest)
      db.prepare(
        'UPDATE brand_assets SET file_name = ?, abs_path = ?, rel_path = ? WHERE id = ?'
      ).run(basename(dest), dest, relative(workspaceRoot, dest), a.id)
      if (basename(dest) === a.file_name) skipped += 1
      else renamed += 1
    } catch (e) {
      // 尽力改回原名（磁盘 + 登记一起），避免留下 `~seq-*` 幽灵文件
      try {
        const back = join(dirname(tmp), a.file_name)
        renameSync(tmp, back)
        db.prepare(
          'UPDATE brand_assets SET file_name = ?, abs_path = ?, rel_path = ? WHERE id = ?'
        ).run(a.file_name, back, relative(workspaceRoot, back), a.id)
      } catch {
        /* 尽力而为 */
      }
      failed.push({ id: a.id, name: a.file_name, error: (e as Error).message || 'rename-failed' })
    }
  }

  return { ok: failed.length === 0, value: { renamed, skipped, failed } }
}
