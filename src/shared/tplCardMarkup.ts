/**
 * 第 69 批（docs/51 / 53）：**模板信息卡的唯一来源** —— 样式 + 数据映射 + HTML 生成。
 *
 * 为什么要抽到 shared：这张卡有**两个出口**
 * 1. 软件界面：React 组件直接渲染（`TplInfoCard.tsx`），实时、矢量、改样式即时生效；
 * 2. PS 插件：UXP **没有 CSS 引擎**，吃不了 HTML ⇒ 由主进程把这个 HTML **离屏渲染成 png**，
 *    写进镜像（`thumb/p<id>.png`），插件照旧 `<img src>` 显示，**插件侧零改动**。
 *
 * 如果两边各写一份样式，迟早会漂移（改了一边忘了另一边，插件里显示的还是旧样子）。
 * 所以：**CSS 只写在这里**，React 侧注入一次 `<style>`，主进程侧拼进 HTML。
 *
 * 卡片内一切尺寸用 `cqw`（容器宽度的百分比）⇒ 同一份版式在
 * 200px 的界面上和 1024px 的离屏画布上是等比缩放，不用写两套。
 */
import { colorModeText, parseTplKeywords, physicalSizeText, tplTitleOf } from './tplInfo'
import { TPL_LOGO_GRAPHIC, TPL_LOGO_WORDMARK } from './tplLogo'

/** 只取渲染需要的字段（不依赖 TplAssetVM 的具体类型，便于测试与复用） */
export interface TplCardData {
  fileName: string
  width: number | null
  height: number | null
  resolution: number | null
  colorMode: string | null
  keywords: string[]
  missing?: boolean
}

/** 卡片上要显示的东西（已算好，两个出口共用） */
export interface TplCardView {
  title: string
  /** 品类大字字号（cqw）—— 按字数反推，保证整名放得下 */
  titleCqw: number
  size: string
  bleed: string
  colorMode: string
  /** 色彩模式缺省时显示占位 */
  missing: boolean
}

const NONE = '—'

/**
 * 品类大字的字号：卡内可用宽度约 86cqw（扣掉左右 padding），中文字宽 ≈ 1em
 * ⇒ 字号上限 = 86 / 字数；再封顶 15cqw（4 字以内吃满）。
 * 不做的话「主视觉-易拉宝」会被省略号吃掉一半，而名字正是这张卡的第一信息。
 */
export function tplCardView(a: TplCardData): TplCardView {
  const info = parseTplKeywords(a.keywords)
  const title = tplTitleOf(a.fileName)
  // 尺寸：**关键词优先**（那是成品尺寸）；没写才用画布算（算出来含出血）
  const size = info.sizeText ?? physicalSizeText(a.width, a.height, a.resolution)
  return {
    title,
    titleCqw: Math.min(15, 86 / Math.max(2, title.length)),
    size: size ?? NONE,
    bleed: info.bleedMm !== null ? `${info.bleedMm}mm` : NONE,
    colorMode: colorModeText(a.colorMode),
    missing: !!a.missing
  }
}

/**
 * 卡片样式 —— **唯一来源**。
 * 卡面固定浅色（不跟深色主题）：它是印刷品预览，白底才像纸。
 */
/*
 * ⚠️⚠️ 本模板字符串里**绝对不能出现反引号**（包括注释里用来包名词的那种）——
 * 反引号会提前结束模板字符串，esbuild 报 "Expected ; but found xxx"，而这个文件
 * 同时被 renderer 和 main 引用 ⇒ 两边都构建失败，但错误信息指向 CSS 行号，很难一眼看出。
 * 想强调名词就用中文引号「」或直接不加引号。（第 69 批踩了两次）
 */
