import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AssetItem,
  DimensionGroup,
  PackCard as PackCardType,
  ProjectWithCount,
  UnboundProject,
  UpdatePackPatch,
  WorkspaceEntry,
  WsInfo
} from './types'

import { PackCard, UnassignedCard } from './components/PackCard'
import { FileRow, fmtSize } from './components/FileRow'
import { NewPackModal } from './components/NewPackModal'
import { PackDetailModal } from './components/PackDetailModal'
import { EditPackModal } from './components/EditPackModal'
import { ProjectModal } from './components/ProjectModal'
import { DeleteProjectModal } from './components/DeleteProjectModal'
import { UnboundProjectsModal } from './components/UnboundProjectsModal'
import { RelocateModal } from './components/RelocateModal'
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

/**
 * 左栏项目筛选 → 标签计数的范围参数。
 * '全部' = 不限（全库可见素材）；数字 = 该项目的包；null = 待归类。
 * 与 `shownPacks` 的口径一一对应，标签数字才能和点开后的结果对上。
 */
function tagScope(f: ProjectFilter): { projectId?: number | null } | undefined {
  return f === '全部' ? undefined : { projectId: f }
}

/** 左栏宽度（px）。默认、最小、最大 */
const SIDE_DEFAULT = 220
const SIDE_MIN = 170
const SIDE_MAX = 420
const SIDE_KEY = 'media.sideWidth'

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<WsInfo | null>(null)
  /** ws:info 是否已经查过一次 —— 查过之前不要贸然去敲数据库 */
  const [wsReady, setWsReady] = useState(false)
  /** 第 6 批：刚升级过目录结构时的提示（看过即清） */
  const [layoutNotice, setLayoutNotice] = useState<{ at: string; packs: number } | null>(null)
  const [view, setView] = useState<ViewMode>('packs')
  const [keyword, setKeyword] = useState('')
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('全部')
  const [sideWidth, setSideWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SIDE_KEY))
    return saved >= SIDE_MIN && saved <= SIDE_MAX ? saved : SIDE_DEFAULT
  })
  const [resizing, setResizing] = useState(false)

  const [packs, setPacks] = useState<PackCardType[]>([])
  const [stats, setStats] = useState({ packs: 0, files: 0, size: 0, unassigned: 0, missing: 0 })
  const [unassignedSize, setUnassignedSize] = useState(0)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  /** 第 8 批：只看文件已丢失的（左栏「⚠️ 文件已丢失」入口） */
  const [missingOnly, setMissingOnly] = useState(false)
  /** 第 9 批（M6）：只看当前那一稿的文件（工具栏开关） */
  const [currentOnly, setCurrentOnly] = useState(false)

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

  // ---- 第 7 批：记录生命周期 ----
  /** 正在编辑信息的包（null = 弹窗关闭） */
  const [editingPackId, setEditingPackId] = useState<number | null>(null)
  const [showUnbound, setShowUnbound] = useState(false)
  /** 包信息改过之后，让包详情弹窗重新挂载一次（它的数据是挂载时拉的） */
  const [detailTick, setDetailTick] = useState(0)

  // ---- 第 8 批：文件已丢失 / 重新定位（M8-03）----
  const [showRelocate, setShowRelocate] = useState(false)

  const [scanning, setScanning] = useState(false)
  const [toasts, setToasts] = useState<ToastMsg[]>([])

  const toastId = useRef(0)
  const toast = useCallback((text: string, kind: 'ok' | 'err' | 'info' = 'info'): void => {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, text, kind }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600)
  }, [])

  // ---------------- 数据加载 ----------------

  const loadWs = useCallback(async (refresh = false): Promise<WsInfo> => {
    const i = await window.api.wsInfo(refresh ? { refresh: true } : undefined)
    setInfo(i)
    setLayoutNotice(i.layoutMigrated ?? null)
    setWsReady(true)
    return i
  }, [])

  /** 第 6 批：目录结构升级提示条 —— 看过就清标记，只出现一次 */
  const dismissLayoutNotice = useCallback((): void => {
    setLayoutNotice(null)
    void window.api.wsAckLayout()
  }, [])

  /**
   * 只有工作区确实可用，才允许下面那些「自动加载」的副作用动手。
   * 理由：工作区连不上（移动硬盘没插）时数据库根本打不开，
   * 那几条副作用会一路把 ENOTDIR 抛到控制台 —— 界面已有提示条，这里统一闸住。
   */
  const wsLive = wsReady && info?.workspaceOk === true

  /** 当前活动工作区（多工作区下，提示条和状态栏都要说清是哪一个） */
  const activeWs = (info?.workspaces ?? []).find((w) => w.id === info?.activeId) ?? null

  /**
   * 第 3 批：拉各维度及其标签（带使用计数）。
   * 第 7 批补：计数口径跟随左栏当前项目范围，数字与点开后的结果保持一致。
   */
  const loadTags = useCallback(
    async (scope?: { projectId?: number | null }): Promise<DimensionGroup[]> => {
      const d = await window.api.listTagDimensions(scope)
      setTagDimensions(d)
      // 已删/已归档的项目对应的负数 id 要从已选里剔掉，避免筛出空结果
      const valid = new Set<number>()
      for (const g of d) for (const t of g.tags) valid.add(t.id)
      setSelectedTagIds((prev) => {
        const next = prev.filter((id) => valid.has(id))
        return next.length === prev.length ? prev : next
      })
      return d
    },
    []
  )

  const loadPacks = useCallback(async (): Promise<void> => {
    const r = await window.api.listPacks()
    setPacks(r.packs)
    setStats(r.total)
    const un = await window.api.listAssets({ view: 'unassigned' })
    setUnassignedSize(un.items.reduce((s, i) => s + i.size, 0))
  }, [])

  /**
   * 第 10 批（2026-09-30 用户实测反馈）：**「物料类别」清单在全软件里只有一套**。
   *
   * 就用左栏标签维度「物料类别」里的那一组 —— 建包 / 编辑包的类别 chips 从这里派生，
   * 所以：左栏「标签管理 → 物料类别」里加一个「易拉宝」，新建包弹窗当场能选到；
   * 删掉「PPT」，它也就不再出现在建包清单里。改名 / 删除还会反向联动已有包（见 tags.ts）。
   *
   * 这里不再走 `info.categories`：那份是 `db.ts` 里写死的常量，跟左栏这套只有两项重叠，
   * 用户实测报了这个 bug 后已把常量与接口字段一并删掉，避免以后又冒出第二个数据源。
   */
  const categoryOptions = useMemo(
    () => tagDimensions.find((d) => d.key === 'category')?.tags.map((t) => t.name) ?? [],
    [tagDimensions]
  )

  const loadAssets = useCallback(
    async (
      kw: string,
      unassigned: boolean,
      tagIds: number[],
      missing?: boolean,
      /** 第 9 批（M6）：只看当前那一稿 */
      cur?: boolean
    ): Promise<void> => {
      const r = await window.api.listAssets({
        keyword: kw,
        view: unassigned ? 'unassigned' : 'all',
        tagIds,
        missingOnly: missing === true,
        currentOnly: cur === true,
        withTags: true
      })
      setAssets(r.items)
      if (unassigned) setUnassignedSize(r.items.reduce((s, i) => s + i.size, 0))
    },
    []
  )

  useEffect(() => {
    ;(async () => {
      const i = await loadWs()
      // 工作区连不上时（盘没挂载）数据库根本打不开，直接不加载，交给顶部提示条
      if (!i.workspaceOk) return
      await loadTags()
      await loadPacks()
      await loadAssets('', false, [], false, false)
    })()
  }, [loadWs, loadTags, loadPacks, loadAssets])

  useEffect(() => {
    if (!wsLive) return
    if (view === 'packs') loadPacks()
    else loadAssets(keyword, unassignedOnly, selectedTagIds, missingOnly, currentOnly)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, unassignedOnly, missingOnly, currentOnly, wsLive])

  useEffect(() => {
    if (!wsLive || view !== 'files') return
    const t = setTimeout(
      () => loadAssets(keyword, unassignedOnly, selectedTagIds, missingOnly, currentOnly),
      220
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, wsLive])

  // 标签勾选变化：左侧筛选立即生效
  // 第 7 批修正：这个 effect 以前把 wsLive 也放进了依赖数组 —— 工作区一连上就被顺带触发，
  // `setView('files')` 跟着执行，结果软件每次启动都落在文件视图，包视图（主视图）得手点
  // （第 4 批引入，界面验证壳第 7 批才抓到）。现在只在「标签真的变了」时才切视图；
  // wsLive 翻转只负责把当前筛选的素材重载一遍。
  const prevTagIdsRef = useRef<number[]>([])
  useEffect(() => {
    if (!wsLive) return
    const prev = prevTagIdsRef.current
    const tagChanged =
      prev.length !== selectedTagIds.length ||
      prev.some((t, i) => t !== selectedTagIds[i])
    prevTagIdsRef.current = selectedTagIds
    if (tagChanged && view !== 'files') setView('files')
    loadAssets(keyword, unassignedOnly, selectedTagIds, missingOnly, currentOnly)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTagIds, wsLive])

  // 第 7 批补：切换项目 / 切到「待归类」时，标签后面的计数跟着重算。
  // 口径 = 当前项目范围，保证「标签数字」与「点开真列出几条」永远一致
  // （以前是全库口径，选了项目后数字对不上）。
  useEffect(() => {
    if (!wsLive) return
    void loadTags(tagScope(projectFilter))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, wsLive])

  // 第 9 批（M6）：「未归属」的文件本来就不属于任何一稿，两个筛选叠起来必定是空的
  // —— 切到未归属视图时自动把「只看当前稿」关掉，别让用户对着空列表猜。
  useEffect(() => {
    if (unassignedOnly && currentOnly) setCurrentOnly(false)
  }, [unassignedOnly, currentOnly])

  const reloadAll = useCallback(async (): Promise<void> => {
    const i = await loadWs()
    if (!i.workspaceOk) return
    await loadTags(tagScope(projectFilter))
    await loadPacks()
    await loadAssets(keyword, unassignedOnly, selectedTagIds, missingOnly, currentOnly)
  }, [
    loadWs,
    loadTags,
    loadPacks,
    loadAssets,
    keyword,
    unassignedOnly,
    selectedTagIds,
    missingOnly,
    currentOnly,
    projectFilter
  ])

  /**
   * 第 8 批 M8-03：单条重新定位 —— 弹系统文件框，选完直接校验 + 落库。
   * 校验不过（文件名 / 大小对不上）就把原因原样告诉用户，别含糊其辞。
   */
  const doRelocate = async (assetId: number): Promise<void> => {
    const r = await window.api.relocateAsset(assetId)
    if (r.canceled) return
    if (!r.ok) {
      toast(r.error ?? '没能定位到文件', 'err')
      return
    }
    toast(`已找回：${r.relPath ?? ''}`, 'ok')
    await reloadAll()
  }

  // ---------------- 工作区不可用时的两个出口 ----------------

  /** 重试：丢掉缓存重新探测一次（插上移动硬盘后用） */
  const doRetryWorkspace = async (): Promise<void> => {
    const i = await loadWs(true)
    if (!i.workspaceOk) {
      toast('还是连不上，检查一下磁盘或移动硬盘', 'err')
      return
    }
    await loadTags(tagScope(projectFilter))
    await loadPacks()
    setUnassignedOnly(false)
    setMissingOnly(false)
    await loadAssets('', false, [], false)
    toast('工作区已恢复', 'ok')
  }

  /** 更改位置：选一个新目录当工作区（选到已有素材的旧工作区，数据会直接读出来） */
  const doPickRoot = async (): Promise<void> => {
    try {
      const r = await window.api.wsPickRoot()
      if (r.canceled) return
      if (!r.ok) {
        toast(r.error || '没能切换工作区', 'err')
        return
      }
      await reloadAll()
      toast(`工作区已切到：${r.workspaceRoot}`, 'ok')
    } catch (e) {
      toast('切换工作区失败：' + (e as Error).message, 'err')
    }
  }

  // ---------------- 第 5 批：多工作区（A1）与搬移（B2）----------------

  /**
   * 切换工作区。
   * 切的是**另一个库**，所以必须整套重载；筛选状态也一并清掉 ——
   * 标签 id 是各库独立的，带着上一个库的 id 去查新库只会查出空。
   */
  const doSwitchWs = async (id: string): Promise<void> => {
    try {
      const r = await window.api.wsSwitch(id)
      if (!r.ok) {
        toast(r.error || '切换工作区失败', 'err')
        return
      }
      setSelectedTagIds([])
      setSelected(new Set())
      setKeyword('')
      setUnassignedOnly(false)
      await reloadAll()
      toast(`已切到工作区「${r.name ?? ''}」`, 'ok')
    } catch (e) {
      toast('切换工作区失败：' + (e as Error).message, 'err')
    }
  }

  /** 添加工作区：空文件夹就新建、有库就登记；搬过来的库会先问要不要改路径 */
  const doAddWs = async (): Promise<void> => {
    try {
      const r = await window.api.wsAdd()
      if (r.canceled) return
      if (!r.ok) {
        toast(r.error || '添加工作区失败', 'err')
        return
      }
      setSelectedTagIds([])
      setSelected(new Set())
      await reloadAll()
      if (r.rewritten) {
        toast(`已切过去，并把 ${r.rewritten} 条记录的位置改好了`, 'ok')
      } else {
        toast(`工作区已添加：${r.workspaceRoot}`, 'ok')
      }
      if (r.missing && r.missing > 0) {
        toast(`另有 ${r.missing} 个文件在磁盘上找不到（只影响预览）`, 'info')
      }
    } catch (e) {
      toast('添加工作区失败：' + (e as Error).message, 'err')
    }
  }

  /** 从列表移除工作区 —— 只是去掉记录，磁盘上的东西一个都不动 */
  const doRemoveWs = async (w: WorkspaceEntry): Promise<void> => {
    const yes = window.confirm(
      `把工作区「${w.name}」从列表里去掉？\n\n` +
        `只是从软件列表里去掉，磁盘上的文件夹和素材一个字节都不会动：\n${w.root}\n\n` +
        `以后想用回来，点「＋ 添加工作区」选它就行。`
    )
    if (!yes) return
    try {
      const r = await window.api.wsRemove(w.id)
      if (!r.ok) {
        toast(r.error || '移除失败', 'err')
        return
      }
      await reloadAll()
      toast('已从列表移除（磁盘上的文件没动）', 'ok')
    } catch (e) {
      toast('移除失败：' + (e as Error).message, 'err')
    }
  }

  /** 搬移当前工作区：同盘瞬间完成；跨盘软件不搬，会弹出做法说明 */
  const doMoveWs = async (): Promise<void> => {
    const cur = (info?.workspaces ?? []).find((w) => w.id === info?.activeId)
    if (!cur) return

    const yes = window.confirm(
      `把工作区「${cur.name}」搬到别的位置？\n\n` +
        `当前：${cur.root}\n\n` +
        `下一步让你选一个目标文件夹，软件会把整个工作区搬过去。\n` +
        `同一个磁盘内是瞬间完成的（不是重新复制）。\n\n` +
        `搬完后原位置不再保留副本。`
    )
    if (!yes) return

    try {
      const r = await window.api.wsMove()
      if (r.canceled) return
      if (!r.ok) {
        // 跨盘时主进程已经弹出引导说明，这里不重复报错
        if (!r.crossDisk) toast(r.error || '搬移失败', 'err')
        return
      }
      await reloadAll()
      toast(`已搬到：${r.to}`, 'ok')
      if (r.missing && r.missing > 0) {
        toast(`另有 ${r.missing} 个文件在磁盘上找不到（只影响预览）`, 'info')
      }
    } catch (e) {
      toast('搬移失败：' + (e as Error).message, 'err')
    }
  }

  /**
   * 工作区连不上时，把「会碰文件/数据库」的动作拦下，给一句人话而不是 ENOTDIR 天书。
   * 只拦这两个顶栏按钮 —— 其余动作（认领、打标签等）在没有素材时本来就点不到。
   */
  const requireWs = (): boolean => {
    if (info?.workspaceOk) return true
    toast('素材工作区当前连不上，先点上方提示条里的「重试」或「更改位置」', 'err')
    return false
  }

  // ---------------- A-10 刷新扫描 ----------------

  const doRefresh = async (): Promise<void> => {
    if (!requireWs()) return
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
      // 第 7 批 ①：磁盘上已经没有的包，记录也摘掉了（信息留在 _system/backup）
      if (r.cleanedPacks) {
        toast(
          `已清理 ${r.cleanedPacks} 条失效的包记录（文件本来就不在了，清单留存在 _system/backup）`,
          'info'
        )
      }
      // 第 9 批（M6）：自动认出的稿 + 编号冲突
      if (r.newVersions) {
        toast(`认出了 ${r.newVersions} 个新的版本文件夹（V1/V2 这种名字）`, 'ok')
      }
      for (const c of r.versionConflicts ?? []) toast(c, 'err')
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
    if (!requireWs()) return
    try {
      const r = await window.api.createPack(v)
      if (!r.ok) {
        // 出错时**不关弹窗**，让用户能改选项目或改名再来一次
        toast(r.error ?? '创建失败', 'err')
        return
      }
      setShowNew(false)
      await reloadAll()
      toast(`包「${r.pack?.name ?? v.name}」已创建，文件夹已建好`, 'ok')
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
      const renamed = (r as { renamed?: { from: string; to: string } }).renamed
      toast(
        editingProject
          ? renamed
            ? '项目已改名，工作区里的文件夹也跟着改了（文件都还在）'
            : `项目「${v.name}」已保存`
          : `项目「${v.name}」已创建，工作区里建好了同名文件夹`,
        'ok'
      )
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
    toTrash?: boolean
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
      if (action.toTrash) {
        toast(
          `项目「${name}」已删进回收站：软件里不再显示，${r.deletedPacks ?? 0} 个包的文件夹原封不动躺在 _回收站 里`,
          'info'
        )
      } else {
        toast(
          n > 0
            ? `项目「${name}」已删除，${r.moved} 个包已${action.moveTo !== null ? '转移' : '变为待归类'}`
            : `项目「${name}」已删除`,
          'ok'
        )
      }
    }
    return r
  }

  // ---------------- 第 7 批 ②③：包信息编辑 / 待归类归位 ----------------

  /**
   * 保存包信息。改名 ⇒ 文件夹改名；改项目 ⇒ 文件夹搬家；只改类别 ⇒ 不碰磁盘。
   * 待归类的包在这里选项目，就是「归位」。
   */
  const submitPackEdit = async (
    patch: UpdatePackPatch
  ): Promise<{ ok: boolean; error?: string }> => {
    if (editingPackId === null) return { ok: false, error: '没有待编辑的包' }
    try {
      const r = await window.api.updatePack(editingPackId, patch)
      if (!r.ok) return { ok: false, error: r.error }
      setEditingPackId(null)
      setDetailTick((t) => t + 1)
      await reloadAll()
      toast(
        r.moved
          ? '已保存，文件夹也跟着改名 / 搬家了（文件一个没动）'
          : '已保存（只改了信息，磁盘上的文件夹没动）',
        'ok'
      )
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---------------- 第 7 批 ④：解绑 / 还原 ----------------

  /** 解绑项目：结项留底 —— 软件里不显示，本地文件全保留 */
  const doUnbind = async (p: ProjectWithCount): Promise<void> => {
    const yes = window.confirm(
      `解绑项目「${p.name}」？\n\n` +
        `· 软件里（包括包视图、文件视图、统计）不再显示它\n` +
        `· 项目文件夹会搬到工作区的「_已解绑的项目」里，文件一个不少\n` +
        `· 想回来时在左栏「已解绑」入口点一下就能还原\n\n` +
        `确认解绑？`
    )
    if (!yes) return
    try {
      const r = await window.api.unbindProject(p.id)
      if (!r.ok) {
        toast(r.error || '解绑失败', 'err')
        return
      }
      if (projectFilter === p.id) setProjectFilter('全部')
      await reloadAll()
      toast(
        `项目「${p.name}」已解绑，${r.packs} 个包跟着搬进 _已解绑的项目（文件都在）`,
        'ok'
      )
    } catch (e) {
      toast('解绑失败：' + (e as Error).message, 'err')
    }
  }

  /** 还原已解绑的项目：文件夹搬回工作区，左栏重新出现 */
  const doRestoreUnbound = async (
    p: UnboundProject
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await window.api.restoreProject(p.id)
      if (!r.ok) return { ok: false, error: r.error }
      await reloadAll()
      toast(`项目「${p.name}」已还原，文件都还在`, 'ok')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
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
    if (tagDimensions.length === 0) await loadTags(tagScope(projectFilter))
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
    if (r.ok) await loadAssets(keyword, unassignedOnly, selectedTagIds, missingOnly, currentOnly)
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

  /** 第 7 批：正在编辑信息的包（从 packs 里现取，保证弹窗里是最新数据） */
  const editingPack = useMemo(
    () => (editingPackId === null ? null : (packs.find((p) => p.id === editingPackId) ?? null)),
    [packs, editingPackId]
  )

  const knownProjectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects])

  /** 是否存在没挂项目的包（删项目选「变成未归属」后会出现）——只判有无，不显示个数 */
  const hasNoProjectPacks = useMemo(
    () => packs.some((p) => p.project_id === null || !knownProjectIds.has(p.project_id)),
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
    if (projectFilter === '全部') return '全部'
    if (projectFilter === null) return '待归类'
    const p = projects.find((x) => x.id === projectFilter)
    return p ? p.name : ''
  }, [projectFilter, projects])

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
          {/* 第 3 批：维度式标签筛选；第 7 批起标签计数跟随当前项目范围 */}
          <TagPanel
            dimensions={tagDimensions}
            selected={selectedTagIds}
            onChange={setSelectedTagIds}
            scopeLabel={currentProjectLabel}
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
                  title={[
                    p.note || p.name,
                    info?.workspaceRoot && p.folder_name
                      ? `磁盘位置：${info.workspaceRoot}\\${p.folder_name}`
                      : ''
                  ]
                    .filter(Boolean)
                    .join('\n')}
                >
                  <span className="proj-label">
                    <i className="cdot" style={{ background: p.color }} />
                    <span className="pname">{p.name}</span>
                  </span>
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
                      className="mini"
                      title="解绑项目（结项留底：软件里不显示，本地文件全保留）"
                      onClick={(e) => {
                        e.stopPropagation()
                        void doUnbind(p)
                      }}
                    >
                      📤
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

          {hasNoProjectPacks && (
            <button
              className={`item${projectFilter === null ? ' on' : ''}`}
              onClick={() => setProjectFilter(null)}
              title="这些包的文件夹直接躺在工作区根目录，还没选项目 —— 点包卡片右上角的 📥 就能归位"
            >
              <span>待归类</span>
            </button>
          )}

          {/* 第 7 批：已解绑的项目入口（只在有解绑项目时出现） */}
          {(info?.unboundProjects?.length ?? 0) > 0 && (
            <button
              className="item unbound-entry"
              onClick={() => setShowUnbound(true)}
              title="结项留底的项目：软件里不显示，本地文件全在 _已解绑的项目 里，可一键还原"
            >
              <span>📦 已解绑 {info?.unboundProjects?.length} 个项目</span>
            </button>
          )}

          <div className="divider" />

          <h4>筛选</h4>
          <button
            className={`item${view === 'files' && unassignedOnly && !missingOnly ? ' on' : ''}`}
            onClick={() => {
              setView('files')
              setUnassignedOnly(true)
              setMissingOnly(false)
            }}
          >
            <span>📥 未归属</span>
            <span className="n">{stats.unassigned}</span>
          </button>
          {/* 第 8 批：文件已丢失（M8-03）—— 记录不删，只是原文件找不到了，可重新定位 */}
          {stats.missing > 0 && (
            <button
              className={`item miss-entry${view === 'files' && missingOnly ? ' on' : ''}`}
              onClick={() => {
                setView('files')
                setUnassignedOnly(false)
                setMissingOnly(true)
              }}
              title="这些素材的原文件被删除或挪走了。软件不会因此删掉记录 —— 点行尾的 🔍 指到文件的新位置就能找回来"
            >
              <span>⚠️ 文件已丢失</span>
              <span className="n">{stats.missing}</span>
            </button>
          )}
          <button
            className={`item${view === 'files' && !unassignedOnly && !missingOnly ? ' on' : ''}`}
            onClick={() => {
              setView('files')
              setUnassignedOnly(false)
              setMissingOnly(false)
            }}
          >
            <span>全部文件</span>
            <span className="n">{stats.files}</span>
          </button>

          <div className="divider" />

          <h4>工作区</h4>
          {(info?.workspaces ?? []).map((w) => {
            const isActive = w.id === info?.activeId
            return (
              <div
                key={w.id}
                className={`wsitem${isActive ? ' on' : ''}`}
                onClick={() => {
                  if (!isActive) void doSwitchWs(w.id)
                }}
                title={isActive ? w.root : `${w.root}\n点一下切到这个工作区`}
              >
                <div className="wrow">
                  <span className="wname">
                    {isActive ? '📁' : '🗂'} {w.name}
                  </span>
                  {isActive ? (
                    <span className="wtag">当前</span>
                  ) : (
                    <button
                      className="wx"
                      title="从列表移除（只去掉记录，磁盘上的文件一个字节都不动）"
                      onClick={(e) => {
                        e.stopPropagation()
                        void doRemoveWs(w)
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="wpath">{w.root}</div>
                {isActive && (
                  <div className="wacts">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.api.wsOpenRoot()
                      }}
                    >
                      打开文件夹
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void doMoveWs()
                      }}
                    >
                      搬移位置
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          <button
            className="item addws"
            onClick={() => void doAddWs()}
            title="选一个文件夹作为工作区：空的就新建，有素材库的直接接进来"
          >
            <span>＋ 添加工作区</span>
          </button>
        </div>

        {/* 左栏宽度拖拽条：按住左右拖，双击复位 */}
        <div
          className={`side-resizer${resizing ? ' dragging' : ''}`}
          title="拖动调整左栏宽度，双击恢复默认"
          onMouseDown={startResize}
          onDoubleClick={resetSideWidth}
        />

        <div className="main">
          {info && !info.workspaceOk && (
            <div className="wsbanner">
              <span className="ico">⚠</span>
              <div className="txt">
                <div className="t">
                  工作区「{activeWs?.name ?? '未知'}」连不上，里面的东西一件没动
                </div>
                <div className="s">
                  {info.workspaceRoot}
                  {info.workspaceNote ? ` —— ${info.workspaceNote}` : ''}
                </div>
              </div>
              <button className="btn" onClick={doRetryWorkspace}>
                重试
              </button>
              <button className="btn primary" onClick={doPickRoot}>
                更改位置
              </button>
            </div>
          )}

          {info?.workspaceOk && layoutNotice && (
            <div className="wsbanner info">
              <span className="ico">🗂</span>
              <div className="txt">
                <div className="t">目录结构已升级：工作区 / 项目 / 包</div>
                <div className="s">
                  {layoutNotice.packs} 个包已归入各自的项目文件夹，文件一个没动
                  {info.workspaceRoot ? ` —— 位置：${info.workspaceRoot}` : ''}
                </div>
              </div>
              <button className="btn" onClick={dismissLayoutNotice}>
                知道了
              </button>
            </div>
          )}
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
                    <PackCard
                      key={p.id}
                      pack={p}
                      onOpen={() => setOpenPackId(p.id)}
                      onEdit={() => setEditingPackId(p.id)}
                    />
                  ))}
                </div>
              )
            ) : shownAssets.length === 0 ? (
              <div className="empty">
                <div className="big">{unassignedOnly ? '📥' : missingOnly ? '✅' : '🔍'}</div>
                <div className="t">
                  {unassignedOnly
                    ? '未归属池是空的'
                    : missingOnly
                      ? '没有文件丢失，全都在'
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
                  {/* 第 9 批（M6）：文件视图默认全显示（铁则：不藏用户的东西），
                      打开这个开关只留各包「当前版本」那一稿的文件 */}
                  <label
                    className="cur-only"
                    title="只显示各包「当前版本」那一稿的文件；未分版本的老文件也会被过滤掉"
                  >
                    <input
                      type="checkbox"
                      checked={currentOnly}
                      onChange={(e) => setCurrentOnly(e.target.checked)}
                    />
                    只看当前稿
                  </label>
                  {/* 第 8 批：一批文件被整体挪走时的批量找回入口 */}
                  {stats.missing > 0 && (
                    <button
                      className="btn"
                      style={{ marginLeft: 'auto', padding: '2px 10px' }}
                      onClick={() => setShowRelocate(true)}
                      title="一批文件被整体挪走了？选它现在所在的文件夹，软件按原目录结构替你先配一遍，你确认后才改"
                    >
                      🔍 批量重新定位{missingOnly ? `（共 ${stats.missing} 条丢失）` : ''}
                    </button>
                  )}
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
                    onRelocate={() => void doRelocate(a.id)}
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
                {stats.missing > 0 && (
                  <span style={{ color: 'var(--warn)' }}>其中 {stats.missing} 条文件已丢失</span>
                )}
              </>
            ) : (
              <>
                <span>
                  共 {shownAssets.length} 条素材
                  {unassignedOnly ? '（未归属）' : ''}
                  {missingOnly ? '（文件已丢失）' : ''}
                  {currentOnly ? '（只看当前稿）' : ''}
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
              工作区{' '}
              <span className="path">
                {activeWs ? `${activeWs.name}（${activeWs.root}）` : info?.workspaceRoot}
              </span>
              <span style={{ margin: '0 8px', opacity: 0.4 }}>|</span>
              <span title="软件版本号（出处：package.json 的 version）">
                v{info?.appVersion ?? '—'}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* 弹窗 */}
      {showNew && info && (
        <NewPackModal
          projects={projects}
          categories={categoryOptions}
          onClose={() => setShowNew(false)}
          onSubmit={doCreatePack}
        />
      )}

      {openPackId !== null && info && (
        <PackDetailModal
          key={`${String(openPackId)}-${detailTick}`}
          packId={openPackId}
          subFolders={info.subFolders}
          onClose={() => setOpenPackId(null)}
          onChanged={reloadAll}
          onEdit={
            typeof openPackId === 'number' && packs.some((p) => p.id === openPackId)
              ? () => setEditingPackId(openPackId)
              : undefined
          }
          toast={toast}
        />
      )}

      {/* 第 7 批 ②③：包信息编辑 / 待归类归位 */}
      {editingPack && info && (
        <EditPackModal
          pack={editingPack}
          projects={projects}
          categories={categoryOptions}
          onClose={() => setEditingPackId(null)}
          onSubmit={submitPackEdit}
        />
      )}

      {/* 第 7 批 ④：已解绑的项目 */}
      {showUnbound && info && (
        <UnboundProjectsModal
          projects={info.unboundProjects ?? []}
          workspaceRoot={info.workspaceRoot}
          onClose={() => setShowUnbound(false)}
          onRestore={doRestoreUnbound}
        />
      )}

      {/* 第 8 批：批量重新定位（M8-03） */}
      {showRelocate && (
        <RelocateModal
          onClose={() => setShowRelocate(false)}
          onDone={async () => {
            await reloadAll()
          }}
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
          scopeLabel={currentProjectLabel}
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
