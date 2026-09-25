import Database from 'better-sqlite3'
import { join, basename, dirname, extname, relative, sep } from 'path'
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
import {
  closeDb,
  getDb,
  openDb,
  pickColor,
  type AssetRow,
  type PackRow,
  type ProjectRow
} from './db'

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
 * 工作区根目录首选 D:\素材工作区（方案 6.0）。
 * 路径记在配置文件里而不是数据库里 —— 数据库本身就在工作区内。
 */
export const DEFAULT_WORKSPACE = 'D:\\素材工作区'

/** 首次启动时首选位置不可用，就落到系统「文档」下的同名文件夹（方案 06 第 6 节） */
export const FALLBACK_FOLDER_NAME = '素材工作区'

export interface WorkspaceState {
  /** 本次使用的工作区根目录 */
  root: string
  /** 该目录当前是否可用（能创建 + 能写入） */
  ok: boolean
  /** 不可用时的原因说明；可用时为空串 */
  note: string
}

/** 列表里的一个工作区（方案 07 第 7 节） */
export interface WorkspaceEntry {
  id: string
  /** 显示名，默认取文件夹名 */
  name: string
  root: string
  addedAt: string
  lastOpenedAt: string
}

/**
 * 配置文件结构 v2。
 *
 * 末尾的 `workspaceRoot` 是**刻意双写**，不是冗余（方案 07 第 7.2 节）：
 * 1. 第 4 批的验收断言直接读这个字段；
 * 2. 用户装回旧版软件时，旧版只认这个字段 —— 读不到会走「首次启动」逻辑
 *    凭空择址出一个空工作区，让用户以为数据丢了。
 */
export interface WorkspaceConfig {
  version: 2
  activeId: string
  workspaces: WorkspaceEntry[]
  workspaceRoot: string
}

/** 系统「文档」目录的兜底推导 —— 不依赖 electron，验收脚本可直接调用 */
function fallbackDocumentsDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  return home ? join(home, 'Documents') : DEFAULT_WORKSPACE
}

/**
 * 判断某个目录能不能当工作区用：能建目录、能写入文件。
 *
 * 只用 existsSync 不够 —— 目录可能存在但不让写（只读盘、U 盘写保护、权限不足）。
 * 探针写在 `_system` 里（那本来就是软件自己的目录，扫描时会跳过），用完立刻删除，
 * 不在用户看得见的地方留任何东西。
 */
