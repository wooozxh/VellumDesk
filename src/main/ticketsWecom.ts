/**
 * 第 13 批（工单模块，docs/15 §4）：wecom-cli 适配器 —— 唯一允许碰外部进程的地方。
 *
 * 职责边界：
 *  - 拉子表清单 / 翻页拉记录 / 读授权身份 —— 全部**只读**
 *  - 把 CLI 的输出翻译成 applySync 吃得进去的干净结构（SheetPayload 等）
 *  - 识别三类失败：CLI 未安装 / 授权过期（850003）/ 其他错误 —— 每种都有明确出口（§4.4）
 *
 * 硬规矩：**只许 spawn 异步**（沙箱 spawnSync 全 EBUSY；正式应用也不该阻塞主进程）。
 * 真实外部依赖不进自动测试（§4.3）—— accept 断言全部喂假数据，本文件不进断言。
 *
 * CLI 在哪：优先环境变量 WECOM_CLI_JS / WECOM_CLI_NODE（同事机器装机时统一设），
 * 兜底用开发机的已知路径。找不到 → 返回 cliMissing，界面降级提示，不影响其他功能。
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import type { SheetPayload, TicketRawRecord, TicketType, WecomSheetRef } from './tickets'

/** 开发机的已知安装路径（用户机器 + 授权已配好；同事机器靠环境变量或同路径安装） */
const DEV_CLI_JS =
  'C:/Users/30873/.workbuddy/binaries/node/cli-connector-packages/node_modules/@wecom/cli/bin/wecom.js'
const DEV_NODE = 'C:/Users/30873/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'

/** CLI 失败的三类出口（§4.4，界面按类型分别提示） */
export type CliFailKind = 'cli-missing' | 'auth-expired' | 'unknown'

export interface CliResult<T> {
  ok: boolean
  data?: T
  error?: string
  kind?: CliFailKind
}

interface RawRun {
  code: number | null
  out: string
  err: string
  spawnError?: string
}

/** 异步跑一次 CLI（绝不用 spawnSync） */
function runRaw(args: string[], timeoutMs: number): Promise<RawRun> {
  const cliJs = process.env.WECOM_CLI_JS || DEV_CLI_JS
  const node = process.env.WECOM_CLI_NODE || (existsSync(DEV_NODE) ? DEV_NODE : 'node')
  return new Promise((resolve) => {
    if (!existsSync(cliJs)) {
      resolve({ code: null, out: '', err: '', spawnError: 'CLI_NOT_FOUND' })
      return
    }
    const child = spawn(node, [cliJs, ...args], { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: null, out, err: err + '\nCLI_TIMEOUT' })
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: null, out, err, spawnError: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, out, err })
    })
  })
}

/** 跑 CLI 并解析 JSON 输出；识别授权过期 / 未安装 */
async function runCliJson<T>(args: string[], timeoutMs = 60000): Promise<CliResult<T>> {
  const r = await runRaw(args, timeoutMs)
  if (r.spawnError === 'CLI_NOT_FOUND' || r.spawnError === 'ENOENT') {
    return { ok: false, kind: 'cli-missing', error: 'wecom-cli 未安装或路径未配置' }
  }
  const text = r.out + '\n' + r.err
  if (/850003|权限已过期|使用权限已过期/.test(text)) {
    return { ok: false, kind: 'auth-expired', error: '企微授权已过期' }
  }
  if (r.code !== 0) {
    return { ok: false, kind: 'unknown', error: text.trim().slice(0, 500) }
  }
  try {
    return { ok: true, data: JSON.parse(r.out) as T }
  } catch {
    return { ok: false, kind: 'unknown', error: 'CLI 输出不是合法 JSON：' + r.out.slice(0, 200) }
  }
}

// ============================================================ docid 解析（设置里粘链接）

