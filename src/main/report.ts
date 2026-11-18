/**
 * 第 19 批（docs/22 导出报表）：报表引擎 —— 纯逻辑，不碰网络。
 *
 * 职责：
 *  - buildReportRows：按「完成时间」起止筛工单，JOIN 本地扩展字段 + 设计师子表，组装数据行。
 *  - exportReport：把数据行序列化成企微智能表格记录值（成员/单选/日期/货币/图片），
 *    调注入的 ReportAdapter 建子表 + 写记录。
 *
 * 架构铁律（docs/15 §4.3 延续）：引擎不碰网络，ReportAdapter 由 ipc.ts 传真实现
 * （reportWecom.ts），自动测试全喂 mock —— 真企微不进自动测试。
 */
import { getDb, getMeta, setMeta } from './db'
import type { CliResult } from './ticketsWecom'
import type { ReportField } from './reportWecom'
// 第 27 批（issue #2）：本地 thumb_url 可能是多张（JSON 数组），读回用同一套解析
import { parseThumbUrls } from './tickets'

// ============================================================ 报表模板字段名（用户建好的模板，docs/22 §2.1）

/** 报表配置的 meta 键（报表表格 docid + 两套模板子表名） */
export const REPORT_META_KEYS = {
  docid: 'report_docid',
  /** 流水报表模板（老键名沿用，避免老工作区丢配置） */
  templateSheet: 'report_template_sheet',
  /** 月度报表模板（第 86 批新增） */
  templateSheetMonth: 'report_template_sheet_month'
} as const

/** 两套模板的默认子表名（与用户真表现名一致） */
export const DEFAULT_TEMPLATE_FLOW = '报表模板（总报表）'
export const DEFAULT_TEMPLATE_MONTH = '报表模板（月度报表）'

/**
 * 历史默认名。读到这个值说明是**老工作区从没改过**，而真表已经改名 ——
 * 直接当成"没配过"，升级成新默认；用户自定义过的名字一律原样保留。
 */
const LEGACY_TEMPLATE_FLOW = '报表模板'

/** 读报表配置（未配置 docid → null；模板名各自回落默认） */
export function readReportConfig(): {
  docid: string | null
  templateSheet: string
  templateSheetMonth: string
} {
  const saved = getMeta(REPORT_META_KEYS.templateSheet)
  return {
    docid: getMeta(REPORT_META_KEYS.docid),
    templateSheet: !saved || saved === LEGACY_TEMPLATE_FLOW ? DEFAULT_TEMPLATE_FLOW : saved,
    templateSheetMonth: getMeta(REPORT_META_KEYS.templateSheetMonth) || DEFAULT_TEMPLATE_MONTH
  }
}

/** 写报表配置（导出弹窗里粘贴链接 / 从候选里选模板时落库） */
export function writeReportConfig(
  docid: string,
  templateSheet: string,
  templateSheetMonth?: string
): void {
  setMeta(REPORT_META_KEYS.docid, docid)
  setMeta(REPORT_META_KEYS.templateSheet, templateSheet || DEFAULT_TEMPLATE_FLOW)
  if (templateSheetMonth) setMeta(REPORT_META_KEYS.templateSheetMonth, templateSheetMonth)
}

/** 报表类型：流水（全字段）/ 月度（按设计师拆表，部分列留空） */
export type ReportKind = 'flow' | 'monthly'

/** 流水报表模板的 12 个字段名（精确匹配用户建好的「报表模板（总报表）」列名） */
export const REPORT_FIELD = {
  type: '工单类型（印刷/电子）',
  no: '编号',
  doneTime: '完成时间',
  title: '物料名称',
  project: '业务归属',
  applicant: '申请人',
  designers: '设计师',
  thumb: '缩略图',
  qty: '印刷数量',
  printCost: '印刷金额',
  performanceCost: '绩效金额',
  remark: '备注'
} as const

