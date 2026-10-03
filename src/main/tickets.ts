/**
 * 第 13 批（工单模块，docs/15-工单模块方案.md）：同步引擎。
 *
 * 架构铁律（§4.3）：**同步核心不碰网络**。wecom-cli 是一个"给记录的适配器"（见
 * ticketsWecom.ts），把拉回来的原始记录喂给这里的 applySync；自动测试全部喂假数据，
 * 真企微只在人工验收时点一次 —— 真实外部依赖不进自动测试。
 *
 * 三条核心规则（docs/15 §2.2，全部用户拍板过，别改）：
 *  ① 唯一键 = 审批单编号（单键）。sheet_id 只是"出生地"属性 —— 用户会重新拉表
 *     （子表重建后 sheet_id 全变），按编号匹配则旧单原地更新，任务 / 历史标记 / 关联全不动。
 *  ② 建任务条件链：设计师=本机身份 且 状态∈{审批中, 已通过} 且 非历史单 且 非待确认。
 *     （审批流两道：一审过就开工，二审过时活已干完 —— 所以"审批中"就要建。）
 *  ③ 历史单 = 首次同步快照时已在表里的单，永不建任务；表里不加任何标记列。
 *  ④ 子表重建（标题对上、sheet_id 变了）→ 新出现的编号全标「待确认」不自动建任务，
 *     由工单面板「确认这批新单」批量放行 —— 出错方向是安全的（宁可不建，绝不误建）。
 *
 * 另一条用户拍板（2026-10-01）：驳回 / 撤销 → 任务与文件完整保留，软件只报告事实。
 */
import { COPY, fmt } from '../shared/copy'
import { getDb, getMeta, setMeta } from './db'
import { createPack } from './workspace'
import { join } from 'path'
import { ensureAnyThumb } from './thumbs'

// ============================================================ 类型

export type TicketType = 'print' | 'digital'

/** 企微侧的子表引用（sheets list 拿到的） */
export interface WecomSheetRef {
  sheet_id: string
  title: string
}

/** 配置里一个启用的子表：标题为主键，sheet_id 只是缓存指纹（docs/15 §5） */
export interface TicketSheetConfig {
  title: string
  sheet_id: string
  type: TicketType
  enabled: boolean
}

/** 适配器喂进来的一条原始记录（wecom-cli records list 的单条） */
export interface TicketRawRecord {
  record_id: string
  values: Record<string, unknown>
}

/** 一个子表的全量记录（适配器翻页拉完后的成品） */
export interface SheetPayload {
  sheet_id: string
  title: string
  type: TicketType
  records: TicketRawRecord[]
}

/** 本机身份（读自 wecom-cli 授权，meta 键 ticket_identity） */
export interface TicketIdentity {
  userid: string
  name: string
}

/** 一次同步的结果（toast / 界面展示的原料） */
export interface SyncResult {
  ok: boolean
  /** 子表重建（标题对上、sheet_id 变了）—— 本次新单全标待确认 */
  structureChanged: boolean
  /** 配置里启用、但表里找不到标题的子表 */
  missingSheets: string[]
  inserted: number
  updated: number
  /** 首次快照标了多少张历史单 */
  historyMarked: number
  tasksCreated: number
  /** 项目未匹配（暂不建任务，对齐后下轮自动补建） */
  projectMismatch: number
  reassigned: number
  rowGone: number
  rowBack: number
  needConfirm: number
  dupWarned: number
  /** 第 17 批（docs/19 §3）：本轮同步新入库且未指派、非历史非待确认的单数（提示条用） */
  newUnassigned: number
  warnings: string[]
}

// ============================================================ meta 配置键（docs/15 §5）

export const META_KEYS = {
  docid: 'ticket_docid',
  docname: 'ticket_docname',
  sheets: 'ticket_sheets',
  identity: 'ticket_identity',
  firstSyncDone: 'ticket_first_sync_done',
  /** 第 17 批（docs/19 §8）：设计师成员列的列名（读写同源，默认「设计师」） */
  designerCol: 'ticket_designer_col',
  /** 第 17 批：允许在本机指派设计师（'1'/'0'，默认关 —— 派单的人自己在工单设置里开） */
  allowAssign: 'ticket_allow_assign',
  /** 第 17 批：设计师列可用性（'0' = 同步时检测到列缺失/不是成员类型；未设 = 视为可用） */
  designerOk: 'ticket_designer_ok'
} as const

/** 设计师成员列的列名（meta 配置，默认「设计师」；改列名只改这一处，读写同源） */
export function designerColName(): string {
  return getMeta(META_KEYS.designerCol) || '设计师'
}

/** 本机是否允许指派设计师（docs/19 §10 #3：开关即门槛，不做身份校验） */
export function allowAssignEnabled(): boolean {
  return getMeta(META_KEYS.allowAssign) === '1'
}

export function setAllowAssignEnabled(v: boolean): void {
  setMeta(META_KEYS.allowAssign, v ? '1' : '0')
}

/** 设计师列可用吗（同步时检测；未同步过 = 不设防，写失败有 toast 兜底） */
export function designerColUsable(): boolean {
  return getMeta(META_KEYS.designerOk) !== '0'
}

export function readTicketConfig(): {
  docid: string | null
  docName: string | null
  sheets: TicketSheetConfig[]
  identity: TicketIdentity | null
  firstSyncDone: boolean
} {
  const sheetsRaw = getMeta(META_KEYS.sheets)
  let sheets: TicketSheetConfig[] = []
  if (sheetsRaw) {
    try {
      sheets = JSON.parse(sheetsRaw) as TicketSheetConfig[]
    } catch {
      sheets = []
    }
  }
  const idRaw = getMeta(META_KEYS.identity)
  let identity: TicketIdentity | null = null
  if (idRaw) {
    try {
      identity = JSON.parse(idRaw) as TicketIdentity
    } catch {
      identity = null
    }
  }
  return {
    docid: getMeta(META_KEYS.docid),
    docName: getMeta(META_KEYS.docname),
    sheets,
    identity,
    firstSyncDone: getMeta(META_KEYS.firstSyncDone) === '1'
  }
}

export function writeTicketSheets(sheets: TicketSheetConfig[]): void {
  setMeta(META_KEYS.sheets, JSON.stringify(sheets))
}

// ============================================================ 结构校验（docs/15 §2.2 ④）

