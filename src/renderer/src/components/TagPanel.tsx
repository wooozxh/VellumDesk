import { COPY, fmt } from '../../../shared/copy'
import { Rich } from './Rich'
import { useMemo, useState } from 'react'
import type { DimensionGroup } from '../types'
import { Icon } from './Icon'

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
 * - 标签后面的数字 = **当前左栏项目范围内**贴了该标签的素材条数（第 7 批起跟随项目，
 *   之前是全库口径，选了项目后数字与右侧结果对不上）；0 条的标签仍列出但压暗
 * - 维度标题右边的数字是「这个维度下有几个标签」，别跟上面的素材数混
 *
 * 组件只负责勾选与回显，筛选发生在界面层（交给 listAssets 的 tagIds）。
 */
export function TagPanel({
  dimensions,
  selected,
  onChange,
  onManage,
  scopeLabel = '全部'
}: {
  dimensions: DimensionGroup[]
  /** 已选 tagId（项目维度为负数 id） */
  selected: number[]
  onChange: (next: number[]) => void
  /** 打开标签管理弹窗（传维度 key 表示定位到该维度） */
  onManage: (dimension?: string) => void
  /**
   * 当前左栏项目范围的显示名（'全部' / 项目名 / '待归类'）。
   * 标签后面的数字就是这个范围内的素材条数（第 7 批起跟随项目），
   * 悬停提示里必须说清是哪个范围，否则用户只能靠猜。
   */
  scopeLabel?: string
}): React.JSX.Element {
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const scopeText =
    scopeLabel === '全部'
      ? COPY.tagMgr.scopeAllLib
      : fmt(COPY.tagPanel.scopeIn, { name: scopeLabel })

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
        <h4 style={{ padding: 0 }}>{COPY.tagPanel.title}</h4>
        {totalPicked > 0 && (
          <button className="tp-clear" onClick={() => onChange([])} title={COPY.tagPanel.clearTip}>
            <Rich tpl={COPY.tagPanel.clear} v={{ n: totalPicked }} />
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
              <span className={`caret${open ? ' open' : ''}`}>
                <Icon name="caret" size={11} />
              </span>
              <span className="tp-dim-label">{dim.label}</span>
              {picked.length > 0 && <span className="tp-badge">{picked.length}</span>}
              <span className="tp-dim-n" title={fmt(COPY.tagPanel.dimCount, { n: dim.tags.length })}>
                {dim.tags.length}
              </span>
            </button>

            {open && (
              <div className="tp-tags">
                {dim.tags.length === 0 && (
                  <span className="tp-empty">
                    {dim.editable ? COPY.tagPanel.emptyEditable : COPY.tagPanel.empty}
                  </span>
                )}
                {dim.tags.map((t) => {
                  const on = selectedSet.has(t.id)
                  const zero = t.assetCount === 0
                  return (
                    <button
                      key={t.id}
                      className={`tp-tag${on ? ' on' : ''}${zero ? ' zero' : ''}`}
                      onClick={() => toggle(dim, t.id)}
                      title={
                        zero
                          ? fmt(COPY.tagPanel.usageNone, { name: t.name, scope: scopeText })
                          : fmt(COPY.tagPanel.usage, { name: t.name, scope: scopeText, n: t.assetCount })
                      }
                      style={
                        on
                          ? { background: t.color, borderColor: t.color, color: '#fff' }
                          : { borderColor: t.color + (zero ? '33' : '66') }
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
                    <Icon name="plus" size={11} strokeWidth={2} />  {COPY.tagPanel.manage}
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
