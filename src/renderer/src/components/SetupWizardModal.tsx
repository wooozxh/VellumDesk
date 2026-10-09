import { useEffect, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import { setupStep, setupStepCount } from '../../../shared/setupWizard'
import type { WecomAuthState } from '../types'
import { Icon } from './Icon'
import { WecomConnectPanel } from './WecomConnectPanel'

/**
 * 第 54 批（docs/40）：首次配置引导（初装向导）。
 *
 * 解决的问题：软件现在的「首次体验」是**四个碎片**散在不同地方 ——
 * 工作区自动择址（无界面）、企微扫码授权（首次自动弹）、工单表配置（自己去点齿轮）、
 * 报表表配置（月底导出时才第一次见到）。新人装完落在工单队列，一屏空白，
 * 没有任何一句"这台机器还没配过"。
 *
 * 六步：欢迎 → 工作区 → 企业微信 → 工单表 → 报表表 → 完成。**每一步都能跳过**。
 *
 * ⚠️ 视觉样式**本批不定稿**（用户 2026-10-09：「欢迎窗口后续我可能会改样式，现在还没想好」）：
 *   - 文字全部走文案字典（`COPY.wz`）→ 以后改字走 `tools/copy-sheet`，不碰代码
 *   - 样式收在 `main.css` 的 `.wz-*` 一段里 → 将来换皮只改那一段
 *
 * 铁律：向导**不替用户做任何决定** —— 不自动扫描、不自动同步、不自动改已有配置。
 * 关窗口（✕ / Esc）= 什么都没发生（不写标记），下次启动还会弹；
 * 只有点「完成」或「我以后再说」才写 `setup_wizard_done`。
 */
const STEP_COUNT = setupStepCount()

export function SetupWizardModal({
  workspaceRoot,
  onClose,
  onFinish,
  onOpenTicketSettings,
  escDisabled,
  onToast
}: {
  /** 当前工作区路径（S1 只展示、允许改 —— 不改变"绝不偷偷换位置"的铁律） */
  workspaceRoot: string
  /** 关窗口：不写标记，下次启动再弹 */
  onClose: () => void
  /** 点「完成」或「我以后再说」：App 负责写标记 + 切到工单队列 + 提示 */
  onFinish: (reason: 'done' | 'later') => void
  /** S3：打开已有的「工单同步设置」弹窗（不重造一套连接 / 选子表 UI） */
  onOpenTicketSettings?: () => void
  /** 内层还开着别的弹窗时挂起 Esc，免得一次 Esc 关两层 */
  escDisabled?: boolean
  onToast?: (msg: string) => void
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  /** 企微授权状态（S2 的面板回传；只用于汇总那一页如实显示） */
  const [auth, setAuth] = useState<WecomAuthState | 'checking'>('checking')
  /** 跳过过哪几步 */
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  /** S4 报表链接 */
  const [reportLink, setReportLink] = useState('')
  const [reportSaved, setReportSaved] = useState(false)
  const [reportErr, setReportErr] = useState<string | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  /** S5 汇总：工单表配没配（进入完成页时读一次） */
  const [ticketConfigured, setTicketConfigured] = useState<boolean | null>(null)

  // 预填已存的报表配置（与「导出报表」弹窗同一套：存的是编号，粘链接也认）
  useEffect(() => {
    void window.api
      .reportStatus()
      .then((r) => {
        if (r.docid) {
          setReportLink(r.docid)
          setReportSaved(true)
        }
      })
      .catch(() => {})
  }, [])

  // 进完成页时读一次工单配置状态（汇总只报事实，不猜）
  useEffect(() => {
    if (step !== STEP_COUNT - 1) return
    let alive = true
    void window.api
      .ticketStatus()
      .then((s) => {
        if (alive) setTicketConfigured(s.configured)
      })
      .catch(() => {
        if (alive) setTicketConfigured(false)
      })
    return () => {
      alive = false
    }
  }, [step])

  // Esc = 关窗口（等同于点 ✕：不写标记，下次启动再弹）
  useEffect(() => {
    if (escDisabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escDisabled, onClose])

  const stepName = (i: number): string => setupStep(i).name

  const prev = (): void => setStep((s) => Math.max(0, s - 1))
  const next = (): void => setStep((s) => Math.min(STEP_COUNT - 1, s + 1))
  const skip = (): void => {
    setSkipped((prevSet) => new Set(prevSet).add(step))
    next()
  }

  const saveReport = async (): Promise<void> => {
    if (reportBusy) return
    setReportBusy(true)
    setReportErr(null)
    try {
      const r = await window.api.reportSaveLink(reportLink.trim())
      if (!r.ok) {
        setReportErr(COPY.wz.s4Bad)
        return
      }
      setReportSaved(true)
      onToast?.(COPY.wz.s4Saved)
    } catch (e) {
      setReportErr(fmt(COPY.sht.failed, { msg: (e as Error).message }))
    } finally {
      setReportBusy(false)
    }
  }

  /** 汇总里的一个条目：文案 + 状态 */
  const summaryItem = (label: string, state: 'done' | 'skip' | 'unset'): React.JSX.Element => (
    <div className="wz-sum-item">
      <span className="k">{label}</span>
      <span className={`v ${state === 'done' ? 'ok' : state === 'skip' ? 'skip' : 'unset'}`}>
        {state === 'done' ? COPY.wz.itemDone : state === 'skip' ? COPY.wz.itemSkipped : COPY.wz.itemUnset}
      </span>
    </div>
  )

  const stateOf = (i: number, done: boolean): 'done' | 'skip' | 'unset' =>
    done ? 'done' : skipped.has(i) ? 'skip' : 'unset'

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wz-modal">
        <h3>
          <Icon name="bulb" size={15} /> {COPY.wz.title}
          <button className="close" onClick={onClose} title={COPY.wz.later}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="content">
          <div className="wz-head">
            <span className="wz-stepbar">
              {fmt(COPY.wz.stepOf, { n: step + 1, m: STEP_COUNT })}
            </span>
            <span className="wz-name">{stepName(step)}</span>
          </div>

          {/* S0 欢迎 */}
          {step === 0 && (
            <div className="wz-body">
              <div className="wz-title">{COPY.wz.s0Title}</div>
              <div className="wz-text">{COPY.wz.s0Body}</div>
            </div>
          )}

          {/* S1 工作区：只展示 + 允许改 */}
          {step === 1 && (
            <div className="wz-body">
              <div className="wz-title">{COPY.wz.s1Title}</div>
              <div className="wz-text">{COPY.wz.s1Body}</div>
              <div className="wz-path">
                <span className="k">{COPY.wz.s1PathLabel}</span>
                <code title={workspaceRoot}>{workspaceRoot}</code>
                <button
                  className="btn small"
                  onClick={() => {
                    // 复用既有的「选目录并切过去」—— 不在这里另造一套择址
                    void window.api.wsPickRoot().then((r) => {
                      if (r.ok && !r.canceled) onToast?.(COPY.wz.s1Changed)
                    })
                  }}
                >
                  {COPY.wz.s1Change}
                </button>
              </div>
            </div>
          )}

          {/* S2 企业微信：与工单设置里的引导共用同一个面板 */}
          {step === 2 && (
            <div className="wz-body">
              <div className="wz-title">{COPY.wz.s2Title}</div>
              <WecomConnectPanel variant="wizard" onToast={onToast} onAuthChange={setAuth} />
            </div>
          )}

          {/* S3 工单表：打开已有的设置弹窗，不重造 */}
          {step === 3 && (
            <div className="wz-body">
              <div className="wz-title">{COPY.wz.s3Title}</div>
              <div className="wz-text">{COPY.wz.s3Body}</div>
              <button className="btn" onClick={() => onOpenTicketSettings?.()}>
                <Icon name="gear" size={13} />  {COPY.wz.s3Open}
              </button>
            </div>
          )}

          {/* S4 报表表 */}
          {step === 4 && (
            <div className="wz-body">
              <div className="wz-title">{COPY.wz.s4Title}</div>
              <div className="wz-text">{COPY.wz.s4Body}</div>
              <label className="wz-label">{COPY.wz.s4Label}</label>
              <div className="wz-row">
                <input
                  className="wz-input"
                  value={reportLink}
                  placeholder="https://…"
                  onChange={(e) => {
                    setReportLink(e.target.value)
                    setReportErr(null)
                  }}
                />
                <button
                  className="btn"
                  disabled={reportBusy || reportLink.trim() === ''}
                  onClick={() => void saveReport()}
                >
                  {reportBusy ? COPY.common.loading : COPY.wz.s4Save}
                </button>
              </div>
              {reportSaved && !reportErr && <div className="wz-okline">{COPY.wz.s4Saved}</div>}
              {reportErr && <div className="tk-err">{reportErr}</div>}
            </div>
          )}

          {/* S5 完成：如实汇总 */}
          {step === 5 && (
            <div className="wz-body">
              <div className="wz-title">{COPY.wz.s5Title}</div>
              <div className="wz-text">{COPY.wz.s5Body}</div>
              <div className="wz-sum">
                {summaryItem(COPY.wz.s1Name, 'done')}
                {summaryItem(COPY.wz.s2Name, stateOf(2, auth === 'authorized'))}
                {summaryItem(COPY.wz.s3Name, stateOf(3, ticketConfigured === true))}
                {summaryItem(COPY.wz.s4Name, stateOf(4, reportSaved))}
              </div>
              <div className="wz-text wz-where">{COPY.wz.s5Where}</div>
            </div>
          )}

          <div className="tk-actions wz-actions">
            {step > 0 && (
              <button className="btn" onClick={prev}>
                {COPY.wz.prev}
              </button>
            )}
            {step === 0 && (
              <>
                <button className="btn primary" onClick={next}>
                  {COPY.wz.start}
                </button>
                <button className="btn" onClick={() => onFinish('later')}>
                  {COPY.wz.later}
                </button>
              </>
            )}
            {step > 0 && step < STEP_COUNT - 1 && (
              <>
                {setupStep(step).skippable && (
                  <button className="btn" onClick={skip}>
                    {COPY.wz.skip}
                  </button>
                )}
                <button className="btn primary" onClick={next}>
                  {COPY.wz.next}
                </button>
              </>
            )}
            {step === STEP_COUNT - 1 && (
              <button className="btn primary" onClick={() => onFinish('done')}>
                {COPY.wz.done}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
