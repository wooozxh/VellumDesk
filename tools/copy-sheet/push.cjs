/*
 * 把导出的两份 CSV 写进腾讯文档在线表格（分块调用 sheet.set_range_value_by_csv）
 *   用法：node push_sheet.cjs <file_id> [chunkRows]
 * 为什么分块：mcporter 只能从命令行收 --args JSON，Windows 命令行上限 ~32767 字符，
 * 70KB 的 CSV 必须拆；用 execFileSync 传 argv 数组避开 shell 引号转义。
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const FILE_ID = process.argv[2]
const CHUNK = Number(process.argv[3] || 40)
if (!FILE_ID) {
  console.error('用法: node push_sheet.cjs <file_id> [chunkRows]')
  process.exit(1)
}

const DIR = __dirname
// 注意：bin 目录下的 `mcporter` 只是个 sh 包装脚本（内部调 dirname/sed/uname），
// Windows 下 Node 直接 spawn 它会失败；必须起 node + dist/cli.js。
// 用 process.execPath —— 就是当前跑本脚本的这个 node，避免再写死一个路径。
const NODE = process.execPath
const MCP_CLI = 'C:/Users/30873/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/mcporter/dist/cli.js'

/** 极简 CSV 解析（能处理引号包裹、转义双引号、字段内换行） */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQ = false
  const s = text.replace(/^\ufeff/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      /* skip */
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 反向：把行数组编成 CSV 文本（给 API 的是 CSV 字符串） */
function toCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v ?? '')
          return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
        })
        .join(',')
    )
    .join('\n')
}

/**
 * 异步调 mcporter（沙箱里 spawnSync/execFileSync 一律 EBUSY，必须用 spawn）
 * 参数用 argv 数组传，不经 shell，避掉引号转义问题
 */
function call(tool, args) {
  return new Promise((resolve) => {
    const p = spawn(NODE, [MCP_CLI, 'call', 'sheet-mcp', tool, '--args', JSON.stringify(args), '--output', 'json'], {
      windowsHide: true
    })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => resolve({ code, out, err }))
  })
}

async function push(csvFile, sheetId, label) {
  const rows = parseCsv(fs.readFileSync(path.join(DIR, csvFile), 'utf-8'))
  console.log(`\n==== ${label}：${rows.length} 行（含表头）× ${rows[0].length} 列 -> sheet ${sheetId} ====`)
  let done = 0
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK)
    const csv = toCsv(chunk)
    const args = { file_id: FILE_ID, sheet_id: sheetId, start_row: start, start_col: 0, csv_data: csv }
    try {
      const { code, out, err } = await call('set_range_value_by_csv', args)
      if (code !== 0) {
        console.log(`\n  ❌ 行 ${start}~${start + chunk.length - 1} 退出码 ${code}: ${String(err || out).slice(0, 300)}`)
        return false
      }
      let j = {}
      try {
        j = JSON.parse(out)
      } catch {
        console.log(`\n  ⚠ 行 ${start} 返回非 JSON: ${out.slice(0, 200)}`)
      }
      if (j.error) {
        console.log(`\n  ❌ 行 ${start}~${start + chunk.length - 1} 失败: ${j.error}`)
        return false
      }
      done += chunk.length
      process.stdout.write(`\r  已写入 ${done}/${rows.length} 行`)
    } catch (e) {
      console.log(`\n  ❌ 行 ${start}~${start + chunk.length - 1} 异常: ${String(e.message).slice(0, 300)}`)
      return false
    }
  }
  console.log(`\n  ✅ ${label} 写入完成 ${done} 行`)

  // 关键补刀：CSV 里的空单元格 API 会跳过，不清的话上次填的「改成」「备注」会残留，
  // 下次打开表就会把旧值当成新改动读回来。
  const clr = await call('clear_range_cells', {
    file_id: FILE_ID,
    sheet_id: sheetId,
    start_row: 1,
    start_col: 5,
    end_row: rows.length,
    end_col: 6
  })
  if (clr.code !== 0) {
    console.log(`\n  ⚠ 「改成 / 备注」列清空失败（退出码 ${clr.code}）：${String(clr.err || clr.out).slice(0, 200)}`)
    return false
  }
  console.log('  ✅ 「改成 / 备注」列已清空')
  return true
}

const S1 = process.env.SHEET1_ID
const S2 = process.env.SHEET2_ID

;(async () => {
  let ok = true
  if (S1) ok = (await push('sheet1-界面文案.csv', S1, 'Sheet1 · 界面文案')) && ok
  if (S2) ok = (await push('sheet2-默认数据.csv', S2, 'Sheet2 · 默认数据')) && ok
  console.log(ok ? '\n全部写入成功' : '\n存在失败')
  process.exit(ok ? 0 : 1)
})()