export interface StructureCheck {
  /** 标题对上但 sheet_id 变了 = 子表被重建过 */
  structureChanged: boolean
  /** 配置启用、但表里找不到的子表标题 */
  missingSheets: string[]
  /** 匹配结果：cfg + 该子表当前的 sheet_id（可能已变，调用方应回写配置缓存） */
  resolved: Array<{ cfg: TicketSheetConfig; sheet_id: string }>
}

export function detectStructure(cfgSheets: TicketSheetConfig[], actual: WecomSheetRef[]): StructureCheck {
  let structureChanged = false
  const missingSheets: string[] = []
  const resolved: StructureCheck['resolved'] = []
  for (const cfg of cfgSheets) {
    if (!cfg.enabled) continue
    const hit = actual.find((s) => s.title === cfg.title)
    if (!hit) {
      missingSheets.push(cfg.title)
      continue
    }
    if (hit.sheet_id !== cfg.sheet_id) structureChanged = true
    resolved.push({ cfg, sheet_id: hit.sheet_id })
  }
  return { structureChanged, missingSheets, resolved }
}

// ============================================================ 字段抽取（docs/15 §3）

/** 表列名 → 软件字段的列名清单（改列名只改这里；映射按列名配对，不按位置） */
const COL = {
  no: '审批单编号',
  title: '物料名称',
  state: '当前审批状态',
  applicant: '申请人',
  dept: '申请部门',
  purpose: '物料申请用途',
  due: '交稿日期',
  done: '完成时间',
  size: '尺寸',
  qty: '印制数量',
  form: '物料形态',
  source: '素材/内容',
  link: '审批链接',
  remark: '备注',
  submit: '提交时间',
  recvName: '收货人姓名',
  recvPhone: '收货人电话',
  deliver: '送达日期',
  designer: '设计师',
  project: '业务归属',
  reviewer: '物料审核人',
  matCat: '物料类别',
  useScene: '物料使用场景',
  // 第 19 批（docs/22 §4）：工单队列的「缩略图」image 列（设计师完成任务时写回，导出报表复用）
  thumb: '缩略图'
} as const

/** 企微智能表格的单元格值 → 纯文本（值是 [{text:…}] 数组；日期可能是毫秒数） */
function takeText(v: unknown): string | null {
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    const first = v[0]
    if (first && typeof first === 'object') {
      const o = first as Record<string, unknown>
      if (typeof o.text === 'string' && o.text !== '') return o.text
      if (typeof o.link === 'string' && o.link !== '') return o.link
      return null
    }
    return takeText(first)
  }
  if (typeof v === 'string') return v === '' ? null : v
  return null
}

/** 超链接单元格 → 真实网址。只收 http/https 开头的值：
 * 超链接单元格是 [{text: 显示文字, link: 网址}] —— takeText 会错拿显示文字（如「点击查看」），
 * 拿去 shell.openExternal 在 Windows 上会兜底打开资源管理器（第 13 批验收实测）。
 * 优先 link 字段；text 只有本身长得像网址才收。
 * （导出供验收断言：拿显示文字去 openExternal 会打开资源管理器）
 */
export function takeLink(v: unknown): string | null {
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    const first = v[0]
    if (first && typeof first === 'object') {
      const o = first as Record<string, unknown>
      if (typeof o.link === 'string' && /^https?:\/\//i.test(o.link)) return o.link
      if (typeof o.text === 'string' && /^https?:\/\//i.test(o.text)) return o.text
      return null
    }
    return takeLink(first)
  }
  if (typeof v === 'string') return /^https?:\/\//i.test(v) ? v : null
  return null
}

/**
 * 图片单元格 → 图片 URL（第 19 批 docs/22 §4：工单队列「缩略图」image 列）。
 * image 列存 CellImageValue 数组 [{id, title, imageUrl}]，取第一个的 imageUrl。
 * 只收 http/https 的图片资源地址；空数组 / 无图 → null。
 */
function takeImageUrl(v: unknown): string | null {
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    const first = v[0]
    if (first && typeof first === 'object') {
      const url = (first as Record<string, unknown>).imageUrl
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url
      return null
    }
    return takeImageUrl(first)
  }
  if (typeof v === 'string') return /^https?:\/\//i.test(v) ? v : null
  return null
}

/** 人员单元格 → userid + 姓名（成员类型列存 {userId, userName}） */function takeUser(v: unknown): { userid: string | null; name: string | null } {
  if (Array.isArray(v)) {
    if (v.length === 0) return { userid: null, name: null }
    const first = v[0]
    if (first && typeof first === 'object') {
      const o = first as Record<string, unknown>
      return {
        userid: typeof o.userId === 'string' ? o.userId : null,
        name: typeof o.userName === 'string' ? o.userName : null
      }
    }
  }
  return { userid: null, name: null }
}

/** 多人员单元格 → 姓名串（如「张三、李四」，仅展示用） */
function takeUserNames(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  const names: string[] = []
  for (const item of v) {
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).userName === 'string') {
      names.push((item as Record<string, unknown>).userName as string)
    }
  }
  return names.length ? names.join('、') : null
}

/** 多人员单元格 → {userid, name}[]（第 18 批 docs/20 §5：设计师列全量；过滤掉无 userid 的元素） */
function takeUsers(v: unknown): Array<{ userid: string; name: string | null }> {
  if (!Array.isArray(v)) return []
  const out: Array<{ userid: string; name: string | null }> = []
  for (const item of v) {
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const userid = typeof o.userId === 'string' ? o.userId : null
      if (!userid) continue
      out.push({ userid, name: typeof o.userName === 'string' ? o.userName : null })
    }
  }
  return out
}

/** 日期单元格 → ISO 串（企微给毫秒数或文本，都接） */
function takeDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v)
    return isNaN(d.getTime()) ? String(v) : d.toISOString()
  }
  return takeText(v)
}

