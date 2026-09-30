import { useState } from 'react'
import type { UnboundProject } from '../types'
import { fmtSize } from './FileRow'
import { Icon } from './Icon'

/**
 * 第 7 批 ④：已解绑的项目。
 *
 * 解绑 = 项目结项后"留底但不碍眼"：文件夹挪进 `_已解绑的项目`，软件里彻底隐身，
 * **本地文件一个不少**，想回来点一下「还原」。
 *
 * 这个弹窗是它们唯一的入口 —— 所以要说清"东西在哪、点了会发生什么"。
 */
export function UnboundProjectsModal({
  projects,
  workspaceRoot,
  onClose,
  onRestore
}: {
  projects: UnboundProject[]
  workspaceRoot: string
  onClose: () => void
  onRestore: (p: UnboundProject) => Promise<{ ok: boolean; error?: string }>
}): React.JSX.Element {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const restore = async (p: UnboundProject): Promise<void> => {
    if (busyId !== null) return
    setBusyId(p.id)
    setErr('')
    const r = await onRestore(p)
    setBusyId(null)
    if (!r.ok) setErr(r.error ?? '还原失败')
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <h3>
          <Icon name="archive" size={15} /> 已解绑的项目（{projects.length}）
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="content">
          {projects.length === 0 ? (
            <div className="hint">没有已解绑的项目</div>
          ) : (
            <>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-2)',
                  lineHeight: 1.9,
                  marginBottom: 10
                }}
              >
                这些项目已经结项留底，软件里不显示，但本地文件一个都没动 —— 都在
                <span className="path">{` ${workspaceRoot}\\_已解绑的项目\\ `}</span>
                里。点「还原」就搬回工作区、重新显示在左栏。
              </div>

              <div className="unbound-list">
                {projects.map((p) => (
                  <div className="unbound-row" key={p.id}>
                    <div className="ub-main">
                      <div className="ub-name">
                        <i className="cdot" style={{ background: p.color }} />
                        {p.name}
                        <span className="ub-folder">{p.folder_name}</span>
                      </div>
                      <div className="ub-sub">
                        {p.packCount} 个包 · {p.fileCount} 个文件 · {fmtSize(p.totalSize)}
                      </div>
                    </div>
                    <button
                      className="btn"
                      disabled={busyId !== null}
                      onClick={() => void restore(p)}
                    >
                      {busyId === p.id ? '还原中…' : '还原'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {err && (
            <div className="hint" style={{ color: 'var(--danger)', marginTop: 10 }}>
              {err}
            </div>
          )}
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
