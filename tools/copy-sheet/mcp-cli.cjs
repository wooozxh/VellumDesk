/*
 * 解析 mcporter 的「node + cli.js」两个路径，供 push.cjs / pull.cjs 共用。
 *
 * 为什么抽出来：这两个脚本原来把路径**写死**成
 *   C:/Users/30873/.workbuddy/binaries/node/versions/22.22.2-3/...
 * → 换一台没有 mcporter 的机器（如 17736）整个 publish / pull 就跑不了，
 *   报错还只是一句 ENOENT，看不出是"路径写死了"。第 56 批因此卡住。
 *
 * 现在的解析顺序：
 *   ① 环境变量 MCPORTER_CLI（最高优先，任何位置都能指）
 *   ② 项目内 node_modules
 *   ③ 当前用户 WorkBuddy 托管 node（各版本扫一遍）
 *   ④ 当前用户 npm 全局（Windows 默认前缀）
 * 都找不到 → 抛一句人话，告诉你怎么装 / 怎么指定，别再抛 ENOENT。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

/** 直接用当前跑脚本的这个 node —— 别再写死另一个 node 的绝对路径。 */
const NODE = process.execPath

const CLI_REL = path.join('node_modules', 'mcporter', 'dist', 'cli.js')

function firstExisting(list) {
  for (const p of list) {
    try {
      if (p && fs.existsSync(p)) return p
    } catch {
      /* 权限/竞态都当不存在，继续下一个 */
    }
  }
  return null
}

/** 扫 <base>/versions/<每个版本>/node_modules/mcporter/dist/cli.js */
function scanManagedVersions(baseDir) {
  const out = []
  try {
    for (const v of fs.readdirSync(path.join(baseDir, 'versions'))) {
      out.push(path.join(baseDir, 'versions', v, CLI_REL))
    }
  } catch {
    /* 目录不存在就算了 */
  }
  return out
}

function resolveMcporterCli() {
  const envCli = process.env.MCPORTER_CLI
  if (envCli && fs.existsSync(envCli)) return envCli

  const home = os.homedir()
  const wbNode = path.join(home, '.workbuddy', 'binaries', 'node')
  const candidates = [
    path.join(__dirname, '..', '..', 'node_modules', 'mcporter', 'dist', 'cli.js'), // 项目内
    ...scanManagedVersions(wbNode), // 托管 node 各版本
    path.join(wbNode, 'workspace', CLI_REL), // 托管 workspace
    path.join(home, 'AppData', 'Roaming', 'npm', CLI_REL) // npm 全局（Windows）
  ]

  const hit = firstExisting(candidates)
  if (hit) return hit

  throw new Error(
    [
      '找不到 mcporter，无法读写在线文案表。',
      '装一个即可（任选其一）：',
      '  · npm i -g mcporter',
      '  · 在项目里：npm i -D mcporter',
      '或者用环境变量直接指定它的 cli.js：',
      '  MCPORTER_CLI=<...>/node_modules/mcporter/dist/cli.js',
      `（当前 node = ${NODE}）`
    ].join('\n')
  )
}

module.exports = { NODE, resolveMcporterCli }
