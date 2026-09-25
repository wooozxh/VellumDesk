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
  /** 第 6 批：项目在工作区磁盘上对应的文件夹名（三级结构） */
  folder_name: string
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
  /** 工作区当前是否可用；不可用时界面顶部给提示条，其余数据为空 */
  workspaceOk: boolean
  /** 不可用的原因说明（可用时为空串） */
  workspaceNote: string
  /** 软件版本号，唯一出处是 package.json 的 version */
  appVersion: string
  /** 第 5 批：全部工作区（左栏工作区面板用） */
  workspaces: WorkspaceEntry[]
  /** 第 5 批：当前活动工作区 id */
  activeId: string
  projects: ProjectWithCount[]
  projectColors: string[]
  categories: string[]
  subFolders: string[]
  unassigned: number
  /**
   * 第 6 批：刚把目录结构升级到三级时才有值 —— 界面弹一次提示条，
   * 调 wsAckLayout 之后就没了。
   */
  layoutMigrated?: { at: string; packs: number }
}

// ==================== 第 5 批：工作区管理（E-01） ====================

export interface WorkspaceEntry {
  id: string
  /** 显示名，默认取文件夹名 */
  name: string
  root: string
  addedAt: string
  lastOpenedAt: string
}

export interface AddWorkspaceResult {
  ok: boolean
  canceled?: boolean
  /** 目录里是一个搬过来的库，需要用户确认是否改写路径 */
  needsConfirm?: boolean
  /** 需要确认时：库里记录的旧位置 */
  oldRoot?: string
  /** 改写后库里的素材条数 */
  rewritten?: number
  /** 自检落空数（文件实际不存在） */
  missing?: number
  backupPath?: string | null
  workspaceRoot?: string
  error?: string
}

export interface MigrateWorkspaceResult {
  ok: boolean
  canceled?: boolean
  /** 目标在不同磁盘：软件不做跨盘复制，给引导文案 */
  crossDisk?: boolean
  from?: string
  to?: string
  rewritten?: number
  missing?: number
  backupPath?: string | null
  error?: string
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
  /** refresh=true 时重新探测工作区（用于"插上移动硬盘后重试"） */
  wsInfo: (opts?: { refresh?: boolean }) => Promise<WsInfo>
  wsSetRoot: (root: string) => Promise<{ ok: boolean; workspaceRoot: string; error?: string }>
  /** 弹系统选目录对话框，选中后切换工作区（取消时 canceled=true） */
  wsPickRoot: () => Promise<{
    ok: boolean
    canceled?: boolean
    workspaceRoot?: string
    error?: string
  }>
  wsOpenRoot: () => Promise<{ ok: boolean; error?: string }>
  /** 第 6 批：界面提示过目录结构升级后调用，保证提示条只出现一次 */
  wsAckLayout: () => Promise<void>

  // ---------------- 第 5 批：工作区管理 ----------------
  /** 工作区列表（含当前活动 id） */
  wsList: () => Promise<{ workspaces: WorkspaceEntry[]; activeId: string }>
  /**
   * 添加工作区。不传 root 时弹系统选目录对话框。
   * 若选中的目录里是一个搬过来的库，返回 needsConfirm=true（此时不做任何改动）；
   * 用户确认后带 rewrite:true 再调一次。
   */
  wsAdd: (opts?: { root?: string; rewrite?: boolean }) => Promise<AddWorkspaceResult>
  /** 按 id 切换工作区 */
  wsSwitch: (
    id: string
  ) => Promise<{ ok: boolean; workspaceRoot?: string; name?: string; error?: string }>
  /** 从列表移除工作区（只删配置记录，磁盘一个字节都不动） */
  wsRemove: (id: string) => Promise<{ ok: boolean; switchedTo?: string; error?: string }>
  /** 同盘搬移当前工作区。不传 targetParentDir 时弹系统选目录对话框 */
  wsMove: (opts?: { targetParentDir?: string }) => Promise<MigrateWorkspaceResult>

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
  ) => Promise<{
    ok: boolean
    project?: Project
    error?: string
    /** 第 6 批：改名连带改了磁盘文件夹时返回（界面可提示改了什么） */
    renamed?: { from: string; to: string; paths: number }
  }>
  removeProject: (
    id: number,
    action: { moveTo: number | null }
  ) => Promise<{ ok: boolean; moved: number; error?: string; movedToRoot?: boolean }>
  moveProject: (
    id: number,
    direction: 'up' | 'down'
  ) => Promise<{ ok: boolean; moved: boolean; error?: string }>

  createPack: (input: {
    name?: string
    projectId?: number | null
    category?: string
  }) => Promise<{ ok: boolean; pack?: PackCard; error?: string }>
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
