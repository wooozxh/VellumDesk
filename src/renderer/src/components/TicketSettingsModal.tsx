import { useEffect, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type {
  TicketAutoSyncState,
  TicketPurgePreview,
  TicketSaveConfigResult,
  TicketStatus,
  TicketType,
  WecomAuthState,
  WecomCliInfo
} from '../types'
import { Icon } from './Icon'
import { WecomAuthModal } from './WecomAuthModal'
import { wecomSourceText, wecomStatusText } from './WecomConnectPanel'

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
  onSaved,
  onOpenWizard
}: {
  /** 已有配置（改配置时预填）；首配为 null */
  initial?: TicketStatus | null
  onClose: () => void
  onSaved: () => void | Promise<void>
  /** 第 54 批（docs/40 §4.3）：重新打开「首次配置引导」 */
  onOpenWizard?: () => void
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
  /**第 50 批（docs/35）：「缩略图」image 列可用吗（来自 status；false = 缺失 / 改名 / 类型不对） */
  const [thumbColOk, setThumbColOk] = useState(initial?.thumbColOk ?? true)
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
   * 第 26 批（docs/31）：自动同步开关 + 间隔。
   * 与「允许指派」同一模式：**改动即存**，不走下面的「保存」按钮（那个按钮只管表格配置）。
   * 间隔先用草稿字符串，失焦时才提交 —— 否则输入框里删到空就会当场存成默认值。
   */
  const [autoSync, setAutoSync] = useState<TicketAutoSyncState | null>(null)
  const [intervalDraft, setIntervalDraft] = useState('30')

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

  // 第 26 批：自动同步配置（只在已配置工单表时才有意义 —— 下面的渲染也按这个条件）
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await window.api.ticketAutoSyncGet()
        if (!alive) return
        setAutoSync(s)
        setIntervalDraft(String(s.intervalMin))
      } catch {
        // 读不到就不显示这一块，不让设置弹窗打不开
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /**
   * 第 26 批：改自动同步设置 —— 主进程改完会**立即重排定时器**，返回值就是最新的真实状态，
   * 直接拿它刷界面（不用再查一遍）。失败则回读一次，绝不把没落库的值留在界面上。
   */
  const patchAutoSync = async (input: {
    enabled?: boolean
    intervalMin?: number
  }): Promise<void> => {
    try {
      const s = await window.api.ticketAutoSyncSet(input)
      setAutoSync(s)
      setIntervalDraft(String(s.intervalMin))
    } catch {
      try {
        const s = await window.api.ticketAutoSyncGet()
        setAutoSync(s)
        setIntervalDraft(String(s.intervalMin))
      } catch {
        // 两次都读不到就维持现状，不猜
      }
    }
  }

  // 第 50 批（docs/35）：拉一次最新的「缩略图」列可用性。
  // `initial` 是弹窗打开那一刻的快照 —— 用户可能刚在另一个窗口同步过，
  // 预检结果是同步时写进meta 的，所以这里重读一次 status（同purge 预览的路数）。
  useEffect(() => {
    if (!initial) return
    let alive = true
    void (async () => {
      try {
        const s = await window.api.ticketStatus()
        if (alive && s) setThumbColOk(s.thumbColOk !== false)
      } catch {
        // 读不到就沿用 initial 的值（默认当可用 = 不设防，与主进程同一口径）
      }
    })()
    return () => {
      alive = false
    }
  }, [initial])

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
              {/* 第 54 批（docs/40 §4.3）：重新打开首次配置引导（常驻入口，不依赖首次自动弹） */}
              {onOpenWizard && (
                <button className="btn small" onClick={onOpenWizard}>
                  {COPY.wz.openWizard}
                </button>
              )}
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

          {/* 第 50 批（docs/35）：「缩略图」image 列的可用性预检 ——
与上面「设计师」列同一套路子（那边是同步时检测、点指派时才拦）。
这里**常驻显示一行**：列缺失 / 被改名 / 类型不对时，同步过一次之后就能在这里看到，
不用等点「完成任务」白跑一趟上传回来才报错。只在已配置工单表时出现。 */}
          {initial && !thumbColOk && (
            <div className="tk-warn">{COPY.ticket.thumbColBad}</div>
          )}

          {/* 第 26 批（docs/31）：自动同步 —— 与「允许指派」同一个「改动即存」模式。
              只在已配置工单表时出现：没配表时它根本不会跑，摆出来只会让人以为坏了。 */}
          {initial && autoSync && (
            <div className="tk-autosync">
              <label className="tk-check">
                <input
                  type="checkbox"
                  checked={autoSync.enabled}
                  onChange={(e) => void patchAutoSync({ enabled: e.target.checked })}
                />
                <span>{COPY.ticket.autoSyncLabel}</span>
              </label>
              <div className="tk-autosync-row">
                <span className="tk-label">{COPY.ticket.autoSyncInterval}</span>
                {/* 范围权威在 src/main/ticketScheduler.ts 的 clampIntervalMin（主进程会夹紧），
                    这里的 min/max 只是输入框的提示，别当第二处真源 */}
                <input
                  type="number"
                  min={10}
                  max={1440}
                  value={intervalDraft}
                  disabled={!autoSync.enabled}
                  onChange={(e) => setIntervalDraft(e.target.value)}
                  onBlur={() => void patchAutoSync({ intervalMin: Number(intervalDraft) })}
                />
              </div>
              <div className="tk-autosync-hint">{COPY.ticket.autoSyncHint}</div>
            </div>
          )}

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
