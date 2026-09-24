import Database from 'better-sqlite3'
import { join } from 'path'
import { mkdirSync } from 'fs'

/**
 * 数据库层。
 * 铁律：数据库文件放在素材工作区内（跟着工作区走），但「工作区路径本身」存在配置文件里，
 * 避免鸡生蛋问题 —— 见 docs/03-MVP入库功能方案.md 6.1。
 */

let db: Database.Database | null = null

export interface ProjectRow {
  id: number
  name: string
  color: string
  note: string
  sort_order: number
  archived: number // 0/1
  created_at: string
}

export interface PackRow {
  id: number
  name: string
  project_id: number | null
  category: string
  folder_path: string
  created_at: string
  updated_at: string
}

export interface TagRow {
  id: number
  dimension: string // project | category | channel | status | time
  name: string
  color: string
  sort_order: number
  created_at: string
}

export interface AssetRow {
  id: number
  pack_id: number | null
  role: string // '成品' | '素材' | '工程' | '未归属'
  file_name: string
  ext: string
  size: number
  abs_path: string
  rel_path: string
  thumb_path: string | null
  // ---- 第 2 批新增：媒体元信息（不建新表，属性跟着文件走）----
  width: number | null
  height: number | null
  color_mode: string | null
  duration_ms: number | null
  video_codec: string | null
  probe_info: string | null
  created_at: string
  modified_at: string
  scanned_at: string
}

