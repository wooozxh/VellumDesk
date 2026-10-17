/**
 * 第 67 批（docs/50 §6）：**「移动到…」分组选择器**（通用库 / 模板库共用）。
 *
 * 为什么不用下拉框：分组是**多层**的（≤5），下拉里看不出谁是谁的子层。
 * 这里按层缩进排成一列，点哪个就去哪个 —— 与左栏那棵树同一个视觉语言。
 *
 * 列表里第一行固定是「未分组」（`id = -1`），对应磁盘上的库根。
 * 勾选的物料可能来自不同分组，所以**不显示"当前分组"**（没有唯一答案，标了反而误导）。
 */
import { COPY } from '../../../shared/copy'
import { Icon } from './Icon'

export interface MoveTargetNode {
  /** -1 = 未分组（库根） */
  id: number
  name: string
  /** 1 = 顶层；未分组给 0 */
  depth: number
  /** 可选：这一组里有多少条（帮助确认"挪到这儿对不对"） */
  count?: number
}

export function MoveToFolderModal({
  nodes,
  busy,
  onPick,
  onClose
}: {
  nodes: MoveTargetNode[]
  busy?: boolean
  onPick: (id: number) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal mv-modal">
        <h3>{COPY.common.moveTitle}</h3>
        <div className="content">
          <div className="mv-list">
            {nodes.map((n) => (
              <button
                key={n.id}
                type="button"
                className="mv-item"
                // 未分组不加缩进（它在根上，语义上是"最外层"）
                style={{ paddingLeft: 10 + Math.max(0, n.depth - 1) * 14 }}
                title={n.name}
                disabled={busy}
                onClick={() => onPick(n.id)}
              >
                <Icon name={n.depth === 0 ? 'inbox' : 'folder'} size={13} />
                <span className="nm">{n.name}</span>
                {typeof n.count === 'number' && <span className="cnt">{n.count}</span>}
              </button>
            ))}
          </div>
          {nodes.length <= 1 && <div className="mv-hint">{COPY.common.moveEmpty}</div>}
          <div className="tk-actions">
            <button className="btn" onClick={onClose} disabled={busy}>
              {busy ? COPY.common.bulkWorking : COPY.common.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
