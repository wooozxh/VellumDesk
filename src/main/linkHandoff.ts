/**
 * 第 62 批（docs/45 §3.4）：插件联动（一）—— **handoff 搬运**（唯一反向通道 · ★ 必做项）。
 *
 * 插件（UXP 沙箱）拿不到工作区文件的 Entry（`placeEvent` 不收裸路径，契约 §9.1 第 9 条），
 * 所以用户在插件点「插入」时，**只能**由软件把那一张原图拷进 `handoff\incoming.<ext>`：
 *
 *   插件：写 handoff\req.json（覆盖）
 *   软件：按 **(scope, assetId)** 反查 abs_path（scope=task→assets / scope=brand→brand_assets）
 *         → 拷原图 → 写 handoff\res.json（reqId 原样回填）
 *   插件：轮询 res.json，reqId 匹配 & ok → 读 incoming → 置入
 *
 * 设计约束（同 `linkMirror`）：**不依赖 electron**，且把「轮询」做成显式的 `tick()`——
 * accept 里可以手动驱动、确定性地验，不靠真定时器。
 *
 * 规则（契约 §六）：
 * · 监听方式 = **轮询**（默认 600ms stat req.json 的 mtime+size，变了才处理；不引 chokidar）。
 * · **多镜像目录 → 每个目录都轮询**（req.json 可能来自任一 PS 版本）。
 * · 去重：同一 reqId 不重复处理。清理：>10 分钟的 res.json / incoming.* 由**软件侧**删。
 * · 任何异常一律回 `ok:false` + error，**不抛、不崩**。
 */
import { join, extname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  copyFileSync,
  renameSync,
  utimesSync

} from 'fs'
import { getDb } from './db'
import {
  CONTRACT_VERSION,
  MIRROR_DIR,
  HANDOFF_DIR,
  isoLocal,
  atomicWriteJson,
  type MirrorTarget
} from './linkMirror'

/** 体积阈值（用户 2026-10-10 拍板 300 MB）—— 超了不自动传，回 too_large */
export const DEFAULT_MAX_BYTES = 300 * 1024 * 1024
/** 过期清理阈值：res.json / incoming.* 超过它就被删（契约 §六 规则 5 归软件侧） */
export const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000
/** 轮询间隔 */
export const DEFAULT_POLL_MS = 600

/** 允许置入的扩展名白名单：常见位图 + psd/psb（docs/45 §3.4 / §7 拍板） */
export const HANDOFF_ALLOWED_EXTS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tiff',
  'tif',
  'avif',
  'psd',
  'psb'
])

export interface HandoffOptions {
  workspaceRoot: string
  targets: MirrorTarget[]
  maxBytes?: number
  maxAgeMs?: number
  pollMs?: number
}

export interface HandoffResult {
  reqId: string
  scope: string
  assetId: number
  ok: boolean
  /** 'not_found' | 'missing' | 'too_large' | 'unsupported' | 'bad_contract' | 'bad_request' | 'copy_failed' */
  error?: string
  /** 镜像内相对路径（成功时） */
  file?: string
  size?: number
}

interface ReqJson {
  contract?: unknown
  reqId?: unknown
  assetId?: unknown
  scope?: unknown
  at?: unknown
}

/**
 * handoff 引擎。生产里 `start()` 起定时轮询；测试里手动 `tick()`（确定、无定时器）。
 */
export class HandoffEngine {
  private readonly targets: MirrorTarget[]
  private readonly maxBytes: number
  private readonly maxAgeMs: number
  private readonly pollMs: number
  /** 每个 req.json 的上次「mtime|size」签名 —— 没变就不处理 */
  private readonly seen = new Map<string, string>()
  /** 已处理过的 reqId → 结果（去重） */
  private readonly done = new Map<string, HandoffResult>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(opts: HandoffOptions) {
    this.targets = opts.targets
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS
  }

  /** 启动常驻轮询（生产用）。幂等。 */
  start(): void {
    if (this.timer) return
    const t = setInterval(() => {
      void this.tick()
      this.cleanup()
    }, this.pollMs)
    const maybeUnref = t as unknown as { unref?: () => void }
    if (typeof maybeUnref.unref === 'function') maybeUnref.unref()
    this.timer = t
  }

