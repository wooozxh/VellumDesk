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
// B-02：给测试壳 bundle 里的 thumbs 副本指路 FFmpeg（显式注入走不了，用环境变量兜底）
process.env.MEDIA_FFMPEG_DIR = join(ROOT, 'resources', 'ffmpeg')
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

  // B-02：FFmpeg 就位则造两个测试视频（横版 / 竖版），文件名写死时长便于核对
  // 用异步 spawn（沙箱拦 spawnSync；正式应用两种都行）
  let ffmpegOk = false
  try {
    const ff = join(ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe')
    if (require('fs').existsSync(ff)) {
      const { spawn } = require('child_process')
      const runFf = (args) =>
        new Promise((resolve) => {
          const c = spawn(ff, args, { windowsHide: true })
          const t = setTimeout(() => resolve(false), 60000)
          c.on('error', () => { clearTimeout(t); resolve(false) })
          c.on('close', (code) => { clearTimeout(t); resolve(code === 0) })
        })
      const vDir = join(root, '元信息演示包', '01-成品')
      mkdirSync(vDir, { recursive: true })
      // 横版 3 秒 640x360（LGPL 版无 libx264，用 libopenh264）
      const ok1 = await runFf(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=10',
        '-c:v', 'libopenh264', '-pix_fmt', 'yuv420p', '-y', join(vDir, '横版视频-3秒.mp4')])
      const vDir2 = join(root, '元信息演示包', '02-素材')
      mkdirSync(vDir2, { recursive: true })
      const ok2 = await runFf(['-f', 'lavfi', '-i', 'smptebars=duration=2:size=360x640:rate=10',
        '-c:v', 'libopenh264', '-pix_fmt', 'yuv420p', '-y', join(vDir2, '竖版视频-2秒.mp4')])
      ffmpegOk = ok1 && ok2
      if (!ffmpegOk) errs.push('FFmpeg 造视频失败（ok1=' + ok1 + ' ok2=' + ok2 + '）')
    }
  } catch (e) {
    errs.push('FFmpeg 环节异常：' + e.message)
  }
  say('ffmpeg video samples', ffmpegOk)

  // B-04：把用户的真实 PSD 样本复制进演示包（有才复制）
  let psdOk = false
  try {
    const PSD_SAMPLE = 'C:/Users/30873/Desktop/访学证.psd'
    if (require('fs').existsSync(PSD_SAMPLE)) {
      const pDir = join(root, '元信息演示包', '03-工程')
      mkdirSync(pDir, { recursive: true })
      require('fs').copyFileSync(PSD_SAMPLE, join(pDir, '访学证.psd'))
      psdOk = true
    }
  } catch (e) {
    errs.push('复制 PSD 样本失败：' + e.message)
  }
  say('psd sample copied', psdOk)

  // B-03：造一个 3 页演示 PDF（手工最小 PDF，图形按页变灰度）
  try {
    const pdfDir = join(root, '元信息演示包', '03-工程')
    mkdirSync(pdfDir, { recursive: true })
    const pages = 3
    const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ')
    const objs = []
    const count = pages * 2 + 2
    for (let i = 0; i < pages; i++) {
      const shade = (0.2 + i * 0.15).toFixed(2)
      const content = `q ${shade} ${shade} 1 rg 0 0 595 842 re f Q`
      objs[4 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
      objs[3 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << >> >>`
    }
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
    objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`
    let pdf = '%PDF-1.4\n'
    const offs = []
    for (let i = 1; i <= count; i++) {
      if (!objs[i]) continue
      offs[i] = Buffer.byteLength(pdf, 'latin1')
      pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`
    }
    const xref = Buffer.byteLength(pdf, 'latin1')
    pdf += `xref\n0 ${count + 1}\n0000000000 65535 f \n`
    for (let i = 1; i <= count; i++) {
      pdf += offs[i] ? `${String(offs[i]).padStart(10, '0')} 00000 n \n` : `0000000000 00000 f \n`
    }
    pdf += `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    writeFileSync(join(pdfDir, '演示文档-3页.pdf'), Buffer.from(pdf, 'latin1'))
  } catch (e) {
    errs.push('造演示 PDF 失败：' + e.message)
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
  say('has new-proj button', await js(`!!document.querySelector('.tp-manage-btn')`))
  say('new-proj label', JSON.stringify(await js(`document.querySelector('.tp-manage-btn')?.innerText || ''`)))
  say('tag panel dims', await js(`document.querySelectorAll('.tag-panel .tp-dim').length`))
  say('tag panel labels', JSON.stringify(await js(`
    [...document.querySelectorAll('.tag-panel .tp-dim-label')].map(e => e.innerText)
  `)))
  say('color dots', await js(`document.querySelectorAll('.proj-row .cdot').length`))
  say('dot colors', JSON.stringify(await js(`
    [...document.querySelectorAll('.proj-row .cdot')].map(d => getComputedStyle(d).backgroundColor)
  `)))

  // ── 2. 打开新建项目弹窗，检查色块 ─────────────────────
  await js(`
    (() => { document.querySelector('.tp-manage-btn')?.click() })()
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

  // ── 11. B-02 视频行：信息行应有 时长 + 编码，缩略图应是真图 ──
  const videoRows = (metaDump || []).filter((s) => /\.mp4|\.mov|\.mkv|\.avi|\.webm/i.test(s))
  say('video rows found', videoRows.length)
  say('video meta lines', JSON.stringify(videoRows))
  if (videoRows.length) {
    say(
      'video has duration',
      videoRows.every((s) => /00:0\d/.test(s))
    )
    say(
      'video has codec',
      videoRows.every((s) => /h264|hevc|vp9|av1/i.test(s))
    )
  }
  // 视频行缩略图：.pic 里应是 <img>（抽帧成功）而不是 .ext 占位块
  const videoThumbs = await js(`
    (() => {
      const rows = Array.from(document.querySelectorAll('.file-row')).filter(r => /\\.mp4|\\.mov|\\.mkv|\\.avi|\\.webm/i.test(r.querySelector('.fn')?.innerText || ''))
      return rows.map(r => ({
        name: r.querySelector('.fn')?.innerText,
        hasImg: !!r.querySelector('.pic img'),
        hasPlaceholder: !!r.querySelector('.pic .ext')
      }))
    })()
  `)
  say('video thumbs', JSON.stringify(videoThumbs))
  shot('shot-b2-video.png', (await win.webContents.capturePage()).toPNG())

  // ── 12. B-04 PSD 行：信息行应有画布尺寸 + 色彩模式，缩略图应是内嵌预览 ──
  const psdRows2 = (metaDump || []).filter((s) => /\.psd|\.psb/i.test(s))
  say('psd rows found', psdRows2.length)
  say('psd meta lines', JSON.stringify(psdRows2))
  if (psdRows2.length) {
    say(
      'psd has size',
      psdRows2.every((s) => /827×1181/.test(s))
    )
    say(
      'psd has mode',
      psdRows2.every((s) => /CMYK/.test(s))
    )
  }
  const psdThumbs = await js(`
    (() => {
      const rows = Array.from(document.querySelectorAll('.file-row')).filter(r => /\\.psd|\\.psb/i.test(r.querySelector('.fn')?.innerText || ''))
      return rows.map(r => ({
        name: r.querySelector('.fn')?.innerText,
        hasImg: !!r.querySelector('.pic img'),
        hasPlaceholder: !!r.querySelector('.pic .ext')
      }))
    })()
  `)
  say('psd thumbs', JSON.stringify(psdThumbs))
  shot('shot-b2-psd.png', (await win.webContents.capturePage()).toPNG())

  // ── 13. B-03 PDF 行：信息行应有页数，缩略图应是渲染的首页 ──
  const pdfRows2 = (metaDump || []).filter((s) => /\.pdf/i.test(s))
  say('pdf rows found', pdfRows2.length)
  say('pdf meta lines', JSON.stringify(pdfRows2))
  if (pdfRows2.length) {
    say(
      'pdf has pages',
      pdfRows2.every((s) => /3 页/.test(s))
    )
  }
  const pdfThumbs = await js(`
    (() => {
      const rows = Array.from(document.querySelectorAll('.file-row')).filter(r => /\\.pdf/i.test(r.querySelector('.fn')?.innerText || ''))
      return rows.map(r => ({
        name: r.querySelector('.fn')?.innerText,
        hasImg: !!r.querySelector('.pic img'),
        hasPlaceholder: !!r.querySelector('.pic .ext')
      }))
    })()
  `)
  say('pdf thumbs', JSON.stringify(pdfThumbs))
  shot('shot-b2-pdf.png', (await win.webContents.capturePage()).toPNG())

  // ── 14. 第 3 批：标签体系界面 ──────────────────────
  // 14.1 左栏维度面板：5 个维度都在
  say('b3 dim count', await js(`document.querySelectorAll('.tag-panel .tp-dim').length`))
  const dimKeys = await js(`
    [...document.querySelectorAll('.tag-panel .tp-dim')].map(d => ({
      label: d.querySelector('.tp-dim-label')?.innerText,
      tags: d.querySelectorAll('.tp-tag').length
    }))
  `)
  say('b3 dims', JSON.stringify(dimKeys))
  shot('shot-b3-1-panel.png', (await win.webContents.capturePage()).toPNG())

  // 14.2 展开类别维度看预制标签
  const catTags = await js(`
    (() => {
      const dims = [...document.querySelectorAll('.tag-panel .tp-dim')]
      const cat = dims.find(d => /类别/.test(d.querySelector('.tp-dim-label')?.innerText || ''))
      if (!cat) return null
      cat.querySelector('.tp-dim-head')?.click()
      return [...cat.querySelectorAll('.tp-tag-name')].map(e => e.innerText)
    })()
  `)
  await wait(300)
  say('b3 category tags', JSON.stringify(catTags))

  // 14.3 点一个标签 → 应进入文件视图并过滤
  const clicked = await js(`
    (() => {
      const dims = [...document.querySelectorAll('.tag-panel .tp-dim')]
      const cat = dims.find(d => /类别/.test(d.querySelector('.tp-dim-label')?.innerText || ''))
      const t = [...(cat?.querySelectorAll('.tp-tag') || [])].find(x => x.innerText.includes('海报'))
      if (!t) return null
      t.click()
      return t.innerText
    })()
  `)
  await wait(900)
  say('b3 clicked tag', JSON.stringify(clicked))
  say('b3 view switched to files', await js(`
    (() => {
      const b = [...document.querySelectorAll('.tabs button')].find(x => /文件/.test(x.textContent))
      return !!b && b.classList.contains('on')
    })()
  `))
  say('b3 badge on dim', await js(`document.querySelector('.tag-panel .tp-badge')?.innerText || null`))
  say('b3 clear button', await js(`document.querySelector('.tp-clear')?.innerText || null`))
  shot('shot-b3-2-filtered.png', (await win.webContents.capturePage()).toPNG())

  // 14.4 全部文件视图：勾选头几条 → 出现「打标签」按钮
  await js(`
    (() => {
      const b = [...document.querySelectorAll('.tabs button')].find(x => /文件/.test(x.textContent))
      b?.click()
    })()
  `)
  await wait(700)
  await js(`document.querySelector('.tp-clear')?.click()`)
  await wait(700)
  const rowCount = await js(`document.querySelectorAll('.file-row').length`)
  say('b3 file rows', rowCount)
  const checked = await js(`
    (() => {
      const cbs = [...document.querySelectorAll('.file-row .cb')].slice(0, 3)
      cbs.forEach(c => c.click())
      return cbs.length
    })()
  `)
  await wait(500)
  say('b3 checked rows', checked)
  say('b3 tag button visible', await js(`
    [...document.querySelectorAll('.claimbar .btn')].some(b => /打标签/.test(b.textContent))
  `))
  shot('shot-b3-3-selected.png', (await win.webContents.capturePage()).toPNG())

  // 14.5 打开打标签弹窗
  await js(`
    (() => {
      const b = [...document.querySelectorAll('.claimbar .btn')].find(x => /打标签/.test(x.textContent))
      b?.click()
    })()
  `)
  await wait(900)
  say('b3 picker open', await js(`!!document.querySelector('.tp-pick-body')`))
  say('b3 picker dims', await js(`document.querySelectorAll('.tp-pick-dim').length`))
  say('b3 picker title', JSON.stringify(await js(`document.querySelector('.modal h3')?.innerText || ''`)))
  say('b3 suggested star', await js(`document.querySelectorAll('.tp-star').length`))
  shot('shot-b3-4-picker.png', (await win.webContents.capturePage()).toPNG())

  // 14.6 选「海报」+「抖音」→ 贴上去
  const pickedTags = await js(`
    (() => {
      const out = []
      for (const kw of ['海报', '抖音']) {
        const t = [...document.querySelectorAll('.tp-pick-body .tp-tag')].find(x => x.innerText.includes(kw))
        if (t) { t.click(); out.push(kw) }
      }
      return out
    })()
  `)
  await wait(400)
  say('b3 picked in picker', JSON.stringify(pickedTags))
  say('b3 picked count text', JSON.stringify(await js(`document.querySelector('.tp-picked-n')?.innerText || ''`)))
  shot('shot-b3-5-picked.png', (await win.webContents.capturePage()).toPNG())

  await js(`
    (() => {
      const b = [...document.querySelectorAll('.modal .foot .btn')].find(x => /贴到/.test(x.textContent))
      b?.click()
    })()
  `)
  await wait(1200)
  say('b3 picker closed', await js(`!document.querySelector('.tp-pick-body')`))
  // 直接从库里核对
  say('b3 db rows', JSON.stringify((() => {
    try {
      const { openDb, getDb } = require(join(ROOT, 'out/test/db.cjs'))
      openDb(root)
      return getDb().prepare('SELECT at.asset_id, t.dimension, t.name FROM asset_tags at JOIN tags t ON t.id=at.tag_id ORDER BY at.asset_id').all()
    } catch (e) { return 'ERR ' + e.message }
  })()))
  say('b3 toast', JSON.stringify(await js(`
    [...document.querySelectorAll('.toast')].map(t => t.innerText)
  `)))

  // 14.7 行上应出现标签色块
  const rowTags = await js(`
    [...document.querySelectorAll('.file-row .row-tag')].map(t => t.innerText.replace('×','').trim())
  `)
  say('b3 row tag chips', JSON.stringify(rowTags))
  shot('shot-b3-6-applied.png', (await win.webContents.capturePage()).toPNG())

  // 14.8 标签管理弹窗
  await js(`
    (() => {
      const b = [...document.querySelectorAll('.tp-add')].find(x => /管理/.test(x.textContent))
      b?.click()
    })()
  `)
  await wait(600)
  say('b3 manager open', await js(`!!document.querySelector('.tm-dims')`))
  say('b3 manager dims', await js(`document.querySelectorAll('.tm-dim').length`))
  say('b3 manager rows', await js(`document.querySelectorAll('.tm-row').length`))
  say('b3 manager title', JSON.stringify(await js(`document.querySelector('.modal h3')?.innerText || ''`)))
  shot('shot-b3-7-manager.png', (await win.webContents.capturePage()).toPNG())

  // 14.9 在管理弹窗里加一个新标签
  await js(`
    (() => {
      const inp = document.querySelector('.tm-add input[type=text]')
      if (!inp) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, '验收专用标签')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await wait(300)
  await js(`
    (() => {
      const b = [...document.querySelectorAll('.tm-add .btn')].find(x => /添加/.test(x.textContent))
      b?.click()
    })()
  `)
  await wait(900)
  say('b3 tag added in manager', await js(`
    [...document.querySelectorAll('.tm-name')].some(e => e.innerText === '验收专用标签')
  `))
  await js(`document.querySelector('.modal .foot .btn')?.click()`)
  await wait(600)

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
