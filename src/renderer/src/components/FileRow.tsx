import { useMemo } from 'react'
import type { AssetItem } from '../types'

export function fmtSize(bytes: number): string {
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

function FileThumb({ item }: { item: AssetItem }): React.JSX.Element {
  if (item.thumb) return <img src={item.thumb} alt={item.file_name} />
  return <div className="ext">{item.ext || '文件'}</div>
}

/** 单个文件行。A-11：双击文件名调系统默认程序打开；右侧按钮可打开所在文件夹 */
export function FileRow({
  item,
  selected,
  selectable,
  onToggle,
  onOpen,
  onReveal
}: {
  item: AssetItem
  selected: boolean
  selectable: boolean
  onToggle: () => void
  onOpen: () => void
  onReveal: () => void
}): React.JSX.Element {
  const cls = useMemo(() => `file-row${selected ? ' sel' : ''}`, [selected])

  return (
    <div className={cls} onDoubleClick={onOpen}>
      {selectable && (
        <input
          className="cb"
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="pic">
        <FileThumb item={item} />
      </div>
      <div className="info">
        <div className="fn" onClick={onOpen} title="双击/单击打开文件">
          {item.file_name}
        </div>
        <div className="fp" title={item.rel_path}>
          {item.rel_path}
        </div>
      </div>
      {item.role && <span className={`role ${item.role}`}>{item.role}</span>}
      <span className="sz">{fmtSize(item.size)}</span>
      <div className="act">
        <button className="icon-btn" title="打开文件" onClick={onOpen}>
          ↗
        </button>
        <button className="icon-btn" title="打开所在文件夹" onClick={onReveal}>
          📁
        </button>
      </div>
    </div>
  )
}