export function isUsableWorkspace(root: string): boolean {
  try {
    mkdirSync(join(root, '_system'), { recursive: true })
    const probe = join(root, '_system', '.write_probe')
    writeFileSync(probe, '', 'utf-8')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 配置 v2

/** 工作区默认显示名：取文件夹名 */
export function workspaceNameOf(root: string): string {
  const b = basename(root.replace(/[\\/]+$/, ''))
  return b || root
}

/**
 * 由 root 推导一个**确定性** id。
 *
 * 确定性是必须的：老配置升级到 v2 时我们不立刻回写文件，
 * 如果每次读取都生成新 id，界面按 id 切换就会失效。
 */
export function workspaceIdOf(root: string, taken: string[] = []): string {
  let h = 0
  const s = root.toLowerCase()
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  const base = 'ws_' + (h >>> 0).toString(36)
  let id = base
  let i = 2
  while (taken.includes(id)) {
    id = `${base}-${i}`
    i += 1
  }
  return id
}

function cfgPath(appDataDir: string): string {
  return join(appDataDir, 'workspace.json')
}

/**
 * 读配置。老格式（只有 workspaceRoot）在**内存里**升级成 v2，不立刻回写 ——
 * 只在下次正常写配置的时机（首次择址 / 切换 / 添加）一并落盘，
 * 避免「只读一次操作就改了用户文件」。
 */
export function readWorkspaceConfig(appDataDir: string): WorkspaceConfig | null {
  const p = cfgPath(appDataDir)
  if (!existsSync(p)) return null

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null // 配置坏了当作「没有配置」处理（与旧行为一致）
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // ---- v2 ----
  if (Array.isArray(r.workspaces) && r.workspaces.length) {
    const list: WorkspaceEntry[] = []
    for (const item of r.workspaces as Array<Record<string, unknown>>) {
      if (!item || typeof item.root !== 'string' || !item.root.trim()) continue
      const root = item.root
      list.push({
        id:
          typeof item.id === 'string' && item.id
            ? item.id
            : workspaceIdOf(root, list.map((x) => x.id)),
        name:
          typeof item.name === 'string' && item.name.trim()
            ? item.name.trim()
            : workspaceNameOf(root),
        root,
        addedAt: typeof item.addedAt === 'string' ? item.addedAt : new Date().toISOString(),
        lastOpenedAt: typeof item.lastOpenedAt === 'string' ? item.lastOpenedAt : ''
      })
    }
    if (!list.length) return null
    const activeId = list.some((w) => w.id === r.activeId) ? (r.activeId as string) : list[0].id
    return {
      version: 2,
      activeId,
      workspaces: list,
      workspaceRoot: list.find((w) => w.id === activeId)!.root
    }
  }

  // ---- 老格式：{ workspaceRoot: "X" } ----
  if (typeof r.workspaceRoot === 'string' && r.workspaceRoot.trim()) {
    const root = r.workspaceRoot
    const now = new Date().toISOString()
    const e: WorkspaceEntry = {
      id: workspaceIdOf(root),
      name: workspaceNameOf(root),
      root,
      addedAt: now,
      lastOpenedAt: now
    }
    return { version: 2, activeId: e.id, workspaces: [e], workspaceRoot: root }
  }

  return null
}

/** 写配置（末尾双写 workspaceRoot 兼容字段） */
export function writeWorkspaceConfig(appDataDir: string, cfg: WorkspaceConfig): void {
  mkdirSync(appDataDir, { recursive: true })
  const active = cfg.workspaces.find((w) => w.id === cfg.activeId) || cfg.workspaces[0]
  const out: WorkspaceConfig = {
    version: 2,
    activeId: active.id,
    workspaces: cfg.workspaces,
    workspaceRoot: active.root
  }
  writeFileSync(cfgPath(appDataDir), JSON.stringify(out, null, 2), 'utf-8')
}

/** 工作区列表（供界面与验收使用） */
export function listWorkspaces(appDataDir: string): {
  workspaces: WorkspaceEntry[]
  activeId: string
} {
  const cfg = readWorkspaceConfig(appDataDir)
  if (!cfg) return { workspaces: [], activeId: '' }
  return { workspaces: cfg.workspaces, activeId: cfg.activeId }
}

/** 当前活动工作区（配置缺失时返回 null） */
export function getActiveWorkspaceEntry(appDataDir: string): WorkspaceEntry | null {
  const cfg = readWorkspaceConfig(appDataDir)
  if (!cfg) return null
  return cfg.workspaces.find((w) => w.id === cfg.activeId) || cfg.workspaces[0] || null
}

/**
 * 决定本次启动用哪个工作区，并报告它是否可用。
 *
 * 铁则「软件永远不悄悄扔掉用户放的东西」在这里的落地方式：
 * **只在「首次启动、还没有任何配置」时才自动择址**；
 * 一旦位置已定（哪怕是历史默认值），就不再自作主张改它 ——
 * 否则移动硬盘没插上时软件悄悄换到「文档」，用户会看到一个空库，以为素材全丢了。
 */
export function resolveWorkspace(
  appDataDir: string,
  documentsDir?: string,
  preferredRoot: string = DEFAULT_WORKSPACE
): WorkspaceState {
  const cfg = readWorkspaceConfig(appDataDir)

  if (cfg) {
    const active = cfg.workspaces.find((w) => w.id === cfg.activeId) || cfg.workspaces[0]
    if (isUsableWorkspace(active.root)) return { root: active.root, ok: true, note: '' }
    return {
      root: active.root,
      ok: false,
      note: '该位置当前不可用（磁盘未挂载 / 移动硬盘未连接 / 没有写入权限）'
    }
  }

  // 首次启动：先试首选位置，不可用再落到「文档」
  const candidates = [
    preferredRoot,
    join(documentsDir || fallbackDocumentsDir(), FALLBACK_FOLDER_NAME)
  ]
  for (const c of candidates) {
    if (isUsableWorkspace(c)) {
      saveWorkspaceRoot(appDataDir, c)
      return { root: c, ok: true, note: '' }
    }
  }
  // 两个候选都不可用：仍报首选位置，把决定权交给界面提示与用户手动指定
  return {
    root: preferredRoot,
    ok: false,
    note: '既定位置与「文档」目录都无法创建，请点「更改位置」手动指定一个可写目录'
  }
}

/**
 * 工作区状态在进程内只解析一次。
 * 一是避免每个 IPC 调用都去写探针文件，二是保证同一次运行里路径不跳变。
 * 用户手动改过位置后（ws:setRoot / ws:pickRoot）调用 resetWorkspaceState 让它重新解析。
 */
let cachedState: WorkspaceState | null = null

export function getWorkspaceState(
  appDataDir: string,
  documentsDir?: string
): WorkspaceState {
  if (!cachedState) cachedState = resolveWorkspace(appDataDir, documentsDir)
  return cachedState
}

export function resetWorkspaceState(): void {
  cachedState = null
}

/** 兼容旧调用：只要路径，不关心可用状态 */
export function getWorkspaceRoot(appDataDir: string, documentsDir?: string): string {
  return getWorkspaceState(appDataDir, documentsDir).root
}

/**
 * 写「当前工作区的根」：把它设为活动工作区。
 *
 * 语义与第 1 批保持一致（老的调用点全部继续可用）：
 * - 该路径已在列表里 → 只是切过去
 * - 不在列表里 → 作为新的一项加进来再切过去
 */
export function saveWorkspaceRoot(appDataDir: string, workspaceRoot: string): void {
  const cfg = readWorkspaceConfig(appDataDir)
  const now = new Date().toISOString()
  const list = cfg ? cfg.workspaces.slice() : []

  const idx = list.findIndex((w) => w.root.toLowerCase() === workspaceRoot.toLowerCase())
  let entry: WorkspaceEntry
  if (idx >= 0) {
    entry = { ...list[idx], lastOpenedAt: now }
    list[idx] = entry
  } else {
    entry = {
      id: workspaceIdOf(workspaceRoot, list.map((w) => w.id)),
      name: workspaceNameOf(workspaceRoot),
      root: workspaceRoot,
      addedAt: now,
      lastOpenedAt: now
    }
    list.push(entry)
  }

  writeWorkspaceConfig(appDataDir, {
    version: 2,
    activeId: entry.id,
    workspaces: list,
    workspaceRoot: entry.root
  })
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

/**
 * 同路径重名时自动加后缀 -2 -3。
 *
 * 注意：必须**同时**检查磁盘和数据库。
 * 只查磁盘会有个坑：包文件夹被人在资源管理器里删掉、但数据库记录还在时，
 * existsSync 说"没冲突"，插入却会撞 folder_path 的 UNIQUE 约束，建包直接崩。
 */
function uniqueFolderPath(workspaceRoot: string, baseName: string): string {
  const db = getDb()
  const taken = db.prepare('SELECT id FROM packs WHERE folder_path = ?')

  let candidate = join(workspaceRoot, baseName)
  let i = 2
  while (existsSync(candidate) || taken.get(candidate)) {
    candidate = join(workspaceRoot, `${baseName}-${i}`)
    i += 1
    if (i > 999) break
  }
  return candidate
}

export interface CreatePackInput {
  name?: string
  projectId?: number | null
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
  const category = (input.category ?? '').trim() || '未分类'

  // 项目按 ID 关联；没传就落到列表第一个（默认「集团通用」）
  let projectId = typeof input.projectId === 'number' ? input.projectId : null
  if (projectId === null) {
    const first = db
      .prepare('SELECT id FROM projects ORDER BY sort_order, id LIMIT 1')
      .get() as { id: number } | undefined
    projectId = first?.id ?? null
  }

  const folderPath = uniqueFolderPath(input.workspaceRoot, sanitizeFolderName(name))

  // 建包文件夹 + 三个子文件夹，由软件自动创建，同事不用自己建
  mkdirSync(folderPath, { recursive: true })
  for (const sub of SUB_FOLDERS) {
    mkdirSync(join(folderPath, sub), { recursive: true })
  }

  const ts = nowIso()
  const info = db
    .prepare(
      `INSERT INTO packs (name, project_id, category, folder_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, projectId, category, folderPath, ts, ts)

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
      // 硬盘上先有的文件夹，补一条记录（包名 = 文件夹名，归到默认项目）
      const defaultProject = db
        .prepare('SELECT id FROM projects ORDER BY sort_order, id LIMIT 1')
        .get() as { id: number } | undefined
      db.prepare(
        `INSERT INTO packs (name, project_id, category, folder_path, created_at, updated_at)
         VALUES (?, ?, '未分类', ?, ?, ?)`
      ).run(basename(full), defaultProject?.id ?? null, full, ts, ts)
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

// ---------------------------------------------------------------- 项目 CRUD

/** 项目列表（含每个项目下的包数）。归档项目默认不给界面，除非显式要 */
export function listProjects(includeArchived = false): ProjectRow[] {
  const db = getDb()
  const sql = includeArchived
    ? 'SELECT * FROM projects ORDER BY archived, sort_order, id'
    : 'SELECT * FROM projects WHERE archived = 0 ORDER BY sort_order, id'
  return db.prepare(sql).all() as ProjectRow[]
}

/** 项目 + 该项目下的包数 */
export function listProjectsWithCount(): Array<ProjectRow & { packCount: number }> {
  const db = getDb()
  const rows = listProjects(false)
  return rows.map((p) => {
    const c = (
      db.prepare('SELECT COUNT(*) AS c FROM packs WHERE project_id = ?').get(p.id) as { c: number }
    ).c
    return { ...p, packCount: c }
  })
}

export function getProject(id: number): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
}

/** 新建项目。名称必填且不允许重名（重名会让包归属产生歧义） */
export function createProject(input: {
  name: string
  color?: string
  note?: string
}): { ok: boolean; project?: ProjectRow; error?: string } {
  const db = getDb()
  const name = (input.name ?? '').trim()
  if (!name) return { ok: false, error: '项目名称不能为空' }

  const dup = db.prepare('SELECT id FROM projects WHERE name = ?').get(name)
  if (dup) return { ok: false, error: `已存在同名项目「${name}」` }

  const maxOrder = (
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects').get() as { m: number }
  ).m
  const color = (input.color ?? '').trim() || pickColor(maxOrder + 1)
  const ts = nowIso()

  const info = db
    .prepare(
      `INSERT INTO projects (name, color, note, sort_order, archived, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    .run(name, color, (input.note ?? '').trim(), maxOrder + 1, ts)

  return { ok: true, project: getProject(Number(info.lastInsertRowid)) }
}

/** 改项目名 / 颜色 / 备注 */
export function updateProject(
  id: number,
  patch: { name?: string; color?: string; note?: string }
): { ok: boolean; project?: ProjectRow; error?: string } {
  const db = getDb()
  const cur = getProject(id)
  if (!cur) return { ok: false, error: '项目不存在' }

  const name = patch.name === undefined ? cur.name : patch.name.trim()
  if (!name) return { ok: false, error: '项目名称不能为空' }

  if (name !== cur.name) {
    const dup = db.prepare('SELECT id FROM projects WHERE name = ? AND id <> ?').get(name, id)
    if (dup) return { ok: false, error: `已存在同名项目「${name}」` }
  }

  db.prepare('UPDATE projects SET name = ?, color = ?, note = ? WHERE id = ?').run(
    name,
    patch.color === undefined ? cur.color : patch.color.trim() || cur.color,
    patch.note === undefined ? cur.note : patch.note.trim(),
    id
  )
  return { ok: true, project: getProject(id) }
}

/**
 * 调整项目在左栏的显示顺序（上移 / 下移一位）。
 *
 * 实现：拿当前未归档项目的完整有序列表，找到目标项，与相邻项交换 sort_order。
 * 只交换两个值，不动其他项目 —— 避免整表重排写坏顺序。
 * 到顶再上移 / 到底再下移，直接返回成功但不改动（界面据此禁用按钮，这里只做兜底）。
 */
export function moveProject(
  id: number,
  direction: 'up' | 'down'
): { ok: boolean; moved: boolean; error?: string } {
  const db = getDb()
  const cur = getProject(id)
  if (!cur) return { ok: false, moved: false, error: '项目不存在' }
  if (cur.archived) return { ok: false, moved: false, error: '已归档的项目不参与排序' }

  const list = listProjects(false)
  const idx = list.findIndex((p) => p.id === id)
  if (idx < 0) return { ok: false, moved: false, error: '项目不存在' }

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= list.length) {
    return { ok: true, moved: false }
  }

  const a = list[idx]
  const b = list[swapIdx]

  // sort_order 全部相同（老库可能都是 0）时，交换值等于没动 —— 先把顺序固化下来
  const allSame = list.every((p) => p.sort_order === list[0].sort_order)
  if (allSame) {
    const stmt = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?')
    db.transaction(() => list.forEach((p, i) => stmt.run(i, p.id)))()
    // 固化后重新取，保证下面的交换基于真实位次
    return moveProject(id, direction)
  }

  const stmt = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?')
  db.transaction(() => {
    stmt.run(b.sort_order, a.id)
    stmt.run(a.sort_order, b.id)
  })()

  return { ok: true, moved: true }
}

/**
 * 删除项目。
 * **不允许出现"包跟着项目一起消失"** —— 项目下有包时，必须由调用方指定去向：
 *   - moveTo: 把包转到另一个项目
 *   - 传 null 则表示「这些包变成未归属」（project_id 置空）
 */
export function removeProject(
  id: number,
  action: { moveTo: number | null }
): { ok: boolean; moved: number; error?: string } {
  const db = getDb()
  const cur = getProject(id)
  if (!cur) return { ok: false, moved: 0, error: '项目不存在' }

  const packCount = (
    db.prepare('SELECT COUNT(*) AS c FROM packs WHERE project_id = ?').get(id) as { c: number }
  ).c

  // 只剩一个项目时不允许删 —— 否则新建包没有默认归属可选
  const total = (db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c
  if (total <= 1) {
    return { ok: false, moved: 0, error: '至少要保留一个项目，无法删除最后一个' }
  }

  if (packCount > 0) {
    if (action.moveTo !== null) {
      if (action.moveTo === id) return { ok: false, moved: 0, error: '不能转移到自己' }
      const target = getProject(action.moveTo)
      if (!target) return { ok: false, moved: 0, error: '目标项目不存在' }
      db.prepare('UPDATE packs SET project_id = ? WHERE project_id = ?').run(action.moveTo, id)
    } else {
      // 变成未归属：包还在、文件还在，只是不再挂任何项目
      db.prepare('UPDATE packs SET project_id = NULL WHERE project_id = ?').run(id)
    }
  }

  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return { ok: true, moved: packCount }
}

// ---------------------------------------------------------------- 查询

export interface PackWithStats extends PackRow {
  fileCount: number
  totalSize: number
  coverPath: string | null
  projectName: string | null
  projectColor: string | null
}

/** A-06：包视图数据 —— 包卡片（含条数、总容量、封面、项目名与配色） */
export function listPacks(): PackWithStats[] {
  const db = getDb()
  const packs = db
    .prepare(
      `SELECT k.*, p.name AS projectName, p.color AS projectColor
         FROM packs k
         LEFT JOIN projects p ON p.id = k.project_id
        ORDER BY k.updated_at DESC`
    )
    .all() as Array<PackRow & { projectName: string | null; projectColor: string | null }>

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

/** A-07：文件视图数据 —— 全部文件平铺，未归属的文件 role = '未归属'
 *  第 3 批：额外支持标签筛选（tagIds 之间是「并且」关系，需求文档 M3-02）*/
export function listAssets(opts: {
  keyword?: string
  view?: 'all' | 'unassigned'
  packId?: number
  projectId?: number
  /** 已选标签；同维度内是「或」，跨维度是「并且」。项目维度传负数 id（-projectId） */
  tagIds?: number[]
  /** 已选项目 id（项目维度走 packs.project_id） */
  filterProjectIds?: number[]
  /** 是否把每条素材的标签一起带出来（tagId 数组 + 名称色块） */
  withTags?: boolean
} = {}): AssetRow[] {
  const db = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (opts.view === 'unassigned') {
    where.push('a.role = @unassigned')
    params.unassigned = UNASSIGNED_ROLE
  }
  if (typeof opts.packId === 'number') {
    where.push('a.pack_id = @packId')
    params.packId = opts.packId
  }
  if (typeof opts.projectId === 'number') {
    where.push('k.project_id = @projectId')
    params.projectId = opts.projectId
  }
  if (opts.filterProjectIds && opts.filterProjectIds.length) {
    where.push(`k.project_id IN (${opts.filterProjectIds.map((_, i) => `@fp${i}`).join(',')})`)
    opts.filterProjectIds.forEach((id, i) => {
      params[`fp${i}`] = id
    })
  }
  if (opts.keyword && opts.keyword.trim()) {
    where.push('a.file_name LIKE @kw')
    params.kw = `%${opts.keyword.trim()}%`
  }

  // tagIds 里可能混着项目维度的负数 id（-projectId，见 tags.ts listTagDimensions）。
  // 负数 id 不能去 tags 表查（那里没有负数），要换算成 packs.project_id 过滤；
  // 正数 id 才走 asset_tags/tags 联表。
  const rawTagIds = opts.tagIds ?? []
  const projIds = rawTagIds.filter((x) => x < 0).map((x) => -x)
  const posTagIds = rawTagIds.filter((x) => x > 0)

  if (projIds.length) {
    // 项目维度：素材必须挂在「这些项目」的包下面（未归属素材自然被排除）
    where.push(`k.project_id IN (${projIds.map((_, i) => `@tp${i}`).join(',')})`)
    projIds.forEach((id, i) => {
      params[`tp${i}`] = id
    })
  }

  let sql: string
  if (posTagIds.length) {
    // 跨维度「并且」：要求每个被选中的维度都至少命中一个标签
    // 例：类别=海报 且 渠道=公众号 且 状态=已交付 → COUNT(DISTINCT dimension)=3
    // （posTagIds 是 tags 表内部数字 id，拼接无注入风险）
    posTagIds.forEach((id, i) => {
      params[`t${i}`] = id
    })
    const dimRows = db
      .prepare(`SELECT DISTINCT dimension FROM tags WHERE id IN (${posTagIds.join(',')})`)
      .all() as Array<{ dimension: string }>
    const dimCount = dimRows.length || 1

    sql = `SELECT a.* FROM assets a
           LEFT JOIN packs k ON k.id = a.pack_id
           JOIN asset_tags at ON at.asset_id = a.id
           JOIN tags t ON t.id = at.tag_id
           WHERE t.id IN (${posTagIds.map((_, i) => `@t${i}`).join(',')})
                 ${where.length ? 'AND ' + where.join(' AND ') : ''}
           GROUP BY a.id
           HAVING COUNT(DISTINCT t.dimension) = @dimCount
           ORDER BY a.modified_at DESC`
    params.dimCount = dimCount
  } else {
    sql = `SELECT a.* FROM assets a
           LEFT JOIN packs k ON k.id = a.pack_id
           ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
           ORDER BY a.modified_at DESC`
  }
  return db.prepare(sql).all(params) as AssetRow[]
}

/** A-08：点开包 → 按三组给出文件 */
export function getPackDetail(packId: number): {
  pack: PackWithStats
  groups: Record<string, AssetRow[]>
} {
  const db = getDb()
  const pack = db
    .prepare(
      `SELECT k.*, p.name AS projectName, p.color AS projectColor
         FROM packs k LEFT JOIN projects p ON p.id = k.project_id
        WHERE k.id = ?`
    )
    .get(packId) as (PackRow & { projectName: string | null; projectColor: string | null }) | undefined
  if (!pack) throw new Error('包不存在')

  const stat = db
    .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS s FROM assets WHERE pack_id = ?')
    .get(packId) as { c: number; s: number }

  const rows = db
    .prepare('SELECT * FROM assets WHERE pack_id = ? ORDER BY modified_at DESC')
    .all(packId) as AssetRow[]

  const groups: Record<string, AssetRow[]> = { 成品: [], 素材: [], 工程: [], 未归属: [] }
  for (const r of rows) {
    if (!groups[r.role]) groups[r.role] = []
    groups[r.role].push(r)
  }
  return {
    pack: { ...pack, fileCount: stat.c, totalSize: stat.s, coverPath: null },
    groups
  }
}

/** 未归属池数量（给界面顶栏做提示用） */
export function countUnassigned(): number {
  const db = getDb()
  const r = db
    .prepare('SELECT COUNT(*) AS c FROM assets WHERE role = ?')
    .get(UNASSIGNED_ROLE) as { c: number }
  return r.c
}

// ================================================================ 第 5 批 E-01：工作区管理与迁移
// 对应方案：docs/07-工作区管理方案.md

/** 两个路径是否在同一个卷上 */
export function isSameVolume(a: string, b: string): boolean {
  try {
    // 用 dev（卷标识）而不是比盘符 —— 能正确处理挂载点、目录联接
    return statSync(a).dev === statSync(b).dev
  } catch {
    return false
  }
}

/** 相对路径归一化：统一分隔符、去掉开头分隔符 */
function normalizeRel(rel: string): string {
  return rel.replace(/[\\/]+/g, sep).replace(/^[\\/]+/, '')
}

/** 去掉尾部分隔符 */
function trimSlash(p: string): string {
  return p.replace(/[\\/]+$/, '')
}

export interface OldRootProbe {
  ok: boolean
  /** 反推出的旧工作区根；null = 库是空的，没什么可重写 */
  oldRoot: string | null
  error?: string
}

/**
 * 从一个已打开的库连接反推工作区旧根。
 *
 * 库里没有字段记录「工作区根」，但每条素材都存了 rel_path，
 * 而 abs_path 一定以它结尾 → 剪掉尾巴剩下的就是根。
 *
 * 【安全阀】所有样本必须推出同一个根。出现多个不同值说明库里有跨根数据，
 * 宁可报错让用户确认，也绝不猜着改。
 */
function detectOldRootFrom(conn: Database.Database): OldRootProbe {
  let rows: Array<{ abs_path: string; rel_path: string }> = []
  try {
    rows = conn
      .prepare("SELECT abs_path, rel_path FROM assets WHERE rel_path IS NOT NULL AND rel_path <> ''")
      .all() as Array<{ abs_path: string; rel_path: string }>
  } catch {
    return { ok: true, oldRoot: null } // 表还不存在 → 当成空库
  }

  const roots = new Set<string>()
  let skipped = 0
  for (const r of rows) {
    const abs = r.abs_path || ''
    const rel = r.rel_path || ''
    if (!abs.toLowerCase().endsWith(rel.toLowerCase())) {
      skipped += 1 // 脏数据：abs_path 不以 rel_path 结尾
      continue
    }
    const head = trimSlash(abs.slice(0, abs.length - rel.length))
    if (head) roots.add(head)
  }

  if (roots.size === 1) return { ok: true, oldRoot: [...roots][0] }
  if (roots.size > 1) {
    return {
      ok: false,
      oldRoot: null,
      error: `库里的素材路径指向 ${roots.size} 个不同位置，数据异常，已拒绝自动改动`
    }
  }

  // 一条都推不出来、但库里明明有记录 → 库不自洽（rel_path 与 abs_path 对不上）。
  // 这种情况继续往下走去猜根，会拿脏 rel_path 重建出一批错误路径，宁可报错。
  if (skipped > 0) {
    return {
      ok: false,
      oldRoot: null,
      error: `库里有 ${skipped}/${rows.length} 条记录的路径自相矛盾，已拒绝自动改动`
    }
  }

  // 一条素材都没有 → 退而用包目录反推（包都直接建在工作区根下）
  let packs: Array<{ folder_path: string }> = []
  try {
    packs = conn.prepare('SELECT folder_path FROM packs').all() as Array<{ folder_path: string }>
  } catch {
    return { ok: true, oldRoot: null }
  }

  const proots = new Set<string>()
  for (const p of packs) {
    const d = trimSlash(dirname(p.folder_path || ''))
    if (d && d !== '.' && d !== sep) proots.add(d)
  }
  if (proots.size === 0) return { ok: true, oldRoot: null } // 空库
  if (proots.size > 1) {
    return {
      ok: false,
      oldRoot: null,
      error: `包目录分布在 ${proots.size} 个不同位置，数据异常，已拒绝自动改动`
    }
  }
  return { ok: true, oldRoot: [...proots][0] }
}

/** 反推当前（已打开）库的工作区旧根 */
export function detectOldRoot(): OldRootProbe {
  return detectOldRootFrom(getDb())
}

/**
 * 把库文件备份到 `_system/backup/`。
 *
 * **调用前必须先 closeDb()** —— 库还开着时复制文件不保证一致快照。
 * `_system` 下划线开头，扫描会自动跳过，不会跑到用户眼皮底下。
 */
export function backupDb(workspaceRoot: string): string | null {
  const sysDir = join(workspaceRoot, '_system')
  const src = join(sysDir, 'media.db')
  if (!existsSync(src)) return null

  const bkDir = join(sysDir, 'backup')
  mkdirSync(bkDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dst = join(bkDir, `media.db.${stamp}.bak`)
  copyFileSync(src, dst)
  for (const ext of ['-wal', '-shm']) {
    if (existsSync(src + ext)) copyFileSync(src + ext, dst + ext)
  }
  return dst
}

export interface RewriteResult {
  ok: boolean
  oldRoot: string
  newRoot: string
  /** 重写后库里的素材条数 */
  assets: number
  packs: number
  /** 自检落空数（文件实际不存在） */
  missing: number
  missingList: string[]
  backupPath: string | null
  error?: string
}

/**
 * 把库里所有绝对路径的前缀从 oldRoot 换成 newRoot（需求文档 M8-05）。
 *
 * **为什么必须重写而不能「重新扫描」**：
 * `abs_path` 是 UNIQUE 键，重扫会把新路径当新文件 INSERT → asset.id 变化
 * → `asset_tags` 标签关联变孤儿；`packs` 还会因 folder_path 对不上而重复登记一份。
 * 重写保住 id，标签与包归属一条不丢。
 *
 * 调用前提：newRoot 下的库已存在（搬家后 / 用户自己复制过来后）。
 */
export function rewritePaths(newRoot: string, oldRootHint?: string): RewriteResult {
  const base: RewriteResult = {
    ok: false,
    oldRoot: oldRootHint ?? '',
    newRoot,
    assets: 0,
    packs: 0,
    missing: 0,
    missingList: [],
    backupPath: null
  }

  const conn = openDb(newRoot)
  const probe = detectOldRootFrom(conn)
  if (!probe.ok) return { ...base, error: probe.error }

  const oldRoot = oldRootHint ?? probe.oldRoot
  if (!oldRoot) return { ...base, ok: true, oldRoot: '' } // 空库，没路径要改
  if (oldRoot.toLowerCase() === trimSlash(newRoot).toLowerCase()) {
    return { ...base, ok: true, oldRoot } // 已在正确位置，幂等跳过
  }

  // ---- 先把目标值全算出来，再进事务（避免中途出现半成品状态）----
  interface PlanRow {
    id: number
    next: string
  }

  const assetRows = conn
    .prepare('SELECT id, abs_path, rel_path FROM assets')
    .all() as Array<{ id: number; abs_path: string; rel_path: string }>
  const planA: PlanRow[] = assetRows.map((a) => {
    let rel = (a.rel_path ?? '').trim()
    if (rel) rel = normalizeRel(rel)
    else if ((a.abs_path ?? '').toLowerCase().startsWith(oldRoot.toLowerCase())) {
      rel = normalizeRel(a.abs_path.slice(oldRoot.length))
    }
    // 推不出来的保持原值不动（宁可留着让人看见，也不猜）
    return { id: a.id, next: rel ? join(newRoot, rel) : a.abs_path }
  })

  const packRows = conn
    .prepare('SELECT id, folder_path FROM packs')
    .all() as Array<{ id: number; folder_path: string }>
  const planP: PlanRow[] = packRows.map((p) => {
    const raw = p.folder_path ?? ''
    let rel = ''
    if (raw.toLowerCase().startsWith(oldRoot.toLowerCase())) {
      rel = normalizeRel(raw.slice(oldRoot.length))
    } else {
      rel = normalizeRel(basename(raw)) // 推不出来就退回包名（包都直接建在根下）
    }
    return { id: p.id, next: rel ? join(newRoot, rel) : raw }
  })

  // ---- 备份（关库 → 复制文件，保证快照一致）----
  closeDb()
  let backupPath: string | null = null
  try {
    backupPath = backupDb(newRoot)
  } catch (e) {
    openDb(newRoot) // 把库开回去，别让调用方拿到死连接
    return { ...base, oldRoot, error: `备份失败，已中止重写：${(e as Error).message}` }
  }

  const d = openDb(newRoot)
  try {
    const tx = d.transaction(() => {
      // 两步走：先落不可能碰撞的临时值，再写目标值。
      // 单一 UPDATE 在「库里已是混合状态」时会中途撞 UNIQUE 约束。
      d.prepare("UPDATE assets SET abs_path = '#migrating#' || id").run()
      d.prepare("UPDATE packs  SET folder_path = '#migrating#' || id").run()

      const ua = d.prepare('UPDATE assets SET abs_path = ? WHERE id = ?')
      for (const x of planA) ua.run(x.next, x.id)
      const up = d.prepare('UPDATE packs SET folder_path = ? WHERE id = ?')
      for (const x of planP) up.run(x.next, x.id)
    })
    tx()
  } catch (e) {
    return {
      ...base,
      oldRoot,
      backupPath,
      error: `重写失败（库已回滚，备份在 ${backupPath}）：${(e as Error).message}`
    }
  }

  // ---- 自检：逐个核对文件是否真的在（只报告，绝不删记录）----
  const after = d.prepare('SELECT abs_path FROM assets').all() as Array<{ abs_path: string }>
  const missingList: string[] = []
  for (const r of after) {
    if (!existsSync(r.abs_path)) missingList.push(r.abs_path)
  }
  const assetCount = (d.prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c
  const packCount = (d.prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c

  return {
    ok: true,
    oldRoot,
    newRoot: trimSlash(newRoot),
    assets: assetCount,
    packs: packCount,
    missing: missingList.length,
    missingList: missingList.slice(0, 50),
    backupPath
  }
}

// ---------------------------------------------------------------- 目录体检

export type DirKind = 'empty' | 'own' | 'foreign' | 'broken'

export interface DirInspection {
  kind: DirKind
  root: string
  oldRoot?: string
  error?: string
}

/**
 * 看一眼这个目录是什么情况 —— **只读，不改任何东西，也不动全局数据库连接**。
 *
 * - empty  ：没有库 → 当新工作区用
 * - own    ：有库且路径自洽 → 直接登记
 * - foreign：有库但记录指向别处（搬过来的）→ 问用户要不要改写路径
 * - broken ：有库但路径自相矛盾 → 拒绝自动处理
 */
export function inspectWorkspaceDir(root: string): DirInspection {
  const norm = trimSlash(root)
  const dbFile = join(norm, '_system', 'media.db')
  if (!existsSync(dbFile)) return { kind: 'empty', root: norm }

  let conn: Database.Database | null = null
  try {
    // 独立的临时连接：不干扰正在用的那个库。
    // 刻意不用 readonly —— WAL 模式下只读打开需要能创建 -shm 文件，
    // 否则会直接打不开，把「刚复制过来、还没生成 -shm」的库误判成坏的。
    conn = new Database(dbFile, { fileMustExist: true })
    const probe = detectOldRootFrom(conn)
    if (!probe.ok) return { kind: 'broken', root: norm, error: probe.error }
    if (!probe.oldRoot) return { kind: 'own', root: norm }
    if (probe.oldRoot.toLowerCase() === norm.toLowerCase()) {
      return { kind: 'own', root: norm, oldRoot: probe.oldRoot }
    }
    return { kind: 'foreign', root: norm, oldRoot: probe.oldRoot }
  } catch (e) {
    return { kind: 'broken', root: norm, error: `读库失败：${(e as Error).message}` }
  } finally {
    try {
      conn?.close()
    } catch {
      /* 关不掉也不影响 */
    }
  }
}

// ---------------------------------------------------------------- 工作区增删切

export interface AddWorkspaceResult {
  ok: boolean
  /** 需要用户确认（目录里是一个搬过来的库） */
  needsConfirm?: boolean
  oldRoot?: string
  migrated?: RewriteResult
  entry?: WorkspaceEntry
  error?: string
}

/**
 * 把一个目录登记成工作区并切过去。
 *
 * 切换四步顺序不可换（这是 BUG-1 的修法）：
 *   closeDb() → 写 activeId → resetWorkspaceState() → initWorkspace(新根)
 */
export function addWorkspace(
  appDataDir: string,
  root: string,
  opts: { rewrite?: boolean } = {}
): AddWorkspaceResult {
  const norm = trimSlash(root)

  if (!isUsableWorkspace(norm)) {
    return { ok: false, error: '这个位置不能写入，请换一个目录' }
  }

  const info = inspectWorkspaceDir(norm)

  if (info.kind === 'broken') {
    return { ok: false, error: info.error || '这个目录里的素材库看起来有问题，已中止' }
  }

  if (info.kind === 'foreign' && !opts.rewrite) {
    // 交给上层弹确认框，这里什么都不改
    return { ok: false, needsConfirm: true, oldRoot: info.oldRoot }
  }

  closeDb()
  resetWorkspaceState()
  saveWorkspaceRoot(appDataDir, norm)

  let migrated: RewriteResult | undefined
  if (info.kind === 'foreign') {
    const r = rewritePaths(norm, info.oldRoot)
    if (!r.ok) return { ok: false, error: r.error || '改写库里的路径失败' }
    migrated = r
  } else {
    initWorkspace(norm)
  }

  return { ok: true, migrated, entry: getActiveWorkspaceEntry(appDataDir) ?? undefined }
}

/** 按 id 切换工作区 */
export function switchWorkspace(
  appDataDir: string,
  id: string
): { ok: boolean; root?: string; name?: string; error?: string } {
  const cfg = readWorkspaceConfig(appDataDir)
  if (!cfg) return { ok: false, error: '还没有配置任何工作区' }

  const target = cfg.workspaces.find((w) => w.id === id)
  if (!target) return { ok: false, error: '工作区不存在' }

  if (!isUsableWorkspace(target.root)) {
    return {
      ok: false,
      error: `「${target.name}」当前位置连不上（磁盘未挂载 / 移动硬盘未连接 / 没有写入权限）`
    }
  }

  closeDb()
  const list = cfg.workspaces.map((w) =>
    w.id === id ? { ...w, lastOpenedAt: new Date().toISOString() } : w
  )
  writeWorkspaceConfig(appDataDir, { ...cfg, activeId: id, workspaces: list })
  resetWorkspaceState()
  initWorkspace(target.root)

  return { ok: true, root: target.root, name: target.name }
}

/**
 * 从列表里去掉一个工作区。
 *
 * **只删配置里的一条记录，磁盘上一个字节都不动。**
 * 移除的是当前活动工作区时，顺手切到剩下的第一个。
 */
export function removeWorkspace(
  appDataDir: string,
  id: string
): { ok: boolean; switchedTo?: string; error?: string } {
  const cfg = readWorkspaceConfig(appDataDir)
  if (!cfg) return { ok: false, error: '还没有配置任何工作区' }

  const rest = cfg.workspaces.filter((w) => w.id !== id)
  if (rest.length === cfg.workspaces.length) return { ok: false, error: '工作区不存在' }
  if (rest.length === 0) return { ok: false, error: '至少要保留一个工作区' }

  if (cfg.activeId !== id) {
    writeWorkspaceConfig(appDataDir, { ...cfg, workspaces: rest })
    return { ok: true }
  }

  closeDb()
  resetWorkspaceState()
  writeWorkspaceConfig(appDataDir, { ...cfg, activeId: rest[0].id, workspaces: rest })
  initWorkspace(rest[0].root)
  return { ok: true, switchedTo: rest[0].root }
}

// ---------------------------------------------------------------- 同盘搬移

export interface MigrateResult {
  ok: boolean
  crossDisk?: boolean
  from?: string
  to?: string
  /** 重写的素材条数 */
  rewritten?: number
  /** 自检落空数 */
  missing?: number
  backupPath?: string | null
  error?: string
}

/**
 * 同盘搬移（B2）：把当前工作区文件夹整体搬到一个新位置。
 *
 * 同盘用 `renameSync` —— 文件系统层面改个名字，**不看文件大小，几百 GB 也是瞬间**。
 * 跨盘会抛 EXDEV，这里明确拒绝：软件不自研跨盘复制（方案 07 第 10 节）。
 */
export function migrateWorkspaceSameDisk(
  appDataDir: string,
  targetParentDir: string
): MigrateResult {
  const cfg = readWorkspaceConfig(appDataDir)
  if (!cfg) return { ok: false, error: '还没有配置任何工作区' }

  const active = cfg.workspaces.find((w) => w.id === cfg.activeId) || cfg.workspaces[0]
  const from = trimSlash(active.root)
  const parent = trimSlash(targetParentDir)
  const to = join(parent, basename(from))

  if (!existsSync(from)) return { ok: false, from, to, error: '当前工作区目录不存在' }
  if (!existsSync(parent)) return { ok: false, from, to, error: '目标位置不存在' }
  if (to.toLowerCase().startsWith(from.toLowerCase() + sep)) {
    return { ok: false, from, to, error: '不能把工作区搬到它自己里面' }
  }
  if (existsSync(to)) {
    return {
      ok: false,
      from,
      to,
      error: `目标位置已经有一个「${basename(from)}」了，换个位置或先改名`
    }
  }
  if (!isSameVolume(from, parent)) {
    return { ok: false, crossDisk: true, from, to }
  }

  // 关库 → rename（原子操作：失败即什么都没变）
  closeDb()
  try {
    renameSync(from, to)
  } catch (e) {
    resetWorkspaceState()
    initWorkspace(from) // 把库开回原处，不留下半死状态
    return { ok: false, from, to, error: `搬移失败：${(e as Error).message}` }
  }

  const list = cfg.workspaces.map((w) =>
    w.id === active.id
      ? { ...w, root: to, name: workspaceNameOf(to), lastOpenedAt: new Date().toISOString() }
      : w
  )
  writeWorkspaceConfig(appDataDir, { ...cfg, activeId: active.id, workspaces: list })
  resetWorkspaceState()

  // 库里的绝对路径还是旧根 → 重写
  const r = rewritePaths(to, from)
  if (!r.ok) {
    return { ok: false, from, to, error: r.error || '文件夹搬好了，但库里的路径没改成，请看备份' }
  }

  return {
    ok: true,
    from,
    to,
    rewritten: r.assets,
    missing: r.missing,
    backupPath: r.backupPath
  }
}
