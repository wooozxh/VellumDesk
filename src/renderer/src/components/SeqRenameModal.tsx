/**
 * 第 68 批（docs/50 §6）：**按序号批量改名**（通用库 / 模板库共用）。
 *
 * 模板库收模板的主场景：一次导入十几份「未命名-1.psd」，改成 `易拉宝-01.psd …` 才好找。
 *
 * 只管三件事：**前缀 / 起始序号 / 位数**，实时给出「效果」，不用点下去才知道长什么样。
 * 真正的改名在主进程做（**两阶段 rename**，防"名字互换"时互相覆盖，见 `renameBrandAssetsSeq` 注释）。
 */
import { useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'

export function SeqRenameModal({
  /** 选中条数（只用来提示，不影响逻辑） */
  count,
  /** 默认前缀（调用方给个合理值：当前分组名 / 「素材」/「模板」） */
  defaultPrefix,
  /** 选中第一条的扩展名（带点，如 `.psd`），用于预览 */
  ext,
  busy,
  onApply,
  onClose
}: {
  count: number
  defaultPrefix: string
  ext: string
  busy?: boolean
  onApply: (input: { prefix: string; start: number; pad: number }) => void
  onClose: () => void
}): React.JSX.Element {
  const [prefix, setPrefix] = useState(defaultPrefix)
  const [start, setStart] = useState(1)
  const [pad, setPad] = useState(2)

  const sample = `${prefix.trim() || '素材'}-${String(start).padStart(pad, '0')}${ext || ''}`

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{COPY.common.renameTitle}</h3>
        <div className="content">
          <div className="rename-form">
            <label>
              <span className="lb">{COPY.common.renamePrefix}</span>
              <input
                className="tk-input"
                autoFocus
                value={prefix}
                placeholder={COPY.common.renamePrefixPh}
                onChange={(e) => setPrefix(e.target.value)}
              />
            </label>
            <label>
              <span className="lb">{COPY.common.renameStart}</span>
              <input
                className="tk-input"
                type="number"
                min={0}
                max={9999}
                value={start}
                onChange={(e) => setStart(Math.max(0, Math.min(9999, Number(e.target.value) || 0)))}
              />
            </label>
            <label>
              <span className="lb">{COPY.common.renamePad}</span>
              <select
                className="tk-input"
                value={pad}
                onChange={(e) => setPad(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/* 实时预览：改名最怕"点下去才发现格式不对"，所以格式化和真实改名用同一套规则 */}
          <div className="rename-preview">{fmt(COPY.common.renamePreview, { sample })}</div>
          <div className="mv-hint">
            {count} 个文件 · {COPY.common.bulkRenameTip}
          </div>
          <div className="tk-actions">
            <button
              className="btn primary"
              disabled={busy || !prefix.trim()}
              onClick={() => onApply({ prefix: prefix.trim(), start, pad })}
            >
              {busy ? COPY.common.bulkWorking : COPY.common.renameApply}
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
