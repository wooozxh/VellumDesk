/**
 * 从腾讯文档在线表格读回「改成」列内容。
 * 用法： node read_sheet.cjs
 * 输出： _sheet_read.json  { sheet1: [[c0..c6], ...], sheet2: [[...]] }
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const NODE = 'C:/Users/30873/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
const CLI = 'C:/Users/30873/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/mcporter/dist/cli.js'
const FILE_ID = 'TFHcDzWQzdBC'
const DIR = __dirname

function call(tool, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const p = spawn(NODE, [CLI, 'call', 'sheet-mcp', tool, '--args', JSON.stringify(args), '--output', 'json'], {
      windowsHide: true
    })
    let out = ''
    let err = ''
    const t = setTimeout(() => { try { p.kill() } catch {} ; reject(new Error('timeout ' + tool)) }, timeoutMs)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => { clearTimeout(t); reject(e) })
    p.on('close', (code) => {
      clearTimeout(t)
      if (code !== 0) return reject(new Error(tool + ' exit ' + code + ' ' + err.slice(0, 300)))
      try { resolve(JSON.parse(out)) } catch (e) { reject(new Error(tool + ' 非法 JSON: ' + out.slice(0, 300))) }
    })
  })
}

async function readSheet(sheetId, totalRows, cols = 7) {
  const grid = []
  for (let r = 0; r < totalRows; r++) grid.push(new Array(cols).fill(''))
  const CHUNK = 60
  for (let start = 0; start < totalRows; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, totalRows - 1)
    const res = await call('get_cell_data', {
      file_id: FILE_ID,
      sheet_id: sheetId,
      start_row: start,
      start_col: 0,
      end_row: end,
      end_col: cols - 1
    })
    const cells = res.cells || []
    for (const c of cells) {
      if (c.row == null || c.col == null) continue
      if (c.row >= totalRows || c.col >= cols) continue
      let v = c.string_value
      if (v == null || v === '') {
        if (c.value_type === 'NUMBER') v = String(c.number_value)
        else v = ''
      }
      grid[c.row][c.col] = String(v)
    }
    process.stdout.write(`\r  读 ${sheetId} 行 ${start}~${end}`)
  }
  process.stdout.write('\n')
  return grid
}

;(async () => {
  const s1 = await readSheet('BB08J2', 484, 7)
  const s2 = await readSheet('c3qmog', 30, 7)
  const out = { file_id: FILE_ID, sheet1: s1, sheet2: s2 }
  fs.writeFileSync(path.join(DIR, '_sheet_read.json'), JSON.stringify(out, null, 1), 'utf-8')

  // 汇总
  for (const [name, g] of [['1-界面文案', s1], ['2-默认数据', s2]]) {
    const body = g.slice(1).filter((r) => r.some((x) => x.trim() !== ''))
    const filled = body.filter((r) => (r[5] || '').trim() !== '')
    console.log(`${name}: 数据行 ${body.length}，填了「改成」列 ${filled.length}`)
  }
  console.log('→ _sheet_read.json')
})().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
