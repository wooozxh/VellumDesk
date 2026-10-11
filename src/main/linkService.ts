/**
 * 第 62 批（docs/45 §4）：插件联动的**服务层** —— 把 linkMirror（写镜像）+ linkHandoff（轮询搬运）
 * 装配成一个随软件启动运行的单元。`index.ts` 在 `initWorkspace` 之后调 `startLinkService()`。
 *
 * 同样**不依赖 electron**：appData / 版本 / 工作区根都从参数进来 →
 * accept 用「假插件目录」直接驱动服务，验启动装配（不必装 PS）。
 */
import {
  discoverPluginDataDirs,
  syncTaskMirror,
  syncBrandMirror,
  isoLocal,
  MIRROR_DIR,
  HANDOFF_DIR,
  type MirrorTarget,
  type MirrorWriteResult
} from './linkMirror'
import { HandoffEngine, type HandoffResult } from './linkHandoff'
import { getLinkConfig, setLinkSyncInfo, getLinkSyncInfo } from './linkConfig'
import { relative, isAbsolute } from 'path'

/** 一次同步的合并结果（任务库 + 通用库，第 62 批 Step 4 起） */
export interface LinkSyncResult extends MirrorWriteResult {
  /** 通用库素材条数 */
  brandCount: number
  /** 通用库落盘缩略图数 */
  brandThumbs: number
}

export interface LinkStatus {
  enabled: boolean
  workspaceRoot: string
  targets: Array<{ psMajor: string; pluginDataDir: string }>
  /** 轮询是否在跑（= 找到了目标且开关开着） */
  running: boolean
  lastSyncAt: string | null
  lastResult: string | null
  /** 手填的目录落在工作区内部、已被防呆忽略（界面提示用） */
  manualDirIgnored: boolean
}

interface LinkState {
  appDataDir: string
  appVersion: string
  workspaceRoot: string
  targets: MirrorTarget[]
  engine: HandoffEngine | null
}

const state: LinkState = {
  appDataDir: '',
  appVersion: '',
  workspaceRoot: '',
  targets: [],
  engine: null
}

/** 从 PluginData 路径里抠 PS 大版本号（手填目录用；抠不到给空串） */
export function psMajorFromPath(p: string): string {
  const m = /[\\/]PHSP[\\/](\d+)[\\/]/i.exec(p)
  return m ? m[1] : ''
}

/**
 * 发现全部目标（契约 §7.1「全部命中都写」）：
 * **自动命中的 + 手填兜底的**（去重）—— 谁都不漏。
 */
export function discoverTargets(appDataDir: string, workspaceRoot = ''): MirrorTarget[] {
  const auto = discoverPluginDataDirs(appDataDir)
  const out = [...auto]
  const manual = getLinkConfig().dataDir.trim()
  if (manual && !out.some((t) => t.pluginDataDir.toLowerCase() === manual.toLowerCase())) {
    // 防呆（第 63 批 docs/47）：手填目录若落在**工作区内部**，镜像会被写进工作区、
    // 还会被任务扫描当成一个包（2026-10-11 用户实测踩过）—— 这种目录直接不认，绝不写。
    if (!isInsideWorkspace(workspaceRoot, manual)) {
      out.push({ psMajor: psMajorFromPath(manual), pluginDataDir: manual })
    }
  }
  return out
}

