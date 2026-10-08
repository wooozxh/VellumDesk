import { COPY } from '../../../shared/copy'
import { Rich } from './Rich'
import { useState } from 'react'
import type { ProjectWithCount } from '../types'
import { Icon } from './Icon'

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
  channels,
  grades,
  onClose,
  onSubmit
}: {
  projects: ProjectWithCount[]
  categories: string[]
  /** 第 23 批（docs/29）：使用场景清单（同样派生自左栏标签维度） */
  channels: string[]
  /** 第 49 批（docs/34）：物料分级清单（同样派生自左栏标签维度） */
  grades: string[]
  onClose: () => void
  onSubmit: (v: {
    name: string
    projectId: number | null
    category: string
    channel: string
    grade: string
  }) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null)
  const [category, setCategory] = useState(categories[0] ?? '未分类')
  const [channel, setChannel] = useState(channels[0] ?? '未分类')
  // 第 49 批（docs/34）：分级的兜底值是「未分级」而不是「未分类」（docs/34 §3.2）
  const [grade, setGrade] = useState(grades[0] ?? COPY.ungraded)
  const [busy, setBusy] = useState(false)

  // 清单可能比弹窗后到，也可能刚被左栏改过：选中的那个不在清单里就顺延到第一个，
  // 一个都没有就记「未分类」（跟后端 `UNCATEGORIZED` 同一个值）
  const picked = categories.includes(category) ? category : (categories[0] ?? '未分类')
  const pickedChannel = channels.includes(channel) ? channel : (channels[0] ?? '未分类')
  const pickedGrade = grades.includes(grade) ? grade : (grades[0] ?? COPY.ungraded)

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onSubmit({ name, projectId, category: picked, channel: pickedChannel, grade: pickedGrade })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          <Icon name="plus" size={15} strokeWidth={2} />  {COPY.top.newPack}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="content">
          <div className="field">
            <label>{COPY.editPack.nameLabel}</label>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder={COPY.newPack.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') onClose()
              }}
            />
            <div className="hint">{COPY.newPack.nameHint}</div>
          </div>

          {/* 第 49 批（docs/34 §5.2，用户指定）：**所属项目与物料分级并排**，
              与下面「物料类别 / 使用场景」一起组成 2×2 的下拉矩阵。
              项目那条静态说明移到行下整行（半列太窄会换行）。*/}
          <div className="field-row">
            <div className="field">
              <label>{COPY.editPack.projectLabel}</label>
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
            </div>

            <div className="field">
              <label>{COPY.dim.grade}</label>
              {grades.length === 0 ? (
                <div className="hint" style={{ color: 'var(--warn)' }}>
                  {COPY.newPack.noGrade}
                </div>
              ) : (
                <select value={pickedGrade} onChange={(e) => setGrade(e.target.value)}>
                  {grades.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* 项目的静态说明，整行显示（见上方注释） */}
          <div className="hint" style={{ marginTop: -4 }}>
            {COPY.newPack.projectHint}
          </div>

          {/* 第 24 批（用户反馈）：物料类别 / 使用场景两个下拉左右并排，下面的说明文字去掉
              （标签越加越多时弹窗更紧凑）。保留「清单为空」的警示 —— 那是状态提示不是说明。 */}
          <div className="field-row">
            <div className="field">
              <label>{COPY.dim.category}</label>
              {categories.length === 0 ? (
                <div className="hint" style={{ color: 'var(--warn)' }}>
                  {COPY.newPack.noCategory}
                </div>
              ) : (
                // 第 23 批（docs/29）：平铺 chips 改成下拉 —— 标签越加越多时弹窗不会被撑臃肿
                <select value={picked} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="field">
              <label>{COPY.dim.channel}</label>
              {channels.length === 0 ? (
                <div className="hint" style={{ color: 'var(--warn)' }}>
                  {COPY.newPack.noChannel}
                </div>
              ) : (
                <select value={pickedChannel} onChange={(e) => setChannel(e.target.value)}>
                  {channels.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
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
            <Rich tpl={COPY.newPack.folderHint} />
            <br />
            <Rich tpl={COPY.newPack.folderPath} />
            <br />
            
            {COPY.newPack.folderHint2}
          </div>
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose}>
            
            {COPY.common.cancel}
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? COPY.newPack.creating : COPY.common.create}
          </button>
        </div>
      </div>
    </div>
  )
}
