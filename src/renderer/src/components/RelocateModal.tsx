import { useState } from 'react'
import type { RelocateSuggestion } from '../types'

/**
 * 第 8 批 M8-03：批量重新定位。
 *
 * 场景：用户把整个文件夹（甚至整个项目目录）从资源管理器里挪到了别处，
 * 一批文件同时"丢失"。这时一条条点太痛苦 —— 选个目录批量配。
 *
 * 流程刻意分三步，**绝不静默改路径**（用户拍板）：
 *   ① 选一个目录
 *   ② 软件按 `rel_path` 逐级降级试匹配，把「哪条配到哪个文件 / 哪条没配上」全列出来
 *   ③ 用户勾选后才落库
 */
export function RelocateModal({
  onClose,
  onDone,
  toast
}: {
  onClose: () => void
  onDone: () => Promise<void> | void
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void
}): React.JSX.Element {
  const [dir, setDir] = useState('')
  const [items, setItems] = useState<RelocateSuggestion[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [scanned, setScanned] = useState(false)

  const pickDir = async (): Promise<void> => {
    if (busy) return
    const r = await window.api.pickRelocateDir()
    if (!r.ok || !r.dir) return
    setDir(r.dir)
    setBusy(true)
    const s = await window.api.relocateSuggest(r.dir)
    setBusy(false)
    setScanned(true)
    setItems(s.items)
    // 默认只勾上"真配上了"的：没配上的用户勾也改不了，别给错觉
    setPicked(new Set(s.items.filter((i) => i.ok && i.matchedPath).map((i) => i.assetId)))
  }

  const toggle = (id: number): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    if (busy) return
    const targets = items.flatMap((i) =>
      picked.has(i.assetId) && i.matchedPath
        ? [{ assetId: i.assetId, newAbsPath: i.matchedPath }]
        : []
    )
    if (!targets.length) {
      toast('一条都没勾上', 'err')
      return
    }
    setBusy(true)
    const r = await window.api.relocateApply(targets)
    setBusy(false)
    await onDone()
    if (r.errors.length) {
      toast(`找回 ${r.moved} 条，${r.errors.length} 条没成：${r.errors[0]}`, 'err')
    } else {
      toast(`找回 ${r.moved} 条文件`, 'ok')
    }
    onClose()
  }

  const okItems = items.filter((i) => i.ok)
  const badItems = items.filter((i) => !i.ok)
  const pickedCount = okItems.filter((i) => picked.has(i.assetId)).length

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal relocate">
        <div className="head">
          <h3>批量重新定位</h3>
          <button className="close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="content">
          <div className="field">
            <div className="hint">
              文件被整批挪走时用这个：选它们<b>现在所在的文件夹</b>，软件按原来的目录结构一层层试配。
              <b>你先看结果、勾选之后才会动记录。</b>
            </div>
            <button className="btn" onClick={pickDir} disabled={busy}>
              📁 选择文件夹
            </button>
            {dir && <div className="path">{dir}</div>}
          </div>

          {busy && <div className="hint">正在这个文件夹里找…</div>}

          {scanned && !busy && (
            <>
              <div className="hint" style={{ color: okItems.length ? 'var(--accent)' : 'var(--warn)' }}>
                配上 {okItems.length} 条
                {badItems.length > 0 ? `　·　没配上 ${badItems.length} 条` : ''}
              </div>
              {items.length === 0 && (
                <div className="hint">当前没有「文件已丢失」的素材，不需要重新定位。</div>
              )}
              <div className="relocate-list">
                {items.map((i) => (
                  <label key={i.assetId} className={`relocate-row${i.matchedPath ? '' : ' bad'}`}>
                    <input
                      type="checkbox"
                      checked={picked.has(i.assetId)}
                      disabled={!i.matchedPath}
                      onChange={() => toggle(i.assetId)}
                    />
                    <div className="rr-main">
                      <div className="rr-name">{i.fileName}</div>
                      <div className="rr-path" title={i.matchedPath ?? i.reason}>
                        {i.matchedPath ?? i.reason}
                      </div>
                    </div>
                    <span className="rr-tag">{i.matchedPath ? i.reason : '没配上'}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="foot">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button className="btn primary" onClick={apply} disabled={busy || pickedCount === 0}>
            找回勾选的 {pickedCount} 条
          </button>
        </div>
      </div>
    </div>
  )
}
