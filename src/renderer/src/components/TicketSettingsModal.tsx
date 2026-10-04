import { useEffect, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type {
  TicketPurgePreview,
  TicketSaveConfigResult,
  TicketStatus,
  TicketType,
  WecomAuthState,
  WecomCliInfo
} from '../types'
import { Icon } from './Icon'
import { WecomAuthModal, wecomSourceText, wecomStatusText } from './WecomAuthModal'

/**
 * 第 13 批：工单同步设置弹窗（docs/15 §6.3）—— 只在首配 / 换表时碰它。
 * 两步走：① 粘链接 → 「连接」探活（列子表 + 读授权身份，通了才进下一步）
 *        ② 勾选子表、标类型（印刷/电子）→ 保存落库
 * 首次同步的后果在界面上明说（§6.3）：当前表里所有工单都会标成历史单，不建任何任务。
 *
 * 第 17 批（docs/19 §10 #3）：「允许在本机指派设计师」开关 —— 用户拍板的门槛形态
 * （部门里要派单的人自己开，不做身份校验；开 = 详情弹窗里能指派并写回企微表）。
 *
 * 第 20 批（docs/24）：「危险操作 · 清理已禁用子表的工单」——关掉子表只是"以后不再同步"，
 * 已同步进来的工单会永久留在本地（同步只增不删），此前没有任何清理入口。这里补上：
 * 按**已保存的**设置算（不看未保存草稿），先预览再二次确认，删除由主进程留痕后才执行。
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
  /** 第 17 批：允许在本机指派设计师（初始值来自 status；改动即存，不走「保存」按钮） */
  const [allowAssign, setAllowAssign] = useState(initial?.allowAssign ?? false)
  /** 第 20 批：清理预览（已关闭子表里有多少条可清 / 多少条因有任务包跳过） */
  const [purge, setPurge] = useState<TicketPurgePreview | null>(null)
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState(false)
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null)
  const [purgeErr, setPurgeErr] = useState<string | null>(null)
  /** 第 21 批（docs/16 §4）：企微连接（内置 wecom-cli 的可用性 / 授权状态）+ 引导弹窗 */
  const [cli, setCli] = useState<(WecomCliInfo & { onboardSeen: boolean }) | null>(null)
  const [showWecom, setShowWecom] = useState(false)

  /**
   * 企微连接状态：打开设置就查一次（不轮询 —— 授权在引导弹窗里做，做完回来这里会重新查）。
   * 查不到（主进程异常）就当没有这一块，不让设置弹窗打不开。
   */
  const loadCli = async (): Promise<void> => {
    try {
      setCli(await window.api.wecomCliInfo())
    } catch {
      setCli(null)
    }
  }

  useEffect(() => {
    void loadCli()
  }, [])

  // 打开弹窗时拉一次预览（只有已配置过才有意义）
  useEffect(() => {
    if (!initial) return
    let alive = true
    void (async () => {
      try {
        const p = await window.api.ticketPurgePreview()
        if (alive) setPurge(p)
      } catch {
        // 读不到就不显示计数（按钮会因 purge 为空而不渲染）
      }
    })()
    return () => {
      alive = false
    }
  }, [initial])

  /** 子表草稿与已保存配置是否不一致（不一致时禁止清理 —— 清理按「已保存的」算） */
  const sheetsDirty = initial
    ? sheets.length !== initial.sheets.length ||
      sheets.some((s) => {
        const o = initial.sheets.find((x) => x.title === s.title)
        return !o || o.enabled !== s.enabled
      })
    : false

  const runPurge = async (): Promise<void> => {
    if (purgeBusy) return
    setPurgeBusy(true)
    setPurgeErr(null)
    try {
      const r = await window.api.ticketPurgeDisabled()
      if (r.error) {
        setPurgeErr(r.error)
        return
      }
      setPurgeConfirm(false)
      setPurgeMsg(
        r.removed > 0
          ? fmt(COPY.ticket.purgeDone, { n: r.removed, path: r.backupPath ?? '' })
          : COPY.ticket.purgeNothing
      )
      setPurge(await window.api.ticketPurgePreview())
    } catch (e) {
      setPurgeErr(fmt(COPY.ticket.purgeFailed, { msg: (e as Error).message }))
    } finally {
      setPurgeBusy(false)
    }
  }

  const toggleAllowAssign = async (v: boolean): Promise<void> => {
    setAllowAssign(v)
    try {
      const r = await window.api.ticketSetAllowAssign(v)
      if (!r.allow) setAllowAssign(false)
    } catch {
      setAllowAssign(!v)
    }
  }

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
          {/* 第 21 批（docs/16 §4）：企微连接常驻入口 —— 内置组件状态 + 授权状态 + 扫码入口。
              放最上面：连不上企微时，用户第一眼就该看到「是这一步没做」。 */}
          {cli && (
            <div className="tk-wecom">
              <Icon name="clip" size={14} />
              <span className="t">{COPY.wecom.title}</span>
              <span className={`wc-pill${cli.auth === 'authorized' ? ' ok' : ''}`}>
                {wecomStatusText(cli.auth as WecomAuthState)}
              </span>
              <span className="s" title={cli.path}>
                {wecomSourceText(cli.source)}
                {cli.version ? ` · v${cli.version}` : ''}
              </span>
              <span className="spacer" />
              <button className="btn small" onClick={() => setShowWecom(true)}>
                {COPY.wecom.openGuide}
              </button>
            </div>
          )}

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

          {/* 第 17 批（docs/19 §10 #3）：本机开关 —— 改动即存，独立于上方的表格配置 */}
          <label className="tk-check tk-allowassign">
            <input
              type="checkbox"
              checked={allowAssign}
              onChange={(e) => void toggleAllowAssign(e.target.checked)}
            />
            <span>
              {COPY.ticket.allowAssignLabel}
              <em>（{COPY.ticket.allowAssignHint}）</em>
            </span>
          </label>

          {initial && !initial.firstSyncDone && (
            <div className="tk-firstwarn">{COPY.ticket.settingsFirstSyncWarn}</div>
          )}

          {/* 第 20 批（docs/24）：危险操作 —— 清理已关闭子表的工单 */}
          {initial && purge && (
            <div className="tk-danger">
              <div className="tk-danger-title">{COPY.ticket.purgeSectionTitle}</div>
              {purge.sheets.length === 0 ? (
                <div className="tk-danger-hint">{COPY.ticket.purgeHintNone}</div>
              ) : (
                <>
                  <div className="tk-danger-hint">
                    {fmt(COPY.ticket.purgeHint, { sheets: purge.sheets.join('、') })}
                  </div>
                  <div className="tk-danger-hint">
                    {fmt(COPY.ticket.purgeCount, {
                      removable: purge.removable,
                      skipped: purge.packedSkipped
                    })}
                  </div>
                </>
              )}
              {sheetsDirty && <div className="tk-danger-hint">{COPY.ticket.purgeDraftDirty}</div>}
              {purgeErr && <div className="tk-err">{purgeErr}</div>}
              {purgeMsg && <div className="tk-danger-done">{purgeMsg}</div>}
              <button
                className="btn danger"
                disabled={purgeBusy || sheetsDirty || purge.sheets.length === 0 || purge.removable === 0}
                onClick={() => {
                  setPurgeMsg(null)
                  setPurgeErr(null)
                  setPurgeConfirm(true)
                }}
              >
                {COPY.ticket.purgeBtn}
              </button>
            </div>
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

      {/* 第 21 批：企微连接引导（从上面的常驻入口打开；授权完回来重新查一次状态） */}
      {showWecom && (
        <WecomAuthModal
          onClose={() => {
            setShowWecom(false)
            void loadCli()
          }}
        />
      )}

      {/* 第 20 批：清理工单的二次确认（删数据，必须再问一次） */}
      {purgeConfirm && purge && (
        <div
          className="mask"
          onMouseDown={(e) => e.target === e.currentTarget && setPurgeConfirm(false)}
        >
          <div className="modal tk-confirm">
            <h3>{COPY.ticket.purgeConfirmTitle}</h3>
            <div className="content">
              <div className="tk-confirm-body">
                {fmt(COPY.ticket.purgeConfirmBody, {
                  n: purge.removable,
                  skipped: purge.packedSkipped
                })}
              </div>
              {purgeErr && <div className="tk-err">{purgeErr}</div>}
              <div className="tk-actions">
                <button
                  className="btn danger"
                  disabled={purgeBusy}
                  onClick={() => void runPurge()}
                >
                  {purgeBusy ? COPY.common.saving : COPY.ticket.purgeConfirmOk}
                </button>
                <button className="btn" disabled={purgeBusy} onClick={() => setPurgeConfirm(false)}>
                  {COPY.common.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