/** 一条原始记录 → tickets 行的业务字段（raw_json 整包另存，后补映射不用重拉） */
function extractRow(rec: TicketRawRecord): {
  ticket_no: string
  /** 第 18 批（docs/20 §5）：设计师列全量（多选成员列）；单值列降级为 designers[0] 冗余 */
  designers: Array<{ userid: string; name: string | null }>
  fields: Record<string, string | number | null>
} {
  const v = rec.values ?? {}
  // 设计师列名走 meta 配置（读写同源，docs/19 §8）——每次调用读一次 meta，
  // 同步一轮几百条的量级下开销可忽略（better-sqlite3 简单查询 ~10 万次/秒）
  const designers = takeUsers(v[designerColName()])
  const primary = designers[0] ?? { userid: null, name: null }
  const applicant = takeUser(v[COL.applicant])
  const qtyText = takeText(v[COL.qty])
  const qty = qtyText ? parseInt(qtyText.replace(/[^\d]/g, ''), 10) : null
  return {
    ticket_no: takeText(v[COL.no]) ?? '',
    designers,
    fields: {
      title: takeText(v[COL.title]),
      approval_state: takeText(v[COL.state]),
      applicant_userid: applicant.userid,
      applicant_name: applicant.name,
      department: takeText(v[COL.dept]),
      purpose: takeText(v[COL.purpose]),
      size_text: takeText(v[COL.size]),
      print_qty: qty !== null && Number.isFinite(qty) ? qty : null,
      material_form: takeText(v[COL.form]),
      use_scene: takeText(v[COL.useScene]),
      due_date: takeDate(v[COL.due]),
      submit_time: takeDate(v[COL.submit]),
      done_time: takeDate(v[COL.done]),
      remark: takeText(v[COL.remark]),
      source_url: takeLink(v[COL.source]),
      approval_url: takeLink(v[COL.link]),
      receiver_name: takeText(v[COL.recvName]),
      receiver_phone: takeText(v[COL.recvPhone]),
      deliver_date: takeDate(v[COL.deliver]),
      designer_userid: primary.userid,
      designer_name: primary.name,
      project_name: takeText(v[COL.project]),
      reviewer_names: takeUserNames(v[COL.reviewer]),
      material_category: takeText(v[COL.matCat]),
      thumb_url: takeImageUrl(v[COL.thumb])
    }
  }
}

// ============================================================ 设计师子表读写（第 18 批 docs/20 §4）

/** 读一张单的完整设计师集合（按 seq 排序；含 notified 通知标记） */
function designersOf(ticket_no: string): Array<{ userid: string; name: string | null; notified: number }> {
  return getDb()
    .prepare('SELECT userid, name, notified FROM ticket_designers WHERE ticket_no = ? ORDER BY seq')
    .all(ticket_no) as Array<{ userid: string; name: string | null; notified: number }>
}

/**
 * 整表替换一张单的设计师集合（先删后插，同一事务）。
 * 保留「同名 userid 的 notified 状态」——同步重建子表时，已通知过的人不丢通知标记，
 * 新进来的人 notified=0（等通知）。单值列 designer_userid/name 由调用方回写为 designers[0]。
 */
function replaceTicketDesigners(
  ticket_no: string,
  list: Array<{ userid: string; name: string | null }>
): void {
  const db = getDb()
  const oldNotified = new Map(designersOf(ticket_no).map((d) => [d.userid, d.notified]))
  const del = db.prepare('DELETE FROM ticket_designers WHERE ticket_no = ?')
  const ins = db.prepare(
    'INSERT INTO ticket_designers (ticket_no, userid, name, seq, notified) VALUES (?, ?, ?, ?, ?)'
  )
  db.transaction(() => {
    del.run(ticket_no)
    list.forEach((d, i) => ins.run(ticket_no, d.userid, d.name, i, oldNotified.get(d.userid) ?? 0))
  })()
}

// ============================================================ 同步主流程（docs/15 §4.2）

export interface ApplySyncInput {
  payloads: SheetPayload[]
  structureChanged: boolean
  identity: TicketIdentity
  workspaceRoot: string
}

/** 建任务门槛的状态集（§2.2 ②：审批中=一审过就开工，已通过=活已干完也要有记录） */
const TASK_STATES = ['审批中', '已通过']

