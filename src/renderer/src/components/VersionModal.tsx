import { COPY, fmt } from '../../../shared/copy'
import { Rich } from './Rich'
import { useEffect, useState } from 'react'
import type { BindableFolder, PackVersion } from '../types'
import { Icon } from './Icon'

/**
 * 第 9 批（M6）：**新建一稿** / **绑定已有文件夹**。
 *
 * 一个组件两副面孔 —— 这两件事的入口挨在一起（版本条右侧），
 * 分两个弹窗反而让人不知道该点哪个：软件建用第一个，自己建好了用第二个。
 */
export function VersionModal({
  mode,
  packId,
  versions,
  unassignedCount,
  onClose,
  onDone,
  toast
}: {
  mode: 'create' | 'bind'
  packId: number
  versions: PackVersion[]
  /** create 模式：包里有多少"未分版本"的文件可以被收编 */
  unassignedCount: number
  onClose: () => void
  onDone: (msg: string) => void
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void
}): React.JSX.Element {
  const nextSeq = versions.length ? Math.max(...versions.map((v) => v.seq)) + 1 : 1
  const prev = versions.length ? [...versions].sort((a, b) => b.seq - a.seq)[0] : null

  const [note, setNote] = useState('')
  // 包里还没有任何稿、而且三组里确实有文件 → 默认勾上"收编"（多数人的第一次建版本就是这个意思）
  const [takeExisting, setTakeExisting] = useState(versions.length === 0 && unassignedCount > 0)
  const [copyPrev, setCopyPrev] = useState(false)
  const [busy, setBusy] = useState(false)

  // ---- 绑定模式 ----
  const [folders, setFolders] = useState<BindableFolder[] | null>(null)
  const [picked, setPicked] = useState('')
  const [seq, setSeq] = useState(nextSeq)

  useEffect(() => {
    if (mode !== 'bind') return
    void window.api.listBindableFolders(packId).then((list) => {
      setFolders(list)
      if (list.length) {
        setPicked(list[0].folderName)
        setSeq(list[0].suggestedSeq)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, packId])

  const doCreate = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const res = await window.api.createVersion({
      packId,
      note: note.trim(),
      takeExisting,
      copyFromVersionId: copyPrev && prev ? prev.id : undefined
    })
    setBusy(false)
    if (!res.ok) {
      toast(res.error ?? COPY.verModal.newFailed, 'err')
      return
    }
    const bits: string[] = []
    if (res.moved) bits.push(fmt(COPY.verModal.collected, { n: res.moved }))
    if (copyPrev && prev) bits.push(fmt(COPY.verModal.copied, { n: prev.seq }))
    onDone(
      fmt(COPY.verModal.created, { seq: res.version?.seq ?? nextSeq }) +
        (bits.length ? '，' + bits.join('、') : '')
    )
  }

  const doBind = async (): Promise<void> => {
    if (busy || !picked) return
    setBusy(true)
    const res = await window.api.bindVersion({
      packId,
      folderName: picked,
      seq,
      note: note.trim()
    })
    setBusy(false)
    if (!res.ok) {
      toast(res.error ?? COPY.verModal.bindFailed, 'err')
      return
    }
    onDone(fmt(COPY.verModal.bound, { name: picked, seq: res.version?.seq ?? seq }))
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal version-modal">
        <h3>
          {mode === 'create' ? (
            <>
              <Icon name="plus" size={15} strokeWidth={2} /> <Rich tpl={COPY.verModal.titleNew} v={{ n: nextSeq }} />
            </>
          ) : (
            <>
              <Icon name="clip" size={15} />  {COPY.verModal.titleBind}
            </>
          )}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="content">
          {mode === 'create' ? (
            <>
              <div className="hint-box">
                <Rich tpl={COPY.verModal.newHint} v={{ n: nextSeq }} />
              </div>

              <label className="fld">
                <span>{COPY.verModal.noteLabel}</span>
                <input
                  value={note}
                  placeholder={COPY.verModal.notePlaceholder}
                  onChange={(e) => setNote(e.target.value)}
                  autoFocus
                />
              </label>

              {versions.length === 0 && unassignedCount > 0 && (
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={takeExisting}
                    onChange={(e) => setTakeExisting(e.target.checked)}
                  />
                  <span>
                    <Rich tpl={COPY.verModal.collectHint} v={{ n: unassignedCount }} />
                  </span>
                </label>
              )}

              {prev && (
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={copyPrev}
                    onChange={(e) => setCopyPrev(e.target.checked)}
                  />
                  <span>
                    <Rich tpl={COPY.verModal.copyHint} v={{ n: prev.seq }} />
                    <em>{COPY.verModal.copyHintNote}</em>
                  </span>
                </label>
              )}
            </>
          ) : (
            <>
              <div className="hint-box">
                
                {COPY.verModal.bindHintA}<b>{COPY.verModal.bindHintBold}</b>{COPY.verModal.bindHintB}
              </div>

              {folders === null ? (
                <div className="group-empty">{COPY.verModal.scanningFolders}</div>
              ) : folders.length === 0 ? (
                <div className="group-empty">
                  
                  {COPY.verModal.noFolders}
                </div>
              ) : (
                <>
                  <div className="bind-list">
                    {folders.map((f) => (
                      <label key={f.folderName} className={`bind-row${picked === f.folderName ? ' sel' : ''}`}>
                        <input
                          type="radio"
                          name="bindfolder"
                          checked={picked === f.folderName}
                          onChange={() => {
                            setPicked(f.folderName)
                            setSeq(f.suggestedSeq)
                          }}
                        />
                        <span className="bfn">
                  <Icon name="folder" size={13} /> {f.folderName}
                </span>
                        <span className="bfc"><Rich tpl={COPY.common.fileCount} v={{ n: f.fileCount }} /></span>
                      </label>
                    ))}
                  </div>

                  <label className="fld">
                    <span>{COPY.verModal.seqLabel}</span>
                    <input
                      type="number"
                      min={1}
                      value={seq}
                      onChange={(e) => setSeq(Number(e.target.value))}
                    />
                  </label>
                </>
              )}

              <label className="fld">
                <span>{COPY.verModal.noteLabel2}</span>
                <input
                  value={note}
                  placeholder={COPY.verModal.notePlaceholder2}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            
            {COPY.common.cancel}
          </button>
          {mode === 'create' ? (
            <button className="btn primary" onClick={doCreate} disabled={busy}>
              {busy ? COPY.verModal.building : fmt(COPY.verModal.buildBtn, { n: nextSeq })}
            </button>
          ) : (
            <button className="btn primary" onClick={doBind} disabled={busy || !picked}>
              {busy ? COPY.verModal.binding : fmt(COPY.verModal.bindBtn, { n: seq })}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
