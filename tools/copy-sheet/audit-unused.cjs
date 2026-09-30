/* 找出 copy.ts 里定义了、但源码里没有任何 COLL 引用的条目 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const COPY_TS = path.join(ROOT, 'src/shared/copy.ts')

const src = fs.readFileSync(COPY_TS, 'utf-8').split(/\r?\n/)

/** 收集 key：形如 `  group: {` 与 `      key: ...`（两空格缩进=组，六空格=条目） */
const groups = []
let cur = null
for (const line of src) {
  let m = line.match(/^ {2}([A-Za-z][\w]*):\s*\{\s*$/)
  if (m) {
    cur = { name: m[1], keys: [] }
    groups.push(cur)
    continue
  }
  if (cur && /^ {2}\}/.test(line)) {
    cur = null
    continue
  }
  m = line.match(/^ {4}([A-Za-z][\w]*):/)
  if (m && cur) cur.keys.push(m[1])
}

/** 扫源码里所有 COPY.xxx.yyy 引用 */
const files = []
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(name) && p !== COPY_TS) files.push(p)
  }
}
walk(path.join(ROOT, 'src'))

const used = new Set()
for (const f of files) {
  const t = fs.readFileSync(f, 'utf-8')
  for (const m of t.matchAll(/COPY\.([A-Za-z]\w*)\.([A-Za-z]\w*)/g)) used.add(`${m[1]}.${m[2]}`)
  for (const m of t.matchAll(/COPY(?:\.[A-Za-z]\w*){2,}/g)) used.add(m[0].split('.').slice(1).join('.'))
}

let total = 0
const rows = []
for (const g of groups) {
  for (const k of g.keys) {
    total++
    if (!used.has(`${g.name}.${k}`)) rows.push(`${g.name}.${k}`)
  }
}
console.log(`字典条目总数: ${total}`)
console.log(`已被引用: ${total - rows.length}`)
console.log(`未被引用: ${rows.length}`)
for (const r of rows) console.log('  ' + r)
