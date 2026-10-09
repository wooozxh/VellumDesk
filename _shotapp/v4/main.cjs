/**
 * 第 4 批起的界面验证壳（第 5、6 批继续在这里加场景）。
 * 用 SHOT_SCENARIO 选择场景：
 *   banner     工作区不可用（顶部红色提示条 + 状态栏版本号）
 *   version    工作区正常（老格式配置自动升级）
 *   wslist     第 5 批：多工作区列表
 *   threelevel 第 6 批：三级目录结构（迁移提示条 / 待归类入口 / 项目行磁盘路径）
 * 工作区配置与截图都落在仓库外/忽略目录，绝不碰用户真实工作区 D:\素材工作区。
 */
const { app, BrowserWindow } = require('electron')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')

const { writeFileSync, mkdirSync, rmSync, existsSync } = require('fs')
const { join } = require('path')

// 界面文案统一走字典（由 `npx esbuild src/shared/copy.ts --outfile=_shotapp/v4/copy.cjs` 生成）：
// 断言引用 COPY.xxx 而不是硬编码中文，改文案时这里自动跟着变，不会测试失败。
const { COPY, fmt } = require('./copy.cjs')
/** 字典模板 → 用户实际看到的文字（去掉 <b>/<code>/<em>/<path>/<span> 内联标记） */
const plain = (s) => String(s).replace(/<\/?(b|code|em|span|path)>/g, '')

const ROOT = join(__dirname, '..', '..')
process.env.MEDIA_FFMPEG_DIR = join(ROOT, 'resources', 'ffmpeg')

const SCEN = process.env.SHOT_SCENARIO || 'banner'
const BASE = 'D:\\_accept_ws'
/** 拿一个「父级是文件」的路径当配置值：mkdir 必然失败，用来模拟"移动硬盘没插" */
const BLOCKER = join(BASE, 'shot4_blocker.txt')

const SCENARIOS = {
  banner: {
    userData: join(BASE, 'shot4_banner'),
    workspaceRoot: join(BLOCKER, 'dead'),
    shot: 'shot-b5-1-banner.png'
  },
  version: {
    userData: join(BASE, 'shot4_version'),
    workspaceRoot: join(BASE, 'shot_ws'),
    shot: 'shot-b5-2-version.png'
  },
  // 第 5 批：左栏工作区列表（两个工作区，第一个是当前）
  wslist: {
    userData: join(BASE, 'shot4_wslist'),
    workspaceRoot: join(BASE, 'shot_ws'),
    shot: 'shot-b5-3-wslist.png'
  },
  // 第 6 批：三级目录结构（工作区 / 项目 / 包）
  threelevel: {
    userData: join(BASE, 'shot4_threelevel'),
    workspaceRoot: join(BASE, 'shot_ws3'),
    shot: 'shot-b6-1-threelevel-migrated.png'
  },
  // 第 7 批：记录生命周期（编辑包信息 / 待归类归位 / 解绑还原 / 删进回收站）
  lifecycle: {
    userData: join(BASE, 'shot4_lifecycle'),
    workspaceRoot: join(BASE, 'shot_ws7'),
    shot: 'shot-b7-4-lifecycle-final.png'
  },
  // 第 7 批补：左栏标签计数口径（跟随项目 / 0 条置灰 / 解绑后跟着减）
  tagcount: {
    userData: join(BASE, 'shot4_tagcount'),
    workspaceRoot: join(BASE, 'shot_ws8'),
    shot: 'shot-b7-5-tagcount.png'
  },
  // 第 8 批：文件已丢失标记 + 重新定位（M8-03）
  missing: {
    userData: join(BASE, 'shot4_missing'),
    workspaceRoot: join(BASE, 'shot_ws9'),
    shot: 'shot-b8-3-missing-final.png'
  },
  // 第 9 批：M6 版本管理（一稿 = 包文件夹下的一个文件夹）
  versions: {
    userData: join(BASE, 'shot4_versions'),
    workspaceRoot: join(BASE, 'shot_wsv'),
    shot: 'shot-b9-9-unbind-still-3.png'
  },
  // 第 10 批：建包类别清单与左栏「物料类别」同源（改名 / 删除联动到包）
  category: {
    userData: join(BASE, 'shot4_category'),
    workspaceRoot: join(BASE, 'shot_wsc'),
    shot: 'shot-b10-4-category-deleted.png'
  },
  // 第 13 批：工单视图（顶栏第三格「工单」：筛选 / 徽标 / 关联任务 / 详情弹窗）
  tickets: {
    userData: join(BASE, 'shot4_tickets'),
    workspaceRoot: join(BASE, 'shot_wst'),
    shot: 'shot-b13-4-detail.png'
  },
  // 第 16 批：M5 交付打包（包详情 → 打包交付 → 生成 zip）
  export: {
    userData: join(BASE, 'shot4_export'),
    workspaceRoot: join(BASE, 'shot_wsexp'),
    shot: 'shot-b16-1-export-modal.png'
  },
  // 第 58 批（docs/43）：任务备份打包（工具条多选 → 批量打包 → 卡片置灰 + 已备份徽标）
  backup: {
    userData: join(BASE, 'shot4_backup'),
    workspaceRoot: join(BASE, 'shot_wsbk'),
    shot: 'shot-b58-6-backup-final.png'
  },
  // 第 25 批：未归属池入口（用户报的 bug —— 点虚线「未归属」卡片时弹窗一直「加载中」）
  unassigned: {
    userData: join(BASE, 'shot4_unassigned'),
    workspaceRoot: join(BASE, 'shot_wsu'),
    shot: 'shot-b25-4-unassigned-final.png'
  },
  // 第 54 批（docs/40）：首次配置引导（初装向导）
  // ⚠️ 这个场景的布景**故意不建库** —— 得让软件自己把 media.db 建出来，
  //    `firstRunThisSession` 才会是 true（向导的触发判据 = 库是不是本次新建的）
  wizard: {
    userData: join(BASE, 'shot4_wizard'),
    workspaceRoot: join(BASE, 'shot_wswz'),
    shot: 'shot-b54-9-wizard-after-reload.png'
  },
  // 使用手册专用：真实图片演示工作区（素材见 D:\_accept_ws\_manual_assets）
  // 只为「拍手册插图」存在，不做断言，跑完把一堆 shot-m-*.png 落在仓库根目录。
  manual: {
    userData: join(BASE, 'shot4_manual'),
    workspaceRoot: join(BASE, 'shot_manual'),
    shot: 'shot-m-00-home.png'
  }
}

