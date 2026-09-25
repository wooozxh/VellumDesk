/**
 * 第 4 批专用界面验证壳。
 * 验证两件事：① 工作区连不上时的顶部提示条 ② 状态栏版本号。
 * 用 SHOT_SCENARIO 选择场景：banner（工作区不可用） / version（工作区正常）。
 * 工作区配置与截图都落在仓库外/忽略目录，绝不碰用户真实工作区 D:\素材工作区。
 */
const { app, BrowserWindow } = require('electron')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')

const { writeFileSync, mkdirSync } = require('fs')
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
    shot: 'shot-b4-1-banner.png'
  },
  version: {
    userData: join(BASE, 'shot4_version'),
    workspaceRoot: join(BASE, 'shot_ws'),
    shot: 'shot-b4-2-version.png'
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
  writeFileSync(
    join(s.userData, 'workspace.json'),
    JSON.stringify({ workspaceRoot: s.workspaceRoot }, null, 2),
    'utf-8'
  )

  app.setPath('userData', s.userData)

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
    `(() => { const el = document.querySelector('.wsbanner'); return el ? el.innerText : '' })()`
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

  if (SCEN === 'banner') {
    ok(typeof bannerText === 'string' && bannerText.length > 0, '工作区不可用时出现顶部提示条')
    ok(bannerText.includes(s.workspaceRoot), '提示条里写清了具体是哪个路径（' + s.workspaceRoot + '）')
    ok(bannerText.includes('移动硬盘') || bannerText.includes('磁盘'), '提示条给出了人看得懂的原因')
    ok(bannerText.includes('没动'), '提示条明确安抚：里面的东西一件没动')
    ok(bannerBtnCount === 2, `提示条有 2 个出口按钮（重试 / 更改位置），实际 ${bannerBtnCount}`)
    ok(/(^|[^0-9])v\d+\.\d+\.\d+/.test(statusText), '工作区挂了也能看到版本号：' + statusText.replace(/\s+/g, ' ').trim())
  } else {
    ok(bannerText === '' || bannerText === undefined || bannerText.length === 0, '工作区正常时不显示提示条')
    ok(statusText.includes('v1.0.0'), '状态栏显示版本号 v1.0.0')
    ok(statusText.includes('shot_ws'), '状态栏显示当前工作区路径')
    ok(leftPanelText.length > 0, '左栏正常渲染（工作区可用时功能不受影响）')
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
  writeFileSync(join(ROOT, `shot-b4-${SCEN}.log`), lines.join('\r\n'), 'utf-8')

  app.exit(failed === 0 ? 0 : 1)
})
