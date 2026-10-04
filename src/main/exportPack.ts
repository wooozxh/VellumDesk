import { COPY, fmt } from '../shared/copy'
import type { AssetItem, DeliveryRecord, PackExportInput, PackExportResult, PackVersion } from '../shared/types'
import { getDb, type DeliveryRecordRow } from './db'
import { getPackDetail, UNASSIGNED_ROLE } from './workspace'
import { readImageMeta, readPsdMeta, readVideoMeta, isImage, isPsd, isVideo } from './thumbs'
import { join, basename, extname } from 'path'
import { createWriteStream, existsSync, statSync, mkdirSync, unlinkSync } from 'fs'
import { ZipArchive } from 'archiver'
import type { Archiver } from 'archiver'

/** 第 15 批（M5 交付打包）：打包计划中的一条文件 */
export interface ExportFileEntry {
  assetId: number
  absPath: string
  role: string
  versionId: number | null
  versionSeq: number | null
  innerPath: string
}

/** 打包计划 */
export interface ExportPlan {
  packName: string
  projectName: string | null
  versionLabel: string
  sizeText: string
  dateText: string
  zipName: string
  outputDir: string
  outputPath: string
  wrapFolder: boolean
  entries: ExportFileEntry[]
  totalSize: number
}

const ROLE_TO_FOLDER: Record<string, string> = {
  成品: '成品',
  素材: '素材',
  工程: '工程',
  [UNASSIGNED_ROLE]: '未归属'
}

function nowIso(): string {
  return new Date().toISOString()
}

function todayYmd(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"\\/|?*\x00-\x1f]/g, '_').trim()
}

function uniqueFileName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let i = 1
  while (i < 9999) {
    const candidate = `${stem} (${i})${ext}`
    if (!existsSync(join(dir, candidate))) return candidate
    i += 1
  }
  return name
}

function versionSeqForFile(entry: ExportFileEntry, mode: PackExportInput['versionMode']): number | null {
  if (mode === 'all') return entry.versionSeq
  return null
}

/**
 * 从所选文件里自动抓取一个尺寸。
 * 优先读「成品」分组里第一个有宽高的图片/PSD/视频；
 * 没有就往素材、工程、未归属里扩散。
 * 返回值如 "1920x1080"，读不到返回 null。
 */
export async function detectSizeForPack(
  packId: number,
  versionMode: PackExportInput['versionMode'],
  specificVersionId?: number | null
): Promise<string | null> {
  const detail = getPackDetail(packId)
  const versions = detail.versions
  let targetVersionIds: (number | null)[] = []

  if (versionMode === 'current') {
    const cur = versions.find((v) => v.is_current === 1)
    targetVersionIds = cur ? [cur.id] : [null]
  } else if (versionMode === 'specific') {
    targetVersionIds = [specificVersionId ?? null]
  } else {
    targetVersionIds = [null, ...versions.map((v) => v.id)]
  }

  const roleOrder = ['成品', '素材', '工程', UNASSIGNED_ROLE]
  const candidates: AssetItem[] = []
  for (const role of roleOrder) {
    const items = (detail.groups[role] ?? []).filter(
      (i) => targetVersionIds.includes(i.version_id) && !i.missing_at && (i.width || i.height)
    )
    candidates.push(...items)
  }

  for (const item of candidates) {
    const wh = await readSizeFromDisk(item.abs_path, item.ext)
    if (wh) return wh
  }
  return null
}

async function readSizeFromDisk(absPath: string, ext: string): Promise<string | null> {
  if (!existsSync(absPath)) return null
  try {
    if (isImage(ext)) {
      const m = await readImageMeta(absPath)
      if (m.width && m.height) return `${m.width}x${m.height}`
    } else if (isPsd(ext)) {
      const m = await readPsdMeta(absPath)
      if (m.width && m.height) return `${m.width}x${m.height}`
    } else if (isVideo(ext)) {
      const m = await readVideoMeta(absPath)
      if (m.width && m.height) return `${m.width}x${m.height}`
    }
  } catch {
    /* 读不到就拉倒 */
  }
  return null
}

/**
 * 根据输入和当前状态生成打包计划（不碰磁盘、不写 zip）。
 */