  /** 停止轮询 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 跑一轮轮询（对每个镜像目录）。返回本轮**新处理**的结果（未变/无请求 → 空数组）。 */
  async tick(): Promise<HandoffResult[]> {
    const out: HandoffResult[] = []
    for (const t of this.targets) {
      const handoff = join(t.pluginDataDir, MIRROR_DIR, HANDOFF_DIR)
      try {
        if (!existsSync(handoff)) mkdirSync(handoff, { recursive: true })
      } catch {
        continue
      }
      const reqPath = join(handoff, 'req.json')
      if (!existsSync(reqPath)) continue
      let sig: string
      try {
        const st = statSync(reqPath)
        sig = `${st.mtimeMs}|${st.size}`
      } catch {
        continue
      }
      if (this.seen.get(reqPath) === sig) continue
      this.seen.set(reqPath, sig)
      out.push(await this.process(handoff, reqPath))
    }
    return out
  }

  /** 清理过期的 res.json / incoming.*（不碰 req.json，那是插件的） */
  cleanup(now: number = Date.now()): number {
    let n = 0
    for (const t of this.targets) {
      const handoff = join(t.pluginDataDir, MIRROR_DIR, HANDOFF_DIR)
      if (!existsSync(handoff)) continue
      let names: string[]
      try {
        names = readdirSync(handoff)
      } catch {
        continue
      }
      for (const nm of names) {
        if (nm === 'req.json') continue
        if (nm !== 'res.json' && !nm.startsWith('incoming.')) continue
        const p = join(handoff, nm)
        try {
          if (now - statSync(p).mtimeMs > this.maxAgeMs) {
            unlinkSync(p)
            n += 1
          }
        } catch {
          /* 删不掉就算了 */
        }
      }
    }
    return n
  }

  // ------------------------------------------------------------ 内部

