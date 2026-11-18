import { useEffect, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import { Icon } from './Icon'

/** 当月默认起止（1 号 ~ 月末） */
function defaultRange(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const p = (n: number): string => String(n).padStart(2, '0')
  return { start: `${y}-${p(m + 1)}-01`, end: `${y}-${p(m + 1)}-${p(new Date(y, m + 1, 0).getDate())}` }
}

/**
 * 导出报表弹窗。
 * 第 19 批（docs/22 §5）：起止日期 + 报表表格链接。
 * 第 86 批（docs/60）：加「报表类型」——
 *   - 流水报表：一张子表，12 字段全写
 *   - 月度报表：按设计师一人一张子表，物料体量 / 备注留空
 * 两种类型都用同一对起止日期（月度也支持只导半个月）。
 */
export function ExportReportModal({
  onClose,
  onToast
}: {
  onClose: () => void
  onToast?: (msg: string) => void
}): React.JSX.Element {
  const [link, setLink] = useState('')
  const [start, setStart] = useState(defaultRange().start)
  const [end, setEnd] = useState(defaultRange().end)
  const [kind, setKind] = useState<'flow' | 'monthly'>('flow')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** 模板名对不上时，表格里现有的子表（第 86 批） */
  const [candidates, setCandidates] = useState<string[]>([])
  const [pickedTemplate, setPickedTemplate] = useState('')

  useEffect(() => {
    void window.api
      .reportStatus()
      .then((r) => {
        if (r.docid) setLink(r.docid)
      })
      .catch(() => {})
  }, [])

  const switchKind = (next: 'flow' | 'monthly'): void => {
    setKind(next)
    // 换类型 = 换模板，上一次的候选不再适用
    setCandidates([])
    setPickedTemplate('')
    setErr(null)
  }

  const doExport = async (): Promise<void> => {
    if (busy) return
    if (link.trim() === '') {
      setErr(COPY.ticket.exportReportNoLink)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await window.api.reportExport({
        link,
        start,
        end,
        kind,
        templateSheet: pickedTemplate || undefined
      })
      if (!r.ok) {
        if (r.kind === 'sheet-missing') {
          setCandidates(r.candidates ?? [])
          setErr(r.error ?? COPY.ticket.exportReportPickTemplate)
          return
        }
        // 月度：部分子表失败 —— 已建出来的照常报，剩下的说清失败张数（重试会重复建表，先不重试）
        if (r.failedSheets?.length) {
          if (r.sheets?.length) {
            onToast?.(
              fmt(COPY.ticket.exportReportMonthOk, { n: r.count ?? 0, m: r.sheets.length })
            )
          }
          onToast?.(fmt(COPY.ticket.exportReportPartial, { n: r.failedSheets.length }))
          if (r.fieldWarnings?.length) onToast?.(r.fieldWarnings.join('；'))
          onClose()
          return
        }
        if (r.kind === 'cli-missing') setErr(COPY.ticket.cliMissing)
        else if (r.kind === 'auth-expired') setErr(COPY.ticket.authExpired)
        else if (r.kind === 'bad-link') setErr(COPY.ticket.exportReportNoLink)
        else setErr(r.error ?? COPY.common.failed)
        return
      }

      if ((r.count ?? 0) === 0) {
        // 月度：有单但全都没设计师 → 不是「没工单」，要说清跳过了多少
        if (kind === 'monthly' && (r.skipped ?? 0) > 0) {
          onToast?.(fmt(COPY.ticket.exportReportSkipped, { n: r.skipped ?? 0 }))
        } else {
          onToast?.(COPY.ticket.exportReportEmpty)
        }
      } else if (kind === 'monthly') {
        onToast?.(fmt(COPY.ticket.exportReportMonthOk, { n: r.count ?? 0, m: r.sheets?.length ?? 0 }))
      } else {
        onToast?.(fmt(COPY.ticket.exportReportOk, { n: r.count, sheet: r.sheetTitle ?? '' }))
      }
      if (kind === 'monthly' && (r.skipped ?? 0) > 0) {
        onToast?.(fmt(COPY.ticket.exportReportSkipped, { n: r.skipped ?? 0 }))
      }
      if (r.fieldWarnings?.length) onToast?.(r.fieldWarnings.join('；'))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          <Icon name="doc" size={15} /> {COPY.ticket.exportReportTitle}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="tk-settings">
          <label className="tk-label">{COPY.ticket.exportReportKindLabel}</label>
          <div className="tk-kinds">
            <label className="tk-kind">
              <input
                type="radio"
                name="reportKind"
                checked={kind === 'flow'}
                onChange={() => switchKind('flow')}
              />
              <span>{COPY.ticket.exportReportKindFlow}</span>
            </label>
            <label className="tk-kind">
              <input
                type="radio"
                name="reportKind"
                checked={kind === 'monthly'}
                onChange={() => switchKind('monthly')}
              />
              <span>{COPY.ticket.exportReportKindMonth}</span>
            </label>
          </div>
          {kind === 'monthly' && (
            <div className="tk-month-hint">{COPY.ticket.exportReportMonthHint}</div>
          )}

          <label className="tk-label">{COPY.ticket.exportReportLink}</label>
          <input
            type="text"
            value={link}
            placeholder="https://doc.weixin.qq.com/smartsheet/…"
            onChange={(e) => setLink(e.target.value)}
          />

          <div className="tk-daterow">
            <label className="tk-date">
              <span>{COPY.ticket.exportReportStart}</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="tk-date">
              <span>{COPY.ticket.exportReportEnd}</span>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>

          {candidates.length > 0 && (
            <label className="tk-label">
              {COPY.ticket.exportReportTemplate}
              <select
                value={pickedTemplate}
                onChange={(e) => setPickedTemplate(e.target.value)}
              >
                <option value="">{COPY.ticket.exportReportPickHint}</option>
                {candidates.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}

          {err && <div className="tk-err">{err}</div>}
        </div>

        {/* 第 70 批：动作条移到滚动区外面（同「工单设置」，内容再多也点得到） */}
        <div className="foot">
          <button
            className="btn primary"
            disabled={busy || start === '' || end === ''}
            onClick={() => void doExport()}
          >
            {busy ? COPY.common.saving : COPY.ticket.exportReportRun}
          </button>
          <button className="btn" onClick={onClose}>
            {COPY.common.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
