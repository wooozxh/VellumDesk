import { COPY, fmt } from '../shared/copy'
import Database from 'better-sqlite3'
import { join, basename, dirname, extname, relative, sep, isAbsolute } from 'path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  unlinkSync,
  rmdirSync
} from 'fs'
import {
  closeDb,
  getDb,
  openDb,
  pickColor,
  getMeta,
  setMeta,
  UNCATEGORIZED,
  /** 第 49 批（docs/34）：物料分级的兜底值（与 UNCATEGORIZED 同机制，词不同） */
  UNGRADED,
  type AssetRow,
  type PackRow,
  type PackVersionRow,
  type ProjectRow
} from './db'

/**
 * 工作区与「包」的业务逻辑。
 * 对应方案文档：A-01 建包 / A-02 工作区初始化 / A-03 扫描归位 / A-04 采集基础信息 / A-09 认领
 * 第 6 批：三级目录结构（工作区 / 项目 / 包 /〔版本〕/ 三组）—— 见 docs/08
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

// ---------------------------------------------------------------- 三级结构（第 6 批）

/**
 * 工作区根目录下的两个「收纳区」，都以 `_` 开头 ——
 * 扫描规则本来就是「下划线开头跳过」，所以"扫不进去"是零代码实现的。
 * 两个区都**不真删文件**（铁则：软件永远不悄悄扔掉用户放的东西）。
 */
/** 解绑的项目挪这儿：记录保留、界面可恢复 */
export const UNBOUND_DIR = '_已解绑的项目'
/** 删除的项目挪这儿：记录已删，文件还在 */
export const TRASH_DIR = '_回收站'

/** 当前目录布局版本。写在数据库 meta 表里，按工作区独立 */
export const LAYOUT_VERSION = '3'

/**
 * 不能当文件夹名的保留字。
 * 除 Windows 设备名外，还包含我们自己的目录 —— 虽然 `_` 开头的名字在 sanitize 阶段
 * 就会被改写（见下），这里再挡一道，避免以后改 sanitize 规则时踩雷。
 */
const RESERVED_FOLDER_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
  '_system', '_thumbs',
  UNBOUND_DIR.toLowerCase(),
  TRASH_DIR.toLowerCase()
])


// ---------------------------------------------------------------- 工作区路径

/**
 * 工作区根目录首选 D:\vellum_workspace（2026-10-05 全站改名，docs/28）。
 * 路径记在配置文件里而不是数据库里 —— 数据库本身就在工作区内。
 */
export const DEFAULT_WORKSPACE = 'D:\\vellum_workspace'

/** 首次启动时首选位置不可用，就落到系统「文档」下的同名文件夹 */
export const FALLBACK_FOLDER_NAME = 'vellum_workspace'

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
      note: COPY.wsErr.badLocationNote
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
    note: COPY.wsErr.noWritableNote
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

/** A-02：工作区首次初始化 —— 建根目录、_thumbs、_system、数据库、两个收纳区 */
export function initWorkspace(workspaceRoot: string): void {
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(join(workspaceRoot, '_thumbs'), { recursive: true })
  openDb(workspaceRoot) // 内部会建 _system/media.db
  // 第 6 批：两个收纳区在"建工作区时"就建好（docs/08 §9），空着也无害
  mkdirSync(join(workspaceRoot, UNBOUND_DIR), { recursive: true })
  mkdirSync(join(workspaceRoot, TRASH_DIR), { recursive: true })
  // 一次性迁移到三级结构（幂等），再补齐项目文件夹
  ensureLayoutV3(workspaceRoot)
  syncProjectFolders(workspaceRoot)
}

// ---------------------------------------------------------------- 建包 A-01

function nowIso(): string {
  return new Date().toISOString()
}

/** 包名称留空时的兜底取名（方案 6.0） */
export function fallbackPackName(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return fmt(COPY.ws.untitledTask, { y: d.getFullYear(), mo: p(d.getMonth() + 1), d: p(d.getDate()), h: p(d.getHours()), mi: p(d.getMinutes()) })
}

/**
 * 文件夹名消毒：去掉 Windows 不允许的字符，并保证结果**不会被扫描跳过**。
 *
 * 关键点（第 6 批新发现的老坑）：目录名以 `_` 或 `.` 开头会被扫描当成软件自己的目录跳过
 * （`_system` / `_thumbs` / `_已解绑的项目` / `_回收站` 全靠这条规则隐身）。
 * 所以用户要是把包名叫「_测试」，建出来的文件夹将永远扫不到 —— 包凭空消失。
 * 开头的 `_` / `.` 一律改写成 `-`，用户还认得出原名。
 */
function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^[._]+/, '-') // 开头不能是 . 或 _（否则被扫描跳过）
    .replace(/[. ]+$/, '') // 结尾不能是点或空格（Windows 会静默去掉，导致库盘不一致）
    .trim()

  const safe = cleaned || COPY.ws.untitledName
  // Windows 设备名（CON / NUL / COM1…）不能当文件夹名
  return RESERVED_FOLDER_NAMES.has(safe.toLowerCase()) ? `${safe}-1` : safe
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
  /** 第 23 批（docs/29）：任务的「使用场景」（标签名字）；留空记「未分类」 */
  channel?: string
  /** 第 49 批（docs/34）：任务的「物料分级」（标签名字）；留空记「未分级」（**不是**未分类） */
  grade?: string
  workspaceRoot: string
}

/** 新建包自带的第一稿文件夹名（用户拍板：新建的包都从 V1 开始） */
export const FIRST_VERSION_FOLDER = 'V1'

/**
 * A-01：新建任务包 —— 硬盘上建文件夹 + 自动建**第一稿 V1** + 落库。
 * 名称不校验、不拦截，留空用兜底名（方案 2.2 / 6.0）。
 *
 * 第 6 批：包文件夹落在 **`工作区\<项目文件夹>\<包名>`**（三级结构）。
 * 项目文件夹不存在就先建出来 —— 这样"软件里建项目"与"磁盘上有文件夹"永远一致。
 *
 * 第 9 批补（用户拍板）：**新建包直接带一个空的 V1**，磁盘结构就是
 * `包\V1\01-成品`。不必"先建个空包、再手动建第 1 稿"两步走 ——
 * 所有新包都是从 V1 开始的，V1 自动成为当前版本。
 *
 * ⚠️ 库里**已有的老包**仍是"包根直接是三组"的老结构（`version_id` 全空、
 * 界面归「未分版本」），扫描不会给它们补 V1 —— 用户拍板"老包不用管"，
 * 悄悄改人家硬盘上的结构比不做更糟。
 */
