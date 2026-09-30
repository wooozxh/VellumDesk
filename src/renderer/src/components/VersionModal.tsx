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
      toast(res.error ?? '新建版本失败', 'err')
      return
    }
    const bits: string[] = []
    if (res.moved) bits.push(`收编了 ${res.moved} 个文件`)
    if (copyPrev && prev) bits.push(`复制了 V${prev.seq} 的内容`)
    onDone(`已建第 ${res.version?.seq ?? nextSeq} 稿${bits.length ? '，' + bits.join('、') : ''}`)
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
      toast(res.error ?? '绑定失败', 'err')
      return
    }
    onDone(`已把「${picked}」绑成 V${res.version?.seq ?? seq}`)
  }

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal version-modal">
        <h3>
          {mode === 'create' ? (
            <>
              <Icon name="plus" size={15} strokeWidth={2} /> 新建版本 V{nextSeq}
            </>
          ) : (
            <>
              <Icon name="clip" size={15} /> 绑定已有文件夹
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
                软件会在<b>这个包的文件夹</b>里建一个 <code>V{nextSeq}</code> 文件夹，里面自动长好
                <code> 01-成品 / 02-素材 / 03-工程 </code>三个空文件夹 ——
                资源管理器里立刻能看到，往里丢东西就行。
              </div>

              <label className="fld">
                <span>这一稿改了什么（版本说明）</span>
                <input
                  value={note}
                  placeholder="例：客户反馈——主标题太小，整体调亮"
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
                    把包里现在这 {unassignedCount} 个文件收进第 1 稿
                    <em>
                      （只搬已经躺在 01-成品 / 02-素材 / 03-工程 里的；直接丢在包根目录的不动）
                    </em>
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
                    把 V{prev.seq} 的文件复制一份进来
                    <em>（改稿时省事，但会多占一份硬盘空间——默认不勾）</em>
                  </span>
                </label>
              )}
            </>
          ) : (
            <>
              <div className="hint-box">
                你自己在资源管理器里建好的文件夹（名字随便叫），在这儿绑定一下就归软件管了。
                编号由软件按你说的算，<b>文件夹名和里面的文件一个都不动</b>。
              </div>

              {folders === null ? (
                <div className="group-empty">正在看包里有啥文件夹…</div>
              ) : folders.length === 0 ? (
                <div className="group-empty">
                  这个包文件夹里没有可绑定的文件夹了（都已认领，或者你还没建）
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
                        <span className="bfc">{f.fileCount} 个文件</span>
                      </label>
                    ))}
                  </div>

                  <label className="fld">
                    <span>算第几稿</span>
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
                <span>这一稿改了什么（可留空）</span>
                <input
                  value={note}
                  placeholder="例：第二稿——按客户意见改了配色"
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        <div className="foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          {mode === 'create' ? (
            <button className="btn primary" onClick={doCreate} disabled={busy}>
              {busy ? '正在建…' : `建 V${nextSeq}`}
            </button>
          ) : (
            <button className="btn primary" onClick={doBind} disabled={busy || !picked}>
              {busy ? '正在绑…' : `绑成 V${seq}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
