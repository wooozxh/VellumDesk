import { COPY, fmt } from '../../../shared/copy'
import { Rich } from './Rich'
import { useState } from 'react'
import type { PackCard as PackCardType } from '../types'
import { Icon } from './Icon'

/** 包卡片占位图标——没有缩略图时显示 */
function Placeholder(): React.JSX.Element {
  return (
    <div className="ph">
      <Icon name="package" size={30} strokeWidth={1.3} />
    </div>
  )
}

export function PackCard({
  pack,
  onOpen,
  onEdit
}: {
  pack: PackCardType
  onOpen: () => void
  /** 第 7 批：改包信息（名称 / 类别 / 所属项目）；待归类的包用它归位 */
  onEdit?: () => void
}): React.JSX.Element {
  const [imgOk, setImgOk] = useState(true)
  const isLoose = pack.project_id === null

  return (
    <div className="pack-card" onClick={onOpen} title={pack.folder_path}>
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
          <Placeholder />
        )}
        {/* 第 8 批：包里有文件丢了 → 挂个角标，进包详情能看到是哪几条 */}
        {(pack.missingCount ?? 0) > 0 && (
          <span
            className="miss-flag"
            title={fmt(COPY.card.missingTip, { n: pack.missingCount })}
          >
            <Icon name="warning" size={12} /> {pack.missingCount}
          </span>
        )}
      </div>
      <div className="meta">
        <div className="name" title={pack.name}>
          {pack.name}
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
