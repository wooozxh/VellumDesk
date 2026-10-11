import { useCallback, useEffect, useRef, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type { BrandAssetItem, BrandFolderNode, BrandListView } from '../types'
import { Icon } from './Icon'

/**
 * 第 62 批（docs/46）：**通用素材库**视图。
 *
 * 自包含（照 `TicketsView` 的路数，不往 App.tsx 堆状态）：
 * 左侧两层组树（全部 / 未分组 / 顶层组 + 子组）+ 右侧缩略图网格。
 * 组上的「插件」开关就是 `sync_to_plugin`（父关则子关，生效值由主进程算好带下来）。
 *
 * 全部写操作都走主进程的 `brand:*` IPC —— 这一层不碰磁盘、不碰数据库。
 */
export function BrandLibraryView({
  onToast
}: {
  onToast: (m: string, kind?: 'ok' | 'err' | 'info') => void
}): React.JSX.Element {
  const [data, setData] = useState<BrandListView | null>(null)
  /** 'all' = 全部素材；-1 = 未分组；数字 = 某组（含子组） */
  const [sel, setSel] = useState<number | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [busy, setBusy] = useState(false)

  // 弹窗
  const [newFolder, setNewFolder] = useState<{ parentId: number | null } | null>(null)
  const [renameTarget, setRenameTarget] = useState<BrandFolderNode | null>(null)
  const [delTarget, setDelTarget] = useState<BrandFolderNode | null>(null)
  const [removeTarget, setRemoveTarget] = useState<BrandAssetItem | null>(null)
  const [copyTarget, setCopyTarget] = useState<BrandAssetItem | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [packs, setPacks] = useState<Array<{ id: number; name: string }>>([])

  /**
   * ⚠️ `onToast` 是父组件里一个**内联箭头函数**，每次渲染都是新引用。
   * 若把它放进 `load` 的依赖里，`load` 每次都变 → effect 每次都触发 → setState → 再渲染 …
   * **无限重取、界面卡死**（本场景第一次跑就踩到了，表现为进程被宿主 kill）。
   * 用 ref 存住它，`load` 的依赖只留真正影响数据的 sel / keyword。
   */
  const toastRef = useRef(onToast)
  toastRef.current = onToast

  const load = useCallback(async (): Promise<void> => {
    try {
      const d = await window.api.brandList({
        folderId: sel === 'all' ? undefined : sel,
        keyword: keyword.trim() || undefined
      })
      setData(d)
    } catch (e) {
      toastRef.current(fmt(COPY.brand.failed, { msg: (e as Error).message }), 'err')
    }
  }, [sel, keyword])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 第 63 批（docs/47）：打开本视图时**静默扫一次磁盘** —— 认领用户手工拉进
   * `_通用素材库\` 的文件/文件夹（本软件没有文件监听，这是最轻的"自动发现"）。
   * 只在挂载时跑一次（ref 守卫 + 空依赖，绝不进 load 的依赖链 —— 那会无限重取）。
   */
  const bootScanned = useRef(false)
  useEffect(() => {
    if (bootScanned.current) return
    bootScanned.current = true
    void (async () => {
      try {
        await window.api.brandScan()
      } catch {
        /* 静默：扫描失败不影响浏览 */
      }
      await load().catch(() => undefined)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doScan = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.brandScan()
      onToast(
        fmt(COPY.brand.imported, { n: r.added, folders: r.folders }) +
          (r.missing > 0 ? ` · ${r.missing} 条已丢失` : ''),
        'ok'
      )
      await load()
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (kind: 'files' | 'folder'): Promise<void> => {
    const picked =
      kind === 'files' ? await window.api.brandPickFiles() : await window.api.brandPickFolder()
    if (!picked.ok || picked.paths.length === 0) return
    setBusy(true)
    try {
      const r = await window.api.brandImport({
        paths: picked.paths,
        folderId: sel === 'all' ? null : sel
      })
      if (r.imported === 0) onToast(COPY.brand.importNone, 'info')
      else if (r.renamed > 0)
        onToast(fmt(COPY.brand.importedRenamed, { n: r.imported, renamed: r.renamed }), 'ok')
      else onToast(fmt(COPY.brand.imported, { n: r.imported, folders: r.createdFolders }), 'ok')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const submitNewFolder = async (): Promise<void> => {
    if (!newFolder || !nameDraft.trim()) return
    const r = await window.api.brandCreateFolder({
      name: nameDraft.trim(),
      parentId: newFolder.parentId
    })
    if (!r.ok) {
      onToast(r.error === 'depth' ? COPY.brand.depthLimit : COPY.brand.dupName, 'err')
      return
    }
    setNewFolder(null)
    setNameDraft('')
    await load()
  }

  const submitRename = async (): Promise<void> => {
    if (!renameTarget || !nameDraft.trim()) return
    const r = await window.api.brandRenameFolder({ id: renameTarget.id, name: nameDraft.trim() })
    if (!r.ok) {
      onToast(COPY.brand.dupName, 'err')
      return
    }
    setRenameTarget(null)
    setNameDraft('')
    await load()
  }

  const submitDelete = async (): Promise<void> => {
    if (!delTarget) return
    const r = await window.api.brandDeleteFolder(delTarget.id)
    if (r.ok) {
      onToast(fmt(COPY.brand.movedToUnsorted, { n: r.moved ?? 0 }), 'ok')
      if (sel === delTarget.id) setSel('all')
    }
    setDelTarget(null)
    await load()
  }

  const toggleSync = async (f: BrandFolderNode): Promise<void> => {
    await window.api.brandSetFolderSync({ id: f.id, on: !f.syncToPlugin })
    await load()
  }

  const doRemove = async (): Promise<void> => {
    if (!removeTarget) return
    const r = await window.api.brandRemoveAsset(removeTarget.id)
    onToast(r.ok ? COPY.brand.removeDone : fmt(COPY.brand.failed, { msg: r.error ?? '' }), r.ok ? 'ok' : 'err')
    setRemoveTarget(null)
    await load()
  }

  const doForget = async (): Promise<void> => {
    if (!removeTarget) return
    await window.api.brandForgetAsset(removeTarget.id)
    onToast(COPY.brand.forgetDone, 'ok')
    setRemoveTarget(null)
    await load()
  }

  const openCopyToPack = async (a: BrandAssetItem): Promise<void> => {
    setCopyTarget(a)
    try {
      const v = await window.api.listPacks()
      setPacks(v.packs.map((p) => ({ id: p.id, name: p.name })))
    } catch {
      setPacks([])
    }
  }

  const doCopyToPack = async (packId: number): Promise<void> => {
    if (!copyTarget) return
    const r = await window.api.brandCopyToPack({ brandAssetId: copyTarget.id, packId })
    onToast(r.ok ? COPY.brand.copyToPackDone : fmt(COPY.brand.failed, { msg: r.error ?? '' }), r.ok ? 'ok' : 'err')
    setCopyTarget(null)
  }

  const folders = data?.folders ?? []
  const tops = folders.filter((f) => f.depth === 1)
  const childrenOf = (id: number): BrandFolderNode[] => folders.filter((f) => f.parentId === id)
  const assets = data?.assets ?? []

  return (
    <div className="brand-view">
      <div className="brand-top">
        <Icon name="layers" size={15} />
        <span className="bt-title">{COPY.brand.title}</span>
        <span className="brand-stats" title={COPY.brand.intro}>
          {fmt(COPY.brand.totalText, {
            folders: data?.stats.folders ?? 0,
            assets: data?.stats.assets ?? 0
          })}
        </span>
        <span className="spacer" />
        <div className="search-wrap brand-search-wrap">
          <span className="icon">
            <Icon name="search" size={13} />
          </span>
          <input
            className="brand-search"
            type="text"
            value={keyword}
            placeholder={COPY.brand.searchPlaceholder}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="brand-actions">
          <button className="btn" disabled={busy} onClick={() => void doScan()}>
            <Icon name="refresh" size={13} /> {busy ? COPY.brand.scanning : COPY.brand.scan}
          </button>
          <button className="btn" disabled={busy} onClick={() => void doImport('files')}>
            <Icon name="plus" size={13} strokeWidth={2} /> {COPY.brand.importFiles}
          </button>
          <button className="btn" disabled={busy} onClick={() => void doImport('folder')}>
            <Icon name="folder" size={13} /> {COPY.brand.importFolder}
          </button>
          <button className="btn" disabled={busy} onClick={() => { setNameDraft(''); setNewFolder({ parentId: null }) }}>
            <Icon name="plus" size={13} strokeWidth={2} /> {COPY.brand.newFolder}
          </button>
        </div>
      </div>

      <div className="brand-body">
        {/* 左：两层组树 */}
        <div className="brand-tree">
          <button className={`brand-node all${sel === 'all' ? ' on' : ''}`} onClick={() => setSel('all')}>
            <span className="bn-name">{COPY.brand.all}</span>
            <span className="b-count">{data?.stats.assets ?? 0}</span>
          </button>
          <button
            className={`brand-node unsorted${sel === -1 ? ' on' : ''}`}
            title={COPY.brand.unsortedHint}
            onClick={() => setSel(-1)}
          >
            <span className="bn-name">{COPY.brand.unsorted}</span>
            <span className="b-count">{data?.stats.unsorted ?? 0}</span>
          </button>
          {tops.map((f) => (
            <div key={f.id} className="brand-group">
              <div className={`brand-node${sel === f.id ? ' on' : ''}`} data-fid={f.id}>
                <button className="bn-main" onClick={() => setSel(f.id)}>
                  <span className="bn-name">{f.name}</span>
                  <span className="b-count">{f.totalCount}</span>
                </button>
                <button
                  className={`b-sync${f.syncToPlugin ? ' on' : ''}${f.effectiveSync ? '' : ' inh'}`}
                  title={f.syncToPlugin ? COPY.brand.syncOn : COPY.brand.syncOff}
                  onClick={() => void toggleSync(f)}
                >
                  {f.syncToPlugin ? COPY.brand.syncOn : COPY.brand.syncOff}
                </button>
                <span className="b-acts">
                  <button className="mini" title={COPY.brand.newSubFolder} onClick={() => { setNameDraft(''); setNewFolder({ parentId: f.id }) }}>
                    <Icon name="plus" size={12} />
                  </button>
                  <button className="mini" title={COPY.brand.pin} onClick={() => void window.api.brandPinFolder(f.id).then(load)}>
                    <Icon name="arrowUp" size={12} />
                  </button>
                  <button className="mini" title={COPY.brand.rename} onClick={() => { setNameDraft(f.name); setRenameTarget(f) }}>
                    <Icon name="edit" size={12} />
                  </button>
                  <button className="mini" title={COPY.brand.del} onClick={() => setDelTarget(f)}>
                    <Icon name="trash" size={12} />
                  </button>
                </span>
              </div>
              {childrenOf(f.id).map((c) => (
                <div key={c.id} className={`brand-node child${sel === c.id ? ' on' : ''}`} data-fid={c.id}>
                  <button className="bn-main" onClick={() => setSel(c.id)}>
                    <span className="bn-name">{c.name}</span>
                    <span className="b-count">{c.totalCount}</span>
                  </button>
                  <button
                    className={`b-sync${c.syncToPlugin ? ' on' : ''}${c.effectiveSync ? '' : ' inh'}`}
                    title={!c.syncToPlugin ? COPY.brand.syncOff : c.effectiveSync ? COPY.brand.syncOn : COPY.brand.syncInherited}
                    onClick={() => void toggleSync(c)}
                  >
                    {!c.syncToPlugin ? COPY.brand.syncOff : c.effectiveSync ? COPY.brand.syncOn : COPY.brand.syncInherited}
                  </button>
                  <span className="b-acts">
                    <button className="mini" title={COPY.brand.rename} onClick={() => { setNameDraft(c.name); setRenameTarget(c) }}>
                      <Icon name="edit" size={12} />
                    </button>
                    <button className="mini" title={COPY.brand.del} onClick={() => setDelTarget(c)}>
                      <Icon name="trash" size={12} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ))}
          {data && data.skippedDeep > 0 && (
            <div className="brand-hint">{fmt(COPY.brand.skippedDeep, { n: data.skippedDeep })}</div>
          )}
          {sel === -1 && <div className="brand-hint">{COPY.brand.unsortedHint}</div>}
        </div>

        {/* 右：缩略图网格 */}
        <div className="brand-main">
          {assets.length === 0 ? (
            <div className="brand-empty">{sel === 'all' && !keyword ? COPY.brand.emptyAll : COPY.brand.emptyGroup}</div>
          ) : (
            <div className="brand-grid">
              {assets.map((a) => (
                <div key={a.id} className={`brand-card${a.missing ? ' missing' : ''}`} data-bid={a.id}>
                  <div className="thumb">
                    {a.thumb ? (
                      <img src={a.thumb} alt={a.fileName} />
                    ) : (
                      <span className="ph">
                        <Icon name="image" size={20} />
                      </span>
                    )}
                    {a.missing && <span className="b-miss">{COPY.brand.missing}</span>}
                    <span className={`b-src ${a.source === 'company' ? 'co' : 'us'}`}>
                      {a.source === 'company' ? COPY.brand.company : COPY.brand.user}
                    </span>
                    <span className="b-acts">
                      <button className="mini" title={COPY.brand.copyToPack} onClick={() => void openCopyToPack(a)}>
                        <Icon name="package" size={12} />
                      </button>
                      <button className="mini" title={COPY.brand.removeTitle} onClick={() => setRemoveTarget(a)}>
                        <Icon name="trash" size={12} />
                      </button>
                    </span>
                  </div>
                  <div className="meta">
                    <span className="name" title={a.fileName}>{a.fileName}</span>
                    <span className="sub">{a.folderName ?? COPY.brand.unsorted}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- 弹窗 ---- */}
      {newFolder && (
        <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && setNewFolder(null)}>
          <div className="modal">
            <h3>{COPY.brand.newFolderTitle}</h3>
            <div className="content">
              <input
                className="tk-input"
                autoFocus
                value={nameDraft}
                placeholder={COPY.brand.namePlaceholder}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitNewFolder()}
              />
              <div className="tk-actions">
                <button className="btn primary" onClick={() => void submitNewFolder()}>{COPY.common.create}</button>
                <button className="btn" onClick={() => setNewFolder(null)}>{COPY.common.cancel}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && setRenameTarget(null)}>
          <div className="modal">
            <h3>{COPY.brand.renameTitle}</h3>
            <div className="content">
              <input
                className="tk-input"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitRename()}
              />
              <div className="tk-actions">
                <button className="btn primary" onClick={() => void submitRename()}>{COPY.common.save}</button>
                <button className="btn" onClick={() => setRenameTarget(null)}>{COPY.common.cancel}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {delTarget && (
        <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && setDelTarget(null)}>
          <div className="modal">
            <h3>{COPY.brand.delConfirmTitle}</h3>
            <div className="content">
              <div className="brand-confirm-body">
                {fmt(COPY.brand.delConfirmBody, { name: delTarget.name, n: delTarget.totalCount })}
              </div>
              <div className="tk-actions">
                <button className="btn danger" onClick={() => void submitDelete()}>{COPY.brand.delConfirmOk}</button>
                <button className="btn" onClick={() => setDelTarget(null)}>{COPY.common.cancel}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && setRemoveTarget(null)}>
          <div className="modal">
            <h3>{COPY.brand.removeTitle}</h3>
            <div className="content">
              <div className="brand-confirm-body">
                {fmt(COPY.brand.removeBody, { name: removeTarget.fileName })}
              </div>
              <div className="tk-actions">
                <button className="btn danger" onClick={() => void doRemove()}>{COPY.brand.removeOk}</button>
                <button className="btn" onClick={() => void doForget()}>{COPY.brand.forget}</button>
                <button className="btn" onClick={() => setRemoveTarget(null)}>{COPY.common.cancel}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {copyTarget && (
        <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && setCopyTarget(null)}>
          <div className="modal">
            <h3>{COPY.brand.copyToPackTitle}</h3>
            <div className="content">
              <div className="brand-pack-list">
                {packs.length === 0 ? (
                  <div className="brand-empty">{COPY.common.loading}</div>
                ) : (
                  packs.map((p) => (
                    <button key={p.id} className="brand-pack-row" onClick={() => void doCopyToPack(p.id)}>
                      <Icon name="package" size={13} /> {p.name}
                    </button>
                  ))
                )}
              </div>
              <div className="tk-actions">
                <button className="btn" onClick={() => setCopyTarget(null)}>{COPY.common.cancel}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
