import { useEffect, useMemo, useState } from 'react'
import type { AssetItem, PackDetail } from '../types'
import { fmtSize } from './FileRow'

const ROLE_ORDER = ['成品', '素材', '工程', '未归属'] as const

function ThumbCell({
  item,
  selected,
  onToggle,
  onOpen,
  onReveal
}: {
  item: AssetItem
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  onReveal: () => void
}): React.JSX.Element {
  return (
    <div
      className={`thumb-cell${selected ? ' sel' : ''}`}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onReveal()
      }}
      title={`${item.file_name}\n${item.rel_path}\n双击打开 · 右键定位`}
    >
      <input
        className="cbwrap"
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="box">
        {item.thumb ? <img src={item.thumb} alt={item.file_name} /> : <div className="ext">{item.ext || '文件'}</div>}
      </div>
      <div className="cap" title={item.file_name}>
        {item.file_name}
      </div>
    </div>
  )
}

/**
 * A-08 点开包 → 三组展开。
 * 「未归属的文件」是本包内的一层保险：直接丢在包根目录、没进三个子文件夹的文件。
 */
export function PackDetailModal({
  packId,
  subFolders,
  onClose,
  onChanged,
  toast
}: {
  packId: number | 'unassigned'
  subFolders: string[]
  onClose: () => void
  onChanged: () => void
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<PackDetail | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [target, setTarget] = useState(subFolders[0] ?? '01-成品')
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    const d = await window.api.packDetail(packId as number)
    setDetail(d)
  }

  useEffect(() => {
    if (packId !== 'unassigned') load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId])

  const allItems = useMemo(() => {
    if (!detail) return [] as AssetItem[]
    return ROLE_ORDER.flatMap((r) => detail.groups[r] ?? [])
  }, [detail])

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** A-09：把选中的文件搬进目标子文件夹 */
  const moveSelected = async (): Promise<void> => {
    if (!detail || busy || selected.size === 0) return
    const paths = allItems.filter((i) => selected.has(i.id)).map((i) => i.abs_path)
    setBusy(true)
    const res = await window.api.claim({ paths, packId: detail.pack.id, subFolder: target })
    setBusy(false)
    if (res.ok) {
      toast(`已移动 ${res.moved} 个文件到「${target}」`, 'ok')
    } else {
      toast(`移动完成 ${res.moved} 个，${res.errors.length} 个失败：${res.errors[0]}`, 'err')
    }
    setSelected(new Set())
    await load()
    onChanged()
  }

  const openFile = async (p: string): Promise<void> => {
    const r = await window.api.openFile(p)
    if (!r.ok) toast(r.error ?? '打开失败', 'err')
  }

  const reveal = (p: string): void => {
    window.api.revealFile(p)
  }

  const total = allItems.length

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <h3>
          {detail ? (
            <>
              🗂 {detail.pack.name}
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                {detail.pack.folder_path}
              </span>
            </>
          ) : (
            '加载中…'
          )}
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </h3>

        <div className="content">
          {detail && (
            <>
              <div className="detail-head">
                <div className="info">
                  <div className="row">
                    <span className="k">所属项目：</span>
                    <span className="tag proj">{detail.pack.project}</span>
                    <span className="k">类别：</span>
                    <span className="tag">{detail.pack.category}</span>
                  </div>
                  <div className="row">
                    <span className="k">共 {total} 个文件 ·</span>
                    <span>{fmtSize(allItems.reduce((s, i) => s + i.size, 0))}</span>
                    <span className="k">· 创建于</span>
                    <span>{new Date(detail.pack.created_at).toLocaleString('zh-CN')}</span>
                  </div>
                </div>
                <button className="btn" onClick={() => window.api.openFolder(detail.pack.folder_path)}>
                  📁 打开文件夹
                </button>
              </div>

              {selected.size > 0 && (
                <div className="claimbar">
                  <span className="txt">已选中 {selected.size} 个文件</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>移动到</span>
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    {subFolders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <button className="btn primary" onClick={moveSelected} disabled={busy}>
                    {busy ? '移动中…' : '确定移动'}
                  </button>
                  <button className="btn" onClick={() => setSelected(new Set())}>
                    取消选择
                  </button>
                </div>
              )}

              {ROLE_ORDER.map((role) => {
                const items = detail.groups[role] ?? []
                const isUnassignedGroup = role === '未归属'
                const label =
                  role === '成品'
                    ? '成品'
                    : role === '素材'
                      ? '素材'
                      : role === '工程'
                        ? '工程文件'
                        : '未归属的文件'
                return (
                  <div className="group" key={role}>
                    <h5>
                      {label}
                      <span className="n">（{items.length}）</span>
                      {isUnassignedGroup && items.length > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--warn)', fontWeight: 400 }}>
                          丢在包根目录、没进子文件夹的文件，可选中后移动进对应组
                        </span>
                      )}
                      {items.length > 0 && (
                        <button
                          className="bulk"
                          onClick={() =>
                            setSelected((prev) => {
                              const next = new Set(prev)
                              const allIn = items.every((i) => next.has(i.id))
                              items.forEach((i) => (allIn ? next.delete(i.id) : next.add(i.id)))
                              return next
                            })
                          }
                        >
                          {items.every((i) => selected.has(i.id)) ? '取消全选' : '全选本组'}
                        </button>
                      )}
                    </h5>
                    {items.length === 0 ? (
                      <div className="group-empty">暂无文件</div>
                    ) : (
                      <div className="thumb-grid">
                        {items.map((it) => (
                          <ThumbCell
                            key={it.id}
                            item={it}
                            selected={selected.has(it.id)}
                            onToggle={() => toggle(it.id)}
                            onOpen={() => openFile(it.abs_path)}
                            onReveal={() => reveal(it.abs_path)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
