import { COPY, fmt } from '../shared/copy'
import { BrowserWindow, ipcMain, shell, app, dialog } from 'electron'
import { join, basename } from 'path'
import { existsSync, mkdirSync } from 'fs'
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
  // 第 47 批：假丢失治理（docs/33）
  countIgnoredMissing,
  ignoreMissingAssets,
  unignoreMissingAssets,
  /** 第 51 批（docs/36）：清掉已忽略的记录 */
  purgeIgnoredAssets,
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
import { PROJECT_COLORS, getDb, getMeta, setMeta } from './db'
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
  allowAssignEnabled,
  applySync,
  completeTicketTask,
  confirmPendingTickets,
  createTaskForTicketManually,
  detectStructure,
  designerColName,
  evaluateDesignerCol,
  /** 第 50 批（docs/35）：「缩略图」image 列可用性预检 */
  evaluateThumbCol,
  /** 同上：读可配列名 + 可用性标记 */
  thumbColUsable,
  executeAssignDesigners,
  listDesignerCandidates,
  readTicketMetrics,
  retryPendingDesignerWrites,
  setAllowAssignEnabled,
  thumbColName,
  unassignedTicketCount,
  writeTicketMetrics,
  // 第 27 批（issue #2）：任务包全部成品 → 多张缩略图（本地 thumb_url 存 JSON 数组）
  joinThumbUrls,
  parseThumbUrls,
  // 第 20 批（docs/24）：清理已禁用子表工单
  previewPurgeDisabledSheetTickets,
  purgeDisabledSheetTickets,
  META_KEYS,
  readTicketConfig,
  writeTicketSheets,
  // 第 26 批（docs/31）：自动同步配置 + 「上次同步」状态
  autoSyncEnabled,
  syncIntervalMin,
  setAutoSyncEnabled,
  setSyncIntervalMin,
  readLastSync,
  writeLastSync,
  type DesignerWriteAdapter,
  type SheetPayload,
  type SyncResult,
  type TicketSheetConfig
} from './tickets'
import {
  extractDocid,
  fetchIdentity,
  fetchSheetRecords,
  fetchSheets,
  sendBotTextMessage,
  updateRecords
} from './ticketsWecom'
// 第 21 批：企微连接（wecom-cli 内置 + 扫码授权引导，docs/16 §4）
import {
  cancelWecomAuth,
  getCliInfo,
  readAuthStatus,
  startWecomAuth,
  type CliFailKind,
  type WecomCliInfo
} from './wecomCli'
// 第 19 批：导出报表（docs/22）
import {
  exportReport,
  readReportConfig,
  writeReportConfig,
  type ExportReportInput,
  type ReportAdapter
} from './report'
import {
  addReportRecords,
  addReportSheet,
  fetchReportTemplateFields,
  rehostReportThumb,
  uploadReportImage
} from './reportWecom'
// 第 15 批：交付打包（M5，docs/18）
import { executePackExport, listDeliveryRecords, previewPackExport } from './exportPack'
// 第 26 批（docs/31）：工单定时自动同步 —— 把 docs/16 §3 被搁置的那一块捡起来
import {
  startTicketScheduler,
  stopTicketScheduler,
  SYNC_DEFAULT_INTERVAL_MIN,
  type TicketSchedulerJobResult,
  type TicketSchedulerOptions
} from './ticketScheduler'
import type {
  CreateShortcutResult,
  PackExportInput,
  PackExportPreview,
  PackExportResult
} from '../shared/types'
// 第 54 批（docs/39）：任务文件夹的桌面 / 开始菜单快捷方式（纯逻辑 + 注入 writer）
import {
  buildShortcutPlan,
  runShortcut,
  shortcutPathFor,
  type ShortcutProbe,
  type ShortcutWriter
} from './shortcut'

/**
 * 一次工单同步的完整结果（手动点「同步」和后台定时跑**共用同一条链路**，docs/16 §3.3）。
 * `ok` 在 SyncResult 里；这里补上失败分类和「这一轮到底跑没跑」。
 */
