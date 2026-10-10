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
  isoLocal,
  MIRROR_DIR,
  HANDOFF_DIR,
  type MirrorTarget,
  type MirrorWriteResult
} from './linkMirror'
import { HandoffEngine, type HandoffResult } from './linkHandoff'
import { getLinkConfig, setLinkSyncInfo, getLinkSyncInfo } from './linkConfig'

export interface LinkStatus {
  enabled: boolean
  workspaceRoot: string
  targets: Array<{ psMajor: string; pluginDataDir: string }>
  /** 轮询是否在跑（= 找到了目标且开关开着） */
  running: boolean
  lastSyncAt: string | null
  lastResult: string | null
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
export function discoverTargets(appDataDir: string): MirrorTarget[] {
  const auto = discoverPluginDataDirs(appDataDir)
  const out = [...auto]
  const manual = getLinkConfig().dataDir.trim()
  if (manual && !out.some((t) => t.pluginDataDir.toLowerCase() === manual.toLowerCase())) {
    out.push({ psMajor: psMajorFromPath(manual), pluginDataDir: manual })
  }
  return out
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
  state.appDataDir = opts.appDataDir
  state.appVersion = opts.appVersion
  state.workspaceRoot = opts.workspaceRoot

  if (process.env.VELLUM_PLUGIN_SYNC === '0') return // 硬开关（排障 / 测试壳）：与设置里的开关无关
  if (!getLinkConfig().enabled) return
  state.targets = discoverTargets(opts.appDataDir)
  if (state.targets.length === 0) return

  state.engine = new HandoffEngine({ workspaceRoot: opts.workspaceRoot, targets: state.targets })
  state.engine.start()
  await syncNow()
}

/** 停止服务（will-quit / 切工作区时调） */
export function stopLinkService(): void {
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
  state.targets = discoverTargets(state.appDataDir)
  if (state.targets.length > 0) {
    state.engine = new HandoffEngine({ workspaceRoot: state.workspaceRoot, targets: state.targets })
    state.engine.start()
  }
  return state.targets.length
}

/** 手动同步（「同步到插件」按钮 / 启动首扫）。返回本次结果。 */
export async function syncNow(): Promise<MirrorWriteResult> {
  if (state.targets.length === 0) state.targets = discoverTargets(state.appDataDir)
  const r = await syncTaskMirror(state.workspaceRoot, state.targets, { appVersion: state.appVersion })
  setLinkSyncInfo(
    isoLocal(),
    r.ok
      ? `ok rev=${r.revision} count=${r.count} thumbs=${r.thumbs} dirs=${r.targets.length}`
      : `fail ${r.error ?? 'unknown'}`
  )
  return r
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
    lastResult: info.lastResult
  }
}

/** 供 UI 展示：镜像目录里有哪些东西（排障用） */
export const MIRROR_DIRNAME = MIRROR_DIR
export const HANDOFF_DIRNAME = HANDOFF_DIR
