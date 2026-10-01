import { COPY } from '../../../shared/copy'
import { useState } from 'react'
import type { Project } from '../types'
import { Icon } from './Icon'

/**
 * 备注快填候选（第 14 批）：跟着预制项目的备注风格走 —— 换预制项目时这里不用再单独维护，
 * 但仍是**候选**而不是强制值，用户想写别的照样能写。
 */
const PRESET_NOTES = [
  COPY.seed.projCampNote,
  COPY.seed.projPrepNote,
  COPY.seed.projFillNote,
  COPY.seed.projOneNote,
  COPY.seed.projIslandNote,
  COPY.seed.projHqNote
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
      setErr(COPY.projErr.nameEmpty)
      return
    }
    setBusy(true)
    const r = await onSubmit({ name: name.trim(), color, note: note.trim() })
    setBusy(false)
    if (!r.ok) setErr(r.error ?? COPY.projModal.failed)
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          {isEdit ? (
            <>
              <Icon name="edit" size={15} />  {COPY.projModal.titleEdit}
            </>
          ) : (
            <>
              <Icon name="plus" size={15} strokeWidth={2} />  {COPY.side.newProjectTip}
            </>
          )}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="content">
          <div className="field">
            <label>
              
              {COPY.projModal.nameLabel} <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              autoFocus
              placeholder={COPY.projModal.namePlaceholder}
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
            ) : isEdit ? (
              <div className="hint">
                
                {COPY.projModal.renameHint}
              </div>
            ) : (
              <div className="hint">{COPY.projModal.createHint}</div>
            )}
          </div>

          <div className="field">
            <label>{COPY.projModal.colorLabel}</label>
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
              
              {COPY.projModal.colorHint}
            </div>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>{COPY.projModal.noteLabel}</label>
            <input
              type="text"
              value={note}
              placeholder={COPY.projModal.notePlaceholder}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') onClose()
              }}
            />
            {!note && (
              <div className="hint">
                
                {COPY.projModal.notePresets}
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
            
            {COPY.common.cancel}
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? COPY.common.saving : isEdit ? COPY.common.save : COPY.common.create}
          </button>
        </div>
      </div>
    </div>
  )
}
