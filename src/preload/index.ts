import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * 暴露给界面的接口。约定见方案 6.1：全部走 invoke（ipcMain.handle），
 * 不用 ipcRenderer.send —— 这样界面能拿到返回值、能 await。
 */
const api = {
  // 工作区
  wsInfo: () => ipcRenderer.invoke('ws:info'),
  wsSetRoot: (root: string) => ipcRenderer.invoke('ws:setRoot', root),
  wsOpenRoot: () => ipcRenderer.invoke('ws:openRoot'),

  // 项目维护
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (input: { name: string; color?: string; note?: string }) =>
    ipcRenderer.invoke('project:create', input),
  updateProject: (id: number, patch: { name?: string; color?: string; note?: string }) =>
    ipcRenderer.invoke('project:update', { id, patch }),
  removeProject: (id: number, action: { moveTo: number | null }) =>
    ipcRenderer.invoke('project:remove', { id, moveTo: action.moveTo }),
  moveProject: (id: number, direction: 'up' | 'down') =>
    ipcRenderer.invoke('project:move', { id, direction }),

  // 建包 / 扫描
  createPack: (input: { name?: string; projectId?: number | null; category?: string }) =>
    ipcRenderer.invoke('pack:create', input),
  refreshScan: () => ipcRenderer.invoke('scan:refresh'),

  // 视图
  listPacks: () => ipcRenderer.invoke('view:packs'),
  listAssets: (opts: {
    keyword?: string
    view?: 'all' | 'unassigned'
    packId?: number
    projectId?: number
  }) => ipcRenderer.invoke('view:assets', opts),
  packDetail: (packId: number) => ipcRenderer.invoke('view:packDetail', packId),

  // 认领
  claim: (args: { paths: string[]; packId: number; subFolder: string }) =>
    ipcRenderer.invoke('asset:claim', args),

  // 打开
  openFile: (absPath: string) => ipcRenderer.invoke('file:open', absPath),
  revealFile: (absPath: string) => ipcRenderer.invoke('file:reveal', absPath),
  openFolder: (p: string) => ipcRenderer.invoke('shell:openPath', p)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