export async function buildPackExportPlan(input: PackExportInput): Promise<ExportPlan> {
  const detail = getPackDetail(input.packId)
  const pack = detail.pack
  const versions = detail.versions

  // 项目名
  const projectName = pack.projectName || null

  // 确定要打包的 version_id 列表
  let targetVersions: PackVersion[] = []
  if (input.versionMode === 'all') {
    targetVersions = versions.slice()
  } else if (input.versionMode === 'specific' && input.specificVersionId) {
    const v = versions.find((x) => x.id === input.specificVersionId)
    if (!v) throw new Error(COPY.wsErr.targetVerMissing)
    targetVersions = [v]
  } else {
    const cur = versions.find((v) => v.is_current === 1)
    if (cur) targetVersions = [cur]
  }

  const targetVersionIds = new Set(targetVersions.map((v) => v.id))
  const unassignedTarget = input.versionMode === 'all' || targetVersions.length === 0

  // 收集文件（按 role 顺序，方便后续编号）
  const roleOrder = ['成品', '素材', '工程', UNASSIGNED_ROLE]
  const entries: ExportFileEntry[] = []
  const excluded = new Set(input.excludedAssetIds ?? [])

  for (const role of roleOrder) {
    if (!input.roles.includes(role)) continue
    const items = (detail.groups[role] ?? []).filter((i) => {
      if (i.missing_at) return false
      if (excluded.has(i.id)) return false
      if (role === UNASSIGNED_ROLE) return unassignedTarget && i.version_id === null
      if (input.versionMode === 'all') return true
      return i.version_id !== null && targetVersionIds.has(i.version_id)
    })
    for (const item of items) {
      const v = item.version_id !== null ? versions.find((x) => x.id === item.version_id) : undefined
      entries.push({
        assetId: item.id,
        absPath: item.abs_path,
        role,
        versionId: item.version_id,
        versionSeq: v ? v.seq : null,
        innerPath: ''
      })
    }
  }

  if (entries.length === 0) throw new Error(COPY.exportPack.noSelection)

  // 尺寸：用户没填就自动抓
  let sizeText = input.size.trim()
  if (!sizeText) {
    const detected = await detectSizeForPack(input.packId, input.versionMode, input.specificVersionId)
    sizeText = detected ?? COPY.exportPack.unknownSize
  }

  // 版本标签
  const versionLabel =
    input.versionMode === 'all'
      ? '全版本'
      : targetVersions.length === 1
        ? `V${targetVersions[0].seq}`
        : targetVersions.length === 0
          ? '未分版本'
          : '多版本'

  // 默认 zip 名
  const dateText = todayYmd()
  const safeProject = sanitizeFileName(projectName ?? '')
  const safePack = sanitizeFileName(pack.name)
  const safeSize = sanitizeFileName(sizeText)
  const safeVersion = sanitizeFileName(versionLabel)
  const defaultZipName = [safeProject, safePack, safeSize, dateText, safeVersion].filter(Boolean).join('-')

  // zip 名同样过非法字符清洗：默认名各段已洗过，但这里是用户手填的原始输入——
  // Windows 文件名不允许 <>:"\/|?*（真机踩坑 2026-10-04：手填「10*1000cm」的星号
  // 直接把 createWriteStream 干出 ENOENT，且错误监听有空窗 → uncaughtException 崩软件）
  const zipName = sanitizeFileName(input.zipName.trim()) || defaultZipName
  const outputDir = input.outputDir || pack.folder_path
  const outputPath = join(outputDir, uniqueFileName(outputDir, `${zipName}.zip`))

  // 内部路径与文件名
  const wrapFolderName = zipName
  const innerEntries = buildInnerPaths(entries, {
    packName: pack.name,
    sizeText,
    dateText,
    mode: input.versionMode,
    keepOriginalName: input.keepOriginalName,
    customTemplate: input.customNameTemplate,
    wrapFolder: input.wrapFolder,
    wrapFolderName
  })

  const totalSize = entries.reduce((s, e) => {
    try {
      return s + statSync(e.absPath).size
    } catch {
      return s
    }
  }, 0)

  return {
    packName: pack.name,
    projectName,
    versionLabel,
    sizeText,
    dateText,
    zipName,
    outputDir,
    outputPath,
    wrapFolder: input.wrapFolder,
    entries: innerEntries,
    totalSize
  }
}

