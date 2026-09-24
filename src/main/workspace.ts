import { join, basename, extname, relative, sep } from 'path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  unlinkSync
} from 'fs'
import { getDb, openDb, type AssetRow, type PackRow } from './db'

/**
 * 工作区与「包」的业务逻辑。
 * 对应方案文档：A-01 建包 / A-02 工作区初始化 / A-03 扫描归位 / A-04 采集基础信息 / A-09 认领
 */

/** 三个子文件夹，顺序即界面展示顺序（方案 2.3） */
export const SUB_FOLDERS = ['01-成品', '02-素材', '03-工程'] as const
export type SubFolder = (typeof SUB_FOLDERS)[number]

/** 子文件夹 → role 的映射。归类只认「放在哪个子文件夹」，不猜后缀 */
const FOLDER_TO_ROLE: Record<string, string> = {
  '01-成品': '成品',
  '02-素材': '素材',
  '03-工程': '工程',
}

export const UNASSIGNED_ROLE = '未归属'

// ---------------------------------------------------------------- 工作区路径

/**
 * 工作区根目录固定 D:\素材工作区（方案 6.0）。
 * 路径记在配置文件里而不是数据库里 —— 数据库本身就在工作区内。
 */
export const DEFAULT_WORKSPACE = 'D:\\素材工作区'

export function getWorkspaceRoot(appDataDir: string): string {
  const cfgPath = join(appDataDir, 'workspace.json')
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'))
      if (cfg && typeof cfg.workspaceRoot === 'string' && cfg.workspaceRoot.trim()) {
        return cfg.workspaceRoot
      }
    } catch {
      // 配置坏了就回落到默认值，不阻断启动
    }
  }
  saveWorkspaceRoot(appDataDir, DEFAULT_WORKSPACE)
  return DEFAULT_WORKSPACE
}

export function saveWorkspaceRoot(appDataDir: string, workspaceRoot: string): void {
  mkdirSync(appDataDir, { recursive: true })
  writeFileSync(
    join(appDataDir, 'workspace.json'),
    JSON.stringify({ workspaceRoot }, null, 2),
    'utf-8'
  )
}

/** A-02：工作区首次初始化 —— 建根目录、_thumbs、_system、数据库 */
export function initWorkspace(workspaceRoot: string): void {
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(join(workspaceRoot, '_thumbs'), { recursive: true })
  openDb(workspaceRoot) // 内部会建 _system/media.db
}

// ---------------------------------------------------------------- 建包 A-01

function nowIso(): string {
  return new Date().toISOString()
}

/** 包名称留空时的兜底取名（方案 6.0） */
export function fallbackPackName(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `未命名任务-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 文件夹名消毒：去掉 Windows 不允许的字符 */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
}

/** 同路径重名时自动加后缀 -2 -3 */
function uniqueFolderPath(workspaceRoot: string, baseName: string): string {
  let candidate = join(workspaceRoot, baseName)
  let i = 2
  while (existsSync(candidate)) {
    candidate = join(workspaceRoot, `${baseName}-${i}`)
    i += 1
    if (i > 999) break
  }
  return candidate
}

export interface CreatePackInput {
  name?: string
  project?: string
  category?: string
  workspaceRoot: string
}

/**
 * A-01：新建任务包 —— 硬盘上建文件夹 + 自动建三个子文件夹 + 落库。
 * 名称不校验、不拦截，留空用兜底名（方案 2.2 / 6.0）。
 */
export function createPack(input: CreatePackInput): PackRow {
  const db = getDb()
  const rawName = (input.name ?? '').trim()
  const name = rawName || fallbackPackName()
  const project = (input.project ?? '').trim() || '集团通用'
  const category = (input.category ?? '').trim() || '未分类'

  const folderPath = uniqueFolderPath(input.workspaceRoot, sanitizeFolderName(name))

  // 建包文件夹 + 三个子文件夹，由软件自动创建，同事不用自己建
  mkdirSync(folderPath, { recursive: true })
  for (const sub of SUB_FOLDERS) {
    mkdirSync(join(folderPath, sub), { recursive: true })
  }

  const ts = nowIso()
  const info = db
    .prepare(
      `INSERT INTO packs (name, project, category, folder_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, project, category, folderPath, ts, ts)

  const row = db.prepare('SELECT * FROM packs WHERE id = ?').get(info.lastInsertRowid) as PackRow

  // 包刚建好就顺手扫一次，把 id 与磁盘对齐
  scanAll(input.workspaceRoot)

  return row
}

// ---------------------------------------------------------------- 扫描 A-03/A-04

export interface ScanResult {
  packs: number
  files: number
  unassigned: number
  newFiles: number
}