  private async process(handoff: string, reqPath: string): Promise<HandoffResult> {
    let req: ReqJson
    try {
      req = JSON.parse(readFileSync(reqPath, 'utf-8')) as ReqJson
    } catch {
      return this.reply(handoff, '', 'task', -1, false, 'bad_request')
    }
    const reqId = typeof req.reqId === 'string' ? req.reqId : ''
    const assetId = typeof req.assetId === 'number' ? req.assetId : -1
    /**
     * `scope` 决定**去哪张表**反查（契约 §六 规则 8；`tpl` 为 2026-10-17 加法）：
     * · `task`  → `assets`（任务库）
     * · `brand` → `brand_assets`（通用素材库，docs/46）
     * · `tpl`   → `tpl_assets`（PSD 模板库，docs/49）—— 模板走同一条通道，落成 `incoming.psd` 供插件 `app.open`
     * 三个库的 `id` **各自从 1 起**（契约 §5.5 命名空间）⇒ **绝不能全局只按 id 查**，
     * 否则 brand 的 `id=59` 撞上任务库的 `id=59` 会拷回**另一张图**（"置入成功但图不对"，极难归因）。
     * 缺省 / 空串 → 按 `task`（向后兼容旧行为）；其它未知值 → `bad_request`（**不猜**，避免误投）。
     */
    const rawScope = typeof req.scope === 'string' ? req.scope.trim() : ''
    const scope = rawScope === '' ? 'task' : rawScope

    if (!String(req.contract ?? '').startsWith('vellum-link/')) {
      return this.reply(handoff, reqId, scope, assetId, false, 'bad_contract')
    }
    if (!reqId) return this.reply(handoff, reqId, scope, assetId, false, 'bad_request')
    if (scope !== 'task' && scope !== 'brand' && scope !== 'tpl') {
      return this.reply(handoff, reqId, scope, assetId, false, 'bad_request')
    }

    // 去重：同一 reqId 不再重复拷（也不重写 res.json）
    const prev = this.done.get(reqId)
    if (prev) return prev

    const db = getDb()
    // **先按 scope 定表、再按 id 查** —— 从构造上杜绝串库（三库 id 各自从 1 起）
    const table = scope === 'brand' ? 'brand_assets' : scope === 'tpl' ? 'tpl_assets' : 'assets'
    const row = db
      .prepare(`SELECT id, abs_path, ext, size, missing_at FROM ${table} WHERE id = ?`)
      .get(assetId) as
      | { id: number; abs_path: string; ext: string; size: number; missing_at: string | null }
      | undefined
    if (!row) return this.reply(handoff, reqId, scope, assetId, false, 'not_found')
    if (row.missing_at !== null) return this.reply(handoff, reqId, scope, assetId, false, 'missing')
    if (!existsSync(row.abs_path)) return this.reply(handoff, reqId, scope, assetId, false, 'not_found')

    const ext = extname(row.abs_path).replace(/^\./, '').toLowerCase()
    if (!HANDOFF_ALLOWED_EXTS.has(ext)) {
      return this.reply(handoff, reqId, scope, assetId, false, 'unsupported')
    }

    let size = row.size
    try {
      size = statSync(row.abs_path).size
    } catch {
      /* 用库里的 size */
    }
    if (size > this.maxBytes) {
      return this.reply(handoff, reqId, scope, assetId, false, 'too_large')
    }

    const dst = join(handoff, `incoming.${ext}`)
    const tmp = join(handoff, `incoming.${ext}.tmp`)
    try {
      copyFileSync(row.abs_path, tmp)
      renameSync(tmp, dst)
      /**
       * 🔴 必须把 mtime 归零到现在（2026-10-11 真机 bug 修复）。
       * Windows 的 `CopyFile`（Node `copyFileSync` 底层）会**连同源文件的修改时间一起搬过来** ——
       * 于是刚写出的 `incoming.jpg` 带着**源图的旧 mtime**（实测一张 20 天前的图 → 年龄 29465 分钟）。
       * 紧接着 `cleanup()`（">10 分钟即过期"）会把它**当成过期文件当场删掉**，
       * 而`res.json` 是刚写的、mtime 新、活了下来 ⇒ 插件看到 res 说 ok，却怎么也读不到文件（置入失败）。
       * 这里显式盖一个"现在"的时间戳，保证 incoming 永远算"新鲜"，不会被 cleanup 误杀。
       */
      const stamp = new Date()
      utimesSync(dst, stamp, stamp)
    } catch {
      return this.reply(handoff, reqId, scope, assetId, false, 'copy_failed')
    }
    return this.reply(handoff, reqId, scope, assetId, true, undefined, `${HANDOFF_DIR}/incoming.${ext}`, size)
  }

  private reply(
    handoff: string,
    reqId: string,
    scope: string,
    assetId: number,
    ok: boolean,
    error?: string,
    file?: string,
    size?: number
  ): HandoffResult {
    const res = {
      contract: CONTRACT_VERSION,
      reqId,
      ok,
      file: file ?? null,
      size: size ?? null,
      error: error ?? null,
      at: isoLocal()
    }
    try {
      atomicWriteJson(join(handoff, 'res.json'), res)
    } catch {
      /* 写不了 res 也不能崩 */
    }
    const result: HandoffResult = { reqId, scope, assetId, ok, error, file, size }
    if (reqId) this.done.set(reqId, result)
    return result
  }
}

/** 便于调用方/测试：读出当前 res.json（没有则 null） */
export function readHandoffResult(pluginDataDir: string): Record<string, unknown> | null {
  const p = join(pluginDataDir, MIRROR_DIR, HANDOFF_DIR, 'res.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 便于调用方/测试：往 handoff 目录写一条 req.json（模拟插件行为） */
export function writeHandoffRequest(
  pluginDataDir: string,
  req: { reqId: string; assetId: number; scope?: string; contract?: string }
): void {
  const handoff = join(pluginDataDir, MIRROR_DIR, HANDOFF_DIR)
  mkdirSync(handoff, { recursive: true })
  atomicWriteJson(join(handoff, 'req.json'), {
    contract: req.contract ?? CONTRACT_VERSION,
    reqId: req.reqId,
    assetId: req.assetId,
    scope: req.scope ?? 'task',
    at: isoLocal()
  })
}

