/**
 * 把在线表格「改成」列的内容回填进 src/shared/copy.ts。
 *
 * 用法：
 *   node apply_copy.cjs            干跑（只报告）
 *   node apply_copy.cjs --write    真写回
 *
 * 输入：_changes.json（由 diff_copy.cjs 产出）
 * 排除：HOLD 里的 key 一律不动（人工确认后才能放行）
 */
const fs = require('fs')
const path = require('path')

const DIR = __dirname
const COPY_TS = path.join(__dirname, '..', '..', 'src', 'shared', 'copy.ts')
const WRITE = process.argv.includes('--write')

// ⚠ 批量替换疑似误伤，挂起不应用，等用户确认
const HOLD = new Map([
  ['top.viewPacks', '「任务试图」——「视图」被写成「试图」'],
  ['toast.projectUnbindConfirmB', '「任务括任务视图」——「包括」的「包」被连带替换了']
])

const ts = require('typescript')

// ———— 读源码 ————
const sf = ts.createSourceFile(COPY_TS, fs.readFileSync(COPY_TS, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const src = sf.text

// ———— 定位 COPY 对象 ————
function unwrap(e) {
  let c = e
  for (;;) {
    if (!c) return null
    if (ts.isAsExpression(c) || ts.isParenthesizedExpression(c) || ts.isSatisfiesExpression?.(c)) { c = c.expression; continue }
    return c
  }
}
function propName(p) {
  if (!p || !p.name) return null
  return ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null
}

let copyObj = null
ts.forEachChild(sf, function walk(n) {
  if (ts.isVariableStatement(n)) {
    for (const d of n.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === 'COPY') copyObj = unwrap(d.initializer)
    }
  }
  if (!copyObj) ts.forEachChild(n, walk)
})
if (!copyObj || !ts.isObjectLiteralExpression(copyObj)) {
  console.error('❌ 找不到 COPY 对象')
  process.exit(1)
}

// key → { node(值节点), group, prop }
const index = new Map()
for (const g of copyObj.properties) {
  const gname = propName(g)
  if (!gname || !ts.isPropertyAssignment(g)) continue
  const gv = unwrap(g.initializer)
  if (!gv || !ts.isObjectLiteralExpression(gv)) continue
  for (const p of gv.properties) {
    const pname = propName(p)
    if (!pname || !ts.isPropertyAssignment(p)) continue
    index.set(`${gname}.${pname}`, { node: unwrap(p.initializer), key: `${gname}.${pname}`, group: gname })
  }
}
console.log(`字典条目 ${index.size} 条`)

// ———— 读变更 ————
const plan = JSON.parse(fs.readFileSync(path.join(DIR, '_changes.json'), 'utf-8'))
const changed = plan.changed

// ———— 生成字符串字面量 ——
function quote(s) {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '') + "'"
}

const edits = []
const held = []
const missing = []
const already = []

for (const c of changed) {
  if (HOLD.has(c.key)) { held.push(c); continue }
  const ent = index.get(c.key)
  if (!ent) { missing.push(c); continue }
  if (c.old === c.new) { already.push(c); continue }
  // 二次核验：字典里现在的值必须 == 表格里的「旧值」，否则拒绝（防止对错行）
  const cur = ts.isStringLiteral(ent.node) ? ent.node.text : null
  if (cur !== null && cur !== c.old) {
    console.log(`  ⚠ 值不符，跳过 ${c.key}\n     字典现在: ${cur}\n     表格旧值: ${c.old}`)
    missing.push(c)
    continue
  }
  edits.push({ key: c.key, start: ent.node.getStart(sf), end: ent.node.getEnd(), text: quote(c.new), rec: c })
}

console.log(`\n待改 ${edits.length} 条 / 挂起 ${held.length} 条 / 异常跳过 ${missing.length} 条`)

if (held.length) {
  console.log('\n【挂起（人工确认后再放行）】')
  for (const h of held) console.log(`  ${h.key}: ${HOLD.get(h.key)}`)
}
if (missing.length) {
  console.log('\n【异常跳过】')
  for (const m of missing) console.log(`  ${m.key}: ${m.old} → ${m.new}`)
}

if (!edits.length) { console.log('\n没有需要写回的改动。'); process.exit(0) }

// ———— 从后往前应用 ————
edits.sort((a, b) => b.start - a.start)
let out = src
for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)

// ———— 自检：重新解析，核对 ————
const sf2 = ts.createSourceFile(COPY_TS, out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
let copyObj2 = null
ts.forEachChild(sf2, function walk(n) {
  if (ts.isVariableStatement(n)) {
    for (const d of n.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === 'COPY') copyObj2 = unwrap(d.initializer)
    }
  }
  if (!copyObj2) ts.forEachChild(n, walk)
})
const index2 = new Map()
for (const g of copyObj2.properties) {
  const gname = propName(g)
  if (!gname || !ts.isPropertyAssignment(g)) continue
  const gv = unwrap(g.initializer)
  if (!gv || !ts.isObjectLiteralExpression(gv)) continue
  for (const p of gv.properties) {
    const pname = propName(p)
    if (!pname || !ts.isPropertyAssignment(p)) continue
    index2.set(`${gname}.${pname}`, unwrap(p.initializer))
  }
}

const fails = []
if (index2.size !== index.size) fails.push(`条目数变了：${index.size} → ${index2.size}`)
for (const e of edits) {
  const v = index2.get(e.key)
  const got = v && ts.isStringLiteral(v) ? v.text : null
  if (got !== e.rec.new) fails.push(`${e.key} 回填后=${JSON.stringify(got)} 期望=${JSON.stringify(e.rec.new)}`)
}
// 未在改动清单里的条目必须一字不变
const editKeys = new Set(edits.map((e) => e.key))
for (const [k, v] of index) {
  if (editKeys.has(k)) continue
  const v2 = index2.get(k)
  const a = ts.isStringLiteral(v.node) ? v.node.text : null
  const b = v2 && ts.isStringLiteral(v2) ? v2.text : null
  if (a !== b) fails.push(`不该变的条目变了：${k}  ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
}

if (fails.length) {
  console.log('\n❌ 自检失败，拒绝写回：')
  for (const f of fails.slice(0, 20)) console.log('   ' + f)
  process.exit(1)
}
console.log('\n✅ 自检通过：条目总数不变、每条新值精确匹配、其余条目一字未动')

if (!WRITE) { console.log('\n（干跑，未写盘。加 --write 生效）'); process.exit(0) }

fs.writeFileSync(COPY_TS, out, 'utf-8')
console.log(`\n已写回 ${COPY_TS}`)

// 落一份变更清单
fs.writeFileSync(
  path.join(DIR, '_applied.json'),
  JSON.stringify({ applied: edits.map((e) => ({ key: e.key, old: e.rec.old, new: e.rec.new })), held: held.map((h) => ({ key: h.key, old: h.old, new: h.new, why: HOLD.get(h.key) })) }, null, 1),
  'utf-8'
)
console.log('→ _applied.json')
