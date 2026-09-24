import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AssetItem,
  DimensionGroup,
  PackCard as PackCardType,
  ProjectWithCount,
  WsInfo
} from './types'

import { PackCard, UnassignedCard } from './components/PackCard'
import { FileRow, fmtSize } from './components/FileRow'
import { NewPackModal } from './components/NewPackModal'
import { PackDetailModal } from './components/PackDetailModal'
import { ProjectModal } from './components/ProjectModal'
import { DeleteProjectModal } from './components/DeleteProjectModal'
import { TagPanel } from './components/TagPanel'
import { TagManagerModal } from './components/TagManagerModal'
import { TagPickerModal } from './components/TagPickerModal'

type ViewMode = 'packs' | 'files'

interface ToastMsg {
  id: number
  text: string
  kind: 'ok' | 'err' | 'info'
}

/** 左栏项目筛选：'全部' 或具体项目 id（null 表示「未指定项目」的包） */
type ProjectFilter = '全部' | number | null

/** 左栏宽度（px）。默认、最小、最大 */
const SIDE_DEFAULT = 220
const SIDE_MIN = 170
const SIDE_MAX = 420
const SIDE_KEY = 'media.sideWidth'

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<WsInfo | null>(null)
  const [view, setView] = useState<ViewMode>('packs')
  const [keyword, setKeyword] = useState('')
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('全部')
  const [sideWidth, setSideWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SIDE_KEY))
    return saved >= SIDE_MIN && saved <= SIDE_MAX ? saved : SIDE_DEFAULT
  })
  const [resizing, setResizing] = useState(false)

  const [packs, setPacks] = useState<PackCardType[]>([])
  const [stats, setStats] = useState({ packs: 0, files: 0, size: 0, unassigned: 0 })
  const [unassignedSize, setUnassignedSize] = useState(0)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [unassignedOnly, setUnassignedOnly] = useState(false)

  // ---- 第 3 批：标签（M2）----
  const [tagDimensions, setTagDimensions] = useState<DimensionGroup[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [showTagManager, setShowTagManager] = useState(false)
  const [tagManagerDim, setTagManagerDim] = useState<string | undefined>(undefined)
  /** 待打标签的素材 id 集合（null = 弹窗关闭） */
  const [tagPickerIds, setTagPickerIds] = useState<number[] | null>(null)
  const [tagSuggestions, setTagSuggestions] = useState<Record<number, number[]>>({})

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [claimPackId, setClaimPackId] = useState<number | null>(null)
  const [claimTarget, setClaimTarget] = useState<string>('02-素材')

  const [showNew, setShowNew] = useState(false)
  const [openPackId, setOpenPackId] = useState<number | 'unassigned' | null>(null)

  // 项目维护弹窗
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectWithCount | null>(null)
  const [deletingProject, setDeletingProject] = useState<ProjectWithCount | null>(null)
  const [hoverProject, setHoverProject] = useState<number | null>(null)

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

  /** 第 3 批：拉 5 个维度及其标签（带使用计数） */
  const loadTags = useCallback(async (): Promise<DimensionGroup[]> => {
    const d = await window.api.listTagDimensions()
    setTagDimensions(d)
    // 已删/已归档的项目对应的负数 id 要从已选里剔掉，避免筛出空结果
    const valid = new Set<number>()
    for (const g of d) for (const t of g.tags) valid.add(t.id)
    setSelectedTagIds((prev) => {
      const next = prev.filter((id) => valid.has(id))
      return next.length === prev.length ? prev : next
    })
    return d
  }, [])

  const loadPacks = useCallback(async (): Promise<void> => {
    const r = await window.api.listPacks()
    setPacks(r.packs)
    setStats(r.total)
    const un = await window.api.listAssets({ view: 'unassigned' })
    setUnassignedSize(un.items.reduce((s, i) => s + i.size, 0))
  }, [])

  const loadAssets = useCallback(
    async (kw: string, unassigned: boolean, tagIds: number[]): Promise<void> => {
      const r = await window.api.listAssets({
        keyword: kw,
        view: unassigned ? 'unassigned' : 'all',
        tagIds,
        withTags: true
      })
      setAssets(r.items)
      if (unassigned) setUnassignedSize(r.items.reduce((s, i) => s + i.size, 0))
    },
    []
  )

  useEffect(() => {
    ;(async () => {
      await loadWs()
      await loadTags()
      await loadPacks()
      await loadAssets('', false, [])
    })()
  }, [loadWs, loadTags, loadPacks, loadAssets])

  useEffect(() => {
    if (view === 'packs') loadPacks()
    else loadAssets(keyword, unassignedOnly, selectedTagIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, unassignedOnly])

  useEffect(() => {
    if (view !== 'files') return
    const t = setTimeout(() => loadAssets(keyword, unassignedOnly, selectedTagIds), 220)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword])

  // 标签勾选变化：左侧筛选立即生效
  useEffect(() => {
    if (view !== 'files') setView('files')
    loadAssets(keyword, unassignedOnly, selectedTagIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTagIds])

  const reloadAll = useCallback(async (): Promise<void> => {
    await loadWs()
    await loadTags()
    await loadPacks()
    await loadAssets(keyword, unassignedOnly, selectedTagIds)
  }, [loadWs, loadTags, loadPacks, loadAssets, keyword, unassignedOnly, selectedTagIds])

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
    projectId: number | null
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

  // ---------------- 项目维护 ----------------

  const submitProject = async (v: {
    name: string
    color: string
    note: string
  }): Promise<{ ok: boolean; error?: string }> => {
    const r = editingProject
      ? await window.api.updateProject(editingProject.id, v)
      : await window.api.createProject(v)
    if (r.ok) {
      toast(editingProject ? `项目「${v.name}」已保存` : `项目「${v.name}」已创建`, 'ok')
      setShowProjectModal(false)
      setEditingProject(null)
      await reloadAll()
    }
    return r
  }

  /** 上移 / 下移项目一位。成功后重新拉数据，左栏立即按新顺序渲染 */
  const moveProj = async (p: ProjectWithCount, direction: 'up' | 'down'): Promise<void> => {
    // 本地先挪一下，避免等 IPC 回来才动、手感发滞
    const i = projects.findIndex((x) => x.id === p.id)
    const j = direction === 'up' ? i - 1 : i + 1
    if (i >= 0 && j >= 0 && j < projects.length) {
      const next = [...projects]
      ;[next[i], next[j]] = [next[j], next[i]]
      setInfo((prev) => (prev ? { ...prev, projects: next } : prev))
    }

    const r = await window.api.moveProject(p.id, direction)
    if (!r.ok) {
      toast(r.error ?? '调整顺序失败', 'err')
      await loadWs()
      return
    }
    await loadWs()
  }

  const confirmDeleteProject = async (action: {
    moveTo: number | null
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!deletingProject) return { ok: false, error: '没有待删除的项目' }
    const name = deletingProject.name
    const n = deletingProject.packCount
    const r = await window.api.removeProject(deletingProject.id, action)
    if (r.ok) {
      setDeletingProject(null)
      // 若当前筛选正是被删的项目，退回「全部」
      if (projectFilter === deletingProject.id) setProjectFilter('全部')
      await reloadAll()
      toast(
        n > 0
          ? `项目「${name}」已删除，${r.moved} 个包已${action.moveTo !== null ? '转移' : '变为未归属'}`
          : `项目「${name}」已删除`,
        'ok'
      )
    }
    return r
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

  // ---------------- 第 3 批：批量打标签 ----------------

  /** 打开打标签弹窗：先拿自动建议（C-07），再显示 */
  const openTagPicker = async (): Promise<void> => {
    const ids = assets.filter((a) => selected.has(a.id)).map((a) => a.id)
    if (ids.length === 0) return
    try {
      const sug = await window.api.suggestTags(ids)
      setTagSuggestions(sug)
    } catch {
      setTagSuggestions({})
    }
    if (tagDimensions.length === 0) await loadTags()
    setTagPickerIds(ids)
  }

  const submitTags = async (args: {
    assetIds: number[]
    tagIds: number[]
  }): Promise<void> => {
    const r = await window.api.applyTags(args)
    if (!r.ok) {
      toast(r.error ?? '打标签失败', 'err')
      return
    }
    setTagPickerIds(null)
    setSelected(new Set())
    await reloadAll()
    toast(`已给 ${args.assetIds.length} 个文件贴上 ${args.tagIds.length} 个标签`, 'ok')
  }

  /** 从当前勾选的素材上摘掉某个标签（在文件行上点标签的小叉） */
  const dropTag = async (assetId: number, tagId: number): Promise<void> => {
    const r = await window.api.removeTagsFrom({ assetIds: [assetId], tagIds: [tagId] })
    if (r.ok) await loadAssets(keyword, unassignedOnly, selectedTagIds)
  }

  // ---------------- 打开 ----------------

  const openFile = async (p: string): Promise<void> => {
    const r = await window.api.openFile(p)
    if (!r.ok) toast(r.error ?? '打开失败', 'err')
  }

  // ---------------- 左栏宽度拖拽 ----------------

  /** 按住分隔条左右拖：实时改宽度，松手落盘 */
  const startResize = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      const startX = e.clientX
      const startW = sideWidth
      setResizing(true)

      const onMove = (ev: MouseEvent): void => {
        const next = Math.min(SIDE_MAX, Math.max(SIDE_MIN, startW + (ev.clientX - startX)))
        setSideWidth(next)
      }
      const onUp = (): void => {
        setResizing(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        // 记录最终宽度（从 state 拿不到最新的，用一次同步读取）
        setSideWidth((w) => {
          localStorage.setItem(SIDE_KEY, String(w))
          return w
        })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [sideWidth]
  )

  /** 双击分隔条：恢复默认宽度 */
  const resetSideWidth = useCallback((): void => {
    setSideWidth(SIDE_DEFAULT)
    localStorage.setItem(SIDE_KEY, String(SIDE_DEFAULT))
  }, [])

  // ---------------- 派生数据 ----------------

  const projects: ProjectWithCount[] = info?.projects ?? []

  const knownProjectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects])

  /** 没挂项目的包数量（删项目选「变成未归属」后会出现） */
  const noProjectCount = useMemo(
    () => packs.filter((p) => p.project_id === null || !knownProjectIds.has(p.project_id)).length,
    [packs, knownProjectIds]
  )

  const shownPacks = useMemo(() => {
    if (projectFilter === '全部') return packs
    if (projectFilter === null) {
      return packs.filter((p) => p.project_id === null || !knownProjectIds.has(p.project_id))
    }
    return packs.filter((p) => p.project_id === projectFilter)
  }, [packs, projectFilter, knownProjectIds])

  const shownAssets = useMemo(() => {
    if (projectFilter === '全部') return assets
    const ids = new Set(shownPacks.map((p) => p.id))
    return assets.filter((a) => a.pack_id !== null && ids.has(a.pack_id))
  }, [assets, shownPacks, projectFilter])

  const shownSize = useMemo(() => shownAssets.reduce((s, i) => s + i.size, 0), [shownAssets])

  // ---------------- 渲染 ----------------

  const currentProjectLabel = useMemo(() => {
    if (projectFilter === '全部') return `全部（${packs.length} 个包）`
    if (projectFilter === null) return `未指定项目（${noProjectCount} 个包）`
    const p = projects.find((x) => x.id === projectFilter)
    return p ? `${p.name}（${p.packCount} 个包）` : ''
  }, [projectFilter, packs.length, noProjectCount, projects])

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
        <div className="side" style={{ width: sideWidth }}>
          {/* 第 3 批：维度式标签筛选（项目维度也在里面，映射 projects 表） */}
          <TagPanel
            dimensions={tagDimensions}
            selected={selectedTagIds}
            onChange={setSelectedTagIds}
            onManage={(dim) => {
              setTagManagerDim(dim)
              setShowTagManager(true)
            }}
          />

          <div className="divider" />

          <h4 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>项目</span>
            <button
              className="tp-manage-btn"
              onClick={() => {
                setEditingProject(null)
                setShowProjectModal(true)
              }}
              title="新建项目"
            >
              ＋
            </button>
          </h4>

          <button
            className={`item${projectFilter === '全部' ? ' on' : ''}`}
            onClick={() => setProjectFilter('全部')}
          >
            <span>全部</span>
            <span className="n">{packs.length}</span>
          </button>

          {projects.map((p, pi) => {
            const active = projectFilter === p.id
            const hovering = hoverProject === p.id
            const isFirst = pi === 0
            const isLast = pi === projects.length - 1
            return (
              <div
                key={p.id}
                className={`proj-row${active ? ' on' : ''}`}
                onMouseEnter={() => setHoverProject(p.id)}
                onMouseLeave={() => setHoverProject(null)}
              >
                <button
                  className="item proj-item"
                  onClick={() => setProjectFilter(p.id)}
                  title={p.note || p.name}
                >
                  <span className="proj-label">
                    <i className="cdot" style={{ background: p.color }} />
                    <span className="pname">{p.name}</span>
                  </span>
                  <span className="n">{p.packCount}</span>
                </button>

                {hovering && (
                  <span className="proj-acts">
                    <button
                      className="mini"
                      title="上移一位"
                      disabled={isFirst}
                      onClick={(e) => {
                        e.stopPropagation()
                        void moveProj(p, 'up')
                      }}
                    >
                      ↑
                    </button>
                    <button
                      className="mini"
                      title="下移一位"
                      disabled={isLast}
                      onClick={(e) => {
                        e.stopPropagation()
                        void moveProj(p, 'down')
                      }}
                    >
                      ↓
                    </button>
                    <button
                      className="mini"
                      title="编辑名称 / 颜色"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingProject(p)
                        setShowProjectModal(true)
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="mini danger"
                      title="删除项目"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeletingProject(p)
                      }}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            )
          })}

          {noProjectCount > 0 && (
            <button
              className={`item${projectFilter === null ? ' on' : ''}`}
              onClick={() => setProjectFilter(null)}
              title="没有指定项目的包"
            >
              <span>未指定项目</span>
              <span className="n">{noProjectCount}</span>
            </button>
          )}

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

        {/* 左栏宽度拖拽条：按住左右拖，双击复位 */}
        <div
          className={`side-resizer${resizing ? ' dragging' : ''}`}
          title="拖动调整左栏宽度，双击恢复默认"
          onMouseDown={startResize}
          onDoubleClick={resetSideWidth}
        />

        <div className="main">
          <div className="main-scroll">
            {view === 'packs' ? (
              shownPacks.length === 0 ? (
                <div className="empty">
                  <div className="big">🗂</div>
                  <div className="t">
                    {projectFilter === '全部'
                      ? '还没有任何任务包'
                      : `「${currentProjectLabel}」下还没有包`}
                  </div>
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
                  {unassignedOnly
                    ? '未归属池是空的'
                    : keyword
                      ? '没找到匹配的文件'
                      : '还没有登记任何文件'}
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
                    <button className="btn" onClick={openTagPicker} title="给选中的文件批量打标签">
                      🏷 打标签
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
                    style={{
                      width: 15,
                      height: 15,
                      accentColor: 'var(--accent)',
                      cursor: 'pointer'
                    }}
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
                    onDropTag={(tagId) => void dropTag(a.id, tagId)}
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
              当前：{currentProjectLabel}
              <span style={{ margin: '0 8px', opacity: 0.4 }}>|</span>
              工作区 <span className="path">{info?.workspaceRoot}</span>
            </span>
          </div>
        </div>
      </div>

      {/* 弹窗 */}
      {showNew && info && (
        <NewPackModal
          projects={projects}
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

      {showProjectModal && info && (
        <ProjectModal
          editing={editingProject}
          colors={info.projectColors}
          onClose={() => {
            setShowProjectModal(false)
            setEditingProject(null)
          }}
          onSubmit={submitProject}
        />
      )}

      {deletingProject && (
        <DeleteProjectModal
          project={deletingProject}
          others={projects.filter((p) => p.id !== deletingProject.id)}
          onClose={() => setDeletingProject(null)}
          onConfirm={confirmDeleteProject}
        />
      )}

      {/* 第 3 批：标签管理 / 批量打标签 */}
      {showTagManager && (
        <TagManagerModal
          dimensions={tagDimensions}
          focusDimension={tagManagerDim}
          onClose={() => {
            setShowTagManager(false)
            setTagManagerDim(undefined)
          }}
          onChanged={reloadAll}
          toast={toast}
        />
      )}

      {tagPickerIds && (
        <TagPickerModal
          assetIds={tagPickerIds}
          dimensions={tagDimensions}
          suggestions={tagSuggestions}
          onClose={() => setTagPickerIds(null)}
          onSubmit={submitTags}
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
