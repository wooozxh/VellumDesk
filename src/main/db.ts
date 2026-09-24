import Database from 'better-sqlite3'
import { join } from 'path'
import { mkdirSync } from 'fs'

/**
 * 数据库层。
 * 铁律：数据库文件放在素材工作区内（跟着工作区走），但「工作区路径本身」存在配置文件里，
 * 避免鸡生蛋问题 —— 见 docs/03-MVP入库功能方案.md 6.1。
 */

let db: Database.Database | null = null

export interface PackRow {
  id: number
  name: string
  project: string
  category: string
  folder_path: string
  created_at: string
  updated_at: string
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

/** 建表。第 1 批只落 packs + assets 两张表（方案 6.1） */
function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS packs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      project      TEXT    NOT NULL DEFAULT '集团通用',
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
  `)
}

/** 项目维度：第 1 批先固定三个，后续做标签专项时再改成可维护 */
export const PROJECTS = ['集团通用', '海南升学规划中心', '海南升学初三集训营'] as const
export const CATEGORIES = ['海报', '视频', '折页', '推文配图', 'PPT', '其他'] as const
