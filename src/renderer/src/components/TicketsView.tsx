import { useCallback, useEffect, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type {
  TicketAutoSyncState,
  TicketDetail,
  TicketListItem,
  TicketStatus
} from '../types'
import { Icon } from './Icon'
import { TicketDetailModal } from './TicketDetailModal'
import { TicketSettingsModal } from './TicketSettingsModal'
import { ExportReportModal } from './ExportReportModal'
import { WecomAuthModal } from './WecomAuthModal'

/**
 * 第 13 批：工单视图（docs/15 §6.1）—— 顶栏第一格「工单队列」（第 21 批由第三格改序更名）。
 *
 * 自包含：状态自己管、数据自己拉（window.api.ticket*），不依赖 App.tsx 的任何状态
 * （这是工单批次给 App.tsx 减负的第一步 —— 新视图一律这么写，不再往巨型组件里堆）。
 *
 * 四种形态（§6.1 / §6.3 / §4.4）：
 *  ① 未配置 → 引导打开设置弹窗
 *  ② 已配置 → 筛选标签 + 同步按钮 + 工单列表
 *  ③ CLI 未安装 / 授权过期 → 点同步时给明确提示（不白屏、不静默）
 *  ④ 子表重建后的新单 → 待确认筛选 + 「确认这批新单」批量放行
 */
type TkFilter = 'all' | 'mine' | 'unassigned' | 'history' | 'reassigned' | 'pending' | 'abnormal'

const FILTERS: Array<{ key: TkFilter; label: string }> = [
  { key: 'mine', label: COPY.ticket.filterMine },
  { key: 'all', label: COPY.ticket.filterAll },
  { key: 'unassigned', label: COPY.ticket.filterUnassigned },
  { key: 'history', label: COPY.ticket.filterHistory },
  { key: 'reassigned', label: COPY.ticket.filterReassigned },
  { key: 'pending', label: COPY.ticket.filterPending },
  { key: 'abnormal', label: COPY.ticket.filterAbnormal }
]

/** 状态徽标的样式类（驳回/撤销压暗；审批中是活跃状态，正常亮显 —— §2.2②） */
function stateClass(s: string | null): string {
  if (s === '已通过') return 'st-pass'
  if (s === '审批中') return 'st-live'
  if (s === '已驳回' || s === '已撤销') return 'st-dim'
  return ''
}

/** 第 26 批：「上次同步 HH:MM」——只到分钟，日期不显示（同步频率是分钟级，看时间就够） */
function hhmm(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function TicketsView({
  onToast,
  onUnassignedCount,
  onOpenWizard
}: {
  onToast?: (msg: string) => void
  /** 第 17 批：同步/加载后回传未指派存量，顶栏徽标跟着刷新（App.tsx 只管显示） */
  onUnassignedCount?: (n: number) => void
  /** 第 54 批（docs/40 §4.3）：从工单设置里重新打开「首次配置引导」 */
  onOpenWizard?: () => void
}): React.JSX.Element {
  const [status, setStatus] = useState<TicketStatus | null>(null)
  const [list, setList] = useState<TicketListItem[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [filter, setFilter] = useState<TkFilter>('mine')
  const [syncing, setSyncing] = useState(false)
  const [detailNo, setDetailNo] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  /** 第 17 批（docs/19 §3②）：本轮同步新增的未指派数（>0 时显示提示条 + 去指派按钮） */
  const [newUnassigned, setNewUnassigned] = useState(0)
  /** 第 21 批：同步撞上「组件缺失 / 未授权」→ 直接把连接引导摆出来（那一步就是全部原因） */
  const [showWecom, setShowWecom] = useState(false)
  /**
   * 第 26 批（docs/31）：自动同步配置 + 「上次同步」状态。
   * 后台自动同步是**静默**跑的（不弹窗），这块就是它唯一的可见凭据 ——
   * 用户看一眼就知道"数据新不新、上次拉成功没有"。
   */
  const [autoSync, setAutoSync] = useState<TicketAutoSyncState | null>(null)

  const toast = useCallback(
    (msg: string) => {
      if (onToast) onToast(msg)
      else setHint(msg)
    },
    [onToast]
  )

  const loadStatus = useCallback(async (): Promise<TicketStatus | null> => {
    try {
      const st = await window.api.ticketStatus()
      setStatus(st)
      // 第 17 批：徽标跟着 status 一起刷新（口径 = 未指派筛选，主进程算）
      if (st && onUnassignedCount) onUnassignedCount(st.unassignedCount)
      return st
    } catch {
      // 第 22 批：工单队列成了**启动默认视图** —— 工作区不可用（如移动硬盘没插）时，
      // 主进程在 ticket:status 里 mkdir 会失败并 reject。这里必须吞掉：否则每次开机都会
      // 在控制台留一条未捕获异常（banner 场景的「控制台零报错」正是盯这个）。
      // 状态置空 → 界面走空态；顶部红色横幅已经说明了原因，不重复打扰。
      setStatus(null)
      if (onUnassignedCount) onUnassignedCount(0)
      return null
    }
  }, [onUnassignedCount])

  const loadList = useCallback(async (view: TkFilter): Promise<void> => {
    setListLoading(true)
    try {
      const items = await window.api.ticketList(view)
      setList(items)
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadAutoSync = useCallback(async (): Promise<void> => {
    try {
      setAutoSync(await window.api.ticketAutoSyncGet())
    } catch {
      // 工作区不可用等 → 不显示这一小块，不影响列表本身
      setAutoSync(null)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const st = await loadStatus()
        if (st?.configured) await loadList('mine')
        await loadAutoSync()
      } catch {
        // 第 22 批：列表读取同理（工作区不可用时静默，横幅已在顶部说明）
      }
    })()
  }, [loadStatus, loadList, loadAutoSync])

  /**
   * 第 26 批（docs/31）：后台自动同步跑完时，主进程会推一条 `ticket:synced`。
   * 收到就刷新列表 + 更新「上次同步」——**界面永不轮询**（docs/16 §3.3 定下的形态）。
   */
  useEffect(() => {
    const off = window.api.onTicketSynced((p) => {
      setAutoSync((prev) =>
        prev
          ? { ...prev, lastSync: { at: p.at, ok: p.ok, error: p.error ?? null } }
          : prev
      )
      void loadStatus()
      void loadList(filter)
    })
    return off
  }, [filter, loadStatus, loadList])

  const switchFilter = async (f: TkFilter): Promise<void> => {
    setFilter(f)
    await loadList(f)
  }

  const doSync = async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    try {
      const r = await window.api.ticketSync()
      if (!r.ok) {
        // 三类失败各有明确出口（§4.4）：不白屏、不静默
        // 第 21 批：前两类（组件缺失 / 未授权）光提示没用，直接把连接引导打开 —— 一次扫码就能修
        if (r.kind === 'cli-missing') {
          toast(COPY.ticket.cliMissing)
          setShowWecom(true)
        } else if (r.kind === 'auth-expired') {
          toast(COPY.ticket.authExpired)
          setShowWecom(true)
        } else toast(fmt(COPY.ticket.syncFailed, { msg: r.error ?? '' }))
        return
      }
      const head = fmt(COPY.ticket.syncDone, {
        inserted: r.inserted,
        updated: r.updated,
        tasks: r.tasksCreated
      })
      const more = fmt(COPY.ticket.syncDoneMore, {
        pending: r.needConfirm,
        reassigned: r.reassigned,
        gone: r.rowGone,
        warns: r.warnings.length
      })
      // 有附加信息才拼第二段，日常同步只有一句；第 17 批：有待指派也拼一段（§3③）
      const extra =
        r.needConfirm + r.reassigned + r.rowGone + r.warnings.length + r.newUnassigned > 0
          ? ` · ${more}`
          : ''
      const assignExtra =
        r.newUnassigned > 0 ? ` · ${fmt(COPY.ticket.syncDoneAssign, { n: r.newUnassigned })}` : ''
      toast(head + extra + assignExtra)
      // 第 17 批（§3②）：本轮确实新增了未指派单 → 提示条 + 「去指派」；无新增即消失
      setNewUnassigned(r.newUnassigned)
      if (r.warnings.length > 0) setHint(r.warnings.join('\n'))
      else setHint(null)
      await loadStatus()
      await loadList(filter)
    } finally {
      setSyncing(false)
    }
  }

  const doConfirmBatch = async (): Promise<void> => {
    const r = await window.api.ticketConfirmBatch()
    toast(fmt(COPY.ticket.syncDone, { inserted: r.confirmed, updated: 0, tasks: r.tasksCreated }))
    if (r.warnings.length) setHint(r.warnings.join('\n'))
    await loadList(filter)
  }

  // ---- 形态①：未配置 → 引导 ----
  if (status && !status.configured) {
    return (
      <>
        <div className="tk-empty">
          <div className="tk-empty-ico">
            <Icon name="inbox" size={28} />
          </div>
          <div className="t">{COPY.ticket.notConfigured}</div>
          <button className="btn primary" onClick={() => setShowSettings(true)}>
            {COPY.ticket.settingsTitle}
          </button>
        </div>
        {showSettings && (
          <TicketSettingsModal
            initial={status}
            onOpenWizard={onOpenWizard}
            onClose={() => setShowSettings(false)}
            onSaved={async () => {
              setShowSettings(false)
              const st = await loadStatus()
              if (st?.configured) await loadList('mine')
            }}
          />
        )}
      </>
    )
  }

  const pendingCount = list.length

  return (
    <div className="tk-view">
      <div className="tk-toolbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? ' on' : ''}`}
              onClick={() => void switchFilter(f.key)}
              title={f.key === 'abnormal' ? COPY.ticket.abnormalHint : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {/* 第 26 批（docs/31）：上次同步时间 —— 后台自动同步**静默跑**（不弹窗是设计），
            这块就是它唯一的可见凭据。失败时变红，点一下直接去设置里看原因。 */}
        {autoSync && (
          <button
            className={`tk-lastsync${autoSync.lastSync.ok === false ? ' bad' : ''}`}
            onClick={() => {
              if (autoSync.lastSync.ok === false) setShowSettings(true)
            }}
            title={
              autoSync.lastSync.ok === false
                ? `${COPY.ticket.lastSyncFailedTip}${
                    autoSync.lastSync.error ? `：${autoSync.lastSync.error}` : ''
                  }`
                : ''
            }
          >
            {autoSync.lastSync.ok === false
              ? fmt(COPY.ticket.lastSyncFailed, { time: hhmm(autoSync.lastSync.at) })
              : autoSync.lastSync.at
                ? fmt(COPY.ticket.lastSyncAt, { time: hhmm(autoSync.lastSync.at) })
                : COPY.ticket.lastSyncNever}
          </button>
        )}
        {filter === 'pending' && pendingCount > 0 && (
          <button className="btn" onClick={() => void doConfirmBatch()}>
            {COPY.ticket.confirmBatch}
          </button>
        )}
        {/* 第 17 批：配置态也要有设置入口（否则「允许指派」开关没地方开）——齿轮，悬停提示 */}
        <button
          className="btn"
          onClick={() => setShowSettings(true)}
          title={COPY.ticket.settingsTitle}
        >
          <Icon name="gear" size={13} />
        </button>
        {/* 第 19 批（docs/22 §6）：导出报表 */}
        <button
          className="btn"
          onClick={() => setShowExport(true)}
          title={COPY.ticket.exportReportBtn}
        >
          <Icon name="doc" size={13} /> {COPY.ticket.exportReportBtn}
        </button>
        <button
          className="btn primary"
          onClick={() => void doSync()}
          disabled={syncing}
          title={status?.docName ?? ''}
        >
          <Icon name="refresh" size={13} />{' '}
          {syncing ? COPY.ticket.syncing : COPY.ticket.syncBtn}
        </button>
      </div>

      {hint && (
        <div className="tk-hint">
          <div className="txt">{hint}</div>
          <button className="wx" onClick={() => setHint(null)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {/* 第 17 批（docs/19 §3②）：本轮同步新增未指派 → 提示条 + 去指派（点掉或下次无新增即消失） */}
      {newUnassigned > 0 && (
        <div className="tk-hint assign">
          <div className="txt">
            {fmt(COPY.ticket.newUnassignedHint, { n: newUnassigned })}
          </div>
          <button
            className="btn small"
            onClick={() => {
              setNewUnassigned(0)
              void switchFilter('unassigned')
            }}
          >
            {COPY.ticket.goAssign}
          </button>
          <button className="wx" onClick={() => setNewUnassigned(0)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {/* 「异常」不拆分：选中的时候给一行说明（悬停筛选标签也有同款提示） */}
      {filter === 'abnormal' && <div className="tk-note">{COPY.ticket.abnormalHint}</div>}

      {/* 列表头（固定不滚，列表区自己滚 —— 不用 sticky，永不叠行） */}
      <div className="tk-row tk-head">
        <span className="c-type" />
        <span className="c-no">编号</span>
        <span className="c-title">物料名称</span>
        <span className="c-state">状态</span>
        <span className="c-applicant">申请人</span>
        <span className="c-project">业务归属</span>
        <span className="c-designer">设计师</span>
        <span className="c-due">交稿日期</span>
        <span className="c-task">关联任务</span>
      </div>

      <div className="tk-list">
        {list.length === 0 && (
          <div className="tk-empty-small">
            {listLoading ? `（${COPY.common.loading}）` : COPY.ticket.emptyList}
          </div>
        )}
        {list.map((t) => {
          const dim = t.approvalState === '已驳回' || t.approvalState === '已撤销'
          return (
            <div
              key={t.id}
              className={`tk-row${dim ? ' dim' : ''}`}
              onClick={() => setDetailNo(t.ticketNo)}
            >
              <span className="c-type">
                <span className={`tk-type ${t.ticketType}`}>
                  {t.ticketType === 'print' ? COPY.ticket.typePrint : COPY.ticket.typeDigital}
                </span>
              </span>
              <span className="c-no">{t.ticketNo}</span>
              <span className="c-title" title={t.title ?? ''}>
                {t.title ?? '—'}
              </span>
              <span className="c-state">
                <span className={`tk-state ${stateClass(t.approvalState)}`}>
                  {t.approvalState ?? '—'}
                </span>
              </span>
              <span className="c-applicant">{t.applicantName ?? '—'}</span>
              <span className="c-project" title={t.projectName ?? ''}>
                {t.projectName ?? '—'}
              </span>
              <span className="c-designer">
                {t.designerName ? (
                  <>
                    {t.designerName}
                    {t.designers.length > 1 && (
                      <span className="tk-dim">{fmt(COPY.ticket.assignMore, { n: t.designers.length - 1 })}</span>
                    )}
                  </>
                ) : (
                  <span className="tk-warn">{COPY.ticket.filterUnassigned}</span>
                )}
              </span>
              <span className="c-due">{t.dueDate ? t.dueDate.slice(0, 10) : '—'}</span>
              <span className="c-task">
                {t.needConfirm ? (
                  <span className="tk-warn">{COPY.ticket.pendingLabel}</span>
                ) : t.dupWarn ? (
                  <span className="tk-warn">{COPY.ticket.dupWarnLabel}</span>
                ) : t.packId !== null ? (
                  <span className="tk-linked" title={t.packName ?? ''}>
                    {fmt(COPY.ticket.linkedTask, { name: t.packName ?? '' })}
                    {t.reassignedTo ? ` · ${fmt(COPY.ticket.reassignedTo, { name: t.reassignedTo })}` : ''}
                  </span>
                ) : t.isHistory ? (
                  <span className="tk-dim">{COPY.ticket.noTaskHistory}</span>
                ) : t.rowGone ? (
                  <span className="tk-dim">{COPY.ticket.rowGoneLabel}</span>
                ) : (
                  <span className="tk-dim">{COPY.ticket.noTaskOther}</span>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {detailNo && (
        <TicketDetailModal
          ticketNo={detailNo}
          onClose={() => setDetailNo(null)}
          onChanged={async () => {
            await loadList(filter)
          }}
          onToast={toast}
        />
      )}
      {showSettings && (
        <TicketSettingsModal
          initial={status}
          onOpenWizard={onOpenWizard}
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            setShowSettings(false)
            await loadStatus()
            await loadList(filter)
            await loadAutoSync()
          }}
        />
      )}
      {showExport && (
        <ExportReportModal onClose={() => setShowExport(false)} onToast={toast} />
      )}
      {/* 第 21 批：同步失败（组件缺失 / 未授权）时自动摆出来的连接引导 */}
      {showWecom && (
        <WecomAuthModal onClose={() => setShowWecom(false)} onToast={toast} />
      )}
    </div>
  )
}

/** 详情弹窗要用的详情加载（放这导出给弹窗复用同一类型） */
export type { TicketDetail }