interface InnerNameOptions {
  packName: string
  sizeText: string
  dateText: string
  mode: PackExportInput['versionMode']
  keepOriginalName: boolean
  customTemplate?: string
  wrapFolder: boolean
  wrapFolderName: string
}

function buildInnerPaths(entries: ExportFileEntry[], opts: InnerNameOptions): ExportFileEntry[] {
  // 按 role 分组，计算序号
  const byRole: Record<string, ExportFileEntry[]> = {}
  for (const e of entries) {
    if (!byRole[e.role]) byRole[e.role] = []
    byRole[e.role].push(e)
  }

  const roleCounters: Record<string, number> = {}
  const usedNames = new Set<string>()

  return entries.map((e) => {
    const folderName = ROLE_TO_FOLDER[e.role] ?? e.role
    const roleSeq = (roleCounters[e.role] ?? 0) + 1
    roleCounters[e.role] = roleSeq

    // 版本层：全部版本时，顶层按版本分；其他情况直接是分组文件夹
    const versionSeq = versionSeqForFile(e, opts.mode)
    const versionFolder = versionSeq !== null ? `V${versionSeq}` : null

    // 文件名
    let fileName: string
    if (opts.customTemplate) {
      fileName = applyCustomTemplate(opts.customTemplate, {
        packName: opts.packName,
        size: opts.sizeText,
        version: versionSeq !== null ? `V${versionSeq}` : '',
        stem: fileStem(basename(e.absPath)),
        date: opts.dateText,
        seq: roleSeq,
        ext: extname(e.absPath).replace(/^\./, '')
      })
    } else {
      fileName = buildDefaultInnerName(e, {
        packName: opts.packName,
        size: opts.sizeText,
        version: versionSeq !== null ? `V${versionSeq}` : '',
        date: opts.dateText,
        seq: roleSeq,
        keepOriginalName: opts.keepOriginalName
      })
    }

    fileName = sanitizeFileName(fileName)
    if (!fileName) fileName = '未命名'

    // 去重
    let unique = fileName
    let dup = 1
    while (usedNames.has(unique)) {
      const ext = extname(fileName)
      const stem = fileName.slice(0, fileName.length - ext.length)
      unique = `${stem} (${dup})${ext}`
      dup += 1
    }
    usedNames.add(unique)

    // 组装内部路径
    const parts = opts.wrapFolder ? [opts.wrapFolderName] : []
    if (versionFolder) parts.push(versionFolder)
    parts.push(folderName)
    parts.push(unique)

    return { ...e, innerPath: parts.join('/') }
  })
}

function fileStem(fileName: string): string {
  const ext = extname(fileName)
  return fileName.slice(0, fileName.length - ext.length)
}

function buildDefaultInnerName(
  entry: ExportFileEntry,
  opts: {
    packName: string
    size: string
    version: string
    date: string
    seq: number
    keepOriginalName: boolean
  }
): string {
  const parts = [opts.packName, opts.size]
  if (opts.version) parts.push(opts.version)
  if (opts.keepOriginalName) {
    parts.push(fileStem(basename(entry.absPath)))
  } else {
    parts.push(String(opts.seq).padStart(2, '0'))
  }
  parts.push(opts.date)
  const ext = extname(entry.absPath)
  return parts.join('-') + ext
}

function applyCustomTemplate(
  tpl: string,
  vars: { packName: string; size: string; version: string; stem: string; date: string; seq: number; ext: string }
): string {
  let out = tpl
  out = out.replace(/\{项目名\}/g, vars.packName)
  out = out.replace(/\{任务名\}/g, vars.packName)
  out = out.replace(/\{尺寸\}/g, vars.size)
  out = out.replace(/\{版本\}/g, vars.version)
  out = out.replace(/\{原文件名\}/g, vars.stem)
  out = out.replace(/\{打包日期\}/g, vars.date)
  out = out.replace(/\{序号\}/g, String(vars.seq).padStart(2, '0'))
  out = out.replace(/\{扩展名\}/g, vars.ext)
  return out
}

