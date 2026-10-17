/**
 * 第 66 批（docs/49）：**PSD 模板库**视图。
 *
 * 自包含（照 `BrandLibraryView` 的路数，不往 `App.tsx` 堆状态）：
 * 左侧**多层**目录树（`DirTree`，与通用库共用一套）+ 右侧模板网格。
 *
 * 与通用库视图的三处差别（都是本批拍板）：
 * · 树是**任意层**（≤5），不是"父组 + 子组"两层；
 * · 卡片上挂**参考线条数**角标（`guides`）—— 这是模板库存在的理由，必须一眼看得见；
 * · 收录有**卡口**（只 PSD / ≤20 MB / 必须读到尺寸），被拒的文件在顶部提示条里列出来。
 *
 * 全部写操作走主进程 `tpl:*` IPC —— 这一层不碰磁盘、不碰数据库。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import { DirTree, type DirNode } from './DirTree'
import { Icon } from './Icon'
// 第 67 批（docs/50）：卡片 / 列表双视图 + 列表勾选批量
import { ListTable, fmtDateTime, type ListColumn } from './ListTable'
import { ViewSwitch, useViewMode } from './ViewSwitch'
import { fmtSize } from './FileRow'
import { MoveToFolderModal } from './MoveToFolderModal'
// 第 69 批（docs/51）：模板缩略图 = 信息卡（HTML 渲染，替代模糊的 PSD 内嵌预览）
import { TplInfoCard } from './TplInfoCard'
import { TPL_CARD_CSS } from '../../../shared/tplCardMarkup'
// 第 68 批（docs/50 §6）：批量复制到任务 / 序号化改名
import { PickPackModal } from './PickPackModal'
import { SeqRenameModal } from './SeqRenameModal'

interface TplFolderVM {
  id: number
  parentId: number | null
  name: string
  depth: number
  sortOrder: number
  assetCount: number
  totalCount: number
  canAddChild: boolean
}

interface TplAssetVM {
  id: number
  folderId: number | null
  folderName: string | null
  folderPath: string[]
  fileName: string
  ext: string
  size: number
  width: number | null
  height: number | null
  resolution: number | null
  guides: number | null
  colorMode: string | null
  /** 第 69 批（docs/51）：PSD 关键词（成品尺寸 / 出血写在这里） */
  keywords: string[]
  missing: boolean
  modifiedAt: string
  absPath: string
  thumb: string | null
}

interface TplRejectedVM {
  name: string
  abs: string
  reason: 'not-psd' | 'too-large' | 'no-size' | 'too-deep'
}

interface TplListVM {
  folders: TplFolderVM[]
  assets: TplAssetVM[]
  stats: { folders: number; assets: number; unsorted: number; missing: number; noGuides: number }
  skippedDeep: number
  rejected: TplRejectedVM[]
  maxDepth: number
  maxBytes: number
}

type Prompt =
  | { kind: 'newFolder'; parentId: number | null }
  | { kind: 'renameFolder'; id: number }
  | { kind: 'renameAsset'; id: number }

type Confirm =
  | { kind: 'delFolder'; id: number; name: string; count: number }
  | { kind: 'removeAsset'; id: number; name: string }

