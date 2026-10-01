import { COPY, fmt } from '../shared/copy'
import { ipcMain, shell, app, dialog } from 'electron'
import { join, basename } from 'path'
import { existsSync } from 'fs'
import { openDb } from './db'
import {
  createPack,
  scanAll,
  claimFiles,
  listPacks,
  listAssets,
  getPackDetail,
  countUnassigned,
  getWorkspaceRoot,
  getWorkspaceState,
  resetWorkspaceState,
  initWorkspace,
  listWorkspaces,
  addWorkspace,
  switchWorkspace,
  removeWorkspace,
  migrateWorkspaceSameDisk,
  listProjectsWithCount,
  createProject,
  updateProject,
  removeProject,
  moveProject,
  readLayoutNotice,
  ackLayoutNotice,
  // 第 7 批：记录生命周期（docs/09）
  updatePack,
  unbindProject,
  restoreProject,
  listUnboundProjects,
  assetTotals,
  countMissing,
  relocateAsset,
  suggestRelocateBatch,
  applyRelocateBatch,
  SUB_FOLDERS,
  type SubFolder,
  // 第 9 批：版本管理（M6，docs/11）
  listVersions,
  listVersionMap,
  createVersion,
  listBindableFolders,
  bindVersion,
  unbindVersion,
  setCurrentVersion,
  type CreateVersionInput,
  type BindVersionInput
} from './workspace'
import {
  ensureThumbsForAssets,
  ensureImageMetaForAssets,
  ensureVideoMetaForAssets,
  ensurePsdMetaForAssets,
  ensurePdfMetaForAssets,
  readAsDataUrl,
  isImage
} from './thumbs'
import { PROJECT_COLORS, getDb, setMeta } from './db'
import {
  listTagDimensions,
  createTag,
  updateTag,
  removeTag,
  tagUsage,
  applyTags,
  removeTagsFrom,
  tagsOfAssets,
  suggestTagsForAssets
} from './tags'
// 第 13 批：工单（docs/15）—— 引擎在 tickets.ts，企微适配在 ticketsWecom.ts
import {
  applySync,
  confirmPendingTickets,
  createTaskForTicketManually,
  detectStructure,
  META_KEYS,
  readTicketConfig,
  writeTicketSheets,
  type SheetPayload,
  type TicketSheetConfig
} from './tickets'
import { extractDocid, fetchIdentity, fetchSheetRecords, fetchSheets } from './ticketsWecom'
// 第 15 批：交付打包（M5，docs/18）
import { executePackExport, listDeliveryRecords } from './exportPack'
import type { PackExportInput, PackExportResult } from '../shared/types'

/**
 * 主进程 / 界面的全部通信接口。
 * 约定：一律 ipcMain.handle + contextBridge（方案 6.1），不用 ipcRenderer.send。
 */

