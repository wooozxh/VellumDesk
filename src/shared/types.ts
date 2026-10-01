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
  /** 第 8 批：这个包里文件已丢失的条数（卡片角标 ⚠ N） */
  missingCount: number
  /** 第 9 批（M6）：共几稿；0 = 老包（界面不显示版本行） */
  versionCount: number
  /** 第 9 批（M6）：当前版本的编号（1 → V1）；没有版本时为 null */
  currentSeq: number | null
  /** 第 15 批（M5）：是否至少有一稿已交付 */
  hasDelivered: boolean
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
  /** 第 8 批：null = 正常；有值 = 该时刻发现文件已丢失（M8-03） */
  missing_at: string | null
  /** 第 9 批：属于哪一稿（pack_versions.id）；null = 未分版本（老包 / 包根散文件） */
  version_id: number | null
  /** 第 9 批：这一稿的编号（IPC 层带上来的派生字段，界面直接用；未分版本为 null） */
  versionSeq?: number | null
  /** 第 9 批：这一稿是不是当前版本 */
  versionCurrent?: boolean
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
  /** 第 7 批：已解绑的项目（左栏「已解绑 N 个项目」入口用） */
  unboundProjects: UnboundProject[]
  projectColors: string[]
  subFolders: string[]
  unassigned: number
  /** 第 8 批：可见素材里文件已丢失的条数（左栏「⚠️ 文件已丢失」入口用） */
  missing: number
  /**
   * 第 6 批：刚把目录结构升级到三级时才有值 —— 界面弹一次提示条，
   * 调 wsAckLayout 之后就没了。
   */
  layoutMigrated?: { at: string; packs: number }
}

// ==================== 第 7 批：记录生命周期（docs/09） ====================

/** 已解绑的项目（archived = 1）：软件里隐身，本地文件全在 `_已解绑的项目` */
export interface UnboundProject extends Project {
  packCount: number
  fileCount: number
  /** 取自库里的文件大小合计 */
  totalSize: number
}

/** 改包信息（名称 / 类别 / 所属项目）；改项目 = 搬文件夹 */
export interface UpdatePackPatch {
  name?: string
  category?: string
  /** 传 null = 变成「待归类」（搬回工作区根目录） */
  projectId?: number | null
}

export interface UpdatePackResult {
  ok: boolean
  error?: string
  /** 真的搬了文件夹时返回（旧路径 / 新路径 / 重写了几条记录） */
  moved?: { from: string; to: string; paths: number }
}

/** 删除项目的结果（toTrash 分支会多带两个字段） */
export interface RemoveProjectResult {
  ok: boolean
  moved: number
  error?: string
  movedToRoot?: boolean
  toTrashPath?: string
  deletedPacks?: number
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
  total: { packs: number; files: number; size: number; unassigned: number; missing: number }
}

export interface PackDetail {
  pack: PackCard
  groups: Record<string, AssetItem[]>
  subFolders: string[]
  /** 第 9 批（M6）：这个包的全部稿（按 seq 倒序，当前版本排最前）。
   *  界面一次拿全、自己按 version_id 过滤 —— 一个包几十条，不必来回问主进程 */
  versions: PackVersion[]
}

// ==================== 第 9 批：版本管理（M6，docs/11） ====================

/**
 * 包里的「一稿」。一稿 = 包文件夹下的一个文件夹（软件建的叫 V1/V2/V3，用户绑定的可以任意名）。
 * 磁盘是唯一真相：`folderExists` 为 false 表示那个文件夹已经不在磁盘上了（被改名或删了）。
 */
export interface PackVersion {
  id: number
  pack_id: number
  /** 第几稿：1 → 界面显示 V1 */
  seq: number
  /** 磁盘上的真实文件夹名 */
  folder_name: string
  /** 版本说明：这一稿改了什么 */
  note: string
  is_current: number
  delivered_at: string | null
  created_at: string
  // ---- 界面用的派生字段 ----
  folder_path: string
  /** 这一稿里有几个文件（含已丢失的） */
  fileCount: number
  /** 这一稿占用（不含已丢失的，口径与第 8 批一致） */
  totalSize: number
  missingCount: number
  folderExists: boolean
}

