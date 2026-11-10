import { COPY } from '../shared/copy'
import { app, shell, BrowserWindow, dialog, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { startLinkService, stopLinkService, flushMirrorNow, hasPendingMirror } from './linkService'
import { destroyTplCardRenderer } from './tplCardImage'
import { getWorkspaceRoot, initWorkspace } from './workspace'
import { readUiPrefs } from './uiPrefs'
import { locateBundledExe, setBundledCliExe } from './wecomCli'
import {
  enrichAllImageMeta,
  enrichAllVideoMeta,
  enrichAllPsdMeta,
  enrichAllPdfMeta,
  setFfmpegDir
} from './thumbs'

/**
 * B-02：定位随软件打包的 FFmpeg（resources/ffmpeg/ffmpeg.exe + ffprobe.exe）。
 * 开发态：项目根 resources/ffmpeg；打包后：<安装目录>/resources/ffmpeg。
 */
function locateFfmpegDir(): string {
  const candidates = [
    app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : '',
    join(app.getAppPath(), 'resources', 'ffmpeg')
  ].filter(Boolean)
  for (const dir of candidates) {
    if (existsSync(join(dir, 'ffmpeg.exe'))) return dir
  }
  return ''
}

/**
 * 第 81 批：系统托盘驻留。
 *
 * 语义（用户拍板）：**点 X 只是把窗口收进托盘，不退出软件**；真正退出走托盘菜单的「退出」。
 * 为什么这样做：工单自动同步是个后台活（默认 10 分钟一轮），关窗就退等于把同步也关了 ——
 * 设计师一天里反复开关软件，任务反而更难及时建出来。
 *
 * 安全阀：`quitting` 为 true 时才允许窗口真的关掉。任何走 `app.quit()` 的路径
 * （托盘菜单、系统关机、任务栏关闭）都必须先把它置 true，否则会被 `close` 拦回来 ——
 * 那就是"点退出没反应"的经典死结。
 */
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
/** 气泡提示只弹一次（每进程一次，不落盘 —— 重启后再关一次也值得提醒） */
let trayHintShown = false

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 托盘只建一次；图标拿不到就**不建**（保持"关窗即退出"的老行为，绝不出现关不掉的窗口） */
function createTray(): void {
  if (tray) return
  let image = nativeImage.createFromPath(icon)
  if (image.isEmpty()) {
    console.warn('[tray] 托盘图标读不到，跳过托盘（关窗仍是退出）')
    return
  }
  // Windows 托盘按 16×16 显示，直接塞 512 会被系统缩得发糊
  image = image.resize({ width: 16, height: 16 })
  try {
    tray = new Tray(image)
  } catch (e) {
    console.error('[tray] 托盘创建失败（关窗仍是退出）：', e)
    tray = null
    return
  }
  tray.setToolTip(COPY.tray.tooltip)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: COPY.tray.open, click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: COPY.tray.refresh,
        click: () => mainWindow?.webContents.send('tray:action', 'refresh')
      },
      { type: 'separator' },
      {
        label: COPY.tray.quit,
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  // 单击切换：窗口在前台就收起，在托盘就唤出（Windows 上左键单击的常规行为）
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide()
    else showMainWindow()
  })
}

