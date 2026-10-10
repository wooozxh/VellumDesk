/**
 * 第 62 批（docs/45 §3.6）：插件联动的**设置项**（meta 键集中定义，照 report.ts / tickets.ts 的路数）。
 *
 * 存在工作区库里（跟着工作区走，多工作区各有一套），不写全局配置。
 */
import { getMeta, setMeta } from './db'

/** meta 键（集中定义，别散落字符串） */
export const LINK_META = {
  /** '1' / '0'；缺省 = 开 */
  enabled: 'plugin_sync_enabled',
  /** 手填的 PluginData 目录（自动命中的兜底；空串 = 不用） */
  dataDir: 'plugin_data_dir',
  /** 最近一次同步时刻 */
  lastSyncAt: 'plugin_last_sync_at',
  /** 最近一次同步结果摘要 */
  lastResult: 'plugin_last_sync'
} as const

export interface LinkConfig {
  /** 变更自动同步开关（含启动首扫）。缺省开。 */
  enabled: boolean
  /** 手填的 PluginData 目录（兜底）。空串 = 未设置。 */
  dataDir: string
}

export interface LinkSyncInfo {
  lastSyncAt: string | null
  lastResult: string | null
}

export function getLinkConfig(): LinkConfig {
  const e = getMeta(LINK_META.enabled)
  return {
    enabled: e === null ? true : e !== '0',
    dataDir: getMeta(LINK_META.dataDir) ?? ''
  }
}

export function setLinkConfig(patch: Partial<LinkConfig>): LinkConfig {
  if (patch.enabled !== undefined) setMeta(LINK_META.enabled, patch.enabled ? '1' : '0')
  if (patch.dataDir !== undefined) setMeta(LINK_META.dataDir, patch.dataDir)
  return getLinkConfig()
}

export function getLinkSyncInfo(): LinkSyncInfo {
  return {
    lastSyncAt: getMeta(LINK_META.lastSyncAt),
    lastResult: getMeta(LINK_META.lastResult)
  }
}

export function setLinkSyncInfo(lastSyncAt: string, lastResult: string): void {
  setMeta(LINK_META.lastSyncAt, lastSyncAt)
  setMeta(LINK_META.lastResult, lastResult)
}
