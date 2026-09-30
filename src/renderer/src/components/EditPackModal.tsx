import { COPY, fmt } from '../../../shared/copy'
import { useState } from 'react'
import type { PackCard, ProjectWithCount, UpdatePackPatch } from '../types'
import { Icon } from './Icon'

/**
 * 第 7 批 ②③：编辑包信息（名称 / 类别 / 所属项目）。
 *
 * 三件事都能改，但**只有两件会动磁盘**：
 *   · 改名称 → 包文件夹跟着改名（与项目改名一个规矩："软件里看到什么，硬盘上就是什么"）
 *   · 改项目 → 包文件夹搬到目标项目文件夹下；选「不指定项目」就是搬回工作区根 = 「待归类」
 *   · 只改类别 → 纯数据，不碰磁盘
 *
 * 待归类（没项目）的包打开这个弹窗时，默认帮用户预选第一个项目 —— 那是"归位"的主场景。
 */
export function EditPackModal({
  pack,
  projects,
  categories,
  onClose,
  onSubmit
}: {
  pack: PackCard
  projects: ProjectWithCount[]
  categories: string[]
  onClose: () => void
  onSubmit: (patch: UpdatePackPatch) => Promise<{ ok: boolean; error?: string }>
}): React.JSX.Element {
  const isLoose = pack.project_id === null
  const [name, setName] = useState(pack.name)
  const [category, setCategory] = useState(pack.category)
  const [projectId, setProjectId] = useState<number | null>(
    isLoose ? (projects[0]?.id ?? null) : pack.project_id
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const nameChanged = name.trim() !== pack.name
  const projectChanged = projectId !== pack.project_id
  const categoryChanged = category !== pack.category
  const willMove = nameChanged || projectChanged

  const targetProject = projects.find((p) => p.id === projectId) ?? null

  const submit = async (): Promise<void> => {
    if (busy) return
    if (!name.trim()) {
      setErr(COPY.packErr.nameEmpty)
      return
    }
    setBusy(true)
    setErr('')
    const r = await onSubmit({
      name: name.trim(),
      category,
      projectId
    })
    setBusy(false)
    if (!r.ok) setErr(r.error ?? COPY.editPack.saveFailed)
  }

  // 类别 chips 就是左栏标签维度「物料类别」那一套（App 派生后传进来）。
  // 当前类别不在清单里时把它补在第一格 —— 第 10 批起「删类别」会连带把包的类别改成「未分类」，
  // 正常不会再出现孤儿值；这一手是给老数据 / 手工改过库的情况留的逃生口。
  const chips = categories.includes(category) ? categories : [category, ...categories]

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          {isLoose ? (
            <>
              <Icon name="inbox" size={15} />  {COPY.editPack.titleLoose}
            </>
          ) : (
            <>
              <Icon name="edit" size={15} />  {COPY.editPack.title}
            </>
          )}
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
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') onClose()
              }}
            />
            {nameChanged && (
              <div className="hint" style={{ color: 'var(--accent)' }}>
                
                {COPY.editPack.nameHint}
              </div>
            )}
          </div>

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
              <option value="">{COPY.editPack.noProject}</option>
            </select>
            {isLoose && !projectChanged && (
              <div className="hint" style={{ color: 'var(--warn)' }}>
                
                {COPY.editPack.looseHint}
              </div>
            )}
            {projectChanged && (
              <div className="hint" style={{ color: 'var(--accent)' }}>
                {targetProject
                  ? fmt(COPY.editPack.moveInto, { name: targetProject.name })
                  : COPY.editPack.moveBack}
              </div>
            )}
          </div>

          <div className="field">
            <label>{COPY.dim.category}</label>
            <div className="chips">
              {chips.map((c) => (
                <button
                  key={c}
                  className={`chip${c === category ? ' on' : ''}`}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="hint">
              
              {COPY.editPack.categoryHint}
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
            
            {COPY.editPack.currentFolder}
            <br />
            <span className="path">{pack.folder_path}</span>
            <br />
            {willMove
              ? COPY.editPack.saveHintMove
              : categoryChanged
                ? COPY.editPack.saveHintCategory
                : COPY.editPack.noChange}
          </div>

          {err && (
            <div className="hint" style={{ color: 'var(--danger)', marginTop: 10 }}>
              {err}
            </div>
          )}
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose}>
            
            {COPY.common.cancel}
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? COPY.common.saving : COPY.common.save}
          </button>
        </div>
      </div>
    </div>
  )
}
