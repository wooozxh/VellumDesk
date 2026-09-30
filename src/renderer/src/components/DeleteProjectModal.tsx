import { useState } from 'react'
import type { ProjectWithCount } from '../types'
import { Icon } from './Icon'

/**
 * 删除项目的确认弹窗。
 *
 * 三条路，**都不允许出现「包跟着项目一起消失」**（铁则：软件永远不悄悄扔掉用户放的东西）：
 *   - 转移到其他项目：包文件夹搬进目标项目的文件夹
 *   - 不指定项目：包文件夹搬回工作区根目录 = 界面上的「待归类」
 *   - 删进回收站（第 7 批新增）：整个项目文件夹搬进 `_回收站`，项目与包的记录删掉
 *
 * 第 7 批只**加**了第三条出口，前两条一个字没改 —— 第 6 批的验收断言继续有效。
 */
export function DeleteProjectModal({
  project,
  others,
  onClose,
  onConfirm
}: {
  project: ProjectWithCount
  /** 其他可接收包的项目 */
  others: ProjectWithCount[]
  onClose: () => void
  onConfirm: (action: {
    moveTo: number | null
    toTrash?: boolean
  }) => Promise<{ ok: boolean; error?: string }>
}): React.JSX.Element {
  const hasPacks = project.packCount > 0
  const [mode, setMode] = useState<'move' | 'orphan' | 'trash'>(
    others.length > 0 ? 'move' : 'orphan'
  )
  const [target, setTarget] = useState<number | null>(others[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const r =
      mode === 'trash'
        ? await onConfirm({ moveTo: null, toTrash: true })
        : await onConfirm({ moveTo: mode === 'move' ? target : null })
    setBusy(false)
    if (!r.ok) setErr(r.error ?? '删除失败')
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          <Icon name="warning" size={15} /> 删除项目
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="content">
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            确定删除项目
            <b style={{ color: project.color }}>「{project.name}」</b>吗？
          </div>

          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              background: 'var(--warn-soft)',
              border: '1px solid var(--warn)',
              borderRadius: 'var(--r-sm)',
              fontSize: 12.5,
              color: 'var(--warn)',
              lineHeight: 1.8
            }}
          >
            {hasPacks ? (
              <>
                该项目下有 <b>{project.packCount}</b> 个包。包和里面的文件都不会被删除，
                但请先选一个去处：
              </>
            ) : (
              <>该项目下没有包。删除后不影响任何文件，要重名再用可以随时新建。</>
            )}
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label className="radio-line">
              <input
                type="radio"
                checked={mode === 'move'}
                disabled={others.length === 0}
                onChange={() => setMode('move')}
              />
              <span>转移到其他项目</span>
            </label>
            {mode === 'move' && others.length > 0 && (
              <select
                value={target ?? ''}
                onChange={(e) => setTarget(Number(e.target.value))}
                style={{ marginTop: 7, marginLeft: 22, width: 'calc(100% - 22px)' }}
              >
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（现有 {p.packCount} 个包）
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="field">
            <label className="radio-line">
              <input
                type="radio"
                checked={mode === 'orphan'}
                onChange={() => setMode('orphan')}
              />
              <span>不指定项目（变成待归类）</span>
            </label>
            <div className="hint" style={{ marginLeft: 22 }}>
              这 {project.packCount || 0} 个包还留在硬盘上、文件一个不少，
              只是不再挂在任何项目下，之后可以再指定
            </div>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="radio-line">
              <input type="radio" checked={mode === 'trash'} onChange={() => setMode('trash')} />
              <span style={{ color: 'var(--danger)' }}>删进回收站（项目连同包一起隐去）</span>
            </label>
            <div className="hint" style={{ marginLeft: 22, lineHeight: 1.8 }}>
              整个项目文件夹会搬到工作区的
              <span className="path"> _回收站 </span>
              里，<b>文件一个都不会消失</b>，只是从软件里不再显示。
              <br />
              真要彻底清掉，自己去 `_回收站` 里删 —— 那才是"不要了"的正确姿势。
            </div>
          </div>

          {err && (
            <div className="hint" style={{ color: 'var(--danger)', marginTop: 10 }}>
              {err}
            </div>
          )}
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn"
            style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }}
            onClick={confirm}
            disabled={busy || (mode === 'move' && hasPacks && target === null)}
          >
            {busy ? '处理中…' : mode === 'trash' ? '删进回收站' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  )
}
