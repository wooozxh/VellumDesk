import { COPY, fmt } from '../../../shared/copy'
import { Rich } from './Rich'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetItem, PackDetail, PackVersion } from '../types'
import { fmtSize } from './FileRow'
import { VersionBar } from './VersionBar'
import { VersionModal } from './VersionModal'
import { PackExportModal } from './PackExportModal'
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
      title={fmt(COPY.pdm.fileTip, { name: item.file_name, path: item.rel_path })}
    >
      <input
        className="cbwrap"
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="box">
        {item.thumb ? <img src={item.thumb} alt={item.file_name} /> : <div className="ext">{item.ext || COPY.file.extFallback}</div>}
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
  packId: number
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
  // 第 15 批（M5）：打包交付弹窗
  const [exportOpen, setExportOpen] = useState(false)
  // 第 19 批（docs/22）：完成任务（生成缩略图写回工单队列）
  const [completeBusy, setCompleteBusy] = useState(false)
  const verInited = useRef(false)

  const load = async (): Promise<void> => {
    const d = await window.api.packDetail(packId)
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
    // 第 25 批：这里原来是 `if (packId !== 'unassigned') load()` —— 未归属池那条路
    // 从第 1 批起就没实现（不加载数据、组件里也没有对应分支），点开只能看到
    // 标题停在「加载中…」。现在未归属卡片改走文件视图（见 App.tsx），
    // 传进来的 packId 只可能是真实的包 id，直接加载即可。
    load()
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
      toast(r.error ?? COPY.pdm.setFailed, 'err')
      return
    }
    toast(fmt(COPY.pdm.setCurrent, { n: v.seq }), 'ok')
    await load()
    onChanged()
  }

  const doUnbind = async (v: PackVersion): Promise<void> => {
    const r = await window.api.unbindVersion(v.id)
    if (!r.ok) {
      toast(r.error ?? COPY.toast.projectUnbindFailed, 'err')
      return
    }
    toast(fmt(COPY.pdm.unbound, { n: v.seq }), 'info')
    await load()
    onChanged()
  }

  /**
   * 第 54 批（docs/39）：给任务文件夹在桌面 + 开始菜单建快捷方式。
   * 目标位置已有同名 `.lnk` 时主进程**什么都不做**、回 `conflict`，
   * 这里问一句再带 overwrite 重来（探针实测：API 自己不会报错，只能我们问）。
   */
  const makeShortcut = async (overwrite = false): Promise<void> => {
    const name = detail?.pack.name ?? ''
    const r = await window.api.packCreateShortcut(packId, overwrite)
    if (r.conflict) {
      if (window.confirm(fmt(COPY.sht.confirmOverwrite, { name }))) {
        await makeShortcut(true)
      }
      return
    }
    if (!r.ok) {
      toast(r.msg ?? COPY.common.failed, 'err')
      return
    }
    if (r.skipped) return
    toast(fmt(COPY.sht.ok, { name }), 'ok')
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
      toast(fmt(COPY.pdm.moved, { n: res.moved, target: target }), 'ok')
    } else {
      toast(fmt(COPY.pdm.movePartial, { n: res.moved, e: res.errors.length, first: res.errors[0] }), 'err')
    }
    setSelected(new Set())
    await load()
    onChanged()
  }

  const openFile = async (p: string): Promise<void> => {
    const r = await window.api.openFile(p)
    if (!r.ok) toast(r.error ?? COPY.toast.packOpenFailed, 'err')
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
            COPY.common.loading
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
                    <span className="k">{COPY.pdm.projectLabel}</span>
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
                        
                        {COPY.card.noProject}
                      </span>
                    )}
                    <span className="k">{COPY.pdm.categoryLabel}</span>
                    <span className="tag">{detail.pack.category}</span>
                  </div>
                  <div className="row">
                    <span className="k"><Rich tpl={COPY.pdm.fileCount} v={{ n: total }} /></span>
                    <span>{fmtSize(allItems.reduce((s, i) => s + i.size, 0))}</span>
                    <span className="k">{COPY.pdm.createdAt}</span>
                    <span>{new Date(detail.pack.created_at).toLocaleString('zh-CN')}</span>
                  </div>
                </div>
                <button className="btn" onClick={() => onEdit && onEdit()} disabled={!onEdit}>
                  {detail.pack.project_id === null ? (
                    <>
                      <Icon name="inbox" size={13} />  {COPY.editPack.titleLoose}
                    </>
                  ) : (
                    <>
                      <Icon name="edit" size={13} />  {COPY.editPack.title}
                    </>
                  )}
                </button>
                <button className="btn" onClick={() => window.api.openFolder(detail.pack.folder_path)}>
                  <Icon name="folder" size={13} />  {COPY.common.openFolder}
                </button>
                {/* 第 54 批（docs/39）：桌面 + 开始菜单快捷方式 */}
                <button
                  className="btn"
                  title={COPY.sht.btnTip}
                  onClick={() => void makeShortcut()}
                >
                  <Icon name="shortcut" size={13} />  {COPY.sht.btn}
                </button>
                <button
                  className="btn primary"
                  onClick={() => setExportOpen(true)}
                  title={COPY.exportPack.btnTip}
                >
                  <Icon name="archive" size={13} />  {COPY.exportPack.btn}
                </button>
                <button
                  className="btn"
                  disabled={completeBusy}
                  title={COPY.ticket.completeBtnTip}
                  onClick={() => {
                    if (completeBusy) return
                    setCompleteBusy(true)
                    void window.api
                      .ticketCompleteByPack(packId)
                      .then((r) => {
                        // 第 27 批（issue #2）：多张成品 —— 如实报张数；有缺张要显眼提示，不闷掉
                        const msg = r.ok
                          ? r.missing && r.missing > 0
                            ? fmt(COPY.ticket.completePartial, { n: r.count ?? 0, miss: r.missing })
                            : r.count
                              ? fmt(COPY.ticket.completeOkN, { n: r.count })
                              : COPY.ticket.completeOk
                          : (r.msg ?? COPY.common.failed)
                        const bad = !r.ok || (r.missing ?? 0) > 0
                        toast(msg, bad ? 'err' : 'ok')
                      })
                      .finally(() => setCompleteBusy(false))
                  }}
                >
                  <Icon name="check" size={13} />  {COPY.ticket.completeBtn}
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
                  <span className="txt"><Rich tpl={COPY.claim.selected} v={{ n: selected.size }} /></span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{COPY.pdm.moveTo}</span>
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    {subFolders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <button className="btn primary" onClick={moveSelected} disabled={busy}>
                    {busy ? COPY.pdm.moving : COPY.pdm.confirmMove}
                  </button>
                  <button className="btn" onClick={() => setSelected(new Set())}>
                    
                    {COPY.pdm.deselect}
                  </button>
                </div>
              )}

              {ROLE_ORDER.map((role) => {
                const items = filteredGroups[role] ?? []
                const isUnassignedGroup = role === '未归属'
                const label =
                  role === '成品'
                    ? COPY.pdm.groupDone
                    : role === '素材'
                      ? COPY.pdm.groupMaterial
                      : role === '工程'
                        ? COPY.pdm.groupProject
                        : COPY.pdm.groupUnassigned
                return (
                  <div className="group" key={role}>
                    <h5>
                      {label}
                      <span className="n">（{items.length}）</span>
                      {isUnassignedGroup && items.length > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--warn)', fontWeight: 400 }}>
                          
                          {COPY.pdm.unassignedHint}
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
                          {items.every((i) => selected.has(i.id)) ? COPY.pdm.deselectAll : COPY.pdm.selectAllGroup}
                        </button>
                      )}
                    </h5>
                    {items.length === 0 ? (
                      <div className="group-empty">{COPY.pdm.empty}</div>
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

      {/* 第 15 批（M5）：打包交付弹窗 */}
      {exportOpen && detail && (
        <PackExportModal
          detail={detail}
          onClose={() => setExportOpen(false)}
          toast={toast}
        />
      )}
    </div>
  )
}
