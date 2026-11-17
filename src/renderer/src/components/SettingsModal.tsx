import { useState } from 'react'
import { COPY } from '../../../shared/copy'
import type { Theme, Density, BootStart as StartView } from '../theme'
import type { WorkspaceEntry } from '../../../shared/types'
import { Icon } from './Icon'

/**
 * 第 74 批（docs/57）：全局设置弹窗（5 页）。
 *
 * 为什么要有它：原来「插件联动」「企业微信授权」「工单同步设置」散在**三个地方**
 * —— 顶栏常驻按钮、工单视图的齿轮、首次配置向导。它们全是**一次性配置**，
 * 配完一年不点第二次，却占着顶栏最贵的位置（L0）。
 *
 * 按 `docs/57-界面层级归属规则`：配置项属于 L0（全局），入口统一收在这里；
 * 顶栏只保留**状态指示**（连上 / 未连），不再放配置按钮。
 *
 * 这一版刻意**不重造**已有弹窗：企业微信 → 交给 WecomAuthModal / 引导，
 * PS 插件 → 交给 PluginLinkModal。设置页只做「说明 + 跳转」，避免两套实现跑偏
 * （第 10 批「两套清单」的教训）。
 */
export interface SettingsModalProps {
  /** 第 85 批：打开时落在哪一页（点顶栏的工作区按钮直接进「工作区」） */
  initialTab?: SettingsTab
  theme: Theme
  onThemeChange: (t: Theme) => void
  /** 第 81 批：列表密度（标准 / 紧凑） */
  density: Density
  onDensityChange: (d: Density) => void
  /** 第 81 批：启动时停在哪一屏（'last' = 上次那屏） */
  startView: StartView
  onStartViewChange: (v: StartView) => void
  workspaceRoot: string
  onOpenWorkspace: () => void
  /** 第 85 批：工作区管理（列表 / 切换 / 添加 / 移除 / 搬移 / 重命名） */
  workspaces: WorkspaceEntry[]
  activeId: string
  onSwitchWorkspace: (id: string) => void
  onAddWorkspace: () => void
  onRemoveWorkspace: (w: WorkspaceEntry) => void
  onMoveWorkspace: () => void
  onRenameWorkspace: (id: string, name: string) => Promise<boolean>
  onOpenWecom: () => void
  onOpenPlugin: () => void
  /** 第 81 批：打开随安装包提供的中文使用手册 */
  onOpenManual: () => void
  version: string
  onClose: () => void
}

export type SettingsTab = 'general' | 'workspace' | 'wecom' | 'plugin' | 'about'
type Tab = SettingsTab

/** 启动视图的选项（顺序按用户使用频率排：工单最多，模板库最少） */
const START_VIEW_OPTIONS: Array<{ value: StartView; label: string }> = [
  { value: 'last', label: '上次那一屏' },
  { value: 'tickets', label: '工单队列' },
  { value: 'packs', label: '任务' },
  { value: 'files', label: '文件' },
  { value: 'brand', label: '通用素材库' },
  { value: 'tpl', label: '模板库' }
]

