import { useState } from 'react'
import type { ProjectWithCount } from '../types'

/**
 * A-01 新建任务包弹窗。
 * 包名称不校验、不拦截，留空也允许创建（方案 2.2 / 6.0）——
 * 输入框里放灰色示例只作引导。
 * 项目列表来自数据库（用户可自己新建项目）；如需新项目请到左栏「＋ 新建项目」。
 *
 * 第 10 批（2026-09-30 用户实测反馈）：**物料类别清单只有一套** ——
 * 由 App 从标签维度「物料类别」派生后传进来（`categories`），不再用写死的常量。
 * 用户改了这个清单，这里当场就变。类别全被删光时也能建包（记「未分类」，
 * 以后在包详情里随时改），只是界面上把话说明白，不让人以为软件坏了。
 */
export function NewPackModal({
  projects,
  categories,
  onClose,
  onSubmit
}: {
  projects: ProjectWithCount[]
  categories: string[]
  onClose: () => void
  onSubmit: (v: {
    name: string
    projectId: number | null
    category: string
  }) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null)
  const [category, setCategory] = useState(categories[0] ?? '未分类')
  const [busy, setBusy] = useState(false)

  // 清单可能比弹窗后到，也可能刚被左栏改过：选中的那个不在清单里就顺延到第一个，
  // 一个都没有就记「未分类」（跟后端 `UNCATEGORIZED` 同一个值）
  const picked = categories.includes(category) ? category : (categories[0] ?? '未分类')

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onSubmit({ name, projectId, category: picked })
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
            <select
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="hint">
              项目在左栏「所属项目 → ＋ 新建项目」里维护（可自己新增）
            </div>
          </div>

          <div className="field">
            <label>物料类别</label>
            {categories.length === 0 ? (
              <div className="hint" style={{ color: 'var(--warn)' }}>
                左栏「物料类别」里还没有标签 —— 去左栏那个维度的「管理」里加一个，这里马上就能选。
                现在建包先记成「未分类」，以后在包详情里随时能改。
              </div>
            ) : (
              <div className="chips">
                {categories.map((c) => (
                  <button
                    key={c}
                    className={`chip${c === picked ? ' on' : ''}`}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="hint">
              跟左栏筛选里的「物料类别」是同一套清单（左栏「管理」里增删，这里跟着变）
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
            创建后软件会在素材工作区自动建好这个包的文件夹，并<b>自带第 1 稿 V1</b>：
            <br />
            <span className="path">包名\V1\01-成品　02-素材　03-工程</span>
            <br />
            V1 自动成为当前版本，之后把文件丢进对应的子文件夹就行，软件会自动归位。
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
