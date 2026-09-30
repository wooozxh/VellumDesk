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
  warnings: string[]
}

// ============================================================ meta 配置键（docs/15 §5）

export const META_KEYS = {
  docid: 'ticket_docid',
  docname: 'ticket_docname',
  sheets: 'ticket_sheets',
  identity: 'ticket_identity',
  firstSyncDone: 'ticket_first_sync_done'
} as const

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
  useScene: '物料使用场景'
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

/** 人员单元格 → userid + 姓名（成员类型列存 {userId, userName}） */
function takeUser(v: unknown): { userid: string | null; name: string | null } {
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
  fields: Record<string, string | number | null>
} {
  const v = rec.values ?? {}
  const designer = takeUser(v[COL.designer])
  const applicant = takeUser(v[COL.applicant])
  const qtyText = takeText(v[COL.qty])
  const qty = qtyText ? parseInt(qtyText.replace(/[^\d]/g, ''), 10) : null
  return {
    ticket_no: takeText(v[COL.no]) ?? '',
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
      source_url: takeText(v[COL.source]),
      approval_url: takeText(v[COL.link]),
      receiver_name: takeText(v[COL.recvName]),
      receiver_phone: takeText(v[COL.recvPhone]),
      deliver_date: takeDate(v[COL.deliver]),
      designer_userid: designer.userid,
      designer_name: designer.name,
      project_name: takeText(v[COL.project]),
      reviewer_names: takeUserNames(v[COL.reviewer]),
      material_category: takeText(v[COL.matCat])
    }
  }
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
    warnings: []
  }

  const firstSyncDone = getMeta(META_KEYS.firstSyncDone) === '1'

  // ---- ① 全部 payload 摊平成行（带出生地信息）----
  interface FlatRow {
    ticket_no: string
    record_id: string
    sheet_id: string
    ticket_type: TicketType
    fields: Record<string, string | number | null>
    raw: string
  }
  const flat: FlatRow[] = []
  const emptyNoIds: string[] = []
  for (const p of input.payloads) {
    for (const rec of p.records) {
      const { ticket_no, fields } = extractRow(rec)
      if (!ticket_no) {
        emptyNoIds.push(rec.record_id)
        continue
      }
      flat.push({
        ticket_no,
        record_id: rec.record_id,
        sheet_id: p.sheet_id,
        ticket_type: p.type,
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
      raw_json, first_seen_at, last_sync_at, is_history)
    VALUES (@sheet_id, @ticket_type, @ticket_no, @record_id,
      @title, @approval_state, @applicant_userid, @applicant_name, @department,
      @purpose, @size_text, @print_qty, @material_form, @use_scene,
      @due_date, @submit_time, @done_time, @remark, @source_url, @approval_url,
      @receiver_name, @receiver_phone, @deliver_date,
      @designer_userid, @designer_name, @project_name, @reviewer_names, @material_category,
      @raw_json, @now, @now, 0)
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
      material_category = @material_category, raw_json = @raw_json,
      last_sync_at = @now
    WHERE ticket_no = @ticket_no
  `)
  const markDup = db.prepare('UPDATE tickets SET dup_warn = 1, dup_json = ? WHERE ticket_no = ?')
  const dupCounts = new Map<string, number>()

  /** 本轮新插入的编号（建任务判定要看；含是否首次快照） */
  const insertedNos = new Set<string>()

  for (const row of flat) {
    const bind = {
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
      updTicket.run(bind)
      res.updated++
    } else {
      insTicket.run(bind)
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
      | (Pick<
          TicketRowLite,
          | 'pack_id' | 'is_history' | 'need_confirm' | 'designer_userid' | 'approval_state'
          | 'reassigned_to' | 'designer_name'
        > & { ticket_no: string })
      | undefined
    if (!t) continue

    // 已建任务的单：改派检测（设计师变成别人 → 不删任务，只标记）
    if (t.pack_id !== null) {
      if (t.designer_userid && t.designer_userid !== input.identity.userid) {
        if (t.reassigned_to !== t.designer_name) {
          setReassigned.run(t.designer_name, row.ticket_no)
          res.reassigned++
        }
      } else if (t.reassigned_to !== null) {
        // 设计师又改回本机 → 清掉改派标记（任务本来就是这台机器的）
        clearReassigned.run(row.ticket_no)
      }
      continue
    }

    // 没建任务的单：先过门槛
    if (t.is_history) continue
    if (t.need_confirm) continue
    if (!t.designer_userid || t.designer_userid !== input.identity.userid) continue
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
      const pack = createPack({
        name: (row.fields.title as string) ?? row.ticket_no,
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
    .prepare('SELECT ticket_no, designer_userid, approval_state, project_name, title, material_category FROM tickets WHERE need_confirm = 1')
    .all() as Array<{
    ticket_no: string
    designer_userid: string | null
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
    if (!t.designer_userid || t.designer_userid !== identity.userid) continue
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
    try {
      const pack = createPack({
        name: t.title ?? t.ticket_no,
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
): { ok: boolean; packId?: number; msg?: string } {
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
    return { ok: true, packId: pack.id }
  } catch (e) {
    return { ok: false, msg: (e as Error).message }
  }
}