export interface CreateVersionInput {
  packId: number
  /** 版本说明：这一稿改了什么 */
  note?: string
  /**
   * 把包里现有的、还没分版本的文件收进这一稿（搬进对应的三组里）。
   * 界面在「包里还没有任何版本、且三组里确实有文件」时默认勾上。
   */
  takeExisting?: boolean
  /** 把哪一稿的文件复制一份进来（默认不复制：大包复制一份可能多占几个 GB） */
  copyFromVersionId?: number
}

/** 可绑定成版本的文件夹（包文件夹下还没被认领的子文件夹） */
export interface BindableFolder {
  folderName: string
  /** 软件建议的编号：文件夹名是 V3 就用 3（没被占时），否则给"下一个可用编号" */
  suggestedSeq: number
  fileCount: number
}

export interface BindVersionInput {
  packId: number
  folderName: string
  /** 编号由用户确认（可改）；撞上已占用的编号会被拒绝 */
  seq: number
  note?: string
}

export interface ScanResult {
  packs: number
  files: number
  unassigned: number
  newFiles: number
  thumbs: number
  /** 第 7 批：本轮摘掉了几个"文件夹已不在磁盘上"的包记录 */
  cleanedPacks: number
  /** 第 8 批：本轮新标记为「文件已丢失」的素材条数 */
  markedMissing: number
  /** 第 8 批：本轮找回（清除丢失标记）的素材条数 */
  restored: number
  /** 第 9 批（M6）：本轮自动认出的新稿数（用户自己在资源管理器里建的 V3 文件夹） */
  newVersions: number
  /** 第 9 批（M6）：编号冲突提示 —— 名字像版本号但那个编号已经被别的文件夹占着，不自动认 */
  versionConflicts: string[]
}

/**
 * 第 14 批：刷新扫描的**阶段进度**（全项目第一条主 → 渲染推送通道）。
 *
 * 为什么有它：扫描 → 缩略图 → 四类元信息整条链路在一个 IPC 里跑完，
 * 大库 + 视频多时用户要干等好几分钟，此前界面只有一个转圈按钮。
 */
export interface ScanProgress {
  stage: 'scan' | 'thumbs' | 'meta'
  /** 阶段名（取自文案字典，界面直接显示） */
  label: string
  /** 已处理条数（含失败）。scan 阶段恒为 0 —— 目录扫描是同步的，拿不到细粒度 */
  done: number
  /** 总条数；0 表示进度不确定（只显示阶段名） */
  total: number
}

/**
 * 第 8 批 M8-03：批量重新定位的候选（只出清单，用户勾选后才落库）。
 * `matchedPath` 为 null 表示这条没配上或校验不过，`reason` 里写清原因。
 */
export interface RelocateSuggestion {
  assetId: number
  fileName: string
  oldRelPath: string
  matchedPath: string | null
  ok: boolean
  reason: string
}

export interface ClaimResult {
  ok: boolean
  moved: number
  errors: string[]
}

// ==================== 第 15 批：交付打包（M5，docs/18） ====================

export interface PackExportInput {
  packId: number
  /** 版本选择模式 */
  versionMode: 'current' | 'specific' | 'all'
  /** specific 模式下必填 */
  specificVersionId?: number | null
  /** 分组选择 */
  roles: string[]
  /** 用户取消勾选的文件 asset.id 数组 */
  excludedAssetIds?: number[]
  /** 目标目录 */
  outputDir: string
  /** 压缩包文件名（不含 .zip） */
  zipName: string
  /** 是否在压缩包内加一层同名文件夹 */
  wrapFolder: boolean
  /** 尺寸，如 1920x1080 */
  size: string
  /** 是否保留原文件名主干 */
  keepOriginalName: boolean
  /** 用户自定义文件名模板，空则用默认规则 */
  customNameTemplate?: string
}

