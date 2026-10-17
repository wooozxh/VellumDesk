/**
 * 第 67 批（docs/50）：**卡片视图 / 列表视图**切换。
 *
 * 背景（用户原话）：「以后东西会越攒越多，卡片视图占的空间太大」——
 * 所以两个视图分工不同，不是二选一：
 * · **卡片**：看缩略图选东西（视觉判断哪个是想要的那张）；
 * · **列表**：整体浏览 + 勾选做批量操作（一屏看几十条，还能按列扫）。
 *
 * 三处共用（任务视图 / 通用库 / 模板库），**各自的偏好独立记忆** ——
 * 在任务视图切了列表，不该顺手把通用库也切了。
 */
import { useCallback, useState } from 'react'
import { COPY } from '../../../shared/copy'
import { Icon } from './Icon'

export type ViewMode = 'card' | 'list'

/**
 * 记住每个视图的选择（`localStorage`）。
 *
 * ⚠️ 读的时候**必须 try/catch**：打包版里 `localStorage` 有可能被
 * 企业策略 / 隐私设置禁掉，直接读会抛 `SecurityError` 把整个视图挂掉。
 * 读不到就退回 `card`（默认视图，永远安全）。
 */
export function useViewMode(key: string): [ViewMode, (m: ViewMode) => void] {
  const storageKey = `vellum.view.${key}`
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(storageKey) === 'list' ? 'list' : 'card'
    } catch {
      return 'card'
    }
  })
  const set = useCallback(
    (m: ViewMode) => {
      setMode(m)
      try {
        localStorage.setItem(storageKey, m)
      } catch {
        /* 存不进去也不影响本次使用 */
      }
    },
    [storageKey]
  )
  return [mode, set]
}

export function ViewSwitch({
  mode,
  onChange
}: {
  mode: ViewMode
  onChange: (m: ViewMode) => void
}): React.JSX.Element {
  return (
    <div className="viewswitch" role="group" aria-label={COPY.common.viewSwitchLabel}>
      <button
        type="button"
        className={mode === 'card' ? 'on' : ''}
        title={COPY.common.viewCard}
        aria-pressed={mode === 'card'}
        onClick={() => onChange('card')}
      >
        <Icon name="grid" size={13} />
      </button>
      <button
        type="button"
        className={mode === 'list' ? 'on' : ''}
        title={COPY.common.viewList}
        aria-pressed={mode === 'list'}
        onClick={() => onChange('list')}
      >
        <Icon name="listView" size={13} />
      </button>
    </div>
  )
}
