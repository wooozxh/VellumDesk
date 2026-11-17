import { useEffect, useRef, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type { WorkspaceEntry } from '../../../shared/types'
import { Icon } from './Icon'

/**
 * 第 85 批：顶栏的「当前工作区」标识 + 快速切换面板。
 *
 * 为什么放顶栏：工作区是**整套库**的根（任务 / 文件 / 通用素材 / 模板 / 工单都在里面），
 * 但原来唯一的完整入口挂在文件视图左栏底部 —— 工单 / 通用库 / 模板三个视图
 * 「独占主体、不复用左栏」，在里面既看不见也切不了。
 *
 * 三条刻意的设计：
 * ① **单库不弹面板** —— 只有一个工作区时点按钮直接进设置，不给用户制造
 *    「我有多个库要管」的错觉（绝大多数人就一个）。
 * ② **每行必须带路径** —— 两个库的根文件夹都叫「素材」时，只有名字分不清。
 * ③ **切库不加确认框** —— 面板里已经点了两下，再问一遍是烦人。
 *    真正危险的操作（移除、搬移）留在设置页，那里有 confirm。
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSwitch,
  onAdd,
  onManage
}: {
  workspaces: WorkspaceEntry[]
  activeId: string
  onSwitch: (id: string) => void
  onAdd: () => void
  onManage: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const active = workspaces.find((w) => w.id === activeId) ?? null
  const multi = workspaces.length > 1
  const name = active?.name || COPY.wsUi.empty
  const root = active?.root || '—'

  // 点外面 / Esc 关面板。用 mousedown 而不是 click：点面板里的按钮时
  // click 会先冒泡到 document，导致「刚点就被关掉」。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (): void => {
    if (!multi) {
      onManage()
      return
    }
    setOpen((v) => !v)
  }

  return (
    <div className="ws-switch-wrap" ref={wrapRef}>
      <button
        className={`ws-switch${open ? ' on' : ''}${multi ? '' : ' single'}`}
        onClick={pick}
        title={fmt(multi ? COPY.wsUi.tipMulti : COPY.wsUi.tipSingle, { root })}
      >
        <Icon name="folder" size={13} />
        <span className="ws-switch-name">{name}</span>
        {multi && <Icon name="caretDown" size={10} />}
      </button>

      {open && multi && (
        <div className="ws-menu" role="menu">
          {workspaces.map((w) => {
            const cur = w.id === activeId
            return (
              <button
                key={w.id}
                className={`ws-menu-item${cur ? ' on' : ''}`}
                role="menuitem"
                title={w.root}
                onClick={() => {
                  setOpen(false)
                  if (!cur) onSwitch(w.id)
                }}
              >
                <span className="ws-menu-check">
                  {cur && <Icon name="check" size={12} strokeWidth={2} />}
                </span>
                <span className="ws-menu-txt">
                  <span className="ws-menu-name">{w.name}</span>
                  <span className="ws-menu-root">{w.root}</span>
                </span>
              </button>
            )
          })}
          <div className="ws-menu-sep" />
          <button
            className="ws-menu-act"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onAdd()
            }}
          >
            <Icon name="plus" size={12} strokeWidth={2} />
            <span>{COPY.wsUi.add}</span>
          </button>
          <button
            className="ws-menu-act"
            role="menuitem"
            title={COPY.wsUi.manageTip}
            onClick={() => {
              setOpen(false)
              onManage()
            }}
          >
            <Icon name="gear" size={12} />
            <span>{COPY.wsUi.manage}</span>
          </button>
        </div>
      )}
    </div>
  )
}