export interface PackExportResult {
  ok: boolean
  outputPath?: string
  fileCount?: number
  totalSize?: number
  error?: string
}

export interface DeliveryRecord {
  id: number
  pack_id: number
  version_id: number | null
  scope_json: string
  files_json: string
  output_path: string
  output_size: number
  file_count: number
  created_at: string
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

// ---------------- 第 13 批：工单（docs/15） ----------------

export type TicketType = 'print' | 'digital'

/** 工单列表一行（工单面板用；列表筛选在主进程做，257+ 条也不卡） */
export interface TicketListItem {
  id: number
  ticketNo: string
  ticketType: TicketType
  title: string | null
  approvalState: string | null
  designerName: string | null
  applicantName: string | null
  projectName: string | null
  dueDate: string | null
  submitTime: string | null
  /** 历史单（首次同步快照之前就在表里的，永不自动建任务） */
  isHistory: boolean
  /** 子表重建后的新单，等「确认这批新单」放行 */
  needConfirm: boolean
  /** 表里这行被删了（留底） */
  rowGone: boolean
  dupWarn: boolean
  reassignedTo: string | null
  /** 关联任务（null = 没建） */
  packId: number | null
  packName: string | null
  /** 任务所属项目（null = 待归类）；「项目未匹配」= 工单有 project_name 但 pack 还没建 */
  packProjectId: number | null
}

/** 工单详情（点一行弹出来；比列表多的字段全在这） */
export interface TicketDetail extends TicketListItem {
  applicantName: string | null
  department: string | null
  purpose: string | null
  sizeText: string | null
  printQty: number | null
  materialForm: string | null
  useScene: string | null
  doneTime: string | null
  remark: string | null
  sourceUrl: string | null
  approvalUrl: string | null
  receiverName: string | null
  receiverPhone: string | null
  deliverDate: string | null
  reviewerNames: string | null
  materialCategory: string | null
  /** 本机视角：这是不是我的单（设计师 userid = 本机身份） */
  mine: boolean
  /** 关联任务的物料概况（文件数 / 最近更新），没建任务为 null */
  packSummary: { fileCount: number; lastUpdate: string | null } | null
}

/** 工单配置（设置弹窗 + 未配置判定用） */
export interface TicketStatus {
  /** 配置过 docid 且至少启用一个子表 = true */
  configured: boolean
  docid: string | null
  /** 表格名（saveConfig 探测成功时带回来过；纯展示） */
  docName: string | null
  sheets: Array<{
    title: string
    sheetId: string
    type: TicketType
    enabled: boolean
  }>
  identity: { userid: string; name: string } | null
  firstSyncDone: boolean
}

/** 保存配置（探活：列子表 + 读授权身份，通了才落库） */
export interface TicketSaveConfigResult {
  ok: boolean
  docid?: string
  docName?: string
  sheets?: Array<{ title: string; sheetId: string; type: TicketType; enabled: boolean }>
  identity?: { userid: string; name: string }
  /** cli-missing / auth-expired / unknown / bad-link */
  kind?: 'cli-missing' | 'auth-expired' | 'unknown' | 'bad-link'
  error?: string
}

/** 一次同步的结果（toast 用；字段与主进程 SyncResult 一致） */
export interface TicketSyncResult {
  ok: boolean
  kind?: 'cli-missing' | 'auth-expired' | 'unknown'
  error?: string
  structureChanged: boolean
  inserted: number
  updated: number
  historyMarked: number
  tasksCreated: number
  projectMismatch: number
  reassigned: number
  rowGone: number
  rowBack: number
  needConfirm: number
  dupWarned: number
  warnings: string[]
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
    action: { moveTo: number | null; toTrash?: boolean }
  ) => Promise<RemoveProjectResult>
  moveProject: (
    id: number,
    direction: 'up' | 'down'
  ) => Promise<{ ok: boolean; moved: boolean; error?: string }>

