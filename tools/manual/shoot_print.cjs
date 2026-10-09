/**
 * 用 CDP 把页面切成「打印媒体」再截图 —— 用来肉眼验 @media print 的版式。
 * 用法：electron shoot_print.cjs <out.png> <in.html> [width] [height] [scrollY]
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const { pathToFileURL } = require('url')
const path = require('path')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')

const A = process.argv.slice(1).filter((a) => !a.startsWith('-'))
const [outPng, inHtml, wArg, hArg, sArg] = A.slice(-5)
const width = parseInt(wArg || '900', 10)
const height = parseInt(hArg || '1270', 10)
const scrollY = parseInt(sArg || '0', 10)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width, height, show: true, webPreferences: { sandbox: false } })
  await win.loadURL(pathToFileURL(path.resolve(inHtml)).href)
  await new Promise((r) => setTimeout(r, 2200))

  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  await dbg.sendCommand('Emulation.setEmulatedMedia', { media: 'print' })
  await new Promise((r) => setTimeout(r, 600))

  if (scrollY) {
    await win.webContents.executeJavaScript(
      "document.documentElement.style.scrollBehavior='auto';window.scrollTo(0," + scrollY + ");document.documentElement.scrollTop=" + scrollY + ';'
    )
    await new Promise((r) => setTimeout(r, 800))
  }
  const img = await win.webContents.capturePage()
  writeFileSync(path.resolve(outPng), img.toPNG())
  console.log('print shot ->', outPng, '(' + width + 'x' + height + ')')
  app.exit(0)
}).catch((e) => { console.log('failed:', e && e.stack ? e.stack : e); app.exit(1) })