/**
 * 月度报表模板的 9 个字段名（精确匹配「报表模板（月度报表）」列名）。
 * 「物料体量」「备注」由设计师在表格里手填 —— 导出时**故意不写**，保持空白。
 */
export const REPORT_FIELD_MONTH = {
  type: REPORT_FIELD.type,
  no: REPORT_FIELD.no,
  doneTime: REPORT_FIELD.doneTime,
  title: REPORT_FIELD.title,
  project: REPORT_FIELD.project,
  designers: REPORT_FIELD.designers,
  thumb: REPORT_FIELD.thumb,
  /** 手填列：导出不写 */
  bodySize: '物料体量',
  /** 手填列：导出不写（与流水报表的本地备注不是一回事） */
  remark: REPORT_FIELD.remark
} as const

/** 每种类型「模板里必须有」的列（缺了才警告；手填列不在此列） */
export const REPORT_REQUIRED_FIELDS: Record<ReportKind, string[]> = {
  flow: [
    REPORT_FIELD.type,
    REPORT_FIELD.no,
    REPORT_FIELD.doneTime,
    REPORT_FIELD.title,
    REPORT_FIELD.project,
    REPORT_FIELD.applicant,
    REPORT_FIELD.designers,
    REPORT_FIELD.thumb,
    REPORT_FIELD.qty,
    REPORT_FIELD.printCost,
    REPORT_FIELD.performanceCost,
    REPORT_FIELD.remark
  ],
  monthly: [
    REPORT_FIELD_MONTH.type,
    REPORT_FIELD_MONTH.no,
    REPORT_FIELD_MONTH.doneTime,
    REPORT_FIELD_MONTH.title,
    REPORT_FIELD_MONTH.project,
    REPORT_FIELD_MONTH.designers,
    REPORT_FIELD_MONTH.thumb
  ]
}

// ============================================================ 数据行

/** 一张要导出的工单（JOIN 了本地扩展字段 + 设计师集合） */
export interface ReportRow {
  ticketNo: string
  ticketType: 'print' | 'digital'
  doneTime: string | null
  title: string | null
  projectName: string | null
  applicantName: string | null
  designers: Array<{ userid: string; name: string }>
  /** 工单队列「缩略图」image 列同步来的 URL（第 27 批起支持多张，导出时逐张重新上传到报表空间） */
  thumbUrls: string[]
  printQty: number | null
  printCost: number | null
  performanceCost: number | null
  remark: string | null
}