  // ---------------- 第 7 批：记录生命周期 ----------------
  /** 解绑项目（结项留底：软件里不显示、本地文件全保留、可还原） */
  unbindProject: (
    id: number
  ) => Promise<{ ok: boolean; packs: number; error?: string; movedTo?: string }>
  /** 还原已解绑的项目 */
  restoreProject: (id: number) => Promise<{ ok: boolean; error?: string }>
  /** 改包信息：名称 / 类别 / 所属项目（改项目 = 搬文件夹；projectId 传 null = 待归类） */
  updatePack: (id: number, patch: UpdatePackPatch) => Promise<UpdatePackResult>

  // ---------------- 第 8 批：重新定位（M8-03） ----------------
  /** 单条重新定位：弹系统文件选择框 → 校验（文件名 + 扩展名 + 大小）→ 通过才落库 */
  relocateAsset: (
    assetId: number
  ) => Promise<{ ok: boolean; error?: string; relPath?: string; canceled?: boolean }>
  /** 批量第一步：选一个目录 */
  pickRelocateDir: () => Promise<{ ok: boolean; canceled?: boolean; dir?: string }>
  /** 批量第二步：出候选清单（只读，不落库） */
  relocateSuggest: (dir: string) => Promise<{ ok: boolean; items: RelocateSuggestion[] }>
  /** 批量第三步：用户勾选后才写 */
  relocateApply: (
    items: Array<{ assetId: number; newAbsPath: string }>
  ) => Promise<{ moved: number; errors: string[] }>

  // ---------------- 第 9 批：版本管理（M6） ----------------
  /** 某包的全部稿（含文件数 / 占用 / 文件夹是否还在） */
  listVersions: (packId: number) => Promise<PackVersion[]>
  /**
   * 新建一稿：建 `V<n>/` + 三组空文件夹（可选收编包里现有文件、可选复制上一稿），新稿自动成为当前版本。
   * 搬文件是 rename + 在原记录上重写路径（绝不做"删旧建新"，否则 asset.id 一变标签就丢）。
   */
  createVersion: (
    input: CreateVersionInput
  ) => Promise<{ ok: boolean; version?: PackVersion; error?: string; moved?: number }>
  /** 绑定候选：这个包文件夹下还没被认领的子文件夹 */
  listBindableFolders: (packId: number) => Promise<BindableFolder[]>
  /** 把用户自己建好的文件夹绑定成某一稿（编号可改；撞号会被拒绝） */
  bindVersion: (input: BindVersionInput) => Promise<{ ok: boolean; version?: PackVersion; error?: string }>
  /** 解绑：只解除管理关系，**文件夹和文件一个都不动** */
  unbindVersion: (versionId: number) => Promise<{ ok: boolean; error?: string }>
  /** 设为当前版本（= M6-05 回滚）；纯库操作，磁盘零改动 */
  setCurrentVersion: (versionId: number) => Promise<{ ok: boolean; error?: string }>