type TicketSyncOutcome = SyncResult & {
  kind?: CliFailKind
  error?: string
  /** false = 这一轮没真跑（工单没配置好等）—— 自动同步据此**不记**「上次同步」 */
  ran: boolean
}

/**
 * 主进程 / 界面的全部通信接口。
 * 约定：一律 ipcMain.handle + contextBridge（方案 6.1），不用 ipcRenderer.send。
 */

export function registerIpc(opts?: {
  /**
   * 第 54 批（docs/40 §4.1）：本次启动时工作区里**没有现成的库**（要在启动过程中现场新建）。
   * 必须由调用方在 `initWorkspace` **之前**探好传进来 —— 主进程是"先建库再注册 IPC"，
   * 这里再探就已经晚了。不传时（界面验证壳）就地探一次。
   */
  firstRunThisSession?: boolean
}): void {
  const appData = app.getPath('userData')
  const documentsDir = app.getPath('documents')

  // ---------- 工作区 ----------
  /**
   * 第 54 批（docs/40 §4.1）：**本次启动时这个工作区的库是不是现场新建的**。
   *
   * ⚠️ 这个值必须由**建库之前**的人告诉我们（`index.ts` 在 `initWorkspace` 之前探一次传进来）——
   * 真实主进程是"先建库、再 registerIpc"的，在这里探就已经晚了（库早被建出来了）。
   * 没传时（界面验证壳走这条）就地探一次：壳的场景布景通常已经把库建好了 → false；
   * 而专门验向导的 `wizard` 场景**故意不建库** → true。
   */
  let firstRunThisSession = opts?.firstRunThisSession
  if (firstRunThisSession === undefined) {
    const st0 = getWorkspaceState(appData, documentsDir)
    firstRunThisSession = st0.ok ? !existsSync(join(st0.root, '_system', 'media.db')) : false
  }

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
      return {
        ...base,
        // 工作区都连不上，谈不上"没配过" —— 向导一律不弹（顶部红条已经说明了原因）
        firstRunThisSession: false,
        setupWizardDone: true,
        projects: [],
        unassigned: 0,
        unboundProjects: [],
        missing: 0,
        ignoredMissing: 0
      }
    }
    initWorkspace(st.root)
    return {
      ...base,
      // 第 54 批（docs/40）：首次配置引导的两个判据
      firstRunThisSession: firstRunThisSession === true,
      setupWizardDone: getMeta('setup_wizard_done') === '1',
      projects: listProjectsWithCount(),
      unassigned: countUnassigned(),
      // 第 7 批：已解绑的项目（左栏「已解绑 N 个项目」入口用）
      unboundProjects: listUnboundProjects(),
      // 第 8 批：文件已丢失的条数（左栏「⚠️ 文件已丢失」入口用）
      // 第 47 批（docs/33 §4.2）：已忽略的**不算**丢失，单独数一个给「🚫 已忽略」入口
      missing: countMissing(),
      ignoredMissing: countIgnoredMissing(),
      // 第 6 批：刚把目录结构升级过的话告诉界面（只提示一次，界面 ack 后不再出现）
      layoutMigrated: readLayoutNotice() ?? undefined
    }
  })

  /** 界面已经提示过目录结构升级了 → 清掉标记，保证提示条只出现一次 */
  ipcMain.handle('ws:ackLayout', () => {
    ackLayoutNotice()
  })

  /**
   * 第 54 批（docs/40 §4.2）：标记「首次配置引导已走过」。
   * 只在点「完成」或「我以后再说」时写；关窗口（✕ / Esc）**不写** —— 下次启动还会弹。
   */
  ipcMain.handle('setup:wizardDone', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    setMeta('setup_wizard_done', '1')
    return { ok: true }
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
    (_e, args: { id: number; patch: { name?: string; category?: string; channel?: string; grade?: string; projectId?: number | null } }) => {
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
    (_e, input: { name?: string; projectId?: number | null; category?: string; channel?: string; grade?: string }) => {
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
        // 第 47 批（docs/33 §4.2）：已忽略的不算丢失，单独数一个给左栏「🚫 已忽略」入口
        missing: stat.missing,
        ignoredMissing: stat.ignoredMissing
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
        /** 第 8 批：只看文件已丢失的（第 47 批起**不含已忽略的**） */
        missingOnly?: boolean
        /** 第 47 批：只看已忽略丢失的 */
        ignoredOnly?: boolean
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
        ignoredOnly: o.ignoredOnly,
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

  /**
   * 第 47 批（docs/33 §4.4）：忽略这些丢失记录（可一次传多条 = 批量）。
   * **只写标记** —— 记录、标签、包内位置一个不动；随时可用下面的 unignore 撤销。
   * 界面上的三个入口（行尾 / 工具栏批量 / 已忽略列表里的恢复）都走这两个通道。
   */
  ipcMain.handle('asset:ignoreMissing', (_e, ids: number[]) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return ignoreMissingAssets(ids ?? [])
  })

  /** 第 47 批：撤销忽略 → 这条记录回到「丢失待处理」 */
  ipcMain.handle('asset:unignoreMissing', (_e, ids: number[]) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return unignoreMissingAssets(ids ?? [])
  })

  /**
   * 第 51 批（docs/36）：清掉「已忽略」的记录（只删库记录，磁盘零改动）。
   * 严格限定「文件已不在 + 用户已忽略」的双重门槛，见 `purgeIgnoredAssets` 注释。
   */
  ipcMain.handle('asset:purgeIgnored', (_e, ids: number[]) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return purgeIgnoredAssets(ids ?? [])
  })

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
      firstSyncDone: cfg.firstSyncDone,
      // 第 17 批（docs/19 §10 #3）：本机开关（默认关，派单的人自己开）
      allowAssign: allowAssignEnabled(),
      // 第 17 批：待指派存量（顶栏徽标口径 = 「未指派」筛选口径）
      unassignedCount: unassignedTicketCount(),
      // 第 50 批（docs/35）：「缩略图」image 列可用吗（未同步过 = 不设防，前端当可用）
      thumbColOk: thumbColUsable(),
      // 第 17 批：表格链接（详情弹窗「在表格中打开」逃生口）
      tableUrl: cfg.docid ? `https://doc.weixin.qq.com/smartsheet/${cfg.docid}` : null
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

  /**
   * 工单同步的实体 —— 手动「同步」按钮与后台定时自动同步**共用这一个函数**
   * （docs/16 §3.3 原话：定时器"复用现有同步链路，一字不改"）。
   * `ran` 只有调度器关心：没配置好时它是 false，那一轮就不记「上次同步」。
   */
  const doTicketSync = async (): Promise<TicketSyncOutcome> => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const cfg = readTicketConfig()
    const zero = {
      structureChanged: false,
      missingSheets: [] as string[],
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
      newUnassigned: 0,
      warnings: [] as string[]
    }
    if (!cfg.docid || !cfg.identity)
      return {
        ok: false,
        kind: 'unknown' as const,
        error: COPY.ticket.notConfigured,
        ran: false,
        ...zero
      }
    const sheetsRes = await fetchSheets(cfg.docid)
    if (!sheetsRes.ok || !sheetsRes.data)
      return { ok: false, kind: sheetsRes.kind, error: sheetsRes.error, ran: true, ...zero }
    const check = detectStructure(cfg.sheets, sheetsRes.data.sheets)
    // 第 17 批（docs/19 §7）：同步时评估「设计师」成员列可用性（缺失/改名 → 指派入口置灰）
    evaluateDesignerCol(
      check.resolved.map((r) => ({ sheet_id: r.sheet_id, title: r.cfg.title })),
      sheetsRes.data.fieldsBySheet
    )
    // 第 50 批（docs/35）：同步时评估「缩略图」image 列（缺失 / 类型不对 → 完成任务前就提示）
    evaluateThumbCol(
      check.resolved.map((r) => ({ sheet_id: r.sheet_id, title: r.cfg.title })),
      sheetsRes.data.fieldsBySheet
    )
    const payloads: SheetPayload[] = []
    for (const r of check.resolved) {
      const pr = await fetchSheetRecords(cfg.docid, r.sheet_id, r.cfg.title, r.cfg.type)
      if (!pr.ok || !pr.data)
        return { ok: false, kind: pr.kind, error: pr.error, ran: true, ...zero }
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
    // 第 17 批（docs/19 §5）：同步后补写 pending 的指派（写回失败积压的，每次同步自动重试）
    const retry = await retryPendingDesignerWrites(wecomDesignerAdapter)
    if (retry.retried > 0) {
      result.warnings.push(
        fmt(COPY.ticket.writeBackRetryInfo, { ok: retry.succeeded, fail: retry.failed })
      )
      result.warnings.push(...retry.errors)
    }
    return { ran: true, ...result }
  }

  /** 手动同步（工单工具栏那个「同步」按钮）—— 与后台自动同步走同一个 doTicketSync */
  ipcMain.handle('ticket:sync', () => doTicketSync())

  /** 自动同步配置 + 「上次同步」状态（工单设置里读、工单视图头部显示） */
  ipcMain.handle('ticket:autoSyncGet', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return {
      enabled: autoSyncEnabled(),
      intervalMin: syncIntervalMin(),
      lastSync: readLastSync()
    }
  })

  /**
   * 改自动同步设置 —— 改完**立即重排定时器**（不用重启软件）：关掉 = 停表、改间隔 = 按新间隔重排。
   * 与「允许指派」同一个模式：改动即存，不走「保存」按钮。
   */
  ipcMain.handle('ticket:autoSyncSet', (_e, input: { enabled?: boolean; intervalMin?: number }) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    if (typeof input?.enabled === 'boolean') setAutoSyncEnabled(input.enabled)
    if (typeof input?.intervalMin === 'number') setSyncIntervalMin(input.intervalMin)
    startTicketScheduler(ticketSchedulerOptions())
    return {
      ok: true,
      enabled: autoSyncEnabled(),
      intervalMin: syncIntervalMin(),
      lastSync: readLastSync()
    }
  })

  /**
   * 调度器的注入项（启动 / 改设置都用这一份，避免两处各写一遍跑偏）。
   * 三层职责在这里会合：读配置（meta）→ 跑同步（doTicketSync）→ 记账 + 推送界面。
   */
  const ticketSchedulerOptions = (): TicketSchedulerOptions => ({
    readConfig: () => {
      try {
        const root = getWorkspaceRoot(appData)
        initWorkspace(root)
        return { enabled: autoSyncEnabled(), intervalMin: syncIntervalMin() }
      } catch {
        // 工作区不可用（外接盘没插）→ 当作「关了」。第 22 批的规矩：
        // 这种时候界面走空态、横幅说明原因，绝不让主进程崩。
        return { enabled: false, intervalMin: SYNC_DEFAULT_INTERVAL_MIN }
      }
    },
    run: async (): Promise<TicketSchedulerJobResult> => {
      const r = await doTicketSync()
      return { ran: r.ran, ok: r.ok, error: r.error }
    },
    onDone: (r) => {
      const at = new Date().toISOString()
      try {
        writeLastSync(at, r.ok, r.error ?? null)
      } catch {
        // 记不上账不影响这一轮同步本身
      }
      // 推给所有窗口：工单视图收到就刷列表 + 更新「上次同步 HH:MM」。
      // 定时器不是由某次 IPC 触发的（没有 e.sender 可用），所以用广播。
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.webContents.isDestroyed()) {
          w.webContents.send('ticket:synced', { ok: r.ok, at, error: r.error ?? null })
        }
      }
    }
  })

  // 第 26 批（docs/31）：起自动同步调度器（默认开、30 分钟、启动后 15 秒首拉；关着就只注册不排表）
  startTicketScheduler(ticketSchedulerOptions())
  // 退出前清掉定时器，不然 Electron 进程可能退不干净
  app.on('will-quit', () => stopTicketScheduler())

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
        // 第 18 批：我的 = 本机身份 ∈ 设计师集合（子表），不再是单值列精确匹配
        where = 'EXISTS (SELECT 1 FROM ticket_designers td WHERE td.ticket_no = t.ticket_no AND td.userid = ?)'
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
      // 第 18 批：批量取每张单的全量设计师（子表），列表行「主设计师 + 等 N 人」+ 多选 UI 用
      const designerMap = new Map<string, Array<{ userid: string; name: string }>>()
      const ticketNos = rows.map((r) => r.ticket_no as string)
      if (ticketNos.length) {
        const ph = ticketNos.map(() => '?').join(',')
        const ds = db
          .prepare(
            `SELECT ticket_no, userid, name FROM ticket_designers WHERE ticket_no IN (${ph}) ORDER BY ticket_no, seq`
          )
          .all(...ticketNos) as Array<{ ticket_no: string; userid: string; name: string | null }>
        for (const d of ds) {
          if (!d.userid) continue
          const arr = designerMap.get(d.ticket_no) ?? []
          arr.push({ userid: d.userid, name: d.name ?? '' })
          designerMap.set(d.ticket_no, arr)
        }
      }
      return rows.map((r) => ({
        id: r.id as number,
        ticketNo: r.ticket_no as string,
        ticketType: r.ticket_type as 'print' | 'digital',
        title: (r.title as string) ?? null,
        approvalState: (r.approval_state as string) ?? null,
        designerName: (r.designer_name as string) ?? null,
        designers: designerMap.get(r.ticket_no as string) ?? [],
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
    // 第 18 批：全量设计师（子表，按 seq 排序，含 userid 供多选 UI）
    const designers = (
      db
        .prepare('SELECT userid, name FROM ticket_designers WHERE ticket_no = ? ORDER BY seq')
        .all(ticketNo) as Array<{ userid: string; name: string | null }>
    )
      .filter((d) => !!d.userid)
      .map((d) => ({ userid: d.userid, name: d.name ?? '' }))
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
      designers,
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
      packSummary,
      // 第 19 批：本地扩展字段 + 缩略图 URL
      // 第 27 批：本地存的可能是多张（JSON 数组），这里取第一张给旧字段用（兼容既有调用方）
      metrics: readTicketMetrics(ticketNo),
      thumbUrl: parseThumbUrls(t.thumb_url as string)[0] ?? null
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

  // ---------- 第 17 批：设计师指派（docs/19 §4~§7） ----------

  /**
   * 企微写回适配器（tickets.ts 引擎的注入实现 —— 架构铁律：引擎不碰网络，真企微不进自动测试）。
   * 写回格式按真表实探钉死（docs/19 §15）：成员列传嵌套数组对象 [{userId}]，errcode=0 还要
   * 检查 helper_msg（写不进去时 errcode 也是 0）—— 这两道判定都在 ticketsWecom.updateRecords 里。
   */
  const wecomDesignerAdapter: DesignerWriteAdapter = {
    updateDesigners: async (record_id, sheet_id, userids) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      const cfg = readTicketConfig()
      if (!cfg.docid) return { ok: false, error: COPY.ticket.notConfigured }
      const r = await updateRecords({
        docid: cfg.docid,
        sheet_id,
        records: [
          { record_id, values: { [designerColName()]: userids.map((userId) => ({ userId })) } }
        ]
      })
      return r.ok ? { ok: true } : { ok: false, error: r.error }
    },
    notify: async (designer_userid, content) => {
      const r = await sendBotTextMessage(designer_userid, content)
      return r.ok ? { ok: true } : { ok: false, error: r.error }
    }
  }

  /** 详情弹窗的指派区原料：开关状态 + 列可用性 + 候选池 + 表格链接（逃生口） */
  ipcMain.handle('ticket:assignInfo', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const cfg = readTicketConfig()
    return {
      allow: allowAssignEnabled(),
      designerColOk: getMeta('ticket_designer_ok') !== '0',
      candidates: listDesignerCandidates(),
      tableUrl: cfg.docid ? `https://doc.weixin.qq.com/smartsheet/${cfg.docid}` : null
    }
  })

  ipcMain.handle('ticket:assignDesigner', async (_e, input: { ticketNo: string; designers: Array<{ userid: string; name: string }> }) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    // 「本机开关」门槛（docs/19 §10 #3 用户拍板：开关即门槛，不做身份校验）
    if (!allowAssignEnabled()) {
      return { ok: false, writeOk: false, notifyState: null, msg: COPY.ticket.assignNotAllowed }
    }
    const cfg = readTicketConfig()
    return executeAssignDesigners(input.ticketNo, input.designers, wecomDesignerAdapter, cfg.identity?.userid ?? null)
  })

  ipcMain.handle('ticket:setAllowAssign', (_e, v: boolean) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    setAllowAssignEnabled(!!v)
    return { ok: true, allow: allowAssignEnabled() }
  })

  ipcMain.handle('ticket:unassignedCount', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return unassignedTicketCount()
  })

  // ---------- 第 20 批：清理已禁用子表工单（docs/24） ----------

  /**
   * 只算不删：给设置弹窗的二次确认用（将删 N 条 / 跳过 M 条）。
   * 不碰网络、不改数据 —— 纯读配置 + 查本地库。
   */
  ipcMain.handle('ticket:purgePreview', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return previewPurgeDisabledSheetTickets()
  })

  /** 真删：已关闭子表同步进来的工单（有任务包的跳过；删前留痕，留痕失败则中止） */
  ipcMain.handle('ticket:purgeDisabled', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return purgeDisabledSheetTickets(root)
  })

  // ---------- 第 21 批：企微连接（docs/16 §4） ----------

  /**
   * 连接状态快照：内置组件在不在 / 从哪来 / 什么版本 / 授权了没。
   * `onboardSeen` = 首次启动的授权引导是否已经弹过一次（弹过就不再自动弹，入口仍常驻设置里）。
   */
  ipcMain.handle(
    'wecom:cliInfo',
    async (): Promise<WecomCliInfo & { onboardSeen: boolean }> => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      const info = await getCliInfo()
      return { ...info, onboardSeen: getMeta('wecom_onboard_seen') === '1' }
    }
  )

  /** 只读授权状态（引导页每 2 秒轮询一次；查不到就说查不到，不猜） */
  ipcMain.handle('wecom:authStatus', async () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return { auth: await readAuthStatus() }
  })

  /**
   * 发起扫码授权：调 `auth init --noninteractive --output-qrcode <临时图>`，
   * 等二维码出现就返回（data URL 给界面），**不等扫码**；进程留着，界面轮询 authStatus。
   */
  ipcMain.handle('wecom:authStart', async () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return startWecomAuth()
  })

  /** 取消授权（用户关弹窗 / 点取消）—— 杀掉等待中的 CLI，清掉临时二维码 */
  ipcMain.handle('wecom:authCancel', () => {
    cancelWecomAuth()
    return { ok: true }
  })

  /** 授权成功后读本机身份（显示名字；userid 只在本机流转，不出界面） */
  ipcMain.handle('wecom:identity', async () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const r = await fetchIdentity()
    if (!r.ok || !r.data) return { ok: false, error: r.error ?? '' }
    return { ok: true, name: r.data.name }
  })

  /** 标记「首次启动引导已看过」—— 只影响自动弹窗，不影响设置里的入口 */
  ipcMain.handle('wecom:onboardSeen', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    setMeta('wecom_onboard_seen', '1')
    return { ok: true }
  })

  // ---------- 第 19 批：导出报表（docs/22） ----------

  /** 本地扩展字段（印刷金额 / 绩效金额 / 备注）读 */
  ipcMain.handle('ticket:metricsGet', (_e, ticketNo: string) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return readTicketMetrics(ticketNo)
  })

  /** 本地扩展字段写（upsert；三值全空删行） */
  ipcMain.handle(
    'ticket:metricsSet',
    (_e, input: { ticketNo: string; printCost: number | null; performanceCost: number | null; remark: string | null }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      writeTicketMetrics(input.ticketNo, {
        printCost: input.printCost,
        performanceCost: input.performanceCost,
        remark: input.remark
      })
      return { ok: true }
    }
  )

  /**
   * 任务包「完成任务」：生成缩略图 + 上传 + 写回工单队列「缩略图」列（docs/22 §4）。
   * 只负责缩略图，不改工单状态（§7 #6）。写回失败返回明确提示，不落 pending（人工可重试）。
   *
   * 第 27 批（issue #2）：最新版本的**全部成品**逐张上传、写回同一图片列（多图）。
   * 单张上传失败不拖累其余（尽力而为），但要如实计数返回给界面 —— 不静默丢张。
   */
  ipcMain.handle('ticket:completeByPack', async (_e, packId: number) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    // 第 50 批（docs/35）：**先判列可用，再干活** —— 列缺失 / 类型不对时直接回绝，
    // 别让用户白跑一趟「生成缩略图 → 逐张上传」，最后写回那一步才报错。
    // 与设计师指派的 `assignColBad` 同一套路子；未同步过（拿不到 fields）时不设防，照常走。
    if (!thumbColUsable()) {
      return { ok: false, msg: COPY.ticket.thumbColBad }
    }
    const comp = await completeTicketTask(packId, root)
    if (!comp.ok) return comp
    const cfg = readTicketConfig()
    const paths = comp.thumbPaths ?? []
    if (!cfg.docid || !comp.recordId || !comp.sheetId || paths.length === 0) {
      return { ok: false, msg: COPY.ticket.completeNoRecord }
    }
    // 逐张上传（几张成品就传几张）；单张失败继续传下一张，最后如实汇报缺了几张
    const urls: string[] = []
    let uploadFail = 0
    let lastErr = ''
    for (const p of paths) {
      const up = await uploadReportImage(cfg.docid, p)
      if (up.ok && up.data) urls.push(up.data)
      else {
        uploadFail += 1
        lastErr = up.error ?? ''
      }
    }
    if (urls.length === 0) {
      return { ok: false, msg: fmt(COPY.ticket.completeUploadFail, { msg: lastErr }) }
    }
    const wr = await updateRecords({
      docid: cfg.docid,
      sheet_id: comp.sheetId,
      records: [
        {
          record_id: comp.recordId,
          values: {
            [thumbColName()]: urls.map((u) => ({ title: comp.ticketNo, imageUrl: u }))
          }
        }
      ]
    })
    if (!wr.ok) {
      return { ok: false, msg: fmt(COPY.ticket.completeWriteFail, { msg: wr.error ?? '' }) }
    }
    // 本地 thumb_url 即时更新（不等下轮同步）—— 多张存 JSON 数组，单张就是纯 URL
    getDb()
      .prepare('UPDATE tickets SET thumb_url = ? WHERE ticket_no = ?')
      .run(joinThumbUrls(urls), comp.ticketNo)
    return {
      ok: true,
      ticketNo: comp.ticketNo,
      count: urls.length,
      // 缺的 = 缩略图没生成出来的 + 上传失败的（两类都要让用户看见）
      missing: uploadFail + (comp.thumbFail ?? 0)
    }
  })

  /** 报表配置状态（导出弹窗预填链接 / 模板子表名） */
  ipcMain.handle('report:status', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return readReportConfig()
  })

  /** 报表 wecom 适配器（引擎注入实现 —— 真企微不进自动测试） */
  const reportAdapter: ReportAdapter = {
    fetchTemplateFields: (docid, sheetTitle) => fetchReportTemplateFields(docid, sheetTitle),
    addSheet: (docid, sheetTitle, fields) => addReportSheet(docid, sheetTitle, fields),
    rehostThumb: (sourceUrl, docid) => rehostReportThumb(sourceUrl, docid),
    addRecords: (docid, sheetTitle, records) => addReportRecords(docid, sheetTitle, records)
  }

  /** 导出报表：起止日期 → 建子表（复制字段）→ 写记录（含图片列重新上传） */
  ipcMain.handle(
    'report:export',
    async (_e, input: { link: string; start: string; end: string }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      const docid = extractDocid(input.link)
      if (!docid) return { ok: false, kind: 'bad-link' as const, error: '链接里解析不出表格编号' }
      const cfg = readReportConfig()
      // 链接变了 → 落库（导出弹窗每次粘贴都带上，这里顺手存）
      if (docid !== cfg.docid) writeReportConfig(docid, cfg.templateSheet)
      const expInput: ExportReportInput = {
        docid,
        templateSheet: cfg.templateSheet || '报表模板',
        start: input.start,
        end: input.end
      }
      return exportReport(expInput, reportAdapter)
    }
  )

  /**
   * 第 54 批（docs/40 S4）：只记住报表表格链接（**不导出**）。
   * 首次配置引导的「配置报表表」用 —— 原来这条链接是搭着「导出」才落库的，
   * 向导里没有导出这一步，所以单独开一个只写配置的口子。
   */
  ipcMain.handle('report:saveLink', (_e, link: string) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const docid = extractDocid(String(link ?? ''))
    if (!docid) return { ok: false, kind: 'bad-link' as const }
    const cfg = readReportConfig()
    writeReportConfig(docid, cfg.templateSheet || '报表模板')
    return { ok: true, docid }
  })

  // ---------- 第 54 批（docs/39）：任务快捷方式 ----------
  /**
   * 给任务文件夹在**桌面 + 开始菜单**各建一个快捷方式（用户拍板 D4）。
   *
   * 三条边界全部来自本机一次性探针实测（见 `shortcut.ts` 文件头，别改成"想当然"的写法）：
   *  ① 目标位置已有同名 `.lnk` 时 API **不报错、直接覆盖** → 覆盖与否只能我们问用户；
   *  ② `target` 指向不存在的目录也照样建成功（死链）→ 建之前必须自己查任务文件夹在不在；
   *  ③ 带 `icon` 回读值存疑 → 不指定图标，用 Windows 给文件夹的默认图标。
   *
   * 只写快捷方式、**不碰任务文件夹里的任何文件**（不新增/不改名/不删除）。
   */
  ipcMain.handle(
    'pack:createShortcut',
    (_e, args: { packId: number; overwrite?: boolean }): CreateShortcutResult => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      if (process.platform !== 'win32') return { ok: false, msg: COPY.sht.notWin }

      let folderPath = ''
      let packName = ''
      try {
        const d = getPackDetail(args.packId)
        folderPath = d.pack.folder_path
        packName = d.pack.name
      } catch {
        return { ok: false, msg: COPY.sht.packMissing }
      }

      const desktopDir = app.getPath('desktop')
      // 开始菜单「所有程序」—— .lnk 放这里就出现在开始菜单里（Windows 的标准做法）
      const startMenuDir = join(
        app.getPath('appData'),
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs'
      )
      // 该目录正常都存在；万一没有（精简系统）就现建一个，失败也不影响桌面那一路
      try {
        mkdirSync(startMenuDir, { recursive: true })
      } catch {
        /* 建不出来就让这一处写失败，桌面照写 */
      }

      const probes: ShortcutProbe[] = [
        { key: 'desktop', dir: desktopDir, lnkExists: existsSync(shortcutPathFor(desktopDir, packName)) },
        {
          key: 'startMenu',
          dir: startMenuDir,
          lnkExists: existsSync(shortcutPathFor(startMenuDir, packName))
        }
      ]

      const plan = buildShortcutPlan({
        packName,
        folderPath,
        folderExists: existsSync(folderPath),
        probes
      })
      if (!plan.ok) return { ok: false, msg: COPY.sht.folderMissing }
      if (plan.needsConfirm && args.overwrite !== true) {
        const desktop = plan.places.find((p) => p.key === 'desktop')
        return { ok: true, conflict: true, path: desktop?.lnkPath }
      }

      const writer: ShortcutWriter = (lnkPath, operation, details) =>
        shell.writeShortcutLink(lnkPath, operation, details)
      const r = runShortcut(writer, plan, { overwrite: args.overwrite === true })
      if (!r.ok) {
        return {
          ok: false,
          msg: fmt(COPY.sht.failed, { msg: COPY.sht.partialFailed })
        }
      }
      return { ok: true, path: r.desktopPath ?? undefined, skipped: !r.wrote }
    }
  )

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

  ipcMain.handle('pack:exportPreview', async (_e, input: PackExportInput) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    try {
      return await previewPackExport(input)
    } catch (e) {
      return { ok: false, zipName: '', innerPaths: [], fileCount: 0, totalSize: 0, error: (e as Error).message } as PackExportPreview
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
