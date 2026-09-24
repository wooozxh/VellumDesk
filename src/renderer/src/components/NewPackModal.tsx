import { useState } from 'react'

/**
 * A-01 新建任务包弹窗。
 * 包名称不校验、不拦截，留空也允许创建（方案 2.2 / 6.0）——
 * 输入框里放灰色示例只作引导。
 */
export function NewPackModal({
  projects,
  categories,
  onClose,
  onSubmit
}: {
  projects: string[]
  categories: string[]
  onClose: () => void
  onSubmit: (v: { name: string; project: string; category: string }) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [project, setProject] = useState(projects[0] ?? '集团通用')
  const [category, setCategory] = useState(categories[0] ?? '海报')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onSubmit({ name, project, category })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          ＋ 新建任务包
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </h3>

        <div className="content">
          <div className="field">
            <label>包名称</label>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder="例：海南招生海报-2026秋季"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') onClose()
              }}
            />
            <div className="hint">留空也可以，软件会自动取名</div>
          </div>

          <div className="field">
            <label>所属项目</label>
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>物料类别</label>
            <div className="chips">
              {categories.map((c) => (
                <button
                  key={c}
                  className={`chip${c === category ? ' on' : ''}`}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              fontSize: 12,
              color: 'var(--text-3)',
              borderTop: '1px solid var(--line)',
              paddingTop: 12,
              lineHeight: 1.9
            }}
          >
            创建后软件会在素材工作区自动建好这个包的文件夹，并带上三个子文件夹：
            <br />
            <span className="path">01-成品　02-素材　03-工程</span>
            <br />
            之后把文件丢进对应的子文件夹就行，软件会自动归位。
          </div>
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
