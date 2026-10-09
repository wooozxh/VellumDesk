#!/usr/bin/env node
/**
 * 用户使用手册 · 一致性体检（tools/manual/check.cjs）
 *
 * 解决的问题：软件更新后，手册里「没跟着改的部分」会悄悄和软件对不上。
 * 眼睛看不出来（手册自己长得挺一致），但它已经开始骗人了。
 *
 * 这个脚本用机器兜住六件事（都是"能自动判对错"的）：
 *   ① 版本号     —— 手册封面标的软件版本 vs package.json
 *   ② 目录对账   —— 目录里每条链接都点得动；正文每个小节都进得了目录
 *   ③ 图片       —— 引用的图都在磁盘上；哪些图白拍了
 *   ④ 标签配对   —— HTML 结构没被手改坏
 *   ⑤ 类名白名单 —— 正文用的 class 都在样式段里定义过（防打错类名 → 静默丢样式）
 *   ⑥ 按钮名     —— 手册里 <span class="btnchip"> 写的按钮名，软件字典里还有没有
 *   ⑦ 产物新鲜度 —— PDF / 单文件版是不是比 index.html 旧（旧了就是忘了重新生成）
 *
 * 用法：
 *   node tools/manual/check.cjs
 *
 * 退出码：0 = 没问题；1 = 有必须处理的项。
 * 注意：**只读**。它不改手册、不改代码，只报告。
 */
'use strict'
const { readFileSync, existsSync, statSync, readdirSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..', '..')
const MAN = join(ROOT, 'docs', 'manual')
const HTML_PATH = join(MAN, 'index.html')
const SINGLE_PATH = join(MAN, 'Vellum工作台-使用手册（单文件）.html')
const PDF_PATH = join(MAN, 'Vellum工作台-使用手册.pdf')
const IMG_DIR = join(MAN, 'images')
const CSS_PATH = join(MAN, 'manual.css')
const SG_PATH = join(MAN, 'styleguide.html')
const COPY_TS = join(ROOT, 'src', 'shared', 'copy.ts')
const PKG_JSON = join(ROOT, 'package.json')
const IGNORE_JSON = join(__dirname, 'check-ignore.json')

const problems = []
const warns = []
const line = (s) => process.stdout.write(s + '\n')
const head = (n, t) => line('\n' + n + ' ' + t + '\n' + '-'.repeat(60))
const pass = (m) => line('  [OK]  ' + m)
const fail = (m) => {
  problems.push(m)
  line('  [!!]  ' + m)
}
const warn = (m) => {
  warns.push(m)
  line('  [~~]  ' + m)
}
const info = (m) => line('  [--]  ' + m)

// ---------------------------------------------------------------- 读手册
if (!existsSync(HTML_PATH)) {
  line('\n找不到手册：' + HTML_PATH)
  line('（手册产物刻意不入库，先做一份或确认路径）\n')
  process.exit(1)
}
const html = readFileSync(HTML_PATH, 'utf8')
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0)

line('\n手册一致性体检 —— ' + HTML_PATH)
line('（只读检查，不会改任何文件）')

// ---------------------------------------------------------------- ① 版本号
head('①', '版本号：手册标的软件版本 vs package.json')
{
  const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'))
  const m = html.match(/软件版本\s*([0-9]+\.[0-9]+\.[0-9]+)/)
  if (!m) {
    warn('手册里没找到「软件版本 X.Y.Z」字样 —— 封面是不是漏标了？')
  } else if (m[1] === pkg.version) {
    pass(`手册标的 v${m[1]} = package.json 的 v${pkg.version}`)
  } else {
    fail(`手册标的 v${m[1]} ≠ package.json 的 v${pkg.version} → 封面版本号要改`)
  }
}