/** 按「完成时间」起止筛工单（含边界；row_gone 的留底单不进报表） */
export function buildReportRows(start: string, end: string): ReportRow[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT t.ticket_no, t.ticket_type, t.done_time, t.title, t.project_name,
              t.applicant_name, t.thumb_url, t.print_qty,
              m.print_cost, m.performance_cost, m.remark
         FROM tickets t
         LEFT JOIN ticket_metrics m ON m.ticket_no = t.ticket_no
        WHERE t.row_gone = 0
          AND t.done_time IS NOT NULL
          AND substr(t.done_time, 1, 10) >= ?
          AND substr(t.done_time, 1, 10) <= ?
        ORDER BY t.done_time, t.id`
    )
    .all(start, end) as Array<Record<string, unknown>>
  // 批量取设计师集合（复用 ticket:list 的模式）
  const designerMap = new Map<string, Array<{ userid: string; name: string }>>()
  const nos = rows.map((r) => r.ticket_no as string)
  if (nos.length) {
    const ph = nos.map(() => '?').join(',')
    const ds = db
      .prepare(
        `SELECT ticket_no, userid, name FROM ticket_designers WHERE ticket_no IN (${ph}) ORDER BY ticket_no, seq`
      )
      .all(...nos) as Array<{ ticket_no: string; userid: string; name: string | null }>
    for (const d of ds) {
      if (!d.userid) continue
      const arr = designerMap.get(d.ticket_no) ?? []
      arr.push({ userid: d.userid, name: d.name ?? '' })
      designerMap.set(d.ticket_no, arr)
    }
  }
  return rows.map((r) => ({
    ticketNo: r.ticket_no as string,
    ticketType: r.ticket_type as 'print' | 'digital',
    doneTime: (r.done_time as string) ?? null,
    title: (r.title as string) ?? null,
    projectName: (r.project_name as string) ?? null,
    applicantName: (r.applicant_name as string) ?? null,
    designers: designerMap.get(r.ticket_no as string) ?? [],
    thumbUrls: parseThumbUrls(r.thumb_url as string),
    printQty: (r.print_qty as number) ?? null,
    printCost: (r.print_cost as number) ?? null,
    performanceCost: (r.performance_cost as number) ?? null,
    remark: (r.remark as string) ?? null
  }))
}

// ============================================================ 写回适配器（ipc 传真实现，测试喂 mock）

export interface ReportAdapter {
  /** 读报表模板字段（复制字段结构用） */
  fetchTemplateFields(docid: string, sheetTitle: string): Promise<CliResult<ReportField[]>>
  /** 列报表表格里的全部子表（模板名对不上时给用户选，第 86 批） */
  listSheets(docid: string): Promise<CliResult<Array<{ title: string; fieldCount: number }>>>
  /** 建子表（按起止日期命名 + 复制字段结构） */
  addSheet(docid: string, sheetTitle: string, fields: ReportField[]): Promise<CliResult<null>>
  /** 把工单队列空间的缩略图 URL 重新上传到报表文档空间（返回报表空间图片 URL） */
  rehostThumb(sourceUrl: string, docid: string): Promise<CliResult<string>>
  /** 写记录 */
  addRecords(
    docid: string,
    sheetTitle: string,
    records: Array<{ values: Record<string, unknown> }>
  ): Promise<CliResult<null>>
}

// ============================================================ 导出入参 / 结果

export interface ExportReportInput {
  docid: string
  /** 报表类型（默认按流水处理，兼容老调用） */
  kind?: ReportKind
  /** 报表模板子表名（流水 / 月度各自的模板） */
  templateSheet: string
  /** 起止日期（YYYY-MM-DD） */
  start: string
  end: string
}

export interface ExportReportResult {
  ok: boolean
  /** 新建的子表名（流水 = 起止日期；月度是多张，取第一张供旧调用方使用） */
  sheetTitle?: string
  /** 导出的条数（月度 = 各人表内条数之和，一单多人会重复计） */
  count?: number
  /** 字段缺失 / 类型不符 / 选项缺失的警告（不阻断导出） */
  fieldWarnings?: string[]
  kind?: 'cli-missing' | 'auth-expired' | 'sheet-missing' | 'unknown'
  error?: string
  /** kind = sheet-missing：该表格现有的全部子表名，供界面让用户选 */
  candidates?: string[]
  /** 月度：实际建出的子表（标题 + 条数） */
  sheets?: Array<{ title: string; count: number }>
  /** 月度：因「没有设计师」被跳过的原始工单条数 */
  skipped?: number
  /** 月度：建表 / 写记录失败的子表（其余继续导，最后如实汇报） */
  failedSheets?: Array<{ title: string; error: string }>
}

// ============================================================ 值序列化

/** 字段名 → 模板字段（field_title 为键，拿类型 + 选项 id） */
function buildFieldMap(fields: ReportField[]): Map<string, ReportField> {
  return new Map(fields.map((f) => [f.field_title, f]))
}

/** 单选字段里按文本找选项 id（拿不到返回 null，降级只写 text） */
function optionId(field: ReportField | undefined, text: string): string | null {
  if (!field) return null
  const p = field.property_single_select as { options?: Array<{ id: string; text: string }> } | undefined
  return p?.options?.find((o) => o.text === text)?.id ?? null
}

/** ISO 时间戳 → 企微 date_time 要求的 "YYYY-MM-DD HH:mm:ss" */
function toDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 一行 → 记录值（values 的 key = 字段名）。
 * - 单值列 null → 不写该键（让表格保持空，而不是写空串/0）
 * - 月度：只写 7 个通用列；「物料体量」「备注」**故意不写**（设计师手填）
 * - 列在模板里不存在 → 跳过（缺列警告由 exportReport 统一预检，避免每条都刷一遍）
 */
function serializeRow(
  row: ReportRow,
  fieldMap: Map<string, ReportField>,
  thumbUrls: string[],
  warnings: string[],
  kind: ReportKind
): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  const field = (k: string): ReportField | undefined => fieldMap.get(k)

  // 工单类型（单选）：印刷 / 电子
  const typeText = row.ticketType === 'print' ? '印刷' : '电子'
  const typeF = field(REPORT_FIELD.type)
  if (typeF) {
    const id = optionId(typeF, typeText)
    v[REPORT_FIELD.type] = id ? [{ id, text: typeText }] : [{ text: typeText }]
    if (!id) warnings.push(`「工单类型」缺「${typeText}」选项，已按文本写入`)
  }

  // 编号（文本）
  if (field(REPORT_FIELD.no)) v[REPORT_FIELD.no] = row.ticketNo

  // 完成时间（日期）
  if (field(REPORT_FIELD.doneTime) && row.doneTime) {
    v[REPORT_FIELD.doneTime] = toDateTime(row.doneTime)
  }

  // 物料名称 / 业务归属（文本）
  if (field(REPORT_FIELD.title) && row.title) v[REPORT_FIELD.title] = row.title
  if (field(REPORT_FIELD.project) && row.projectName) v[REPORT_FIELD.project] = row.projectName

  // 设计师（成员，多选）：全量 [{userName}]
  if (field(REPORT_FIELD.designers) && row.designers.length) {
    v[REPORT_FIELD.designers] = row.designers.map((d) => ({ userName: d.name }))
  }

  // 缩略图（图片）：先 rehost 拿到报表空间 URL —— 第 27 批起可多张，一次性写入同一图片列
  if (field(REPORT_FIELD.thumb) && thumbUrls.length > 0) {
    v[REPORT_FIELD.thumb] = thumbUrls.map((u) => ({ title: row.ticketNo, imageUrl: u }))
  }

  // 流水专属：申请人 / 数量 / 两个金额 / 本地备注
  if (kind === 'flow') {
    if (field(REPORT_FIELD.applicant) && row.applicantName) {
      v[REPORT_FIELD.applicant] = [{ userName: row.applicantName }]
    }
    if (field(REPORT_FIELD.qty) && row.printQty != null) v[REPORT_FIELD.qty] = row.printQty
    if (field(REPORT_FIELD.printCost) && row.printCost != null) {
      v[REPORT_FIELD.printCost] = row.printCost
    }
    if (field(REPORT_FIELD.performanceCost) && row.performanceCost != null) {
      v[REPORT_FIELD.performanceCost] = row.performanceCost
    }
    if (field(REPORT_FIELD.remark) && row.remark) v[REPORT_FIELD.remark] = row.remark
  }

  return v
}

// ============================================================ 导出主流程

/** 起止日期 → 流水子表名（如 2026-10-01~2026-10-31，docs/22 §7 #3） */
export function reportSheetTitle(start: string, end: string): string {
  return `${start}~${end}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 起止是否正好覆盖一个自然月（1 号 ~ 当月最后一天） */
export function isFullMonth(start: string, end: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const last = new Date(y, mo, 0).getDate()
  return d === 1 && end === `${y}-${pad2(mo)}-${pad2(last)}`
}

/** 区间短标签：同月 `2026-11-01~15`；跨月 `2026-11-20~12-05` */
export function rangeLabel(start: string, end: string): string {
  if (start.slice(0, 7) === end.slice(0, 7)) return `${start}~${end.slice(8, 10)}`
  return `${start}~${end.slice(5)}`
}

/**
 * 月度子表名（第 86 批）：
 * - 整月：`2026-11 张三 月度报表`
 * - 非整月：`2026-11-01~15 张三 月度报表`（同月导两次靠区间区分，不会同名）
 */
export function monthSheetTitle(start: string, end: string, name: string): string {
  const prefix = isFullMonth(start, end) ? start.slice(0, 7) : rangeLabel(start, end)
  return `${prefix} ${name} 月度报表`
}

export interface DesignerGroup {
  name: string
  rows: ReportRow[]
}

/**
 * 月度：按设计师拆组。一单多人 → 每个人的组里各放一份（按人计产出）。
 * 返回 skipped = 没有任何可归组设计师的**原始**工单条数（不是人-单数）。
 */
export function groupRowsByDesigner(rows: ReportRow[]): {
  groups: DesignerGroup[]
  skipped: number
} {
  const map = new Map<string, ReportRow[]>()
  let skipped = 0
  for (const r of rows) {
    const names = r.designers.map((d) => (d.name ?? '').trim()).filter(Boolean)
    if (names.length === 0) {
      skipped++
      continue
    }
    for (const name of names) {
      const arr = map.get(name) ?? []
      arr.push(r)
      map.set(name, arr)
    }
  }
  const groups = [...map.entries()]
    .map(([name, list]) => ({ name, rows: list }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return { groups, skipped }
}

/** 读模板；读不到时（且不是 CLI/授权问题）把候选子表带回去 */
async function fetchTemplate(
  input: ExportReportInput,
  adapter: ReportAdapter
): Promise<{ ok: true; fields: ReportField[] } | { ok: false; result: ExportReportResult }> {
  const tpl = await adapter.fetchTemplateFields(input.docid, input.templateSheet)
  if (tpl.ok && tpl.data) return { ok: true, fields: tpl.data }
  if (tpl.kind !== 'cli-missing' && tpl.kind !== 'auth-expired') {
    const ls = await adapter.listSheets(input.docid)
    if (ls.ok && ls.data) {
      const titles = ls.data.map((s) => s.title)
      if (!titles.includes(input.templateSheet)) {
        return {
          ok: false,
          result: {
            ok: false,
            kind: 'sheet-missing',
            error: `报表表格里找不到模板子表「${input.templateSheet}」`,
            candidates: titles
          }
        }
      }
    }
  }
  return { ok: false, result: { ok: false, kind: tpl.kind ?? 'unknown', error: tpl.error } }
}

/** 模板缺列预检（每种类型只查「必须有」的列；手填列不在此列） */
function checkFields(kind: ReportKind, fields: ReportField[], warnings: string[]): void {
  const have = new Set(fields.map((f) => f.field_title))
  const label = kind === 'monthly' ? '月度报表' : '流水报表'
  for (const need of REPORT_REQUIRED_FIELDS[kind]) {
    if (!have.has(need)) warnings.push(`${label}模板缺「${need}」列`)
  }
}

/** 一条工单的缩略图逐张重传（同一张图在整次导出里只传一次，多人协作单不重复上传） */
async function rehostThumbs(
  row: ReportRow,
  docid: string,
  adapter: ReportAdapter,
  cache: Map<string, string>,
  warnings: string[]
): Promise<string[]> {
  const out: string[] = []
  for (const src of row.thumbUrls) {
    const hit = cache.get(src)
    if (hit) {
      out.push(hit)
      continue
    }
    const rh = await adapter.rehostThumb(src, docid)
    if (rh.ok && rh.data) {
      out.push(rh.data)
      cache.set(src, rh.data)
    } else {
      warnings.push(`工单 ${row.ticketNo} 缩略图重新上传失败：${rh.error ?? ''}`)
    }
  }
  return out
}

/** 流水：一张子表，12 字段全写 */
async function exportFlow(
  input: ExportReportInput,
  rows: ReportRow[],
  fields: ReportField[],
  adapter: ReportAdapter,
  warnings: string[]
): Promise<ExportReportResult> {
  const sheetTitle = reportSheetTitle(input.start, input.end)
  const add = await adapter.addSheet(input.docid, sheetTitle, fields)
  if (!add.ok) {
    return { ok: false, kind: add.kind ?? 'unknown', error: add.error, sheetTitle }
  }
  const fieldMap = buildFieldMap(fields)
  const cache = new Map<string, string>()
  const records: Array<{ values: Record<string, unknown> }> = []
  for (const row of rows) {
    const urls = await rehostThumbs(row, input.docid, adapter, cache, warnings)
    records.push({ values: serializeRow(row, fieldMap, urls, warnings, 'flow') })
  }
  const wr = await adapter.addRecords(input.docid, sheetTitle, records)
  if (!wr.ok) {
    return {
      ok: false,
      kind: wr.kind ?? 'unknown',
      error: wr.error,
      sheetTitle,
      fieldWarnings: warnings
    }
  }
  return { ok: true, count: rows.length, sheetTitle, fieldWarnings: warnings }
}

/** 月度：一位设计师一张子表；「物料体量」「备注」留空 */
async function exportMonthly(
  input: ExportReportInput,
  rows: ReportRow[],
  fields: ReportField[],
  adapter: ReportAdapter,
  warnings: string[]
): Promise<ExportReportResult> {
  const { groups, skipped } = groupRowsByDesigner(rows)
  if (groups.length === 0) {
    return { ok: true, count: 0, skipped, sheets: [], fieldWarnings: warnings }
  }
  const fieldMap = buildFieldMap(fields)
  const cache = new Map<string, string>()
  const sheets: Array<{ title: string; count: number }> = []
  const failedSheets: Array<{ title: string; error: string }> = []
  let total = 0

  for (const g of groups) {
    const title = monthSheetTitle(input.start, input.end, g.name)
    const add = await adapter.addSheet(input.docid, title, fields)
    if (!add.ok) {
      failedSheets.push({ title, error: add.error ?? '建子表失败' })
      continue
    }
    const records: Array<{ values: Record<string, unknown> }> = []
    for (const row of g.rows) {
      const urls = await rehostThumbs(row, input.docid, adapter, cache, warnings)
      records.push({ values: serializeRow(row, fieldMap, urls, warnings, 'monthly') })
    }
    const wr = await adapter.addRecords(input.docid, title, records)
    if (!wr.ok) {
      failedSheets.push({ title, error: wr.error ?? '写记录失败' })
      continue
    }
    sheets.push({ title, count: g.rows.length })
    total += g.rows.length
  }

  return {
    ok: failedSheets.length === 0,
    count: total,
    sheetTitle: sheets[0]?.title,
    sheets,
    skipped,
    failedSheets: failedSheets.length ? failedSheets : undefined,
    fieldWarnings: warnings,
    error: failedSheets.length ? `${failedSheets.length} 张子表没导成` : undefined,
    kind: failedSheets.length ? 'unknown' : undefined
  }
}

/**
 * 导出报表：
 * - 流水：建 1 张子表，12 字段全写
 * - 月度：按设计师一人一张，只写 7 列（体量 / 备注留空）
 * 0 条时直接成功返回（不建子表，避免留空子表）。
 */
export async function exportReport(
  input: ExportReportInput,
  adapter: ReportAdapter
): Promise<ExportReportResult> {
  const kind: ReportKind = input.kind === 'monthly' ? 'monthly' : 'flow'
  const warnings: string[] = []
  const rows = buildReportRows(input.start, input.end)
  const sheetTitle = kind === 'flow' ? reportSheetTitle(input.start, input.end) : undefined
  if (rows.length === 0) {
    return { ok: true, count: 0, sheetTitle, skipped: 0 }
  }

  const tpl = await fetchTemplate(input, adapter)
  if (!tpl.ok) return { ...tpl.result, sheetTitle }
  checkFields(kind, tpl.fields, warnings)

  return kind === 'monthly'
    ? exportMonthly(input, rows, tpl.fields, adapter, warnings)
    : exportFlow(input, rows, tpl.fields, adapter, warnings)
}
