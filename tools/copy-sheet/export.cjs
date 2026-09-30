/*
 * 从 copy.ts 导出「文案清单」CSV（给腾讯文档在线表格用）
 *   Sheet1 · 界面文案 = 除 seed 组以外全部
 *   Sheet2 · 默认数据 = seed 组
 * 列：序号 / 编号 / 分组 / 出现在哪 / 现在的文案 / 改成（你填这列）/ 备注
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..', '..')
const COPY_TS = path.join(ROOT, 'src/shared/copy.ts')
const OUT_DIR = __dirname

// ---------------- ① 解析 copy.ts ----------------
const sf = ts.createSourceFile(COPY_TS, fs.readFileSync(COPY_TS, 'utf-8'), ts.ScriptTarget.ESNext, true)

function unwrap(e) {
  for (;;) {
    if (!e) return null
    if (ts.isAsExpression(e) || ts.isParenthesizedExpression(e)) {
      e = e.expression
      continue
    }
    return e
  }
}

/** 组名 -> 中文名（取组前的 // ==== X ==== 注释） */
const zhOf = {}
const groups = [] // [{name, zh, entries:[{key,val,line,comment,ph}]}]
{
  let cur = null
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.initializer)) {
      const name = n.name.getText(sf)
      if (name !== 'COPY') {
        // 组级
        const zh = zhOf[name] || ''
        cur = { name, zh, entries: [] }
        groups.push(cur)
        for (const p of n.initializer.properties) {
          if (!ts.isPropertyAssignment(p)) continue
          const k = p.name.getText(sf)
          const init = unwrap(p.initializer)
          let val = null
          if (init && ts.isStringLiteralLike(init)) val = init.text
          else if (init && ts.isTemplateExpression(init)) val = init.getText(sf)
          else if (init && ts.isNoSubstitutionTemplateLiteral(init)) val = init.text
          const line = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1
          const comment = ts.getLeadingCommentRanges(sf.text, p.getFullStart())
          let cm = ''
          if (comment) {
            const last = comment[comment.length - 1]
            cm = sf.text
              .slice(last.pos, last.end)
              .replace(/^\/\*\*?/, '')
              .replace(/\*\/$/, '')
              .split('\n')
              .map((s) => s.replace(/^\s*\*?\s?/, '').trim())
              .filter(Boolean)
              .join(' ')
          }
          cur.entries.push({ key: k, val, line, comment: cm })
        }
        cur = null
      }
    }
    ts.forEachChild(n, visit)
  }
  // 先扫组头注释
  const txt = sf.text.split('\n')
  let pending = ''
  for (const l of txt) {
    const m = l.match(/\/\/\s*=+\s*(.+?)\s*=+\s*$/)
    if (m) {
      pending = m[1]
      continue
    }
    const g = l.match(/^ {2}([A-Za-z]\w*):\s*\{/)
    if (g && pending) {
      zhOf[g[1]] = pending
      pending = ''
    }
  }
  visit(sf)
}

// ---------------- ② 扫引用点 → 推断「出现在哪」 ----------------
const refs = {} // "g.k" -> [{file, role}]
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(name) && p !== COPY_TS) scanFile(p)
  }
}

