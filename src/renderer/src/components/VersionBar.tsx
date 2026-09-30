import type { PackVersion } from '../types'
import { fmtSize } from './FileRow'

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
              {v.is_current === 1 && <span className="vflag cur">当前</span>}
              {!v.folderExists && (
                <span className="vflag gone" title="这个文件夹已经不在磁盘上了（被改名或删了）">
                  文件夹不在
                </span>
              )}
            </div>
            <div className="vnote">{v.note || '（没写这一稿改了什么）'}</div>
            <div className="vmeta">
              {v.fileCount} 个文件 · {fmtSize(v.totalSize)}
              {v.missingCount > 0 && <span className="vmiss"> · ⚠ {v.missingCount}</span>}
            </div>
            <div className="vacts">
              {v.is_current !== 1 && (
                <button
                  className="vbtn"
                  title="把这一稿设为当前版本（回滚）——只改指针，不删任何文件"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetCurrent(v)
                  }}
                >
                  设为当前
                </button>
              )}
              <button
                className="vbtn"
                title="解除管理关系：文件夹和文件一个都不动"
                onClick={(e) => {
                  e.stopPropagation()
                  onUnbind(v)
                }}
              >
                解绑
              </button>
            </div>
          </div>
        ))}

        {unassignedCount > 0 && (
          <div
            className={`ver-cell none${selected === null ? ' sel' : ''}`}
            onClick={() => onSelect(null)}
            title="还没归到任何一稿里的文件（不在 V1/V2 这些文件夹里）"
          >
            <div className="vh">
              <span className="vn">未分版本</span>
            </div>
            <div className="vnote">不在任何一稿的文件夹里</div>
            <div className="vmeta">{unassignedCount} 个文件</div>
          </div>
        )}
      </div>

      <div className="ver-acts">
        <button
          className="btn primary"
          onClick={onCreate}
          title="在包文件夹里建一个新版本文件夹（V1 / V2 / V3…）"
        >
          ＋ 新建版本
        </button>
        <button
          className="btn"
          onClick={onBind}
          title="你自己在资源管理器里建好了文件夹？在这儿绑定一下就能纳入管理"
        >
          📎 绑定文件夹
        </button>
      </div>
    </div>
  )
}
