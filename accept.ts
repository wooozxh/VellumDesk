/**
 * 第 1 批验收脚本 —— 按 docs/03-MVP入库功能方案.md 5.3 节主线，用真实文件跑一遍。
 * 调用的是 main 侧同一套业务函数（workspace.ts / db.ts），验证逻辑与界面一致。
 */
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  copyFileSync
} from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import {
  initWorkspace,
  createPack,
  scanAll,
  listPacks,
  getPackDetail,
  claimFiles,
  countUnassigned,
  listProjectsWithCount,
  createProject,
  updateProject,
  removeProject,
  moveProject,
  SUB_FOLDERS,
  UNASSIGNED_ROLE,
  listAssets,
  // 第 4 批：工作区择址兜底
  resolveWorkspace,
  isUsableWorkspace,
  getWorkspaceState,
  resetWorkspaceState,
  saveWorkspaceRoot,
  DEFAULT_WORKSPACE,
  FALLBACK_FOLDER_NAME,
  // 第 5 批：工作区管理与迁移
  readWorkspaceConfig,
  listWorkspaces,
  inspectWorkspaceDir,
  addWorkspace,
  switchWorkspace,
  removeWorkspace,
  rewritePaths,
  migrateWorkspaceSameDisk,
  isSameVolume,
  // 第 6 批：三级目录结构
  ensureLayoutV3,
  syncProjectFolders,
  ensureFolderNames,
  readLayoutNotice,
  ackLayoutNotice,
  UNBOUND_DIR,
  TRASH_DIR,
  LAYOUT_VERSION,
  // 第 7 批：记录生命周期
  updatePack,
  unbindProject,
  restoreProject,
  listUnboundProjects,
  cleanupMissingPacks,
  // 第 8 批：文件已丢失标记
  markMissingAssets,
  relocateAsset,
  suggestRelocateBatch,
  applyRelocateBatch,
  // 第 9 批：版本管理（M6）
  createVersion,
  listVersions,
  listBindableFolders,
  bindVersion,
  unbindVersion,
  setCurrentVersion,
  listVersionMap,
  ensureCurrentVersion,
  // 第 9 批补：新建包自带的第一稿文件夹名
  FIRST_VERSION_FOLDER
} from './src/main/workspace'
// 第 15 批：交付打包（M5，docs/18）
import { buildPackExportPlan, executePackExport, listDeliveryRecords } from './src/main/exportPack'
import {
  applySync,
  detectStructure,
  confirmPendingTickets,
  createTaskForTicketManually,
  takeLink,
  META_KEYS,
  writeTicketSheets,
  // 第 17 批：设计师指派（docs/19）
  allowAssignEnabled,
  designerColName,
  designerColUsable,
  evaluateDesignerCol,
  executeAssignDesigners,
  listDesignerCandidates,
  retryPendingDesignerWrites,
  setAllowAssignEnabled,
  unassignedTicketCount,
  // 第 19 批：导出报表 + 完成任务（docs/22）
  completeTicketTask,
  readTicketMetrics,
  thumbColName,
  writeTicketMetrics,
  type DesignerWriteAdapter,
  type SheetPayload,
  type TicketRawRecord,
  type TicketSheetConfig
} from './src/main/tickets'
// 第 19 批：导出报表（docs/22）
import {
  buildReportRows,
  exportReport,
  reportSheetTitle,
  REPORT_FIELD,
  type ReportAdapter,
  type ReportRow
} from './src/main/report'
import type { ReportField } from './src/main/reportWecom'
import {
  ensureThumbsForAssets,
  ensureImageMetaForAssets,
  ensureVideoMetaForAssets,
  ensurePsdMetaForAssets,
  ensurePdfMetaForAssets,
  extractPsdPreviewJpg,
  setFfmpegDir,
  ffmpegReady
} from './src/main/thumbs'
import { getDb, closeDb, openDb, getMeta, setMeta } from './src/main/db'
import {
  listTagDimensions,
  createTag,
  updateTag,
  tagUsage,
  removeTag,
  applyTags,
  removeTagsFrom,
  tagsOfAssets,
  suggestTagsForAssets,
  type DimensionGroup
} from './src/main/tags'

/** 每次跑用一个全新的工作区目录，避免上一次的残留污染结果 */
const RUN_ID = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const WS = `D:\\_accept_ws\\run_${RUN_ID}`
const lines: string[] = []
let failed = 0

function log(s = ''): void {
  lines.push(s)
  console.log(s)
}

function ok(cond: boolean, label: string): boolean {
  log(`${cond ? '  [OK]  ' : '  [FAIL]'} ${label}`)
  if (!cond) failed += 1
  return cond
}

/**
 * 强制删除（不走系统回收站）。
 * 某些沙箱环境会把 fs 的删除劫持成"移动到回收站"，而回收站在沙箱里会失败。
 * 验收脚本要的是彻底清空，所以直接调 Node 原生 fs 绑定。
 */
