import { COPY } from '../../../shared/copy'
import { Rich } from './Rich'
import type { PackVersion } from '../types'
import { fmtSize } from './FileRow'
import { Icon } from './Icon'

/**
 * 第 9 批（M6 版本管理）：包详情顶部的**版本条** —— 一格 = 一稿。
 *
 * 点格子切换下面三组显示哪一稿的内容；格子右下角 hover 出「设为当前」「解绑」。
 * 「未分版本」格只在包里确实有这类文件（老包文件 / 包根散文件）时才出现。
 *
 * 为什么不做成独立弹窗：版本是"这个包的第几稿"，跟包内容是一体两面，
 * 放在同一个视野里，用户点一下就换视角，不用在窗口之间跳。
 */
export function VersionBar({
  versions,
  selected,
  unassignedCount,
  onSelect,
  onCreate,
  onBind,
  onSetCurrent,
  onUnbind
}: {
  versions: PackVersion[]
  /** 选中的是哪一稿；null = 未分版本 */
  selected: number | null
  unassignedCount: number
  onSelect: (id: number | null) => void
  onCreate: () => void
  onBind: () => void
  onSetCurrent: (v: PackVersion) => void
  onUnbind: (v: PackVersion) => void
}): React.JSX.Element {
  return (
    <div className="ver-bar">
      <div className="ver-list">
        {versions.map((v) => (
          <div
            key={v.id}
            className={`ver-cell${selected === v.id ? ' sel' : ''}${v.is_current === 1 ? ' cur' : ''}`}
            onClick={() => onSelect(v.id)}
            title={`${v.folder_name}${v.note ? '\n' + v.note : ''}\n${v.folder_path}`}
          >
            <div className="vh">
              <span className="vn">V{v.seq}</span>
              {v.is_current === 1 && <span className="vflag cur">{COPY.common.current}</span>}
              {!v.folderExists && (
                <span className="vflag gone" title={COPY.verBar.goneTip}>
                  
                  {COPY.verBar.gone}
                </span>
              )}
            </div>
            <div className="vnote">{v.note || COPY.verBar.noNote}</div>
            <div className="vmeta">
              <Rich tpl={COPY.card.fileSize} v={{ n: v.fileCount, size: fmtSize(v.totalSize) }} />
              {v.missingCount > 0 && <span className="vmiss">
                {' · '}
                <Icon name="warning" size={11} /> {v.missingCount}
              </span>}
            </div>
            <div className="vacts">
              {v.is_current !== 1 && (
                <button
                  className="vbtn"
                  title={COPY.verBar.setCurrentTip}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetCurrent(v)
                  }}
                >
                  
                  {COPY.verBar.setCurrent}
                </button>
              )}
              <button
                className="vbtn"
                title={COPY.verBar.unbindTip}
                onClick={(e) => {
                  e.stopPropagation()
                  onUnbind(v)
                }}
              >
                
                {COPY.verBar.unbind}
              </button>
            </div>
          </div>
        ))}

        {unassignedCount > 0 && (
          <div
            className={`ver-cell none${selected === null ? ' sel' : ''}`}
            onClick={() => onSelect(null)}
            title={COPY.verBar.unassignedTip}
          >
            <div className="vh">
              <span className="vn">{COPY.verBar.unassigned}</span>
            </div>
            <div className="vnote">{COPY.verBar.unassignedNote}</div>
            <div className="vmeta"><Rich tpl={COPY.common.fileCount} v={{ n: unassignedCount }} /></div>
          </div>
        )}
      </div>

      <div className="ver-acts">
        <button
          className="btn primary"
          onClick={onCreate}
          title={COPY.verBar.newTip}
        >
          <Icon name="plus" size={13} strokeWidth={2} />  {COPY.verBar.newVer}
        </button>
        <button
          className="btn"
          onClick={onBind}
          title={COPY.verBar.bindTip}
        >
          <Icon name="clip" size={13} />  {COPY.verBar.bind}
        </button>
      </div>
    </div>
  )
}
