import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { getWorkspaceRoot, initWorkspace } from './workspace'
import { enrichAllImageMeta, enrichAllVideoMeta, enrichAllPsdMeta, setFfmpegDir } from './thumbs'

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
    title: '素材管家',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mediabutler')

  // 启动即初始化工作区（A-02）：建目录 + 建库，避免界面首次查询时表还不存在
  try {
    // B-02：FFmpeg 路径注入（随软件打包；找不到也不影响启动，只是视频功能降级）
    const ffDir = locateFfmpegDir()
    setFfmpegDir(ffDir)
    if (!ffDir) console.warn('[ffmpeg] 未找到 resources/ffmpeg，视频缩略图与信息功能降级')

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
