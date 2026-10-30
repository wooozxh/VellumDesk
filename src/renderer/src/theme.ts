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
 */
export type Theme = 'dark' | 'light'

export const THEME_ATTR = 'data-theme'

export function readBootTheme(): Theme {
  try {
    const q = new URLSearchParams(window.location.search).get('theme')
    return q === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** 打到 `<html>` 上；深色时**移除属性**（让 `:root` 的缺省值生效，CSS 只有一份覆盖块） */
export function applyTheme(theme: Theme): void {
  const el = document.documentElement
  if (theme === 'light') el.setAttribute(THEME_ATTR, 'light')
  else el.removeAttribute(THEME_ATTR)
}

export function bootTheme(): Theme {
  const t = readBootTheme()
  applyTheme(t)
  return t
}
