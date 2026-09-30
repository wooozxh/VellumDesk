import { useMemo, useState } from 'react'
import type { DimensionGroup, TagWithCount } from '../types'

/**
 * 第 3 批 C-02：标签管理弹窗（增 / 改名 / 改色 / 删）。
 *
 * 约定：
 * - 同名同维度不允许；跨维度允许同名
 * - 删标签前先查使用量，被 N 条素材用着就明确提示，确认才删（素材本身不动）
 *
 * 第 10 批（2026-09-30 用户拍板）：**「物料类别」这个维度管着两处东西** ——
 * 除了素材上的标签，它还同时是建包时的类别清单（`packs.category` 存的是类别名）。
 * 所以这里的增删改都会影响包：
 *   · 加一个类别 → 新建包弹窗当场能选到
 *   · 改名      → 已有包的类别跟着改名（后端同一事务里做）
 *   · 删除      → 先弹确认把「有 N 个包正在用它」说清楚，确认后这些包的类别归「未分类」
 * 其余两个维度（使用渠道 / 状态）跟包无关，行为跟以前完全一样。
 */
export function TagManagerModal({
  dimensions,
  focusDimension,
  onClose,
  onChanged,
  toast,
  scopeLabel = '全部'
}: {
  dimensions: DimensionGroup[]
  /** 打开时定位到哪个维度 */
  focusDimension?: string
  onClose: () => void
  onChanged: () => Promise<void> | void
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void
  /** 左栏当前项目范围名（'全部' / 项目名 / '待归类'）—— 列表里的数字就是这个范围的（第 7 批） */
  scopeLabel?: string
}): React.JSX.Element {
  const editableDims = useMemo(
    () => dimensions.filter((d) => d.editable),
    [dimensions]
  )
  const [dimKey, setDimKey] = useState<string>(focusDimension ?? editableDims[0]?.key ?? '')
  const dim = dimensions.find((d) => d.key === dimKey) ?? editableDims[0]

  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDel, setConfirmDel] = useState<{
    tag: TagWithCount
    usage: number
    /** 有多少个包的类别正是它（只有「物料类别」维度会大于 0） */
    packCount: number
  } | null>(null)

  const add = async (): Promise<void> => {
    if (busy || !dim) return
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const r = await window.api.createTag({ dimension: dim.key, name })
    setBusy(false)
    if (!r.ok) {
      toast(r.error ?? '新建失败', 'err')
      return
    }
    setNewName('')
    toast(`标签「${name}」已加到「${dim.label}」`, 'ok')
    await onChanged()
  }

  const saveEdit = async (tag: TagWithCount): Promise<void> => {
    const name = editName.trim()
    if (!name || name === tag.name) {
      setEditingId(null)
      return
    }
    const r = await window.api.updateTag(tag.id, { name })
    if (!r.ok) {
      toast(r.error ?? '改名失败', 'err')
      return
    }
    setEditingId(null)
    toast('标签已改名', 'ok')
    await onChanged()
  }

  const recolor = async (tag: TagWithCount, color: string): Promise<void> => {
    const r = await window.api.updateTag(tag.id, { color })
    if (!r.ok) {
      toast(r.error ?? '改色失败', 'err')
      return
    }
    await onChanged()
  }

  const askDelete = async (tag: TagWithCount): Promise<void> => {
    const u = await window.api.tagUsage(tag.id)
    setConfirmDel({ tag, usage: u.assetCount, packCount: u.packCount })
  }

  const doDelete = async (): Promise<void> => {
    if (!confirmDel) return
    const { tag } = confirmDel
    const r = await window.api.removeTag(tag.id)
    setConfirmDel(null)
    if (!r.ok) {
      toast(r.error ?? '删除失败', 'err')
      return
    }
    const packs = r.packsAffected ?? 0
    toast(
      `标签「${tag.name}」已删除` +
        (r.deleted > 0 ? `，${r.deleted} 条素材的该标签已摘掉` : '') +
        (packs > 0 ? `，${packs} 个包的类别已归到「未分类」` : ''),
      'ok'
    )
    await onChanged()
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 560 }}>
        <h3>
          🏷 标签管理
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </h3>

        <div className="content">
          {/* 维度切换 */}
          <div className="tm-dims">
            {editableDims.map((d) => (
              <button
                key={d.key}
                className={`tm-dim${d.key === dimKey ? ' on' : ''}`}
                onClick={() => {
                  setDimKey(d.key)
                  setEditingId(null)
                }}
              >
                {d.label}
                <span className="n">{d.tags.length}</span>
              </button>
            ))}
          </div>

          <div className="hint" style={{ marginBottom: 10 }}>
            {dim?.hint}
            {dim?.mode === 'single' && ' · 该维度每张素材只能有一个标签'}
          </div>

          {/* 新增 */}
          <div className="tm-add">
            <input
              type="text"
              value={newName}
              placeholder={`给「${dim?.label ?? ''}」加一个新标签…`}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add()
              }}
            />
            <button className="btn primary" onClick={add} disabled={busy || !newName.trim()}>
              ＋ 添加
            </button>
          </div>

          {/* 列表 */}
          <div className="tm-list">
            {dim?.tags.length === 0 && <div className="tm-empty">这个维度还没有标签</div>}
            {dim?.tags.map((t) => (
              <div className="tm-row" key={t.id}>
                {editingId === t.id ? (
                  <>
                    <input
                      className="tm-edit"
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(t)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                    <button className="mini ok" onClick={() => saveEdit(t)} title="保存">
                      ✓
                    </button>
                    <button className="mini" onClick={() => setEditingId(null)} title="取消">
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <span className="tm-dot" style={{ background: t.color }} />
                    <span className="tm-name">{t.name}</span>
                    <span className="tm-cnt" title={`使用该标签的素材数（当前范围：${scopeLabel === '全部' ? '全库' : scopeLabel}）`}>
                      {t.assetCount}
                    </span>
                    <input
                      className="tm-color"
                      type="color"
                      value={t.color}
                      onChange={(e) => recolor(t, e.target.value)}
                      title="改颜色"
                    />
                    <button
                      className="mini"
                      title="改名"
                      onClick={() => {
                        setEditingId(t.id)
                        setEditName(t.name)
                      }}
                    >
                      ✎
                    </button>
                    <button className="mini danger" title="删除标签" onClick={() => askDelete(t)}>
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      {/* 删除二次确认 */}
      {confirmDel && (
        <div className="mask" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal" style={{ width: 400, zIndex: 2 }}>
            <h3>删除标签</h3>
            <div className="content">
              <div className="hint" style={{ color: 'var(--text)', fontSize: 13 }}>
                确定删除标签「<b>{confirmDel.tag.name}</b>」？
              </div>
              <div className="hint">
                {confirmDel.usage > 0
                  ? `全库共 ${confirmDel.usage} 条素材在用这个标签（含已解绑项目里的），删除后这些素材会失去这个标签（素材文件本身不会被删）。`
                  : '全库还没有任何素材用过这个标签。'}
              </div>
              {confirmDel.packCount > 0 && (
                <div className="hint" style={{ color: 'var(--danger)' }}>
                  目前有 <b>{confirmDel.packCount}</b> 个包正在使用这个类别，删除后这些包的类别也会一并去掉（归为「未分类」）。
                </div>
              )}
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setConfirmDel(null)}>
                取消
              </button>
              <button className="btn danger" onClick={doDelete}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
