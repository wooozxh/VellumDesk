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

/** 报表配置的 meta 键（报表表格 docid + 模板子表名） */
export const REPORT_META_KEYS = {
  docid: 'report_docid',
  templateSheet: 'report_template_sheet'
} as const

/** 读报表配置（未配置 docid → null；模板子表名默认「报表模板」） */
export function readReportConfig(): { docid: string | null; templateSheet: string } {
  return {
    docid: getMeta(REPORT_META_KEYS.docid),
    templateSheet: getMeta(REPORT_META_KEYS.templateSheet) || '报表模板'
  }
}

/** 写报表配置（导出弹窗里粘贴链接时落库） */
export function writeReportConfig(docid: string, templateSheet: string): void {
  setMeta(REPORT_META_KEYS.docid, docid)
  setMeta(REPORT_META_KEYS.templateSheet, templateSheet || '报表模板')
}

/** 报表模板的 12 个字段名（精确匹配用户建好的「报表模板」子表列名） */
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
  /** 报表模板子表名（默认「报表模板」） */
  templateSheet: string
  /** 起止日期（YYYY-MM-DD） */
  start: string
  end: string
}

export interface ExportReportResult {
  ok: boolean
  /** 新建的子表名（= 起止日期） */
  sheetTitle?: string
  /** 导出的条数 */
  count?: number
  /** 字段缺失 / 类型不符 / 选项缺失的警告（不阻断导出） */
  fieldWarnings?: string[]
  kind?: 'cli-missing' | 'auth-expired' | 'unknown'
  error?: string
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
 * 一行 → 记录值（values 的 key = 字段名）。字段缺失/类型不匹配时跳过并留 warning。
 * 单值列 null → 不写该键（让表格保持空，而不是写空串/0）。
 */
function serializeRow(
  row: ReportRow,
  fieldMap: Map<string, ReportField>,
  thumbUrls: string[],
  warnings: string[]
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
  } else {
    warnings.push(`报表模板缺「${REPORT_FIELD.type}」字段`)
  }

  // 编号（文本）
  if (field(REPORT_FIELD.no)) v[REPORT_FIELD.no] = row.ticketNo
  else warnings.push(`报表模板缺「${REPORT_FIELD.no}」字段`)

  // 完成时间（日期）
  if (field(REPORT_FIELD.doneTime) && row.doneTime) v[REPORT_FIELD.doneTime] = toDateTime(row.doneTime)
  else if (!field(REPORT_FIELD.doneTime)) warnings.push(`报表模板缺「${REPORT_FIELD.doneTime}」字段`)

  // 物料名称 / 业务归属（文本）
  if (field(REPORT_FIELD.title) && row.title) v[REPORT_FIELD.title] = row.title
  if (field(REPORT_FIELD.project) && row.projectName) v[REPORT_FIELD.project] = row.projectName

  // 申请人（成员，多选）：单元素数组
  if (field(REPORT_FIELD.applicant) && row.applicantName) {
    v[REPORT_FIELD.applicant] = [{ userName: row.applicantName }]
  }
  // 设计师（成员，多选）：全量 [{userName}]
  if (field(REPORT_FIELD.designers) && row.designers.length) {
    v[REPORT_FIELD.designers] = row.designers.map((d) => ({ userName: d.name }))
  }

  // 缩略图（图片）：先 rehost 拿到报表空间 URL —— 第 27 批起可多张，一次性写入同一图片列
  if (field(REPORT_FIELD.thumb) && thumbUrls.length > 0) {
    v[REPORT_FIELD.thumb] = thumbUrls.map((u) => ({ title: row.ticketNo, imageUrl: u }))
  }

  // 印刷数量（数字）/ 印刷金额（货币）/ 绩效金额（货币）
  if (field(REPORT_FIELD.qty) && row.printQty != null) v[REPORT_FIELD.qty] = row.printQty
  if (field(REPORT_FIELD.printCost) && row.printCost != null) v[REPORT_FIELD.printCost] = row.printCost
  if (field(REPORT_FIELD.performanceCost) && row.performanceCost != null) {
    v[REPORT_FIELD.performanceCost] = row.performanceCost
  }

  // 备注（文本）
  if (field(REPORT_FIELD.remark) && row.remark) v[REPORT_FIELD.remark] = row.remark

  return v
}

// ============================================================ 导出主流程

/** 起止日期 → 子表名（如 2026-10-01~2026-10-31，docs/22 §7 #3） */
export function reportSheetTitle(start: string, end: string): string {
  return `${start}~${end}`
}

/**
 * 导出报表：选起止日期 → 建子表（复制字段）→ 逐条写记录（含图片列重新上传）。
 * 0 条时直接成功返回（不建子表，避免留空子表）。
 */
export async function exportReport(
  input: ExportReportInput,
  adapter: ReportAdapter
): Promise<ExportReportResult> {
  const warnings: string[] = []
  const rows = buildReportRows(input.start, input.end)
  const sheetTitle = reportSheetTitle(input.start, input.end)
  if (rows.length === 0) {
    return { ok: true, count: 0, sheetTitle }
  }

  const tpl = await adapter.fetchTemplateFields(input.docid, input.templateSheet)
  if (!tpl.ok || !tpl.data) {
    return { ok: false, kind: tpl.kind ?? 'unknown', error: tpl.error, sheetTitle }
  }
  const fieldMap = buildFieldMap(tpl.data)

  // 建子表（复制「报表模板」字段结构）
  const add = await adapter.addSheet(input.docid, sheetTitle, tpl.data)
  if (!add.ok) {
    return { ok: false, kind: add.kind ?? 'unknown', error: add.error, sheetTitle }
  }

  // 逐条序列化 + 缩略图重新上传（第 27 批：一条可能有几张成品图，逐张重传、单张失败只记警告）
  const records: Array<{ values: Record<string, unknown> }> = []
  for (const row of rows) {
    const thumbUrls: string[] = []
    for (const src of row.thumbUrls) {
      const rh = await adapter.rehostThumb(src, input.docid)
      if (rh.ok && rh.data) thumbUrls.push(rh.data)
      else warnings.push(`工单 ${row.ticketNo} 缩略图重新上传失败：${rh.error ?? ''}`)
    }
    records.push({ values: serializeRow(row, fieldMap, thumbUrls, warnings) })
  }

  const wr = await adapter.addRecords(input.docid, sheetTitle, records)
  if (!wr.ok) {
    return { ok: false, kind: wr.kind ?? 'unknown', error: wr.error, sheetTitle, fieldWarnings: warnings }
  }
  return { ok: true, count: rows.length, sheetTitle, fieldWarnings: warnings }
}
