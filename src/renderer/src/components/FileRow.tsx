import { COPY, fmt } from '../../../shared/copy'
import { useMemo } from 'react'
import type { AssetItem } from '../types'
import { Icon } from './Icon'

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

/** 毫秒 → 00:01:23 / 03:45（不足 1 小时省略时） */
export function fmtDuration(ms: number | null): string | null {
  if (!ms || ms <= 0) return null
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${p2(h)}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** probe_info JSON 里的页数（PDF），读不出返回 null */
function pdfPages(probeInfo: string | null): number | null {
  if (!probeInfo) return null
  try {
    const j = JSON.parse(probeInfo) as { pages?: number }
    return typeof j.pages === 'number' && j.pages > 0 ? j.pages : null
  } catch {
    return null
  }
}

/**
 * B-01 / B-05：媒体信息行 —— 尺寸 · 色彩/编码 · 时长 · 页数 · 体积 · 时间。
 * 只把「有值」的段拼进去，没有的段不留空档。
 */
export function buildMetaLine(item: AssetItem): string {
  const parts: string[] = []
  if (item.width && item.height) parts.push(`${item.width}×${item.height}`)
  if (item.color_mode) parts.push(item.color_mode)
  const dur = fmtDuration(item.duration_ms)
  if (dur) parts.push(dur)
  if (item.video_codec) parts.push(item.video_codec)
  const pages = pdfPages(item.probe_info ?? null)
  if (pages) parts.push(fmt(COPY.file.pages, { n: pages }))
  parts.push(fmtSize(item.size))
  const t = fmtTime(item.modified_at)
  if (t) parts.push(t)
  return parts.join(' · ')
}

function FileThumb({ item }: { item: AssetItem }): React.JSX.Element {
  if (item.thumb) return <img src={item.thumb} alt={item.file_name} />
  return <div className="ext">{item.ext || COPY.file.extFallback}</div>
}

/** 单个文件行。A-11：双击文件名调系统默认程序打开；右侧按钮可打开所在文件夹 */
export function FileRow({
  item,
  selected,
  selectable,
  onToggle,
  onOpen,
  onReveal,
  onDropTag,
  onRelocate
}: {
  item: AssetItem
  selected: boolean
  selectable: boolean
  onToggle: () => void
  onOpen: () => void
  onReveal: () => void
  /** 第 3 批：点标签上的小叉摘掉这个标签 */
  onDropTag?: (tagId: number) => void
  /** 第 8 批：文件已丢失 → 点这里重新定位（M8-03） */
  onRelocate?: () => void
}): React.JSX.Element {
  const missing = item.missing_at !== null
  const cls = useMemo(
    () => `file-row${selected ? ' sel' : ''}${missing ? ' missing' : ''}`,
    [selected, missing]
  )
  const metaLine = useMemo(() => buildMetaLine(item), [item])
  const tags = item.tags ?? []
  const lostTitle = missing
    ? fmt(COPY.file.missingTip, { at: item.missing_at, path: item.abs_path })
    : COPY.file.openTip

  return (
    <div className={cls} onDoubleClick={missing ? undefined : onOpen}>
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
        <div className="fn" onClick={missing ? undefined : onOpen} title={lostTitle}>
          {item.file_name}
          {item.versionSeq ? (
            <span
              className={`ver-badge${item.versionCurrent ? ' cur' : ''}`}
              title={
                item.versionCurrent
                  ? fmt(COPY.file.currentVerTip, { n: item.versionSeq })
                  : fmt(COPY.file.historyVerTip, { n: item.versionSeq })
              }
            >
              V{item.versionSeq}
            </span>
          ) : null}
          {missing && (
            <span className="miss-badge" title={lostTitle}>
              <Icon name="warning" size={12} />  {COPY.side.missing}
            </span>
          )}
        </div>
        <div className="fp" title={metaLine}>
          <span className="meta">{metaLine}</span>
          <span className="path-sep">·</span>
          <span className="rpath">{item.rel_path}</span>
        </div>
        {tags.length > 0 && (
          <div className="row-tags">
            {tags.map((t) => (
              <span
                key={t.id}
                className="row-tag"
                style={{ background: t.color + '22', borderColor: t.color + '77', color: t.color }}
                title={`${t.dimension} · ${t.name}`}
              >
                {t.name}
                {onDropTag && (
                  <button
                    className="row-tag-x"
                    title={COPY.file.removeTagTip}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDropTag(t.id)
                    }}
                  >
                    <Icon name="close" size={10} strokeWidth={2} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      {item.role && <span className={`role ${item.role}`}>{item.role}</span>}
      <div className="act">
        {missing ? (
          <button
            className="icon-btn relocate"
            title={COPY.file.relocateTip}
            onClick={onRelocate}
          >
            <Icon name="locate" size={14} />
          </button>
        ) : (
          <button className="icon-btn" title={COPY.file.openFileTip} onClick={onOpen}>
            <Icon name="external" size={13} />
          </button>
        )}
        <button className="icon-btn" title={COPY.file.revealTip} onClick={onReveal}>
          <Icon name="folder" size={14} />
        </button>
      </div>
    </div>
  )
}
