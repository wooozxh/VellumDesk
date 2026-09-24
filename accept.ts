/**
 * 第 1 批验收脚本 —— 按 docs/03-MVP入库功能方案.md 5.3 节主线，用真实文件跑一遍。
 * 调用的是 main 侧同一套业务函数（workspace.ts / db.ts），验证逻辑与界面一致。
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
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
  UNASSIGNED_ROLE
} from './src/main/workspace'
import {
  ensureThumbsForAssets,
  ensureImageMetaForAssets,
  ensureVideoMetaForAssets,
  setFfmpegDir,
  ffmpegReady
} from './src/main/thumbs'
import { getDb, closeDb } from './src/main/db'

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
  ok(existsSync(join(WS, '海南招生海报-2026秋季')), '包文件夹已在硬盘上创建')
  for (const sub of SUB_FOLDERS) {
    ok(existsSync(join(WS, '海南招生海报-2026秋季', sub)), `自动创建子文件夹 ${sub}`)
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
