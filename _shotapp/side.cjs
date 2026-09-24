// 用 Chromium 真实鼠标事件验证 hover 布局（JS 派发的 mouseover 不触发 CSS :hover）
const { app, BrowserWindow } = require('electron')
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

const shot = (n, b) => writeFileSync(join(ROOT, n), b)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []
const say = (k, v) => log.push(k.padEnd(30) + ': ' + v)

app.whenReady().then(async () => {
  app.setPath('userData', join(ROOT, '_shotapp/_userdata'))
  const root = getWorkspaceRoot(app.getPath('userData'))
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
  win.webContents.on('console-message', (_e, lvl, msg) => {
    if (lvl >= 2) errs.push('L' + lvl + ': ' + msg)
  })

  const js = async (c) => {
    try {
      return await win.webContents.executeJavaScript(c)
    } catch (e) {
      return '__JSERR__ ' + (e && e.message ? e.message : String(e))
    }
  }

  await win.loadFile(join(ROOT, 'out/renderer/index.html'))
  await wait(2600)
  await js(`localStorage.removeItem('media.sideWidth')`)
  await win.webContents.reload()
  await wait(2600)

  // 取得某项目行的屏幕坐标（供真实鼠标用）
  const box = await js(`
    (() => {
      const r = Array.from(document.querySelectorAll('.proj-row')).find(x => x.innerText.includes('海南升学规划中心'))
      const b = r.getBoundingClientRect()
      return { x: Math.round(b.left + 40), y: Math.round(b.top + b.height/2) }
    })()
  `)
  say('target row (device px)', JSON.stringify(box))

  const dpr = await js(`window.devicePixelRatio`)
  say('devicePixelRatio', dpr)

  const send = (type, x, y) =>
    win.webContents.sendInputEvent({
      type,
      x: Math.round(x / dpr),
      y: Math.round(y / dpr)
    })

  // 真实鼠标移入
  send('mouseMove', box.x, box.y)
  await wait(700)

  const hoverGeom = await js(`
    (() => {
      const r = Array.from(document.querySelectorAll('.proj-row')).find(x => x.innerText.includes('海南升学规划中心'))
      const p = r.querySelector('.pname')
      const a = r.querySelector('.proj-acts')
      const item = r.querySelector('.proj-item')
      const pr = p.getBoundingClientRect()
      const ar = a ? a.getBoundingClientRect() : null
      return {
        realHover: r.matches(':hover'),
        itemPadRight: getComputedStyle(item).paddingRight,
        pnameW: Math.round(pr.width),
        pnameText: p.innerText,
        actsLeft: ar ? Math.round(ar.left) : null,
        pnameRight: Math.round(pr.right),
        overlap: ar ? Math.round(pr.right - ar.left) : null,
        minis: r.querySelectorAll('.mini').length,
        isClipped: p.scrollWidth > p.clientWidth + 1
      }
    })()
  `)
  say('REAL hover geometry', JSON.stringify(hoverGeom))
  say('padding-right applied', hoverGeom.itemPadRight)
  say('text NOT covered', hoverGeom.overlap !== null && hoverGeom.overlap <= 0)
  shot('shot-side-hover-real.png', (await win.webContents.capturePage()).toPNG())

  // 真实鼠标拖拽分隔条
  const rzBox = await js(`
    (() => {
      const r = document.querySelector('.side-resizer').getBoundingClientRect()
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + 300), w: Math.round(r.width) }
    })()
  `)
  say('resizer box', JSON.stringify(rzBox))

  send('mouseMove', rzBox.x, rzBox.y)
  await wait(200)
  say('resizer hover bg', await js(`
    getComputedStyle(document.querySelector('.side-resizer')).backgroundColor
  `))

  send('mouseDown', rzBox.x, rzBox.y)
  await wait(200)
  for (const dx of [40, 80, 120, 160]) {
    send('mouseMove', rzBox.x + dx, rzBox.y)
    await wait(120)
  }
  say('during drag: dragging class', await js(`!!document.querySelector('.side-resizer.dragging')`))
  say('during drag: side width', await js(`Math.round(document.querySelector('.side').getBoundingClientRect().width)`))
  shot('shot-side-drag-real.png', (await win.webContents.capturePage()).toPNG())

  send('mouseUp', rzBox.x + 160, rzBox.y)
  await wait(600)
  say('after release: dragging cleared', await js(`!document.querySelector('.side-resizer.dragging')`))
  say('after release: width', await js(`Math.round(document.querySelector('.side').getBoundingClientRect().width)`))
  say('after release: saved', await js(`localStorage.getItem('media.sideWidth')`))

  // 加宽后项目名能显示几个字
  const wide = await js(`
    (() => {
      const r = Array.from(document.querySelectorAll('.proj-row')).find(x => x.innerText.includes('海南升学规划中心'))
      const p = r.querySelector('.pname')
      return { pnameW: Math.round(p.getBoundingClientRect().width), chars: Math.floor(p.getBoundingClientRect().width/12), clipped: p.scrollWidth > p.clientWidth+1 }
    })()
  `)
  say('wide side: pname', JSON.stringify(wide))
  shot('shot-side-wide.png', (await win.webContents.capturePage()).toPNG())

  // 还原默认宽度并刷新验证持久化
  await js(`localStorage.setItem('media.sideWidth','260')`)
  await win.webContents.reload()
  await wait(2600)
  say('reload restores width', await js(`Math.round(document.querySelector('.side').getBoundingClientRect().width)`))
  shot('shot-side-final.png', (await win.webContents.capturePage()).toPNG())

  console.log('\n===UI-CHECK===')
  console.log(log.join('\n'))
  console.log('---')
  console.log('console errors:', errs.length ? errs.join('\n') : '(none)')
  console.log('===END===')
  app.exit(0)
}).catch((e) => {
  console.log('\n===UI-CHECK===')
  console.log(log.join('\n'))
  console.log('---')
  console.log('FATAL:', e && e.stack ? e.stack : String(e))
  console.log('===END===')
  app.exit(1)
})
