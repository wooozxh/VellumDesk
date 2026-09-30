import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetItem, PackDetail, PackVersion } from '../types'
import { fmtSize } from './FileRow'
import { VersionBar } from './VersionBar'
import { VersionModal } from './VersionModal'
import { Icon } from './Icon'

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
  onEdit,
  toast
}: {
  packId: number | 'unassigned'
  subFolders: string[]
  onClose: () => void
  onChanged: () => void
  /** 第 7 批：编辑包信息（名称 / 类别 / 所属项目；待归类的包用它归位） */
  onEdit?: () => void
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<PackDetail | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [target, setTarget] = useState(subFolders[0] ?? '01-成品')
  const [busy, setBusy] = useState(false)
  // 第 9 批（M6）：当前在看哪一稿（null = 未分版本）；verModal = 新建/绑定弹窗
  const [selVer, setSelVer] = useState<number | null>(null)
  const [verModal, setVerModal] = useState<'create' | 'bind' | null>(null)
  const verInited = useRef(false)

  const load = async (): Promise<void> => {
    const d = await window.api.packDetail(packId as number)
    setDetail(d)
    if (!verInited.current) {
      // 首次打开：默认看当前版本（没有版本就看"未分版本"）
      verInited.current = true
      const cur = d.versions.find((v) => v.is_current === 1)
      setSelVer(cur ? cur.id : null)
    } else {
      // 之前选中的那一稿被解绑了 → 回到当前版本，别让界面空着
      setSelVer((prev) => {
        if (prev !== null && !d.versions.some((v) => v.id === prev)) {
          const cur = d.versions.find((v) => v.is_current === 1)
          return cur ? cur.id : null
        }
        return prev
      })
    }
  }

  useEffect(() => {
    if (packId !== 'unassigned') load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId])

  /** 只显示选中的那一稿的文件（未分版本 = version_id 为 null 的） */
  const filteredGroups = useMemo(() => {
    if (!detail) return {} as Record<string, AssetItem[]>
    const out: Record<string, AssetItem[]> = {}
    for (const role of ROLE_ORDER) {
      out[role] = (detail.groups[role] ?? []).filter((i) =>
        selVer === null ? i.version_id === null : i.version_id === selVer
      )
    }
    return out
  }, [detail, selVer])

  /** 还没归到任何一稿的文件数（决定要不要显示「未分版本」那一格） */
  const unassignedCount = useMemo(() => {
    if (!detail) return 0
    return ROLE_ORDER.flatMap((r) => detail.groups[r] ?? []).filter((i) => i.version_id === null)
      .length
  }, [detail])

  const allItems = useMemo(
    () => ROLE_ORDER.flatMap((r) => filteredGroups[r] ?? []),
    [filteredGroups]
  )

  const doSetCurrent = async (v: PackVersion): Promise<void> => {
    const r = await window.api.setCurrentVersion(v.id)
    if (!r.ok) {
      toast(r.error ?? '设置失败', 'err')
      return
    }
    toast(`已把 V${v.seq} 设为当前版本（文件夹一个都没动）`, 'ok')
    await load()
    onChanged()
  }

  const doUnbind = async (v: PackVersion): Promise<void> => {
    const r = await window.api.unbindVersion(v.id)
    if (!r.ok) {
      toast(r.error ?? '解绑失败', 'err')
      return
    }
    toast(`已解绑 V${v.seq}：文件夹和文件都没动，只是软件不再把它当一稿`, 'info')
    await load()
    onChanged()
  }

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
    const res = await window.api.claim({
      paths,
      packId: detail.pack.id,
      subFolder: target,
      // 第 9 批：正在看某一稿时，移动的目标是「那一稿文件夹里的这个组」，
      // 不然文件会被搬到包根目录下的三组、等于把它挪出了这一稿。
      // selVer === null（用户明确停在「未分版本」那格）→ 传 null，落包根三组。
      versionId: selVer
    })
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
              <Icon name="package" size={15} /> {detail.pack.name}
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                {detail.pack.folder_path}
              </span>
            </>
          ) : (
            '加载中…'
          )}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="content">
          {detail && (
            <>
              <div className="detail-head">
                <div className="info">
                  <div className="row">
                    <span className="k">所属项目：</span>
                    {detail.pack.projectName ? (
                      <span
                        className="tag proj"
                        style={{
                          color: detail.pack.projectColor ?? 'var(--accent)',
                          borderColor: (detail.pack.projectColor ?? '#4f8cff') + '77',
                          background: (detail.pack.projectColor ?? '#4f8cff') + '22'
                        }}
                      >
                        {detail.pack.projectName}
                      </span>
                    ) : (
                      <span
                        className="tag"
                        style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}
                      >
                        未指定项目
                      </span>
                    )}
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
                <button className="btn" onClick={() => onEdit && onEdit()} disabled={!onEdit}>
                  {detail.pack.project_id === null ? (
                    <>
                      <Icon name="inbox" size={13} /> 归位到项目
                    </>
                  ) : (
                    <>
                      <Icon name="edit" size={13} /> 编辑包信息
                    </>
                  )}
                </button>
                <button className="btn" onClick={() => window.api.openFolder(detail.pack.folder_path)}>
                  <Icon name="folder" size={13} /> 打开文件夹
                </button>
              </div>

              {/* 第 9 批（M6）：版本条 —— 一格一稿，点一下换视角 */}
              <VersionBar
                versions={detail.versions}
                selected={selVer}
                unassignedCount={unassignedCount}
                onSelect={setSelVer}
                onCreate={() => setVerModal('create')}
                onBind={() => setVerModal('bind')}
                onSetCurrent={doSetCurrent}
                onUnbind={doUnbind}
              />

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
                const items = filteredGroups[role] ?? []
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

      {/* 第 9 批（M6）：新建 / 绑定 弹窗（叠在包详情上面） */}
      {verModal && detail && (
        <VersionModal
          mode={verModal}
          packId={detail.pack.id}
          versions={detail.versions}
          unassignedCount={unassignedCount}
          onClose={() => setVerModal(null)}
          onDone={async (msg) => {
            setVerModal(null)
            toast(msg, 'ok')
            await load()
            onChanged()
          }}
          toast={toast}
        />
      )}
    </div>
  )
}
