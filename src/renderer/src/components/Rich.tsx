import type { ReactNode } from 'react'

/**
 * 把「带占位符的一句文案」渲染成 React 节点。
 *
 * 为什么需要它：像「已选中 {n} 个文件」这种句子，原本在 JSX 里被拆成
 * `已选中 {selected.size} 个文件` 三个节点 —— 搬到文案字典后如果也拆成三段，
 * 你在表格里看到的就只剩碎片。Rich 让整句留在一个编号里，改起来是完整的句子。
 *
 * 输出是 Fragment（不额外包 DOM），所以跟手写 JSX 的结构、样式完全一致。
 *
 * 支持的标签：<b> 加粗、<code> 等宽、<em> 斜体、<path> 路径样式（渲染成 span.path）、<span> 普通行内
 * 用法： <Rich tpl={COPY.claim.selected} v={{ n: selected.size }} />
 */
export function Rich({
  tpl,
  v
}: {
  tpl: string
  v?: Record<string, unknown>
}): React.JSX.Element {
  return <>{parse(tpl, v)}</>
}

const TOKEN = /<(\/?)(b|code|em|span|path)>|\{(\w+)\}/g

function parse(tpl: string, v?: Record<string, unknown>): ReactNode[] {
  const out: ReactNode[] = []
  const stack: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(tpl))) {
    if (m.index > last) out.push(wrap(tpl.slice(last, m.index), stack, k++))
    if (m[3]) out.push(wrap(String(v?.[m[3]] ?? m[0]), stack, k++))
    else if (!m[1]) stack.push(m[2])
    else stack.pop()
    last = TOKEN.lastIndex
  }
  if (last < tpl.length) out.push(wrap(tpl.slice(last), stack, k++))
  return out
}

function wrap(node: ReactNode, stack: string[], k: number): ReactNode {
  for (let i = stack.length - 1; i >= 0; i--) {
    const tag = stack[i]
    if (tag === 'b') node = <b key={k}>{node}</b>
    else if (tag === 'code') node = <code key={k}>{node}</code>
    else if (tag === 'em') node = <em key={k}>{node}</em>
    else if (tag === 'span') node = <span key={k}>{node}</span>
    else
      node = (
        <span className="path" key={k}>
          {node}
        </span>
      )
  }
  return node
}
