/**
 * 扫描 copy.ts 里仍含「包」字的条目 —— 提示用户是否遗漏。
 * 只报告，不改动。
 */
const fs = require('fs')
const ts = require('typescript')
const P = require('path').join(__dirname, '..', '..', 'src', 'shared', 'copy.ts')
const sf = ts.createSourceFile(P, fs.readFileSync(P, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function unwrap(e) {
  let c = e
  for (;;) {
    if (!c) return null
    if (ts.isAsExpression(c) || ts.isParenthesizedExpression(c)) { c = c.expression; continue }
    return c
  }
}
function pn(p) { return p && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null }

let copyObj = null
ts.forEachChild(sf, function w(n) {
  if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === 'COPY') copyObj = unwrap(d.initializer)
  if (!copyObj) ts.forEachChild(n, w)
})

const hits = []
const all = []
for (const g of copyObj.properties) {
  const gn = pn(g)
  if (!gn || !ts.isPropertyAssignment(g)) continue
  const gv = unwrap(g.initializer)
  if (!gv || !ts.isObjectLiteralExpression(gv)) continue
  for (const p of gv.properties) {
    const k = pn(p)
    if (!k || !ts.isPropertyAssignment(p)) continue
    const v = unwrap(p.initializer)
    if (!ts.isStringLiteral(v)) { all.push([`${gn}.${k}`, '(非字符串字面量)']); continue }
    all.push([`${gn}.${k}`, v.text])
    if (v.text.includes('包')) hits.push([`${gn}.${k}`, v.text])
  }
}

console.log(`总条目 ${all.length}，仍含「包」字 ${hits.length} 条：\n`)
for (const [k, v] of hits) console.log(`  ${k}\n     ${v}`)