// ---------------------------------------------------------------- ② 目录对账
head('②', '目录对账：目录 ↔ 正文小节')
{
  const tocStart = html.indexOf('<div class="tocfull">')
  const tocEnd = tocStart < 0 ? -1 : html.indexOf('</section>', tocStart)
  if (tocStart < 0 || tocEnd < 0) {
    fail('找不到目录块（<div class="tocfull">）—— 结构是不是被改了？')
  } else {
    const toc = html.slice(tocStart, tocEnd)
    const tocHrefs = [...toc.matchAll(/href="#([^"]+)"/g)].map((x) => x[1])
    const allIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]))
    const bodyIds = new Set(
      [...html.replace(toc, '').matchAll(/\sid="([^"]+)"/g)].map((x) => x[1])
    )
    const sectionIds = [...html.matchAll(/\sid="(s[0-9]+-[0-9]+)"/g)].map((x) => x[1])

    // 目录里的链接都要点得动
    const dead = tocHrefs.filter((h) => !allIds.has(h))
    if (dead.length) fail(`目录里有 ${dead.length} 条链接指不到东西：${dead.join(', ')}`)
    else pass(`目录 ${tocHrefs.length} 条链接全部指得到正文`)

    // 正文的小节都要进目录
    const notInToc = sectionIds.filter((s) => !tocHrefs.includes(s))
    if (notInToc.length)
      fail(`正文有 ${notInToc.length} 个小节没进目录（新增小节忘了加进目录）：${notInToc.join(', ')}`)
    else pass(`正文 ${sectionIds.length} 个小节全部在目录里`)

    // 章节头与"第N部分"的分组对得上（粗查）
    const chHeads = [...html.matchAll(/id="ch([0-9]+)"/g)].map((x) => Number(x[1]))
    const groups = [...toc.matchAll(/<div class="grp">([^<]*)</g)].length
    if (chHeads.length !== 6) warn(`正文有 ${chHeads.length} 个章头（<section class="chapterhead" id="chN">），预期 6`)
    else pass('6 个章头齐')

    // 小节编号连续性（1.1 / 1.2 …，跳号说明漏写）
    const byCh = {}
    for (const s of sectionIds) {
      const [c, n] = s.slice(1).split('-').map(Number)
      byCh[c] = byCh[c] || []
      byCh[c].push(n)
    }
    const gaps = []
    for (const c of Object.keys(byCh)) {
      const ns = byCh[c].sort((a, b) => a - b)
      for (let i = 1; i < ns.length; i += 1) {
        if (ns[i] !== ns[i - 1] + 1) gaps.push(`${c}.${ns[i - 1]}→${c}.${ns[i]}`)
      }
      if (ns[0] !== 1) gaps.push(`第 ${c} 章不是从 1 开始`)
    }
    if (gaps.length) warn(`小节编号不连续：${gaps.join(', ')}（跳号 = 可能漏删/漏写）`)
    else pass(`小节编号连续（${Object.keys(byCh).length} 章 / ${sectionIds.length} 节）`)
  }
}

