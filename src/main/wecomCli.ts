/**
 * 第 21 批（docs/16 §4）：wecom-cli **定位 + 调用**的唯一入口 —— 全应用只有这里 spawn 外部进程。
 *
 * 为什么要独立成文件：第 13~20 批的定位逻辑散在「环境变量 → 开发机硬编码路径」两步里，
 * 那是「每人自己装 CLI」时代的写法。第 21 批把 CLI 打进安装包后，定位要按**内置优先**重排，
 * 而定位顺序是纯逻辑（能喂假 exists 断言），调用是副作用（异步 spawn）—— 两者分开，
 * 自动测试只考前者（延续铁律：**真企微不进自动测试**）。
 *
 * 定位顺序（docs/16 §4.1）：
 *   ① 环境变量 `WECOM_CLI_EXE` —— 直接指 exe，运维逃生口（临时换一版 CLI 排查用）
 *   ② **内置**：打包后 `<安装目录>/resources/wecom-cli/wecom-cli.exe`；
 *      开发态是项目 `resources/wecom-cli/wecom-cli.exe`
 *   ③ 环境变量 `WECOM_CLI_JS`（+ `WECOM_CLI_NODE`）—— 一期同事机的老配法，保留不删
 *   ④ 开发机硬编码路径 —— 最后兜底，只为老开发机不用改环境变量
 * 前三步都命中不到 → `null`（界面显示「CLI 不可用」，其余功能不受影响）。
 *
 * 内置之后**直接 spawn exe**，不再需要 node 中转（exe 是零依赖单文件）——
 * 这也是「不需要在同事机器上装 Node」的原因。
 */
import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readFile, unlink } from 'fs/promises'

/** CLI 从哪来（界面「企微连接」区块会显示，排查"为什么用不了"时一眼看出） */
export type CliSource = 'env-exe' | 'bundled' | 'env-js' | 'dev-js'

/** 一条可直接 spawn 的命令：`cmd` + 前置参数（JS 形态时前置参数是那个 js 路径） */
export interface CliCommand {
  cmd: string
  pre: string[]
  source: CliSource
  /** 展示给人看的路径（exe 或 js） */
  path: string
}

/** CLI 失败的三类出口（§4.4，界面按类型分别提示） */
export type CliFailKind = 'cli-missing' | 'auth-expired' | 'unknown'

export interface CliResult<T> {
  ok: boolean
  data?: T
  error?: string
  kind?: CliFailKind
}

/** 开发机的已知安装路径（用户机器 + 授权已配好；同事机器靠内置 exe 或环境变量） */
const DEV_CLI_JS =
  'C:/Users/30873/.workbuddy/binaries/node/cli-connector-packages/node_modules/@wecom/cli/bin/wecom.js'
const DEV_NODE = 'C:/Users/30873/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'

// ============================================================ 定位（纯逻辑，可断言）

export interface CliResolveInput {
  /** 环境变量 WECOM_CLI_EXE（直指 exe） */
  envExe?: string
  /** 环境变量 WECOM_CLI_JS（一期老配法） */
  envJs?: string
  /** 环境变量 WECOM_CLI_NODE */
  envNode?: string
  /** 内置 exe 的绝对路径（调用方按 dev / 打包两种形态算好；空串 = 没找到） */
  bundledExe?: string
  /** 开发机兜底（可注入假路径做断言） */
  devJs?: string
  devNode?: string
  /** 存在性判定（断言时注入假的） */
  exists?: (p: string) => boolean
}

/**
 * 按 docs/16 §4.1 的顺序挑一条命令。纯函数：只看入参 + 一个 exists 判定，不碰真实文件系统。
 * 全部落空返回 null。
 */
export function resolveCliCommand(input: CliResolveInput): CliCommand | null {
  const ex = input.exists ?? existsSync
  const envExe = (input.envExe ?? '').trim()
  const envJs = (input.envJs ?? '').trim()
  if (envExe && ex(envExe)) {
    return { cmd: envExe, pre: [], source: 'env-exe', path: envExe }
  }
  const bundled = (input.bundledExe ?? '').trim()
  if (bundled && ex(bundled)) {
    return { cmd: bundled, pre: [], source: 'bundled', path: bundled }
  }
  const devJs = input.devJs ?? DEV_CLI_JS
  const devNode = input.devNode ?? DEV_NODE
  if (envJs && ex(envJs)) {
    // node：环境变量指了就用，没指就挑一个存在的（开发机的 / PATH 上的 node）
    const node = (input.envNode ?? '').trim() || (ex(devNode) ? devNode : 'node')
    return { cmd: node, pre: [envJs], source: 'env-js', path: envJs }
  }
  if (ex(devJs)) {
    return { cmd: ex(devNode) ? devNode : 'node', pre: [devJs], source: 'dev-js', path: devJs }
  }
  return null
}

