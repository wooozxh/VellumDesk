import { ipcMain, shell, app, dialog } from 'electron'
import { join, basename } from 'path'
import { existsSync } from 'fs'
import { openDb, getDb } from './db'
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
  isUsableWorkspace,
  initWorkspace,
  saveWorkspaceRoot,
  listProjectsWithCount,
  createProject,
  updateProject,
  removeProject,
  moveProject,
  SUB_FOLDERS,
  type SubFolder
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
import { PROJECT_COLORS, CATEGORIES } from './db'
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
    const base = {
      workspaceRoot: st.root,
      workspaceOk: st.ok,
      workspaceNote: st.note,
      appVersion: app.getVersion(),
      projectColors: [...PROJECT_COLORS],
      categories: [...CATEGORIES],
      subFolders: [...SUB_FOLDERS]
    }
    if (!st.ok) {
      // 工作区不可用时数据库根本打不开，直接返回空数据交给界面提示，
      // 不让异常冒到渲染进程控制台
      return { ...base, projects: [], unassigned: 0 }
    }
    initWorkspace(st.root)
    return { ...base, projects: listProjectsWithCount(), unassigned: countUnassigned() }
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
    return createProject(input)
  })

  ipcMain.handle(
    'project:update',
    (_e, args: { id: number; patch: { name?: string; color?: string; note?: string } }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      return updateProject(args.id, args.patch)
    }
  )

  ipcMain.handle(
    'project:remove',
    (_e, args: { id: number; moveTo: number | null }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      return removeProject(args.id, { moveTo: args.moveTo })
    }
  )

  // 调整项目在左栏的显示顺序（上移 / 下移一位）
  ipcMain.handle('project:move', (_e, args: { id: number; direction: 'up' | 'down' }) => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return moveProject(args.id, args.direction)
  })

  ipcMain.handle('ws:setRoot', (_e, root: string) => {
    if (!root || !isUsableWorkspace(root)) {
      return { ok: false, workspaceRoot: root, error: '这个位置不能写入，请换一个目录' }
    }
    saveWorkspaceRoot(appData, root)
    resetWorkspaceState()
    initWorkspace(root)
    return { ok: true, workspaceRoot: root }
  })

  /**
   * 「更改位置」：弹系统选目录对话框，选中后切过去。
   * 如果选中的是一个已经有素材的旧工作区目录，原来的包 / 标签 / 登记信息会直接读出来
   * （媒体库就存在该目录的 `_system/media.db` 里）——
   * 这就是需求文档第 365 条说的「换电脑或换盘后指过去即恢复，无需重新登记」。
   */
  ipcMain.handle('ws:pickRoot', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择素材工作区位置',
      buttonLabel: '用这里',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true }
    const picked = r.filePaths[0]
    if (!isUsableWorkspace(picked)) {
      return { ok: false, error: '这个位置不能写入，换一个试试（别选只读盘或系统目录）' }
    }
    saveWorkspaceRoot(appData, picked)
    resetWorkspaceState()
    initWorkspace(picked)
    return { ok: true, workspaceRoot: picked }
  })

  ipcMain.handle('ws:openRoot', async () => {
    const root = getWorkspaceRoot(appData)
    if (!existsSync(root)) return { ok: false, error: '工作区目录不存在' }
    const err = await shell.openPath(root)
    return err ? { ok: false, error: err } : { ok: true }
  })

  // ---------- A-01 建包 ----------
  ipcMain.handle(
    'pack:create',
    (_e, input: { name?: string; projectId?: number | null; category?: string }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      const pack = createPack({ ...input, workspaceRoot: root })
      return { ok: true, pack }
    }
  )

  // ---------- A-10 刷新扫描 ----------
  ipcMain.handle('scan:refresh', async () => {
    const root = getWorkspaceRoot(appData)
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

    const thumbs = await ensureThumbsForAssets(root, rows)

    // B-01：补图片尺寸 / 色彩模式（只处理还没有 width 的图片）
    const metaRows = db
      .prepare('SELECT id, abs_path, ext, width FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; width: number | null }>
    const metas = await ensureImageMetaForAssets(metaRows)

    // B-02：补视频时长 / 编码 / 尺寸（只处理还没有 duration_ms 的视频）
    const videoRows = db
      .prepare('SELECT id, abs_path, ext, duration_ms FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; duration_ms: number | null }>
    const videoMetas = await ensureVideoMetaForAssets(videoRows)

    // B-04：补 PSD 画布尺寸 / 色彩模式（只处理还没有 width 的 psd/psb）
    const psdRows = db
      .prepare('SELECT id, abs_path, ext, width FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; width: number | null }>
    const psdMetas = await ensurePsdMetaForAssets(psdRows)

    // B-03：补 PDF 页数（只处理还没有 probe_info 的 pdf）
    const pdfRows = db
      .prepare('SELECT id, abs_path, ext, probe_info FROM assets')
      .all() as Array<{ id: number; abs_path: string; ext: string; probe_info: string | null }>
    const pdfMetas = await ensurePdfMetaForAssets(pdfRows)

    return { ...result, thumbs, metas, videoMetas, psdMetas, pdfMetas }
  })
  // ---------- A-06 包视图 ----------
  ipcMain.handle('view:packs', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    const packs = listPacks()
    const db = getDb()

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

    const stat = db
      .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS s FROM assets')
      .get() as { c: number; s: number }

    return {
      packs: withCover,
      total: { packs: packs.length, files: stat.c, size: stat.s, unassigned: countUnassigned() }
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
        filterProjectIds: o.filterProjectIds
      })
      // 第 3 批：需要标签时一并带出（列表色块展示）
      const tagMap = o.withTags || o.tagIds?.length ? tagsOfAssets(rows.map((r) => r.id)) : {}
      const withThumb = rows.map((r) => ({
        ...r,
        // thumb_path 有值就直接读缩略图（图片 .webp / 视频 .jpg 都走这里）；
        // 没有缩略图且本身是图片才读原图 —— 视频原文件绝不直接读（太大）
        thumb:
          r.thumb_path
            ? readAsDataUrl(join(root, r.thumb_path))
            : isImage(r.ext)
              ? readAsDataUrl(r.abs_path)
              : null,
        tags: tagMap[r.id] ?? []
      }))
      return { items: withThumb, total: withThumb.length }
    }
  )

  // ---------- A-08 点开包 ----------
  ipcMain.handle('view:packDetail', (_e, packId: number) => {
    const root = getWorkspaceRoot(appData)
    const detail = getPackDetail(packId)
    const withThumb: Record<string, unknown[]> = {}
    for (const [role, items] of Object.entries(detail.groups)) {
      withThumb[role] = items.map((r) => ({
        ...r,
        thumb:
          r.thumb_path
            ? readAsDataUrl(join(root, r.thumb_path))
            : isImage(r.ext)
              ? readAsDataUrl(r.abs_path)
              : null
      }))
    }
    return { pack: detail.pack, groups: withThumb, subFolders: [...SUB_FOLDERS] }
  })

  // ---------- A-09 认领 ----------
  ipcMain.handle(
    'asset:claim',
    (_e, args: { paths: string[]; packId: number; subFolder: SubFolder }) => {
      const root = getWorkspaceRoot(appData)
      const res = claimFiles(root, args.paths, args.packId, args.subFolder)
      return { ok: res.errors.length === 0, ...res }
    }
  )

  // ---------- A-11 双击打开 ----------
  ipcMain.handle('file:open', async (_e, absPath: string) => {
    if (!existsSync(absPath)) return { ok: false, error: '文件不存在：' + basename(absPath) }
    const err = await shell.openPath(absPath)
    return err ? { ok: false, error: err } : { ok: true }
  })

  ipcMain.handle('file:reveal', (_e, absPath: string) => {
    if (!existsSync(absPath)) return { ok: false, error: '文件不存在' }
    shell.showItemInFolder(absPath)
    return { ok: true }
  })

  ipcMain.handle('shell:openPath', async (_e, p: string) => {
    if (!existsSync(p)) return { ok: false, error: '路径不存在' }
    const err = await shell.openPath(p)
    return err ? { ok: false, error: err } : { ok: true }
  })

  // ---------- 第 3 批：标签体系（M2） ----------
  ipcMain.handle('tag:dimensions', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return listTagDimensions()
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
}
