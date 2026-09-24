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
  // ---- 第 2 批新增：媒体元信息 ----
  width: number | null
  height: number | null
  color_mode: string | null
  duration_ms: number | null
  video_codec: string | null
  /** 精简 JSON：视频 {"fps","acodec","bitrate"} / PDF {"pages"} */
  probe_info: string | null
  created_at: string
  modified_at: string
  thumb?: string | null
  /** 第 3 批：本条素材的标签（listAssets 带 withTags 时填充） */
  tags?: Tag[]
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

// ==================== 第 3 批：标签体系（M2） ====================

export interface Tag {
  id: number
  /** 所属维度：project / category / channel / status / time */
  dimension: string
  name: string
  color: string
  sort_order: number
  created_at: string
}

export interface TagWithCount extends Tag {
  /** 被多少条素材使用（左栏显示数量、删标签前提示用） */
  assetCount: number
}

export interface DimensionGroup {
  key: string
  label: string
  mode: 'single' | 'multi'
  editable: boolean
  hint: string
  tags: TagWithCount[]
}

/** 左栏当前勾选的标签（tagId 数组；项目维度用负数 id = -projectId） */
export interface TagSelection {
  tagIds: number[]
  /** 各维度已选项，用于界面高亮回显 */
  byDimension: Record<string, number[]>
}

export interface ApplyTagsResult {
  ok: boolean
  tagged: number
  cleared: number
  error?: string
}

export interface SuggestTagsResult {
  /** 素材 id → 建议的 tagId 数组（只推荐，不自动贴） */
  [assetId: number]: number[]
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
  moveProject: (
    id: number,
    direction: 'up' | 'down'
  ) => Promise<{ ok: boolean; moved: boolean; error?: string }>

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
    /** 第 3 批：已选标签（同维度或，跨维度并且）；项目维度用负数 id */
    tagIds?: number[]
    filterProjectIds?: number[]
    /** 是否把每条素材的标签一起带出来 */
    withTags?: boolean
  }) => Promise<{ items: AssetItem[]; total: number }>
  packDetail: (packId: number) => Promise<PackDetail>
  claim: (args: { paths: string[]; packId: number; subFolder: string }) => Promise<ClaimResult>
  openFile: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  revealFile: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  openFolder: (p: string) => Promise<{ ok: boolean; error?: string }>

  // ---------------- 第 3 批：标签 ----------------
  /** 5 个维度 + 每个维度的标签（带使用计数） */
  listTagDimensions: () => Promise<DimensionGroup[]>
  createTag: (input: {
    dimension: string
    name: string
    color?: string
  }) => Promise<{ ok: boolean; tag?: Tag; error?: string }>
  updateTag: (
    id: number,
    patch: { name?: string; color?: string }
  ) => Promise<{ ok: boolean; tag?: Tag; error?: string }>
  removeTag: (id: number) => Promise<{ ok: boolean; deleted: number; error?: string }>
  /** 删除前看该标签被多少素材使用 */
  tagUsage: (id: number) => Promise<{ assetCount: number }>
  /** 批量打标签（覆盖同维度旧标签） */
  applyTags: (args: { assetIds: number[]; tagIds: number[] }) => Promise<ApplyTagsResult>
  /** 批量移除标签 */
  removeTagsFrom: (args: {
    assetIds: number[]
    tagIds: number[]
  }) => Promise<{ ok: boolean; removed: number }>
  /** 取一批素材各自的标签 */
  tagsOfAssets: (assetIds: number[]) => Promise<Record<number, Tag[]>>
  /** 标签自动建议（只推荐，不自动贴） */
  suggestTags: (assetIds: number[]) => Promise<SuggestTagsResult>
}
