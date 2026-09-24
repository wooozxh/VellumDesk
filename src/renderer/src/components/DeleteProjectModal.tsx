import { useState } from 'react'
import type { ProjectWithCount } from '../types'

/**
 * 删除项目的确认弹窗。
 *
 * 两条路都不允许出现「包跟着项目一起消失」：
 *   - 项目下有包 → 必须选去向：转到另一个项目 / 变成未归属
 *   - 项目下没有包 → 普通确认
 * 这是「软件永远不悄悄扔掉用户放的东西」铁则在项目维度上的落地。
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
  onConfirm: (action: { moveTo: number | null }) => Promise<{ ok: boolean; error?: string }>
}): React.JSX.Element {
  const hasPacks = project.packCount > 0
  const [mode, setMode] = useState<'move' | 'orphan'>(others.length > 0 ? 'move' : 'orphan')
  const [target, setTarget] = useState<number | null>(others[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const r = await onConfirm({ moveTo: hasPacks ? (mode === 'move' ? target : null) : null })
    setBusy(false)
    if (!r.ok) setErr(r.error ?? '删除失败')
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          ⚠ 删除项目
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </h3>

        <div className="content">
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            确定删除项目
            <b style={{ color: project.color }}>「{project.name}」</b>吗？
          </div>

          {hasPacks ? (
            <>
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
                该项目下有 <b>{project.packCount}</b> 个包。包和里面的文件都不会被删除，
                但请先指定它们的新归属：
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

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="radio-line">
                  <input
                    type="radio"
                    checked={mode === 'orphan'}
                    onChange={() => setMode('orphan')}
                  />
                  <span>不指定项目（变成未归属）</span>
                </label>
                <div className="hint" style={{ marginLeft: 22 }}>
                  这 {project.packCount} 个包还留在硬盘上、文件一个不少，
                  只是不再挂在任何项目下，之后可以再指定
                </div>
              </div>
            </>
          ) : (
            <div className="hint" style={{ marginTop: 10 }}>
              该项目下没有包，删除后不影响任何文件。要重名再用可以随时新建。
            </div>
          )}

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
            disabled={busy || (hasPacks && mode === 'move' && target === null)}
          >
            {busy ? '处理中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  )
}
