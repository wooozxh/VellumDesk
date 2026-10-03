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
 * 第 19 批（docs/22 §5）：导出报表弹窗。
 * 选起止日期（默认当月，按「完成时间」筛）+ 填报表表格链接（预填已存的，随手存）。
 * 点「导出」→ 在「工单报表」智能表格按起止日期新建子表 + 写记录。
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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void window.api
      .reportStatus()
      .then((r) => {
        if (r.docid) setLink(r.docid)
      })
      .catch(() => {})
  }, [])

  const doExport = async (): Promise<void> => {
    if (busy) return
    if (link.trim() === '') {
      setErr(COPY.ticket.exportReportNoLink)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await window.api.reportExport({ link, start, end })
      if (!r.ok) {
        if (r.kind === 'cli-missing') setErr(COPY.ticket.cliMissing)
        else if (r.kind === 'auth-expired') setErr(COPY.ticket.authExpired)
        else if (r.kind === 'bad-link') setErr(COPY.ticket.exportReportNoLink)
        else setErr(r.error ?? COPY.common.failed)
        return
      }
      if ((r.count ?? 0) === 0) {
        onToast?.(COPY.ticket.exportReportEmpty)
      } else {
        onToast?.(fmt(COPY.ticket.exportReportOk, { n: r.count, sheet: r.sheetTitle ?? '' }))
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

          {err && <div className="tk-err">{err}</div>}

          <div className="tk-actions">
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
    </div>
  )
}