/** 打开（或新建）工作区数据库 */
export function openDb(workspaceRoot: string): Database.Database {
  if (db) return db

  const dbDir = join(workspaceRoot, '_system')
  mkdirSync(dbDir, { recursive: true })

  db = new Database(join(dbDir, 'media.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  migrate(db)
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库尚未初始化，请先调用 openDb()')
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

/** 建表 + 迁移。每次启动都跑，必须幂等 */
function migrate(d: Database.Database): void {
  // ---- 基础表 ----
  d.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL UNIQUE,
      color        TEXT    NOT NULL DEFAULT '#4f8cff',
      note         TEXT    NOT NULL DEFAULT '',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      archived     INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS packs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      category     TEXT    NOT NULL DEFAULT '未分类',
      folder_path  TEXT    NOT NULL UNIQUE,
      created_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id      INTEGER REFERENCES packs(id) ON DELETE SET NULL,
      role         TEXT    NOT NULL DEFAULT '未归属',
      file_name    TEXT    NOT NULL,
      ext          TEXT    NOT NULL DEFAULT '',
      size         INTEGER NOT NULL DEFAULT 0,
      abs_path     TEXT    NOT NULL UNIQUE,
      rel_path     TEXT    NOT NULL DEFAULT '',
      thumb_path   TEXT,
      created_at   TEXT    NOT NULL,
      modified_at  TEXT    NOT NULL,
      scanned_at   TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assets_pack ON assets(pack_id);
    CREATE INDEX IF NOT EXISTS idx_assets_role ON assets(role);

    -- 第 3 批：标签体系（需求文档 7.4 节定的两张表）
    CREATE TABLE IF NOT EXISTS tags (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      dimension    TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      color        TEXT    NOT NULL DEFAULT '#4f8cff',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL,
      UNIQUE(dimension, name)
    );

    -- 关联表：一条素材可贴多个标签。标准做法，别省。
    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id   INTEGER NOT NULL,
      tag_id     INTEGER NOT NULL,
      PRIMARY KEY (asset_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tags_dim ON tags(dimension, sort_order);
    CREATE INDEX IF NOT EXISTS idx_at_tag ON asset_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_at_asset ON asset_tags(asset_id);
  `)

  // ---- 迁移 1：packs 表加 project_id（旧库是 project 文本列）----
  const packCols = d.prepare('PRAGMA table_info(packs)').all() as Array<{ name: string }>
  const hasProjectId = packCols.some((c) => c.name === 'project_id')
  const hasProjectText = packCols.some((c) => c.name === 'project')

  if (!hasProjectId) {
    d.exec('ALTER TABLE packs ADD COLUMN project_id INTEGER')
    d.exec('CREATE INDEX IF NOT EXISTS idx_packs_project ON packs(project_id)')
  }

  // ---- 迁移 2：把旧库的 project 文本列搬进 projects 表 ----
  const now = new Date().toISOString()

  if (hasProjectText) {
    const oldRows = d
      .prepare("SELECT DISTINCT project FROM packs WHERE project IS NOT NULL AND project <> ''")
      .all() as Array<{ project: string }>
    for (const r of oldRows) {
      ensureProjectByName(d, r.project, now)
    }
    // 按名字回填 project_id，老包归属不丢
    d.exec(`
      UPDATE packs
         SET project_id = (SELECT p.id FROM projects p WHERE p.name = packs.project)
       WHERE project_id IS NULL AND project IS NOT NULL AND project <> ''
    `)
  }

  // ---- 迁移 4：assets 表加媒体元信息列（第 2 批）----
  // 逐列判断，缺哪个补哪个 —— 保证老库能平滑升级
  const assetCols = d.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>
  const hasAssetCol = (n: string): boolean => assetCols.some((c) => c.name === n)

  const newAssetCols: Array<[string, string]> = [
    ['width', 'INTEGER'],
    ['height', 'INTEGER'],
    ['color_mode', 'TEXT'],
    ['duration_ms', 'INTEGER'],
    ['video_codec', 'TEXT'],
    ['probe_info', 'TEXT']
  ]
  for (const [col, type] of newAssetCols) {
    if (!hasAssetCol(col)) d.exec(`ALTER TABLE assets ADD COLUMN ${col} ${type}`)
  }

  // ---- 迁移 3：首次使用（空库）→ 落三个预制项目 ----
  const projectCount = (d.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c
  if (projectCount === 0) {
    const seed = [
      { name: '集团通用', color: '#6b7280', note: '不属于具体业务的通用素材' },
      { name: '海南升学规划中心', color: '#4f8cff', note: '教育咨询 + 异地升学办理' },
      { name: '海南升学初三集训营', color: '#3fb950', note: '外回初三考生集训提分' }
    ]
    const ins = d.prepare(
      `INSERT INTO projects (name, color, note, sort_order, archived, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    seed.forEach((s, i) => ins.run(s.name, s.color, s.note, i, now))
  }

  // ---- 兜底：还有 project_id 为空的包，塞进「集团通用」----
  const defaultProject = d
    .prepare("SELECT id FROM projects WHERE name = '集团通用'")
    .get() as { id: number } | undefined
  if (defaultProject) {
    d.prepare('UPDATE packs SET project_id = ? WHERE project_id IS NULL').run(defaultProject.id)
  }

  // ---- 迁移 5：首次使用（空库）→ 落预制标签 ----
  const tagCount = (d.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number }).c
  if (tagCount === 0) {
    const insTag = d.prepare(
      `INSERT INTO tags (dimension, name, color, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const dim of TAG_DIMENSIONS) {
      dim.presets.forEach((name, i) => {
        insTag.run(dim.key, name, dim.colors[i % dim.colors.length], i, now)
      })
    }
  }
}

// ---------------------------------------------------------------- 第 3 批：标签维度定义

export type DimensionKey = 'category' | 'channel' | 'status'

export interface DimensionDef {
  key: DimensionKey
  label: string
  /** 该维度下一条素材能贴几个标签：'single' 单选 / 'multi' 多选 */
  mode: 'single' | 'multi'
  /** 是否允许用户自行增删标签 */
  editable: boolean
  /** 预制标签（空库初始化用） */
  presets: string[]
  /** 预制标签的配色池 */
  colors: string[]
  hint: string
}

/** 新建项目时的自动配色池（深色主题下都清晰可辨） */
export const PROJECT_COLORS = [
  '#4f8cff', // 蓝
  '#3fb950', // 绿
  '#e8a33d', // 橙
  '#a884ff', // 紫
  '#f0603f', // 红
  '#2bb5b5', // 青
  '#e86fa8', // 粉
  '#8fa83d', // 橄榄
  '#d9a0ff', // 浅紫
  '#6b7280' // 灰
] as const

/**
 * 标签维度（需求文档 5.2 节定为 5 个，2026-09-24 用户拍板砍成 3 个）：
 * - 砍「所属项目」：与左栏项目面板重复，项目归属走 packs.project_id
 * - 砍「时间」：物料固有字段（信息行已显示），不值得单独出标签
 */
export const TAG_DIMENSIONS: readonly DimensionDef[] = [
  {
    key: 'category',
    label: '物料类别',
    mode: 'multi',
    editable: true,
    presets: [
      '海报', '折页', '详情长图', '短视频', '宣传片',
      '直播物料', '字体', '图标素材', '参考图'
    ],
    colors: ['#4f8cff', '#3fb950', '#e8a33d', '#a884ff', '#f0603f', '#2bb5b5', '#e86fa8', '#8fa83d', '#d9a0ff'],
    hint: '一张海报可以同时是「海报」和「参考图」'
  },
  {
    key: 'channel',
    label: '使用渠道',
    mode: 'multi',
    editable: true,
    presets: ['公众号', '朋友圈', '视频号', '抖音', '线下门店', '官网'],
    colors: ['#4f8cff', '#3fb950', '#e8a33d', '#a884ff', '#f0603f', '#2bb5b5'],
    hint: '同一张图可以发多个渠道'
  },
  {
    key: 'status',
    label: '状态',
    mode: 'single',
    editable: true,
    presets: ['草稿', '待审核', '已交付', '已归档'],
    colors: ['#6b7280', '#e8a33d', '#3fb950', '#8fa83d'],
    hint: '一条素材同一时刻只处于一种状态'
  }
] as const

export function getDimension(key: string): DimensionDef | undefined {
  return TAG_DIMENSIONS.find((d) => d.key === key)
}

/** 按名字找项目，没有就建（迁移用） */
function ensureProjectByName(d: Database.Database, name: string, ts: string): number {
  const hit = d.prepare('SELECT id FROM projects WHERE name = ?').get(name) as
    | { id: number }
    | undefined
  if (hit) return hit.id
  const maxOrder = (
    d.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects').get() as { m: number }
  ).m
  const info = d
    .prepare(
      `INSERT INTO projects (name, color, note, sort_order, archived, created_at)
       VALUES (?, ?, '', ?, 0, ?)`
    )
    .run(name, pickColor(maxOrder + 1), maxOrder + 1, ts)
  return Number(info.lastInsertRowid)
}

export function pickColor(seed: number): string {
  return PROJECT_COLORS[Math.abs(seed) % PROJECT_COLORS.length]
}

/** 物料类别：暂仍为固定项（标签专项时再改成可维护） */
export const CATEGORIES = ['海报', '视频', '折页', '推文配图', 'PPT', '其他'] as const