function createWindow(): void {
  /**
   * 第 70 批（docs/55）：主题要在**首屏之前**就定下来，否则浅色用户每次启动会先闪一帧深灰。
   * 两道保险：① 窗口底色按主题给（Chromium 空闲底色）；② 主题经 URL 查询串带给渲染层，
   * 由 `index.html` 里的内联脚本在 React 挂载前打到 `<html data-theme>` 上。
   *
   * 第 81 批：密度和启动视图跟着同一条 query 串走 —— 三者都是「首帧就得对」的，
   * 分开走 IPC 会晚一步（用户能看到界面先按标准密度铺开、再跳成紧凑）。
   */
  const prefs = readUiPrefs(userDataDir)
  const theme = prefs.theme
  const bootQuery = {
    theme,
    density: prefs.density,
    start: prefs.startView
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: theme === 'light' ? '#eeebe4' : '#15161a',
    title: COPY.app.name,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // 下面用到的是"这个窗口"，不直接用模块级的 mainWindow —— 重建窗口时旧引用会被换掉，
  // 事件回调里抓局部变量更不容易出错（模块级那份只给托盘/activate 用）
  const win = mainWindow

  /**
   * 第 81 批：点 X = 收进托盘。
   * 只有 `quitting` 为 true（托盘菜单「退出」/系统关机）才放行真正的关闭。
   * 托盘没建成功时不拦 —— 否则窗口就在眼前却怎么都关不掉。
   */
  win.on('close', (e) => {
    if (quitting || !tray) return
    e.preventDefault()
    win.hide()
    // 第一次收起时给一句提示（只提示一次，之后用户就知道了）。
    // 系统通知被关了也不影响 —— displayBalloon 抛错/静默都只是少一句话。
    if (!trayHintShown) {
      trayHintShown = true
      try {
        tray.displayBalloon({ title: COPY.app.name, content: COPY.tray.hint })
      } catch {
        // 忽略：通知渠道不可用不该影响收起
      }
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // 窗口标题的唯一来源是字典（COPY.app.name）：页面 <title> 会在加载后覆盖窗口标题，
  // 一旦 index.html 里那个标题漂了（脚手架默认值是「Electron」），任务栏上就是另一个名字。
  // 这里把覆盖拦下来，改名字只改字典一处。
  win.on('page-title-updated', (event) => {
    event.preventDefault()
    win.setTitle(COPY.app.name)
  })

  win.on('ready-to-show', () => {
    // 托盘常驻后，"重建窗口"（activate / 托盘点开）不该再抢焦点闪一下，
    // 但首次启动必须显示 —— show() 对已隐藏窗口是幂等的
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const q = new URLSearchParams(bootQuery).toString()
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${q}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: bootQuery })
  }
}

// 禁用 GPU 硬件加速：本工具的缩略图走 sharp（CPU），界面软件渲染足够；
// 换来的好处是任何显卡驱动有问题的办公机都能稳定启动（演示不翻车）
app.disableHardwareAcceleration()
// ⚠️ 仅 disableHardwareAcceleration 不够（1.3.0 真机踩坑，2026-10-01）：
// 它只关硬件加速，Chromium 照样会拉起独立 GPU 进程做合成；显卡驱动或
// 安全软件有问题时该进程直接访问违例（0xC0000005）反复崩溃，
// 窗口永远到不了 ready-to-show，最终 Chromium 打出
// 「GPU process isn't usable. Goodbye.」静默退出——用户看到的就是「双击没反应」。
// 实测 disable-gpu 单独上也拦不住（GPU 进程仍会拉起），必须三件套：
// disable-gpu 彻底不走 GPU；disable-software-rasterizer 关 SwiftShader 兜底；
// in-process-gpu 让残余合成逻辑并进主进程、不再起独立 GPU 子进程。
// （界面验证壳 _shotapp 一直带这组参数跑，所以场景全绿而真机裸启动会死。）
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')

// 主进程兜底：任何未捕获异常至少弹个框，别再「静默退出让用户猜」
process.on('uncaughtException', (err) => {
  try {
    dialog.showErrorBox(
      `${COPY.app.name} 启动/运行异常`,
      `软件遇到未处理的错误，请截图反馈：\n\n${String(err && err.stack ? err.stack : err)}`
    )
  } catch {
    // showErrorBox 也不可用时只能放弃，保住退出码
  }
  app.exit(1)
})

// 用户数据目录锁定：2026-10-05 全站改名（docs/28）把产品名改为「Vellum工作台」，
// 同时用户数据目录从 proj_media 改为 vellumdesk_project。目录名不跟随产品名推导，
// 显式钉死；老用户（旧版 proj_media）升级后需在首次打开时重选一次工作区位置，数据本身不丢。
const userDataDir = join(app.getPath('appData'), 'vellumdesk_project')
try {
  mkdirSync(userDataDir, { recursive: true })
} catch {
  // 极端情况（如盘只读）下保持 Electron 默认路径，不让启动失败
}
app.setPath('userData', userDataDir)

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.vellumdesk')

  /**
   * 第 54 批（docs/40 §4.1）：首次配置引导的判据 —— **本次启动时工作区里有没有现成的库**。
   * ⚠️ 必须在 `initWorkspace` 之前探（那一步就是把库建出来的），而且只能探这一次。
   * 判据刻意是"库在没在"而不是"配置文件在不在"：第 28 批 userData 改名后，
   * 老用户升级时配置文件本来就是空的 —— 拿它判会把老用户全弹一遍。
   */
  let firstRunThisSession = false

  // 启动即初始化工作区（A-02）：建目录 + 建库，避免界面首次查询时表还不存在
  try {
    // B-02：FFmpeg 路径注入（随软件打包；找不到也不影响启动，只是视频功能降级）
    const ffDir = locateFfmpegDir()
    setFfmpegDir(ffDir)
    if (!ffDir) console.warn('[ffmpeg] 未找到 resources/ffmpeg，视频缩略图与信息功能降级')

    // 第 21 批（docs/16 §4）：wecom-cli 内置路径注入 —— 装完软件即可用工单同步与扫码授权，
    // 同事机器不必再自己装 CLI。找不到就退回环境变量/老开发机路径（界面显示「企微未连接」）。
    const cliExe = locateBundledExe(app.getAppPath(), process.resourcesPath, app.isPackaged)
    setBundledCliExe(cliExe)
    if (!cliExe) console.warn('[wecom-cli] 未找到内置 resources/wecom-cli/wecom-cli.exe')

    const root = getWorkspaceRoot(app.getPath('userData'))
    // 第 54 批：建库**之前**探一次（见上面 firstRunThisSession 的说明）
    firstRunThisSession = !existsSync(join(root, '_system', 'media.db'))
    initWorkspace(root)
    // B-01/B-02/B-04：后台补一次图片尺寸 / 色彩模式 + 视频时长 / 编码 + PSD 尺寸，
    // 让界面一打开就有信息（不阻塞窗口显示）
    void enrichAllImageMeta().catch((e) =>
      console.error('[meta] 图片元信息补齐失败：', e)
    )
    void enrichAllVideoMeta().catch((e) =>
      console.error('[meta] 视频元信息补齐失败：', e)
    )
    void enrichAllPsdMeta().catch((e) =>
      console.error('[meta] PSD 元信息补齐失败：', e)
    )
    void enrichAllPdfMeta().catch((e) =>
      console.error('[meta] PDF 页数补齐失败：', e)
    )

    // 第 62 批（docs/45）：插件联动 —— 启动后起 handoff 轮询 + 首扫镜像。
    // 一个插件目录都没找到 / 开关关着 → startLinkService 内部静默不启，不影响其它功能。
    void startLinkService({
      appDataDir: app.getPath('appData'),
      appVersion: app.getVersion(),
      workspaceRoot: root
    }).catch((e) => console.error('[link] 插件联动服务启动失败：', e))
  } catch (e) {
    console.error('[workspace] 初始化失败：', e)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 第 54 批（docs/40）：把"启动时有没有现成的库"传下去 —— 首次配置引导的触发判据
  registerIpc({ firstRunThisSession })

  createWindow()
  // 第 81 批：托盘必须在窗口建好之后 —— close 拦截依赖 `tray` 是否存在
  createTray()

  app.on('activate', function () {
    // 托盘常驻后窗口通常是"隐藏"而不是"没有" —— 这里统一走 showMainWindow 判断
    showMainWindow()
  })
})

let linkFlushDone = false

app.on('before-quit', (e) => {
  // 第 81 批：任何退出路径都要先放行 close 拦截，否则会卡在"退不掉"
  quitting = true
  // 第 63 批（docs/47）：退出前把还没写盘的镜像变更冲刷掉（防抖计时器里可能还挂着一次）。
  if (linkFlushDone || !hasPendingMirror()) return
  linkFlushDone = true
  e.preventDefault()
  void flushMirrorNow()
    .catch(() => undefined)
    .finally(() => app.quit())
})

app.on('will-quit', () => {
  // 第 62 批（docs/45）：停掉插件联动的 handoff 轮询（照 ipc.ts 的 stopTicketScheduler 路数）
  stopLinkService()
  // 第 69 批（docs/53）：销毁离屏渲染窗口 —— 隐藏窗口会拖住进程不让退出
  destroyTplCardRenderer()
  // 第 81 批：托盘图标不销毁会在 Windows 通知区留一个不能点的幽灵图标
  tray?.destroy()
  tray = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
