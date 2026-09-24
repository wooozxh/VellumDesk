/**
 * 主进程 / 预加载 / 界面 三端共享的数据结构。
 * 这里是唯一出处 —— 改这里，三端一起生效。
 */

export interface Project {
  id: number
  name: string
  color: string
  note: string
  sort_order: number
  archived: number
  created_at: string
}

export interface ProjectWithCount extends Project {
  packCount: number
}

export interface PackCard {
  id: number
  name: string
  project_id: number | null
  category: string
  folder_path: string
  created_at: string
  updated_at: string
  fileCount: number
  totalSize: number
  cover: string | null
  /** 项目名与配色（LEFT JOIN projects 得来，未归属时为 null） */
  projectName: string | null
  projectColor: string | null
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
  projects: ProjectWithCount[]
  projectColors: string[]
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

  // 项目维护
  listProjects: () => Promise<ProjectWithCount[]>
  createProject: (input: {
    name: string
    color?: string
    note?: string
  }) => Promise<{ ok: boolean; project?: Project; error?: string }>
  updateProject: (
    id: number,
    patch: { name?: string; color?: string; note?: string }
  ) => Promise<{ ok: boolean; project?: Project; error?: string }>
  removeProject: (
    id: number,
    action: { moveTo: number | null }
  ) => Promise<{ ok: boolean; moved: number; error?: string }>

  createPack: (input: {
    name?: string
    projectId?: number | null
    category?: string
  }) => Promise<{ ok: boolean; pack: PackCard }>
  refreshScan: () => Promise<ScanResult>
  listPacks: () => Promise<PacksView>
  listAssets: (opts: {
    keyword?: string
    view?: 'all' | 'unassigned'
    packId?: number
    projectId?: number
  }) => Promise<{ items: AssetItem[]; total: number }>
  packDetail: (packId: number) => Promise<PackDetail>
  claim: (args: { paths: string[]; packId: number; subFolder: string }) => Promise<ClaimResult>
  openFile: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  revealFile: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  openFolder: (p: string) => Promise<{ ok: boolean; error?: string }>
}
