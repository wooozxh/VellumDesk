import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * 第 70 批（docs/55）：界面外观偏好（深/浅双主题）。
 *
 * 为什么**不存工作区库**（`meta` 表）：主题是"这台机器上这个人的习惯"，
 * 而工作区可能整个在移动硬盘上 —— 盘没插时库都打不开，界面却还得知道自己该是深色还是浅色。
 * 所以落在 `userData/ui-prefs.json`，与工作区解耦。
 *
 * 读写都**绝不抛**：这个文件坏掉最多丢一个偏好，不能让软件启动失败或主题切换报错
 * （与 `workspace.json` 的容错口径一致）。
 *
 * 第 81 批：从「只有 theme」扩成三个键（theme / density / startView）。
 * 老文件只有 theme 也照样能读 —— 缺的键一律走缺省值，不要求用户重新设置。
 */
export type Theme = 'dark' | 'light'
/** 列表密度（第 81 批）：表格行高 + 卡片间距。两档，不给三档 —— 再多就没人分得清 */
export type Density = 'standard' | 'compact'
/** 启动时停在那一屏（第 81 批）。'last' = 上次关软件时待的那一屏 */
export type StartView = 'last' | 'tickets' | 'packs' | 'files' | 'brand' | 'tpl'

export interface UiPrefs {
  theme: Theme
  density: Density
  startView: StartView
}

const FILE = 'ui-prefs.json'

/** 缺省深色 —— 老用户升级上来看到的第一眼必须还是他熟悉的那个样子 */
export const DEFAULT_THEME: Theme = 'dark'
/** 缺省标准密度 —— 与升级前完全一致 */
export const DEFAULT_DENSITY: Density = 'standard'
/** 缺省「上次那屏」—— 升级前就是这个行为（App 里固定停工单队列） */
export const DEFAULT_START_VIEW: StartView = 'last'

export function isTheme(v: unknown): v is Theme {
  return v === 'dark' || v === 'light'
}

export function isDensity(v: unknown): v is Density {
  return v === 'standard' || v === 'compact'
}

export function isStartView(v: unknown): v is StartView {
  return v === 'last' || v === 'tickets' || v === 'packs' || v === 'files' || v === 'brand' || v === 'tpl'
}

/** 读全部偏好（每个键单独校验，坏一个不影响其它） */
export function readUiPrefs(userDataDir: string): UiPrefs {
  const fallback: UiPrefs = {
    theme: DEFAULT_THEME,
    density: DEFAULT_DENSITY,
    startView: DEFAULT_START_VIEW
  }
  try {
    const p = join(userDataDir, FILE)
    if (!existsSync(p)) return fallback
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown> | null
    return {
      theme: isTheme(raw?.['theme']) ? raw['theme'] : DEFAULT_THEME,
      density: isDensity(raw?.['density']) ? raw['density'] : DEFAULT_DENSITY,
      startView: isStartView(raw?.['startView']) ? raw['startView'] : DEFAULT_START_VIEW
    }
  } catch {
    return fallback
  }
}

/**
 * 写单个键，保留文件里其它键（含未来版本写的、本版本不认识的键）。
 * 三个偏好共用一个实现 —— 各写各的容易互相覆盖（第 70 批只写 theme 时不用担心，
 * 一旦变成多键就必须先读回来再合并）。
 */
function patchPref<K extends keyof UiPrefs>(userDataDir: string, key: K, value: UiPrefs[K]): void {
  let existing: Record<string, unknown> = {}
  try {
    const p = join(userDataDir, FILE)
    if (existsSync(p)) existing = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
  } catch {
    existing = {}
  }
  try {
    writeFileSync(
      join(userDataDir, FILE),
      JSON.stringify({ ...existing, [key]: value }, null, 2),
      'utf-8'
    )
  } catch {
    // 盘只读等极端情况：本次会话照常切（界面已经改了），只是下次启动不记得
  }
}

export function writeTheme(userDataDir: string, theme: Theme): Theme {
  const next: Theme = isTheme(theme) ? theme : DEFAULT_THEME
  patchPref(userDataDir, 'theme', next)
  return next
}

export function writeDensity(userDataDir: string, density: Density): Density {
  const next: Density = isDensity(density) ? density : DEFAULT_DENSITY
  patchPref(userDataDir, 'density', next)
  return next
}

export function writeStartView(userDataDir: string, startView: StartView): StartView {
  const next: StartView = isStartView(startView) ? startView : DEFAULT_START_VIEW
  patchPref(userDataDir, 'startView', next)
  return next
}
