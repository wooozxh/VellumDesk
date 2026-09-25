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

const { writeFileSync, mkdirSync, rmSync } = require('fs')
const { join } = require('path')

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
    mkdirSync(join(ws, '海南升学初三集训营'), { recursive: true })

    // 用已有的 workspace 产物建库（它内部带着 db 模块，会建表 + 建两个收纳区）
    const wsm = require(join(ROOT, 'out/test/workspace.cjs'))
    wsm.initWorkspace(ws)

    // 播种"老两级结构"的库记录：直接连库写，避开 esbuild 分包导致的模块实例隔离
    const Database = require('better-sqlite3')
    const d = new Database(join(ws, '_system', 'media.db'))
    d.pragma('foreign_keys = ON')
    const now = new Date().toISOString()
    // 项目不用自己造 —— initWorkspace 首次使用会落 3 个预制项目（集团通用 / 海南升学规划中心 / 海南升学初三集训营）
    const pid = d.prepare('SELECT id FROM projects WHERE name = ?').get('海南升学规划中心').id
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
        (require('fs').existsSync(join(ws, '海南升学规划中心', '海南招生海报-2026秋季', '01-成品', '海报终稿.png'))
          ? '包已进项目文件夹 ✅'
          : '❌ 包没被搬进项目文件夹')
    )
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

  await win.loadFile(join(ROOT, 'out/renderer/index.html'))
  await wait(3000)

  say('scenario              : ' + SCEN)
  say('configured workspace  : ' + s.workspaceRoot)

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
    ok(/工作区\s*\/\s*项目\s*\/\s*包/.test(infoBannerText), '提示条写清新结构是三级：工作区 / 项目 / 包')
    ok(infoBannerText.includes('1 个包'), '提示条报出了本次搬了几个包（应为 1 个）')
    ok(infoBannerText.includes('文件一个没动'), '提示条明确安抚：文件一个没动')
    ok(infoBannerBtn === '知道了', `提示条只给一个出口「知道了」，实际「${infoBannerBtn}」`)
    ok(bannerText === '' || bannerText === undefined || bannerText.length === 0, '工作区正常，不显示红色错误条')

    // ---- 左栏：待归类入口 ----
    ok(looseEntry === '待归类', '根目录下的游离包让左栏多了「待归类」入口')
    ok(!leftPanelText.includes('未指定项目'), '老文案「未指定项目」已全部换成「待归类」')
    ok(
      projNames.includes('海南升学规划中心') && projNames.includes('海南升学初三集训营'),
      '两个项目都在左栏：' + JSON.stringify(projNames)
    )
    ok(
      projTitles.some((t) => t.includes('磁盘位置：') && t.includes('海南升学规划中心')),
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
  app.exit(9)
})
