import { useState } from 'react'
import type { Project } from '../types'

const PRESET_NOTES = [
  '教育咨询 + 异地升学办理',
  '外回初三考生集训提分',
  '不属于具体业务的通用素材'
]

/**
 * 新建 / 编辑项目弹窗。
 * 「新建」：名称必填、颜色自选（默认预选一个）、备注可选。
 * 「编辑」：三个字段都能改。
 */
export function ProjectModal({
  editing,
  colors,
  onClose,
  onSubmit
}: {
  /** 传了就是编辑模式，不传是新建 */
  editing?: Project | null
  colors: string[]
  onClose: () => void
  onSubmit: (v: {
    name: string
    color: string
    note: string
  }) => Promise<{ ok: boolean; error?: string }>
}): React.JSX.Element {
  const isEdit = !!editing
  const [name, setName] = useState(editing?.name ?? '')
  const [color, setColor] = useState(editing?.color ?? colors[0] ?? '#4f8cff')
  const [note, setNote] = useState(editing?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (): Promise<void> => {
    if (busy) return
    if (!name.trim()) {
      setErr('项目名称不能为空')
      return
    }
    setBusy(true)
    const r = await onSubmit({ name: name.trim(), color, note: note.trim() })
    setBusy(false)
    if (!r.ok) setErr(r.error ?? '操作失败')
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          {isEdit ? '✎ 编辑项目' : '＋ 新建项目'}
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </h3>

        <div className="content">
          <div className="field">
            <label>
              项目名称 <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder="例：抖音短视频运营"
              onChange={(e) => {
                setName(e.target.value)
                setErr('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') onClose()
              }}
            />
            {err ? (
              <div className="hint" style={{ color: 'var(--danger)' }}>
                {err}
              </div>
            ) : (
              <div className="hint">公司开了新业务、内部孵化了新项目，就在这里加一个</div>
            )}
          </div>

          <div className="field">
            <label>标签颜色</label>
            <div className="swatches">
              {colors.map((c) => (
                <button
                  key={c}
                  className={`swatch${c === color ? ' on' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
            <div className="hint">
              包卡片和左栏的项目标签用这个色，一排包摆出来能一眼看出哪些同属一个项目
            </div>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>备注（可选）</label>
            <input
              type="text"
              value={note}
              placeholder="这个项目是干什么的"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') onClose()
              }}
            />
            {!note && (
              <div className="hint">
                参考：
                {PRESET_NOTES.map((n, i) => (
                  <button
                    key={n}
                    className="linky"
                    onClick={() => setNote(n)}
                    style={{ marginLeft: i ? 8 : 4 }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? '保存中…' : isEdit ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
