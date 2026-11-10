/**
 * 第 70 批（docs/55）：深 / 浅双主题的**首屏定调**。
 *
 * 为什么不在 `App.tsx` 的 `useEffect` 里设：那时 React 已经渲染完一帧，
 * 浅色用户会先看到深色界面闪一下再变白。这里在 `createRoot().render()` **之前**执行，
 * 首帧就是对的。
 *
 * 值的来源：主进程在 `loadFile/loadURL` 时把 `?theme=light` 带进 URL
 * （见 `src/main/index.ts` 的 createWindow）。取不到就当深色 —— 与 `uiPrefs` 的缺省一致。
 *
 * ⚠️ `index.html` 的 CSP 是 `script-src 'self'`，**不能写内联脚本**，
 * 所以这段必须是一个独立模块，且要保证在 `render()` 之前被 import 到。
 *
 * 第 81 批：同一个入口也带上了**列表密度**和**启动视图** —— 三者都是"首帧就得对"的东西，
 * 走同一条 query 串比各开一条 IPC 往返简单（晚一步设置就会闪一下）。
 */
export type Theme = 'dark' | 'light'
export type Density = 'standard' | 'compact'

export const THEME_ATTR = 'data-theme'
export const DENSITY_ATTR = 'data-density'

/** 启动时该停在哪一屏（'last' = 上次那屏，由 App 读 localStorage 决定） */
export type BootStart = 'last' | 'tickets' | 'packs' | 'files' | 'brand' | 'tpl'

export function readBootTheme(): Theme {
  try {
    const q = new URLSearchParams(window.location.search).get('theme')
    return q === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function readBootDensity(): Density {
  try {
    const q = new URLSearchParams(window.location.search).get('density')
    return q === 'compact' ? 'compact' : 'standard'
  } catch {
    return 'standard'
  }
}

export function readBootStart(): BootStart {
  try {
    const q = new URLSearchParams(window.location.search).get('start')
    if (q === 'tickets' || q === 'packs' || q === 'files' || q === 'brand' || q === 'tpl') return q
    return 'last'
  } catch {
    return 'last'
  }
}

/** 打到 `<html>` 上；深色时**移除属性**（让 `:root` 的缺省值生效，CSS 只有一份覆盖块） */
export function applyTheme(theme: Theme): void {
  const el = document.documentElement
  if (theme === 'light') el.setAttribute(THEME_ATTR, 'light')
  else el.removeAttribute(THEME_ATTR)
}

/** 同理：标准密度 = 移除属性，走 `:root` 的缺省值；只有紧凑才写覆盖块 */
export function applyDensity(density: Density): void {
  const el = document.documentElement
  if (density === 'compact') el.setAttribute(DENSITY_ATTR, 'compact')
  else el.removeAttribute(DENSITY_ATTR)
}

export function bootTheme(): Theme {
  const t = readBootTheme()
  applyTheme(t)
  return t
}

/** 首屏一次把外观定完（主题 + 密度），返回实际生效的值供调用方复用 */
export function bootAppearance(): { theme: Theme; density: Density } {
  const theme = readBootTheme()
  const density = readBootDensity()
  applyTheme(theme)
  applyDensity(density)
  return { theme, density }
}
