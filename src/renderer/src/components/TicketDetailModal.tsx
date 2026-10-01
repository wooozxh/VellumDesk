import { useCallback, useEffect, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type { TicketDetail as TicketDetailT } from '../types'
import { Icon } from './Icon'

/**
 * 第 13 批：工单详情弹窗（docs/15 §6.2）。
 * 字段分三段：基本信息（自动同步的）/ 印刷专属（只有印刷单有）/ 关联任务卡。
 * 「打开审批（含附件）」跳浏览器 —— 一期不做附件下载，附件在审批详情页看（§1 实探结论 5）。
 * 历史单 / 项目未匹配的单给「建任务」手动兜底按钮（§2.2③）。
 */
export function TicketDetailModal({
  ticketNo,
  onClose,
  onChanged,
  onToast
}: {
  ticketNo: string
  onClose: () => void
  onChanged?: () => void | Promise<void>
  onToast?: (msg: string) => void
}): React.JSX.Element {
  const [d, setD] = useState<TicketDetailT | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const r = await window.api.ticketDetail(ticketNo)
    setD(r)
  }, [ticketNo])

  useEffect(() => {
    void load()
  }, [load])

  const openApproval = async (): Promise<void> => {
    // 只放行 http/https —— 非网址的值在 Windows 上会兜底打开资源管理器（验收实测）
    const url = d?.approvalUrl ?? d?.sourceUrl ?? ''
    if (!/^https?:\/\//i.test(url)) return
    await window.api.ticketOpenApproval(url)
  }

  const createTask = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const r = await window.api.ticketCreateTask(ticketNo)
      if (r.ok) {
        onToast?.(fmt(COPY.ticket.createTaskOk, { name: r.packName ?? '' }))
        await load()
        await onChanged?.()
      } else {
        onToast?.(r.msg ?? COPY.ticket.syncFailed.replace('{msg}', ''))
      }
    } finally {
      setBusy(false)
    }
  }

  const row = (label: string, v: string | number | null | undefined): React.JSX.Element | null =>
    v === null || v === undefined || v === '' ? null : (
      <div className="tk-field">
        <span className="k">{label}</span>
        <span className="v">{String(v)}</span>
      </div>
    )

  const urlOk = /^https?:\/\//i.test(d?.approvalUrl ?? d?.sourceUrl ?? '')

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide tk-modal">
        <h3>
          <Icon name="doc" size={15} /> {d ? d.title ?? d.ticketNo : COPY.common.loading}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        {!d ? (
          <div className="tk-empty-small">{COPY.common.loading}</div>
        ) : (
          <div className="content">
          <div className="tk-detail">
            <div className="tk-detail-tags">
              <span className={`tk-type ${d.ticketType}`}>
                {d.ticketType === 'print' ? COPY.ticket.typePrint : COPY.ticket.typeDigital}
              </span>
              <span className="tk-state">{d.approvalState ?? '—'}</span>
              {d.isHistory && <span className="tk-dim">{COPY.ticket.filterHistory}</span>}
              {d.needConfirm && <span className="tk-warn">{COPY.ticket.pendingLabel}</span>}
              {d.dupWarn && <span className="tk-warn">{COPY.ticket.dupWarnLabel}</span>}
              {d.reassignedTo && (
                <span className="tk-warn">{fmt(COPY.ticket.reassignedTo, { name: d.reassignedTo })}</span>
              )}
              {d.rowGone && <span className="tk-dim">{COPY.ticket.rowGoneLabel}</span>}
            </div>

            <h4>{COPY.ticket.basicSection}</h4>
            <div className="tk-fields">
              {row('审批单编号', d.ticketNo)}
              {row('申请人', d.applicantName)}
              {row('申请部门', d.department)}
              {row('业务归属', d.projectName)}
              {row('设计师', d.designerName)}
              {row('交稿日期', d.dueDate?.slice(0, 10))}
              {row('提交时间', d.submitTime?.slice(0, 10))}
              {row('完成时间', d.doneTime?.slice(0, 10))}
              {row('物料申请用途', d.purpose)}
              {row('备注', d.remark)}
            </div>

            {d.ticketType === 'print' && (
              <>
                <h4>{COPY.ticket.printSection}</h4>
                <div className="tk-fields">
                  {row('尺寸', d.sizeText)}
                  {row('印制数量', d.printQty)}
                  {row('物料形态', d.materialForm)}
                  {row('物料类别', d.materialCategory)}
                  {row('收货人', d.receiverName)}
                  {row('收货电话', d.receiverPhone)}
                  {row('送达日期', d.deliverDate?.slice(0, 10))}
                </div>
              </>
            )}

            {d.ticketType === 'digital' && (
              <>
                <h4>{COPY.ticket.digitalSection}</h4>
                <div className="tk-fields">
                  {row('物料使用场景', d.useScene)}
                  {row('物料类别', d.materialCategory)}
                </div>
              </>
            )}

            {d.reviewerNames && <div className="tk-fields">{row('物料审核人', d.reviewerNames)}</div>}

            <h4>{COPY.ticket.taskSection}</h4>
            {d.packId !== null ? (
              <div className="tk-packcard">
                <span className="name">{fmt(COPY.ticket.linkedTask, { name: d.packName ?? '' })}</span>
                {d.packSummary && (
                  <span className="meta">
                    {fmt(COPY.common.fileCount, { n: d.packSummary.fileCount })}
                    {d.packSummary.lastUpdate ? ` · ${d.packSummary.lastUpdate.slice(0, 10)}` : ''}
                  </span>
                )}
                {d.packProjectId === null && (
                  <span className="tk-warn">（待归类 —— 到任务视图里给它选项目）</span>
                )}
              </div>
            ) : (
              <div className="tk-packcard empty">
                <span className="tk-dim">
                  {d.isHistory
                    ? COPY.ticket.noTaskHistory
                    : d.needConfirm
                      ? COPY.ticket.noTaskPending
                      : d.approvalState === '已驳回' || d.approvalState === '已撤销'
                        ? '审批未通过，未建任务'
                        : d.mine
                          ? '还没建任务（同步时自动建；项目对不上会等对齐后补建）'
                          : COPY.ticket.noTaskOther}
                </span>
                {/*
                  补建任务按钮：历史单 / 驳回撤销 / 项目未匹配 都给（人点的按钮，容错出口）；
                  唯独待确认单不给 —— 那批要走「确认这批新单」的确认闸，单按钮会绕过它
                */}
                {!d.needConfirm && (
                  <button className="btn" disabled={busy} onClick={() => void createTask()}>
                    {COPY.ticket.createTask}
                  </button>
                )}
              </div>
            )}

            <div className="tk-actions">
              <button
                className="btn"
                onClick={() => void openApproval()}
                disabled={!urlOk}
                title={!urlOk ? COPY.ticket.linkInvalidTitle : undefined}
              >
                {COPY.ticket.openApproval}
              </button>
              <button className="btn primary" onClick={onClose}>
                {COPY.common.close}
              </button>
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  )
}