/** 判断某个目录是不是一个「包」（含三子文件夹中至少一个，或曾在 packs 表里） */
function detectRoleFromPath(workspaceRoot: string, absPath: string): {
  packFolder: string | null
  role: string
} {
  const rel = relative(workspaceRoot, absPath)
  if (!rel || rel.startsWith('..')) return { packFolder: null, role: UNASSIGNED_ROLE }

  const parts = rel.split(sep)
  if (parts.length === 1) {
    // 直接躺在工作区根目录 → 未归属池
    return { packFolder: null, role: UNASSIGNED_ROLE }
  }

  const packFolder = join(workspaceRoot, parts[0])
  const role = parts[1] && FOLDER_TO_ROLE[parts[1]] ? FOLDER_TO_ROLE[parts[1]] : UNASSIGNED_ROLE
  return { packFolder, role }
}

/** 递归收集某个包文件夹下所有文件（跳过隐藏系统目录） */
function collectFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name.startsWith('_')) continue // _thumbs / _system 属于软件自己的目录
    const full = join(dir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) collectFiles(full, out)
    else if (st.isFile()) out.push(full)
  }
  return out
}

/** A-03 + A-04：全量扫描工作区，登记文件基础信息并归位 */
export function scanAll(workspaceRoot: string): ScanResult {
  const db = getDb()
  const ts = nowIso()

  // 1. 让硬盘上的包文件夹与数据库对齐（同事可能手动建了文件夹）
  const packFolders: string[] = []
  let rootEntries: string[] = []
  try {
    rootEntries = readdirSync(workspaceRoot)
  } catch {
    rootEntries = []
  }
  for (const name of rootEntries) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    const full = join(workspaceRoot, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    packFolders.push(full)
    const known = db.prepare('SELECT id FROM packs WHERE folder_path = ?').get(full)
    if (!known) {
      // 硬盘上先有的文件夹，补一条记录（包名 = 文件夹名）
      db.prepare(
        `INSERT INTO packs (name, project, category, folder_path, created_at, updated_at)
         VALUES (?, '集团通用', '未分类', ?, ?, ?)`
      ).run(basename(full), full, ts, ts)
    }
  }

  // 2. 收集所有文件（含工作区根目录下的散文件 → 未归属池）
  const allFiles: string[] = []
  for (const name of rootEntries) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    const full = join(workspaceRoot, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) collectFiles(full, allFiles)
    else if (st.isFile()) allFiles.push(full)
  }

  // 3. 逐个 upsert。铁则：只登记，永不删除用户文件
  const packIdByFolder = new Map<string, number>()
  for (const p of db.prepare('SELECT id, folder_path FROM packs').all() as PackRow[]) {
    packIdByFolder.set(p.folder_path, p.id)
  }

  let newFiles = 0
  let unassigned = 0
  const upsert = db.prepare(
    `INSERT INTO assets (pack_id, role, file_name, ext, size, abs_path, rel_path, created_at, modified_at, scanned_at)
     VALUES (@pack_id, @role, @file_name, @ext, @size, @abs_path, @rel_path, @created_at, @modified_at, @scanned_at)
     ON CONFLICT(abs_path) DO UPDATE SET
       pack_id     = excluded.pack_id,
       role        = excluded.role,
       file_name   = excluded.file_name,
       ext         = excluded.ext,
       size        = excluded.size,
       rel_path    = excluded.rel_path,
       modified_at = excluded.modified_at,
       scanned_at  = excluded.scanned_at`
  )
  const existsStmt = db.prepare('SELECT id FROM assets WHERE abs_path = ?')

  const tx = db.transaction((files: string[]) => {
    for (const abs of files) {
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      const { packFolder, role } = detectRoleFromPath(workspaceRoot, abs)
      if (role === UNASSIGNED_ROLE) unassigned += 1
      if (!existsStmt.get(abs)) newFiles += 1

      upsert.run({
        pack_id: packFolder ? (packIdByFolder.get(packFolder) ?? null) : null,
        role,
        file_name: basename(abs),
        ext: extname(abs).replace(/^\./, '').toLowerCase(),
        size: st.size,
        abs_path: abs,
        rel_path: relative(workspaceRoot, abs),
        created_at: st.birthtime.toISOString(),
        modified_at: st.mtime.toISOString(),
        scanned_at: ts
      })
    }
  })
  tx(allFiles)

  // 4. 清理：磁盘上已不存在的记录 → 从索引里摘掉（但绝不删磁盘文件）
  const allKnown = db.prepare('SELECT id, abs_path FROM assets').all() as AssetRow[]
  const del = db.prepare('DELETE FROM assets WHERE id = ?')
  const pruneTx = db.transaction(() => {
    for (const a of allKnown) {
      if (!existsSync(a.abs_path)) del.run(a.id)
    }
  })
  pruneTx()

  // 5. 更新包的 updated_at（取包内最新文件时间）
  db.prepare(
    `UPDATE packs SET updated_at = COALESCE(
       (SELECT MAX(scanned_at) FROM assets WHERE assets.pack_id = packs.id), updated_at)`
  ).run()

  const packsCount = (db.prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c

  return { packs: packsCount, files: allFiles.length, unassigned, newFiles }
}

