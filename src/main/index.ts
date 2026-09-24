import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { getWorkspaceRoot, initWorkspace } from './workspace'

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
    const root = getWorkspaceRoot(app.getPath('userData'))
    initWorkspace(root)
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