// ---------------------------------------------------------------- ③ 图片
head('③', '图片：引用与实际')
{
  const refs = [
    ...new Set([...html.matchAll(/(?:src|href)="(images\/[^"]+)"/g)].map((x) => x[1]))
  ]
  const missing = refs.filter((r) => !existsSync(join(MAN, r.replace(/\//g, '\\'))))
  if (missing.length) fail(`${missing.length} 张图引用了但磁盘上没有：${missing.join(', ')}`)
  else pass(`引用 ${refs.length} 张图，全部在 images/ 里`)

  const logoRefs = refs.filter((r) => /logo/.test(r))
  if (logoRefs.length) info(`logo 相关：${logoRefs.join(', ')}`)

  if (existsSync(IMG_DIR)) {
    const onDisk = readdirSync(IMG_DIR).filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f))
    const used = new Set(refs.map((r) => r.split('/').pop()))
    const unused = onDisk.filter((f) => !used.has(f))
    if (unused.length) info(`images/ 里有 ${unused.length} 张没被引用（白拍的？）：${unused.slice(0, 8).join(', ')}${unused.length > 8 ? ' …' : ''}`)
    else pass('images/ 里没有闲置图')
  } else {
    fail('没有 images/ 目录')
  }
}

// ---------------------------------------------------------------- ④ 标签配对
head('④', 'HTML 结构：标签配对')
{
  const tags = ['section', 'div', 'table', 'figure', 'details', 'ol', 'ul', 'svg', 'p']
  let bad = 0
  for (const t of tags) {
    const o = [...html.matchAll(new RegExp('<' + t + '[\\s>]', 'g'))].length
    const c = [...html.matchAll(new RegExp('</' + t + '>', 'g'))].length
    if (o !== c) {
      fail(`<${t}> 开 ${o} / 闭 ${c} —— 不配对，结构坏了`)
      bad += 1
    }
  }
  if (!bad) pass('主要标签开闭全配对')
  const unclosed = /<\/?[a-z]+[^>]*$/.test(html.trim())
  if (unclosed) warn('文件末尾像是被截断了（最后一个标签没闭合）')
}

// ---------------------------------------------------------------- ⑤ 类名白名单
head('⑤', '类名白名单：正文用的 class 都得有样式')
{
  // 样式是**一份**（manual.css），手册与样板页共用 —— 改样式只改那一处
  const linked = /<link[^>]+href="manual\.css"/.test(html)
  if (!existsSync(CSS_PATH)) {
    fail('没有 manual.css —— 样式表丢了（手册会退化成裸 HTML）')
  } else if (!linked) {
    fail('index.html 没有引用 manual.css（是不是又写回内联 <style> 了？）')
  } else {
    pass('样式表 manual.css 就位，且被 index.html 引用')
  }

  const cssText = existsSync(CSS_PATH)
    ? readFileSync(CSS_PATH, 'utf8')
    : (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1]
  const defined = new Set([...cssText.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((x) => x[1]))
  // 纯结构性 / 只做 hook 用的类，允许没有可见样式
  const ALLOW = new Set([
    'in', 'tx', 'n', 'h', 'grp', 'lv3', 'on', 'cap', 'right', 'left',
    'badge', 'warn', 'danger', 'info', 'ok', 'anchor'
  ])

  // 手册 + 样板页都要干净 —— 样板页是模具，自己用错类名就没有说服力
  const pages = [['index.html', html]]
  if (existsSync(SG_PATH)) pages.push(['styleguide.html', readFileSync(SG_PATH, 'utf8')])
  for (const [name, src] of pages) {
    const body = src
      .replace(/<style>[\s\S]*?<\/style>/g, '')
      .replace(/<script>[\s\S]*?<\/script>/g, '')
    const used = new Set()
    for (const m of body.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/).filter(Boolean)) used.add(c)
    }
    const orphan = [...used].filter((c) => !defined.has(c) && !ALLOW.has(c))
    if (orphan.length) {
      fail(`${name} 用了样式表里没有的 class（打错了就静默丢样式，界面悄悄跑偏）：${orphan.join(', ')}`)
    } else {
      pass(`${name} 用的 ${used.size} 个 class 全部有定义（或属允许的结构类）`)
    }
  }
}

// ---------------------------------------------------------------- ⑥ 按钮名
head('⑥', '按钮名：手册写的 vs 软件字典（copy.ts）')
{
  const copySrc = readText(COPY_TS)
  if (!copySrc) {
    warn('读不到 src/shared/copy.ts —— 跳过（手册可能在另一台机器上单独维护）')
  } else {
    // 抽出字典里所有文案值（单/双引号，允许跨行）
    const values = []
    for (const m of copySrc.matchAll(/:\s*'([^']*)'/g)) values.push(m[1])
    for (const m of copySrc.matchAll(/:\s*"([^"]*)"/g)) values.push(m[1])
    const norm = (s) => s.replace(/\s+/g, ' ').trim()
    const dict = new Set(values.map(norm).filter(Boolean))
    // {name} 这类占位符 → 通配，这样"任务「XX」不在了"这种带实参的提示语也能对上
    const dictRe = [...dict].map(
      (v) =>
        new RegExp(
          '^' + norm(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[A-Za-z0-9_]+\\\}/g, '.+?') + '$'
        )
    )

    // 手册里当作"界面元素"标出来的：btnchip
    //
    // 手册为了让人"照着屏幕上找得到"，常把图标一起写上（如「📦 打包交付」「＋ 新建任务」、
    // 「✎ 编辑任务信息」），而字典里只有名字本身 → 比对前先剥掉前导的图标/符号。
    const stripIcon = (s) => norm(s).replace(/^[^\p{L}\p{N}]+/u, '').trim()
    const chips = [...new Set([...html.matchAll(/<span class="btnchip">([^<]*)<\/span>/g)].map((x) => norm(x[1])))]
    const chipsBare = [...new Set(chips.map(stripIcon).filter(Boolean))]
    // 人工确认过「不是软件界面元素」的（示例文字等），写进 check-ignore.json
    const ignore = new Set(
      existsSync(IGNORE_JSON)
        ? (JSON.parse(readFileSync(IGNORE_JSON, 'utf8')).btnchip || []).map(norm)
        : []
    )

    const matchOne = (c) => dict.has(c) || dictRe.some((r) => r.test(c))
    const hit = chipsBare.filter(matchOne)
    const miss = chipsBare.filter((c) => !matchOne(c) && !ignore.has(c))
    pass(`手册标了 ${chips.length} 个按钮名，其中 ${hit.length} 个能在字典里对上`)
    if (ignore.size) info(`（另有 ${ignore.size} 个在忽略清单里：${[...ignore].join(', ')}）`)
    if (miss.length) {
      fail(
        `${miss.length} 个按钮名在字典里找不到 —— 软件改名了？还是手册写错了？\n` +
          miss.map((m) => `         · 「${m}」`).join('\n')
      )
      info('确认其中某个确实不是界面元素 → 加进 tools/manual/check-ignore.json 的 btnchip 数组')
    } else {
      pass('没有对不上的按钮名')
    }
  }
}

// ---------------------------------------------------------------- ⑦ 产物新鲜度
head('⑦', '产物新鲜度：PDF / 单文件版跟得上 index.html 吗')
{
  const h = mtime(HTML_PATH)
  const stamp = (t) => (t ? new Date(t).toLocaleString('zh-CN') : '不存在')
  for (const [name, p] of [
    ['单文件便携版', SINGLE_PATH],
    ['A4 打印版 PDF', PDF_PATH]
  ]) {
    const t = mtime(p)
    if (!t) {
      warn(`${name} 不在（忘了生成？）`)
    } else if (t < h) {
      fail(`${name} 比 index.html 旧 —— 改完手册要重新生成这两份（${stamp(h)} → 产物 ${stamp(t)}）`)
    } else {
      pass(`${name} 是最新的`)
    }
  }
}

// ---------------------------------------------------------------- 汇总
line('\n' + '='.repeat(62))
if (!problems.length) {
  line(`全部通过 ✅  （${warns.length} 条提醒）`)
} else {
  line(`有 ${problems.length} 项要处理 ❌  （另有 ${warns.length} 条提醒）`)
}
line('='.repeat(62) + '\n')
process.exit(problems.length ? 1 : 0)