// ---------------------------------------------------------------- 认领 A-09

/** 把未归属文件搬进指定包的目标子文件夹，然后重新扫描 */
export function claimFiles(
  workspaceRoot: string,
  absPaths: string[],
  packId: number,
  subFolder: SubFolder
): { moved: number; errors: string[] } {
  const db = getDb()
  const pack = db.prepare('SELECT * FROM packs WHERE id = ?').get(packId) as PackRow | undefined
  if (!pack) return { moved: 0, errors: ['目标包不存在'] }
  if (!SUB_FOLDERS.includes(subFolder)) return { moved: 0, errors: ['目标分组不合法'] }

  const targetDir = join(pack.folder_path, subFolder)
  mkdirSync(targetDir, { recursive: true })

  let moved = 0
  const errors: string[] = []

  for (const src of absPaths) {
    if (!existsSync(src)) {
      errors.push(`${basename(src)}：文件已不存在`)
      continue
    }
    // 同名冲突时自动加后缀，绝不覆盖
    let dest = join(targetDir, basename(src))
    if (existsSync(dest) && dest !== src) {
      const ext = extname(src)
      const stem = basename(src, ext)
      let i = 2
      while (existsSync(dest) && i < 999) {
        dest = join(targetDir, `${stem}-${i}${ext}`)
        i += 1
      }
    }
    try {
      // 同盘用 rename 极快；跨盘或占用时回落到 copy + unlink，绝不覆盖
      try {
        renameSync(src, dest)
      } catch {
        copyFileSync(src, dest)
        unlinkSync(src)
      }
      moved += 1
    } catch (e) {
      errors.push(`${basename(src)}：${(e as Error).message}`)
    }
  }

  if (moved > 0) scanAll(workspaceRoot)
  return { moved, errors }
}

// ---------------------------------------------------------------- 查询

export interface PackWithStats extends PackRow {
  fileCount: number
  totalSize: number
  coverPath: string | null
}

/** A-06：包视图数据 —— 包卡片（含条数、总容量、封面） */
export function listPacks(): PackWithStats[] {
  const db = getDb()
  const packs = db.prepare('SELECT * FROM packs ORDER BY updated_at DESC').all() as PackRow[]

  return packs.map((p) => {
    const stat = db
      .prepare(
        'SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS s FROM assets WHERE pack_id = ?'
      )
      .get(p.id) as { c: number; s: number }

    // 封面：优先取「成品」里的第一个图片
    const cover = db
      .prepare(
        `SELECT abs_path, thumb_path FROM assets
         WHERE pack_id = ? AND (thumb_path IS NOT NULL OR ext IN ('jpg','jpeg','png','webp','gif','bmp'))
         ORDER BY CASE role WHEN '成品' THEN 0 WHEN '素材' THEN 1 ELSE 2 END, id
         LIMIT 1`
      )
      .get(p.id) as { abs_path: string; thumb_path: string | null } | undefined

    return {
      ...p,
      fileCount: stat.c,
      totalSize: stat.s,
      coverPath: cover ? cover.thumb_path || cover.abs_path : null
    }
  })
}

/** A-07：文件视图数据 —— 全部文件平铺，未归属的文件 role = '未归属' */
export function listAssets(opts: {
  keyword?: string
  view?: 'all' | 'unassigned'
  packId?: number
} = {}): AssetRow[] {
  const db = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (opts.view === 'unassigned') {
    where.push("role = @unassigned")
    params.unassigned = UNASSIGNED_ROLE
  }
  if (typeof opts.packId === 'number') {
    where.push('pack_id = @packId')
    params.packId = opts.packId
  }
  if (opts.keyword && opts.keyword.trim()) {
    where.push('file_name LIKE @kw')
    params.kw = `%${opts.keyword.trim()}%`
  }

  const sql = `SELECT * FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY modified_at DESC`
  return db.prepare(sql).all(params) as AssetRow[]
}

/** A-08：点开包 → 按三组给出文件 */
export function getPackDetail(packId: number): {
  pack: PackRow
  groups: Record<string, AssetRow[]>
} {
  const db = getDb()
  const pack = db.prepare('SELECT * FROM packs WHERE id = ?').get(packId) as PackRow
  const rows = db
    .prepare('SELECT * FROM assets WHERE pack_id = ? ORDER BY modified_at DESC')
    .all(packId) as AssetRow[]

  const groups: Record<string, AssetRow[]> = { 成品: [], 素材: [], 工程: [], 未归属: [] }
  for (const r of rows) {
    if (!groups[r.role]) groups[r.role] = []
    groups[r.role].push(r)
  }
  return { pack, groups }
}

/** 未归属池数量（给界面顶栏做提示用） */
export function countUnassigned(): number {
  const db = getDb()
  const r = db
    .prepare('SELECT COUNT(*) AS c FROM assets WHERE role = ?')
    .get(UNASSIGNED_ROLE) as { c: number }
  return r.c
}
