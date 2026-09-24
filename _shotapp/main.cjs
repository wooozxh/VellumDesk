// 临时验收 App：启动真实界面 → 截图 + 抓界面文本 + 抓控制台错误
// 放在 _shotapp/ 下并带 package.json，这样 Electron 才把它当主进程入口
const { app, BrowserWindow } = require('electron')

// 无头/沙箱环境：禁用 GPU 硬件加速，改用软件渲染，否则 GPU 进程会崩
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')
const { writeFileSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..')
const { registerIpc } = require(join(ROOT, 'out/test/ipc.cjs'))
const { getWorkspaceRoot, initWorkspace, scanAll } = require(join(ROOT, 'out/test/workspace.cjs'))

const shot = (name, buf) => writeFileSync(join(ROOT, name), buf)

app.whenReady().then(async () => {
  // 用真实 App 的 userData 目录，保证与正式运行时同一份工作区配置
  app.setPath('userData', join(ROOT, '_shotapp/_userdata'))

  const userData = app.getPath('userData')
  const root = getWorkspaceRoot(userData)
  initWorkspace(root)
  scanAll(root)
  registerIpc()

  const errs = []
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
  win.webContents.on('render-process-gone', (_e, d) =>
    errs.push('RENDER GONE: ' + JSON.stringify(d))
  )

  await win.loadFile(join(ROOT, 'out/renderer/index.html'))
  await new Promise((r) => setTimeout(r, 3000))

  shot('shot-packs.png', (await win.webContents.capturePage()).toPNG())
  writeFileSync(
    join(ROOT, 'shot-text-packs.txt'),
    await win.webContents.executeJavaScript('document.body.innerText'),
    'utf-8'
  )

  // 切文件视图
  const switched = await win.webContents.executeJavaScript(`
    (() => {
      const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.includes('文件视图'));
      if (b) { b.click(); return true }
      return false
    })()
  `)
  await new Promise((r) => setTimeout(r, 1500))
  shot('shot-files.png', (await win.webContents.capturePage()).toPNG())
  writeFileSync(
    join(ROOT, 'shot-text-files.txt'),
    await win.webContents.executeJavaScript('document.body.innerText'),
    'utf-8'
  )

  // 点开第一个包 → 详情
  const opened = await win.webContents.executeJavaScript(`
    (() => {
      const c = document.querySelector('.pack-card');
      if (c) { c.click(); return true }
      return false
    })()
  `)
  await new Promise((r) => setTimeout(r, 1600))
  shot('shot-detail.png', (await win.webContents.capturePage()).toPNG())
  writeFileSync(
    join(ROOT, 'shot-text-detail.txt'),
    await win.webContents.executeJavaScript('document.body.innerText'),
    'utf-8'
  )

  // 关详情 → 新建包弹窗
  await win.webContents.executeJavaScript(`document.querySelector('.close')?.click()`)
  await new Promise((r) => setTimeout(r, 700))
  const newOpened = await win.webContents.executeJavaScript(`
    (() => {
      const b = [...document.querySelectorAll('.btn')].find(x => x.textContent.includes('新建任务包'));
      if (b) { b.click(); return true }
      return false
    })()
  `)
  await new Promise((r) => setTimeout(r, 900))
  shot('shot-newpack.png', (await win.webContents.capturePage()).toPNG())

  console.log('\n===UI-CHECK===')
  console.log('console errors:', errs.length ? errs.join('\n') : '(none)')
  console.log('switched to files view:', switched)
  console.log('opened pack detail    :', opened)
  console.log('opened new-pack modal :', newOpened)
  console.log('===END===')
  app.exit(0)
})