export function applySync(input: ApplySyncInput): SyncResult {
  const db = getDb()
  const now = new Date().toISOString()
  const res: SyncResult = {
    ok: true,
    structureChanged: input.structureChanged,
    missingSheets: [],
    inserted: 0,
    updated: 0,
    historyMarked: 0,
    tasksCreated: 0,
    projectMismatch: 0,
    reassigned: 0,
    rowGone: 0,
    rowBack: 0,
    needConfirm: 0,
    dupWarned: 0,
    newUnassigned: 0,
    warnings: []
  }

  const firstSyncDone = getMeta(META_KEYS.firstSyncDone) === '1'

  // ---- ① 全部 payload 摊平成行（带出生地信息）----
  interface FlatRow {
    ticket_no: string
    record_id: string
    sheet_id: string
    ticket_type: TicketType
    /** 第 18 批：设计师列全量（多值） */
    designers: Array<{ userid: string; name: string | null }>
    fields: Record<string, string | number | null>
    raw: string
  }
  const flat: FlatRow[] = []
  const emptyNoIds: string[] = []
  for (const p of input.payloads) {
    for (const rec of p.records) {
      const { ticket_no, fields, designers } = extractRow(rec)
      if (!ticket_no) {
        emptyNoIds.push(rec.record_id)
        continue
      }
      flat.push({
        ticket_no,
        record_id: rec.record_id,
        sheet_id: p.sheet_id,
        ticket_type: p.type,
        designers,
        fields,
        raw: JSON.stringify(rec.values ?? {})
      })
    }
  }
  if (emptyNoIds.length) {
    res.warnings.push(
      fmt(COPY.ticket.warnEmptyNo, { n: emptyNoIds.length, ids: emptyNoIds.slice(0, 3).join('、') })
    )
  }
  if (input.structureChanged) {
    res.warnings.push(COPY.ticket.warnStructureChanged)
  }

  // ---- ② 按编号 upsert（批内撞号：第二份存 dup_json + 标 dup_warn，绝不悄悄合并）----
  const seenNos = new Set<string>()
  const selByNo = db.prepare('SELECT * FROM tickets WHERE ticket_no = ?')
  const insTicket = db.prepare(`
    INSERT INTO tickets (sheet_id, ticket_type, ticket_no, record_id,
      title, approval_state, applicant_userid, applicant_name, department,
      purpose, size_text, print_qty, material_form, use_scene,
      due_date, submit_time, done_time, remark, source_url, approval_url,
      receiver_name, receiver_phone, deliver_date,
      designer_userid, designer_name, project_name, reviewer_names, material_category,
      thumb_url, raw_json, first_seen_at, last_sync_at, is_history)
    VALUES (@sheet_id, @ticket_type, @ticket_no, @record_id,
      @title, @approval_state, @applicant_userid, @applicant_name, @department,
      @purpose, @size_text, @print_qty, @material_form, @use_scene,
      @due_date, @submit_time, @done_time, @remark, @source_url, @approval_url,
      @receiver_name, @receiver_phone, @deliver_date,
      @designer_userid, @designer_name, @project_name, @reviewer_names, @material_category,
      @thumb_url, @raw_json, @now, @now, 0)
  `)
  const updTicket = db.prepare(`
    UPDATE tickets SET
      sheet_id = @sheet_id, record_id = @record_id,
      title = @title, approval_state = @approval_state,
      applicant_userid = @applicant_userid, applicant_name = @applicant_name,
      department = @department, purpose = @purpose, size_text = @size_text,
      print_qty = @print_qty, material_form = @material_form, use_scene = @use_scene,
      due_date = @due_date, submit_time = @submit_time, done_time = @done_time,
      remark = @remark, source_url = @source_url, approval_url = @approval_url,
      receiver_name = @receiver_name, receiver_phone = @receiver_phone,
      deliver_date = @deliver_date,
      designer_userid = @designer_userid, designer_name = @designer_name,
      project_name = @project_name, reviewer_names = @reviewer_names,
      material_category = @material_category, thumb_url = @thumb_url,
      raw_json = @raw_json,
      last_sync_at = @now
    WHERE ticket_no = @ticket_no
  `)
  const markDup = db.prepare('UPDATE tickets SET dup_warn = 1, dup_json = ? WHERE ticket_no = ?')
  const dupCounts = new Map<string, number>()

  /** 本轮新插入的编号（建任务判定要看；含是否首次快照） */
  const insertedNos = new Set<string>()

  for (const row of flat) {
    const bind: Record<string, unknown> = {
      sheet_id: row.sheet_id,
      ticket_type: row.ticket_type,
      ticket_no: row.ticket_no,
      record_id: row.record_id,
      raw_json: row.raw,
      now,
      ...row.fields
    }
    if (seenNos.has(row.ticket_no)) {
      // 批内撞号：库里那份不动（可能刚插入），第二份原文存 dup_json —— 两份都留
      markDup.run(row.raw, row.ticket_no)
      dupCounts.set(row.ticket_no, (dupCounts.get(row.ticket_no) ?? 1) + 1)
      continue
    }
    seenNos.add(row.ticket_no)
    const existing = selByNo.get(row.ticket_no) as Record<string, unknown> | undefined
    if (existing) {
      // 第 17 批（docs/19 §5 冲突三态，第 18 批扩展为「集合」）：本机有待写回（上次写回失败
      // 的积压）时，设计师集合**不采纳表值**（本地守住子表，写出去再交权）——本轮同步后自动补写
      if (existing.designer_write_pending === 1) {
        const kept = designersOf(row.ticket_no)
        bind.designer_userid = kept[0]?.userid ?? null
        bind.designer_name = kept[0]?.name ?? null
      } else {
        // 采纳表值：整表替换子表（冗余列已由 row.fields 带出 = 集合第一个）
        replaceTicketDesigners(row.ticket_no, row.designers)
      }
      updTicket.run(bind)
      res.updated++
    } else {
      insTicket.run(bind)
      replaceTicketDesigners(row.ticket_no, row.designers)
      res.inserted++
      insertedNos.add(row.ticket_no)
    }
  }
  for (const [no, n] of dupCounts) {
    res.dupWarned++
    res.warnings.push(fmt(COPY.ticket.warnDupNo, { no, n }))
  }

  // ---- ③ 首次同步快照（§2.2 ③）：本次全部新插入标历史，一张任务都不建 ----
  if (!firstSyncDone) {
    const markHistory = db.prepare(
      'UPDATE tickets SET is_history = 1 WHERE ticket_no = ? AND is_history = 0'
    )
    for (const no of insertedNos) markHistory.run(no)
    res.historyMarked = insertedNos.size
    setMeta(META_KEYS.firstSyncDone, '1')
  }

  // ---- ④ 建任务判定（§2.2 ②，含待确认降级 §2.2 ④）----
  const markPending = db.prepare('UPDATE tickets SET need_confirm = 1 WHERE ticket_no = ?')
  const setPack = db.prepare('UPDATE tickets SET pack_id = ? WHERE ticket_no = ?')
  const setReassigned = db.prepare('UPDATE tickets SET reassigned_to = ? WHERE ticket_no = ?')
  const clearReassigned = db.prepare('UPDATE tickets SET reassigned_to = NULL WHERE ticket_no = ?')

  for (const row of flat) {
    const t = selByNo.get(row.ticket_no) as
      | (Pick<TicketRowLite, 'pack_id' | 'is_history' | 'need_confirm' | 'approval_state' | 'reassigned_to'> & {
          ticket_no: string
        })
      | undefined
    if (!t) continue

    // 已建任务的单：改派检测（本机被移出设计师集合 → 不删任务，只标记）
    if (t.pack_id !== null) {
      const designers = designersOf(row.ticket_no)
      const mine = designers.some((d) => d.userid === input.identity.userid)
      const primaryName = designers[0]?.name ?? null
      if (!mine && primaryName) {
        if (t.reassigned_to !== primaryName) {
          setReassigned.run(primaryName, row.ticket_no)
          res.reassigned++
        }
      } else if (t.reassigned_to !== null) {
        // 本机仍在集合（或集合已空、无新负责人）→ 清掉改派标记（任务本来就是这台机器的）
        clearReassigned.run(row.ticket_no)
      }
      continue
    }

    // 没建任务的单：先过门槛（§2.2② 建任务条件链改「本机 ∈ 设计师集合」）
    if (t.is_history) continue
    if (t.need_confirm) continue
    if (!designersOf(row.ticket_no).some((d) => d.userid === input.identity.userid)) continue
    if (!t.approval_state || !TASK_STATES.includes(t.approval_state)) continue

    // 子表重建 → 本轮新单降级为「待确认」，不自动建任务（§2.2 ④）
    if (input.structureChanged && insertedNos.has(row.ticket_no)) {
      markPending.run(row.ticket_no)
      res.needConfirm++
      continue
    }

    // 项目匹配（§4.2 步骤3；createPack 无项目时会兜底塞第一个项目 —— 与
    // 「落待归类」冲突，故对不上时暂不建任务，项目名对齐后下轮同步自动补建）
    const projName = row.fields.project_name
    let projectId: number | null = null
    if (typeof projName === 'string' && projName !== '') {
      const proj = db
        .prepare('SELECT id FROM projects WHERE name = ?')
        .get(projName) as { id: number } | undefined
      if (!proj) {
        res.projectMismatch++
        res.warnings.push(
          fmt(COPY.ticket.warnProjectMismatch, { no: row.ticket_no, project: projName })
        )
        continue
      }
      projectId = proj.id
    } else {
      // 没填业务归属：同样暂不建（项目决定任务落哪个文件夹，不能猜）
      res.projectMismatch++
      res.warnings.push(fmt(COPY.ticket.warnProjectMismatch, { no: row.ticket_no, project: '(空)' }))
      continue
    }

    try {
      const category =
        typeof row.fields.material_category === 'string' && row.fields.material_category !== ''
          ? row.fields.material_category
          : ''
      // 第 18 批（docs/20 §6 路 A）：多设计师（≥2 人）时任务名 = 物料名称-本机姓名；
      // 单设计师时 = 物料名称（向后兼容，不悄悄改既有命名）
      const designers = designersOf(row.ticket_no)
      const baseName = (row.fields.title as string) ?? row.ticket_no
      const packName =
        designers.length >= 2 ? `${baseName}-${input.identity.name || input.identity.userid}` : baseName
      const pack = createPack({
        name: packName,
        projectId,
        category,
        workspaceRoot: input.workspaceRoot
      })
      setPack.run(pack.id, row.ticket_no)
      res.tasksCreated++
    } catch (e) {
      res.warnings.push(
        fmt(COPY.ticket.warnCreateFailed, { no: row.ticket_no, msg: (e as Error).message })
      )
    }
  }

  // ---- ⑤ 删行处理（§4.2 步骤5）：本次拉到的子表里，record_id 消失的单留底标 gone ----
  const liveSheetIds = [...new Set(input.payloads.map((p) => p.sheet_id))]
  const liveRecordIds = new Set(flat.map((r) => r.record_id))
  if (liveSheetIds.length > 0) {
    const ph = liveSheetIds.map(() => '?').join(',')
    const candidates = db
      .prepare(`SELECT ticket_no, record_id, row_gone FROM tickets WHERE sheet_id IN (${ph})`)
      .all(...liveSheetIds) as Array<{ ticket_no: string; record_id: string | null; row_gone: number }>
    const markGone = db.prepare('UPDATE tickets SET row_gone = 1 WHERE ticket_no = ?')
    const markBack = db.prepare('UPDATE tickets SET row_gone = 0 WHERE ticket_no = ?')
    for (const c of candidates) {
      if (!c.record_id) continue
      if (!liveRecordIds.has(c.record_id)) {
        if (c.row_gone === 0) {
          markGone.run(c.ticket_no)
          res.rowGone++
        }
      } else if (c.row_gone === 1) {
        markBack.run(c.ticket_no)
        res.rowBack++
      }
    }
  }

  // ---- ⑥ 本轮新增未指派计数（docs/19 §3：提示条 + toast 的口径）----
  // "新增" = 本轮新入库（ticket_no 首次出现）且 designer 为空；历史单（首次快照全标）
  // 与待确认单（入口置灰）不算 —— 提示条指的路必须真的能走通。
  if (insertedNos.size > 0) {
    const selIns = db.prepare(
      'SELECT designer_userid, is_history, need_confirm FROM tickets WHERE ticket_no = ?'
    )
    for (const no of insertedNos) {
      const r = selIns.get(no) as
        | { designer_userid: string | null; is_history: number; need_confirm: number }
        | undefined
      if (r && r.designer_userid == null && r.is_history === 0 && r.need_confirm === 0) {
        res.newUnassigned++
      }
    }
  }

  return res
}

