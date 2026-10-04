import { COPY } from '../shared/copy'
import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
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

// 用户数据目录锁定（B-11）：安装包的显示名会随版本调整（当前「营销中心-素材库」），
// 而工作区配置就放在 userData/workspace.json 里。目录名一旦跟着产品名变，
// 老用户打开软件就会看到「工作区没了」——数据其实还在旧目录，只是找不到。
// 历史上该目录一直是 proj_media，这里显式钉死，不再依赖 Electron 按应用名的推导。
const userDataDir = join(app.getPath('appData'), 'proj_media')
try {
  mkdirSync(userDataDir, { recursive: true })
} catch {
  // 极端情况（如盘只读）下保持 Electron 默认路径，不让启动失败
}
app.setPath('userData', userDataDir)

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mediabutler')

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
  } catch (e) {
    console.error('[workspace] 初始化失败：', e)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
