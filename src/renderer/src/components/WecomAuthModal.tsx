import { COPY } from '../../../shared/copy'
import { Icon } from './Icon'
import { WecomConnectPanel } from './WecomConnectPanel'

/**
 * 第 21 批（docs/16 §4）：企业微信连接引导弹窗。
 *
 * 为什么做成弹窗而不是一页设置：这件事**只在没授权时才有意义**，做完一辈子不用再看。
 *
 * 第 54 批（docs/40 §5）改造：**首次启动的自动弹已收编进「首次配置引导」**，
 * 本弹窗现在只服务于两个入口：
 *   ① 工单设置里的常驻入口（「打开连接引导」）
 *   ② 同步撞上「组件缺失 / 未授权」时的兜底自动弹
 * 扫码区抽到了 `WecomConnectPanel`（向导 S2 与本弹窗共用同一份实现，避免两边跑偏）。
 */
export function WecomAuthModal({
  onClose,
  onToast
}: {
  onClose: () => void
  onToast?: (msg: string) => void
}): React.JSX.Element {
  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wc-modal">
        <h3>
          <Icon name="clip" size={15} /> {COPY.wecom.title}
          <button className="close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </h3>

        <WecomConnectPanel
          variant="modal"
          onToast={onToast}
          footer={({ auth }) => (
            <>
              {auth !== 'authorized' && (
                <button className="btn" onClick={onClose}>
                  {COPY.wecom.laterBtn}
                </button>
              )}
              {auth === 'authorized' && (
                <button className="btn primary" onClick={onClose}>
                  {COPY.wecom.doneBtn}
                </button>
              )}
            </>
          )}
        />
      </div>
    </div>
  )
}
