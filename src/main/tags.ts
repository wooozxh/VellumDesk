import { COPY, fmt } from '../shared/copy'
import { getDb, getDimension, TAG_DIMENSIONS, UNCATEGORIZED, type TagRow } from './db'
import { VISIBLE_PACK_SQL } from './workspace'

/**
 * 第 3 批：标签业务（M2 标签与分类）。
 * 2026-09-24 用户拍板：维度只留 类别 / 渠道 / 状态 三个 ——
 * 项目归属走左栏项目面板（packs.project_id），时间用物料固有字段，都不再做成标签。
 * （历史说明：项目维度曾用负数 id 映射 projects 表，listAssets 至今保留负数 id 兼容。）
 */

/**
 * 「物料类别」这个维度的 key。
 *
 * 这个维度跟别的两个不一样：它**同时是建包 / 编辑包时的类别下拉清单**。
 * 第 3 批之前，建包用的是 `db.ts` 里写死的 `CATEGORIES` 常量（海报 / 视频 / 折页 / 推文配图 / PPT / 其他），
 * 跟左栏这一套只有「海报、折页」是重叠的 —— 用户 2026-09-30 实测发现后拍板：**两套合一**，
 * 建包清单跟着标签走，并且改名 / 删除时反向联动到包上（见下面 updateTag / removeTag）。
 */
const CATEGORY_DIM = 'category'

/**
 * 有多少个包的「物料类别」正是这个标签名。
 *
 * - 只有 `category` 维度参与：渠道 / 状态维度就算撞了同名标签，也跟包的类别无关
 * - 统计**全库**包（含已解绑项目名下的）：那些包界面上隐身，但数据得跟着走，
 *   将来项目重新绑定回来时类别才不会是个面板里找不到的老名字
 */
function countPacksWithCategory(dimension: string, name: string): number {
  if (dimension !== CATEGORY_DIM) return 0
  const db = getDb()
  return (
    db.prepare('SELECT COUNT(*) AS c FROM packs WHERE category = ?').get(name) as { c: number }
  ).c
}

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

/**
 * 列出所有维度及其标签（带「被多少条素材使用」计数）。
 *
 * 计数口径（2026-09-29 用户拍板）：**跟随左栏当前选中的项目范围**，
 * 保证「标签后面的数字」与「点开之后右侧真列出几条」永远一致。
 *   · 不传 scope（= 左栏选「全部」）→ 全库可见素材
 *   · `scope.projectId = 数字`        → 该项目下可见包的素材
 *   · `scope.projectId = null`        → 「待归类」（没挂项目的包）下的素材
 *
 * 无论哪种范围，都**先排掉已解绑项目（archived = 1）的素材** ——
 * 第 7 批做「解绑后软件里全隐身」时漏了这一处，数字会虚高、跟点开结果对不上。
 */
