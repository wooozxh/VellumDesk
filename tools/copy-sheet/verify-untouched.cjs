/*
 * 「抽字典 / 接 Rich」前后 —— 整屏文字逐字比对
 *
 * 口径：
 *   ① *.txt      = document.body.innerText（可见文字，最接近用户看到的）
 *   ② *.all.txt  = 全文字节点的 textContent（与 CSS 完全无关，排除"某块被藏起来"的干扰）
 *   两份目录里同名文件必须逐字节相等；多出/少了文件也算差异。
 *
 * 附带：两次构建产物 CSS 去掉换行后逐字节比对（排除 CR/LF 干扰，验证样式没变）。
 */
const fs = require('fs')
const path = require('path')

/**
 * 屏蔽「非文案」的动态内容：测试夹具每次落盘的文件修改时间会变，
 * 而界面会把 mtime 显示出来（"3 B · 2026-09-30 16:13"）。
 * 这些字不是软件文案，比对时必须掩掉，否则每跑一次都会假报差异。
 */
function mask(s) {
  return s
    .replace(/\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?/g, '«TS»')
    .replace(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/g, '«TS»')
    .replace(/\d{1,2}:\d{2}:\d{2}/g, '«T»')
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, '«D»')
}

function readAll(dir) {
  const m = new Map()
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.txt')) m.set(f, mask(fs.readFileSync(path.join(dir, f), 'utf-8')))
  }
  return m
}

function diffLines(a, b) {
  const A = a.split('\n')
  const B = b.split('\n')
  const out = []
  const n = Math.max(A.length, B.length)
  for (let i = 0; i < n; i++) {
    if (A[i] !== B[i]) out.push({ line: i + 1, before: A[i], after: B[i] })
  }
  return out
}

function compare(beforeDir, afterDir, label) {
  const A = readAll(beforeDir)
  const B = readAll(afterDir)
  const names = [...new Set([...A.keys(), ...B.keys()])].sort()

  let same = 0
  let diff = 0
  let missing = 0
  const details = []

  for (const n of names) {
    if (!A.has(n)) {
      missing++
      details.push(`  ⚠ 只在新版有：${n}`)
      continue
    }
    if (!B.has(n)) {
      missing++
      details.push(`  ⚠ 只在旧版有：${n}`)
      continue
    }
    if (A.get(n) === B.get(n)) {
      same++
      continue
    }
    diff++
    const d = diffLines(A.get(n), B.get(n))
    details.push(`  ❌ ${n}  （${d.length} 行不同，共 ${d.length ? '' : ''}）`)
    for (const x of d.slice(0, 6)) {
      details.push(`       第 ${x.line} 行`)
      details.push(`         旧: ${JSON.stringify(x.before)}`)
      details.push(`         新: ${JSON.stringify(x.after)}`)
    }
    if (d.length > 6) details.push(`         …还有 ${d.length - 6} 行`)
  }

  console.log(`\n===== ${label} =====`)
  console.log(`屏幕状态 ${names.length} 个：逐字相同 ${same}  不同 ${diff}  缺文件 ${missing}`)
  if (details.length) console.log(details.join('\n'))
  console.log(diff === 0 && missing === 0 ? `✅ ${label} 全部逐字一致` : `❌ ${label} 存在差异`)
  return diff === 0 && missing === 0
}

const JUNK = 'D:/_accept_ws/_junk'
// 目录可用命令行覆盖：node verify-untouched.cjs <dump前目录> <dump后目录>
const _argv = process.argv.slice(2)
let ok = true
// 两份目录里同时含 *.txt（可见文字）和 *.all.txt（全部文字节点），一次比对覆盖两种口径
ok = compare(_argv[0] || path.join(JUNK, 'dump_before2'), _argv[1] || path.join(JUNK, 'dump_after'), '①② 可见文字 + 全部文字节点')

// ② CSS 去换行比对（换行符不是「用户看到的字」，其余必须逐字节相同）
const cssDir = path.join(JUNK, 'css')
if (fs.existsSync(cssDir)) {
  const files = fs.readdirSync(cssDir)
  const befores = files.filter((f) => f.startsWith('before_'))
  const afters = files.filter((f) => f.startsWith('after_'))
  console.log('\n===== ② 构建产物 CSS（去换行后逐字节比对）=====')
  if (befores.length === 1 && afters.length === 1) {
    const A = fs.readFileSync(path.join(cssDir, befores[0]), 'utf-8').replace(/\r\n/g, '\n')
    const B = fs.readFileSync(path.join(cssDir, afters[0]), 'utf-8').replace(/\r\n/g, '\n')
    console.log(`  before=${befores[0]}  去CR后 ${A.length} 字节`)
    console.log(`  after =${afters[0]}  去CR后 ${B.length} 字节`)
    console.log(A === B ? '  ✅ CSS 内容完全一致' : '  ❌ CSS 内容不一致（样式被动过）')
    ok = A === B && ok
  } else {
    console.log(`  （文件配对失败：before ${befores.length} 个 / after ${afters.length} 个）`)
    ok = false
  }
}

console.log('\n' + (ok ? '════ 结论：改造前后界面文字一字不差 ════' : '════ 结论：存在差异，见上 ════'))
process.exit(ok ? 0 : 1)
