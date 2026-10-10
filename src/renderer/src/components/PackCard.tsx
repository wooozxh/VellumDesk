import { COPY, fmt } from '../../../shared/copy'
import { taskCode } from '../../../shared/taskCode'
import { Rich } from './Rich'
import { useState } from 'react'
import type { PackCard as PackCardType } from '../types'
import { Icon } from './Icon'

/**
 * 第 56 批（docs/42）：拼「工单标识」的悬停提示。
 * 有值才出一行 —— 不会出现「交期：」这种后面空着的壳。
 * 卡片和详情弹窗共用这一份（两处显示完全一致）。
 */
export function ticketTip(p: {
  ticketNo: string | null
  ticketTitle: string | null
  ticketApplicant: string | null
  ticketDueDate: string | null
  ticketState: string | null
  ticketCount: number
}): string {
  if (!p.ticketNo) return ''
  const rows = [
    fmt(COPY.card.ticketTipNo, { no: p.ticketNo }),
    p.ticketTitle ? fmt(COPY.card.ticketTipTitle, { title: p.ticketTitle }) : '',
    p.ticketApplicant ? fmt(COPY.card.ticketTipApplicant, { app: p.ticketApplicant }) : '',
    p.ticketDueDate ? fmt(COPY.card.ticketTipDue, { due: p.ticketDueDate }) : '',
    p.ticketState ? fmt(COPY.card.ticketTipState, { state: p.ticketState }) : ''
  ]
  if (p.ticketCount > 1) rows.push(fmt(COPY.card.ticketTipMore, { n: p.ticketCount }))
  return rows.filter(Boolean).join('\n')
}

/** 第 59 批（docs/44）：未归类任务的兜底项目色（与 db.ts `PROJECT_COLORS` 末位的灰一致） */
const GENERIC_COVER_COLOR = '#6b7280'

/**
 * 第 59 批（docs/44）：任务里没有可用成品图时的「通用封面」。
 *
 * 纯 CSS/DOM 绘制 —— 不落地文件、不改主进程：同款版式、按项目换色。
 * 顺序与需求一致：**有真图就用真图**，没有才画这张（判定每次渲染都做，不做记忆）；
 * 任务改名 / 换工单号后，下次渲染自动就是新的，没有缓存失效问题。
 */
function GenericCover({ pack, code }: { pack: PackCardType; code: string }): React.JSX.Element {
  const pc = pack.projectColor ?? GENERIC_COVER_COLOR
  return (
    <div className="gen-cover" style={{ ['--pc' as string]: pc } as React.CSSProperties}>
      <div className="gc-top">
        <span className="gc-dot" />
        <span className="gc-proj">{pack.projectName ?? COPY.card.noProject}</span>
      </div>
      <div className="gc-mid">
        <div className="gc-name">{pack.name}</div>
      </div>
      <div className="gc-bottom">
        <span className="gc-code">{code}</span>
        <span className="gc-mark" title={COPY.cover.markTip}>
          {COPY.cover.mark}
        </span>
      </div>
    </div>
  )
}

