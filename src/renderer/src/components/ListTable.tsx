/**
 * 第 67 批（docs/50）：**列表表格**（带勾选多选）。
 *
 * 三个视图（任务 / 通用库 / 模板库）共用同一套骨架，各自只提供**列定义**。
 * 为什么抽出来：三处的"表头 + 全选 + 行勾选 + 选中态 + Shift 连选"完全一样，
 * 各写一遍必然长歪（列宽、行高、hover 观感三处不一致）。
 *
 * 交互口径（刻意简单，不做花活）：
 * · **点行任意处 = 切换勾选** —— 列表视图的主用途就是"勾一堆再批量做"，
 *   所以整行是热区，不用瞄准那个 15×15 的小方块；
 * · **表头复选框 = 全选 / 全不选**（只作用于**当前显示的**行，不是整库）；
 * · **Shift + 点** = 从上次点的行连选到这一行（和资源管理器一致）；
 * · 勾选状态由父组件持有（`selected`），本组件只报事件 —— 因为批量操作要读它。
 */
import { useRef } from 'react'
import { COPY, fmt } from '../../../shared/copy'

/**
 * 列表里的时间显示：`2026-10-17 15:04`。
 *
 * 三处列表共用一份 —— 各自 `new Date(...)` 一次必然有人忘了补零 / 处理非法值。
 * 解析不出来就退回原串前 10 位（**不抛错**：一条脏数据不该让整张表白屏）。
 */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface ListColumn<T> {
  key: string
  label: string
  /** grid 列宽：`1fr` / `120px` / `minmax(0,1.4fr)` 都行 */
  width: string
  /** 右对齐（数字、大小、时间用） */
  align?: 'right' | 'center'
  /** 单元格悬停提示（被省略号截断的长文件名靠它看全） */
  title?: (row: T) => string
  render: (row: T) => React.ReactNode
}

export function ListTable<T extends { id: number }>({
  rows,
  columns,
  selected,
  onToggle,
  onToggleAll,
  onSelectRange,
  rowClass,
  /** 双击行（任务视图用：双击进任务）；不传则双击无动作 */
  onOpen,
  empty
}: {
  rows: T[]
  columns: ListColumn<T>[]
  selected: Set<number>
  onToggle: (id: number) => void
  onToggleAll: () => void
  /** Shift 连选：把这一段 id 全部置为选中 */
  onSelectRange?: (ids: number[]) => void
  rowClass?: (row: T) => string
  onOpen?: (row: T) => void
  empty?: React.ReactNode
}): React.JSX.Element {
  /** 上一次点过的行（Shift 连选的锚点）—— 只在渲染期之外用，不需要触发重绘 */
  const anchorRef = useRef<number | null>(null)

  /** 第一列固定是复选框；其余按 `columns` 拼 —— 表头与每一行用**同一个**模板，保证对齐 */
  const grid = `30px ${columns.map((c) => c.width).join(' ')}`

  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const someOn = rows.some((r) => selected.has(r.id))

  const clickRow = (row: T, shift: boolean): void => {
    if (shift && anchorRef.current !== null && onSelectRange) {
      const a = rows.findIndex((r) => r.id === anchorRef.current)
      const b = rows.findIndex((r) => r.id === row.id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        onSelectRange(rows.slice(lo, hi + 1).map((r) => r.id))
        anchorRef.current = row.id
        return
      }
    }
    onToggle(row.id)
    anchorRef.current = row.id
  }

  if (rows.length === 0) {
    return <div className="dtable-empty">{empty ?? COPY.common.listEmpty}</div>
  }

  return (
    <div className="dtable">
      <div className="dthead" style={{ gridTemplateColumns: grid }}>
        <span className="dcell-check">
          <input
            className="cb"
            type="checkbox"
            // 「部分选中」时画成半选 —— 否则全选了几条和一条没选看起来一样
            ref={(el) => {
              if (el) el.indeterminate = someOn && !allOn
            }}
            checked={allOn}
            onChange={onToggleAll}
            title={allOn ? COPY.common.selectNoneAll : COPY.common.selectAllAll}
          />
        </span>
        {columns.map((c) => (
          <span
            key={c.key}
            className="dcell-h"
            style={{ justifySelf: c.align === 'right' ? 'end' : c.align === 'center' ? 'center' : 'start' }}
          >
            {c.label}
          </span>
        ))}
      </div>

      {rows.map((r) => {
        const on = selected.has(r.id)
        return (
          <div
            key={r.id}
            className={`drow${on ? ' on' : ''}${rowClass ? ` ${rowClass(r)}` : ''}`}
            style={{ gridTemplateColumns: grid }}
            onClick={(e) => clickRow(r, e.shiftKey)}
            onDoubleClick={() => onOpen?.(r)}
            title={onOpen ? fmt(COPY.common.dblClickOpen, { name: '' }).trim() : undefined}
          >
            <span className="dcell-check">
              {/* pointer-events:none ⇒ 点它等同于点整行，不会触发两次（一次 change 一次行 click） */}
              <input className="cb" type="checkbox" checked={on} readOnly style={{ pointerEvents: 'none' }} />
            </span>
            {columns.map((c) => (
              <span
                key={c.key}
                className={`dcell dcell-${c.key}`}
                style={{ justifySelf: c.align === 'right' ? 'end' : c.align === 'center' ? 'center' : 'stretch' }}
                title={c.title ? c.title(r) : undefined}
              >
                {c.render(r)}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}