/** 查询用的行子集类型（避免引入 db.ts 的完整 TicketRow 造成循环依赖） */
interface TicketRowLite {
  pack_id: number | null
  is_history: number
  need_confirm: number
  designer_userid: string | null
  approval_state: string | null
  reassigned_to: string | null
  designer_name: string | null
}

// ============================================================ 待确认批量放行（§2.2 ④）

/**
 * 「确认这批新单」：把待确认的单按正常规则补一轮建任务判定。
 * 返回补建的任务数；这些单的 need_confirm 清零。
 */
export function confirmPendingTickets(identity: TicketIdentity, workspaceRoot: string): {
  confirmed: number
  tasksCreated: number
  warnings: string[]
} {
  const db = getDb()
  const pendings = db
    .prepare('SELECT ticket_no, approval_state, project_name, title, material_category FROM tickets WHERE need_confirm = 1')
    .all() as Array<{
    ticket_no: string
    approval_state: string | null
    project_name: string | null
    title: string | null
    material_category: string | null
  }>
  let confirmed = 0
  let tasksCreated = 0
  const warnings: string[] = []
  const clearPending = db.prepare('UPDATE tickets SET need_confirm = 0 WHERE ticket_no = ?')
  const setPack = db.prepare('UPDATE tickets SET pack_id = ? WHERE ticket_no = ?')

  for (const t of pendings) {
    clearPending.run(t.ticket_no)
    confirmed++
    const designers = designersOf(t.ticket_no)
    if (!designers.some((d) => d.userid === identity.userid)) continue
    if (!t.approval_state || !TASK_STATES.includes(t.approval_state)) continue
    if (!t.project_name) {
      warnings.push(fmt(COPY.ticket.warnProjectMismatch, { no: t.ticket_no, project: '(空)' }))
      continue
    }
    const proj = db.prepare('SELECT id FROM projects WHERE name = ?').get(t.project_name) as
      | { id: number }
      | undefined
    if (!proj) {
      warnings.push(fmt(COPY.ticket.warnProjectMismatch, { no: t.ticket_no, project: t.project_name }))
      continue
    }
    const isMulti = designers.length >= 2
    const baseName = t.title ?? t.ticket_no
    const packName = isMulti ? `${baseName}-${identity.name || identity.userid}` : baseName
    try {
      const pack = createPack({
        name: packName,
        projectId: proj.id,
        category: t.material_category ?? '',
        workspaceRoot
      })
      setPack.run(pack.id, t.ticket_no)
      tasksCreated++
    } catch (e) {
      warnings.push(fmt(COPY.ticket.warnCreateFailed, { no: t.ticket_no, msg: (e as Error).message }))
    }
  }
  return { confirmed, tasksCreated, warnings }
}

