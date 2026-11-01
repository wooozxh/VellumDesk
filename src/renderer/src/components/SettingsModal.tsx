import { useState } from 'react'
import { COPY } from '../../../shared/copy'
import type { Theme } from '../theme'
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
  theme: Theme
  onThemeChange: (t: Theme) => void
  workspaceRoot: string
  onOpenWorkspace: () => void
  onChangeWorkspace: () => void
  onOpenWecom: () => void
  onOpenPlugin: () => void
  version: string
  onClose: () => void
}

type Tab = 'general' | 'workspace' | 'wecom' | 'plugin' | 'about'

export function SettingsModal({
  theme,
  onThemeChange,
  workspaceRoot,
  onOpenWorkspace,
  onChangeWorkspace,
  onOpenWecom,
  onOpenPlugin,
  version,
  onClose
}: SettingsModalProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('general')

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
                    <span className="set-soon">{COPY.set.soon}</span>
                  </div>
                </div>
                <div className="set-row">
                  <div className="lab">
                    <div className="t">{COPY.set.startupTitle}</div>
                    <div className="d">{COPY.set.startupDesc}</div>
                  </div>
                  <div className="ctl">
                    <span className="set-soon">{COPY.set.soon}</span>
                  </div>
                </div>
              </>
            )}

            {tab === 'workspace' && (
              <div className="set-row">
                <div className="lab">
                  <div className="t">{COPY.set.wsTitle}</div>
                  <div className="d">{COPY.set.wsDesc}</div>
                </div>
                <div className="ctl" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                  <code className="set-path" title={workspaceRoot}>
                    {workspaceRoot || '—'}
                  </code>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={onOpenWorkspace}>
                      {COPY.set.wsOpen}
                    </button>
                    <button className="btn" onClick={onChangeWorkspace}>
                      {COPY.set.wsChange}
                    </button>
                  </div>
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
                    <span className="set-soon">docs/manual</span>
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
