/*
 * 回填文案前后 —— 整屏文字比对（允许且仅允许「变更清单」里的改动）
 *
 * 口径：
 *   ① *.txt      = document.body.innerText（可见文字）
 *   ② *.all.txt  = 全文字节点 textContent（与 CSS 无关）
 *
 * 判定方式（不是靠眼看）：
 *   把「回填后」的每一行，按变更清单里的「新→旧」替换对反向还原；
 *   能还原成「回填前」→ 这行差异属预期；还原不了 → 未预期差异，判失败。
 */
const fs = require('fs')
const path = require('path')

const JUNK = 'D:/_accept_ws/_junk'
// 目录可用命令行覆盖：node verify-applied.cjs <改前dump目录> <改后dump目录>
const _argv = process.argv.slice(2)
const BEFORE = _argv[0] || path.join(JUNK, 'dump_after') // 上一轮：改造后、文案未改
const AFTER = _argv[1] || path.join(JUNK, 'dump_applied') // 本轮：回填用户改动后

function mask(s) {
  return s
    .replace(/\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?/g, '«TS»')
    .replace(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/g, '«TS»')
    .replace(/\d{1,2}:\d{2}:\d{2}/g, '«T»')
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, '«D»')
}
const plain = (s) => String(s).replace(/<\/?(b|code|em|span|path)>/g, '')

// ———— 变更清单 → 替换对（新片段 → 旧片段）————
const applied = JSON.parse(fs.readFileSync(path.join(__dirname, '_applied.json'), 'utf-8'))
const all = [
  ...applied.applied,
  // 手工修正的 2 条（表格里被批量替换误伤，按正确值应用）
  { key: 'top.viewPacks', old: '包视图', new: '任务视图' },
  { key: 'toast.projectUnbindConfirmB', old: '· 软件里（包括包视图、文件视图、统计）不再显示它\n', new: '· 软件里（包括任务视图、文件视图、统计）不再显示它\n' }
]

// 拆段依据：占位符 {x} 和 内联标记 <b>/<code>/<em>/<path>/<span>。
// 必须拆标记：textContent 口径下，DOM 会把一句话按标记切成多个独立文本节点，
// 整句在 dump 里根本找不到。注意用非捕获组 —— 带捕获组的 split 会把标签名也塞进结果。
const SPLIT = /\{\w+\}|<\/?(?:b|code|em|span|path)>/

const pairs = []
for (const c of all) {
  const rawO = String(c.old)
  const rawN = String(c.new)
  const oS = rawO.split(SPLIT).map((x) => x.trim()).filter((x) => x.length >= 2)
  const nS = rawN.split(SPLIT).map((x) => x.trim()).filter((x) => x.length >= 2)
  if (oS.length !== nS.length) {
    const o = rawO.trim()
    const n = rawN.trim()
    if (o !== n) pairs.push({ from: o, to: n, key: c.key })
    continue
  }
  for (let i = 0; i < oS.length; i++) {
    if (oS[i] !== nS[i]) pairs.push({ from: oS[i], to: nS[i], key: c.key })
  }
}
// 长的先替换，避免短片段抢先吃掉长片段
pairs.sort((a, b) => b.to.length - a.to.length)
console.log(`变更对 ${pairs.length} 组（来自 ${all.length} 条变更）`)

// 同一个「旧值」可能对应多个「新值」。判定时从「回填前」出发正向替换，
// 只要「回填后」在候选集合里，就说明这处差异仍在预期内。
// （反向还原不行：多轮替换会让后一轮把前一轮刚还原好的文本又改坏。）
const byFrom = new Map()
for (const p of pairs) {
  if (!byFrom.has(p.from)) byFrom.set(p.from, [])
  byFrom.get(p.from).push(p.to)
}
const byFromList = [...byFrom.entries()].sort((a, b) => b[0].length - a[0].length)

/** 把「回填前」的一行按变更清单正向替换出所有可能的写法（多候选，上限防爆） */
function forwardAll(line) {
  let cur = [line]
  for (const [from, tos] of byFromList) {
    const next = []
    for (const s of cur) {
      if (!s.includes(from)) {
        next.push(s)
        continue
      }
      for (const t of tos) next.push(s.split(from).join(t))
    }
    cur = next.slice(0, 64)
  }
  return cur
}

function readAll(dir) {
  const m = new Map()
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.txt')) m.set(f, mask(fs.readFileSync(path.join(dir, f), 'utf-8')))
  }
  return m
}

const A = readAll(BEFORE)
const B = readAll(AFTER)
const names = [...new Set([...A.keys(), ...B.keys()])].sort()

let identical = 0
let expected = 0
let unexpected = 0
let missing = 0
const bad = []
let expectedLines = 0

for (const n of names) {
  if (!A.has(n) || !B.has(n)) {
    missing++
    bad.push(`  ⚠ 文件缺失：${n}`)
    continue
  }
  const a = A.get(n).split('\n')
  const b = B.get(n).split('\n')
  if (A.get(n) === B.get(n)) {
    identical++
    continue
  }
  if (a.length !== b.length) {
    // 行数变了 → 逐行还原对不齐，直接列为未预期（人工看）
    unexpected++
    bad.push(`  ❌ ${n}：行数 ${a.length} → ${b.length}（结构变了）`)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        bad.push(`      第 ${i + 1} 行\n         旧: ${JSON.stringify(a[i])}\n         新: ${JSON.stringify(b[i])}`)
        if (bad.length > 60) break
      }
    }
    continue
  }
  let anyChange = false
  let allExpected = true
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    anyChange = true
    expectedLines++
    const cands = forwardAll(a[i])
    if (!cands.includes(b[i])) {
      allExpected = false
      bad.push(`  ❌ ${n} 第 ${i + 1} 行（按清单替换后对不上）\n         旧: ${JSON.stringify(a[i])}\n         新: ${JSON.stringify(b[i])}\n         候选: ${JSON.stringify(cands.slice(0, 3))}`)
      if (bad.length > 60) break
    }
  }
  if (!anyChange) identical++
  else if (allExpected) expected++
  else unexpected++
}

console.log(`\n===== 回填前 vs 回填后 =====`)
console.log(`屏幕状态 ${names.length} 个：完全一致 ${identical}  差异全部属预期 ${expected}  含未预期差异 ${unexpected}  文件缺失 ${missing}`)
console.log(`（共 ${expectedLines} 行发生预期内的文案替换）`)
if (bad.length) {
  console.log('\n未预期差异：')
  console.log(bad.slice(0, 60).join('\n'))
}
const ok = unexpected === 0 && missing === 0
console.log(
  ok
    ? '\n════ 结论：界面文字的改动「恰好」是清单里那批，没有一处意外变化 ════'
    : '\n════ 结论：存在未预期差异，见上 ════'
)
process.exit(ok ? 0 : 1)
