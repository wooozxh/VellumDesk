import { useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type { TicketSaveConfigResult, TicketStatus, TicketType } from '../types'
import { Icon } from './Icon'

/**
 * 第 13 批：工单同步设置弹窗（docs/15 §6.3）—— 只在首配 / 换表时碰它。
 * 两步走：① 粘链接 → 「连接」探活（列子表 + 读授权身份，通了才进下一步）
 *        ② 勾选子表、标类型（印刷/电子）→ 保存落库
 * 首次同步的后果在界面上明说（§6.3）：当前表里所有工单都会标成历史单，不建任何任务。
 */
interface SheetDraft {
  title: string
  sheetId: string
  type: TicketType
  enabled: boolean
}

export function TicketSettingsModal({
  initial,
  onClose,
  onSaved
}: {
  /** 已有配置（改配置时预填）；首配为 null */
  initial?: TicketStatus | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}): React.JSX.Element {
  const [link, setLink] = useState(initial?.docid ?? '')
  const [probed, setProbed] = useState<TicketSaveConfigResult | null>(null)
  const [sheets, setSheets] = useState<SheetDraft[]>(
    initial?.sheets.map((s) => ({ ...s })) ?? []
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const probeOrSave = async (mode: 'probe' | 'save'): Promise<void> => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const r =
        mode === 'probe'
          ? await window.api.ticketSaveConfig({ linkOrDocid: link, sheets: [] })
          : await window.api.ticketSaveConfig({
              linkOrDocid: link,
              sheets: sheets.map((s) => ({ title: s.title, type: s.type, enabled: s.enabled }))
            })
      if (!r.ok) {
        if (r.kind === 'cli-missing') setErr(COPY.ticket.cliMissing)
        else if (r.kind === 'auth-expired') setErr(COPY.ticket.authExpired)
        else setErr(fmt(COPY.ticket.syncFailed, { msg: r.error ?? '' }))
        return
      }
      if (mode === 'probe') {
        setProbed(r)
        setSheets(r.sheets?.map((s) => ({ ...s })) ?? [])
      } else {
        await onSaved()
      }
    } finally {
      setBusy(false)
    }
  }

  const canSave = sheets.length > 0 && sheets.some((s) => s.enabled)

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          <Icon name="gear" size={15} /> {COPY.ticket.settingsTitle}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="tk-settings">
          <label className="tk-label">{COPY.ticket.settingsDocid}</label>
          <div className="tk-linkrow">
            <input
              type="text"
              value={link}
              placeholder="https://doc.weixin.qq.com/smartsheet/…"
              onChange={(e) => setLink(e.target.value)}
            />
            <button
              className="btn"
              disabled={busy || link.trim() === ''}
              onClick={() => void probeOrSave('probe')}
            >
              {busy ? COPY.common.saving : '连接'}
            </button>
          </div>

          {probed?.ok && probed.docName && (
            <div className="tk-ok">{fmt(COPY.ticket.settingsDocidOk, { docid: probed.docName })}</div>
          )}

          {sheets.length > 0 && (
            <>
              <label className="tk-label">{COPY.ticket.settingsSheets}</label>
              <div className="tk-sheetlist">
                {sheets.map((s, i) => (
                  <div key={s.title} className="tk-sheetrow">
                    <label className="tk-check">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={(e) => {
                          const next = [...sheets]
                          next[i] = { ...s, enabled: e.target.checked }
                          setSheets(next)
                        }}
                      />
                      <span>{s.title}</span>
                    </label>
                    <select
                      value={s.type}
                      onChange={(e) => {
                        const next = [...sheets]
                        next[i] = { ...s, type: e.target.value as TicketType }
                        setSheets(next)
                      }}
                    >
                      <option value="print">{COPY.ticket.typePrint}</option>
                      <option value="digital">{COPY.ticket.typeDigital}</option>
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}

          {probed?.ok && probed.identity && (
            <div className="tk-identity">
              <span className="k">{COPY.ticket.settingsIdentity}</span>
              <span className="v">
                {probed.identity.name}
                <em>（{COPY.ticket.settingsIdentityHint}）</em>
              </span>
            </div>
          )}

          {initial && !initial.firstSyncDone && (
            <div className="tk-firstwarn">{COPY.ticket.settingsFirstSyncWarn}</div>
          )}

          {err && <div className="tk-err">{err}</div>}

          <div className="tk-actions">
            <button
              className="btn primary"
              disabled={busy || !canSave}
              onClick={() => void probeOrSave('save')}
            >
              {COPY.common.save}
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
