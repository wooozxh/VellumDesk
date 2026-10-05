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

async function readSheet(sheetId, cols = 7) {
  // 行数**不能写死**（原来写死 484 / 30）：字典会随批次增长，publish 会把表扩容
  // （2026-10-05 刷表后 Sheet1 已到 689 行），写死上限就只读回前 484 行 ——
  // 用户改了末尾那些文案，AI 拉不回来 = 静默漏改。改成从表元信息取真实行数。
  const info = await call('get_sheet_info', { file_id: FILE_ID })
  const meta = (info.sheets || []).find((s) => s.sheet_id === sheetId)
  const totalRows = Math.max(1, Number(meta && meta.row_count) || 1)
  const grid = []
  for (let r = 0; r < totalRows; r++) grid.push(new Array(cols).fill(''))
  const CHUNK = 60
  for (let start = 0; start < totalRows; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, totalRows - 1)
    const range = {
      file_id: FILE_ID,
      sheet_id: sheetId,
      start_row: start,
      start_col: 0,
      end_row: end,
      end_col: cols - 1
    }
    let cells = (await call('get_cell_data', range)).cells || []
    // 偶发坑（2026-10-05 实测）：某一块会**静默返回空 cells**（同一块单独重读就有内容），
    // 表现为「表里明明有内容，读回来整段空白」。静默漏读 = 用户改的文案落不了地，
    // 所以表头之后（start > 0）的块读空时重试一次。
    if (cells.length === 0 && start > 0) {
      await new Promise((r) => setTimeout(r, 400))
      cells = (await call('get_cell_data', range)).cells || []
    }
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
  const s1 = await readSheet('BB08J2', 7)
  const s2 = await readSheet('c3qmog', 7)
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
