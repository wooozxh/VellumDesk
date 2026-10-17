/**
 * 第 68 批（docs/50 §6）：**任务的批量设置**（项目 / 类别 / 场景 / 分级）。
 *
 * 四个字段都是"只有选了才改"—— 留「（不改）」的保持原样。
 * 这比"复制第一个任务的值到全部"安全：批量操作最怕的就是把不想动的字段一起覆盖了。
 *
 * 「项目」多两个特殊项：`（不改）` 与 `待归类`（`projectId = null`，文件夹搬回工作区根目录）。
 */
import { useState } from 'react'
import { COPY } from '../../../shared/copy'

export interface BulkPackPatch {
  projectId?: number | null
  category?: string
  channel?: string
  grade?: string
}

/** 下拉里的哨兵值：`__keep` = 不改；`__none` = 待归类（projectId = null） */
const KEEP = '__keep'
const NONE = '__none'

export function BulkPackSettingsModal({
  projects,
  categories,
  channels,
  grades,
  busy,
  onApply,
  onClose
}: {
  projects: Array<{ id: number; name: string }>
  categories: string[]
  channels: string[]
  grades: string[]
  busy?: boolean
  onApply: (patch: BulkPackPatch) => void
  onClose: () => void
}): React.JSX.Element {
  const [proj, setProj] = useState<string>(KEEP)
  const [cat, setCat] = useState<string>('')
  const [cha, setCha] = useState<string>('')
  const [gra, setGra] = useState<string>('')

  const build = (): BulkPackPatch => {
    const patch: BulkPackPatch = {}
    if (proj === NONE) patch.projectId = null
    else if (proj !== KEEP) patch.projectId = Number(proj)
    if (cat) patch.category = cat
    if (cha) patch.channel = cha
    if (gra) patch.grade = gra
    return patch
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{COPY.common.bulkSettingsTitle}</h3>
        <div className="content">
          <div className="set-form">
            <label>
              <span className="lb">{COPY.common.colProject}</span>
              <select className="tk-input" value={proj} onChange={(e) => setProj(e.target.value)}>
                <option value={KEEP}>{COPY.common.keepUnchanged}</option>
                <option value={NONE}>{COPY.side.loose}</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="lb">{COPY.dim.category}</span>
              <select className="tk-input" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">{COPY.common.keepUnchanged}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="lb">{COPY.dim.channel}</span>
              <select className="tk-input" value={cha} onChange={(e) => setCha(e.target.value)}>
                <option value="">{COPY.common.keepUnchanged}</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="lb">{COPY.dim.grade}</span>
              <select className="tk-input" value={gra} onChange={(e) => setGra(e.target.value)}>
                <option value="">{COPY.common.keepUnchanged}</option>
                {grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mv-hint">{COPY.common.bulkSettingsHint}</div>
          <div className="tk-actions">
            <button className="btn primary" disabled={busy} onClick={() => onApply(build())}>
              {busy ? COPY.common.bulkWorking : COPY.common.settingsApply}
            </button>
            <button className="btn" onClick={onClose} disabled={busy}>
              {COPY.common.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
