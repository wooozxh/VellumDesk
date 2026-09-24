import { useState } from 'react'
import type { PackCard as PackCardType } from '../types'

/** 包卡片占位图标——没有缩略图时显示 */
function Placeholder(): React.JSX.Element {
  return <div className="ph">🗂</div>
}

export function PackCard({
  pack,
  onOpen
}: {
  pack: PackCardType
  onOpen: () => void
}): React.JSX.Element {
  const [imgOk, setImgOk] = useState(true)

  return (
    <div className="pack-card" onClick={onOpen} title={pack.folder_path}>
      <div className="thumb">
        {pack.cover && imgOk ? (
          <img src={pack.cover} alt={pack.name} onError={() => setImgOk(false)} />
        ) : (
          <Placeholder />
        )}
      </div>
      <div className="meta">
        <div className="name" title={pack.name}>
          {pack.name}
        </div>
        <div className="sub">
          {pack.fileCount} 个文件 · {fmtSize(pack.totalSize)}
        </div>
        <div className="tags">
          <span className="tag proj">{pack.project}</span>
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
          📥
        </div>
      </div>
      <div className="meta">
        <div className="name">未归属</div>
        <div className="sub">
          {count} 个文件 · {fmtSize(size)}
        </div>
        <div className="tags">
          <span className="tag" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
            待整理
          </span>
        </div>
      </div>
    </div>
  )
}