export function registerIpc(): void {
  const appData = app.getPath('userData')
  const documentsDir = app.getPath('documents')

  // ---------- 工作区 ----------
  /**
   * 工作区信息。这里要区分两种「不可用」（方案 06 第 6 节）：
   * - 首次启动、还没有任何配置 → 已在 resolveWorkspace 里自动择址，正常情况必然可用
   * - 已有配置但位置连不上（移动硬盘拔了 / 盘符没了）→ 绝不偷偷换位置，只如实报告 + 界面给提示
   */
  ipcMain.handle('ws:info', (_e, opts?: { refresh?: boolean }) => {
    // refresh 用于「插上移动硬盘后重试」：丢掉缓存重新探测一次
    if (opts?.refresh) resetWorkspaceState()
    const st = getWorkspaceState(appData, documentsDir)
    const ws = listWorkspaces(appData)
    const base = {
      workspaceRoot: st.root,
      workspaceOk: st.ok,
      workspaceNote: st.note,
      appVersion: app.getVersion(),
      // 工作区列表即使当前位置连不上也要照常返回 —— 界面得让用户能切到别的库去
      workspaces: ws.workspaces,
      activeId: ws.activeId,
      projectColors: [...PROJECT_COLORS],
      // 第 10 批：这里原来返回一份写死的 `categories` 给建包弹窗用。
      // 已删 —— 类别清单现在由渲染层从标签维度「物料类别」派生（tagDimensions），
      // 保证「左栏能加什么、建包就能选什么」，也免掉两个数据源再次跑偏。
      subFolders: [...SUB_FOLDERS]
    }
    if (!st.ok) {
      // 工作区不可用时数据库根本打不开，直接返回空数据交给界面提示，
      // 不让异常冒到渲染进程控制台
      return { ...base, projects: [], unassigned: 0, unboundProjects: [], missing: 0 }
    }
    initWorkspace(st.root)
    return {
      ...base,
      projects: listProjectsWithCount(),
      unassigned: countUnassigned(),
      // 第 7 批：已解绑的项目（左栏「已解绑 N 个项目」入口用）
      unboundProjects: listUnboundProjects(),
      // 第 8 批：文件已丢失的条数（左栏「⚠️ 文件已丢失」入口用）
      missing: countMissing(),
      // 第 6 批：刚把目录结构升级过的话告诉界面（只提示一次，界面 ack 后不再出现）
      layoutMigrated: readLayoutNotice() ?? undefined
    }
  })

  /** 界面已经提示过目录结构升级了 → 清掉标记，保证提示条只出现一次 */
  ipcMain.handle('ws:ackLayout', () => {
    ackLayoutNotice()
  })

  // ---------- 项目维护 ----------
  ipcMain.handle('project:list', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return listProjectsWithCount()
  })

  ipcMain.handle('project:create', (_e, input: { name: string; color?: string; note?: string }) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    // 第 6 批：顺手在磁盘上建出项目文件夹，界面上的项目与本地文件夹一一对应
    return createProject({ ...input, workspaceRoot: root })
  })

  ipcMain.handle(
    'project:update',
    (_e, args: { id: number; patch: { name?: string; color?: string; note?: string } }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      // 第 6 批：改名会连带把磁盘上的项目文件夹一起改名（并重写库里的路径）
      return updateProject(args.id, args.patch, root)
    }
  )

  ipcMain.handle(
    'project:remove',
    (_e, args: { id: number; moveTo: number | null; toTrash?: boolean }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      // 第 6 批：包文件夹跟着走 —— 转移项目就搬进目标项目文件夹，
      // 变未归属就搬到工作区根目录（界面上的「待归类」）
      // 第 7 批：toTrash = 整个项目文件夹搬进 _回收站，记录删掉，文件一个不少
      return removeProject(args.id, { moveTo: args.moveTo, toTrash: args.toTrash }, root)
    }
  )

  // 第 7 批 ④：解绑（结项留底，软件里不显示、本地全保留）/ 还原
  ipcMain.handle('project:unbind', (_e, id: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return unbindProject(id, root)
  })

  ipcMain.handle('project:restore', (_e, id: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return restoreProject(id, root)
  })

  // 第 7 批 ②③：改包信息（名称 / 类别 / 所属项目）—— 改项目 = 搬文件夹
  ipcMain.handle(
    'pack:update',
    (_e, args: { id: number; patch: { name?: string; category?: string; projectId?: number | null } }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      try {
        return updatePack(args.id, args.patch, root)
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  // 调整项目在左栏的显示顺序（上移 / 下移一位）
  ipcMain.handle('project:move', (_e, args: { id: number; direction: 'up' | 'down' }) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return moveProject(args.id, args.direction)
  })

  /**
   * 添加 / 切换工作区的公共流程：先给目录做体检，
   * 若里面是一个「搬过来的库」就把话说清楚再让用户点头。
   */
  async function addWorkspaceFlow(
    root: string,
    forceRewrite = false
  ): Promise<{
    ok: boolean
    canceled?: boolean
    needsConfirm?: boolean
    oldRoot?: string
    rewritten?: number
    missing?: number
    backupPath?: string | null
    workspaceRoot?: string
    error?: string
  }> {
    const first = addWorkspace(appData, root, { rewrite: forceRewrite })

    if (first.ok) {
      return {
        ok: true,
        workspaceRoot: first.entry?.root ?? root,
        rewritten: first.migrated?.assets,
        missing: first.migrated?.missing,
        backupPath: first.migrated?.backupPath ?? null
      }
    }
    if (!first.needsConfirm) {
      return { ok: false, error: first.error }
    }

    const box = await dialog.showMessageBox({
      type: 'question',
      buttons: [COPY.ipc.relocateBtn, COPY.common.cancel],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: COPY.ipc.movedLibTitle,
      message: COPY.ipc.movedLibMsg,
      detail:
        fmt(COPY.ipc.movedLibOld, { old: first.oldRoot }) +
        fmt(COPY.ipc.movedLibNew, { root: root }) +
        COPY.ipc.movedLibNoteA +
        COPY.ipc.movedLibNoteB
    })
    if (box.response !== 0) return { ok: false, canceled: true }

    const second = addWorkspace(appData, root, { rewrite: true })
    if (!second.ok) return { ok: false, error: second.error || COPY.ipc.rewriteFailed }
    return {
      ok: true,
      workspaceRoot: second.entry?.root ?? root,
      rewritten: second.migrated?.assets,
      missing: second.migrated?.missing,
      backupPath: second.migrated?.backupPath ?? null
    }
  }

  /**
   * 把某个绝对路径设为当前工作区（第 1 批就有的老接口，无界面调用，保留兼容）。
   *
   * 第 5 批起统一走 addWorkspace，它按四步执行：
   *   closeDb() → 写 activeId → resetWorkspaceState() → initWorkspace(新根)
   * 老版本这里漏了关数据库（closeDb 全项目从未被调用），切换后进程内仍读写旧库 —— 已修。
   */
  ipcMain.handle('ws:setRoot', (_e, root: string) => {
    if (!root) return { ok: false, workspaceRoot: root, error: COPY.ipc.pathEmpty }
    const r = addWorkspace(appData, root, { rewrite: true })
    if (!r.ok) return { ok: false, workspaceRoot: root, error: r.error || COPY.ipc.switchFailed }
    return { ok: true, workspaceRoot: r.entry?.root ?? root }
  })

  /**
   * 「更改位置」：弹系统选目录对话框，选中后切过去。
   * 选到一个已经有素材的旧工作区目录时，原来的包 / 标签 / 登记信息会直接读出来
   * （媒体库就存在该目录的 `_system/media.db` 里）——
   * 这就是需求文档 M8-05「换电脑或换盘后指过去即恢复，无需重新登记」。
   */
  ipcMain.handle('ws:pickRoot', async () => {
    const r = await dialog.showOpenDialog({
      title: COPY.ipc.pickWsTitle,
      buttonLabel: COPY.ipc.useHere,
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true }
    return addWorkspaceFlow(r.filePaths[0])
  })

  // ---------------- 第 5 批：工作区管理与迁移（方案 07）----------------
  ipcMain.handle('ws:list', () => listWorkspaces(appData))

  ipcMain.handle('ws:add', async (_e, opts?: { root?: string; rewrite?: boolean }) => {
    let root = opts?.root
    if (!root) {
      const r = await dialog.showOpenDialog({
        title: COPY.ipc.addWsTitle,
        buttonLabel: COPY.ipc.useThisFolder,
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true }
      root = r.filePaths[0]
    }
    return addWorkspaceFlow(root, opts?.rewrite === true)
  })

  ipcMain.handle('ws:switch', (_e, id: string) => {
    const r = switchWorkspace(appData, id)
    return r.ok
      ? { ok: true, workspaceRoot: r.root, name: r.name }
      : { ok: false, error: r.error }
  })

  // 只删配置里的一条记录，磁盘上一个字节都不动
  ipcMain.handle('ws:remove', (_e, id: string) => removeWorkspace(appData, id))

  ipcMain.handle('ws:move', async (_e, opts?: { targetParentDir?: string }) => {
    let parent = opts?.targetParentDir
    if (!parent) {
      const r = await dialog.showOpenDialog({
        title: COPY.ipc.moveWsTitle,
        buttonLabel: COPY.ipc.moveHere,
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true }
      parent = r.filePaths[0]
    }

    const res = migrateWorkspaceSameDisk(appData, parent)

    if (!res.ok && res.crossDisk) {
      // 跨盘不做软件内复制（方案 07 第 10 节）：给出能照着做的引导
      await dialog.showMessageBox({
        type: 'info',
        buttons: [COPY.common.know],
        noLink: true,
        title: COPY.ipc.crossDiskTitle,
        message: COPY.ipc.crossDiskMsg,
        detail:
          COPY.ipc.crossDiskNoteA +
          fmt(COPY.ipc.crossDiskNote1, { folder: basename(res.from || '') }) +
          COPY.ipc.crossDiskNote2 +
          COPY.ipc.crossDiskNote3 +
          COPY.ipc.crossDiskNote4
      })
    }
    return res
  })

  ipcMain.handle('ws:openRoot', async () => {
    const root = getWorkspaceRoot(appData)
    if (!existsSync(root)) return { ok: false, error: COPY.ipc.wsDirMissing }
    const err = await shell.openPath(root)
    return err ? { ok: false, error: err } : { ok: true }
  })

  // ---------- A-01 建包 ----------
  ipcMain.handle(
    'pack:create',
    (_e, input: { name?: string; projectId?: number | null; category?: string }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      // 第 6 批：项目缺失时 createPack 会抛错，转成 {ok:false,error} 交给界面显示，
      // 不让异常以 rejected promise 的形式冒到控制台
      try {
        const pack = createPack({ ...input, workspaceRoot: root })
        return { ok: true, pack }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  // ---------- A-10 刷新扫描 ----------
  ipcMain.handle('scan:refresh', async (e) => {
    const root = getWorkspaceRoot(appData)

    /**
     * 第 14 批：刷新扫描的进度推送。
     * 这是全项目**第一条主 → 渲染的推送通道**（此前只有 invoke 请求-应答）。
     * 为什么必须有它：整条链路（扫描 → 缩略图 → 四类元信息）在一个 IPC 里跑完，
     * 大库 + 视频多时用户要干等好几分钟，界面只有一个转圈按钮，不知道跑到哪了。
     * 推送用 `sender.send` 回到发起这次刷新的那个窗口，别广播到别的窗口。
     */
    const push = (stage: 'scan' | 'thumbs' | 'meta', label: string, done: number, total: number): void => {
      if (e.sender.isDestroyed()) return
      e.sender.send('scan:progress', { stage, label, done, total })
    }

    push('scan', COPY.scan.progressScan, 0, 0) // 目录扫描是同步的，拿不到细粒度 → 0/0 表示"进行中"
    const result = scanAll(root)

    const db = openDb(root)
    const rows = db
      .prepare('SELECT id, abs_path, size, ext, thumb_path, modified_at FROM assets')
      .all() as Array<{
      id: number
      abs_path: string
      size: number
      ext: string
      thumb_path: string | null
      modified_at: string
    }>

    const thumbs = await ensureThumbsForAssets(root, rows, (done, total) =>
      push('thumbs', COPY.scan.progressThumbs, done, total)
    )

    // B-01：补图片尺寸 / 色彩模式（只处理还没有 width 的图片）
    const metaRows = db
      .prepare('SELECT id, abs_path, ext, width FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; width: number | null }>
    const metas = await ensureImageMetaForAssets(metaRows, (done, total) =>
      push('meta', COPY.scan.progressMetaImage, done, total)
    )

    // B-02：补视频时长 / 编码 / 尺寸（只处理还没有 duration_ms 的视频）
    const videoRows = db
      .prepare('SELECT id, abs_path, ext, duration_ms FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; duration_ms: number | null }>
    const videoMetas = await ensureVideoMetaForAssets(videoRows, (done, total) =>
      push('meta', COPY.scan.progressMetaVideo, done, total)
    )

    // B-04：补 PSD 画布尺寸 / 色彩模式（只处理还没有 width 的 psd/psb）
    const psdRows = db
      .prepare('SELECT id, abs_path, ext, width FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; width: number | null }>
    const psdMetas = await ensurePsdMetaForAssets(psdRows, (done, total) =>
      push('meta', COPY.scan.progressMetaPsd, done, total)
    )

    // B-03：补 PDF 页数（只处理还没有 probe_info 的 pdf）
    const pdfRows = db
      .prepare('SELECT id, abs_path, ext, probe_info FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; probe_info: string | null }>
    const pdfMetas = await ensurePdfMetaForAssets(pdfRows, (done, total) =>
      push('meta', COPY.scan.progressMetaPdf, done, total)
    )

    return { ...result, thumbs, metas, videoMetas, psdMetas, pdfMetas }
  })
  // ---------- A-06 包视图 ----------
  ipcMain.handle('view:packs', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const packs = listPacks()

    // 封面转 dataURL，避免渲染进程直接读磁盘
    const withCover = packs.map((p) => {
      let cover: string | null = null
      if (p.coverPath) {
        const abs = p.coverPath.startsWith('_thumbs')
          ? join(root, p.coverPath)
          : p.coverPath
        cover = readAsDataUrl(abs)
      }
      return { ...p, cover }
    })

    // 第 7 批：总条数 / 总容量走 assetTotals —— 解绑项目名下的素材不计入（用户拍板）
    // 第 8 批：口径改为「条数算上丢失的、容量不算」，并带出 missing 计数
    const stat = assetTotals()

    return {
      packs: withCover,
      total: {
        packs: packs.length,
        files: stat.count,
        size: stat.size,
        unassigned: countUnassigned(),
        missing: stat.missing
      }
    }
  })

  // ---------- A-07 文件视图 ----------
  ipcMain.handle(
    'view:assets',
    (
      _e,
      opts: {
        keyword?: string
        view?: 'all' | 'unassigned'
        packId?: number
        projectId?: number
        tagIds?: number[]
        filterProjectIds?: number[]
        withTags?: boolean
        /** 第 8 批：只看文件已丢失的 */
        missingOnly?: boolean
        /** 第 9 批：只看当前那一稿的文件 */
        currentOnly?: boolean
      }
    ) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      const o = opts ?? {}
      const rows = listAssets({
        keyword: o.keyword,
        view: o.view,
        packId: o.packId,
        projectId: o.projectId,
        tagIds: o.tagIds,
        filterProjectIds: o.filterProjectIds,
        missingOnly: o.missingOnly,
        currentOnly: o.currentOnly
      })
      // 第 3 批：需要标签时一并带出（列表色块展示）
      const tagMap = o.withTags || o.tagIds?.length ? tagsOfAssets(rows.map((r) => r.id)) : {}
      // 第 9 批：给每行带上"哪一稿 / 是不是当前"——文件视图没有"当前包"的上下文，统一在这儿补
      const vmap = new Map(listVersionMap().map((v) => [v.id, v]))
      const withThumb = rows.map((r) => {
        const v = r.version_id !== null ? vmap.get(r.version_id) : undefined
        return {
          ...r,
          versionSeq: v ? v.seq : null,
          versionCurrent: v ? v.is_current === 1 : false,
          // thumb_path 有值就直接读缩略图（图片 .webp / 视频 .jpg 都走这里）；
          // 没有缩略图且本身是图片才读原图 —— 视频原文件绝不直接读（太大）
          thumb:
            r.thumb_path
              ? readAsDataUrl(join(root, r.thumb_path))
              : isImage(r.ext)
                ? readAsDataUrl(r.abs_path)
                : null,
          tags: tagMap[r.id] ?? []
        }
      })
      return { items: withThumb, total: withThumb.length }
    }
  )

  // ---------- A-08 点开包 ----------
  ipcMain.handle('view:packDetail', (_e, packId: number) => {
    const root = getWorkspaceRoot(appData)
    const detail = getPackDetail(packId)
    const vmap = new Map(listVersionMap().map((v) => [v.id, v]))
    const withThumb: Record<string, unknown[]> = {}
    for (const [role, items] of Object.entries(detail.groups)) {
      withThumb[role] = items.map((r) => {
        const v = r.version_id !== null ? vmap.get(r.version_id) : undefined
        return {
          ...r,
          versionSeq: v ? v.seq : null,
          versionCurrent: v ? v.is_current === 1 : false,
          thumb:
            r.thumb_path
              ? readAsDataUrl(join(root, r.thumb_path))
              : isImage(r.ext)
                ? readAsDataUrl(r.abs_path)
                : null
        }
      })
    }
    return {
      pack: detail.pack,
      groups: withThumb,
      subFolders: [...SUB_FOLDERS],
      // 第 9 批（M6）：这一包的全部稿（界面画版本条、自己按 version_id 过滤）
      versions: detail.versions
    }
  })

  // ---------- 第 9 批：版本管理（M6，docs/11） ----------
  /** 某包的全部稿（含文件数 / 占用 / 文件夹是否还在） */
  ipcMain.handle('version:list', (_e, packId: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return listVersions(packId)
  })

  /** 新建一稿：建 `V<n>/` + 三组空文件夹（可选收编现有文件、可选复制上一稿） */
  ipcMain.handle('version:create', (_e, input: CreateVersionInput) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return createVersion(root, input)
  })

  /** 绑定候选：这个包文件夹下还没被认领的子文件夹 */
  ipcMain.handle('version:bindable', (_e, packId: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return listBindableFolders(packId)
  })

  /** 把用户自己建好的文件夹绑定成某一稿 */
  ipcMain.handle('version:bind', (_e, input: BindVersionInput) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return bindVersion(root, input)
  })

  /** 解绑：只解除管理关系，文件夹和文件一个都不动 */
  ipcMain.handle('version:unbind', (_e, versionId: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return unbindVersion(versionId)
  })

  /** 设为当前版本（= 回滚）：纯库操作，磁盘零改动 */
  ipcMain.handle('version:setCurrent', (_e, versionId: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return setCurrentVersion(versionId)
  })

  // ---------- A-09 认领 ----------
  ipcMain.handle(
    'asset:claim',
    (_e, args: { paths: string[]; packId: number; subFolder: SubFolder; versionId?: number | null }) => {
      const root = getWorkspaceRoot(appData)
      const res = claimFiles(root, args.paths, args.packId, args.subFolder, args.versionId)
      return { ok: res.errors.length === 0, ...res }
    }
  )

  // ---------- A-11 双击打开 ----------
  ipcMain.handle('file:open', async (_e, absPath: string) => {
    if (!existsSync(absPath)) return { ok: false, error: COPY.ipc.fileMissingColon + basename(absPath) }
    const err = await shell.openPath(absPath)
    return err ? { ok: false, error: err } : { ok: true }
  })

  ipcMain.handle('file:reveal', (_e, absPath: string) => {
    if (!existsSync(absPath)) return { ok: false, error: COPY.ipc.fileMissing }
    shell.showItemInFolder(absPath)
    return { ok: true }
  })

  ipcMain.handle('shell:openPath', async (_e, p: string) => {
    if (!existsSync(p)) return { ok: false, error: COPY.ipc.pathMissing }
    const err = await shell.openPath(p)
    return err ? { ok: false, error: err } : { ok: true }
  })

  // ---------- 第 8 批 M8-03：重新定位（文件被删/挪走之后把它找回来）----------
  /**
   * 单条：弹系统文件选择框 → 校验（文件名 + 扩展名 + 大小，用户拍板）→ 通过才落库。
   * 校验不过就把原因原样返回，界面照实说"哪儿对不上"。
   */
  ipcMain.handle('asset:relocate', async (_e, assetId: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const r = await dialog.showOpenDialog({
      title: COPY.ipc.findFileTitle,
      buttonLabel: COPY.ipc.thisOne,
      properties: ['openFile']
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true }
    return relocateAsset(assetId, r.filePaths[0], root)
  })

  /** 批量第一步：选一个目录（"整个文件夹被搬走了"的场景） */
  ipcMain.handle('asset:pickRelocateDir', async () => {
    const r = await dialog.showOpenDialog({
      title: COPY.ipc.findFilesTitle,
      buttonLabel: COPY.ipc.searchHere,
      properties: ['openDirectory']
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true }
    return { ok: true, dir: r.filePaths[0] }
  })

  /** 批量第二步：出候选清单（**只读**，不落库 —— 用户勾选前一个字节都不改） */
  ipcMain.handle('asset:relocateSuggest', (_e, dir: string) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return { ok: true, items: suggestRelocateBatch(dir, root) }
  })

  /** 批量第三步：用户勾选后才写 */
  ipcMain.handle(
    'asset:relocateApply',
    (_e, items: Array<{ assetId: number; newAbsPath: string }>) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      return applyRelocateBatch(items ?? [], root)
    }
  )

  // ---------- 第 3 批：标签体系（M2） ----------
  ipcMain.handle('tag:dimensions', (_e, scope?: { projectId?: number | null }) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    // 第 7 批补：标签计数跟随左栏当前项目范围（不传 = 全部）
    return listTagDimensions(scope)
  })

  ipcMain.handle(
    'tag:create',
    (_e, input: { dimension: string; name: string; color?: string }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      return createTag(input)
    }
  )

  ipcMain.handle(
    'tag:update',
    (_e, args: { id: number; patch: { name?: string; color?: string } }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      return updateTag(args.id, args.patch)
    }
  )

  ipcMain.handle('tag:remove', (_e, id: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return removeTag(id)
  })

  ipcMain.handle('tag:usage', (_e, id: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return tagUsage(id)
  })

  ipcMain.handle('tag:apply', (_e, args: { assetIds: number[]; tagIds: number[] }) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return applyTags(args)
  })

  ipcMain.handle('tag:removeFrom', (_e, args: { assetIds: number[]; tagIds: number[] }) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return removeTagsFrom(args)
  })

  ipcMain.handle('tag:ofAssets', (_e, assetIds: number[]) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return tagsOfAssets(assetIds)
  })

  ipcMain.handle('tag:suggest', (_e, assetIds: number[]) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return suggestTagsForAssets(assetIds)
  })

  // ---------- 第 13 批：工单（docs/15） ----------
  ipcMain.handle('ticket:status', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const cfg = readTicketConfig()
    return {
      configured: !!(cfg.docid && cfg.identity && cfg.sheets.some((s) => s.enabled)),
      docid: cfg.docid,
      docName: cfg.docName,
      sheets: cfg.sheets.map((s) => ({
        title: s.title,
        sheetId: s.sheet_id,
        type: s.type,
        enabled: s.enabled
      })),
      identity: cfg.identity,
      firstSyncDone: cfg.firstSyncDone
    }
  })

  ipcMain.handle(
    'ticket:saveConfig',
    async (
      _e,
      input: { linkOrDocid: string; sheets: Array<{ title: string; type: 'print' | 'digital'; enabled: boolean }> }
    ) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      const docid = extractDocid(input.linkOrDocid)
      if (!docid) return { ok: false, kind: 'bad-link' as const, error: '链接里解析不出表格编号' }
      // 探活：列子表 + 读授权身份 —— 都通了才落库（配置错当场暴露，不留到同步时）
      const sheetsRes = await fetchSheets(docid)
      if (!sheetsRes.ok || !sheetsRes.data)
        return { ok: false, kind: sheetsRes.kind, error: sheetsRes.error }
      const sheetsInfo = sheetsRes.data
      const idRes = await fetchIdentity()
      if (!idRes.ok || !idRes.data) return { ok: false, kind: idRes.kind, error: idRes.error }
      // **探查模式**（input.sheets 为空）：只返回表里实际有哪些子表，不落库 ——
      // 设置弹窗第一步用它展示子表清单让用户勾选，第二步带完整 sheets 再来存。
      if (input.sheets.length === 0) {
        return {
          ok: true,
          docid,
          docName: sheetsInfo.docName,
          sheets: sheetsInfo.sheets.map((s) => ({
            title: s.title,
            sheetId: s.sheet_id,
            // 类型按标题猜（含「印刷」→ print，否则 digital），用户在弹窗里可改
            type: (s.title.includes('印刷') ? 'print' : 'digital') as 'print' | 'digital',
            enabled: true
          })),
          identity: idRes.data
        }
      }
      const sheets: TicketSheetConfig[] = input.sheets.map((s) => {
        const hit = sheetsInfo.sheets.find((x) => x.title === s.title)
        return { title: s.title, sheet_id: hit?.sheet_id ?? '', type: s.type, enabled: s.enabled }
      })
      setMeta(META_KEYS.docid, docid)
      setMeta(META_KEYS.docname, sheetsInfo.docName ?? '')
      writeTicketSheets(sheets)
      setMeta(META_KEYS.identity, JSON.stringify(idRes.data))
      return {
        ok: true,
        docid,
        docName: sheetsRes.data.docName,
        sheets: sheets.map((s) => ({
          title: s.title,
          sheetId: s.sheet_id,
          type: s.type,
          enabled: s.enabled
        })),
        identity: idRes.data
      }
    }
  )

  ipcMain.handle('ticket:sync', async () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const cfg = readTicketConfig()
    const zero = {
      structureChanged: false,
      inserted: 0,
      updated: 0,
      historyMarked: 0,
      tasksCreated: 0,
      projectMismatch: 0,
      reassigned: 0,
      rowGone: 0,
      rowBack: 0,
      needConfirm: 0,
      dupWarned: 0,
      warnings: [] as string[]
    }
    if (!cfg.docid || !cfg.identity)
      return { ok: false, kind: 'unknown' as const, error: COPY.ticket.notConfigured, ...zero }
    const sheetsRes = await fetchSheets(cfg.docid)
    if (!sheetsRes.ok || !sheetsRes.data)
      return { ok: false, kind: sheetsRes.kind, error: sheetsRes.error, ...zero }
    const check = detectStructure(cfg.sheets, sheetsRes.data.sheets)
    const payloads: SheetPayload[] = []
    for (const r of check.resolved) {
      const pr = await fetchSheetRecords(cfg.docid, r.sheet_id, r.cfg.title, r.cfg.type)
      if (!pr.ok || !pr.data)
        return { ok: false, kind: pr.kind, error: pr.error, ...zero }
      payloads.push(pr.data)
    }
    const result = applySync({
      payloads,
      structureChanged: check.structureChanged,
      identity: cfg.identity,
      workspaceRoot: root
    })
    // 缺失的子表（标题找不到了）拼进警告，让用户知道有子表没同步到
    for (const title of check.missingSheets) {
      result.warnings.push(fmt(COPY.ticket.warnMissingSheet, { title }))
    }
    // 子表重建后回写 sheet_id 指纹缓存（标题仍是主键，指纹保持新鲜）
    if (check.resolved.some((r) => r.sheet_id !== r.cfg.sheet_id)) {
      writeTicketSheets(
        cfg.sheets.map((s) => {
          const hit = check.resolved.find((r) => r.cfg.title === s.title)
          return hit ? { ...s, sheet_id: hit.sheet_id } : s
        })
      )
    }
    return result
  })

  ipcMain.handle(
    'ticket:list',
    (_e, view?: 'all' | 'mine' | 'unassigned' | 'history' | 'reassigned' | 'pending' | 'abnormal') => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      const db = getDb()
      const cfg = readTicketConfig()
      const mineUserid = cfg.identity?.userid ?? ''
      let where = '1=1'
      const args: unknown[] = []
      if (view === 'mine' && mineUserid) {
        where = 't.designer_userid = ?'
        args.push(mineUserid)
      } else if (view === 'mine') {
        return []
      } else if (view === 'unassigned') {
        where = 't.designer_userid IS NULL'
      } else if (view === 'history') {
        where = 't.is_history = 1'
      } else if (view === 'reassigned') {
        where = 't.reassigned_to IS NOT NULL'
      } else if (view === 'pending') {
        where = 't.need_confirm = 1'
      } else if (view === 'abnormal') {
        // 编号重复 / 项目未匹配（工单写了业务归属，但软件里没有同名项目）
        where =
          't.dup_warn = 1 OR (t.project_name IS NOT NULL AND t.project_name <> \'\' AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.name = t.project_name))'
      }
      const rows = db
        .prepare(
          `SELECT t.id, t.ticket_no, t.ticket_type, t.title, t.approval_state,
             t.designer_name, t.applicant_name, t.project_name, t.due_date, t.submit_time,
             t.is_history, t.need_confirm, t.row_gone, t.dup_warn, t.reassigned_to,
             t.pack_id, p.name AS pack_name, p.project_id AS pack_project_id
           FROM tickets t LEFT JOIN packs p ON p.id = t.pack_id
           WHERE ${where}
           ORDER BY t.submit_time DESC, t.id DESC`
        )
        .all(...args) as Array<Record<string, unknown>>
      return rows.map((r) => ({
        id: r.id as number,
        ticketNo: r.ticket_no as string,
        ticketType: r.ticket_type as 'print' | 'digital',
        title: (r.title as string) ?? null,
        approvalState: (r.approval_state as string) ?? null,
        designerName: (r.designer_name as string) ?? null,
        applicantName: (r.applicant_name as string) ?? null,
        projectName: (r.project_name as string) ?? null,
        dueDate: (r.due_date as string) ?? null,
        submitTime: (r.submit_time as string) ?? null,
        isHistory: r.is_history === 1,
        needConfirm: r.need_confirm === 1,
        rowGone: r.row_gone === 1,
        dupWarn: r.dup_warn === 1,
        reassignedTo: (r.reassigned_to as string) ?? null,
        packId: (r.pack_id as number) ?? null,
        packName: (r.pack_name as string) ?? null,
        packProjectId: (r.pack_project_id as number) ?? null
      }))
    }
  )

  ipcMain.handle('ticket:detail', (_e, ticketNo: string) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const db = getDb()
    const t = db
      .prepare('SELECT * FROM tickets WHERE ticket_no = ?')
      .get(ticketNo) as Record<string, unknown> | undefined
    if (!t) return null
    const cfg = readTicketConfig()
    let packSummary: { fileCount: number; lastUpdate: string | null } | null = null
    let packName: string | null = null
    let packProjectId: number | null = null
    if (t.pack_id !== null && t.pack_id !== undefined) {
      const p = db
        .prepare('SELECT name, project_id FROM packs WHERE id = ?')
        .get(t.pack_id as number) as { name: string; project_id: number | null } | undefined
      if (p) {
        packName = p.name
        packProjectId = p.project_id
        // assets 表没有 updated_at（用的是 modified_at）—— 第 13 批场景壳抓出来的
        const s = db
          .prepare('SELECT COUNT(*) AS c, MAX(modified_at) AS last FROM assets WHERE pack_id = ?')
          .get(t.pack_id as number) as { c: number; last: string | null }
        packSummary = { fileCount: s.c, lastUpdate: s.last }
      }
    }
    return {
      id: t.id as number,
      ticketNo: t.ticket_no as string,
      ticketType: t.ticket_type as 'print' | 'digital',
      title: (t.title as string) ?? null,
      approvalState: (t.approval_state as string) ?? null,
      designerName: (t.designer_name as string) ?? null,
      projectName: (t.project_name as string) ?? null,
      dueDate: (t.due_date as string) ?? null,
      submitTime: (t.submit_time as string) ?? null,
      isHistory: t.is_history === 1,
      needConfirm: t.need_confirm === 1,
      rowGone: t.row_gone === 1,
      dupWarn: t.dup_warn === 1,
      reassignedTo: (t.reassigned_to as string) ?? null,
      packId: (t.pack_id as number) ?? null,
      packName,
      packProjectId,
      applicantName: (t.applicant_name as string) ?? null,
      department: (t.department as string) ?? null,
      purpose: (t.purpose as string) ?? null,
      sizeText: (t.size_text as string) ?? null,
      printQty: (t.print_qty as number) ?? null,
      materialForm: (t.material_form as string) ?? null,
      useScene: (t.use_scene as string) ?? null,
      doneTime: (t.done_time as string) ?? null,
      remark: (t.remark as string) ?? null,
      sourceUrl: (t.source_url as string) ?? null,
      approvalUrl: (t.approval_url as string) ?? null,
      receiverName: (t.receiver_name as string) ?? null,
      receiverPhone: (t.receiver_phone as string) ?? null,
      deliverDate: (t.deliver_date as string) ?? null,
      reviewerNames: (t.reviewer_names as string) ?? null,
      materialCategory: (t.material_category as string) ?? null,
      mine: !!cfg.identity && t.designer_userid === cfg.identity.userid,
      packSummary
    }
  })

  ipcMain.handle('ticket:confirmBatch', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const cfg = readTicketConfig()
    if (!cfg.identity) return { confirmed: 0, tasksCreated: 0, warnings: [] }
    return confirmPendingTickets(cfg.identity, root)
  })

  ipcMain.handle('ticket:createTask', (_e, ticketNo: string) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return createTaskForTicketManually(ticketNo, root)
  })

  ipcMain.handle('ticket:openApproval', async (_e, url: string) => {
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ---------- 第 15 批：交付打包（M5，docs/18） ----------
  ipcMain.handle('pack:export', async (_e, input: PackExportInput) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    try {
      return await executePackExport(input)
    } catch (e) {
      return { ok: false, error: (e as Error).message } as PackExportResult
    }
  })

  ipcMain.handle('pack:deliveryRecords', (_e, packId: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return listDeliveryRecords(packId)
  })

  ipcMain.handle('dialog:pickOutputDir', async (_e, defaultPath?: string) => {
    const r = await dialog.showOpenDialog({
      title: COPY.exportPack.pickOutputDirTitle,
      buttonLabel: COPY.exportPack.pickOutputDirBtn,
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true }
    return { ok: true, dir: r.filePaths[0] }
  })
}
