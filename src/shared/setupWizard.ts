/**
 * 第 54 批（docs/40）：首次配置引导的**纯逻辑**（步骤定义 + 触发判定 + 关窗语义）。
 *
 * 为什么单独抽出来放 shared：
 * accept.cjs 跑在**纯 node** 下，拿不到 Electron 的渲染层组件 —— 所以「弹不弹」「几步」「哪几步能跳过」
 * 这些规则必须是能被单测直接调用的纯函数，而不是埋在 `App.tsx` 的 effect 与 JSX 里。
 * （组件只负责"照着这份定义渲染"，规则本身在这里。）
 */
import { COPY } from './copy'

export type SetupStepKey = 'welcome' | 'workspace' | 'wecom' | 'ticket' | 'report' | 'done'

export interface SetupStepDef {
  key: SetupStepKey
  /** 步骤名（走文案字典 —— 用户能改） */
  name: string
  /** 这一步能不能跳过 */
  skippable: boolean
}

/**
 * 六步（顺序即数组顺序）。欢迎与完成页没有"跳过"的含义，中间四步都可跳过。
 * ⚠️ 加减步骤时，`accept` 里那条"步骤定义"断言会跟着红 —— 那是故意的（防止漏改）。
 */
export const SETUP_STEPS: SetupStepDef[] = [
  { key: 'welcome', name: COPY.wz.title, skippable: false },
  { key: 'workspace', name: COPY.wz.s1Name, skippable: true },
  { key: 'wecom', name: COPY.wz.s2Name, skippable: true },
  { key: 'ticket', name: COPY.wz.s3Name, skippable: true },
  { key: 'report', name: COPY.wz.s4Name, skippable: true },
  { key: 'done', name: COPY.wz.s5Name, skippable: false }
]

export function setupStepCount(): number {
  return SETUP_STEPS.length
}

export function setupStep(index: number): SetupStepDef {
  return SETUP_STEPS[Math.max(0, Math.min(SETUP_STEPS.length - 1, index))]
}

/** 关窗的三种原因：完成 / 以后再说 / 直接关掉（✕、Esc、点弹窗外） */
export type WizardDismissReason = 'done' | 'later' | 'dismiss'

/**
 * 只有「完成」与「我以后再说」才写 `setup_wizard_done`；
 * **直接关掉不写** —— "我还没决定" ≠ "以后别再问了"，下次启动还会弹。
 */
export function wizardWritesDoneFlag(reason: WizardDismissReason): boolean {
  return reason === 'done' || reason === 'later'
}

export interface SetupWizardSignals {
  /** 工作区当前可用（连不上时一律不弹 —— 顶部红条已经说明原因了） */
  workspaceOk: boolean
  /** 本次启动时这个工作区的库是**现场新建**的（= 真正的新装 / 换 Windows 账号 / 换电脑） */
  firstRunThisSession: boolean
  /** 已经走过向导（点过「完成」或「我以后再说」） */
  setupWizardDone: boolean
  /** 本会话里已经自动弹过一次（防止每次数据刷新都再弹） */
  alreadyShownThisSession: boolean
}

/**
 * 自动弹向导的判定。
 * ⚠️ 判据是**库在没在**，不是"配置文件在不在"：第 28 批 userData 目录改过名，
 * 老用户升级时配置文件本来就是空的 —— 拿它判会把老用户全弹一遍（见 docs/40 §4.1）。
 */
export function shouldShowSetupWizard(s: SetupWizardSignals): boolean {
  if (!s.workspaceOk) return false
  if (!s.firstRunThisSession) return false
  if (s.setupWizardDone) return false
  if (s.alreadyShownThisSession) return false
  return true
}