export function SettingsModal({
  initialTab = 'general',
  theme,
  onThemeChange,
  density,
  onDensityChange,
  startView,
  onStartViewChange,
  workspaceRoot,
  onOpenWorkspace,
  workspaces,
  activeId,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
  onMoveWorkspace,
  onRenameWorkspace,
  onOpenWecom,
  onOpenPlugin,
  onOpenManual,
  version,
  onClose
}: SettingsModalProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>(initialTab)
  /** 第 85 批：行内改名（Electron 里 window.prompt 不可用，自己做一个轻量的） */
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startRename = (w: WorkspaceEntry): void => {
    setRenaming(w.id)
    setDraft(w.name)
  }

  /**
   * 提交改名。Enter 与 blur 都会走到这里，靠 `renaming !== id` 挡住第二次
   * （先 setRenaming(null) 再 await，第二次进来就已经不是这个 id 了）。
   */
  const submitRename = async (id: string): Promise<void> => {
    if (renaming !== id) return
    const next = draft.trim()
    setRenaming(null)
    if (!next) return
    if (next === (workspaces.find((w) => w.id === id)?.name ?? '')) return
    await onRenameWorkspace(id, next)
  }

  const nav: { key: Tab; label: string; icon: 'sun' | 'archive' | 'wecom' | 'layers' | 'info'; group?: string }[] = [
    { key: 'general', label: '通用', icon: 'sun', group: COPY.set.groupApp },
    { key: 'workspace', label: COPY.side.workspace, icon: 'archive' },
    { key: 'wecom', label: COPY.wecom.title, icon: 'wecom', group: COPY.set.groupIntegration },
    { key: 'plugin', label: COPY.pluginLink.title, icon: 'layers' },
    { key: 'about', label: COPY.set.tabAbout, icon: 'info', group: COPY.set.groupOther }
  ]

  return (
    <div className="mask" onClick={onClose}>
      <div className="modal set-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {COPY.set.title}
          <button className="close" onClick={onClose} title={COPY.common.close}>
            ✕
          </button>
        </h3>

        <div className="set-wrap">
          <nav className="set-nav">
            {nav.map((n) => (
              <div key={n.key}>
                {n.group && <div className="set-grp">{n.group}</div>}
                <button
                  className={tab === n.key ? 'on' : ''}
                  onClick={() => setTab(n.key)}
                  type="button"
                >
                  <Icon name={n.icon} size={14} />
                  {n.label}
                </button>
              </div>
            ))}
          </nav>

          <div className="set-body">
            {tab === 'general' && (
              <>
                <div className="set-row">
                  <div className="lab">
                    <div className="t">{COPY.set.themeTitle}</div>
                    <div className="d">{COPY.set.themeDesc}</div>
                  </div>
                  <div className="ctl">
                    <button
                      className={`btn${theme === 'dark' ? ' primary' : ''}`}
                      onClick={() => onThemeChange('dark')}
                    >
                      {COPY.set.themeDark}
                    </button>
                    <button
                      className={`btn${theme === 'light' ? ' primary' : ''}`}
                      onClick={() => onThemeChange('light')}
                    >
                      {COPY.set.themeLight}
                    </button>
                  </div>
                </div>
                <div className="set-row">
                  <div className="lab">
                    <div className="t">{COPY.set.densityTitle}</div>
                    <div className="d">{COPY.set.densityDesc}</div>
                  </div>
                  <div className="ctl">
                    <button
                      className={`btn${density === 'standard' ? ' primary' : ''}`}
                      onClick={() => onDensityChange('standard')}
                    >
                      {COPY.set.densityStandard}
                    </button>
                    <button
                      className={`btn${density === 'compact' ? ' primary' : ''}`}
                      onClick={() => onDensityChange('compact')}
                    >
                      {COPY.set.densityCompact}
                    </button>
                  </div>
                </div>
                <div className="set-row">
                  <div className="lab">
                    <div className="t">{COPY.set.startupTitle}</div>
                    <div className="d">{COPY.set.startupDesc}</div>
                  </div>
                  <div className="ctl">
                    <select
                      className="tk-input set-select"
                      value={startView}
                      onChange={(e) => onStartViewChange(e.target.value as StartView)}
                    >
                      {START_VIEW_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {tab === 'workspace' && (
              <div className="set-ws">
                {/* 说明文字走全宽，不塞进 .set-row 那 168px 的左栏 ——
                    「一整套库」这句话必须一次读顺，挤成六行就没人读了 */}
                <div className="set-ws-intro">
                  <div className="t">{COPY.set.wsTitle}</div>
                  <div className="d">{COPY.set.wsDesc}</div>
                </div>
                <div className="set-ws-check">
                  <code className="set-path" title={workspaceRoot}>
                    {workspaceRoot || '—'}
                  </code>
                  <button className="btn" onClick={onOpenWorkspace}>
                    {COPY.set.wsOpen}
                  </button>
                </div>

                {/* 第 85 批：完整的管理器 —— 原来这里只有「路径 + 更换位置」，
                    列表 / 添加 / 移除 / 搬移全挤在文件视图左栏底部，三个用不到左栏的
                    视图（工单 / 通用库 / 模板）里根本管不了。 */}
                <div className="set-ws-head">
                  <span>{COPY.wsUi.colName}</span>
                  <span>{COPY.wsUi.colRoot}</span>
                  <span>{COPY.wsUi.colActions}</span>
                </div>
                {workspaces.map((w) => {
                  const cur = w.id === activeId
                  return (
                    <div key={w.id} className={`set-ws-row${cur ? ' on' : ''}`}>
                      <div className="set-ws-namecell">
                        {renaming === w.id ? (
                          <input
                            className="set-ws-input"
                            value={draft}
                            autoFocus
                            maxLength={24}
                            onChange={(ev) => setDraft(ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') void submitRename(w.id)
                              else if (ev.key === 'Escape') setRenaming(null)
                            }}
                            onBlur={() => void submitRename(w.id)}
                          />
                        ) : (
                          <>
                            <span className="set-ws-name">{w.name}</span>
                            {cur && <span className="set-ws-tag">{COPY.common.current}</span>}
                          </>
                        )}
                      </div>
                      <span className="set-ws-root" title={w.root}>
                        {w.root}
                      </span>
                      <div className="set-ws-acts">
                        {!cur && (
                          <button className="btn mini" onClick={() => onSwitchWorkspace(w.id)}>
                            {COPY.wsUi.actSwitch}
                          </button>
                        )}
                        {renaming !== w.id && (
                          <button className="btn mini" onClick={() => startRename(w)}>
                            {COPY.wsUi.actRename}
                          </button>
                        )}
                        {cur && (
                          <button className="btn mini" onClick={onOpenWorkspace}>
                            {COPY.wsUi.actOpen}
                          </button>
                        )}
                        {cur && (
                          <button className="btn mini" onClick={onMoveWorkspace}>
                            {COPY.wsUi.actMove}
                          </button>
                        )}
                        {!cur && (
                          <button className="btn mini danger" onClick={() => onRemoveWorkspace(w)}>
                            {COPY.wsUi.actRemove}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}

                <div className="set-ws-foot">
                  <button className="btn primary" onClick={onAddWorkspace}>
                    <Icon name="plus" size={12} strokeWidth={2} />
                    {COPY.wsUi.add}
                  </button>
                  <span className="set-ws-hint">{COPY.wsUi.addTip}</span>
                </div>
              </div>
            )}

            {tab === 'wecom' && (
              <div className="set-row">
                <div className="lab">
                  <div className="t">{COPY.wecom.title}</div>
                  <div className="d">{COPY.set.wecomDesc}</div>
                </div>
                <div className="ctl">
                  <button className="btn" onClick={onOpenWecom}>
                    {COPY.set.wecomAuth}
                  </button>
                  <span className="set-soon">{COPY.set.wecomStateHint}</span>
                </div>
              </div>
            )}

            {tab === 'plugin' && (
              <div className="set-row">
                <div className="lab">
                  <div className="t">{COPY.pluginLink.title}</div>
                  <div className="d">{COPY.set.pluginDesc}</div>
                </div>
                <div className="ctl">
                  <button className="btn" onClick={onOpenPlugin}>
                    {COPY.set.pluginOpen}
                  </button>
                  <span className="set-soon">{COPY.set.pluginStateHint}</span>
                </div>
              </div>
            )}

            {tab === 'about' && (
              <>
                <div className="set-row">
                  <div className="lab">
                    <div className="t">{COPY.set.aboutVersion}</div>
                    <div className="d">{COPY.set.aboutVersionDesc}</div>
                  </div>
                  <div className="ctl">
                    <span className="chip-strong">{version}</span>
                  </div>
                </div>
                <div className="set-row">
                  <div className="lab">
                    <div className="t">{COPY.set.aboutManual}</div>
                    <div className="d">{COPY.set.aboutManualDesc}</div>
                  </div>
                  <div className="ctl">
                    <button className="btn" onClick={onOpenManual}>
                      {COPY.set.manualOpen}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="foot">
          <span className="set-hint">{COPY.set.autoApply}</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {COPY.common.close}
          </button>
        </div>
      </div>
    </div>
  )
}
