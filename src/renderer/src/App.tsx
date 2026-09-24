import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssetItem, PackCard as PackCardType, WsInfo } from './types'

import { PackCard, UnassignedCard } from './components/PackCard'
import { FileRow, fmtSize } from './components/FileRow'
import { NewPackModal } from './components/NewPackModal'
import { PackDetailModal } from './components/PackDetailModal'

type ViewMode = 'packs' | 'files'

interface ToastMsg {
  id: number
  text: string
  kind: 'ok' | 'err' | 'info'
}

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<WsInfo | null>(null)
  const [view, setView] = useState<ViewMode>('packs')
  const [keyword, setKeyword] = useState('')
  const [projectFilter, setProjectFilter] = useState<string>('全部')

  const [packs, setPacks] = useState<PackCardType[]>([])
  const [stats, setStats] = useState({ packs: 0, files: 0, size: 0, unassigned: 0 })
  const [unassignedSize, setUnassignedSize] = useState(0)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [unassignedOnly, setUnassignedOnly] = useState(false)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [claimPackId, setClaimPackId] = useState<number | null>(null)
  const [claimTarget, setClaimTarget] = useState<string>('02-素材')

  const [showNew, setShowNew] = useState(false)
  const [openPackId, setOpenPackId] = useState<number | 'unassigned' | null>(null)
  const [scanning, setScanning] = useState(false)
  const [toasts, setToasts] = useState<ToastMsg[]>([])

  const toastId = useRef(0)
  const toast = useCallback((text: string, kind: 'ok' | 'err' | 'info' = 'info'): void => {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, text, kind }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600)
  }, [])

  // ---------------- 数据加载 ----------------

  const loadWs = useCallback(async (): Promise<WsInfo> => {
    const i = await window.api.wsInfo()
    setInfo(i)
    return i
  }, [])

  const loadPacks = useCallback(async (): Promise<void> => {
    const r = await window.api.listPacks()
    setPacks(r.packs)
    setStats(r.total)
    // 未归属容量：单独算一遍（列表里 role 是未归属的那些）
    const un = await window.api.listAssets({ view: 'unassigned' })
    setUnassignedSize(un.items.reduce((s, i) => s + i.size, 0))
  }, [])

  const loadAssets = useCallback(
    async (kw: string, unassigned: boolean): Promise<void> => {
      const r = await window.api.listAssets({
        keyword: kw,
        view: unassigned ? 'unassigned' : 'all'
      })
      setAssets(r.items)
      if (unassigned) setUnassignedSize(r.items.reduce((s, i) => s + i.size, 0))
    },
    []
  )

  useEffect(() => {
    ;(async () => {
      await loadWs()
      await loadPacks()
      await loadAssets('', false)
    })()
  }, [loadWs, loadPacks, loadAssets])

  // 切换视图时刷新对应数据
  useEffect(() => {
    if (view === 'packs') loadPacks()
    else loadAssets(keyword, unassignedOnly)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, unassignedOnly])

  // 搜索防抖
  useEffect(() => {
    if (view !== 'files') return
    const t = setTimeout(() => loadAssets(keyword, unassignedOnly), 220)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword])

  const reloadAll = useCallback(async (): Promise<void> => {
    await loadPacks()
    await loadAssets(keyword, unassignedOnly)
  }, [loadPacks, loadAssets, keyword, unassignedOnly])

  // ---------------- A-10 刷新扫描 ----------------

  const doRefresh = async (): Promise<void> => {
    setScanning(true)
    try {
      const r = await window.api.refreshScan()
      await reloadAll()
      toast(
        `扫描完成：${r.packs} 个包 · ${r.files} 个文件` +
          (r.newFiles ? ` · 新增 ${r.newFiles} 条` : '') +
          (r.thumbs ? ` · 生成 ${r.thumbs} 张缩略图` : ''),
        'ok'
      )
    } catch (e) {
      toast('扫描失败：' + (e as Error).message, 'err')
    } finally {
      setScanning(false)
    }
  }

  // ---------------- A-01 建包 ----------------

  const doCreatePack = async (v: {
    name: string
    project: string
    category: string
  }): Promise<void> => {
    try {
      const r = await window.api.createPack(v)
      setShowNew(false)
      await reloadAll()
      toast(`包「${r.pack.name}」已创建，文件夹已建好`, 'ok')
    } catch (e) {
      toast('创建失败：' + (e as Error).message, 'err')
    }
  }

  // ---------------- A-09 认领 ----------------

  const doClaim = async (): Promise<void> => {
    if (!claimPackId || selected.size === 0) return
    const paths = assets.filter((a) => selected.has(a.id)).map((a) => a.abs_path)
    const r = await window.api.claim({ paths, packId: claimPackId, subFolder: claimTarget })
    if (r.ok) toast(`已认领 ${r.moved} 个文件到目标包`, 'ok')
    else toast(`认领 ${r.moved} 个，${r.errors.length} 个失败`, 'err')
    setSelected(new Set())
    setClaimPackId(null)
    await reloadAll()
  }

  // ---------------- 打开 ----------------

  const openFile = async (p: string): Promise<void> => {
    const r = await window.api.openFile(p)
    if (!r.ok) toast(r.error ?? '打开失败', 'err')
  }

  // ---------------- 派生数据 ----------------

  const projectCounts = useMemo(() => {
    const m = new Map<string, number>()
    m.set('全部', packs.length)
    for (const p of packs) m.set(p.project, (m.get(p.project) ?? 0) + 1)
    return m
  }, [packs])

  const shownPacks = useMemo(() => {
    if (projectFilter === '全部') return packs
    return packs.filter((p) => p.project === projectFilter)
  }, [packs, projectFilter])

  const shownAssets = useMemo(() => {
    let list = assets
    if (projectFilter !== '全部') {
      const ids = new Set(packs.filter((p) => p.project === projectFilter).map((p) => p.id))
      list = list.filter((a) => a.pack_id !== null && ids.has(a.pack_id))
    }
    return list
  }, [assets, projectFilter, packs])

  const shownSize = useMemo(() => shownAssets.reduce((s, i) => s + i.size, 0), [shownAssets])

  const filterProjects = useMemo(() => {
    const set = new Set<string>(['全部'])
    for (const p of info?.projects ?? []) set.add(p)
    for (const p of packs) set.add(p.project)
    return [...set]
  }, [info, packs])

  // ---------------- 渲染 ----------------

  return (
    <div className="app">
      {/* 顶栏 */}
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          素材管家
        </div>

        <div className="search-wrap">
          <span className="icon">🔍</span>
          <input
            type="text"
            value={keyword}
            placeholder={view === 'packs' ? '搜索包名称…' : '搜索文件名…'}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <div className="spacer" />

        <div className="tabs">
          <button className={view === 'packs' ? 'on' : ''} onClick={() => setView('packs')}>
            包视图
          </button>
          <button className={view === 'files' ? 'on' : ''} onClick={() => setView('files')}>
            文件视图
          </button>
        </div>

        <button className="btn" onClick={doRefresh} disabled={scanning} title="重新扫描素材工作区">
          {scanning ? '扫描中…' : '🔄 刷新扫描'}
        </button>

        <button className="btn primary" onClick={() => setShowNew(true)}>
          ＋ 新建任务包
        </button>
      </div>

      {/* 主体 */}
      <div className="body">
        <div className="side">
          <h4>所属项目</h4>
          {filterProjects.map((p) => (
            <button
              key={p}
              className={`item${projectFilter === p ? ' on' : ''}`}
              onClick={() => setProjectFilter(p)}
            >
              <span>{p}</span>
              <span className="n">{projectCounts.get(p) ?? 0}</span>
            </button>
          ))}

          <div className="divider" />

          <h4>筛选</h4>
          <button
            className={`item${view === 'files' && unassignedOnly ? ' on' : ''}`}
            onClick={() => {
              setView('files')
              setUnassignedOnly(true)
            }}
          >
            <span>📥 未归属</span>
            <span className="n">{stats.unassigned}</span>
          </button>
          <button
            className={`item${view === 'files' && !unassignedOnly ? ' on' : ''}`}
            onClick={() => {
              setView('files')
              setUnassignedOnly(false)
            }}
          >
            <span>全部文件</span>
            <span className="n">{stats.files}</span>
          </button>

          <div className="divider" />

          <h4>工作区</h4>
          <button className="item" onClick={() => window.api.wsOpenRoot()} title={info?.workspaceRoot}>
            <span>📁 打开工作区</span>
          </button>
          <div
            className="path"
            style={{ padding: '6px 8px 0', wordBreak: 'break-all', fontSize: 10.5 }}
          >
            {info?.workspaceRoot}
          </div>
        </div>

        <div className="main">
          <div className="main-scroll">
            {view === 'packs' ? (
              shownPacks.length === 0 ? (
                <div className="empty">
                  <div className="big">🗂</div>
                  <div className="t">还没有任何任务包</div>
                  <div className="s">
                    点右上角「＋ 新建任务包」建第一个包，
                    <br />
                    软件会自动在工作区建好文件夹和三个子文件夹。
                  </div>
                </div>
              ) : (
                <div className="grid">
                  {projectFilter === '全部' && stats.unassigned > 0 && (
                    <UnassignedCard
                      count={stats.unassigned}
                      size={unassignedSize}
                      onOpen={() => setOpenPackId('unassigned')}
                    />
                  )}
                  {shownPacks.map((p) => (
                    <PackCard key={p.id} pack={p} onOpen={() => setOpenPackId(p.id)} />
                  ))}
                </div>
              )
            ) : shownAssets.length === 0 ? (
              <div className="empty">
                <div className="big">{unassignedOnly ? '📥' : '🔍'}</div>
                <div className="t">
                  {unassignedOnly ? '未归属池是空的' : keyword ? '没找到匹配的文件' : '还没有登记任何文件'}
                </div>
                <div className="s">
                  往工作区里的包文件夹丢文件，然后点右上角「🔄 刷新扫描」。
                </div>
              </div>
            ) : (
              <>
                {selected.size > 0 && (
                  <div className="claimbar">
                    <span className="txt">已选中 {selected.size} 个文件</span>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>认领进</span>
                    <select
                      value={claimPackId ?? ''}
                      onChange={(e) => setClaimPackId(Number(e.target.value) || null)}
                    >
                      <option value="">— 选择任务包 —</option>
                      {packs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select value={claimTarget} onChange={(e) => setClaimTarget(e.target.value)}>
                      {(info?.subFolders ?? []).map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn primary"
                      onClick={doClaim}
                      disabled={!claimPackId}
                      title={!claimPackId ? '请先选择目标包' : '把文件搬进目标包'}
                    >
                      确定认领
                    </button>
                    <button className="btn" onClick={() => setSelected(new Set())}>
                      取消
                    </button>
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '0 10px 8px',
                    fontSize: 11.5,
                    color: 'var(--text-3)'
                  }}
                >
                  <input
                    className="cb"
                    type="checkbox"
                    style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }}
                    checked={shownAssets.length > 0 && shownAssets.every((a) => selected.has(a.id))}
                    onChange={() => {
                      const all = shownAssets.every((a) => selected.has(a.id))
                      setSelected(all ? new Set() : new Set(shownAssets.map((a) => a.id)))
                    }}
                  />
                  全选（双击文件名可直接打开文件）
                </div>

                {shownAssets.map((a) => (
                  <FileRow
                    key={a.id}
                    item={a}
                    selected={selected.has(a.id)}
                    selectable
                    onToggle={() =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (next.has(a.id)) next.delete(a.id)
                        else next.add(a.id)
                        return next
                      })
                    }
                    onOpen={() => openFile(a.abs_path)}
                    onReveal={() => window.api.revealFile(a.abs_path)}
                  />
                ))}
              </>
            )}
          </div>

          {/* 状态栏 */}
          <div className="statusbar">
            {view === 'packs' ? (
              <>
                <span>共 {shownPacks.length} 个包</span>
                <span>·</span>
                <span>共 {stats.files} 条素材</span>
              </>
            ) : (
              <>
                <span>
                  共 {shownAssets.length} 条素材
                  {unassignedOnly ? '（未归属）' : ''}
                </span>
                <span>·</span>
                <span>{fmtSize(shownSize)}</span>
              </>
            )}
            {selected.size > 0 && <span className="pick">已选中 {selected.size}</span>}
            {stats.unassigned > 0 && view === 'packs' && (
              <span style={{ color: 'var(--warn)' }}>未归属 {stats.unassigned} 个待整理</span>
            )}
            <span style={{ marginLeft: 'auto' }}>
              工作区 <span className="path">{info?.workspaceRoot}</span>
            </span>
          </div>
        </div>
      </div>

      {/* 弹窗 */}
      {showNew && info && (
        <NewPackModal
          projects={info.projects}
          categories={info.categories}
          onClose={() => setShowNew(false)}
          onSubmit={doCreatePack}
        />
      )}

      {openPackId !== null && info && (
        <PackDetailModal
          packId={openPackId}
          subFolders={info.subFolders}
          onClose={() => setOpenPackId(null)}
          onChanged={reloadAll}
          toast={toast}
        />
      )}

      {/* 提示 */}
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
