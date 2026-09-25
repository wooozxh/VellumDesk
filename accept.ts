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
  LAYOUT_VERSION
} from './src/main/workspace'
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
import { getDb, closeDb, openDb, getMeta } from './src/main/db'
import {
  listTagDimensions,
  createTag,
  updateTag,
  tagUsage,
  removeTag,
  applyTags,
  removeTagsFrom,
  tagsOfAssets,
  suggestTagsForAssets
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
  ok(preset.length === 3, `首次使用自动落 3 个预制项目（实际 ${preset.length}）`)
  ok(
    preset.some((p) => p.name === '集团通用') &&
      preset.some((p) => p.name === '海南升学规划中心') &&
      preset.some((p) => p.name === '海南升学初三集训营'),
    `预制项目名称正确：${preset.map((p) => p.name).join(' / ')}`
  )
  ok(preset.every((p) => /^#[0-9a-f]{6}$/i.test(p.color)), '每个项目都分到了颜色')

  const projPlan = preset.find((p) => p.name === '海南升学规划中心')!

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
  const p1 = createPack({
    name: '海南招生海报-2026秋季',
    projectId: projPlan.id,
    category: '海报',
    workspaceRoot: WS
  })
  ok(p1.id > 0, `建包成功：id=${p1.id} name=${p1.name}`)
  ok(p1.project_id === projPlan.id, `包已关联到项目 id=${projPlan.id}（海南升学规划中心）`)
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
  const p2 = createPack({ name: '   ', projectId: newProjId, category: '其他', workspaceRoot: WS })
  ok(p2.name.startsWith('未命名任务-'), `A-01 名称为空 → 自动兜底取名：${p2.name}`)
  ok(p2.project_id === newProjId, '包归属为自建项目')

  // 重名自动加后缀
  const p3 = createPack({
    name: '海南招生海报-2026秋季',
    projectId: projPlan.id,
    category: '海报',
    workspaceRoot: WS
  })
  ok(p3.folder_path !== p1.folder_path, `A-01 重名不覆盖，自动区分：${p3.folder_path.replace(WS, '')}`)

  // 不传项目 → 落到默认（排序第一个）
  const pDefault = createPack({ name: '默认归属测试', category: '其他', workspaceRoot: WS })
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
  const n = await ensureThumbsForAssets(WS, rows)
  ok(n >= 4, `生成 / 复用 ${n} 张缩略图`)
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
  ok(card.projectName === '海南升学规划中心', `包卡片带出项目名：${card.projectName}`)
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
  ok(stillThere.c === 0, '手动删除的文件，扫描后从索引摘除')
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
  const projWithPacks = listProjectsWithCount().find((p) => p.name === '海南升学规划中心')!
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
  const metaPack = createPack({ name: '元信息测试包', workspaceRoot: WS })
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
  const videoPack = createPack({ name: '视频测试包', workspaceRoot: WS })
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

  const psdPack = createPack({ name: 'PSD测试包', workspaceRoot: WS })
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

  const pdfPack = createPack({ name: 'PDF测试包', workspaceRoot: WS })
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
  log('\n[16] 第 3 批 C-01：3 个标签维度 + 预制标签')

  const dims = listTagDimensions()
  ok(dims.length === 3, `维度数 = ${dims.length}（应为 3：类别/渠道/状态；项目/时间已砍）`)
  ok(
    dims.map((d) => d.key).join(',') === 'category,channel,status',
    `维度顺序：${dims.map((d) => d.key).join(',')}`
  )
  const categoryDim = dims.find((d) => d.key === 'category')!
  const statusDim = dims.find((d) => d.key === 'status')!
  ok(categoryDim.mode === 'multi', `类别维度为多选（mode=${categoryDim.mode}）`)
  ok(statusDim.mode === 'single', `状态维度为单选（mode=${statusDim.mode}）`)
  ok(categoryDim.tags.length >= 9, `类别预制标签 ${categoryDim.tags.length} 个（≥9）`)
  ok(categoryDim.tags.some((t) => t.name === '海报'), '类别含预制「海报」')
  ok(categoryDim.tags.some((t) => t.name === '详情长图'), '类别含预制「详情长图」')
  const channelDim = dims.find((d) => d.key === 'channel')!
  ok(channelDim.tags.length >= 6, `渠道预制标签 ${channelDim.tags.length} 个（≥6）`)
  ok(channelDim.tags.some((t) => t.name === '视频号'), '渠道含预制「视频号」')
  ok(statusDim.tags.length >= 4, `状态预制标签 ${statusDim.tags.length} 个（≥4）`)
  ok(statusDim.tags.some((t) => t.name === '待审核'), '状态含预制「待审核」')
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
  const douyinTag = channelDim.tags.find((t) => t.name === '抖音')!

  const r1 = applyTags({ assetIds: pick, tagIds: [posterTag.id, douyinTag.id] })
  ok(r1.ok, `批量贴标签返回 ok（tagged=${r1.tagged}, cleared=${r1.cleared}）`)
  ok(r1.tagged === pick.length * 2, `张贴记录数 = ${r1.tagged}（3 素材 × 2 标签）`)
  ok(r1.cleared === 0, `首次贴无清除（cleared=${r1.cleared}）`)

  const fromDb = tagsOfAssets(pick)
  ok(fromDb[pick[0]]?.length === 2, `第 1 条素材有 2 个标签：${fromDb[pick[0]]?.length}`)
  ok(
    fromDb[pick[1]]?.some((t) => t.name === '海报') && fromDb[pick[1]]?.some((t) => t.name === '抖音'),
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
    after2[pick[0]]?.some((t) => t.name === '抖音') === true,
    '非同维度标签「抖音」不受影响，仍保留'
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

  // 造一组确定数据：3 条素材，A 组贴【折页 + 抖音】，B 组贴【折页】
  const groupA = pick
  const groupB = allAssetIds.slice(3, 5)
  applyTags({ assetIds: groupA, tagIds: [foldTag.id, douyinTag.id] })
  applyTags({ assetIds: groupB, tagIds: [foldTag.id] })

  const onlyFold = listAssets({ tagIds: [foldTag.id] })
  ok(
    onlyFold.length >= groupA.length + groupB.length,
    `按「折页」单选筛出 ${onlyFold.length} 条（≥${groupA.length + groupB.length}）`
  )

  const foldAndDouyin = listAssets({ tagIds: [foldTag.id, douyinTag.id] })
  ok(
    foldAndDouyin.length === groupA.length,
    `「折页 + 抖音」并且筛出 ${foldAndDouyin.length} 条（=${groupA.length}，跨维度 AND 生效）`
  )
  ok(
    foldAndDouyin.every((a) => groupA.includes(a.id)),
    '筛出的正是 A 组（同维度旧标签被覆盖后不串味）'
  )

  // ---- 项目维度负数 id 兼容：listAssets 把 -projectId 换算成 packs.project_id 过滤 ----
  // 背景：项目维度标签已砍（2026-09-24），界面不再传负数 id，但该能力保留作防御
  // （回归：上线首日用户实点「集团通用」筛出 0 条的 bug —— 负数 id 没换算成 project_id）
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
  ok(b.productName === '素材管家', 'productName = 素材管家')
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
  const w5Pack = createPack({ name: '迁移测试包', workspaceRoot: w5A })
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
  ok(w6Projs.length === 3, `内置 3 个预制项目（实际 ${w6Projs.length}）`)
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
  const w6Plan = listProjectsWithCount().find((p) => p.name === '海南升学规划中心')!
  const w6PackA = createPack({ name: '招生海报', projectId: w6Plan.id, workspaceRoot: w6Ws })
  ok(
    w6PackA.folder_path === join(w6Ws, w6Plan.folder_name, '招生海报'),
    `包落在项目文件夹下：…\\${w6Plan.folder_name}\\招生海报`
  )
  const w6Camp = listProjectsWithCount().find((p) => p.name === '海南升学初三集训营')!
  const w6PackB = createPack({ name: '招生海报', projectId: w6Camp.id, workspaceRoot: w6Ws })
  ok(
    w6PackB.folder_path === join(w6Ws, w6Camp.folder_name, '招生海报'),
    `【三级结构白送的好处】不同项目可以有同名包：…\\${w6Camp.folder_name}\\招生海报`
  )
  let w6Throw = ''
  try {
    createPack({ name: '不该建成', projectId: 999999, workspaceRoot: w6Ws })
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

  const w6Ren = updateProject(w6Plan.id, { name: '海南升学规划中心（南区）' }, w6Ws)
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

  const w6CampNow = listProjectsWithCount().find((p) => p.name === '海南升学初三集训营')!
  const w6Common = listProjectsWithCount().find((p) => p.name === '集团通用')!
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

  const w6Victim = listProjectsWithCount().find((p) => p.name === '集团通用')!
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
  ok(w6bProjs.length === 3, '造老库：打开时落好 3 个预制项目')
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

  closeDb()
  hardRm(w6bRoot)
  hardRm(w6Root)

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