/** 详情/列表用的「补建任务」手动按钮（历史单兜底，§2.2 ③） */
export function createTaskForTicketManually(
  ticket_no: string,
  workspaceRoot: string
): { ok: boolean; packId?: number; packName?: string; msg?: string } {
  const db = getDb()
  const t = db
    .prepare('SELECT pack_id, project_name, title, material_category FROM tickets WHERE ticket_no = ?')
    .get(ticket_no) as
    | { pack_id: number | null; project_name: string | null; title: string | null; material_category: string | null }
    | undefined
  if (!t) return { ok: false, msg: COPY.ticket.detailTitle /* 不存在 */ }
  if (t.pack_id !== null) return { ok: false, msg: fmt(COPY.ticket.linkedTask, { name: '' }) }
  if (!t.project_name) {
    return { ok: false, msg: fmt(COPY.ticket.warnProjectMismatch, { no: ticket_no, project: '(空)' }) }
  }
  const proj = db.prepare('SELECT id FROM projects WHERE name = ?').get(t.project_name) as
    | { id: number }
    | undefined
  if (!proj) {
    return { ok: false, msg: fmt(COPY.ticket.warnProjectMismatch, { no: ticket_no, project: t.project_name }) }
  }
  try {
    const pack = createPack({
      name: t.title ?? ticket_no,
      projectId: proj.id,
      category: t.material_category ?? '',
      workspaceRoot
    })
    db.prepare('UPDATE tickets SET pack_id = ? WHERE ticket_no = ?').run(pack.id, ticket_no)
    return { ok: true, packId: pack.id, packName: t.title ?? ticket_no }
  } catch (e) {
    return { ok: false, msg: (e as Error).message }
  }
}

// ============================================================ 设计师指派（第 17 批 docs/19 §4~§6）

/** 候选设计师（§5.4：历史工单设计师去重；activeCount = 在办单数，辅助判断谁有空） */
export interface DesignerCandidate {
  userid: string
  name: string
  /** 在办单数（非历史、非删行、状态 ∈ 审批中/已通过） */
  activeCount: number
}

/**
 * 候选池：所有工单里出现过的设计师去重（含历史单 —— 历史派过活的人也是候选）。
 * 零接口零权限：不碰通讯录，纯本地库聚合。只做提示、不替人排序派活（铁律③）。
 */
export function listDesignerCandidates(): DesignerCandidate[] {
  const db = getDb()
  // 第 18 批（docs/20 §5.5）：候选池改读子表（设计师的全量、可索引来源）
  const all = db
    .prepare(
      `SELECT td.userid AS userid, MAX(td.name) AS name FROM ticket_designers td
       GROUP BY td.userid`
    )
    .all() as Array<{ userid: string; name: string | null }>
  const active = db
    .prepare(
      `SELECT td.userid AS userid, COUNT(DISTINCT td.ticket_no) AS c FROM ticket_designers td
       JOIN tickets t ON t.ticket_no = td.ticket_no
       WHERE t.is_history = 0 AND t.row_gone = 0 AND t.approval_state IN ('审批中', '已通过')
       GROUP BY td.userid`
    )
    .all() as Array<{ userid: string; c: number }>
  const activeMap = new Map(active.map((a) => [a.userid, a.c]))
  return all
    .map((a) => ({
      userid: a.userid,
      name: a.name ?? a.userid,
      activeCount: activeMap.get(a.userid) ?? 0
    }))
    .sort((x, y) => y.activeCount - x.activeCount || x.name.localeCompare(y.name))
}

/** 一次指派的结果（界面 toast 的原料） */
export interface AssignResult {
  /** 本地指派是否生效（designer 字段已更新 + pending 已标） */
  ok: boolean
  msg?: string
  /** 写回企微表是否成功（失败 = 保 pending，下次同步自动补写） */
  writeOk: boolean
  writeError?: string
  /** 通知状态（写回成功才有；null = 没尝试） */
  notifyState: 'sent' | 'failed' | null
  designerName?: string
}

/**
 * 写回适配器（架构铁律 §4.3 延续：**同步核心不碰网络**）。
 * ipc.ts 传真适配器（wecom-cli），自动测试传 mock —— 真企微不进自动测试。
 */
export interface DesignerWriteAdapter {
  /** 把设计师集合写回企微表的指定 record（列名由实现方按 meta 配置取；多值 = userids 数组） */
  updateDesigners(record_id: string, sheet_id: string, userids: string[]): Promise<{ ok: boolean; error?: string }>
  /** 给设计师发企微机器人消息（markdown 文本） */
  notify(designer_userid: string, content: string): Promise<{ ok: boolean; error?: string }>
}

/** 指派判定的行子集 */
interface AssignableRow {
  ticket_no: string
  record_id: string | null
  sheet_id: string
  designer_name: string | null
  title: string | null
  project_name: string | null
  due_date: string | null
  is_history: number
  need_confirm: number
  row_gone: number
  designer_write_pending: number
  notify_state: string | null
}

function getAssignableRow(ticket_no: string): AssignableRow | undefined {
  return getDb()
    .prepare(
      `SELECT ticket_no, record_id, sheet_id, designer_name, title, project_name, due_date,
         is_history, need_confirm, row_gone, designer_write_pending, notify_state
       FROM tickets WHERE ticket_no = ?`
    )
    .get(ticket_no) as AssignableRow | undefined
}

/**
 * 多设计师指派（第 18 批 docs/20 §5.7）：一次把集合全量写成 list（整表替换）。
 * 流向：本地即时生效 → 标 pending → 异步写回 → 失败保 pending → 通知本次新增的设计师。
 * 「本机开关」门槛由调用方（IPC）把关，引擎只管单子本身的状态门槛。
 */