export function createPack(input: CreatePackInput): PackRow {
  const db = getDb()
  const root = input.workspaceRoot
  const rawName = (input.name ?? '').trim()
  const name = rawName || fallbackPackName()
  const category = (input.category ?? '').trim() || UNCATEGORIZED
  const channel = (input.channel ?? '').trim() || UNCATEGORIZED
  // 第 49 批（docs/34）：分级用**自己的**兜底值 UNGRADED，不用 UNCATEGORIZED
  const grade = (input.grade ?? '').trim() || UNGRADED

  // 三级结构下"归属哪个项目"直接决定包放进哪个文件夹，所以项目必须先确定
  ensureFolderNames()
  let projectId = typeof input.projectId === 'number' ? input.projectId : null
  if (projectId !== null && !db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    // 显式指定了不存在的项目 —— 报错而不是静默兜底，
    // 否则包会落进一个用户没预期的文件夹，事后很难解释
    throw new Error(COPY.wsErr.projectMissingForPack)
  }
  if (projectId === null) {
    const first = db
      .prepare('SELECT id FROM projects WHERE archived = 0 ORDER BY sort_order, id LIMIT 1')
      .get() as { id: number } | undefined
    projectId = first?.id ?? null
  }
  if (projectId === null) throw new Error(COPY.wsErr.noProjectYet)

  const proj = db
    .prepare('SELECT id, folder_name FROM projects WHERE id = ?')
    .get(projectId) as { id: number; folder_name: string }
  const projectDir = join(root, proj.folder_name)
  mkdirSync(projectDir, { recursive: true })

  // 重名判定在**项目文件夹内**做 —— 不同项目可以有同名包，这是三级结构白送的好处
  const folderPath = uniqueFolderPath(projectDir, sanitizeFolderName(name))

  // 建包文件夹 + **第一稿 V1**（V1 里再长三个组），由软件自动创建，同事不用自己建。
  // 第 9 批起包根不再直接放三组 —— 否则资源管理器里会多出 3 个永远空着的文件夹。
  mkdirSync(folderPath, { recursive: true })
  const firstDir = join(folderPath, FIRST_VERSION_FOLDER)
  mkdirSync(firstDir, { recursive: true })
  for (const sub of SUB_FOLDERS) {
    mkdirSync(join(firstDir, sub), { recursive: true })
  }

  const ts = nowIso()
  const info = db
    .prepare(
      `INSERT INTO packs (name, project_id, category, channel, grade, folder_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name, projectId, category, channel, grade, folderPath, ts, ts)

  const packId = Number(info.lastInsertRowid)

  // 第一稿立刻落库并成为当前版本。写在包记录之后（要外键 id），
  // 且**必须在下面的 scanAll 之前** —— 否则扫描会把这个 V1 文件夹当成
  // "用户手工建的稿"再自动认一遍（虽然撞名字会跳过，但没必要留这个歧义）。
  db.prepare(
    `INSERT INTO pack_versions (pack_id, seq, folder_name, note, is_current, created_at)
     VALUES (?, 1, ?, '', 1, ?)`
  ).run(packId, FIRST_VERSION_FOLDER, ts)

  const row = db.prepare('SELECT * FROM packs WHERE id = ?').get(packId) as PackRow

  // 包刚建好就顺手扫一次，把 id 与磁盘对齐
  scanAll(root)

  return row
}

// ---------------------------------------------------------------- 扫描 A-03/A-04

export interface ScanResult {
  packs: number
  files: number
  unassigned: number
  newFiles: number
  /** 第 7 批：本轮摘掉了几个"文件夹已不在磁盘上"的包记录（连同包内素材，没动磁盘文件） */
  cleanedPacks: number
  /** 第 8 批：本轮新标记为「文件已丢失」的素材条数（记录留着，等重新定位） */
  markedMissing: number
  /** 第 8 批：本轮找回（清除丢失标记）的素材条数 */
  restored: number
  /** 第 9 批（M6）：本轮自动认出的新稿数（用户自己在资源管理器里建的 V3 文件夹） */
  newVersions: number
  /** 第 9 批（M6）：编号冲突提示（名字像版本号但那个编号已被别的文件夹占着，不自动认） */
  versionConflicts: string[]
}

/**
 * 根目录第一层的分类结果。
 *
 * ⚠️ `rootReadable` 是关键安全阀：根目录读失败（移动硬盘没插 / 网络盘断线 / 权限不足）
 * **不等于**"里面什么都没有"。调用方必须先看这个标志，再决定能不能做删除判定。
 */
interface TopDirs {
  rootReadable: boolean
  /** 项目文件夹（根目录下、既不带三组、也不带版本层的目录） */
  projectDirs: string[]
  /** 游离的包（根目录下、带三组或带版本层的目录）→ 界面归「待归类」 */
  loosePacks: string[]
}

/** 目录的直接子级里有没有三组文件夹之一 */
function hasSubFolder(dir: string): boolean {
  for (const sub of SUB_FOLDERS) {
    try {
      if (statSync(join(dir, sub)).isDirectory()) return true
    } catch {
      /* 不存在，看下一个 */
    }
  }
  return false
}

/**
 * 目录的直接子级里有没有**版本层**（`V1` / `V2` …），且版本层里带三组之一。
 *
 * 第 55 批（docs/41）补：第 9 批起每个任务都自带 `V1`，任务文件夹的直接子级**不再**放三组，
 * 于是 `hasSubFolder` 对「躺在工作区根目录的待归类任务」判 false → 被当成「项目文件夹」，
 * 它里面的 `V1` 又被当成一个独立任务登记下来。结果是原任务变空、多出一个叫「V1」的幽灵任务，
 * 文件全挂到幽灵名下（命中「永不静默丢弃用户数据」：标签 / 版本 / 工单关联会挂错）。
 *
 * 为什么要连版本层里的三组一起看：只认「子目录叫 V<n>」会把「项目下有个任务恰好叫 V1」的
 * 项目文件夹误判成任务（那是更糟的方向 —— 整个项目连同它的任务会消失）。多看一层，零成本。
 */
function hasVersionLayer(dir: string): boolean {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return false
  }
  for (const name of entries) {
    if (!VERSION_FOLDER_RE.test(name)) continue
    const full = join(dir, name)
    try {
      if (statSync(full).isDirectory() && hasSubFolder(full)) return true
    } catch {
      /* 不存在 / 不是目录，看下一个 */
    }
  }
  return false
}

/** 列出某个目录下的直接子目录（跳过下划线 / 点开头的软件目录） */
function listSubDirs(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    const full = join(dir, name)
    try {
      if (statSync(full).isDirectory()) out.push(full)
    } catch {
      /* 读不到的项跳过 */
    }
  }
  return out
}

/**
 * 把工作区根目录的第一层分成「项目文件夹」与「游离的包」。
 *
 * 判据只有一条，看**直接子级**：
 *   根目录下的文件夹 F 直接含 01-成品 / 02-素材 / 03-工程 之一 → F 是【游离的包】
 *   否则                                                      → F 是【项目文件夹】
 *
 * 天然互斥：`项目\` 的直接子级是包文件夹名，只有 `项目\ces\` 的直接子级才含三组名。
 * 所以不需要在磁盘上留任何标记文件。
 */
function listTopDirs(workspaceRoot: string): TopDirs {
  let entries: string[]
  try {
    entries = readdirSync(workspaceRoot)
  } catch {
    return { rootReadable: false, projectDirs: [], loosePacks: [] }
  }

  const projectDirs: string[] = []
  const loosePacks: string[] = []
  for (const name of entries) {
    if (name.startsWith('_') || name.startsWith('.')) continue // _system / _thumbs / 两个收纳区
    const full = join(workspaceRoot, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    // 「这是任务文件夹（包）」的两条判据（第 55 批补齐第二条）：
    //   ① 直接子级带三组 —— 第 9 批前的老布局，或同事手动建的
    //   ② 直接子级带版本层 `V<n>` 且它里面有三组 —— 第 9 批起的标准布局
    // 少了 ②，根目录下的「待归类任务」就会被当项目文件夹，它里面的 V1 被当独立任务。
    if (hasSubFolder(full) || hasVersionLayer(full)) loosePacks.push(full)
    else projectDirs.push(full)
  }
  return { rootReadable: true, projectDirs, loosePacks }
}

/** p 是否位于 dir 之内（含子级）。按路径段比较，避免 `D:\a` 误配 `D:\abc` */
function isInside(p: string, dir: string): boolean {
  const rel = relative(dir, p)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * 判定一个文件属于哪个包、算哪一类 role（第 6 批的核心：**深度无关**）。
 *
 * 先定位「包文件夹」（最长前缀匹配），再在**相对包文件夹的子树**里找第一个匹配三组名的段：
 *
 *   项目\包\01-成品\a.png        → 包 = 项目\包，role = 成品
 *   项目\包\V1\01-成品\a.png     → 包 = 项目\包，role = 成品   ← 将来加版本层，这里一行不用改
 *   项目\包\随手丢.png           → 包 = 项目\包，role = 未归属（仍挂在包里）
 *   项目\散文件.txt              → 无包匹配，role = 未归属
 *
 * 老实现靠 `parts[0]` 数段数（第 0 段是包、第 1 段是子文件夹），包下插一层就全崩 —— 换掉了。
 *
 * `sortedPackDirs` 必须按长度**降序**传入：第一个匹配的就是最长前缀。
 */
function locateFile(
  sortedPackDirs: string[],
  absPath: string
): { packPath: string | null; role: string } {
  let best: string | null = null
  for (const p of sortedPackDirs) {
    if (isInside(absPath, p)) {
      best = p
      break
    }
  }
  if (!best) return { packPath: null, role: UNASSIGNED_ROLE }

  const parts = relative(best, absPath).split(sep)
  // 最后一段是文件名，只在它前面的目录段里找三组名
  for (let i = 0; i < parts.length - 1; i += 1) {
    const role = FOLDER_TO_ROLE[parts[i]]
    if (role) return { packPath: best, role }
  }
  return { packPath: best, role: UNASSIGNED_ROLE }
}

// ---------------------------------------------------------------- 版本识别（第 9 批 M6 版本管理）

/**
 * 版本文件夹的命名模式。软件建的就是 `V1/V2/V3`；用户自己手工建、且按这个格式命名的，
 * 扫描时**自动认**成对应编号的稿。
 * 名字不规范的（"最终版-客户确认"）不会被自动认 —— 那正是「绑定文件夹」要解决的事。
 */
export const VERSION_FOLDER_RE = /^[Vv](\d+)$/

/**
 * 判定一个文件属于哪一稿（与 `locateFile` 同一路数：**深度无关**，找第一个匹配的段）。
 *
 *   包\V2\01-成品\a.png       → 第 2 稿
 *   包\V2\a.png               → 第 2 稿（没进三组也算这一稿的）
 *   包\01-成品\a.png          → 未分版本（老包）
 *   包\最终版\01-成品\a.png   → 未分版本（绑过才会认，靠 folder_name 匹配）
 *
 * ⚠️ Windows 文件系统不区分大小写，用户建 `v2` 也要能匹配库里的 `V2` → 比较前统一小写。
 */
function locateVersion(
  packPath: string,
  absPath: string,
  versions: Array<{ id: number; folder_name: string }>
): number | null {
  if (!versions.length) return null
  const parts = relative(packPath, absPath).split(sep)
  for (let i = 0; i < parts.length - 1; i += 1) {
    const seg = parts[i].toLowerCase()
    const hit = versions.find((v) => v.folder_name.toLowerCase() === seg)
    if (hit) return hit.id
  }
  return null
}

/**
 * 扫描第 3.5 步：把磁盘上「名字像版本号」的文件夹自动认成稿。
 *
 * 三条规矩（docs/11 §5）：
 *   · 名字符合 `V<数字>`、这个包还没认领过这个名字 → 建一条版本记录
 *   · 该编号已经被**别的**文件夹占着（手工建的撞上了已绑定的第 2 稿）→ **不认**，只提示
 *   · 名字不规范 → 不认，等用户在界面里「绑定文件夹」
 */
function detectVersions(
  packPlan: Array<{ dir: string }>,
  packIdByFolder: Map<string, number>
): { newVersions: number; versionConflicts: string[] } {
  const db = getDb()
  const ts = nowIso()
  const conflicts: string[] = []
  let newVersions = 0

  const knownByPack = new Map<number, Array<{ id: number; folder_name: string; seq: number }>>()
  for (const v of db
    .prepare('SELECT id, pack_id, folder_name, seq FROM pack_versions')
    .all() as Array<{ id: number; pack_id: number; folder_name: string; seq: number }>) {
    const arr = knownByPack.get(v.pack_id) ?? []
    arr.push({ id: v.id, folder_name: v.folder_name, seq: v.seq })
    knownByPack.set(v.pack_id, arr)
  }

  const ins = db.prepare(
    `INSERT INTO pack_versions (pack_id, seq, folder_name, note, is_current, created_at)
     VALUES (?, ?, ?, '', 0, ?)`
  )

  // 解绑过的文件夹名（见 db.ts 里 pack_version_ignores 的注释）：不再自动认领，
  // 想收回管理得用户自己点「绑定文件夹」。否则解绑按下去毫无效果 —— 下一轮扫描又认回来。
  const ignoredByPack = new Map<number, string[]>()
  for (const r of db
    .prepare('SELECT pack_id, folder_name FROM pack_version_ignores')
    .all() as Array<{ pack_id: number; folder_name: string }>) {
    const arr = ignoredByPack.get(r.pack_id) ?? []
    arr.push(r.folder_name.toLowerCase())
    ignoredByPack.set(r.pack_id, arr)
  }

  db.transaction(() => {
    for (const p of packPlan) {
      const pid = packIdByFolder.get(p.dir)
      if (!pid) continue
      const known = knownByPack.get(pid) ?? []
      const ignored = ignoredByPack.get(pid) ?? []
      for (const sub of listSubDirs(p.dir)) {
        const name = basename(sub)
        const m = VERSION_FOLDER_RE.exec(name)
        if (!m) continue
        const seq = Number(m[1])
        // 这个名字已经认领过（大小写不敏感）→ 跳过
        if (known.some((v) => v.folder_name.toLowerCase() === name.toLowerCase())) continue
        // 用户解绑过这个名字 → 不自动认（等他手工绑定）
        if (ignored.includes(name.toLowerCase())) continue
        const taken = known.find((v) => v.seq === seq)
        if (taken) {
          conflicts.push(
            fmt(COPY.wsErr.folderTaken, { name: name, seq: seq, taken: taken.folder_name })
          )
          continue
        }
        const info = ins.run(pid, seq, name, ts)
        known.push({ id: Number(info.lastInsertRowid), folder_name: name, seq })
        knownByPack.set(pid, known)
        newVersions += 1
      }
    }
  })()

  return { newVersions, versionConflicts: conflicts }
}

/**
 * 第 47 批（docs/33 §3.2）：这个文件名算不算「临时文件」。
 *
 * 规则刻意收得很窄 —— 宁可漏放几个，也别误伤用户的真实素材：
 *   ① `~` 开头 —— 设计软件暂存（`~S…`）/ Office 锁文件（`~$…`）/ Word 恢复文件（`~WRL…tmp`）
 *   ② `~` 结尾 —— 编辑器的备份文件（`方案.pptx~`）
 *   ③ 扩展名 ∈ { tmp temp crdownload part partial !ut } —— 通用临时、下载未完成
 *   ④ 固定名 Thumbs.db / desktop.ini —— Windows 自动生成的元数据
 * 匹配一律先转小写（Windows 文件系统不区分大小写）。
 *
 * 导出成纯函数：accept 直接断言"该拦的拦、不该拦的不拦"（§9.1 [35] 段）。
 */
const TEMP_FILE_EXTS = new Set(['tmp', 'temp', 'crdownload', 'part', 'partial', '!ut'])

export function isTempFile(fileName: string): boolean {
  const n = fileName.toLowerCase()
  if (n.startsWith('~') || n.endsWith('~')) return true
  if (n === 'thumbs.db' || n === 'desktop.ini') return true
  const dot = n.lastIndexOf('.')
  if (dot > 0) return TEMP_FILE_EXTS.has(n.slice(dot + 1))
  return false
}

// ================================================================ 第 53 批（docs/38）：封面文件

/**
 * 封面文件的文件名词根（不含扩展名）。**精确匹配** —— 名字越独特越不会误伤普通素材。
 *
 * 动机：PPT / AI / ZIP 这类任务包**取不出缩略图**（sharp 抓不了这些格式），
 * 包卡片封面和工单「缩略图」列就一直是空的。用户提的做法：
 * 允许在包里放一个**约定文件名**的图片当封面（**只在没有可抓取的文件时**才用）。
 *
 * ⚠️ 它本身仍是**正常素材**：进文件列表、可打标签、算进文件数 —— 只是**顺带**能当封面。
 *
 * ⚠️⚠️ **它以下划线开头**，而扫描器原本**跳过所有 `_` 开头的东西**（那是软件自己的
 * `_thumbs` / `_system` 目录的约定）。所以 `collectFiles` 里为它开了**唯一一个例外** ——
 * 不加那个例外，文件根本进不了库，整个功能形同虚设（第 53 批施工时实测踩到）。
 */
export const COVER_BASENAME = '_封面'

/** 认的扩展名（用户要 jpg/png；jpeg 只是 jpg 的另一种后缀写法，一并收） */
const COVER_EXTS = new Set(['jpg', 'jpeg', 'png'])

/** 文件名是不是「封面文件」（`_封面.jpg` / `_封面.jpeg` / `_封面.png`，扩展名不分大小写） */
export function isCoverFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return false
  return (
    fileName.slice(0, dot) === COVER_BASENAME &&
    COVER_EXTS.has(fileName.slice(dot + 1).toLowerCase())
  )
}

/**
 * 递归收集某个包文件夹下所有文件（跳过下划线 / 点开头的软件目录）。
 *
 * `skipTemp`（第 47 批 docs/33 §5.2）：为真时跳过临时文件（见 `isTempFile`）。
 * 是否跳过由**所属任务的 `scan_temp`** 决定，调用方（`scanAll`）负责算好传进来。
 */
function collectFiles(dir: string, out: string[] = [], skipTemp = false): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    // `_` / `.` 开头 = 软件自己的目录（`_thumbs` / `_system`）或系统隐藏项 → 跳过。
    // 第 53 批（docs/38）**唯一例外**：封面文件（`_封面.jpg` 等）。
    // 它虽然也以下划线开头，但那是**用户放的正常素材**，必须收进来 ——
    // 否则文件进不了库，整个封面功能形同虚设。
    // 边界安全：`isCoverFileName` 要求"词根恰为 `_封面` + 扩展名是图片"，而
    // `_thumbs` / `_system` 永远不满足 → 原有跳过行为一个字节没变。
    if ((name.startsWith('_') || name.startsWith('.')) && !isCoverFileName(name)) continue
    const full = join(dir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) collectFiles(full, out, skipTemp)
    else if (st.isFile()) {
      if (skipTemp && isTempFile(name)) continue
      out.push(full)
    }
  }
  return out
}

/**
 * 直接躺在某个目录下的文件（不递归）。
 * `skipTemp`（第 47 批）：未归属散文件不属于任何任务，调用方一律传 true。
 */
function filesDirectlyIn(dir: string, skipTemp = false): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    if (skipTemp && isTempFile(name)) continue
    const full = join(dir, name)
    try {
      if (statSync(full).isFile()) out.push(full)
    } catch {
      /* 跳过读不到的项 */
    }
  }
  return out
}

/**
 * A-03 + A-04：全量扫描工作区，登记文件基础信息并归位。
 *
 * 第 6 批（三级结构）流程：
 *   1. 根目录第一层 → 项目文件夹 + 游离的包
 *   2. 项目文件夹的直接子级 → 包文件夹
 *   3. 磁盘上有的包、库里没有 → 补记录
 *      （项目文件夹下的挂到该项目；游离包 `project_id` 留空 = 界面上的「待归类」）
 *   4. 收集文件 → upsert（role 深度无关判定）
 *      （第 47 批 docs/33：默认**跳过临时文件** —— 逐包看 `packs.scan_temp`，见第 3 步）
 *   4.5 版本识别（第 9 批 M6）：磁盘上名字像 `V2` 的文件夹自动认成稿；文件挂上 version_id
 *   5. 失效检查：磁盘上已不存在的素材记录 → 打「文件已丢失」标记（第 8 批 M8-03，
 *      **不再删记录**）；文件挪回来自动清标记
 *   6. 清理：包文件夹已不在磁盘上的包记录 → 连同包内素材记录一起摘掉（第 7 批，摘前留痕）
 *
 * ⚠️ 安全阀：根目录读失败时**整段跳过删除判定**。
 * 工作区放在移动硬盘 / 网络盘上、设备没连的时候，"读不到"绝不是"全没了" ——
 * 一次刷新清空全部索引是这类软件最致命的事故。
 */
export function scanAll(workspaceRoot: string): ScanResult {
  const db = getDb()
  const ts = nowIso()

  // 1. 分类根目录第一层，列出所有包文件夹
  const { rootReadable, projectDirs, loosePacks } = listTopDirs(workspaceRoot)

  ensureFolderNames()
  const projRows = db
    .prepare("SELECT id, folder_name FROM projects WHERE folder_name <> ''")
    .all() as Array<{ id: number; folder_name: string }>
  const projIdByFolder = new Map<string, number>()
  for (const p of projRows) {
    projIdByFolder.set(join(workspaceRoot, p.folder_name).toLowerCase(), p.id)
  }

  // 包文件夹 → 归属项目（游离包为空 → 「待归类」）
  const packPlan: Array<{ dir: string; projectId: number | null }> = []
  for (const pd of projectDirs) {
    const pid = projIdByFolder.get(pd.toLowerCase()) ?? null
    for (const pk of listSubDirs(pd)) packPlan.push({ dir: pk, projectId: pid })
  }
  for (const lp of loosePacks) packPlan.push({ dir: lp, projectId: null })

  // 2. 让硬盘上的包文件夹与数据库对齐（同事可能手动建了文件夹）
  const knownPack = db.prepare('SELECT id FROM packs WHERE folder_path = ?')
  const insPack = db.prepare(
    `INSERT INTO packs (name, project_id, category, channel, grade, folder_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const p of packPlan) {
    if (knownPack.get(p.dir)) continue
    // 硬盘上先有的文件夹，补一条记录（包名 = 文件夹名，类别/场景记「未分类」、分级记「未分级」）
    insPack.run(basename(p.dir), p.projectId, UNCATEGORIZED, UNCATEGORIZED, UNGRADED, p.dir, ts, ts)
  }

  // 3. 收集所有文件
  //    第 47 批（docs/33 §5.2）：**按任务逐包判定** —— 包的 `scan_temp = 0`（默认）时跳过临时文件；
  //    勾了「扫描临时文件」的任务（`scan_temp = 1`）照旧全收。
  //    未归属散文件不属于任何任务，没地方挂"例外开关" → **永远跳过**临时文件。
  const packScanTemp = db.prepare('SELECT scan_temp FROM packs WHERE folder_path = ?')
  const allFiles: string[] = []
  for (const p of packPlan) {
    const row = packScanTemp.get(p.dir) as { scan_temp: number } | undefined
    collectFiles(p.dir, allFiles, row?.scan_temp !== 1)
  }
  if (rootReadable) {
    // 根目录下、项目文件夹下**直接躺着**的散文件 → 未归属池
    allFiles.push(...filesDirectlyIn(workspaceRoot, true))
    for (const pd of projectDirs) allFiles.push(...filesDirectlyIn(pd, true))
  }

  // 4. 逐个 upsert。铁则：只登记，永不删除用户文件
  const packIdByFolder = new Map<string, number>()
  for (const p of db.prepare('SELECT id, folder_path FROM packs').all() as PackRow[]) {
    packIdByFolder.set(p.folder_path, p.id)
  }

  // 4.5 版本识别（第 9 批 M6）：磁盘上"名字像版本号"的文件夹 → 自动认成稿
  const { newVersions, versionConflicts } = detectVersions(packPlan, packIdByFolder)

  // 版本清单（刚被 4.5 补过几条，所以放在它后面读）
  const versionsByPack = new Map<number, Array<{ id: number; folder_name: string }>>()
  for (const v of db
    .prepare('SELECT id, pack_id, folder_name FROM pack_versions')
    .all() as Array<{ id: number; pack_id: number; folder_name: string }>) {
    const arr = versionsByPack.get(v.pack_id) ?? []
    arr.push({ id: v.id, folder_name: v.folder_name })
    versionsByPack.set(v.pack_id, arr)
  }

  // 长度降序 → 第一个匹配的就是最长前缀（= 所属包）
  const sortedPackDirs = packPlan.map((p) => p.dir).sort((a, b) => b.length - a.length)

  let newFiles = 0
  let unassigned = 0
  const upsert = db.prepare(
    `INSERT INTO assets (pack_id, role, file_name, ext, size, abs_path, rel_path, created_at, modified_at, scanned_at, version_id)
     VALUES (@pack_id, @role, @file_name, @ext, @size, @abs_path, @rel_path, @created_at, @modified_at, @scanned_at, @version_id)
     ON CONFLICT(abs_path) DO UPDATE SET
       pack_id     = excluded.pack_id,
       role        = excluded.role,
       file_name   = excluded.file_name,
       ext         = excluded.ext,
       size        = excluded.size,
       rel_path    = excluded.rel_path,
       modified_at = excluded.modified_at,
       scanned_at  = excluded.scanned_at,
       version_id  = excluded.version_id`
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
      const { packPath, role } = locateFile(sortedPackDirs, abs)
      if (role === UNASSIGNED_ROLE) unassigned += 1
      if (!existsStmt.get(abs)) newFiles += 1
      const pid = packPath ? (packIdByFolder.get(packPath) ?? null) : null

      upsert.run({
        pack_id: pid,
        role,
        file_name: basename(abs),
        ext: extname(abs).replace(/^\./, '').toLowerCase(),
        size: st.size,
        abs_path: abs,
        rel_path: relative(workspaceRoot, abs),
        created_at: st.birthtime.toISOString(),
        modified_at: st.mtime.toISOString(),
        scanned_at: ts,
        // 第 9 批：属于哪一稿。文件在磁盘上挪了位置，这里会自动跟着更新
        version_id:
          pid !== null && packPath
            ? locateVersion(packPath, abs, versionsByPack.get(pid) ?? [])
            : null
      })
    }
  })
  tx(allFiles)

  // 5. 失效检查（第 8 批 M8-03）：磁盘上已不存在的记录 → 打「文件已丢失」标记。
  //
  // ⚠️ 这一条**推翻**了第 1 批的写法（原来是直接 DELETE，见 docs/10 §1.2）：
  //    记录一删，asset_tags 的 ON DELETE CASCADE 就跟着把标签关联一起蒸发，
  //    用户永远不知道文件丢了，更没法重新定位。需求文档 M8-03 要的是「标记 + 重新定位」。
  //
  // 逻辑抽在 markMissingAssets 里（能单独验证"根目录读不到时一条都不许标"）。
  const { markedMissing, restored } = markMissingAssets(rootReadable)

  // 6. 包记录回收（第 7 批 ①）：包文件夹在磁盘上没了 → 记录也摘掉（摘前留痕）
  const cleanedPacks = cleanupMissingPacks(workspaceRoot, rootReadable)

  // 7. 更新包的 updated_at（取包内最新文件时间）
  db.prepare(
    `UPDATE packs SET updated_at = COALESCE(
       (SELECT MAX(scanned_at) FROM assets WHERE assets.pack_id = packs.id), updated_at)`
  ).run()

  const packsCount = (db.prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c

  return {
    packs: packsCount,
    files: allFiles.length,
    unassigned,
    newFiles,
    cleanedPacks,
    markedMissing,
    restored,
    newVersions,
    versionConflicts
  }
}

