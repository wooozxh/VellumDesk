import { COPY } from '../shared/copy'
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
  /**
   * 项目在工作区磁盘上对应的文件夹名（第 6 批：三级目录结构）。
   *
   * 为什么不靠 `name` 现算：项目改名要连带改文件夹，必须知道**旧文件夹名**。
   * 有包时能从 packs.folder_path 反推，但**空项目无从反推** ——
   * 而"新建工作区预设几个项目"天然会产生空项目文件夹。
   * 值的唯一生成者是 workspace.ts 的 ensureFolderNames()。
   */
  folder_name: string
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
  // ---- 第 8 批新增：失效检查（M8-03）----
  /** null = 正常；有值 = 这个时刻发现文件已丢失（原路径见 abs_path） */
  missing_at: string | null
  // ---- 第 9 批新增：版本管理（M6）----
  /** 属于哪一稿（pack_versions.id）；null = 未分版本（老包 / 包根散文件） */
  version_id: number | null
}

/** 第 9 批（M6 版本管理）：包里的「一稿」。一稿 = 包文件夹下的一个文件夹 */
export interface PackVersionRow {
  id: number
  pack_id: number
  /** 第几稿：1 → 界面显示 V1 */
  seq: number
  /** 磁盘上的真实文件夹名：软件建的是 V1/V2/V3，用户手工建的可以是任意名（绑定时登记） */
  folder_name: string
  /** 版本说明：这一稿改了什么 */
  note: string
  /** 当前版本（一个包内最多一个为 1） */
  is_current: number
  /** M6-07 用（交付记录绑版本），本批只留字段 */
  delivered_at: string | null
  created_at: string
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

/** 读软件自己的元信息（没有则返回 null） */
export function getMeta(key: string): string | null {
  const r = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return r ? r.value : null
}

/** 写软件自己的元信息 */
export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
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
      folder_name  TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL
    );

    -- 软件自己的元信息（第 6 批）：目前只放目录布局版本 layout_version。
    -- 放在工作区自己的库里而不是全局配置里 —— 多工作区各有各的结构状态。
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
      scanned_at   TEXT    NOT NULL,
      -- 第 8 批 M8-03：NULL = 正常；有值 = 该时刻发现原文件已丢失（记录不删，等重新定位）
      missing_at   TEXT,
      -- 第 9 批（M6 版本管理）：属于哪一稿（pack_versions.id）；NULL = 未分版本
      version_id   INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_assets_pack ON assets(pack_id);
    CREATE INDEX IF NOT EXISTS idx_assets_role ON assets(role);
    -- ⚠️ missing_at / version_id 的索引不在这里建：老库的 assets 表已存在（CREATE TABLE
    -- IF NOT EXISTS 会跳过），这两句跑的时候列还没被迁移补上，直接 "no such column"。
    -- 分别放到迁移 8 / 迁移 9 的 ALTER 之后建。

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
    -- 第 7 批：补上真外键 + ON DELETE CASCADE —— 素材记录被删时关联行自动消失，
    -- 不再留孤儿（老库由「迁移 7」重建，见下）。
    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id   INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      tag_id     INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
      PRIMARY KEY (asset_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tags_dim ON tags(dimension, sort_order);
    CREATE INDEX IF NOT EXISTS idx_at_tag ON asset_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_at_asset ON asset_tags(asset_id);

    -- 第 9 批（M6 版本管理）：包里的「稿」。一稿 = 包文件夹下的一个文件夹。
    -- 磁盘是唯一真相（文件夹在不在），这张表只记「编号 / 文件夹名 / 说明 / 当前」。
    -- 这是**新表**，所以索引可以就建在这儿（不像 assets 那种给老表补列的场景）。
    CREATE TABLE IF NOT EXISTS pack_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      -- 包被删（cleanupMissingPacks）时，它的稿记录跟着消失，不留孤儿
      pack_id      INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
      seq          INTEGER NOT NULL,
      folder_name  TEXT    NOT NULL,
      note         TEXT    NOT NULL DEFAULT '',
      is_current   INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      created_at   TEXT    NOT NULL,
      UNIQUE(pack_id, seq),
      UNIQUE(pack_id, folder_name)
    );

    CREATE INDEX IF NOT EXISTS idx_pack_versions_pack ON pack_versions(pack_id);

    -- 第 9 批（M6 版本管理）：「解绑白名单」的反面 —— 解绑过的文件夹不要再被**自动认领**。
    --
    -- 为什么需要它：自动认领的规则是「文件夹名像 V<数字>、该名字还没被认领」。
    -- 用户解绑 V1 后，磁盘上那个文件夹还叫「V1」（铁则：解绑不动磁盘），
    -- 下一次扫描按规则又把它认成第 1 稿 —— 用户点了「解绑」等于没点。
    -- 所以解绑时把「包 + 文件夹名」记在这里，扫描自动认领时跳过它。
    -- 用户想收回管理，点「绑定文件夹」即可（绑定成功会把这条忽略记录删掉）。
    --
    -- COLLATE NOCASE：Windows 上 V1 / v1 是同一个文件夹，不能记成两条。
    CREATE TABLE IF NOT EXISTS pack_version_ignores (
      pack_id     INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
      folder_name TEXT    NOT NULL COLLATE NOCASE,
      created_at  TEXT    NOT NULL,
      PRIMARY KEY (pack_id, folder_name)
    );
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

  // ---- 迁移 6：projects 加 folder_name（第 6 批：三级目录结构）----
  // 只加列 + 索引；**值由 workspace.ts 的 ensureFolderNames() 回填**（单一来源）。
  // 回填前全是空串，被 WHERE 排除，所以索引能安全建立。
  const projCols = d.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
  if (!projCols.some((c) => c.name === 'folder_name')) {
    d.exec("ALTER TABLE projects ADD COLUMN folder_name TEXT NOT NULL DEFAULT ''")
  }
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_folder
      ON projects(folder_name) WHERE folder_name <> ''
  `)

  // ---- 迁移 7：asset_tags 补真外键（第 7 批：记录生命周期）----
  //
  // 老表是张**裸关联表**：对 assets / tags 都没有外键，素材记录被删时关联行留成孤儿。
  // SQLite 不支持 ALTER 加外键，只能重建表。
  // 幂等判定：`foreign_key_list` 为空 = 还没重建过（新建的库在建表时已带外键，会直接跳过）。
  const assetTagFks = d.prepare('PRAGMA foreign_key_list(asset_tags)').all() as Array<unknown>
  if (assetTagFks.length === 0) {
    // ① 先清历史孤儿 —— 不清的话重建时会被新外键拒绝写入
    d.exec(`
      DELETE FROM asset_tags WHERE asset_id NOT IN (SELECT id FROM assets);
      DELETE FROM asset_tags WHERE tag_id   NOT IN (SELECT id FROM tags);
    `)
    // ② PRAGMA foreign_keys 在事务内是 no-op，必须在事务外切
    d.pragma('foreign_keys = OFF')
    d.transaction(() => {
      d.exec(`
        CREATE TABLE asset_tags_new (
          asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
          PRIMARY KEY (asset_id, tag_id)
        );
        INSERT INTO asset_tags_new (asset_id, tag_id) SELECT asset_id, tag_id FROM asset_tags;
        DROP TABLE asset_tags;
        ALTER TABLE asset_tags_new RENAME TO asset_tags;
        CREATE INDEX IF NOT EXISTS idx_at_tag   ON asset_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_at_asset ON asset_tags(asset_id);
      `)
    })()
    d.pragma('foreign_keys = ON')
  }

  // ---- 迁移 8：assets 加 missing_at（第 8 批 M8-03：文件已丢失标记）----
  // 老库升级：缺列就补。新列默认 NULL（= 正常），不需要回填。
  // 这条迁移本身不搬数据 —— 老库里"文件已经丢了但记录还在"的素材，
  // 会在下一次刷新扫描时由 scanAll 第 5 步自动标上（见 workspace.ts）。
  const assetCols8 = d.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>
  if (!assetCols8.some((c) => c.name === 'missing_at')) {
    d.exec('ALTER TABLE assets ADD COLUMN missing_at TEXT')
  }
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_assets_missing ON assets(missing_at)
     WHERE missing_at IS NOT NULL
  `)

  // ---- 迁移 9：assets 加 version_id（第 9 批 M6 版本管理）----
  // 老库升级：缺列就补，值全为 NULL（= 未分版本），软件行为与升级前**完全一致** ——
  // 用户拍板"老包不管"（库里现有包全是测试数据），所以这条迁移**不搬任何数据、不动任何文件**。
  // 索引同样必须放在 ALTER 之后（迁移 8 踩过的坑：建表段里那句会跑在 ALTER 之前 → no such column）。
  const assetCols9 = d.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>
  if (!assetCols9.some((c) => c.name === 'version_id')) {
    d.exec('ALTER TABLE assets ADD COLUMN version_id INTEGER')
  }
  d.exec('CREATE INDEX IF NOT EXISTS idx_assets_version ON assets(version_id)')

  // ---- 迁移 3：首次使用（空库）→ 落三个预制项目 ----
  const projectCount = (d.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c
  if (projectCount === 0) {
    const seed = [
      { name: COPY.seed.projCommonName, color: '#6b7280', note: COPY.projModal.notePresetCommon },
      { name: COPY.seed.projEduName, color: '#4f8cff', note: COPY.projModal.notePresetEducation },
      { name: COPY.seed.projCampName, color: '#3fb950', note: COPY.projModal.notePresetCamp }
    ]
    const ins = d.prepare(
      `INSERT INTO projects (name, color, note, sort_order, archived, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    seed.forEach((s, i) => ins.run(s.name, s.color, s.note, i, now))
  }

  // ---- 第 6 批起：**故意不再**给 project_id 为空的包兜底塞进「集团通用」 ----
  //
  // 老实现这里有一段 `UPDATE packs SET project_id = <集团通用> WHERE project_id IS NULL`，
  // 每次启动都跑。三级目录结构落地后这成了个坑：根目录下的游离包（scanAll 明确写成
  // project_id = null，界面归「待归类」等用户手动选项目）会被启动时悄悄认领走，
  // 「待归类」这个入口永远空着 —— 用户明明没选过项目，包却自己有了归属。
  //
  // NULL 现在是**合法状态**（docs/08 §2），只由 createPack 在用户真的选了项目时才赋值。

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
    label: COPY.dim.category,
    mode: 'multi',
    editable: true,
    presets: [
      COPY.seed.catPoster, COPY.seed.catFolded, COPY.seed.catLongImage, COPY.seed.catShortVideo, COPY.seed.catPromo,
      COPY.seed.catLive, COPY.seed.catFont, COPY.seed.catIcon, COPY.seed.catRef
    ],
    colors: ['#4f8cff', '#3fb950', '#e8a33d', '#a884ff', '#f0603f', '#2bb5b5', '#e86fa8', '#8fa83d', '#d9a0ff'],
    hint: COPY.dim.categoryHint
  },
  {
    key: 'channel',
    label: COPY.dim.channel,
    mode: 'multi',
    editable: true,
    presets: [COPY.seed.chOfficial, COPY.seed.chMoments, COPY.seed.chVideo, COPY.seed.chDouyin, COPY.seed.chStore, COPY.seed.chWebsite],
    colors: ['#4f8cff', '#3fb950', '#e8a33d', '#a884ff', '#f0603f', '#2bb5b5'],
    hint: COPY.dim.channelHint
  },
  {
    key: 'status',
    label: COPY.dim.status,
    mode: 'single',
    editable: true,
    presets: [COPY.seed.stDraft, COPY.seed.stReview, COPY.seed.stDelivered, COPY.seed.stArchived],
    colors: ['#6b7280', '#e8a33d', '#3fb950', '#8fa83d'],
    hint: COPY.dim.statusHint
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

/**
 * 包没类别时的兜底值（`packs.category` 的建表默认值 / 建包留空时也用它）。
 *
 * 第 10 批（2026-09-30）：原来这里还有一份写死的 `CATEGORIES`（海报/视频/折页/推文配图/PPT/其他），
 * 给「新建包」当类别下拉用 —— 跟左栏标签维度的「物料类别」是两套清单，只有两项重叠，
 * 用户实测发现后拍板两套合一：**建包清单直接跟着标签维度走**（渲染层从 `tagDimensions` 派生），
 * 常量已删。类别的增删改都在左栏「标签管理 → 物料类别」里做。
 */
export const UNCATEGORIZED = '未分类'
