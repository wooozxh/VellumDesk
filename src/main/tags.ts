import { getDb, getDimension, TAG_DIMENSIONS, type TagRow } from './db'

/**
 * 第 3 批：标签业务（M2 标签与分类）。
 * 2026-09-24 用户拍板：维度只留 类别 / 渠道 / 状态 三个 ——
 * 项目归属走左栏项目面板（packs.project_id），时间用物料固有字段，都不再做成标签。
 * （历史说明：项目维度曾用负数 id 映射 projects 表，listAssets 至今保留负数 id 兼容。）
 */

export interface TagWithCount extends TagRow {
  assetCount: number
}

export interface DimensionGroup {
  key: string
  label: string
  mode: 'single' | 'multi'
  editable: boolean
  hint: string
  tags: TagWithCount[]
}

/** 列出所有维度及其标签（带「被多少条素材使用」计数） */
export function listTagDimensions(): DimensionGroup[] {
  const db = getDb()
  const out: DimensionGroup[] = []

  for (const dim of TAG_DIMENSIONS) {
    const rows = db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM asset_tags at WHERE at.tag_id = t.id) AS assetCount
           FROM tags t
          WHERE t.dimension = ?
          ORDER BY t.sort_order ASC, t.id ASC`
      )
      .all(dim.key) as Array<TagRow & { assetCount: number }>
    out.push({
      key: dim.key,
      label: dim.label,
      mode: dim.mode,
      editable: dim.editable,
      hint: dim.hint,
      tags: rows
    })
  }
  return out
}

/** 新建标签 */
export function createTag(input: {
  dimension: string
  name: string
  color?: string
}): { ok: boolean; tag?: TagRow; error?: string } {
  const db = getDb()
  const dim = getDimension(input.dimension)
  if (!dim) return { ok: false, error: '维度不存在：' + input.dimension }
  const name = (input.name ?? '').trim()
  if (!name) return { ok: false, error: '标签名不能为空' }

  const dup = db
    .prepare('SELECT id FROM tags WHERE dimension = ? AND name = ?')
    .get(input.dimension, name) as { id: number } | undefined
  if (dup) return { ok: false, error: `「${dim.label}」下已有同名标签` }

  const maxOrder = (
    db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM tags WHERE dimension = ?')
      .get(input.dimension) as { m: number }
  ).m
  const color = input.color || dim.colors[(maxOrder + 1) % dim.colors.length]
  const info = db
    .prepare(
      `INSERT INTO tags (dimension, name, color, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.dimension, name, color, maxOrder + 1, new Date().toISOString())

  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(info.lastInsertRowid) as TagRow
  return { ok: true, tag }
}

/** 改标签（改名 / 改色） */
export function updateTag(
  id: number,
  patch: { name?: string; color?: string }
): { ok: boolean; tag?: TagRow; error?: string } {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined
  if (!cur) return { ok: false, error: '标签不存在' }

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, error: '标签名不能为空' }
    const dup = db
      .prepare('SELECT id FROM tags WHERE dimension = ? AND name = ? AND id <> ?')
      .get(cur.dimension, name, id) as { id: number } | undefined
    if (dup) return { ok: false, error: '同维度下已有同名标签' }
    db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id)
  }
  if (patch.color !== undefined) {
    db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(patch.color, id)
  }
  return { ok: true, tag: db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow }
}

/** 标签使用量（删除前提示：「该标签被 320 条素材使用，确认删除？」） */
export function tagUsage(id: number): { assetCount: number } {
  const db = getDb()
  const r = db.prepare('SELECT COUNT(*) AS c FROM asset_tags WHERE tag_id = ?').get(id) as {
    c: number
  }
  return { assetCount: r.c }
}

/** 删标签（连带清掉关联；素材本身不动） */
export function removeTag(id: number): { ok: boolean; deleted: number; error?: string } {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined
  if (!cur) return { ok: false, deleted: 0, error: '标签不存在' }
  const affected = (
    db.prepare('SELECT COUNT(*) AS c FROM asset_tags WHERE tag_id = ?').get(id) as { c: number }
  ).c

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM asset_tags WHERE tag_id = ?').run(id)
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)
  })
  tx()
  return { ok: true, deleted: affected }
}

/**
 * 批量打标签（需求文档原话：「框选 100 张图一次打完」）。
 * 会先清掉这批素材在「所贴标签所属维度」上的旧标签（单选维度必须清，多选维度按面板勾选结果覆盖）。
 */
