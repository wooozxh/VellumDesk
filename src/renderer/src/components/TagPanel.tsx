import { useMemo, useState } from 'react'
import type { DimensionGroup } from '../types'

/**
 * 第 3 批 C-01 / C-08：左栏「维度式」标签筛选面板。
 *
 * 交互约定（方案 docs/05-MVP标签与检索方案.md 第 6 节）：
 * - 每个维度可折叠；已勾选的维度自动展开并在标题上显示已选数量
 * - 同维度内多选 = 「或」（点了海报 + 折页，两类都出来）
 * - 跨维度 = 「并且」（海报 且 抖音 → 只出既贴海报又贴抖音的）
 * - 单选维度（状态）点新标签自动替换旧的
 * - 顶部一行汇总「已选 N 个」，一键清除
 * - 项目归属不在这里（走左栏项目面板）；时间用物料固有字段，都不做成标签
 *
 * 组件只负责勾选与回显，筛选发生在界面层（交给 listAssets 的 tagIds）。
 */
export function TagPanel({
  dimensions,
  selected,
  onChange,
  onManage
}: {
  dimensions: DimensionGroup[]
  /** 已选 tagId（项目维度为负数 id） */
  selected: number[]
  onChange: (next: number[]) => void
  /** 打开标签管理弹窗（传维度 key 表示定位到该维度） */
  onManage: (dimension?: string) => void
}): React.JSX.Element {
  const selectedSet = useMemo(() => new Set(selected), [selected])

  /** 每个维度已选了几个 —— 用于标题徽标与自动展开 */
  const pickedByDim = useMemo(() => {
    const m: Record<string, number[]> = {}
    for (const d of dimensions) {
      const ids = d.tags.filter((t) => selectedSet.has(t.id)).map((t) => t.id)
      m[d.key] = ids
    }
    return m
  }, [dimensions, selectedSet])

  /** 折叠状态：有选择的默认展开 */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const isOpen = (key: string): boolean =>
    collapsed[key] === undefined ? (pickedByDim[key]?.length ?? 0) > 0 : !collapsed[key]

  const toggle = (dim: DimensionGroup, tagId: number): void => {
    const single = dim.mode === 'single'
    if (single) {
      // 单选维度：点已选的取消，点未选的替换
      const cur = pickedByDim[dim.key] ?? []
      const isPicked = cur.includes(tagId)
      const next = selected.filter((id) => !cur.includes(id))
      onChange(isPicked ? next : [...next, tagId])
      return
    }
    onChange(
      selectedSet.has(tagId) ? selected.filter((id) => id !== tagId) : [...selected, tagId]
    )
  }

  const totalPicked = selected.length

  return (
    <div className="tag-panel">
      <div className="tp-head">
        <h4 style={{ padding: 0 }}>筛选标签</h4>
        {totalPicked > 0 && (
          <button className="tp-clear" onClick={() => onChange([])} title="清除全部已选标签">
            清除 {totalPicked}
          </button>
        )}
      </div>

      {dimensions.map((dim) => {
        const picked = pickedByDim[dim.key] ?? []
        const open = isOpen(dim.key)
        return (
          <div className="tp-dim" key={dim.key}>
            <button
              className={`tp-dim-head${picked.length ? ' has' : ''}`}
              onClick={() => setCollapsed((c) => ({ ...c, [dim.key]: open }))}
              title={dim.hint}
            >
              <span className={`caret${open ? ' open' : ''}`}>▸</span>
              <span className="tp-dim-label">{dim.label}</span>
              {picked.length > 0 && <span className="tp-badge">{picked.length}</span>}
              <span className="tp-dim-n">{dim.tags.length}</span>
            </button>

            {open && (
              <div className="tp-tags">
                {dim.tags.length === 0 && (
                  <span className="tp-empty">
                    {dim.editable ? '还没有标签，点「管理」加一个' : '暂无'}
                  </span>
                )}
                {dim.tags.map((t) => {
                  const on = selectedSet.has(t.id)
                  return (
                    <button
                      key={t.id}
                      className={`tp-tag${on ? ' on' : ''}`}
                      onClick={() => toggle(dim, t.id)}
                      title={`${t.name} · ${t.assetCount} 条素材`}
                      style={
                        on
                          ? { background: t.color, borderColor: t.color, color: '#fff' }
                          : { borderColor: t.color + '66' }
                      }
                    >
                      {!on && <i className="cdot" style={{ background: t.color }} />}
                      <span className="tp-tag-name">{t.name}</span>
                      <span className="tp-tag-n">{t.assetCount}</span>
                    </button>
                  )
                })}
                {dim.editable && (
                  <button className="tp-add" onClick={() => onManage(dim.key)}>
                    ＋ 管理
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