  createPack: (input: {
    name?: string
    projectId?: number | null
    category?: string
  }) => Promise<{ ok: boolean; pack?: PackCard; error?: string }>
  refreshScan: () => Promise<ScanResult>
  /**
   * 第 14 批：订阅「刷新扫描」的阶段进度推送。返回**退订函数**（组件卸载时务必调用）。
   * 这是全项目第一条主 → 渲染推送通道 —— 其余接口仍是 invoke 请求-应答。
   */
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void
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
    /** 第 8 批：只看文件已丢失的（M8-03） */
    missingOnly?: boolean
    /** 第 9 批（M6）：只看当前那一稿的文件（工具栏「只看当前稿」开关）。
     *  未分版本的老文件**不算**当前版本的文件，开关打开时它们不显示 */
    currentOnly?: boolean
  }) => Promise<{ items: AssetItem[]; total: number }>
  packDetail: (packId: number) => Promise<PackDetail>
  claim: (args: {
    paths: string[]
    packId: number
    subFolder: string
    /** 第 9 批（M6）：搬进「某一稿」的组里。
     *  传数字 = 搬进那一稿；传 null = 明确落「未分版本」（包根三组）；
     *  **不传** = 自动：包有当前版本就落当前版本（新建包默认有 V1） */
    versionId?: number | null
  }) => Promise<ClaimResult>
  openFile: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  revealFile: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  openFolder: (p: string) => Promise<{ ok: boolean; error?: string }>

  // ---------------- 第 3 批：标签 ----------------
  /** 各维度 + 每个维度的标签（带使用计数）。
   *  计数口径跟随左栏当前项目范围：不传 = 全部；`projectId: 数字` = 该项目；`projectId: null` = 待归类 */
  listTagDimensions: (scope?: { projectId?: number | null }) => Promise<DimensionGroup[]>
  createTag: (input: {
    dimension: string
    name: string
    color?: string
  }) => Promise<{ ok: boolean; tag?: Tag; error?: string }>
  /** 第 10 批：改「物料类别」的名字时，`packsUpdated` = 跟着改掉的包数 */
  updateTag: (
    id: number,
    patch: { name?: string; color?: string }
  ) => Promise<{ ok: boolean; tag?: Tag; packsUpdated?: number; error?: string }>
  /** 第 10 批：删「物料类别」时，`packsAffected` = 类别被归到「未分类」的包数 */
  removeTag: (
    id: number
  ) => Promise<{ ok: boolean; deleted: number; packsAffected?: number; error?: string }>
  /** 删除前看该标签被多少素材使用（`packCount` = 有多少个包的类别正是它） */
  tagUsage: (id: number) => Promise<{ assetCount: number; packCount: number }>
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

  // ---------------- 第 13 批：工单（docs/15） ----------------
  /** 工单配置状态（不碰 CLI，只读本地 meta；未配置时界面走引导） */
  ticketStatus: () => Promise<TicketStatus>
  /** 保存配置：粘链接（自动剥 docid）→ 探活（列子表 + 读授权身份）→ 落库 */
  ticketSaveConfig: (input: {
    linkOrDocid: string
    sheets: Array<{ title: string; type: TicketType; enabled: boolean }>
  }) => Promise<TicketSaveConfigResult>
  /** 手动同步（拉两个子表 → 结构校验 → applySync）。一期唯一的拉取入口 */
  ticketSync: () => Promise<TicketSyncResult>
  /** 工单列表（筛选在主进程做） */
  ticketList: (view?: 'all' | 'mine' | 'unassigned' | 'history' | 'reassigned' | 'pending' | 'abnormal') => Promise<TicketListItem[]>
  /** 工单详情 */
  ticketDetail: (ticketNo: string) => Promise<TicketDetail | null>
  /** 「确认这批新单」批量放行（§2.2④） */
  ticketConfirmBatch: () => Promise<{ confirmed: number; tasksCreated: number; warnings: string[] }>
  /** 历史单/异常单的手动「补建任务」兜底按钮 */
  ticketCreateTask: (
    ticketNo: string
  ) => Promise<{ ok: boolean; packId?: number; packName?: string; msg?: string }>
  /** 打开审批链接（浏览器） */
  ticketOpenApproval: (url: string) => Promise<{ ok: boolean; error?: string }>

  // ---------------- 第 15 批：交付打包（M5） ----------------
  /** 执行打包，生成 zip 并写交付记录 */
  packExport: (input: PackExportInput) => Promise<PackExportResult>
  /** 读取某任务的交付记录 */
  packDeliveryRecords: (packId: number) => Promise<DeliveryRecord[]>
  /** 弹系统选目录对话框，用于选择打包输出位置 */
  pickOutputDir: (defaultPath?: string) => Promise<{ ok: boolean; canceled?: boolean; dir?: string; error?: string }>
}
