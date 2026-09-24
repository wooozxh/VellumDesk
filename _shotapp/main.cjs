// 临时验收 App：启动真实界面 → 截图 + 抓界面文本 + 抓控制台错误
// 放在 _shotapp/ 下并带 package.json，这样 Electron 才把它当主进程入口
const { app, BrowserWindow } = require('electron')

// 无头/沙箱环境：禁用 GPU 硬件加速，改用软件渲染，否则 GPU 进程会崩
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')
const { writeFileSync, mkdirSync } = require('fs')
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

  const errs = []
  const userData = app.getPath('userData')
  const root = getWorkspaceRoot(userData)
  initWorkspace(root)

  // 给「元信息展示」准备真实素材：已知尺寸的 PNG（文件名直接写死尺寸，便于人工核对）
  try {
    const packDir = join(root, '元信息演示包')
    mkdirSync(join(packDir, '01-成品'), { recursive: true })
    mkdirSync(join(packDir, '02-素材'), { recursive: true })
    mkdirSync(join(packDir, '03-工程'), { recursive: true })
    // 用 sharp 造两张不同尺寸的真图
    const sharp = require('sharp')
    await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: { r: 79, g: 140, b: 255 } }
    })
      .png()
      .toFile(join(packDir, '01-成品', '横版海报-1920x1080.png'))
    await sharp({
      create: { width: 800, height: 1200, channels: 4, background: { r: 63, g: 185, b: 80, alpha: 1 } }
    })
      .png()
      .toFile(join(packDir, '02-素材', '竖版素材-800x1200.png'))
    writeFileSync(join(packDir, '03-工程', '说明.txt'), '第 2 批元信息展示用', 'utf-8')
  } catch (e) {
    errs.push('准备素材失败：' + e.message)
  }

  scanAll(root)
  registerIpc()

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

  const jsRaw = (code) => win.webContents.executeJavaScript(code)
  // 包一层：任何一步失败都只记录不中断，保证后面的截图和汇总照常出
  const js = async (code) => {
    try {
      return await jsRaw(code)
    } catch (e) {
      return '__JSERR__ ' + (e && e.message ? e.message : String(e))
    }
  }

  await win.loadFile(join(ROOT, 'out/renderer/index.html'))
  await wait(2600)

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
  await wait(400)
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
  await wait(600)
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
      const r = Array.from(document.querySelectorAll('.proj-row')).find(x => x.innerText.includes(${JSON.stringify(name)}))
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
  await wait(400)
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
  await wait(400)
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
  await wait(400)

  // ── 6. 点删除按钮 → 确认弹窗（无包时应可直接删）─────
  await js(`document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  await wait(300)
  await hoverRow('内部孵化')
  await wait(400)
  const delOpened = await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => x.innerText.includes('内部孵化'))
      const b = r?.querySelector('.mini.danger')
      if (!b) return false
      b.click(); return true
    })()
  `)
  await wait(400)
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
  await wait(600)
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
  await wait(400)
  say('picked project w/ packs', JSON.stringify(packProj))
  const delOpened2 = await js(`
    (() => {
      const r = [...document.querySelectorAll('.proj-row')].find(x => Number(x.querySelector('.n')?.innerText || 0) > 0)
      const b = r?.querySelector('.mini.danger')
      if (!b) return false
      b.click(); return true
    })()
  `)
  await wait(400)
  say('delete(has packs) modal', delOpened2)
  say('radio-line count', await js(`document.querySelectorAll('.radio-line').length`))
  say('has move option', await js(`(document.querySelector('.modal')?.innerText||'').includes('转移')`))
  say('has unassigned option', await js(`(document.querySelector('.modal')?.innerText||'').includes('未归属')`))
  shot('shot-proj-9-delwithpacks.png', (await win.webContents.capturePage()).toPNG())
  await js(`[...document.querySelectorAll('.modal .btn')].find(x => /取消/.test(x.textContent))?.click()`)
  await wait(400)

  // ── 8. 文件视图 + 新建包弹窗（项目下拉读新表）────────
  const switched = await js(`
    (() => {
      const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.includes('文件视图'));
      if (b) { b.click(); return true }
      return false
    })()
  `)
  await wait(700)
  say('switched to files view', switched)
  shot('shot-proj-10-files.png', (await win.webContents.capturePage()).toPNG())

  const newOpened = await js(`
    (() => {
      const b = [...document.querySelectorAll('.btn')].find(x => x.textContent.includes('新建任务包'));
      if (b) { b.click(); return true }
      return false
    })()
  `)
  await wait(500)
  say('new-pack modal opened', newOpened)
  say('new-pack project options', JSON.stringify(await js(`
    [...document.querySelectorAll('.modal select option')].map(o => o.textContent)
  `)))
  shot('shot-proj-11-newpack.png', (await win.webContents.capturePage()).toPNG())

  // ── 9. 项目排序：悬浮出 ↑↓，点一下换位 ──────────────
  await js(`document.querySelector('.modal .close')?.click()`)
  await js(`[...document.querySelectorAll('.modal .btn')].find(x => /取消/.test(x.textContent))?.click()`)
  await wait(500)
  await js(`
    (() => {
      const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.includes('包视图'))
      b?.click()
    })()
  `)
  await wait(700)
  await js(`document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  await wait(300)

  const orderBefore = await js(`[...document.querySelectorAll('.proj-row .pname')].map(e => e.innerText)`)
  say('order before', JSON.stringify(orderBefore))

  // 悬浮第三行，检查 ↑↓ 出现且首位/末位禁用态正确
  const thirdName = orderBefore[2]
  await js(`
    (() => {
      const r = Array.from(document.querySelectorAll('.proj-row'))[2]
      r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })()
  `)
  await wait(400)
  say('mini count on 3rd row', await js(`
    Array.from(document.querySelectorAll('.proj-row'))[2].querySelectorAll('.mini').length
  `))
  say('mini titles', JSON.stringify(await js(`
    Array.from(Array.from(document.querySelectorAll('.proj-row'))[2].querySelectorAll('.mini')).map(b => b.title + (b.disabled ? '(禁用)' : ''))
  `)))
  shot('shot-sort-1-hover-arrows.png', (await win.webContents.capturePage()).toPNG())

  // 检查首位 ↑ 禁用、末位 ↓ 禁用
  await js(`
    (() => {
      document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const rows = Array.from(document.querySelectorAll('.proj-row'))
      rows[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })()
  `)
  await wait(400)
  say('first row up disabled', await js(`
    Array.from(document.querySelectorAll('.proj-row'))[0].querySelector('.mini').disabled
  `))
  await js(`
    (() => {
      document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const rows = [...document.querySelectorAll('.proj-row')]
      rows[rows.length-1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })()
  `)
  await wait(400)
  say('last row down disabled', await js(`
    (() => {
      const rows = [...document.querySelectorAll('.proj-row')]
      const bs = Array.from(rows[rows.length-1].querySelectorAll('.mini'))
      return bs[1].disabled
    })()
  `))

  // 点第三行的 ↑，应上移一位
  await js(`
    (() => {
      document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const rows = Array.from(document.querySelectorAll('.proj-row'))
      rows[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })()
  `)
  await wait(400)
  const clickedUp = await js(`
    (() => {
      const b = Array.from(document.querySelectorAll('.proj-row'))[2].querySelector('.mini')
      if (!b || b.disabled) return false
      b.click(); return true
    })()
  `)
  await wait(900)
  const orderAfter = await js(`[...document.querySelectorAll('.proj-row .pname')].map(e => e.innerText)`)
  say('clicked up arrow', clickedUp)
  say('order after up', JSON.stringify(orderAfter))
  say(
    'swapped correctly',
    orderAfter[1] === thirdName && orderAfter[2] === orderBefore[1]
  )
  shot('shot-sort-2-after-up.png', (await win.webContents.capturePage()).toPNG())

  // 点↓ 移回去
  await js(`
    (() => {
      document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const rows = Array.from(document.querySelectorAll('.proj-row'))
      rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })()
  `)
  await wait(400)
  await js(`
    (() => {
      const bs = Array.from(Array.from(document.querySelectorAll('.proj-row'))[1].querySelectorAll('.mini'))
      bs[1]?.click()
    })()
  `)
  await wait(600)
  const orderBack = await js(`[...document.querySelectorAll('.proj-row .pname')].map(e => e.innerText)`)
  say('order after down', JSON.stringify(orderBack))
  say('reversible', JSON.stringify(orderBack) === JSON.stringify(orderBefore))
  shot('shot-sort-3-after-down.png', (await win.webContents.capturePage()).toPNG())

  // ── 10. 第 2 批：文件列表的媒体信息行 ──────────────
  await js(`document.querySelector('.modal .close')?.click()`)
  await js(`[...document.querySelectorAll('.modal .btn')].find(x => /取消/.test(x.textContent))?.click()`)
  await wait(400)

  // 先点一次「刷新扫描」，走完整 IPC 链路触发元信息采集（与用户操作一致）
  const refreshed = await js(`
    (() => {
      const b = [...document.querySelectorAll('.btn')].find(x => x.textContent.includes('刷新扫描'))
      if (!b) return false
      b.click(); return true
    })()
  `)
  await wait(3000)
  say('clicked refresh scan', refreshed)

  await js(`
    (() => {
      const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.includes('文件视图'))
      b?.click()
    })()
  `)
  await wait(1400)
  say('meta line count', await js(`document.querySelectorAll('.file-row .fp .meta').length`))
  const metaDump = await js(`
    [...document.querySelectorAll('.file-row')].map(r => {
      const fn = r.querySelector('.fn')?.innerText || ''
      const meta = r.querySelector('.fp .meta')?.innerText || ''
      return fn + '  →  ' + meta
    })
  `)
  say('meta lines', JSON.stringify(metaDump))
  shot('shot-b2-meta.png', (await win.webContents.capturePage()).toPNG())

  // 逐条核对：文件名里写死的尺寸应与界面显示的一致
  const checks = (metaDump || []).map((s) => {
    const m = s.match(/^(.+?)\s+→\s+(.+)$/)
    if (!m) return { ok: false, s }
    const hint = m[1].match(/(\d+)x(\d+)/)
    if (!hint) return { ok: true, s, note: '无尺寸提示，跳过' }
    const expect = hint[1] + '×' + hint[2]
    return { ok: m[2].includes(expect), s, expect }
  })
  const sized = checks.filter((c) => c.expect)
  say('size cross-check', sized.map((c) => (c.ok ? 'OK' : 'MISMATCH') + ' ' + c.expect).join(' | ') || '(无带尺寸的文件名)')
  say('all sizes match', sized.length > 0 && sized.every((c) => c.ok))

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
