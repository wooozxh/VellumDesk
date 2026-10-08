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
  channels,
  onClose,
  onSubmit
}: {
  pack: PackCard
  projects: ProjectWithCount[]
  categories: string[]
  /** 第 23 批（docs/29）：使用场景清单（同样派生自左栏标签维度） */
  channels: string[]
  onClose: () => void
  onSubmit: (patch: UpdatePackPatch) => Promise<{ ok: boolean; error?: string }>
}): React.JSX.Element {
  const isLoose = pack.project_id === null
  const [name, setName] = useState(pack.name)
  const [category, setCategory] = useState(pack.category)
  const [channel, setChannel] = useState(pack.channel)
  const [projectId, setProjectId] = useState<number | null>(
    isLoose ? (projects[0]?.id ?? null) : pack.project_id
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // 第 47 批（docs/33 §5.3）：扫描临时文件开关（纯数据，不碰磁盘）
  const [scanTemp, setScanTemp] = useState(pack.scan_temp === 1)

  const nameChanged = name.trim() !== pack.name
  const projectChanged = projectId !== pack.project_id
  const categoryChanged = category !== pack.category
  const channelChanged = channel !== pack.channel
  const scanTempChanged = scanTemp !== (pack.scan_temp === 1)
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
      channel,
      projectId,
      scanTemp
    })
    setBusy(false)
    if (!r.ok) setErr(r.error ?? COPY.editPack.saveFailed)
  }

  // 类别 / 场景下拉的清单就是左栏标签维度那一套（App 派生后传进来）。
  // 当前值不在清单里时把它补在第一格 —— 第 10 批起「删标签」会连带把包的类别改成「未分类」，
  // 正常不会再出现孤儿值；这一手是给老数据 / 手工改过库的情况留的逃生口。
  const categoryList = categories.includes(category) ? categories : [category, ...categories]
  const channelList = channels.includes(channel) ? channels : [channel, ...channels]

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

          {/* 第 24 批（用户反馈）：物料类别 / 使用场景两个下拉左右并排，下面的说明文字去掉 */}
          <div className="field-row">
            <div className="field">
              <label>{COPY.dim.category}</label>
              {/* 第 23 批（docs/29）：平铺 chips 改成下拉 —— 标签越加越多时弹窗不会被撑臃肿 */}
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categoryList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>{COPY.dim.channel}</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {channelList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 第 47 批（docs/33 §5.3）：临时文件扫描开关 —— 默认不扫描 */}
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={scanTemp}
                onChange={(e) => setScanTemp(e.target.checked)}
              />
              {COPY.editPack.scanTempLabel}
            </label>
            <div className="hint">{COPY.editPack.scanTempHint}</div>
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
              : categoryChanged || channelChanged || scanTempChanged
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