/** `dir` 是否落在 `root` 内部（含相等）。root 为空 → 一律 false（不拦）。 */
export function isInsideWorkspace(root: string, dir: string): boolean {
  if (!root) return false
  const rel = relative(root, dir)
  if (rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * 启动服务：发现目标 → 起 handoff 轮询 → 首扫一次镜像。
 * 开关关着、或一个目录都没找到 → **静默不启**（不报错、不影响其它功能）。
 */
export async function startLinkService(opts: {
  appDataDir: string
  appVersion: string
  workspaceRoot: string
}): Promise<void> {
  stopLinkService()
  // 硬开关（排障 / 测试壳）：**连 appDataDir 都不记** —— 免得之后手动同步误写真实插件目录
  if (process.env.VELLUM_PLUGIN_SYNC === '0') return
  state.appDataDir = opts.appDataDir
  state.appVersion = opts.appVersion
  state.workspaceRoot = opts.workspaceRoot

  if (!getLinkConfig().enabled) return
  state.targets = discoverTargets(opts.appDataDir, opts.workspaceRoot)
  if (state.targets.length === 0) return

  state.engine = new HandoffEngine({ workspaceRoot: opts.workspaceRoot, targets: state.targets })
  state.engine.start()
  await syncNow()
}

/** 停止服务（will-quit / 切工作区时调） */
export function stopLinkService(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (state.engine) {
    state.engine.stop()
    state.engine = null
  }
  state.targets = []
}

/** 设置里改了手填目录 / 开关后调用：重新发现目标并重挂轮询。返回目标数。 */
export async function refreshLinkTargets(): Promise<number> {
  if (state.engine) {
    state.engine.stop()
    state.engine = null
  }
  if (!getLinkConfig().enabled) {
    state.targets = []
    return 0
  }
  state.targets = discoverTargets(state.appDataDir, state.workspaceRoot)
  if (state.targets.length > 0) {
    state.engine = new HandoffEngine({ workspaceRoot: state.workspaceRoot, targets: state.targets })
    state.engine.start()
  }
  return state.targets.length
}

/** 真正的同步实现（不对外）：任务库 + 通用库**一起**同步，返回合并结果。 */
async function syncNowCore(): Promise<LinkSyncResult> {
  if (state.targets.length === 0) state.targets = discoverTargets(state.appDataDir, state.workspaceRoot)
  const task = await syncTaskMirror(state.workspaceRoot, state.targets, {
    appVersion: state.appVersion
  })
  const brand = await syncBrandMirror(state.workspaceRoot, state.targets, {
    appVersion: state.appVersion
  })
  const ok = task.ok && brand.ok
  const error = task.error ?? brand.error
  setLinkSyncInfo(
    isoLocal(),
    ok
      ? `ok rev=${task.revision} count=${task.count} thumbs=${task.thumbs} dirs=${task.targets.length}` +
        ` | brand rev=${brand.revision} count=${brand.count} thumbs=${brand.thumbs}`
      : `fail ${error ?? 'unknown'}`
  )
  return {
    ...task,
    ok,
    error,
    wrote: task.wrote || brand.wrote,
    brandCount: brand.count,
    brandThumbs: brand.thumbs
  }
}

// ---------------------------------------------------------------- 变更后自动同步（第 63 批 · docs/47）

/** 防抖窗口：一次变更后等这么久再写盘；连续操作合并成一次（批量导入只写一次）。 */
export const MIRROR_DEBOUNCE_MS = 1500

let debounceTimer: ReturnType<typeof setTimeout> | null = null
/** 串行链：保证任意时刻只有一个 syncNow 在写 —— 防「并发读同一个 prevRev」把 revision 写乱。 */
let syncChain: Promise<unknown> = Promise.resolve()

function serialSync(): Promise<LinkSyncResult> {
  const run = syncChain.then(() => syncNowCore())
  syncChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** 手动同步（「同步到插件」按钮 / 启动首扫 / accept）：**立即**执行，但走同一条串行链。 */
export function syncNow(): Promise<LinkSyncResult> {
  return serialSync()
}

/**
 * **变更后自动同步**：任务库 / 通用库任何写操作成功后调它。
 * 1.5 秒防抖（合并连续操作）；内容没变时 `syncNowCore` 内部签名短路，一个字节都不写。
 */
export function scheduleMirror(reason = ''): void {
  void reason
  // **节流**（不是防抖）：已经排上了就**不再往后推**。
  // 这样"改动后最迟 1.5 秒写盘"是硬保证 —— 否则界面上的轮询类调用会把已排的写
  // 一直往后顶，写盘被无限推迟（插件侧提醒的真问题）。
  if (debounceTimer) return
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void serialSync().catch(() => undefined)
  }, MIRROR_DEBOUNCE_MS)
  const t = debounceTimer as unknown as { unref?: () => void }
  if (typeof t.unref === 'function') t.unref()
}

/** 立即冲刷（退出兜底 / accept）：取消待跑的防抖，马上同步一次并等它写完。 */
export async function flushMirrorNow(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  await serialSync().catch(() => undefined)
}

/** 还有没有「等着写」的变更（退出钩子 / 排障用） */
export function hasPendingMirror(): boolean {
  return debounceTimer !== null
}

/**
 * 换工作区后调：把服务指向新根 —— 重新发现目标、重挂 handoff 轮询，并排一次同步。
 * （不这么做的话 `state.workspaceRoot` 仍是旧根，会把**旧工作区**的内容写进镜像。）
 */
export async function refreshLinkWorkspace(workspaceRoot: string): Promise<void> {
  state.workspaceRoot = workspaceRoot
  await refreshLinkTargets()
  scheduleMirror('ws')
}

/** 手动跑一轮轮询（accept / 排障用） */
export async function pollHandoffOnce(): Promise<HandoffResult[]> {
  if (!state.engine) return []
  return state.engine.tick()
}

export function getLinkStatus(): LinkStatus {
  const info = getLinkSyncInfo()
  return {
    enabled: getLinkConfig().enabled,
    workspaceRoot: state.workspaceRoot,
    targets: state.targets.map((t) => ({ psMajor: t.psMajor, pluginDataDir: t.pluginDataDir })),
    running: state.engine !== null,
    lastSyncAt: info.lastSyncAt,
    lastResult: info.lastResult,
    // 手填了目录、但它落在工作区内部 → 被防呆拦掉（界面提示用户改）
    manualDirIgnored:
      getLinkConfig().dataDir.trim() !== '' &&
      isInsideWorkspace(state.workspaceRoot, getLinkConfig().dataDir.trim())
  }
}

/** 供 UI 展示：镜像目录里有哪些东西（排障用） */
export const MIRROR_DIRNAME = MIRROR_DIR
export const HANDOFF_DIRNAME = HANDOFF_DIR
