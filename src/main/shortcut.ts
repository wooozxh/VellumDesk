/**
 * 第 54 批（docs/39）：任务文件夹的「桌面 + 开始菜单」快捷方式。
 *
 * 为什么单独一个文件、还要把「算路径」和「真写盘」拆开：
 * accept.cjs 跑在**纯 node** 下，`require('electron')` 拿到的是可执行文件路径而不是
 * `shell` API —— 真写 `.lnk` 没法进自动测试。所以这里做成「纯逻辑 + 注入 writer」：
 * 单测注入一个假的 writer 验参数，真 writer（`shell.writeShortcutLink`）只在 ipc.ts 里注入。
 * （与第 18 批「设计师写回适配器」、第 19 批「报表适配器」同一路数。）
 *
 * ⚠️ 本机一次性探针实测（2026-10-09，Electron 39.8.10 / Windows，结论写死在下面的设计里）：
 *  1. `target` 指向**文件夹**可用 —— `.lnk` 能建成，`readShortcutLink` 回读的 target 精确等于该文件夹。
 *  2. 目标已存在同名 `.lnk` 时再 `create` **不报错、直接覆盖** —— 所以「要不要覆盖」只能由
 *     软件自己 `existsSync` 判断，**不能指望 API 抛异常**（单测里这条也钉住了）。
 *  3. `target` 指向**不存在**的目录时**照样建成功**（生成一个点不开的死链）——
 *     所以建之前必须自己检查任务文件夹还在不在。
 *  4. 带 `icon` 参数时回读的图标值与写入值不一致（存疑）→ 本批不指定图标，
 *     用 Windows 给文件夹的默认图标（最符合「这是文件夹」的直觉）。
 */
import { join } from 'path'

/** 快捷方式落点（桌面 / 开始菜单）——用户拍板 D4：两处都建 */
export const SHORTCUT_PLACES = ['desktop', 'startMenu'] as const
export type ShortcutPlaceKey = (typeof SHORTCUT_PLACES)[number]

/** 桌面 / 开始菜单里的 `.lnk` 文件名：净化非法字符（与建任务的规则同源） */
export function sanitizeShortcutName(name: string): string {
  return (
    name
      // Windows 文件名禁字符 + 控制字符
      .replace(/[<>:"\\/|?*\x00-\x1f]/g, '_')
      .trim()
      // 结尾的点和空格在 Windows 上会被静默吃掉，先自己去掉，免得名字对不上
      .replace(/[. ]+$/, '')
  )
}

/** 名字上限（任务名一般远短于此；防超长路径，留足余量） */
const MAX_STEM = 120

/** 快捷方式要落到的完整路径（不含写入，纯计算） */
export function shortcutPathFor(dir: string, packName: string): string {
  let stem = sanitizeShortcutName(packName) || 'task'
  if (stem.length > MAX_STEM) stem = stem.slice(0, MAX_STEM).replace(/[. ]+$/, '')
  return join(dir, `${stem}.lnk`)
}

/** 一个落点的探测结果（由调用方探测后喂进来，纯函数才好测） */
export interface ShortcutProbe {
  key: ShortcutPlaceKey
  dir: string
  /** 该位置是否已经有同名 `.lnk` */
  lnkExists: boolean
}

/** 组装结果：要么明确「不可建」（并说明原因），要么给出可执行的计划 */
export type ShortcutPlan =
  | { ok: false; reason: 'folder-missing'; folderPath: string }
  | {
      ok: true
      /** 快捷方式指向的目标（任务文件夹） */
      target: string
      /** 任一处已有同名 `.lnk` → 需要用户确认覆盖 */
      needsConfirm: boolean
      places: Array<ShortcutProbe & { lnkPath: string }>
    }

/** 算计划 —— 纯函数，文件系统探测由调用方做（`folderExists` / 每个 place 的 `lnkExists`）。 */
export function buildShortcutPlan(input: {
  packName: string
  folderPath: string
  folderExists: boolean
  probes: ShortcutProbe[]
}): ShortcutPlan {
  if (!input.folderExists) {
    return { ok: false, reason: 'folder-missing', folderPath: input.folderPath }
  }
  const places = input.probes.map((p) => ({
    ...p,
    lnkPath: shortcutPathFor(p.dir, input.packName)
  }))
  return {
    ok: true,
    target: input.folderPath,
    needsConfirm: places.some((p) => p.lnkExists),
    places
  }
}

/** 真写盘的那一步（由 ipc 注入 `shell.writeShortcutLink`；单测注入假实现） */
export type ShortcutWriter = (
  lnkPath: string,
  operation: 'create' | 'replace',
  details: { target: string }
) => boolean

/** 执行结果 */
export interface ShortcutOutcome {
  /** 整体是否成功（用户选择「不覆盖」也算成功 —— 只是什么都没做） */
  ok: boolean
  /** 是否真的写了文件（用户取消覆盖时为 false） */
  wrote: boolean
  /** 真写成功的落点（桌面 / 开始菜单） */
  done: ShortcutPlaceKey[]
  /** 写失败的落点 */
  failed: ShortcutPlaceKey[]
  /** 桌面那份的路径（界面提示与单测断言用） */
  desktopPath: string | null
}

/**
 * 执行建快捷方式。
 * - 任一处已有同名 + 未确认覆盖 → **一次 writer 都不调**，直接返回（什么都不做）
 * - 已确认覆盖 → 对每一处该覆盖的用 `replace`，其余用 `create`
 *   （探针第 2 条：`create` 对已存在的不报错，但用 `replace` 把「我就是来覆盖的」写明白）
 * - 个别落点失败不连坐：另一处照写，结果里如实列出哪几处失败
 */
export function runShortcut(
  writer: ShortcutWriter,
  plan: Extract<ShortcutPlan, { ok: true }>,
  opts: { overwrite: boolean }
): ShortcutOutcome {
  const desktop = plan.places.find((p) => p.key === 'desktop')
  if (plan.needsConfirm && !opts.overwrite) {
    return {
      ok: true,
      wrote: false,
      done: [],
      failed: [],
      desktopPath: desktop ? desktop.lnkPath : null
    }
  }
  const done: ShortcutPlaceKey[] = []
  const failed: ShortcutPlaceKey[] = []
  for (const place of plan.places) {
    const operation: 'create' | 'replace' = place.lnkExists ? 'replace' : 'create'
    let wrote = false
    try {
      wrote = writer(place.lnkPath, operation, { target: plan.target })
    } catch {
      wrote = false
    }
    if (wrote) done.push(place.key)
    else failed.push(place.key)
  }
  return {
    ok: failed.length === 0,
    wrote: done.length > 0,
    done,
    failed,
    desktopPath: desktop ? desktop.lnkPath : null
  }
}