/**
 * 执行打包：生成 zip、写交付记录、更新版本 delivered_at。
 */
export async function executePackExport(input: PackExportInput): Promise<PackExportResult> {
  let plan: ExportPlan
  try {
    plan = await buildPackExportPlan(input)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  // 防御性校验：所有文件必须存在
  for (const e of plan.entries) {
    if (!existsSync(e.absPath)) {
      return { ok: false, error: fmt(COPY.wsErr.fileGone, { name: basename(e.absPath) }) }
    }
  }

  // 校验目标目录可写
  try {
    mkdirSync(plan.outputDir, { recursive: true })
  } catch (e) {
    return { ok: false, error: COPY.wsErr.notWritable }
  }

  // error listener 必须紧跟 createWriteStream 同步挂上：open 失败（如路径含 Windows 非法字符）
  // 的 error 事件会在下面 await finalize 期间发出，挂晚了 = 无监听 error = uncaughtException 崩软件
  const outputStream = createWriteStream(plan.outputPath)
  let streamError: Error | null = null
  const streamClosed = new Promise<void>((resolve) => {
    outputStream.on('close', () => resolve())
    outputStream.on('error', (err) => {
      streamError = err
      resolve()
    })
  })

  const archive: Archiver = new ZipArchive({ zlib: { level: 6 } })

  let archiveError: Error | null = null
  archive.on('error', (err: Error) => {
    archiveError = err
  })

  archive.pipe(outputStream)

  for (const e of plan.entries) {
    if (archiveError) break
    archive.file(e.absPath, { name: e.innerPath })
  }

  try {
    await archive.finalize()
  } catch (e) {
    archiveError = e as Error
  }

  await streamClosed

  const failure = streamError ?? archiveError
  if (failure) {
    // 清掉半成品 zip，别在工作区留垃圾（没写成时 unlink 失败就随它去）
    try {
      unlinkSync(plan.outputPath)
    } catch {
      /* ignore */
    }
    return { ok: false, error: COPY.exportPack.failed + failure.message }
  }

  // 计算实际 zip 大小
  let outputSize = 0
  try {
    outputSize = statSync(plan.outputPath).size
  } catch {
    /* ignore */
  }

  // 写交付记录
  recordDelivery(input.packId, plan, outputSize)

  // 更新当前版本的 delivered_at（或全部版本）
  updateVersionDeliveredAt(input.packId, plan)

  return {
    ok: true,
    outputPath: plan.outputPath,
    fileCount: plan.entries.length,
    totalSize: outputSize
  }
}

function recordDelivery(packId: number, plan: ExportPlan, outputSize: number): number {
  const db = getDb()
  const versionId =
    plan.entries.length > 0 && plan.entries.every((e) => e.versionId === plan.entries[0].versionId)
      ? plan.entries[0].versionId
      : null
  const scope = [...new Set(plan.entries.map((e) => e.role))]
  const files = plan.entries.map((e) => e.innerPath)

  const info = db
    .prepare(
      `INSERT INTO delivery_records
       (pack_id, version_id, scope_json, files_json, output_path, output_size, file_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      packId,
      versionId,
      JSON.stringify(scope),
      JSON.stringify(files),
      plan.outputPath,
      outputSize,
      files.length,
      nowIso()
    )
  return Number(info.lastInsertRowid)
}

function updateVersionDeliveredAt(packId: number, plan: ExportPlan): void {
  const db = getDb()
  const versionIds = [...new Set(plan.entries.map((e) => e.versionId).filter((v): v is number => v !== null))]
  if (versionIds.length === 0) return
  const ts = nowIso()
  const placeholders = versionIds.map(() => '?').join(',')
  db.prepare(`UPDATE pack_versions SET delivered_at = ? WHERE pack_id = ? AND id IN (${placeholders})`).run(
    ts,
    packId,
    ...versionIds
  )
}

/**
 * 读取某任务的交付记录（按时间倒序）。
 */
export function listDeliveryRecords(packId: number): DeliveryRecord[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM delivery_records WHERE pack_id = ? ORDER BY created_at DESC')
    .all(packId) as DeliveryRecordRow[]
}
