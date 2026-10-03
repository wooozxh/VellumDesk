import { useCallback, useEffect, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type { TicketAssignInfo, TicketDetail as TicketDetailT } from '../types'
import { Icon } from './Icon'

/**
 * 第 13 批：工单详情弹窗（docs/15 §6.2）。
 * 字段分三段：基本信息（自动同步的）/ 印刷专属（只有印刷单有）/ 关联任务卡。
 * 「打开审批（含附件）」跳浏览器 —— 一期不做附件下载，附件在审批详情页看（§1 实探结论 5）。
 * 历史单 / 项目未匹配的单给「建任务」手动兜底按钮（§2.2③）。
 *
 * 第 17 批（docs/19 §4）：顶部「指派设计师」区 —— 本机开关开的机器可选人指派
 * （选定即存 → 异步写回企微表 → 通知设计师）；开关没开只读提示。改派走同一个下拉。
 * 「在表格中打开」是逃生口：写回失败 / 权限不足 / CLI 不在时随时退回手工改表。
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
  /** 第 17 批：指派区原料（开关 / 列可用性 / 候选池 / 表格链接） */
  const [assignInfo, setAssignInfo] = useState<TicketAssignInfo | null>(null)
  const [assigning, setAssigning] = useState(false)
  /** 第 18 批：指派草稿（点选/移除先攒在这，点「提交」才真正同步出去） */
  const [draft, setDraft] = useState<Array<{ userid: string; name: string }>>([])

  useEffect(() => {
    void window.api
      .ticketAssignInfo()
      .then((r) => setAssignInfo(r))
      .catch(() => {})
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const r = await window.api.ticketDetail(ticketNo)
    setD(r)
    setDraft(r?.designers ?? [])
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

  /** 第 18 批（docs/20 §7）：多选指派——点「提交」才把整套设计师集合同步出去（写回企微表 + 通知新增人） */
  const doAssign = async (designers: Array<{ userid: string; name: string }>): Promise<void> => {
    if (assigning) return
    setAssigning(true)
    try {
      const r = await window.api.ticketAssignDesigner({ ticketNo, designers })
      if (r.msg) onToast?.(r.msg)
      else if (!r.ok) onToast?.(fmt(COPY.ticket.assignFailed, { msg: r.writeError ?? '' }))
      await load()
      await onChanged?.()
    } finally {
      setAssigning(false)
    }
  }

  /** 第 17 批：逃生口 —— 在表格中打开（写回失败 / 权限不足时退回手工改表） */
  const openTable = async (): Promise<void> => {
    const url = assignInfo?.tableUrl ?? ''
    if (!/^https?:\/\//i.test(url)) return
    await window.api.ticketOpenApproval(url)
  }

  const row = (label: string, v: string | number | null | undefined): React.JSX.Element | null =>
    v === null || v === undefined || v === '' ? null : (
      <div className="tk-field">
        <span className="k">{label}</span>
        <span className="v">{String(v)}</span>
      </div>
    )

  const urlOk = /^https?:\/\//i.test(d?.approvalUrl ?? d?.sourceUrl ?? '')

  // 草稿与已保存集合是否一致（按 userid 集合比较，忽略顺序）
  const draftKey = draft.map((x) => x.userid).sort().join('\u0000')
  const savedKey = (d?.designers ?? []).map((x) => x.userid).sort().join('\u0000')
  const dirty = draftKey !== savedKey

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

            {/* 第 17 批（docs/19 §4）：指派设计师区。历史/待确认/已删行的单不给入口；
                开关没开的机器只读提示「等待指派」；改派走同一个下拉（§4 末条） */}
            {(!d.designerName || assignInfo?.allow) &&
              !d.isHistory &&
              !d.needConfirm &&
              !d.rowGone && (
                <div className="tk-assign">
                  <span className="k">{COPY.ticket.assignSection}</span>
                  {assignInfo === null ? (
                    <span className="tk-dim">{COPY.common.loading}</span>
                  ) : !assignInfo.allow ? (
                    <span className="tk-dim">{COPY.ticket.assignNotAllowed}</span>
                  ) : !assignInfo.designerColOk ? (
                    <span className="tk-warn">{COPY.ticket.assignColBad}</span>
                  ) : (
                    <>
                    <span className="tk-assign-pick">
                      {/* 第 18 批（docs/20 §7）：已选设计师以标签显示，可点 × 移除（最后一人不可移除）；
                          点选/移除只改本地草稿，点右侧「提交指派」才真正同步出去 */}
                      {draft.map((ds) => (
                        <span className="tk-assign-tag" key={ds.userid}>
                          {ds.name}
                          {draft.length > 1 && (
                            <button
                              type="button"
                              className="tk-assign-x"
                              disabled={assigning}
                              title={COPY.ticket.assignNeedOne}
                              onClick={() => setDraft(draft.filter((x) => x.userid !== ds.userid))}
                            >
                              <Icon name="close" size={11} />
                            </button>
                          )}
                        </span>
                      ))}
                      <select
                        disabled={assigning}
                        value=""
                        onChange={(e) => {
                          const c = assignInfo.candidates.find((x) => x.userid === e.target.value)
                          if (c && !draft.some((x) => x.userid === c.userid)) {
                            setDraft([...draft, { userid: c.userid, name: c.name }])
                          }
                          e.currentTarget.value = ''
                        }}
                      >
                        <option value="">
                          {assigning ? COPY.common.saving : COPY.ticket.assignPlaceholder}
                        </option>
                        {assignInfo.candidates
                          .filter((c) => !draft.some((x) => x.userid === c.userid))
                          .map((c) => (
                            <option key={c.userid} value={c.userid}>
                              {c.name}（{fmt(COPY.ticket.assignBusyLabel, { n: c.activeCount })}）
                            </option>
                          ))}
                      </select>
                      {dirty && <span className="tk-dim">{COPY.ticket.assignDirty}</span>}
                    </span>
                    {dirty && (
                      <button
                        type="button"
                        className="btn primary tk-assign-submit"
                        disabled={assigning}
                        onClick={() => void doAssign(draft)}
                      >
                        {COPY.ticket.assignSubmit}
                      </button>
                    )}
                    </>
                  )}
                </div>
              )}

            <h4>{COPY.ticket.basicSection}</h4>
            <div className="tk-fields">
              {row('审批单编号', d.ticketNo)}
              {row('申请人', d.applicantName)}
              {row('申请部门', d.department)}
              {row('业务归属', d.projectName)}
              {row('设计师', d.designers.length ? d.designers.map((x) => x.name).join('、') : null)}
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
              {/* 第 17 批：逃生口 —— 写回失败/权限不足/CLI 不在时退回手工改表（docs/19 §2） */}
              {assignInfo?.tableUrl && (
                <button className="btn" onClick={() => void openTable()}>
                  {COPY.ticket.openTable}
                </button>
              )}
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
