/*
 * 一条命令把 copy.ts 刷回在线表：
 *   export.cjs（copy.ts → CSV）→ push.cjs（CSV → 覆盖在线表 + 清空「改成」）
 *
 *   node tools/copy-sheet/publish.cjs
 *
 * 什么时候跑：每次文案改动落地之后。不跑的话表里「现在的文案」还是旧值，
 * 下次改的时候会分不清哪句是现状。
 */
const { spawn } = require('child_process')
const path = require('path')

const FILE_ID = 'TFHcDzWQzdBC'
const SHEET1_ID = 'BB08J2' // 1-界面文案
const SHEET2_ID = 'c3qmog' // 2-默认数据

function run(script, args = [], env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, script), ...args], {
      stdio: 'inherit',
      env: { ...process.env, ...env }
    })
    p.on('close', (code) => resolve(code ?? 1))
    p.on('error', () => resolve(1))
  })
}

;(async () => {
  console.log('▶ ① 从 copy.ts 导出清单…')
  const a = await run('export.cjs')
  if (a !== 0) {
    console.error('❌ export.cjs 失败，已中止')
    process.exit(a)
  }

  console.log('\n▶ ② 覆盖写入在线表并清空「改成」列…')
  const b = await run('push.cjs', [FILE_ID, '40'], { SHEET1_ID, SHEET2_ID })
  if (b !== 0) {
    console.error('❌ push.cjs 失败')
    process.exit(b)
  }

  console.log(`\n✅ 在线表已刷新：https://docs.qq.com/sheet/DVEZIY0R6V1F6ZEJD`)
})()