function scanFile(file) {
  const text = fs.readFileSync(file, 'utf-8')
  if (!text.includes('COPY.')) return
  const s2 = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  const hit = (g, k, role) => {
    const id = `${g}.${k}`
    ;(refs[id] = refs[id] || []).push({
      file: path.relative(path.join(ROOT, 'src'), file).replace(/\\/g, '/'),
      role
    })
  }

  /** 向上找最近的「角色节点」 */
  function roleOf(node) {
    let cur = node
    let depth = 0
    while (cur && depth < 12) {
      const p = cur.parent
      if (!p) break
      if (ts.isJsxAttribute(p)) {
        const an = p.name.getText(s2)
        if (an === 'title') return '悬停提示'
        if (an === 'placeholder') return '输入框占位'
        if (an === 'aria-label') return '无障碍标签'
        return '界面属性'
      }
      if (ts.isCallExpression(p)) {
        const c = p.expression.getText(s2)
        if (/^(toast|ok|fail|notify)/.test(c)) return '操作反馈'
        if (/^(fmt|t)$/.test(c)) {
          cur = p
          depth++
          continue
        }
        return '界面文字'
      }
      if (ts.isJsxElement(p)) {
        const tag = p.openingElement.tagName.getText(s2)
        const cls = p.openingElement.attributes.properties.find(
          (a) => ts.isJsxAttribute(a) && a.name.getText(s2) === 'className'
        )
        const cn =
          cls && cls.initializer && ts.isStringLiteral(cls.initializer) ? cls.initializer.text : ''
        const where = `${tag}${cn ? ' .' + cn.split(/\s+/)[0] : ''}`
        if (/^h[1-6]$/.test(tag)) return `标题 <${where}>`
        if (tag === 'button' || /btn|mini|ok|tp-clear/.test(cn)) return `按钮 <${where}>`
        if (/head|title/.test(cn)) return `标题区 <${where}>`
        if (/tip|hint|note/.test(cn)) return `说明文字 <${where}>`
        if (/empty/.test(cn)) return `空状态 <${where}>`
        if (tag === 'option') return '下拉选项'
        if (tag === 'th' || tag === 'td') return '表格单元格'
        return `界面文字 <${where}>`
      }
      cur = p
      depth++
    }
    return '阅读代码'
  }

  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n)) {
      const chain = []
      let c = n
      while (c && ts.isPropertyAccessExpression(c)) {
        chain.unshift(c.name.getText(s2))
        c = c.expression
      }
      if (c && ts.isIdentifier(c) && c.getText(s2) === 'COPY') {
        if (chain.length >= 2 && /^[A-Za-z]\w*$/.test(chain[0]) && /^[A-Za-z]\w*$/.test(chain[1]))
          hit(chain[0], chain[1], roleOf(n))
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(s2)
}
walk(path.join(ROOT, 'src'))

// ---------------- ③ 出 CSV ----------------
const ROLE_ZH = {
  '悬停提示': '悬停提示',
  '输入框占位': '输入框占位',
  '操作反馈': '操作反馈（toast / 弹窗）'
}

function esc(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function buildRows(filter) {
  const rows = []
  let i = 0
  for (const g of groups) {
    if (!filter(g)) continue
    for (const e of g.entries) {
      i++
      const where = []
      const seen = new Set()
      for (const r of refs[`${g.name}.${e.key}`] || []) {
        const key = `${r.file}|${r.role}`
        if (seen.has(key)) continue
        seen.add(key)
        where.push(`${r.file} · ${r.role}`)
      }
      const w = e.comment || where.join(' ／ ') || '（未找到引用点 · 请核对）'
      const ph = [...String(e.val ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      const note = ph.length ? `含变量：${ph.map((x) => '{' + x + '}').join(' ')}` : ''
      rows.push([i, `${g.name}.${e.key}`, g.zh || g.name, w, e.val ?? '', '', note])
    }
  }
  return rows
}

const HEAD = ['序号', '编号', '分组', '出现在哪', '现在的文案', '改成（你填这列）', '备注']

const s1 = buildRows((g) => g.name !== 'seed')
const s2 = buildRows((g) => g.name === 'seed')

function csv(rows) {
  const out = [HEAD.map(esc).join(',')]
  for (const r of rows) out.push(r.map(esc).join(','))
  return '\ufeff' + out.join('\r\n') + '\r\n'
}

fs.writeFileSync(path.join(OUT_DIR, 'sheet1-界面文案.csv'), csv(s1), 'utf-8')
fs.writeFileSync(path.join(OUT_DIR, 'sheet2-默认数据.csv'), csv(s2), 'utf-8')

console.log(`Sheet1 界面文案：${s1.length} 条`)
console.log(`Sheet2 默认数据：${s2.length} 条`)
console.log(`合计：${s1.length + s2.length} 条（字典 505 条：界面 ${505 - s2.length} + 默认数据 ${s2.length}）`)

const missing = s1.concat(s2).filter((r) => r[3] === '（未找到引用点 · 请核对）')
if (missing.length) {
  console.log(`\n⚠ 没有引用点的条目 ${missing.length} 条（多为被 fmt 动态取用，需人工核对）：`)
  for (const m of missing) console.log('  ' + m[1] + ' = ' + JSON.stringify(m[4]))
}
