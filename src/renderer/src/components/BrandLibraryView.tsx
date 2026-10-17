import { useCallback, useEffect, useRef, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type { BrandAssetItem, BrandFolderNode, BrandListView } from '../types'
import { Icon } from './Icon'
// 第 66 批（docs/49）：多层组树抽成共用组件，模板库与通用库同一套渲染
import { DirTree, type DirNode } from './DirTree'
// 第 67 批（docs/50）：卡片 / 列表双视图 + 列表勾选批量
import { ListTable, fmtDateTime, type ListColumn } from './ListTable'
import { ViewSwitch, useViewMode } from './ViewSwitch'
import { fmtSize } from './FileRow'
import { MoveToFolderModal } from './MoveToFolderModal'
// 第 68 批（docs/50 §6）：批量复制到任务 / 序号化改名
import { PickPackModal } from './PickPackModal'
import { SeqRenameModal } from './SeqRenameModal'

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

  /**
   * 第 67 批（docs/50）：卡片 / 列表视图。
   * 偏好存 `localStorage`（`vellum.view.brand`），关掉软件再打开还是上次那个视图。
   */
  const [viewMode, setViewMode] = useViewMode('brand')
  /** 列表视图里勾选的素材 id */
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  /** 第 67 批（docs/50 §6）：「移动到…」弹窗 */
  const [moveOpen, setMoveOpen] = useState(false)
  /** 第 68 批：批量复制到任务 / 批量改名 */
  const [copyBulkOpen, setCopyBulkOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  // 弹窗
  const [newFolder, setNewFolder] = useState<{ parentId: number | null } | null>(null)
  const [renameTarget, setRenameTarget] = useState<BrandFolderNode | null>(null)
  const [delTarget, setDelTarget] = useState<BrandFolderNode | null>(null)
  const [removeTarget, setRemoveTarget] = useState<BrandAssetItem | null>(null)
  const [copyTarget, setCopyTarget] = useState<BrandAssetItem | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [packs, setPacks] = useState<
    Array<{ id: number; name: string; projectName?: string | null }>
  >([])

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
   * 第 67 批（docs/50）：**换分组 / 改搜索词就清空勾选**。
   * 否则勾选会"跨筛选残留"：在「易拉宝」里勾了 3 条，切到「海报」后批量清除
   * —— 用户以为清的是眼前这几条，实际把看不见的那 3 条也清了。这是最危险的一类错。
   */
  useEffect(() => {
    setPicked(new Set())
  }, [sel, keyword])

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
      /**
       * 第 67 批（docs/50）：扫描和导入是两件事，文案不能共用。
       * 打开视图时会自动扫一次，所以手动再点「扫描磁盘」常常是 0 新增 ——
       * 原来复用「已导入 0 个文件」，读起来像"我点了导入但什么都没发生"。
       */
      const head =
        r.added > 0 ? fmt(COPY.brand.scanDone, { n: r.added, folders: r.folders }) : COPY.brand.scanDoneNone
      onToast(head + (r.missing > 0 ? ` · ${r.missing} 条已丢失` : ''), 'ok')
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

  /**
   * 第 67 批（docs/50）：**批量执行**（清除记录 / 删除）。
   *
   * 刻意**逐条调用现成的单条通道**，不在主进程新开批量接口：
   * · 单条通道已经被 accept 与真机验证过（含回收站、缺文件、路径边界），
   *   批量版等于再写一遍同样的边界，多一份出错机会；
   * · 条数是"一屏勾选的量"（几十条级），几十次 IPC 的开销可以忽略。
   * 逐条 await（不并发）—— 这些操作**会动磁盘**，并发 rename 同名文件容易互相踩。
   *
   * ⚠️ 中途失败**不中断**：已经成功的那些不该因为后面一条失败就白做；
   * 最后按「成功 N / 失败 M + 第一条错误」汇总，用户能据此判断要不要重试。
   */
  const runBulk = async (
    kind: 'forget' | 'remove',
    fn: (id: number) => Promise<{ ok: boolean; error?: string }>
  ): Promise<void> => {
    const ids = [...picked]
    if (ids.length === 0 || bulkBusy) return
    const tip = kind === 'forget' ? COPY.common.bulkForgetConfirm : COPY.common.bulkRemoveConfirm
    if (!window.confirm(fmt(tip, { n: ids.length }))) return

    setBulkBusy(true)
    let okN = 0
    let firstErr = ''
    for (const id of ids) {
      try {
        const r = await fn(id)
        if (r.ok) okN += 1
        else if (!firstErr) firstErr = r.error ?? ''
      } catch (e) {
        if (!firstErr) firstErr = (e as Error).message
      }
    }
    setBulkBusy(false)
    setPicked(new Set())

    const fail = ids.length - okN
    if (fail === 0) {
      const done = kind === 'forget' ? COPY.common.bulkForgetDone : COPY.common.bulkRemoveDone
      onToast(fmt(done, { n: okN }), 'ok')
    } else {
      const partial = kind === 'forget' ? COPY.common.bulkForgetPartial : COPY.common.bulkRemovePartial
      onToast(fmt(partial, { ok: okN, fail, msg: firstErr }), 'err')
    }
    await load()
  }

  const openCopyToPack = async (a: BrandAssetItem): Promise<void> => {
    setCopyTarget(a)
    try {
      const v = await window.api.listPacks()
      setPacks(v.packs.map((p) => ({ id: p.id, name: p.name, projectName: p.projectName })))
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
  const assets = data?.assets ?? []
  /** 任意层组树（2026-10-17 起通用库也放开到 5 层，与模板库共用 `DirTree` 渲染） */
  const nodes: DirNode[] = folders.map((f) => ({
    id: f.id,
    parentId: f.parentId,
    name: f.name,
    depth: f.depth,
    count: f.totalCount
  }))

  /**
   * 第 67 批（docs/50 §6）：**批量移动到分组**（`targetId = -1` = 未分组 / 库根）。
   *
   * 不做"整批回滚"：主进程那边已经搬了一部分，硬回滚反而会把成功的也退回去。
   * 按返回的 `moved / failed` 如实汇报，用户能据此知道哪几个没成。
   */
  const doMove = async (targetId: number): Promise<void> => {
    const ids = [...picked]
    if (ids.length === 0 || bulkBusy) return
    const targetName =
      targetId === -1 ? COPY.brand.unsorted : (folders.find((f) => f.id === targetId)?.name ?? '')
    setBulkBusy(true)
    try {
      const r = await window.api.brandMoveAssets({ ids, targetFolderId: targetId })
      if (r.error === 'no-target') {
        onToast(COPY.common.moveNoTarget, 'err')
      } else if (r.ok) {
        const tail = r.skipped > 0 ? ' ' + fmt(COPY.common.moveSkipped, { n: r.skipped }) : ''
        onToast(fmt(COPY.common.moveDone, { n: r.moved, name: targetName }) + tail, 'ok')
      } else {
        onToast(
          fmt(COPY.common.movePartial, {
            ok: r.moved,
            fail: r.failed.length,
            msg: r.failed[0]?.error ?? ''
          }),
          'err'
        )
      }
      setMoveOpen(false)
      setPicked(new Set())
      await load()
    } finally {
      setBulkBusy(false)
    }
  }

  /** 第 68 批：打开「复制到任务」——先把任务列表拉回来（同名任务靠项目名区分） */
  const openBulkCopy = async (): Promise<void> => {
    setCopyBulkOpen(true)
    try {
      const v = await window.api.listPacks()
      setPacks(v.packs.map((p) => ({ id: p.id, name: p.name, projectName: p.projectName })))
    } catch {
      setPacks([])
    }
  }

  const doBulkCopy = async (packId: number): Promise<void> => {
    const ids = [...picked]
    if (ids.length === 0 || bulkBusy) return
    const packName = packs.find((p) => p.id === packId)?.name ?? ''
    setBulkBusy(true)
    try {
      const r = await window.api.brandCopyAssetsToPack({ ids, packId })
      if (r.ok) onToast(fmt(COPY.common.copyDone, { n: r.copied, name: packName }), 'ok')
      else {
        onToast(
          fmt(COPY.common.copyPartial, {
            ok: r.copied,
            fail: r.failed.length,
            msg: r.failed[0]?.error ?? ''
          }),
          'err'
        )
      }
      setCopyBulkOpen(false)
      setPicked(new Set())
      await load()
    } finally {
      setBulkBusy(false)
    }
  }

  /** 第 68 批：序号化改名。前缀默认取当前分组名（"未分组/全部"时退回「素材」） */
  const defaultSeqPrefix = (): string => {
    if (typeof sel === 'number' && sel >= 0) {
      return folders.find((f) => f.id === sel)?.name ?? '素材'
    }
    return '素材'
  }

  const doRenameSeq = async (input: {
    prefix: string
    start: number
    pad: number
  }): Promise<void> => {
    const ids = [...picked]
    if (ids.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const r = await window.api.brandRenameAssetsSeq({ ids, ...input })
      if (r.ok) {
        const tail = r.skipped > 0 ? ' ' + fmt(COPY.common.renameSkipped, { n: r.skipped }) : ''
        onToast(fmt(COPY.common.renameDone, { n: r.renamed }) + tail, 'ok')
      } else {
        onToast(
          fmt(COPY.common.renamePartial, {
            ok: r.renamed,
            fail: r.failed.length,
            msg: r.failed[0]?.error ?? ''
          }),
          'err'
        )
      }
      setRenameOpen(false)
      setPicked(new Set())
      await load()
    } finally {
      setBulkBusy(false)
    }
  }

  /**
   * 第 67 批（docs/50）：列表的列定义。
   * 只在列表视图下用到，但定义放在组件顶部 —— 免得 JSX 里塞一坨 render 函数。
   * 列的取舍：**文件大小 / 修改时间 / 来源**在卡片上看不全，正是列表视图的价值所在。
   */
  const columns: ListColumn<BrandAssetItem>[] = [
    {
      key: 'name',
      label: COPY.common.colName,
      width: 'minmax(0,1.6fr)',
      title: (a) => a.fileName,
      render: (a) => <span className="dcell-name">{a.fileName}</span>
    },
    {
      key: 'group',
      label: COPY.common.colGroup,
      width: '120px',
      title: (a) => a.folderName ?? COPY.brand.unsorted,
      render: (a) => <span className="dcell-sub">{a.folderName ?? COPY.brand.unsorted}</span>
    },
    {
      key: 'px',
      label: COPY.common.colPx,
      width: '96px',
      align: 'right',
      render: (a) => (
        <span className="dcell-num">
          {a.width && a.height ? `${a.width}×${a.height}` : COPY.common.none}
        </span>
      )
    },
    {
      key: 'bytes',
      label: COPY.common.colSize,
      width: '76px',
      align: 'right',
      render: (a) => <span className="dcell-num">{fmtSize(a.size)}</span>
    },
    {
      key: 'source',
      label: COPY.common.colSource,
      width: '62px',
      render: (a) => (
        <span className="dcell-sub">{a.source === 'company' ? COPY.brand.company : COPY.brand.user}</span>
      )
    },
    {
      key: 'time',
      label: COPY.common.colTime,
      width: '112px',
      align: 'right',
      render: (a) => <span className="dcell-num">{fmtDateTime(a.modifiedAt)}</span>
    }
  ]

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
        {/* 第 67 批（docs/50）：卡片 / 列表切换 —— 放在最右，三视图同一位置 */}
        <ViewSwitch mode={viewMode} onChange={setViewMode} />
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
          <DirTree
            nodes={nodes}
            selectedId={typeof sel === 'number' && sel >= 0 ? sel : null}
            onSelect={(id) => setSel(id)}
            badge={(n) => {
              const f = folders.find((x) => x.id === n.id)
              if (!f) return null
              const label = !f.syncToPlugin
                ? COPY.brand.syncOff
                : f.effectiveSync
                  ? COPY.brand.syncOn
                  : COPY.brand.syncInherited
              return (
                <button
                  className={`b-sync${f.syncToPlugin ? ' on' : ''}${f.effectiveSync ? '' : ' inh'}`}
                  title={label}
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggleSync(f)
                  }}
                >
                  {label}
                </button>
              )
            }}
            actions={(n) => {
              const f = folders.find((x) => x.id === n.id)
              if (!f) return null
              return (
                <>
                  {f.canAddChild && (
                    <button className="mini" title={COPY.brand.newSubFolder} onClick={(e) => { e.stopPropagation(); setNameDraft(''); setNewFolder({ parentId: f.id }) }}>
                      <Icon name="plus" size={12} />
                    </button>
                  )}
                  <button className="mini" title={COPY.brand.pin} onClick={(e) => { e.stopPropagation(); void window.api.brandPinFolder(f.id).then(load) }}>
                    <Icon name="arrowUp" size={12} />
                  </button>
                  <button className="mini" title={COPY.brand.rename} onClick={(e) => { e.stopPropagation(); setNameDraft(f.name); setRenameTarget(f) }}>
                    <Icon name="edit" size={12} />
                  </button>
                  <button className="mini" title={COPY.brand.del} onClick={(e) => { e.stopPropagation(); setDelTarget(f) }}>
                    <Icon name="trash" size={12} />
                  </button>
                </>
              )
            }}
          />
          {data && data.skippedDeep > 0 && (
            <div className="brand-hint">{fmt(COPY.brand.skippedDeep, { n: data.skippedDeep })}</div>
          )}
          {sel === -1 && <div className="brand-hint">{COPY.brand.unsortedHint}</div>}
        </div>

        {/* 右：卡片网格 / 列表（第 67 批：两种视图，用户按场景切） */}
        <div className="brand-main">
          {/* 批量条只在「列表视图 + 有勾选」时出现 —— 卡片视图的勾选交回给单卡片按钮 */}
          {viewMode === 'list' && picked.size > 0 && (
            <div className="bulk-bar">
              <span className="n">{fmt(COPY.common.bulkCount, { n: picked.size })}</span>
              <span className="spacer" />
              <button
                className="btn"
                disabled={bulkBusy}
                title={COPY.common.bulkMoveTip}
                onClick={() => setMoveOpen(true)}
              >
                <Icon name="folder" size={12} /> {COPY.common.bulkMove}
              </button>
              <button
                className="btn"
                disabled={bulkBusy}
                title={COPY.common.bulkCopyToPackTip}
                onClick={() => void openBulkCopy()}
              >
                <Icon name="package" size={12} /> {COPY.common.bulkCopyToPack}
              </button>
              <button
                className="btn"
                disabled={bulkBusy}
                title={COPY.common.bulkRenameTip}
                onClick={() => setRenameOpen(true)}
              >
                <Icon name="edit" size={12} /> {COPY.common.bulkRename}
              </button>
              <button
                className="btn"
                disabled={bulkBusy}
                title={COPY.common.bulkForgetTip}
                onClick={() => void runBulk('forget', (id) => window.api.brandForgetAsset(id))}
              >
                <Icon name="eyeOff" size={12} /> {bulkBusy ? COPY.common.bulkWorking : COPY.common.bulkForget}
              </button>
              <button
                className="btn"
                disabled={bulkBusy}
                title={COPY.common.bulkRemoveTip}
                onClick={() => void runBulk('remove', (id) => window.api.brandRemoveAsset(id))}
              >
                <Icon name="trash" size={12} /> {COPY.common.bulkRemove}
              </button>
              <button className="btn" disabled={bulkBusy} onClick={() => setPicked(new Set())}>
                {COPY.common.bulkClearSel}
              </button>
            </div>
          )}

          {assets.length === 0 ? (
            <div className="brand-empty">{sel === 'all' && !keyword ? COPY.brand.emptyAll : COPY.brand.emptyGroup}</div>
          ) : viewMode === 'list' ? (
            <ListTable
              rows={assets}
              columns={columns}
              selected={picked}
              onToggle={(id) =>
                setPicked((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
              onToggleAll={() =>
                setPicked((prev) => {
                  const all = assets.every((a) => prev.has(a.id))
                  return all ? new Set() : new Set(assets.map((a) => a.id))
                })
              }
              onSelectRange={(ids) => setPicked((prev) => new Set([...prev, ...ids]))}
              rowClass={(a) => (a.missing ? 'missing' : '')}
              empty={COPY.brand.emptyGroup}
            />
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
      {/* 第 67 批（docs/50 §6）：移动到分组（多层分组按层缩进列出来） */}
      {moveOpen && (
        <MoveToFolderModal
          busy={bulkBusy}
          nodes={[
            { id: -1, name: COPY.brand.unsorted, depth: 0, count: data?.stats.unsorted ?? 0 },
            ...folders.map((f) => ({
              id: f.id,
              name: f.name,
              depth: f.depth,
              count: f.totalCount
            }))
          ]}
          onPick={(id) => void doMove(id)}
          onClose={() => {
            if (!bulkBusy) setMoveOpen(false)
          }}
        />
      )}

      {copyBulkOpen && (
        <PickPackModal
          packs={packs}
          busy={bulkBusy}
          onPick={(id) => void doBulkCopy(id)}
          onClose={() => {
            if (!bulkBusy) setCopyBulkOpen(false)
          }}
        />
      )}

      {renameOpen && (
        <SeqRenameModal
          count={picked.size}
          defaultPrefix={defaultSeqPrefix()}
          ext={
            assets.find((a) => picked.has(a.id))
              ? `.${assets.find((a) => picked.has(a.id))!.ext}`
              : ''
          }
          busy={bulkBusy}
          onApply={(input) => void doRenameSeq(input)}
          onClose={() => {
            if (!bulkBusy) setRenameOpen(false)
          }}
        />
      )}

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