export function PackCard({
  pack,
  onOpen,
  onEdit,
  selectable,
  selected,
  onToggleSelect,
  onViewDetail
}: {
  pack: PackCardType
  onOpen: () => void
  /** 第 7 批：改包信息（名称 / 类别 / 所属项目）；待归类的包用它归位 */
  onEdit?: () => void
  /** 第 58 批（docs/43）：多选备份模式下，整卡点击 = 切换勾选（不再打开详情） */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  /** 第 58 批：多选模式下单独打开详情的入口（点卡片是勾选，所以单给一个眼睛按钮） */
  onViewDetail?: () => void
}): React.JSX.Element {
  const [imgOk, setImgOk] = useState(true)
  const isLoose = pack.project_id === null
  const backedUp = !!pack.backedUpAt
  const code = taskCode(pack)

  const cls = [
    'pack-card',
    backedUp ? 'backed-up' : '',
    selectable && selected ? 'selected' : '',
    selectable ? 'selectable' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls} onClick={() => (selectable ? onToggleSelect?.() : onOpen())} title={pack.folder_path}>
      {/* 第 58 批：多选模式左上角的勾选指示（整卡可点，这里只是视觉反馈） */}
      {selectable && (
        <span className={'pick-cb' + (selected ? ' on' : '')} aria-hidden="true">
          {selected && <Icon name="check" size={13} strokeWidth={2.6} />}
        </span>
      )}
      {selectable && onViewDetail && (
        <button
          className="pact detail"
          title={COPY.backup.viewDetail}
          onClick={(e) => {
            e.stopPropagation()
            onViewDetail()
          }}
        >
          <Icon name="eye" size={13} />
        </button>
      )}
      {onEdit && (
        <button
          className="pact"
          title={isLoose ? COPY.card.relocateTip : COPY.card.editTip}
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          {isLoose ? <Icon name="inbox" size={13} /> : <Icon name="edit" size={13} />}
        </button>
      )}
      <div className="thumb">
        {pack.cover && imgOk ? (
          <img src={pack.cover} alt={pack.name} onError={() => setImgOk(false)} />
        ) : (
          <GenericCover pack={pack} code={code} />
        )}
      </div>
      <div className="meta">
        {/* 第 8 批：包里有文件丢了 → 挂个角标，进包详情能看到是哪几条。
            第 60 批（bug 修复）：原来挂在**封面区**右上角，与悬停才显形的编辑按钮
            （`.pact`, top:8 right:8）完全重叠 —— 挪到**信息区**右上角，与任务名同行。 */}
        {(pack.missingCount ?? 0) > 0 && (
          <span
            className="miss-flag"
            title={fmt(COPY.card.missingTip, { n: pack.missingCount })}
          >
            <Icon name="warning" size={12} /> {pack.missingCount}
          </span>
        )}
        <div className="name" title={pack.name}>
          {pack.name}
        </div>
        {/* 第 56 批（docs/42）+ 第 58 批（docs/43 §2.8）：始终挂出**唯一标识** ——
            有工单的用「工单 P0001」，自建任务用「编号 T0023」，两者都跟备份包文件名前缀一致，
            用户在软件里看到什么、去网盘就搜什么。 */}
        <div
          className="ticket-line"
          title={pack.ticketNo ? ticketTip(pack) : fmt(COPY.backup.codeLineTip, { code })}
        >
          <span className="tno">
            {pack.ticketNo ? fmt(COPY.card.ticketLine, { no: pack.ticketNo }) : fmt(COPY.backup.codeLine, { code })}
          </span>
          {pack.ticketApplicant && <span className="tapp">{pack.ticketApplicant}</span>}
        </div>
        <div className="sub">
          <Rich tpl={COPY.card.fileSize} v={{ n: pack.fileCount, size: fmtSize(pack.totalSize) }} />
          {pack.versionCount > 0 && (
            <span
              className="ver-chip"
              title={fmt(COPY.card.verTip, { n: pack.versionCount })}
            >
              {' · '}
              {pack.currentSeq ? fmt(COPY.card.currentVer, { n: pack.currentSeq }) : COPY.card.hasVer} · <Rich tpl={COPY.card.verCount} v={{ n: pack.versionCount }} />
            </span>
          )}
          {pack.hasDelivered && (
            <span className="delivered-chip" title={COPY.exportPack.deliveredMark}>
              {' · '}
              <Icon name="check" size={10} /> {COPY.exportPack.deliveredMark}
            </span>
          )}
          {/* 第 58 批：已备份徽标（跟「已交付」并列 —— 两者是不同维度的状态） */}
          {backedUp && (
            <span
              className="backup-chip"
              title={fmt(COPY.backup.chipTip, { time: fmtTime(pack.backedUpAt), path: pack.backupPath ?? '' })}
            >
              {' · '}
              <Icon name="archive" size={10} /> {COPY.backup.chip}
            </span>
          )}
        </div>
        <div className="tags">
          {pack.projectName ? (
            <span
              className="tag proj"
              style={{
                color: pack.projectColor ?? 'var(--accent)',
                borderColor: (pack.projectColor ?? '#4f8cff') + '77',
                background: (pack.projectColor ?? '#4f8cff') + '22'
              }}
            >
              {pack.projectName}
            </span>
          ) : (
            <span
              className="tag"
              style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}
              title={COPY.card.noProjectTip}
            >
              
              {COPY.card.noProject}
            </span>
          )}
          <span className="tag">{pack.category}</span>
        </div>
      </div>
    </div>
  )
}

/** 第 58 批：把备份时间戳渲染成可读的一行（徽标悬停提示用） */
function fmtTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

/** 「未归属」专用卡片——虚线边框，视觉上明确是"待整理"而不是一个正常包 */
export function UnassignedCard({
  count,
  size,
  onOpen
}: {
  count: number
  size: number
  onOpen: () => void
}): React.JSX.Element {
  return (
    <div className="pack-card unassigned" onClick={onOpen}>
      <div className="thumb">
        <div className="ph" style={{ opacity: 0.7 }}>
          <Icon name="inbox" size={30} strokeWidth={1.3} />
        </div>
      </div>
      <div className="meta">
        <div className="name">{COPY.side.unassigned}</div>
        <div className="sub">
          <Rich tpl={COPY.card.fileSize} v={{ n: count, size: fmtSize(size) }} />
        </div>
        <div className="tags">
          <span className="tag" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
            
            {COPY.card.pending}
          </span>
        </div>
      </div>
    </div>
  )
}