// ---------------------------------------------------------------- 失效检查（第 8 批 M8-03）

/**
 * 扫描第 5 步：磁盘上已不存在的素材 → 打「文件已丢失」标记；文件回来的 → 清标记。
 *
 * **为什么抽成独立函数**：真窗口 / 真工作区里没法模拟"移动硬盘没插"，
 * 而这道门（门一）恰恰是最不能出错的地方 —— 拔一次硬盘把全库标成丢失是最致命的事故。
 * 抽出来之后单元断言能直接 `markMissingAssets(false)` 验证"一条都不许标"。
 * 第 7 批的 `cleanupMissingPacks(workspaceRoot, rootReadable)` 是同样的路数。
 *
 * 五道门，缺一就会误标：
 *   ① `rootReadable` —— 根目录读不到 ≠ 里面什么都没有
 *   ② 文件确实不在磁盘上（`!existsSync`）
 *   ③ 素材**可见**（`VISIBLE_PACK_SQL`：所属项目未解绑）—— 解绑项目的文件夹在
 *      `_已解绑的项目` 下，扫描本来就不扫那里；不豁免的话，解绑当天整个项目的记录会集体"丢失"
 *   ④ 所属**包文件夹还在** —— 包整个没了交给包清理统一处理（连带摘掉包内素材，见 §2.3），
 *      用户删的是整包，不该在文件视图里冒出一堆"丢失素材"
 *   ⑤ **所属任务已备份**（`backed_up_at` 非空）—— 第 58 批（docs/43）：备份是任务的
 *      **收尾动作**，之后就是删文件腾空间。整任务豁免，任务内文件没了也不报警。
 *      ⚠️ 门五**只挡"打标记"，不影响"清标记"**：已备份任务里不会产生新标记，
 *      而备份动作本身已经顺手清了一遍残留标记（见 `backupPack.ts` 第 6 步）。
 *      ⚠️ 门五排在门四**之后**：包文件夹整个没了仍走包清理，不被门五截胡。
 */
export function markMissingAssets(rootReadable: boolean): {
  markedMissing: number
  restored: number
} {
  if (!rootReadable) return { markedMissing: 0, restored: 0 } // 门一
  const db = getDb()
  const ts = nowIso()

  const known = db
    .prepare(
      `SELECT a.id, a.abs_path, a.missing_at, k.folder_path, k.backed_up_at
         FROM assets a
         LEFT JOIN packs k ON k.id = a.pack_id
        WHERE ${VISIBLE_PACK_SQL}` // 门三：解绑项目的素材压根不在结果集里
    )
    .all() as Array<{
    id: number
    abs_path: string
    missing_at: string | null
    folder_path: string | null
    backed_up_at: string | null
  }>

  const markLost = db.prepare('UPDATE assets SET missing_at = ? WHERE id = ?')
  // 第 47 批（docs/33 §4.3）：文件回来了，**两个标记一起清** ——
  // 既清「丢失」，也清「已忽略」（这条记录又有效了，不该继续躺在"已忽略"里）。
  const markBack = db.prepare(
    `UPDATE assets
        SET missing_at = NULL, missing_ignored_at = NULL, size = ?, modified_at = ?
      WHERE id = ?`
  )

  let markedMissing = 0
  let restored = 0
  db.transaction(() => {
    for (const a of known) {
      if (a.folder_path !== null && !existsSync(a.folder_path)) continue // 门四
      // 门五（第 58 批 docs/43）：所属任务已备份 → 整任务豁免，任务内文件没了也不报警
      if (a.backed_up_at !== null) continue
      if (!existsSync(a.abs_path)) {
        // 只在「无标记 → 有标记」时写：保住"第一次发现丢失"的时刻，别每次刷新都改
        if (a.missing_at === null) {
          markLost.run(ts, a.id)
          markedMissing += 1
        }
      } else if (a.missing_at !== null) {
        // 文件回来了（用户重新定位、或自己在资源管理器里挪回来）→ 清标记，
        // 顺手刷新大小与修改时间（内容可能已经换了）
        try {
          const st = statSync(a.abs_path)
          markBack.run(st.size, st.mtime.toISOString(), a.id)
          restored += 1
        } catch {
          /* 拿不到 stat 就当这次没回来，留给下轮扫描 */
        }
      }
    }
  })()

  return { markedMissing, restored }
}

// ---------------------------------------------------------------- 重新定位（第 8 批 M8-03）

/** 重新定位候选的校验结果 */
export interface RelocateCheck {
  ok: boolean
  /** 不通过的原因（通过时为空串） */
  reason: string
  absPath: string
  relPath: string
}

/**
 * 校验「用户选中的这个文件，是不是那条丢失记录的同一份」。
 *
 * 判据（用户拍板）：**文件名 + 扩展名 + 大小** 三者全对才接受。
 * 刻意不读文件内容 —— 算内容指纹是 M8-02「重复文件检测」才该干的事，这一批不该引进来。
 */
function verifyRelocateTarget(
  asset: AssetRow,
  newAbsPath: string,
  workspaceRoot: string
): RelocateCheck {
  if (!existsSync(newAbsPath)) {
    return { ok: false, reason: COPY.wsErr.fileNotExist, absPath: '', relPath: '' }
  }
  const rel = relative(workspaceRoot, newAbsPath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return {
      ok: false,
      reason: COPY.wsErr.outsideWorkspace,
      absPath: '',
      relPath: ''
    }
  }
  const name = basename(newAbsPath)
  if (name !== asset.file_name) {
    return {
      ok: false,
      reason: fmt(COPY.wsErr.nameMismatch, { record: asset.file_name, picked: name }),
      absPath: '',
      relPath: ''
    }
  }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(newAbsPath)
  } catch {
    return { ok: false, reason: COPY.wsErr.unreadable, absPath: '', relPath: '' }
  }
  if (st.size !== asset.size) {
    return {
      ok: false,
      reason: fmt(COPY.wsErr.sizeMismatch, { record: asset.size, picked: st.size }),
      absPath: '',
      relPath: ''
    }
  }
  return { ok: true, reason: '', absPath: newAbsPath, relPath: rel }
}

/**
 * 单条重新定位：校验通过就在**原记录上**改路径（id 不变 → 标签、缩略图全都留着）。
 *
 * 绝不新建记录 —— 那等于把标签丢了（第 7 批的教训：abs_path 是 UNIQUE 键，
 * 换路径不能靠"删旧建新"）。
 */
export function relocateAsset(
  assetId: number,
  newAbsPath: string,
  workspaceRoot: string
): { ok: boolean; error?: string; relPath?: string } {
  const db = getDb()
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as AssetRow | undefined
  if (!asset) return { ok: false, error: COPY.wsErr.assetGone }

  const check = verifyRelocateTarget(asset, newAbsPath, workspaceRoot)
  if (!check.ok) return { ok: false, error: check.reason }

  let st: ReturnType<typeof statSync>
  try {
    st = statSync(newAbsPath)
  } catch {
    return { ok: false, error: COPY.wsErr.unreadablePlain }
  }

  try {
    db.transaction(() => {
      // ⚠️ 这段是"常态"，不是异常处理：
      // 用户把文件挪到**工作区内**的新位置后，那一轮扫描已经把它登记成一条**新记录**了
      // （未归属、多半没标签），新路径因此被占住 —— 直接 UPDATE 必撞 abs_path 的 UNIQUE。
      // 处理：把占用者身上可能有的标签转挂到这条老记录上，再删掉它。
      // 结果是一条文件还是一条（老记录留着 → 标签、缩略图、id 全保住）。
      const occupant = db
        .prepare('SELECT id FROM assets WHERE abs_path = ? AND id <> ?')
        .get(check.absPath, assetId) as { id: number } | undefined
      if (occupant) {
        db.prepare(
          `INSERT OR IGNORE INTO asset_tags (asset_id, tag_id)
             SELECT @keep, tag_id FROM asset_tags WHERE asset_id = @drop`
        ).run({ keep: assetId, drop: occupant.id })
        db.prepare('DELETE FROM assets WHERE id = ?').run(occupant.id)
      }
      db.prepare(
        `UPDATE assets
            SET abs_path = @abs, rel_path = @rel, file_name = @name, ext = @ext,
                size = @size, modified_at = @mod, missing_at = NULL, scanned_at = @ts
          WHERE id = @id`
      ).run({
        id: assetId,
        abs: check.absPath,
        rel: check.relPath,
        name: basename(check.absPath),
        ext: extname(check.absPath).replace(/^\./, '').toLowerCase(),
        size: st.size,
        mod: st.mtime.toISOString(),
        ts: nowIso()
      })
    })()
  } catch (e) {
    return { ok: false, error: COPY.wsErr.writeFailed + (e as Error).message }
  }
  return { ok: true, relPath: check.relPath }
}

export interface RelocateSuggestion {
  assetId: number
  fileName: string
  oldRelPath: string
  matchedPath: string | null
  ok: boolean
  /** 命中说明 或 没配上/校验不过的原因 */
  reason: string
}

/**
 * 批量重新定位：用户选一个目录，对每条丢失记录按 `rel_path` **逐级降级**试匹配。
 *
 * 例（原 rel_path = 甲项目/甲包/01-成品/a.png，用户选了目录 D）：
 *   ① D/甲项目/甲包/01-成品/a.png   完整结构
 *   ② D/甲包/01-成品/a.png          去掉项目层
 *   ③ D/01-成品/a.png               只剩组名
 *   ④ D/a.png                       只有文件名（最宽松）
 *
 * **只出候选、不落库** —— 必须先让用户看到"哪条配到哪个文件"、勾选后才写（用户拍板）。
 */
