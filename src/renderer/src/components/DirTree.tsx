/**
 * 第 66 批（docs/49）：可复用的「多层目录树」。
 *
 * 通用素材库与模板库共用同一套 —— 之前通用库的树在 `BrandLibraryView` 里写死了"父组 + 子组"两层，
 * 模板库要任意层（≤5），所以抽成通用组件：**节点扁平传入（自带 depth）**，组件只负责
 * 缩进 / 折叠 / 选中态 / 操作按钮插槽，**不做任何数据请求**。
 *
 * 传进来的 `nodes` 需要已按「父在前、同层按 sortOrder」排好序（`tplLib.listTplFolders` 就是这么排的）。
 */
import { useMemo, useState } from 'react'
import { Icon } from './Icon'

export interface DirNode {
  id: number
  parentId: number | null
  name: string
  /** 1 = 顶层 */
  depth: number
  /** 节点右侧显示的数字（模板库用"含子层总数"） */
  count: number
}

export function DirTree(props: {
  nodes: DirNode[]
  selectedId: number | null
  onSelect: (id: number) => void
  /** 每行**常驻**的徽标（如通用库的「同步 / 不同步」开关）—— 状态必须一直看得见 */
  badge?: (n: DirNode) => React.ReactNode
  /** 每行右侧的操作按钮（悬停才出现；不传则没有） */
  actions?: (n: DirNode) => React.ReactNode
  /** 层级上限提示（点"新建子分组"到顶时用得到，这里只透传给 actions） */
  maxDepth?: number
}) {
  const { nodes, selectedId, onSelect, badge, actions } = props
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const hasChild = useMemo(() => {
    const s = new Set<number>()
    for (const n of nodes) if (n.parentId !== null) s.add(n.parentId)
    return s
  }, [nodes])

  /** 祖先里有被折叠的 → 这一行不显示（带环保护，脏数据不会卡死） */
  const hiddenByCollapse = (n: DirNode): boolean => {
    let p = n.parentId
    const guard = new Set<number>()
    while (p !== null && !guard.has(p)) {
      if (collapsed.has(p)) return true
      guard.add(p)
      p = byId.get(p)?.parentId ?? null
    }
    return false
  }

  const toggle = (id: number): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="dirtree">
      {nodes
        .filter((n) => !hiddenByCollapse(n))
        .map((n) => {
          const on = selectedId === n.id
          const kids = hasChild.has(n.id)
          const isCollapsed = collapsed.has(n.id)
          return (
            <div
              key={n.id}
              className={`dirtree-row${on ? ' on' : ''}`}
              data-did={n.id}
              style={{ paddingLeft: 6 + (n.depth - 1) * 14 }}
            >
              <button
                className={`dt-chev${kids ? '' : ' leaf'}`}
                tabIndex={-1}
                aria-label={isCollapsed ? '展开' : '收起'}
                onClick={(e) => {
                  e.stopPropagation()
                  if (kids) toggle(n.id)
                }}
              >
                {kids ? <Icon name={isCollapsed ? 'caret' : 'caretDown'} size={11} /> : null}
              </button>
              <button className="dt-main" onClick={() => onSelect(n.id)} title={n.name}>
                <span className="dt-name">{n.name}</span>
                <span className="dt-count">{n.count}</span>
              </button>
              {badge && <span className="dt-badge">{badge(n)}</span>}
              {actions && <span className="dt-acts">{actions(n)}</span>}
            </div>
          )
        })}
    </div>
  )
}
