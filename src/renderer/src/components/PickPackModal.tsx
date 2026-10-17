/**
 * 第 68 批（docs/50 §6）：**选一个任务**（批量「复制到任务」用）。
 *
 * 与 `MoveToFolderModal` 同一个观感（复用 `.mv-*` 样式）—— 两者本质都是"从一列里挑一个目标"，
 * 用户学一次就够了。区别只是这里列的是任务、带项目名做区分（同名任务不罕见，见 docs/42）。
 */
import { COPY } from '../../../shared/copy'
import { Icon } from './Icon'

export interface PackChoice {
  id: number
  name: string
  projectName?: string | null
}

export function PickPackModal({
  packs,
  busy,
  onPick,
  onClose
}: {
  packs: PackChoice[]
  busy?: boolean
  onPick: (id: number) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal mv-modal">
        <h3>{COPY.common.pickPackTitle}</h3>
        <div className="content">
          {packs.length === 0 ? (
            <div className="mv-hint">{COPY.common.pickPackEmpty}</div>
          ) : (
            <div className="mv-list">
              {packs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="mv-item"
                  title={p.projectName ? `${p.projectName} / ${p.name}` : p.name}
                  disabled={busy}
                  onClick={() => onPick(p.id)}
                >
                  <Icon name="package" size={13} />
                  <span className="nm">{p.name}</span>
                  {p.projectName && <span className="cnt">{p.projectName}</span>}
                </button>
              ))}
            </div>
          )}
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