export function suggestRelocateBatch(dir: string, workspaceRoot: string): RelocateSuggestion[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT a.* FROM assets a
         LEFT JOIN packs k ON k.id = a.pack_id
        WHERE a.missing_at IS NOT NULL AND (${VISIBLE_PACK_SQL})
        ORDER BY a.rel_path`
    )
    .all() as AssetRow[]

  return rows.map((a) => {
    const parts = (a.rel_path || a.file_name).split(sep).filter(Boolean)
    for (let drop = 0; drop < parts.length; drop += 1) {
      const cand = join(dir, ...parts.slice(drop))
      if (!existsSync(cand)) continue
      const chk = verifyRelocateTarget(a, cand, workspaceRoot)
      if (chk.ok) {
        return {
          assetId: a.id,
          fileName: a.file_name,
          oldRelPath: a.rel_path,
          matchedPath: cand,
          ok: true,
          reason: drop === 0 ? COPY.ws.reasonFullMatch : fmt(COPY.ws.reasonDropMatch, { n: drop })
        }
      }
      // 找到了同名文件但校验不过 → 直接报原因，不再往下猜（再猜更容易指错）
      return {
        assetId: a.id,
        fileName: a.file_name,
        oldRelPath: a.rel_path,
        matchedPath: null,
        ok: false,
        reason: chk.reason
      }
    }
    return {
      assetId: a.id,
      fileName: a.file_name,
      oldRelPath: a.rel_path,
      matchedPath: null,
      ok: false,
      reason: COPY.ws.reasonNotFound
    }
  })
}

/** 批量落库：只写用户勾选的那些（逐条仍走 relocateAsset 的校验） */
export function applyRelocateBatch(
  items: Array<{ assetId: number; newAbsPath: string }>,
  workspaceRoot: string
): { moved: number; errors: string[] } {
  let moved = 0
  const errors: string[] = []
  for (const it of items) {
    const r = relocateAsset(it.assetId, it.newAbsPath, workspaceRoot)
    if (r.ok) moved += 1
    else errors.push(r.error ?? COPY.wsErr.unknown)
  }
  return { moved, errors }
}

// ---------------------------------------------------------------- 认领 A-09

/** 把未归属文件搬进指定包的目标子文件夹，然后重新扫描 */
export function claimFiles(
  workspaceRoot: string,
  absPaths: string[],
  packId: number,
  subFolder: SubFolder,
  /**
   * 第 9 批（M6）搬进哪一稿的组里：
   *   · 传数字 → 搬进那一稿（界面正在看某一稿时）
   *   · 传 `null` → 明确要「未分版本」（落在包根的三组，老结构）
   *   · **不传** → 自动：包有当前版本就落当前版本（新建包默认有 V1），
   *     没有版本的老包落包根三组。这样从「未归属池」认领进新包的文件
   *     会直接进 V1，而不是落在包根变成一个"未分版本"的孤儿。
   */
  versionId?: number | null
): { moved: number; errors: string[] } {
  const db = getDb()
  const pack = db.prepare('SELECT * FROM packs WHERE id = ?').get(packId) as PackRow | undefined
  if (!pack) return { moved: 0, errors: [COPY.wsErr.targetPackMissing] }
  if (!SUB_FOLDERS.includes(subFolder)) return { moved: 0, errors: [COPY.wsErr.badSubFolder] }

  // 目标目录：有稿就落在「那一稿文件夹」里，否则落在包根目录下的组里。
  // 这一层不能搞错 —— 搞错等于把文件悄悄挪出了那一稿（用户看到的是"移了个位置，版本没了"）。
  let baseDir = pack.folder_path
  let targetVersionId: number | null = null
  const pickVersion = db.prepare(
    'SELECT id, folder_name FROM pack_versions WHERE id = ? AND pack_id = ?'
  )
  if (versionId === undefined) {
    const cur = db
      .prepare('SELECT id, folder_name FROM pack_versions WHERE pack_id = ? AND is_current = 1')
      .get(packId) as { id: number; folder_name: string } | undefined
    if (cur) {
      baseDir = join(pack.folder_path, cur.folder_name)
      targetVersionId = cur.id
    }
  } else if (versionId !== null) {
    const v = pickVersion.get(versionId, packId) as { id: number; folder_name: string } | undefined
    if (!v) return { moved: 0, errors: [COPY.wsErr.targetVerMissing] }
    baseDir = join(pack.folder_path, v.folder_name)
    targetVersionId = v.id
  }

  const targetDir = join(baseDir, subFolder)
  mkdirSync(targetDir, { recursive: true })

  let moved = 0
  const errors: string[] = []
  const movedPairs: Array<[string, string]> = []

  for (const src of absPaths) {
    if (!existsSync(src)) {
      errors.push(fmt(COPY.wsErr.fileGone, { name: basename(src) }))
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
      movedPairs.push([src, dest])
    } catch (e) {
      errors.push(`${basename(src)}：${(e as Error).message}`)
    }
  }

  // 搬完立刻**在原记录上重写路径**，不靠重新扫描兜底。
  // 扫描认的键是 abs_path（UNIQUE）：旧路径那条会被判成「文件已丢失」（第 8 批起）
  // 或直接被删（第 8 批以前），新路径又登记成一条新记录 —— 一条文件变两条；
  // 更要命的是旧记录 id 一消失，挂在它上的标签关联（asset_tags ON DELETE CASCADE）
  // 跟着蒸发，用户认领前打的标签白打了。
  // 这与第 7 批 movePackTo 是同一条规矩：**软件自己搬的东西，自己把路径改对**。
  if (movedPairs.length) {
    const find = db.prepare('SELECT id FROM assets WHERE abs_path = ?')
    const upd = db.prepare(
      `UPDATE assets
          SET abs_path = @abs, rel_path = @rel, file_name = @name, ext = @ext,
              pack_id = @pack, role = @role, version_id = @ver,
              missing_at = NULL, scanned_at = @ts
        WHERE id = @id`
    )
    const ts = nowIso()
    db.transaction(() => {
      for (const [src, dest] of movedPairs) {
        const row = find.get(src) as { id: number } | undefined
        if (!row) continue // 没登记过（极罕见）→ 交给下面的 scanAll 兜底
        try {
          upd.run({
            id: row.id,
            abs: dest,
            rel: relative(workspaceRoot, dest),
            name: basename(dest),
            ext: extname(dest).replace(/^\./, '').toLowerCase(),
            pack: packId,
            role: FOLDER_TO_ROLE[subFolder] ?? UNASSIGNED_ROLE,
            ver: targetVersionId,
            ts
          })
        } catch {
          /* 撞 UNIQUE（库里已有同路径的脏数据）→ 不拦搬家本身，交给 scanAll */
        }
      }
    })()
  }

  if (moved > 0) scanAll(workspaceRoot)
  return { moved, errors }
}

// ---------------------------------------------------------------- 项目 ↔ 文件夹（第 6 批）

/**
 * 回填 `projects.folder_name`。幂等，可反复调用。
 *
 * 这里（以及下面的 uniqueFolderName）是 `folder_name` 的**唯一生成者** ——
 * db.ts 只负责建列，不参与取值，避免两处规则打架。
 */
export function ensureFolderNames(): void {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, name, folder_name FROM projects ORDER BY sort_order, id')
    .all() as Array<{ id: number; name: string; folder_name: string }>

  // 已有的 folder_name 先占位，避免新回填出来的名字撞上它
  const taken = new Set<string>()
  for (const r of rows) if (r.folder_name) taken.add(r.folder_name.toLowerCase())

  const setStmt = db.prepare('UPDATE projects SET folder_name = ? WHERE id = ?')
  for (const r of rows) {
    if (r.folder_name) continue
    const base = sanitizeFolderName(r.name) || fmt(COPY.ws.fallbackProjectFolder, { id: r.id })
    let cand = base
    let i = 2
    while (taken.has(cand.toLowerCase())) {
      cand = `${base}-${i}`
      i += 1
      if (i > 999) break
    }
    taken.add(cand.toLowerCase())
    setStmt.run(cand, r.id)
  }
}

/**
 * 给一个项目名算可用的文件夹名：消毒 + 避开其他项目已占用的名字。
 * `excludeId` 传改名的项目自己 —— 它原来占的名字不该算冲突。
 */
function uniqueFolderName(name: string, excludeId?: number): string {
  const db = getDb()
  const rows = db
    .prepare('SELECT folder_name FROM projects WHERE id <> ?')
    .all(excludeId ?? -1) as Array<{ folder_name: string }>
  const taken = new Set(rows.map((r) => r.folder_name.toLowerCase()).filter(Boolean))

  const base = sanitizeFolderName(name) || COPY.ws.untitledProject
  let cand = base
  let i = 2
  while (taken.has(cand.toLowerCase())) {
    cand = `${base}-${i}`
    i += 1
    if (i > 999) break
  }
  return cand
}

/**
 * 确保每个项目的文件夹都在磁盘上（"建工作区时预设几个项目"也要有文件夹）。
 * 返回本次新建的个数。
 *
 * 第 7 批：**已解绑的项目（archived = 1）必须排除**。
 * 它的文件夹现在躺在 `_已解绑的项目` 里；这里要是不排除，每个 IPC 调用前的
 * `initWorkspace` 都会在根目录把同名文件夹重新建出来一个空的 ——
 * 结果是「软件里看不见、根目录却多一个空壳」，而且还原时会被自己建的壳挡住。
 */
export function syncProjectFolders(workspaceRoot: string): number {
  ensureFolderNames()
  const rows = getDb()
    .prepare("SELECT folder_name FROM projects WHERE folder_name <> '' AND archived = 0")
    .all() as Array<{ folder_name: string }>
  let made = 0
  for (const r of rows) {
    const p = join(workspaceRoot, r.folder_name)
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true })
      made += 1
    }
  }
  return made
}

/** 项目名校验：非空、不以 `_` / `.` 开头（否则文件夹会被扫描跳过，项目凭空消失） */
function checkProjectName(name: string): string | null {
  const n = (name ?? '').trim()
  if (!n) return COPY.projErr.nameEmpty
  if (/^[._]/.test(n)) return COPY.projErr.namePrefix
  return null
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

/**
 * 新建项目。
 *
 * 第 6 批：项目名 = 磁盘上的文件夹名（`folder_name`），所以
 * ① 名称必填、不重名、不能以 `_` / `.` 开头；
 * ② 传了 workspaceRoot 就**当场把文件夹建出来** ——
 *    "软件里建项目 → 工作区里出现同名文件夹"，这是三级结构的核心一致性。
 */
export function createProject(input: {
  name: string
  color?: string
  note?: string
  workspaceRoot?: string
}): { ok: boolean; project?: ProjectRow; error?: string } {
  const db = getDb()
  const nameErr = checkProjectName(input.name)
  if (nameErr) return { ok: false, error: nameErr }
  const name = input.name.trim()

  const dup = db.prepare('SELECT id FROM projects WHERE name = ?').get(name)
  if (dup) return { ok: false, error: fmt(COPY.projErr.dup, { name: name }) }

  const folderName = uniqueFolderName(name)

  // 先建文件夹：建不出来就别落记录，免得库里有项目、磁盘上却没地方放包
  if (input.workspaceRoot) {
    try {
      mkdirSync(join(input.workspaceRoot, folderName), { recursive: true })
    } catch (e) {
      return { ok: false, error: fmt(COPY.projErr.folderCreateFailed, { msg: (e as Error).message }) }
    }
  }

  const maxOrder = (
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects').get() as { m: number }
  ).m
  const color = (input.color ?? '').trim() || pickColor(maxOrder + 1)
  const ts = nowIso()

  const info = db
    .prepare(
      `INSERT INTO projects (name, color, note, sort_order, archived, folder_name, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
    .run(name, color, (input.note ?? '').trim(), maxOrder + 1, folderName, ts)

  return { ok: true, project: getProject(Number(info.lastInsertRowid)) }
}

/**
 * 把库里所有以 `oldAbs` 为根的路径改成 `newAbs`（项目改名 / 包搬移时用）。
 *
 * **按路径段对齐**替换前缀，不做字符串瞎替换 —— 否则 `D:\a` 会误伤 `D:\abc`。
 * `assets.abs_path` 上是 UNIQUE，所以先全部挪到临时值再写目标值，避免中途撞车。
 */
export function reprefixPaths(workspaceRoot: string, oldAbs: string, newAbs: string): number {
  const db = getDb()
  const oldRel = relative(workspaceRoot, oldAbs)
  const newRel = relative(workspaceRoot, newAbs)
  const hits = (p: string, base: string): boolean =>
    !!base &&
    (p.toLowerCase() === base.toLowerCase() || p.toLowerCase().startsWith((base + sep).toLowerCase()))

  const packs = db
    .prepare('SELECT id, folder_path FROM packs')
    .all() as Array<{ id: number; folder_path: string }>
  const assets = db
    .prepare('SELECT id, abs_path, rel_path FROM assets')
    .all() as Array<{ id: number; abs_path: string; rel_path: string }>

  const upPack = db.prepare('UPDATE packs SET folder_path = ? WHERE id = ?')
  const stageAbs = db.prepare('UPDATE assets SET abs_path = ? WHERE id = ?')
  const upAsset = db.prepare('UPDATE assets SET abs_path = ?, rel_path = ? WHERE id = ?')

  let n = 0
  db.transaction(() => {
    for (const p of packs) {
      if (!hits(p.folder_path, oldAbs)) continue
      upPack.run(newAbs + p.folder_path.slice(oldAbs.length), p.id)
      n += 1
    }
    const pending: Array<{ id: number; abs: string; rel: string }> = []
    for (const a of assets) {
      if (!hits(a.abs_path, oldAbs)) continue
      pending.push({
        id: a.id,
        abs: newAbs + a.abs_path.slice(oldAbs.length),
        rel: hits(a.rel_path, oldRel) ? newRel + a.rel_path.slice(oldRel.length) : a.rel_path
      })
    }
    for (const x of pending) stageAbs.run(`#migrating#${x.id}`, x.id)
    for (const x of pending) upAsset.run(x.abs, x.rel, x.id)
    n += pending.length
  })()
  return n
}

/**
 * 改项目名 / 颜色 / 备注。
 *
 * 第 6 批：名字改了，**磁盘上的项目文件夹跟着改**（否则软件与磁盘不一致，
 * 正好违背三级结构的初衷）。传了 workspaceRoot 才动磁盘。
 * 顺序：备份 → rename 文件夹 → 单事务改库；任何一步失败都把文件夹 rename 回来。
 */
export function updateProject(
  id: number,
  patch: { name?: string; color?: string; note?: string },
  workspaceRoot?: string
): {
  ok: boolean
  project?: ProjectRow
  error?: string
  renamed?: { from: string; to: string; paths: number }
} {
  const db = getDb()
  const cur = getProject(id)
  if (!cur) return { ok: false, error: COPY.projErr.notFound }

  const name = patch.name === undefined ? cur.name : patch.name.trim()
  const nameErr = checkProjectName(name)
  if (nameErr) return { ok: false, error: nameErr }

  if (name !== cur.name) {
    const dup = db.prepare('SELECT id FROM projects WHERE name = ? AND id <> ?').get(name, id)
    if (dup) return { ok: false, error: fmt(COPY.projErr.dup, { name: name }) }
  }

  const nameChanged = name !== cur.name
  const oldFolder = cur.folder_name
  const newFolder = nameChanged ? uniqueFolderName(name, id) : oldFolder
  const color = patch.color === undefined ? cur.color : patch.color.trim() || cur.color
  const note = patch.note === undefined ? cur.note : patch.note.trim()

  // 改了名 + 能落磁盘 + 文件夹确实要换 → 连带改文件夹名
  if (nameChanged && workspaceRoot && oldFolder && newFolder !== oldFolder) {
    const from = join(workspaceRoot, oldFolder)
    const to = join(workspaceRoot, newFolder)
    if (existsSync(to)) {
      return { ok: false, error: fmt(COPY.projErr.folderExists, { name: newFolder }) }
    }

    // 这一步动的是用户看得见的目录，先备份数据库
    backupDb(workspaceRoot)

    let moved = false
    if (existsSync(from)) {
      try {
        renameSync(from, to)
        moved = true
      } catch (e) {
        return { ok: false, error: fmt(COPY.projErr.renameFailed, { msg: (e as Error).message }) }
      }
    }

    try {
      let paths = 0
      db.transaction(() => {
        db.prepare(
          'UPDATE projects SET name = ?, folder_name = ?, color = ?, note = ? WHERE id = ?'
        ).run(name, newFolder, color, note, id)
        paths = reprefixPaths(workspaceRoot, from, to)
      })()
      return { ok: true, project: getProject(id), renamed: { from, to, paths } }
    } catch (e) {
      // 库没改成 → 文件夹也退回去，别留下"文件夹叫新名、库里还是旧名"的烂摊子
      if (moved) {
        try {
          renameSync(to, from)
        } catch {
          /* 退回失败只能如实报错，让用户看到 */
        }
      }
      return { ok: false, error: fmt(COPY.projErr.renameRollback, { msg: (e as Error).message }) }
    }
  }

  db.prepare('UPDATE projects SET name = ?, color = ?, note = ? WHERE id = ?').run(name, color, note, id)
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
  if (!cur) return { ok: false, moved: false, error: COPY.projErr.notFound }
  if (cur.archived) return { ok: false, moved: false, error: COPY.projErr.archivedNoSort }

  const list = listProjects(false)
  const idx = list.findIndex((p) => p.id === id)
  if (idx < 0) return { ok: false, moved: false, error: COPY.projErr.notFound }

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
 *
 * **不允许出现"包跟着项目一起消失"** —— 三个出口：
 *   - `moveTo: N`：把包转到另一个项目（磁盘上同时搬进那个项目的文件夹）
 *   - `moveTo: null`：这些包「变成未归属」→ 搬到**工作区根目录**，界面上就是「待归类」
 *   - `toTrash: true`（第 7 批新增）：**整个项目文件夹**搬进 `_回收站`，项目与包的记录删掉。
 *     文件一个不少，只是换了个地方躺；`_回收站` 下划线开头，扫描永远跳过。
 *
 * 传了 `workspaceRoot` 才动磁盘。同盘 `rename` 瞬间完成，**只挪不删**。
 * 搬移失败或改库失败都会把文件夹退回去，不留"库盘不一致"的烂摊子。
 */
export function removeProject(
  id: number,
  action: { moveTo: number | null; toTrash?: boolean },
  workspaceRoot?: string
): {
  ok: boolean
  moved: number
  error?: string
  movedToRoot?: boolean
  /** toTrash 分支：搬进回收站后的目录 */
  toTrashPath?: string
  /** toTrash 分支：删掉了几条包记录 */
  deletedPacks?: number
} {
  const db = getDb()
  const cur = getProject(id)
  if (!cur) return { ok: false, moved: 0, error: COPY.projErr.notFound }

  const packs = db
    .prepare('SELECT id, folder_path FROM packs WHERE project_id = ?')
    .all(id) as Array<{ id: number; folder_path: string }>
  const packCount = packs.length

  // 只剩一个项目时不允许删 —— 否则新建包没有默认归属可选
  const total = (db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c
  if (total <= 1) {
    return { ok: false, moved: 0, error: COPY.projErr.keepAtLeastOne }
  }

  // ---- 出口三：整个项目搬进 _回收站（第 7 批）----
  if (action.toTrash) {
    return removeProjectToTrash(cur, workspaceRoot)
  }

  let targetProject: ProjectRow | undefined
  if (packCount > 0 && action.moveTo !== null) {
    if (action.moveTo === id) return { ok: false, moved: 0, error: COPY.projErr.moveToSelf }
    targetProject = getProject(action.moveTo)
    if (!targetProject) return { ok: false, moved: 0, error: COPY.projErr.targetMissing }
  }

  // ---- 磁盘：把包文件夹搬走（同盘 rename）----
  const plan: Array<{ packId: number; from: string; to: string }> = []
  if (workspaceRoot && packCount > 0) {
    const parent = targetProject
      ? join(workspaceRoot, targetProject.folder_name)
      : workspaceRoot // moveTo = null → 搬到工作区根目录 = 待归类
    mkdirSync(parent, { recursive: true })
    for (const p of packs) {
      if (!existsSync(p.folder_path)) continue // 记录悬空，没东西可搬
      plan.push({ packId: p.id, from: p.folder_path, to: uniqueFolderPath(parent, basename(p.folder_path)) })
    }

    if (plan.length) {
      backupDb(workspaceRoot)
      const done: Array<{ from: string; to: string }> = []
      for (const step of plan) {
        try {
          renameSync(step.from, step.to)
          done.push({ from: step.from, to: step.to })
        } catch (e) {
          for (const d of done.reverse()) {
            try {
              renameSync(d.to, d.from)
            } catch {
              /* 尽力而为 */
            }
          }
          return { ok: false, moved: 0, error: fmt(COPY.projErr.movePackFailed, { msg: (e as Error).message }) }
        }
      }
    }
  }

  // ---- 数据库 ----
  try {
    db.transaction(() => {
      for (const step of plan) {
        db.prepare('UPDATE packs SET folder_path = ? WHERE id = ?').run(step.to, step.packId)
        reprefixPaths(workspaceRoot!, step.from, step.to)
      }
      if (packCount > 0) {
        if (action.moveTo !== null) {
          db.prepare('UPDATE packs SET project_id = ? WHERE project_id = ?').run(action.moveTo, id)
        } else {
          // 变成未归属：包还在、文件还在，只是不再挂任何项目
          db.prepare('UPDATE packs SET project_id = NULL WHERE project_id = ?').run(id)
        }
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    })()
  } catch (e) {
    for (const step of plan) {
      try {
        if (existsSync(step.to)) renameSync(step.to, step.from)
      } catch {
        /* 尽力而为 */
      }
    }
    return { ok: false, moved: 0, error: fmt(COPY.projErr.deleteRollback, { msg: (e as Error).message }) }
  }

  // 项目文件夹搬空了就收掉它 —— 只删空目录，绝不删文件
  if (workspaceRoot && cur.folder_name) {
    const dir = join(workspaceRoot, cur.folder_name)
    try {
      if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir)
    } catch {
      /* 删不掉不影响正确性 */
    }
  }

  return { ok: true, moved: packCount, movedToRoot: action.moveTo === null }
}

// ================================================================ 第 7 批 G-01：记录生命周期
// 对应方案：docs/09-记录生命周期方案.md

export interface PackBackupRecord {
  name: string
  category: string
  folderPath: string
  projectName: string | null
  createdAt: string
  fileCount: number
  /** 第 8 批：包内文件清单（工作区相对路径）。记录要连素材一起摘了，
   *  这份 JSON 是事后唯一能查"当时包里有什么"的东西 */
  files?: string[]
  /** 第 55 批：为什么被摘 —— `fs` = 文件夹在磁盘上没了；`nested` = 这条记录其实指向
   *  别的任务内部的层级文件夹（历史误认留下的幽灵记录） */
  reason?: 'fs' | 'nested'
}

/**
 * 把即将被摘掉的包记录写进 `_system/backup/packs-<时间戳>.json`。
 *
 * 只是**留痕**（出事了能查"当时有什么"），永不自动删除。
 * `_system` 下划线开头，扫描自动跳过，不会跑到用户眼皮底下。
 */
export function backupPackRecords(
  workspaceRoot: string,
  reason: string,
  records: PackBackupRecord[]
): string | null {
  if (!records.length) return null
  try {
    const dir = join(workspaceRoot, '_system', 'backup')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(dir, `packs-${stamp}.json`)
    writeFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), reason, records }, null, 2),
      'utf-8'
    )
    return file
  } catch {
    return null // 留痕失败不拦住清理本身（记录本来就该走）
  }
}

