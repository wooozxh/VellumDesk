/**
 * 第 4 批界面验证的运行器：必须起子进程（沙箱里本进程带 ELECTRON_RUN_AS_NODE，
 * 会让 Electron 退化成纯 Node，窗口根本不会出现）。
 * 用法：node _shotapp/run-verify4.cjs banner   /   version
 */
const { spawn } = require('child_process')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const scen = process.argv[2] || 'banner'

/**
 * 先把 src/shared/copy.ts 打成 v4/copy.cjs —— 场景壳的断言引用的是它。
 * 少了这一步，改完文案的场景断言会拿着旧字典去比对（天天假失败）。
 */
function rebuildCopyBridge() {
  return new Promise((resolve) => {
    const out = path.join(__dirname, 'v4', 'copy.cjs')
    const p = spawn(
      process.execPath,
      [
        path.join(ROOT, 'node_modules/esbuild/bin/esbuild'),
        path.join(ROOT, 'src/shared/copy.ts'),
        '--bundle',
        '--platform=node',
        '--format=cjs',
        '--outfile=' + out
      ],
      { stdio: 'ignore' }
    )
    p.on('close', () => resolve())
    p.on('error', () => resolve())
  })
}

;(async () => {
  await rebuildCopyBridge()

  const env = { ...process.env, SHOT_SCENARIO: scen }
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(
    path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
    ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '.'],
    { cwd: path.join(ROOT, '_shotapp', 'v4'), stdio: 'inherit', env }
  )
  child.on('close', (code) => process.exit(code ?? 0))
})()
