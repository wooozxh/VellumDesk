import { COPY, fmt } from '../../../shared/copy'
import { Icon } from './Icon'
import { Rich } from './Rich'
import { useEffect, useMemo, useState } from 'react'
import type { AssetItem, PackDetail, PackExportInput } from '../types'
import { fmtSize } from './FileRow'

const ROLE_ORDER = ['成品', '素材', '工程', '未归属'] as const

interface PackExportModalProps {
  detail: PackDetail
  onClose: () => void
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void
}

export function PackExportModal({ detail, onClose, toast }: PackExportModalProps): React.JSX.Element {
  const pack = detail.pack
  const versions = detail.versions
  const hasVersions = versions.length > 0

  // 版本选择
  const [versionMode, setVersionMode] = useState<PackExportInput['versionMode']>('current')
  const [specificVersionId, setSpecificVersionId] = useState<number | null>(null)

  // 分组选择：默认成品/素材/工程全勾，未归属不勾
  const [roleSel, setRoleSel] = useState<Record<string, boolean>>({
    成品: true,
    素材: true,
    工程: true,
    未归属: false
  })

  // 文件选择：默认全勾；用户取消的记在这里
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())

  // 输出设置
  const [outputDir, setOutputDir] = useState(pack.folder_path)
  const [zipName, setZipName] = useState('')
  const [size, setSize] = useState('')
  const [keepOriginalName, setKeepOriginalName] = useState(true)
  const [customTemplate, setCustomTemplate] = useState('')
  const [wrapFolder, setWrapFolder] = useState(true)

  // 状态
  const [busy, setBusy] = useState(false)

  // 首次打开：尝试自动读尺寸
  useEffect(() => {
    let canceled = false
    const autoSize = async (): Promise<void> => {
      try {
        const firstDone = (detail.groups['成品'] ?? []).find(
          (i) => !i.missing_at && (i.width || i.height)
        )
        if (firstDone?.width && firstDone?.height) {
          if (!canceled) setSize(`${firstDone.width}x${firstDone.height}`)
        }
      } catch {
        /* ignore */
      }
    }
    autoSize()
    return () => {
      canceled = true
    }
  }, [detail])

  // 当前版本
  const currentVersion = useMemo(
    () => versions.find((v) => v.is_current === 1),
    [versions]
  )

  // 根据版本选择过滤文件
  const filteredAssets = useMemo(() => {
    const out: Record<string, AssetItem[]> = {}
    for (const role of ROLE_ORDER) {
      out[role] = (detail.groups[role] ?? []).filter((i) => {
        if (i.missing_at) return false
        if (role === '未归属') return i.version_id === null
        if (versionMode === 'all') return true
        if (versionMode === 'specific') return i.version_id === specificVersionId
        return i.version_id === currentVersion?.id
      })
    }
    return out
  }, [detail, versionMode, specificVersionId, currentVersion])

  // 实际会打包的文件
  const selectedEntries = useMemo(() => {
    const out: AssetItem[] = []
    for (const role of ROLE_ORDER) {
      if (!roleSel[role]) continue
      for (const item of filteredAssets[role]) {
        if (!excludedIds.has(item.id)) out.push(item)
      }
    }
    return out
  }, [filteredAssets, roleSel, excludedIds])

  const totalSize = useMemo(
    () => selectedEntries.reduce((s, i) => s + i.size, 0),
    [selectedEntries]
  )

  // 默认 zip 名（用户没改时按规则生成）
  useEffect(() => {
    if (zipName) return
    const parts: string[] = []
    if (pack.projectName) parts.push(pack.projectName)
    parts.push(pack.name)
    parts.push(size.trim() || COPY.exportPack.unknownSize)
    parts.push(todayYmd())
    if (versionMode === 'all') parts.push('全版本')
    else if (versionMode === 'specific' && specificVersionId) {
      const v = versions.find((x) => x.id === specificVersionId)
      if (v) parts.push(`V${v.seq}`)
    } else if (currentVersion) parts.push(`V${currentVersion.seq}`)
    else parts.push(COPY.exportPack.versionUnassigned)
    setZipName(parts.join('-').replace(/[<>:"\\/|?*\x00-\x1f]/g, '_'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.projectName, pack.name, size, versionMode, specificVersionId, currentVersion, versions])

  const toggleRole = (role: string): void => {
    setRoleSel((prev) => ({ ...prev, [role]: !prev[role] }))
  }

  const toggleFile = (id: number): void => {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const pickDir = async (): Promise<void> => {
    const r = await window.api.pickOutputDir(outputDir)
    if (r.ok && r.dir) setOutputDir(r.dir)
  }

  const doExport = async (): Promise<void> => {
    if (selectedEntries.length === 0) {
      toast(COPY.exportPack.noSelection, 'err')
      return
    }
    setBusy(true)
    const input: PackExportInput = {
      packId: pack.id,
      versionMode,
      specificVersionId,
      roles: ROLE_ORDER.filter((r) => roleSel[r]),
      excludedAssetIds: Array.from(excludedIds),
      outputDir,
      zipName,
      wrapFolder,
      size,
      keepOriginalName,
      customNameTemplate: customTemplate.trim()
    }
    const res = await window.api.packExport(input)
    setBusy(false)
    if (res.ok && res.outputPath) {
      toast(fmt(COPY.exportPack.done, { path: res.outputPath }), 'ok')
      onClose()
    } else {
      toast(COPY.exportPack.failed + (res.error ?? ''), 'err')
    }
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide pack-export-modal">
        <h3>
          <Icon name="package" size={15} /> {fmt(COPY.exportPack.title, { name: pack.name })}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="content">
          {/* 版本选择 */}
          <section className="ep-section">
            <label>{COPY.exportPack.versionLabel}</label>
            <div className="ep-options">
              {hasVersions && (
                <label className="ep-radio">
                  <input
                    type="radio"
                    checked={versionMode === 'current'}
                    onChange={() => setVersionMode('current')}
                  />
                  {currentVersion
                    ? fmt(COPY.exportPack.versionCurrent, { n: currentVersion.seq })
                    : COPY.exportPack.versionUnassigned}
                </label>
              )}
              {hasVersions && (
                <label className="ep-radio">
                  <input
                    type="radio"
                    checked={versionMode === 'specific'}
                    onChange={() => setVersionMode('specific')}
                  />
                  {COPY.exportPack.versionSpecific}
                  {versionMode === 'specific' && (
                    <select
                      value={specificVersionId ?? ''}
                      onChange={(e) => setSpecificVersionId(Number(e.target.value) || null)}
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          V{v.seq}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              )}
              {hasVersions && (
                <label className="ep-radio">
                  <input
                    type="radio"
                    checked={versionMode === 'all'}
                    onChange={() => setVersionMode('all')}
                  />
                  {COPY.exportPack.versionAll}
                </label>
              )}
              {!hasVersions && (
                <span className="ep-muted">{COPY.exportPack.versionUnassigned}</span>
              )}
            </div>
          </section>

          {/* 分组选择 */}
          <section className="ep-section">
            <label>{COPY.exportPack.groupsLabel}</label>
            <div className="ep-checks">
              {ROLE_ORDER.map((role) => {
                const label =
                  role === '成品'
                    ? COPY.exportPack.groupDone
                    : role === '素材'
                      ? COPY.exportPack.groupMaterial
                      : role === '工程'
                        ? COPY.exportPack.groupProject
                        : COPY.exportPack.groupUnassigned
                const count = filteredAssets[role]?.length ?? 0
                return (
                  <label key={role} className="ep-check" title={`${count} 个文件`}>
                    <input
                      type="checkbox"
                      checked={!!roleSel[role]}
                      onChange={() => toggleRole(role)}
                      disabled={count === 0}
                    />
                    {label} ({count})
                  </label>
                )
              })}
            </div>
          </section>

          {/* 文件明细 */}
          <section className="ep-section">
            <label>{COPY.exportPack.filesLabel}</label>
            <div className="ep-files">
              {selectedEntries.length === 0 && (
                <div className="ep-empty">{COPY.exportPack.emptyFiles}</div>
              )}
              {ROLE_ORDER.map((role) => {
                const items = filteredAssets[role] ?? []
                if (items.length === 0 || !roleSel[role]) return null
                const label =
                  role === '成品'
                    ? COPY.exportPack.groupDone
                    : role === '素材'
                      ? COPY.exportPack.groupMaterial
                      : role === '工程'
                        ? COPY.exportPack.groupProject
                        : COPY.exportPack.groupUnassigned
                const allChecked = items.every((i) => !excludedIds.has(i.id))
                return (
                  <div key={role} className="ep-file-group">
                    <h5>
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => {
                          setExcludedIds((prev) => {
                            const next = new Set(prev)
                            if (allChecked) items.forEach((i) => next.add(i.id))
                            else items.forEach((i) => next.delete(i.id))
                            return next
                          })
                        }}
                      />
                      {label}（{items.length}）
                    </h5>
                    {items.map((item) => (
                      <label key={item.id} className="ep-file-row">
                        <input
                          type="checkbox"
                          checked={!excludedIds.has(item.id)}
                          onChange={() => toggleFile(item.id)}
                        />
                        <span className="ep-file-name">{item.file_name}</span>
                        <span className="ep-file-size">{fmtSize(item.size)}</span>
                        {item.width && item.height && (
                          <span className="ep-file-dim">{item.width}x{item.height}</span>
                        )}
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>

          {/* 输出设置 */}
          <section className="ep-section ep-output">
            <label>{COPY.exportPack.outputDirLabel}</label>
            <div className="ep-row">
              <input type="text" value={outputDir} readOnly className="ep-path" />
              <button className="btn" onClick={pickDir} disabled={busy}>
                {COPY.exportPack.outputDirPick}
              </button>
            </div>

            <label>{COPY.exportPack.zipNameLabel}</label>
            <input
              type="text"
              value={zipName}
              onChange={(e) => setZipName(e.target.value)}
              disabled={busy}
            />

            <label>{COPY.exportPack.sizeLabel}</label>
            <input
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder={COPY.exportPack.sizeHint}
              disabled={busy}
            />

            <label className="ep-check">
              <input
                type="checkbox"
                checked={keepOriginalName}
                onChange={(e) => setKeepOriginalName(e.target.checked)}
                disabled={busy}
              />
              {COPY.exportPack.keepOriginalName}
            </label>

            <label>{COPY.exportPack.customNameLabel}</label>
            <input
              type="text"
              value={customTemplate}
              onChange={(e) => setCustomTemplate(e.target.value)}
              placeholder={COPY.exportPack.customNameHint}
              disabled={busy}
            />

            <label className="ep-check">
              <input
                type="checkbox"
                checked={wrapFolder}
                onChange={(e) => setWrapFolder(e.target.checked)}
                disabled={busy}
              />
              {COPY.exportPack.wrapFolderLabel}
            </label>
          </section>

          {/* 底部摘要 */}
          <div className="ep-summary">
            <Rich
              tpl={COPY.exportPack.summary}
              v={{
                n: selectedEntries.length,
                size: fmtSize(totalSize),
                path: outputDir
              }}
            />
          </div>
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            {COPY.common.cancel}
          </button>
          <button
            className="btn primary"
            onClick={doExport}
            disabled={busy || selectedEntries.length === 0}
          >
            {busy ? COPY.exportPack.packing : COPY.exportPack.start}
          </button>
        </div>
      </div>
    </div>
  )
}

function todayYmd(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}