export const TPL_CARD_CSS = `
.tpl-card {
  container-type: size;
  width: 100%;
  height: 100%;
  background: #fbfaf7;
  color: #23262b;
  overflow: hidden;
}
.tc-inner {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 6.2cqw 6.6cqw;
  display: flex;
  flex-direction: column;
}
.tc-head { display: flex; align-items: center; gap: 2.2cqw; flex: none; }
/*
 * logo 尺寸用**宽度百分比**，不用 cqw：
 * cqw 依赖 container-type 生效，一旦容器高度解析不出（父级 aspect-ratio 那条链路上有 auto），
 * 就会**回退到视口宽度** —— 表现是"卡片里 logo 突然变得巨大"（真踩过）。
 * 宽度的 % 只相对父宽，最稳。比例按设计稿：图形约占卡宽 12%、字标 22%。
 * flex: none 防止被 flex 拉伸。
 */
.tc-logo-g { width: 12%; height: auto; flex: none; }
.tc-logo-w { width: 22%; height: auto; flex: none; }
.tc-rule {
  /* 0.55cqw 在 200px 的卡上只有 1px，半透明像素会被"看没了" ⇒ 给个 2px 下限 */
  height: max(2px, 0.55cqw);
  background: #ff5a00;
  margin-top: 2.4cqw;
  flex: none;
}
.tc-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /*
   * 用户要求「文字再靠上一点」。
   * 但直接 flex-start 会贴住橙线、下方空一大片（试过，视觉重心太飘）。
   * ⇒ 仍居中，用 padding-bottom 把整块**整体上推** 4.5cqw：既上移了，又保持上下呼吸均衡。
   */
  justify-content: center;
  gap: 4cqw;
  padding-top: 4cqw;
  padding-bottom: 9cqw;
}
.tc-title {
  line-height: 1.02;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #23262b;
  font-family: 'Source Han Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-rows { display: flex; flex-direction: column; gap: 1.8cqw; }
/* 字号整体比首版 +15%：界面 200px 卡上原来只有 8px、插件 179px 格子只有 8.7px，都偏小 */
.tc-row {
  display: flex;
  align-items: baseline;
  gap: 1.2cqw;
  font-size: 5.6cqw;
  line-height: 1.22;
  white-space: nowrap;
  overflow: hidden;
}
.tc-k { color: #8a8f98; font-size: 4.8cqw; flex: none; }
.tc-k::after { content: '：'; }
.tc-v { color: #23262b; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.tc-foot { height: 5.4cqw; background: #ff5a00; flex: none; margin: 0 -6.6cqw -6.2cqw; }
.tpl-card.missing { filter: grayscale(1) opacity(0.55); }
`

/** HTML 转义（标题是文件名，可能带 `<` `&`） */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成**完整的独立 HTML 文档**（给离屏渲染用）。
 * 结构与 React 侧的 `TplInfoCard` 一一对应 —— 两边都只改这一处的 CSS。
 */
export function tplCardHtml(a: TplCardData, opts?: { size?: number }): string {
  const v = tplCardView(a)
  const px = opts?.size ?? 1024
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: ${px}px; height: ${px}px; background: #fff; }
  ${TPL_CARD_CSS}
</style></head>
<body>
  <div class="tpl-card${v.missing ? ' missing' : ''}">
    <div class="tc-inner">
      <div class="tc-head">
        <img class="tc-logo-g" src="${TPL_LOGO_GRAPHIC}" alt="" />
        <img class="tc-logo-w" src="${TPL_LOGO_WORDMARK}" alt="" />
      </div>
      <div class="tc-rule"></div>
      <div class="tc-body">
        <div class="tc-title" style="font-size:${v.titleCqw}cqw">${esc(v.title)}</div>
        <div class="tc-rows">
          <div class="tc-row"><span class="tc-k">尺寸</span><span class="tc-v">${esc(v.size)}</span></div>
          <div class="tc-row"><span class="tc-k">出血</span><span class="tc-v">${esc(v.bleed)}</span></div>
          <div class="tc-row"><span class="tc-k">色彩模式</span><span class="tc-v">${esc(v.colorMode)}</span></div>
        </div>
      </div>
      <div class="tc-foot"></div>
    </div>
  </div>
</body></html>`
}
