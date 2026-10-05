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
  /** 第 23 批（docs/29）：任务的「使用场景」（标签名字） */
  channel: string
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
  /** 第 23 批（docs/29）：任务的「使用场景」（标签名字） */
  channel?: string
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
  /** 第 23 批（docs/29）：被多少个任务（包）使用 —— 左栏数字 = 任务数 + 文件数 */
  packCount: number
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
  /** 第 18 批：全量设计师（多设计师；空数组 = 未指派；含 userid 供多选 UI 勾选/移除） */
  designers: Array<{ userid: string; name: string }>
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
  /** 第 19 批：本地扩展字段（印刷金额 / 绩效金额 / 备注，只存本地） */
  metrics: TicketMetrics
  /** 第 19 批：工单队列「缩略图」image 列同步来的 URL */
  thumbUrl: string | null
}

/** 第 19 批：工单本地扩展字段（docs/22 §3，只存本地不进工单队列） */
export interface TicketMetrics {
  printCost: number | null
  performanceCost: number | null
  remark: string | null
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
  /** 第 17 批（docs/19 §10 #3）：允许在本机指派设计师（本机开关，默认关） */
  allowAssign: boolean
  /** 第 17 批：未指派存量数（顶栏徽标，口径 = 「未指派」筛选） */
  unassignedCount: number
  /** 第 17 批：表格链接（详情弹窗「在表格中打开」逃生口） */
  tableUrl: string | null
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
  /** 第 17 批：本轮同步新入库的未指派单数（提示条 + toast） */
  newUnassigned: number
  warnings: string[]
}

// ---------------- 第 17 批：设计师指派（docs/19） ----------------

/** 候选设计师（历史工单设计师去重 + 在办单数） */
export interface DesignerCandidate {
  userid: string
  name: string
  /** 在办单数（非历史、非删行、审批中/已通过） */
  activeCount: number
}

/** 详情弹窗指派区的原料 */
export interface TicketAssignInfo {
  /** 本机开关是否开启（关 = 只读提示） */
  allow: boolean
  /** 设计师成员列可用吗（同步时检测；false = 入口置灰 + 提示） */
  designerColOk: boolean
  candidates: DesignerCandidate[]
  /** 表格链接（「在表格中打开」逃生口） */
  tableUrl: string | null
}

/** 一次指派的结果（toast 的原料） */
export interface TicketAssignResult {
  /** 本地指派是否生效 */
  ok: boolean
  msg?: string
  /** 写回企微表是否成功（失败保 pending，下次同步自动补写） */
  writeOk: boolean
  writeError?: string
  /** 通知状态（写回成功才有） */
  notifyState: 'sent' | 'failed' | null
  designerName?: string
}

// ---------------- 第 19 批：导出报表（docs/22） ----------------

/** 任务包「完成任务」的结果（生成缩略图 + 写回工单队列） */
export interface TicketCompleteResult {
  ok: boolean
  msg?: string
  ticketNo?: string
}

/** 报表配置状态（导出弹窗预填链接 / 模板子表名） */
export interface ReportStatus {
  docid: string | null
  templateSheet: string
}

/** 一次导出报表的结果（toast 的原料） */
export interface ExportReportResult {
  ok: boolean
  /** 新建的子表名（= 起止日期） */
  sheetTitle?: string
  /** 导出的条数 */
  count?: number
  /** 字段缺失 / 类型不符 / 选项缺失的警告（不阻断导出） */
  fieldWarnings?: string[]
  kind?: 'cli-missing' | 'auth-expired' | 'unknown' | 'bad-link'
  error?: string
}

// ---------------- 第 20 批：清理已禁用子表工单（docs/24） ----------------

/** 清理预览（只算不删）：设置弹窗二次确认用 */
export interface TicketPurgePreview {
  /** 将被清理的条数（来自已关闭子表、且没有任务包） */
  removable: number
  /** 有任务包、跳过不删的条数 */
  packedSkipped: number
  /** 已关闭（未启用）的子表标题 */
  sheets: string[]
}

/** 一次清理的结果 */
export interface TicketPurgeResult extends TicketPurgePreview {
  removed: number
  /** 留痕备份文件路径（什么都没删时为 null） */
  backupPath: string | null
  error?: string
}

// ---------------- 第 21 批：企微连接（wecom-cli 内置 + 扫码授权，docs/16 §4） ----------------

/** CLI 从哪来（界面「企业微信连接」里显示，排查"为什么用不了"时一眼看出） */
export type WecomCliSource = 'env-exe' | 'bundled' | 'env-js' | 'dev-js'

