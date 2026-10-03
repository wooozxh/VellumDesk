/**
 * 第 19 批（docs/22 导出报表）：报表 wecom-cli 适配器 —— 唯一允许碰外部进程的地方。
 *
 * 职责：把「工单报表」智能表格的写操作翻译成 wecom-cli 调用。
 *  - 读报表模板字段（fields list）→ 复制字段结构用
 *  - 建子表（sheets add + fields）→ 每次导出按起止日期新建子表
 *  - 上传本地图片（media upload → images upload）→ 拿图片 URL 写 image 列
 *  - 写记录（records add）
 *
 * 架构铁律延续（docs/15 §4.3）：引擎（report.ts）不碰网络，本文件是实现注入；
 * 自动测试全部喂 mock，真企微只在人工验收时点一次。
 */
import { runCliJson, type CliResult } from './ticketsWecom'
import { createWriteStream } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { unlink } from 'fs/promises'
import http from 'http'
import https from 'https'

/** 报表模板的一个字段（fields list 的原始结构，property_xxx 原样保留供复制） */
export interface ReportField {
  field_title: string
  field_type: string
  [prop: string]: unknown
}

/**
 * 读「工单报表」里某个子表的字段清单（用于复制「报表模板」的字段结构）。
 * 返回原始字段（field_title + field_type + property_xxx），调用方据此建子表 / 序列化值。
 */
export async function fetchReportTemplateFields(
  docid: string,
  sheetTitle: string
): Promise<CliResult<ReportField[]>> {
  const r = await runCliJson<{ fields?: ReportField[] }>([
    'smartsheet',
    'fields',
    'list',
    '--json',
    JSON.stringify({ docid, sheet_title: sheetTitle, limit: 100 })
  ])
  if (!r.ok || !r.data) return { ok: false, kind: r.kind ?? 'unknown', error: r.error }
  return { ok: true, data: r.data.fields ?? [] }
}

/** fields list 的字段 → sheets add 的 fields（只留 field_title + field_type + property_*） */
function toSheetAddField(f: ReportField): Record<string, unknown> {
  const out: Record<string, unknown> = { field_title: f.field_title, field_type: f.field_type }
  for (const [k, v] of Object.entries(f)) {
    if (k.startsWith('property_')) out[k] = v
  }
  return out
}

/**
 * 建子表（复制「报表模板」字段结构）。sheet_title 由调用方按起止日期命名。
 * fields 传 fields list 的原始字段（内部过滤出 field_title/field_type/property_*）。
 */
export async function addReportSheet(
  docid: string,
  sheetTitle: string,
  fields: ReportField[]
): Promise<CliResult<null>> {
  const r = await runCliJson<{ errcode?: number; errmsg?: string; helper_msg?: string }>([
    'smartsheet',
    'sheets',
    'add',
    '--json',
    JSON.stringify({ docid, sheet_title: sheetTitle, fields: fields.map(toSheetAddField) })
  ])
  if (!r.ok || !r.data) return { ok: false, kind: r.kind ?? 'unknown', error: r.error }
  if (typeof r.data.errcode === 'number' && r.data.errcode !== 0) {
    return { ok: false, kind: 'unknown', error: r.data.errmsg || `errcode ${r.data.errcode}` }
  }
  return { ok: true, data: null }
}

/**
 * 上传一张本地图片到目标智能表格的文档空间，返回图片 URL。
 * 两步：media upload（本地文件 → media_id）→ images upload（media_id + docid → url）。
 */
export async function uploadReportImage(docid: string, localPath: string): Promise<CliResult<string>> {
  const up = await runCliJson<{ media_id?: string }>([
    'media',
    'upload',
    '--json',
    JSON.stringify({ file_path: localPath })
  ])
  if (!up.ok || !up.data || !up.data.media_id) {
    return { ok: false, kind: up.kind ?? 'unknown', error: up.error ?? '媒体上传失败（拿不到 media_id）' }
  }
  const img = await runCliJson<{ url?: string }>([
    'smartsheet',
    'images',
    'upload',
    '--json',
    JSON.stringify({ media_id: up.data.media_id, docid })
  ])
  if (!img.ok || !img.data || !img.data.url) {
    return { ok: false, kind: img.kind ?? 'unknown', error: img.error ?? '图片上传失败（拿不到 url）' }
  }
  return { ok: true, data: img.data.url }
}

/** 一次写多条记录（records add；values 的 key = 字段名，值格式由调用方按字段类型序列化） */
export async function addReportRecords(
  docid: string,
  sheetTitle: string,
  records: Array<{ values: Record<string, unknown> }>
): Promise<CliResult<null>> {
  const r = await runCliJson<{ errcode?: number; errmsg?: string; helper_msg?: string }>([
    'smartsheet',
    'records',
    'add',
    '--json',
    JSON.stringify({ docid, sheet_title: sheetTitle, records })
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

/** 下载一个 http/https 资源到本地文件（导出时把工单队列缩略图 URL 落成本地再重传） */
function downloadTo(url: string, dest: string): Promise<boolean> {
  return new Promise((resolve) => {
    const lib = url.startsWith('https://') ? https : http
    const req = lib.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve(false)
        return
      }
      const ws = createWriteStream(dest)
      res.pipe(ws)
      ws.on('finish', () => resolve(true))
      ws.on('error', () => resolve(false))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * 把工单队列空间的缩略图 URL 重新上传到「工单报表」文档空间，返回报表空间图片 URL。
 * 三步：下载源图 → media upload → images upload(docid)。跨文档 image URL 直接复用待实测
 * （docs/22 §8 #4），默认稳妥地重传。
 */
export async function rehostReportThumb(sourceUrl: string, docid: string): Promise<CliResult<string>> {
  const tmpPath = join(tmpdir(), `wb-report-thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`)
  const dl = await downloadTo(sourceUrl, tmpPath)
  if (!dl) {
    await unlink(tmpPath).catch(() => {})
    return { ok: false, kind: 'unknown', error: '缩略图下载失败' }
  }
  const up = await uploadReportImage(docid, tmpPath)
  await unlink(tmpPath).catch(() => {})
  return up
}