/** 链接或裸 docid → 规范 docid（s3_xxx）。认不出返回 null。 */
export function extractDocid(input: string): string | null {
  const s = (input || '').trim()
  const m = s.match(/(s3_[A-Za-z0-9]+)/)
  if (m) return m[1]
  // 粘的就是裸 docid（不带 s3_ 前缀的历史格式）—— 原样接受
  if (/^[A-Za-z0-9_-]{8,}$/.test(s)) return s
  return null
}

// ============================================================ 授权身份（identity whoami，隐藏命令）

export interface WecomIdentity {
  userid: string
  name: string
}

/**
 * 本机身份 = CLI 的授权真人（docs/15 §2.2②）。
 * whoami 的 extra_identity_context 里有「授权真人用户身份：名字：X ID：woJ3…」，
 * userid 与智能表格「设计师」列（成员类型）存的 userId 同源 —— 精确匹配，重名不怕。
 */
export async function fetchIdentity(): Promise<CliResult<WecomIdentity>> {
  const r = await runCliJson<{ extra_identity_context?: string }>(['identity', 'whoami', '--json', '{}'])
  if (!r.ok || !r.data) return { ok: false, kind: r.kind ?? 'unknown', error: r.error }
  const ctx = r.data.extra_identity_context ?? ''
  const m = ctx.match(/授权真人用户身份：\s*\n名字：\s*(\S+?)[\s,，]*\n?ID：\s*(\S+)/)
  if (!m) return { ok: false, kind: 'unknown', error: 'whoami 返回里解析不出授权人身份' }
  return { ok: true, data: { name: m[1], userid: m[2] } }
}

// ============================================================ 子表清单

export interface WecomFieldRef {
  field_title: string
  field_type: string
}

export interface SheetsInfo {
  docName: string | null
  sheets: WecomSheetRef[]
  /** 第 17 批（docs/19 §7）：各子表的列清单 —— 用于检测「设计师」成员列在不在/是不是 user 类型 */
  fieldsBySheet?: Record<string, WecomFieldRef[]>
}

export async function fetchSheets(docid: string): Promise<CliResult<SheetsInfo>> {
  const r = await runCliJson<{
    name?: string
    sheets?: Array<{ sheet_id: string; title: string; fields?: Array<{ field_title: string; field_type: string }> }>
  }>([
    'smartsheet',
    'sheets',
    'list',
    '--json',
    JSON.stringify({ docid })
  ])
  if (!r.ok || !r.data) return { ok: false, kind: r.kind ?? 'unknown', error: r.error }
  const fieldsBySheet: Record<string, WecomFieldRef[]> = {}
  const sheets: WecomSheetRef[] = []
  for (const s of r.data.sheets ?? []) {
    sheets.push({ sheet_id: s.sheet_id, title: s.title })
    if (Array.isArray(s.fields)) {
      fieldsBySheet[s.sheet_id] = s.fields.map((f) => ({
        field_title: f.field_title,
        field_type: f.field_type
      }))
    }
  }
  return {
    ok: true,
    data: { docName: r.data.name ?? null, sheets, fieldsBySheet }
  }
}

// ============================================================ 记录（翻页拉全量）

interface RecordsPage {
  records?: TicketRawRecord[]
  has_more?: boolean
  next_cursor?: string
  next?: string
}

/**
 * 一个子表拉全量（按游标翻页，每页 500；实测 257 条一页就完，翻页是给将来数据量上来的）。
 * type 由调用方按配置（子表→工单类型映射）传进来 —— 适配器不管业务语义。
 */
