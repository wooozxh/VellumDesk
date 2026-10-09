/**
 * 用 Electron 的 printToPDF 验 A4 打印（顺便产出一份 PDF）。
 * 用法：electron export_pdf.cjs <in.html> <out.pdf>
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const { pathToFileURL } = require('url')
const path = require('path')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')

const A = process.argv.slice(1).filter((a) => !a.startsWith('-'))
const [inHtml, outPdf] = A.slice(-2)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 900, show: true, webPreferences: { sandbox: false } })
  await win.loadURL(pathToFileURL(path.resolve(inHtml)).href)
  await new Promise((r) => setTimeout(r, 2500))
  const pdf = await win.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    margins: { marginType: 'custom', top: 0.63, bottom: 0.63, left: 0.59, right: 0.59 }
  })
  writeFileSync(path.resolve(outPdf), pdf)
  console.log('pdf ->', outPdf, Math.round(pdf.length / 1024) + ' KB')
  app.exit(0)
}).catch((e) => { console.log('pdf failed:', e && e.stack ? e.stack : e); app.exit(1) })
