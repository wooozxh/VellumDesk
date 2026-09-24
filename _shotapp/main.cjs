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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []
const say = (k, v) => log.push(k.padEnd(26) + ': ' + v)

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

  const js = (code) => win.webContents.executeJavaScript(code)

  await win.loadFile(join(ROOT, 'out/renderer/index.html'))
  await wait(3000)

  // ── 1. 左栏项目面板基线 ───────────────────────────────
  shot('shot-proj-1-list.png', (await win.webContents.capturePage()).toPNG())
  say('proj rows', await js(`document.querySelectorAll('.proj-row').length`))
  say('has add-proj button', await js(`!!document.querySelector('.add-proj')`))
  say('add-proj label', JSON.stringify(await js(`document.querySelector('.add-proj')?.innerText || ''`)))
  say('color dots', await js(`document.querySelectorAll('.proj-row .cdot').length`))
  say('dot colors', JSON.stringify(await js(`
    [...document.querySelectorAll('.proj-row .cdot')].map(d => getComputedStyle(d).backgroundColor)
  `)))

  // ── 2. 打开新建项目弹窗，检查色块 ─────────────────────
  await js(`
    (() => { document.querySelector('.add-proj')?.click() })()
  `)
  await wait(700)
  shot('shot-proj-2-newmodal.png', (await win.webContents.capturePage()).toPNG())
  say('new-project modal', await js(`!!document.querySelector('.modal')`))
  say('swatch count', await js(`document.querySelectorAll('.swatch').length`))
  say('modal inputs', JSON.stringify(await js(`
    [...document.querySelectorAll('.modal input')].map(i => i.placeholder || i.type)
  `)))
  say('modal text', JSON.stringify(await js(`document.querySelector('.modal')?.innerText || ''`)))

  // ── 3. 选第 4 个色块 + 填名 + 创建 ────────────────────
  const colorPicked = await js(`
    (() => {
      const sw = document.querySelectorAll('.swatch')
      if (sw.length < 4) return null
      sw[3].click()
      return getComputedStyle(sw[3]).backgroundColor
    })()
  `)
  say('picked swatch[3]', JSON.stringify(colorPicked))

  await js(`
    (() => {
      const inp = [...document.querySelectorAll('.modal input')].find(i => i.type === 'text' || !i.type)
      if (!inp) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, '内部孵化·AI 素材')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await wait(400)
  shot('shot-proj-3-filled.png', (await win.webContents.capturePage()).toPNG())

  const created = await js(`
    (() => {
      const b = [...document.querySelectorAll('.modal .btn')].find(x => /创建|保存|确定/.test(x.textContent))
      if (!b) return false
      b.click(); return true
    })()
  `)
  await wait(1200)
  say('clicked create/save', created)
  say('proj rows after create', await js(`document.querySelectorAll('.proj-row').length`))
  say('new row present', await js(`
    [...document.querySelectorAll('.proj-row')].some(r => r.innerText.includes('内部孵化'))
  `))
  say('new row dot color', JSON.stringify(await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => x.innerText.includes('内部孵化'))
      const d = r?.querySelector('.cdot')
      return d ? getComputedStyle(d).backgroundColor : null
    })()
  `)))
  shot('shot-proj-4-created.png', (await win.webContents.capturePage()).toPNG())

  // 悬浮某项目行：React 用 onMouseEnter 合成事件，需派发可冒泡的 mouseover
  const hoverRow = (name) => js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => x.innerText.includes(${JSON.stringify(name)}))
      if (!r) return false
      r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      r.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
      return true
    })()
  `)

  // ── 4. 悬浮新行，检查编辑/删除小按钮 ─────────────────
  // 先移开鼠标，避免上一行仍处于 hover 状态
  await js(`document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  await wait(300)
  const hover = await hoverRow('内部孵化')
  await wait(600)
  say('hover applied', hover)
  say('proj-acts visible', await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => x.innerText.includes('内部孵化'))
      const a = r?.querySelector('.proj-acts')
      if (!a) return 'no .proj-acts'
      return getComputedStyle(a).display + '/' + getComputedStyle(a).opacity
    })()
  `))
  say('mini buttons on row', await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => x.innerText.includes('内部孵化'))
      return r ? r.querySelectorAll('.mini').length : 0
    })()
  `))
  say('mini labels', JSON.stringify(await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => x.innerText.includes('内部孵化'))
      return r ? [...r.querySelectorAll('.mini')].map(b => b.className + '|' + b.title) : []
    })()
  `)))
  shot('shot-proj-5-hover.png', (await win.webContents.capturePage()).toPNG())

  // ── 5. 点编辑按钮 → 弹窗应带出旧名与旧色 ─────────────
  const editOpened = await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => x.innerText.includes('内部孵化'))
      const b = r?.querySelector('.mini:not(.danger)')
      if (!b) return false
      b.click(); return true
    })()
  `)
  await wait(800)
  say('edit modal opened', editOpened)
  say('edit modal prefilled', JSON.stringify(await js(`
    (() => {
      const inp = document.querySelector('.modal input')
      return inp ? inp.value : null
    })()
  `)))
  say('edit modal has name', await js(`(document.querySelector('.modal')?.innerText||'').includes('内部孵化')`))
  shot('shot-proj-6-edit.png', (await win.webContents.capturePage()).toPNG())
  await js(`[...document.querySelectorAll('.modal .btn')].find(x => /取消/.test(x.textContent))?.click()`)
  await wait(600)

  // ── 6. 点删除按钮 → 确认弹窗（无包时应可直接删）─────
  await js(`document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  await wait(300)
  await hoverRow('内部孵化')
  await wait(500)
  const delOpened = await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => x.innerText.includes('内部孵化'))
      const b = r?.querySelector('.mini.danger')
      if (!b) return false
      b.click(); return true
    })()
  `)
  await wait(800)
  say('delete modal opened', delOpened)
  say('delete modal text', JSON.stringify(await js(`document.querySelector('.modal')?.innerText || ''`)))
  shot('shot-proj-7-delconfirm.png', (await win.webContents.capturePage()).toPNG())

  // 确认删除
  const delDone = await js(`
    (() => {
      const b = [...document.querySelectorAll('.modal .btn')].find(x => /删除|确定/.test(x.textContent))
      if (!b) return false
      b.click(); return true
    })()
  `)
  await wait(1200)
  say('delete confirmed', delDone)
  say('new row gone', await js(`
    ![...document.querySelectorAll('.proj-row')].some(r => r.innerText.includes('内部孵化'))
  `))
  say('proj rows final', await js(`document.querySelectorAll('.proj-row').length`))
  shot('shot-proj-8-deleted.png', (await win.webContents.capturePage()).toPNG())

  // ── 7. 有包项目的删除确认（应出现二选一去向）─────────
  const packProj = await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => {
        const n = Number(x.querySelector('.n')?.innerText || 0)
        return n > 0
      })
      if (!r) return null
      r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      return r.querySelector('.pname')?.innerText || null
    })()
  `)
  await wait(500)
  say('picked project w/ packs', JSON.stringify(packProj))
  const delOpened2 = await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => Number(x.querySelector('.n')?.innerText || 0) > 0)
      const b = r?.querySelector('.mini.danger')
      if (!b) return false
      b.click(); return true
    })()
  `)
  await wait(800)
  say('delete(has packs) modal', delOpened2)
  say('radio-line count', await js(`document.querySelectorAll('.radio-line').length`))
  say('has move option', await js(`(document.querySelector('.modal')?.innerText||'').includes('转移')`))
  say('has unassigned option', await js(`(document.querySelector('.modal')?.innerText||'').includes('未归属')`))
  shot('shot-proj-9-delwithpacks.png', (await win.webContents.capturePage()).toPNG())
  await js(`[...document.querySelectorAll('.modal .btn')].find(x => /取消/.test(x.textContent))?.click()`)
  await wait(600)

  // ── 8. 文件视图 + 新建包弹窗（项目下拉读新表）────────
  const switched = await js(`
    (() => {
      const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.includes('文件视图'));
      if (b) { b.click(); return true }
      return false
    })()
  `)
  await wait(1500)
  say('switched to files view', switched)
  shot('shot-proj-10-files.png', (await win.webContents.capturePage()).toPNG())

  const newOpened = await js(`
    (() => {
      const b = [...document.querySelectorAll('.btn')].find(x => x.textContent.includes('新建任务包'));
      if (b) { b.click(); return true }
      return false
    })()
  `)
  await wait(1000)
  say('new-pack modal opened', newOpened)
  say('new-pack project options', JSON.stringify(await js(`
    [...document.querySelectorAll('.modal select option')].map(o => o.textContent)
  `)))
  shot('shot-proj-11-newpack.png', (await win.webContents.capturePage()).toPNG())

  console.log('\n===UI-CHECK===')
  console.log(log.join('\n'))
  console.log('---')
  console.log('console errors:', errs.length ? errs.join('\n') : '(none)')
  console.log('===END===')
  app.exit(0)
})
