import { COPY } from '../shared/copy'
import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { startLinkService, stopLinkService } from './linkService'
import { getWorkspaceRoot, initWorkspace } from './workspace'
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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#15161a',
    title: COPY.app.name,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 窗口标题的唯一来源是字典（COPY.app.name）：页面 <title> 会在加载后覆盖窗口标题，
  // 一旦 index.html 里那个标题漂了（脚手架默认值是「Electron」），任务栏上就是另一个名字。
  // 这里把覆盖拦下来，改名字只改字典一处。
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault()
    mainWindow.setTitle(COPY.app.name)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  // 第 62 批（docs/45）：停掉插件联动的 handoff 轮询（照 ipc.ts 的 stopTicketScheduler 路数）
  stopLinkService()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