const lines = []
let failed = 0
const say = (s) => lines.push(s)
const ok = (cond, label) => {
  lines.push(`${cond ? '  [OK]  ' : '  [FAIL]'} ${label}`)
  if (!cond) failed += 1
  return cond
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const s = SCENARIOS[SCEN]
  if (!s) {
    console.log('未知场景：' + SCEN)
    app.exit(3)
    return
  }

  mkdirSync(BASE, { recursive: true })
  writeFileSync(BLOCKER, 'blocker', 'utf-8')
  mkdirSync(s.userData, { recursive: true })

  // wslist 场景要两个工作区 —— 直接写 v2 结构（也能顺带验证 v2 读得对）
  const wsMain = join(BASE, 'shot_ws')
  const wsOther = join(BASE, 'shot_ws2')
  const cfgToWrite =
    SCEN === 'wslist'
      ? {
          version: 2,
          activeId: 'ws_main',
          workspaces: [
            {
              id: 'ws_main',
              name: '主素材库',
              root: wsMain,
              addedAt: '2026-09-25T00:00:00.000Z',
              lastOpenedAt: '2026-09-25T00:00:00.000Z'
            },
            {
              id: 'ws_design',
              name: '设计素材库',
              root: wsOther,
              addedAt: '2026-09-25T00:00:00.000Z',
              lastOpenedAt: ''
            }
          ],
          workspaceRoot: wsMain
        }
      : { workspaceRoot: s.workspaceRoot }

  writeFileSync(
    join(s.userData, 'workspace.json'),
    JSON.stringify(cfgToWrite, null, 2),
    'utf-8'
  )

  app.setPath('userData', s.userData)

  // ---- 第 6 批：三级结构场景 ----
  // 先在工作区里造出「老两级结构」（包文件夹直接躺在根目录）+ 老库记录，
  // 再让软件跑一次一次性迁移，然后验证界面。全程只碰 D:\_accept_ws。
  const ws = s.workspaceRoot
  if (SCEN === 'threelevel') {
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const oldPack = join(ws, '海南招生海报-2026秋季')
    mkdirSync(join(oldPack, '01-成品'), { recursive: true })
    mkdirSync(join(oldPack, '02-素材'), { recursive: true })
    writeFileSync(join(oldPack, '01-成品', '海报终稿.png'), 'png', 'utf-8')
    writeFileSync(join(oldPack, '02-素材', '底图.png'), 'png', 'utf-8')

    // 根目录下的游离包（库里有记录、但没有项目归属）→ 界面应归「待归类」
    const loosePack = join(ws, '零散海报')
    mkdirSync(join(loosePack, '01-成品'), { recursive: true })
    writeFileSync(join(loosePack, '01-成品', '随手做的.png'), 'png', 'utf-8')

    // 磁盘上已经存在、和项目同名的空文件夹（软件应识别并沿用，不再另建）
    mkdirSync(join(ws, '精英升学先修营'), { recursive: true })

    // 用已有的 workspace 产物建库（它内部带着 db 模块，会建表 + 建两个收纳区）
    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    // 播种"老两级结构"的库记录：直接连库写，避开 esbuild 分包导致的模块实例隔离
    const Database = require('better-sqlite3')
    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    // 项目不用自己造 —— initWorkspace 首次使用会落预制项目（第 14 批起是 6 个本厂项目：
    // 海南升学集训营 / 精英升学先修营 / 精英志愿填报中心 / 一对一项目部 / 精英岛 / 总部）
    const pid = d.prepare('SELECT id FROM projects WHERE name = ?').get('海南升学集训营').id
    const addPack = d.prepare(
      `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    addPack.run('海南招生海报-2026秋季', '海报', oldPack, pid, now, now)
    addPack.run('零散海报', '海报', loosePack, null, now, now)
    // 抹掉布局标记 + 迁移提示 —— 模拟"这个库还是老结构，等着软件来迁"
    d.prepare("DELETE FROM meta WHERE key IN ('layout_version', 'layout_notice')").run()
    d.close()

    // 再跑一次 initWorkspace：这次库里有包，会真正走一遍一次性迁移
    wsm.initWorkspace(ws)
    const check = new Database(join(ws, '_system', 'media.db'), { readonly: true })
    const metaRow = check.prepare("SELECT value FROM meta WHERE key = 'layout_notice'").get()
    say('layout_version        : ' + JSON.stringify(check.prepare("SELECT value FROM meta WHERE key='layout_version'").get()))
    say('layout_notice         : ' + (metaRow ? metaRow.value : '(none)'))
    check.close()
    say('root entries          : ' + require('fs').readdirSync(ws).join(' | '))
    say(
      'migrated pack on disk : ' +
        (require('fs').existsSync(join(ws, '海南升学集训营', '海南招生海报-2026秋季', '01-成品', '海报终稿.png'))
          ? '包已进项目文件夹 ✅'
          : '❌ 包没被搬进项目文件夹')
    )
  }

  // ---- 第 54 批（docs/40）：首次配置引导 ----
  // 只建空目录、**不建库**：让软件启动时自己把 media.db 建出来，
  // 这样主进程的 `firstRunThisSession` 才是 true（= 向导该弹）。
  if (SCEN === 'wizard') {
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })
  }

  // ---- 第 7 批：记录生命周期场景 ----
  // 造一个正常的三级工作区：一个项目 + 2 个包（在项目文件夹里）+ 1 个游离包（根目录 → 待归类）
  if (SCEN === 'lifecycle') {
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws) // 建库 + 落 3 个预制项目 + 两个收纳区

    const Database = require('better-sqlite3')
    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const pid = d.prepare('SELECT id FROM projects WHERE name = ?').get('海南升学集训营').id
    const folder = d.prepare('SELECT folder_name FROM projects WHERE id = ?').get(pid).folder_name
    const SUB = ['01-成品', '02-素材', '03-工程']

    const inProject = join(ws, folder, '海南招生海报-2026秋季')
    for (const sub of SUB) mkdirSync(join(inProject, sub), { recursive: true })
    writeFileSync(join(inProject, '01-成品', '海报终稿.png'), 'png', 'utf-8')
    writeFileSync(join(inProject, '02-素材', '底图.png'), 'png', 'utf-8')

    const second = join(ws, folder, '招生折页-A4')
    for (const sub of SUB) mkdirSync(join(second, sub), { recursive: true })
    writeFileSync(join(second, '01-成品', '折页封面.png'), 'png', 'utf-8')

    const loose = join(ws, '零散海报')
    for (const sub of SUB) mkdirSync(join(loose, sub), { recursive: true })
    writeFileSync(join(loose, '01-成品', '随手做的.png'), 'png', 'utf-8')

    const addPack = d.prepare(
      `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    addPack.run('海南招生海报-2026秋季', '海报', inProject, pid, now, now)
    addPack.run('招生折页-A4', '折页', second, pid, now, now)
    addPack.run('零散海报', '海报', loose, null, now, now)
    d.close()

    wsm.scanAll(ws) // 登记文件，让包卡片有文件数
    const chk = new Database(join(ws, '_system', 'media.db'), { readonly: true })
    say('seeded packs          : ' + chk.prepare('SELECT COUNT(*) AS c FROM packs').get().c)
    say('seeded assets         : ' + chk.prepare('SELECT COUNT(*) AS c FROM assets').get().c)
    chk.close()
    say('root entries          : ' + require('fs').readdirSync(ws).join(' | '))
  }

  // ---- 第 7 批补：标签计数口径场景 ----
  // 两个项目各挂 1 个包（甲 2 个文件 / 乙 1 个文件）+ 根目录 1 个游离包（1 个文件），
  // 4 个文件全贴同一个标签 —— 于是「全部 / 甲 / 乙 / 待归类」四个范围分别是 4 / 2 / 1 / 1，
  // 一眼就能看出数字到底跟着谁走。
  if (SCEN === 'tagcount') {
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    const Database = require('better-sqlite3')
    const SUB = ['01-成品', '02-素材', '03-工程']
    const mkPackDir = (dir) => {
      for (const sub of SUB) mkdirSync(join(dir, sub), { recursive: true })
      writeFileSync(join(dir, '01-成品', '占位.png'), 'png', 'utf-8')
    }

    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const projA = d.prepare('SELECT id, folder_name FROM projects WHERE name = ?').get('海南升学集训营')
    const projB = d
      .prepare('SELECT id, folder_name FROM projects WHERE name = ?')
      .get('精英升学先修营')

    const packDirA = join(ws, projA.folder_name, '计数甲包')
    const packDirB = join(ws, projB.folder_name, '计数乙包')
    const packDirLoose = join(ws, '计数游离包')
    for (const dir of [packDirA, packDirB, packDirLoose]) for (const sub of SUB) mkdirSync(join(dir, sub), { recursive: true })
    writeFileSync(join(packDirA, '01-成品', '甲1.png'), 'png', 'utf-8')
    writeFileSync(join(packDirA, '01-成品', '甲2.png'), 'png', 'utf-8')
    writeFileSync(join(packDirB, '01-成品', '乙1.png'), 'png', 'utf-8')
    writeFileSync(join(packDirLoose, '01-成品', '游离1.png'), 'png', 'utf-8')

    const addPack = d.prepare(
      `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    addPack.run('计数甲包', '海报', packDirA, projA.id, now, now)
    addPack.run('计数乙包', '海报', packDirB, projB.id, now, now)
    addPack.run('计数游离包', '海报', packDirLoose, null, now, now)
    // 第 49 批（docs/34）：给「甲包」标 S 级、「乙包」标 A 级、游离包留未分级 ——
    // 用来验分级标签的数字也统计任务数，且**跟随左栏当前项目范围**（甲/乙/待归类各不同）。
    d.prepare('UPDATE packs SET grade = ? WHERE name = ?').run(COPY.seed.gradeS, '计数甲包')
    d.prepare('UPDATE packs SET grade = ? WHERE name = ?').run(COPY.seed.gradeA, '计数乙包')
    d.close()

    wsm.scanAll(ws)

    // 贴标签：4 个文件全部贴上预制标签「海报」
    const d2 = new Database(join(ws, '_system', 'media.db'))
    d2.pragma('foreign_keys = ON')
    const tagId = d2.prepare("SELECT id FROM tags WHERE dimension = 'category' AND name = '海报'").get().id
    const assets = d2.prepare('SELECT id, file_name FROM assets').all()
    const ins = d2.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
    for (const a of assets) ins.run(a.id, tagId)
    say('seeded packs          : ' + d2.prepare('SELECT COUNT(*) AS c FROM packs').get().c)
    say('seeded assets         : ' + assets.length)
    say('seeded asset_tags     : ' + d2.prepare('SELECT COUNT(*) AS c FROM asset_tags').get().c)
    say('taged files           : ' + assets.map((a) => a.file_name).join(' | '))
    d2.close()
    say(
      'expect 全部/甲/乙/待归类 : 4 / 2 / 1 / 1（实际以断言为准）'
    )
  }

  if (SCEN === 'missing') {
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    const Database = require('better-sqlite3')
    const SUB = ['01-成品', '02-素材', '03-工程']

    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const proj = d
      .prepare('SELECT id, folder_name FROM projects WHERE name = ?')
      .get('海南升学集训营')

    const packDir = join(ws, proj.folder_name, '丢失演示包')
    for (const sub of SUB) mkdirSync(join(packDir, sub), { recursive: true })
    writeFileSync(join(packDir, '01-成品', '海报终稿.png'), 'AAAA', 'utf-8')
    writeFileSync(join(packDir, '02-素材', '底图.psd'), 'BBBB', 'utf-8')
    writeFileSync(join(ws, '散落的图.png'), 'CCCC', 'utf-8')

    d.prepare(
      `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('丢失演示包', '海报', packDir, proj.id, now, now)
    d.close()

    wsm.scanAll(ws)

    // 给「海报终稿.png」贴上预制标签「海报」—— 后面要验证"文件丢了，标签也没丢"
    const d2 = new Database(join(ws, '_system', 'media.db'))
    d2.pragma('foreign_keys = ON')
    const tagRow = d2
      .prepare("SELECT id FROM tags WHERE dimension = 'category' AND name = '海报'")
      .get()
    const t1 = d2.prepare('SELECT id FROM assets WHERE file_name = ?').get('海报终稿.png')
    d2.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)').run(t1.id, tagRow.id)
    say('seeded assets         : ' + d2.prepare('SELECT COUNT(*) AS c FROM assets').get().c)
    say('seeded asset_tags     : ' + d2.prepare('SELECT COUNT(*) AS c FROM asset_tags').get().c)
    d2.close()

    // 模拟"用户在资源管理器里把两个文件删了 / 挪走了"（一个包内、一个根目录散文件）
    rmSync(join(packDir, '01-成品', '海报终稿.png'), { force: true })
    rmSync(join(ws, '散落的图.png'), { force: true })
    const sc = wsm.scanAll(ws)
    say('marked missing        : ' + sc.markedMissing)
    const d3 = new Database(join(ws, '_system', 'media.db'))
    say(
      'assets after mark     : ' + d3.prepare('SELECT COUNT(*) AS c FROM assets').get().c
    )
    say(
      'missing rows          : ' +
        d3.prepare('SELECT file_name FROM assets WHERE missing_at IS NOT NULL').all().map((r) => r.file_name).join(' | ')
    )
    d3.close()
  }

  // ---- 第 9 批：M6 版本管理场景 ----
  // 布景一个包，磁盘上摆出 5 种"稿"的样子：
  //   V1       软件建的第一稿（当初把包里的文件"收编"进去的）
  //   V2       当前稿（客户的改后版）
  //   V3       用户在资源管理器里自己建的、名字规范 → 扫描时"自动认"
  //   终版-客户定稿   用户自己建的、名字不规范 → 扫描不猜，只能靠「绑定文件夹」纳入管理
  //   包根散文件      不在任何一稿里 → 界面归「未分版本」
  if (SCEN === 'versions') {
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    const Database = require('better-sqlite3')
    const SUB = ['01-成品', '02-素材', '03-工程']
    /** 写点像样的体积进去，截图上"容量/大小"才不是一片 0 B */
    const blob = (kb) => 'x'.repeat(kb * 1024)

    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const proj = d
      .prepare('SELECT id, folder_name FROM projects WHERE name = ?')
      .get('海南升学集训营')
    const packDir = join(ws, proj.folder_name, '海南招生海报-2026秋季')

    const seedVer = (folder, files) => {
      const dir = join(packDir, folder)
      for (const sub of SUB) mkdirSync(join(dir, sub), { recursive: true })
      for (const [sub, name, kb] of files) writeFileSync(join(dir, sub, name), blob(kb), 'utf-8')
      return dir
    }

    seedVer('V1', [
      ['01-成品', '招生海报-初稿.png', 320],
      ['02-素材', '背景底图.png', 880],
      ['03-工程', '海报源文件.psd', 2400]
    ])
    seedVer('V2', [
      ['01-成品', '招生海报-改后.png', 410],
      ['01-成品', '招生海报-竖版.png', 380],
      ['03-工程', '海报源文件.psd', 2600]
    ])
    seedVer('V3', [['01-成品', '招生海报-终审.png', 450]])
    seedVer('终版-客户定稿', [['01-成品', '招生海报-客户签字版.png', 460]])

    // 直接丢在包根目录的散文件
    writeFileSync(join(packDir, '临时导出的预览图.png'), blob(120), 'utf-8')

    d.prepare(
      `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('海南招生海报-2026秋季', '海报', packDir, proj.id, now, now)
    d.close()

    // 扫一遍：V1 / V2 / V3 被自动认（名字符合 V<数字>），「终版-客户定稿」不会被猜
    const vscan = wsm.scanAll(ws)
    say('auto-recognized vers  : ' + vscan.newVersions)
    say('version conflicts     : ' + (vscan.versionConflicts.join(' | ') || '(none)'))

    // 补版本说明 + 把当前指针指到 V2。
    // （指针不动是设计如此：用户自己在资源管理器里建个 V3 文件夹，不该把"当前"悄悄挪走）
    const d2 = new Database(join(ws, '_system', 'media.db'))
    d2.pragma('foreign_keys = ON')
    const pack = d2.prepare('SELECT id FROM packs WHERE name = ?').get('海南招生海报-2026秋季')
    const setNote = d2.prepare('UPDATE pack_versions SET note = ? WHERE pack_id = ? AND seq = ?')
    setNote.run('初稿——按招生简报先出一版', pack.id, 1)
    setNote.run('客户反馈：主标题太小，整体调亮', pack.id, 2)
    setNote.run('终审版——换蓝色主视觉', pack.id, 3)
    d2.prepare('UPDATE pack_versions SET is_current = 0 WHERE pack_id = ?').run(pack.id)
    d2.prepare('UPDATE pack_versions SET is_current = 1 WHERE pack_id = ? AND seq = 2').run(pack.id)
    say(
      'seeded versions       : ' +
        d2
          .prepare('SELECT seq, folder_name, is_current FROM pack_versions WHERE pack_id = ? ORDER BY seq')
          .all(pack.id)
          .map((v) => `V${v.seq}=${v.folder_name}${v.is_current ? '(当前)' : ''}`)
          .join(' | ')
    )
    d2.close()
  }

  if (SCEN === 'category') {
    // 第 10 批：三个包各带一个类别（海报 / 单页 / 折页）——
    // 一会儿在左栏把「单页」删掉，看它是不是只影响到用它的那个包。
    // （第 14 批换预制清单后，「短视频」不再是预制标签了，删除目标改用「单页」）
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    const Database = require('better-sqlite3')
    const SUB = ['01-成品', '02-素材', '03-工程']
    const blob = (kb) => 'x'.repeat(kb * 1024)

    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const proj = d
      .prepare('SELECT id, folder_name FROM projects WHERE name = ?')
      .get('海南升学集训营')

    const seedPack = (name, cat, files) => {
      const dir = join(ws, proj.folder_name, name)
      for (const sub of SUB) mkdirSync(join(dir, 'V1', sub), { recursive: true })
      for (const [sub, fn, kb] of files) writeFileSync(join(dir, 'V1', sub, fn), blob(kb), 'utf-8')
      d.prepare(
        `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(name, cat, dir, proj.id, now, now)
    }
    seedPack('海南招生海报-2026秋季', '海报', [
      ['01-成品', '招生海报.png', 420],
      ['02-素材', '背景底图.png', 880]
    ])
    seedPack('招生短视频-30秒', '单页', [['01-成品', '成片30秒.mp4', 3200]])
    seedPack('招生简章折页', '折页', [['01-成品', '折页正面.png', 380]])
    d.close()

    const scanned = wsm.scanAll(ws)
    say('seeded packs          : 3（海报 / 单页 / 折页）')
    say('auto-recognized vers  : ' + scanned.newVersions)
  }

  if (SCEN === 'unassigned') {
    // 第 25 批：一个正常任务 + 一个丢在工作区根目录的散文件。
    // 后者就是「未归属池」的内容 —— 池子非空时，任务视图里才会多出那张虚线「未归属」卡片。
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    const Database = require('better-sqlite3')
    const SUB = ['01-成品', '02-素材', '03-工程']
    const blob = (kb) => 'x'.repeat(kb * 1024)

    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const proj = d
      .prepare('SELECT id, folder_name FROM projects WHERE name = ?')
      .get('海南升学集训营')

    const packDir = join(ws, proj.folder_name, '招生海报-未归属演示')
    for (const sub of SUB) mkdirSync(join(packDir, 'V1', sub), { recursive: true })
    writeFileSync(join(packDir, 'V1', '01-成品', '海报终稿.png'), blob(300), 'utf-8')
    d.prepare(
      `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('招生海报-未归属演示', '海报', packDir, proj.id, now, now)
    d.close()

    // 工作区根目录的散文件 = 未归属池（本场景断言的主角）
    writeFileSync(join(ws, '待整理的散图.png'), blob(120), 'utf-8')

    wsm.scanAll(ws)
    say('seeded packs          : 1（招生海报-未归属演示）')
    say('unassigned seeded     : 1（工作区根目录「待整理的散图.png」）')
  }

  if (SCEN === 'tickets') {
    // 第 13 批：工单视图。播种 8 张覆盖各形态的工单（我的/别人的/未指派/历史/待确认/撞号）
    // + 一张已建任务的单。meta 里落好配置（docid / 子表映射 / 本机身份 / 首同步已做），
    // 界面一进工单视图就该出列表 —— 全程不碰真企微（wecom 适配器只在真同步时才被调）。
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    const Database = require('better-sqlite3')
    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const proj = d
      .prepare('SELECT id, folder_name FROM projects WHERE name = ?')
      .get('海南升学集训营')

    // 给 T001 配一个真实任务（文件夹 + packs 记录 + 工单关联）
    const SUB = ['01-成品', '02-素材', '03-工程']
    const t1Dir = join(ws, proj.folder_name, '海南招生海报-工单A')
    for (const sub of SUB) mkdirSync(join(t1Dir, 'V1', sub), { recursive: true })
    writeFileSync(join(t1Dir, 'V1', '01-成品', '海报终稿.png'), 'x'.repeat(300 * 1024), 'utf-8')
    const packInfo = d
      .prepare(
        `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('海南招生海报-工单A', '海报', t1Dir, proj.id, now, now)
    const packId = Number(packInfo.lastInsertRowid)

    // 工单配置（meta）：已配置 + 首同步已做（否则全部会被当成历史单）
    const setM = d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
    setM.run('ticket_docid', 's3_SHOTTEST')
    setM.run('ticket_docname', '营销物料设计工单队列（测试）')
    setM.run(
      'ticket_sheets',
      JSON.stringify([
        { title: '营销物料制作申请（印刷物料）', sheet_id: 'tlT1', type: 'print', enabled: true },
        { title: '营销物料制作申请（电子物料）', sheet_id: 'tlT2', type: 'digital', enabled: true }
      ])
    )
    setM.run('ticket_identity', JSON.stringify({ userid: 'uME', name: '测试设计师' }))
    setM.run('ticket_first_sync_done', '1')
    // 第 50 批（docs/35）：模拟「同步时判定缩略图列不可用」。**必须在布景期写** ——
    // 软件开库之后再改 meta，主进程那份连接看不到（实测：写进去了、status 仍返回旧值）。
    // 设 SHOT_THUMB_COL_BAD=1 跑本场景即可验「设置弹窗里出现警示行」那一支。
    if (process.env.SHOT_THUMB_COL_BAD === '1') {
      setM.run('ticket_thumb_ok', '0')
    }
    // 第 26 批（docs/31）：**显式关掉自动同步**。上面配的是假 docid，若不关掉，软件启动
    // 15 秒后会真去跑 wecom-cli 拉这张不存在的表 —— 后台行为污染场景、还白等一次进程 spawn。
    // 自动同步的判定 / 记账逻辑由 accept 断言覆盖，界面场景只验形态与读写闭环。
    setM.run('ticket_auto_sync', '0')

    const addTicket = d.prepare(`
      INSERT INTO tickets (sheet_id, ticket_type, ticket_no, record_id, title, approval_state,
        applicant_name, department, designer_userid, designer_name, project_name,
        due_date, submit_time, material_category, print_qty, is_history, need_confirm,
        dup_warn, dup_json, raw_json, first_seen_at, last_sync_at, pack_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?, ?)`)
    // 第 18 批（docs/20 §4）：设计师进子表 ticket_designers（多选成员列落库结构）
    const addDesigner = d.prepare(
      'INSERT INTO ticket_designers (ticket_no, userid, name, seq) VALUES (?, ?, ?, ?)'
    )
    const T = (no, o) => {
      // 第 18 批：统一走 designers 数组（缺省 = 老单值字段兜底）；单值列 designer_userid/name = designers[0] 冗余
      const designers =
        o.designers ?? [
          {
            userid: o.designer === undefined ? 'uME' : o.designer,
            name: o.designerName === undefined ? '测试设计师' : o.designerName
          }
        ]
      const primary = designers[0] ?? { userid: null, name: null }
      addTicket.run(
        'tlT1', 'print', no, 'rec_' + no,
        o.title ?? '物料-' + no, o.state ?? '审批中',
        '申请人甲', '营销中心',
        primary.userid, primary.name,
        o.project ?? '海南升学集训营',
        o.due ?? '2026-10-05', now, o.cat ?? '海报', o.qty ?? 100,
        o.history ? 1 : 0, o.pending ? 1 : 0, o.dup ? 1 : 0,
        now, now, o.packId ?? null
      )
      designers.forEach((dd, i) => dd && dd.userid && addDesigner.run(no, dd.userid, dd.name, i))
    }
    T('202610010001', { title: '海南招生海报-工单A', state: '审批中', packId }) // 我的，已建任务
    T('202610010002', { title: '招生折页-B款', state: '已通过' })                  // 我的，活已干完
    T('202610010003', { title: '易拉宝-校区门口', state: '已驳回' })               // 我的，驳回 → 压暗
    T('202610010004', {
      title: '详情长图-国庆版', state: '审批中',
      designer: 'uOTHER', designerName: '别的同事', due: '2026-10-08'
    })                                                                              // 别人的
    T('202610010005', { title: '推文配图-双节', designer: null, designerName: null }) // 未指派
    T('202610010006', { title: '旧单-开学季', history: true })                      // 历史单
    T('202610010007', { title: '新单-待确认', pending: true })                      // 子表重建后的新单
    T('202610010008', { title: '撞号单', dup: true })                               // 编号重复
    // 第 18 批（docs/20）：多人协作单 —— 两名设计师，测「等 N 人」+ 多选标签
    T('202610010010', {
      title: '大屏主视觉-多人协作', state: '审批中',
      designers: [
        { userid: 'uME', name: '测试设计师' },
        { userid: 'uOTHER', name: '别的同事' }
      ]
    })
    // 一张电子类型的（第二子表）
    addTicket.run(
      'tlT2', 'digital', '202610010009', 'rec_202610010009', '短视频封面-秋季', '审批中',
      '申请人乙', '营销中心', 'uME', '测试设计师', '海南升学集训营',
      '2026-10-06', now, null, null, 0, 0, 0, now, now, null
    )
    addDesigner.run('202610010009', 'uME', '测试设计师', 0)
    d.close()
    wsm.scanAll(ws) // 登记 T001 任务里的文件，详情卡有文件数
    say('seeded tickets        : 10（我的3 / 别人1 / 未指派1 / 历史1 / 待确认1 / 撞号1 / 电子1 / 多人1）')
  }

  if (SCEN === 'export') {
    // 第 16 批：M5 交付打包。造一个三级工作区 + 一个带 V1 的任务，
    // V1 下 01/02/03 各放 1 个文件，方便弹窗里默认勾选全部三组。
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    const Database = require('better-sqlite3')
    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const proj = d
      .prepare('SELECT id, folder_name FROM projects WHERE name = ?')
      .get('海南升学集训营')

    const packDir = join(ws, proj.folder_name, '海南招生海报-导出测试')
    const SUB = ['01-成品', '02-素材', '03-工程']
    for (const sub of SUB) mkdirSync(join(packDir, 'V1', sub), { recursive: true })
    writeFileSync(join(packDir, 'V1', '01-成品', '海报终稿.png'), 'x'.repeat(300 * 1024), 'utf-8')
    writeFileSync(join(packDir, 'V1', '02-素材', '底图.png'), 'y'.repeat(200 * 1024), 'utf-8')
    writeFileSync(join(packDir, 'V1', '03-工程', '工程源文件.psd'), 'z'.repeat(100 * 1024), 'utf-8')

    d.prepare(
      `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('海南招生海报-导出测试', '海报', packDir, proj.id, now, now)
    d.close()

    wsm.scanAll(ws)
    say('seeded export pack    : ' + packDir)
  }

  // ---- 第 58 批（docs/43）：任务备份打包 ----
  // 造一个项目 + 两个任务（各带 成品/素材 两个文件），用来验多选备份的整套界面。
  if (SCEN === 'backup') {
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    const Database = require('better-sqlite3')
    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    const proj = d
      .prepare('SELECT id, folder_name FROM projects WHERE name = ?')
      .get('海南升学集训营')

    const SUB = ['01-成品', '02-素材', '03-工程']
    const addPack = d.prepare(
      `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    const mk = (name, bytes) => {
      const dir = join(ws, proj.folder_name, name)
      for (const sub of SUB) mkdirSync(join(dir, sub), { recursive: true })
      // 用**随机字节**而不是 'x'.repeat()：高度可压的数据打成 zip 只剩几十字节，
      // 「zip 非空」这类断言就失去意义了（真实图片是压不动的）。
      writeFileSync(join(dir, '01-成品', '成品.png'), require('crypto').randomBytes(bytes))
      writeFileSync(join(dir, '02-素材', '底图.png'), require('crypto').randomBytes(Math.floor(bytes / 2)))
      addPack.run(name, '海报', dir, proj.id, now, now)
      return dir
    }
    const bp1 = mk('海南招生海报', 80 * 1024)
    const bp2 = mk('抖音短视频封面', 60 * 1024)
    d.close()

    wsm.scanAll(ws)
    say('seeded backup packs   : ' + bp1 + ' | ' + bp2)
  }

  // ============================================================
  // 使用手册专用布景：一份「像真在用的」工作区
  //   · 素材是**真图片**（D:\_accept_ws\_manual_assets，由 _manual/gen_assets.py 生成）
  //   · 4 个项目 / 7 个任务 / 2 稿 / 真视频 / 真缩略图 / 打了标签
  //   只写 D:\_accept_ws\shot_manual，绝不碰用户真实工作区
  // ============================================================
  if (SCEN === 'manual') {
    rmSync(ws, { recursive: true, force: true })
    mkdirSync(ws, { recursive: true })

    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    const Database = require('better-sqlite3')
    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const SUB = ['01-成品', '02-素材', '03-工程']
    const A = 'D:\\_accept_ws\\_manual_assets'
    const now = new Date().toISOString()

    const put = (verDir, sub, src, asName) => {
      mkdirSync(join(verDir, sub), { recursive: true })
      require('fs').copyFileSync(join(A, src), join(verDir, sub, asName || src))
    }
    const subFolders = (verDir) => { for (const s of SUB) mkdirSync(join(verDir, s), { recursive: true }) }

    const pj = (n) => d.prepare('SELECT id, folder_name FROM projects WHERE name = ?').get(n)
    const P1 = pj('海南升学集训营')
    const P2 = pj('精英升学先修营')
    const P3 = pj('精英志愿填报中心')
    const P4 = pj('一对一项目部')
    const addPack = d.prepare(
      `INSERT INTO packs (name, category, folder_path, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )

    // A —— 主任务：两稿（V2 当前）
    const dirA = join(ws, P1.folder_name, '海南招生海报-2026秋季')
    subFolders(join(dirA, 'V1'))
    put(join(dirA, 'V1'), '01-成品', '海报-秋季招生主视觉.png')
    put(join(dirA, 'V1'), '02-素材', '底图-椰林渐变.jpg')
    put(join(dirA, 'V1'), '03-工程', '素材-暗色渐变.jpg', '主视觉源文件.psd')
    subFolders(join(dirA, 'V2'))
    put(join(dirA, 'V2'), '01-成品', '海报-秋季招生主视觉.png', '海报-秋季招生主视觉-终稿.png')
    put(join(dirA, 'V2'), '01-成品', '海报-初三集训营.png')
    put(join(dirA, 'V2'), '02-素材', '素材-几何底纹.jpg')
    require('fs').copyFileSync(join(A, '配图-公众号首图.png'), join(dirA, '临时导出的预览图.png'))
    addPack.run('海南招生海报-2026秋季', '海报', dirA, P1.id, now, now)

    // B —— 折页
    const dirB = join(ws, P1.folder_name, '招生折页-A4三折')
    subFolders(join(dirB, 'V1'))
    put(join(dirB, 'V1'), '01-成品', '折页封面-A4三折.png')
    put(join(dirB, 'V1'), '02-素材', '素材-暗色渐变.jpg')
    put(join(dirB, 'V1'), '03-工程', '素材-几何底纹.jpg', '折页源文件.psd')
    addPack.run('招生折页-A4三折', '折页', dirB, P1.id, now, now)

    // C —— 视频任务（真 mp4，缩略图走 FFmpeg 抽帧）
    const dirC = join(ws, P1.folder_name, '初三集训营形象片')
    subFolders(join(dirC, 'V1'))
    put(join(dirC, 'V1'), '01-成品', '宣传片-秋季形象片.mp4')
    put(join(dirC, 'V1'), '02-素材', '底图-椰林渐变.jpg', '底图-片头.jpg')
    addPack.run('初三集训营形象片', 'KV-电子展示', dirC, P1.id, now, now)

    // D —— 另一个项目的系列海报
    const dirD = join(ws, P2.folder_name, '精英先修营-系列海报')
    subFolders(join(dirD, 'V1'))
    put(join(dirD, 'V1'), '01-成品', '海报-精英先修营.png')
    put(join(dirD, 'V1'), '02-素材', '素材-几何底纹.jpg')
    addPack.run('精英先修营-系列海报', '海报', dirD, P2.id, now, now)

    // E —— 电子屏 KV
    const dirE = join(ws, P3.folder_name, '志愿填报-电子屏KV')
    subFolders(join(dirE, 'V1'))
    put(join(dirE, 'V1'), '01-成品', 'KV-电子屏主视觉.png')
    addPack.run('志愿填报-电子屏KV', 'KV-电子展示', dirE, P3.id, now, now)

    // F —— 长图
    const dirF = join(ws, P4.folder_name, '国庆活动朋友圈长图')
    subFolders(join(dirF, 'V1'))
    put(join(dirF, 'V1'), '01-成品', '长图-国庆活动.png')
    put(join(dirF, 'V1'), '02-素材', '素材-暗色渐变.jpg')
    addPack.run('国庆活动朋友圈长图', '电商长图', dirF, P4.id, now, now)

    // ⚠️ 刻意**不**造「躺在工作区根目录、里面是 V1」的待归类任务：
    //    scanAll 的 listTopDirs 只用「直接子级有没有三组」来区分「项目文件夹 / 游离任务」，
    //    这种布局会被误判成项目文件夹、把里面的 V1 当成一个新任务。
    //    已单独复现并记录（见本次会话报告），不在手册布景里制造这种状态。

    // 未归属池：直接丢在工作区根目录的散文件
    require('fs').copyFileSync(join(A, '配图-公众号首图.png'), join(ws, '公众号配图-待整理.png'))
    require('fs').copyFileSync(join(A, '素材-暗色渐变.jpg'), join(ws, '素材-暗色渐变.jpg'))

    d.close()

    // 扫一遍：V1 / V2 自动认，生成真缩略图（sharp 对真图；mp4 走 FFmpeg 抽帧）
    const vscan = wsm.scanAll(ws)
    say('manual auto-versions  : ' + vscan.newVersions)

    // 补版本说明 + 把「当前」指到 V2（和真实用法一致：改稿后新建一稿）
    const d2 = new Database(join(ws, '_system', 'media.db'))
    d2.pragma('foreign_keys = ON')
    const pkA = d2.prepare('SELECT id FROM packs WHERE name = ?').get('海南招生海报-2026秋季')
    const setNote = d2.prepare('UPDATE pack_versions SET note = ? WHERE pack_id = ? AND seq = ?')
    setNote.run('初稿——按招生简报先出一版', pkA.id, 1)
    setNote.run('客户反馈：主标题太小，整体调亮', pkA.id, 2)
    d2.prepare('UPDATE pack_versions SET is_current = 0 WHERE pack_id = ?').run(pkA.id)
    d2.prepare('UPDATE pack_versions SET is_current = 1 WHERE pack_id = ? AND seq = 2').run(pkA.id)

    // 给素材贴上标签（左栏三个维度的数字才有内容，不是一片灰 0）
    const tagRows = d2.prepare('SELECT id, dimension FROM tags ORDER BY dimension, sort_order, id').all()
    const byDim = {}
    for (const t of tagRows) (byDim[t.dimension] = byDim[t.dimension] || []).push(t.id)
    const pick = (dim, i) => (byDim[dim] && byDim[dim].length ? byDim[dim][i % byDim[dim].length] : null)
    const linkTag = d2.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
    const assets = d2.prepare('SELECT id, abs_path FROM assets').all()
    const plan = [
      ['海南招生海报', 6, 0, 0],
      ['招生折页', 1, 1, 1],
      ['形象片', 8, 6, 1],
      ['精英先修营', 0, 5, 2],
      ['志愿填报', 9, 2, 0],
      ['国庆活动', 7, 4, 2],
      ['待归位', 6, 4, 3]
    ]
    for (const a of assets) {
      const p = plan.find((x) => a.abs_path.includes(x[0])) || ['', 6, 0, 3]
      for (const [dim, idx] of [['category', p[1]], ['channel', p[2]], ['grade', p[3]]]) {
        const tid = pick(dim, idx)
        if (tid) linkTag.run(a.id, tid)
      }
    }
    say('manual tagged assets  : ' + d2.prepare('SELECT COUNT(*) AS c FROM asset_tags').get().c)
    say('manual packs / assets : ' + d2.prepare('SELECT COUNT(*) AS c FROM packs').get().c + ' / ' + assets.length)
    d2.close()
  }

  const errs = []
  require(join(ROOT, 'out/test/ipc.cjs')).registerIpc()
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#15161a',
    webPreferences: { preload: join(ROOT, 'out/preload/index.js'), sandbox: false }
  })
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) errs.push('L' + level + ': ' + msg)
  })
  win.webContents.on('render-process-gone', (_e, d) => errs.push('RENDER GONE: ' + JSON.stringify(d)))

  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code)
    } catch (e) {
      return '__JSERR__ ' + (e && e.message ? e.message : String(e))
    }
  }

  // ---- 各场景共用的 DOM 操作小工具 ----
  const shot = async (name) => {
    try {
      const img = await win.webContents.capturePage()
      writeFileSync(join(ROOT, name), img.toPNG())
      say('screenshot            : ' + name + ' (' + Math.round(img.toPNG().length / 1024) + ' KB)')
      // 可选：把这一屏的**全部可见文字**落盘（改文案/抽字典时做「前后一字不差」比对用）。
      // 不设 SHOT_TEXT_DUMP 时零行为；设了就是目标目录。
      if (process.env.SHOT_TEXT_DUMP) {
        const dir = process.env.SHOT_TEXT_DUMP
        mkdirSync(dir, { recursive: true })
        const base = name.replace(/\.png$/, '')
        const norm = (s) =>
          String(s)
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean)
            .join('\n')
        // ① 可见文字（受 CSS display/visibility 影响，最接近用户看到的）
        writeFileSync(join(dir, base + '.txt'), norm(await js('document.body.innerText')), 'utf-8')
        // ② 全部文字节点（**与 CSS 完全无关**，用来排除"CSS 改了导致某块被藏起来"的干扰）
        writeFileSync(
          join(dir, base + '.all.txt'),
          norm(await js(`(() => { const w=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const o=[]; while(w.nextNode()) o.push(w.currentNode.nodeValue); return o.join('\\n') })()`)),
          'utf-8'
        )
      }
    } catch (e) {
      ok(false, '截图失败：' + e.message)
    }
  }
  const clickByText = (sel, text) =>
    js(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
        .find(x => x.innerText.trim() === ${JSON.stringify(text)})
      if (!el) return 'no-el'
      el.click(); return 'ok'
    })()`)
  /** 点弹窗右下角那个主按钮（保存 / 确认）；弹窗不在时返回 no-btn，别再抛 TypeError 污染控制台 */
  const clickModalOk = () =>
    js(`(() => {
      const b = [...document.querySelectorAll('.modal .foot .btn')].pop()
      if (!b) return 'no-btn'
      b.click(); return 'ok'
    })()`)
  /**
   * 真鼠标移到项目行上 —— React 的 onMouseEnter 只认真实事件。
   * 第 14 批：预制项目 3 → 6 个，目标行可能落到左栏可视区之外；而且左栏标签面板
   * 长起来之后机器一忙这步偶发失效（症状 hovered=false → 后续 no-btn，tagcount 踩过两次）。
   * 所以这里做成确定性动作 + 整体重试 3 轮：
   *   ① 先把鼠标挪到左上角，清掉上一次残留的 hover（否则「已经在行上」不会再触发 mouseenter）
   *   ② scrollIntoView 把目标行滚进视野
   *   ③ 取坐标读两次，等 rect 稳定再移鼠标（滚动/重排未落定时取到的坐标会打偏）
   *   ④ 两步移入（-4px 再到位），轮询最多 2 秒等 React 渲染出悬浮按钮
   */
  const hoverProjectRow = async (idx) => {
    if (idx < 0) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 4, button: 'none' })
      await wait(250)
      return false
    }
    const readRect = () =>
      js(`(() => {
        const el = document.querySelectorAll('.side .proj-row')[${idx}]
        if (!el) return null
        const r = el.getBoundingClientRect()
        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          winH: window.innerHeight,
          visible: r.top >= 0 && r.bottom <= window.innerHeight
        }
      })()`)
    for (let attempt = 0; attempt < 3; attempt++) {
      // ① 清残留 hover
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 4, button: 'none' })
      await wait(120)
      // ② 滚进视野
      await js(`(() => {
        const el = document.querySelectorAll('.side .proj-row')[${idx}]
        if (el) el.scrollIntoView({ block: 'center' })
        return 'ok'
      })()`)
      await wait(220)
      // ③ 取坐标，读两次抹掉重排抖动
      let p = await readRect()
      if (!p) return false
      const p2 = await readRect()
      if (p2 && p2.y === p.y) p = p2
      else if (p2) {
        await wait(120)
        p = (await readRect()) || p2
      }
      if (process.env.SHOT_DEBUG_HOVER) {
        const dbg = await js(`(() => {
          const rows = [...document.querySelectorAll('.side .proj-row')]
          const list = rows.map((el, i) => { const r = el.getBoundingClientRect(); return { i, t: Math.round(r.top), b: Math.round(r.bottom) } })
          const at = document.elementFromPoint(${p.x}, ${p.y})
          return { win: { w: window.innerWidth, h: window.innerHeight }, count: rows.length, list, at: at ? (at.className + '|' + at.tagName) : 'null', p: ${JSON.stringify(p)}, attempt }
        })()`)
        say('HOVER_DBG ' + JSON.stringify(dbg))
      }
      // ④ 两步移入
      win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x - 4, y: p.y, button: 'none' })
      await wait(150)
      win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y, button: 'none' })
      for (let i = 0; i < 10; i++) {
        const has = await js(`!!document.querySelector('.side .proj-acts .mini')`)
        if (has) {
          await wait(80)
          return true
        }
        await wait(200)
      }
      say(`HOVER_RETRY 第 ${attempt + 1} 轮没 hover 上（row=${idx} y=${p.y}）`)
    }
    return false
  }
  const projRowNames = () =>
    js(`[...document.querySelectorAll('.side .proj-item .pname')].map(b => b.innerText.trim())`)
  const packCardNames = () =>
    js(`[...document.querySelectorAll('.grid .pack-card .name')].map(b => b.innerText.trim())`)
  const clickPackAction = (name, icon) =>
    js(`(() => {
      const cards = [...document.querySelectorAll('.grid .pack-card')]
      const c = cards.find(el => ((el.querySelector('.name') || {}).innerText || '').includes(${JSON.stringify(name)}))
      if (!c) return 'no-card'
      const b = c.querySelector('.pact')
      if (!b) return 'no-btn'
      if (${icon ? `!(b.getAttribute('title') || '').includes(${JSON.stringify(icon)})` : 'false'}) return 'wrong-icon:' + (b.getAttribute('title') || '')
      b.click(); return 'ok'
    })()`)
  /** 展开某个标签维度（折叠状态下看不到标签后的数字） */
  const expandDim = (label) =>
    js(`(() => {
      const b = [...document.querySelectorAll('.tp-dim-head')]
        .find(x => ((x.querySelector('.tp-dim-label') || {}).innerText || '').trim() === ${JSON.stringify(label)})
      if (!b) return 'no-head'
      if (b.querySelector('.caret.open')) return 'already'
      b.click(); return 'clicked'
    })()`)
  /** 读某个标签当前的显示数字 + 是否置灰 + 悬停提示 */
  const tagNum = (name) =>
    js(`(() => {
      const b = [...document.querySelectorAll('.tp-tag')]
        .find(x => ((x.querySelector('.tp-tag-name') || {}).innerText || '').trim() === ${JSON.stringify(name)})
      if (!b) return null
      return {
        n: Number((((b.querySelector('.tp-tag-n') || {}).innerText) || '0').trim()),
        zero: b.classList.contains('zero'),
        title: b.getAttribute('title') || ''
      }
    })()`)
  const pickSideItem = async (text, sel = '.side .item') => {
    const r = await clickByText(sel, text)
    await wait(750)
    return r
  }

  await win.loadFile(join(ROOT, 'out/renderer/index.html'))
  await wait(3000)

  say('scenario              : ' + SCEN)
  say('configured workspace  : ' + s.workspaceRoot)

  // 第 22 批：默认视图改为「工单队列」（顶栏第一格）。除 tickets 场景外，其余场景都围绕
  // 左栏 / 包视图做断言 —— 启动后统一切回「任务视图」，否则左栏（.side）整个不渲染，
  // 后面成片读 .side 的断言会连锁报红（看着像代码回归，其实只是默认视图换了）。
  // 启动瞬间的高亮另存快照，供 lifecycle / tickets 两个场景钉住「默认落在哪一格」。
  // 注意：这串文本可能带「未指派 N」角标（如「工单队列1」），所以断言一律用 startsWith 前缀匹配。
  const tabOnLoad = await js(
    `(() => { const el = document.querySelector('.tabs button.on'); return el ? el.innerText.trim() : '' })()`
  )
  if (SCEN !== 'tickets') {
    await clickByText('.tabs button', COPY.top.viewPacks)
    await wait(900)
  }

  const bannerText = await js(
    `(() => { const el = document.querySelector('.wsbanner:not(.info)'); return el ? el.innerText : '' })()`
  )
  const bannerBtnCount = await js(
    `document.querySelectorAll('.wsbanner .btn').length`
  )
  const statusText = await js(
    `(() => { const el = document.querySelector('.statusbar'); return el ? el.innerText : '' })()`
  )
  const leftPanelText = await js(
    `(() => { const el = document.querySelector('.side'); return el ? el.innerText : '' })()`
  )
  // 第 5 批：左栏工作区列表
  const wsItemCount = await js(`document.querySelectorAll('.wsitem').length`)
  const wsActiveCount = await js(`document.querySelectorAll('.wsitem.on').length`)
  const wsRemoveCount = await js(`document.querySelectorAll('.wsitem .wx').length`)
  const wsPathCount = await js(`document.querySelectorAll('.wsitem .wpath').length`)
  const wsActBtns = await js(`document.querySelectorAll('.wsitem.on .wacts button').length`)
  const wsAddText = await js(
    `(() => { const el = document.querySelector('.side .item.addws'); return el ? el.innerText : '' })()`
  )
  // 第 6 批：三级结构相关的 DOM
  const infoBannerText = await js(
    `(() => { const el = document.querySelector('.wsbanner.info'); return el ? el.innerText : '' })()`
  )
  const infoBannerBtn = await js(
    `(() => { const el = document.querySelector('.wsbanner.info .btn'); return el ? el.innerText.trim() : '' })()`
  )
  const looseEntry = await js(
    `(() => {
       const btns = [...document.querySelectorAll('.side .item')]
       const el = btns.find((b) => b.innerText.trim() === '待归类')
       return el ? el.innerText.trim() : ''
     })()`
  )
  const projTitles = await js(
    `[...document.querySelectorAll('.side .proj-item')].map((b) => b.getAttribute('title') || '')`
  )
  const projNames = await js(
    `[...document.querySelectorAll('.side .proj-item .pname')].map((b) => b.innerText.trim())`
  )

  if (SCEN === 'banner') {
    ok(typeof bannerText === 'string' && bannerText.length > 0, '工作区不可用时出现顶部提示条')
    ok(bannerText.includes(s.workspaceRoot), '提示条里写清了具体是哪个路径（' + s.workspaceRoot + '）')
    ok(bannerText.includes('移动硬盘') || bannerText.includes('磁盘'), '提示条给出了人看得懂的原因')
    ok(bannerText.includes('没动'), '提示条明确安抚：里面的东西一件没动')
    ok(bannerBtnCount === 2, `提示条有 2 个出口按钮（重试 / 更改位置），实际 ${bannerBtnCount}`)
    ok(/(^|[^0-9])v\d+\.\d+\.\d+/.test(statusText), '工作区挂了也能看到版本号：' + statusText.replace(/\s+/g, ' ').trim())
    ok(wsItemCount >= 1 && wsAddText.includes('添加工作区'), '工作区挂了，左栏仍列出工作区并给出换库入口')
  } else if (SCEN === 'wslist') {
    ok(bannerText === '' || bannerText === undefined || bannerText.length === 0, '工作区正常时不显示提示条')
    ok(wsItemCount === 2, `左栏列出 2 个工作区，实际 ${wsItemCount}`)
    ok(wsActiveCount === 1, `当前工作区只有一个且被高亮，实际 ${wsActiveCount}`)
    ok(
      leftPanelText.includes('主素材库') && leftPanelText.includes('设计素材库'),
      '两个工作区的名字都显示出来了'
    )
    ok(wsPathCount === 2, `每个工作区都显示完整路径（同名文件夹靠它区分），实际 ${wsPathCount}`)
    ok(wsRemoveCount === 1, `非当前项才给「×」移除按钮，实际 ${wsRemoveCount}`)
    ok(wsActBtns === 2, `当前项给了 2 个操作（打开文件夹 / 搬移位置），实际 ${wsActBtns}`)
    ok(wsAddText.includes('添加工作区'), '底部有「＋ 添加工作区」入口')
    ok(statusText.includes('主素材库'), '状态栏写明了当前是哪个工作区')
    ok(statusText.includes('v1.0.0'), '状态栏仍显示版本号')
  } else if (SCEN === 'threelevel') {
    // ---- 迁移提示条 ----
    ok(infoBannerText.length > 0, '刚迁移过的工作区出现「目录结构已升级」提示条')
    ok(infoBannerText.includes('目录结构已升级'), '提示条标题说明了发生了什么')
    ok(infoBannerText.includes(COPY.banner.layoutUpgraded), '提示条写清新结构是三级：工作区 / 项目 / 任务')
    ok(infoBannerText.includes(fmt(COPY.banner.layoutMoved, { n: 1 })), '提示条报出了本次搬了几个任务（应为 1 个）')
    ok(infoBannerText.includes('文件一个没动'), '提示条明确安抚：文件一个没动')
    ok(infoBannerBtn === '知道了', `提示条只给一个出口「知道了」，实际「${infoBannerBtn}」`)
    ok(bannerText === '' || bannerText === undefined || bannerText.length === 0, '工作区正常，不显示红色错误条')

    // ---- 左栏：待归类入口 ----
    ok(looseEntry === '待归类', '根目录下的游离包让左栏多了「待归类」入口')
    ok(!leftPanelText.includes('未指定项目'), '老文案「未指定项目」已全部换成「待归类」')
    ok(
      projNames.includes('海南升学集训营') && projNames.includes('精英升学先修营'),
      '两个项目都在左栏：' + JSON.stringify(projNames)
    )
    ok(
      projTitles.some((t) => t.includes('磁盘位置：') && t.includes('海南升学集训营')),
      '项目行的悬浮提示写清了它在磁盘上的位置：' + JSON.stringify(projTitles[0] || '')
    )
    ok(
      !leftPanelText.includes('_已解绑的项目') && !leftPanelText.includes('_回收站'),
      '两个下划线收纳区不出现在左栏里'
    )

    // ---- 「知道了」点一下就消失，且不再出现 ----
    // 点击前先留一张证据图：提示条还在的样子
    try {
      const img = await win.webContents.capturePage()
      writeFileSync(join(ROOT, s.shot), img.toPNG())
      say('screenshot            : ' + s.shot + ' (' + Math.round(img.toPNG().length / 1024) + ' KB)')
    } catch (e) {
      ok(false, '截图失败：' + e.message)
    }
    // 收尾那张截图换个名字，别把上面这张盖掉
    s.shot = 'shot-b6-2-threelevel-acked.png'

    await js(`document.querySelector('.wsbanner.info .btn').click()`)
    await wait(600)
    const afterAck = await js(
      `(() => { const el = document.querySelector('.wsbanner.info'); return el ? el.innerText : '' })()`
    )
    ok(afterAck === '', '点「知道了」之后提示条立刻消失')
    const Database2 = require('better-sqlite3')
    const d2 = new Database2(join(s.workspaceRoot, '_system', 'media.db'), { readonly: true })
    const noticeRow = d2.prepare("SELECT value FROM meta WHERE key = 'layout_notice'").get()
    d2.close()
    ok(
      !noticeRow || noticeRow.value === '',
      '标记已从库里清掉，下次启动不会再弹（layout_notice = ' +
        JSON.stringify(noticeRow ? noticeRow.value : '') +
        '）'
    )

    // ============================================================
    // 第 14 批①：左栏「未归属」的图标换成「散件」
    // 原样是 `inbox`（朝下的入库箭头），语义像"下载/导入"；用户在 2026-10-01 指出不对。
    // 只改这一处：待归类包的「归位」按钮仍用 inbox（那是入库语义，本来就对）。
    // ============================================================
    const looseIconShape = await js(`(() => {
      const b = [...document.querySelectorAll('.side .item')]
        .find(x => x.innerText.includes(${JSON.stringify(plain(COPY.side.unassigned))}))
      const svg = b ? b.querySelector('svg') : null
      if (!svg) return null
      return { rects: svg.querySelectorAll('rect').length, paths: svg.querySelectorAll('path').length }
    })()`)
    ok(
      !!looseIconShape && looseIconShape.rects === 2 && looseIconShape.paths === 1,
      `【第 14 批】「未归属」图标已换成散件（2 个矩形 + 1 条折线）：${JSON.stringify(looseIconShape)}`
    )

    // ============================================================
    // 第 14 批②：刷新扫描的阶段进度推送（全项目第一条主 → 渲染推送通道）
    // 先挂记录器再点扫描 —— 小库扫得飞快，晚挂就抓不到推送（会得到假失败）。
    // ============================================================
    ok(
      await js(`typeof (window.api && window.api.onScanProgress) === 'function'`),
      '【第 14 批】preload 暴露了 onScanProgress 订阅接口'
    )
    await js(`(() => {
      window.__scanEvents = []
      window.api.onScanProgress((p) => window.__scanEvents.push(p))
      return 'hooked'
    })()`)
    const scanBtnLabel = plain(COPY.top.rescan)
    const clickedScan = await clickByText('.topbar .btn', scanBtnLabel)
    ok(clickedScan === 'ok', `点了「${scanBtnLabel}」（${clickedScan}）`)
    let scanIdle = false
    for (let i = 0; i < 120; i++) {
      scanIdle = await js(`(() => {
        const b = [...document.querySelectorAll('.topbar .btn')]
          .find(x => x.innerText.includes(${JSON.stringify(scanBtnLabel)}))
        return !!b && !b.disabled
      })()`)
      if (scanIdle) break
      await wait(500)
    }
    ok(scanIdle, '扫描结束后按钮恢复可用（没有卡在「处理中」）')

    const scanEvents = await js(`window.__scanEvents || []`)
    ok(
      Array.isArray(scanEvents) && scanEvents.length > 0,
      `【第 14 批】扫描期间收到 ${Array.isArray(scanEvents) ? scanEvents.length : 0} 次进度推送（主 → 渲染通道通了）`
    )
    const scanStageLabels = [
      COPY.scan.progressScan,
      COPY.scan.progressThumbs,
      COPY.scan.progressMetaImage,
      COPY.scan.progressMetaVideo,
      COPY.scan.progressMetaPsd,
      COPY.scan.progressMetaPdf
    ].map(plain)
    ok(
      Array.isArray(scanEvents) &&
        scanEvents.every(
          (e) =>
            scanStageLabels.includes(e.label) &&
            ['scan', 'thumbs', 'meta'].includes(e.stage) &&
            Number.isFinite(e.done) &&
            Number.isFinite(e.total) &&
            e.done >= 0 &&
            e.total >= 0
        ),
      `每条推送格式正确（阶段名 + done/total）：${JSON.stringify((scanEvents || []).slice(0, 3))}`
    )
    ok(
      Array.isArray(scanEvents) && scanEvents[0] && scanEvents[0].stage === 'scan',
      `第一条推送来自「${plain(COPY.scan.progressScan)}」阶段（目录扫描先报阶段名）`
    )
    const thumbsEvts = (scanEvents || []).filter((e) => e.stage === 'thumbs')
    if (thumbsEvts.length) {
      const lastThumbs = thumbsEvts[thumbsEvts.length - 1]
      ok(
        lastThumbs.done === lastThumbs.total,
        `缩略图阶段最后一推 done=total（${lastThumbs.done}/${lastThumbs.total}，进度跑满不留尾巴）`
      )
      ok(
        thumbsEvts.every((e, i) => i === 0 || e.done >= thumbsEvts[i - 1].done),
        '缩略图阶段的 done 单调不减（并发跑也不会倒退）'
      )
    } else {
      say('（本轮没有待生成的缩略图，跳过缩略图进度断言）')
    }
  } else if (SCEN === 'lifecycle') {
    // ============================================================
    // 第 7 批：记录生命周期
    // ============================================================
    const Database = require('better-sqlite3')
    const dbPath = join(s.workspaceRoot, '_system', 'media.db')
    const q = (sql, ...args) => {
      const dd = new Database(dbPath, { readonly: true })
      try {
        return dd.prepare(sql).get(...args)
      } finally {
        dd.close()
      }
    }

    // 解绑用的是 window.confirm —— 真窗口里会弹出阻塞式对话框，验证壳里直接放行
    await js(`window.confirm = () => true; 'patched'`)

    // 启动默认视图 = 工单队列（第 22 批按用户要求定；此前是任务视图）。用启动瞬间的快照断言 ——
    // 场景壳在分发前已切回任务视图（其余断言要左栏），顺带守住第 7 批那个老坑：
    // 曾把 wsLive 塞进标签筛选 effect 的依赖数组，工作区一连上就被顺带切到文件视图。
    ok(String(tabOnLoad).startsWith(COPY.ticket.viewTab), `启动默认落在${COPY.ticket.viewTab}（启动时高亮：${tabOnLoad}）`)

    // ---- (1) 初始状态：有「待归类」，没有「已解绑」 ----
    const entryBefore = await js(
      `(() => {
         const els = [...document.querySelectorAll('.side .item')]
         return {
           loose: !!els.find(e => e.innerText.trim() === '待归类'),
           unbound: !!els.find(e => e.innerText.includes('已解绑'))
         }
       })()`
    )
    ok(entryBefore.loose, '左栏有「待归类」入口（根目录下躺着 1 个游离包）')
    ok(!entryBefore.unbound, '一开始没有「已解绑」入口')
    const cardsFirst = await packCardNames()
    ok(cardsFirst.length === 3, `包视图摆出 3 张包卡片：${JSON.stringify(cardsFirst)}`)

    // ---- (2) 待归类 → 点包卡片上的 📥 → 归位到项目 ----
    await clickByText('.side .item', '待归类')
    await wait(500)
    const looseCards = await packCardNames()
    ok(
      looseCards.length === 1 && looseCards[0].includes('零散海报'),
      `「待归类」下正好 1 个包：${JSON.stringify(looseCards)}`
    )
    const openLoose = await clickPackAction('零散海报', '归位')
    ok(openLoose === 'ok', `游离包卡片上给的是「归位」按钮（${openLoose}）`)
    await wait(400)
    const editTitle = await js(
      `(() => { const el = document.querySelector('.modal h3'); return el ? el.innerText : '' })()`
    )
    ok(editTitle.includes('归位到项目'), `弹窗标题是「归位到项目」：${editTitle.trim()}`)
    const editOptions = await js(
      `document.querySelectorAll('.modal select option').length`
    )
    ok(editOptions >= 3, `项目下拉里有 ${editOptions} 个选项（含「不指定项目」）`)
    await shot('shot-b7-1-lifecycle-home-before.png')

    // 明确把目标项目选成「海南升学集训营」（默认预选的是列表第一个，别靠运气）
    const picked = await js(
      `(() => {
         const sel = document.querySelector('.modal select')
         if (!sel) return 'no-select'
         const opt = [...sel.options].find(o => o.text.includes('海南升学集训营'))
         if (!opt) return 'no-option'
         const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
         setter.call(sel, opt.value)
         sel.dispatchEvent(new Event('change', { bubbles: true }))
         return opt.text.trim()
       })()`
    )
    ok(picked === '海南升学集训营', `目标项目选成「${picked}」`)
    await wait(300)
    const moveHint = await js(
      `(() => { const m = document.querySelector('.modal'); return m ? m.innerText : '' })()`
    )
    ok(moveHint.includes(fmt(COPY.editPack.moveInto, { name: '海南升学集训营' })), '弹窗提前说明了文件夹会搬去哪')

    const homeSubmit = await clickModalOk()
    ok(homeSubmit === 'ok', `点保存（${homeSubmit}）`)
    await wait(1200)
    const homeOk = q('SELECT folder_path, project_id FROM packs WHERE name = ?', '零散海报')
    ok(!!homeOk && homeOk.project_id !== null, '【库】归位后 project_id 不再是空')
    ok(
      require('fs').existsSync(homeOk.folder_path) &&
        !require('fs').existsSync(join(s.workspaceRoot, '零散海报')),
      '【盘】包文件夹已经搬进项目文件夹，根目录下没有了'
    )
    const entryAfterHome = await js(
      `!![...document.querySelectorAll('.side .item')].find(e => e.innerText.trim() === '待归类')`
    )
    ok(!entryAfterHome, '没有游离包了，「待归类」入口自动消失')

    // ---- (3) 编辑包信息：只改类别 → 磁盘不动 ----
    await clickByText('.side .item', '全部')
    await wait(500)
    const beforeCategory = q('SELECT category, folder_path FROM packs WHERE name = ?', '招生折页-A4')
    const editOpened = await clickPackAction('招生折页-A4', COPY.editPack.title)
    ok(editOpened === 'ok', `包卡片上有「编辑」入口（${editOpened}）`)
    await wait(400)
    const editBox = await js(
      `(() => {
         const m = document.querySelector('.modal')
         if (!m) return { title: '', fields: 0, selects: 0, path: '' }
         return {
           title: (m.querySelector('h3') || {}).innerText || '',
           fields: m.querySelectorAll('.field').length,
           selects: m.querySelectorAll('.field select').length,
           path: (m.querySelector('.path') || {}).innerText || ''
         }
       })()`
    )
    ok(editBox.title.includes(COPY.editPack.title), `弹窗标题：${editBox.title.trim()}`)
    ok(
      // 第 49 批（docs/34）：物料分级作为**独立的一个 .field** 加进了「所属项目」那一行
      // （项目 + 分级并排），所以 .field 由 5 块变 6 块、下拉由 3 个变 4 个。
      editBox.fields === 6,
      `六块可改：名称 / 所属项目 / 物料分级 / 物料类别 / 使用场景 / 扫描临时文件（${editBox.fields} 块）`
    )
    ok(
      editBox.selects === 4,
      `所属项目 / 物料分级 / 物料类别 / 使用场景 四个下拉（第 49 批加了分级；${editBox.selects} 个）`
    )
    // 第 49 批：钉住「项目与分级并排」这个用户指定的布局（编辑弹窗与新建弹窗都要）
    const editLayout = await js(
      `(() => {
         const m = document.querySelector('.modal')
         if (!m) return null
         const rows = [...m.querySelectorAll('.field-row')]
         const hit = rows.find(r => {
           const ls = [...r.querySelectorAll('.field > label')].map(l => (l.innerText||'').trim())
           return ls.includes(${JSON.stringify(COPY.editPack.projectLabel)})
             && ls.includes(${JSON.stringify(COPY.dim.grade)})
         })
         if (!hit) return { found: false }
         const fs = [...hit.querySelectorAll('.field')]
         const a = fs[0].getBoundingClientRect(), b = fs[1].getBoundingClientRect()
         return {
           found: true,
           sameRow: Math.abs(a.top - b.top) < 4,
           labels: [...hit.querySelectorAll('.field > label')].map(l => (l.innerText||'').trim()),
           gradeOptions: [...fs[1].querySelectorAll('select option')].map(o => (o.textContent||'').trim())
         }
       })()`
    )
    ok(
      !!editLayout && editLayout.found && editLayout.sameRow,
      `【核心·布局】编辑弹窗里「所属项目」与「物料分级」并排（labels=${JSON.stringify(editLayout && editLayout.labels)}）`
    )
    ok(
      !!editLayout && editLayout.gradeOptions && editLayout.gradeOptions.length > 0,
      `编辑弹窗的分级下拉有值可选：${JSON.stringify(editLayout && editLayout.gradeOptions)}`
    )
    ok(editBox.path.includes('招生折页-A4'), '弹窗里显示了当前文件夹在哪')
    await shot('shot-b7-2-lifecycle-editpack.png')

    // 第 23 批：类别改下拉 —— 用原生 setter + change 事件触发 React onChange
    await js(`(() => {
      const m = document.querySelector('.modal')
      if (!m) return 'no-modal'
      const f = [...m.querySelectorAll('.field')]
        .find(x => ((x.querySelector('label')||{}).innerText||'').trim() === ${JSON.stringify(COPY.dim.category)})
      const s = f && f.querySelector('select')
      if (!s) return 'no-select'
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(s, '单页')
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return 'ok'
    })()`)
    await wait(200)
    await clickModalOk()
    await wait(1200)
    const afterCategory = q('SELECT category, folder_path FROM packs WHERE name = ?', '招生折页-A4')
    ok(afterCategory.category === '单页', `类别已改成「${afterCategory.category}」`)
    ok(afterCategory.folder_path === beforeCategory.folder_path, '只改类别：磁盘上的文件夹一动不动')

    // ---- (4) 解绑项目 ----
    const projRowsBefore = await projRowNames()
    const unbindIdx = projRowsBefore.indexOf('海南升学集训营')
    ok(unbindIdx >= 0, `定位到要解绑的项目「海南升学集训营」，在第 ${unbindIdx + 1} 行`)
    const pkBeforeUnbind = (q('SELECT COUNT(*) AS c FROM packs') || {}).c
    const hovered = await hoverProjectRow(unbindIdx)
    ok(hovered, '鼠标移到项目行上（悬浮按钮才会出现）')
    const acts = await js(
      `[...document.querySelectorAll('.side .proj-acts .mini')].map(b => b.getAttribute('title') || '')`
    )
    ok(
      acts.some((t) => t.includes('解绑')),
      `项目行悬浮按钮里有「解绑」：${JSON.stringify(acts)}`
    )
    const unbindClick = await js(
      `(() => {
        const b = [...document.querySelectorAll('.side .proj-acts .mini')]
          .find(x => (x.getAttribute('title')||'').includes('解绑'))
        if (!b) return 'no-btn'
        b.click(); return 'ok'
      })()`
    )
    ok(unbindClick === 'ok', `点了解绑按钮（${unbindClick}）`)
    await wait(1500)
    const projRowsAfter = await projRowNames()
    ok(projRowsAfter.length === projRowsBefore.length - 1, `左栏项目少了一个（${projRowsBefore.length} → ${projRowsAfter.length}）`)
    ok(!projRowsAfter.includes('海南升学集训营'), '被解绑的项目从左栏消失了')
    const unboundEntry = await js(
      `(() => {
         const el = [...document.querySelectorAll('.side .item')].find(e => e.innerText.includes('已解绑'))
         return el ? el.innerText.trim() : ''
       })()`
    )
    ok(unboundEntry.includes('已解绑 1 个项目'), `左栏出现「已解绑」入口：${unboundEntry}`)
    const unboundProj = q('SELECT archived, folder_name FROM projects WHERE name = ?', '海南升学集训营')
    ok(unboundProj.archived === 1, '【库】项目标记 archived = 1')
    ok(
      (q('SELECT COUNT(*) AS c FROM packs') || {}).c === pkBeforeUnbind,
      `【库】解绑只动归属不动记录：包还是 ${pkBeforeUnbind} 条`
    )
    ok(
      require('fs').existsSync(join(s.workspaceRoot, '_已解绑的项目', unboundProj.folder_name)) &&
        !require('fs').existsSync(join(s.workspaceRoot, unboundProj.folder_name)),
      '【盘】项目文件夹搬进了 _已解绑的项目'
    )
    const visiblePacks = await packCardNames()
    ok(
      !visiblePacks.includes('海南招生海报-2026秋季') && !visiblePacks.includes('招生折页-A4'),
      `【隐身】包视图里看不到它的包了：${JSON.stringify(visiblePacks)}`
    )
    const leftPanelNow = await js(`document.querySelector('.side').innerText`)
    ok(
      !leftPanelNow.includes('_已解绑的项目') && !leftPanelNow.includes('_回收站'),
      '两个收纳区仍然不出现在左栏里'
    )
    await shot('shot-b7-3-lifecycle-unbound.png')

    // ---- (5) 已解绑弹窗 → 还原 ----
    await clickByText('.side .item', '已解绑 1 个项目')
    await wait(500)
    const unboundModal = await js(
      `(() => {
         const m = document.querySelector('.modal.wide')
         if (!m) return null
         return {
           title: (m.querySelector('h3') || {}).innerText || '',
           rows: m.querySelectorAll('.unbound-row').length,
           text: m.innerText,
           btn: (m.querySelector('.unbound-row .btn') || {}).innerText || ''
         }
       })()`
    )
    ok(!!unboundModal && unboundModal.rows === 1, `弹窗里列出 1 个已解绑项目（${unboundModal && unboundModal.rows}）`)
    ok(unboundModal.text.includes('海南升学集训营'), '列的就是它')
    ok(/_已解绑的项目/.test(unboundModal.text), '弹窗里写清了东西在 _已解绑的项目 里')
    ok(unboundModal.btn.includes('还原'), `每行给了「还原」按钮（${unboundModal.btn}）`)

    const restoreClick = await js(
      `(() => {
        const b = document.querySelector('.modal .unbound-row .btn')
        if (!b) return 'no-btn'
        b.click(); return 'ok'
      })()`
    )
    ok(restoreClick === 'ok', `点了「还原」（${restoreClick}）`)
    await wait(1500)
    const restored = q('SELECT archived, folder_name FROM projects WHERE name = ?', '海南升学集训营')
    ok(restored.archived === 0, '【库】还原后 archived = 0')
    ok(
      require('fs').existsSync(join(s.workspaceRoot, restored.folder_name)),
      '【盘】项目文件夹搬回了工作区根目录'
    )
    const restoredRows = await projRowNames()
    ok(restoredRows.includes('海南升学集训营'), '项目重新出现在左栏')
    const entryGone = await js(
      `!![...document.querySelectorAll('.side .item')].find(e => e.innerText.includes('已解绑'))`
    )
    ok(!entryGone, '没有已解绑项目了，入口自动消失')
    const restoredPacks = await packCardNames()
    ok(
      restoredPacks.includes('海南招生海报-2026秋季'),
      `【回来了】包视图里又能看到它的包：${JSON.stringify(restoredPacks)}`
    )
    // 关掉可能的弹窗，避免挡住后面的操作
    await js(`(() => { const b = document.querySelector('.modal .close'); if (b) b.click(); return 'ok' })()`)
    await wait(300)

    // ---- (6) 删除项目：三选一 + 删进回收站 ----
    const projIdx = (await projRowNames()).indexOf('海南升学集训营')
    ok(projIdx >= 0, `找到要删的项目「海南升学集训营」，在第 ${projIdx + 1} 行`)
    const pkTotalBefore = (q('SELECT COUNT(*) AS c FROM packs') || {}).c
    const pkOfTarget = (
      q(
        'SELECT COUNT(*) AS c FROM packs WHERE project_id = (SELECT id FROM projects WHERE name = ?)',
        '海南升学集训营'
      ) || {}
    ).c
    ok(pkOfTarget === 3, `【前置】这个项目名下挂着 3 个包（归位进来的也在里面）：${pkOfTarget}`)
    // ⚠️ 2026-10-08 第 53 批：原来只 hover 一次就找按钮，批量连跑（12 个 Electron 前后相接、
    //    机器变慢）时悬停事件偶尔没生效 → 按钮压根没渲染出来 → 假失败「点开删除项目弹窗（no-btn）」。
    //    改成**重试几次**（不削弱断言：真坏了照样报错，只是给它几次机会）。
    let delClick = 'no-btn'
    for (let i = 0; i < 5; i++) {
      await hoverProjectRow(projIdx)
      await wait(450)
      delClick = await js(
        `(() => {
           const b = document.querySelector('.side .proj-acts .mini.danger')
           if (!b) return 'no-btn'
           b.click(); return 'ok'
         })()`
      )
      if (delClick === 'ok') break
      await wait(450)
    }
    ok(delClick === 'ok', `点开删除项目弹窗（${delClick}）`)
    await wait(500)
    const delModal = await js(
      `(() => {
         const m = document.querySelector('.modal')
         if (!m) return null
         return {
           radios: m.querySelectorAll('.radio-line input[type=radio]').length,
           labels: [...m.querySelectorAll('.radio-line span')].map(s => s.innerText.trim()),
           text: m.innerText
         }
       })()`
    )
    ok(!!delModal && delModal.radios === 3, `删除弹窗给了 3 个出口（${delModal && delModal.radios}）`)
    ok(
      delModal.labels.some((l) => l.includes('转移到其他项目')) &&
        delModal.labels.some((l) => l.includes('待归类')) &&
        delModal.labels.some((l) => l.includes('回收站')),
      `三个出口分别是：${JSON.stringify(delModal.labels)}`
    )
    ok(delModal.text.includes('文件一个都不会消失'), '弹窗明确写了：文件一个都不会消失')

    // 选「删进回收站」→ 确认
    await js(`(() => {
      const rs = [...document.querySelectorAll('.modal .radio-line input[type=radio]')]
      rs[2].click(); return 'ok'
    })()`)
    await wait(250)
    const confirmLabel = await js(
      `(() => { const b = [...document.querySelectorAll('.modal .foot .btn')].pop(); return b.innerText.trim() })()`
    )
    ok(confirmLabel.includes('回收站'), `按钮文案跟着变成「${confirmLabel}」`)
    await clickModalOk()
    // 删项目 = 把整个项目文件夹搬进 _回收站 + 清库 + 左栏重新加载，冷启动磁盘操作偶尔要几秒。
    // 2026-10-05 第 25 批实测：只等 DB 落库还不够 —— 库已经干净了、左栏 DOM 可能还没重渲染
    //（会误报「被删的项目从左栏消失了」）。
    // ⚠️ 2026-10-08 第 53 批再修：原来**只等左栏**（等 DOM 消失就往下走），批量连跑时磁盘慢，
    //    左栏可能先于库更新（或上一次渲染的旧 DOM 恰好不含该行）→ 立刻 break → 库其实还没删完，
    //    紧接着的「【库】项目记录已删」就假失败（本批连跑两次都撞到，单独跑 3/3 通过）。
    //    **正解：两个条件都等到**（库真的没有了 且 左栏行也没了），预算放宽到 15s。
    for (let i = 0; i < 60; i++) {
      const dbGone = q('SELECT COUNT(*) AS c FROM projects WHERE name = ?', '海南升学集训营').c === 0
      const names = await projRowNames()
      if (dbGone && !names.includes('海南升学集训营')) break
      await wait(250)
    }

    const gone = q('SELECT COUNT(*) AS c FROM projects WHERE name = ?', '海南升学集训营')
    ok(gone.c === 0, '【库】项目记录已删')
    ok(
      q(
        'SELECT COUNT(*) AS c FROM packs WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)'
      ).c === 0,
      '【库】没有悬空的包记录（project_id 指向已不存在的项目）'
    )
    ok(
      require('fs').existsSync(join(s.workspaceRoot, '_回收站', restored.folder_name, '海南招生海报-2026秋季', '01-成品', '海报终稿.png')),
      '【盘】整个项目文件夹（含包里的文件）原封不动躺在 _回收站 里'
    )
    const pkTotalAfter = (q('SELECT COUNT(*) AS c FROM packs') || {}).c
    ok(
      pkTotalAfter === pkTotalBefore - pkOfTarget,
      `项目名下的 ${pkOfTarget} 条包记录一并摘除：${pkTotalBefore} → ${pkTotalAfter}`
    )
    const afterAll = await projRowNames()
    ok(!afterAll.includes('海南升学集训营'), '被删的项目从左栏消失了')
    const orphanTags = q(
      `SELECT COUNT(*) AS c FROM asset_tags at
        WHERE at.asset_id NOT IN (SELECT id FROM assets) OR at.tag_id NOT IN (SELECT id FROM tags)`
    )
    ok(orphanTags.c === 0, '【外键】删项目之后 asset_tags 里没有孤儿行')
    await shot('shot-b7-4-lifecycle-final.png')
  } else if (SCEN === 'tagcount') {
    // ============================================================
    // 第 7 批补：左栏标签计数口径
    // 布景刻意让四个范围数字互不相同：全部 4 / 甲项目 2 / 乙项目 1 / 待归类 1，
    // 一眼就能看出这个数字到底跟着谁走。
    // ============================================================
    await js(`window.confirm = () => true; 'patched'`)

    // 第 23 批（docs/29）：左侧标签数字口径扩成「任务数 + 文件数」（用户拍板任务+文件一起管）。
    // 下面的断言全部改成「数字 = 文件数 + 任务数」，任务数按范围实时查库 —— 比写死数字更稳、
    // 也把新口径钉死在断言里。
    const DatabaseTC = require('better-sqlite3')
    const dbPathTC = join(s.workspaceRoot, '_system', 'media.db')
    const qTC = (sql, ...args) => {
      const dd = new DatabaseTC(dbPathTC, { readonly: true })
      try {
        return dd.prepare(sql).get(...args)
      } finally {
        dd.close()
      }
    }
    const packCountIn = (sqlWhere) =>
      (
        qTC(
          `SELECT COUNT(*) AS c FROM packs k LEFT JOIN projects p ON p.id = k.project_id ${sqlWhere}`
        ) || {}
      ).c
    const packAll = () => packCountIn('WHERE k.project_id IS NULL OR p.archived = 0')
    const packOfProj = (name) =>
      (
        qTC(
          `SELECT COUNT(*) AS c FROM packs k JOIN projects p ON p.id = k.project_id WHERE p.name = ?`,
          name
        ) || {}
      ).c
    const packLoose = () =>
      packCountIn('WHERE k.project_id IS NULL OR k.project_id NOT IN (SELECT id FROM projects)')

    const dimOpen = await expandDim('物料类别')
    ok(dimOpen !== 'no-head', `左栏标签面板有「物料类别」维度（${dimOpen}）`)

    // (1) 全部 = 4 文件 + 全库任务数（第 23 批起数字含任务）
    const all0 = await tagNum('海报')
    ok(!!all0, '「海报」标签在面板里')
    ok(
      all0 && all0.n === 4 + packAll(),
      `【全部】数字 = ${all0 && all0.n}（4 个文件 + ${packAll()} 个任务）`
    )
    ok(!!all0 && all0.title.includes('全库'), `悬停提示说清了范围：${all0 && all0.title}`)

    // (2) 甲项目 = 2 —— 数字必须跟着项目走（用户报的就是这里对不上）
    const pickA = await pickSideItem('海南升学集训营', '.side .proj-item')
    ok(pickA === 'ok', `点了「海南升学集训营」（${pickA}）`)
    const a1 = await tagNum('海报')
    ok(
      a1 && a1.n === 2 + packOfProj('海南升学集训营'),
      `【甲项目】数字跟着变成 ${a1 && a1.n}（该项目下 2 个文件 + ${packOfProj('海南升学集训营')} 个任务）`
    )
    ok(
      !!a1 && a1.title.includes('海南升学集训营'),
      `悬停提示跟着换范围：${a1 && a1.title}`
    )

    // (3) 数字 == 点开后真列出的条数
    await pickSideItem('文件视图', '.tabs button')
    const clickTag = await js(
      `(() => {
        const b = [...document.querySelectorAll('.tp-tag')]
          .find(x => ((x.querySelector('.tp-tag-name') || {}).innerText || '').trim() === '海报')
        if (!b) return 'no-tag'
        b.click(); return 'ok'
      })()`
    )
    ok(clickTag === 'ok', `在甲项目下勾选「海报」（${clickTag}）`)
    await wait(900)
    const listedA = await js(`document.querySelectorAll('.main-scroll .file-row').length`)
    ok(
      listedA === 2,
      `【文件视图】勾上「海报」列出 ${listedA} 条文件（第 23 批起面板数字 = 任务 + 文件，这是其中的文件部分）`
    )
    await shot('shot-b7-5-tagcount-project.png')

    // 取消勾选 + 回包视图，别影响后面的数字
    await js(
      `(() => {
        const b = [...document.querySelectorAll('.tp-tag')]
          .find(x => ((x.querySelector('.tp-tag-name') || {}).innerText || '').trim() === '海报')
        if (b) b.click(); return 'ok'
      })()`
    )
    await wait(400)
    await pickSideItem(COPY.top.viewPacks, '.tabs button')

    // (4) 乙项目 = 1
    const pickB = await pickSideItem('精英升学先修营', '.side .proj-item')
    ok(pickB === 'ok', `点了「精英升学先修营」（${pickB}）`)
    const b1 = await tagNum('海报')
    ok(
      b1 && b1.n === 1 + packOfProj('精英升学先修营'),
      `【乙项目】数字 ${b1 && b1.n}（1 个文件 + ${packOfProj('精英升学先修营')} 个任务）`
    )

    // (5) 待归类 = 1 文件 + 待归类任务数
    const pickLoose = await pickSideItem('待归类')
    ok(pickLoose === 'ok', `点了「待归类」（${pickLoose}）`)
    const l1 = await tagNum('海报')
    ok(l1 && l1.n === 1 + packLoose(), `【待归类】数字 ${l1 && l1.n}（1 个文件 + ${packLoose()} 个任务）`)

    // (6) 0 条的标签仍然列出，只是压暗
    const fold0 = await tagNum('折页')
    ok(!!fold0 && fold0.n === 0, `没人用的「折页」数字是 0（${fold0 && fold0.n}）`)
    ok(!!fold0 && fold0.zero, '0 条的标签被压暗（不会让人以为标签丢了）')

    // (7) 切回「全部」= 4 文件 + 全库任务数
    const backAll = await pickSideItem('全部')
    ok(backAll === 'ok', `切回「全部」（${backAll}）`)
    const all1 = await tagNum('海报')
    ok(
      all1 && all1.n === 4 + packAll(),
      `【全部】切回来还是 ${all1 && all1.n}（4 个文件 + ${packAll()} 个任务）`
    )

    // (7-49) 第 49 批（docs/34）：**分级标签的数字也统计任务数**，且跟随项目范围。
    // 布景：甲包 = S、乙包 = A、游离包 = 未分级；文件全部只贴了「海报」，没贴分级
    //       → 所以分级的数字应当**纯等于任务数**（文件那一半是 0）。
    const packOfGrade = (grade) =>
      (
        qTC(
          `SELECT COUNT(*) AS c FROM packs k LEFT JOIN projects p ON p.id = k.project_id
            WHERE (k.project_id IS NULL OR p.archived = 0) AND k.grade = ?`,
          grade
        ) || {}
      ).c
    await expandDim(COPY.dim.grade)
    await wait(400)
    const gradeTags = await js(
      `(() => {
         const d = [...document.querySelectorAll('.tp-dim')]
           .find(x => ((x.querySelector('.tp-dim-label')||{}).innerText||'').trim() === ${JSON.stringify(COPY.dim.grade)})
         if (!d) return null
         return [...d.querySelectorAll('.tp-tag')].map(b => ({
           name: ((b.querySelector('.tp-tag-name')||{}).innerText||'').trim(),
           n: ((b.querySelector('.tp-tag-n')||{}).innerText||'').trim(),
           title: b.getAttribute('title') || ''
         }))
       })()`
    )
    ok(
      Array.isArray(gradeTags) && gradeTags.length === 4,
      `【核心】左栏「物料分级」维度有 4 个预制标签（实际 ${Array.isArray(gradeTags) ? gradeTags.length : 0}）`
    )
    // 第 52 批：分级名从文案字典取（不再硬编码 S/A/B/C，改名时这里自动跟着变）
    const gS = Array.isArray(gradeTags) ? gradeTags.find((x) => x.name === COPY.seed.gradeS) : null
    const gA = Array.isArray(gradeTags) ? gradeTags.find((x) => x.name === COPY.seed.gradeA) : null
    const gC = Array.isArray(gradeTags) ? gradeTags.find((x) => x.name === COPY.seed.gradeC) : null
    ok(
      !!gS && Number(gS.n) === packOfGrade(COPY.seed.gradeS),
      `【核心】「${COPY.seed.gradeS}」的数字 = ${gS && gS.n}（应等于 ${packOfGrade(COPY.seed.gradeS)} 个任务；文件没贴分级所以文件那一半是 0）`
    )
    ok(
      !!gA && Number(gA.n) === packOfGrade(COPY.seed.gradeA),
      `【核心】「${COPY.seed.gradeA}」的数字 = ${gA && gA.n}（应等于 ${packOfGrade(COPY.seed.gradeA)} 个任务）`
    )
    // 0 条标签要压暗 —— `zero` 类只有共享的 tagNum() 会读，所以这条走它
    const gCNum = await tagNum(COPY.seed.gradeC)
    ok(
      !!gCNum && gCNum.n === 0 && gCNum.zero,
      `没人用的「C」数字 0 且压暗（实际 ${gCNum && gCNum.n}，zero=${gCNum && gCNum.zero}）`
    )
    ok(
      !!gS && gS.title.includes('任务') && gS.title.includes('文件'),
      `分级标签的悬停提示也把数字分解成「任务 + 文件」：${gS && gS.title}`
    )

    // 分级数字跟随项目范围：切到甲项目，S 应为 1；切到乙项目，S 应为 0（乙包是 A）
    await pickSideItem('海南升学集训营', '.side .proj-item')
    await wait(700)
    const gS_A = await js(
      `(() => {
         const d = [...document.querySelectorAll('.tp-dim')]
           .find(x => ((x.querySelector('.tp-dim-label')||{}).innerText||'').trim() === ${JSON.stringify(COPY.dim.grade)})
         if (!d) return null
         const b = [...d.querySelectorAll('.tp-tag')].find(x => ((x.querySelector('.tp-tag-name')||{}).innerText||'').trim() === ${JSON.stringify(COPY.seed.gradeS)})
         return b ? ((b.querySelector('.tp-tag-n')||{}).innerText||'').trim() : null
       })()`
    )
    ok(
      gS_A === '1',
      `【核心】切到甲项目后「S」= ${gS_A}（该范围只有甲包= S 级；数字必须跟着范围走）`
    )
    await pickSideItem('精英升学先修营', '.side .proj-item')
    await wait(700)
    const gS_B = await js(
      `(() => {
         const d = [...document.querySelectorAll('.tp-dim')]
           .find(x => ((x.querySelector('.tp-dim-label')||{}).innerText||'').trim() === ${JSON.stringify(COPY.dim.grade)})
         if (!d) return null
         const b = [...d.querySelectorAll('.tp-tag')].find(x => ((x.querySelector('.tp-tag-name')||{}).innerText||'').trim() === ${JSON.stringify(COPY.seed.gradeS)})
         return b ? ((b.querySelector('.tp-tag-n')||{}).innerText||'').trim() : null
       })()`
    )
    ok(gS_B === '0', `【核心】切到乙项目后「S」= ${gS_B}（该范围没有 S 级任务 → 0）`)
    await shot('shot-b49-2-tagcount-grade.png')
    await pickSideItem('全部')
    await wait(600)

    // (8) 解绑一个项目 → 全库数字立刻跟着减（原 bug：纹丝不动）
    const names = await projRowNames()
    const idxB = names.indexOf('精英升学先修营')
    ok(idxB >= 0, `定位到要解绑的项目（第 ${idxB + 1} 行）`)
    const hovered = await hoverProjectRow(idxB)
    ok(hovered, '鼠标移到项目行上')
    const unbindClick = await js(
      `(() => {
        const b = [...document.querySelectorAll('.side .proj-acts .mini')]
          .find(x => (x.getAttribute('title')||'').includes('解绑'))
        if (!b) return 'no-btn'
        b.click(); return 'ok'
      })()`
    )
    ok(unbindClick === 'ok', `点了解绑（${unbindClick}）`)
    await wait(1600)
    const all2 = await tagNum('海报')
    // 解绑乙项目 → 乙项目那 1 个文件也随项目隐身（4 → 3 文件），任务数同步少 1
    ok(
      all2 && all1 && all2.n === 3 + packAll() && all2.n < all1.n,
      `【回归】解绑后全库数字立刻 ${all1 && all1.n} → ${all2 && all2.n}（3 个文件 + ${packAll()} 个任务；数字含任务数，解绑后随之减少）`
    )
    const foldAfter = await tagNum('折页')
    ok(!!foldAfter && foldAfter.zero, '解绑后面板照常渲染，0 条标签仍置灰')
  } else if (SCEN === 'missing') {
    // ============================================================
    // 第 8 批 M8-03：文件已丢失标记
    // 布景：包内 1 个 + 根目录 1 个文件被"删掉"，扫描后应标记 2 条丢失、
    // 记录仍在（标签没丢）。重新定位要弹系统文件框，验证壳里不点它。
    // ============================================================
    const Database = require('better-sqlite3')
    const dbPath9 = join(s.workspaceRoot, '_system', 'media.db')
    const q9 = (sql, ...args) => {
      const dd = new Database(dbPath9, { readonly: true })
      try {
        return dd.prepare(sql).get(...args)
      } finally {
        dd.close()
      }
    }

    await pickSideItem(COPY.top.viewPacks, '.tabs button')
    await wait(600)

    // 第 51 批：「清掉记录」走 window.confirm 二次确认 —— 真窗口里那是个**阻塞式**对话框，
    // 验证壳里必须直接放行，否则点下去整个场景卡死（第 51 批施工时踩到，白等一轮超时）。
    // 与 lifecycle / tagcount 两处同一做法。
    await js(`window.confirm = () => true; 'patched'`)

    // (1) 左栏出现「⚠️ 文件已丢失 2」
    const entry = await js(
      `(() => {
         const e = [...document.querySelectorAll('.side .item')].find(x => x.innerText.includes('文件已丢失'))
         return e ? { text: e.innerText.replace(/\\s+/g, ' ').trim(), n: (e.querySelector('.n')||{}).innerText } : null
       })()`
    )
    ok(!!entry, `左栏有「文件已丢失」入口：${entry && entry.text}`)
    ok(!!entry && String(entry.n).trim() === '2', `入口数字 = ${entry && entry.n}（删了 2 个文件）`)
    ok(
      q9('SELECT COUNT(*) AS c FROM assets').c === 3,
      `【核心】库里仍有 3 条记录（不是 1 条）—— 记录不再被删掉`
    )
    ok(
      q9('SELECT COUNT(*) AS c FROM assets WHERE missing_at IS NOT NULL').c === 2,
      '其中 2 条带「文件已丢失」标记'
    )
    ok(
      q9('SELECT COUNT(*) AS c FROM asset_tags').c === 1,
      '【核心收益】标签关联还在（老实现里记录一删，标签跟着 CASCADE 蒸发）'
    )
    const packCard = await js(
      `(() => {
         const cards = [...document.querySelectorAll('.grid .pack-card')]
         const c = cards.find(x => x.querySelector('.miss-flag')) || cards[0]
         if (!c) return null
         const f = c.querySelector('.miss-flag')
         return {
           name: (c.querySelector('.name')||{}).innerText || '',
           sub: (c.querySelector('.sub')||{}).innerText || '',
           flag: f ? f.innerText.trim() : null,
           flagIcon: f && f.querySelector('svg') ? 'warning' : null
         }
       })()`
    )
    ok(
      !!packCard && packCard.flag === '1' && packCard.flagIcon === 'warning',
      `包卡片挂出丢失角标（图标 + 数字）：${packCard && packCard.flag}`
    )
    ok(
      !!packCard && packCard.sub.includes('2 个文件'),
      `卡片文件数仍算上丢失的（含丢失共 2 条）：${packCard && packCard.sub}`
    )
    await shot('shot-b8-1-missing-entry.png')

    // (2) 点进去：只看丢失的，左栏数字与列表条数必须一致
    const clickEntry = await js(
      `(() => {
         const e = [...document.querySelectorAll('.side .item')].find(x => x.innerText.includes('文件已丢失'))
         if (!e) return 'no-el'
         e.click(); return 'ok'
       })()`
    )
    ok(clickEntry === 'ok', `点了「文件已丢失」入口（${clickEntry}）`)
    await wait(900)
    const rows = await js(
      `(() => {
         const rs = [...document.querySelectorAll('.main-scroll .file-row')]
         return {
           n: rs.length,
           names: rs.map(r => ((r.querySelector('.fn')||{}).innerText||'').replace(/\\s+/g,' ').trim()),
           badges: rs.filter(r => r.querySelector('.miss-badge')).length,
           dim: rs.filter(r => r.classList.contains('missing')).length
         }
       })()`
    )
    ok(rows.n === 2, `【一致】点开真列出 ${rows.n} 条，与左栏数字 2 相等`)
    ok(rows.badges === 2, `每条都带「文件已丢失」角标（${rows.badges} 条）`)
    ok(rows.dim === 2, '每条都压暗（.missing）')
    ok(
      rows.names.join('|').includes('海报终稿.png') && rows.names.join('|').includes('散落的图.png'),
      `丢的正是那两个文件：${rows.names.join(' / ')}`
    )
    const tagStill = await js(`document.querySelectorAll('.main-scroll .file-row .row-tag').length`)
    ok(tagStill >= 1, `【核心收益】丢失行上的标签还在（看到 ${tagStill} 个标签色块）`)
    await shot('shot-b8-2-missing-list.png')

    // (3) 点丢失行的文件名：不许报错、也不许尝试打开（必然失败）
    const errBefore = errs.length
    await js(
      `(() => {
         const fn = document.querySelector('.main-scroll .file-row .fn')
         if (fn) fn.click()
         return 'ok'
       })()`
    )
    await wait(500)
    ok(errs.length === errBefore, '点丢失行的文件名不会往控制台甩错误')

    // (4) 行尾按钮换成「重新定位」
    const act = await js(
      `(() => {
         const b = document.querySelector('.main-scroll .file-row .act .icon-btn')
         return b ? { title: b.getAttribute('title') || '', text: b.innerText.trim() } : null
       })()`
    )
    ok(
      !!act && act.title.includes('重新定位'),
      `行尾按钮是「重新定位」而不是「打开文件」：${act && act.title}`
    )

    // (5) 批量重新定位弹窗能开能关（**不点「选择文件夹」**：系统对话框会阻塞验证壳）
    const openModal = await js(
      `(() => {
         const b = [...document.querySelectorAll('.main-scroll .btn')].find(x => x.innerText.includes('批量重新定位'))
         if (!b) return 'no-btn'
         b.click(); return 'ok'
       })()`
    )
    ok(openModal === 'ok', `工具栏有「批量重新定位」按钮（${openModal}）`)
    await wait(500)
    const modalText = await js(
      `(() => {
         const m = document.querySelector('.modal.relocate')
         return m ? m.innerText.replace(/\\s+/g, ' ').trim() : null
       })()`
    )
    ok(
      !!modalText && modalText.includes('选择文件夹'),
      `弹窗打开了：${(modalText || '').slice(0, 50)}`
    )
    ok(
      !!modalText && modalText.includes('勾选之后才会动记录'),
      '弹窗里写明了"勾选之后才会动"（绝不静默改路径）'
    )
    await shot('shot-b8-3-missing-relocate.png')
    await js(
      `(() => {
         const b = [...document.querySelectorAll('.modal.relocate .foot .btn')].find(x => x.innerText.trim() === '关闭')
         if (b) b.click()
         return 'ok'
       })()`
    )
    await wait(400)

    // (6) 把文件放回去 + 刷新扫描 → 标记自动清、入口数字跟着减
    writeFileSync(join(s.workspaceRoot, '散落的图.png'), 'CCCC', 'utf-8')
    const refresh = await js(
      `(() => {
         const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes(${JSON.stringify(COPY.top.rescan)}))
         if (!b) return 'no-btn'
         b.click(); return 'ok'
       })()`
    )
    ok(refresh === 'ok', `点了「${COPY.top.rescan}」（${refresh}）`)
    await wait(2000)
    const entry2 = await js(
      `(() => {
         const e = [...document.querySelectorAll('.side .item')].find(x => x.innerText.includes('文件已丢失'))
         return e ? (e.querySelector('.n')||{}).innerText : null
       })()`
    )
    ok(String(entry2).trim() === '1', `文件放回来 + 刷新后，入口数字 2 → ${entry2}（恢复自动生效）`)
    ok(
      q9('SELECT missing_at AS m FROM assets WHERE file_name = ?', '散落的图.png').m === null,
      '那条记录的丢失标记被清空了'
    )
    ok(
      q9('SELECT COUNT(*) AS c FROM assets WHERE missing_at IS NOT NULL').c === 1,
      '库里只剩 1 条真丢失的'
    )

    // ============================================================
    // 第 47 批（docs/33）：假丢失治理 —— 忽略 / 已忽略入口 / 撤销
    // 此时还剩 1 条待处理的丢失（海报终稿.png，文件确实不在）
    // ============================================================

    // (7) 行尾「忽略」→ 从丢失列表消失、进左栏「已忽略」；左栏「文件已丢失」入口照旧在
    await pickSideItem(COPY.top.viewPacks, '.tabs button')
    await wait(600)
    await js(
      `(() => {
         const e = [...document.querySelectorAll('.side .item')].find(x => x.innerText.includes(${JSON.stringify(COPY.side.missing)}))
         if (e) e.click()
         return 'ok'
       })()`
    )
    await wait(900)
    const ignoreBtn = await js(
      `(() => {
         const b = [...document.querySelectorAll('.main-scroll .file-row .act .icon-btn')]
           .find(x => (x.getAttribute('title') || '').startsWith('忽略'))
         if (!b) return 'no-btn'
         b.click(); return 'ok'
       })()`
    )
    ok(ignoreBtn === 'ok', `丢失行行尾有「忽略」按钮（${ignoreBtn}）`)
    await wait(1600)
    const afterIgnore = await js(
      `(() => {
         const items = [...document.querySelectorAll('.side .item')]
         const miss = items.find(x => x.innerText.includes(${JSON.stringify(COPY.side.missing)}))
         const ign = items.find(x => x.innerText.includes(${JSON.stringify(COPY.side.ignored)}))
         return {
           miss: miss ? ((miss.querySelector('.n') || {}).innerText || '').trim() : null,
           missText: miss ? miss.innerText.replace(/\\s+/g, ' ').trim() : null,
           ign: ign ? ((ign.querySelector('.n') || {}).innerText || '').trim() : null,
           rows: document.querySelectorAll('.main-scroll .file-row').length
         }
       })()`
    )
    ok(
      afterIgnore.miss === '0' && (afterIgnore.missText || '').startsWith(COPY.side.missing),
      `忽略后：左栏「文件已丢失」入口照旧在、文字不变（"${afterIgnore.missText}"，计数 ${afterIgnore.miss}）`
    )
    ok(afterIgnore.ign === '1', `「已忽略」是独立入口，没顶替「文件已丢失」（= ${afterIgnore.ign}）`)
    ok(afterIgnore.rows === 0, '当前"只看丢失"的列表里已经没有它了（空态）')
    ok(q9('SELECT COUNT(*) AS c FROM assets').c === 3, '【铁律①】记录还是 3 条（忽略不删记录）')
    ok(
      q9('SELECT COUNT(*) AS c FROM assets WHERE missing_ignored_at IS NOT NULL').c === 1,
      '库里记下了忽略时刻'
    )
    await shot('shot-b47-1-ignored.png')

    // (8) 点「已忽略」入口 → 真列出 1 条、带灰色角标、整行压暗
    const clickIgn = await js(
      `(() => {
         const e = [...document.querySelectorAll('.side .item')].find(x => x.innerText.includes(${JSON.stringify(COPY.side.ignored)}))
         if (!e) return 'no-el'
         e.click(); return 'ok'
       })()`
    )
    ok(clickIgn === 'ok', `点「${COPY.side.ignored}」入口（${clickIgn}）`)
    await wait(900)
    const ignRows = await js(
      `(() => {
         const rs = [...document.querySelectorAll('.main-scroll .file-row')]
         return {
           n: rs.length,
           badges: rs.filter(r => r.querySelector('.miss-badge.ignored')).length,
           dim: rs.filter(r => r.classList.contains('ignored')).length
         }
       })()`
    )
    ok(ignRows.n === 1, `【一致】点开真列出 ${ignRows.n} 条，与左栏数字 1 相等`)
    ok(ignRows.badges === 1, '行上带「已忽略」角标（灰色版，与红色"文件已丢失"区分）')
    ok(ignRows.dim === 1, '整行压暗（.ignored）')
    await shot('shot-b47-2-ignored-list.png')

    // (9) 行尾「撤销忽略」→ 回到丢失待处理
    const undoBtn = await js(
      `(() => {
         const b = [...document.querySelectorAll('.main-scroll .file-row .act .icon-btn')]
           .find(x => (x.getAttribute('title') || '').startsWith('撤销忽略'))
         if (!b) return 'no-btn'
         b.click(); return 'ok'
       })()`
    )
    ok(undoBtn === 'ok', `已忽略行行尾是「撤销忽略」（${undoBtn}）`)
    await wait(1600)
    ok(
      q9('SELECT missing_ignored_at AS i FROM assets WHERE file_name = ?', '海报终稿.png').i === null,
      '撤销后忽略标记清空'
    )
    ok(
      q9('SELECT missing_at AS m FROM assets WHERE file_name = ?', '海报终稿.png').m !== null,
      '丢失标记仍在（文件确实还没回来）'
    )

    // (10) 「编辑任务信息」里有「扫描临时文件」开关，且默认不勾（docs/33 §5.3）
    await pickSideItem(COPY.top.viewPacks, '.tabs button')
    await wait(800)
    const editOpen = await js(
      `(() => {
         const cards = [...document.querySelectorAll('.grid .pack-card')]
         if (!cards.length) return 'no-card'
         // 包视图里第一张是「未归属」虚拟卡片（没有编辑按钮），要按"有编辑入口"的那张找
         const card = cards.find(c => c.querySelector('.pact'))
         if (!card) return 'no-edit-btn'
         card.querySelector('.pact').click()
         return 'ok'
       })()`
    )
    ok(editOpen === 'ok', `包卡片有编辑入口（${editOpen}）`)
    await wait(800)
    const editModal = await js(
      `(() => {
         const m = document.querySelector('.modal')
         if (!m) return null
         const cb = [...m.querySelectorAll('input[type=checkbox]')].find(x => {
           const lb = x.closest('label')
           return lb && lb.innerText.includes(${JSON.stringify(COPY.editPack.scanTempLabel)})
         })
         return {
           hasLabel: m.innerText.includes(${JSON.stringify(COPY.editPack.scanTempLabel)}),
           checked: cb ? cb.checked : null
         }
       })()`
    )
    ok(!!editModal && editModal.hasLabel, `编辑任务弹窗里有「${COPY.editPack.scanTempLabel}」`)
    ok(!!editModal && editModal.checked === false, `开关默认不勾（${editModal && editModal.checked}）`)
    await shot('shot-b47-3-scan-temp.png')
    await js(
      `(() => {
         const b = [...document.querySelectorAll('.modal .foot .btn')].find(x => x.innerText.trim() === ${JSON.stringify(COPY.common.cancel)})
         if (b) b.click()
         return 'ok'
       })()`
    )
    await wait(400)

    // (11) 第 51 批（docs/36）：清掉记录出口
    //   前置：第 (9) 步把「海报终稿.png」撤销了忽略 → 它现在是"待处理丢失"
    //   ① 双重门槛的界面侧：待处理的行**不该**有「清掉记录」
    //   ② 重新忽略 → 已忽略列表里**该有**（与「撤销忽略」并排）
    //   ③ 点它 → 二次确认 → 从列表与库里一起消失
    //
    // ⚠️ 不能用 pickSideItem 切「全部文件」：clickByText 是**精确**匹配
    //    （innerText.trim() === text），而那一行的 innerText 还带计数（"全部文件\n3"）→ 永远 no-el。
    //    另外行尾的按钮不止两个：还有「打开所在文件夹」，所以只断言"该有的在 / 不该有的不在"，
    //    不写死按钮个数（个数会随 UI 微调而变，写死是脆弱断言）。
    const toAllFiles = await js(
      `(() => {
         const e = [...document.querySelectorAll('.side .item')].find(x => (x.innerText || '').includes(${JSON.stringify(COPY.side.allFiles)}))
         if (!e) return 'no-el'
         e.click(); return 'ok'
       })()`
    )
    ok(toAllFiles === 'ok', `切到「${COPY.side.allFiles}」并复位筛选（${toAllFiles}）`)
    await wait(900)

    // 按钮的 title 是「提示句」不是「按钮字」，取冒号前那截来匹配
    const PURGE_TITLE = COPY.file.purgeTip.split('：')[0]
    const IGNORE_TITLE = COPY.file.ignoreTip.split('：')[0]
    const UNIGNORE_TITLE = COPY.file.unignoreTip.split('：')[0]

    const actTitles = async () =>
      js(
        `(() => {
           const r = [...document.querySelectorAll('.main-scroll .file-row')]
             .find(x => (x.innerText || '').includes('海报终稿'))
           if (!r) return null
           return [...r.querySelectorAll('.act .icon-btn')].map(b => (b.getAttribute('title') || ''))
         })()`
      )

    // ① 待处理丢失：有「重新定位 + 忽略」，**没有**「清掉记录」
    const actsPending = await actTitles()
    ok(Array.isArray(actsPending), `【布景】找到「海报终稿」那一行（${JSON.stringify(actsPending)}）`)
    ok(
      Array.isArray(actsPending) && actsPending.some((t) => t.startsWith('重新定位')),
      '待处理丢失行有「重新定位」'
    )
    ok(
      Array.isArray(actsPending) && actsPending.some((t) => t.startsWith(IGNORE_TITLE)),
      `待处理丢失行有「${IGNORE_TITLE}」`
    )
    ok(
      Array.isArray(actsPending) && !actsPending.some((t) => t.startsWith(PURGE_TITLE)),
      `【核心·双重门槛】待处理的丢失**不给**「${PURGE_TITLE}」（它还能重新定位，用户也没说放弃）`
    )

    // ② 忽略掉它 → 出口应变成「撤销忽略 + 清掉记录」
    const reIgnore = await js(
      `(() => {
         const r = [...document.querySelectorAll('.main-scroll .file-row')]
           .find(x => (x.innerText || '').includes('海报终稿'))
         if (!r) return 'no-row'
         const b = [...r.querySelectorAll('.act .icon-btn')]
           .find(x => (x.getAttribute('title') || '').startsWith(${JSON.stringify(IGNORE_TITLE)}))
         if (!b) return 'no-btn'
         b.click(); return 'ok'
       })()`
    )
    ok(reIgnore === 'ok', `重新点「${IGNORE_TITLE}」（${reIgnore}）`)
    await wait(1600)

    // 进左栏「已忽略」入口再看
    await js(
      `(() => {
         const e = [...document.querySelectorAll('.side .item')].find(x => x.innerText.includes(${JSON.stringify(COPY.side.ignored)}))
         if (e) e.click(); return 'ok'
       })()`
    )
    await wait(900)
    const actsIgnored = await actTitles()
    ok(Array.isArray(actsIgnored), `【布景】已忽略列表里找到那一行（${JSON.stringify(actsIgnored)}）`)
    ok(
      Array.isArray(actsIgnored) && actsIgnored.some((t) => t.startsWith(UNIGNORE_TITLE)),
      `其一是「${UNIGNORE_TITLE}」（第 47 批原有出口，没被挤掉）`
    )
    ok(
      Array.isArray(actsIgnored) && actsIgnored.some((t) => t.startsWith(PURGE_TITLE)),
      `【核心】其二是「${PURGE_TITLE}」（第 51 批新增出口）`
    )
    await shot('shot-b51-1-ignored-two-exits.png')

    // ③ 点「清掉记录」→ 二次确认（场景里 window.confirm 已被 patch 成恒 true）
    //    先记下 id：清掉后就查不到了，级联断言要用
    const t1Id = q9('SELECT id FROM assets WHERE file_name = ?', '海报终稿.png').id
    const purgeClick = await js(
      `(() => {
         const r = [...document.querySelectorAll('.main-scroll .file-row')]
           .find(x => (x.innerText || '').includes('海报终稿'))
         if (!r) return 'no-row'
         const b = [...r.querySelectorAll('.act .icon-btn')]
           .find(x => (x.getAttribute('title') || '').startsWith(${JSON.stringify(PURGE_TITLE)}))
         if (!b) return 'no-btn'
         b.click(); return 'ok'
       })()`
    )
    ok(purgeClick === 'ok', `点「${PURGE_TITLE}」（${purgeClick}）`)
    await wait(1800)

    ok(
      q9('SELECT COUNT(*) AS c FROM assets WHERE file_name = ?', '海报终稿.png').c === 0,
      '【核心】记录已从库里清掉'
    )
    ok(
      q9('SELECT COUNT(*) AS c FROM asset_tags WHERE asset_id = ?', t1Id).c === 0,
      '【级联】它的标签关联一并清掉'
    )
    // 已忽略入口：计数归 0 时该入口**整个隐藏**（App.tsx 的 `ignoredMissing > 0` 条件）
    const afterPurge = await js(
      `(() => {
         const e = [...document.querySelectorAll('.side .item')].find(x => x.innerText.includes(${JSON.stringify(COPY.side.ignored)}))
         return e ? e.innerText.trim() : null
       })()`
    )
    ok(
      afterPurge === null,
      `【核心】清完后左栏「已忽略」入口整个消失（计数 0 → 入口隐藏；实际 ${JSON.stringify(afterPurge)}）`
    )
    const rowGone = await js(
      `[...document.querySelectorAll('.main-scroll .file-row')].filter(x => (x.innerText || '').includes('海报终稿')).length`
    )
    ok(rowGone === 0, `【核心】列表里那条也没了（残留 ${rowGone} 条）`)
    await shot('shot-b51-2-purged.png')
  } else if (SCEN === 'versions') {
    // ============================================================
    // 第 9 批 M6：版本管理（建稿 / 自动认 / 绑定 / 设为当前 / 解绑）
    // 布景见上面的 seeding 段：V1、V2（当前）、V3 + 一个没认领的「终版-客户定稿」
    // ============================================================
    const Database = require('better-sqlite3')
    const dbPath = join(s.workspaceRoot, '_system', 'media.db')
    const qv = (sql, ...args) => {
      const dd = new Database(dbPath, { readonly: true })
      try {
        // 查不到就返回空对象 —— 断言会失败，但不会把整个场景拖崩
        return dd.prepare(sql).get(...args) || {}
      } finally {
        dd.close()
      }
    }
    const projFolder = qv('SELECT folder_name AS f FROM projects WHERE name = ?', '海南升学集训营').f || '海南升学集训营'
    const vPackDir = join(s.workspaceRoot, projFolder, '海南招生海报-2026秋季')

    await pickSideItem(COPY.top.viewPacks, '.tabs button')
    await wait(1000)

    // (1) 包卡片上的版本行 —— 不点进去也知道这个包有几稿、当前是第几稿
    // 包视图里还有一张「未归属」的虚拟卡片排在最前面，所以按名字找真实的包卡片
    const card = await js(
      `(() => {
         const cards = [...document.querySelectorAll('.grid .pack-card')]
         const c = cards.find(x => ((x.querySelector('.name')||{}).innerText||'').includes('海南招生海报'))
         if (!c) return null
         return {
           nCards: cards.length,
           name: ((c.querySelector('.name')||{}).innerText||'').trim(),
           sub: ((c.querySelector('.sub')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
           chip: ((c.querySelector('.ver-chip')||{}).innerText||'').replace(/\\s+/g,' ').trim()
         }
       })()`
    )
    ok(!!card && card.name.includes('海南招生海报'), `包卡片渲染出来了：${card && card.name}`)
    ok(!!card && card.chip.includes('V2 当前'), `卡片直接标出当前稿：${card && card.chip}`)
    ok(
      !!card && card.chip.includes('3 稿'),
      '卡片标出总稿数 3（V1/V2/V3）——磁盘上那个没认领的文件夹不算'
    )
    ok(
      !!card && card.sub.includes('9 个文件'),
      `卡片文件数算全部稿（含历史稿，跟容量口径一致）：${card && card.sub}`
    )
    await shot('shot-b9-1-pack-card-version.png')

    // (2) 点进包详情 → 版本条：一格 = 一稿
    await js(
      `(() => {
         const cards = [...document.querySelectorAll('.grid .pack-card')]
         const c = cards.find(x => ((x.querySelector('.name')||{}).innerText||'').includes('海南招生海报'))
         if (c) c.click()
         return 'ok'
       })()`
    )
    await wait(1500)
    // 注意：版本条是 **seq 倒序**（最新的排最左），所以下面一律按 label 找，不按下标。
    const bar = await js(
      `(() => {
         const b = document.querySelector('.modal.wide .ver-bar')
         if (!b) return null
         const cells = [...b.querySelectorAll('.ver-cell')]
         return {
           n: cells.length,
           cells: cells.map(x => ({
             label: ((x.querySelector('.vn')||{}).innerText||'').trim(),
             note: ((x.querySelector('.vnote')||{}).innerText||'').trim(),
             meta: ((x.querySelector('.vmeta')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
             isCur: !!x.querySelector('.vflag.cur'),
             isSel: x.classList.contains('sel'),
             nActBtn: x.querySelectorAll('.vbtn').length
           })),
           acts: [...b.querySelectorAll('.ver-acts .btn')].map(x => x.innerText.trim())
         }
       })()`
    )
    const cellOf = (label) => (bar && bar.cells.find((c) => c.label === label)) || null
    ok(!!bar, '包详情里有版本条')
    ok(!!bar && bar.n === 4, `版本条 3 稿 + 1 个「未分版本」格 = ${bar && bar.n} 格`)
    ok(
      !!bar && bar.cells.filter((c) => c.label === '未分版本').length === 1,
      `有一格是「未分版本」（装没归到任何稿里的文件）：${bar && bar.cells.map((c) => c.label).join(' / ')}`
    )
    ok(
      !!bar && bar.cells.filter((c) => c.isCur).length === 1 && cellOf('V2') && cellOf('V2').isCur,
      `只有一格是「当前」，就是 V2：${bar && bar.cells.filter((c) => c.isCur).map((c) => c.label).join(',')}`
    )
    ok(!!bar && !!cellOf('V2') && cellOf('V2').isSel, '打开就停在当前那一稿（不用用户自己找）')
    ok(
      !!cellOf('V1') && cellOf('V1').note.includes('初稿') && cellOf('V2').note.includes('主标题太小'),
      `每稿都带着版本说明：V1「${cellOf('V1') && cellOf('V1').note}」/ V2「${cellOf('V2') && cellOf('V2').note}」`
    )
    ok(
      !!cellOf('V1') && cellOf('V1').meta.includes('3 个文件'),
      `每稿单独显示自己的文件数和容量：V1 ${cellOf('V1') && cellOf('V1').meta}`
    )
    ok(
      !!cellOf('V1') && cellOf('V1').nActBtn === 2,
      `非当前稿有「设为当前」「解绑」两个按钮（${cellOf('V1') && cellOf('V1').nActBtn} 个）`
    )
    ok(
      !!cellOf('V2') && cellOf('V2').nActBtn === 1,
      `当前稿那一格不给「设为当前」（它已经是了），只剩「解绑」`
    )
    ok(
      !!bar && bar.acts.join('|').includes('新建版本') && bar.acts.join('|').includes('绑定文件夹'),
      `版本条右侧两个入口：${bar && bar.acts.join(' / ')}`
    )
    await shot('shot-b9-2-version-bar.png')

    // (3) 点 V1 格 → 下面三组只显示 V1 的文件（版本视角真的换了）
    const toV1 = await js(
      `(() => {
         const cells = [...document.querySelectorAll('.modal.wide .ver-bar .ver-cell')]
         const c = cells.find(x => ((x.querySelector('.vn')||{}).innerText||'').trim() === 'V1')
         if (!c) return 'no-cell'
         c.click(); return 'ok'
       })()`
    )
    ok(toV1 === 'ok', `点了 V1 那一格（${toV1}）`)
    await wait(800)
    const g1 = await js(
      `(() => {
         const caps = [...document.querySelectorAll('.modal.wide .thumb-grid .thumb-cell .cap')].map(x => x.innerText.trim())
         return { caps, n: caps.length }
       })()`
    )
    ok(g1 && g1.n === 3, `切到 V1：只剩 V1 自己的 3 个文件（实际 ${g1 && g1.n}）`)
    ok(
      g1 && g1.caps.includes('招生海报-初稿.png') && !g1.caps.includes('招生海报-改后.png'),
      `V2 的文件不串场：${g1 && g1.caps.join(' / ')}`
    )
    await shot('shot-b9-3-version-v1-only.png')

    // (4) 「＋ 新建版本」弹窗
    const openCreate = await js(
      `(() => {
         const b = [...document.querySelectorAll('.modal.wide .ver-acts .btn')].find(x => x.innerText.includes('新建版本'))
         if (!b) return 'no-btn'
         b.click(); return 'ok'
       })()`
    )
    ok(openCreate === 'ok', `点开「新建版本」（${openCreate}）`)
    await wait(600)
    const cm = await js(
      `(() => {
         const m = document.querySelector('.modal.version-modal')
         if (!m) return null
         return {
           title: ((m.querySelector('h3')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
           hint: ((m.querySelector('.hint-box')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
           foot: [...m.querySelectorAll('.foot .btn')].map(x => x.innerText.trim()),
           chks: [...m.querySelectorAll('.chk')].map(x => x.innerText.replace(/\\s+/g,' ').trim())
         }
       })()`
    )
    ok(!!cm && cm.title.includes('V4'), `弹窗标题写清要建第几稿：${cm && cm.title}`)
    ok(
      !!cm && cm.hint.includes('V4') && cm.hint.includes('01-成品'),
      `弹窗里写明会建哪个文件夹、里面长什么：${(cm && cm.hint || '').slice(0, 40)}…`
    )
    ok(
      !!cm && cm.chks.some((t) => t.includes('把 V3 的文件复制一份进来')),
      `「复制上一稿」是可选（默认不勾）：${cm && cm.chks.join(' || ')}`
    )
    ok(
      !!cm && cm.chks.every((t) => !t.includes(plain(COPY.verModal.collectHint).split('{')[0].trim())),
      '包里已有稿 → 不再出现「收编现有文件」（那是第一稿才有的事）'
    )
    await shot('shot-b9-4-version-create.png')
    await js(
      `(() => { const b = document.querySelector('.modal.version-modal .close'); if (b) b.click(); return 'ok' })()`
    )
    await wait(500)

    // (5) 「📎 绑定文件夹」弹窗 —— 用户自己在资源管理器里建的文件夹在这儿纳管
    const openBind = await js(
      `(() => {
         const b = [...document.querySelectorAll('.modal.wide .ver-acts .btn')].find(x => x.innerText.includes('绑定文件夹'))
         if (!b) return 'no-btn'
         b.click(); return 'ok'
       })()`
    )
    ok(openBind === 'ok', `点开「绑定文件夹」（${openBind}）`)
    await wait(1000)
    const bm = await js(
      `(() => {
         const m = document.querySelector('.modal.version-modal')
         if (!m) return null
         return {
           rows: [...m.querySelectorAll('.bind-row')].map(x => x.innerText.replace(/\\s+/g,' ').trim()),
           seq: String((m.querySelector('.fld input[type=number]')||{}).value),
           foot: [...m.querySelectorAll('.foot .btn')].map(x => x.innerText.trim())
         }
       })()`
    )
    ok(
      !!bm && bm.rows.some((r) => r.includes('终版-客户定稿')),
      `候选里列出了用户自己建的文件夹：${bm && bm.rows.join(' / ')}`
    )
    ok(
      !!bm && bm.rows.length === 1,
      `已认领的 V1/V2/V3 不再出现在候选里（只剩 ${bm && bm.rows.length} 个）`
    )
    ok(!!bm && bm.seq === '4', `默认算第 ${bm && bm.seq} 稿（避开已占的 1 / 2 / 3）`)
    ok(
      !!bm && bm.foot.some((t) => t.includes('绑成 V4')),
      `按钮直接写清会绑成第几稿：${bm && bm.foot.join(' / ')}`
    )
    await shot('shot-b9-5-version-bind.png')

    // (6) 真绑一下 → 版本条立刻多一格，文件当场归位
    const doBind = await js(
      `(() => {
         const b = [...document.querySelectorAll('.modal.version-modal .foot .btn')].find(x => x.innerText.includes('绑成'))
         if (!b) return 'no-btn'
         b.click(); return 'ok'
       })()`
    )
    ok(doBind === 'ok', `点「绑成 V4」（${doBind}）`)
    await wait(2400)
    const bar2 = await js(
      `(() => {
         const b = document.querySelector('.modal.wide .ver-bar')
         if (!b) return null
         const cells = [...b.querySelectorAll('.ver-cell')]
         const v4 = cells.find(x => ((x.querySelector('.vn')||{}).innerText||'').trim() === 'V4')
         return {
           n: cells.length,
           labels: cells.map(x => ((x.querySelector('.vn')||{}).innerText||'').trim()),
           v4title: v4 ? (v4.getAttribute('title')||'') : '',
           v4note: v4 ? ((v4.querySelector('.vnote')||{}).innerText||'').trim() : '',
           cur: ((b.querySelector('.ver-cell.cur .vn')||{}).innerText||'').trim()
         }
       })()`
    )
    ok(!!bar2 && bar2.n === 5, `绑完，版本条多一格（3 稿 + V4 + 未分版本 = ${bar2 && bar2.n}）`)
    ok(!!bar2 && bar2.labels.includes('V4'), `多出来的那格就是 V4：${bar2 && bar2.labels.join(' / ')}`)
    ok(
      !!bar2 && bar2.v4title.includes('终版-客户定稿'),
      `格子上悬停能看到它真实对应的文件夹名：${(bar2 && bar2.v4title || '').split('\\n')[0]}`
    )
    ok(
      qv('SELECT folder_name AS f FROM pack_versions WHERE seq = 4').f === '终版-客户定稿',
      '【铁则】库里记的是真实文件夹名，没被改成 V4（磁盘上那文件夹一个字符没动）'
    )
    ok(
      qv(
        'SELECT COUNT(*) AS c FROM assets WHERE version_id = (SELECT id FROM pack_versions WHERE seq = 4)'
      ).c === 1,
      '【核心】绑定那一刻文件就挂上这一稿了（不用用户自己再去点扫描）'
    )
    ok(!!bar2 && bar2.cur === 'V2', `【绑定不改当前】当前稿仍是 V2（补绑历史稿是常见场景）：${bar2 && bar2.cur}`)

    // (7) 把绑进来的这一稿设为当前（= 回滚）
    const setCur = await js(
      `(() => {
         const cells = [...document.querySelectorAll('.modal.wide .ver-bar .ver-cell')]
         const c = cells.find(x => ((x.querySelector('.vn')||{}).innerText||'').trim() === 'V4')
         if (!c) return 'no-cell'
         const btn = [...c.querySelectorAll('.vbtn')].find(x => x.innerText.includes('设为当前'))
         if (!btn) return 'no-btn'
         btn.click(); return 'ok'
       })()`
    )
    ok(setCur === 'ok', `点第 4 格的「设为当前」（${setCur}）`)
    await wait(1800)
    const afterCur = await js(
      `(() => {
         const b = document.querySelector('.modal.wide .ver-bar')
         const cur = [...b.querySelectorAll('.ver-cell.cur')]
         return { n: cur.length, label: cur.length ? ((cur[0].querySelector('.vn')||{}).innerText||'').trim() : '' }
       })()`
    )
    ok(afterCur && afterCur.n === 1 && afterCur.label === 'V4', `当前指针挪到 V4（当前格只 ${afterCur && afterCur.n} 个：${afterCur && afterCur.label}）`)
    ok(qv('SELECT COUNT(*) AS c FROM pack_versions WHERE is_current = 1').c === 1, '库里也只有一个当前')
    ok(
      existsSync(join(vPackDir, 'V1')) && existsSync(join(vPackDir, 'V2')),
      '【铁则】回滚只改指针：V1 / V2 文件夹一个都没删'
    )
    await shot('shot-b9-6-version-set-current.png')

    // (8) 关掉包详情 → 文件视图：每行挂版本徽标；「只看当前稿」一开就只剩当前那稿
    await js(
      `(() => { const b = document.querySelector('.modal.wide .close'); if (b) b.click(); return 'ok' })()`
    )
    await wait(900)
    await pickSideItem('文件视图', '.tabs button')
    await wait(1600)
    const allRows = await js(
      `(() => {
         const rows = [...document.querySelectorAll('.main-scroll .file-row')]
         return {
           n: rows.length,
           badges: rows.filter(r => r.querySelector('.ver-badge')).length,
           texts: [...new Set(rows.map(r => ((r.querySelector('.ver-badge')||{}).innerText||'').trim()).filter(Boolean))],
           curBadges: rows.filter(r => (r.querySelector('.ver-badge')||{}).classList && r.querySelector('.ver-badge').classList.contains('cur')).length
         }
       })()`
    )
    ok(allRows && allRows.n >= 7, `文件视图默认全显示（含历史稿，不藏东西）：${allRows && allRows.n} 行`)
    ok(allRows && allRows.badges >= 4, `文件行挂着版本徽标：${allRows && allRows.texts.join(' / ')}`)
    ok(allRows && allRows.curBadges === 1, `当前稿那一行有且只有 1 个绿色徽标（${allRows && allRows.curBadges}）`)
    await shot('shot-b9-7-file-view-badges.png')

    const toggle = await js(
      `(() => {
         const i = document.querySelector('.cur-only input')
         if (!i) return 'no-input'
         i.click(); return 'ok'
       })()`
    )
    ok(toggle === 'ok', `点开工具栏的「只看当前稿」（${toggle}）`)
    await wait(1600)
    const curRows = await js(
      `(() => {
         const rows = [...document.querySelectorAll('.main-scroll .file-row')]
         return {
           n: rows.length,
           texts: rows.map(r => ((r.querySelector('.ver-badge')||{}).innerText||'').trim()),
           names: rows.map(r => ((r.querySelector('.fn')||{}).innerText||'').split('\\n')[0].trim()),
           status: ((document.querySelector('.statusbar')||{}).innerText||'').includes('只看当前稿')
         }
       })()`
    )
    ok(curRows && curRows.n === 1, `只剩当前稿 V4 的 1 个文件（实际 ${curRows && curRows.n}）`)
    ok(curRows && curRows.texts.every((t) => t === 'V4'), `列出来的都是 V4：${curRows && curRows.texts.join(' / ')}`)
    ok(
      curRows && curRows.names.join('|').includes('招生海报-客户签字版.png'),
      `正是客户签字那一版：${curRows && curRows.names.join(' / ')}`
    )
    ok(!!curRows && curRows.status, '状态栏写明当前在「只看当前稿」')
    await shot('shot-b9-8-current-only.png')
    // 关回去，免得影响后面的解绑验证
    await js(
      `(() => { const i = document.querySelector('.cur-only input'); if (i) i.click(); return 'ok' })()`
    )
    await wait(1000)

    // (9) 解绑 V3（名字规范、正是扫描会自动认的那种）+ 刷新扫描
    //     → 文件夹留在磁盘上、文件回「未分版本」，但**不会**被扫描又认回来
    await pickSideItem(COPY.top.viewPacks, '.tabs button')
    await wait(1000)
    await js(
      `(() => {
         const cards = [...document.querySelectorAll('.grid .pack-card')]
         const c = cards.find(x => ((x.querySelector('.name')||{}).innerText||'').includes('海南招生海报'))
         if (c) c.click()
         return 'ok'
       })()`
    )
    await wait(1500)
    const unbind = await js(
      `(() => {
         const cells = [...document.querySelectorAll('.modal.wide .ver-bar .ver-cell')]
         const c = cells.find(x => ((x.querySelector('.vn')||{}).innerText||'').trim() === 'V3')
         if (!c) return 'no-cell'
         const btn = [...c.querySelectorAll('.vbtn')].find(x => x.innerText.includes('解绑'))
         if (!btn) return 'no-btn'
         btn.click(); return 'ok'
       })()`
    )
    ok(unbind === 'ok', `点 V3 那一格的「解绑」（${unbind}）`)
    await wait(1800)
    const bar3 = await js(
      `(() => {
         const b = document.querySelector('.modal.wide .ver-bar')
         return {
           labels: [...b.querySelectorAll('.ver-cell .vn')].map(x => x.innerText.trim()),
           none: ((b.querySelector('.ver-cell.none .vmeta')||{}).innerText||'').replace(/\\s+/g,' ').trim()
         }
       })()`
    )
    ok(
      !!bar3 && !bar3.labels.includes('V3'),
      `V3 那一格没了：${bar3 && bar3.labels.join(' / ')}`
    )
    ok(
      existsSync(join(vPackDir, 'V3')) && existsSync(join(vPackDir, 'V3', '01-成品', '招生海报-终审.png')),
      '【铁则】解绑只解除管理关系：磁盘上 V3 文件夹和里面的文件一个字节没动'
    )
    ok(
      !!bar3 && !bar3.none.startsWith('0'),
      `V3 的文件回到「未分版本」：${bar3 && bar3.none}`
    )
    ok(
      qv("SELECT COUNT(*) AS c FROM assets WHERE file_name = '招生海报-终审.png' AND version_id IS NULL").c === 1,
      '【不删记录】那条文件记录还在，只是没了版本归属'
    )

    await js(
      `(() => {
         const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes(${JSON.stringify(COPY.top.rescan)}))
         if (b) b.click()
         return 'ok'
       })()`
    )
    await wait(2600)
    ok(
      qv('SELECT COUNT(*) AS c FROM pack_versions').c === 3,
      '【核心】刷新扫描后仍是 3 稿（V1/V2/V4）——没把刚解绑的 V3 又自动认回来（解绑按了是真生效）'
    )
    ok(
      qv('SELECT COUNT(*) AS c FROM pack_versions WHERE seq = 3').c === 0,
      '编号 3 空着，等用户想收回时自己点「绑定」'
    )
    const bar4 = await js(
      `(() => {
         const b = document.querySelector('.modal.wide .ver-bar')
         if (!b) return null
         return { labels: [...b.querySelectorAll('.ver-cell .vn')].map(x => x.innerText.trim()) }
       })()`
    )
    ok(
      !!bar4 && !bar4.labels.includes('V3'),
      `界面也没冒出 V3：${bar4 && bar4.labels.join(' / ')}`
    )
    await shot('shot-b9-9-unbind-still-3.png')

    // ---- (10) 第 9 批补：新建包自带第一稿 V1 ----
    // 用户拍板「所有新建的包都从 V1 开始」：不用再"先建个空包 → 再手动建第 1 稿"两步走。
    // 建包时磁盘上直接把 `包\V1\三组` 长好，V1 自动成为当前版本。
    const SUB3 = ['01-成品', '02-素材', '03-工程']
    await js(
      `(() => { const b = document.querySelector('.modal .close'); if (b) b.click(); return 'ok' })()`
    )
    await wait(700)
    await js(
      `(() => {
         const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes(${JSON.stringify(COPY.top.newPack)}))
         if (b) b.click()
         return b ? 'ok' : 'no-btn'
       })()`
    )
    await wait(900)
    const npTip = await js(
      `(() => {
         const m = document.querySelector('.modal')
         if (!m) return null
         return {
           title: ((m.querySelector('h3')||{}).innerText||'').trim(),
           path: ((m.querySelector('.path')||{}).innerText||'').trim()
         }
       })()`
    )
    ok(!!npTip && npTip.title.includes(COPY.top.newPack), `新建包弹窗打开（${npTip && npTip.title}）`)
    ok(
      !!npTip && npTip.path.includes('V1') && npTip.path.includes('01-成品'),
      `弹窗提前讲清会自带第 1 稿 V1：${npTip && npTip.path}`
    )
    const npFilled = await js(
      `(() => {
         const i = document.querySelector('.modal .field input[type=text]')
         if (!i) return 'no-input'
         const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
         setter.call(i, '海南招生折页-秋季')
         i.dispatchEvent(new Event('input', { bubbles: true }))
         return 'ok'
       })()`
    )
    ok(npFilled === 'ok', `填包名（${npFilled}）`)
    await wait(400)
    await shot('shot-b9-10-newpack-dialog.png')
    await clickModalOk()
    await wait(3000)

    const npCard = await js(
      `(() => {
         const cards = [...document.querySelectorAll('.grid .pack-card')]
         const c = cards.find(x => ((x.querySelector('.name')||{}).innerText||'').includes('海南招生折页-秋季'))
         if (!c) return null
         return {
           chip: ((c.querySelector('.ver-chip')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
           sub: ((c.querySelector('.sub')||{}).innerText||'').replace(/\\s+/g,' ').trim()
         }
       })()`
    )
    ok(!!npCard, '新建的包出现在包视图卡片里')
    ok(
      !!npCard && npCard.chip.includes('V1') && npCard.chip.includes('当前') && npCard.chip.includes('1 稿'),
      `【核心】新包卡片直接标「V1 当前 · 1 稿」，不用手工建稿：${npCard && npCard.chip}`
    )
    const npPackRow = qv('SELECT id, folder_path FROM packs WHERE name = ?', '海南招生折页-秋季')
    ok(!!npPackRow.id, '【库】新包的记录建好了')
    ok(
      !!npPackRow.folder_path && SUB3.every((f) => existsSync(join(npPackRow.folder_path, 'V1', f))),
      '【盘】新包自带 V1，V1 下的三组已经长好'
    )
    ok(
      !!npPackRow.folder_path && !SUB3.some((f) => existsSync(join(npPackRow.folder_path, f))),
      '【盘】包根不再直接放三组（不会多出 3 个永远空着的文件夹）'
    )
    ok(
      qv(
        'SELECT COUNT(*) AS c FROM pack_versions WHERE pack_id = ? AND seq = 1 AND is_current = 1',
        npPackRow.id
      ).c === 1,
      '【库】V1 直接就是当前版本'
    )
    await shot('shot-b9-11-newpack-card.png')

    // 点进新包详情：版本条上直接有 V1，不用再点「＋ 新建版本」
    await js(
      `(() => {
         const cards = [...document.querySelectorAll('.grid .pack-card')]
         const c = cards.find(x => ((x.querySelector('.name')||{}).innerText||'').includes('海南招生折页-秋季'))
         if (c) c.click()
         return 'ok'
       })()`
    )
    await wait(1700)
    const npBar = await js(
      `(() => {
         const b = document.querySelector('.modal.wide .ver-bar')
         if (!b) return null
         const cells = [...b.querySelectorAll('.ver-cell')]
         return {
           labels: cells.map(x => ((x.querySelector('.vn')||{}).innerText||'').trim()),
           cur: ((b.querySelector('.ver-cell.cur .vn')||{}).innerText||'').trim(),
           sel: ((b.querySelector('.ver-cell.sel .vn')||{}).innerText||'').trim()
         }
       })()`
    )
    ok(!!npBar && npBar.labels[0] === 'V1', `新包详情里直接有 V1：${npBar && npBar.labels.join(' / ')}`)
    ok(!!npBar && npBar.cur === 'V1' && npBar.sel === 'V1', '打开新包就停在 V1（当前版本）上')
    await shot('shot-b9-12-newpack-detail.png')
    await js(
      `(() => { const b = document.querySelector('.modal .close'); if (b) b.click(); return 'ok' })()`
    )
    await wait(600)
  } else if (SCEN === 'category') {
    // ============================================================
    // 第 10 批：建包时的「物料类别」= 左栏筛选里那一套（用户实测报的 bug）
    // 布景见上面的 seeding 段：3 个包（海报 / 单页 / 折页）
    // ============================================================
    const openManager = async () => {
      await js(`(() => {
        const d = [...document.querySelectorAll('.tp-dim')]
          .find(x => ((x.querySelector('.tp-dim-label')||{}).innerText||'').trim() === '物料类别')
        if (!d) return 'no-dim'
        const b = d.querySelector('.tp-add')
        if (!b) return 'no-add'
        b.click(); return 'ok'
      })()`)
      await wait(1000)
    }
    const openNewPack = async () => {
      await js(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes(${JSON.stringify(COPY.top.newPack)}))
        if (b) b.click()
        return b ? 'ok' : 'no-btn'
      })()`)
      await wait(1000)
    }
    const closeTopModal = async () => {
      await js(
        `(() => { const b = document.querySelector('.modal .close'); if (b) b.click(); return 'ok' })()`
      )
      await wait(700)
    }
    // 第 23 批（docs/29）：建包弹窗的类别 / 场景由平铺 chips 改成**下拉**，
    // 读取方式跟着改成读对应 field 里 select 的 option。
    const readNewPackSelect = (dimLabel) =>
      js(`(() => {
         const m = [...document.querySelectorAll('.mask > .modal')]
           .find(x => ((x.querySelector('h3')||{}).innerText||'').includes(${JSON.stringify(COPY.top.newPack)}))
         if (!m) return null
         const f = [...m.querySelectorAll('.field')]
           .find(x => ((x.querySelector('label')||{}).innerText||'').trim() === ${JSON.stringify(dimLabel)})
         const s = f && f.querySelector('select')
         if (!s) return []
         return [...s.querySelectorAll('option')].map(o => (o.textContent||'').trim())
       })()`)
    const readNewPackChips = () => readNewPackSelect(COPY.dim.category)

    await pickSideItem(COPY.top.viewPacks, '.tabs button')
    await wait(900)

    // (1) 左栏「物料类别」现在有这些
    await expandDim('物料类别')
    await wait(500)
    const panelCats = await js(
      `(() => {
         const d = [...document.querySelectorAll('.tp-dim')]
           .find(x => ((x.querySelector('.tp-dim-label')||{}).innerText||'').trim() === '物料类别')
         if (!d) return null
         return [...d.querySelectorAll('.tp-tag-name')].map(x => x.innerText.trim())
       })()`
    )
    ok(
      Array.isArray(panelCats) && panelCats.length >= 9,
      `【布景】左栏「物料类别」里有 ${Array.isArray(panelCats) ? panelCats.length : 0} 个标签`
    )

    // (1b) 第 23 批：左栏「使用场景」维度的标签清单（建包面板那个新下拉要跟它对齐）
    await expandDim(COPY.dim.channel)
    await wait(500)
    const panelScenes = await js(
      `(() => {
         const d = [...document.querySelectorAll('.tp-dim')]
           .find(x => ((x.querySelector('.tp-dim-label')||{}).innerText||'').trim() === ${JSON.stringify(COPY.dim.channel)})
         if (!d) return null
         return [...d.querySelectorAll('.tp-tag-name')].map(x => x.innerText.trim())
       })()`
    )
    ok(
      Array.isArray(panelScenes) && panelScenes.length >= 5,
      `【布景】左栏「使用场景」里有 ${Array.isArray(panelScenes) ? panelScenes.length : 0} 个标签`
    )

    // (2) 新建包弹窗的 chips 必须与左栏一字不差 —— 这就是用户报的那个 bug
    await openNewPack()
    const chips1 = await readNewPackChips()
    ok(!!chips1, '新建包弹窗打开了')
    ok(
      Array.isArray(chips1) && JSON.stringify(chips1) === JSON.stringify(panelCats),
      `【核心】建包能选的 = 左栏「物料类别」，一字不差（${
        Array.isArray(chips1) ? chips1.join('、') : String(chips1)
      }）`
    )
    ok(
      Array.isArray(chips1) && !chips1.includes('推文配图') && !chips1.includes('PPT'),
      '【核心】原来那套写死的 6 项（视频 / 推文配图 / PPT…）已经不存在了'
    )
    // (2b) 第 23 批：使用场景也能在建包面板绑定，清单跟左栏一致（第 23 批前任务上根本绑不了它）
    const scenes1 = await readNewPackSelect(COPY.dim.channel)
    ok(
      Array.isArray(scenes1) && scenes1.length > 0,
      `新建包弹窗有「使用场景」下拉（${Array.isArray(scenes1) ? scenes1.join('、') : String(scenes1)}）`
    )
    ok(
      Array.isArray(scenes1) &&
        Array.isArray(panelScenes) &&
        JSON.stringify(scenes1) === JSON.stringify(panelScenes),
      '【核心】建包能选的「使用场景」= 左栏「使用场景」，一字不差'
    )

    // (2b-49) 第 49 批（docs/34）：物料分级 —— 预制清单在左栏出现，且建包下拉与之一字不差
    await expandDim(COPY.dim.grade)
    await wait(500)
    const panelGrades = await js(
      `(() => {
         const d = [...document.querySelectorAll('.tp-dim')]
           .find(x => ((x.querySelector('.tp-dim-label')||{}).innerText||'').trim() === ${JSON.stringify(COPY.dim.grade)})
         if (!d) return null
         return [...d.querySelectorAll('.tp-tag-name')].map(x => x.innerText.trim())
       })()`
    )
    // 第 52 批：分级名从文案字典取（不再硬编码，改名时自动跟着变）
    const GRADE_ORDER = [COPY.seed.gradeS, COPY.seed.gradeA, COPY.seed.gradeB, COPY.seed.gradeC].join(',')
    ok(
      Array.isArray(panelGrades) && panelGrades.length === 4,
      `【布景】左栏「物料分级」有 ${Array.isArray(panelGrades) ? panelGrades.length : 0} 个预制标签（应为 4）`
    )
    ok(
      Array.isArray(panelGrades) && panelGrades.join(',') === GRADE_ORDER,
      `【核心】预制分级顺序 = ${GRADE_ORDER}（实际：${Array.isArray(panelGrades) ? panelGrades.join(',') : String(panelGrades)}）`
    )

    await openNewPack()
    const grades1 = await readNewPackSelect(COPY.dim.grade)
    ok(
      Array.isArray(grades1) && grades1.length > 0,
      `新建包弹窗有「物料分级」下拉（${Array.isArray(grades1) ? grades1.join('、') : String(grades1)}）`
    )
    ok(
      Array.isArray(grades1) &&
        Array.isArray(panelGrades) &&
        JSON.stringify(grades1) === JSON.stringify(panelGrades),
      '【核心】建包能选的「物料分级」= 左栏「物料分级」，一字不差'
    )

    // (2b-49b) 【核心·布局】用户指定：所属项目与物料分级**并排**（同一个 .field-row）
    const layoutOk = await js(
      `(() => {
         const m = [...document.querySelectorAll('.mask > .modal')]
           .find(x => ((x.querySelector('h3')||{}).innerText||'').includes(${JSON.stringify(COPY.top.newPack)}))
         if (!m) return null
         const rows = [...m.querySelectorAll('.field-row')]
         const hit = rows.find(r => {
           const labels = [...r.querySelectorAll('.field > label')].map(l => (l.innerText||'').trim())
           return labels.includes(${JSON.stringify(COPY.editPack.projectLabel)})
             && labels.includes(${JSON.stringify(COPY.dim.grade)})
         })
         if (!hit) return { found: false, rowLabels: rows.map(r => [...r.querySelectorAll('.field > label')].map(l => (l.innerText||'').trim())) }
         const fs = [...hit.querySelectorAll('.field')]
         const a = fs[0].getBoundingClientRect(), b2 = fs[1].getBoundingClientRect()
         return {
           found: true,
           sameRow: Math.abs(a.top - b2.top) < 4,
           leftIsProject: ((fs[0].querySelector('label')||{}).innerText||'').trim() === ${JSON.stringify(COPY.editPack.projectLabel)},
           twoSelects: fs.filter(f => f.querySelector('select')).length === 2,
           rowLabels: [...hit.querySelectorAll('.field > label')].map(l => (l.innerText||'').trim())
         }
       })()`
    )
    ok(layoutOk && layoutOk.found, `项目与分级在同一行（实际行分组：${JSON.stringify(layoutOk && layoutOk.rowLabels)}）`)
    ok(!!layoutOk && layoutOk.sameRow, '【核心】两个下拉顶端对齐（确实并排，不是上下堆叠）')
    ok(!!layoutOk && layoutOk.leftIsProject, '【核心】左边是「所属项目」（用户指定分级放它旁边）')
    ok(!!layoutOk && layoutOk.twoSelects, '该行是两个下拉（不是只有一个）')

    // 2×2 矩阵：第二行应是「物料类别 + 使用场景」
    const matrixRows = await js(
      `(() => {
         const m = [...document.querySelectorAll('.mask > .modal')]
           .find(x => ((x.querySelector('h3')||{}).innerText||'').includes(${JSON.stringify(COPY.top.newPack)}))
         if (!m) return null
         return [...m.querySelectorAll('.field-row')].map(r =>
           [...r.querySelectorAll('.field > label')].map(l => (l.innerText||'').trim()).join('+'))
       })()`
    )
    ok(
      Array.isArray(matrixRows) &&
        matrixRows.length === 2 &&
        matrixRows[1] === [COPY.dim.category, COPY.dim.channel].join('+'),
      `【核心】2×2 下拉矩阵第二行 = 物料类别+使用场景（实际：${JSON.stringify(matrixRows)}）`
    )

    await shot('shot-b10-1-newpack-same-list.png')
    await shot('shot-b49-1-newpack-grade.png')
    await closeTopModal()

    // (2c) 第 23 批【核心】标签数字含任务数 + 点标签筛任务（用户报的 bug：新建任务后
    //      左侧数字不动、点标签筛不出任务）
    const catRows = await js(
      `(() => {
         const d = [...document.querySelectorAll('.tp-dim')]
           .find(x => ((x.querySelector('.tp-dim-label')||{}).innerText||'').trim() === ${JSON.stringify(COPY.dim.category)})
         if (!d) return null
         return [...d.querySelectorAll('.tp-tag')].map(b => ({
           name: ((b.querySelector('.tp-tag-name')||{}).innerText||'').trim(),
           n: ((b.querySelector('.tp-tag-n')||{}).innerText||'').trim(),
           tip: b.getAttribute('title') || ''
         }))
       })()`
    )
    const posterRow = Array.isArray(catRows) ? catRows.find((x) => x.name === '海报') : null
    ok(
      !!posterRow && Number(posterRow.n) > 0,
      `【核心】左侧标签数字统计到任务（「海报」= ${posterRow && posterRow.n}）`
    )
    ok(
      !!posterRow && posterRow.tip.includes('任务') && posterRow.tip.includes('文件'),
      `悬停提示把数字分解成「任务 + 文件」：${posterRow && posterRow.tip}`
    )
    const cardsBefore = await js(`document.querySelectorAll('.grid .pack-card').length`)
    await js(`(() => {
      const d = [...document.querySelectorAll('.tp-dim')]
        .find(x => ((x.querySelector('.tp-dim-label')||{}).innerText||'').trim() === ${JSON.stringify(COPY.dim.category)})
      const b = d && [...d.querySelectorAll('.tp-tag')].find(x => ((x.querySelector('.tp-tag-name')||{}).innerText||'').trim() === '海报')
      if (b) b.click(); return b ? 'ok' : 'no-tag'
    })()`)
    await wait(700)
    const cardsAfter = await js(`document.querySelectorAll('.grid .pack-card').length`)
    ok(
      cardsAfter >= 1 && cardsAfter < cardsBefore,
      `【核心】点「海报」标签后任务视图按类别筛出任务：卡片 ${cardsBefore} → ${cardsAfter}（bug：以前筛不出任务）`
    )
    await shot('shot-b23-1-filter-tasks-by-tag.png')
    // 复位筛选，别影响后面的断言
    await js(`(() => { const b = document.querySelector('.tp-clear'); if (b) b.click(); return 'ok' })()`)
    await wait(600)

    // (3) 左栏加一个「易拉宝」→ 建包弹窗当场多一项
    await openManager()
    const tmTitle = await js(
      `(() => { const m = document.querySelector('.modal'); return m ? ((m.querySelector('h3')||{}).innerText||'').trim() : '' })()`
    )
    ok(tmTitle.includes('标签管理'), `左栏「＋ 管理」打开了标签管理（${tmTitle}）`)
    await js(`(() => {
      const i = document.querySelector('.modal .tm-add input')
      if (!i) return 'no-input'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(i, '易拉宝')
      i.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`)
    await wait(400)
    await js(
      `(() => { const b = document.querySelector('.modal .tm-add .btn'); if (b) b.click(); return b ? 'ok' : 'no-btn' })()`
    )
    await wait(1300)
    const tmNames = await js(
      `[...document.querySelectorAll('.tm-row .tm-name')].map(x => x.innerText.trim())`
    )
    ok(
      Array.isArray(tmNames) && tmNames.includes('易拉宝'),
      '【左栏】新标签「易拉宝」加进了「物料类别」'
    )
    await closeTopModal()
    await openNewPack()
    const chips2 = await readNewPackChips()
    ok(
      Array.isArray(chips2) && chips2.includes('易拉宝'),
      `【实时同步】刚在左栏加的「易拉宝」，建包弹窗当场能选到（现在 ${
        Array.isArray(chips2) ? chips2.length : 0
      } 项）`
    )
    await shot('shot-b10-2-new-category-sync.png')
    await closeTopModal()

    // (4) 删掉被包用着的「单页」：先把「有 N 个包在用」说清楚，确认才删
    await openManager()
    await js(`(() => {
      const row = [...document.querySelectorAll('.tm-row')]
        .find(x => ((x.querySelector('.tm-name')||{}).innerText||'').trim() === '单页')
      if (!row) return 'no-row'
      const b = row.querySelector('.mini.danger')
      if (!b) return 'no-del'
      b.click(); return 'ok'
    })()`)
    await wait(1000)
    const warn = await js(
      `(() => {
         const ms = [...document.querySelectorAll('.mask > .modal')]
         const m = ms[ms.length - 1]
         if (!m) return null
         return {
           title: ((m.querySelector('h3')||{}).innerText||'').trim(),
           text: [...m.querySelectorAll('.hint')].map(x => x.innerText.trim()).join(' '),
           btns: [...m.querySelectorAll('.foot .btn')].map(x => x.innerText.trim())
         }
       })()`
    )
    ok(!!warn && warn.title.includes('删除标签'), '删除前先弹二次确认')
    ok(
      !!warn && warn.text.includes(fmt(plain(COPY.tagMgr.delPackCount).split('，')[0], { n: 1 })),
      `【核心】确认框写明「有 1 个任务正在用这个类别」：${warn && warn.text}`
    )
    ok(
      !!warn && warn.text.includes('未分类') && warn.btns.includes('确认删除'),
      '并把后果讲清楚（包的类别归「未分类」）之后才给「确认删除」'
    )
    await shot('shot-b10-3-delete-warn.png')
    await js(`(() => {
      const ms = [...document.querySelectorAll('.mask > .modal')]
      const m = ms[ms.length - 1]
      if (!m) return 'no-modal'
      const b = [...m.querySelectorAll('.foot .btn')].pop()
      if (!b) return 'no-btn'
      b.click(); return 'ok'
    })()`)
    await wait(1600)
    const delToast = await js(
      `[...document.querySelectorAll('.toast')].map(x => x.innerText.trim()).join(' || ')`
    )
    ok(
      typeof delToast === 'string' && delToast.includes('未分类'),
      `删完的提示条也说了包的类别归到「未分类」：${delToast}`
    )
    await closeTopModal()
    await wait(1000)

    // (5) 回包视图：被删类别的包显示「未分类」，别的包纹丝不动
    const cardTags = await js(
      `(() => {
         const out = {}
         for (const c of document.querySelectorAll('.grid .pack-card')) {
           const n = ((c.querySelector('.name')||{}).innerText||'').trim()
           if (!n || n === '未归属') continue
           out[n] = [...c.querySelectorAll('.tags .tag')].map(x => x.innerText.trim())
         }
         return out
       })()`
    )
    ok(
      !!cardTags && (cardTags['招生短视频-30秒'] || []).includes('未分类'),
      `【联动】用过这个类别的包显示「未分类」：${JSON.stringify(
        cardTags && cardTags['招生短视频-30秒']
      )}`
    )
    ok(
      !!cardTags && (cardTags['招生简章折页'] || []).includes('折页'),
      '【边界】没用到这个类别的包纹丝不动（折页还是折页）'
    )
    ok(
      !!cardTags && (cardTags['海南招生海报-2026秋季'] || []).includes('海报'),
      '【边界】「海报」也没被牵连'
    )
    await shot('shot-b10-4-category-deleted.png')
  } else if (SCEN === 'tickets') {
    // ============================================================
    // 第 13 批：工单视图（顶栏第三格）。布景：9 张各形态工单 + 1 个已建任务。
    // ============================================================
    const clickChip = async (text) => {
      await js(`(() => {
        const b = [...document.querySelectorAll('.tk-toolbar .chip')]
          .find(x => x.innerText.trim() === ${JSON.stringify(text)})
        if (b) b.click()
        return b ? 'ok' : 'no-chip'
      })()`)
      await wait(700)
    }
    const rowCount = () => js(`document.querySelectorAll('.tk-list .tk-row').length`)
    const rowByNo = (no) =>
      js(`(() => {
        const r = [...document.querySelectorAll('.tk-list .tk-row')]
          .find(x => x.innerText.includes(${JSON.stringify(no)}))
        if (!r) return null
        return {
          dim: r.classList.contains('dim'),
          type: ((r.querySelector('.tk-type')||{}).innerText||'').trim(),
          state: ((r.querySelector('.tk-state')||{}).innerText||'').trim(),
          task: ((r.querySelector('.c-task')||{}).innerText||'').trim(),
          designer: ((r.querySelector('.c-designer')||{}).innerText||'').trim()
        }
      })()`)

    // (1) 顶栏出现第三格「工单」，点进去
    // ⚠️ 第 17 批起这颗按钮里可能带「待指派 N」徽标（innerText 变成「工单1」），
    // 全等匹配会点不进去 —— 用前缀匹配（clickByText 的全等是给别的场景用的，不动）
    const tabOk = await js(
      `(() => { const b = [...document.querySelectorAll('.tabs button')].find(x => x.innerText.trim().startsWith(${JSON.stringify(COPY.ticket.viewTab)})); if (b) { b.click(); return 'ok' } return 'no-el' })()`
    )
    ok(tabOk === 'ok', `顶栏「${COPY.ticket.viewTab}」格出现了`)
    await wait(1200)

    // (1b) 第 21 批：顶栏三格按使用逻辑重排 —— 工单队列在最前（先看单、再回任务、最后查文件）
    const tabBar = await js(
      `(() => { const bs = [...document.querySelectorAll('.tabs button')]; return { n: bs.length, first: bs[0] ? bs[0].innerText.trim() : '', order: bs.map(b => b.innerText.trim()) } })()`
    )
    ok(
      !!tabBar && tabBar.n === 3 && tabBar.first.startsWith(plain(COPY.ticket.viewTab)),
      `顶栏第一格是「${plain(COPY.ticket.viewTab)}」（实际顺序：${tabBar ? tabBar.order.join(' / ') : '—'}）`
    )
    ok(
      !!tabBar && tabBar.order[1] && tabBar.order[1].startsWith(plain(COPY.top.viewPacks)),
      `第二格是${plain(COPY.top.viewPacks)}（顺序按使用逻辑而非功能新旧）`
    )
    // 第 22 批：工单队列升为启动默认视图（此前默认落在任务视图）—— 用启动快照钉住
    ok(String(tabOnLoad).startsWith(COPY.ticket.viewTab), `启动默认落在${plain(COPY.ticket.viewTab)}（启动时高亮：${tabOnLoad}）`)

    // (2) 筛选标签齐全 + 同步按钮在
    const chips = await js(`[...document.querySelectorAll('.tk-toolbar .chip')].map(b => b.innerText.trim())`)
    ok(
      Array.isArray(chips) && chips.length === 7,
      `七个筛选标签齐全（${Array.isArray(chips) ? chips.join(' / ') : String(chips)}）`
    )
    const syncBtn = await js(
      `(() => { const b = [...document.querySelectorAll('.tk-toolbar .btn')].find(x => x.innerText.includes(${JSON.stringify(COPY.ticket.syncBtn)})); return b ? b.innerText.trim() : '' })()`
    )
    ok(syncBtn.includes(COPY.ticket.syncBtn), `「${COPY.ticket.syncBtn}」按钮在`)

    // (2b) 第 19 批：顶栏「导出报表」按钮 + 弹窗形态（不真导出 —— 真企微不进自动测试）
    const exportBtn = await js(
      `(() => { const b = [...document.querySelectorAll('.tk-toolbar .btn')].find(x => x.innerText.includes(${JSON.stringify(COPY.ticket.exportReportBtn)})); return b ? b.innerText.trim() : '' })()`
    )
    ok(exportBtn.includes(COPY.ticket.exportReportBtn), `「${COPY.ticket.exportReportBtn}」按钮在`)
    await js(
      `(() => { const b = [...document.querySelectorAll('.tk-toolbar .btn')].find(x => x.innerText.includes(${JSON.stringify(COPY.ticket.exportReportBtn)})); if (b) b.click(); return 'ok' })()`
    )
    await wait(700)
    const erModal = await js(
      `(() => { const m = document.querySelector('.mask .modal'); if (!m) return null; const inputs = [...m.querySelectorAll('input')]; return { title: ((m.querySelector('h3')||{}).innerText||'').trim(), hasLink: inputs.some(i => i.type === 'text'), dateCount: inputs.filter(i => i.type === 'date').length, runBtn: [...m.querySelectorAll('.btn')].some(b => b.innerText.includes(${JSON.stringify(COPY.ticket.exportReportRun)})) } })()`
    )
    ok(!!erModal && erModal.title.includes(COPY.ticket.exportReportTitle), `「${COPY.ticket.exportReportTitle}」弹窗在`)
    ok(!!erModal && erModal.hasLink && erModal.dateCount === 2, '弹窗含报表链接输入框 + 起止日期两个日期框')
    ok(!!erModal && erModal.runBtn, `「${COPY.ticket.exportReportRun}」按钮在`)
    await shot('shot-b19-1-export-modal.png')
    await js(`(() => { const b = document.querySelector('.mask .modal .close'); if (b) b.click(); return 'ok' })()`)
    await wait(500)

    // (3) 默认「我的」：8 张（= 派给我的全部：含我的历史单/待确认/撞号/多人协作 —— 列表可见性口径，磁盘上只长该建任务的那些），驳回的压暗
    ok((await rowCount()) === 8, `默认「我的」视图 8 张（实际 ${await rowCount()}）`)
    const r1 = await rowByNo('202610010001')
    ok(!!r1 && r1.type === COPY.ticket.typePrint, '印刷类型徽标正确')
    ok(!!r1 && r1.state === '审批中', '审批中是活跃状态（正常亮显，徽标蓝色）')
    ok(
      !!r1 && r1.task.includes(COPY.ticket.linkedTask.split('{name}')[0].slice(0, 2)),
      `已建任务的单显示任务名（${r1 ? r1.task : '—'}）`
    )
    const r3 = await rowByNo('202610010003')
    ok(!!r3 && r3.dim === true, '已驳回的单整行压暗（用户拍板：审批中才建任务，驳回保留展示）')
    await shot('shot-b13-1-mine.png')

    // (4) 全部：10 张；类型徽标印刷/电子都在；未指派 / 历史 / 待确认各归各位
    await clickChip(COPY.ticket.filterAll)
    ok((await rowCount()) === 10, `「全部」视图 10 张（实际 ${await rowCount()}）`)
    const r9 = await rowByNo('202610010009')
    ok(!!r9 && r9.type === COPY.ticket.typeDigital, `电子类型徽标正确（${r9 ? r9.type : '—'}）`)
    const r5 = await rowByNo('202610010005')
    ok(!!r5 && r5.designer === COPY.ticket.filterUnassigned, '设计师空着的单标「未指派」')
    const r6 = await rowByNo('202610010006')
    ok(!!r6 && r6.task.includes(COPY.ticket.noTaskHistory.split('（')[0].slice(0, 2)), `历史单的任务列写明原因（${r6 ? r6.task : '—'}）`)
    // 第 18 批（docs/20 §7）：多人协作单列表行「主设计师 + 等 1 人」
    const r10 = await rowByNo('202610010010')
    ok(
      !!r10 && r10.designer.includes(COPY.ticket.assignMore.replace('{n}', '1')),
      `多人协作单列表行标「等 1 人」（${r10 ? r10.designer : '—'}）`
    )
    await shot('shot-b13-2-all.png')

    // (5) 待确认：1 张 + 「确认这批新单」批量按钮
    await clickChip(COPY.ticket.filterPending)
    ok((await rowCount()) === 1, `「待确认」视图 1 张（实际 ${await rowCount()}）`)
    const confirmBtn = await js(
      `(() => { const b = [...document.querySelectorAll('.tk-toolbar .btn')].find(x => x.innerText.includes(${JSON.stringify(COPY.ticket.confirmBatch)})); return b ? b.innerText.trim() : '' })()`
    )
    ok(confirmBtn.includes(COPY.ticket.confirmBatch), `「${COPY.ticket.confirmBatch}」按钮在（子表重建防护，§2.2④）`)

    // (6) 详情弹窗：三段字段 + 打开审批 + 关联任务卡
    await clickChip(COPY.ticket.filterMine)
    await js(
      `(() => { const r = [...document.querySelectorAll('.tk-list .tk-row')].find(x => x.innerText.includes('202610010001')); if (r) r.click(); return r ? 'ok' : 'no-row' })()`
    )
    await wait(900)
    const dTitle = await js(
      `(() => { const m = document.querySelector('.mask .modal'); return m ? ((m.querySelector('h3')||{}).innerText||'').trim() : '' })()`
    )
    ok(dTitle.includes('海南招生海报-工单A'), `详情弹窗标题是物料名（${dTitle}）`)
    const dSections = await js(
      `[...document.querySelectorAll('.tk-detail h4')].map(x => x.innerText.trim())`
    )
    ok(
      Array.isArray(dSections) && dSections.includes(plain(COPY.ticket.basicSection)) && dSections.includes(plain(COPY.ticket.printSection)) && dSections.includes(plain(COPY.ticket.taskSection)),
      `详情分三段：基本信息 / 印刷信息 / 关联任务（${Array.isArray(dSections) ? dSections.join(' / ') : String(dSections)}）`
    )
    const dOpen = await js(
      `(() => { const b = [...document.querySelectorAll('.tk-actions .btn')].find(x => x.innerText.includes(${JSON.stringify(COPY.ticket.openApproval)})); return b ? 'ok' : 'no' })()`
    )
    ok(dOpen === 'ok', `「${COPY.ticket.openApproval}」按钮在（一期不做附件下载，跳审批页看）`)
    // 第 19 批：详情弹窗「报表统计」区块（印刷金额/绩效金额/备注三个本地输入框）
    const dMetrics = await js(
      `(() => { const m = document.querySelector('.mask .modal'); if (!m) return null; const h4 = [...m.querySelectorAll('.tk-detail h4')].map(x => x.innerText.trim()); const inputs = [...m.querySelectorAll('.tk-metric input')]; return { hasSection: h4.includes(${JSON.stringify(plain(COPY.ticket.metricsSection))}), metricCount: inputs.length, numCount: inputs.filter(i => i.type === 'number').length } })()`
    )
    ok(!!dMetrics && dMetrics.hasSection, `详情有「${COPY.ticket.metricsSection}」区块`)
    ok(!!dMetrics && dMetrics.metricCount === 3 && dMetrics.numCount === 2, `报表统计 3 个输入框（2 个金额数字 + 1 个备注，实际 ${dMetrics ? dMetrics.metricCount + '/' + dMetrics.numCount : '—'}）`)
    await shot('shot-b13-4-detail.png')
    await js(`(() => { const b = document.querySelector('.mask .modal .close'); if (b) b.click(); return 'ok' })()`)
    await wait(600)

    // (7) 第 17 批：顶栏「工单」格待指派徽标（种子 1 张未指派 → 徽标 1）
    const badge = await js(
      `(() => { const b = document.querySelector('.tabs .tab-badge'); return b ? b.innerText.trim() : '' })()`
    )
    ok(badge === '1', `顶栏待指派徽标显示存量 1（实际「${badge}」）`)

    // (8) 第 17 批：配置态有设置入口（齿轮）→ 开关默认关 → 未指派详情只读提示
    const gearBtn = await js(
      `(() => { const b = [...document.querySelectorAll('.tk-toolbar .btn')].find(x => (x.getAttribute('title')||'').includes(${JSON.stringify(COPY.ticket.settingsTitle)})); return b ? 'ok' : 'no' })()`
    )
    ok(gearBtn === 'ok', '配置态工具栏有「工单同步设置」入口（齿轮）')
    await clickChip(COPY.ticket.filterAll)
    await js(
      `(() => { const r = [...document.querySelectorAll('.tk-list .tk-row')].find(x => x.innerText.includes('202610010005')); if (r) r.click(); return r ? 'ok' : 'no-row' })()`
    )
    await wait(900)
    const assignRo = await js(
      `(() => { const a = document.querySelector('.tk-assign'); if (!a) return null; return { k: ((a.querySelector('.k')||{}).innerText||'').trim(), ro: ((a.querySelector('.tk-dim')||{}).innerText||'').trim() } })()`
    )
    ok(
      !!assignRo && assignRo.k === plain(COPY.ticket.assignSection),
      `未指派单详情出现「${COPY.ticket.assignSection}」区`
    )
    ok(
      !!assignRo && assignRo.ro.includes(COPY.ticket.assignNotAllowed.split('（')[0].slice(0, 4)),
      `开关未开 → 只读提示「等待指派」（${assignRo ? assignRo.ro : '—'}）`
    )
    await js(`(() => { const b = document.querySelector('.mask .modal .close'); if (b) b.click(); return 'ok' })()`)
    await wait(500)

    // (8b) 第 26 批（docs/31）：工具栏上的「上次同步」—— 后台自动同步**静默跑**，
    // 这块是它唯一的可见凭据。本场景自动同步关着、也没手动同步过 → 应显示「尚未同步」。
    const lastSyncEl = await js(
      `(() => { const e = document.querySelector('.tk-lastsync'); return e ? { txt: e.innerText.trim(), bad: e.classList.contains('bad') } : null })()`
    )
    ok(!!lastSyncEl, '工具栏上有「上次同步」提示')
    ok(
      !!lastSyncEl && lastSyncEl.txt === plain(COPY.ticket.lastSyncNever),
      `还没同步过时显示「${lastSyncEl && lastSyncEl.txt}」`
    )
    ok(!!lastSyncEl && !lastSyncEl.bad, '没过同步失败 → 不落在失败态（不无故报红）')

    // (9) 第 17 批：设置弹窗里开「允许在本机指派设计师」
    await js(
      `(() => { const b = [...document.querySelectorAll('.tk-toolbar .btn')].find(x => (x.getAttribute('title')||'').includes(${JSON.stringify(COPY.ticket.settingsTitle)})); if (b) b.click(); return 'ok' })()`
    )
    await wait(700)
    const swBefore = await js(`(() => { const c = document.querySelector('.tk-allowassign input'); return c ? c.checked : null })()`)
    ok(swBefore === false, '「允许在本机指派设计师」开关默认关')
    await js(`(() => { const c = document.querySelector('.tk-allowassign input'); if (c) c.click(); return 'ok' })()`)
    await wait(700)
    const swAfter = await js(`(() => { const c = document.querySelector('.tk-allowassign input'); return c ? c.checked : null })()`)
    ok(swAfter === true, '开关点开即存（meta 落库）')

    // (9a) 第 50 批（docs/35）：「缩略图」列可用性。
    // 两支互补，由环境变量 SHOT_THUMB_COL_BAD 选：
    //   默认（列可用）→ 断言**不出现**警示行（别没事也报警，狼来了就没人管了）
    //   =1（列不可用）→ 见下面 (9a-2)，断言出现且文案点明是哪一列
    // ⚠️ 布景是假 docid、从未同步成功过 → 平时 meta 无标记 = 不设防 = 当可用
    //    （与主进程「fields 拿不到就不设防」的口径一致）
    const thumbWarnAbsent = await js(
      `(() => {
         const m = [...document.querySelectorAll('.modal')].find(x => ((x.querySelector('h3')||{}).innerText||'').includes(${JSON.stringify(COPY.ticket.settingsTitle)}))
         if (!m) return 'no-modal'
         return [...m.querySelectorAll('.tk-warn')].some(x => (x.innerText||'').includes(${JSON.stringify(COPY.ticket.thumbColBad)}))
       })()`
    )
    // 「不出现」这一支只在默认（列可用）模式下断言 —— 不可用分支下它**必然**出现，
    //硬跑就是一条自相矛盾的假失败。这里是**跳过**，不是把断言改成永远通过。
    if (process.env.SHOT_THUMB_COL_BAD !== '1') {
      ok(
        thumbWarnAbsent === false,
        `列可用时不显示「缩略图列不可用」警示（实际：${thumbWarnAbsent}）`
      )
    }

    // (9a-2) 列不可用时**常驻显示**一行警示（不必等点「完成任务」才报错）
    // ⚠️ 标记由**布景期**按环境变量 SHOT_THUMB_COL_BAD 写入（见 setup 里的 setM.run）——
    //    **不能在软件已开库之后改 meta**：主进程那份连接看不到（2026-10-08 实测：
    //    写进去了、status 仍返回旧值 → 一度误判成"代码没生效"，白查一轮）。
    if (process.env.SHOT_THUMB_COL_BAD === '1') {
      await js(`(() => { const b = document.querySelector('.modal .close'); if (b) b.click(); return 'ok' })()`)
      await wait(500)
      await js(
        `(() => { const b = [...document.querySelectorAll('.tk-toolbar .btn')].find(x => (x.getAttribute('title')||'').includes(${JSON.stringify(COPY.ticket.settingsTitle)})); if (b) b.click(); return 'ok' })()`
      )
      await wait(900)
      const thumbWarn = await js(
        `(() => {
           const m = [...document.querySelectorAll('.modal')].find(x => ((x.querySelector('h3')||{}).innerText||'').includes(${JSON.stringify(COPY.ticket.settingsTitle)}))
           if (!m) return null
           const w = [...m.querySelectorAll('.tk-warn')].find(x => (x.innerText||'').includes(${JSON.stringify(COPY.ticket.thumbColBad)}))
           return w ? { text: w.innerText.trim() } : null
         })()`
      )
      ok(
        !!thumbWarn,
        `【核心】列不可用时设置弹窗里出现警示行：${thumbWarn ? thumbWarn.text : '（没出现）'}`
      )
      ok(
        !!thumbWarn && thumbWarn.text.includes('缩略图'),
        '警示文案点明是「缩略图」这一列（别让人不知道该去看哪一列）'
      )
      await shot('shot-b50-1-thumbcol-warn.png')
    }

    // (9b) 第 20 批（docs/24）：设置弹窗底部「危险操作 · 清理已禁用子表工单」
    // ⚠️ 只验形态，不真点清理 —— 真删工单不进自动测试（引擎行为由 accept 断言盖住）
    const danger = await js(
      `(() => { const d = document.querySelector('.tk-danger'); if (!d) return null; const btn = d.querySelector('.btn.danger'); return { title: ((d.querySelector('.tk-danger-title')||{}).innerText||'').trim(), hints: [...d.querySelectorAll('.tk-danger-hint')].map(x => x.innerText.trim()), btn: btn ? btn.innerText.trim() : '' } })()`
    )
    ok(
      !!danger && danger.title === plain(COPY.ticket.purgeSectionTitle),
      `设置弹窗底部有「${COPY.ticket.purgeSectionTitle}」区`
    )
    ok(
      !!danger && danger.btn === plain(COPY.ticket.purgeBtn),
      `危险操作区有「${COPY.ticket.purgeBtn}」按钮`
    )
    ok(
      !!danger && danger.hints.length >= 1 && danger.hints.some((h) => h.length > 0),
      `危险操作区有说明文案（${danger ? danger.hints.join(' / ').slice(0, 60) : '—'}）`
    )
    await shot('shot-b17-1-settings-switch.png')

    // (9d) 第 26 批（docs/31）：设置里的「自动同步」区 —— 开关默认开 + 间隔默认 30
    const autoBlock = await js(
      `(() => {
         const a = document.querySelector('.tk-autosync')
         if (!a) return null
         const cb = a.querySelector('input[type=checkbox]')
         const num = a.querySelector('input[type=number]')
         return {
           label: ((a.querySelector('.tk-check span') || {}).innerText || '').trim(),
           checked: cb ? cb.checked : null,
           intervalLabel: ((a.querySelector('.tk-label') || {}).innerText || '').trim(),
           interval: num ? num.value : '',
           hint: ((a.querySelector('.tk-autosync-hint') || {}).innerText || '').trim()
         }
       })()`
    )
    ok(!!autoBlock, '工单设置里有「自动同步」区')
    ok(
      !!autoBlock && autoBlock.label === plain(COPY.ticket.autoSyncLabel),
      `开关文案：${autoBlock && autoBlock.label}`
    )
    ok(
      !!autoBlock && autoBlock.checked === false,
      '（本场景为测试隔离显式关了自动同步）开关读到「关」'
    )
    // 点开 → 当场落库（改动即存，与「允许指派」同一模式）
    await js(
      `(() => { const c = document.querySelector('.tk-autosync input[type=checkbox]'); if (c) c.click(); return 'ok' })()`
    )
    await wait(900)
    const DatabaseSw = require('better-sqlite3')
    const dbSw = new DatabaseSw(join(s.workspaceRoot, '_system', 'media.db'), { readonly: true })
    const swRow = dbSw.prepare('SELECT value FROM meta WHERE key = ?').get('ticket_auto_sync')
    dbSw.close()
    ok(
      !!swRow && String(swRow.value) === '1',
      `点开开关后 meta 落库（ticket_auto_sync = ${swRow && swRow.value}）`
    )
    // 关回去：假 docid 下开着也不会拉到数据，但不给后续流程留脏状态
    await js(
      `(() => { const c = document.querySelector('.tk-autosync input[type=checkbox]'); if (c) c.click(); return 'ok' })()`
    )
    await wait(700)
    ok(
      !!autoBlock && autoBlock.intervalLabel === plain(COPY.ticket.autoSyncInterval),
      `间隔标签：${autoBlock && autoBlock.intervalLabel}`
    )
    ok(
      !!autoBlock && autoBlock.interval === '30',
      `间隔默认 30 分钟（实际 ${autoBlock && autoBlock.interval}）`
    )
    ok(!!autoBlock && autoBlock.hint.length > 0, '区里给了说明（关掉就只能手动点同步）')
    await shot('shot-b26-1-autosync-settings.png')

    // (9e) 第 26 批：改间隔 → 当场落库（改动即存，不走「保存」按钮）
    // ⚠️ React 的 onBlur 实际监听的是**冒泡的 focusout**；离屏窗口里 element.blur() 不产生它，
    // 所以要手动派发 focusout（真实用户点别处时浏览器会自己发，行为一致）。
    await js(`(() => {
      const num = document.querySelector('.tk-autosync input[type=number]')
      if (!num) return 'no-input'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(num, '45')
      num.dispatchEvent(new Event('input', { bubbles: true }))
      num.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      return 'ok'
    })()`)
    await wait(900)
    const DatabaseAuto = require('better-sqlite3')
    const dbAuto = new DatabaseAuto(join(s.workspaceRoot, '_system', 'media.db'), { readonly: true })
    const ivRow = dbAuto.prepare('SELECT value FROM meta WHERE key = ?').get('ticket_sync_interval_min')
    dbAuto.close()
    ok(
      !!ivRow && String(ivRow.value) === '45',
      `间隔改成 45 后落库（meta ticket_sync_interval_min = ${ivRow && ivRow.value}）`
    )
    // 复位成默认（别把后面的同步流程带歪）
    await js(`(() => {
      const num = document.querySelector('.tk-autosync input[type=number]')
      if (!num) return 'no-input'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(num, '30')
      num.dispatchEvent(new Event('input', { bubbles: true }))
      num.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      return 'ok'
    })()`)
    await wait(700)

    // (9c) 第 21 批（docs/16 §4）：设置弹窗顶部「企业微信连接」常驻入口 → 打开授权引导弹窗
    // ⚠️ 只看形态：状态徽标 / 组件来源具体是什么取决于本机，不写死；也不点「开始扫码授权」
    // （真去 auth init 会拉起真 CLI 等扫码 —— 真企微不进自动测试）
    const wecomBlock = await js(
      `(() => { const w = document.querySelector('.tk-wecom'); if (!w) return null; const btn = w.querySelector('.btn'); return { t: ((w.querySelector('.t')||{}).innerText||'').trim(), s: [...w.querySelectorAll('.s')].map(x => x.innerText.trim()).join(' '), btn: btn ? btn.innerText.trim() : '' } })()`
    )
    ok(
      !!wecomBlock && wecomBlock.t === plain(COPY.wecom.title),
      `设置弹窗顶部有「${plain(COPY.wecom.title)}」区块`
    )
    ok(
      !!wecomBlock && wecomBlock.btn === plain(COPY.wecom.openGuide),
      `区块有「${plain(COPY.wecom.openGuide)}」按钮（授权入口常驻，不依赖首次自动弹）`
    )
    // 第 54 批（docs/40 §4.3）：同一行还有「重新打开配置向导」入口（排在连接引导之后）
    const wzEntry = await js(
      `(() => { const w = document.querySelector('.tk-wecom'); if (!w) return null; return { bs: [...w.querySelectorAll('.btn')].map((b) => b.innerText.trim()) } })()`
    )
    ok(
      !!wzEntry && wzEntry.bs.includes(plain(COPY.wz.openWizard)),
      `区块还有「${plain(COPY.wz.openWizard)}」入口（第 54 批：以后想重配随时能打开）`
    )
    await js(
      `(() => { const b = document.querySelector('.tk-wecom .btn'); if (b) b.click(); return 'ok' })()`
    )
    await wait(900)
    const wcModal = await js(
      `(() => { const m = document.querySelector('.wc-modal'); if (!m) return null; return { title: ((m.querySelector('h3')||{}).innerText||'').trim(), pill: ((m.querySelector('.wc-pill')||{}).innerText||'').trim(), meta: ((m.querySelector('.wc-meta')||{}).innerText||'').trim(), intro: ((m.querySelector('.wc-intro')||{}).innerText||'').trim(), btns: [...m.querySelectorAll('.btn')].map(b => b.innerText.trim()) } })()`
    )
    ok(
      !!wcModal && wcModal.title.includes(plain(COPY.wecom.title)),
      `「${plain(COPY.wecom.title)}」引导弹窗能打开`
    )
    ok(!!wcModal && wcModal.pill.length > 0, `引导弹窗有状态徽标（${wcModal ? wcModal.pill : '—'}）`)
    ok(
      !!wcModal && wcModal.meta.length > 0,
      `引导弹窗标出「组件来源 + 版本」（${wcModal ? wcModal.meta : '—'}）`
    )
    ok(!!wcModal && wcModal.intro.length > 20, '引导弹窗有一句话说明（授权只做一次 / 换机才需重扫）')
    await shot('shot-b21-1-wecom-auth.png')
    // 关掉引导弹窗（回到设置弹窗）
    await js(
      `(() => { const m = document.querySelector('.wc-modal'); const b = m && m.querySelector('.close'); if (b) b.click(); return 'ok' })()`
    )
    await wait(600)
    const wecomClosed = await js(`!document.querySelector('.wc-modal')`)
    ok(wecomClosed === true, '关掉引导弹窗后回到工单设置（不连带关掉设置弹窗）')
    await js(`(() => { const b = document.querySelector('.mask .modal .close'); if (b) b.click(); return 'ok' })()`)
    await wait(500)

    // (10) 第 17 批：开关开了 → 未指派详情有指派下拉（候选 + 在办标注）+「在表格中打开」逃生口
    // ⚠️ 这里只验证形态，不真选人 —— 选人会走真写回（wecom-cli），真企微不进自动测试
    //（写回链路的全部行为由 accept 的 mock 适配器断言盖住，人工验收盖真表）
    await js(
      `(() => { const r = [...document.querySelectorAll('.tk-list .tk-row')].find(x => x.innerText.includes('202610010005')); if (r) r.click(); return 'ok' })()`
    )
    await wait(900)
    const assignUi = await js(
      `(() => { const a = document.querySelector('.tk-assign'); if (!a) return null; const sel = a.querySelector('select'); return { k: ((a.querySelector('.k')||{}).innerText||'').trim(), hasSelect: !!sel, options: sel ? sel.options.length : 0, optText: sel ? [...sel.options].map(o => o.innerText).join(' | ') : '' } })()`
    )
    ok(!!assignUi && assignUi.hasSelect, '开关开了 → 指派下拉出现')
    ok(
      !!assignUi && assignUi.options === 3,
      `候选池 2 人 + 1 占位项（实际 ${assignUi ? assignUi.options : 0}：${assignUi ? assignUi.optText : '—'}）`
    )
    ok(
      !!assignUi && assignUi.optText.includes(COPY.ticket.assignBusyLabel.split('{n}')[0]),
      '候选项带「在办 N 单」标注（辅助判断谁有空，不替人派）'
    )
    // 第 21 批（用户实测）：下拉原来没设背景 → 落到浏览器默认浅色控件（白底黑字），与深色界面割裂
    const selStyle = await js(
      `(() => { const s = document.querySelector('.tk-assign select'); if (!s) return null; const cs = getComputedStyle(s); return { bg: cs.backgroundColor, color: cs.color, scheme: cs.colorScheme } })()`
    )
    ok(
      !!selStyle && selStyle.bg === 'rgb(35, 35, 35)',
      `指派下拉闭合态用深色面板色（实际 ${selStyle ? selStyle.bg : '—'}）`
    )
    ok(
      !!selStyle && selStyle.scheme === 'dark',
      `下拉设了 color-scheme:dark —— 展开的列表跟着深色走，不再是白底（实际 ${selStyle ? selStyle.scheme : '—'}）`
    )
    const openTableBtn = await js(
      `(() => { const b = [...document.querySelectorAll('.tk-actions .btn')].find(x => x.innerText.includes(${JSON.stringify(COPY.ticket.openTable)})); return b ? 'ok' : 'no' })()`
    )
    ok(openTableBtn === 'ok', `「${COPY.ticket.openTable}」逃生口在（写回失败时退回手工改表）`)
    await shot('shot-b17-2-assign.png')
    await js(`(() => { const b = document.querySelector('.mask .modal .close'); if (b) b.click(); return 'ok' })()`)
    await wait(500)

    // (11) 第 18 批（docs/20 §7）：多人协作单详情 —— 设计师字段全量姓名 + 两个已选标签 + 各自带移除按钮
    await clickChip(COPY.ticket.filterAll)
    await js(
      `(() => { const r = [...document.querySelectorAll('.tk-list .tk-row')].find(x => x.innerText.includes('202610010010')); if (r) r.click(); return r ? 'ok' : 'no-row' })()`
    )
    await wait(900)
    const multiTags = await js(
      `[...document.querySelectorAll('.tk-assign-tag')].map(x => x.innerText.trim())`
    )
    ok(
      Array.isArray(multiTags) && multiTags.length === 2,
      `多人协作单详情 2 个已选设计师标签（${Array.isArray(multiTags) ? multiTags.join(' / ') : '—'}）`
    )
    const multiX = await js(`document.querySelectorAll('.tk-assign-x').length`)
    ok(multiX === 2, `两名设计师各带移除按钮 ×（实际 ${multiX}）`)
    const multiField = await js(
      `(() => { const f = [...document.querySelectorAll('.tk-field')].find(x => (x.querySelector('.k')||{}).innerText === '设计师'); return f ? (f.querySelector('.v')||{}).innerText || '' : '' })()`
    )
    ok(
      multiField.includes('测试设计师') && multiField.includes('别的同事'),
      `设计师字段显示全量姓名（${multiField}）`
    )
    await shot('shot-b18-1-multi.png')

    // (11b) 第 18 批：提交按钮形态 —— 无未提交改动不出现，点 × 改草稿后才出现（只验形态，不点提交以免真写回企微）
    const submitBefore = await js(`!!document.querySelector('.tk-assign-submit')`)
    ok(submitBefore === false, '无未提交改动时不显示「提交指派」按钮')
    await js(`(() => { const x = document.querySelector('.tk-assign-x'); if (x) x.click(); return 'ok' })()`)
    await wait(400)
    const submitAfter = await js(
      `(() => { const b = document.querySelector('.tk-assign-submit'); return b ? b.innerText.trim() : null })()`
    )
    ok(
      submitAfter === plain(COPY.ticket.assignSubmit),
      `点 × 移除一人后出现「${plain(COPY.ticket.assignSubmit)}」按钮（${submitAfter}）`
    )
    const dirtyHint = await js(
      `(() => { const a = document.querySelector('.tk-assign'); return a ? a.innerText.includes(${JSON.stringify(plain(COPY.ticket.assignDirty))}) : false })()`
    )
    ok(dirtyHint === true, `草稿有改动时显示「${plain(COPY.ticket.assignDirty)}」提示`)
    const tagAfterX = await js(`document.querySelectorAll('.tk-assign-tag').length`)
    ok(tagAfterX === 1, `移除后剩 1 个标签、最后一人不可再移除（实际 ${tagAfterX} 个）`)
    await shot('shot-b18-2-submit.png')

    await js(`(() => { const b = document.querySelector('.mask .modal .close'); if (b) b.click(); return 'ok' })()`)
    await wait(500)
  } else if (SCEN === 'export') {
    // ============================================================
    // 第 16 批：M5 交付打包（包详情 → 打包交付 → 生成 zip）
    // ============================================================
    const exportPackName = '海南招生海报-导出测试'

    // (1) 点击任务卡片打开详情弹窗
    const clickedCard = await js(`(() => {
      const cards = [...document.querySelectorAll('.grid .pack-card')]
      const c = cards.find(el => ((el.querySelector('.name') || {}).innerText || '').includes(${JSON.stringify(exportPackName)}))
      if (!c) return 'no-card'
      c.click(); return 'ok'
    })()`)
    ok(clickedCard === 'ok', '找到并点击「' + exportPackName + '」任务卡片')
    await wait(900)

    // (1b) 第 54 批（docs/39）：详情顶部按钮组里多了「快捷方式」（桌面 + 开始菜单）
    // ⚠️ 只验形态、**不真点** —— 真点会在用户真实桌面 / 开始菜单留下 .lnk（方案 D8）
    const shtBtn = await js(`(() => {
      const bs = [...document.querySelectorAll('.modal .btn')]
      const b = bs.find((x) => x.innerText.trim() === ${JSON.stringify(COPY.sht.btn)})
      if (!b) return null
      return {
        t: b.innerText.trim(),
        tip: (b.getAttribute('title') || '').trim(),
        btns: bs.map((x) => x.innerText.trim())
      }
    })()`)
    ok(!!shtBtn, `【第 54 批】任务详情里有「${plain(COPY.sht.btn)}」按钮`)
    ok(
      !!shtBtn && shtBtn.tip === plain(COPY.sht.btnTip),
      `按钮提示写明落点（桌面 + 开始菜单）：${shtBtn ? shtBtn.tip : '—'}`
    )
    ok(
      !!shtBtn &&
        shtBtn.btns.indexOf(plain(COPY.sht.btn)) >
          shtBtn.btns.indexOf(plain(COPY.common.openFolder)),
      '它排在「打开文件夹」之后（两者指向同一个任务文件夹）'
    )
    await shot('shot-b54-8-packdetail-shortcut-btn.png')

    // (2) 详情弹窗里有「打包交付」按钮并点击
    const exportBtn = await js(`(() => {
      const b = [...document.querySelectorAll('.modal .btn')]
        .find(x => x.innerText.trim() === ${JSON.stringify(COPY.exportPack.btn)})
      if (!b) return 'no-btn'
      b.click(); return 'ok'
    })()`)
    ok(exportBtn === 'ok', '详情弹窗里出现并点击「' + COPY.exportPack.btn + '」')
    await wait(800)

    // (3) 导出弹窗出现，标题正确
    const modalTitle = await js(
      `(() => { const m = document.querySelector('.pack-export-modal'); return m ? ((m.querySelector('h3') || {}).innerText || '').trim() : '' })()`
    )
    ok(modalTitle.includes(plain(COPY.exportPack.title).replace('{name}', '').trim()), '导出弹窗标题正确（' + modalTitle + '）')
    await wait(600) // 等文件结构预览（防抖 300ms）回来再截图（第 32 批）
    await shot('shot-b32-export-modal.png')
    // 滚到 content 底部：占位符按钮、输出位置、文件结构预览都在下半段（第 32 批）
    await js(`(() => { const c = document.querySelector('.pack-export-modal .content'); if (c) c.scrollTop = c.scrollHeight; return 'ok' })()`)
    await wait(300)
    await shot('shot-b32-export-preview.png')

    // (4) 默认输出位置就是任务文件夹
    const outputPath = await js(
      `(() => { const el = document.querySelector('.pack-export-modal input.ep-path'); return el ? el.value : '' })()`
    )
    ok(outputPath.includes(exportPackName), '默认输出位置是任务文件夹（' + outputPath + '）')

    // (5) 默认 zip 名包含项目名与任务名
    const zipNameVal = await js(
      `(() => { const inputs = document.querySelectorAll('.pack-export-modal .ep-output input[type=text]'); return inputs[0] ? inputs[0].value : '' })()`
    )
    ok(zipNameVal.includes('海南升学集训营') && zipNameVal.includes(exportPackName), '默认 zip 名含项目名与任务名（' + zipNameVal + '）')

    // (6) 默认勾选三组，未归属不勾
    const groupChecks = await js(`(() => {
      const out = {}
      document.querySelectorAll('.pack-export-modal .ep-check').forEach(lab => {
        const txt = lab.innerText.trim()
        const inp = lab.querySelector('input[type=checkbox]')
        if (inp && (txt.includes('成品') || txt.includes('素材') || txt.includes('工程') || txt.includes('未归属'))) {
          out[txt.split('(')[0].trim()] = inp.checked
        }
      })
      return out
    })()`)
    ok(
      groupChecks &&
        groupChecks[COPY.exportPack.groupDone] === true &&
        groupChecks[COPY.exportPack.groupMaterial] === true &&
        groupChecks[COPY.exportPack.groupProject] === true,
      '默认勾选成品/素材/工程：' + JSON.stringify(groupChecks)
    )
    ok(
      !groupChecks || groupChecks[COPY.exportPack.groupUnassigned] !== true,
      '默认不勾选未归属：' + JSON.stringify(groupChecks)
    )

    // (7) 点击「开始打包」
    const startBtn = await js(`(() => {
      const b = [...document.querySelectorAll('.pack-export-modal .foot .btn')]
        .find(x => x.innerText.trim() === ${JSON.stringify(COPY.exportPack.start)})
      if (!b) return 'no-btn'
      b.click(); return 'ok'
    })()`)
    ok(startBtn === 'ok', '点击「' + COPY.exportPack.start + '」')

    // 等打包完成（zip 约 600KB，通常 1 秒内完成）
    let done = false
    for (let i = 0; i < 30; i++) {
      done = await js(`!document.querySelector('.pack-export-modal')`)
      if (done) break
      await wait(500)
    }
    ok(done, '导出弹窗已关闭')

    // (8) 成功 toast 出现
    let toastOk = false
    for (let i = 0; i < 20; i++) {
      toastOk = await js(
        `(() => {
          const t = [...document.querySelectorAll('.toast')].find(el => el.classList.contains('ok'))
          return t ? t.innerText.includes(${JSON.stringify(plain(COPY.exportPack.done).split('{path}')[0].trim())}) : false
        })()`
      )
      if (toastOk) break
      await wait(300)
    }
    ok(toastOk, '出现成功 toast')

    // (9) 磁盘上真的生成了 zip 且非空
    const zipFiles = require('fs').readdirSync(outputPath).filter((f) => f.endsWith('.zip'))
    ok(zipFiles.length > 0, '任务文件夹下生成了 zip：' + zipFiles.join(' | '))
    const zipPath = join(outputPath, zipFiles[0])
    const zipStat = require('fs').statSync(zipPath)
    ok(zipStat.size > 1000, '生成的 zip 非空（' + Math.round(zipStat.size / 1024) + ' KB）')

    await shot('shot-b16-1-export-done.png')
  } else if (SCEN === 'backup') {
    // ============================================================
    // 第 58 批（docs/43）：任务备份打包
    //   工具条「新建任务」右边「备份打包」→ 卡片进多选 → 勾任务 → 批量打包
    //   → 系统选目录 → 每任务各打一个 zip → 卡片置灰 + 「已备份」徽标 → 详情信息条
    // ============================================================
    const BKOUT = join(BASE, 'shot_bkout')
    rmSync(BKOUT, { recursive: true, force: true })

    // ⚠️【关键】把系统「选择文件夹」对话框换成固定返回值。
    //   否则真点「批量打包」会弹出原生模态框把场景卡死在无人点击上。
    //   换的是同一个 dialog 对象上的方法 —— ipc.cjs 里 `dialog.showOpenDialog(...)`
    //   访问的就是这个属性，所以能拦住。
    const { dialog } = require('electron')
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [BKOUT] })
    say('stub dialog.showOpenDialog → ' + BKOUT)

    const P1 = '海南招生海报'
    const P2 = '抖音短视频封面'
    // 主按钮文案随勾选数变（批量打包（0）→（2）），只用前缀定位，别把数字写死进选择器
    const batchPrefix = plain(COPY.backup.doBatch).split('（')[0]

    // ---- (1) 工具条上有「备份打包」按钮，且排在「新建任务」右边 ----
    const tb = await js(`(() => {
      const bs = [...document.querySelectorAll('.topbar .btn')]
      const texts = bs.map(b => b.innerText.trim())
      const iNew = texts.findIndex(t => t.includes(${JSON.stringify(plain(COPY.top.newPack))}))
      const iBk  = texts.findIndex(t => t.includes(${JSON.stringify(plain(COPY.backup.enter))}))
      const bk = bs[iBk] || null
      return { texts, iNew, iBk, tip: bk ? (bk.getAttribute('title') || '').trim() : '' }
    })()`)
    ok(tb && tb.iBk >= 0, `工具条出现「${plain(COPY.backup.enter)}」按钮`)
    ok(tb && tb.iNew >= 0 && tb.iBk > tb.iNew, '它排在「新建任务」右边（iNew=' + (tb ? tb.iNew : '?') + ' → iBk=' + (tb ? tb.iBk : '?') + '）')
    ok(!!tb && tb.tip === plain(COPY.backup.enterTip), '按钮提示点明与「打包交付」无关：' + (tb ? tb.tip : '—'))
    await shot('shot-b58-1-backup-entry.png')

    // ---- (2) 点它 → 进多选模式：主按钮变「批量打包（0）」+ 旁边冒「取消」+ 顶部提示条 ----
    const enterClicked = await js(`(() => {
      const b = [...document.querySelectorAll('.topbar .btn')]
        .find(x => x.innerText.includes(${JSON.stringify(plain(COPY.backup.enter))}))
      if (!b) return 'no-btn'
      b.click(); return 'ok'
    })()`)
    ok(enterClicked === 'ok', '点击「' + plain(COPY.backup.enter) + '」进入多选模式')
    await wait(500)

    const modeUi = await js(`(() => {
      const bs = [...document.querySelectorAll('.topbar .btn')]
      const texts = bs.map(b => b.innerText.trim())
      const batch = bs.find(b => b.innerText.includes(${JSON.stringify(batchPrefix)}))
      const cancel = bs.find(b => b.innerText.trim() === ${JSON.stringify(plain(COPY.common.cancel))})
      const bar = document.querySelector('.backup-bar')
      return {
        texts,
        batchText: batch ? batch.innerText.trim() : '',
        batchDisabled: batch ? batch.disabled : null,
        hasCancel: !!cancel,
        barText: bar ? bar.innerText.trim() : '',
        barBtns: bar ? [...bar.querySelectorAll('.btn')].map(b => b.innerText.trim()) : [],
        selectableCount: document.querySelectorAll('.pack-card.selectable').length
      }
    })()`)
    ok(
      modeUi && modeUi.batchText === fmt(COPY.backup.doBatch, { n: 0 }),
      `主按钮变「${fmt(COPY.backup.doBatch, { n: 0 })}」：${modeUi ? modeUi.batchText : '—'}`
    )
    ok(!!modeUi && modeUi.batchDisabled === true, '一个都没勾时「批量打包」是禁用的')
    ok(!!modeUi && modeUi.hasCancel, '旁边多出「' + plain(COPY.common.cancel) + '」')
    ok(!!modeUi && modeUi.barText.includes(plain(COPY.backup.selectHint)), '顶部出现提示条：' + (modeUi ? modeUi.barText.split('\n')[0] : '—'))
    ok(
      !!modeUi && modeUi.barBtns.includes(plain(COPY.backup.selectAll)) && modeUi.barBtns.includes(plain(COPY.backup.selectNone)),
      '提示条里有「全选 / 取消全选」：' + (modeUi ? modeUi.barBtns.join(' | ') : '—')
    )
    ok(!!modeUi && modeUi.selectableCount === 2, '两张卡片都进了多选态（selectable=' + (modeUi ? modeUi.selectableCount : '?') + '）')
    await shot('shot-b58-2-backup-mode.png')

    // ---- (3) 勾两张卡：勾选指示点亮、按钮计数变 2 ----
    const pickCards = await js(`(() => {
      const cards = [...document.querySelectorAll('.grid .pack-card')]
      let n = 0
      for (const c of cards) { c.click(); n += 1 }
      return n
    })()`)
    ok(pickCards === 2, '点了两张卡片（' + pickCards + '）')
    await wait(400)

    const selUi = await js(`(() => {
      const bs = [...document.querySelectorAll('.topbar .btn')]
      const batch = bs.find(b => b.innerText.includes(${JSON.stringify(batchPrefix)}))
      return {
        batchText: batch ? batch.innerText.trim() : '',
        batchDisabled: batch ? batch.disabled : null,
        cbOn: document.querySelectorAll('.grid .pack-card .pick-cb.on').length,
        selCount: document.querySelectorAll('.grid .pack-card.selected').length,
        detailBtns: document.querySelectorAll('.grid .pack-card.selectable .pact.detail').length
      }
    })()`)
    ok(!!selUi && selUi.cbOn === 2, '两张卡的勾选指示点亮（pick-cb.on=' + (selUi ? selUi.cbOn : '?') + '）')
    ok(!!selUi && selUi.selCount === 2, '两张卡带 selected 高亮（selected=' + (selUi ? selUi.selCount : '?') + '）')
    ok(!!selUi && selUi.batchText === fmt(COPY.backup.doBatch, { n: 2 }), `按钮计数变「${fmt(COPY.backup.doBatch, { n: 2 })}」：` + (selUi ? selUi.batchText : '—'))
    ok(!!selUi && selUi.batchDisabled === false, '勾了任务后「批量打包」可点')
    ok(!!selUi && selUi.detailBtns === 2, '多选态下每张卡有独立「查看详情」眼睛按钮（' + (selUi ? selUi.detailBtns : '?') + '）')
    await shot('shot-b58-3-backup-selected.png')

    // ---- (3b) 全选 / 取消全选 ----
    await clickByText('.backup-bar .btn', plain(COPY.backup.selectAll))
    await wait(300)
    const allOn = await js(`document.querySelectorAll('.grid .pack-card .pick-cb.on').length`)
    ok(allOn === 2, '点「全选」后两张都勾上（' + allOn + '）')
    await clickByText('.backup-bar .btn', plain(COPY.backup.selectNone))
    await wait(300)
    const noneOn = await js(`document.querySelectorAll('.grid .pack-card .pick-cb.on').length`)
    ok(noneOn === 0, '点「取消全选」后一张不剩（' + noneOn + '）')

    // 重新勾上两张，准备真打包
    await js(`(() => { document.querySelectorAll('.grid .pack-card').forEach(c => c.click()); return 'ok' })()`)
    await wait(400)
    const reselected = await js(`document.querySelectorAll('.grid .pack-card .pick-cb.on').length`)
    ok(reselected === 2, '重新勾上两张（' + reselected + '）')

    // ---- (4) 点「批量打包」→ 真跑主进程打包（选目录已被 stub 成固定路径）----
    const batchClicked = await js(`(() => {
      const b = [...document.querySelectorAll('.topbar .btn')]
        .find(x => x.innerText.includes(${JSON.stringify(batchPrefix)}))
      if (!b) return 'no-btn'
      b.click(); return 'ok'
    })()`)
    ok(batchClicked === 'ok', '点击「' + plain(COPY.backup.doBatch).replace('（{n}）', '') + '」')

    // 等打包完成：多选模式自动退出 = 「备份打包」按钮回来 + 提示条消失
    let left = false
    for (let i = 0; i < 60; i++) {
      left = await js(`(() => {
        const bs = [...document.querySelectorAll('.topbar .btn')]
        const hasEnter = bs.some(b => b.innerText.includes(${JSON.stringify(plain(COPY.backup.enter))}))
        return hasEnter && !document.querySelector('.backup-bar')
      })()`)
      if (left === true) break
      await wait(500)
    }
    ok(left === true, '打包完成后自动退出多选模式')

    // ---- (5) 成功 toast ----
    let toastOk = false
    for (let i = 0; i < 20; i++) {
      toastOk = await js(`(() => {
        const t = [...document.querySelectorAll('.toast')].find(el => el.classList.contains('ok'))
        if (!t) return false
        return t.innerText.includes(${JSON.stringify(plain(COPY.backup.done).split('{n}')[0].trim())}) &&
               t.innerText.includes(${JSON.stringify(BKOUT)})
      })()`)
      if (toastOk) break
      await wait(300)
    }
    ok(toastOk, '出现「已备份 N 个任务」成功 toast')

    // ---- (6) 磁盘上真的按「项目 / 标识-任务名-backup.zip」落了两个包 ----
    const projDir = join(BKOUT, '海南升学集训营')
    const zips = existsSync(projDir) ? require('fs').readdirSync(projDir).filter((f) => f.endsWith('.zip')) : []
    ok(zips.length === 2, '输出目录下「项目名」子目录里有 2 个 zip：' + zips.join(' | '))
    ok(zips.every((z) => z.includes(P1) || z.includes(P2)), 'zip 名带任务名')
    ok(zips.every((z) => z.endsWith('-backup.zip')), 'zip 名带 -backup 后缀')
    ok(zips.every((z) => /^T\d{4}-/.test(z)), '自建任务 zip 名以「T+4位编号」打头：' + zips.join(' | '))
    ok(
      zips.every((z) => require('fs').statSync(join(projDir, z)).size > 1000),
      '生成的 zip 都非空'
    )

    // 备份清单.csv —— UTF-8 带 BOM（否则 Excel 打开中文乱码）
    const mf = join(BKOUT, plain(COPY.backup.manifestName))
    const mfRaw = existsSync(mf) ? require('fs').readFileSync(mf, 'utf-8') : ''
    ok(mfRaw.charCodeAt(0) === 0xfeff, '输出目录根上有「' + plain(COPY.backup.manifestName) + '」且以 BOM 开头')
    ok(mfRaw.includes(P1) && mfRaw.includes(P2), '清单里记了两个任务名')

    // ---- (7) 卡片置灰 + 「已备份」徽标 ----
    const cardUi = await js(`(() => {
      const cards = [...document.querySelectorAll('.grid .pack-card')]
      return {
        backedUp: cards.filter(c => c.classList.contains('backed-up')).length,
        chips: cards.filter(c => c.querySelector('.backup-chip')).length,
        chipText: (() => { const c = document.querySelector('.grid .pack-card .backup-chip'); return c ? c.innerText.trim() : '' })(),
        selectableLeft: document.querySelectorAll('.grid .pack-card.selectable').length
      }
    })()`)
    ok(!!cardUi && cardUi.backedUp === 2, '两张卡都置灰（backed-up=' + (cardUi ? cardUi.backedUp : '?') + '）')
    ok(!!cardUi && cardUi.chips === 2, '两张卡都有「已备份」徽标（' + (cardUi ? cardUi.chipText : '—') + '）')
    ok(!!cardUi && cardUi.selectableLeft === 0, '已退出多选态（selectable=' + (cardUi ? cardUi.selectableLeft : '?') + '）')
    await shot('shot-b58-4-backup-cards.png')

    // ---- (8) 打开详情 → 顶部「已备份」信息条 ----
    const openDetail = await js(`(() => {
      const c = [...document.querySelectorAll('.grid .pack-card')]
        .find(el => ((el.querySelector('.name') || {}).innerText || '').includes(${JSON.stringify(P1)}))
      if (!c) return 'no-card'
      c.click(); return 'ok'
    })()`)
    ok(openDetail === 'ok', '打开「' + P1 + '」任务详情')
    await wait(900)

    const infoUi = await js(`(() => {
      const bar = document.querySelector('.modal .backup-info')
      if (!bar) return null
      return {
        text: bar.innerText.trim(),
        hasOpenBtn: !!bar.querySelector('.btn')
      }
    })()`)
    ok(!!infoUi, '详情里有「已备份」信息条')
    ok(!!infoUi && infoUi.text.includes('.zip'), '信息条里点明从哪个 zip 取回：' + (infoUi ? infoUi.text.split('\n').join(' ') : '—'))
    ok(!!infoUi && infoUi.hasOpenBtn === true, 'zip 还在磁盘上 → 有「打开所在文件夹」按钮')
    await shot('shot-b58-5-backup-detail.png')

    // 关掉详情弹窗，别影响收尾截图
    await js(`(() => { const m = document.querySelector('.modal .foot .btn, .modal .close'); if (m) m.click(); return 'ok' })()`)
    await wait(400)
  } else if (SCEN === 'unassigned') {
    // ============================================================
    // 第 25 批：未归属池入口 —— 用户报的 bug
    //   现象：任务视图里那张虚线「未归属」卡片，点开弹窗一直「加载中」，关掉再点还是一样
    //   根因：它点开的是「任务详情」弹窗（PackDetailModal），而那个组件收到 packId='unassigned'
    //         时**连数据都不加载**（`if (packId !== 'unassigned') load()`），组件里也从来没有
    //         未归属的渲染分支 —— 第 1 批留下的半成品：所有内容都挂在 `detail &&` 下，
    //         于是 detail 永远为 null → 弹窗只剩标题「加载中…」永远转圈。
    //   修法：卡片点击改成跟左栏「未归属」按钮同一个去处（文件视图 + 未归属筛选），
    //         在那里勾选文件 → 认领栏出现 → 选目标任务 + 子文件夹 → 认领。
    // ============================================================
    await wait(1200)

    // (1) 任务视图里，虚线「未归属」卡片在，而且它不是任务
    const grid = await js(`(() => {
      const cards = [...document.querySelectorAll('.grid .pack-card')]
      const un = cards.find((c) => c.classList.contains('unassigned'))
      return {
        nCards: cards.length,
        hasUn: !!un,
        name: un ? ((un.querySelector('.name') || {}).innerText || '').trim() : '',
        sub: un ? ((un.querySelector('.sub') || {}).innerText || '').replace(/\\s+/g, ' ').trim() : '',
        tag: un ? ((un.querySelector('.tags .tag') || {}).innerText || '').trim() : ''
      }
    })()`)
    ok(grid.hasUn, `【布景】任务视图里有虚线「未归属」卡片（网格共 ${grid.nCards} 张卡）`)
    ok(
      grid.name === COPY.side.unassigned,
      `卡片名 = 「${grid.name}」—— 它不是任务，是未归属池入口`
    )
    ok(grid.sub.includes('1'), `卡片标出池里现有 1 个文件：${grid.sub}`)
    ok(grid.tag === COPY.card.pending, `卡片上的橙色标签是「${grid.tag}」`)
    await shot('shot-b25-1-unassigned-card.png')

    // (2) 【核心】点它 → 必须跳到文件视图 + 未归属筛选；绝不能弹出那个一直转圈的详情弹窗
    const clicked = await js(`(() => {
      const c = [...document.querySelectorAll('.grid .pack-card')]
        .find((x) => x.classList.contains('unassigned'))
      if (!c) return 'no-card'
      c.click(); return 'ok'
    })()`)
    ok(clicked === 'ok', '点击「未归属」卡片')
    await wait(1400)

    const after = await js(`(() => {
      const modal = document.querySelector('.mask .modal')
      const onUn = [...document.querySelectorAll('.side .item')].some(
        (b) =>
          b.classList.contains('on') &&
          (b.innerText || '').includes(${JSON.stringify(COPY.side.unassigned)})
      )
      return {
        modalOpen: !!modal,
        modalTitle: modal ? ((modal.querySelector('h3') || {}).innerText || '').replace(/\\s+/g, ' ').trim() : '',
        rows: document.querySelectorAll('.main-scroll .file-row').length,
        onUn
      }
    })()`)
    ok(
      !after.modalOpen,
      `【核心】不再弹出那个永远「加载中」的详情弹窗（修前必现：弹窗打开、标题=${after.modalTitle}）`
    )
    ok(after.onUn, '跳到了文件视图，左栏「未归属」筛选已点亮')
    ok(after.rows === 1, `列出池里的 1 个散文件：实际 ${after.rows} 条`)
    await shot('shot-b25-2-unassigned-jumped.png')

    // (3) 勾选它 → 认领栏出现（目标任务 + 子文件夹两个下拉）→ 说明这条路真能把散文件收编进任务
    const checked = await js(`(() => {
      const cb = document.querySelector('.main-scroll .file-row input.cb')
      if (!cb) return 'no-cb'
      cb.click(); return 'ok'
    })()`)
    ok(checked === 'ok', '勾选这个未归属文件')
    await wait(700)
    const claim = await js(`(() => {
      const bar = document.querySelector('.claimbar')
      if (!bar) return null
      const sels = bar.querySelectorAll('select')
      return {
        txt: ((bar.querySelector('.txt') || {}).innerText || '').trim(),
        nSelect: sels.length,
        packOpts: sels[0] ? sels[0].querySelectorAll('option').length : 0
      }
    })()`)
    ok(!!claim, '勾选后出现认领栏（能把散文件认领进任务）')
    ok(
      !!claim && claim.nSelect === 2,
      `认领栏有「目标任务」+「子文件夹」两个下拉（实际 ${claim && claim.nSelect} 个）`
    )
    ok(
      !!claim && claim.packOpts >= 2,
      `目标任务下拉里能选到任务（${claim && claim.packOpts} 项，含一个占位项）`
    )
    await shot('shot-b25-3-claim-bar.png')
  } else if (SCEN === 'wizard') {
    // ============================================================
    // 第 54 批（docs/40）：首次配置引导（初装向导）
    //   六步：欢迎 → 工作区 → 企业微信 → 工单表 → 报表表 → 完成
    //   触发判据 = **库是不是本次新建的**（本场景布景故意不建库）+ 没走过向导
    //   「完成」/「我以后再说」→ 写 setup_wizard_done；直接关掉 → 不写
    // ============================================================
    await wait(1600)

    // (1) 【核心】全新库启动 → 向导自动弹出
    const w0 = await js(`(() => {
      const m = document.querySelector('.wz-modal')
      if (!m) return null
      return {
        title: ((m.querySelector('h3') || {}).innerText || '').replace(/\\s+/g, ' ').trim(),
        step: ((m.querySelector('.wz-stepbar') || {}).innerText || '').trim(),
        name: ((m.querySelector('.wz-name') || {}).innerText || '').trim(),
        h: ((m.querySelector('.wz-title') || {}).innerText || '').trim(),
        btns: [...m.querySelectorAll('.btn')].map((b) => b.innerText.trim())
      }
    })()`)
    ok(!!w0, '【核心】全新库启动 → 首次配置引导自动弹出（库本次新建 + 没走过向导）')
    ok(!!w0 && w0.title.includes(plain(COPY.wz.title)), `弹窗标题 = 「${w0 ? w0.title : '—'}」`)
    ok(
      !!w0 && w0.step === plain(fmt(COPY.wz.stepOf, { n: 1, m: 6 })),
      `步骤指示：${w0 ? w0.step : '—'}`
    )
    ok(!!w0 && w0.h === plain(COPY.wz.s0Title), `欢迎页大标题：${w0 ? w0.h : '—'}`)
    ok(
      !!w0 && w0.btns.includes(plain(COPY.wz.start)) && w0.btns.includes(plain(COPY.wz.later)),
      `首步按钮：${w0 ? w0.btns.join(' / ') : '—'}`
    )
    ok(
      !!w0 && !w0.btns.includes(plain(COPY.wz.skip)) && !w0.btns.includes(plain(COPY.wz.prev)),
      '首步没有「跳过」也没有「上一步」'
    )
    if (!w0) {
      // 后面全靠这个弹窗往下走，没弹出来就别接着点（那只会得到一串 no-el 假失败）
      ok(false, '向导没弹出 —— 后续步骤跳过（先修触发判定）')
    } else {
      await shot('shot-b54-1-wizard-welcome.png')

      // (2) 点「开始配置」→ S1 工作区（显示软件已自动选好的位置 + 允许改）
      await clickByText('.wz-modal .btn', COPY.wz.start)
      await wait(700)
      const w1 = await js(`(() => {
        const m = document.querySelector('.wz-modal')
        if (!m) return null
        return {
          h: ((m.querySelector('.wz-title') || {}).innerText || '').trim(),
          path: ((m.querySelector('.wz-path code') || {}).innerText || '').trim(),
          change: ((m.querySelector('.wz-path .btn') || {}).innerText || '').trim()
        }
      })()`)
      ok(!!w1 && w1.h === plain(COPY.wz.s1Title), `第 2 步是「工作区」（${w1 ? w1.h : '—'}）`)
      ok(
        !!w1 && w1.path.toLowerCase().includes('shot_wswz'),
        `显示软件已经自动选好的位置：${w1 ? w1.path : '—'}`
      )
      ok(
        !!w1 && w1.change === plain(COPY.wz.s1Change),
        '工作区那步有「更改位置」（不破坏"绝不偷偷换位置"）'
      )
      await shot('shot-b54-2-wizard-workspace.png')

      // (3) 下一步 → S2 企业微信（扫码面板与工单设置里是同一个组件）
      await clickByText('.wz-modal .btn', COPY.wz.next)
      await wait(1300)
      const w2 = await js(`(() => {
        const m = document.querySelector('.wz-modal')
        if (!m) return null
        return {
          h: ((m.querySelector('.wz-title') || {}).innerText || '').trim(),
          pill: ((m.querySelector('.wc-pill') || {}).innerText || '').trim(),
          intro: ((m.querySelector('.wc-intro') || {}).innerText || '').trim(),
          btns: [...m.querySelectorAll('.btn')].map((b) => b.innerText.trim())
        }
      })()`)
      ok(!!w2 && w2.h === plain(COPY.wz.s2Title), `第 3 步是「连接企业微信」（${w2 ? w2.h : '—'}）`)
      ok(!!w2 && w2.pill.length > 0, `扫码面板有状态徽标（${w2 ? w2.pill : '—'}）`)
      ok(!!w2 && w2.intro.length > 20, '面板有一句话说明（授权只做一次 / 换机才需重扫）')
      ok(
        !!w2 &&
          w2.btns.includes(plain(COPY.wz.skip)) &&
          w2.btns.includes(plain(COPY.wz.prev)) &&
          w2.btns.includes(plain(COPY.wz.next)),
        `中间步骤的三个按钮都在：${w2 ? w2.btns.join(' / ') : '—'}`
      )
      // ⚠️ 不点「开始扫码授权」—— 那会拉起真 CLI 等扫码（真企微不进自动测试）
      await shot('shot-b54-3-wizard-wecom.png')

      // (4) 跳过 → S3 工单表：向导里只放一个按钮，把已有的设置弹窗打开
      await clickByText('.wz-modal .btn', COPY.wz.skip)
      await wait(700)
      const w3 = await js(`(() => {
        const m = document.querySelector('.wz-modal')
        if (!m) return null
        return {
          h: ((m.querySelector('.wz-title') || {}).innerText || '').trim(),
          open: ((m.querySelector('.wz-body > .btn') || {}).innerText || '').trim()
        }
      })()`)
      ok(!!w3 && w3.h === plain(COPY.wz.s3Title), `第 4 步是「配置工单表」（${w3 ? w3.h : '—'}）`)
      ok(
        !!w3 && w3.open === plain(COPY.wz.s3Open),
        `有「${w3 ? w3.open : '—'}」按钮（复用已有的设置弹窗，不重造一套）`
      )

      // (5) 点它 → 工单同步设置真的开在向导之上；关掉后回到向导
      await js(`(() => {
        const m = document.querySelector('.wz-modal')
        const b =
          m &&
          [...m.querySelectorAll('.btn')].find(
            (x) => x.innerText.trim() === ${JSON.stringify(plain(COPY.wz.s3Open))}
          )
        if (b) b.click()
        return 'ok'
      })()`)
      await wait(1300)
      const nested = await js(`!document.querySelector('.tk-settings')`)
      ok(nested === false, '向导里点「打开工单同步设置」→ 工单设置弹窗真的开在向导之上')
      await shot('shot-b54-4-wizard-ticket-settings.png')
      await js(`(() => {
        const st = document.querySelector('.tk-settings')
        const modal = st && st.closest('.modal')
        const c = modal && modal.querySelector('.close')
        if (c) c.click()
        return 'ok'
      })()`)
      await wait(900)
      const backToWizard = await js(
        `(() => ({ wizard: !!document.querySelector('.wz-modal'), settings: !!document.querySelector('.tk-settings') }))()`
      )
      ok(
        backToWizard.wizard === true && backToWizard.settings === false,
        '关掉设置弹窗后回到向导（向导没被连带关掉）'
      )

      // (6) 下一步 → S4 报表表：内联一个链接框；填个不像链接的 → 如实报错
      await clickByText('.wz-modal .btn', COPY.wz.next)
      await wait(700)
      const w4 = await js(`(() => {
        const m = document.querySelector('.wz-modal')
        if (!m) return null
        return {
          h: ((m.querySelector('.wz-title') || {}).innerText || '').trim(),
          hasInput: !!m.querySelector('.wz-input'),
          save: ((m.querySelector('.wz-row .btn') || {}).innerText || '').trim()
        }
      })()`)
      ok(!!w4 && w4.h === plain(COPY.wz.s4Title), `第 5 步是「配置报表表」（${w4 ? w4.h : '—'}）`)
      ok(!!w4 && w4.hasInput, '报表那步有链接输入框（向导内联，不用再开一个弹窗）')
      ok(!!w4 && w4.save === plain(COPY.wz.s4Save), `有「${w4 ? w4.save : '—'}」按钮`)

      await js(`(() => {
        const i = document.querySelector('.wz-modal .wz-input')
        if (!i) return 'no-input'
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(i, '这不是一条表格链接')
        i.dispatchEvent(new Event('input', { bubbles: true }))
        return 'ok'
      })()`)
      await wait(400)
      await js(`(() => {
        const b = document.querySelector('.wz-modal .wz-row .btn')
        if (b) b.click()
        return 'ok'
      })()`)
      await wait(1000)
      const badLink = await js(`(() => {
        const e = document.querySelector('.wz-modal .tk-err')
        return e ? e.innerText.trim() : ''
      })()`)
      ok(
        badLink === plain(COPY.wz.s4Bad),
        `填了不像链接的内容 → 如实报错、不静默存进去（${badLink || '—'}）`
      )
      await shot('shot-b54-5-wizard-report.png')

      // (7) 走到完成页：汇总如实（工作区=已配置 / 企业微信=已跳过）
      await clickByText('.wz-modal .btn', COPY.wz.next)
      await wait(1000)
      const w5 = await js(`(() => {
        const m = document.querySelector('.wz-modal')
        if (!m) return null
        return {
          h: ((m.querySelector('.wz-title') || {}).innerText || '').trim(),
          items: [...m.querySelectorAll('.wz-sum-item')].map((x) => ({
            k: ((x.querySelector('.k') || {}).innerText || '').trim(),
            v: ((x.querySelector('.v') || {}).innerText || '').trim()
          })),
          btns: [...m.querySelectorAll('.btn')].map((b) => b.innerText.trim())
        }
      })()`)
      ok(!!w5 && w5.h === plain(COPY.wz.s5Title), `末步是完成页（${w5 ? w5.h : '—'}）`)
      ok(!!w5 && w5.items.length === 4, `汇总列出四项配置（实际 ${w5 ? w5.items.length : 0}）`)
      ok(
        !!w5 && w5.items[0] && w5.items[0].v === plain(COPY.wz.itemDone),
        `工作区如实标「已配置」（${w5 && w5.items[0] ? w5.items[0].v : '—'}）`
      )
      ok(
        !!w5 && w5.items[1] && w5.items[1].v === plain(COPY.wz.itemSkipped),
        `【如实】被跳过的企业微信标「已跳过」（${w5 && w5.items[1] ? w5.items[1].v : '—'}）`
      )
      ok(
        !!w5 && w5.btns.includes(plain(COPY.wz.done)) && w5.btns.includes(plain(COPY.wz.prev)),
        `完成页按钮：${w5 ? w5.btns.join(' / ') : '—'}`
      )
      await shot('shot-b54-6-wizard-summary.png')

      // (8) 点「完成」→ 关窗 + 写标记 + 跳到工单队列（用户拍板 W11）
      await clickByText('.wz-modal .btn', COPY.wz.done)
      await wait(1400)
      const doneState = await js(`(() => ({
        wizard: !!document.querySelector('.wz-modal'),
        tab: (() => { const el = document.querySelector('.tabs button.on'); return el ? el.innerText.trim() : '' })(),
        toast: [...document.querySelectorAll('.toast')].map((t) => t.innerText.trim()).join(' | ')
      }))()`)
      ok(doneState.wizard === false, '点「完成」→ 向导关闭')
      ok(
        String(doneState.tab).startsWith(plain(COPY.ticket.viewTab)),
        `完成后自动跳到${plain(COPY.ticket.viewTab)}（当前高亮：${doneState.tab}）`
      )
      ok(
        doneState.toast.includes(plain(fmt(COPY.wz.syncHint, { btn: COPY.ticket.syncBtn }))),
        `并提示点一下「${plain(COPY.ticket.syncBtn)}」（${doneState.toast || '—'}）`
      )

      // (9) 【核心】标记真的落库了（另开一个连接读 —— 主进程写的是已提交数据）
      const Database2 = require('better-sqlite3')
      const dbW = new Database2(join(ws, '_system', 'media.db'), { readonly: true })
      const doneFlag = dbW.prepare("SELECT value FROM meta WHERE key = 'setup_wizard_done'").get()
      dbW.close()
      ok(!!doneFlag && doneFlag.value === '1', '点「完成」→ `setup_wizard_done` 落库')

      // (10) 【核心】再启动一次渲染层 → 向导不再弹（标记生效，不会天天挡路）
      await win.webContents.reload()
      await wait(2400)
      const afterReload = await js(`(() => ({
        wizard: !!document.querySelector('.wz-modal'),
        tab: (() => { const el = document.querySelector('.tabs button.on'); return el ? el.innerText.trim() : '' })()
      }))()`)
      ok(
        afterReload.wizard === false,
        '【核心】走过向导之后再启动 → **不再自动弹**（标记生效）'
      )
      await shot('shot-b54-7-wizard-no-repop.png')
    }
  } else if (SCEN === 'manual') {
    // ============================================================
    // 使用手册插图流水线：把演示工作区每一屏各拍一张（不做断言，只出图）
    // 产物：仓库根目录 shot-m-*.png
    // ============================================================
    const clickTxt = async (sel, text) => {
      const r = await js(`(() => {
        const b = [...document.querySelectorAll(${JSON.stringify(sel)})]
          .find(x => x.innerText.trim().includes(${JSON.stringify(text)}))
        if (!b) return 'no-el'
        b.click(); return 'ok'
      })()`)
      await wait(600)
      return r
    }
    /** 关掉最顶层那个弹窗（叠了弹窗时 pop() 拿到的就是最上面那层） */
    const popModal = async () => {
      await js(`(() => {
        const ms = [...document.querySelectorAll('.modal')]
        const m = ms[ms.length - 1]
        if (!m) return 'no-modal'
        const c = m.querySelector('.close')
        if (c) { c.click(); return 'ok' }
        return 'no-close'
      })()`)
      await wait(500)
    }

    await wait(2400)

    // 出图前先探一次真实 DOM，写进 log —— 以后选择器失效时能一眼看出是哪儿变了
    say('dom probe: tabs       : ' + JSON.stringify(await js(`[...document.querySelectorAll('.tabs button')].map(b=>b.innerText.trim())`)))
    say('dom probe: file rows  : ' + (await js(`document.querySelectorAll('.file-row').length`)))
    say('dom probe: pack cards : ' + (await js(`document.querySelectorAll('.grid .pack-card').length`)))

    // 左栏标签维度默认是收起的（没选标签就折叠）—— 展开，截图里才看得到标签清单。
    // ⚠️ 收起时 `.tp-tags` 根本不渲染，所以判据用「这个维度里有没有 .tp-tag」，
    //    不要用 offsetHeight（第一次就踩了这个，展开没生效）。
    say('expanded dims         : ' + (await js(`(() => {
      let n = 0
      ;[...document.querySelectorAll('.tag-panel .tp-dim-head')].forEach((h) => {
        const box = h.closest('.tp-dim')
        if (box && !box.querySelector('.tp-tag')) { h.click(); n += 1 }
      })
      return n
    })()`)))
    await wait(600)

    // ① 任务视图（总览）
    await clickTxt('.tabs button', COPY.top.viewPacks)
    await wait(1400)
    await shot('shot-m-01-packs.png')

    // ② 点一个「有人用过」的标签 → 自动跳到文件视图并筛选
    const tagClicked = await js(`(() => {
      const ts = [...document.querySelectorAll('.tag-panel .tp-tag')]
      const t = ts.find(x => parseInt(((x.querySelector('.tp-tag-n')||{}).innerText||'0').trim(), 10) > 0)
      if (!t) return 'none'
      t.click()
      return ((t.querySelector('.tp-tag-name')||{}).innerText||'').trim()
    })()`)
    say('clicked tag           : ' + tagClicked)
    await wait(1200)
    await shot('shot-m-02-files-tag.png')

    // ③ 清掉标签 → 全部文件
    await js(`(() => { const b = document.querySelector('.tag-panel .tp-clear'); if (b) b.click(); return 'ok' })()`)
    await wait(500)
    await clickTxt('.side .item', COPY.side.allFiles)
    await wait(1100)
    await shot('shot-m-03-files.png')

    // ④ 勾 3 个文件 → 认领条
    await js(`(() => { const c = [...document.querySelectorAll('.file-row .cb')].slice(0,3); c.forEach(x=>x.click()); return c.length })()`)
    await wait(500)
    await shot('shot-m-04-files-claimbar.png')

    // ⑤ 认领条上的「打标签」→ 标签选择弹窗
    await clickTxt('.claimbar .btn', COPY.claim.tagBtn)
    await wait(1400)
    await shot('shot-m-05-tagpicker.png')
    await popModal()
    await js(`(() => { const b=[...document.querySelectorAll('.claimbar .btn')].find(x=>x.innerText.trim()===${JSON.stringify(COPY.common.cancel)}); if(b){b.click(); return 'ok'} return 'no' })()`)
    await wait(400)

    // ⑥ 回任务视图 → 点开主任务（两稿、带封面）
    await clickTxt('.tabs button', COPY.top.viewPacks)
    await wait(1300)
    await js(`(() => {
      const c = [...document.querySelectorAll('.grid .pack-card')]
        .find(x => ((x.querySelector('.name')||{}).innerText||'').includes('海南招生海报'))
      if (c) c.click()
      return c ? 'ok' : 'no-card'
    })()`)
    await wait(1700)
    await shot('shot-m-06-packdetail.png')

    // ⑦ 勾选成品组里的文件 → 移动条
    await js(`(() => { const c=[...document.querySelectorAll('.modal.wide .cbwrap input')].slice(0,2); c.forEach(x=>x.click()); return c.length })()`)
    await wait(600)
    await shot('shot-m-07-packdetail-move.png')
    await clickTxt('.modal.wide .claimbar .btn', COPY.pdm.deselect)

    // ⑧ 新建版本弹窗
    await clickTxt('.modal.wide .ver-acts .btn', '新建版本')
    await wait(1100)
    await shot('shot-m-08-version-new.png')
    await popModal()

    // ⑨ 打包交付弹窗（上 / 下两屏）
    await clickTxt('.modal.wide .btn', COPY.exportPack.btn)
    await wait(1500)
    await shot('shot-m-09-export-top.png')
    await js(`(() => { const c=document.querySelector('.pack-export-modal .content'); if(c) c.scrollTop=c.scrollHeight; return 'ok' })()`)
    await wait(600)
    await shot('shot-m-10-export-bottom.png')
    await popModal()

    // ⑩ 编辑任务信息
    await clickTxt('.modal.wide .btn', '编辑任务信息')
    await wait(1000)
    await shot('shot-m-11-editpack.png')
    await popModal()
    await popModal() // 关掉任务详情

    // ⑪ 新建任务弹窗
    await clickTxt('.btn', COPY.top.newPack)
    await wait(1100)
    await shot('shot-m-12-newpack.png')
    await popModal()

    // ⑫ 标签管理
    await js(`(() => { const b=document.querySelector('.tag-panel .tp-add'); if(b){b.click(); return 'ok'} return 'no' })()`)
    await wait(1100)
    await shot('shot-m-13-tagmanager.png')
    await popModal()

    // ⑬ 新建项目
    await js(`(() => { const b=document.querySelector('button[title=' + JSON.stringify(${JSON.stringify(COPY.side.newProjectTip)}) + ']'); if(b){b.click(); return 'ok'} return 'no' })()`)
    await wait(1000)
    await shot('shot-m-14-project-new.png')
    await popModal()

    // ⑭ 删除项目（要先真鼠标 hover 项目行，🗑 才出现）
    if (typeof hoverProjectRow === 'function') await hoverProjectRow(1)
    await wait(500)
    await js(`(() => {
      const r = [...document.querySelectorAll('.side .proj-row')][1]
      if (!r) return 'no-row'
      const b = [...r.querySelectorAll('button')].find(x => (x.getAttribute('title')||'').includes('删除'))
      if (b) { b.click(); return 'ok' }
      return 'no-del-btn'
    })()`)
    await wait(1000)
    await shot('shot-m-15-project-del.png')
    await popModal()

    say('manual screenshots    : done')
  } else {
    ok(bannerText === '' || bannerText === undefined || bannerText.length === 0, '工作区正常时不显示提示条')
    ok(statusText.includes('v1.0.0'), '状态栏显示版本号 v1.0.0')
    ok(statusText.includes('shot_ws'), '状态栏显示当前工作区路径')
    ok(leftPanelText.length > 0, '左栏正常渲染（工作区可用时功能不受影响）')
    ok(wsItemCount === 1, `老格式配置自动升级成一个工作区项，实际 ${wsItemCount}`)
  }

  say('banner text           : ' + JSON.stringify(bannerText.replace(/\s+/g, ' ').trim()).slice(0, 200))
  say('banner buttons        : ' + bannerBtnCount)
  say('statusbar text        : ' + JSON.stringify(statusText.replace(/\s+/g, ' ').trim()).slice(0, 200))
  say('console errors        : ' + errs.length + (errs.length ? ' -> ' + errs.slice(0, 4).join(' | ') : ''))
  ok(errs.length === 0, '控制台零报错')

  try {
    const img = await win.webContents.capturePage()
    writeFileSync(join(ROOT, s.shot), img.toPNG())
    say('screenshot            : ' + s.shot + ' (' + Math.round(img.toPNG().length / 1024) + ' KB)')
  } catch (e) {
    ok(false, '截图失败：' + e.message)
  }

  say('')
  say(failed === 0 ? '场景通过 ✅' : `场景有 ${failed} 项失败 ❌`)
  console.log(lines.join('\n'))
  writeFileSync(join(ROOT, `shot-b5-${SCEN}.log`), lines.join('\r\n'), 'utf-8')

  app.exit(failed === 0 ? 0 : 1)
}).catch((e) => {
  // 没有这层兜底，一旦 setup 阶段抛异常，窗口永远不会出现、进程就一直挂着
  console.log('\n场景 ' + SCEN + ' 启动阶段炸了：\n' + (e && e.stack ? e.stack : String(e)))
  // 崩之前已经攒下的断言也要打出来，不然真实失败点会被这层兜底吞掉
  if (lines.length) console.log('\n---- 崩溃前已收集的断言 ----\n' + lines.join('\n'))
  app.exit(9)
})