export function applyTags(args: {
  assetIds: number[]
  tagIds: number[]
}): { ok: boolean; tagged: number; cleared: number } {
  const db = getDb()
  if (!args.assetIds.length || !args.tagIds.length) return { ok: true, tagged: 0, cleared: 0 }

  const ins = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
  const idList = args.tagIds.join(',')
  const placeholders = args.assetIds.map(() => '?').join(',')
  let cleared = 0

  const tx = db.transaction(() => {
    // 1. 先清：这批素材在「要贴的标签所属维度」上的旧标签
    const dims = (
      db.prepare(`SELECT DISTINCT dimension FROM tags WHERE id IN (${idList})`).all() as Array<{
        dimension: string
      }>
    ).map((r) => r.dimension)

    for (const dim of dims) {
      const stale = db
        .prepare(
          `SELECT at.asset_id, at.tag_id FROM asset_tags at
             JOIN tags t ON t.id = at.tag_id
            WHERE t.dimension = ? AND at.asset_id IN (${placeholders})`
        )
        .all(dim, ...args.assetIds) as Array<{ asset_id: number; tag_id: number }>
      const del = db.prepare('DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = ?')
      for (const s of stale) {
        del.run(s.asset_id, s.tag_id)
        cleared += 1
      }
    }

    // 2. 再贴
    for (const aid of args.assetIds) {
      for (const tid of args.tagIds) ins.run(aid, tid)
    }
  })
  tx()

  return { ok: true, tagged: args.assetIds.length * args.tagIds.length, cleared }
}

/** 批量去标签 */
export function removeTagsFrom(args: {
  assetIds: number[]
  tagIds: number[]
}): { ok: boolean; removed: number } {
  const db = getDb()
  if (!args.assetIds.length || !args.tagIds.length) return { ok: true, removed: 0 }
  const del = db.prepare('DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = ?')
  let removed = 0
  const tx = db.transaction(() => {
    for (const aid of args.assetIds) {
      for (const tid of args.tagIds) {
        removed += del.run(aid, tid).changes
      }
    }
  })
  tx()
  return { ok: true, removed }
}

/** 取一批素材的标签（列表色块 / 详情用） */
export function tagsOfAssets(assetIds: number[]): Record<number, TagRow[]> {
  const db = getDb()
  const out: Record<number, TagRow[]> = {}
  if (!assetIds.length) return out

  const rows = db
    .prepare(
      `SELECT at.asset_id, t.id, t.dimension, t.name, t.color, t.sort_order, t.created_at
         FROM asset_tags at
         JOIN tags t ON t.id = at.tag_id
        WHERE at.asset_id IN (${assetIds.map(() => '?').join(',')})
        ORDER BY t.dimension ASC, t.sort_order ASC`
    )
    .all(...assetIds) as Array<TagRow & { asset_id: number }>

  for (const r of rows) {
    if (!out[r.asset_id]) out[r.asset_id] = []
    out[r.asset_id].push({
      id: r.id,
      dimension: r.dimension,
      name: r.name,
      color: r.color,
      sort_order: r.sort_order,
      created_at: r.created_at
    })
  }
  return out
}

/**
 * C-07 标签自动建议：按文件名 / 相对路径匹配已有标签。
 * 只做推荐，绝不自动贴 —— 往用户文件上乱贴标签比不贴更糟。
 */
export function suggestTagsForAssets(assetIds: number[]): Record<number, number[]> {
  const db = getDb()
  const out: Record<number, number[]> = {}
  if (!assetIds.length) return out

  const allTags = db
    .prepare('SELECT id, dimension, name FROM tags ORDER BY dimension, sort_order')
    .all() as Array<{ id: number; dimension: string; name: string }>

  const rows = db
    .prepare(
      `SELECT id, file_name, rel_path FROM assets
        WHERE id IN (${assetIds.map(() => '?').join(',')})`
    )
    .all(...assetIds) as Array<{ id: number; file_name: string; rel_path: string }>

  for (const r of rows) {
    const hay = `${r.file_name} ${r.rel_path}`.toLowerCase()
    const hits: number[] = []
    for (const t of allTags) {
      const n = t.name.toLowerCase().trim()
      if (n.length < 2) continue // 单字标签太容易误命中
      if (hay.includes(n)) hits.push(t.id)
    }
    out[r.id] = hits
  }
  return out
}