/** 主进程启动时注入内置 exe 路径（与 setFfmpegDir 同一套路） */
let bundledCliExe = ''
export function setBundledCliExe(p: string): void {
  bundledCliExe = p
}
export function locateBundledExe(appPath: string, resourcesPath: string, packaged: boolean): string {
  const cands = [
    packaged ? join(resourcesPath, 'wecom-cli', 'wecom-cli.exe') : '',
    join(appPath, 'resources', 'wecom-cli', 'wecom-cli.exe')
  ].filter(Boolean)
  for (const p of cands) {
    if (existsSync(p)) return p
  }
  return ''
}

/** 进程内当前生效的那条命令（每次现算：环境变量可能被改） */
export function cliCommand(): CliCommand | null {
  return resolveCliCommand({
    envExe: process.env.WECOM_CLI_EXE,
    envJs: process.env.WECOM_CLI_JS,
    envNode: process.env.WECOM_CLI_NODE,
    bundledExe: bundledCliExe
  })
}

// ============================================================ 调用（副作用）

interface RawRun {
  code: number | null
  out: string
  err: string
  spawnError?: string
}

/** 异步跑一次 CLI（绝不用 spawnSync：沙箱 spawnSync 全 EBUSY，正式应用也不该阻塞主进程） */
export function runRaw(args: string[], timeoutMs: number): Promise<RawRun> {
  const c = cliCommand()
  if (!c) return Promise.resolve({ code: null, out: '', err: '', spawnError: 'CLI_NOT_FOUND' })
  return new Promise((resolve) => {
    const child = spawn(c.cmd, [...c.pre, ...args], { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: null, out, err: err + '\nCLI_TIMEOUT' })
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: null, out, err, spawnError: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
}

/** 跑 CLI 并解析 JSON 输出；识别授权过期 / 未安装 */
export async function runCliJson<T>(args: string[], timeoutMs = 60000): Promise<CliResult<T>> {
  const r = await runRaw(args, timeoutMs)
  if (r.spawnError === 'CLI_NOT_FOUND' || r.spawnError === 'ENOENT') {
    return { ok: false, kind: 'cli-missing', error: 'wecom-cli 不可用（内置文件缺失或路径未配置）' }
  }
  const text = r.out + '\n' + r.err
  if (/850003|权限已过期|使用权限已过期/.test(text)) {
    return { ok: false, kind: 'auth-expired', error: '企微授权已过期' }
  }
  if (r.code !== 0) {
    return { ok: false, kind: 'unknown', error: text.trim().slice(0, 500) }
  }
  try {
    return { ok: true, data: JSON.parse(r.out) as T }
  } catch {
    return { ok: false, kind: 'unknown', error: 'CLI 输出不是合法 JSON：' + r.out.slice(0, 200) }
  }
}

// ============================================================ 版本 / 授权状态（纯解析 + 真调用）

/** 从 `wecom-cli --version` 的输出里抠版本号（`wecom-cli 1.3.4 (wecom …)` → `1.3.4`） */
export function parseCliVersion(out: string): string | null {
  const m = (out || '').trim().match(/wecom-cli\s+v?(\d+\.\d+\.\d+)/i)
  return m ? m[1] : null
}

/**
 * `auth show --status` 输出 → 三态。
 * ⚠️ 必须先判 `unauthorized`：它是 `authorized` 的超串，顺序写反会把「未授权」读成「已授权」。
 */
export function parseAuthStatus(out: string): 'authorized' | 'unauthorized' | 'unknown' {
  const t = (out || '').toLowerCase()
  if (/unauthori[sz]ed/.test(t)) return 'unauthorized'
  if (/authori[sz]ed/.test(t)) return 'authorized'
  return 'unknown'
}

export async function readCliVersion(): Promise<string | null> {
  const r = await runRaw(['--version'], 15000)
  if (!r.out && !r.err) return null
  return parseCliVersion(r.out + r.err)
}

export async function readAuthStatus(): Promise<'authorized' | 'unauthorized' | 'unknown' | 'cli-missing'> {
  const r = await runRaw(['auth', 'show', '--status'], 20000)
  if (r.spawnError === 'CLI_NOT_FOUND' || r.spawnError === 'ENOENT') return 'cli-missing'
  return parseAuthStatus(r.out + r.err)
}

/** 界面「企微连接」要的一次性快照 */
export interface WecomCliInfo {
  available: boolean
  source: CliSource | null
  path: string
  version: string | null
  auth: 'authorized' | 'unauthorized' | 'unknown' | 'cli-missing'
}

let cachedVersion: string | null | undefined
export function resetCliInfoCache(): void {
  cachedVersion = undefined
}

export async function getCliInfo(): Promise<WecomCliInfo> {
  const c = cliCommand()
  if (!c) {
    return { available: false, source: null, path: '', version: null, auth: 'cli-missing' }
  }
  if (cachedVersion === undefined) cachedVersion = await readCliVersion()
  const auth = await readAuthStatus()
  return { available: true, source: c.source, path: c.path, version: cachedVersion, auth }
}

// ============================================================ 授权引导（auth init）

/**
 * 一次授权会话的形态：`auth init --noninteractive` 会在终端里等扫码，
 * 我们把二维码**额外**落到一张 PNG（`--output-qrcode`）—— 界面显示图片，用户拿企业微信扫。
 * 进程不杀，扫码成功后自己退出；界面靠轮询 `auth show --status` 判断结束。
 *
 * ⚠️ 二维码必须落在**系统临时目录**（第 21 批实测，2026-10-04）：
 * CLI 有自己的文件访问白名单 —— 允许范围 = **CLI 进程的工作目录 + 系统临时目录**，
 * 其余路径一律 893006 PermissionError（"目标路径超出可访问范围"）。
 * 所以这里用 `os.tmpdir()`，**不要**改成工作区里的目录（那会被拒，二维码就出不来）。
 */
export interface AuthStartResult {
  ok: boolean
  /** 二维码图片（data URL，直接给 <img src>；不落工作区，不暴露路径） */
  qr?: string
  /** 首次探测到的 CLI 原始输出（排查用，仅在本轮会话里展示） */
  log: string
  error?: string
}

/**
 * 判断 buffer 是不是一张**写完整了**的 PNG：头 8 字节是 PNG 签名、尾 8 字节是 IEND 块。
 *
 * 为什么不能只看「文件存在」就读（2026-10-05 修的必现 bug）：
 * `auth init --output-qrcode` 的实际时序是**先创建 0 字节文件、约 1.5 秒后才写入完整图片**
 * （探针 3/3 复现：第一次读到 size=0，+1.5s 重读才是 3.5KB 完整 PNG）。
 * 抢读到 0 字节会返回空 data URL，界面二维码显示为破图。
 * 头尾双签名都对上才认为写完 —— 纯函数，accept 有断言。
 */
export function isCompletePng(buf: Buffer): boolean {
  if (buf.length < 16) return false
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const IEND_TAIL = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  return buf.subarray(0, 8).equals(PNG_SIG) && buf.subarray(buf.length - 8).equals(IEND_TAIL)
}

let authChild: ChildProcess | null = null
let authQrFile = ''
let authLog = ''

/** 关掉正在等待扫码的进程（用户点「取消」或关弹窗） */
export function cancelWecomAuth(): void {
  if (authChild) {
    try {
      authChild.kill()
    } catch {
      // 已经退出了就算了
    }
    authChild = null
  }
  if (authQrFile) {
    void unlink(authQrFile).catch(() => {})
    authQrFile = ''
  }
  authLog = ''
}

export function isWecomAuthRunning(): boolean {
  return authChild !== null
}

/**
 * 发起授权：等二维码图片落盘（最多 20 s）就返回，**不等扫码**（扫码是用户的事，可能几十秒）。
 * 轮询状态由界面调 readAuthStatus。
 */
export async function startWecomAuth(): Promise<AuthStartResult> {
  const c = cliCommand()
  if (!c) return { ok: false, log: '', error: 'wecom-cli 不可用' }
  cancelWecomAuth()
  const qrFile = join(tmpdir(), `wecom-auth-${Date.now()}.png`)
  authQrFile = qrFile
  authLog = ''
  const child = spawn(
    c.cmd,
    [...c.pre, 'auth', 'init', '--noninteractive', '--no-browser', '--output-qrcode', qrFile],
    { windowsHide: true }
  )
  authChild = child
  let exited = false
  child.stdout.on('data', (d) => (authLog += d.toString()))
  child.stderr.on('data', (d) => (authLog += d.toString()))
  child.on('error', (e) => {
    exited = true
    authLog += '\n' + e.message
  })
  child.on('close', () => {
    exited = true
    if (authChild === child) authChild = null
  })

  // 等二维码写完整（CLI 要先联网换码，通常 1~3 秒；文件会先以 0 字节出现，见 isCompletePng 注释）
  for (let i = 0; i < 100; i++) {
    if (existsSync(qrFile)) {
      try {
        const buf = await readFile(qrFile)
        if (isCompletePng(buf)) {
          return { ok: true, qr: `data:image/png;base64,${buf.toString('base64')}`, log: authLog }
        }
        // 文件已创建但还没写完（或读到半截）—— 不把残缺数据交给界面，下一轮再读
      } catch {
        // Windows 上 CLI 正在写时读取可能撞占用 —— 同样等下一轮，不让单次读失败判死
      }
    }
    if (exited) {
      // 进程已经退出但没出码 —— 一般是断网 / CLI 报错，把原始输出带回去
      return { ok: false, log: authLog, error: 'CLI 未生成二维码就退出了' }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return { ok: false, log: authLog, error: '等待二维码超时（20 秒）' }
}