export function TplLibraryView({
  onToast
}: {
  onToast: (m: string, kind?: 'ok' | 'err' | 'info') => void
}): React.JSX.Element {
  const [data, setData] = useState<TplListVM | null>(null)
  /** 'all' = 全部模板；-1 = 未分组；数字 = 某组（含所有子层） */
  const [sel, setSel] = useState<number | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [draft, setDraft] = useState('')

  /** 第 67 批（docs/50）：卡片 / 列表视图（偏好独立记忆，键 `vellum.view.tpl`） */
  const [viewMode, setViewMode] = useViewMode('tpl')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  /** 第 67 批（docs/50 §6）：「移动到…」弹窗 */
  const [moveOpen, setMoveOpen] = useState(false)
  /** 第 68 批：批量复制到任务 / 批量改名 */
  const [copyBulkOpen, setCopyBulkOpen] = useState(false)
  /** 第 69 批：重建卡片图（给插件）时的忙态 */
  const [cardsBusy, setCardsBusy] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [packs, setPacks] = useState<
    Array<{ id: number; name: string; projectName?: string | null }>
  >([])

  /**
   * ⚠️ `onToast` 是父组件里的**内联箭头函数**，每次渲染都是新引用。
   * 放进 `load` 的依赖里会让 effect 每次重跑 → setState → 再渲染 → **无限重取**。
   * 用 ref 存住它，`load` 的依赖只留真正影响数据的 sel / keyword。
   * （这是 `BrandLibraryView` 踩过的坑，原样沿用。）
   */
  const toastRef = useRef(onToast)
  toastRef.current = onToast

  const load = useCallback(async () => {
    try {
      const d = (await window.api.tplList({
        folderId: typeof sel === 'number' ? sel : undefined,
        keyword: keyword.trim() || undefined
      })) as TplListVM
      setData(d)
    } catch (e) {
      toastRef.current(fmt(COPY.tpl.failed, { msg: (e as Error).message }), 'err')
    }
  }, [sel, keyword])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 第 67 批（docs/50）：换分组 / 改搜索词 ⇒ 清空勾选。
   * 不清的话，"在 A 组勾 3 条、切到 B 组点批量删除"会把看不见的 A 组那 3 条也删掉。
   */
  useEffect(() => {
    setPicked(new Set())
  }, [sel, keyword])

  /**
   * 批量执行（清除记录 / 删除）——**逐条调现成的单条通道**，理由同 `BrandLibraryView`：
   * 单条通道已经过了 accept 与真机（含回收站、缺文件、重名），批量版再写一遍边界只是多一份出错机会。
   * 逐条 await（不并发）：这些操作会 rename 磁盘文件，并发容易互相踩。
   * 中途失败不中断，最后按「成功 N / 失败 M + 第一条错误」汇总。
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
      toastRef.current(fmt(done, { n: okN }), 'ok')
    } else {
      const partial = kind === 'forget' ? COPY.common.bulkForgetPartial : COPY.common.bulkRemovePartial
      toastRef.current(fmt(partial, { ok: okN, fail, msg: firstErr }), 'err')
    }
    await load()
  }

  const run = async (fn: () => Promise<{ ok?: boolean; error?: string } | void>, okMsg?: string) => {
    setBusy(true)
    try {
      const r = await fn()
      if (r && r.ok === false) {
        const err = r.error ?? ''
        const known =
          err === 'depth'
            ? COPY.tpl.depthLimit
            : err === 'duplicate'
              ? COPY.tpl.dupName
              : fmt(COPY.tpl.failed, { msg: err })
        toastRef.current(known, 'err')
      } else if (okMsg) {
        toastRef.current(okMsg, 'ok')
      }
      await load()
    } catch (e) {
      toastRef.current(fmt(COPY.tpl.failed, { msg: (e as Error).message }), 'err')
    } finally {
      setBusy(false)
    }
  }

  const doScan = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = (await window.api.tplScan()) as {
        ok: boolean
        added: number
        folders: number
        rejected?: TplRejectedVM[]
      }
      await load()
      if (r.rejected && r.rejected.length > 0) {
        toastRef.current(
          fmt(COPY.tpl.rejectedTitle, { n: r.rejected.length }) + ' · ' + rejectReasonText(r.rejected[0]),
          'info'
        )
      } else {
        // 第 67 批（docs/50）：扫描要**有反馈** —— 否则点了没动静，用户会以为按钮坏了
        toastRef.current(
          r.added > 0
            ? fmt(COPY.tpl.scanDone, { n: r.added, folders: r.folders })
            : COPY.tpl.scanDoneNone,
          'ok'
        )
      }
    } catch (e) {
      toastRef.current(fmt(COPY.tpl.failed, { msg: (e as Error).message }), 'err')
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (): Promise<void> => {
    const picked = (await window.api.tplPickFiles()) as {
      ok: boolean
      canceled?: boolean
      paths: string[]
    }
    if (!picked.ok || picked.paths.length === 0) return
    setBusy(true)
    try {
      const r = (await window.api.tplImport({
        paths: picked.paths,
        folderId: typeof sel === 'number' && sel >= 0 ? sel : null
      })) as { ok: boolean; imported: number; renamed: number; rejected: TplRejectedVM[] }
      await load()
      if (r.imported === 0 && r.rejected.length === 0) {
        toastRef.current(COPY.tpl.importNone, 'info')
      } else if (r.rejected.length > 0) {
        toastRef.current(
          fmt(COPY.tpl.rejectedTitle, { n: r.rejected.length }) + ' · ' + rejectReasonText(r.rejected[0]),
          'info'
        )
      } else if (r.renamed > 0) {
        toastRef.current(fmt(COPY.tpl.importedRenamed, { n: r.imported, renamed: r.renamed }), 'ok')
      } else {
        toastRef.current(fmt(COPY.tpl.imported, { n: r.imported, folders: 0 }), 'ok')
      }
    } catch (e) {
      toastRef.current(fmt(COPY.tpl.failed, { msg: (e as Error).message }), 'err')
    } finally {
      setBusy(false)
    }
  }

  const submitPrompt = async (): Promise<void> => {
    if (!prompt) return
    const value = draft.trim()
    if (!value) return
    const p = prompt
    setPrompt(null)
    if (p.kind === 'newFolder') {
      await run(
        () => window.api.tplCreateFolder({ name: value, parentId: p.parentId }),
        COPY.tpl.newFolder + '：' + value
      )
    } else if (p.kind === 'renameFolder') {
      await run(() => window.api.tplRenameFolder({ id: p.id, name: value }), COPY.tpl.rename)
    } else {
      await run(() => window.api.tplRenameAsset({ id: p.id, name: value }), COPY.tpl.rename)
    }
  }

  const submitConfirm = async (): Promise<void> => {
    if (!confirm) return
    const c = confirm
    setConfirm(null)
    if (c.kind === 'delFolder') {
      const r = (await window.api.tplDeleteFolder(c.id)) as { ok: boolean; moved?: number }
      await load()
      if (r.ok) {
        if (sel === c.id) setSel('all')
        toastRef.current(fmt(COPY.tpl.delFolderDone, { n: r.moved ?? 0 }), 'ok')
      }
    } else {
      const r = (await window.api.tplRemoveAsset(c.id)) as { ok: boolean; error?: string }
      await load()
      if (r.ok) toastRef.current(COPY.tpl.removeDone, 'ok')
      else toastRef.current(fmt(COPY.tpl.failed, { msg: r.error ?? '' }), 'err')
    }
  }

  const folders = data?.folders ?? []
  const assets = data?.assets ?? []
  const nodes: DirNode[] = folders.map((f) => ({
    id: f.id,
    parentId: f.parentId,
    name: f.name,
    depth: f.depth,
    count: f.totalCount
  }))
  const byId = new Map(folders.map((f) => [f.id, f]))

  /**
   * 第 67 批（docs/50 §6）：批量移动到分组（`-1` = 未分组；与通用库同一套口径）。
   * 不做整批回滚 —— 主进程已经搬了一部分，按 moved / failed 如实汇报。
   */
  const doMove = async (targetId: number): Promise<void> => {
    const ids = [...picked]
    if (ids.length === 0 || bulkBusy) return
    const targetName =
      targetId === -1 ? COPY.tpl.unsorted : (byId.get(targetId)?.name ?? '')
    setBulkBusy(true)
    try {
      const r = await window.api.tplMoveAssets({ ids, targetFolderId: targetId })
      if (r.error === 'no-target') {
        toastRef.current(COPY.common.moveNoTarget, 'err')
      } else if (r.ok) {
        const tail = r.skipped > 0 ? ' ' + fmt(COPY.common.moveSkipped, { n: r.skipped }) : ''
        toastRef.current(fmt(COPY.common.moveDone, { n: r.moved, name: targetName }) + tail, 'ok')
      } else {
        toastRef.current(
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

  /**
   * 第 69 批（docs/53）：重建给插件用的卡片图。
   *
   * 为什么不"自动就够"：内容变了会按签名自动重画，但**样式**（CSS / logo）变了签名不变，
   * 缓存会命中旧图 —— 改完设计必须点这个，否则插件里还是老样子。
   */
  const doRebuildCards = async (): Promise<void> => {
    if (cardsBusy) return
    setCardsBusy(true)
    try {
      const r = await window.api.tplRebuildCards()
      toastRef.current(
        r.ok
          ? fmt(COPY.tpl.rebuildCardsDone, { n: r.rendered })
          : fmt(COPY.tpl.failed, { msg: 'rebuild' }),
        r.ok ? 'ok' : 'err'
      )
    } catch (e) {
      toastRef.current(fmt(COPY.tpl.failed, { msg: (e as Error).message }), 'err')
    } finally {
      setCardsBusy(false)
    }
  }

  /** 第 68 批：打开「复制到任务」 */
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
      const r = await window.api.tplCopyAssetsToPack({ ids, packId })
      if (r.ok) toastRef.current(fmt(COPY.common.copyDone, { n: r.copied, name: packName }), 'ok')
      else {
        toastRef.current(
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

  /** 序号化改名。前缀默认取当前分组名（"全部/未分组"时退回「模板」） */
  const defaultSeqPrefix = (): string => {
    if (typeof sel === 'number' && sel >= 0) {
      return byId.get(sel)?.name ?? '模板'
    }
    return '模板'
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
      const r = await window.api.tplRenameAssetsSeq({ ids, ...input })
      if (r.ok) {
        const tail = r.skipped > 0 ? ' ' + fmt(COPY.common.renameSkipped, { n: r.skipped }) : ''
        toastRef.current(fmt(COPY.common.renameDone, { n: r.renamed }) + tail, 'ok')
      } else {
        toastRef.current(
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

  const rejectReasonText = (r: TplRejectedVM): string => {
    switch (r.reason) {
      case 'too-large':
        return COPY.tpl.rejectedTooLarge
      case 'not-psd':
        return COPY.tpl.rejectedNotPsd
      case 'too-deep':
        return COPY.tpl.rejectedTooDeep
      default:
        return COPY.tpl.rejectedNoSize
    }
  }

  const sizeText = (a: TplAssetVM): string => {
    const wh = `${a.width ?? '?'}×${a.height ?? '?'}`
    return a.resolution ? fmt(COPY.tpl.sizeInfoWithPpi, { w: a.width ?? '?', h: a.height ?? '?', ppi: a.resolution }) : wh
  }

  /**
   * 第 67 批（docs/50）：列表的列定义。
   *
   * **参考线独占一列**（还带三种状态徽标）—— 模板库列表的存在意义之一就是
   * 「一眼扫出哪些模板没打参考线」，这是卡片视图看不快的（卡上角标挤在缩略图里）。
   */
  const columns: ListColumn<TplAssetVM>[] = [
    {
      key: 'name',
      label: COPY.common.colName,
      width: 'minmax(0,1.4fr)',
      title: (a) => a.fileName,
      render: (a) => <span className="dcell-name">{a.fileName}</span>
    },
    {
      key: 'group',
      label: COPY.common.colGroup,
      // 150px：多层目录的路径可能长到「易拉宝 / 2026春季 / 海南」，132px 会被截掉尾巴
      width: '150px',
      title: (a) => (a.folderPath.length ? a.folderPath.join(' / ') : COPY.tpl.unsorted),
      render: (a) => (
        <span className="dcell-sub">
          {a.folderPath.length ? a.folderPath.join(' / ') : COPY.tpl.unsorted}
        </span>
      )
    },
    {
      key: 'px',
      label: COPY.common.colPx,
      width: '92px',
      align: 'right',
      render: (a) => (
        <span className="dcell-num">
          {a.width && a.height ? `${a.width}×${a.height}` : COPY.common.none}
        </span>
      )
    },
    {
      key: 'ppi',
      label: COPY.common.colPpi,
      width: '54px',
      align: 'right',
      render: (a) => (
        <span className="dcell-num">{a.resolution ? `${a.resolution}` : COPY.common.none}</span>
      )
    },
    {
      key: 'guides',
      label: COPY.common.colGuides,
      width: '80px',
      render: (a) => (
        <span
          className={`dchip${a.guides === null ? '' : a.guides === 0 ? ' warn' : ' ok'}`}
          title={COPY.tpl.intro}
        >
          {a.guides === null
            ? COPY.tpl.guidesUnknown
            : a.guides === 0
              ? COPY.tpl.noGuides
              : fmt(COPY.tpl.guidesBadge, { n: a.guides })}
        </span>
      )
    },
    {
      key: 'bytes',
      label: COPY.common.colSize,
      width: '72px',
      align: 'right',
      render: (a) => <span className="dcell-num">{fmtSize(a.size)}</span>
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
      {/* 第 69 批：信息卡的样式只有一份（shared），这里注入一次给所有卡片用 */}
      <style>{TPL_CARD_CSS}</style>
      <div className="brand-top">
        <span className="bt-title">{COPY.tpl.title}</span>
        <span className="brand-stats" title={COPY.tpl.intro}>
          {fmt(COPY.tpl.statsText, { folders: data?.stats.folders ?? 0, assets: data?.stats.assets ?? 0 })}
        </span>
        <span className="spacer" />
        <div className="search-wrap brand-search-wrap">
          <span className="icon">
            <Icon name="search" size={13} />
          </span>
          <input
            className="brand-search"
            value={keyword}
            placeholder={COPY.tpl.searchPlaceholder}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="brand-actions">
          <button className="btn" disabled={busy} onClick={() => void doScan()}>
            <Icon name="refresh" size={13} /> {busy ? COPY.tpl.scanning : COPY.tpl.scan}
          </button>
          <button className="btn" disabled={busy} onClick={() => void doImport()}>
            <Icon name="plus" size={13} strokeWidth={2} /> {COPY.tpl.importFiles}
          </button>
          {/* 第 69 批（docs/53）：插件吃的是渲染好的卡片图。改了卡片样式才需要点这个 */}
          <button
            className="btn"
            disabled={busy || cardsBusy}
            title={COPY.tpl.rebuildCardsTip}
            onClick={() => void doRebuildCards()}
          >
            <Icon name="image" size={13} />{' '}
            {cardsBusy ? COPY.tpl.rebuildCardsRunning : COPY.tpl.rebuildCards}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              setDraft('')
              setPrompt({ kind: 'newFolder', parentId: null })
            }}
          >
            <Icon name="plus" size={13} strokeWidth={2} /> {COPY.tpl.newFolder}
          </button>
        </div>
        {/* 第 67 批（docs/50）：卡片 / 列表切换 —— 与通用库同一位置 */}
        <ViewSwitch mode={viewMode} onChange={setViewMode} />
      </div>

      <div className="brand-body">
        {/* 左：多层目录树（DirTree） */}
        <div className="brand-tree">
          <button className={`brand-node all${sel === 'all' ? ' on' : ''}`} onClick={() => setSel('all')}>
            <span className="bn-name">{COPY.tpl.all}</span>
            <span className="b-count">{data?.stats.assets ?? 0}</span>
          </button>
          <button
            className={`brand-node unsorted${sel === -1 ? ' on' : ''}`}
            title={COPY.tpl.unsortedHint}
            onClick={() => setSel(-1)}
          >
            <span className="bn-name">{COPY.tpl.unsorted}</span>
            <span className="b-count">{data?.stats.unsorted ?? 0}</span>
          </button>

          <DirTree
            nodes={nodes}
            selectedId={typeof sel === 'number' && sel >= 0 ? sel : null}
            onSelect={(id) => setSel(id)}
            actions={(n) => {
              const f = byId.get(n.id)
              return (
                <>
                  {f?.canAddChild && (
                    <button
                      className="mini"
                      title={COPY.tpl.newSubFolder}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDraft('')
                        setPrompt({ kind: 'newFolder', parentId: n.id })
                      }}
                    >
                      <Icon name="plus" size={12} />
                    </button>
                  )}
                  <button
                    className="mini"
                    title={COPY.tpl.rename}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDraft(n.name)
                      setPrompt({ kind: 'renameFolder', id: n.id })
                    }}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                  <button
                    className="mini"
                    title={COPY.tpl.delFolder}
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirm({
                        kind: 'delFolder',
                        id: n.id,
                        name: n.name,
                        count: n.count
                      })
                    }}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </>
              )
            }}
          />

          {(data?.skippedDeep ?? 0) > 0 && (
            <div className="brand-hint">{fmt(COPY.tpl.skippedDeep, { n: data?.skippedDeep ?? 0 })}</div>
          )}
          {sel === -1 && <div className="brand-hint">{COPY.tpl.unsortedHint}</div>}
          {data && data.stats.noGuides > 0 && (
            <div className="brand-hint">{COPY.tpl.noGuides}：{data.stats.noGuides}</div>
          )}
        </div>

        {/* 右：模板网格 */}
        <div className="brand-main">
          {(data?.rejected.length ?? 0) > 0 && (
            <div className="tpl-reject" title={COPY.tpl.rejectedTitle}>
              <Icon name="warning" size={13} />
              <span>{fmt(COPY.tpl.rejectedTitle, { n: data?.rejected.length ?? 0 }) }</span>
              <span className="rlist">
                {data?.rejected
                  .slice(0, 3)
                  .map((r) => `${r.name}（${rejectReasonText(r)}）`)
                  .join('、')}
                {(data?.rejected.length ?? 0) > 3 ? ' …' : ''}
              </span>
            </div>
          )}

          {/* 批量条只在「列表视图 + 有勾选」时出现 */}
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
                onClick={() => void runBulk('forget', (id) => window.api.tplForgetAsset(id))}
              >
                <Icon name="eyeOff" size={12} /> {bulkBusy ? COPY.common.bulkWorking : COPY.common.bulkForget}
              </button>
              <button
                className="btn"
                disabled={bulkBusy}
                title={COPY.common.bulkRemoveTip}
                onClick={() => void runBulk('remove', (id) => window.api.tplRemoveAsset(id))}
              >
                <Icon name="trash" size={12} /> {COPY.common.bulkRemove}
              </button>
              <button className="btn" disabled={bulkBusy} onClick={() => setPicked(new Set())}>
                {COPY.common.bulkClearSel}
              </button>
            </div>
          )}

          {assets.length === 0 ? (
            <div className="brand-empty">
              {sel === 'all' && !keyword ? COPY.tpl.emptyAll : COPY.tpl.emptyGroup}
            </div>
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
              empty={COPY.tpl.emptyGroup}
            />
          ) : (
            <div className="brand-grid tpl-grid">
              {assets.map((a) => (
                <div key={a.id} className={`brand-card${a.missing ? ' missing' : ''}`} data-tid={a.id}>
                  <div className="thumb">
                    {/* 第 69 批：不再用 PSD 内嵌预览（典型 160px，放大必糊），改画信息卡 */}
                    <TplInfoCard a={a} />
                    {a.missing && <span className="b-miss">{COPY.tpl.missing}</span>}
                    {/* 参考线角标：有 / 无 / 未探到 三种状态分开显示 */}
                    <span
                      className={`tpl-guides${a.guides === 0 ? ' none' : ''}${a.guides === null ? ' unk' : ''}`}
                      title={COPY.tpl.intro}
                    >
                      {a.guides === null
                        ? COPY.tpl.guidesUnknown
                        : a.guides === 0
                          ? COPY.tpl.noGuides
                          : fmt(COPY.tpl.guidesBadge, { n: a.guides })}
                    </span>
                    <span className="b-acts">
                      <button
                        className="mini"
                        title={COPY.tpl.openFile}
                        onClick={() => void window.api.openFolder(a.absPath)}
                      >
                        <Icon name="external" size={12} />
                      </button>
                      <button
                        className="mini"
                        title={COPY.tpl.locate}
                        onClick={() => void window.api.revealFile(a.absPath)}
                      >
                        <Icon name="locate" size={12} />
                      </button>
                      <button
                        className="mini"
                        title={COPY.tpl.rename}
                        onClick={() => {
                          setDraft(a.fileName)
                          setPrompt({ kind: 'renameAsset', id: a.id })
                        }}
                      >
                        <Icon name="edit" size={12} />
                      </button>
                      <button
                        className="mini"
                        title={COPY.tpl.removeTitle}
                        onClick={() =>
                          setConfirm({ kind: 'removeAsset', id: a.id, name: a.fileName })
                        }
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </span>
                  </div>
                  <div className="meta">
                    <span className="name" title={a.fileName}>
                      {a.fileName}
                    </span>
                    <span className="sub">
                      {sizeText(a)}
                      {a.folderPath.length > 0 ? ' · ' + a.folderPath.join(' / ') : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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

      {/* ---- 命名弹窗（新建分组 / 分组改名 / 模板改名 共用一个） ---- */}
      {/* 第 67 批（docs/50 §6）：移动到分组 */}
      {moveOpen && (
        <MoveToFolderModal
          busy={bulkBusy}
          nodes={[
            { id: -1, name: COPY.tpl.unsorted, depth: 0, count: data?.stats.unsorted ?? 0 },
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

      {prompt && (
        <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && setPrompt(null)}>
          <div className="modal">
            <h3>
              {prompt.kind === 'newFolder'
                ? COPY.tpl.newFolder
                : prompt.kind === 'renameFolder'
                  ? COPY.tpl.renameFolderTitle
                  : COPY.tpl.renameAssetTitle}
            </h3>
            <div className="content">
              <input
                className="tk-input"
                autoFocus
                value={draft}
                placeholder={
                  prompt.kind === 'renameAsset' ? COPY.tpl.assetNamePlaceholder : COPY.tpl.namePlaceholder
                }
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitPrompt()}
              />
              <div className="tk-actions">
                <button className="btn" onClick={() => setPrompt(null)}>
                  取消
                </button>
                <button className="btn primary" onClick={() => void submitPrompt()}>
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- 确认弹窗（删分组 / 移出模板） ---- */}
      {confirm && (
        <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal">
            <h3>{confirm.kind === 'delFolder' ? COPY.tpl.delFolder : COPY.tpl.removeTitle}</h3>
            <div className="content">
              <p>
                {confirm.kind === 'delFolder'
                  ? fmt(COPY.tpl.delFolderBody, { name: confirm.name, n: confirm.count })
                  : fmt(COPY.tpl.removeBody, { name: confirm.name })}
              </p>
              <div className="tk-actions">
                <button className="btn" onClick={() => setConfirm(null)}>
                  取消
                </button>
                <button className="btn primary" onClick={() => void submitConfirm()}>
                  {confirm.kind === 'delFolder' ? COPY.tpl.delFolderOk : COPY.tpl.removeOk}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
