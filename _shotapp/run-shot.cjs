// 启动 main.cjs 的辅助：unset ELECTRON_RUN_AS_NODE + 禁 GPU
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const ROOT = path.join(__dirname, '..')
delete process.env.ELECTRON_RUN_AS_NODE
const out = fs.openSync(path.join(ROOT, 'shot-b2.log'), 'w')
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
  ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '.'],
  { cwd: path.join(ROOT, '_shotapp'), stdio: ['ignore', out, out] })
child.on('close', (code) => { fs.closeSync(out); process.exit(code ?? 0) })
