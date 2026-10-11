import { useEffect, useState } from 'react'
import { COPY, fmt } from '../../../shared/copy'
import type { PluginLinkConfig, PluginLinkStatus } from '../types'
import { Icon } from './Icon'

/**
 * 第 62 批（docs/45 Step 3b）：PS 插件联动设置弹窗（独立入口，不复用工单设置）。
 *
 * 只做「任务库」镜像的可见层：
 *   · 变更时自动同步开关（改即存，与工单设置里的「允许指派」同一套路子）
 *   · 插件数据目录：自动发现结果展示 + 手填兜底（可点「选择目录」走系统对话框）
 *   · 「同步到插件」手动按钮，带结果（写了几个目录 / 多少素材 / revision）
 *   · 上次同步时间与结果
 *
 * 设计原则（对齐 TicketSettingsModal）：任何一步读不到状态都**不让弹窗打不开** ——
 * 拿不到就退化成降级态，绝不抛。所有写操作失败都回读一次，绝不把没落库的值留在界面上。
 */
export function PluginLinkModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [cfg, setCfg] = useState<PluginLinkConfig | null>(null)
  const [status, setStatus] = useState<PluginLinkStatus | null>(null)
  /** 手填目录的草稿：失焦 / 点选目录时才提交（否则输入框里删到空就会当场存成空串） */
  const [dirDraft, setDirDraft] = useState('')
  const [dirDirty, setDirDirty] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  /**
   * 拉一次配置 + 状态（改设置后会重拉，因为目标目录可能变了）。
   * `keepDraft = true` 表示「用户正在编辑手填目录」，不要用落库值覆盖输入框。
   */
  const refresh = async (keepDraft = true): Promise<void> => {
    try {
      const c = await window.api.pluginGetConfig()
      setCfg(c)
      setDirDraft((prev) => (keepDraft ? prev : c.dataDir))
    } catch {
      setCfg(null)
    }
    try {
      setStatus(await window.api.pluginStatus())
    } catch {
      setStatus(null)
    }
  }

  // 挂载时首拉：此时输入框是空的，直接把落库的手填目录填进去
  useEffect(() => {
    void refresh(false)
    // 只在挂载时跑一次（refresh 是稳定语义，不随依赖变化）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleEnabled = async (v: boolean): Promise<void> => {
    setErr(null)
    try {
      const c = await window.api.pluginSetConfig({ enabled: v })
      setCfg(c)
      setStatus(await window.api.pluginStatus())
    } catch {
      await refresh()
    }
  }

  const commitDir = async (dir: string): Promise<void> => {
    setErr(null)
    setDirDirty(false)
    try {
      const c = await window.api.pluginSetConfig({ dataDir: dir.trim() })
      setCfg(c)
      setDirDraft(c.dataDir)
      setStatus(await window.api.pluginStatus())
    } catch {
      await refresh()
    }
  }

  const pickDir = async (): Promise<void> => {
    setErr(null)
    try {
      const r = await window.api.pluginPickDataDir()
      if (r.ok && r.dir) await commitDir(r.dir)
    } catch {
      // 选目录失败不弹错误，维持现状
    }
  }

  const doSync = async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    setMsg(null)
    setErr(null)
    try {
      const r = await window.api.pluginSyncNow()
      if (!r.ok) {
        setErr(fmt(COPY.pluginLink.syncFail, { msg: r.error ?? COPY.common.failed }))
      } else if (r.dirs === 0) {
        setMsg(COPY.pluginLink.syncNone)
      } else {
        setMsg(
          fmt(COPY.pluginLink.syncDone, {
            dirs: r.dirs,
            count: r.count,
            thumbs: r.thumbs,
            rev: r.revision
          })
        )
      }
      setStatus(await window.api.pluginStatus())
    } catch (e) {
      setErr(fmt(COPY.pluginLink.syncFail, { msg: (e as Error).message }))
    } finally {
      setSyncing(false)
    }
  }

  const targets = status?.targets ?? []
  const last = status?.lastSyncAt ? localTime(status.lastSyncAt) : null

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>
          <Icon name="layers" size={15} /> {COPY.pluginLink.title}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <div className="tk-settings">
          <div className="pl-intro">{COPY.pluginLink.intro}</div>

          {/* 总开关（改即存）—— 名字必须是「启用插件联动」而不是「自动同步」：
              关掉它等于**停掉整个联动**（镜像不写 + handoff 轮询也停，插件既看不到素材也无法插入）。 */}
          <label className="tk-check pl-autosync">
            <input
              type="checkbox"
              checked={cfg?.enabled ?? false}
              disabled={!cfg}
              onChange={(e) => void toggleEnabled(e.target.checked)}
            />
            <span>{COPY.pluginLink.autoLabel}</span>
          </label>
          <div className="pl-hint">{COPY.pluginLink.autoHint}</div>

          {/* 手填目录（兜底） */}
          <label className="tk-label">{COPY.pluginLink.dirLabel}</label>
          <div className="tk-linkrow">
            <input
              type="text"
              value={dirDraft}
              placeholder="…\com.vellum.toolbox\PluginData"
              onChange={(e) => {
                setDirDirty(true)
                setDirDraft(e.target.value)
              }}
              onBlur={() => {
                if (dirDirty) void commitDir(dirDraft)
              }}
            />
            <button className="btn" disabled={syncing} onClick={() => void pickDir()}>
              {COPY.pluginLink.pick}
            </button>
          </div>
          <div className="pl-hint">{COPY.pluginLink.dirHint}</div>
          {status?.manualDirIgnored && (
            <div className="tk-err pl-hint">{COPY.pluginLink.dirInsideWs}</div>
          )}

          {/* 自动发现结果 */}
          <div className="pl-targets">
            {targets.length === 0 ? (
              <div className="pl-none">{COPY.pluginLink.foundNone}</div>
            ) : (
              <>
                <div className="pl-found">
                  {fmt(COPY.pluginLink.foundTitle, { n: targets.length })}
                </div>
                {targets.map((t) => (
                  <div className="pl-target" key={t.pluginDataDir}>
                    <Icon name="folder" size={13} />
                    <span className="ps">{fmt(COPY.pluginLink.psMajor, { v: t.psMajor })}</span>
                    <span className="path" title={t.pluginDataDir}>
                      {t.pluginDataDir}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          {msg && <div className="tk-ok pl-msg">{msg}</div>}
          {err && <div className="tk-err">{err}</div>}

          <div className="pl-last">
            <span className="k">{COPY.pluginLink.lastLabel}</span>
            <span className="v" title={last ?? ''}>
              {last ?? COPY.pluginLink.lastNone}
            </span>
          </div>

          <div className="tk-actions">
            <button className="btn primary" disabled={syncing} onClick={() => void doSync()}>
              {syncing ? COPY.pluginLink.syncing : COPY.pluginLink.syncBtn}
            </button>
            <button className="btn" onClick={onClose}>
              {COPY.common.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 把 ISO 时间（含 +08:00）显示成本地可读格式；解析不出来就原样返回 */
function localTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}