/**
 * 第 7 批 ①：把"文件夹已不在磁盘上"的包记录摘掉（**只摘记录，绝不动磁盘**）。
 *
 * 三道门，缺一不可：
 *   ① `rootReadable` —— 根目录这次读成功了吗（读不到 ≠ 里面没有）
 *   ② `!existsSync(folder_path)` —— 磁盘上确实没有这个文件夹
 *   ③ 所属项目没被解绑（`archived = 0`）—— 解绑只是留底，包挪进 `_已解绑的项目` 后不能清记录
 *
 * 门二刻意用 `existsSync` 而不是"不在本次扫描结果里"：包被手动挪到不合法位置时，
 * 记录留着让用户还能看见它，比默默摘掉更符合「软件永远不悄悄扔掉用户放的东西」。
 *
 * **第 55 批（docs/41）补第四类"失效"**：`folder_path` 虽然存在，但它**嵌在另一个包里面**。
 * 三级结构里包只可能是「项目\任务」或「根\任务」，绝不可能是「任务\子目录」——
 * 出现这种嵌套只有一种来历：历史误认。最典型的是根目录下的「待归类任务」，
 * 它的 `V1` 层曾被当成一个独立任务登记（见 `hasVersionLayer` 的注释），
 * 于是 `待归类任务\V1` 成了一条真包记录，最长前缀匹配一直把文件判给它，
 * 原任务永远是"0 个文件"。这一条是**回收历史误认**，不是新玩法。
 *
 * 摘之前先留痕。**第 8 批补**：摘记录时把包内素材记录一并摘掉 ——
 * 光删包记录的话，外键会把包内素材的 `pack_id` 置空，变成一堆悬空的"孤儿素材"，
 * 下一轮扫描它们又会被判成「文件已丢失」（文件确实没了），跟用户"我把整包删了"的本意对不上。
 *
 * 所以留痕 JSON 里必须带上每个包的文件清单（磁盘文件本来就没了，这是唯一线索）。
 */
