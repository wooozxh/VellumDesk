import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ScanProgress, PackExportInput } from '../shared/types'

/**
 * 暴露给界面的接口。约定见方案 6.1：全部走 invoke（ipcMain.handle），
 * 不用 ipcRenderer.send —— 这样界面能拿到返回值、能 await。
 */
const api = {
  // 工作区
  wsInfo: (opts?: { refresh?: boolean }) => ipcRenderer.invoke('ws:info', opts),
  wsSetRoot: (root: string) => ipcRenderer.invoke('ws:setRoot', root),
  wsPickRoot: () => ipcRenderer.invoke('ws:pickRoot'),
  wsOpenRoot: () => ipcRenderer.invoke('ws:openRoot'),
  // 第 6 批：目录结构升级提示条已被界面看到
  wsAckLayout: () => ipcRenderer.invoke('ws:ackLayout'),

  // 第 5 批：工作区管理与迁移
  wsList: () => ipcRenderer.invoke('ws:list'),
  wsAdd: (opts?: { root?: string; rewrite?: boolean }) => ipcRenderer.invoke('ws:add', opts),
  wsSwitch: (id: string) => ipcRenderer.invoke('ws:switch', id),
  wsRemove: (id: string) => ipcRenderer.invoke('ws:remove', id),
  wsMove: (opts?: { targetParentDir?: string }) => ipcRenderer.invoke('ws:move', opts),

  // 项目维护
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (input: { name: string; color?: string; note?: string }) =>
    ipcRenderer.invoke('project:create', input),
  updateProject: (id: number, patch: { name?: string; color?: string; note?: string }) =>
    ipcRenderer.invoke('project:update', { id, patch }),
  removeProject: (id: number, action: { moveTo: number | null; toTrash?: boolean }) =>
    ipcRenderer.invoke('project:remove', { id, moveTo: action.moveTo, toTrash: action.toTrash }),
  moveProject: (id: number, direction: 'up' | 'down') =>
    ipcRenderer.invoke('project:move', { id, direction }),

  // 第 7 批：记录生命周期（docs/09）
  unbindProject: (id: number) => ipcRenderer.invoke('project:unbind', id),
  restoreProject: (id: number) => ipcRenderer.invoke('project:restore', id),
  updatePack: (id: number, patch: { name?: string; category?: string; projectId?: number | null }) =>
    ipcRenderer.invoke('pack:update', { id, patch }),

  // 第 8 批：重新定位（M8-03）
  relocateAsset: (assetId: number) => ipcRenderer.invoke('asset:relocate', assetId),
  pickRelocateDir: () => ipcRenderer.invoke('asset:pickRelocateDir'),
  relocateSuggest: (dir: string) => ipcRenderer.invoke('asset:relocateSuggest', dir),
  relocateApply: (items: Array<{ assetId: number; newAbsPath: string }>) =>
    ipcRenderer.invoke('asset:relocateApply', items),

  // 第 9 批：版本管理（M6，docs/11）
  listVersions: (packId: number) => ipcRenderer.invoke('version:list', packId),
  createVersion: (input: {
    packId: number
    note?: string
    takeExisting?: boolean
    copyFromVersionId?: number
  }) => ipcRenderer.invoke('version:create', input),
  listBindableFolders: (packId: number) => ipcRenderer.invoke('version:bindable', packId),
  bindVersion: (input: { packId: number; folderName: string; seq: number; note?: string }) =>
    ipcRenderer.invoke('version:bind', input),
  unbindVersion: (versionId: number) => ipcRenderer.invoke('version:unbind', versionId),
  setCurrentVersion: (versionId: number) => ipcRenderer.invoke('version:setCurrent', versionId),

  // 建包 / 扫描
  createPack: (input: { name?: string; projectId?: number | null; category?: string }) =>
    ipcRenderer.invoke('pack:create', input),
  refreshScan: () => ipcRenderer.invoke('scan:refresh'),
  /**
   * 第 14 批：刷新扫描的阶段进度推送（主进程 `sender.send`）。
   * 返回退订函数 —— 组件卸载时必须调用，否则订阅会越积越多。
   */
  onScanProgress: (cb: (p: ScanProgress) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: ScanProgress): void => cb(p)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.off('scan:progress', handler)
  },

  // 视图
  listPacks: () => ipcRenderer.invoke('view:packs'),
  listAssets: (opts: {
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
  }) => ipcRenderer.invoke('view:assets', opts),
  packDetail: (packId: number) => ipcRenderer.invoke('view:packDetail', packId),

  // 认领
  claim: (args: { paths: string[]; packId: number; subFolder: string; versionId?: number | null }) =>
    ipcRenderer.invoke('asset:claim', args),

  // 第 3 批：标签体系（M2）
  // 第 7 批补：计数口径跟随左栏项目范围（不传 = 全部）
  listTagDimensions: (scope?: { projectId?: number | null }) =>
    ipcRenderer.invoke('tag:dimensions', scope),
  createTag: (input: { dimension: string; name: string; color?: string }) =>
    ipcRenderer.invoke('tag:create', input),
  updateTag: (id: number, patch: { name?: string; color?: string }) =>
    ipcRenderer.invoke('tag:update', { id, patch }),
  removeTag: (id: number) => ipcRenderer.invoke('tag:remove', id),
  tagUsage: (id: number) => ipcRenderer.invoke('tag:usage', id),
  applyTags: (args: { assetIds: number[]; tagIds: number[] }) =>
    ipcRenderer.invoke('tag:apply', args),
  removeTagsFrom: (args: { assetIds: number[]; tagIds: number[] }) =>
    ipcRenderer.invoke('tag:removeFrom', args),
  tagsOfAssets: (assetIds: number[]) => ipcRenderer.invoke('tag:ofAssets', assetIds),
  suggestTags: (assetIds: number[]) => ipcRenderer.invoke('tag:suggest', assetIds),

  // 第 13 批：工单（docs/15）
  ticketStatus: () => ipcRenderer.invoke('ticket:status'),
  ticketSaveConfig: (input: {
    linkOrDocid: string
    sheets: Array<{ title: string; type: 'print' | 'digital'; enabled: boolean }>
  }) => ipcRenderer.invoke('ticket:saveConfig', input),
  ticketSync: () => ipcRenderer.invoke('ticket:sync'),
  ticketList: (view?: 'all' | 'mine' | 'unassigned' | 'history' | 'reassigned' | 'pending' | 'abnormal') =>
    ipcRenderer.invoke('ticket:list', view),
  ticketDetail: (ticketNo: string) => ipcRenderer.invoke('ticket:detail', ticketNo),
  ticketConfirmBatch: () => ipcRenderer.invoke('ticket:confirmBatch'),
  ticketCreateTask: (ticketNo: string) => ipcRenderer.invoke('ticket:createTask', ticketNo),
  ticketOpenApproval: (url: string) => ipcRenderer.invoke('ticket:openApproval', url),

  // 第 17 批：设计师指派（docs/19）
  ticketAssignInfo: () => ipcRenderer.invoke('ticket:assignInfo'),
  ticketAssignDesigner: (input: { ticketNo: string; designers: Array<{ userid: string; name: string }> }) =>
    ipcRenderer.invoke('ticket:assignDesigner', input),
  ticketSetAllowAssign: (v: boolean) => ipcRenderer.invoke('ticket:setAllowAssign', v),
  ticketUnassignedCount: () => ipcRenderer.invoke('ticket:unassignedCount'),

  // 打开
  openFile: (absPath: string) => ipcRenderer.invoke('file:open', absPath),
  revealFile: (absPath: string) => ipcRenderer.invoke('file:reveal', absPath),
  openFolder: (p: string) => ipcRenderer.invoke('shell:openPath', p),

  // 第 15 批：交付打包（M5，docs/18）
  packExport: (input: PackExportInput) => ipcRenderer.invoke('pack:export', input),
  packDeliveryRecords: (packId: number) => ipcRenderer.invoke('pack:deliveryRecords', packId),
  pickOutputDir: (defaultPath?: string) => ipcRenderer.invoke('dialog:pickOutputDir', defaultPath)
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
