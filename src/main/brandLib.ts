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
/** 两层封顶：顶层 = 1，子组 = 2 */
export const BRAND_MAX_DEPTH = 2

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

/** 磁盘上找一个不撞名的目录（组名重复时自动 -2 -3） */
function uniqueDir(baseDir: string, name: string): string {
  let p = join(baseDir, name)
  let i = 2
  while (existsSync(p)) {
    p = join(baseDir, `${name}-${i}`)
    i += 1
  }
  return p
}

/** 磁盘上找一个不撞名的文件名（导入同名文件时自动 -2 -3） */
function uniqueFile(dir: string, fileName: string): string {
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
  /** 1 = 顶层，2 = 子组 */
  depth: number
  /** 生效同步 = 自身与所有祖先都为 1（父关则子关） */
  effectiveSync: boolean
  /** 直属素材数 */
  assetCount: number
  /** 含子组的素材总数 */
  totalCount: number
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

/** 组树（含 depth / 生效同步 / 素材计数）。按「顶层在前、各自按 sort_order」排。 */
export function listBrandFolders(): BrandFolderNode[] {
  const rows = allFolderRows()
  const byId = new Map(rows.map((r) => [r.id, r]))
  const depthOf = (r: BrandFolderRow): number => (r.parent_id === null ? 1 : 2)
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
  const self: BrandFolderNode[] = rows.map((r) => {
    const direct = counts.get(r.id) ?? 0
    const children = rows.filter((x) => x.parent_id === r.id)
    return {
      ...r,
      depth: depthOf(r),
      effectiveSync: effective(r),
      assetCount: direct,
      totalCount: direct + children.reduce((n, c) => n + (counts.get(c.id) ?? 0), 0)
    }
  })
  const rank = (n: BrandFolderNode): [number, number, number] => [
    n.depth,
    n.parent_id ?? 0,
    n.sort_order
  ]
  return self.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra[0] !== rb[0]) return ra[0] - rb[0]
    // 顶层按 sort_order；子组先按父组、再按 sort_order
    if (a.parent_id === null && b.parent_id === null) return a.sort_order - b.sort_order || a.id - b.id
    if (ra[1] !== rb[1]) return ra[1] - rb[1]
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
    const ids = new Set<number>([o.folderId])
    for (const f of allFolderRows()) if (f.parent_id === o.folderId) ids.add(f.id)
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

/** 新建组。`parentId = null` 建顶层组；否则建子组（**两层封顶**，第三层拒绝）。 */
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

  if (parentId !== null) {
    const parent = getBrandFolder(parentId)
    if (!parent) return { ok: false, error: 'no-parent' }
    if (parent.parent_id !== null) return { ok: false, error: 'depth' } // 只做两层
  }
  const dup = db
    .prepare(
      parentId === null
        ? 'SELECT id FROM brand_folders WHERE parent_id IS NULL AND name = ?'
        : 'SELECT id FROM brand_folders WHERE parent_id = ? AND name = ?'
    )
    .get(...(parentId === null ? [name] : [parentId, name]))
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
    // 子组的 rel_path 前缀跟着改；其素材的 abs_path / rel_path 也改
    const kids = db
      .prepare('SELECT id, rel_path FROM brand_folders WHERE parent_id = ?')
      .all(id) as Array<{ id: number; rel_path: string }>
    for (const k of kids) {
      const kRel = newRel + k.rel_path.slice(f.rel_path.length)
      db.prepare('UPDATE brand_folders SET rel_path = ? WHERE id = ?').run(kRel, k.id)
    }
    db.prepare(
      `UPDATE brand_assets
         SET rel_path = ? || substr(rel_path, ?), abs_path = ? || substr(abs_path, ?)
       WHERE abs_path LIKE ? ESCAPE '\\'`
    ).run(newRel, f.rel_path.length + 1, newAbs, oldAbs.length + 1, `${oldAbs}\\%`)
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

  const ids = [id, ...allFolderRows().filter((x) => x.parent_id === id).map((x) => x.id)]
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
    // 子组先删，再删自己（记录级：素材已挪走，不会被 CASCADE 带走）
    db.prepare('DELETE FROM brand_folders WHERE parent_id = ?').run(id)
    db.prepare('DELETE FROM brand_folders WHERE id = ?').run(id)
  })
  tx()

  // 磁盘目录：只剩空目录才清（尽力而为，失败不影响记录）
  for (const dir of dirsToClean) {
    if (!existsSync(dir)) continue
    try {
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
  thumbs: number
}

/**
 * 扫 `<根>`（两层）→ 认领文件夹与素材。**只登记，永不删用户文件。**
 * 规则：
 *  · 顶层目录（不以 `_` / `.` 开头）→ 顶层组；其子目录 → 子组；**再往下跳过**并计数。
 *  · 直接躺在根下 / 组目录下的文件 → 记为该组素材（根下的 folder_id = NULL = 未分组）。
 *  · 磁盘上已不存在的记录 → 打 `missing_at`（照第 8 批口径，**不删记录**）。
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
    thumbs: 0
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
  let order = 0
  for (const topName of listDirs(root)) {
    if (skipHidden(topName)) continue
    const topDir = join(root, topName)
    const topRel = relative(workspaceRoot, topDir)
    const top = ensureFolder(null, topName, topRel, order++, 'user')
    for (const abs of listFiles(topDir)) files.push({ abs, folderId: top.id, source: top.source })

    let sub = 0
    for (const subName of listDirs(topDir)) {
      if (skipHidden(subName)) continue
      const subDir = join(topDir, subName)
      const subRel = relative(workspaceRoot, subDir)
      const child = ensureFolder(top.id, subName, subRel, sub++, top.source)
      for (const abs of listFiles(subDir)) files.push({ abs, folderId: child.id, source: child.source })
      // 三层及以上：跳过（用户拍板 #1）
      for (const deep of listDirs(subDir)) {
        if (skipHidden(deep)) continue
        out.skippedDeep += 1
      }
    }
  }
  // 根下直接躺着的文件 → 「未分组」
  for (const abs of listFiles(root)) files.push({ abs, folderId: null, source: 'user' })

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
      const abs = join(p, entry.name)
      if (entry.isFile()) copyInto(groupDir, abs)
      else if (entry.isDirectory()) {
        const sub = createBrandFolder({ workspaceRoot, name: entry.name, parentId: made.value.id })
        if (sub.ok && sub.value) {
          out.createdFolders += 1
          const subDir = brandFolderDir(workspaceRoot, sub.value.id)!
          mkdirSync(subDir, { recursive: true })
          for (const f of readdirSync(abs, { withFileTypes: true })) {
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