export async function executeAssignDesigners(
  ticket_no: string,
  list: Array<{ userid: string; name: string }>,
  adapter: DesignerWriteAdapter,
  assignedBy?: string | null
): Promise<AssignResult> {
  const db = getDb()
  const t = getAssignableRow(ticket_no)
  if (!t) return { ok: false, writeOk: false, notifyState: null, msg: COPY.ticket.assignTicketMissing }
  if (t.need_confirm) return { ok: false, writeOk: false, notifyState: null, msg: COPY.ticket.assignPendingHint }
  if (t.row_gone) return { ok: false, writeOk: false, notifyState: null, msg: COPY.ticket.assignRowGoneHint }
  if (t.is_history) return { ok: false, writeOk: false, notifyState: null, msg: COPY.ticket.assignHistoryHint }
  if (!designerColUsable()) return { ok: false, writeOk: false, notifyState: null, msg: COPY.ticket.assignColBad }
  // 空集合写不出去（API 无法清空成员列，docs/20 §2.1）——「移除到最后一人」在 UI 层就挡掉了
  if (list.length === 0) return { ok: false, writeOk: false, notifyState: null, msg: COPY.ticket.assignEmptyHint }

  // ① 本地即时生效（不等写回）：整表替换子表（保留已通知者标记）+ 回写冗余列 + 标 pending + 留痕
  const now = new Date().toISOString()
  db.transaction(() => {
    replaceTicketDesigners(ticket_no, list)
    db.prepare(
      `UPDATE tickets SET designer_userid = ?, designer_name = ?, designer_write_pending = 1,
         assigned_by = ?, assigned_at = ? WHERE ticket_no = ?`
    ).run(list[0]?.userid ?? null, list[0]?.name ?? null, assignedBy ?? null, now, ticket_no)
  })()

  // ② 异步写回（多值数组，一次只写这一张单）
  const wr = await writeBackOne(adapter, ticket_no)
  if (!wr.ok) {
    return {
      ok: true,
      writeOk: false,
      writeError: wr.error,
      notifyState: null,
      designerName: joinNames(list),
      msg: fmt(COPY.ticket.assignOkWriteFailed, { name: joinNames(list), msg: wr.error ?? '' })
    }
  }

  // ③ 写回成功 → 通知本次新增的设计师（notified=0 的），逐个发，失败不阻断（§6）
  const notify = await notifyPendingDesigners(adapter, ticket_no)
  const notifyState: 'sent' | 'failed' | null =
    notify.failed > 0 ? 'failed' : notify.sent > 0 ? 'sent' : null
  return {
    ok: true,
    writeOk: true,
    notifyState,
    designerName: joinNames(list),
    msg:
      notifyState === 'sent'
        ? fmt(COPY.ticket.assignOkNotified, { name: joinNames(notify.names) })
        : notifyState === 'failed'
          ? fmt(COPY.ticket.assignOkNotifyFailed, { name: joinNames(notify.names) })
          : undefined
  }
}

/** 姓名/ID 列表 → 顿号串（toast 文案用） */
function joinNames(list: Array<{ name: string | null }> | string[]): string {
  const arr = list.map((x) => (typeof x === 'string' ? x : (x.name ?? ''))).filter(Boolean)
  return arr.join('、')
}

/** 一张单写回企微表（多值数组）；成功清 pending，失败保 pending（返回失败原因） */
async function writeBackOne(
  adapter: DesignerWriteAdapter,
  ticket_no: string
): Promise<{ ok: boolean; error?: string }> {
  const t = getAssignableRow(ticket_no)
  if (!t || !t.record_id || !t.sheet_id) {
    return { ok: false, error: COPY.ticket.assignNoRecordId }
  }
  // record_id / sheet_id 变了（重拉表）→ 从库里取最新值（子表集合）再写
  const userids = designersOf(ticket_no).map((d) => d.userid)
  if (!userids.length) return { ok: false, error: COPY.ticket.assignNoRecordId }
  const wr = await adapter.updateDesigners(t.record_id, t.sheet_id, userids)
  if (!wr.ok) return { ok: false, error: wr.error }
  getDb().prepare('UPDATE tickets SET designer_write_pending = 0 WHERE ticket_no = ?').run(ticket_no)
  return { ok: true }
}

/**
 * 给一张单里「还没通知过」的设计师逐个发通知（notified=0 的，防重精确到人）。
 * 失败不阻断，返回发送结果汇总。
 */
async function notifyPendingDesigners(
  adapter: DesignerWriteAdapter,
  ticket_no: string
): Promise<{ sent: number; failed: number; names: string[] }> {
  const t = getAssignableRow(ticket_no)
  if (!t) return { sent: 0, failed: 0, names: [] }
  const content = fmt(COPY.ticket.notifyTemplate, {
    title: t.title ?? t.ticket_no,
    project: t.project_name ?? '—',
    due: t.due_date ? t.due_date.slice(0, 10) : COPY.ticket.notifyDueEmpty
  })
  const pending = getDb()
    .prepare('SELECT userid, name FROM ticket_designers WHERE ticket_no = ? AND notified = 0 ORDER BY seq')
    .all(ticket_no) as Array<{ userid: string; name: string | null }>
  let sent = 0
  let failed = 0
  const names: string[] = []
  for (const d of pending) {
    const nr = await adapter.notify(d.userid, content)
    if (nr.ok) {
      getDb()
        .prepare('UPDATE ticket_designers SET notified = 1 WHERE ticket_no = ? AND userid = ?')
        .run(ticket_no, d.userid)
      sent++
      names.push(d.name ?? d.userid)
    } else {
      failed++
    }
  }
  // 汇总状态仍写回 tickets.notify_state（兼容第 17 批的口径 / 界面提示）
  const state = failed > 0 ? 'failed' : sent > 0 ? 'sent' : null
  if (state) {
    getDb().prepare('UPDATE tickets SET notify_state = ? WHERE ticket_no = ?').run(state, ticket_no)
  }
  return { sent, failed, names }
}

/** 同步后的写回补写（§2.2 管路：pending 的单每次同步自动重试，不做指数退避） */
export async function retryPendingDesignerWrites(
  adapter: DesignerWriteAdapter
): Promise<{ retried: number; succeeded: number; failed: number; errors: string[] }> {
  const db = getDb()
  const pendings = db
    .prepare(
      'SELECT ticket_no FROM tickets WHERE designer_write_pending = 1 AND record_id IS NOT NULL'
    )
    .all() as Array<{ ticket_no: string }>
  let succeeded = 0
  const errors: string[] = []
  for (const p of pendings) {
    const wr = await writeBackOne(adapter, p.ticket_no)
    if (wr.ok) {
      succeeded++
      // 补写成功也要补通知（notified=0 的设计师，比如上次指派时通知还没发就崩了）
      await notifyPendingDesigners(adapter, p.ticket_no)
    } else {
      errors.push(fmt(COPY.ticket.assignWriteRetryItem, { no: p.ticket_no, msg: wr.error ?? '' }))
    }
  }
  return { retried: pendings.length, succeeded, failed: errors.length, errors }
}

