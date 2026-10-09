import { useCallback, useEffect, useRef, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type { WecomAuthState, WecomCliInfo, WecomCliSource } from '../types'

/**
 * 第 54 批（docs/40 §5）：从「企业微信连接引导」弹窗里抽出来的**扫码区**。
 *
 * 为什么抽：首次配置引导（S2）与「工单设置 → 打开连接引导」都要这一块。
 * 直接把弹窗嵌进向导会很别扭（弹窗套弹窗），复制一份逻辑又必然两边跑偏
 * —— 第 10 批「两套清单」的教训（DECISIONS 2026-09-30 物料类别同源）。
 *
 * 组件只管「状态 + 扫码 + 按钮」，**外层壳（弹窗 / 向导页）由调用方决定**：
 * 底部那排按钮通过 `footer(auth, ctx)` 回调注入 —— 弹窗注入「稍后再说 / 完成」，
 * 向导注入「上一步 / 跳过 / 下一步」。
 *
 * 铁律延续：所有网络/进程动作都在主进程（`wecomCli.ts`），这里只调 IPC；
 * 授权凭据由 CLI 自己写在用户目录，软件不碰、不存。
 */
const POLL_MS = 2000
/** 最长等多久（秒）：CLI 那边没有官方超时说明，给 3 分钟足够一般人找手机 */
const MAX_WAIT_S = 180

/** 状态 → 人话（弹窗与工单设置里的常驻入口共用，两处口径必须一致） */
export function wecomStatusText(auth: WecomAuthState | 'checking'): string {
  if (auth === 'checking') return COPY.wecom.stChecking
  if (auth === 'authorized') return COPY.wecom.stAuthorized
  if (auth === 'unauthorized') return COPY.wecom.stUnauthorized
  if (auth === 'cli-missing') return COPY.wecom.stCliMissing
  return COPY.wecom.stUnknown
}

/** 组件来源 → 人话（排查用，不做主信息） */
export function wecomSourceText(source: WecomCliSource | null): string {
  if (!source) return COPY.wecom.srcNone
  if (source === 'bundled') return COPY.wecom.srcBundled
  if (source === 'env-exe') return COPY.wecom.srcEnvExe
  if (source === 'env-js') return COPY.wecom.srcEnvJs
  return COPY.wecom.srcDevJs
}

export interface WecomConnectPanelProps {
  /** modal = 原来的引导弹窗；wizard = 首次配置引导里那一页（多一句说明） */
  variant?: 'modal' | 'wizard'
  onToast?: (msg: string) => void
  /** 授权状态变化时回调（向导靠它决定"下一步"要不要提示还没连上） */
  onAuthChange?: (auth: WecomAuthState | 'checking') => void
  /** 底部额外按钮（由外层壳注入；拿到当前状态与是否正在等扫码） */
  footer?: (ctx: { auth: WecomAuthState | 'checking'; scanning: boolean }) => React.ReactNode
}

export function WecomConnectPanel({
  variant = 'modal',
  onToast,
  onAuthChange,
  footer
}: WecomConnectPanelProps): React.JSX.Element {
  const [info, setInfo] = useState<WecomCliInfo | null>(null)
  const [auth, setAuth] = useState<WecomAuthState | 'checking'>('checking')
  const [qr, setQr] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 已经等了多久（秒）—— 让用户知道轮询在跑、不是卡死了 */
  const [waited, setWaited] = useState(0)
  /** 授权成功后的本机身份（只显示名字） */
  const [name, setName] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 是否正在等扫码（决定关闭时要不要通知主进程杀进程） */
  const waitingRef = useRef(false)

  const stopPoll = useCallback((): void => {
    if (pollRef.current) {
      clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }, [])

  /** 状态一变就通知外层（向导据此决定"下一步"的提示） */
  const publish = useCallback(
    (a: WecomAuthState | 'checking'): void => {
      setAuth(a)
      onAuthChange?.(a)
    },
    [onAuthChange]
  )

  /** 每 2 秒问一次授权状态；成功后自动读身份、提示成功 */
  const tick = useCallback(
    async (elapsed: number): Promise<void> => {
      if (!waitingRef.current) return
      if (elapsed >= MAX_WAIT_S) {
        waitingRef.current = false
        setErr(COPY.wecom.timeout)
        return
      }
      try {
        const r = await window.api.wecomAuthStatus()
        if (r.auth === 'authorized') {
          waitingRef.current = false
          publish('authorized')
          setQr(null)
          const id = await window.api.wecomIdentity().catch(() => null)
          if (id?.ok && id.name) {
            setName(id.name)
            onToast?.(fmt(COPY.wecom.okWithIdentity, { name: id.name }))
          } else {
            onToast?.(COPY.wecom.okNoIdentity)
          }
          return
        }
        publish(r.auth)
      } catch {
        // 单次探测失败不打断轮询（CLI 偶发占用），下一个周期再试
      }
      setWaited(elapsed + POLL_MS / 1000)
      pollRef.current = setTimeout(() => void tick(elapsed + POLL_MS / 1000), POLL_MS)
    },
    [onToast, publish]
  )

  // 打开即查一次状态
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const i = await window.api.wecomCliInfo()
        if (!alive) return
        setInfo(i)
        publish(i.auth)
      } catch (e) {
        if (alive) setErr(fmt(COPY.wecom.startFailed, { msg: (e as Error).message }))
      }
    })()
    return () => {
      alive = false
    }
    // publish 是稳定引用（useCallback），这里只在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 关掉弹窗 / 组件卸载：停轮询，并让主进程收掉还在等下扫码的 CLI
  useEffect(() => {
    return () => {
      stopPoll()
      if (waitingRef.current) {
        waitingRef.current = false
        void window.api.wecomAuthCancel().catch(() => {})
      }
    }
  }, [stopPoll])

  const startAuth = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setErr(null)
    setLog('')
    setQr(null)
    setName(null)
    try {
      const r = await window.api.wecomAuthStart()
      setLog(r.log ?? '')
      if (!r.ok || !r.qr) {
        setErr(fmt(COPY.wecom.startFailed, { msg: r.error ?? '' }))
        return
      }
      setQr(r.qr)
      setWaited(0)
      waitingRef.current = true
      pollRef.current = setTimeout(() => void tick(POLL_MS / 1000), POLL_MS)
    } catch (e) {
      setErr(fmt(COPY.wecom.startFailed, { msg: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const cancelAuth = async (): Promise<void> => {
    waitingRef.current = false
    stopPoll()
    setQr(null)
    setWaited(0)
    setLog('')
    setErr(null)
    try {
      await window.api.wecomAuthCancel()
    } catch {
      // 主进程没收到也无所谓：进程会自己超时退出
    }
    // 回到「未授权」态，用户可以再来一次
    publish('unauthorized')
  }

  const scanning = waitingRef.current && qr !== null
  const missing = auth === 'cli-missing' || (info !== null && !info.available)
  /** CLI 原始输出里那条授权链接（`auth init` 会打印，扫码失败时的兜底路径） */
  const authUrl = (log.match(/https:\/\/\S+/) ?? [])[0] ?? null

  return (
    <div className="content">
      {/* 状态一行：徽标 + 版本 + 来源（悬停看路径，排查用） */}
      <div className="wc-status">
        <span className={`wc-pill ${auth === 'authorized' ? 'ok' : ''}`}>
          {wecomStatusText(auth)}
        </span>
        <span className="wc-meta" title={info?.path ?? ''}>
          {wecomSourceText(info?.source ?? null)}
          {info?.version ? ` · ${fmt(COPY.wecom.versionLine, { ver: info.version })}` : ''}
        </span>
      </div>

      <div className="wc-intro">{missing ? COPY.wecom.introMissing : COPY.wecom.intro}</div>
      {variant === 'wizard' && !missing && (
        <div className="wc-intro">{COPY.wz.s2Body}</div>
      )}

      {/* 扫码区：拿到二维码才出现 */}
      {qr && (
        <div className="wc-qr">
          <img src={qr} alt={COPY.wecom.scanQrAlt} />
          <div className="wc-scan">
            <div className="t">{COPY.wecom.scanHint}</div>
            <div className="s">{fmt(COPY.wecom.scanWait, { s: Math.floor(waited) })}</div>
            {/* CLI 除了出图还会打印一条授权链接 —— 兜底给出来（可选中复制，不自动打开） */}
            {authUrl && (
              <div className="wc-url">
                {COPY.wecom.linkLabel}
                <br />
                {authUrl}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 已授权：把本机身份亮出来（这是"连上了"最直接的证据） */}
      {auth === 'authorized' && name && (
        <div className="wc-ok">{fmt(COPY.wecom.okWithIdentity, { name })}</div>
      )}

      {err && <div className="tk-err">{err}</div>}
      {/* CLI 原始输出只在出错后展示，平时不吓人 */}
      {log && (err || missing) && <pre className="wc-log">{log.trim().slice(0, 1200)}</pre>}

      <div className="tk-actions">
        {auth !== 'authorized' && !missing && (
          <button className="btn primary" disabled={busy} onClick={() => void startAuth()}>
            {busy ? COPY.common.loading : qr ? COPY.wecom.reauthBtn : COPY.wecom.startBtn}
          </button>
        )}
        {auth === 'authorized' && (
          <button className="btn" onClick={() => void startAuth()} disabled={busy}>
            {COPY.wecom.reauthBtn}
          </button>
        )}
        {scanning && (
          <button className="btn" onClick={() => void cancelAuth()}>
            {COPY.wecom.cancelBtn}
          </button>
        )}
        {footer?.({ auth, scanning })}
      </div>
    </div>
  )
}
