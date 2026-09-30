/**
 * 对比「现在的文案」vs「改成」列，产出变更清单。
 * 输出：
 *   - _changes.json   真变化的行（编号 / 分组 / 出现在哪 / 旧 / 新）
 *   - _suspect.json   疑似误伤标记的行（标签或占位符结构变了）
 * 用法： node diff_copy.cjs
 */
const fs = require('fs')
const path = require('path')
const DIR = __dirname

const data = JSON.parse(fs.readFileSync(path.join(DIR, '_sheet_read.json'), 'utf-8'))

// —— 结构指纹：把文案里的「标记骨架」抽出来，用来判断批量替换有没有误伤 ——
//   <b>x</b>  →  标签名入栈
//   {n}      →  占位符名
function markFingerprint(s) {
  const tags = []
  const re = /<(\/?)(b|code|em|span|path)>|\{(\w+)\}/g
  let m
  while ((m = re.exec(s))) {
    if (m[3]) tags.push('{' + m[3] + '}')
    else tags.push((m[1] ? '/' : '') + m[2])
  }
  return tags.join(' ')
}

function markCounts(s) {
  const re = /<(\/?)(b|code|em|span|path)>|\{(\w+)\}/g
  const out = { open: 0, close: 0, ph: 0 }
  let m
  while ((m = re.exec(s))) {
    if (m[3]) out.ph++
    else if (m[1]) out.close++
    else out.open++
  }
  return out
}

// —— 不依赖标记的「裸文字」：把标记全去掉，只留用户看得见的字 ——
function bare(s) {
  return s
    .replace(/<\/?(b|code|em|span|path)>/g, '')
    .replace(/\{(\w+)\}/g, '\u0000$1\u0000')
}

const rows = data.sheet1.slice(1).filter((r) => r.some((x) => (x || '').trim() !== ''))
const changed = []
const suspects = []
const same = []
const blank = []

for (const r of rows) {
  const [seq, key, group, where, oldText, newText, note] = r
  const oldS = String(oldText || '')
  const newRaw = String(newText || '')

  if (newRaw.trim() === '') { blank.push({ seq, key }); continue }

  // 归一：表格里单元格内的换行、首尾空白不影响判断（文案本身没有换行）
  const newS = newRaw.replace(/\r\n/g, '\n')

  if (newS === oldS) { same.push({ seq, key }); continue }

  const oldFp = markFingerprint(oldS)
  const newFp = markFingerprint(newS)
  const oc = markCounts(oldS)
  const nc = markCounts(newS)

  const rec = { seq, key, group, where, old: oldS, new: newS, note: note || '' }

  const problems = []
  if (oldFp !== newFp) {
    problems.push(`标记结构变了\n      旧: ${oldFp || '(无)'}\n      新: ${newFp || '(无)'}`)
  }
  if (oc.open !== nc.open || oc.close !== nc.close) {
    problems.push(`标签配对变了（旧 ${oc.open}开/${oc.close}闭 → 新 ${nc.open}开/${nc.close}闭）`)
  }
  if (oc.ph !== nc.ph) {
    problems.push(`占位符个数变了（旧 ${oc.ph} → 新 ${nc.ph}）`)
  }
  // 裸文字相同但标记不同 → 几乎肯定是批量替换误伤
  if (bare(oldS) === bare(newS) && problems.length) {
    problems.push('★ 去掉标记后的文字完全一样 → 极可能是批量替换误伤，文字本身没改')
  }

  if (problems.length) {
    rec.problems = problems
    suspects.push(rec)
  } else {
    changed.push(rec)
  }
}

console.log('==== 比对结果 ====')
console.log(`数据行            ${rows.length}`)
console.log(`未填（保持原样）    ${blank.length}`)
console.log(`与原文一致（复制）  ${same.length}`)
console.log(`真变化             ${changed.length}`)
console.log(`疑似误伤标记       ${suspects.length}`)

if (changed.length) {
  console.log('\n==== 真变化的行 ====')
  for (const c of changed) {
    console.log(`\n[${c.seq}] ${c.key}  (${c.group})  ${c.where}`)
    console.log(`  旧: ${c.old}`)
    console.log(`  新: ${c.new}`)
  }
}

if (suspects.length) {
  console.log('\n==== 疑似误伤标记（需你确认）====')
  for (const c of suspects) {
    console.log(`\n[${c.seq}] ${c.key}  (${c.group})  ${c.where}`)
    console.log(`  旧: ${c.old}`)
    console.log(`  新: ${c.new}`)
    for (const p of c.problems) console.log(`  ⚠ ${p}`)
  }
}

fs.writeFileSync(path.join(DIR, '_changes.json'), JSON.stringify({ changed, suspects, sameCount: same.length, blank }, null, 1), 'utf-8')
console.log('\n→ _changes.json')