export function listTagDimensions(scope?: { projectId?: number | null }): DimensionGroup[] {
  const db = getDb()
  const out: DimensionGroup[] = []

  const scoped = scope !== undefined && scope.projectId !== undefined
  const pid = scoped ? scope!.projectId! : undefined
  const params: Record<string, unknown> = {}

  const where = [`(${VISIBLE_PACK_SQL})`]
  if (scoped) {
    if (pid === null) {
      // 「待归类」：和界面层 shownPacks 的判定保持一致 —— 没挂项目的包，
      // 外加「project_id 指向已不存在项目」的悬空包（老库可能残留）。
      // k.id IS NOT NULL 是必须的：LEFT JOIN 下散文件（未归属池）的 k.* 全是 NULL，
      // 不加这条会把未归属的散文件也算进「待归类」。
      where.push(
        '(k.id IS NOT NULL AND (k.project_id IS NULL OR k.project_id NOT IN (SELECT id FROM projects)))'
      )
    } else {
      where.push('k.project_id = @scopeProjectId')
      params.scopeProjectId = pid
    }
  }

  const sql = `SELECT t.*, (
                 SELECT COUNT(*) FROM asset_tags at
                   JOIN assets a ON a.id = at.asset_id
                   LEFT JOIN packs k ON k.id = a.pack_id
                  WHERE at.tag_id = t.id AND ${where.join(' AND ')}
               ) AS assetCount
                 FROM tags t
                WHERE t.dimension = @dim
                ORDER BY t.sort_order ASC, t.id ASC`

  for (const dim of TAG_DIMENSIONS) {
    const rows = db.prepare(sql).all({ ...params, dim: dim.key }) as Array<
      TagRow & { assetCount: number }
    >
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
  if (!dim) return { ok: false, error: COPY.tagErr.dimNotFound + input.dimension }
  const name = (input.name ?? '').trim()
  if (!name) return { ok: false, error: COPY.tagErr.nameEmpty }

  const dup = db
    .prepare('SELECT id FROM tags WHERE dimension = ? AND name = ?')
    .get(input.dimension, name) as { id: number } | undefined
  if (dup) return { ok: false, error: fmt(COPY.tagErr.dupInDim, { dim: dim.label }) }

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

/**
 * 改标签（改名 / 改色）。
 *
 * 改名时**「物料类别」维度要连带改包**：`packs.category` 存的是类别**名字**（不是外键），
 * 光改标签名会把已有包留成一个"面板里再也找不到的名字"。用户 2026-09-30 拍板要跟着改。
 * 两件事必须在同一个事务里 —— 改名成功但包没跟上，就是一条查不出来的脏数据。
 */
export function updateTag(
  id: number,
  patch: { name?: string; color?: string }
): { ok: boolean; tag?: TagRow; packsUpdated?: number; error?: string } {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined
  if (!cur) return { ok: false, error: COPY.tagErr.notFound }

  let packsUpdated = 0
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, error: COPY.tagErr.nameEmpty }
    const dup = db
      .prepare('SELECT id FROM tags WHERE dimension = ? AND name = ? AND id <> ?')
      .get(cur.dimension, name, id) as { id: number } | undefined
    if (dup) return { ok: false, error: COPY.tagErr.dupSameDim }

    const tx = db.transaction(() => {
      db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id)
      if (cur.dimension === CATEGORY_DIM && name !== cur.name) {
        packsUpdated = db
          .prepare('UPDATE packs SET category = ?, updated_at = ? WHERE category = ?')
          .run(name, new Date().toISOString(), cur.name).changes
      }
    })
    tx()
  }
  if (patch.color !== undefined) {
    db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(patch.color, id)
  }
  return {
    ok: true,
    tag: db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow,
    packsUpdated
  }
}

/** 标签使用量（删除前提示：「该标签被 320 条素材使用，确认删除？」） */
export function tagUsage(id: number): { assetCount: number; packCount: number } {
  const db = getDb()
  const cur = db.prepare('SELECT dimension, name FROM tags WHERE id = ?').get(id) as
    | { dimension: string; name: string }
    | undefined
  const r = db.prepare('SELECT COUNT(*) AS c FROM asset_tags WHERE tag_id = ?').get(id) as {
    c: number
  }
  return {
    assetCount: r.c,
    // 第 10 批：删「物料类别」前要把用它的包数一并告诉用户 ——
    // 界面上得说清「不只是素材上的标签没了，这些包的类别也会被去掉」
    packCount: cur ? countPacksWithCategory(cur.dimension, cur.name) : 0
  }
}

/**
 * 删标签（连带清掉素材关联；素材文件本身不动）。
 *
 * 第 10 批：删掉的是「物料类别」时，**用它的包类别一并归「未分类」**
 * （用户原话："使用这个标签的包中的这个标签也会被去掉"）。
 * 归「未分类」而不是留个空串：包必须有类别，空串在界面上是个说不清的状态。
 */
export function removeTag(id: number): {
  ok: boolean
  deleted: number
  packsAffected?: number
  error?: string
} {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined
  if (!cur) return { ok: false, deleted: 0, error: COPY.tagErr.notFound }
  const affected = (
    db.prepare('SELECT COUNT(*) AS c FROM asset_tags WHERE tag_id = ?').get(id) as { c: number }
  ).c

  let packsAffected = 0
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM asset_tags WHERE tag_id = ?').run(id)
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)
    if (cur.dimension === CATEGORY_DIM) {
      packsAffected = db
        .prepare('UPDATE packs SET category = ?, updated_at = ? WHERE category = ?')
        .run(UNCATEGORIZED, new Date().toISOString(), cur.name).changes
    }
  })
  tx()
  return { ok: true, deleted: affected, packsAffected }
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