/** 未指派存量数（顶栏徽标口径 = 「未指派」筛选口径，与点开条数严格一致） */
export function unassignedTicketCount(): number {
  const r = getDb()
    .prepare('SELECT COUNT(*) AS c FROM tickets WHERE designer_userid IS NULL')
    .get() as { c: number }
  return r.c
}

/** 同步时评估设计师列可用性（sheets list 的 fields 里查列名 + user 类型） */
export function evaluateDesignerCol(
  enabledSheets: Array<{ sheet_id: string; title: string }>,
  fieldsBySheet: Record<string, Array<{ field_title: string; field_type: string }>> | undefined
): void {
  // fields 拿不到（CLI 版本差异）→ 不设防（写失败有 toast 兜底），只看有数据的判断
  if (!fieldsBySheet) return
  const col = designerColName()
  let allOk = true
  let checked = 0
  for (const s of enabledSheets) {
    const fields = fieldsBySheet[s.sheet_id]
    if (!fields) continue
    checked++
    const hit = fields.find((f) => f.field_title === col)
    if (!hit || hit.field_type !== 'user') allOk = false
  }
  if (checked > 0) setMeta(META_KEYS.designerOk, allOk ? '1' : '0')
}

// ============================================================ 本地扩展字段（第 19 批 docs/22 §3）

/** 一张单的本地扩展字段（印刷金额 / 绩效金额 / 备注，只存本地，不进工单队列） */
export interface TicketMetrics {
  printCost: number | null
  performanceCost: number | null
  remark: string | null
}

/** 读一张单的本地扩展字段（无记录 → 全 null，不建行） */
export function readTicketMetrics(ticket_no: string): TicketMetrics {
  const r = getDb()
    .prepare('SELECT print_cost, performance_cost, remark FROM ticket_metrics WHERE ticket_no = ?')
    .get(ticket_no) as { print_cost: number | null; performance_cost: number | null; remark: string | null } | undefined
  return {
    printCost: r?.print_cost ?? null,
    performanceCost: r?.performance_cost ?? null,
    remark: r?.remark ?? null
  }
}

/**
 * 写一张单的本地扩展字段（upsert）。三值全空时删行（不留空记录，避免导出时无谓 JOIN）。
 * 金额存 REAL（导出时按货币列写数字）；备注存文本。
 */
export function writeTicketMetrics(ticket_no: string, m: TicketMetrics): void {
  const empty = m.printCost == null && m.performanceCost == null && (m.remark == null || m.remark === '')
  if (empty) {
    getDb().prepare('DELETE FROM ticket_metrics WHERE ticket_no = ?').run(ticket_no)
    return
  }
  getDb()
    .prepare(
      `INSERT INTO ticket_metrics (ticket_no, print_cost, performance_cost, remark)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ticket_no) DO UPDATE SET
         print_cost = excluded.print_cost,
         performance_cost = excluded.performance_cost,
         remark = excluded.remark`
    )
    .run(ticket_no, m.printCost, m.performanceCost, m.remark)
}

// ============================================================ 「完成任务」缩略图（第 19 批 docs/22 §4）

/** 工单队列「缩略图」image 列的列名（固定，读写同源） */
export function thumbColName(): string {
  return COL.thumb
}

/** 一张单的「完成任务」结果（引擎只负责找成品图 + 生成缩略图，上传写回由调用方做） */
export interface CompleteTaskResult {
  ok: boolean
  msg?: string
  ticketNo?: string
  recordId?: string | null
  sheetId?: string
  /** 本地缩略图绝对路径（供 media upload 上传） */
  thumbPath?: string
}

/**
 * 任务包「完成任务」：找该任务包关联的工单 → 最新版本第一张成品素材 → 生成缩略图。
 * 只负责缩略图生成（不改工单状态，docs/22 §7 #6）。上传写回由 IPC 层调 wecom-cli 完成。
 */
export async function completeTicketTask(
  packId: number,
  workspaceRoot: string
): Promise<CompleteTaskResult> {
  const db = getDb()
  const t = db
    .prepare('SELECT ticket_no, record_id, sheet_id FROM tickets WHERE pack_id = ? ORDER BY id LIMIT 1')
    .get(packId) as { ticket_no: string; record_id: string | null; sheet_id: string } | undefined
  if (!t) return { ok: false, msg: COPY.ticket.completeNoTicket }

  // 最新版本（当前稿，否则最大 seq）的第一张「成品」素材
  const ver = db
    .prepare('SELECT id FROM pack_versions WHERE pack_id = ? ORDER BY is_current DESC, seq DESC LIMIT 1')
    .get(packId) as { id: number } | undefined
  let asset = ver
    ? (db
        .prepare(
          `SELECT abs_path, size, ext, modified_at FROM assets
            WHERE pack_id = ? AND role = '成品' AND version_id = ? ORDER BY id LIMIT 1`
        )
        .get(packId, ver.id) as { abs_path: string; size: number; ext: string; modified_at: string } | undefined)
    : undefined
  // 该版本没成品 / 老包没分版本 → 退到「包内所有成品素材第一张」
  if (!asset) {
    asset = db
      .prepare(
        `SELECT abs_path, size, ext, modified_at FROM assets
          WHERE pack_id = ? AND role = '成品' ORDER BY id LIMIT 1`
      )
      .get(packId) as { abs_path: string; size: number; ext: string; modified_at: string } | undefined
  }
  if (!asset) return { ok: false, msg: COPY.ticket.completeNoAsset }

  const rel = await ensureAnyThumb(
    workspaceRoot,
    asset.abs_path,
    asset.size,
    asset.ext,
    new Date(asset.modified_at).getTime()
  )
  if (!rel) return { ok: false, msg: COPY.ticket.completeNoThumb }

  return {
    ok: true,
    ticketNo: t.ticket_no,
    recordId: t.record_id,
    sheetId: t.sheet_id,
    thumbPath: join(workspaceRoot, rel)
  }
}
