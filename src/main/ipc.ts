import { ipcMain, shell, app } from 'electron'
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
  initWorkspace,
  saveWorkspaceRoot,
  SUB_FOLDERS,
  type SubFolder
} from './workspace'
import { ensureThumbsForAssets, readAsDataUrl, isImage } from './thumbs'
import { PROJECTS, CATEGORIES } from './db'

/**
 * 主进程 / 界面的全部通信接口。
 * 约定：一律 ipcMain.handle + contextBridge（方案 6.1），不用 ipcRenderer.send。
 */

export function registerIpc(): void {
  const appData = app.getPath('userData')

  // ---------- 工作区 ----------
  ipcMain.handle('ws:info', () => {
    const root = getWorkspaceRoot(appData)
    initWorkspace(root)
    return {
      workspaceRoot: root,
      projects: [...PROJECTS],
      categories: [...CATEGORIES],
      subFolders: [...SUB_FOLDERS],
      unassigned: countUnassigned()
    }
  })

  ipcMain.handle('ws:setRoot', (_e, root: string) => {
    saveWorkspaceRoot(appData, root)
    initWorkspace(root)
    return { ok: true, workspaceRoot: root }
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
    (
      _e,
      input: { name?: string; project?: string; category?: string }
    ) => {
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
    return { ...result, thumbs }
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
    (_e, opts: { keyword?: string; view?: 'all' | 'unassigned'; packId?: number }) => {
      const root = getWorkspaceRoot(appData)
      initWorkspace(root)
      const rows = listAssets(opts ?? {})
      const withThumb = rows.map((r) => ({
        ...r,
        thumb:
          r.thumb_path && isImage(r.ext)
            ? readAsDataUrl(join(root, r.thumb_path))
            : isImage(r.ext)
              ? readAsDataUrl(r.abs_path)
              : null
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
          r.thumb_path && isImage(r.ext)
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
}