export async function fetchSheetRecords(
  docid: string,
  sheet_id: string,
  title: string,
  type: TicketType
): Promise<CliResult<SheetPayload>> {
  const records: TicketRawRecord[] = []
  let cursor: string | undefined
  let total = 0
  // 防呆上限：10 页 × 500 = 5000 条，超过说明哪里出问题了，别死循环
  for (let page = 0; page < 10; page++) {
    const body: Record<string, unknown> = { docid, sheet_id, limit: 500 }
    if (cursor) body.cursor = cursor
    const r = await runCliJson<RecordsPage>([
      'smartsheet',
      'records',
      'list',
      '--json',
      JSON.stringify(body)
    ])
    if (!r.ok || !r.data) return { ok: false, kind: r.kind ?? 'unknown', error: r.error }
    const batch = r.data.records ?? []
    records.push(...batch)
    total += batch.length
    const next = r.data.next_cursor ?? r.data.next
    if (!r.data.has_more || !next) break
    cursor = next
  }
  return { ok: true, data: { sheet_id, title, type, records } }
}

// ============================================================ 写回（第 17 批 docs/19，真表实探钉死）

/** 一次写回的入参：值按「列名 → 企微原生结构」传（成员列 = [{userId}] 嵌套对象数组） */
export interface UpdateRecordsInput {
  docid: string
  sheet_id: string
  records: Array<{ record_id: string; values: Record<string, unknown> }>
}

/**
 * 批量更新智能表格记录（一次只写几张单，远用不到 2000 行上限）。
 *
 * 实探结论（docs/19 §15，2026-10-02 真表验证）：
 *  - `values` 里成员列的值传**嵌套数组对象**（`[{userId:...}]`）；
 *    CLI schema 声明的「值=JSON 字符串」形式会被服务端拒收（值类型与列类型不符）
 *  - ⚠️ **errcode=0 ≠ 写成功**：写不进去时 errcode 也是 0，拒绝原因藏在 helper_msg 里
 *    （"全部 N 条 record 的单元格都不可写入/已跳过"）—— 这里把 helper_msg 含
 *    "跳过/不可写入"字样判为失败，errcode 只作辅助
 */
export async function updateRecords(input: UpdateRecordsInput): Promise<CliResult<null>> {
  const body = {
    docid: input.docid,
    sheet_id: input.sheet_id,
    type: 'update' as const,
    key_type: 'field_title' as const,
    records: input.records
  }
  const r = await runCliJson<{ errcode?: number; errmsg?: string; helper_msg?: string }>([
    'smartsheet',
    'records',
    'update',
    '--json',
    JSON.stringify(body)
  ])
  if (!r.ok || !r.data) return { ok: false, kind: r.kind ?? 'unknown', error: r.error }
  if (typeof r.data.errcode === 'number' && r.data.errcode !== 0) {
    return { ok: false, kind: 'unknown', error: r.data.errmsg || `errcode ${r.data.errcode}` }
  }
  const helper = r.data.helper_msg ?? ''
  if (helper.includes('跳过') || helper.includes('不可写入')) {
    return { ok: false, kind: 'unknown', error: helper.trim().slice(0, 300) }
  }
  return { ok: true, data: null }
}

/**
 * 机器人发 markdown 消息（第 17 批：指派成功后通知设计师）。
 * 单聊的 chat_id = 接收成员的 userid（实探验证，docs/19 §15）。
 * 已知约束：设计师若从未与机器人有过消息往来，可能发不出去 —— 调用方按失败降级。
 */
export async function sendBotTextMessage(
  userid: string,
  content: string
): Promise<CliResult<null>> {
  const r = await runCliJson<{ success?: boolean; errcode?: number; errmsg?: string }>([
    'message',
    'aibot',
    'send',
    '--json',
    JSON.stringify({
      chat_id: userid,
      msg_type: 'markdown',
      markdown: { content }
    })
  ])
  if (!r.ok || !r.data) return { ok: false, kind: r.kind ?? 'unknown', error: r.error }
  if (r.data.success === true) return { ok: true, data: null }
  if (typeof r.data.errcode === 'number' && r.data.errcode !== 0) {
    return { ok: false, kind: 'unknown', error: r.data.errmsg || `errcode ${r.data.errcode}` }
  }
  if (r.data.success === false) return { ok: false, kind: 'unknown', error: '机器人消息发送失败' }
  return { ok: true, data: null }
}