function hardRm(p: string): void {
  if (!existsSync(p)) return
  const rawFs = require('node:fs') as typeof import('fs')
  const st = rawFs.lstatSync(p, { throwIfNoEntry: false })
  if (!st) return
  if (st.isDirectory()) {
    for (const e of rawFs.readdirSync(p)) hardRm(join(p, e))
    try {
      rawFs.rmdirSync(p)
    } catch {
      /* 忽略：可能已被上层清掉 */
    }
  } else {
    try {
      rawFs.unlinkSync(p)
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * 【老结构建包】
 *
 * 第 9 批起 `createPack` 会自动带上第一稿 V1（磁盘结构 `包\V1\01-成品`）。
 * 但用户库里跑着的老包全是"包根直接是三组"的老结构（`version_id` 全空、
 * 界面归「未分版本」），第 1~8 批断言考的正是这条**兼容路径** ——
 * 不能因为改了建包行为就把它们一起改掉，那等于把老包的覆盖面偷偷丢掉。
 *
 * 所以这里包一层：建完包把自带的 V1 抹掉（记录 + 文件夹），补回包根三组，
 * 得到一个与第 9 批之前**完全一样**的包。要考"新建包自带 V1"请直接用 createPack。
 */
function mkPack(input: {
  name?: string
  projectId?: number | null
  category?: string
  workspaceRoot: string
}): ReturnType<typeof createPack> {
  const p = createPack(input)
  const db = getDb()
  const vs = db
    .prepare('SELECT id, folder_name FROM pack_versions WHERE pack_id = ?')
    .all(p.id) as Array<{ id: number; folder_name: string }>
  db.prepare('DELETE FROM pack_versions WHERE pack_id = ?').run(p.id)
  db.prepare('DELETE FROM pack_version_ignores WHERE pack_id = ?').run(p.id)
  // 自带的 V1 是空文件夹（包刚建好、一个文件都没有），直接摘掉不影响任何记录
  for (const v of vs) hardRm(join(p.folder_path, v.folder_name))
  for (const sub of SUB_FOLDERS) mkdirSync(join(p.folder_path, sub), { recursive: true })
  return p
}

function makePng(path: string, w = 8, h = 8, rgb: [number, number, number] = [80, 140, 255]): void {
  const zlib = require('zlib') as typeof import('zlib')
  const raw = Buffer.alloc((w * 3 + 1) * h)
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0
    for (let x = 0; x < w; x++) {
      raw[o++] = (rgb[0] + x * 8) % 256
      raw[o++] = (rgb[1] + y * 8) % 256
      raw[o++] = rgb[2]
    }
  }
  const idat = zlib.deflateSync(raw)

  const crcTable: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const t = Buffer.from(type, 'ascii')
    const body = Buffer.concat([t, data])
    const cc = Buffer.alloc(4)
    cc.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, cc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
  writeFileSync(path, png)
}

/** 手工造最小合法 PDF（不引库）：pages 页，每页画一个灰度随页数变化的矩形 */
function makePdf(path: string, pages = 1): void {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ')
  const objs: string[] = []
  const count = pages * 2 + 2
  for (let i = 0; i < pages; i++) {
    const contentObj = 4 + i * 2
    const pageObj = 3 + i * 2
    const shade = (0.2 + (i % 5) * 0.15).toFixed(2)
    const content = `q ${shade} ${shade} 1 rg 0 0 595 842 re f Q`
    objs[contentObj] =
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    objs[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R /Resources << >> >>`
  }
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`

  let pdf = '%PDF-1.4\n'
  const offs: number[] = []
  for (let i = 1; i <= count; i++) {
    if (!objs[i]) continue
    offs[i] = Buffer.byteLength(pdf, 'latin1')
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${count + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= count; i++) {
    pdf += (offs[i] ?? 0) !== 0 ? `${String(offs[i]).padStart(10, '0')} 00000 n \n` : `0000000000 00000 f \n`
  }
  pdf += `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  writeFileSync(path, Buffer.from(pdf, 'latin1'))
}

async function main(): Promise<void> {
  // ============ 起点：干净工作区 ============
  log('='.repeat(62))
  log('第 1 批验收：素材入库主线')
  log('='.repeat(62))
  hardRm(WS)
  log(`\n[准备] 清空并重建工作区 ${WS}`)

  // A-02 工作区初始化
  initWorkspace(WS)
  ok(existsSync(WS), 'A-02 工作区根目录已创建')
  ok(existsSync(join(WS, '_thumbs')), 'A-02 缩略图目录 _thumbs 已创建')
  ok(existsSync(join(WS, '_system', 'media.db')), 'A-02 数据库 _system/media.db 已创建')

  // ============ 项目：预制 + 自建 ============
  log('\n[0] 项目管理：预制项目 + 用户自建')
  const preset = listProjectsWithCount()
  ok(preset.length === 6, `首次使用自动落 6 个预制项目（实际 ${preset.length}）`)
  ok(
    preset.some((p) => p.name === '海南升学集训营') &&
      preset.some((p) => p.name === '精英升学先修营') &&
      preset.some((p) => p.name === '精英志愿填报中心') &&
      preset.some((p) => p.name === '一对一项目部') &&
      preset.some((p) => p.name === '精英岛') &&
      preset.some((p) => p.name === '总部'),
    `预制项目名称正确（第 14 批换成本厂清单）：${preset.map((p) => p.name).join(' / ')}`
  )
  ok(preset.every((p) => /^#[0-9a-f]{6}$/i.test(p.color)), '每个项目都分到了颜色')
  ok(
    preset.every((p) => p.note.length > 0),
    `每个预制项目都带备注：${preset.map((p) => p.note).join(' / ')}`
  )

  const projPlan = preset.find((p) => p.name === '海南升学集训营')!

  // 用户自建项目（模拟"公司开了新业务"）
  const created = createProject({ name: '抖音短视频运营', color: '#e86fa8', note: '短视频号内容' })
  ok(created.ok && !!created.project, `自建项目成功：${created.project?.name}`)
  ok(created.project?.color === '#e86fa8', `自选颜色已保存：${created.project?.color}`)
  const newProjId = created.project!.id

  // 重名拦截
  const dup = createProject({ name: '抖音短视频运营' })
  ok(!dup.ok, `重名项目被拦截：${dup.error}`)

  // 空名拦截
  const emptyName = createProject({ name: '   ' })
  ok(!emptyName.ok, `空名项目被拦截：${emptyName.error}`)

  // 改名 / 换色
  const upd = updateProject(newProjId, { name: '抖音短视频（新）', color: '#2bb5b5' })
  ok(upd.ok && upd.project?.name === '抖音短视频（新）', `项目改名成功：${upd.project?.name}`)
  ok(upd.project?.color === '#2bb5b5', `项目改色成功：${upd.project?.color}`)

  // ============ A-01 建包 ============
  log('\n[1] A-01 新建任务包')
  const p1 = mkPack({
    name: '海南招生海报-2026秋季',
    projectId: projPlan.id,
    category: '海报',
    workspaceRoot: WS
  })
  ok(p1.id > 0, `建包成功：id=${p1.id} name=${p1.name}`)
  ok(p1.project_id === projPlan.id, `包已关联到项目 id=${projPlan.id}（海南升学集训营）`)
  // 第 6 批：三级结构 —— 包文件夹不再直接躺在工作区根下，而是在**项目文件夹**里
  ok(
    p1.folder_path === join(WS, projPlan.folder_name, '海南招生海报-2026秋季'),
    `【第 6 批】包建在项目文件夹下：…\\${projPlan.folder_name}\\海南招生海报-2026秋季`
  )
  ok(existsSync(p1.folder_path), '包文件夹已在硬盘上创建')
  for (const sub of SUB_FOLDERS) {
    ok(existsSync(join(p1.folder_path, sub)), `自动创建子文件夹 ${sub}`)
  }

  // 名称留空的兜底
  const p2 = mkPack({ name: '   ', projectId: newProjId, category: '其他', workspaceRoot: WS })
  ok(p2.name.startsWith('未命名任务-'), `A-01 名称为空 → 自动兜底取名：${p2.name}`)
  ok(p2.project_id === newProjId, '包归属为自建项目')

  // 重名自动加后缀
  const p3 = mkPack({
    name: '海南招生海报-2026秋季',
    projectId: projPlan.id,
    category: '海报',
    workspaceRoot: WS
  })
  ok(p3.folder_path !== p1.folder_path, `A-01 重名不覆盖，自动区分：${p3.folder_path.replace(WS, '')}`)

  // 不传项目 → 落到默认（排序第一个）
  const pDefault = mkPack({ name: '默认归属测试', category: '其他', workspaceRoot: WS })
  ok(pDefault.project_id !== null, `不传项目时自动落到默认项目 id=${pDefault.project_id}`)

  // ============ 丢文件 ============
  log('\n[2] 往三个子文件夹里丢文件（模拟同事操作）')
  const pk = p1.folder_path
  mkdirSync(join(pk, '01-成品'), { recursive: true })
  mkdirSync(join(pk, '02-素材'), { recursive: true })
  mkdirSync(join(pk, '03-工程'), { recursive: true })
  mkdirSync(join(pk, '04-乱建的'), { recursive: true })

  makePng(join(pk, '01-成品', '招生海报-横版.png'), 240, 160, [230, 60, 60])
  makePng(join(pk, '01-成品', '招生海报-竖版.png'), 160, 240, [60, 200, 120])
  makePng(join(pk, '02-素材', '背景-蓝色.png'), 120, 120, [60, 120, 240])
  writeFileSync(join(pk, '02-素材', '字体说明.txt'), '思源黑体 CN Bold，商用授权见附件。')
  writeFileSync(join(pk, '03-工程', '海报源文件.psd'), Buffer.alloc(4096, 7))
  writeFileSync(join(pk, '03-工程', '分层图.psd'), Buffer.alloc(2048, 3))
  // 直接丢在包根目录 → 包内“未归属的文件”
  writeFileSync(join(pk, '随手丢的参考图.png'), Buffer.alloc(512, 1))
  // 丢进一个软件不认识的子文件夹 → 兜底未归属，不报错
  writeFileSync(join(pk, '04-乱建的', '乱丢的东西.txt'), 'x')

  // 工作区根目录的散文件 → 全局“未归属池”
  makePng(join(WS, '不知道谁的图.png'), 100, 100, [240, 200, 40])
  writeFileSync(join(WS, '临时笔记.txt'), '这是同事随手丢在工作区根目录的文件。')

  const fileCount = (dir: string): number => {
    let n = 0
    for (const e of readdirSync(dir)) {
      const f = join(dir, e)
      if (statSync(f).isDirectory()) n += fileCount(f)
      else n += 1
    }
    return n
  }
  log(`     已放置 ${fileCount(pk)} 个文件进包，「未归属池」放 2 个`)

  // ============ A-03 + A-04 扫描归位 ============
  log('\n[3] A-03/A-04 刷新扫描 → 自动归位')
  const s1 = scanAll(WS)
  ok(s1.files > 0, `扫描登记 ${s1.files} 个文件`)
  ok(
    s1.unassigned === 4,
    `未归属计数正确（包根 1 + 包内未知子文件夹 1 + 工作区根 2 = 4），实际 ${s1.unassigned}`
  )

  const db = getDb()
  const byRole = (role: string): number =>
    (db.prepare('SELECT COUNT(*) AS c FROM assets WHERE role = ?').get(role) as { c: number }).c
  ok(byRole('成品') === 2, `A-03 「01-成品」里 2 个文件归入成品`)
  ok(byRole('素材') === 2, `A-03 「02-素材」里 2 个文件归入素材`)
  ok(byRole('工程') === 2, `A-03 「03-工程」里 2 个文件归入工程`)
  ok(byRole(UNASSIGNED_ROLE) === 4, `A-03 未归属 4 个`)

  // 关键：归类按文件夹不按后缀 —— 把 .psd 丢进成品也按成品算
  const psdInFinished = join(pk, '01-成品', '其实是参考的图.psd')
  writeFileSync(psdInFinished, Buffer.alloc(256, 9))
  scanAll(WS)
  const psdRole = db.prepare('SELECT role FROM assets WHERE abs_path = ?').get(psdInFinished) as
    | { role: string }
    | undefined
  ok(psdRole?.role === '成品', 'A-03 关键规则：.psd 丢进 01-成品 仍按「成品」归类（不猜后缀）')

  // A-04 基础信息
  const one = db
    .prepare('SELECT * FROM assets WHERE file_name = ?')
    .get('招生海报-横版.png') as {
    file_name: string
    ext: string
    size: number
    abs_path: string
    rel_path: string
    created_at: string
    modified_at: string
    role: string
  }
  ok(one.size > 0, `A-04 体积已采集：${one.size} 字节`)
  ok(one.ext === 'png', `A-04 扩展名已采集：${one.ext}`)
  ok(!!one.created_at && !!one.modified_at, 'A-04 创建/修改时间已采集')
  ok(one.rel_path.includes('01-成品'), `A-04 相对路径已采集：${one.rel_path}`)

  // ============ A-05 缩略图 ============
  log('\n[4] A-05 图片缩略图（sharp）')
  const rows = db
    .prepare('SELECT id, abs_path, size, ext, thumb_path, modified_at FROM assets')
    .all() as Array<{
    id: number
    abs_path: string
    size: number
    ext: string
    thumb_path: string | null
    modified_at: string
  }>
  // 第 14 批：并发化之后，进度回调仍要逐条、单调上报（界面顶栏就靠它显示"缩略图 37/214"）
  const thumbProgress: Array<{ done: number; total: number }> = []
  const n = await ensureThumbsForAssets(WS, rows, (done, total) => thumbProgress.push({ done, total }))
  ok(n >= 4, `生成 / 复用 ${n} 张缩略图`)
  ok(
    thumbProgress.length > 0,
    `【第 14 批】缩略图批次进度回调 ${thumbProgress.length} 次（每条处理完报一次）`
  )
  ok(
    thumbProgress.every((e, i) => i === 0 || e.done >= thumbProgress[i - 1].done),
    '【第 14 批】进度 done 单调不减（并发跑也不会倒退）'
  )
  ok(
    thumbProgress.length > 0 && thumbProgress[thumbProgress.length - 1].done === thumbProgress.length,
    `【第 14 批】最后一推 done=${thumbProgress[thumbProgress.length - 1]?.done}（= 已处理条数 ${thumbProgress.length}）`
  )
  ok(
    thumbProgress.every((e) => e.total === thumbProgress[0]?.total),
    `【第 14 批】进度总数全程固定 total=${thumbProgress[0]?.total}（= 本轮待处理条数）`
  )
  const thumbed = db
    .prepare("SELECT COUNT(*) AS c FROM assets WHERE thumb_path IS NOT NULL")
    .get() as { c: number }
  ok(thumbed.c >= 4, `数据库中 ${thumbed.c} 条记录已挂上缩略图`)
  const anyThumb = db
    .prepare("SELECT thumb_path FROM assets WHERE thumb_path IS NOT NULL LIMIT 1")
    .get() as { thumb_path: string }
  ok(
    existsSync(join(WS, anyThumb.thumb_path)),
    `缩略图文件实际落盘：${anyThumb.thumb_path}`
  )

  // ============ A-06 包视图 ============
  log('\n[5] A-06 包视图：包卡片 + 条数 + 总容量')
  const packs = listPacks()
  ok(packs.length === 4, `包视图共 ${packs.length} 个包（4 个）`)
  const card = packs.find((p) => p.id === p1.id)!
  // 此时包内：3 成品（2 png + 1 psd）+ 2 素材 + 2 工程 + 2 未归属 = 9
  ok(card.fileCount === 9, `包卡片条数正确：${card.fileCount} 个文件`)
  ok(card.totalSize > 0, `包卡片总容量正确：${card.totalSize} 字节`)
  ok(!!card.coverPath, `包卡片取到封面（第一个成品的缩略图）：${card.coverPath}`)
  ok(
    !!card.coverPath && existsSync(join(WS, card.coverPath)),
    '封面文件在硬盘上真实存在（界面拿它转 dataURL）'
  )
  ok(card.projectName === '海南升学集训营', `包卡片带出项目名：${card.projectName}`)
  ok(!!card.projectColor, `包卡片带出项目配色：${card.projectColor}`)

  // ============ A-08 点开包 → 三组 ============
  log('\n[6] A-08 点开包 → 成品 / 素材 / 工程 三组')
  const d = getPackDetail(p1.id)
  ok(d.groups['成品'].length === 3, `成品组 ${d.groups['成品'].length} 个（含丢进去的 .psd）`)
  ok(d.groups['素材'].length === 2, `素材组 ${d.groups['素材'].length} 个`)
  ok(d.groups['工程'].length === 2, `工程组 ${d.groups['工程'].length} 个`)
  ok(d.groups['未归属'].length === 2, `包内「未归属的文件」${d.groups['未归属'].length} 个`)

  // ============ A-09 一键认领 ============
  log('\n[7] A-09 未归属池 → 一键认领进包')
  const unassignedBefore = countUnassigned()
  ok(unassignedBefore === 4, `认领前未归属池 ${unassignedBefore} 个`)
  const unassignedFiles = db
    .prepare('SELECT abs_path FROM assets WHERE role = ?')
    .all(UNASSIGNED_ROLE) as Array<{ abs_path: string }>

  const res = claimFiles(
    WS,
    unassignedFiles.map((u) => u.abs_path),
    p1.id,
    '02-素材'
  )
  ok(res.moved === 4, `认领移动 ${res.moved} 个文件（0 失败：${res.errors.length}）`)
  ok(countUnassigned() === 0, `认领后未归属池清空（${countUnassigned()} 个）`)
  // 认领后的实际落点
  ok(
    existsSync(join(pk, '02-素材', '不知道谁的图.png')),
    '根目录散落图片已搬进 包/02-素材/'
  )
  ok(
    existsSync(join(pk, '02-素材', '随手丢的参考图.png')),
    '包根目录的散文件已搬进 包/02-素材/'
  )
  const d2 = getPackDetail(p1.id)
  ok(d2.groups['素材'].length === 6, `认领后素材组变 ${d2.groups['素材'].length} 个`)
  ok(d2.groups['未归属'].length === 0, '认领后包内「未归属的文件」归零')

  // ============ 铁则：软件不悄悄扔东西 ============
  log('\n[8] 铁则校验：软件永不悄悄扔掉用户放的东西')
  // 注意：只数「用户放的文件」，_thumbs / _system 是软件自己的目录，不登记也不该计入
  const userFileCount = (dir: string): number => {
    let n = 0
    for (const e of readdirSync(dir)) {
      if (e.startsWith('_') || e.startsWith('.')) continue
      const f = join(dir, e)
      if (statSync(f).isDirectory()) n += userFileCount(f)
      else n += 1
    }
    return n
  }
  const totalOnDisk = userFileCount(WS)
  const totalInDb = (db.prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c
  ok(totalOnDisk === totalInDb, `用户文件数 ${totalOnDisk} = 数据库记录数 ${totalInDb}（一条不多一条不少）`)

  // 手动删掉一个文件后再扫，应只摘索引、不报错、不影响别的文件
  const victim = join(pk, '03-工程', '分层图.psd')
  hardRm(victim)
  const s3 = scanAll(WS)
  const stillThere = db
    .prepare('SELECT COUNT(*) AS c FROM assets WHERE file_name = ?')
    .get('分层图.psd') as { c: number }
  // 第 8 批 M8-03 推翻第 1 批的写法：需求文档要的是「标记为文件已丢失 + 提供重新定位」，
  // 原来的"直接从索引摘除"会让记录连同标签关联一起消失，用户根本不知道文件丢了。
  const missingRow = db
    .prepare('SELECT id, missing_at FROM assets WHERE file_name = ?')
    .get('分层图.psd') as { id: number; missing_at: string | null } | undefined
  ok(stillThere.c === 1, '手动删除的文件，记录仍在（不再从索引摘除）')
  ok(!!missingRow && missingRow.missing_at !== null, '并且被打上「文件已丢失」标记')
  ok(s3.markedMissing === 1, `本轮扫描标记了 ${s3.markedMissing} 条丢失`)
  ok(s3.files >= 0, `重新扫描不报错（${s3.files} 个文件）`)

  // ============ A-11 准备（路径有效性） ============
  log('\n[9] A-11 双击打开：文件路径有效性')
  const sample = db
    .prepare("SELECT abs_path FROM assets WHERE ext = 'png' LIMIT 1")
    .get() as { abs_path: string }
  ok(existsSync(sample.abs_path), `待打开文件真实存在：${sample.abs_path.replace(WS, '…')}`)

  // ============ 项目排序：上移 / 下移 ============
  log('\n[9.5] 项目排序：上移 / 下移一位')

  const namesOf = (): string[] => listProjectsWithCount().map((p) => p.name)

  // 保证至少 3 个项目再做排序测试
  while (listProjectsWithCount().length < 3) {
    const r = createProject({ name: `排序测试项目${listProjectsWithCount().length + 1}` })
    if (!r.ok) break
  }

  const orderStart = namesOf()
  ok(orderStart.length >= 3, `排序前顺序：${orderStart.join(' → ')}`)

  // 把第 3 个往上挪一位，应与第 2 个互换
  const third = listProjectsWithCount()[2]
  const secondName = orderStart[1]
  const upRes = moveProject(third.id, 'up')
  ok(upRes.ok && upRes.moved, `「${third.name}」上移成功`)
  const orderAfterUp = namesOf()
  ok(
    orderAfterUp[1] === third.name && orderAfterUp[2] === secondName,
    `上移一位后与相邻项互换：${orderAfterUp.join(' → ')}`
  )
  ok(
    orderAfterUp.length === orderStart.length &&
      [...orderAfterUp].sort().join('|') === [...orderStart].sort().join('|'),
    '上移只改顺序，不增不减任何项目'
  )

  // 再下移回来，应回到初始顺序
  const downRes = moveProject(third.id, 'down')
  ok(downRes.ok && downRes.moved, `「${third.name}」下移成功`)
  ok(namesOf().join('|') === orderStart.join('|'), '下移回来后顺序与初始完全一致（可逆）')

  // 边界：第一个再上移 → 不动，且不报错
  const first = listProjectsWithCount()[0]
  const edgeTop = moveProject(first.id, 'up')
  ok(edgeTop.ok && !edgeTop.moved, '首位项目再上移：静默不动，不报错')
  ok(namesOf().join('|') === orderStart.join('|'), '边界上移没有打乱顺序')

  // 边界：最后一个再下移 → 不动
  const allNow = listProjectsWithCount()
  const last = allNow[allNow.length - 1]
  const edgeBottom = moveProject(last.id, 'down')
  ok(edgeBottom.ok && !edgeBottom.moved, '末位项目再下移：静默不动，不报错')
  ok(namesOf().join('|') === orderStart.join('|'), '边界下移没有打乱顺序')

  // 不存在的项目
  const ghost = moveProject(999999, 'up')
  ok(!ghost.ok, `对不存在的项目排序被拒：${ghost.error}`)

  // 排序结果要能持久化（重新读一遍库）
  const third2 = listProjectsWithCount()[1]
  moveProject(third2.id, 'up')
  ok(
    listProjectsWithCount()[0].id === third2.id,
    `排序结果持久化：重新查询后「${third2.name}」仍在首位`
  )
  moveProject(third2.id, 'down')

  // ============ 项目删除：绝不让包跟着消失 ============
  log('\n[10] 删项目铁则：包和文件一个都不能少')

  // 场景 A：项目下有包 → 转移到另一个项目
  const beforeFiles = userFileCount(WS)
  const beforePacks = (db.prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c
  const projWithPacks = listProjectsWithCount().find((p) => p.name === '海南升学集训营')!
  ok(projWithPacks.packCount > 0, `待删项目「${projWithPacks.name}」下有 ${projWithPacks.packCount} 个包`)
  const targetProj = listProjectsWithCount().find((p) => p.id !== projWithPacks.id)!

  const delA = removeProject(projWithPacks.id, { moveTo: targetProj.id })
  ok(delA.ok, `删除成功，${delA.moved} 个包已转移 → ${targetProj.name}`)
  ok(
    (db.prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c === beforePacks,
    `包数量不变（${beforePacks} 个）—— 没有包被连带删除`
  )
  ok(
    userFileCount(WS) === beforeFiles,
    `磁盘文件数不变（${beforeFiles} 个）—— 没有任何文件丢失`
  )
  ok(
    (db.prepare('SELECT COUNT(*) AS c FROM packs WHERE project_id = ?').get(targetProj.id) as { c: number })
      .c >= delA.moved,
    `转移后的包确实挂到了目标项目下`
  )
  ok(
    listProjectsWithCount().every((p) => p.id !== projWithPacks.id),
    '被删项目已从项目列表消失'
  )

  // 场景 B：项目下有包 → 变成未归属
  const proj2 = listProjectsWithCount().find((p) => p.name === '抖音短视频（新）')!
  const packsBeforeB = (db.prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c
  const delB = removeProject(proj2.id, { moveTo: null })
  ok(delB.ok, `删除成功，${delB.moved} 个包变为未归属`)
  ok(
    (db.prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c === packsBeforeB,
    '包数量依然不变'
  )
  ok(
    userFileCount(WS) === beforeFiles,
    '磁盘文件数依然不变 —— 包变未归属但文件都在'
  )
  const orphanPacks = listPacks().filter((p) => p.project_id === null)
  ok(orphanPacks.length >= delB.moved, `${orphanPacks.length} 个包现在没有项目归属（project_id 为空）`)

  // 场景 C：不能删最后一个项目
  let remaining = listProjectsWithCount()
  while (remaining.length > 1) {
    const r = removeProject(remaining[0].id, { moveTo: null })
    if (!r.ok) break
    remaining = listProjectsWithCount()
  }
  const lastDel = removeProject(remaining[0].id, { moveTo: null })
  ok(!lastDel.ok, `拒绝删除最后一个项目：${lastDel.error}`)

  // ============ 启动迁移：老库（project 文本列）能平滑升级 ============
  log('\n[11] 老库迁移：已有 project 文本列的库能自动升级')
  const legacyProjects = listProjectsWithCount()
  ok(legacyProjects.length >= 1, `迁移后仍有项目：${legacyProjects.map((p) => p.name).join(' / ')}`)
  const allPacksHaveOwner = listPacks().every(
    (p) => p.project_id === null || legacyProjects.some((x) => x.id === p.project_id)
  )
  ok(allPacksHaveOwner, '所有包的 project_id 都能对应到一个真实项目（无悬空引用）')

  // ============ 第 2 批 B-01：图片尺寸与色彩模式 ============
  log('\n[12] 第 2 批 B-01：图片尺寸 / 色彩模式采集')

  // 12.1 迁移：6 个新列齐备
  const cols = (getDb().prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>).map(
    (c) => c.name
  )
  const needCols = ['width', 'height', 'color_mode', 'duration_ms', 'video_codec', 'probe_info']
  for (const c of needCols) {
    ok(cols.includes(c), `assets 表已有列 ${c}`)
  }

  // 12.2 造一张已知尺寸的图，扫描后元信息应一致
  const knownW = 137
  const knownH = 89
  const metaPack = mkPack({ name: '元信息测试包', workspaceRoot: WS })
  const metaImg = join(metaPack.folder_path, '01-成品', 'KnownSize.png')
  makePng(metaImg, knownW, knownH, [10, 200, 90])

  scanAll(WS)
  const metaRows = getDb()
    .prepare('SELECT id, abs_path, ext, width FROM assets')
    .all() as Array<{ id: number; abs_path: string; ext: string; width: number | null }>
  const written = await ensureImageMetaForAssets(metaRows)

  const got = getDb()
    .prepare('SELECT width, height, color_mode FROM assets WHERE file_name = ?')
    .get('KnownSize.png') as { width: number; height: number; color_mode: string } | undefined
  ok(!!got, '已知尺寸图已登记进库')
  ok(written >= 1, `本次补齐了 ${written} 个图片的元信息`)
  ok(got?.width === knownW, `宽度正确：${got?.width}（造的是 ${knownW}）`)
  ok(got?.height === knownH, `高度正确：${got?.height}（造的是 ${knownH}）`)
  ok(
    got?.color_mode === 'RGB' || got?.color_mode === 'RGBA',
    `色彩模式识别为 ${got?.color_mode}（造的是 24 位真彩 PNG → 应为 RGB）`
  )

  // 12.3 再次跑不应重复处理（幂等）
  const again = await ensureImageMetaForAssets(
    getDb().prepare('SELECT id, abs_path, ext, width FROM assets').all() as Array<{
      id: number
      abs_path: string
      ext: string
      width: number | null
    }>
  )
  ok(again === 0, `第二次运行处理 0 个（幂等，不重复算）：实际 ${again}`)

  // 12.4 降级：损坏的图片不阻断入库，元信息为 null
  const brokenPath = join(metaPack.folder_path, '02-素材', 'Broken.png')
  writeFileSync(brokenPath, Buffer.from('这不是一张真 PNG'))
  scanAll(WS)
  const brokenRow = getDb()
    .prepare('SELECT id, width, height FROM assets WHERE file_name = ?')
    .get('Broken.png') as { id: number; width: number | null; height: number | null } | undefined
  ok(!!brokenRow, '损坏文件依然被登记进库（不丢弃用户文件）')
  ok(brokenRow?.width === null, '损坏文件的 width 为 null（读不出但没崩）')
  const stillCount = (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c
  ok(stillCount > 0, `坏文件未影响其他记录（库里共 ${stillCount} 条）`)

  // 12.5 非图片文件不该被赋元信息
  const txtPath = join(metaPack.folder_path, '03-工程', 'readme.txt')
  writeFileSync(txtPath, 'hello')
  scanAll(WS)
  await ensureImageMetaForAssets(
    getDb().prepare('SELECT id, abs_path, ext, width FROM assets').all() as Array<{
      id: number
      abs_path: string
      ext: string
      width: number | null
    }>
  )
  const txtRow = getDb()
    .prepare('SELECT width, color_mode FROM assets WHERE file_name = ?')
    .get('readme.txt') as { width: number | null; color_mode: string | null } | undefined
  ok(txtRow?.width === null && txtRow?.color_mode === null, 'txt 文件不被赋图片元信息')

  // 12.6 老库迁移：手工造一个没有新列的 assets 表，重开后应自动补齐
  const legacyWs = `D:\\_accept_ws\\legacy_${RUN_ID}`
  mkdirSync(join(legacyWs, '_system'), { recursive: true })
  {
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const raw = new Database(join(legacyWs, '_system', 'media.db'))
    raw.exec(`
      CREATE TABLE packs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        project_id INTEGER, category TEXT NOT NULL DEFAULT '未分类',
        folder_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#4f8cff', note TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL);
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id INTEGER, role TEXT NOT NULL DEFAULT '未归属',
        file_name TEXT NOT NULL, ext TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
        abs_path TEXT NOT NULL UNIQUE, rel_path TEXT NOT NULL DEFAULT '', thumb_path TEXT,
        created_at TEXT NOT NULL, modified_at TEXT NOT NULL, scanned_at TEXT NOT NULL);
      INSERT INTO assets (pack_id, role, file_name, ext, size, abs_path, rel_path, created_at, modified_at, scanned_at)
        VALUES (NULL, '未归属', '老记录.png', 'png', 100, '${legacyWs.replace(/\\/g, '\\\\')}\\\\老记录.png', '老记录.png', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `)
    raw.close()
  }
  closeDb()
  initWorkspace(legacyWs)
  const legacyCols = (
    getDb().prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>
  ).map((c) => c.name)
  ok(
    needCols.every((c) => legacyCols.includes(c)),
    '老库（无新列）打开后自动补齐 6 个新列'
  )
  const legacyKept = getDb()
    .prepare('SELECT COUNT(*) AS c FROM assets')
    .get() as { c: number }
  ok(legacyKept.c === 1, `老库已有记录未丢失（${legacyKept.c} 条）`)
  closeDb()

  // 回到主工作区继续
  initWorkspace(WS)

  // ============ 第 2 批 B-02：视频信息与视频缩略图 ============
  log('\n[13] 第 2 批 B-02：FFmpeg 视频探测 / 抽帧')

  // FFmpeg 就位检测（resources/ffmpeg；没就位则视频功能应整体降级而不是崩）
  const projFfDir = 'D:\\proj_media\\resources\\ffmpeg'
  setFfmpegDir(existsSync(join(projFfDir, 'ffmpeg.exe')) ? projFfDir : '')
  log(`  （FFmpeg 就位：${ffmpegReady() ? '是' : '否 —— 本轮跑降级断言'}）`)

  // 13.1 无 FFmpeg 时：批量补视频信息应返回 0 且不报错
  if (!ffmpegReady()) {
    const vRows = getDb()
      .prepare('SELECT id, abs_path, ext, duration_ms FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; duration_ms: number | null }>
    const vRet = await ensureVideoMetaForAssets(vRows)
    ok(vRet === 0, `无 FFmpeg 时视频补齐返回 0（降级不崩）：实际 ${vRet}`)
  }

  // 13.2 有 FFmpeg 时：造 2 秒 320x240 测试视频（ffmpeg 自己生成，格式绝对正确）
  const videoPack = mkPack({ name: '视频测试包', workspaceRoot: WS })
  const vidPath = join(videoPack.folder_path, '01-成品', 'demo.mp4')
  let videoMade = false
  if (ffmpegReady()) {
    // 用异步 spawn（沙箱环境拦 spawnSync，见 PROGRESS.md 已知问题）
    const { spawn } = require('child_process') as typeof import('child_process')
    videoMade = await new Promise<boolean>((resolve) => {
      let settled = false
      const done = (v: boolean): void => {
        if (!settled) {
          settled = true
          resolve(v)
        }
      }
      // 45 秒兜底，防止 ffmpeg 挂死拖垮整个验收
      const timer = setTimeout(() => done(false), 45000)
      try {
        const child = spawn(
          join(projFfDir, 'ffmpeg.exe'),
          [
            '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10',
            // 注意：LGPL 版不含 libx264（GPL），用 libopenh264（BSD，codec 名同为 h264）
            '-c:v', 'libopenh264', '-pix_fmt', 'yuv420p', '-y', vidPath
          ],
          { windowsHide: true }
        )
        child.on('error', () => {
          clearTimeout(timer)
          done(false)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          done(code === 0 && existsSync(vidPath))
        })
      } catch {
        clearTimeout(timer)
        done(false)
      }
    })
  }
  if (!videoMade) {
    // 没有可用 FFmpeg 就造一个假 mp4，至少验证降级路径
    writeFileSync(vidPath, '这不是一个真视频')
  }
  ok(existsSync(vidPath), `测试视频已生成：demo.mp4（真实=${videoMade}）`)

  scanAll(WS)
  const vMetaRows = getDb()
    .prepare('SELECT id, abs_path, ext, duration_ms FROM assets')
    .all() as Array<{ id: number; abs_path: string; ext: string; duration_ms: number | null }>
  const vWritten = await ensureVideoMetaForAssets(vMetaRows)

  const vRow = getDb()
    .prepare(
      'SELECT width, height, duration_ms, video_codec, probe_info FROM assets WHERE file_name = ?'
    )
    .get('demo.mp4') as
    | { width: number | null; height: number | null; duration_ms: number | null; video_codec: string | null; probe_info: string | null }
    | undefined
  ok(!!vRow, '视频已登记进库')

  if (videoMade) {
    ok(vWritten >= 1, `本次补齐 ${vWritten} 个视频的元信息`)
    ok(
      vRow?.duration_ms !== null && vRow.duration_ms > 1500 && vRow.duration_ms < 2500,
      `时长正确：${vRow?.duration_ms} ms（造的是 2 秒，允许 ±500）`
    )
    ok(vRow?.video_codec === 'h264', `视频编码识别为 ${vRow?.video_codec}（应为 h264）`)
    ok(vRow?.width === 320 && vRow?.height === 240, `视频尺寸 ${vRow?.width}×${vRow?.height}（应为 320×240）`)
    ok(
      !!vRow?.probe_info && vRow.probe_info.includes('fps'),
      `probe_info 已存（${vRow?.probe_info?.slice(0, 60)}）`
    )

    // 13.3 幂等
    const vAgain = await ensureVideoMetaForAssets(
      getDb()
        .prepare('SELECT id, abs_path, ext, duration_ms FROM assets')
        .all() as Array<{ id: number; abs_path: string; ext: string; duration_ms: number | null }>
    )
    ok(vAgain === 0, `视频元信息第二次运行处理 0 个（幂等）：实际 ${vAgain}`)

    // 13.4 视频缩略图：抽帧生成 .jpg
    const vThumbRows = getDb()
      .prepare('SELECT id, abs_path, size, ext, thumb_path, modified_at FROM assets WHERE file_name = ?')
      .all('demo.mp4') as Array<{
      id: number
      abs_path: string
      size: number
      ext: string
      thumb_path: string | null
      modified_at: string
    }>
    const thumbed = await ensureThumbsForAssets(WS, vThumbRows)
    ok(thumbed >= 1, `视频缩略图生成 ${thumbed} 张`)
    const vAfter = getDb()
      .prepare('SELECT thumb_path FROM assets WHERE file_name = ?')
      .get('demo.mp4') as { thumb_path: string | null }
    ok(
      !!vAfter.thumb_path && vAfter.thumb_path.endsWith('.jpg') && existsSync(join(WS, vAfter.thumb_path)),
      `视频缩略图落盘：${vAfter.thumb_path}`
    )

    // 13.5 假视频（文本冒充 mp4）：探测失败降级，不崩、不阻断
    const fakePath = join(videoPack.folder_path, '02-素材', 'fake.mp4')
    writeFileSync(fakePath, '这不是一个真视频，只是文本')
    scanAll(WS)
    await ensureVideoMetaForAssets(
      getDb()
        .prepare('SELECT id, abs_path, ext, duration_ms FROM assets')
        .all() as Array<{ id: number; abs_path: string; ext: string; duration_ms: number | null }>
    )
    const fakeRow = getDb()
      .prepare('SELECT id, duration_ms FROM assets WHERE file_name = ?')
      .get('fake.mp4') as { id: number; duration_ms: number | null }
    ok(!!fakeRow, '假视频依然被登记进库（不丢弃用户文件）')
    ok(fakeRow?.duration_ms === null, '假视频探测失败 → duration_ms 保持 null（没崩）')
  }

  // 13.6 临时摘掉 FFmpeg 再跑：整体降级返回 0（恢复后再继续）
  if (ffmpegReady()) {
    setFfmpegDir('')
    const offRows = getDb()
      .prepare('SELECT id, abs_path, ext, duration_ms FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; duration_ms: number | null }>
    const offRet = await ensureVideoMetaForAssets(offRows)
    ok(offRet === 0, `摘掉 FFmpeg 后补齐返回 0（功能降级而非报错）：实际 ${offRet}`)
    setFfmpegDir(projFfDir)
  }

  // ============ 第 2 批 B-04：PSD 内嵌预览图与元信息 ============
  log('\n[14] 第 2 批 B-04：PSD 内嵌预览 / 元信息')

  // 真实样本（用户提供）；不在就跳过真实断言，只跑降级断言
  const PSD_SAMPLE = 'C:\\Users\\30873\\Desktop\\访学证.psd'
  const hasSample = existsSync(PSD_SAMPLE)
  log(`  （真实 PSD 样本：${hasSample ? '有 —— 访学证.psd' : '无 —— 跳过真实断言'}）`)

  const psdPack = mkPack({ name: 'PSD测试包', workspaceRoot: WS })
  let sampleCopied = false
  if (hasSample) {
    const { copyFileSync } = require('fs') as typeof import('fs')
    const dst = join(psdPack.folder_path, '01-成品', '访学证.psd')
    copyFileSync(PSD_SAMPLE, dst)
    sampleCopied = existsSync(dst)
  }
  ok(sampleCopied, '真实 PSD 样本已复制进测试包')

  // 假 PSD（文本冒充）：降级路径任何环境都要过
  const fakePsdPath = join(psdPack.folder_path, '02-素材', 'fake.psd')
  writeFileSync(fakePsdPath, '8BPS 这不是真 PSD，只有签名')

  scanAll(WS)
  const pMetaRows = getDb()
    .prepare('SELECT id, abs_path, ext, width FROM assets')
    .all() as Array<{ id: number; abs_path: string; ext: string; width: number | null }>
  const pWritten = await ensurePsdMetaForAssets(pMetaRows)

  // 14.1 假 PSD：登记但不崩、无元信息
  const fakePsdRow = getDb()
    .prepare('SELECT id, width, color_mode FROM assets WHERE file_name = ?')
    .get('fake.psd') as { id: number; width: number | null; color_mode: string | null }
  ok(!!fakePsdRow, '假 PSD 依然被登记进库（不丢弃用户文件）')
  ok(fakePsdRow?.width === null, '假 PSD 元信息为 null（没崩）')

  if (sampleCopied) {
    // 14.2 真实样本：文件头尺寸与色彩模式（样本实测：PSD 头宽 827 × 高 1181，竖版 CMYK）
    const psdRow = getDb()
      .prepare('SELECT width, height, color_mode FROM assets WHERE file_name = ?')
      .get('访学证.psd') as { width: number | null; height: number | null; color_mode: string | null } | undefined
    ok(!!psdRow, 'PSD 已登记进库')
    ok(pWritten >= 1, `本次补齐 ${pWritten} 个 PSD 的元信息`)
    ok(psdRow?.width === 827, `画布宽度 ${psdRow?.width}（样本应为 827）`)
    ok(psdRow?.height === 1181, `画布高度 ${psdRow?.height}（样本应为 1181）`)
    ok(psdRow?.color_mode === 'CMYK', `色彩模式 ${psdRow?.color_mode}（样本应为 CMYK）`)

    // 14.3 内嵌预览 JPG 可提取且 sharp 能解码
    const psdAbs = join(psdPack.folder_path, '01-成品', '访学证.psd')
    const jpg = await extractPsdPreviewJpg(psdAbs)
    ok(!!jpg && jpg.length > 100, `内嵌预览提取成功（${jpg?.length ?? 0} 字节）`)
    if (jpg) {
      const sharp = (await import('sharp')).default
      const pm = await sharp(jpg).metadata()
      ok(!!pm.width && !!pm.height, `预览图可解码：${pm.width}×${pm.height} ${pm.format}`)
    }

    // 14.4 PSD 缩略图落盘
    const pThumbRows = getDb()
      .prepare('SELECT id, abs_path, size, ext, thumb_path, modified_at FROM assets WHERE file_name = ?')
      .all('访学证.psd') as Array<{
      id: number
      abs_path: string
      size: number
      ext: string
      thumb_path: string | null
      modified_at: string
    }>
    const pThumbed = await ensureThumbsForAssets(WS, pThumbRows)
    ok(pThumbed >= 1, `PSD 缩略图生成 ${pThumbed} 张`)
    const pAfter = getDb()
      .prepare('SELECT thumb_path FROM assets WHERE file_name = ?')
      .get('访学证.psd') as { thumb_path: string | null }
    ok(
      !!pAfter.thumb_path && pAfter.thumb_path.endsWith('.webp') && existsSync(join(WS, pAfter.thumb_path)),
      `PSD 缩略图落盘：${pAfter.thumb_path}`
    )

    // 14.5 幂等
    const pAgain = await ensurePsdMetaForAssets(
      getDb()
        .prepare('SELECT id, abs_path, ext, width FROM assets')
        .all() as Array<{ id: number; abs_path: string; ext: string; width: number | null }>
    )
    ok(pAgain === 0, `PSD 元信息第二次运行处理 0 个（幂等）：实际 ${pAgain}`)
  }

  // ============ 第 2 批 B-03：PDF 首页缩略图与页数 ============
  log('\n[15] 第 2 批 B-03：PDF 渲染 / 页数')

  const pdfPack = mkPack({ name: 'PDF测试包', workspaceRoot: WS })
  // 造一个 3 页 PDF
  const pdfPath = join(pdfPack.folder_path, '01-成品', '三页文档.pdf')
  makePdf(pdfPath, 3)
  ok(existsSync(pdfPath), `测试 PDF 已生成（3 页）`)

  // 假 PDF（文本冒充）走降级路径
  const fakePdfPath = join(pdfPack.folder_path, '02-素材', 'fake.pdf')
  writeFileSync(fakePdfPath, '%PDF-1.4 这不是真 PDF')

  scanAll(WS)
  const pdfRows = getDb()
    .prepare('SELECT id, abs_path, ext, probe_info FROM assets')
    .all() as Array<{ id: number; abs_path: string; ext: string; probe_info: string | null }>
  const pdfWritten = await ensurePdfMetaForAssets(pdfRows)

  const pdfRow = getDb()
    .prepare('SELECT probe_info FROM assets WHERE file_name = ?')
    .get('三页文档.pdf') as { probe_info: string | null } | undefined
  ok(!!pdfRow, 'PDF 已登记进库')
  ok(pdfWritten >= 1, `本次补齐 ${pdfWritten} 个 PDF 的页数`)
  ok(
    !!pdfRow?.probe_info && pdfRow.probe_info.includes('"pages":3'),
    `页数正确（probe_info = ${pdfRow?.probe_info}）`
  )

  // 假 PDF：登记但不崩、无页数
  const fakePdfRow = getDb()
    .prepare('SELECT id, probe_info FROM assets WHERE file_name = ?')
    .get('fake.pdf') as { id: number; probe_info: string | null }
  ok(!!fakePdfRow, '假 PDF 依然被登记进库（不丢弃用户文件）')
  ok(fakePdfRow?.probe_info === null, '假 PDF 页数为 null（没崩）')

  // PDF 缩略图落盘
  const pdfThumbRows = getDb()
    .prepare('SELECT id, abs_path, size, ext, thumb_path, modified_at FROM assets WHERE file_name = ?')
    .all('三页文档.pdf') as Array<{
    id: number
    abs_path: string
    size: number
    ext: string
    thumb_path: string | null
    modified_at: string
  }>
  const pdfThumbed = await ensureThumbsForAssets(WS, pdfThumbRows)
  ok(pdfThumbed >= 1, `PDF 缩略图生成 ${pdfThumbed} 张`)
  const pdfAfter = getDb()
    .prepare('SELECT thumb_path FROM assets WHERE file_name = ?')
    .get('三页文档.pdf') as { thumb_path: string | null }
  ok(
    !!pdfAfter.thumb_path && pdfAfter.thumb_path.endsWith('.webp') && existsSync(join(WS, pdfAfter.thumb_path)),
    `PDF 缩略图落盘：${pdfAfter.thumb_path}`
  )
  if (pdfAfter.thumb_path) {
    const sharp = (await import('sharp')).default
    const tm = await sharp(join(WS, pdfAfter.thumb_path)).metadata()
    ok(!!tm.width && tm.width <= 320, `缩略图宽 ${tm.width}（≤320）`)
  }

  // 幂等
  const pdfAgain = await ensurePdfMetaForAssets(
    getDb()
      .prepare('SELECT id, abs_path, ext, probe_info FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; probe_info: string | null }>
  )
  ok(pdfAgain === 0, `PDF 页数第二次运行处理 0 个（幂等）：实际 ${pdfAgain}`)

  // ============ 第 3 批 C-01：标签维度与预制标签 ============
  log('\n[16] 第 3 批 C-01：2 个标签维度 + 预制标签（第 14 批换清单）')

  const dims = listTagDimensions()
  ok(dims.length === 2, `维度数 = ${dims.length}（应为 2：物料类别/使用场景；项目/时间/状态已砍）`)
  ok(
    dims.map((d) => d.key).join(',') === 'category,channel',
    `维度顺序：${dims.map((d) => d.key).join(',')}`
  )
  const categoryDim = dims.find((d) => d.key === 'category')!
  ok(categoryDim.mode === 'multi', `类别维度为多选（mode=${categoryDim.mode}）`)
  ok(
    !dims.some((d) => d.key === 'status'),
    '【第 14 批】「目前状态」维度已砍掉，不再出现在维度列表'
  )
  ok(
    (
      getDb().prepare("SELECT COUNT(*) AS c FROM tags WHERE dimension = 'status'").get() as {
        c: number
      }
    ).c === 0,
    '【第 14 批】库里没有 status 维度的残留标签（迁移 11 已清）'
  )
  ok(categoryDim.tags.length >= 11, `类别预制标签 ${categoryDim.tags.length} 个（≥11）`)
  ok(categoryDim.tags.some((t) => t.name === '海报'), '类别含预制「海报」')
  ok(categoryDim.tags.some((t) => t.name === 'KV-喷绘印刷'), '类别含预制「KV-喷绘印刷」')
  const channelDim = dims.find((d) => d.key === 'channel')!
  ok(channelDim.tags.length >= 7, `场景预制标签 ${channelDim.tags.length} 个（≥7）`)
  ok(channelDim.tags.some((t) => t.name === '社群'), '场景含预制「社群」')
  ok(
    channelDim.tags.some((t) => t.name === '新媒体（直播、短视频）'),
    '场景含预制「新媒体（直播、短视频）」'
  )
  ok(
    dims.every((d) => d.tags.every((t) => t.id > 0)),
    '标签 id 全为正数（项目维度已砍，不再有负数映射标签）'
  )
  ok(
    dims.every((d) => d.tags.every((t) => typeof t.name === 'string' && typeof t.id === 'number')),
    '每个标签都有 name / id 字段'
  )

  // ============ 第 3 批 C-02：标签增 / 改 / 删 ============
  log('\n[17] 第 3 批 C-02：标签增改删 + 重名校验')

  const mk1 = createTag({ dimension: 'category', name: '验收测试类别' })
  ok(mk1.ok && !!mk1.tag, `新建标签成功（id=${mk1.tag?.id}）`)
  ok(mk1.tag?.name === '验收测试类别', `标签名正确：${mk1.tag?.name}`)
  ok(!!mk1.tag?.color && /^#[0-9a-f]{6}$/i.test(mk1.tag!.color), `标签自动配色：${mk1.tag?.color}`)

  const dupTag = createTag({ dimension: 'category', name: '验收测试类别' })
  ok(!dupTag.ok && !!dupTag.error, `同维度同名被拒：${dupTag.error}`)

  const crossOk = createTag({ dimension: 'channel', name: '验收测试类别' })
  ok(crossOk.ok, '跨维度同名允许（维度内唯一即可）')

  const empty = createTag({ dimension: 'category', name: '   ' })
  ok(!empty.ok, `空名被拒：${empty.error}`)

  const badDim = createTag({ dimension: 'nope', name: 'x' })
  ok(!badDim.ok, `不存在的维度被拒：${badDim.error}`)

  // 第 14 批：已砍掉的 status 维度同样算"不存在"，建标签必须被拒（防回归）
  const statusTry = createTag({ dimension: 'status', name: '想偷偷加回来' })
  ok(!statusTry.ok, `【第 14 批】往已砍掉的 status 维度建标签被拒：${statusTry.error}`)

  const updTag = updateTag(mk1.tag!.id, { name: '验收改名后', color: '#ff0000' })
  ok(updTag.ok && updTag.tag?.name === '验收改名后', `改名生效：${updTag.tag?.name}`)
  ok(updTag.tag?.color === '#ff0000', `改色生效：${updTag.tag?.color}`)

  const badUpd = updateTag(mk1.tag!.id, { name: '   ' })
  ok(!badUpd.ok, `改成空名被拒：${badUpd.error}`)

  // ============ 第 3 批 C-03：批量打标签（覆盖语义） ============
  log('\n[18] 第 3 批 C-03：列表勾选批量打标签')

  const allAssetIds = (
    getDb().prepare('SELECT id FROM assets ORDER BY id').all() as Array<{ id: number }>
  ).map((r) => r.id)
  ok(allAssetIds.length >= 5, `库内素材 ${allAssetIds.length} 条（≥5，可用于批量打标签）`)

  const pick = allAssetIds.slice(0, 3)
  const posterTag = categoryDim.tags.find((t) => t.name === '海报')!
  const groupTag = channelDim.tags.find((t) => t.name === '社群')!

  const r1 = applyTags({ assetIds: pick, tagIds: [posterTag.id, groupTag.id] })
  ok(r1.ok, `批量贴标签返回 ok（tagged=${r1.tagged}, cleared=${r1.cleared}）`)
  ok(r1.tagged === pick.length * 2, `张贴记录数 = ${r1.tagged}（3 素材 × 2 标签）`)
  ok(r1.cleared === 0, `首次贴无清除（cleared=${r1.cleared}）`)

  const fromDb = tagsOfAssets(pick)
  ok(fromDb[pick[0]]?.length === 2, `第 1 条素材有 2 个标签：${fromDb[pick[0]]?.length}`)
  ok(
    fromDb[pick[1]]?.some((t) => t.name === '海报') && fromDb[pick[1]]?.some((t) => t.name === '社群'),
    '两个标签都贴上了'
  )

  // 覆盖语义：同维度再贴一次，旧的要被清掉
  const foldTag = categoryDim.tags.find((t) => t.name === '折页')!
  const r2 = applyTags({ assetIds: pick, tagIds: [foldTag.id] })
  ok(r2.cleared === pick.length, `同维度覆盖清掉旧标签 ${r2.cleared} 条（=3，类别维度单选语义）`)
  const after2 = tagsOfAssets(pick)
  ok(
    after2[pick[0]]?.some((t) => t.name === '折页') === true,
    '新标签「折页」已贴上'
  )
  ok(
    after2[pick[0]]?.some((t) => t.name === '海报') === false,
    '旧类别标签「海报」被清掉（同维度覆盖）'
  )
  ok(
    after2[pick[0]]?.some((t) => t.name === '社群') === true,
    '非同维度标签「社群」不受影响，仍保留'
  )

  // ============ 第 3 批 C-04：去标签 / 使用量 / 删标签 ============
  log('\n[19] 第 3 批 C-04：去标签 / 使用量统计 / 删标签级联')

  const usageFold = tagUsage(foldTag.id)
  ok(usageFold.assetCount === pick.length, `「折页」使用量 = ${usageFold.assetCount}（=3）`)

  const r3 = removeTagsFrom({ assetIds: [pick[0]], tagIds: [foldTag.id] })
  ok(r3.removed === 1, `去标签生效 ${r3.removed} 条`)
  ok(
    tagsOfAssets([pick[0]])[pick[0]]?.some((t) => t.name === '折页') === false,
    '第 1 条已无「折页」'
  )
  ok(tagUsage(foldTag.id).assetCount === pick.length - 1, `使用量随之减为 ${tagUsage(foldTag.id).assetCount}`)

  const delTag = createTag({ dimension: 'category', name: '待删除标签' })
  applyTags({ assetIds: pick, tagIds: [delTag.tag!.id] })
  const usageBeforeDel = tagUsage(delTag.tag!.id).assetCount
  ok(usageBeforeDel === pick.length, `待删标签使用量 ${usageBeforeDel}`)
  const rDel = removeTag(delTag.tag!.id)
  ok(rDel.ok && rDel.deleted === pick.length, `删标签成功，连带清 ${rDel.deleted} 条关联`) 
  ok(tagUsage(delTag.tag!.id).assetCount === 0, '关联已清空，使用量归 0')
  ok(
    getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() !== undefined &&
      (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c ===
        allAssetIds.length,
    '删标签不动素材（素材条数不变）'
  )
  const rDelAgain = removeTag(delTag.tag!.id)
  ok(!rDelAgain.ok, `删不存在的标签被拒：${rDelAgain.error}`)

  // 清理跨维度同名测试标签
  if (crossOk.tag) removeTag(crossOk.tag.id)

  // ============ 第 3 批 C-05：多维筛选（并且语义） ============
  log('\n[20] 第 3 批 C-05：多维筛选「并且」语义')

  // 造一组确定数据：3 条素材，A 组贴【折页 + 社群】，B 组贴【折页】
  const groupA = pick
  const groupB = allAssetIds.slice(3, 5)
  applyTags({ assetIds: groupA, tagIds: [foldTag.id, groupTag.id] })
  applyTags({ assetIds: groupB, tagIds: [foldTag.id] })

  const onlyFold = listAssets({ tagIds: [foldTag.id] })
  ok(
    onlyFold.length >= groupA.length + groupB.length,
    `按「折页」单选筛出 ${onlyFold.length} 条（≥${groupA.length + groupB.length}）`
  )

  const foldAndGroup = listAssets({ tagIds: [foldTag.id, groupTag.id] })
  ok(
    foldAndGroup.length === groupA.length,
    `「折页 + 社群」并且筛出 ${foldAndGroup.length} 条（=${groupA.length}，跨维度 AND 生效）`
  )
  ok(
    foldAndGroup.every((a) => groupA.includes(a.id)),
    '筛出的正是 A 组（同维度旧标签被覆盖后不串味）'
  )

  // ---- 项目维度负数 id 兼容：listAssets 把 -projectId 换算成 packs.project_id 过滤 ----
  // 背景：项目维度标签已砍（2026-09-24），界面不再传负数 id，但该能力保留作防御
  // （回归：上线首日用户实点「总部」筛出 0 条的 bug —— 负数 id 没换算成 project_id）
  // 注意：[10] 段的删项目测试会把前面的项目删掉，这里取「当前还活着且有包」的项目
  const liveProj = getDb()
    .prepare(
      `SELECT p.id, p.name FROM projects p
        WHERE EXISTS (SELECT 1 FROM packs k WHERE k.project_id = p.id)
        ORDER BY p.id LIMIT 1`
    )
    .get() as { id: number; name: string } | undefined
  ok(!!liveProj, `有存活且带包的项目可测：${liveProj?.name ?? '无'}`)
  if (liveProj) {
    const expectedCnt = (
      getDb()
        .prepare(
          'SELECT COUNT(*) AS c FROM assets a JOIN packs k ON k.id = a.pack_id WHERE k.project_id = ?'
        )
        .get(liveProj.id) as { c: number }
    ).c
    const byProj = listAssets({ tagIds: [-liveProj.id] })
    ok(
      byProj.length === expectedCnt && byProj.length >= 2,
      `按项目标签「${liveProj.name}」筛出 ${byProj.length} 条（=库内直算 ${expectedCnt}，负数 id 已换算成 project_id）`
    )
    ok(
      byProj.every((a) => a.pack_id !== null),
      '筛出的全是挂在项目包下的素材（未归属不混入）'
    )

    // 项目维度 + 类别维度 跨维度「并且」：给项目包里的一条素材贴「折页」再筛
    const projAsset = getDb()
      .prepare(
        'SELECT a.id FROM assets a JOIN packs k ON k.id = a.pack_id WHERE k.project_id = ? ORDER BY a.id LIMIT 1'
      )
      .get(liveProj.id) as { id: number }
    applyTags({ assetIds: [projAsset.id], tagIds: [foldTag.id] })
    const expectedMixed = allAssetIds.filter((id) => {
      const a = getDb()
        .prepare(
          'SELECT k.project_id FROM assets a LEFT JOIN packs k ON k.id = a.pack_id WHERE a.id = ?'
        )
        .get(id) as { project_id: number | null } | undefined
      const tagged = getDb()
        .prepare(
          'SELECT 1 AS x FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ? AND t.name = ?'
        )
        .get(id, '折页')
      return a?.project_id === liveProj.id && !!tagged
    })
    const mixed = listAssets({ tagIds: [-liveProj.id, foldTag.id] })
    ok(
      mixed.length === expectedMixed.length &&
        mixed.length >= 1 &&
        mixed.every((a) => expectedMixed.includes(a.id)),
      `「${liveProj.name} + 折页」并且筛出 ${mixed.length} 条（与库内直算一致，项目 AND 标签生效）`
    )
  }

  // 不存在的项目 id → 空结果而不是全量
  const noProj = listAssets({ tagIds: [-99999] })
  ok(noProj.length === 0, `不存在的项目标签筛出 0 条（实际 ${noProj.length}）`)

  // ============ 第 3 批 C-07：标签自动建议 ============
  log('\n[21] 第 3 批 C-07：标签自动建议（只推荐不自动贴）')

  const suggestDb = getDb()
  // 取一条「从没被打过标签」的素材（后面几条没进过 [18]/[19] 的批次）
  const targetAsset = suggestDb
    .prepare(
      `SELECT a.id, a.file_name FROM assets a
        WHERE NOT EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id = a.id)
        ORDER BY a.id DESC LIMIT 1`
    )
    .get() as { id: number; file_name: string }
  ok(!!targetAsset && typeof targetAsset.id === 'number', `取到干净素材用于建议：${targetAsset?.file_name}`)
  // 把一条渠道标签命名成文件名里必含的词，检验能否命中
  const word = targetAsset.file_name.slice(0, 2)
  const sugTag = createTag({ dimension: 'channel', name: word })
  ok(sugTag.ok, `造建议用标签「${word}」（取自文件名前两字）`)

  const sug = suggestTagsForAssets([targetAsset.id])
  ok(Array.isArray(sug[targetAsset.id]), '建议返回数组')
  ok(sug[targetAsset.id].includes(sugTag.tag!.id), `文件名含「${word}」→ 建议命中该标签 ✓`)

  const before = sug[targetAsset.id].length
  ok(
    tagsOfAssets([targetAsset.id])[targetAsset.id] === undefined,
    '建议阶段不会自动贴标签（素材标签表仍为空）'
  )
  ok(before >= 1, `建议数 ${before}（≥1）`)

  // 单字标签不该被建议
  const oneChar = createTag({ dimension: 'channel', name: '的' })
  if (oneChar.tag) {
    const sug2 = suggestTagsForAssets([targetAsset.id])
    ok(sug2[targetAsset.id].includes(oneChar.tag.id) === false, '单字标签跳过建议（避免误命中）')
    removeTag(oneChar.tag.id)
  }

  if (sugTag.tag) removeTag(sugTag.tag.id)
  removeTag(mk1.tag!.id)

  // ============ 第 4 批 D-01：工作区择址兜底（方案 06 第 6 节） ============
  log('\n[22] 第 4 批 D-01：工作区择址兜底 + 绝不偷偷改用户位置')

  // 全程用一套独立临时目录，绝不碰用户真实工作区
  const wsTestRoot = join('D:\\_accept_ws', `wstest_${RUN_ID}`)
  const appDataA = join(wsTestRoot, 'appdata_a')
  const appDataB = join(wsTestRoot, 'appdata_b')
  const appDataC = join(wsTestRoot, 'appdata_c')
  const docsDir = join(wsTestRoot, 'docs')
  const goodDir = join(wsTestRoot, 'good')
  mkdirSync(docsDir, { recursive: true })

  // (1) 可用性判定
  ok(isUsableWorkspace(goodDir), '可写目录 → 判定为可用')
  ok(existsSync(join(goodDir, '_system')), '探针顺带把 _system 建好（数据库就放这儿）')
  ok(!existsSync(join(goodDir, '_system', '.write_probe')), '探针文件用完即删，不留痕')

  // (2) 不可用：父级是文件，mkdir 必然失败
  const blocker = join(wsTestRoot, 'blocker.txt')
  writeFileSync(blocker, 'x', 'utf-8')
  ok(!isUsableWorkspace(join(blocker, 'sub')), '目录建不出来 → 判定为不可用（不会误判成可用）')

  // (3) 首次启动 + 首选位置可用 → 用首选位置，并落配置
  mkdirSync(appDataA, { recursive: true })
  const stA = resolveWorkspace(appDataA, docsDir, goodDir)
  ok(stA.ok && stA.root === goodDir, `首次启动用首选位置（${stA.root}）`)
  ok(
    existsSync(join(appDataA, 'workspace.json')) &&
      JSON.parse(readFileSync(join(appDataA, 'workspace.json'), 'utf-8')).workspaceRoot === goodDir,
    '首次择址结果已写进配置文件'
  )

  // (4) 首次启动 + 首选位置不可用 → 自动落到「文档」
  mkdirSync(appDataB, { recursive: true })
  const stB = resolveWorkspace(appDataB, docsDir, join(blocker, 'sub'))
  ok(stB.ok, '首选位置不可用时仍能拿到可用工作区（自动兜底）')
  ok(
    stB.root === join(docsDir, FALLBACK_FOLDER_NAME),
    `兜底落到「文档」下（${stB.root}）`
  )

  // (5) 【铁则】已有配置但位置连不上 → 绝不偷偷改配置
  mkdirSync(appDataC, { recursive: true })
  const deadRoot = join(blocker, 'dead')
  saveWorkspaceRoot(appDataC, deadRoot)
  const cfgBefore = readFileSync(join(appDataC, 'workspace.json'), 'utf-8')
  const stC = resolveWorkspace(appDataC, docsDir)
  ok(!stC.ok, '已配置的位置连不上 → 如实报告不可用')
  ok(stC.root === deadRoot, '不可用时仍返回用户原位置（不偷偷换地方）')
  ok(
    readFileSync(join(appDataC, 'workspace.json'), 'utf-8') === cfgBefore,
    '【铁则】配置文件一个字都没被改'
  )
  ok(stC.note.length > 0, `给出人看得懂的原因：${stC.note}`)

  // (6) 缓存与重置
  const c1 = getWorkspaceState(appDataA, docsDir)
  ok(c1 === getWorkspaceState(appDataA, docsDir), '工作区状态进程内缓存（不必每次调用都写探针）')
  resetWorkspaceState()
  ok(getWorkspaceState(appDataA, docsDir) !== c1, 'reset 后重新解析（供「更改位置 / 重试」使用）')
  resetWorkspaceState()

  // (7) 打包配置契约 —— 锁住本批结论，防止以后被改回去
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
  const b = pkg.build || {}
  ok(/^\d+\.\d+\.\d+$/.test(pkg.version), `版本号取自 package.json：${pkg.version}`)
  // 显示名三处必须一致：产品名（窗口/进程显示）/ 快捷方式名 / 卸载列表名。
  // 写成契约而不是硬编码具体名字 —— 改名是业务动作，不该每次都来改测试。
  const dispNames = [b.productName, b.nsis?.shortcutName, b.nsis?.uninstallDisplayName]
  ok(
    dispNames.every((x: unknown) => typeof x === 'string' && (x as string).length > 0) &&
      new Set(dispNames).size === 1,
    `应用显示名三处一致：${dispNames[0]}`
  )
  ok(
    typeof b.nsis?.artifactName === 'string' && b.nsis.artifactName.startsWith(b.productName),
    `安装包文件名带产品名：${b.nsis?.artifactName}`
  )
  ok(b.appId === 'com.mediabutler', 'appId 与 setAppUserModelId 一致（com.mediabutler）')
  ok(
    b.npmRebuild === false,
    '【核心】npmRebuild=false —— 原生模块是 N-API 预编译，本机无 VS 工具链'
  )
  ok(!existsSync('electron-builder.yml'), '【核心】出包配置只有一处：electron-builder.yml 已删除')
  ok(
    Array.isArray(b.files) && b.files.includes('!resources/ffmpeg/**'),
    '排除 resources/ffmpeg 免重复打包（否则安装包虚胖 267MB）'
  )
  ok(
    Array.isArray(b.extraResources) &&
      b.extraResources.some((x: { from?: string }) => x.from === 'resources/ffmpeg'),
    'FFmpeg 走 extraResources 单独一份'
  )
  ok(b.win?.executableName === 'MediaButler', '主程序 exe 用 ASCII 名（中文名留给快捷方式）')
  ok(b.nsis?.perMachine === false, '免管理员权限安装（perMachine=false）')
  ok(b.directories?.output === 'release', '出包产物落在 release/，与 out/ 编译产物分开')

  // ============ 第 5 批 E-01：工作区管理与迁移（方案 07） ============
  log('\n[23] 第 5 批 E-01：多工作区 + 路径重写 + 同盘搬移')

  const w5Root = join('D:\\_accept_ws', `wstest5_${RUN_ID}`)
  const w5App = join(w5Root, 'appdata')
  const w5A = join(w5Root, 'wsA')
  const w5Copy = join(w5Root, 'wsCopy')
  const w5MoveTo = join(w5Root, 'moved')
  const w5AppOld = join(w5Root, 'appdata_old')
  mkdirSync(w5App, { recursive: true })
  mkdirSync(w5MoveTo, { recursive: true })
  mkdirSync(w5AppOld, { recursive: true })

  /** 递归复制目录（造「搬过来的库」用） */
  function w5CopyDir(src: string, dst: string): void {
    mkdirSync(dst, { recursive: true })
    for (const name of readdirSync(src)) {
      const s = join(src, name)
      const d = join(dst, name)
      if (statSync(s).isDirectory()) w5CopyDir(s, d)
      else copyFileSync(s, d)
    }
  }

  /** 数一个目录下的文件总数 */
  function w5CountFiles(dir: string): number {
    if (!existsSync(dir)) return 0
    let n = 0
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) n += w5CountFiles(p)
      else n += 1
    }
    return n
  }

  // (1) 空目录 → 新建工作区
  const w5Add1 = addWorkspace(w5App, w5A)
  ok(w5Add1.ok, '空目录 → 添加工作区成功')
  ok(existsSync(join(w5A, '_thumbs')), '新工作区建好了 _thumbs')
  ok(
    existsSync(join(w5A, '_system', 'media.db')),
    '【BUG-1 修复】新工作区真的建出了 media.db（老版本 openDb 单例会提前返回，根本建不出来）'
  )

  // (2) 配置结构 v2
  const w5Cfg1 = readWorkspaceConfig(w5App)
  ok(!!w5Cfg1 && w5Cfg1.version === 2, '配置文件是 v2 结构')
  ok(!!w5Cfg1 && w5Cfg1.workspaces.length === 1, '列表里有 1 个工作区')
  ok(!!w5Cfg1 && w5Cfg1.activeId === w5Cfg1.workspaces[0].id, 'activeId 指向它')
  ok(!!w5Cfg1 && !!w5Cfg1.workspaces[0].id, '每个工作区都有 id')
  const w5RawCfg1 = JSON.parse(readFileSync(join(w5App, 'workspace.json'), 'utf-8'))
  ok(
    w5RawCfg1.workspaceRoot === w5A,
    '【兼容双写】配置里同时写了 workspaceRoot 老字段（旧版软件才读得到，不会凭空择址）'
  )
  ok(
    Array.isArray(w5RawCfg1.workspaces) && w5RawCfg1.workspaces.length === 1,
    '配置文件里落了 workspaces 数组'
  )

  // (3) 老配置自动升级 + 不改用户文件 + id 确定性
  const w5OldCfgPath = join(w5AppOld, 'workspace.json')
  const w5OldCfgRaw = JSON.stringify({ workspaceRoot: w5A })
  writeFileSync(w5OldCfgPath, w5OldCfgRaw, 'utf-8')
  const w5CfgOld = readWorkspaceConfig(w5AppOld)
  ok(!!w5CfgOld && w5CfgOld.version === 2, '老格式 { workspaceRoot } 读时自动升级成 v2')
  ok(!!w5CfgOld && w5CfgOld.workspaces[0].root === w5A, '升级后工作区路径不丢')
  ok(readFileSync(w5OldCfgPath, 'utf-8') === w5OldCfgRaw, '【只读不写】升级只在内存里，没动用户文件')
  const w5IdFirst = readWorkspaceConfig(w5AppOld)!.workspaces[0].id
  const w5IdSecond = readWorkspaceConfig(w5AppOld)!.workspaces[0].id
  ok(
    w5IdFirst === w5IdSecond,
    '升级出来的 id 是确定性的（同一 root 每次读都一样，界面按 id 切换才有效）'
  )

  // (4) 在 w5A 里造真实内容：一个包 + 两个文件 + 一个标签关联
  const w5Pack = mkPack({ name: '迁移测试包', workspaceRoot: w5A })
  writeFileSync(join(w5Pack.folder_path, '01-成品', 'a.txt'), 'hello', 'utf-8')
  writeFileSync(join(w5Pack.folder_path, '02-素材', 'b.txt'), 'world', 'utf-8')
  scanAll(w5A)
  const w5Assets = (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c
  const w5Packs = (getDb().prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c
  const w5First = getDb().prepare('SELECT id FROM assets ORDER BY id LIMIT 1').get() as { id: number }
  const w5Tag = createTag({ dimension: 'category', name: `迁移标签${RUN_ID}`, color: '#4f8cff' })
  applyTags({ assetIds: [w5First.id], tagIds: [w5Tag.tag!.id] })
  const w5Links = (getDb().prepare('SELECT COUNT(*) AS c FROM asset_tags').get() as { c: number }).c
  ok(
    w5Assets === 2 && w5Links === 1,
    `铺垫就绪：${w5Assets} 条素材 / ${w5Links} 条标签关联 / ${w5Packs} 个包`
  )

  const w5List = listWorkspaces(w5App)
  ok(w5List.workspaces.length === 1 && w5List.activeId === w5Cfg1!.activeId, 'listWorkspaces 与配置一致')

  // (5) 复制一份 → 造出「搬过来的库」
  w5CopyDir(w5A, w5Copy)
  const w5Insp = inspectWorkspaceDir(w5Copy)
  ok(w5Insp.kind === 'foreign', '复制过来的库 → 体检判定为 foreign（搬过来的）')
  ok((w5Insp.oldRoot ?? '').toLowerCase() === w5A.toLowerCase(), `反推出的旧根正确：${w5Insp.oldRoot}`)
  ok(
    (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c === w5Assets,
    '体检走独立连接，没有打断/污染当前库'
  )

  // (6) 用户没点头之前，一个字都不改
  const w5CfgPath = join(w5App, 'workspace.json')
  const w5CfgBefore = readFileSync(w5CfgPath, 'utf-8')
  const w5Add2 = addWorkspace(w5App, w5Copy)
  ok(!w5Add2.ok && w5Add2.needsConfirm === true, '搬过来的库：先返回 needsConfirm，不擅自动手')
  ok(readFileSync(w5CfgPath, 'utf-8') === w5CfgBefore, '【铁则】未确认前配置文件一个字没改')
  ok(
    (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c === w5Assets,
    '【铁则】未确认前当前库也没被动'
  )

  // (7) 用户确认 → 重写路径（本批核心）
  const w5Add3 = addWorkspace(w5App, w5Copy, { rewrite: true })
  ok(w5Add3.ok, `确认后重写成功（${w5Add3.migrated?.oldRoot} → ${w5Add3.migrated?.newRoot}）`)
  const w5M = w5Add3.migrated!
  ok(w5M.assets === w5Assets, `重写后素材条数不变（${w5M.assets}）`)
  const w5RowsA = getDb().prepare('SELECT abs_path FROM assets').all() as Array<{ abs_path: string }>
  ok(
    w5RowsA.every((r) => r.abs_path.toLowerCase().startsWith(w5Copy.toLowerCase())),
    '所有素材路径都改成了新位置'
  )
  ok(
    !w5RowsA.some((r) => r.abs_path.toLowerCase().startsWith(w5A.toLowerCase() + '\\')),
    '没有一条还指着旧位置'
  )
  const w5LinksAfter = (getDb().prepare('SELECT COUNT(*) AS c FROM asset_tags').get() as { c: number }).c
  ok(w5LinksAfter === w5Links, `【最关键】标签关联条数不变（${w5LinksAfter}）—— 标签一条都没丢`)
  const w5PacksAfter = (getDb().prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c
  ok(w5PacksAfter === w5Packs, `包没有重复登记（还是 ${w5PacksAfter} 个）`)
  const w5PackRows = getDb().prepare('SELECT folder_path FROM packs').all() as Array<{
    folder_path: string
  }>
  ok(
    w5PackRows.every((p) => p.folder_path.toLowerCase().startsWith(w5Copy.toLowerCase())),
    '包的目录路径也改成了新位置'
  )
  ok(!!w5M.backupPath && existsSync(w5M.backupPath), `重写前自动备份了：${w5M.backupPath}`)
  ok(w5M.missing === 0, '重写后自检 0 个文件落空')

  // (8) 幂等：已经在正确位置上再跑一次
  const w5Idem = rewritePaths(w5Copy, w5Copy)
  ok(w5Idem.ok && w5Idem.error === undefined, '已经在正确位置时再跑重写：不报错（幂等）')

  // (9) 库里有跨根数据 → 拒绝自动重写（宁可报错也不硬猜）
  const w5AllRows = getDb()
    .prepare('SELECT id, abs_path, rel_path FROM assets ORDER BY id')
    .all() as Array<{ id: number; abs_path: string; rel_path: string }>
  const w5Bad = w5AllRows[0]

  // 造出「abs_path 仍以 rel_path 结尾、但根在别的盘」的脏数据 —— 这才是真跨根
  getDb()
    .prepare('UPDATE assets SET abs_path = ? WHERE id = ?')
    .run(join('E:\\zzz_other', w5Bad.rel_path), w5Bad.id)
  const w5InspBad = inspectWorkspaceDir(w5Copy)
  ok(w5InspBad.kind === 'broken', '库里路径指向两个不同位置 → 判定为异常')
  ok(!!w5InspBad.error && w5InspBad.error.includes('拒绝'), `如实报错不硬猜：${w5InspBad.error}`)

  // (9b) rel_path 与 abs_path 全对不上 → 同样拒绝（不许拿脏数据重建路径）
  getDb().prepare("UPDATE assets SET rel_path = 'X:\\wrong\\nowhere.txt'").run()
  const w5InspDirty = inspectWorkspaceDir(w5Copy)
  ok(w5InspDirty.kind === 'broken', 'abs_path 与 rel_path 全对不上 → 判定为异常')
  ok(
    !!w5InspDirty.error && w5InspDirty.error.includes('自相矛盾'),
    `对不上的库也拒绝：${w5InspDirty.error}`
  )

  // 复原两条记录（后面的搬移用例要用干净数据）
  const w5Restore = getDb().prepare('UPDATE assets SET abs_path = ?, rel_path = ? WHERE id = ?')
  for (const r of w5AllRows) w5Restore.run(r.abs_path, r.rel_path, r.id)
  ok(
    inspectWorkspaceDir(w5Copy).kind === 'own',
    '脏数据复原后判定恢复为 own —— 说明前两次是数据异常触发，不是逻辑恒判'
  )

  // (10) 同盘搬移
  const w5Mv = migrateWorkspaceSameDisk(w5App, w5MoveTo)
  ok(w5Mv.ok, `同盘搬移成功：${w5Mv.from} → ${w5Mv.to}`)
  const w5MovedRoot = join(w5MoveTo, 'wsCopy')
  ok(!existsSync(w5Copy) && existsSync(w5MovedRoot), '目录真的搬走了（原位置不再有副本）')
  const w5CfgMoved = readWorkspaceConfig(w5App)!
  ok(
    w5CfgMoved.workspaces.some((w) => w.root.toLowerCase() === w5MovedRoot.toLowerCase()),
    '配置里的路径跟着更新了'
  )
  const w5RowsMoved = getDb().prepare('SELECT abs_path FROM assets').all() as Array<{
    abs_path: string
  }>
  ok(
    w5RowsMoved.every((r) => r.abs_path.toLowerCase().startsWith(w5MovedRoot.toLowerCase())),
    '搬完后库里的路径指向新位置（重写生效）'
  )
  ok(!!w5Mv.backupPath && existsSync(w5Mv.backupPath), '搬移同样做了备份')

  // (11) 跨盘 → 明确拒绝，磁盘与配置零改动
  const w5CParent = join(tmpdir(), `_accept_xdisk_${RUN_ID}`)
  mkdirSync(w5CParent, { recursive: true })
  const w5MvCross = migrateWorkspaceSameDisk(w5App, w5CParent)
  ok(!w5MvCross.ok && w5MvCross.crossDisk === true, '跨盘 → 明确拒绝并标记 crossDisk')
  ok(existsSync(w5MovedRoot), '【零改动】跨盘被拒后工作区还在原处')
  ok(w5CfgMoved.activeId === readWorkspaceConfig(w5App)!.activeId, '【零改动】跨盘被拒后配置也没改')
  hardRm(w5CParent)

  // (12) 目标已存在 → 拒绝，绝不覆盖
  const w5MvDup = migrateWorkspaceSameDisk(w5App, w5MoveTo)
  ok(!w5MvDup.ok && !w5MvDup.crossDisk && !!w5MvDup.error, `目标已存在 → 拒绝不覆盖：${w5MvDup.error}`)

  // (13) 同盘判定
  ok(isSameVolume(w5A, w5MoveTo), '同一磁盘内两个目录 → 判定同卷')
  ok(!isSameVolume(w5MoveTo, 'C:\\'), 'D 盘与 C 盘 → 判定不同卷')

  // (14) 切换工作区：【BUG-1 的决定性证据】切完必须读到另一个库
  const w5B = join(w5Root, 'wsB')
  const w5AddB = addWorkspace(w5App, w5B)
  ok(w5AddB.ok, '添加第二个（空）工作区')
  ok(
    (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c === 0,
    '新建的库确实是空的（说明数据库连接真的换到了新库）'
  )
  const w5EntryMoved = readWorkspaceConfig(w5App)!.workspaces.find(
    (w) => w.root.toLowerCase() === w5MovedRoot.toLowerCase()
  )
  ok(!!w5EntryMoved, '能在列表里找到刚搬过去的那个工作区')
  const w5Sw = switchWorkspace(w5App, w5EntryMoved!.id)
  ok(w5Sw.ok, `切回有素材的那个工作区（${w5Sw.name}）`)
  const w5AfterSwitch = (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c
  ok(
    w5AfterSwitch === w5Assets,
    `【BUG-1 决定性证据】切换后读到的是目标库的数据（${w5AfterSwitch} 条，不是 0）`
  )

  // (15) 移除工作区：只删记录，磁盘一个字节不动
  const w5EntryB = readWorkspaceConfig(w5App)!.workspaces.find(
    (w) => w.root.toLowerCase() === w5B.toLowerCase()
  )
  ok(!!w5EntryB, '能找到要移除的那个工作区')
  const w5FilesB = w5CountFiles(w5B)
  const w5RmB = removeWorkspace(w5App, w5EntryB!.id)
  ok(w5RmB.ok, '从列表移除一个工作区')
  ok(
    readWorkspaceConfig(w5App)!.workspaces.every((w) => w.root.toLowerCase() !== w5B.toLowerCase()),
    '列表里已经没有它了'
  )
  ok(
    existsSync(w5B) && w5CountFiles(w5B) === w5FilesB,
    `【铁则】磁盘上的文件夹一点没动（${w5FilesB} 个文件还在）`
  )
  const w5Left = readWorkspaceConfig(w5App)!.workspaces
  ok(w5Left.length >= 1, `列表里还留着 ${w5Left.length} 个工作区`)
  if (w5Left.length === 1) {
    const w5RmLast = removeWorkspace(w5App, w5Left[0].id)
    ok(!w5RmLast.ok, '最后一个工作区不许移除（否则软件无处可去）')
  }

  hardRm(w5Root)

  hardRm(wsTestRoot)

  // ============ 第 6 批 F-01：三级目录结构（方案 08） ============
  log('\n[24] 第 6 批 F-01：三级目录结构（工作区 / 项目 / 包）')

  const w6Root = join('D:\\_accept_ws', `wstest6_${RUN_ID}`)
  const w6App = join(w6Root, 'appdata')
  const w6Ws = join(w6Root, 'ws')
  mkdirSync(w6App, { recursive: true })

  /**
   * 数一个目录下的文件总数（第 6 批自己的，避免与 w5 的撞名）。
   * 跳过 `_` / `.` 开头的目录 —— `_system` 下会因为备份而新增文件，
   * 那是软件自己的事，不该算进"用户的文件少了没有"。
   */
  function w6CountFiles(dir: string): number {
    if (!existsSync(dir)) return 0
    let n = 0
    for (const name of readdirSync(dir)) {
      if (name.startsWith('_') || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) n += w6CountFiles(p)
      else n += 1
    }
    return n
  }

  // (1) 新工作区初始化
  const w6Add = addWorkspace(w6App, w6Ws)
  ok(w6Add.ok, '新工作区就绪')
  ok(existsSync(join(w6Ws, UNBOUND_DIR)), `【建工作区时】创建了收纳区「${UNBOUND_DIR}」`)
  ok(existsSync(join(w6Ws, TRASH_DIR)), `【建工作区时】创建了收纳区「${TRASH_DIR}」`)
  ok(
    getMeta('layout_version') === LAYOUT_VERSION,
    `新工作区直接标记 layout_version=${LAYOUT_VERSION}（不跑迁移）`
  )
  ok(readLayoutNotice() === null, '新工作区不会留下"刚迁移过"的提示（不打扰用户）')

  // (2) 项目 ↔ 文件夹
  const w6Projs = listProjectsWithCount()
  ok(w6Projs.length === 6, `内置 6 个预制项目（实际 ${w6Projs.length}）`)
  ok(
    w6Projs.every((p) => !!p.folder_name && existsSync(join(w6Ws, p.folder_name))),
    `每个项目在工作区里有对应文件夹：${w6Projs.map((p) => p.folder_name).join(' / ')}`
  )

  const w6New = createProject({ name: '抖音短视频运营', workspaceRoot: w6Ws })
  ok(w6New.ok, '新建项目成功')
  ok(
    existsSync(join(w6Ws, '抖音短视频运营')),
    '【软件与磁盘一致】新建项目时磁盘上立刻出现同名文件夹'
  )
  const w6BadName = createProject({ name: '_隐藏项目', workspaceRoot: w6Ws })
  ok(
    !w6BadName.ok && !!w6BadName.error && w6BadName.error.includes('下划线'),
    `以 _ 开头的项目名被拒（否则文件夹会被扫描跳过）：${w6BadName.error}`
  )
  const w6Dirty = createProject({ name: 'a<b>c:d', workspaceRoot: w6Ws })
  ok(w6Dirty.ok, `含非法字符的项目名被消毒后建成：${w6Dirty.project?.name}`)
  ok(
    !!w6Dirty.project && !/[<>:"/\\|?*]/.test(w6Dirty.project.folder_name),
    `文件夹名里没有 Windows 非法字符：${w6Dirty.project?.folder_name}`
  )

  // (3) 建包落在项目文件夹下
  const w6Plan = listProjectsWithCount().find((p) => p.name === '海南升学集训营')!
  const w6PackA = mkPack({ name: '招生海报', projectId: w6Plan.id, workspaceRoot: w6Ws })
  ok(
    w6PackA.folder_path === join(w6Ws, w6Plan.folder_name, '招生海报'),
    `包落在项目文件夹下：…\\${w6Plan.folder_name}\\招生海报`
  )
  const w6Camp = listProjectsWithCount().find((p) => p.name === '精英升学先修营')!
  const w6PackB = mkPack({ name: '招生海报', projectId: w6Camp.id, workspaceRoot: w6Ws })
  ok(
    w6PackB.folder_path === join(w6Ws, w6Camp.folder_name, '招生海报'),
    `【三级结构白送的好处】不同项目可以有同名包：…\\${w6Camp.folder_name}\\招生海报`
  )
  let w6Throw = ''
  try {
    mkPack({ name: '不该建成', projectId: 999999, workspaceRoot: w6Ws })
  } catch (e) {
    w6Throw = (e as Error).message
  }
  ok(w6Throw.includes('项目不存在'), `指定了不存在的项目 → 明确报错，不静默兜底：${w6Throw}`)

  // (4) role 判定：深度无关（版本层预留）
  writeFileSync(join(w6PackA.folder_path, '01-成品', 'a.png'), Buffer.alloc(64, 1))
  writeFileSync(join(w6PackA.folder_path, '02-素材', 'b.txt'), 'x', 'utf-8')
  writeFileSync(join(w6PackA.folder_path, '随手丢的.png'), Buffer.alloc(32, 2))
  mkdirSync(join(w6PackA.folder_path, 'V1', '01-成品'), { recursive: true })
  writeFileSync(join(w6PackA.folder_path, 'V1', '01-成品', 'c.png'), Buffer.alloc(48, 3))

  scanAll(w6Ws)
  const w6Rows = listAssets()
  const w6RoleOf = (n: string): string | undefined =>
    w6Rows.find((r) => r.file_name === n)?.role
  ok(w6RoleOf('a.png') === '成品', '项目\\包\\01-成品\\a.png → 成品')
  ok(w6RoleOf('b.txt') === '素材', '项目\\包\\02-素材\\b.txt → 素材')
  ok(w6RoleOf('随手丢的.png') === UNASSIGNED_ROLE, '包根目录下的散文件 → 未归属（仍挂在包里）')
  ok(
    w6RoleOf('c.png') === '成品',
    '【版本层预留的决定性证据】项目\\包\\V1\\01-成品\\c.png → 成品（深度无关，将来加版本层不用改代码）'
  )
  ok(
    w6Rows.find((r) => r.file_name === 'c.png')?.pack_id === w6PackA.id,
    'V1 层里的文件仍归属到该包'
  )

  // (5) 游离的包 → 待归类
  const w6Loose = join(w6Ws, '手动丢进来的包')
  for (const sub of SUB_FOLDERS) mkdirSync(join(w6Loose, sub), { recursive: true })
  writeFileSync(join(w6Loose, '01-成品', 'loose.png'), Buffer.alloc(16, 4))
  writeFileSync(join(w6Ws, w6Plan.folder_name, '项目下的散文件.txt'), 'y', 'utf-8')
  writeFileSync(join(w6Ws, '根目录散文件.txt'), 'z', 'utf-8')

  scanAll(w6Ws)
  const w6LoosePack = listPacks().find((p) => p.name === '手动丢进来的包')
  ok(!!w6LoosePack, '根目录下直接带三组文件夹的目录 → 识别为包')
  ok(w6LoosePack?.project_id === null, '【待归类】游离的包没有项目归属')
  ok(w6LoosePack?.folder_path === w6Loose, '游离包的位置就在工作区根目录')
  ok(
    !listPacks().some((p) => p.folder_path === join(w6Ws, w6Plan.folder_name)),
    '项目文件夹本身不会被误登记成包'
  )
  const w6Rows2 = listAssets()
  const w6Scatter1 = w6Rows2.find((r) => r.file_name === '项目下的散文件.txt')
  ok(
    w6Scatter1?.role === UNASSIGNED_ROLE && w6Scatter1?.pack_id === null,
    '项目文件夹下直接躺着的散文件 → 未归属池'
  )
  const w6Scatter2 = w6Rows2.find((r) => r.file_name === '根目录散文件.txt')
  ok(
    w6Scatter2?.role === UNASSIGNED_ROLE && w6Scatter2?.pack_id === null,
    '工作区根目录下的散文件 → 未归属池'
  )

  // (6) 项目改名 → 连带改文件夹名（并重写库里的路径）
  const w6Tag = createTag({ dimension: 'category', name: `改名标签${RUN_ID}`, color: '#4f8cff' })
  const w6First = getDb()
    .prepare("SELECT id FROM assets WHERE file_name = 'a.png'")
    .get() as { id: number }
  applyTags({ assetIds: [w6First.id], tagIds: [w6Tag.tag!.id] })
  const w6LinksBefore = (getDb().prepare('SELECT COUNT(*) AS c FROM asset_tags').get() as { c: number }).c
  const w6PacksBefore = (getDb().prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c
  const w6OldFolder = join(w6Ws, w6Plan.folder_name)

  const w6Ren = updateProject(w6Plan.id, { name: '海南升学集训营（南区）' }, w6Ws)
  ok(w6Ren.ok, `项目改名成功：${w6Ren.project?.name}`)
  ok(
    !!w6Ren.renamed,
    `改名连带改了磁盘文件夹：…\\${w6Ren.renamed?.from.replace(w6Ws + '\\', '')} → …\\${w6Ren.renamed?.to.replace(w6Ws + '\\', '')}`
  )
  ok(!existsSync(w6OldFolder), '旧文件夹已经不在了')
  const w6NewPlanDir = join(w6Ws, w6Ren.project!.folder_name)
  ok(existsSync(w6NewPlanDir), '新文件夹出现了')
  ok(
    existsSync(join(w6NewPlanDir, '招生海报', '01-成品', 'a.png')),
    '包和文件跟着搬过去了（一个没少）'
  )
  const w6Rows3 = listAssets()
  ok(
    w6Rows3.every((r) => !r.abs_path.toLowerCase().startsWith(w6OldFolder.toLowerCase() + '\\')),
    '库里没有一条路径还指着旧文件夹'
  )
  const w6Moved = w6Rows3.find((r) => r.file_name === 'a.png')
  ok(
    !!w6Moved && w6Moved.abs_path.toLowerCase().startsWith(w6NewPlanDir.toLowerCase()),
    `素材路径已重写到新位置：…${w6Moved?.abs_path.slice(w6Ws.length)}`
  )
  const w6LinksAfter = (getDb().prepare('SELECT COUNT(*) AS c FROM asset_tags').get() as { c: number }).c
  ok(w6LinksAfter === w6LinksBefore, `【最关键】改名后标签关联条数不变（${w6LinksAfter}）—— 标签一条没丢`)
  ok(
    (getDb().prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c === w6PacksBefore,
    `包没有重复登记（还是 ${w6PacksBefore} 个）`
  )

  // (7) 目标文件夹已存在 → 拒绝，零改动
  const w6Tmp = createProject({ name: '临时项目X', workspaceRoot: w6Ws })
  mkdirSync(join(w6Ws, '已经占了这个名'), { recursive: true })
  const w6Clash = updateProject(w6Tmp.project!.id, { name: '已经占了这个名' }, w6Ws)
  ok(
    !w6Clash.ok && !!w6Clash.error && w6Clash.error.includes('已经有一个'),
    `磁盘上已有同名文件夹 → 拒绝不覆盖：${w6Clash.error}`
  )
  ok(
    listProjectsWithCount().find((p) => p.id === w6Tmp.project!.id)?.name === '临时项目X',
    '冲突被拒后项目名没变（零改动）'
  )
  ok(existsSync(join(w6Ws, '临时项目X')), '冲突被拒后原文件夹还在')

  // (8) 删项目：包文件夹跟着走（同盘 rename）
  const w6PacksB4 = (getDb().prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c
  const w6FilesB4 = w6CountFiles(w6Ws)

  const w6CampNow = listProjectsWithCount().find((p) => p.name === '精英升学先修营')!
  const w6Common = listProjectsWithCount().find((p) => p.name === '总部')!
  const w6DelA = removeProject(w6CampNow.id, { moveTo: w6Common.id }, w6Ws)
  ok(w6DelA.ok, `删项目（转移到「${w6Common.name}」）成功，动了 ${w6DelA.moved} 个包`)
  ok(
    existsSync(join(w6Ws, w6Common.folder_name, '招生海报')),
    '包文件夹真的搬进了目标项目文件夹'
  )
  ok(
    (getDb().prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c === w6PacksB4,
    '包记录一个没少'
  )
  ok(w6CountFiles(w6Ws) === w6FilesB4, `磁盘文件一个没少（${w6FilesB4} 个）`)

  const w6Victim = listProjectsWithCount().find((p) => p.name === '总部')!
  // 用 id 而不是名字筛 —— 三级结构下不同项目可以有同名包，用名字会误伤
  const w6VictimPacks = listPacks().filter((p) => p.project_id === w6Victim.id)
  const w6VictimIds = w6VictimPacks.map((p) => p.id)
  const w6VictimNames = w6VictimPacks.map((p) => basename(p.folder_path))
  ok(w6VictimIds.length > 0, `待删项目「${w6Victim.name}」名下有 ${w6VictimIds.length} 个包`)
  const w6DelB = removeProject(w6Victim.id, { moveTo: null }, w6Ws)
  ok(w6DelB.ok && w6DelB.movedToRoot === true, `删项目并让 ${w6DelB.moved} 个包变成未归属`)
  ok(
    w6VictimNames.every((n) => existsSync(join(w6Ws, n))),
    `【待归类】包文件夹搬到了工作区根目录：${w6VictimNames.join(' / ')}`
  )
  ok(
    listPacks()
      .filter((p) => w6VictimIds.includes(p.id))
      .every((p) => p.project_id === null),
    '这些包的 project_id 已置空（界面上就是「待归类」）'
  )
  ok(w6CountFiles(w6Ws) === w6FilesB4, '两次删项目之后，磁盘文件依然一个没少')

  // (9) 安全阀：根目录读不到时，一条记录都不许删
  const w6PacksBefore9 = (getDb().prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c
  const w6AssetsBefore9 = (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c
  const w6Ghost = join(w6Root, 'not-mounted-at-all')
  const w6GhostScan = scanAll(w6Ghost)
  ok(w6GhostScan.files === 0, '扫一个根本不存在的根目录：不报错、收集到 0 个文件')
  ok(
    (getDb().prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c === w6PacksBefore9 &&
      (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c === w6AssetsBefore9,
    '【安全阀】根目录读失败时不做任何删除判定（包与素材记录一条没少）'
  )

  // (10) 一次性迁移：两级结构（包直接躺在根下）→ 三级
  const w6bRoot = join('D:\\_accept_ws', `wstest6b_${RUN_ID}`)
  const w6bWs = join(w6bRoot, 'ws')
  mkdirSync(join(w6bWs, '_system'), { recursive: true })
  for (const n of ['老包A', '老包B', '游离包']) {
    for (const sub of SUB_FOLDERS) mkdirSync(join(w6bWs, n, sub), { recursive: true })
  }
  writeFileSync(join(w6bWs, '老包A', '01-成品', '老包A-成品.txt'), 'x', 'utf-8')
  writeFileSync(join(w6bWs, '老包B', '02-素材', '老包B-素材.txt'), 'y', 'utf-8')
  writeFileSync(join(w6bWs, '游离包', '02-素材', 'free.txt'), 'f', 'utf-8')

  closeDb()
  openDb(w6bWs)
  const w6bProjs = listProjectsWithCount()
  ok(w6bProjs.length === 6, `造老库：打开时落好 6 个预制项目（实际 ${w6bProjs.length}）`)
  ok(getMeta('layout_version') === null, '造老库：还没有 layout_version 标记')
  const w6bTs = new Date().toISOString()
  const w6bIns = getDb().prepare(
    `INSERT INTO packs (name, project_id, category, folder_path, created_at, updated_at)
     VALUES (?, ?, '未分类', ?, ?, ?)`
  )
  w6bIns.run('老包A', w6bProjs[0].id, join(w6bWs, '老包A'), w6bTs, w6bTs)
  w6bIns.run('老包B', w6bProjs[1].id, join(w6bWs, '老包B'), w6bTs, w6bTs)
  scanAll(w6bWs)
  const w6bAssetsBefore = (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c
  ok(w6bAssetsBefore === 3, `造老库：登记了 ${w6bAssetsBefore} 条素材`)

  const w6bMig = ensureLayoutV3(w6bWs)
  ok(w6bMig.migrated && w6bMig.packs === 2, `迁移执行：搬了 ${w6bMig.packs} 个有归属的包`)
  ok(!existsSync(join(w6bWs, '老包A')), '老包A 已从工作区根目录搬走')
  // folder_name 是迁移时回填的，所以要重新查（造老库那一刻还是空串）
  const w6bAfter = listProjectsWithCount()
  const w6bP0 = w6bAfter.find((p) => p.id === w6bProjs[0].id)!
  const w6bP1 = w6bAfter.find((p) => p.id === w6bProjs[1].id)!
  ok(!!w6bP0.folder_name, `迁移顺手给项目回填了文件夹名：${w6bP0.folder_name}`)
  ok(
    existsSync(join(w6bWs, w6bP0.folder_name, '老包A')),
    `老包A 落在项目文件夹「${w6bP0.folder_name}」下`
  )
  ok(
    existsSync(join(w6bWs, w6bP1.folder_name, '老包B')),
    `老包B 落在项目文件夹「${w6bP1.folder_name}」下`
  )
  ok(
    existsSync(join(w6bWs, w6bP0.folder_name, '老包A', '01-成品', '老包A-成品.txt')),
    '包里的文件一个没少'
  )
  ok(
    existsSync(join(w6bWs, '游离包')),
    '【游离包不动】没有项目归属的包迁移时留在根目录（界面上仍是「待归类」）'
  )
  ok(
    (getDb().prepare("SELECT project_id FROM packs WHERE name = '游离包'").get() as {
      project_id: number | null
    }).project_id === null,
    '游离包迁移后仍然没有项目归属'
  )
  ok(getMeta('layout_version') === LAYOUT_VERSION, `迁移后标记 layout_version=${LAYOUT_VERSION}`)
  ok(!!readLayoutNotice(), '迁移后留下一次性提示标记（界面提示一次）')
  ackLayoutNotice()
  ok(!readLayoutNotice(), 'ack 之后标记被清掉 —— 提示条只出现一次')
  const w6bPackRows = getDb().prepare('SELECT folder_path FROM packs').all() as Array<{
    folder_path: string
  }>
  ok(
    w6bPackRows.every((r) => existsSync(r.folder_path)),
    '库里记录的每个包路径都真实存在（库与磁盘一致）'
  )
  const w6bAssets = getDb().prepare('SELECT abs_path FROM assets').all() as Array<{ abs_path: string }>
  ok(
    w6bAssets.every((a) => !a.abs_path.toLowerCase().startsWith(join(w6bWs, '老包').toLowerCase())),
    '素材路径也重写到了项目文件夹下'
  )
  ok(
    (getDb().prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c === w6bAssetsBefore,
    '迁移后素材条数不变'
  )
  const w6bBackupDir = join(w6bWs, '_system', 'backup')
  ok(
    existsSync(w6bBackupDir) && readdirSync(w6bBackupDir).length > 0,
    '迁移前把数据库备份到了 _system/backup/'
  )
  const w6bMig2 = ensureLayoutV3(w6bWs)
  ok(!w6bMig2.migrated && w6bMig2.packs === 0, '再跑一次迁移：零改动（幂等）')

// ============ 第 7 批 G-01：记录生命周期（方案 09） ============
  log('\n[25] 第 7 批 G-01：记录生命周期（清理 / 编辑 / 归位 / 解绑 / 回收站 / 外键）')

  hardRm(w6bRoot)

  const w7Root = join('D:\\_accept_ws', `wstest7_${RUN_ID}`)
  const w7Ws = join(w7Root, 'ws')
  mkdirSync(w7Ws, { recursive: true })

  /**
   * 数文件。这次**不跳过** `_回收站` / `_已解绑的项目` ——
   * 铁则校验就是要看"东西被挪走之后还在不在"，跳过就没意义了。
   * 只跳过软件私有的 `_system` / `_thumbs`（备份会产生新文件）。
   */
  function w7CountFiles(dir: string): number {
    if (!existsSync(dir)) return 0
    let n = 0
    for (const name of readdirSync(dir)) {
      if (name === '_system' || name === '_thumbs' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) n += w7CountFiles(p)
      else n += 1
    }
    return n
  }
  const w7TagCount = (): number =>
    (getDb().prepare('SELECT COUNT(*) AS c FROM asset_tags').get() as { c: number }).c
  const w7OrphanCount = (): number =>
    (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM asset_tags at
            WHERE at.asset_id NOT IN (SELECT id FROM assets)
               OR at.tag_id   NOT IN (SELECT id FROM tags)`
        )
        .get() as { c: number }
    ).c
  const w7PackCount = (): number =>
    (getDb().prepare('SELECT COUNT(*) AS c FROM packs').get() as { c: number }).c

  // (1) ⑥ asset_tags 补真外键（迁移 7）
  closeDb()
  openDb(w7Ws)
  initWorkspace(w7Ws)

  // 先把库造回"第 6 批的老样子"：没有外键的裸关联表 + 一条历史孤儿
  getDb().exec('DROP TABLE asset_tags')
  getDb().exec(
    `CREATE TABLE asset_tags (
       asset_id INTEGER NOT NULL,
       tag_id   INTEGER NOT NULL,
       PRIMARY KEY (asset_id, tag_id)
     )`
  )
  getDb().prepare('INSERT INTO asset_tags (asset_id, tag_id) VALUES (?, ?)').run(999999, 888888)
  const w7FkBefore = getDb().prepare('PRAGMA foreign_key_list(asset_tags)').all() as Array<unknown>
  ok(w7FkBefore.length === 0, '造场景：老的 asset_tags 一个外键都没有（第 6 批的老样子）')
  ok(w7OrphanCount() === 1, '造场景：库里有一条指向不存在素材的孤儿标签关联')

  closeDb()
  openDb(w7Ws) // ← 触发迁移 7
  const w7FkAfter = getDb().prepare('PRAGMA foreign_key_list(asset_tags)').all() as Array<{
    table: string
    on_delete: string
  }>
  ok(w7FkAfter.length === 2, `迁移 7 重建了 asset_tags：${w7FkAfter.length} 个外键`)
  ok(
    w7FkAfter.every((f) => f.on_delete === 'CASCADE'),
    '两个外键都带 ON DELETE CASCADE'
  )
  ok(w7OrphanCount() === 0, '迁移 7 把历史孤儿清干净了')

  // (2) 造数据：两个项目 + 一个带文件、带标签的包
  const w7A = createProject({ name: '生命周期-A', workspaceRoot: w7Ws })
  const w7B = createProject({ name: '生命周期-B', workspaceRoot: w7Ws })
  ok(w7A.ok && w7B.ok, '建两个项目（磁盘上立刻有同名文件夹）')
  const w7ProjA = w7A.project!
  const w7ProjB = w7B.project!

  const w7Pack0 = mkPack({ name: '包甲', projectId: w7ProjA.id, workspaceRoot: w7Ws })
  const w7PackId = w7Pack0.id
  const w7Path0 = w7Pack0.folder_path
  writeFileSync(join(w7Path0, '01-成品', '成品-甲.png'), 'a', 'utf-8')
  writeFileSync(join(w7Path0, '02-素材', '素材-甲.txt'), 'b', 'utf-8')
  writeFileSync(join(w7Path0, '随手丢.txt'), 'c', 'utf-8')
  scanAll(w7Ws)
  const w7PackAssets = getDb()
    .prepare('SELECT id FROM assets WHERE pack_id = ?')
    .all(w7PackId) as Array<{ id: number }>
  ok(w7PackAssets.length === 3, `包甲登记了 ${w7PackAssets.length} 条素材`)

  const w7Dim = listTagDimensions()[0]
  applyTags({ assetIds: w7PackAssets.map((a) => a.id), tagIds: [w7Dim.tags[0].id] })
  const w7Tags0 = w7TagCount()
  ok(w7Tags0 === 3, `给 3 条素材贴了标签（asset_tags 共 ${w7Tags0} 行）`)

  // 外键级联：删一条素材 → 它的标签关联跟着走
  const w7VictimAsset = w7PackAssets[0].id
  getDb().prepare('DELETE FROM assets WHERE id = ?').run(w7VictimAsset)
  ok(w7TagCount() === w7Tags0 - 1, '【外键】删一条素材，它的标签关联同步消失')
  ok(w7OrphanCount() === 0, '【外键】没有产生孤儿行')
  // 重新贴回来，方便后面继续用
  applyTags({ assetIds: w7PackAssets.slice(1).map((a) => a.id), tagIds: [w7Dim.tags[0].id] })
  const w7TagsBase = w7TagCount()
  const w7FilesBase = w7CountFiles(w7Ws)

  // (3) ② 只改类别 → 纯数据，不碰磁盘
  const w7R1 = updatePack(w7PackId, { category: '折页' }, w7Ws)
  ok(w7R1.ok && !w7R1.moved, '只改类别：成功且没有动磁盘')
  ok(
    (getDb().prepare('SELECT folder_path FROM packs WHERE id = ?').get(w7PackId) as {
      folder_path: string
    }).folder_path === w7Path0 &&
      existsSync(w7Path0),
    '只改类别：文件夹还在原位'
  )
  ok(
    (getDb().prepare('SELECT category FROM packs WHERE id = ?').get(w7PackId) as {
      category: string
    }).category === '折页',
    '类别落库了'
  )

  // (4) ② 改名称 → 包文件夹连带改名
  const w7R2 = updatePack(w7PackId, { name: '包甲-改名' }, w7Ws)
  ok(w7R2.ok && !!w7R2.moved, '改名称：连带改了文件夹')
  ok(!existsSync(w7Path0), '旧文件夹已经不在了')
  const w7Path1 = join(w7Ws, w7ProjA.folder_name, '包甲-改名')
  ok(existsSync(w7Path1), '新文件夹出现在项目文件夹下')
  ok(
    existsSync(join(w7Path1, '01-成品', '成品-甲.png')) &&
      existsSync(join(w7Path1, '02-素材', '素材-甲.txt')),
    '改名后文件一个不少（含子文件夹层级）'
  )
  const w7AssetPaths1 = getDb()
    .prepare('SELECT abs_path FROM assets WHERE pack_id = ?')
    .all(w7PackId) as Array<{ abs_path: string }>
  ok(
    w7AssetPaths1.every((a) => a.abs_path.toLowerCase().startsWith(w7Path1.toLowerCase())),
    '库里所有素材路径都指向新文件夹'
  )
  ok(w7TagCount() === w7TagsBase, `改名前后标签关联条数不变（${w7TagsBase}）`)
  ok(w7CountFiles(w7Ws) === w7FilesBase, '改名前后磁盘文件数不变')

  // (5) ② 改项目 → 包文件夹搬进目标项目
  const w7R3 = updatePack(w7PackId, { projectId: w7ProjB.id }, w7Ws)
  ok(w7R3.ok && !!w7R3.moved, '改项目：搬了文件夹')
  const w7Path2 = join(w7Ws, w7ProjB.folder_name, '包甲-改名')
  ok(existsSync(w7Path2), `包搬到「${w7ProjB.name}」的项目文件夹下`)
  ok(!existsSync(w7Path1), '原项目文件夹下已经没有了')
  ok(
    (getDb().prepare('SELECT project_id FROM packs WHERE id = ?').get(w7PackId) as {
      project_id: number
    }).project_id === w7ProjB.id,
    'packs.project_id 已更新'
  )
  ok(w7TagCount() === w7TagsBase, '搬项目前后标签关联条数不变')
  ok(w7CountFiles(w7Ws) === w7FilesBase, '搬项目前后磁盘文件数不变')

  // (6) ② 目标位置重名 → 自动 -2，不覆盖
  const w7Dup1 = mkPack({ name: '重名测试', projectId: w7ProjB.id, workspaceRoot: w7Ws })
  const w7Dup2 = mkPack({ name: '重名测试-临时', projectId: w7ProjB.id, workspaceRoot: w7Ws })
  const w7RDup = updatePack(w7Dup2.id, { name: '重名测试' }, w7Ws)
  ok(w7RDup.ok && !!w7RDup.moved, '改名撞上已有同名包：照样成功')
  ok(
    basename(w7RDup.moved!.to) === '重名测试-2',
    `自动加了后缀、没覆盖别人：${basename(w7RDup.moved!.to)}`
  )
  ok(existsSync(w7Dup1.folder_path), '原来那个同名包的文件夹还在')

  // (7) ③ 待归类归位：游离包（没项目）→ 选项目 → 搬进项目文件夹
  mkdirSync(join(w7Ws, '游离-测试', '01-成品'), { recursive: true })
  writeFileSync(join(w7Ws, '游离-测试', '01-成品', '游离成品.txt'), 'x', 'utf-8')
  scanAll(w7Ws)
  const w7Loose = listPacks().find((p) => p.name === '游离-测试')!
  ok(!!w7Loose && w7Loose.project_id === null, '根目录下游离的包被登记为「待归类」（project_id = null）')
  const w7FilesBeforeHome = w7CountFiles(w7Ws)
  const w7RHome = updatePack(w7Loose.id, { projectId: w7ProjA.id }, w7Ws)
  ok(w7RHome.ok, '归位成功')
  ok(
    existsSync(join(w7Ws, w7ProjA.folder_name, '游离-测试')),
    `游离包已搬进「${w7ProjA.name}」的项目文件夹`
  )
  ok(!existsSync(join(w7Ws, '游离-测试')), '工作区根目录下已经没有它了')
  ok(
    (getDb().prepare('SELECT project_id FROM packs WHERE id = ?').get(w7Loose.id) as {
      project_id: number
    }).project_id === w7ProjA.id,
    '归位后 project_id 有值了'
  )
  ok(w7CountFiles(w7Ws) === w7FilesBeforeHome, '归位前后磁盘文件数不变')

  // (8) ④ 解绑：软件里隐身、本地全留、可还原
  const w7FilesBeforeUnbind = w7CountFiles(w7Ws)
  const w7TagsBeforeUnbind = w7TagCount()
  const w7PacksOfA = listPacks().filter((p) => p.project_id === w7ProjA.id).map((p) => p.id)
  // 注意：包甲在第 (5) 步已经搬到 B 了，所以此时 A 名下只剩刚归位进来的「游离-测试」
  ok(w7PacksOfA.length === 1, `项目「${w7ProjA.name}」下有 ${w7PacksOfA.length} 个包`)

  const w7RUnbind = unbindProject(w7ProjA.id, w7Ws)
  ok(w7RUnbind.ok && w7RUnbind.packs === 1, `解绑成功：带走了 ${w7RUnbind.packs} 个包`)
  ok(
    (getDb().prepare('SELECT archived FROM projects WHERE id = ?').get(w7ProjA.id) as {
      archived: number
    }).archived === 1,
    '项目标记为 archived = 1'
  )
  ok(
    existsSync(join(w7Ws, UNBOUND_DIR, w7ProjA.folder_name)),
    `项目文件夹搬进了 ${UNBOUND_DIR}（本地文件全在）`
  )
  ok(!existsSync(join(w7Ws, w7ProjA.folder_name)), '工作区根目录下已经看不到它')
  ok(
    listPacks().every((p) => p.project_id !== w7ProjA.id),
    '【隐身】包视图里看不到这个项目的包'
  )
  ok(
    listAssets({ projectId: w7ProjA.id }).length === 0,
    '【隐身】文件视图里也筛不出它的素材'
  )
  ok(
    listProjectsWithCount().every((p) => p.id !== w7ProjA.id),
    '【隐身】左栏项目列表里没有它'
  )
  const w7UnboundList = listUnboundProjects()
  const w7UnboundA = w7UnboundList.find((p) => p.id === w7ProjA.id)!
  ok(!!w7UnboundA, '「已解绑」清单里有它')
  ok(w7UnboundA.packCount === 1, `清单里的包数对得上（${w7UnboundA.packCount}）`)
  ok(w7UnboundA.fileCount > 0 && w7UnboundA.totalSize > 0, '清单里带了文件数与占用（左栏入口要显示）')
  ok(w7CountFiles(w7Ws) === w7FilesBeforeUnbind, '解绑前后磁盘文件数不变（一个都没少）')
  ok(w7TagCount() === w7TagsBeforeUnbind, '解绑前后标签关联条数不变')

  // 回归钉子（界面验证抓出来的）：每个 IPC 调用前都会跑一遍 initWorkspace → syncProjectFolders，
  // 它绝不能给已解绑的项目在根目录重建出一个空壳文件夹 ——
  // 空壳一旦出现，「还原」就会被自己建的空壳挡住（restoreProject 见根目录同名就拒绝）。
  initWorkspace(w7Ws)
  ok(
    !existsSync(join(w7Ws, w7ProjA.folder_name)),
    '【回归】initWorkspace 之后根目录没有给已解绑项目重建空壳文件夹'
  )
  ok(
    existsSync(join(w7Ws, UNBOUND_DIR, w7ProjA.folder_name)),
    '【回归】它的文件夹仍安稳躺在 _已解绑的项目 里'
  )

  // 还原
  const w7RRestore = restoreProject(w7ProjA.id, w7Ws)
  ok(w7RRestore.ok, '还原成功')
  ok(existsSync(join(w7Ws, w7ProjA.folder_name)), '项目文件夹搬回了工作区根目录')
  ok(!existsSync(join(w7Ws, UNBOUND_DIR, w7ProjA.folder_name)), `${UNBOUND_DIR} 里已经空了`)
  ok(
    listPacks().filter((p) => p.project_id === w7ProjA.id).length === 1,
    '【回来了】包视图又能看到这个项目的包'
  )
  ok(
    listAssets({ projectId: w7ProjA.id }).length > 0,
    '【回来了】文件视图又能筛出它的素材'
  )
  ok(w7CountFiles(w7Ws) === w7FilesBeforeUnbind, '还原前后磁盘文件数不变')
  ok(w7TagCount() === w7TagsBeforeUnbind, '还原前后标签关联条数不变')

  // 拒绝解绑最后一个项目
  let w7Active = listProjectsWithCount()
  while (w7Active.length > 1) {
    const r = unbindProject(w7Active[0].id, w7Ws)
    if (!r.ok) break
    w7Active = listProjectsWithCount()
  }
  const w7LastUnbind = unbindProject(w7Active[0].id, w7Ws)
  ok(!w7LastUnbind.ok, `拒绝解绑最后一个项目：${w7LastUnbind.error}`)

  // (9) ⑤ 删除进回收站：记录删掉、文件夹进 _回收站、文件一个不少
  const w7C = createProject({ name: '生命周期-C', workspaceRoot: w7Ws })
  const w7ProjC = w7C.project!
  const w7PackC = mkPack({ name: '包丙', projectId: w7ProjC.id, workspaceRoot: w7Ws })
  writeFileSync(join(w7PackC.folder_path, '01-成品', '丙-成品.txt'), 'p', 'utf-8')
  writeFileSync(join(w7Ws, w7ProjC.folder_name, '手工丢的说明.txt'), 'q', 'utf-8')
  scanAll(w7Ws)
  const w7CGroupFiles = w7CountFiles(w7Ws)
  const w7TagsBeforeTrash = w7TagCount()

  const w7RTrash = removeProject(w7ProjC.id, { moveTo: null, toTrash: true }, w7Ws)
  ok(w7RTrash.ok && !!w7RTrash.toTrashPath, '删进回收站：成功')
  ok(
    existsSync(join(w7Ws, TRASH_DIR, w7ProjC.folder_name)),
    `整个项目文件夹搬进了 ${TRASH_DIR}`
  )
  ok(!existsSync(join(w7Ws, w7ProjC.folder_name)), '原位已经没有它了')
  ok(
    listProjectsWithCount().every((p) => p.id !== w7ProjC.id),
    '项目记录已从软件里消失'
  )
  ok(
    listPacks().every((p) => p.id !== w7PackC.id),
    `包记录也删掉了（${w7RTrash.deletedPacks} 个）`
  )
  ok(
    existsSync(join(w7Ws, TRASH_DIR, w7ProjC.folder_name!, '手工丢的说明.txt')),
    '【铁则】连没进过扫描的手工文件也跟着搬进回收站了'
  )
  ok(w7CountFiles(w7Ws) === w7CGroupFiles, '删除前后磁盘文件数不变（一个都没少）')
  ok(w7TagCount() === w7TagsBeforeTrash, '删除前后标签关联条数不变')
  ok(w7OrphanCount() === 0, '删除项目后 asset_tags 里没有孤儿行')

  // 老分支行为不变：不指定项目 → 包变「待归类」，文件都在
  const w7D = createProject({ name: '生命周期-D', workspaceRoot: w7Ws })
  const w7ProjD = w7D.project!
  const w7PackD = mkPack({ name: '包丁', projectId: w7ProjD.id, workspaceRoot: w7Ws })
  writeFileSync(join(w7PackD.folder_path, '02-素材', '丁-素材.txt'), 'd', 'utf-8')
  scanAll(w7Ws)
  const w7DGroups = w7CountFiles(w7Ws)
  const w7RD = removeProject(w7ProjD.id, { moveTo: null }, w7Ws)
  ok(w7RD.ok && w7RD.movedToRoot === true, '老分支（变成待归类）行为不变')
  ok(
    existsSync(join(w7Ws, '包丁')) && !existsSync(join(w7Ws, w7ProjD.folder_name)),
    '包文件夹搬回了工作区根目录 = 待归类'
  )
  ok(
    (getDb().prepare('SELECT project_id FROM packs WHERE id = ?').get(w7PackD.id) as {
      project_id: number | null
    }).project_id === null,
    '它的 project_id 变成 NULL 了'
  )
  ok(w7CountFiles(w7Ws) === w7DGroups, '磁盘文件数不变')

  // (10) ① 包记录自动清理
  // 注意：这里必须用一个**新建的、没被解绑的**项目 —— 不能复用 A（前面的拒绝解绑测试
  // 把它解绑了，而解绑项目的包是豁免清理的，会验不到真正的清理路径）
  const w7ProjG = createProject({ name: '生命周期-G', workspaceRoot: w7Ws }).project!
  const w7PackE = mkPack({ name: '包戊', projectId: w7ProjG.id, workspaceRoot: w7Ws })
  writeFileSync(join(w7PackE.folder_path, '01-成品', '戊.txt'), 'e', 'utf-8')
  scanAll(w7Ws)
  const w7PacksBeforeClean = w7PackCount()
  hardRm(w7PackE.folder_path) // 模拟"用户在资源管理器里把包文件夹删了"
  const w7Scan1 = scanAll(w7Ws)
  ok(w7Scan1.cleanedPacks === 1, `刷新扫描摘掉了 ${w7Scan1.cleanedPacks} 条失效的包记录`)
  ok(w7PackCount() === w7PacksBeforeClean - 1, '包记录确实少了一条')
  ok(
    !existsSync(w7PackE.folder_path) && listPacks().every((p) => p.id !== w7PackE.id),
    '这个包已经不在界面数据里了'
  )
  const w7BackupDir = join(w7Ws, '_system', 'backup')
  const w7PackJson = readdirSync(w7BackupDir).filter((f) => f.startsWith('packs-'))
  ok(w7PackJson.length > 0, `清理前留了痕：_system/backup/${w7PackJson[0]}`)
  ok(
    readFileSync(join(w7BackupDir, w7PackJson[w7PackJson.length - 1]), 'utf-8').includes('包戊'),
    '留痕文件里能查到被清掉的包名'
  )
  const w7Scan2 = scanAll(w7Ws)
  ok(w7Scan2.cleanedPacks === 0, '再扫一次：零改动（幂等）')

  // 安全阀：根目录读不到 → 一条都不清
  const w7PacksBeforeGhost = w7PackCount()
  const w7GhostScan = scanAll(join('D:\\_accept_ws', 'w7-not-mounted'))
  ok(w7GhostScan.cleanedPacks === 0, '【安全阀】根目录读失败时不做清理判定')
  ok(w7PackCount() === w7PacksBeforeGhost, '【安全阀】包记录一条没少')
  ok(w7OrphanCount() === 0, '【安全阀】素材记录也没被牵连')
  ok(
    cleanupMissingPacks(w7Ws, false) === 0,
    '【安全阀】直接把 rootReadable 传 false：清理函数一条都不清'
  )

  // 豁免：解绑项目的包，就算文件夹被人挪走也不清记录（那是留底）
  const w7ProjF = createProject({ name: '生命周期-F', workspaceRoot: w7Ws }).project!
  const w7PackF = mkPack({ name: '包己', projectId: w7ProjF.id, workspaceRoot: w7Ws })
  scanAll(w7Ws)
  unbindProject(w7ProjF.id, w7Ws)
  hardRm(join(w7Ws, UNBOUND_DIR, w7ProjF.folder_name))
  const w7Scan3 = scanAll(w7Ws)
  ok(w7Scan3.cleanedPacks === 0, `【豁免】解绑项目的包文件夹没了，记录依然保留（留底）`)
  ok(
    getDb().prepare('SELECT id FROM packs WHERE id = ?').get(w7PackF.id) !== undefined,
    '包「包己」的记录还在'
  )

  // (11) 第 7 批补：左栏标签计数口径
  //      用户实测反馈两件事：① 这个数字以前是全库口径，选了项目后跟点开的条数对不上
  //      ② 解绑项目后数字不减少 —— 属第 7 批「解绑后软件里全隐身」的漏网点
  //      （listTagDimensions 是全项目唯一没过滤 archived 的地方）。
  //      用户拍板：数字跟随当前项目范围；0 条的标签仍列出（置灰，界面层）。
  log('\n[26] 第 7 批补：标签计数口径（跟随项目 / 排除已解绑）')
  const tcA = createProject({ name: '计数-甲', workspaceRoot: w7Ws }).project!
  const tcB = createProject({ name: '计数-乙', workspaceRoot: w7Ws }).project!
  const tcPackA = mkPack({ name: '计数包甲', projectId: tcA.id, workspaceRoot: w7Ws })
  const tcPackB = mkPack({ name: '计数包乙', projectId: tcB.id, workspaceRoot: w7Ws })
  writeFileSync(join(tcPackA.folder_path, '01-成品', '甲1.png'), 'x', 'utf-8')
  writeFileSync(join(tcPackA.folder_path, '01-成品', '甲2.png'), 'x', 'utf-8')
  writeFileSync(join(tcPackB.folder_path, '01-成品', '乙1.png'), 'x', 'utf-8')
  scanAll(w7Ws)

  // 用一个专属标签，避免被前面几组老测试贴过的「海报」污染（否则"不重不漏"等式不成立）
  const tcTagRes = createTag({ dimension: 'category', name: '计数专用标签' })
  ok(tcTagRes.ok && !!tcTagRes.tag, '【布景】建了专属标签，计数不受老数据干扰')
  const tcTagId = tcTagRes.tag!.id
  const tcDim = (scope?: { projectId?: number | null }): DimensionGroup =>
    listTagDimensions(scope).find((d) => d.key === 'category')!
  const tcCount = (scope?: { projectId?: number | null }): number =>
    tcDim(scope).tags.find((t) => t.id === tcTagId)!.assetCount
  const tcListed = (): number => listAssets({ tagIds: [tcTagId] }).length

  applyTags({
    assetIds: listAssets({ packId: tcPackA.id }).map((a) => a.id),
    tagIds: [tcTagId]
  })
  applyTags({
    assetIds: listAssets({ packId: tcPackB.id }).map((a) => a.id),
    tagIds: [tcTagId]
  })

  ok(
    tcCount({ projectId: tcA.id }) === 2,
    `【口径=素材条数·按项目】「计数-甲」下标签数字 ${tcCount({ projectId: tcA.id })}（该包 2 个文件都打了）`
  )
  ok(
    tcCount({ projectId: tcB.id }) === 1,
    `【按项目】「计数-乙」下标签数字 ${tcCount({ projectId: tcB.id })}（该包 1 个文件）`
  )
  // 用户当初就是这里对不上：数字是全库、点开只有本项目那几条
  ok(
    tcCount({ projectId: tcA.id }) ===
      listAssets({ filterProjectIds: [tcA.id], tagIds: [tcTagId] }).length,
    '【一致】选「计数-甲」时：标签数字 == 点开后真列出的条数'
  )

  // 「待归类」= 没挂项目的包里的素材，不能把工作区根目录的散文件（未归属池）算进来
  const tcLooseBefore = tcCount({ projectId: null })
  const tcLooseIds = new Set(listPacks().filter((p) => p.project_id === null).map((p) => p.id))
  ok(
    tcCount({ projectId: null }) ===
      listAssets({ tagIds: [tcTagId] }).filter(
        (a) => a.pack_id !== null && tcLooseIds.has(a.pack_id)
      ).length,
    '【口径=待归类】只算没挂项目的包里的素材'
  )
  const tcAllBefore = tcCount()
  writeFileSync(join(w7Ws, '散落的海报.png'), 'x', 'utf-8')
  scanAll(w7Ws)
  const tcStray = listAssets({ keyword: '散落的海报' })
  ok(tcStray.length === 1 && tcStray[0].pack_id === null, '散文件进了「未归属」（没挂任何包）')
  applyTags({ assetIds: tcStray.map((a) => a.id), tagIds: [tcTagId] })
  ok(tcCount({ projectId: null }) === tcLooseBefore, '【待归类】根目录散文件不增加「待归类」的数字')
  ok(tcCount() === tcAllBefore + 1, `【全库】但它算进「全部」（${tcAllBefore} → ${tcCount()}）`)
  const tcStrayCount = (): number =>
    listAssets({ tagIds: [tcTagId] }).filter((a) => a.pack_id === null).length
  ok(
    tcCount() ===
      tcCount({ projectId: tcA.id }) +
        tcCount({ projectId: tcB.id }) +
        tcCount({ projectId: null }) +
        tcStrayCount(),
    '【不重不漏】全库 = 甲 + 乙 + 待归类 + 未归属散文件'
  )

  // 【回归钉子】解绑项目后各口径数字必须立刻跟着减少（原来的 bug：数字纹丝不动）
  const tcAllPreUnbind = tcCount()
  const tcListedPreUnbind = tcListed()
  unbindProject(tcB.id, w7Ws)
  ok(
    tcCount() === tcAllPreUnbind - 1,
    `【回归】解绑「计数-乙」后全库数字跟着减 1（${tcAllPreUnbind} → ${tcCount()}）`
  )
  ok(tcListed() === tcListedPreUnbind - 1, '解绑后点开列出的条数也同步减 1')
  ok(tcCount() === tcListed(), '【一致】解绑后：数字与列出的条数仍然相等')
  ok(
    tcCount({ projectId: tcB.id }) === 0,
    '【隐身】已解绑的项目按它自己的范围查是 0（套进 scope 也不会漏出来）'
  )

  // ============ 第 8 批 H-01：文件已丢失标记（M8-03）============
  log('\n[27] 第 8 批 H-01：文件已丢失标记 + 重新定位（M8-03）')

  const w8Root = join('D:\\_accept_ws', `wstest8_${RUN_ID}`)
  const w8Ws = join(w8Root, 'ws')
  hardRm(w8Root)
  mkdirSync(w8Ws, { recursive: true })
  closeDb()
  openDb(w8Ws)
  initWorkspace(w8Ws)

  const w8Row = <T,>(sql: string, ...args: unknown[]): T =>
    getDb().prepare(sql).get(...args) as T
  const w8Num = (sql: string, ...args: unknown[]): number =>
    (getDb().prepare(sql).get(...args) as { c: number }).c
  const w8AssetOf = (
    name: string
  ): { id: number; missing_at: string | null; size: number } =>
    w8Row<{ id: number; missing_at: string | null; size: number }>(
      'SELECT id, missing_at, size FROM assets WHERE file_name = ?',
      name
    )
  const w8MissingCount = (): number =>
    w8Num('SELECT COUNT(*) AS c FROM assets WHERE missing_at IS NOT NULL')
  const w8TagsOf = (name: string): number =>
    w8Num(
      `SELECT COUNT(*) AS c FROM asset_tags at
        JOIN assets a ON a.id = at.asset_id
       WHERE a.file_name = ?`,
      name
    )

  const w8ProjA = createProject({ name: '丢失-甲', workspaceRoot: w8Ws }).project!
  const w8ProjB = createProject({ name: '丢失-乙', workspaceRoot: w8Ws }).project!
  const w8PackA = mkPack({ name: '丢失包甲', projectId: w8ProjA.id, workspaceRoot: w8Ws })
  const w8PackB = mkPack({ name: '丢失包乙', projectId: w8ProjB.id, workspaceRoot: w8Ws })

  const w8F1 = join(w8PackA.folder_path, '01-成品', '甲-成品.png')
  const w8F2 = join(w8PackA.folder_path, '02-素材', '甲-素材.psd')
  const w8F3 = join(w8PackB.folder_path, '01-成品', '乙-成品.png')
  const w8Stray = join(w8Ws, '散落.png')
  writeFileSync(w8F1, 'AAAAAAAA', 'utf-8')
  writeFileSync(w8F2, 'BBBB', 'utf-8')
  writeFileSync(w8F3, 'CCCC', 'utf-8')
  writeFileSync(w8Stray, 'DDDD', 'utf-8')
  scanAll(w8Ws)
  ok(
    w8Num('SELECT COUNT(*) AS c FROM assets') === 4,
    `【布景】登记 4 个文件（甲包 2 / 乙包 1 / 根目录散文件 1）`
  )

  // ---- (1) 标记：文件丢了，记录不删 ----
  const w8TagRes = createTag({ dimension: 'category', name: '丢失专用标签' })
  const w8TagId = w8TagRes.tag!.id
  const w8F1Id = w8AssetOf('甲-成品.png').id
  applyTags({ assetIds: [w8F1Id], tagIds: [w8TagId] })
  ok(w8TagsOf('甲-成品.png') === 1, '【布景】给「甲-成品.png」贴了一个标签')

  hardRm(w8F1) // 模拟"用户在资源管理器里把文件删了 / 挪走了"
  const w8ScanA = scanAll(w8Ws)
  ok(w8ScanA.markedMissing === 1, `删掉文件后扫描标记了 ${w8ScanA.markedMissing} 条`)
  const w8AfterMark = w8AssetOf('甲-成品.png')
  ok(!!w8AfterMark && w8AfterMark.id === w8F1Id, '【核心】记录仍在且 id 没变（不再删记录）')
  ok(w8AfterMark.missing_at !== null, `【核心】打上了「文件已丢失」标记：${w8AfterMark.missing_at}`)
  ok(
    w8TagsOf('甲-成品.png') === 1,
    '【核心收益】标签关联一条没少（老实现里记录一删，CASCADE 把它一起带走了）'
  )
  ok(w8MissingCount() === 1, '全库丢失条数 = 1，没有牵连别的文件')
  ok(w8AssetOf('甲-素材.psd').missing_at === null, '同包其它文件正常，没被误标')
  ok(
    listAssets({}).length === 4,
    '【口径】丢失的素材仍出现在列表里（记录还在，只是带标记）'
  )

  // ---- (2) 重复扫描不刷新丢失时刻 ----
  const w8Stamp = w8AfterMark.missing_at
  const w8ScanB = scanAll(w8Ws)
  ok(w8ScanB.markedMissing === 0, '再扫一次：不重复标记')
  ok(
    w8AssetOf('甲-成品.png').missing_at === w8Stamp,
    '【细节】丢失时刻保持不变（保留"第一次发现"的时间，不被刷新）'
  )

  // ---- (3) 文件回来 → 自动清标记 ----
  writeFileSync(w8F1, 'AAAAAAAABBBB', 'utf-8') // 内容换了、大小也变了
  const w8ScanC = scanAll(w8Ws)
  ok(w8ScanC.restored === 1, `文件放回来：扫描恢复了 ${w8ScanC.restored} 条`)
  const w8Back = w8AssetOf('甲-成品.png')
  ok(w8Back.missing_at === null, '丢失标记自动清空（不用用户手动"取消丢失"）')
  ok(w8Back.size === 12, `大小跟着刷新成新值 ${w8Back.size} 字节`)
  ok(w8Back.id === w8F1Id && w8TagsOf('甲-成品.png') === 1, 'id 与标签关联都还在')

  // ---- (4) 门四：包文件夹整个被删 → 走包清理，连带摘素材 ----
  ok(
    w8Num('SELECT COUNT(*) AS c FROM assets WHERE pack_id = ?', w8PackA.id) === 2,
    '【布景】「丢失包甲」名下 2 条素材记录'
  )
  hardRm(w8PackA.folder_path)
  const w8ScanD = scanAll(w8Ws)
  ok(w8ScanD.cleanedPacks === 1, '包文件夹整个删掉 → 走的是包清理（摘了 1 条包记录）')
  ok(w8ScanD.markedMissing === 0, '【门四】包内素材不会被标成「已丢失」（用户删的是整包）')
  ok(
    w8Num('SELECT COUNT(*) AS c FROM assets WHERE pack_id = ?', w8PackA.id) === 0,
    '包内素材记录跟着一起摘掉了'
  )
  ok(
    w8Num(
      `SELECT COUNT(*) AS c FROM assets WHERE pack_id IS NULL AND role <> ?`,
      UNASSIGNED_ROLE
    ) === 0,
    '【关键】没有 pack_id 悬空的孤儿素材（光删包记录会留一地）'
  )
  ok(
    w8Num('SELECT COUNT(*) AS c FROM assets') === 2,
    `库里只剩乙包 1 条 + 根目录散文件 1 条（当前 ${w8Num('SELECT COUNT(*) AS c FROM assets')} 条）`
  )

  const w8BackupDir = join(w8Ws, '_system', 'backup')
  const w8BackupFiles = existsSync(w8BackupDir)
    ? readdirSync(w8BackupDir).filter((f) => f.endsWith('.json'))
    : []
  ok(w8BackupFiles.length === 1, '摘记录前留痕，生成了一份备份 JSON')
  const w8Backup = JSON.parse(
    readFileSync(join(w8BackupDir, w8BackupFiles[0]), 'utf-8')
  ) as { records: Array<{ files?: string[] }> }
  ok(
    Array.isArray(w8Backup.records?.[0]?.files) && w8Backup.records[0].files!.length === 2,
    `【留痕】包里当时有哪两个文件，JSON 里查得到：${JSON.stringify(w8Backup.records?.[0]?.files)}`
  )

  // ---- (5) 门三：解绑项目的文件"从扫描范围消失"，但不许标丢失 ----
  const w8Unbind = unbindProject(w8ProjB.id, w8Ws)
  ok(w8Unbind.ok, '【布景】解绑「丢失-乙」（文件夹搬进 _已解绑的项目）')
  const w8ScanE = scanAll(w8Ws)
  ok(w8ScanE.markedMissing === 0, '【门三】解绑当天：一条都不许标丢失')
  ok(
    w8Num('SELECT COUNT(*) AS c FROM assets WHERE pack_id = ?', w8PackB.id) === 1,
    '解绑项目的素材记录原样保留'
  )
  ok(w8AssetOf('乙-成品.png').missing_at === null, '它的丢失标记仍是 NULL')
  ok(restoreProject(w8ProjB.id, w8Ws).ok, '【布景】再还原回来')
  ok(scanAll(w8Ws).markedMissing === 0, '还原后扫描也不误标')

  // ---- (6) 门一：根目录读不到（移动硬盘拔了）→ 一条都不许标 ----
  // 真窗口里没法模拟"拔硬盘"（连 rename 工作区根都会被 SQLite 的文件句柄拦成 EPERM，实测过），
  // 所以第 5 步抽成了 markMissingAssets(rootReadable)，直接喂 false 验这道门。
  const w8Guard = markMissingAssets(false)
  ok(
    w8Guard.markedMissing === 0 && w8Guard.restored === 0,
    '【门一・安全阀】rootReadable=false 时一条都不标、一条都不恢复'
  )
  ok(w8MissingCount() === 0, '库里没有任何记录被误标')
  // 端到端再来一遍：扫一个根本不存在的根目录
  const w8GhostScan = scanAll(join(w8Root, 'not-mounted-at-all'))
  ok(
    w8GhostScan.files === 0 && w8GhostScan.markedMissing === 0 && w8MissingCount() === 0,
    '扫一个根本不存在的根目录：不报错、0 个文件、记录一条没动'
  )
  ok(scanAll(w8Ws).markedMissing === 0, '回到真目录再扫，一切正常')

  // ---- (7) 根目录散文件丢了照样标记（没有包保护） ----
  hardRm(w8Stray)
  ok(scanAll(w8Ws).markedMissing === 1, '根目录散文件丢了也标记（它没有所属包）')
  ok(w8AssetOf('散落.png').missing_at !== null, '散文件的记录仍在、带标记')

  // ---- (8) 重新定位：单条 ----
  const w8Park = join(w8Ws, '临时停放')
  mkdirSync(w8Park, { recursive: true })
  const w8StrayId = w8AssetOf('散落.png').id
  const w8StrayHome = join(w8Park, '散落.png')
  writeFileSync(w8StrayHome, 'DDDD', 'utf-8') // 与记录同大小
  const w8Reloc = relocateAsset(w8StrayId, w8StrayHome, w8Ws)
  ok(w8Reloc.ok, `单条重新定位成功 → ${w8Reloc.relPath}`)
  const w8StrayAfter = w8AssetOf('散落.png')
  ok(w8StrayAfter.missing_at === null, '丢失标记清空')
  ok(w8StrayAfter.id === w8StrayId, 'id 没变（标签 / 缩略图等关联全保留）')
  ok(
    w8Row<{ rel_path: string }>('SELECT rel_path FROM assets WHERE id = ?', w8StrayId).rel_path.startsWith(
      '临时停放'
    ),
    'rel_path 重算成了新位置'
  )
  ok(scanAll(w8Ws).markedMissing === 0, '【幂等】重新定位后再扫描，不会被重新标成丢失')

  // ---- (9) 校验：文件名 / 大小 / 工作区边界，三道都要拦住 ----
  const w8ProjC = createProject({ name: '丢失-丙', workspaceRoot: w8Ws }).project!
  const w8PackC = mkPack({ name: '丢失包丙', projectId: w8ProjC.id, workspaceRoot: w8Ws })
  const w8F4 = join(w8PackC.folder_path, '01-成品', '丙-成品.png')
  writeFileSync(w8F4, 'EEEEEEEE', 'utf-8') // 8 字节
  scanAll(w8Ws)
  hardRm(w8F4)
  ok(scanAll(w8Ws).markedMissing === 1, '【布景】丙包的文件被挪走了（8 字节的记录）')
  const w8F4Id = w8AssetOf('丙-成品.png').id

  const w8Outside = join(w8Root, '丙-成品.png') // 工作区外（w8Ws 的上一级）
  writeFileSync(w8Outside, 'EEEEEEEE', 'utf-8')
  const w8OutTry = relocateAsset(w8F4Id, w8Outside, w8Ws)
  ok(
    !w8OutTry.ok && (w8OutTry.error ?? '').includes('工作区外面'),
    `【边界】工作区外的文件被拒：${w8OutTry.error}`
  )

  const w8NameWrong = join(w8PackC.folder_path, '03-工程', '别的东西.png')
  writeFileSync(w8NameWrong, 'EEEEEEEE', 'utf-8')
  const w8NameTry = relocateAsset(w8F4Id, w8NameWrong, w8Ws)
  ok(
    !w8NameTry.ok && (w8NameTry.error ?? '').includes('文件名对不上'),
    `【判据】文件名不符被拒：${w8NameTry.error}`
  )

  const w8SizeWrong = join(w8PackC.folder_path, '02-素材', '丙-成品.png')
  writeFileSync(w8SizeWrong, 'EE', 'utf-8') // 2 字节 ≠ 记录里的 8
  const w8SizeTry = relocateAsset(w8F4Id, w8SizeWrong, w8Ws)
  ok(
    !w8SizeTry.ok && (w8SizeTry.error ?? '').includes('大小对不上'),
    `【判据】大小不符被拒（挡"选错文件"）：${w8SizeTry.error}`
  )
  ok(w8AssetOf('丙-成品.png').missing_at !== null, '三次被拒之后，记录仍是"已丢失"状态（改动一点没落）')

  const w8Good = join(w8PackC.folder_path, '03-工程', '丙-成品.png')
  writeFileSync(w8Good, 'EEEEEEEE', 'utf-8')
  const w8GoodTry = relocateAsset(w8F4Id, w8Good, w8Ws)
  ok(w8GoodTry.ok, `选对了就放行 → ${w8GoodTry.relPath}`)
  ok(w8AssetOf('丙-成品.png').missing_at === null, '标记清空、界面恢复正常')

  // ---- (10) 批量重新定位：逐级降级匹配 + 预览绝不落库 ----
  const w8ProjD = createProject({ name: '丢失-丁', workspaceRoot: w8Ws }).project!
  const w8PackD = mkPack({ name: '丢失包丁', projectId: w8ProjD.id, workspaceRoot: w8Ws })
  const w8D1 = join(w8PackD.folder_path, '01-成品', '丁-成品.png')
  const w8D2 = join(w8PackD.folder_path, '02-素材', '丁-素材.txt')
  writeFileSync(w8D1, 'FFFFFFFF', 'utf-8')
  writeFileSync(w8D2, 'GGGGGGGG', 'utf-8')
  scanAll(w8Ws)

  // 用户把这批文件整体挪到了另一个文件夹（原位删掉）
  const w8BatchDir = join(w8Ws, '整体挪到这')
  mkdirSync(w8BatchDir, { recursive: true })
  writeFileSync(join(w8BatchDir, '丁-成品.png'), 'FFFFFFFF', 'utf-8')
  writeFileSync(join(w8BatchDir, '丁-素材.txt'), 'GGGGGGGG', 'utf-8')
  hardRm(w8D1)
  hardRm(w8D2)
  ok(scanAll(w8Ws).markedMissing === 2, '【布景】两条文件同时丢失')

  const w8SuggestEmpty = suggestRelocateBatch(join(w8BatchDir, '不存在的子目录'), w8Ws)
  ok(
    w8SuggestEmpty.length === 2 && w8SuggestEmpty.every((s) => !s.ok && s.matchedPath === null),
    '选了个空目录：两条都"没配上"，不会瞎指'
  )

  const w8Suggest = suggestRelocateBatch(w8BatchDir, w8Ws)
  ok(
    w8Suggest.length === 2 && w8Suggest.every((s) => s.ok && s.matchedPath !== null),
    `【逐级降级】选对目录后两条都配上了：${w8Suggest.map((s) => s.reason).join(' / ')}`
  )
  ok(
    w8Suggest.every((s) => s.reason.includes('去掉前')),
    '命中的是"去掉前几层目录后命中"（原目录结构已不完整）'
  )
  ok(
    w8MissingCount() === 2,
    '【关键】预览只是看 —— 调用完 suggest 一条都没落库，标记还在'
  )

  const w8Apply = applyRelocateBatch(
    w8Suggest.filter((s) => s.ok).map((s) => ({ assetId: s.assetId, newAbsPath: s.matchedPath! })),
    w8Ws
  )
  ok(
    w8Apply.moved === 2 && w8Apply.errors.length === 0,
    `勾选后落库：找回 ${w8Apply.moved} 条${
      w8Apply.errors.length ? '，失败：' + w8Apply.errors.join('；') : ''
    }`
  )
  ok(w8MissingCount() === 0, '库里再也没有"已丢失"的记录了')
  ok(
    w8AssetOf('丁-成品.png').missing_at === null && w8AssetOf('丁-素材.txt').missing_at === null,
    '两条记录的标记都清空了'
  )
  ok(
    w8Num('SELECT COUNT(*) AS c FROM assets WHERE file_name = ?', '丁-成品.png') === 1 &&
      w8Num('SELECT COUNT(*) AS c FROM assets WHERE file_name = ?', '丁-素材.txt') === 1,
    '【合并】同一份文件只剩一条记录（扫描时登记的那条重复行被并掉了，不堆两份）'
  )
  ok(scanAll(w8Ws).markedMissing === 0, '【幂等】再扫一遍也不会又标丢失')

  // ============ 第 9 批 M6：版本管理（一稿 = 包文件夹下的一个文件夹）============
  log('\n[28] 第 9 批 M6：版本管理（建稿 / 收编 / 自动认 / 绑定 / 回滚 / 解绑）')

  const w9Root = join('D:\\_accept_ws', `wstest9_${RUN_ID}`)
  const w9Ws = join(w9Root, 'ws')
  hardRm(w9Root)
  mkdirSync(w9Ws, { recursive: true })
  closeDb()
  openDb(w9Ws)
  initWorkspace(w9Ws)

  const w9Num = (sql: string, ...args: unknown[]): number =>
    (getDb().prepare(sql).get(...args) as { c: number }).c
  const w9At = (
    p: string
  ): { id: number; version_id: number | null; rel_path: string } | undefined =>
    getDb()
      .prepare('SELECT id, version_id, rel_path FROM assets WHERE abs_path = ?')
      .get(p) as { id: number; version_id: number | null; rel_path: string } | undefined
  const w9Ver = (
    seq: number,
    /** 第 9 批补：库里出现第二个带稿的包之后，只按 seq 查会串包 —— 传 packId 限定 */
    packId?: number
  ): { id: number; folder_name: string; is_current: number } | undefined =>
    packId === undefined
      ? (getDb()
          .prepare('SELECT id, folder_name, is_current FROM pack_versions WHERE seq = ?')
          .get(seq) as { id: number; folder_name: string; is_current: number } | undefined)
      : (getDb()
          .prepare(
            'SELECT id, folder_name, is_current FROM pack_versions WHERE seq = ? AND pack_id = ?'
          )
          .get(seq, packId) as
          | { id: number; folder_name: string; is_current: number }
          | undefined)
  const w9Vid = (p: string): number | null => w9At(p)?.version_id ?? null
  const w9TagsOf = (name: string): number =>
    w9Num(
      `SELECT COUNT(*) AS c FROM asset_tags at
        JOIN assets a ON a.id = at.asset_id
       WHERE a.file_name = ?`,
      name
    )

  const w9Proj = createProject({ name: '版本-甲', workspaceRoot: w9Ws }).project!
  const w9Pack = mkPack({ name: '版本包甲', projectId: w9Proj.id, workspaceRoot: w9Ws })

  const w9F1 = join(w9Pack.folder_path, '01-成品', '海报.png')
  const w9F2 = join(w9Pack.folder_path, '02-素材', '底图.png')
  const w9F3 = join(w9Pack.folder_path, '03-工程', '源文件.psd')
  const w9Stray = join(w9Pack.folder_path, '随手丢在包根.png')
  writeFileSync(w9F1, 'AAAAAAAA', 'utf-8')
  writeFileSync(w9F2, 'BBBB', 'utf-8')
  writeFileSync(w9F3, 'CCCC', 'utf-8')
  writeFileSync(w9Stray, 'DDDD', 'utf-8')
  scanAll(w9Ws)
  ok(
    w9Num('SELECT COUNT(*) AS c FROM assets WHERE pack_id = ?', w9Pack.id) === 4,
    '【布景】三组各 1 个文件 + 包根散文件 1 个'
  )
  ok(w9Num('SELECT COUNT(*) AS c FROM pack_versions') === 0, '【布景】还没建任何稿（老包的样子）')

  // ---- (1) 建 V1：把包里现有的文件收进第 1 稿 ----
  const w9Tag = createTag({ dimension: 'category', name: '版本专用标签' }).tag!
  const w9F1Id = w9At(w9F1)!.id
  applyTags({ assetIds: [w9F1Id], tagIds: [w9Tag.id] })
  ok(w9TagsOf('海报.png') === 1, '【布景】给「海报.png」贴了一个标签')

  const w9V1Res = createVersion(w9Ws, { packId: w9Pack.id, note: '初稿', takeExisting: true })
  ok(
    w9V1Res.ok && w9V1Res.version?.seq === 1,
    `建 V1：${w9V1Res.ok ? 'V' + w9V1Res.version?.seq : w9V1Res.error}`
  )
  ok(w9V1Res.moved === 3, `【收编】三组里的 3 个文件搬进 V1（moved=${w9V1Res.moved}）`)
  ok(
    existsSync(join(w9Pack.folder_path, 'V1', '01-成品', '海报.png')) &&
      existsSync(join(w9Pack.folder_path, 'V1', '02-素材', '底图.png')) &&
      existsSync(join(w9Pack.folder_path, 'V1', '03-工程', '源文件.psd')),
    '【磁盘】V1 下三组各就各位（资源管理器里直接能看到）'
  )
  ok(
    !existsSync(join(w9Pack.folder_path, '01-成品', '海报.png')) && existsSync(w9Stray),
    '【铁则】旧位置空了是"搬走"；包根下的散文件一个都没动（它本来就没归类）'
  )
  const w9F1After = w9At(join(w9Pack.folder_path, 'V1', '01-成品', '海报.png'))
  ok(!!w9F1After && w9F1After.id === w9F1Id, '【关键】路径重写，asset.id 没变（不是删旧建新）')
  ok(w9TagsOf('海报.png') === 1, '【关键】标签一张没丢（id 若变，CASCADE 会把它带走）')
  ok(w9F1After!.version_id === w9V1Res.version!.id, '文件挂到了 V1 名下')
  ok(
    w9F1After!.rel_path.includes('V1') && w9F1After!.rel_path.includes('01-成品'),
    `库里的相对路径跟着改了：${w9F1After!.rel_path}`
  )
  ok(w9Ver(1)!.is_current === 1, '【新建即当前】V1 自动成为当前版本')
  ok(w9Ver(1)!.folder_name === 'V1', '文件夹名就是 V1（软件自己命的名）')

  // ---- (2) 建空 V2（默认不复制上一稿）----
  const w9V2Res = createVersion(w9Ws, { packId: w9Pack.id, note: '客户反馈：主标题太小' })
  ok(w9V2Res.ok && w9V2Res.version?.seq === 2, '建 V2')
  ok(w9V2Res.moved === 0, '【默认空】V2 里不放东西（要复制上一稿得显式勾）')
  ok(
    SUB_FOLDERS.every((f) => existsSync(join(w9Pack.folder_path, 'V2', f))),
    'V2 下自动长好 01-成品 / 02-素材 / 03-工程'
  )
  ok(w9Ver(2)!.is_current === 1, '【当前版本】新建的那稿自动成为当前')
  ok(w9Ver(1)!.is_current === 0, 'V1 的「当前」被摘掉（一个包最多一个当前）')
  ok(
    existsSync(join(w9Pack.folder_path, 'V1', '01-成品', '海报.png')),
    '【铁则】建新稿不动旧稿：V1 的文件原样还在'
  )

  // ---- (3) 用户自己在资源管理器里建 V3 → 扫描自动认 ----
  const w9V3File = join(w9Pack.folder_path, 'V3', '01-成品', '海报.png')
  mkdirSync(join(w9Pack.folder_path, 'V3', '01-成品'), { recursive: true })
  writeFileSync(w9V3File, 'EEEEEEEE', 'utf-8')
  const w9ScanV3 = scanAll(w9Ws)
  ok(w9ScanV3.newVersions === 1, `【自动认】认出了 ${w9ScanV3.newVersions} 个新稿（名字像 V3 的文件夹）`)
  ok(w9ScanV3.versionConflicts.length === 0, '这一步没有编号冲突')
  ok(w9Ver(3)?.folder_name === 'V3', 'V3 的记录建好了')
  ok(w9Vid(w9V3File) === w9Ver(3)!.id, 'V3 里的文件挂到了它名下')
  ok(w9Ver(2)!.is_current === 1, '【自动认不动当前】当前版本仍是 V2')

  // ---- (4) 名字不规范 → 不猜，靠「绑定文件夹」 ----
  const w9OddName = '最终版-客户确认'
  const w9OddFile = join(w9Pack.folder_path, w9OddName, '01-成品', '海报.png')
  mkdirSync(join(w9Pack.folder_path, w9OddName, '01-成品'), { recursive: true })
  writeFileSync(w9OddFile, 'FFFFFFFF', 'utf-8')
  scanAll(w9Ws)
  ok(w9Vid(w9OddFile) === null, '【不猜】名字不规范的文件夹不自动认，归「未分版本」')

  const w9Cands = listBindableFolders(w9Pack.id)
  ok(
    w9Cands.some((c) => c.folderName === w9OddName),
    `【候选】列出包里的可绑文件夹：${w9Cands.map((c) => c.folderName).join('、')}`
  )
  const w9OddCand = w9Cands.find((c) => c.folderName === w9OddName)!
  ok(w9OddCand.suggestedSeq === 4, `建议编号 = 下一个可用（${w9OddCand.suggestedSeq}）`)
  ok(w9OddCand.fileCount === 1, '候选里带上了这个文件夹的文件数')
  ok(!w9Cands.some((c) => c.folderName === 'V1'), '已认领的文件夹不再出现在候选里')

  const w9Bind = bindVersion(w9Ws, {
    packId: w9Pack.id,
    folderName: w9OddName,
    seq: 4,
    note: '客户确认稿'
  })
  ok(w9Bind.ok && w9Bind.version?.seq === 4, `绑定成功：${w9Bind.ok ? 'V' + w9Bind.version?.seq : w9Bind.error}`)
  ok(
    w9Vid(w9OddFile) === w9Bind.version!.id,
    '【核心】绑完文件立刻挂上这一稿（不用自己再点刷新扫描）'
  )
  ok(existsSync(join(w9Pack.folder_path, w9OddName)), '【铁则】绑定不改名、不搬文件夹')
  ok(w9Ver(2)!.is_current === 1, '【绑定不改当前】当前版本仍是 V2（补绑历史稿是常见场景）')
  ok(!bindVersion(w9Ws, { packId: w9Pack.id, folderName: w9OddName, seq: 5 }).ok, '同一个文件夹绑两次会被拦下')
  ok(!bindVersion(w9Ws, { packId: w9Pack.id, folderName: 'V1', seq: 9 }).ok, '绑一个已认领的文件夹会被拦下')
  ok(!bindVersion(w9Ws, { packId: w9Pack.id, folderName: '不存在的文件夹', seq: 9 }).ok, '绑不存在的文件夹会被拦下')
  const w9Outside = join(w9Ws, '包外面')
  mkdirSync(w9Outside, { recursive: true })
  ok(
    !bindVersion(w9Ws, { packId: w9Pack.id, folderName: '..\\包外面', seq: 9 }).ok,
    '【安全】想绑包外面的文件夹（路径穿越）会被拦下'
  )

  // ---- (5) 编号冲突：手工建 V4，但第 4 稿已经绑给别的文件夹了 ----
  const w9ConflictFile = join(w9Pack.folder_path, 'V4', '01-成品', 'x.png')
  mkdirSync(join(w9Pack.folder_path, 'V4', '01-成品'), { recursive: true })
  writeFileSync(w9ConflictFile, 'GG', 'utf-8')
  const w9ScanConflict = scanAll(w9Ws)
  ok(
    w9ScanConflict.versionConflicts.length === 1,
    `【编号冲突】不自动认 + 给出提示：${w9ScanConflict.versionConflicts[0] ?? '（没有提示！）'}`
  )
  ok(w9ScanConflict.newVersions === 0, '冲突的那个不算新稿')
  ok(w9Vid(w9ConflictFile) === null, '冲突文件夹里的文件留在「未分版本」，不硬塞进某一稿')
  const w9V4Cand = listBindableFolders(w9Pack.id).find((c) => c.folderName === 'V4')
  ok(!!w9V4Cand && w9V4Cand.suggestedSeq === 5, '冲突的文件夹仍可手工绑，建议编号避开已占用的（5）')

  // ---- (6) 设为当前版本（= 回滚）----
  ok(setCurrentVersion(w9Ver(1)!.id).ok, '把 V1 设为当前版本（回滚）')
  ok(w9Ver(1)!.is_current === 1 && w9Ver(2)!.is_current === 0, '指针指回 V1')
  ok(
    existsSync(join(w9Pack.folder_path, 'V2')) && existsSync(join(w9Pack.folder_path, 'V3')),
    '【铁则】回滚只改指针：V2 / V3 文件夹一个字符都没删'
  )
  ok(listPacks().find((p) => p.id === w9Pack.id)!.currentSeq === 1, '包卡片上的「当前」跟着变成 V1')
  ok(!setCurrentVersion(999999).ok, '设一个不存在的稿为当前会被拦下')

  // ---- (7) 解绑：只解除管理关系 ----
  ok(unbindVersion(w9Ver(3)!.id).ok, '解绑 V3')
  ok(!w9Ver(3), 'V3 的记录没了')
  ok(existsSync(join(w9Pack.folder_path, 'V3')), '【铁则】V3 文件夹还在磁盘上，一个字节没动')
  ok(w9Vid(w9V3File) === null, 'V3 里的文件回到「未分版本」')
  ok(!unbindVersion(999999).ok, '解绑不存在的稿会被拦下')
  ok(
    w9Num('SELECT COUNT(*) AS c FROM assets WHERE file_name = ?', '海报.png') === 3,
    '【不删文件】三条同名记录（V1 / V2 里搬过去的 / 最终版）都还在，只是归属不同'
  )

  // ---- (8) 当前版本被解绑 → 顺延 ----
  ok(unbindVersion(w9Ver(1)!.id).ok, '解绑当前版本 V1')
  ok(w9Ver(4)!.is_current === 1, '【顺延】当前版本自动落到剩下编号最大的 V4')
  ok(
    w9Num(
      'SELECT COUNT(*) AS c FROM pack_versions WHERE pack_id = ? AND is_current = 1',
      w9Pack.id
    ) === 1,
    '一个包永远只有一个当前版本'
  )

  // ---- (8.5) 解绑要真的生效：扫一遍不会把刚解绑的 V1 又自动认回来 ----
  // 自动认领的规则是「文件夹名像 V<数字> + 这个名字还没被认领」，而解绑**不动磁盘**——
  // 文件夹还在、名字还叫 V1。没有忽略记录的话，下一轮扫描立刻把它认成第 1 稿，
  // 用户点了「解绑」等于白点。
  const w9ScanAfterUnbind = scanAll(w9Ws)
  ok(w9ScanAfterUnbind.newVersions === 0, '【解绑生效】扫一遍不会把刚解绑的 V1 又认回来')
  ok(!w9Ver(1) && !w9Ver(3), '【解绑生效】V1 / V3 的编号仍然空着')
  ok(
    w9Num('SELECT COUNT(*) AS c FROM pack_versions WHERE pack_id = ?', w9Pack.id) === 2,
    '【解绑生效】包里仍是 2 稿（V2 / V4）'
  )
  const w9ReCand = listBindableFolders(w9Pack.id)
  ok(
    w9ReCand.some((c) => c.folderName === 'V1') && w9ReCand.some((c) => c.folderName === 'V3'),
    '【解绑可回头】解绑过的文件夹仍在「绑定」候选里，想收回管理随时能收回'
  )

  // ---- (8.6) 重新绑回来：用户主动收回 → 忽略记录作废、扫描不再重复认 ----
  const w9Rebind = bindVersion(w9Ws, { packId: w9Pack.id, folderName: 'V3', seq: 3 })
  ok(
    w9Rebind.ok,
    `把解绑过的 V3 重新绑回来：${w9Rebind.ok ? 'V' + w9Rebind.version?.seq : w9Rebind.error}`
  )
  ok(w9Vid(w9V3File) === w9Rebind.version!.id, '重新绑定后文件立刻挂上这一稿')
  const w9ScanRebind = scanAll(w9Ws)
  ok(w9ScanRebind.newVersions === 0, '【不重复建稿】重新绑定后扫描不会又建一条 V3')
  ok(
    w9Num('SELECT COUNT(*) AS c FROM pack_versions WHERE pack_id = ? AND seq = 3', w9Pack.id) === 1,
    '【不重复建稿】编号 3 只有一条记录'
  )
  ok(unbindVersion(w9Rebind.version!.id).ok, '再解绑一次（收拾干净，后面仍按 2 稿算）')

  // ---- (9) 兜底：一个当前都没有时自动顺延 ----
  getDb().prepare('UPDATE pack_versions SET is_current = 0 WHERE pack_id = ?').run(w9Pack.id)
  ensureCurrentVersion(w9Pack.id)
  ok(w9Ver(4)!.is_current === 1, '【兜底】一个当前都没有 → 自动顺延到编号最大的那一稿')

  // ---- (10) 统计口径 ----
  const w9Card = listPacks().find((p) => p.id === w9Pack.id)!
  ok(w9Card.versionCount === 2, `包卡片：共 ${w9Card.versionCount} 稿（V2 / V4）`)
  ok(w9Card.currentSeq === 4, `包卡片：当前 V${w9Card.currentSeq}`)
  ok(
    w9Card.fileCount === w9Num('SELECT COUNT(*) AS c FROM assets WHERE pack_id = ?', w9Pack.id),
    '【口径】卡片的文件数算全部（含各稿，跟容量口径一致）'
  )
  const w9Detail = getPackDetail(w9Pack.id)
  ok(w9Detail.versions.length === 2, '包详情带上了全部稿')
  ok(
    w9Detail.versions.every(
      (v) => typeof v.fileCount === 'number' && typeof v.folderExists === 'boolean'
    ),
    '每稿都带上了文件数和「文件夹还在不在」'
  )
  ok(w9Detail.versions.find((v) => v.seq === 4)!.folderExists === true, '绑定那稿的文件夹存在 → folderExists')

  // ---- (11) 只看当前稿 ----
  const w9CurOnly = listAssets({ packId: w9Pack.id, currentOnly: true })
  ok(
    w9CurOnly.length > 0 && w9CurOnly.every((a) => a.version_id === w9Ver(4)!.id),
    `【只看当前稿】只列 V4 的文件（${w9CurOnly.length} 条）`
  )
  const w9AllAssets = listAssets({ packId: w9Pack.id })
  ok(
    w9AllAssets.length > w9CurOnly.length,
    `【默认全显示】全显示 ${w9AllAssets.length} 条 > 只看当前稿 ${w9CurOnly.length} 条（不藏用户的东西）`
  )

  // ---- (12) 在某一稿视角下移动文件，要落进「那一稿」的组 ----
  // 注意路径：建 V1 时那份海报已经被「收编」搬进 V1 了，包根的 01-成品 早就空了。
  const w9V1Poster = join(w9Pack.folder_path, 'V1', '01-成品', '海报.png')
  ok(existsSync(w9V1Poster), '【布景】V1 里那份海报还在（解绑只是解除管理关系，文件没被扔）')
  ok(!existsSync(w9F1), '【布景】包根那个旧位置仍然是空的（收编是真搬走，不是复制）')
  const w9Claim = claimFiles(w9Ws, [w9V1Poster], w9Pack.id, '02-素材', w9Ver(2)!.id)
  const w9ClaimedPath = join(w9Pack.folder_path, 'V2', '02-素材', '海报.png')
  ok(
    w9Claim.moved === 1 && existsSync(w9ClaimedPath),
    '【移动带版本】在某一稿视角下移动 → 落进「那一稿」的组，不会被挪到包根'
  )
  scanAll(w9Ws)
  ok(w9Vid(w9ClaimedPath) === w9Ver(2)!.id, '扫描后版本归属仍然正确（还在 V2）')

  // ---- (13) 老包（没有版本）行为与升级前一模一样 ----
  const w9OldPack = mkPack({ name: '老包无版本', projectId: w9Proj.id, workspaceRoot: w9Ws })
  const w9OldFile = join(w9OldPack.folder_path, '01-成品', '老文件.png')
  writeFileSync(w9OldFile, 'HH', 'utf-8')
  scanAll(w9Ws)
  const w9OldCard = listPacks().find((p) => p.id === w9OldPack.id)!
  ok(w9OldCard.versionCount === 0 && w9OldCard.currentSeq === null, '【老包】没有版本 → 卡片不显示版本行')
  ok(w9Vid(w9OldFile) === null, '【老包】文件照常登记，version_id 为空')
  ok(
    w9Num('SELECT COUNT(*) AS c FROM assets WHERE pack_id = ?', w9OldPack.id) === 1,
    '【老包】文件数与升级前一模一样'
  )
  ok(getPackDetail(w9OldPack.id).versions.length === 0, '老包的详情里没有稿')

  // ---- (14) 幂等 + 全库映射 ----
  const w9ScanIdle = scanAll(w9Ws)
  ok(w9ScanIdle.newVersions === 0, '【幂等】再扫一遍不会重复建稿')
  ok(w9Num('SELECT COUNT(*) AS c FROM pack_versions') === 2, '库里一共 2 稿（V2 / V4）')
  const w9Map = listVersionMap()
  ok(
    w9Map.length === 2 && w9Map.some((v) => v.seq === 2) && w9Map.some((v) => v.seq === 4),
    '全库稿映射可用（界面给文件行打 V2/V4 徽标用）'
  )

  // ---- (15) 新建包自带第一稿 V1（用户拍板：「所有新建的包都从 V1 开始」）----
  // 之前是"先建个空包 → 再手动建第 1 稿"两步走，没必要：
  // 建包时直接把 `包\V1\三组` 长好，V1 自动成为当前版本。
  const w9AutoPack = createPack({ name: '自动带稿包', projectId: w9Proj.id, workspaceRoot: w9Ws })
  const w9AutoCard = listPacks().find((p) => p.id === w9AutoPack.id)!
  ok(
    w9Num('SELECT COUNT(*) AS c FROM pack_versions WHERE pack_id = ?', w9AutoPack.id) === 1,
    '【新建即带稿】建完包库里就有 1 条稿记录，不用再手工建'
  )
  ok(
    w9Num(
      'SELECT COUNT(*) AS c FROM pack_versions WHERE pack_id = ? AND seq = 1 AND is_current = 1',
      w9AutoPack.id
    ) === 1,
    '【新建即带稿】它就是第 1 稿、并且直接是当前版本'
  )
  ok(
    w9Num(
      'SELECT COUNT(*) AS c FROM pack_versions WHERE pack_id = ? AND folder_name = ?',
      w9AutoPack.id,
      FIRST_VERSION_FOLDER
    ) === 1,
    `【新建即带稿】文件夹名就是 ${FIRST_VERSION_FOLDER}（软件自己命的，用户不用想）`
  )
  ok(
    SUB_FOLDERS.every((f) => existsSync(join(w9AutoPack.folder_path, FIRST_VERSION_FOLDER, f))),
    '【磁盘】V1 下三组已经长好，资源管理器里直接能用'
  )
  ok(
    !SUB_FOLDERS.some((f) => existsSync(join(w9AutoPack.folder_path, f))),
    '【磁盘】包根不再直接放三组（不然会多出 3 个永远空着的文件夹）'
  )
  ok(
    w9AutoCard.versionCount === 1 && w9AutoCard.currentSeq === 1,
    `【卡片】新包直接显示「V1 当前 · 1 稿」（${w9AutoCard.versionCount} 稿 / V${w9AutoCard.currentSeq}）`
  )
  ok(getPackDetail(w9AutoPack.id).versions.length === 1, '包详情里直接就有这一稿')

  // 往 V1 里丢文件 → 扫描认它是第 1 稿的文件（不用再手工建稿、收编）
  const w9AutoFile = join(w9AutoPack.folder_path, FIRST_VERSION_FOLDER, '01-成品', '新包成品.png')
  writeFileSync(w9AutoFile, 'II', 'utf-8')
  scanAll(w9Ws)
  ok(w9Vid(w9AutoFile) === w9Ver(1, w9AutoPack.id)!.id, '丢进 V1 的文件自动归第 1 稿')

  // 认领（界面「未归属」→ 认领进这个包）：不指定稿 → 自动落进当前版本 V1
  const w9Stray2 = join(w9Ws, '待认领-海报.png')
  writeFileSync(w9Stray2, 'JJJ', 'utf-8')
  scanAll(w9Ws)
  const w9ClaimAuto = claimFiles(w9Ws, [w9Stray2], w9AutoPack.id, '02-素材')
  const w9Claimed2 = join(w9AutoPack.folder_path, FIRST_VERSION_FOLDER, '02-素材', '待认领-海报.png')
  ok(
    w9ClaimAuto.moved === 1 && existsSync(w9Claimed2),
    '【认领】认领进新包的文件落在 V1 里，不是落包根变成"未分版本"的孤儿'
  )
  ok(w9Vid(w9Claimed2) === w9Ver(1, w9AutoPack.id)!.id, '【认领】认领进来的文件直接挂上第 1 稿')

  // 老包那一套照旧：明确要「未分版本」时（传 null）仍落包根三组
  const w9ClaimNull = claimFiles(w9Ws, [w9AutoFile], w9AutoPack.id, '01-成品', null)
  ok(
    w9ClaimNull.moved === 1 &&
      existsSync(join(w9AutoPack.folder_path, '01-成品', '新包成品.png')) &&
      w9Vid(join(w9AutoPack.folder_path, '01-成品', '新包成品.png')) === null,
    '【显式未分版本】传 null 时落包根三组、version_id 为空（老结构的逃生口还在）'
  )

  // 在这个包上再建一稿 → 编号接着 V2
  const w9AutoV2 = createVersion(w9Ws, { packId: w9AutoPack.id, note: '第二稿' })
  ok(w9AutoV2.ok && w9AutoV2.version?.seq === 2, '新包上再建一稿 → 编号接着 V2（不会又建一个 V1）')
  ok(
    w9Ver(2, w9AutoPack.id)!.is_current === 1 && w9Ver(1, w9AutoPack.id)!.is_current === 0,
    '【当前】新稿成为当前，V1 让位'
  )

  // ============ 第 10 批：物料类别清单合一（建包清单 = 左栏标签维度）============
  log('\n[29] 第 10 批：建包类别清单与左栏「物料类别」同源（改名 / 删除联动包）')

  const eRoot = join('D:\\_accept_ws', `wstest10_${RUN_ID}`)
  const eWs = join(eRoot, 'ws')
  hardRm(eRoot)
  mkdirSync(eWs, { recursive: true })
  closeDb()
  openDb(eWs)
  initWorkspace(eWs)

  /** 包当前的类别 */
  const eCat = (packId: number): string =>
    (getDb().prepare('SELECT category FROM packs WHERE id = ?').get(packId) as { category: string })
      .category
  /** 快照：当前「物料类别」维度下的标签名 —— 就是建包弹窗能选到的那些 */
  const eList = (): string[] =>
    (listTagDimensions().find((d) => d.key === 'category')?.tags ?? []).map((t) => t.name)

  const eProj = createProject({ name: '类别-甲', workspaceRoot: eWs }).project!

  // ---- (1) 两套合一：建包能选的 = 左栏「物料类别」里的（用户实测报的就是这两处不同步）----
  const eBase = eList()
  ok(
    eBase.includes('海报') && eBase.includes('KV-喷绘印刷') && eBase.includes('单页'),
    `【同源】建包清单就是左栏这一套（${eBase.length} 项：${eBase.join('、')}）`
  )
  ok(
    !eBase.includes('视频') && !eBase.includes('推文配图') && !eBase.includes('PPT'),
    '【关键】原来那套写死的清单（视频 / 推文配图 / PPT）已经不存在了 —— 全软件只剩一套'
  )
  const eNewTag = createTag({ dimension: 'category', name: '易拉宝' }).tag!
  ok(eList().includes('易拉宝'), '【实时】左栏新加一个「易拉宝」→ 建包清单当场就有（不用重启）')

  // ---- (2) 建包选哪个类别，包上就记哪个 ----
  const ePackA = createPack({
    name: '类别包甲',
    projectId: eProj.id,
    category: '易拉宝',
    workspaceRoot: eWs
  })
  const ePackB = createPack({
    name: '类别包乙',
    projectId: eProj.id,
    category: '易拉宝',
    workspaceRoot: eWs
  })
  const ePackC = createPack({
    name: '类别包丙',
    projectId: eProj.id,
    category: '海报',
    workspaceRoot: eWs
  })
  ok(
    eCat(ePackA.id) === '易拉宝' && eCat(ePackC.id) === '海报',
    '建包选什么类别，包上就记什么（甲/乙 = 易拉宝，丙 = 海报）'
  )

  // ---- (3) 删除前能问出「有多少个包在用这个类别」----
  const eUsage = tagUsage(eNewTag.id)
  ok(
    eUsage.packCount === 2,
    `删前查得到：${eUsage.packCount} 个包正在用「易拉宝」（界面确认弹窗就是拿这个数字说话）`
  )
  const eChTag = createTag({ dimension: 'channel', name: '类别测试渠道' }).tag!
  ok(tagUsage(eChTag.id).packCount === 0, '【只算类别维度】渠道标签的包计数恒为 0（包跟它无关）')

  // ---- (4) 改名 → 已有包的类别跟着改（不留"面板里查不到的老名字"）----
  const eRename = updateTag(eNewTag.id, { name: '易拉宝-大展架' })
  ok(
    eRename.ok && eRename.packsUpdated === 2,
    `改名：${eRename.packsUpdated} 个包的类别跟着改了`
  )
  ok(
    eCat(ePackA.id) === '易拉宝-大展架' && eCat(ePackB.id) === '易拉宝-大展架',
    '两个包的类别都是新名字'
  )
  ok(eCat(ePackC.id) === '海报', '【边界】没用到这个类别的包一个没动（丙还是「海报」）')
  ok(
    eList().includes('易拉宝-大展架') && !eList().includes('易拉宝'),
    '清单里也只剩新名字（没有老名字的残影）'
  )

  // ---- (5) 跨维度同名：改 / 删「渠道」维度的同名标签，包一根毫毛都不动 ----
  const eChPoster = createTag({ dimension: 'channel', name: '海报' }).tag!
  ok(!!eChPoster, '【布景】渠道维度里也放一个叫「海报」的标签（跨维度允许同名）')
  const eChRename = updateTag(eChPoster.id, { name: '海报（渠道）' })
  ok(eChRename.ok && eChRename.packsUpdated === 0, '改渠道维度的同名标签 → 0 个包受影响')
  ok(eCat(ePackC.id) === '海报', '【关键】包丙的类别纹丝不动（只认「物料类别」这一个维度）')
  const eDelCh = removeTag(eChPoster.id)
  ok(
    eDelCh.ok && eDelCh.packsAffected === 0 && eCat(ePackC.id) === '海报',
    `【关键】删渠道维度的同名标签，0 个包受影响、包丙的类别照样不动（packsAffected=${eDelCh.packsAffected}）`
  )

  // ---- (6) 删除 → 用它的包类别归「未分类」----
  const eDel = removeTag(eNewTag.id)
  ok(
    eDel.ok && eDel.packsAffected === 2,
    `确认删除后：${eDel.packsAffected} 个包的类别归到「未分类」`
  )
  ok(eCat(ePackA.id) === '未分类' && eCat(ePackB.id) === '未分类', '两个包都成了「未分类」')
  ok(!eList().includes('易拉宝-大展架'), '清单里也没有这一项了')
  ok(eCat(ePackC.id) === '海报', '【边界】没用到它的包还是「海报」')

  // ---- (7) 联动是全库的：项目已解绑（界面上隐身的）包，类别也照样跟着改 ----
  const eTagD = createTag({ dimension: 'category', name: '解绑也要跟' }).tag!
  const ePackD = createPack({
    name: '解绑包丁',
    projectId: eProj.id,
    category: '解绑也要跟',
    workspaceRoot: eWs
  })
  getDb().prepare('UPDATE projects SET archived = 1 WHERE id = ?').run(eProj.id)
  const eDelD = removeTag(eTagD.id)
  ok(
    eDelD.packsAffected === 1 && eCat(ePackD.id) === '未分类',
    '【全库】项目已解绑、界面上隐身的包，类别也照样跟着改（将来重新绑定回来不会留个查不到的名字）'
  )
  getDb().prepare('UPDATE projects SET archived = 0 WHERE id = ?').run(eProj.id)

  // ---- (8) 类别被删光也不崩：建包记「未分类」，重扫不会重置 ----
  for (const t of listTagDimensions().find((d) => d.key === 'category')!.tags) removeTag(t.id)
  ok(eList().length === 0, '【布景】「物料类别」这一维度被清空')
  const ePackE = createPack({ name: '空类别包', projectId: null, category: '', workspaceRoot: eWs })
  ok(eCat(ePackE.id) === '未分类', '清单空着也能建包 → 记「未分类」，不报错不崩')
  scanAll(eWs)
  ok(eCat(ePackE.id) === '未分类', '【回归】重新扫描不会把包的类别重置回默认值')

  // ---- (9) 手工在资源管理器建的包文件夹被扫进来 → 类别记「未分类」----
  const eManual = join(eWs, '手工建的包')
  mkdirSync(join(eManual, '01-成品'), { recursive: true })
  scanAll(eWs)
  const eManualRow = getDb()
    .prepare('SELECT id, category FROM packs WHERE folder_path = ?')
    .get(eManual) as { id: number; category: string } | undefined
  ok(
    !!eManualRow && eManualRow.category === '未分类',
    '【兜底】手工建的包文件夹被扫进来时类别记「未分类」（不是空串）'
  )

  // ============ 第 13 批 T-01：工单表迁移 10（方案 15 §5） ============
  log('\n[30] 第 13 批：tickets 表迁移（唯一键=审批单编号，sheet_id 只是出生地属性）')
  {
    const tRoot = join('D:\\_accept_ws', `wstest13_${RUN_ID}`)
    const tWs = join(tRoot, 'ws')
    hardRm(tRoot)
    mkdirSync(tWs, { recursive: true })
    closeDb()
    openDb(tWs)
    initWorkspace(tWs)

    // ---- (1) 全部列都在（含 §3.1 的 reviewer_names / material_category 和撞号兜底 dup_json）----
    const tCols = getDb().prepare('PRAGMA table_info(tickets)').all() as Array<{ name: string }>
    const tNeed = [
      'id', 'sheet_id', 'ticket_type', 'ticket_no', 'record_id',
      'title', 'approval_state', 'applicant_userid', 'applicant_name', 'department',
      'purpose', 'size_text', 'print_qty', 'material_form', 'use_scene',
      'due_date', 'submit_time', 'done_time', 'remark', 'source_url', 'approval_url',
      'receiver_name', 'receiver_phone', 'deliver_date',
      'designer_userid', 'designer_name', 'project_name',
      'reviewer_names', 'material_category', 'raw_json', 'dup_json',
      'first_seen_at', 'last_sync_at', 'is_history', 'dup_warn',
      'reassigned_to', 'row_gone', 'need_confirm', 'pack_id', 'print_status'
    ]
    const tMissing = tNeed.filter((c) => !tCols.some((x) => x.name === c))
    ok(tCols.length > 0 && tMissing.length === 0, `tickets 表列齐全（${tCols.length} 列${tMissing.length ? '，缺: ' + tMissing.join(',') : ''}）`)

    // ---- (2) 唯一键 = ticket_no 单键（不是「子表+编号」组合键 —— 重新拉表防重复，§2.2①）----
    const tUk = getDb()
      .prepare("SELECT name FROM pragma_index_list('tickets') WHERE origin = 'u'")
      .all() as Array<{ name: string }>
    const tUkCols = tUk.flatMap((u) =>
      (getDb().prepare(`PRAGMA index_info('${u.name}')`).all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    )
    ok(
      tUk.length === 1 && tUkCols.length === 1 && tUkCols[0] === 'ticket_no',
      `唯一键 = ticket_no 单键（列：${tUkCols.join(',')}，不是「子表+编号」组合键）`
    )

    // ---- (3) 唯一键真的拦得住：同编号插第二行必须被拒 ----
    const tIns = getDb().prepare(
      `INSERT INTO tickets (sheet_id, ticket_type, ticket_no, title) VALUES (?, ?, ?, ?)`
    )
    tIns.run('sheetAAA', 'print', '202610010001', '测试单甲')
    let tDupThrew = false
    try {
      tIns.run('sheetBBB', 'print', '202610010001', '测试单甲-撞号')
    } catch {
      tDupThrew = true
    }
    ok(tDupThrew, '同编号第二行被唯一键拦下（撞号处理是同步引擎层的事：dup_warn + dup_json，绝不悄悄合并）')

    // ---- (4) 默认值：同步状态四件套 ----
    const tRow = getDb()
      .prepare('SELECT * FROM tickets WHERE ticket_no = ?')
      .get('202610010001') as Record<string, unknown>
    ok(
      tRow.is_history === 0 && tRow.dup_warn === 0 && tRow.row_gone === 0 && tRow.need_confirm === 0,
      '同步状态默认值：is_history / dup_warn / row_gone / need_confirm 全 0'
    )

    // ---- (5) pack_id 外键 ON DELETE SET NULL：任务删了 → 关联自动清空，工单永远留底 ----
    const tPack = createPack({ name: '工单的包', projectId: null, category: '', workspaceRoot: tWs })
    getDb().prepare('UPDATE tickets SET pack_id = ? WHERE ticket_no = ?').run(tPack.id, '202610010001')
    getDb().prepare('DELETE FROM packs WHERE id = ?').run(tPack.id)
    const tAfter = getDb()
      .prepare('SELECT pack_id FROM tickets WHERE ticket_no = ?')
      .get('202610010001') as { pack_id: number | null }
    ok(tAfter.pack_id === null, '任务被删 → ticket.pack_id 自动置 NULL（工单记录本身永远留底）')

    // ---- (6) 查询索引在位（「我的」筛选 / 任务关联 / 状态筛选）----
    const tIdx = (getDb().prepare('PRAGMA index_list(tickets)').all() as Array<{ name: string }>).map(
      (i) => i.name
    )
    ok(
      ['idx_tickets_designer', 'idx_tickets_pack', 'idx_tickets_state'].every((n) => tIdx.includes(n)),
      '索引在位：designer / pack / state'
    )

    // ---- (7) meta 表可存工单配置（docid / 子表映射 / 本机身份 / 快照打点）----
    setMeta('ticket_docid', 's3_TESTDOCID')
    setMeta('ticket_first_sync_done', '1')
    ok(
      getMeta('ticket_docid') === 's3_TESTDOCID' && getMeta('ticket_first_sync_done') === '1',
      'meta 表工单配置键读写正常（跟工作区走）'
    )

    closeDb()
    hardRm(tRoot)
  }

  // ============ 第 13 批 T-02：同步引擎（方案 15 §4，全部喂假数据，不碰真企微） ============
  log('\n[31] 第 13 批：同步引擎 applySync（幂等 / 快照 / 条件链 / 改派 / 删行 / 撞号 / 重拉表）')
  // 第 13 批验收返修（2026-10-01 晨）：链接取值 —— 超链接单元格必须拿真实网址，不是显示文字
  ok(
    takeLink([{ text: '点击查看', link: 'https://example.com/a' }]) === 'https://example.com/a',
    'takeLink：超链接单元格取 link 不取显示文字'
  )
  ok(takeLink([{ text: '点击查看' }]) === null, 'takeLink：没有合法网址 → null（按钮置灰）')
  ok(takeLink('https://doc.weixin.qq.com/x') === 'https://doc.weixin.qq.com/x', 'takeLink：纯文本网址照收')
  {
    const kRoot = join('D:\\_accept_ws', `wstest13b_${RUN_ID}`)
    const kWs = join(kRoot, 'ws')
    hardRm(kRoot)
    mkdirSync(kWs, { recursive: true })
    closeDb()
    openDb(kWs)
    initWorkspace(kWs)

    /** 造一条假记录（企微智能表格的 values 结构） */
    const kRec = (no: string, over: Record<string, unknown> = {}): TicketRawRecord => ({
      record_id: `rec_${no}`,
      values: {
        审批单编号: [{ text: no }],
        物料名称: [{ text: `物料-${no}` }],
        当前审批状态: [{ text: '审批中' }],
        设计师: [{ userId: 'uME', userName: '本机测试员' }],
        业务归属: [{ text: '工单测试项目' }],
        ...over
      }
    })
    const kPayload = (records: TicketRawRecord[], sheetId = 'sheetP'): SheetPayload => ({
      sheet_id: sheetId,
      title: '营销物料设计申请（印刷物料）',
      type: 'print',
      records
    })
    const kIdentity = { userid: 'uME', name: '本机测试员' }
    const kCfg: TicketSheetConfig[] = [
      { title: '营销物料设计申请（印刷物料）', sheet_id: 'sheetP', type: 'print', enabled: true }
    ]
    const kTicket = (no: string): Record<string, unknown> =>
      getDb().prepare('SELECT * FROM tickets WHERE ticket_no = ?').get(no) as Record<string, unknown>

    const kProj = createProject({ name: '工单测试项目', workspaceRoot: kWs }).project!

    // ---- (1) 首次同步快照（§2.2③）：表里已有的全标历史，一张任务都不建 ----
    const kS1 = applySync({
      payloads: [kPayload([kRec('T0001'), kRec('T0002'), kRec('T0003')])],
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    ok(
      kS1.inserted === 3 && kS1.historyMarked === 3 && kS1.tasksCreated === 0,
      `首次同步快照：3 张全标历史、零任务（inserted=${kS1.inserted}, history=${kS1.historyMarked}, tasks=${kS1.tasksCreated}）`
    )
    ok(kTicket('T0001').is_history === 1, 'T0001 标了 is_history=1（永不自动建任务）')
    ok(getMeta(META_KEYS.firstSyncDone) === '1', '首次同步打点已置位')

    // ---- (2) 幂等：同一批再同步一遍 → 只更新不重复 ----
    const kS2 = applySync({
      payloads: [kPayload([kRec('T0001'), kRec('T0002'), kRec('T0003')])],
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    const kTotal = (
      getDb().prepare('SELECT COUNT(*) AS c FROM tickets').get() as { c: number }
    ).c
    ok(
      kS2.inserted === 0 && kS2.updated === 3 && kTotal === 3,
      `幂等：第二次同步 0 插入 3 更新，表里还是 3 行（inserted=${kS2.inserted}, updated=${kS2.updated}, total=${kTotal}）`
    )

    // ---- (3) 建任务条件链（§2.2②：审批中/已通过建；驳回/撤销/别人的/历史的不建）----
    const kS3 = applySync({
      payloads: [
        kPayload([
          kRec('T0010'),                                            // 审批中 + 我 → 建
          kRec('T0011', { 当前审批状态: [{ text: '已通过' }] }),     // 已通过 + 我 → 建
          kRec('T0012', { 当前审批状态: [{ text: '已驳回' }] }),     // 驳回 → 不建
          kRec('T0013', { 当前审批状态: [{ text: '已撤销' }] }),     // 撤销 → 不建
          kRec('T0014', { 设计师: [{ userId: 'uOTHER', userName: '别人' }] }), // 别人的 → 不建
          kRec('T0015', { 设计师: [] })                             // 未指派 → 不建
        ])
      ],
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    ok(
      kS3.tasksCreated === 2,
      `条件链：6 张新单只建 2 个任务（审批中✅ 已通过✅；驳回/撤销/别人/未指派❌）`
    )
    ok(kTicket('T0010').pack_id !== null && kTicket('T0011').pack_id !== null, 'T0010/T0011 都关联上了任务')
    ok(kTicket('T0012').pack_id === null && kTicket('T0014').pack_id === null, 'T0012/T0014 没建任务')
    const kPack10 = getDb()
      .prepare('SELECT p.id, p.project_id FROM packs p JOIN tickets t ON t.pack_id = p.id WHERE t.ticket_no = ?')
      .get('T0010') as { id: number; project_id: number }
    ok(kPack10.project_id === kProj.id, '任务落对了项目（业务归属 → 同名项目）')
    ok(existsSync(join(kWs, kProj.folder_name, '物料-T0010', 'V1')), '磁盘上长出了任务文件夹（包\\V1）')

    // ---- (4) 项目未匹配 → 暂不建任务，项目对齐后下轮自动补建 ----
    const kS4a = applySync({
      payloads: [kPayload([kRec('T0020', { 业务归属: [{ text: '不存在的项目' }] })])],
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    ok(
      kS4a.tasksCreated === 0 && kS4a.projectMismatch === 1 && kTicket('T0020').pack_id === null,
      '项目对不上 → 暂不建任务（createPack 的兜底会塞第一个项目，宁可不建）'
    )
    createProject({ name: '不存在的项目', workspaceRoot: kWs })
    const kS4b = applySync({
      payloads: [kPayload([kRec('T0020', { 业务归属: [{ text: '不存在的项目' }] })])],
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    ok(
      kS4b.tasksCreated === 1 && kTicket('T0020').pack_id !== null,
      '项目名对齐后，下一轮同步自动补建任务'
    )

    // ---- (5) 改派不删任务（§4.2 步骤4）----
    const kS5 = applySync({
      payloads: [
        kPayload([kRec('T0010', { 设计师: [{ userId: 'uOTHER', userName: '新设计师' }] })])
      ],
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    const kT5 = kTicket('T0010')
    ok(
      kS5.reassigned === 1 && kT5.pack_id !== null && kT5.reassigned_to === '新设计师',
      '改派：任务不删、文件夹还在，工单标「已改派给新设计师」'
    )
    ok(existsSync(join(kWs, kProj.folder_name, '物料-T0010', 'V1')), '改派后磁盘文件一个没动')
    // 改回本机 → 改派标记清掉
    applySync({
      payloads: [kPayload([kRec('T0010')])],
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    ok(kTicket('T0010').reassigned_to === null, '设计师改回本机 → 改派标记自动清掉')

    // ---- (6) 删行留底 + 行回来恢复（§4.2 步骤5）----
    applySync({
      payloads: [kPayload([kRec('T0011')])], // T0010/T0012… 不在这次的批里
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    ok(
      kTicket('T0012').row_gone === 1 && kTicket('T0012').pack_id === null && kTicket('T0010').row_gone === 1,
      '表里删了行 → 工单留底标「已不在表中」（关联任务不动）'
    )
    applySync({
      payloads: [kPayload([kRec('T0010'), kRec('T0012')])],
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    ok(kTicket('T0010').row_gone === 0 && kTicket('T0012').row_gone === 0, '行回来 → 标记自动清掉')

    // ---- (7) 批内撞号：两份都留 + dup_warn（§2.2①）----
    const kS7 = applySync({
      payloads: [
        kPayload([
          kRec('T0030', { 物料名称: [{ text: '第一份' }] }),
          { ...kRec('T0030', { 物料名称: [{ text: '第二份' }] }), record_id: 'rec_T0030_b' }
        ])
      ],
      structureChanged: false,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    const kT7 = kTicket('T0030')
    ok(
      kS7.dupWarned === 1 && kT7.dup_warn === 1 && (kT7.dup_json as string).includes('第二份'),
      '撞号：dup_warn=1、第二份原文进 dup_json（绝不悄悄合并/丢弃）'
    )
    ok(kS7.warnings.some((w) => w.includes('T0030')), '撞号进了警告清单（用户能看到）')

    // ---- (8) 字段缺失不崩（§4.4）----
    let kS8ok = true
    try {
      const kS8 = applySync({
        payloads: [
          kPayload([{ record_id: 'rec_bare', values: { 审批单编号: [{ text: 'T0040' }] } }])
        ],
        structureChanged: false,
        identity: kIdentity,
        workspaceRoot: kWs
      })
      kS8ok = kS8.ok && kTicket('T0040').title === null
    } catch {
      kS8ok = false
    }
    ok(kS8ok, '只有编号、别的列全缺 → 照常入库、字段置空、不崩')

    // ---- (9) 重新拉表（§2.2④）：sheet_id 变 → 旧单原地更新零重复，新单标待确认 ----
    const kCheck = detectStructure(kCfg, [
      { sheet_id: 'sheetNEW', title: '营销物料设计申请（印刷物料）' }
    ])
    ok(kCheck.structureChanged && kCheck.resolved[0].sheet_id === 'sheetNEW', '结构校验：标题对上、sheet_id 变了 → 检出重建')

    const kCheckMissing = detectStructure(kCfg, [{ sheet_id: 'sheetX', title: '别的表' }])
    ok(
      kCheckMissing.missingSheets.length === 1 && kCheckMissing.structureChanged === false,
      '结构校验：标题找不到 → missingSheets（不算重建）'
    )

    const kS9 = applySync({
      payloads: [
        {
          sheet_id: 'sheetNEW',
          title: '营销物料设计申请（印刷物料）',
          type: 'print' as const,
          records: [
            kRec('T0010'),          // 旧单：应该原地更新
            kRec('T0050'),          // 新单：应该标待确认、不建任务
            kRec('T0051', { 当前审批状态: [{ text: '已通过' }] }) // 新单：同样待确认
          ]
        }
      ],
      structureChanged: true,
      identity: kIdentity,
      workspaceRoot: kWs
    })
    const kCount10 = (
      getDb().prepare("SELECT COUNT(*) AS c FROM tickets WHERE ticket_no = 'T0010'").get() as { c: number }
    ).c
    ok(
      kCount10 === 1 && kS9.updated >= 1 && kS9.inserted === 2,
      `重拉表：旧编号 T0010 原地更新、库里还是 1 行（不重复入库）`
    )
    ok(
      kTicket('T0050').need_confirm === 1 && kTicket('T0051').need_confirm === 1 && kS9.tasksCreated === 0,
      '重拉表后新出现的编号全标「待确认」、零任务自动建（宁可不建，绝不误建）'
    )
    ok(kTicket('T0010').pack_id !== null, '重拉表后已建的任务关联原封不动')

    // ---- (10) 「确认这批新单」放行（§2.2④）----
    const kS10 = confirmPendingTickets(kIdentity, kWs)
    ok(
      kS10.confirmed === 2 && kS10.tasksCreated === 2 && kTicket('T0050').need_confirm === 0,
      `确认放行：2 张待确认清零、按正常规则补建 2 个任务（confirmed=${kS10.confirmed}, tasks=${kS10.tasksCreated}）`
    )

    // ---- (11) 历史单的「补建任务」手动按钮（§2.2③兜底）----
    const kS11 = createTaskForTicketManually('T0001', kWs)
    ok(kS11.ok && kTicket('T0001').pack_id !== null, '历史单也能手动补建任务（兜底按钮）')
    const kS11b = createTaskForTicketManually('T9999', kWs)
    ok(!kS11b.ok, '不存在的编号 → 手动补建返回失败，不崩')

    // ---- (12) 配置读写（meta 键跟工作区走）----
    writeTicketSheets([{ title: '营销物料设计申请（印刷物料）', sheet_id: 'sheetNEW', type: 'print', enabled: true }])
    const kS12 = JSON.parse(getMeta(META_KEYS.sheets) ?? '[]') as TicketSheetConfig[]
    ok(kS12.length === 1 && kS12[0].sheet_id === 'sheetNEW', '子表配置（标题为主键 + sheet_id 指纹）读写正常')

    closeDb()
    hardRm(kRoot)
  }

  closeDb()
  hardRm(eRoot)
  closeDb()
  hardRm(w9Root)
  closeDb()
  hardRm(w8Root)
  hardRm(w7Root)
  hardRm(w6Root)

  // ============ 第 15 批 M5：交付打包 ============
  const p15Root = `D:\\_accept_ws\\run_${RUN_ID}_packexport`
  mkdirSync(p15Root, { recursive: true })
  initWorkspace(p15Root)

  // 用 createPack（自带 V1），往 V1 的三组里丢文件
  const p15Proj = listProjectsWithCount()[0]
  const p15Pack = createPack({ name: '交付打包测试', projectId: p15Proj.id, workspaceRoot: p15Root })
  const p15V1Dir = join(p15Pack.folder_path, 'V1')
  mkdirSync(join(p15V1Dir, '01-成品'), { recursive: true })
  mkdirSync(join(p15V1Dir, '02-素材'), { recursive: true })
  mkdirSync(join(p15V1Dir, '03-工程'), { recursive: true })
  makePng(join(p15V1Dir, '01-成品', '海报终稿.png'), 16, 9)
  writeFileSync(join(p15V1Dir, '02-素材', '底图.jpg'), 'jpg-bytes', 'utf-8')
  writeFileSync(join(p15V1Dir, '03-工程', '源文件.psd'), 'psd-bytes', 'utf-8')
  scanAll(p15Root)

  // (1) 默认打包：当前版本 + 成品/素材/工程
  const outDir = join(p15Root, 'out')
  mkdirSync(outDir, { recursive: true })
  const pe1 = await executePackExport({
    packId: p15Pack.id,
    versionMode: 'current',
    roles: ['成品', '素材', '工程'],
    excludedAssetIds: [],
    outputDir: outDir,
    zipName: '',
    wrapFolder: true,
    size: '',
    keepOriginalName: true
  })
  ok(pe1.ok && !!pe1.outputPath && existsSync(pe1.outputPath), '默认打包生成 zip')
  ok((pe1.fileCount ?? 0) === 3, '默认打包包含 3 个文件')

  // 交付记录 + 版本 delivered_at
  const records = listDeliveryRecords(p15Pack.id)
  ok(records.length >= 1, '打包后生成交付记录')
  const db15 = getDb()
  const v15Delivered = db15
    .prepare('SELECT delivered_at FROM pack_versions WHERE pack_id = ?')
    .get(p15Pack.id) as { delivered_at: string | null }
  ok(!!v15Delivered?.delivered_at, '打包后当前版本标记为已交付')

  // (2) 不保留原文件名 → 内部文件用序号
  const pe2 = await executePackExport({
    packId: p15Pack.id,
    versionMode: 'current',
    roles: ['成品'],
    excludedAssetIds: [],
    outputDir: outDir,
    zipName: 'test-no-original',
    wrapFolder: false,
    size: '1920x1080',
    keepOriginalName: false
  })
  ok(pe2.ok && existsSync(pe2.outputPath!), '不保留原文件名打包成功')

  // (3) 自定义模板
  const pe3 = await executePackExport({
    packId: p15Pack.id,
    versionMode: 'current',
    roles: ['素材'],
    excludedAssetIds: [],
    outputDir: outDir,
    zipName: 'test-custom',
    wrapFolder: true,
    size: '800x600',
    keepOriginalName: true,
    customNameTemplate: '{任务名}-{尺寸}-{版本}-{原文件名}{打包日期}.{扩展名}'
  })
  ok(pe3.ok && existsSync(pe3.outputPath!), '自定义文件名模板打包成功')

  // (4) 空选择 → 失败
  const pe4 = await executePackExport({
    packId: p15Pack.id,
    versionMode: 'current',
    roles: ['未归属'],
    excludedAssetIds: [],
    outputDir: outDir,
    zipName: 'test-empty',
    wrapFolder: true,
    size: '',
    keepOriginalName: true
  })
  ok(!pe4.ok, '没有可打包内容时返回失败')

  // (5) zip 名含 Windows 非法字符 → 主进程清洗（真机踩坑 2026-10-04：手填「10*1000cm」
  // 的星号未经清洗直接落 createWriteStream → ENOENT + error 监听空窗 → uncaughtException 崩软件）
  const plan5 = await buildPackExportPlan({
    packId: p15Pack.id,
    versionMode: 'current',
    roles: ['成品'],
    excludedAssetIds: [],
    outputDir: outDir,
    zipName: '非法<>:"\\/|?*字符',
    wrapFolder: true,
    size: '10*1000cm',
    keepOriginalName: true
  })
  ok(!/[<>:"\\/|?*]/.test(basename(plan5.outputPath)), 'zip 名含非法字符时计划落盘路径已清洗')
  ok(basename(plan5.outputPath) === '非法_________字符.zip', '非法字符逐个替换为下划线')

  // (6) 端到端：手填带星号的 zip 名（真机原始场景）也能打包成功
  const pe5 = await executePackExport({
    packId: p15Pack.id,
    versionMode: 'current',
    roles: ['成品'],
    excludedAssetIds: [],
    outputDir: outDir,
    zipName: '海南升学集训营-讲座横幅-10*1000cm-20261004-V1',
    wrapFolder: true,
    size: '',
    keepOriginalName: true
  })
  ok(pe5.ok && !!pe5.outputPath && existsSync(pe5.outputPath), '手填星号 zip 名打包成功（星号已清洗）')
  ok(!pe5.outputPath!.includes('*'), '实际落盘 zip 路径不含星号')

  closeDb()
  hardRm(p15Root)

  // ============ 第 17 批 T-01：迁移 13（方案 19 §8，指派四列） ============
  log('\n[32] 第 17 批：迁移 13 —— tickets 指派四列（designer_write_pending / assigned_by / assigned_at / notify_state）')
  {
    const aRoot = join('D:\\_accept_ws', `wstest17a_${RUN_ID}`)
    const aWs = join(aRoot, 'ws')
    hardRm(aRoot)
    mkdirSync(aWs, { recursive: true })
    closeDb()
    openDb(aWs)
    initWorkspace(aWs)

    const aCols = getDb().prepare('PRAGMA table_info(tickets)').all() as Array<{ name: string }>
    for (const c of ['designer_write_pending', 'assigned_by', 'assigned_at', 'notify_state']) {
      ok(aCols.some((x) => x.name === c), `tickets 表有 ${c} 列（迁移 13 幂等补列）`)
    }
    const pendCol = aCols.find((x) => x.name === 'designer_write_pending') as
      | { name: string; dflt_value: string | null }
      | undefined
    ok(!!pendCol && pendCol.dflt_value === '0', 'designer_write_pending 默认 0（老库行为不变）')

    closeDb()
    hardRm(aRoot)
  }

  // ============ 第 17 批 T-02：指派引擎（docs/19 §4~§6，写回适配器全部喂 mock） ============
  log('\n[33] 第 17 批：指派引擎（本地即时 / pending / 写回 / 冲突三态 / 补写 / 通知 / 候选池 / 计数）')
  {
    const bRoot = join('D:\\_accept_ws', `wstest17b_${RUN_ID}`)
    const bWs = join(bRoot, 'ws')
    hardRm(bRoot)
    mkdirSync(bWs, { recursive: true })
    closeDb()
    openDb(bWs)
    initWorkspace(bWs)

    /** mock 适配器：写回成败可编程，通知内容留底 */
    let writeShouldOk = true
    let notifyShouldOk = true
    const writtenRows: Array<{ record_id: string; sheet_id: string; userids: string[] }> = []
    const notified: Array<{ userid: string; content: string }> = []
    const mockAdapter: DesignerWriteAdapter = {
      updateDesigners: async (record_id, sheet_id, userids) => {
        if (!writeShouldOk) return { ok: false, error: 'MOCK_WRITE_FAIL' }
        writtenRows.push({ record_id, sheet_id, userids })
        return { ok: true }
      },
      notify: async (userid, content) => {
        if (!notifyShouldOk) return { ok: false, error: 'MOCK_NOTIFY_FAIL' }
        notified.push({ userid, content })
        return { ok: true }
      }
    }

    const bRec = (no: string, over: Record<string, unknown> = {}): TicketRawRecord => ({
      record_id: `rec_${no}`,
      values: {
        审批单编号: [{ text: no }],
        物料名称: [{ text: `物料-${no}` }],
        当前审批状态: [{ text: '审批中' }],
        业务归属: [{ text: '工单测试项目' }],
        ...over
      }
    })
    const bPayload = (records: TicketRawRecord[]): SheetPayload => ({
      sheet_id: 'sheetP',
      title: '营销物料设计申请（印刷物料）',
      type: 'print',
      records
    })
    const bIdentity = { userid: 'uME', name: '本机测试员' }
    const bTicket = (no: string): Record<string, unknown> =>
      getDb().prepare('SELECT * FROM tickets WHERE ticket_no = ?').get(no) as Record<string, unknown>

    /**
     * 全量同步助手：删行判定是「本次批里没有 → row_gone」（§4.2 步骤5），
     * 所以每轮同步都必须带上**全部活着的记录** —— live 集维护当前全量。
     */
    const live = new Map<string, TicketRawRecord>()
    const put = (no: string, over: Record<string, unknown> = {}): void => {
      live.set(no, bRec(no, over))
    }
    const syncAll = (structureChanged = false) =>
      applySync({
        payloads: [bPayload([...live.values()])],
        structureChanged,
        identity: bIdentity,
        workspaceRoot: bWs
      })

    createProject({ name: '工单测试项目', workspaceRoot: bWs })
    // 首次同步快照：3 张历史（其中 A1 已派设计师 uOLD —— 候选池种子）
    put('A1', { 设计师: [{ userId: 'uOLD', userName: '老设计师' }] })
    put('A2', { 设计师: [{ userId: 'uME', userName: '本机测试员' }] })
    put('A3')
    syncAll()

    // ---- (1) 候选池：历史工单设计师去重 + 在办计数 ----
    put('B1')
    put('B2')
    syncAll()
    // B3 派给本机、已通过 → 建了任务 = 在办 1 张（A2 是历史单不算在办）
    put('B3', { 设计师: [{ userId: 'uME', userName: '本机测试员' }], 当前审批状态: [{ text: '已通过' }] })
    syncAll()
    const cands = listDesignerCandidates()
    ok(cands.length === 2, `候选池 = 历史设计师去重（2 人，实际 ${cands.length}）`)
    const candOld = cands.find((c) => c.userid === 'uOLD')
    const candMe = cands.find((c) => c.userid === 'uME')
    ok(!!candOld && candOld.name === '老设计师', '历史单的设计师也在候选池（历史派过活的人就是候选）')
    ok(!!candMe && candMe.activeCount === 1, `在办计数只算活跃单（uME 在办 1，实际 ${candMe?.activeCount}）`)
    ok(!!candOld && candOld.activeCount === 0, '历史单不算在办（uOLD 在办 0）')

    // ---- (2) 本机开关：默认关，读写可切 ----
    ok(allowAssignEnabled() === false, '「允许在本机指派」默认关（docs/19 §10 #3）')
    setAllowAssignEnabled(true)
    ok(allowAssignEnabled() === true, '开关可开（meta 落库）')
    setAllowAssignEnabled(false)

    // ---- (3) 指派本地即时生效 + pending + 留痕 + 通知 ----
    writeShouldOk = true
    notifyShouldOk = true
    const ar1 = await executeAssignDesigners('B1', [{ userid: 'uOLD', name: '老设计师' }], mockAdapter, 'uME')
    const tB1 = bTicket('B1')
    ok(ar1.ok && tB1.designer_userid === 'uOLD' && tB1.designer_name === '老设计师', '指派本地即时生效（不等写回）')
    ok(tB1.designer_write_pending === 0, '写回成功 → pending 已清')
    ok(tB1.assigned_by === 'uME' && !!tB1.assigned_at, '留痕：谁派的 / 什么时候派的（assigned_by / assigned_at）')
    ok(ar1.notifyState === 'sent' && notified.length === 1, '写回成功后通知设计师（notify_state=sent）')
    ok(
      notified[0]?.userid === 'uOLD' && notified[0]?.content.includes('物料-B1') && notified[0]?.content.includes('工单测试项目'),
      `通知内容走模板（标题+项目）：${notified[0]?.content ?? '—'}`
    )
    ok(writtenRows[0]?.record_id === 'rec_B1' && writtenRows[0]?.userids?.[0] === 'uOLD', '写回拿到了 record_id + userid')
    // 通知防重复：再补写一次（pending 已清不会触发）→ notified 不涨
    await retryPendingDesignerWrites(mockAdapter)
    ok(notified.length === 1, 'notify_state=sent 防重复推送（补写不再通知）')

    // ---- (4) 写回失败：保 pending + 同步不被表值覆盖 + 下次同步自动补写 ----
    writeShouldOk = false
    const ar2 = await executeAssignDesigners('B2', [{ userid: 'uOLD', name: '老设计师' }], mockAdapter, 'uME')
    ok(ar2.ok && ar2.writeOk === false, '写回失败不回滚指派（本地已生效）')
    ok(bTicket('B2').designer_write_pending === 1, '写回失败 → pending 保住（数据不丢）')
    // 同步时表里设计师是别人（uME）≠ 本地 pending 值（uOLD）→ 本地守住不被覆盖（冲突三态之二）
    put('B2', { 设计师: [{ userId: 'uME', userName: '本机测试员' }] })
    syncAll()
    ok(
      bTicket('B2').designer_write_pending === 1 && bTicket('B2').designer_userid === 'uOLD',
      '有 pending 时本地守住不被表值覆盖（我改的还没写出去，覆盖等于白改）'
    )
    writeShouldOk = true
    const retry1 = await retryPendingDesignerWrites(mockAdapter)
    ok(retry1.retried === 1 && retry1.succeeded === 1, '下次同步自动补写成功（B2）')
    ok(bTicket('B2').designer_write_pending === 0, '补写成功 → pending 清掉')
    // 收敛：表值同步回本地，两边一致
    put('B2', { 设计师: [{ userId: 'uOLD', userName: '老设计师' }] })
    syncAll()
    ok(bTicket('B2').designer_name === '老设计师' && bTicket('B2').designer_write_pending === 0, '冲突三态收敛：写回成功后表值=本地值')

    // ---- (5) 冲突三态之一：无 pending → 采纳表值 ----
    put('B2', { 设计师: [{ userId: 'uOTHER', userName: '表格里改的人' }] })
    syncAll()
    ok(
      bTicket('B2').designer_userid === 'uOTHER' && bTicket('B2').designer_name === '表格里改的人',
      '无 pending 时采纳表值（别的机器/表格里改的，表是权威）'
    )

    // ---- (6) 指派给本机身份 → 下轮同步自动建任务（复用一期条件链，零分支） ----
    const ar3b = await executeAssignDesigners('B1', [{ userid: 'uME', name: '本机测试员' }], mockAdapter, 'uME')
    ok(ar3b.ok && bTicket('B1').designer_userid === 'uME', '把 B1 改派给本机身份（改派走同一管路）')
    put('B1', { 设计师: [{ userId: 'uME', userName: '本机测试员' }] })
    const sB1 = syncAll()
    ok(sB1.tasksCreated === 1 && bTicket('B1').pack_id !== null, '指派给本机身份 → 下轮同步自动建出任务（条件链零改动）')
    // 指派给他人 → 不建任务
    writeShouldOk = true
    await executeAssignDesigners('B2', [{ userid: 'uOLD', name: '老设计师' }], mockAdapter, 'uME')
    put('B2', { 设计师: [{ userId: 'uOLD', userName: '老设计师' }] })
    syncAll()
    ok(bTicket('B2').pack_id === null, '指派给别人 → 本机不建任务（他的机器同步到自会建）')

    // ---- (7) 状态门槛：待确认 / 已删行 / 历史单不可指派 ----
    put('C1', { 设计师: [] })
    syncAll()
    getDb().prepare('UPDATE tickets SET need_confirm = 1 WHERE ticket_no = ?').run('C1')
    const arC1 = await executeAssignDesigners('C1', [{ userid: 'uOLD', name: '老设计师' }], mockAdapter, 'uME')
    ok(!arC1.ok && arC1.msg === '待确认单放行后才能指派', '待确认单不能指派（record_id 可能未放行）')
    getDb().prepare('UPDATE tickets SET need_confirm = 0, row_gone = 1 WHERE ticket_no = ?').run('C1')
    const arC1b = await executeAssignDesigners('C1', [{ userid: 'uOLD', name: '老设计师' }], mockAdapter, 'uME')
    ok(!arC1b.ok && arC1b.msg === '该单已不在表中，无法指派', '已删行（row_gone）不能指派（record_id 已失效，写也白写）')
    const arA3 = await executeAssignDesigners('A3', [{ userid: 'uOLD', name: '老设计师' }], mockAdapter, 'uME')
    ok(!arA3.ok && arA3.msg === '历史单请在表格中指派', '历史单不能指派（§10 #7 默认拍板）')

    // ---- (8) 通知失败不阻断指派 ----
    notifyShouldOk = false
    writeShouldOk = true
    getDb().prepare('UPDATE tickets SET row_gone = 0 WHERE ticket_no = ?').run('C1')
    const arC2 = await executeAssignDesigners('C1', [{ userid: 'uOLD', name: '老设计师' }], mockAdapter, 'uME')
    ok(arC2.ok && arC2.writeOk === true && arC2.notifyState === 'failed', '通知发不出去：指派与写回照常完成（不阻断）')
    ok(bTicket('C1').notify_state === 'failed', '通知失败留痕 notify_state=failed')

    // ---- (9) 设计师列可用性：列缺失 → 指派拒绝（降级不崩） ----
    setMeta(META_KEYS.designerOk, '0')
    ok(designerColUsable() === false, '同步检测到列缺失 → designerColUsable=false')
    const arC3 = await executeAssignDesigners('B2', [{ userid: 'uME', name: '本机测试员' }], mockAdapter, 'uME')
    ok(!arC3.ok, '列不可用时指派被拒（入口置灰的后端兜底）')
    setMeta(META_KEYS.designerOk, '1')
    // evaluateDesignerCol：按 sheets list 的 fields 判定
    evaluateDesignerCol([{ sheet_id: 'sheetP', title: 'x' }], {
      sheetP: [{ field_title: '设计师', field_type: 'user' }]
    })
    ok(designerColUsable() === true, 'evaluateDesignerCol：列在且是 user 类型 → 可用')
    evaluateDesignerCol([{ sheet_id: 'sheetP', title: 'x' }], {
      sheetP: [{ field_title: '#设计师', field_type: 'user' }]
    })
    ok(designerColUsable() === false, 'evaluateDesignerCol：列被改名（# 前缀隐身）→ 不可用')
    evaluateDesignerCol([{ sheet_id: 'sheetP', title: 'x' }], {
      sheetP: [{ field_title: '设计师', field_type: 'text' }]
    })
    ok(designerColUsable() === false, 'evaluateDesignerCol：列在但不是成员类型 → 不可用')
    // 列名 meta：读写同源
    setMeta(META_KEYS.designerCol, '设计负责人')
    ok(designerColName() === '设计负责人', '设计师列名走 meta 配置（改名只改这一处）')
    setMeta(META_KEYS.designerCol, '')
    setMeta(META_KEYS.designerOk, '1') // 复位（最后一条评估把状态留在了 0）

    // ---- (10) newUnassigned 计数 + 未指派存量 ----
    put('D1', { 设计师: [] })
    put('D2', { 设计师: [] })
    put('D3', { 设计师: [{ userId: 'uME', userName: '本机测试员' }] })
    const sN = syncAll()
    ok(sN.newUnassigned === 2, `本轮新增未指派计数（2 张新单没派，实际 ${sN.newUnassigned}）`)
    put('D9', { 设计师: [] })
    const sN2 = syncAll()
    ok(sN2.newUnassigned === 1, '非首同步的新未指派单照常计数')
    const cnt = unassignedTicketCount()
    ok(cnt >= 2, `未指派存量数（顶栏徽标口径 = 未指派筛选，≥2，实际 ${cnt}）`)

    // ---- (11) 写回补写失败也要有错误清单 ----
    writeShouldOk = false
    await executeAssignDesigners('D1', [{ userid: 'uOLD', name: '老设计师' }], mockAdapter, 'uME')
    const retryFail = await retryPendingDesignerWrites(mockAdapter)
    ok(retryFail.retried === 1 && retryFail.failed === 1 && retryFail.errors.length === 1, '补写失败返回错误清单（界面拼警告）')
    ok(bTicket('D1').designer_write_pending === 1, '补写失败 → pending 继续（下次同步再试）')

    closeDb()
    hardRm(bRoot)
  }

  // ============ 第 18 批 T-03：迁移 14（多设计师子表 ticket_designers） ============
  log('\n[34] 第 18 批：迁移 14 —— ticket_designers 子表（建表 + 索引 + 老单值迁移 + 幂等）')
  {
    const aRoot = join('D:\\_accept_ws', `wstest18a_${RUN_ID}`)
    const aWs = join(aRoot, 'ws')
    hardRm(aRoot)
    mkdirSync(aWs, { recursive: true })
    closeDb()
    openDb(aWs)
    initWorkspace(aWs)

    const tdCols = getDb().prepare('PRAGMA table_info(ticket_designers)').all() as Array<{ name: string }>
    for (const c of ['ticket_no', 'userid', 'name', 'seq', 'notified']) {
      ok(tdCols.some((x) => x.name === c), `ticket_designers 有 ${c} 列（迁移 14 建表）`)
    }

    // 造一条老单值数据 → 重新 openDb 触发迁移 14 的「搬老数据」
    getDb()
      .prepare(
        `INSERT INTO tickets (sheet_id, ticket_type, ticket_no, designer_userid, designer_name)
         VALUES ('s', 'print', 'OLD1', 'uOLD', '老设计师')`
      )
      .run()
    closeDb()
    openDb(aWs)
    const migrated = getDb()
      .prepare('SELECT userid, name, seq FROM ticket_designers WHERE ticket_no = ? ORDER BY seq')
      .all('OLD1') as Array<{ userid: string; name: string | null; seq: number }>
    ok(
      migrated.length === 1 && migrated[0].userid === 'uOLD' && migrated[0].name === '老设计师' && migrated[0].seq === 0,
      '老单值数据迁移进子表（seq=0，单值列原样保留）'
    )
    // 幂等：再开一次不重搬
    closeDb()
    openDb(aWs)
    const cnt = getDb().prepare('SELECT COUNT(*) AS c FROM ticket_designers WHERE ticket_no = ?').get('OLD1') as { c: number }
    ok(cnt.c === 1, '迁移 14 幂等（重复启动不重搬）')

    closeDb()
    hardRm(aRoot)
  }

  // ============ 第 18 批 T-04：多设计师引擎（docs/20 §5，写回适配器全喂 mock） ============
  log('\n[35] 第 18 批：多设计师（读多值 / 落子表 / 建任务 ∈集合 / 后缀 / 改派 / 通知新增 / 未指派口径）')
  {
    const bRoot = join('D:\\_accept_ws', `wstest18b_${RUN_ID}`)
    const bWs = join(bRoot, 'ws')
    hardRm(bRoot)
    mkdirSync(bWs, { recursive: true })
    closeDb()
    openDb(bWs)
    initWorkspace(bWs)

    let writeShouldOk = true
    let notifyShouldOk = true
    const writtenRows: Array<{ record_id: string; sheet_id: string; userids: string[] }> = []
    const notified: Array<{ userid: string; content: string }> = []
    const mockAdapter: DesignerWriteAdapter = {
      updateDesigners: async (record_id, sheet_id, userids) => {
        if (!writeShouldOk) return { ok: false, error: 'MOCK_WRITE_FAIL' }
        writtenRows.push({ record_id, sheet_id, userids })
        return { ok: true }
      },
      notify: async (userid, content) => {
        if (!notifyShouldOk) return { ok: false, error: 'MOCK_NOTIFY_FAIL' }
        notified.push({ userid, content })
        return { ok: true }
      }
    }

    const bRec = (no: string, over: Record<string, unknown> = {}): TicketRawRecord => ({
      record_id: `rec_${no}`,
      values: {
        审批单编号: [{ text: no }],
        物料名称: [{ text: `物料-${no}` }],
        当前审批状态: [{ text: '审批中' }],
        业务归属: [{ text: '工单测试项目' }],
        ...over
      }
    })
    const bPayload = (records: TicketRawRecord[]): SheetPayload => ({
      sheet_id: 'sheetP',
      title: '营销物料设计申请（印刷物料）',
      type: 'print',
      records
    })
    const bIdentity = { userid: 'uME', name: '本机测试员' }
    const bTicket = (no: string): Record<string, unknown> =>
      getDb().prepare('SELECT * FROM tickets WHERE ticket_no = ?').get(no) as Record<string, unknown>
    const bDesigners = (no: string): Array<{ userid: string; name: string | null; seq: number; notified: number }> =>
      getDb()
        .prepare('SELECT userid, name, seq, notified FROM ticket_designers WHERE ticket_no = ? ORDER BY seq')
        .all(no) as Array<{ userid: string; name: string | null; seq: number; notified: number }>

    const live = new Map<string, TicketRawRecord>()
    const put = (no: string, over: Record<string, unknown> = {}): void => {
      live.set(no, bRec(no, over))
    }
    const syncAll = (structureChanged = false) =>
      applySync({
        payloads: [bPayload([...live.values()])],
        structureChanged,
        identity: bIdentity,
        workspaceRoot: bWs
      })

    createProject({ name: '工单测试项目', workspaceRoot: bWs })
    put('A1', { 设计师: [{ userId: 'uOLD', userName: '老设计师' }] })
    put('A2')
    syncAll() // 首次快照：A1/A2 历史

    // ---- (1) 读多值 + 落子表 ----
    put('M1', { 设计师: [{ userId: 'uA', userName: '甲' }, { userId: 'uB', userName: '乙' }] })
    put('M2', { 设计师: [{ userId: 'uME', userName: '本机测试员' }] })
    put('M3', { 设计师: [] })
    syncAll()
    const dM1 = bDesigners('M1')
    ok(dM1.length === 2 && dM1[0].userid === 'uA' && dM1[1].userid === 'uB', '多值设计师落子表（2 行，seq 0/1）')
    ok(bTicket('M1').designer_userid === 'uA' && bTicket('M1').designer_name === '甲', '冗余列 = 集合第一个（主设计师）')
    ok(bTicket('M3').designer_userid === null, '未指派（空数组）→ 冗余列 null（全空才算）')

    // ---- (2) 建任务链「本机 ∈ 集合」+ 任务名后缀 ----
    put('M4', { 设计师: [{ userId: 'uME', userName: '本机测试员' }, { userId: 'uC', userName: '丙' }] })
    const s4 = syncAll()
    ok(s4.tasksCreated === 1 && bTicket('M4').pack_id !== null, '本机 ∈ 设计师集合 → 建任务')
    const pack4 = getDb().prepare('SELECT name FROM packs WHERE id = ?').get(bTicket('M4').pack_id as number) as
      | { name: string }
      | undefined
    ok(pack4?.name === '物料-M4-本机测试员', `多设计师（≥2）任务名带本机姓名后缀（${pack4?.name ?? '—'}）`)
    put('M5', { 设计师: [{ userId: 'uA', userName: '甲' }, { userId: 'uB', userName: '乙' }] })
    syncAll()
    ok(bTicket('M5').pack_id === null, '本机 ∉ 集合 → 不建任务（别的设计师机器自会建）')

    // ---- (3) 候选池子表去重 + 在办计数 ----
    const cands = listDesignerCandidates()
    ok(cands.some((c) => c.userid === 'uA' && c.name === '甲'), '候选池改读子表去重')
    ok(cands.some((c) => c.userid === 'uB'), '多设计师每个都进候选池')

    // ---- (4) 多值指派本地即时 + 写回多值数组 + 通知逐个 ----
    writeShouldOk = true
    notifyShouldOk = true
    const ar = await executeAssignDesigners(
      'M2',
      [{ userid: 'uA', name: '甲' }, { userid: 'uB', name: '乙' }],
      mockAdapter,
      'uME'
    )
    ok(ar.ok && bTicket('M2').designer_userid === 'uA', '多值指派本地即时生效（主设计师 = 第一个）')
    ok(bDesigners('M2').length === 2, '子表整表替换成 2 行')
    const lastW = writtenRows[writtenRows.length - 1]
    ok(lastW?.userids.length === 2 && lastW.userids[0] === 'uA' && lastW.userids[1] === 'uB', '写回多值数组 [{uA,uB}]')
    ok(notified.length === 2, '通知逐个新增设计师（2 人都通知）')

    // ---- (5) 改派加人 → 只通知新增的（notified 精确到人） ----
    const notifiedBefore = notified.length
    await executeAssignDesigners(
      'M2',
      [{ userid: 'uA', name: '甲' }, { userid: 'uB', name: '乙' }, { userid: 'uC', name: '丙' }],
      mockAdapter,
      'uME'
    )
    ok(notified.length === notifiedBefore + 1, '改派加人 → 只通知新增的丙（甲/乙已 notified 不重发）')

    // ---- (6) 改派检测：本机被移出集合 → 标 reassigned、任务不删；回到集合 → 清标记 ----
    put('M4', { 设计师: [{ userId: 'uC', userName: '丙' }] })
    syncAll()
    ok(bTicket('M4').reassigned_to === '丙', '本机被移出集合 → 标已改派给集合第一人')
    ok(bTicket('M4').pack_id !== null, '改派不删任务（文件保留）')
    put('M4', { 设计师: [{ userId: 'uME', userName: '本机测试员' }] })
    syncAll()
    ok(bTicket('M4').reassigned_to === null, '本机回到集合 → 清改派标记')

    // ---- (7) 写回失败保 pending + 下次补写 ----
    writeShouldOk = false
    await executeAssignDesigners('M5', [{ userid: 'uA', name: '甲' }], mockAdapter, 'uME')
    ok(bTicket('M5').designer_write_pending === 1, '多值写回失败 → 保 pending')
    writeShouldOk = true
    const r = await retryPendingDesignerWrites(mockAdapter)
    ok(r.succeeded === 1 && bTicket('M5').designer_write_pending === 0, '补写成功清 pending')

    // ---- (8) 未指派口径：全空才算（空数组 → null） ----
    const cnt = unassignedTicketCount()
    ok(cnt >= 1, `未指派口径 = 冗余列 null（全空才算，M3 算，实际 ${cnt}）`)

    // ---- (9) 空集合指派被拒（API 无法清空成员列，docs/20 §2.1） ----
    const arEmpty = await executeAssignDesigners('M2', [], mockAdapter, 'uME')
    ok(!arEmpty.ok, '空集合指派被拒（成员列无法 API 清空，UI 层挡住最后一人）')

    closeDb()
    hardRm(bRoot)
  }

  // ============ 第 19 批 T-05：迁移 15（导出报表，docs/22 §3） ============
  log('\n[36] 第 19 批：迁移 15 —— ticket_metrics 子表 + tickets.thumb_url 列')
  {
    const aRoot = join('D:\\_accept_ws', `wstest19a_${RUN_ID}`)
    const aWs = join(aRoot, 'ws')
    hardRm(aRoot)
    mkdirSync(aWs, { recursive: true })
    closeDb()
    openDb(aWs)
    initWorkspace(aWs)

    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ticket_metrics'")
      .all()
    ok(tables.length === 1, '迁移 15 建 ticket_metrics 子表')
    const tCols = getDb().prepare('PRAGMA table_info(tickets)').all() as Array<{ name: string }>
    ok(tCols.some((c) => c.name === 'thumb_url'), 'tickets 有 thumb_url 列（迁移 15 幂等补列）')
    ok(thumbColName() === '缩略图', '缩略图列名 = 缩略图（读写同源）')

    closeDb()
    hardRm(aRoot)
  }

  // ============ 第 19 批 T-06：本地字段 + 缩略图映射 + 完成任务 + 导出组装（docs/22） ============
  log('\n[37] 第 19 批：本地字段读写 / 缩略图列映射 / 完成任务 / 导出组装（mock 适配器）')
  {
    const bRoot = join('D:\\_accept_ws', `wstest19b_${RUN_ID}`)
    const bWs = join(bRoot, 'ws')
    hardRm(bRoot)
    mkdirSync(bWs, { recursive: true })
    closeDb()
    openDb(bWs)
    initWorkspace(bWs)

    const bIdentity = { userid: 'uME', name: '本机测试员' }
    const bRec = (no: string, over: Record<string, unknown> = {}): TicketRawRecord => ({
      record_id: `rec_${no}`,
      values: {
        审批单编号: [{ text: no }],
        物料名称: [{ text: `物料-${no}` }],
        当前审批状态: [{ text: '审批中' }],
        业务归属: [{ text: '工单测试项目' }],
        ...over
      }
    })
    const bPayload = (records: TicketRawRecord[]): SheetPayload => ({
      sheet_id: 'sheetP',
      title: '营销物料设计申请（印刷物料）',
      type: 'print',
      records
    })
    const live = new Map<string, TicketRawRecord>()
    const put = (no: string, over: Record<string, unknown> = {}): void => {
      live.set(no, bRec(no, over))
    }
    const syncAll = (structureChanged = false) =>
      applySync({
        payloads: [bPayload([...live.values()])],
        structureChanged,
        identity: bIdentity,
        workspaceRoot: bWs
      })

    createProject({ name: '工单测试项目', workspaceRoot: bWs })
    put('A1', { 设计师: [{ userId: 'uOLD', userName: '老设计师' }] })
    syncAll() // 首次快照

    // ---- (1) 缩略图列映射：image 列值 → thumb_url ----
    // 派给别的设计师（uOTHER）→ 不自动建任务，避免干扰后面的完成任务断言
    put('R1', {
      设计师: [{ userId: 'uOTHER', userName: '别的同事' }],
      完成时间: [{ text: '2026-10-05' }],
      缩略图: [{ id: 'img1', title: '图', imageUrl: 'https://wqpic.example/thumb1.jpg' }]
    })
    put('R2', { 设计师: [{ userId: 'uOTHER', userName: '别的同事' }], 完成时间: [{ text: '2026-10-15' }] })
    put('R3', { 设计师: [{ userId: 'uOTHER', userName: '别的同事' }], 完成时间: [{ text: '2026-09-20' }] })
    put('R4', { 设计师: [{ userId: 'uOTHER', userName: '别的同事' }] })
    syncAll()
    const tR1 = getDb().prepare('SELECT thumb_url FROM tickets WHERE ticket_no = ?').get('R1') as { thumb_url: string | null }
    ok(tR1.thumb_url === 'https://wqpic.example/thumb1.jpg', 'image 列 URL → thumb_url')
    const tR2 = getDb().prepare('SELECT thumb_url FROM tickets WHERE ticket_no = ?').get('R2') as { thumb_url: string | null }
    ok(tR2.thumb_url === null, '无图 → thumb_url null')

    // ---- (2) 本地字段读写（upsert + 全空删行）----
    writeTicketMetrics('R1', { printCost: 1200.5, performanceCost: null, remark: '备注A' })
    const m1 = readTicketMetrics('R1')
    ok(m1.printCost === 1200.5 && m1.performanceCost === null && m1.remark === '备注A', '本地字段写读（金额 + 备注）')
    writeTicketMetrics('R1', { printCost: 2000, performanceCost: 300, remark: '' })
    const m2 = readTicketMetrics('R1')
    ok(m2.printCost === 2000 && m2.performanceCost === 300, '本地字段 upsert 更新金额')
    writeTicketMetrics('R2', { printCost: null, performanceCost: null, remark: null })
    const cntR2 = getDb().prepare('SELECT COUNT(*) AS c FROM ticket_metrics WHERE ticket_no = ?').get('R2') as { c: number }
    ok(cntR2.c === 0, '全空删行 → ticket_metrics 无残留')

    // ---- (3) buildReportRows：按完成时间筛 + JOIN 本地字段 ----
    writeTicketMetrics('R1', { printCost: 500, performanceCost: 100, remark: 'x' })
    writeTicketMetrics('R2', { printCost: 800, performanceCost: 200, remark: '' })
    const rows = buildReportRows('2026-10-01', '2026-10-31')
    ok(rows.length === 2, `buildReportRows 只含 10 月内完成（2 条，实际 ${rows.length}）`)
    ok(rows.every((r) => r.ticketNo === 'R1' || r.ticketNo === 'R2'), '范围外（9 月）与无完成时间的单被排除')
    const rowR1 = rows.find((r) => r.ticketNo === 'R1')
    ok(rowR1?.printCost === 500 && rowR1?.performanceCost === 100, '报表行 JOIN 本地扩展字段')

    // ---- (4) 完成任务：找成品图 + 生成缩略图 ----
    const projId = (getDb().prepare('SELECT id FROM projects WHERE name = ?').get('工单测试项目') as { id: number }).id
    const pack = createPack({ name: '完成任务测试包', projectId: projId, workspaceRoot: bWs })
    const v1 = getDb().prepare('SELECT folder_name FROM pack_versions WHERE pack_id = ? ORDER BY seq LIMIT 1').get(pack.id) as { folder_name: string }
    const doneDir = join(pack.folder_path, v1.folder_name, '01-成品')
    mkdirSync(doneDir, { recursive: true })
    makePng(join(doneDir, '完成图.png'), 200, 150, [200, 80, 40])
    scanAll(bWs)
    getDb().prepare('UPDATE tickets SET pack_id = ? WHERE ticket_no = ?').run(pack.id, 'R1')
    const comp = await completeTicketTask(pack.id, bWs)
    ok(comp.ok && comp.ticketNo === 'R1' && !!comp.thumbPath, '完成任务：找成品图 + 生成缩略图')
    ok(!!comp.thumbPath && existsSync(comp.thumbPath), `缩略图文件已生成（${comp.thumbPath ?? '—'}）`)
    const pack2 = createPack({ name: '空包', projectId: projId, workspaceRoot: bWs })
    getDb().prepare('UPDATE tickets SET pack_id = ? WHERE ticket_no = ?').run(pack2.id, 'R2')
    const comp2 = await completeTicketTask(pack2.id, bWs)
    ok(!comp2.ok, '无成品图 → 完成任务被拒')

    // ---- (5) 导出：mock 适配器（真企微不进自动测试）----
    const tplFields: ReportField[] = [
      { field_title: '工单类型（印刷/电子）', field_type: 'single_select', property_single_select: { options: [{ id: 'opt_print', text: '印刷' }, { id: 'opt_digital', text: '电子' }] } },
      { field_title: '编号', field_type: 'text' },
      { field_title: '完成时间', field_type: 'date_time' },
      { field_title: '物料名称', field_type: 'text' },
      { field_title: '业务归属', field_type: 'text' },
      { field_title: '申请人', field_type: 'user', property_user: { is_multiple: true } },
      { field_title: '设计师', field_type: 'user', property_user: { is_multiple: true } },
      { field_title: '缩略图', field_type: 'image' },
      { field_title: '印刷数量', field_type: 'number' },
      { field_title: '印刷金额', field_type: 'currency' },
      { field_title: '绩效金额', field_type: 'currency' },
      { field_title: '备注', field_type: 'text' }
    ]
    const addedSheets: Array<{ docid: string; sheetTitle: string; fields: ReportField[] }> = []
    const rehosted: string[] = []
    let addedRecords: Array<{ values: Record<string, unknown> }> = []
    const mockReportAdapter: ReportAdapter = {
      fetchTemplateFields: async () => ({ ok: true, data: tplFields }),
      addSheet: async (docid, sheetTitle, fields) => {
        addedSheets.push({ docid, sheetTitle, fields })
        return { ok: true, data: null }
      },
      rehostThumb: async (sourceUrl) => {
        rehosted.push(sourceUrl)
        return { ok: true, data: 'https://report-space/thumb.jpg' }
      },
      addRecords: async (_docid, _sheetTitle, records) => {
        addedRecords = records
        return { ok: true, data: null }
      }
    }
    const er = await exportReport(
      { docid: 's3_REPORT', templateSheet: '报表模板', start: '2026-10-01', end: '2026-10-31' },
      mockReportAdapter
    )
    ok(er.ok && er.count === 2 && er.sheetTitle === '2026-10-01~2026-10-31', `导出成功（2 条，子表名 = 起止日期，实际 ${er.count}/${er.sheetTitle}）`)
    ok(addedSheets.length === 1 && addedSheets[0].fields.length === 12, '建子表复制 12 字段结构')
    ok(rehosted.length === 1 && rehosted[0] === 'https://wqpic.example/thumb1.jpg', '有缩略图的单重新上传（1 张）')
    ok(addedRecords.length === 2, '写 2 条记录')
    const rec1 = addedRecords.find((r) => r.values[REPORT_FIELD.no] === 'R1')
    const rec2 = addedRecords.find((r) => r.values[REPORT_FIELD.no] === 'R2')
    ok(!!rec1 && !!rec2, '记录按编号写入')
    const typeVal = rec1?.values[REPORT_FIELD.type] as Array<{ id?: string; text: string }> | undefined
    ok(typeVal?.[0]?.text === '印刷' && typeVal?.[0]?.id === 'opt_print', '工单类型单选写 [{id,text}]')
    const dsVal = rec1?.values[REPORT_FIELD.designers] as Array<{ userName: string }> | undefined
    ok(dsVal?.length === 1 && dsVal?.[0]?.userName === '别的同事', '设计师成员列写 [{userName}]')
    const thumbVal = rec1?.values[REPORT_FIELD.thumb] as Array<{ imageUrl: string }> | undefined
    ok(thumbVal?.[0]?.imageUrl === 'https://report-space/thumb.jpg', '缩略图写报表空间 URL')
    ok(rec1?.values[REPORT_FIELD.printCost] === 500, '印刷金额写货币数值')
    ok(rec2?.values[REPORT_FIELD.performanceCost] === 200, '绩效金额写数值（R2）')
    ok(rec2?.values[REPORT_FIELD.thumb] === undefined, '无缩略图的单不写图片字段')

    closeDb()
    hardRm(bRoot)
  }

// ============ 汇总 ============
  log('\n' + '='.repeat(62))
  log(failed === 0 ? `全部通过 ✅  共 ${lines.filter((l) => l.includes('[OK]') || l.includes('[FAIL]')).length} 项断言` : `有 ${failed} 项失败 ❌`)
  log('='.repeat(62))

  writeFileSync('accept-result.txt', lines.join('\r\n'), 'utf-8')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('验收脚本崩溃：', e)
  writeFileSync('accept-result.txt', lines.join('\r\n') + '\r\n\r\nCRASH: ' + e.message, 'utf-8')
  process.exit(2)
})
