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
 */
export type Theme = 'dark' | 'light'

export interface UiPrefs {
  theme: Theme
}

const FILE = 'ui-prefs.json'

/** 缺省深色 —— 老用户升级上来看到的第一眼必须还是他熟悉的那个样子 */
export const DEFAULT_THEME: Theme = 'dark'

export function isTheme(v: unknown): v is Theme {
  return v === 'dark' || v === 'light'
}

export function readUiPrefs(userDataDir: string): UiPrefs {
  try {
    const p = join(userDataDir, FILE)
    if (!existsSync(p)) return { theme: DEFAULT_THEME }
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as { theme?: unknown }
    return { theme: isTheme(raw?.theme) ? raw.theme : DEFAULT_THEME }
  } catch {
    return { theme: DEFAULT_THEME }
  }
}

/** 只写主题，不动别人的键（以后加别的界面偏好也不会互相覆盖） */
export function writeTheme(userDataDir: string, theme: Theme): Theme {
  const next: Theme = isTheme(theme) ? theme : DEFAULT_THEME
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
      JSON.stringify({ ...existing, theme: next }, null, 2),
      'utf-8'
    )
  } catch {
    // 盘只读等极端情况：本次会话照常切（界面已经改了），只是下次启动不记得
  }
  return next
}
