import { useCallback, useEffect, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type { TicketDetail, TicketListItem, TicketStatus } from '../types'
import { Icon } from './Icon'
import { TicketDetailModal } from './TicketDetailModal'
import { TicketSettingsModal } from './TicketSettingsModal'

/**
 * 第 13 批：工单视图（docs/15 §6.1）—— 顶栏第三格「工单」。
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

export function TicketsView({ onToast }: { onToast?: (msg: string) => void }): React.JSX.Element {
  const [status, setStatus] = useState<TicketStatus | null>(null)
  const [list, setList] = useState<TicketListItem[]>([])
  const [filter, setFilter] = useState<TkFilter>('mine')
  const [syncing, setSyncing] = useState(false)
  const [detailNo, setDetailNo] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const toast = useCallback(
    (msg: string) => {
      if (onToast) onToast(msg)
      else setHint(msg)
    },
    [onToast]
  )

  const loadStatus = useCallback(async (): Promise<TicketStatus | null> => {
    const st = await window.api.ticketStatus()
    setStatus(st)
    return st
  }, [])

  const loadList = useCallback(async (view: TkFilter): Promise<void> => {
    const items = await window.api.ticketList(view)
    setList(items)
  }, [])

  useEffect(() => {
    void (async () => {
      const st = await loadStatus()
      if (st?.configured) await loadList('mine')
    })()
  }, [loadStatus, loadList])

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
        if (r.kind === 'cli-missing') toast(COPY.ticket.cliMissing)
        else if (r.kind === 'auth-expired') toast(COPY.ticket.authExpired)
        else toast(fmt(COPY.ticket.syncFailed, { msg: r.error ?? '' }))
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
      // 有附加信息才拼第二段，日常同步只有一句
      const extra =
        r.needConfirm + r.reassigned + r.rowGone + r.warnings.length > 0 ? ` · ${more}` : ''
      toast(head + extra)
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
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {filter === 'pending' && pendingCount > 0 && (
          <button className="btn" onClick={() => void doConfirmBatch()}>
            {COPY.ticket.confirmBatch}
          </button>
        )}
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

      {/* 列表头 */}
      <div className="tk-row tk-head">
        <span className="c-type" />
        <span className="c-no">编号</span>
        <span className="c-title">物料名称</span>
        <span className="c-state">状态</span>
        <span className="c-designer">设计师</span>
        <span className="c-due">交稿日期</span>
        <span className="c-task">关联任务</span>
      </div>

      <div className="tk-list">
        {list.length === 0 && <div className="tk-empty-small">（{COPY.common.loading}）</div>}
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
              <span className="c-designer">
                {t.designerName ?? (
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
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            setShowSettings(false)
            await loadStatus()
            await loadList(filter)
          }}
        />
      )}
    </div>
  )
}

/** 详情弹窗要用的详情加载（放这导出给弹窗复用同一类型） */
export type { TicketDetail }
