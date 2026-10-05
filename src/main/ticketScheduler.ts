/**
 * 第 26 批（docs/31 —— 把 docs/16 §3 里被搁置的「定时自动同步」捡起来做）：
 * 工单同步调度器。
 *
 * 这个文件**只做调度**：什么时候跑、跑的时候会不会重入。具体跑什么由调用方注入（`run`），
 * 跑完怎么记账由 `onDone` 决定 —— 调度不碰业务、业务不碰定时器，两边都能单独测
 * （承接 docs/15 §1 的架构铁律：引擎不碰网络，真企微不进自动测试）。
 *
 * 行为（docs/16 §3.1 原样）：
 *  · 软件启动后 15 秒先拉一次（避开启动高峰，不拖慢开窗；没配置好时那一轮会自己跳过）
 *  · 之后每隔 N 分钟拉一次（默认 30，设置里可调 10~1440，可关）
 *  · 防重入：上一次还没跑完就到点了 → 跳过本次，不排队
 *  · 静默失败：错误不弹窗，只把结果交给 `onDone`（界面在工单视图头部出一条状态）
 */

/** 间隔下限：比 10 分钟更密对企微接口没意义（上游同步表本身最长 1 小时才更新一次） */
export const SYNC_MIN_INTERVAL_MIN = 10
/** 间隔上限：1440 分钟 = 一天拉一次 */
export const SYNC_MAX_INTERVAL_MIN = 1440
/** 默认间隔（分钟） */
export const SYNC_DEFAULT_INTERVAL_MIN = 30
/** 启动后首拉延迟：避开启动高峰，也让工作区初始化先跑完 */
export const SYNC_FIRST_DELAY_MS = 15_000

/**
 * 间隔分钟数归一：非数字 / NaN / 越界一律夹回 [10, 1440] 再取整。
 * meta 里的值可能是手改过库的、或老版本从没写过 —— 读进来必须过这一道，
 * 否则写个 0 进来就会变成「每 0 毫秒拉一次」把企微接口打爆。
 */
export function clampIntervalMin(v: unknown): number {
  // null / undefined / 空串 = "这个键还没设过" → 直接给默认值。
  // ⚠️ 不能直接扔给 Number()：Number(null) === 0、Number('') === 0 都是**合法数字**，
  // 会被当成用户填的 0 而夹到下限 10 —— 默认值 30 就永远用不上了（accept 断言抓出来的）。
  if (v === null || v === undefined || v === '') return SYNC_DEFAULT_INTERVAL_MIN
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return SYNC_DEFAULT_INTERVAL_MIN
  return Math.min(SYNC_MAX_INTERVAL_MIN, Math.max(SYNC_MIN_INTERVAL_MIN, n))
}

/** 一次触发到底干了什么 —— 决定"要不要记这一笔" */
export interface TicketSchedulerJobResult {
  /** false = 这一轮其实没跑（工单没配置好等），**不写**「上次同步」 */
  ran: boolean
  ok: boolean
  error?: string
}

export interface TicketSchedulerOptions {
  /** 读当前配置（开关 + 间隔分钟）。每次重排都重新读，用户改完设置不用重启软件 */
  readConfig: () => { enabled: boolean; intervalMin: number }
  /** 真正的同步动作 */
  run: () => Promise<TicketSchedulerJobResult>
  /** 一轮真正跑过之后的回调（写 meta + 推送界面都在这里做） */
  onDone?: (r: TicketSchedulerJobResult) => void
}

let firstTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let running = false
let current: TicketSchedulerOptions | null = null

function clearTimers(): void {
  if (firstTimer) {
    clearTimeout(firstTimer)
    firstTimer = null
  }
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

async function tick(): Promise<void> {
  const opts = current
  if (!opts) return
  // 防重入：上一轮还在跑（企微接口慢 / 网络卡）就到点了 → 跳过本次，不排队堆积
  if (running) return
  running = true
  try {
    const r = await opts.run()
    if (r.ran) opts.onDone?.(r)
  } catch (e) {
    // 调度器自己绝不抛：这一轮炸了也要让定时器活着（下一轮还能救回来）。
    // 未捕获异常在主进程会走 index.ts 的兜底弹框 + 退出，那是启动期的东西，不能让它管这里。
    const msg = e && (e as Error).message ? (e as Error).message : String(e)
    opts.onDone?.({ ran: true, ok: false, error: msg })
  } finally {
    running = false
  }
}

/**
 * 按当前配置（重新）排定时器 —— 启动、改设置、切换工作区都走这一个入口。
 * `enabled = false` 时会停掉已有定时器并直接返回（等于"关"）。
 */
export function startTicketScheduler(opts: TicketSchedulerOptions): void {
  current = opts
  clearTimers()
  const cfg = opts.readConfig()
  if (!cfg.enabled) return
  const ms = clampIntervalMin(cfg.intervalMin) * 60_000
  firstTimer = setTimeout(() => {
    void tick()
    tickTimer = setInterval(() => void tick(), ms)
  }, SYNC_FIRST_DELAY_MS)
}

/** 退出 / 测试收尾时清掉 —— 定时器不清，Electron 进程退不干净 */
export function stopTicketScheduler(): void {
  clearTimers()
  running = false
  current = null
}

/** 仅供诊断与断言：定时器在不在跑、此刻有没有一轮在执行 */
export function schedulerState(): { scheduled: boolean; running: boolean } {
  return { scheduled: firstTimer !== null || tickTimer !== null, running }
}
