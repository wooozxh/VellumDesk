import { useMemo, useState } from 'react'
import type { DimensionGroup } from '../types'
import { Icon } from './Icon'

/**
 * 第 3 批 C-03 / C-07：给已勾选的一批素材打标签（用户拍板的入口：列表勾选批量打）。
 *
 * 设计要点：
 * - 顶部一句话说清要打给几条素材，防误操作
 * - 5 个维度全在，点标签即选中；可选「只贴不覆盖」或默认的「同维度覆盖」
 * - C-07 自动建议：按文件名/路径猜出的标签，在标签右上角打个小星标，但绝不自动勾选
 */
export function TagPickerModal({
  assetIds,
  dimensions,
  suggestions,
  onClose,
  onSubmit
}: {
  assetIds: number[]
  dimensions: DimensionGroup[]
  /** 素材 id → 建议 tagId（C-07，可为空对象） */
  suggestions: Record<number, number[]>
  onClose: () => void
  onSubmit: (args: { assetIds: number[]; tagIds: number[] }) => Promise<void>
}): React.JSX.Element {
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  /** 默认覆盖：同一维度旧标签会被清掉，符合「批量整理」的直觉 */
  const [overwrite] = useState(true)

  /** 建议命中的 tagId 集合（所有选中素材的建议并集） */
  const suggestedIds = useMemo(() => {
    const s = new Set<number>()
    for (const id of assetIds) for (const t of suggestions[id] ?? []) s.add(t)
    return s
  }, [assetIds, suggestions])

  const toggle = (dim: DimensionGroup, tagId: number): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) {
        next.delete(tagId)
        return next
      }
      // 单选维度：先把该维度已有的都摘掉
      if (dim.mode === 'single') {
        for (const t of dim.tags) next.delete(t.id)
      }
      next.add(tagId)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    if (busy || picked.size === 0) return
    setBusy(true)
    await onSubmit({ assetIds, tagIds: [...picked] })
    setBusy(false)
  }

  /** 把建议一次全选上（用户显式点才生效） */
  const pickAllSuggested = (): void => {
    setPicked((prev) => new Set([...prev, ...suggestedIds]))
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 620 }}>
        <h3>
          <Icon name="tag" size={15} /> 给 {assetIds.length} 个文件打标签
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="content">
          <div className="hint" style={{ marginBottom: 8 }}>
            同一维度内点多个 = 一次贴多个；同一个标签维度内每张素材保留最后选中的（批量整理更顺手）。
          </div>

          {suggestedIds.size > 0 && (
            <div className="tp-sug-bar">
              <span>
                <Icon name="bulb" size={13} /> 按文件名猜出 {suggestedIds.size} 个可能的标签
              </span>
              <button className="linky" onClick={pickAllSuggested}>
                全部选中
              </button>
            </div>
          )}

          <div className="tp-pick-body">
            {dimensions.map((dim) => (
              <div className="tp-pick-dim" key={dim.key}>
                <div className="tp-pick-label">
                  {dim.label}
                  <span className="tp-pick-mode">{dim.mode === 'single' ? '单选' : '多选'}</span>
                </div>
                <div className="tp-tags">
                  {dim.tags.length === 0 && <span className="tp-empty">暂无标签</span>}
                  {dim.tags.map((t) => {
                    const on = picked.has(t.id)
                    const sug = suggestedIds.has(t.id)
                    return (
                      <button
                        key={t.id}
                        className={`tp-tag${on ? ' on' : ''}${sug ? ' sug' : ''}`}
                        onClick={() => toggle(dim, t.id)}
                        title={sug ? `${t.name}（文件名可能匹配）` : t.name}
                        style={
                          on
                            ? { background: t.color, borderColor: t.color, color: '#fff' }
                            : { borderColor: t.color + '66' }
                        }
                      >
                        {!on && <i className="cdot" style={{ background: t.color }} />}
                        <span className="tp-tag-name">{t.name}</span>
                        {sug && <span className="tp-star" title="自动建议">
                          <Icon name="star" size={10} />
                        </span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {overwrite && picked.size > 0 && (
            <div className="hint" style={{ color: 'var(--warn)' }}>
              注意：已选维度上的旧标签会被这批新标签替换掉
            </div>
          )}
        </div>

        <div className="foot">
          <span className="tp-picked-n">已选 {picked.size} 个标签</span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={apply} disabled={busy || picked.size === 0}>
            {busy ? '正在打标签…' : `贴到 ${assetIds.length} 个文件`}
          </button>
        </div>
      </div>
    </div>
  )
}
