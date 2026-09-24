/**
 * 主进程 / 预加载 / 界面 三端共享的数据结构。
 * 这里是唯一出处 —— 改这里，三端一起生效。
 */

export interface PackCard {
  id: number
  name: string
  project: string
  category: string
  folder_path: string
  created_at: string
  updated_at: string
  fileCount: number
  totalSize: number
  cover: string | null
}

export interface AssetItem {
  id: number
  pack_id: number | null
  role: string
  file_name: string
  ext: string
  size: number
  abs_path: string
  rel_path: string
  thumb_path: string | null
  created_at: string
  modified_at: string
  thumb?: string | null
}

export interface WsInfo {
  workspaceRoot: string
  projects: string[]
  categories: string[]
  subFolders: string[]
  unassigned: number
}

export interface PacksView {
  packs: PackCard[]
  total: { packs: number; files: number; size: number; unassigned: number }
}

export interface PackDetail {
  pack: PackCard
  groups: Record<string, AssetItem[]>
  subFolders: string[]
}

export interface ScanResult {
  packs: number
  files: number
  unassigned: number
  newFiles: number
  thumbs: number
}

export interface ClaimResult {
  ok: boolean
  moved: number
  errors: string[]
}

export interface Api {
  wsInfo: () => Promise<WsInfo>
  wsSetRoot: (root: string) => Promise<{ ok: boolean; workspaceRoot: string }>
  wsOpenRoot: () => Promise<{ ok: boolean; error?: string }>
  createPack: (input: {
    name?: string
    project?: string
    category?: string
  }) => Promise<{ ok: boolean; pack: PackCard }>
  refreshScan: () => Promise<ScanResult>
  listPacks: () => Promise<PacksView>
  listAssets: (opts: {
    keyword?: string
    view?: 'all' | 'unassigned'
    packId?: number
  }) => Promise<{ items: AssetItem[]; total: number }>
  packDetail: (packId: number) => Promise<PackDetail>
  claim: (args: { paths: string[]; packId: number; subFolder: string }) => Promise<ClaimResult>
  openFile: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  revealFile: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  openFolder: (p: string) => Promise<{ ok: boolean; error?: string }>
}
