/**
 * 第 69 批（docs/51 / 53）：模板卡片的「信息卡」—— 软件界面的那一份。
 *
 * 样式与数据映射**不在这里**：都在 `shared/tplCardMarkup.ts`（唯一来源）。
 * 原因：同一张卡还要被主进程离屏渲染成 png 发给 PS 插件（UXP 没有 CSS 引擎，吃不了 HTML），
 * 两边若各写一份样式必然漂移。
 */
import { parseTplKeywords, tplNoteOf } from '../../../shared/tplInfo'
import { tplCardView, type TplCardData } from '../../../shared/tplCardMarkup'
import { TPL_LOGO_GRAPHIC, TPL_LOGO_WORDMARK } from '../../../shared/tplLogo'

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="tc-row">
      <span className="tc-k">{label}</span>
      <span className="tc-v">{value}</span>
    </div>
  )
}

export function TplInfoCard({ a }: { a: TplCardData }): React.JSX.Element {
  const v = tplCardView(a)
  const info = parseTplKeywords(a.keywords)
  const note = tplNoteOf(a.fileName)

  /**
   * 悬停提示：卡片上只放 3 行（空间有限、也不破坏设计稿），
   * 其余关键词（用途/客户/标签/备注/认不出的）全在这里 —— 信息不丢，但不占版面。
   */
  const tip = [
    a.fileName,
    `尺寸：${v.size} ｜ 出血：${v.bleed} ｜ ${v.colorMode}`,
    info.usage ? `用途：${info.usage}` : '',
    info.client ? `客户：${info.client}` : '',
    info.tags.length ? `标签：${info.tags.join('、')}` : '',
    info.note ? `备注：${info.note}` : '',
    note ? `文件名备注：${note}` : '',
    info.others.length ? `其他关键词：${info.others.join('、')}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className={`tpl-card${v.missing ? ' missing' : ''}`} title={tip}>
      {/* 内层是必须的：`cqw` 相对**最近祖先容器**，不能在定义 container 的元素自身上用 */}
      <div className="tc-inner">
        <div className="tc-head">
          {/* 图形原图白底 ⇒ multiply 融进卡面；字标是透明底 */}
          <img className="tc-logo-g" src={TPL_LOGO_GRAPHIC} alt="" />
          <img className="tc-logo-w" src={TPL_LOGO_WORDMARK} alt="" />
        </div>
        <div className="tc-rule" />
        <div className="tc-body">
          <div className="tc-title" style={{ fontSize: `${v.titleCqw}cqw` }}>
            {v.title}
          </div>
          <div className="tc-rows">
            <Row label="尺寸" value={v.size} />
            <Row label="出血" value={v.bleed} />
            <Row label="色彩模式" value={v.colorMode} />
          </div>
        </div>
        <div className="tc-foot" />
      </div>
    </div>
  )
}