/** 授权状态四态：查不到就说查不到（unknown），不猜 */
export type WecomAuthState = 'authorized' | 'unauthorized' | 'unknown' | 'cli-missing'

/** 一次连接状态快照 */
export interface WecomCliInfo {
  /** 内置组件可用（找得到可执行文件） */
  available: boolean
  source: WecomCliSource | null
  /** 组件位置（悬停提示用；不主动展示路径给不关心的用户） */
  path: string
  version: string | null
  auth: WecomAuthState
}

/** 发起授权的结果：拿到二维码图（data URL）就算成功，扫码是用户的事 */
export interface WecomAuthStart {
  ok: boolean
  /** 二维码 PNG 的 data URL（直接喂 <img src>） */
  qr?: string
  /** CLI 原始输出（出错时给用户看，便于自助排查） */
  log: string
  error?: string
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
    /** 第 23 批（docs/29）：任务的「使用场景」 */
    channel?: string
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

  // ---------------- 第 17 批：设计师指派（docs/19） ----------------
  /** 详情弹窗指派区原料：开关 / 列可用性 / 候选池 / 表格链接 */
  ticketAssignInfo: () => Promise<TicketAssignInfo>
  /** 指派设计师（本地即时生效 → 标 pending → 异步写回 → 通知） */
  ticketAssignDesigner: (input: { ticketNo: string; designers: Array<{ userid: string; name: string }> }) => Promise<TicketAssignResult>
  /** 工单设置：允许在本机指派设计师 开关 */
  ticketSetAllowAssign: (v: boolean) => Promise<{ ok: boolean; allow: boolean }>
  /** 未指派存量数（顶栏徽标） */
  ticketUnassignedCount: () => Promise<number>

  // ---------------- 第 19 批：导出报表（docs/22） ----------------
  /** 读工单本地扩展字段（印刷金额 / 绩效金额 / 备注） */
  ticketMetricsGet: (ticketNo: string) => Promise<TicketMetrics>
  /** 写工单本地扩展字段（upsert；三值全空删行） */
  ticketMetricsSet: (input: {
    ticketNo: string
    printCost: number | null
    performanceCost: number | null
    remark: string | null
  }) => Promise<{ ok: boolean }>
  /** 任务包「完成任务」：生成缩略图 + 写回工单队列 */
  ticketCompleteByPack: (packId: number) => Promise<TicketCompleteResult>
  /** 报表配置状态（预填导出弹窗） */
  reportStatus: () => Promise<ReportStatus>
  /** 导出报表：起止日期 → 建子表 → 写记录 */
  reportExport: (input: { link: string; start: string; end: string }) => Promise<ExportReportResult>

  // ---------------- 第 20 批：清理已禁用子表工单（docs/24） ----------------
  /** 只算不删：已关闭子表的工单里，多少条可清理 / 多少条因有任务包会跳过 */
  ticketPurgePreview: () => Promise<TicketPurgePreview>
  /** 真删：清理已关闭子表同步进来的工单（删前留痕，有任务包的跳过） */
  ticketPurgeDisabled: () => Promise<TicketPurgeResult>

  // ---------------- 第 15 批：交付打包（M5） ----------------
  /** 执行打包，生成 zip 并写交付记录 */
  packExport: (input: PackExportInput) => Promise<PackExportResult>
  /** 读取某任务的交付记录 */
  packDeliveryRecords: (packId: number) => Promise<DeliveryRecord[]>
  /** 弹系统选目录对话框，用于选择打包输出位置 */
  pickOutputDir: (defaultPath?: string) => Promise<{ ok: boolean; canceled?: boolean; dir?: string; error?: string }>

  // ---------------- 第 21 批：企微连接（wecom-cli 内置 + 扫码授权） ----------------
  /** 连接状态快照（组件在不在 / 从哪来 / 版本 / 授权了没 + 引导是否已弹过） */
  wecomCliInfo: () => Promise<WecomCliInfo & { onboardSeen: boolean }>
  /** 只读授权状态（引导页轮询用） */
  wecomAuthStatus: () => Promise<{ auth: WecomAuthState }>
  /** 发起扫码授权：返回二维码 data URL */
  wecomAuthStart: () => Promise<WecomAuthStart>
  /** 取消授权（关弹窗 / 点取消） */
  wecomAuthCancel: () => Promise<{ ok: boolean }>
  /** 读本机企微身份（只回名字，不回 userid） */
  wecomIdentity: () => Promise<{ ok: boolean; name?: string; error?: string }>
  /** 标记首次启动引导已看过（只影响自动弹窗） */
  wecomOnboardSeen: () => Promise<{ ok: boolean }>
}
