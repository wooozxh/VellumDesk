/**
 * 用项目自带的 Electron 当「HTML 截图器」——本机没装 playwright。
 * 用法：electron shoot_html.cjs <out.png> <file.html|url> [width] [height] [scrollY]
 * 不传 height 时按内容撑满（上限 6000）。
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const { pathToFileURL } = require('url')
const path = require('path')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

// ⚠️ Electron 的 process.argv 里**带着 CLI 开关**（--no-sandbox 之类），
//    直接按下标取会把开关当成参数（踩过：width 变 NaN → setContentSize 报 conversion failure）
const A = process.argv.slice(1).filter((a) => !a.startsWith('-'))
const [outPng, target, widthArg, heightArg, scrollArg] = A.slice(-5)
const width = parseInt(widthArg || '1440', 10)
const wantH = heightArg ? parseInt(heightArg, 10) : 0
const scrollY = parseInt(scrollArg || '0', 10)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height: 1000,
    // ⚠️ 必须显示出来（show:true）—— 隐藏窗口会被当成后台页，
    //    rAF / 定时器被节流，依赖滚动的 JS（右侧「本页内容」）截出来是旧的（踩过）
    show: process.env.SHOT_HIDE !== '1',
    webPreferences: { offscreen: false, sandbox: false }
  })
  const url = /^https?:/.test(target) ? target : pathToFileURL(path.resolve(target)).href
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 1600))

  const contentH = await win.webContents.executeJavaScript(
    'Math.min(6000, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))'
  )
  const h = wantH || contentH
  win.setContentSize(width, Math.ceil(h))
  await new Promise((r) => setTimeout(r, 700))

  if (scrollY) {
    // ⚠️ 页面里写了 html{scroll-behavior:smooth} —— 直接 scrollTo 会变成动画，
    //    截图时还没滚到位（踩过：截出来还是第一屏）。先关掉平滑，再直接设 scrollTop。
    await win.webContents.executeJavaScript(
      "document.documentElement.style.scrollBehavior='auto';" +
        "document.body.style.scrollBehavior='auto';" +
        'window.scrollTo(0,' + scrollY + ');' +
        'document.documentElement.scrollTop=' + scrollY + ';' +
        'document.body.scrollTop=' + scrollY + ';' +
        'String(window.scrollY)'
    )
    await new Promise((r) => setTimeout(r, 900))
  }

  const img = await win.webContents.capturePage()
  writeFileSync(path.resolve(outPng), img.toPNG())
  console.log('shot ->', outPng, '(' + Math.round(img.toPNG().length / 1024) + ' KB,', width + 'x' + Math.ceil(h) + ', scrollY=' + scrollY + ')')
  app.exit(0)
}).catch((e) => {
  console.log('shot failed:', e && e.stack ? e.stack : e)
  app.exit(1)
})