export function cleanupMissingPacks(workspaceRoot: string, rootReadable: boolean): number {
  if (!rootReadable) return 0
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT k.id, k.name, k.category, k.folder_path, k.created_at,
              p.name AS projectName, p.archived AS projectArchived
         FROM packs k
         LEFT JOIN projects p ON p.id = k.project_id`
    )
    .all() as Array<{
    id: number
    name: string
    category: string
    folder_path: string
    created_at: string
    projectName: string | null
    projectArchived: number | null
  }>

  // 两类失效，分开记原因（第 55 批补第二类，见函数头注释）
  const dirs = rows.map((r) => r.folder_path)
  const whyOf = new Map<number, 'fs' | 'nested'>()
  for (const r of rows) {
    if (r.projectArchived) continue
    if (!existsSync(r.folder_path)) whyOf.set(r.id, 'fs')
    else if (dirs.some((d) => d !== r.folder_path && isInside(r.folder_path, d)))
      whyOf.set(r.id, 'nested')
  }
  const gone = rows.filter((r) => whyOf.has(r.id))
  if (!gone.length) return 0

  const filesOf = db.prepare(
    'SELECT rel_path, file_name FROM assets WHERE pack_id = ? ORDER BY rel_path'
  )
  const delAssets = db.prepare('DELETE FROM assets WHERE pack_id = ?')
  const delPack = db.prepare('DELETE FROM packs WHERE id = ?')

  const records = gone.map((g) => {
    const fs = filesOf.all(g.id) as Array<{ rel_path: string; file_name: string }>
    return {
      name: g.name,
      category: g.category,
      folderPath: g.folder_path,
      projectName: g.projectName,
      createdAt: g.created_at,
      fileCount: fs.length,
      files: fs.map((f) => f.rel_path || f.file_name),
      reason: whyOf.get(g.id)
    }
  })

  // 整批都是"幽灵记录"时换一句准确的原因；混着来时用原来那句（文件没了更常见）
  const allNested = gone.every((r) => whyOf.get(r.id) === 'nested')
  backupPackRecords(
    workspaceRoot,
    allNested ? COPY.wsErr.scanPackNestedNote : COPY.wsErr.scanPackGoneNote,
    records
  )

  // ⚠️ 顺序要紧：先删素材、再删包，且同一事务里做完。
  // 反过来（只删包）会靠外键把 pack_id 置空，留下一批孤儿素材记录。
  // 删 assets 时 asset_tags 由 ON DELETE CASCADE 自动清关联（第 7 批加的外键）。
  db.transaction(() => {
    for (const g of gone) {
      delAssets.run(g.id)
      delPack.run(g.id)
    }
  })()
  return gone.length
}

/** ⑤ 删除项目的出口三：整个项目文件夹搬进 `_回收站`，记录删掉 */
function removeProjectToTrash(
  cur: ProjectRow,
  workspaceRoot?: string
): { ok: boolean; moved: number; error?: string; toTrashPath?: string; deletedPacks?: number } {
  const db = getDb()
  const packRows = db
    .prepare('SELECT id, name, category, folder_path, created_at FROM packs WHERE project_id = ?')
    .all(cur.id) as Array<{
    id: number
    name: string
    category: string
    folder_path: string
    created_at: string
  }>

  const from = workspaceRoot && cur.folder_name ? join(workspaceRoot, cur.folder_name) : ''
  let to = ''

  if (workspaceRoot && from) {
    // 删前留痕（项目与包的记录都要删了，留一份能查的清单）
    const fileCount = db.prepare('SELECT COUNT(*) AS c FROM assets WHERE pack_id = ?')
    backupPackRecords(
      workspaceRoot,
      fmt(COPY.projErr.deletedToTrash, { name: cur.name, dir: TRASH_DIR }),
      packRows.map((p) => ({
        name: p.name,
        category: p.category,
        folderPath: p.folder_path,
        projectName: cur.name,
        createdAt: p.created_at,
        fileCount: (fileCount.get(p.id) as { c: number }).c
      }))
    )

    const trashDir = join(workspaceRoot, TRASH_DIR)
    mkdirSync(trashDir, { recursive: true })
    to = join(trashDir, cur.folder_name)
    let i = 2
    while (existsSync(to) && i < 999) {
      to = join(trashDir, `${cur.folder_name}-${i}`)
      i += 1
    }

    backupDb(workspaceRoot)

    if (existsSync(from)) {
      try {
        // 整个项目文件夹一起搬 —— 里面没进过扫描的手工文件夹也跟着走，绝不漏
        renameSync(from, to)
      } catch (e) {
        return { ok: false, moved: 0, error: fmt(COPY.projErr.trashFailed, { msg: (e as Error).message }) }
      }
    }
  }

  try {
    db.transaction(() => {
      // 先删素材记录（连带 asset_tags 级联），再删包，最后删项目
      db.prepare(
        'DELETE FROM assets WHERE pack_id IN (SELECT id FROM packs WHERE project_id = ?)'
      ).run(cur.id)
      db.prepare('DELETE FROM packs WHERE project_id = ?').run(cur.id)
      db.prepare('DELETE FROM projects WHERE id = ?').run(cur.id)
    })()
  } catch (e) {
    // 库没删干净 → 文件夹搬回来，别留下"文件进了回收站、界面上项目还在"的错位
    if (from && to && existsSync(to)) {
      try {
        renameSync(to, from)
      } catch {
        /* 尽力而为 */
      }
    }
    return { ok: false, moved: 0, error: fmt(COPY.projErr.deleteRollback, { msg: (e as Error).message }) }
  }

  return { ok: true, moved: 0, deletedPacks: packRows.length, toTrashPath: to || undefined }
}

/**
 * 第 7 批 ②③ 的共用核心：把包搬到另一个父目录（改项目 / 待归类归位 / 改名）。
 *
 * 统一走 `rename` + 路径重写，**不重新扫描** ——
 * `abs_path` 是 UNIQUE 键，重扫会把新路径当新文件 INSERT，`asset.id` 一变，
 * `asset_tags` 里的标签关联就全断了（第 5 批踩过的坑，见 DECISIONS 2026-09-25）。
 *
 * `targetProjectId === null` → 搬到工作区根目录，界面上就是「待归类」。
 */
export function movePackTo(
  workspaceRoot: string,
  packId: number,
  target: {
    projectId: number | null
    name: string
    category: string
    channel: string
    /** 第 49 批（docs/34）：物料分级。不传 = 保持原值 */
    grade?: string
    /** 第 47 批（docs/33 §5.1）：扫描临时文件开关。不传 = 保持原值（纯数据，不碰磁盘） */
    scanTemp?: boolean
  }
): UpdatePackResult {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM packs WHERE id = ?').get(packId) as PackRow | undefined
  if (!cur) return { ok: false, error: COPY.packErr.notFound }

  // ---- 目标父目录 ----
  let parentDir = workspaceRoot
  if (target.projectId !== null) {
    const proj = getProject(target.projectId)
    if (!proj) return { ok: false, error: COPY.projErr.targetMissing }
    if (proj.archived) return { ok: false, error: COPY.projErr.archivedNoPack }
    parentDir = join(workspaceRoot, proj.folder_name)
  }

  const name = target.name.trim()
  if (!name) return { ok: false, error: COPY.packErr.nameEmpty }
  const category = target.category.trim() || UNCATEGORIZED
  const channel = target.channel.trim() || UNCATEGORIZED
  // 第 49 批（docs/34）：分级用 UNGRADED 兜底；不传 = 保持原值（与另两个维度的取法一致）
  const grade =
    target.grade === undefined ? cur.grade : target.grade.trim() || UNGRADED
  // 第 47 批（docs/33 §5.1）：临时文件开关 —— 不传就保持原值
  const scanTemp = target.scanTemp === undefined ? cur.scan_temp : target.scanTemp ? 1 : 0

  // ---- 目标文件夹 ----  // 名字与父目录都没变就别加 -2 后缀（uniqueFolderPath 只认 existsSync，会误判自己）
  const want = join(parentDir, sanitizeFolderName(name))
  const to =
    want.toLowerCase() === cur.folder_path.toLowerCase()
      ? cur.folder_path
      : uniqueFolderPath(parentDir, sanitizeFolderName(name))
  const needMove = to.toLowerCase() !== cur.folder_path.toLowerCase()

  // 只改类别 / 场景 / 分级 / 临时文件开关 → 纯数据，不碰磁盘
  if (!needMove) {
    db.prepare(
      'UPDATE packs SET name = ?, category = ?, channel = ?, grade = ?, scan_temp = ?, project_id = ?, updated_at = ? WHERE id = ?'
    ).run(name, category, channel, grade, scanTemp, target.projectId, nowIso(), packId)
    return { ok: true, pack: getPackRow(packId) }
  }

  mkdirSync(parentDir, { recursive: true })
  backupDb(workspaceRoot)

  let renamed = false
  if (existsSync(cur.folder_path)) {
    try {
      renameSync(cur.folder_path, to)
      renamed = true
    } catch (e) {
      return { ok: false, error: fmt(COPY.packErr.moveFailed, { msg: (e as Error).message }) }
    }
  }

  try {
    let paths = 0
    db.transaction(() => {
      db.prepare(
        'UPDATE packs SET name = ?, category = ?, channel = ?, grade = ?, scan_temp = ?, folder_path = ?, project_id = ?, updated_at = ? WHERE id = ?'
      ).run(name, category, channel, grade, scanTemp, to, target.projectId, nowIso(), packId)
      paths = reprefixPaths(workspaceRoot, cur.folder_path, to)
    })()
    return { ok: true, pack: getPackRow(packId), moved: { from: cur.folder_path, to, paths } }
  } catch (e) {
    if (renamed) {
      try {
        renameSync(to, cur.folder_path)
      } catch {
        /* 尽力而为 */
      }
    }
    return { ok: false, error: fmt(COPY.packErr.editRollback, { msg: (e as Error).message }) }
  }
}

function getPackRow(id: number): PackRow | undefined {
  return getDb().prepare('SELECT * FROM packs WHERE id = ?').get(id) as PackRow | undefined
}

export interface UpdatePackPatch {
  name?: string
  category?: string
  /** 第 23 批（docs/29）：任务的「使用场景」（标签名字） */
  channel?: string
  /** 第 49 批（docs/34）：任务的「物料分级」（标签名字）；传空串 = 归「未分级」 */
  grade?: string
  /** 传 null = 变成「待归类」（搬回工作区根目录） */
  projectId?: number | null
  /** 第 47 批（docs/33 §5.3）：扫描时是否收临时文件（纯数据，不碰磁盘） */
  scanTemp?: boolean
}

export interface UpdatePackResult {
  ok: boolean
  pack?: PackRow
  error?: string
  moved?: { from: string; to: string; paths: number }
}

/**
 * 第 7 批 ②：改包信息（名称 / 类别 / 所属项目）。
 *
 * - 只改类别 → 不碰磁盘
 * - 只改临时文件开关（第 47 批 docs/33）→ 同上，纯数据
 * - 改名称 → **连带改文件夹名**（与项目改名一个规矩："软件里看到什么，硬盘上就是什么"）
 * - 改项目 → 搬文件夹（③ 待归类归位就是 `projectId: null → N`）
 */
export function updatePack(
  packId: number,
  patch: UpdatePackPatch,
  workspaceRoot: string
): UpdatePackResult {
  const cur = getPackRow(packId)
  if (!cur) return { ok: false, error: COPY.packErr.notFound }

  const name = patch.name === undefined ? cur.name : patch.name.trim()
  if (!name) return { ok: false, error: COPY.packErr.nameEmpty }
  const category =
    patch.category === undefined ? cur.category : patch.category.trim() || UNCATEGORIZED
  const channel = patch.channel === undefined ? cur.channel : patch.channel.trim() || UNCATEGORIZED
  // 第 49 批（docs/34）：分级传空串 → 归「未分级」（不是「未分类」）；不传 = 保持原值
  const grade = patch.grade === undefined ? cur.grade : patch.grade.trim() || UNGRADED
  const projectId = patch.projectId === undefined ? cur.project_id : patch.projectId

  return movePackTo(workspaceRoot, packId, {
    projectId,
    name,
    category,
    channel,
    grade,
    // 第 47 批（docs/33 §5.1）：临时文件开关；patch 没带就保持原值
    scanTemp: patch.scanTemp
  })
}

// ---------------------------------------------------------------- 项目解绑 / 还原

export interface UnboundProject extends ProjectRow {
  packCount: number
  fileCount: number
  /** 取自库里的文件大小合计（不去扫盘，够用） */
  totalSize: number
}

/** 已解绑的项目清单（左栏入口用）：含包数、文件数、占用 */
export function listUnboundProjects(): UnboundProject[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM projects WHERE archived = 1 ORDER BY sort_order, id')
    .all() as ProjectRow[]
  const stat = db.prepare(
    `SELECT COUNT(DISTINCT k.id) AS packs, COUNT(a.id) AS files, COALESCE(SUM(a.size), 0) AS size
       FROM packs k
       LEFT JOIN assets a ON a.pack_id = k.id
      WHERE k.project_id = ?`
  )
  return rows.map((p) => {
    const s = stat.get(p.id) as { packs: number; files: number; size: number }
    return { ...p, packCount: s.packs, fileCount: s.files, totalSize: s.size }
  })
}

/**
 * 第 7 批 ④：解绑项目 —— 项目文件夹搬进 `_已解绑的项目`，`archived = 1`。
 *
 * 语义是"结项留底"：软件里看不见（包、素材、统计全隐身），本地文件一个不少，随时能还原。
 * `_已解绑的项目` 下划线开头 → 扫描永远跳过，所以"隐形"是零代码实现的。
 */
export function unbindProject(
  id: number,
  workspaceRoot: string
): { ok: boolean; packs: number; error?: string; movedTo?: string } {
  const db = getDb()
  const cur = getProject(id)
  if (!cur) return { ok: false, packs: 0, error: COPY.projErr.notFound }
  if (cur.archived) return { ok: false, packs: 0, error: COPY.projErr.alreadyUnbound }

  const active = (
    db.prepare('SELECT COUNT(*) AS c FROM projects WHERE archived = 0').get() as { c: number }
  ).c
  if (active <= 1) {
    return { ok: false, packs: 0, error: COPY.projErr.keepAtLeastOneUnbind }
  }

  const packCount = (
    db.prepare('SELECT COUNT(*) AS c FROM packs WHERE project_id = ?').get(id) as { c: number }
  ).c

  const from = join(workspaceRoot, cur.folder_name)
  const unboundDir = join(workspaceRoot, UNBOUND_DIR)
  mkdirSync(unboundDir, { recursive: true })

  let to = join(unboundDir, cur.folder_name)
  let i = 2
  while (existsSync(to) && i < 999) {
    to = join(unboundDir, `${cur.folder_name}-${i}`)
    i += 1
  }
  const newFolderName = basename(to)

  backupDb(workspaceRoot)

  let moved = false
  if (existsSync(from)) {
    try {
      renameSync(from, to)
      moved = true
    } catch (e) {
      return { ok: false, packs: 0, error: fmt(COPY.projErr.moveFailed, { msg: (e as Error).message }) }
    }
  }

  try {
    db.transaction(() => {
      db.prepare('UPDATE projects SET archived = 1, folder_name = ? WHERE id = ?').run(
        newFolderName,
        id
      )
      if (moved) reprefixPaths(workspaceRoot, from, to)
    })()
  } catch (e) {
    if (moved) {
      try {
        renameSync(to, from)
      } catch {
        /* 尽力而为 */
      }
    }
    return { ok: false, packs: 0, error: fmt(COPY.projErr.unbindRollback, { msg: (e as Error).message }) }
  }

  return { ok: true, packs: packCount, movedTo: moved ? to : undefined }
}

/**
 * 第 7 批 ④：还原已解绑的项目 —— 文件夹搬回工作区根目录，`archived = 0`。
 *
 * 根目录已有同名文件夹时**报错让用户先处理，不自动加后缀**：
 * 那是用户自己放的东西，悄悄改名会让他找不到。
 */
export function restoreProject(id: number, workspaceRoot: string): { ok: boolean; error?: string } {
  const db = getDb()
  const cur = getProject(id)
  if (!cur) return { ok: false, error: COPY.projErr.notFound }
  if (!cur.archived) return { ok: true }

  const from = join(workspaceRoot, UNBOUND_DIR, cur.folder_name)
  const to = join(workspaceRoot, cur.folder_name)
  if (existsSync(to)) {
    return {
      ok: false,
      error: fmt(COPY.projErr.restoreFolderExists, { name: cur.folder_name })
    }
  }

  backupDb(workspaceRoot)

  let moved = false
  if (existsSync(from)) {
    try {
      renameSync(from, to)
      moved = true
    } catch (e) {
      return { ok: false, error: fmt(COPY.projErr.restoreMoveFailed, { msg: (e as Error).message }) }
    }
  }

  try {
    db.transaction(() => {
      db.prepare('UPDATE projects SET archived = 0 WHERE id = ?').run(id)
      if (moved) reprefixPaths(workspaceRoot, from, to)
    })()
  } catch (e) {
    if (moved) {
      try {
        renameSync(to, from)
      } catch {
        /* 尽力而为 */
      }
    }
    return { ok: false, error: fmt(COPY.projErr.restoreRollback, { msg: (e as Error).message }) }
  }

  return { ok: true }
}

// ---------------------------------------------------------------- 版本管理（第 9 批 M6，见 docs/11）

/**
 * 一稿 = 包文件夹下的一个文件夹。软件建的是 `V1/V2/V3`；用户自己在资源管理器里建好、
 * 名字不规范的，在界面里「绑定文件夹」纳入管理（库里记真实 folder_name）。
 */
export interface PackVersion extends PackVersionRow {
  /** 这一稿的绝对路径（= 包文件夹 + folder_name） */
  folder_path: string
  /** 这一稿里有几个文件（含已丢失的） */
  fileCount: number
  /** 这一稿占用（不含已丢失的，口径与第 8 批一致） */
  totalSize: number
  missingCount: number
  /** 文件夹是否还在磁盘上（用户可能把它改名或删了） */
  folderExists: boolean
}

export interface CreateVersionInput {
  packId: number
  note?: string
  takeExisting?: boolean
  copyFromVersionId?: number
}

export interface BindableFolder {
  folderName: string
  suggestedSeq: number
  fileCount: number
}

export interface BindVersionInput {
  packId: number
  folderName: string
  seq: number
  note?: string
}

/** role → 三组文件夹名（收编文件时按角色放回对应的组） */
const ROLE_TO_FOLDER: Record<string, string> = {
  成品: '01-成品',
  素材: '02-素材',
  工程: '03-工程'
}

/** 递归复制目录（复制上一稿用）。跳过 `.` 开头的临时文件，其余原样搬 */
function copyDirRecursive(from: string, to: string): number {
  let n = 0
  let names: string[]
  try {
    names = readdirSync(from)
  } catch {
    return 0
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    const src = join(from, name)
    const dst = join(to, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(src)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      mkdirSync(dst, { recursive: true })
      n += copyDirRecursive(src, dst)
    } else if (st.isFile()) {
      try {
        copyFileSync(src, dst)
        n += 1
      } catch {
        /* 单个文件失败不阻断整体 */
      }
    }
  }
  return n
}

/**
 * 某包的全部稿（seq 倒序）。派生统计跟第 8 批口径一致：**条数含丢失、容量不含**。
 */
export function listVersions(packId: number): PackVersion[] {
  const db = getDb()
  const pack = getPackRow(packId)
  if (!pack) return []
  const rows = db
    .prepare('SELECT * FROM pack_versions WHERE pack_id = ? ORDER BY seq DESC')
    .all(packId) as PackVersionRow[]

  const stat = db.prepare(
    `SELECT COUNT(*) AS c,
            COALESCE(SUM(CASE WHEN missing_at IS NULL THEN size ELSE 0 END), 0) AS s,
            COALESCE(SUM(CASE WHEN missing_at IS NOT NULL AND missing_ignored_at IS NULL THEN 1 ELSE 0 END), 0) AS m
       FROM assets WHERE version_id = ?`
  )

  return rows.map((r) => {
    const st = stat.get(r.id) as { c: number; s: number; m: number }
    const folderPath = join(pack.folder_path, r.folder_name)
    return {
      ...r,
      folder_path: folderPath,
      fileCount: st.c,
      totalSize: st.s,
      missingCount: st.m,
      folderExists: existsSync(folderPath)
    }
  })
}

/**
 * 全库版本映射（只读派生）：界面要给**文件视图**的每一行打 `V2` 徽标，
 * 那里没有"当前包"的上下文，所以由 IPC 层一次性带出 id → {seq, is_current}。
 */
export function listVersionMap(): Array<{
  id: number
  pack_id: number
  seq: number
  is_current: number
}> {
  const db = getDb()
  return db.prepare('SELECT id, pack_id, seq, is_current FROM pack_versions').all() as Array<{
    id: number
    pack_id: number
    seq: number
    is_current: number
  }>
}

/**
 * 兜底：一个包有稿、却没有任何一稿标着"当前"（比如当前那稿刚被解绑）→
 * 把 seq 最大的那稿设为当前。纯库操作，不动磁盘。
 */
export function ensureCurrentVersion(packId: number): void {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, is_current FROM pack_versions WHERE pack_id = ?')
    .all(packId) as Array<{ id: number; is_current: number }>
  if (!rows.length) return
  if (rows.some((r) => r.is_current === 1)) return
  const top = db
    .prepare('SELECT id FROM pack_versions WHERE pack_id = ? ORDER BY seq DESC LIMIT 1')
    .get(packId) as { id: number } | undefined
  if (top) db.prepare('UPDATE pack_versions SET is_current = 1 WHERE id = ?').run(top.id)
}

/**
 * 新建一稿（docs/11 §6.1）：
 *   ① 建 `V<n>/` + 三组空文件夹（**磁盘上立刻可见**）
 *   ② 可选：把上一稿的文件复制一份进来（默认不复制）
 *   ③ 可选：把包里"未分版本"的文件收进这一稿 —— **只收已经在三组里的**，
 *      包根下的散文件不动（它们本来就没归类，悄悄挪等于替用户做主）
 *   ④ 新稿自动成为当前版本
 *
 * 搬文件是 `rename` + **在原记录上 UPDATE 路径**（绝不"删旧建新"：
 * `assets.abs_path` 是 UNIQUE 键，重建记录会让 asset.id 变化 → `asset_tags`
 * 的 ON DELETE CASCADE 把标签一起蒸发。第 1 批的老 bug、第 7/8 批的教训）。
 */
export function createVersion(
  workspaceRoot: string,
  input: CreateVersionInput
): { ok: boolean; version?: PackVersion; error?: string; moved?: number } {
  const db = getDb()
  const pack = getPackRow(input.packId)
  if (!pack) return { ok: false, error: COPY.packErr.notFound }
  if (!existsSync(pack.folder_path)) {
    return { ok: false, error: COPY.packErr.folderGone }
  }

  const maxSeq = (
    db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM pack_versions WHERE pack_id = ?')
      .get(pack.id) as { m: number }
  ).m
  const seq = maxSeq + 1
  const folderName = `V${seq}`
  const folderPath = join(pack.folder_path, folderName)
  if (existsSync(folderPath)) {
    return { ok: false, error: fmt(COPY.packErr.folderExists, { name: folderName }) }
  }

  // ① 建文件夹
  try {
    mkdirSync(folderPath, { recursive: true })
    for (const sub of SUB_FOLDERS) mkdirSync(join(folderPath, sub), { recursive: true })
  } catch (e) {
    return { ok: false, error: fmt(COPY.packErr.createVerFolderFailed, { msg: (e as Error).message }) }
  }

  // ② 可选：复制上一稿
  if (input.copyFromVersionId) {
    const src = db
      .prepare('SELECT folder_name FROM pack_versions WHERE id = ? AND pack_id = ?')
      .get(input.copyFromVersionId, pack.id) as { folder_name: string } | undefined
    if (src) {
      const from = join(pack.folder_path, src.folder_name)
      if (existsSync(from)) copyDirRecursive(from, folderPath)
    }
  }

  // ③ 可选：收编未分版本的文件（只收已经在三组里的）
  const moves: Array<{ id: number; from: string; to: string }> = []
  if (input.takeExisting) {
    const rows = db
      .prepare(
        `SELECT id, abs_path, role, file_name FROM assets
          WHERE pack_id = ? AND version_id IS NULL AND missing_at IS NULL
            AND role IN ('成品', '素材', '工程')`
      )
      .all(pack.id) as Array<{ id: number; abs_path: string; role: string; file_name: string }>
    for (const r of rows) {
      const sub = ROLE_TO_FOLDER[r.role]
      if (!sub) continue
      const to = join(folderPath, sub, r.file_name)
      if (existsSync(to)) continue
      moves.push({ id: r.id, from: r.abs_path, to })
    }
  }

  // 先搬磁盘，任何一步失败就把已搬的搬回去
  const done: Array<{ from: string; to: string }> = []
  for (const m of moves) {
    try {
      mkdirSync(dirname(m.to), { recursive: true })
      renameSync(m.from, m.to)
      done.push({ from: m.from, to: m.to })
    } catch (e) {
      for (const d of done) {
        try {
          renameSync(d.to, d.from)
        } catch {
          /* 尽力而为 */
        }
      }
      return { ok: false, error: fmt(COPY.packErr.moveFileRollback, { msg: (e as Error).message }) }
    }
  }

  // 再写库（单事务：建稿 + 改当前 + 重写路径）
  try {
    db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO pack_versions (pack_id, seq, folder_name, note, is_current, created_at)
           VALUES (?, ?, ?, ?, 1, ?)`
        )
        .run(pack.id, seq, folderName, input.note ?? '', nowIso())
      const vid = Number(info.lastInsertRowid)
      db.prepare('UPDATE pack_versions SET is_current = 0 WHERE pack_id = ? AND id <> ?').run(
        pack.id,
        vid
      )
      // 软件自己建的这个名字（例如用户解绑过 V5、又把 V5 文件夹删了，这里重建 V5）——
      // 忽略记录随之作废，否则下次扫描认不出它。
      db.prepare('DELETE FROM pack_version_ignores WHERE pack_id = ? AND folder_name = ?').run(
        pack.id,
        folderName
      )
      const upd = db.prepare(
        'UPDATE assets SET abs_path = ?, rel_path = ?, version_id = ? WHERE id = ?'
      )
      for (const m of moves) {
        const target = done.find((d) => d.from === m.from)
        if (!target) continue
        upd.run(target.to, relative(workspaceRoot, target.to), vid, m.id)
      }
    })()
  } catch (e) {
    for (const d of done) {
      try {
        renameSync(d.to, d.from)
      } catch {
        /* 尽力而为 */
      }
    }
    return { ok: false, error: fmt(COPY.packErr.writeDbRollback, { msg: (e as Error).message }) }
  }

  // ④ 扫一遍：把复制进来的新文件登记好、版本归属算准
  scanAll(workspaceRoot)

  return { ok: true, version: listVersions(pack.id).find((v) => v.seq === seq), moved: moves.length }
}

/**
 * 绑定候选：包文件夹下**还没被认领的直接子文件夹**。
 * 建议编号：文件夹名是 `V3` 就用 3（没被占的话），否则给"下一个可用编号"。
 */
export function listBindableFolders(packId: number): BindableFolder[] {
  const db = getDb()
  const pack = getPackRow(packId)
  if (!pack || !existsSync(pack.folder_path)) return []

  const taken = new Set(
    (
      db.prepare('SELECT folder_name FROM pack_versions WHERE pack_id = ?').all(packId) as Array<{
        folder_name: string
      }>
    ).map((r) => r.folder_name.toLowerCase())
  )
  const usedSeq = new Set(
    (db.prepare('SELECT seq FROM pack_versions WHERE pack_id = ?').all(packId) as Array<{
      seq: number
    }>).map((r) => r.seq)
  )
  const maxSeq = usedSeq.size ? Math.max(...usedSeq) : 0

  const out: BindableFolder[] = []
  for (const sub of listSubDirs(pack.folder_path)) {
    const name = basename(sub)
    if (taken.has(name.toLowerCase())) continue
    const m = VERSION_FOLDER_RE.exec(name)
    let suggestedSeq = maxSeq + 1
    if (m) {
      const n = Number(m[1])
      suggestedSeq = usedSeq.has(n) ? maxSeq + 1 : n
    }
    out.push({ folderName: name, suggestedSeq, fileCount: collectFiles(sub).length })
  }
  return out.sort((a, b) => a.folderName.localeCompare(b.folderName))
}

