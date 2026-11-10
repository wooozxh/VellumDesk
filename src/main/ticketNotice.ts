/**
 * 第 82 批：自动同步拉到新派给本机的单时，那条托盘通知长什么样。
 *
 * 为什么单独一个文件：`index.ts` 一 import 就把 electron 拖进来了，accept 跑不了。
 * 通知的**文字**是纯函数，抽出来就能断言（"0 条要返回 null"、"3 条要说等 3 个"
 * 这种规则靠肉眼在真机上试，一年也试不全）。
 *
 * 托盘只负责把返回值塞给 `displayBalloon` —— 谁弹、什么时候弹是 index.ts 的事。
 */

import { COPY, fmt } from '../shared/copy'

export interface TicketNotice {
  title: string
  content: string
}

/** 气泡正文最多说几个名字：再多系统会自己截断，不如我们先截 */
const MAX_NAMES = 2

/**
 * 本轮新建任务 → 一条通知；没有新任务时返回 null（调用方据此"什么都不做"）。
 *
 * 名字为空时回落到单号：任务名理论上不会空（createPack 有默认值），
 * 但气泡正文是空的话，用户看到的就是一个只有标题的框 —— 那种通知比不弹更差。
 */
export function newTasksNotice(
  tasks: Array<{ ticket_no: string; name: string }> | undefined
): TicketNotice | null {
  if (!tasks || tasks.length === 0) return null
  const names = tasks
    .slice(0, MAX_NAMES)
    .map((t) => (t.name || '').trim() || t.ticket_no)
    .join('、')
  const content = tasks.length > MAX_NAMES ? fmt(COPY.tray.newTasksMore, { names, n: tasks.length }) : names
  return { title: fmt(COPY.tray.newTasksTitle, { n: tasks.length }), content }
}