/**
 * 把用户自己建好的文件夹绑定成某一稿（docs/11 §6.3）。
 *
 * 规矩：
 *   · 只能绑**包文件夹的直接子级**（工作区外的东西软件管不着）
 *   · 编号由用户确认，撞上已占用的编号会被拒绝
 *   · **不自动改"当前版本"**（补绑历史稿是常见场景，不该悄悄把指针挪走）
 */
export function bindVersion(
  workspaceRoot: string,
  input: BindVersionInput
): { ok: boolean; version?: PackVersion; error?: string } {
  const db = getDb()
  const pack = getPackRow(input.packId)
  if (!pack) return { ok: false, error: COPY.packErr.notFound }

  const name = input.folderName.trim()
  if (!name) return { ok: false, error: COPY.verErr.folderNameEmpty }
  const folderPath = join(pack.folder_path, name)
  if (dirname(folderPath) !== pack.folder_path) {
    return { ok: false, error: COPY.verErr.onlyInPack }
  }
  let isDir = false
  try {
    isDir = statSync(folderPath).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) return { ok: false, error: fmt(COPY.verErr.folderNotInPack, { name: name }) }
  if (!Number.isInteger(input.seq) || input.seq < 1) {
    return { ok: false, error: COPY.verErr.seqInvalid }
  }

  const dupName = db
    .prepare('SELECT id FROM pack_versions WHERE pack_id = ? AND folder_name = ? COLLATE NOCASE')
    .get(pack.id, name)
  if (dupName) return { ok: false, error: fmt(COPY.verErr.alreadyBound, { name: name }) }

  const dupSeq = db
    .prepare('SELECT folder_name FROM pack_versions WHERE pack_id = ? AND seq = ?')
    .get(pack.id, input.seq) as { folder_name: string } | undefined
  if (dupSeq) return { ok: false, error: fmt(COPY.verErr.seqTaken, { seq: input.seq, taken: dupSeq.folder_name }) }

  try {
    db.prepare(
      `INSERT INTO pack_versions (pack_id, seq, folder_name, note, is_current, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).run(pack.id, input.seq, name, input.note ?? '', nowIso())
    // 用户主动把它收回管理 → 之前「解绑不再自动认」的忽略记录作废（文件夹名带 COLLATE NOCASE）
    db.prepare('DELETE FROM pack_version_ignores WHERE pack_id = ? AND folder_name = ?').run(
      pack.id,
      name
    )
  } catch (e) {
    return { ok: false, error: fmt(COPY.verErr.bindFailed, { msg: (e as Error).message }) }
  }

  // 顺手扫一遍，让这个文件夹里的文件立刻挂上这一稿
  scanAll(workspaceRoot)
  return { ok: true, version: listVersions(pack.id).find((v) => v.folder_name === name) }
}

/**
 * 解绑：**只解除管理关系，文件夹和文件一个都不动**（铁则：软件永远不悄悄扔掉用户放的东西）。
 * 那一稿下的文件回到「未分版本」；解绑的若是当前版本，当前顺延给剩下编号最大的那一稿。
 *
 * ⚠️ 顺手把「包 + 文件夹名」记进 `pack_version_ignores`：解绑后文件夹还在、名字还叫 `V1`，
 * 下轮扫描按自动认领规则又会把它认回来 —— 那解绑就等于没点。名字不规范（「最终版-客户确认」）
 * 本来就不会被自动认，不必记。
 */
export function unbindVersion(versionId: number): { ok: boolean; error?: string } {
  const db = getDb()
  const v = db.prepare('SELECT * FROM pack_versions WHERE id = ?').get(versionId) as
    | PackVersionRow
    | undefined
  if (!v) return { ok: false, error: COPY.verErr.notFound }
  db.transaction(() => {
    db.prepare('UPDATE assets SET version_id = NULL WHERE version_id = ?').run(versionId)
    db.prepare('DELETE FROM pack_versions WHERE id = ?').run(versionId)
    if (VERSION_FOLDER_RE.test(v.folder_name)) {
      db.prepare(
        'INSERT OR IGNORE INTO pack_version_ignores (pack_id, folder_name, created_at) VALUES (?, ?, ?)'
      ).run(v.pack_id, v.folder_name, nowIso())
    }
  })()
  ensureCurrentVersion(v.pack_id)
  return { ok: true }
}

/** 设为当前版本（= M6-05 回滚）。纯库操作，磁盘零改动 */
export function setCurrentVersion(versionId: number): { ok: boolean; error?: string } {
  const db = getDb()
  const v = db.prepare('SELECT * FROM pack_versions WHERE id = ?').get(versionId) as
    | PackVersionRow
    | undefined
  if (!v) return { ok: false, error: COPY.verErr.notFound }
  db.transaction(() => {
    db.prepare('UPDATE pack_versions SET is_current = 0 WHERE pack_id = ?').run(v.pack_id)
    db.prepare('UPDATE pack_versions SET is_current = 1 WHERE id = ?').run(versionId)
  })()
  return { ok: true }
}

// ---------------------------------------------------------------- 查询

/**
 * 第 7 批：「这条素材所属的包是不是可见的」。
 *
 * 解绑的项目（`projects.archived = 1`）名下的包与素材在软件里**完全隐身** ——
 * 用户拍板"项目解绑后软件里不显示"，包括包视图、文件视图、未归属计数、总条数与总容量。
 *
 * 为什么不给包加 `hidden` 字段：要改的查询点一样多，但新加一处查询就会漏一次；
 * 集中在 `archived` 一个语义上，漏了更容易发现。
 * 前提：SQL 里 packs 表必须用别名 `k`。
 * 第 7 批补：`tags.ts` 的标签计数也要用，所以导出共用（别再各写一份）。
 */
export const VISIBLE_PACK_SQL =
  'k.id IS NULL OR NOT EXISTS (SELECT 1 FROM projects pz WHERE pz.id = k.project_id AND pz.archived = 1)'

export interface PackWithStats extends PackRow {
  fileCount: number
  totalSize: number
  coverPath: string | null
  projectName: string | null
  projectColor: string | null
  /** 第 8 批：包里有几条素材的文件已经丢了（卡片上挂 ⚠ N） */
  missingCount: number
  /** 第 9 批（M6）：共几稿；0 = 老包（卡片不显示版本行） */
  versionCount: number
  /** 第 9 批（M6）：当前版本的编号（1 → V1）；没有版本时为 null */
  currentSeq: number | null
  // ---- 第 56 批（docs/42）：工单标识（手工建的任务全 null / 0）----
  ticketNo: string | null
  ticketApplicant: string | null
  ticketDueDate: string | null
  ticketTitle: string | null
  ticketState: string | null
  ticketCount: number
  // ---- 第 58 批（docs/43）：任务备份打包 ----
  /** null = 未备份；有值 = 最近一次备份成功的时刻 */
  backedUpAt: string | null
  /** 最近一次备份 zip 的绝对路径 */
  backupPath: string | null
  /** `backupPath` 指向的文件当前是否还在（界面据此决定要不要给「打开所在文件夹」按钮） */
  backupPathExists: boolean
}

/**
 * 第 56 批（docs/42）：一张任务关联的工单展示信息。
 *
 * 为什么单独查：`packs` 表里**不存**工单编号（工单是可增删的镜像数据），
 * 唯一键 `ticket_no` 只在 `tickets` 表里，关联靠 `tickets.pack_id`
 * （建任务时写入、任务删除时外键自动 SET NULL）。
 * 一张任务理论上可能挂多张单（历史手工干预）→ 取 **id 最小的一张**做代表，
 * 另带 `ticketCount` 总张数。手工建的任务查不到 → 全 null / 0，界面不显示标识行。
 */
export interface PackTicketInfo {
  ticketNo: string | null
  ticketApplicant: string | null
  ticketDueDate: string | null
  ticketTitle: string | null
  ticketState: string | null
  ticketCount: number
}

/** 第 56 批（docs/42）：一次查全部「任务 → 工单展示信息」，避免在包循环里逐条查（N+1） */
export function packTicketInfoMap(): Map<number, PackTicketInfo> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT pack_id, ticket_no, applicant_name, due_date, title, approval_state
         FROM tickets
        WHERE pack_id IS NOT NULL
        ORDER BY pack_id, id`
    )
    .all() as Array<{
    pack_id: number
    ticket_no: string
    applicant_name: string | null
    due_date: string | null
    title: string | null
    approval_state: string | null
  }>
  const map = new Map<number, PackTicketInfo>()
  for (const r of rows) {
    const cur = map.get(r.pack_id)
    if (cur) {
      cur.ticketCount += 1
      continue // 先出现的 id 最小 → 它当代表，后面的只累计张数
    }
    map.set(r.pack_id, {
      ticketNo: r.ticket_no,
      ticketApplicant: r.applicant_name,
      ticketDueDate: r.due_date,
      ticketTitle: r.title,
      ticketState: r.approval_state,
      ticketCount: 1
    })
  }
  return map
}

/** 第 56 批（docs/42）：没有工单时的兜底值 —— 界面据此不显示标识行 */
const NO_TICKET: PackTicketInfo = {
  ticketNo: null,
  ticketApplicant: null,
  ticketDueDate: null,
  ticketTitle: null,
  ticketState: null,
  ticketCount: 0
}

/** A-06：包视图数据 —— 包卡片（含条数、总容量、封面、项目名与配色） */
/**
 * 找一个任务包里的「封面文件」绝对路径；没有则 null。
 *
 * 排序与包封面口径一致（成品 > 素材 > 工程 > 其它），
 * 同一个包里若有多张（比如成品放一张、素材又放一张），取更靠前的那张。
 */
export function findCoverFile(packId: number): string | null {
  const r = getDb()
    .prepare(
      `SELECT abs_path, file_name FROM assets
        WHERE pack_id = ? AND missing_at IS NULL
          AND file_name LIKE '\\_封面.%' ESCAPE '\\'
        ORDER BY CASE role WHEN '成品' THEN 0 WHEN '素材' THEN 1 WHEN '工程' THEN 2 ELSE 3 END, id`
    )
    .all(packId) as Array<{ abs_path: string; file_name: string }>
  // SQL 那层只做"前缀像"，扩展名交给 JS 精确判（SQL 里判大小写很啰嗦）
  const hit = r.find((x) => isCoverFileName(x.file_name))
  return hit ? hit.abs_path : null
}

export function listPacks(): PackWithStats[] {
  const db = getDb()
  // 第 7 批：解绑项目（archived = 1）名下的包在软件里彻底隐身 —— 用户拍板
  const packs = db
    .prepare(
      `SELECT k.*, p.name AS projectName, p.color AS projectColor
         FROM packs k
         LEFT JOIN projects p ON p.id = k.project_id
        WHERE k.project_id IS NULL OR p.archived = 0
        ORDER BY k.updated_at DESC`
    )
    .all() as Array<PackRow & { projectName: string | null; projectColor: string | null }>

  // 第 56 批（docs/42）：一次查全部工单标识（手工建的任务不在表里 → 走兜底，界面不显示）
  const ticketInfo = packTicketInfoMap()

  // 第 53 批（docs/38）**刻意不在这里动封面**：
  // 原有封面查询的候选条件已经包含 `ext IN (jpg,jpeg,png,webp,gif,bmp)`，
  // 而本批的封面文件只可能是 jpg/jpeg/png —— **本来就抓得到**，
  // 再加一段"兜底"是永远走不到的死代码（还会多一次查询）。
  // 唯一真正缺的是「完成任务」那条路：它只看 role='成品'，封面文件在 02/03 就够不着。

  return packs.map((p) => {
    // 第 8 批口径（用户拍板）：**条数算上丢失的**（记录还在），
    // **容量不算**（文件已经不在本地占空间了，算进去会让"占用 X GB"虚高），
    // 另外单独数一个 missingCount 给卡片挂角标。
    const stat = db
      .prepare(
        `SELECT COUNT(*) AS c,
                COALESCE(SUM(CASE WHEN missing_at IS NULL THEN size ELSE 0 END), 0) AS s,
                COALESCE(SUM(CASE WHEN missing_at IS NOT NULL AND missing_ignored_at IS NULL THEN 1 ELSE 0 END), 0) AS m
           FROM assets WHERE pack_id = ?`
      )
      .get(p.id) as { c: number; s: number; m: number }

    // 封面：优先取「成品」里的第一个图片。第 8 批：跳过已丢失的
    //（指过去也是读不出来的死链，不如让下一张顶上）
    const cover = db
      .prepare(
        `SELECT abs_path, thumb_path FROM assets
         WHERE pack_id = ? AND missing_at IS NULL
           AND (thumb_path IS NOT NULL OR ext IN ('jpg','jpeg','png','webp','gif','bmp'))
         ORDER BY CASE role WHEN '成品' THEN 0 WHEN '素材' THEN 1 ELSE 2 END, id
         LIMIT 1`
      )
      .get(p.id) as { abs_path: string; thumb_path: string | null } | undefined

    // 第 9 批（M6）：共几稿 + 当前是第几稿（老包 = 0 稿，界面不显示版本行）
    const vstat = db
      .prepare(
        `SELECT COUNT(*) AS c,
                COALESCE(MAX(CASE WHEN is_current = 1 THEN seq END), 0) AS cur
           FROM pack_versions WHERE pack_id = ?`
      )
      .get(p.id) as { c: number; cur: number }

    // 第 15 批（M5）：是否至少有一稿已交付
    const hasDelivered = db
      .prepare('SELECT 1 FROM pack_versions WHERE pack_id = ? AND delivered_at IS NOT NULL LIMIT 1')
      .get(p.id) !== undefined

    const ti = ticketInfo.get(p.id) ?? NO_TICKET
    return {
      ...p,
      fileCount: stat.c,
      totalSize: stat.s,
      missingCount: stat.m,
      versionCount: vstat.c,
      currentSeq: vstat.cur || null,
      hasDelivered,
      coverPath: cover ? cover.thumb_path || cover.abs_path : null,
      // 第 58 批（docs/43）：备份标记 + 路径是否还在（界面据此决定要不要给跳转按钮）
      backedUpAt: p.backed_up_at,
      backupPath: p.backup_path,
      backupPathExists: !!p.backup_path && existsSync(p.backup_path),
      ...ti
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
  /** 第 8 批：只看文件已丢失的（左栏「⚠️ 文件已丢失」入口）。
   *  第 47 批（docs/33 §4.2）：**已忽略的不算丢失**，口径与 assetTotals / listPacks 严格一致 */
  missingOnly?: boolean
  /** 第 47 批（docs/33 §4.2）：只看已忽略丢失的（左栏「🚫 已忽略」入口） */
  ignoredOnly?: boolean
  /** 第 9 批（M6）：只看当前那一稿的文件（工具栏「只看当前稿」开关）。
   *  未分版本的老文件**不算**当前版本的文件，开关打开时它们不出现 */
  currentOnly?: boolean
} = {}): AssetRow[] {
  const db = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}

  // 第 7 批：解绑项目的包在软件里彻底隐身，它的素材也不该冒出来（用户拍板）
  where.push(`(${VISIBLE_PACK_SQL})`)

  // 第 8 批：只看丢了文件的（可与项目 / 标签筛选叠加 —— where 本来就是 AND）
  // 第 47 批（docs/33 §4.2）：两条口径严格互斥 —— 「丢失」不含已忽略的，「已忽略」只看已忽略的，
  // 这样左栏两个数字与各自点开后的条数永远相等（第 7 批教训：筛选器数字必须与结果一致）。
  if (opts.missingOnly) where.push('a.missing_at IS NOT NULL AND a.missing_ignored_at IS NULL')
  if (opts.ignoredOnly) where.push('a.missing_ignored_at IS NOT NULL')

  // 第 9 批（M6）：只看当前那一稿的文件
  if (opts.currentOnly) {
    where.push('a.version_id IN (SELECT id FROM pack_versions WHERE is_current = 1)')
  }

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

/** A-08：点开包 → 按三组给出文件（第 9 批起带上全部稿，界面自己按 version_id 过滤） */
export function getPackDetail(packId: number): {
  pack: PackWithStats
  groups: Record<string, AssetRow[]>
  versions: PackVersion[]
} {
  const db = getDb()
  const pack = db
    .prepare(
      `SELECT k.*, p.name AS projectName, p.color AS projectColor
         FROM packs k LEFT JOIN projects p ON p.id = k.project_id
        WHERE k.id = ?`
    )
    .get(packId) as (PackRow & { projectName: string | null; projectColor: string | null }) | undefined
  if (!pack) throw new Error(COPY.packErr.notFound)

  // 第 9 批：万一当前版本那稿被解绑了，这里兜底把指针顺延，界面才不至于"一个都不选中"
  ensureCurrentVersion(packId)
  const versions = listVersions(packId)

  // 第 8 批：口径与 listPacks 一致 —— 条数含丢失、容量不含、另数丢失条数
  const stat = db
    .prepare(
      `SELECT COUNT(*) AS c,
              COALESCE(SUM(CASE WHEN missing_at IS NULL THEN size ELSE 0 END), 0) AS s,
              COALESCE(SUM(CASE WHEN missing_at IS NOT NULL AND missing_ignored_at IS NULL THEN 1 ELSE 0 END), 0) AS m
         FROM assets WHERE pack_id = ?`
    )
    .get(packId) as { c: number; s: number; m: number }

  const rows = db
    .prepare('SELECT * FROM assets WHERE pack_id = ? ORDER BY modified_at DESC')
    .all(packId) as AssetRow[]

  const groups: Record<string, AssetRow[]> = { 成品: [], 素材: [], 工程: [], 未归属: [] }
  for (const r of rows) {
    if (!groups[r.role]) groups[r.role] = []
    groups[r.role].push(r)
  }
  return {
    pack: {
      ...pack,
      fileCount: stat.c,
      totalSize: stat.s,
      missingCount: stat.m,
      versionCount: versions.length,
      currentSeq: versions.find((v) => v.is_current === 1)?.seq ?? null,
      coverPath: null,
      // 第 58 批（docs/43）：详情弹窗的「已备份」信息条要用这两列
      backedUpAt: pack.backed_up_at,
      backupPath: pack.backup_path,
      backupPathExists: !!pack.backup_path && existsSync(pack.backup_path),
      // 第 56 批（docs/42）：详情弹窗标题要带同样的工单标识，与卡片对得上
      ...(packTicketInfoMap().get(packId) ?? NO_TICKET)
    },
    groups,
    versions
  }
}

/** 未归属池数量（给界面顶栏做提示用） */
export function countUnassigned(): number {
  const db = getDb()
  const r = db
    .prepare(
      `SELECT COUNT(*) AS c FROM assets a
         LEFT JOIN packs k ON k.id = a.pack_id
        WHERE a.role = @role AND (${VISIBLE_PACK_SQL})`
    )
    .get({ role: UNASSIGNED_ROLE }) as { c: number }
  return r.c
}

/**
 * 可见素材的总条数、总容量、丢失条数（包视图顶栏统计用；解绑项目的素材不计入）。
 *
 * 第 8 批口径（用户拍板）：**条数算上丢失的**（记录还在，界面能看到也能重新定位），
 * **容量不算**（文件已经不在本地占空间了，算进去会让"占用 X GB"虚高，误导用户去清理）。
 */
export function assetTotals(): {
  count: number
  size: number
  missing: number
  ignoredMissing: number
} {
  const db = getDb()
  const r = db
    .prepare(
      `SELECT COUNT(*) AS c,
              COALESCE(SUM(CASE WHEN a.missing_at IS NULL THEN a.size ELSE 0 END), 0) AS s,
              COALESCE(SUM(CASE WHEN a.missing_at IS NOT NULL AND a.missing_ignored_at IS NULL
                                THEN 1 ELSE 0 END), 0) AS m,
              COALESCE(SUM(CASE WHEN a.missing_ignored_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS ig
         FROM assets a
         LEFT JOIN packs k ON k.id = a.pack_id
        WHERE ${VISIBLE_PACK_SQL}`
    )
    .get() as { c: number; s: number; m: number; ig: number }
  // 第 47 批（docs/33 §4.2）：`missing` 只算"还没被忽略"的；已忽略的单独数一个 `ignoredMissing`。
  // 容量口径不变（`missing_at IS NULL`）—— 已忽略的文件也确实不在磁盘上，不该算进占用。
  return { count: r.c, size: r.s, missing: r.m, ignoredMissing: r.ig }
}

/** 第 8 批：可见素材里「文件已丢失」的条数（左栏入口的角标，必须与点开后列出的条数相等） */
export function countMissing(): number {
  return assetTotals().missing
}

/** 第 47 批（docs/33 §4.2）：可见素材里「已忽略丢失」的条数（左栏「已忽略」入口角标，口径同上） */
export function countIgnoredMissing(): number {
  return assetTotals().ignoredMissing
}

/**
 * 第 47 批（docs/33 §4.4）：忽略这些丢失记录 —— **只写标记**，记录、标签、包内位置一个不动。
 * 语义是"我不打算找回了，别再提醒我"，不是删除；随时可用 `unignoreMissingAssets` 撤销。
 * 只对**当前确实处于丢失态**的行生效（已忽略的再点一次无副作用，时间戳不刷新）。
 */
export function ignoreMissingAssets(ids: number[]): { ok: boolean; changed: number } {
  if (!ids.length) return { ok: true, changed: 0 }
  const db = getDb()
  const ph = ids.map(() => '?').join(',')
  const info = db
    .prepare(
      `UPDATE assets SET missing_ignored_at = ?
        WHERE id IN (${ph}) AND missing_at IS NOT NULL AND missing_ignored_at IS NULL`
    )
    .run(nowIso(), ...ids)
  return { ok: true, changed: info.changes }
}

/** 第 47 批（docs/33 §4.4）：撤销忽略 → 这条记录回到「丢失待处理」 */
export function unignoreMissingAssets(ids: number[]): { ok: boolean; changed: number } {
  if (!ids.length) return { ok: true, changed: 0 }
  const db = getDb()
  const ph = ids.map(() => '?').join(',')
  const info = db
    .prepare(`UPDATE assets SET missing_ignored_at = NULL WHERE id IN (${ph})`)
    .run(...ids)
  return { ok: true, changed: info.changes }
}

/**
 * 第 51 批（docs/36）：**彻底清掉「已忽略」的记录** —— 只删数据库行，磁盘零改动。
 *
 * 为什么需要它：第 47 批的「忽略」是个**单向门** —— 忽略了就没法把记录从库里去掉。
 * 被删文件的记录会一直留着，并且**占着版本卡片的位置**（版本卡片按 `version_id IS NULL`
 * 统计，不看文件还在不在），界面上就表现为一张去不掉的「未分版本 · 1 个文件」幽灵卡片。
 * 用户实测踩到，本批补这个出口。
 *
 * ⚠️ **双重门槛，缺一不可**：
 *   · `missing_at IS NOT NULL`         —— 扫描已确认**文件不在磁盘上**
 *   · `missing_ignored_at IS NOT NULL` —— 用户已明确说过「不打算找回了」
 * 由此得到两个保证：
 *   ① **不可能误删用户文件** —— 文件本就不在盘上，这里不碰磁盘一个字节；
 *   ② **不是不可逆的数据丢失** —— 文件以后若重新出现（用户放回去 / 从别处拷回），
 *      下一轮扫描会**重新建记录**。即：清掉 = 丢弃一条失效索引，事实来源（磁盘）没动。
 *
 * **刻意不给「待处理的丢失」开这个口**：那些行还能「重新定位」，用户也没说放弃。
 * 宁可少给一个按钮，也不越界替用户丢东西（「软件永不悄悄扔东西」铁律）。
 *
 * `asset_tags` 有 `ON DELETE CASCADE`，标签关联跟着自动清（不需要手动删）。
 * **不删缩略图缓存**（`_thumbs/*.webp`）—— 与既有「删包」路径（也只删库记录）保持一致，
 * 不为本批单独引入文件删除动作。
 */
export function purgeIgnoredAssets(ids: number[]): { ok: boolean; changed: number } {
  if (!ids.length) return { ok: true, changed: 0 }
  const db = getDb()
  const ph = ids.map(() => '?').join(',')
  const info = db
    .prepare(
      `DELETE FROM assets
        WHERE id IN (${ph}) AND missing_at IS NOT NULL AND missing_ignored_at IS NOT NULL`
    )
    .run(...ids)
  return { ok: true, changed: info.changes }
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
      error: fmt(COPY.wsErr.multiRoot, { n: roots.size })
    }
  }

  // 一条都推不出来、但库里明明有记录 → 库不自洽（rel_path 与 abs_path 对不上）。
  // 这种情况继续往下走去猜根，会拿脏 rel_path 重建出一批错误路径，宁可报错。
  if (skipped > 0) {
    return {
      ok: false,
      oldRoot: null,
      error: fmt(COPY.wsErr.inconsistent, { skipped: skipped, total: rows.length })
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
      error: fmt(COPY.wsErr.multiPackRoot, { n: proots.size })
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

// ================================================================ 第 6 批 F-01：三级目录结构迁移
// 对应方案：docs/08-目录结构升级方案.md

export interface LayoutMigration {
  /** 本次是否真的搬了东西（false = 已迁移过 / 无需迁移） */
  migrated: boolean
  /** 搬了几个包 */
  packs: number
  error?: string
}

/**
 * 一次性把工作区从「两级（包直接躺在根目录）」迁移到「三级（项目 / 包）」。
 *
 * 幂等：靠 `meta.layout_version` 标记，加上"源不存在或已在目标位置就跳过"。
 *
 * **顺序是刻意这么排的** —— 文件系统没有事务，数据库有：
 *   ① 备份库 → ② 建项目文件夹 → ③ 全部 rename（记下逆向操作）
 *   → ④ 单事务改库 → ⑤ 写标记
 * rename 阶段失败就逐个 rename 回去；改库阶段失败就回滚事务 + 把 rename 退回去。
 * 任何情况下都能回到起点，不会留下"文件搬了但库没改"的半拉子状态。
 */
export function ensureLayoutV3(workspaceRoot: string): LayoutMigration {
  const db = getDb()

  // folder_name 先补上 —— 迁移目标路径全靠它
  ensureFolderNames()

  if (getMeta('layout_version') === LAYOUT_VERSION) return { migrated: false, packs: 0 }

  const projRows = db.prepare('SELECT id, folder_name FROM projects').all() as Array<{
    id: number
    folder_name: string
  }>
  const projById = new Map(projRows.map((p) => [p.id, p]))
  const packs = db
    .prepare('SELECT id, folder_path, project_id FROM packs')
    .all() as Array<{ id: number; folder_path: string; project_id: number | null }>

  // 算迁移计划。两类包不动：
  //   · 记录悬空（磁盘上没这个文件夹）→ 交给第 7 批的清理逻辑，这里不碰
  //   · 没有项目归属 → 留在根目录，界面归「待归类」
  const used = new Set<string>()
  const plan: Array<{ packId: number; from: string; to: string }> = []
  for (const p of packs) {
    const from = p.folder_path
    if (!from || !existsSync(from)) continue
    const proj = p.project_id === null ? undefined : projById.get(p.project_id)
    if (!proj || !proj.folder_name) continue

    const targetDir = join(workspaceRoot, proj.folder_name)
    if (dirname(from).toLowerCase() === targetDir.toLowerCase()) continue // 已在目标位置

    // 同一批里多个包搬进同一个项目文件夹时，靠内存集合去重（此时磁盘上还没有新名字）
    const base = basename(from)
    let to = join(targetDir, base)
    let i = 2
    while (existsSync(to) || used.has(to.toLowerCase())) {
      to = join(targetDir, `${base}-${i}`)
      i += 1
      if (i > 999) break
    }
    used.add(to.toLowerCase())
    plan.push({ packId: p.id, from, to })
  }

  const stamp = new Date().toISOString()

  // 没有要搬的（新工作区 / 已搬过）→ 直接标记就行
  if (plan.length === 0) {
    setMeta('layout_version', LAYOUT_VERSION)
    return { migrated: false, packs: 0 }
  }

  // ① 备份：迁移动的是用户看得见的目录，先留一手
  if (!backupDb(workspaceRoot)) {
    return { migrated: false, packs: 0, error: COPY.wsErr.backupFailedMigrate }
  }

  // ② + ③ 建目录、逐个 rename
  const moved: Array<{ from: string; to: string }> = []
  for (const step of plan) {
    try {
      mkdirSync(dirname(step.to), { recursive: true })
      renameSync(step.from, step.to)
      moved.push({ from: step.from, to: step.to })
    } catch (e) {
      for (const d of [...moved].reverse()) {
        try {
          renameSync(d.to, d.from)
        } catch {
          /* 尽力而为 */
        }
      }
      return {
        migrated: false,
        packs: 0,
        error: fmt(COPY.wsErr.moveRollback, { name: basename(step.from), msg: (e as Error).message })
      }
    }
  }

  // ④ 单事务改库
  try {
    db.transaction(() => {
      for (const step of plan) {
        db.prepare('UPDATE packs SET folder_path = ? WHERE id = ?').run(step.to, step.packId)
        reprefixPaths(workspaceRoot, step.from, step.to)
      }
    })()
  } catch (e) {
    for (const d of moved) {
      try {
        if (existsSync(d.to)) renameSync(d.to, d.from)
      } catch {
        /* 尽力而为 */
      }
    }
    return { migrated: false, packs: 0, error: fmt(COPY.wsErr.writeDbRollback, { msg: (e as Error).message }) }
  }

  // ⑤ 写标记（notice 留给界面提示一次，ack 后清掉）
  setMeta('layout_version', LAYOUT_VERSION)
  setMeta('layout_notice', JSON.stringify({ at: stamp, packs: plan.length }))

  return { migrated: true, packs: plan.length }
}

/** 界面提示过迁移结果后调用，保证提示条只出现一次 */
export function ackLayoutNotice(): void {
  setMeta('layout_notice', '')
}

/**
 * 读「刚迁移过、还没提示」的标记。没有则返回 null。
 * 只在真正搬了东西之后才有值 —— 新工作区不会打扰用户。
 */
export function readLayoutNotice(): { at: string; packs: number } | null {
  const raw = getMeta('layout_notice')
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { at?: string; packs?: number }
    return { at: o.at ?? '', packs: typeof o.packs === 'number' ? o.packs : 0 }
  } catch {
    return null
  }
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
    return { ...base, oldRoot, error: fmt(COPY.wsErr.backupFailedRewrite, { msg: (e as Error).message }) }
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
      error: fmt(COPY.wsErr.rewriteRollback, { path: backupPath, msg: (e as Error).message })
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
    return { kind: 'broken', root: norm, error: fmt(COPY.wsErr.readDbFailed, { msg: (e as Error).message }) }
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
    return { ok: false, error: COPY.wsErr.notWritable }
  }

  const info = inspectWorkspaceDir(norm)

  if (info.kind === 'broken') {
    return { ok: false, error: info.error || COPY.wsErr.libBroken }
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
    if (!r.ok) return { ok: false, error: r.error || COPY.ipc.rewriteFailed }
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
  if (!cfg) return { ok: false, error: COPY.wsErr.noWorkspace }

  const target = cfg.workspaces.find((w) => w.id === id)
  if (!target) return { ok: false, error: COPY.wsErr.wsMissing }

  if (!isUsableWorkspace(target.root)) {
    return {
      ok: false,
      error: fmt(COPY.wsErr.wsOffline, { name: target.name })
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
  if (!cfg) return { ok: false, error: COPY.wsErr.noWorkspace }

  const rest = cfg.workspaces.filter((w) => w.id !== id)
  if (rest.length === cfg.workspaces.length) return { ok: false, error: COPY.wsErr.wsMissing }
  if (rest.length === 0) return { ok: false, error: COPY.wsErr.keepOneWs }

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
  if (!cfg) return { ok: false, error: COPY.wsErr.noWorkspace }

  const active = cfg.workspaces.find((w) => w.id === cfg.activeId) || cfg.workspaces[0]
  const from = trimSlash(active.root)
  const parent = trimSlash(targetParentDir)
  const to = join(parent, basename(from))

  if (!existsSync(from)) return { ok: false, from, to, error: COPY.wsErr.curWsDirMissing }
  if (!existsSync(parent)) return { ok: false, from, to, error: COPY.wsErr.targetMissing }
  if (to.toLowerCase().startsWith(from.toLowerCase() + sep)) {
    return { ok: false, from, to, error: COPY.wsErr.moveIntoItself }
  }
  if (existsSync(to)) {
    return {
      ok: false,
      from,
      to,
      error: fmt(COPY.wsErr.targetExists, { name: basename(from) })
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
    return { ok: false, from, to, error: fmt(COPY.wsErr.moveFailed, { msg: (e as Error).message }) }
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
    return { ok: false, from, to, error: r.error || COPY.wsErr.movedButDbFailed }
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
