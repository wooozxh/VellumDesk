/**
 * UI 改版（第 11 批）：线性图标集。
 *
 * 为什么手写而不是引图标库：项目从第 1 批起就定了"不引 UI 库、样式全手写"的路子
 * （见 DECISIONS 2026-09-24）。一套自绘图标零依赖、零体积负担、观感完全可控。
 *
 * 统一规范（对齐 Adobe Spectrum 图标的观感）：
 * - 24×24 网格，只描边不填充，笔宽 1.6，圆头 + 圆角端点
 * - stroke 用 currentColor —— 图标跟文字同色，hover / 选中 / 危险态自动跟着变
 * - 尺寸只给 14 / 15 / 16 / 18 几档，和正文字号（12~13px）对齐
 *
 * 换掉 emoji 的动机：Windows 上 emoji 渲染成彩色字体图标（Segoe UI Emoji），
 * 跟界面完全不是一个血统 —— 这是"不像专业软件"的最大单一来源。
 */
export type IconName =
  | 'search'
  | 'locate'
  | 'refresh'
  | 'edit'
  | 'trash'
  | 'close'
  | 'check'
  | 'plus'
  | 'inbox'
  | 'fileLoose'
  | 'export'
  | 'folder'
  | 'archive'
  | 'package'
  | 'tag'
  | 'clip'
  | 'warning'
  | 'caret'
  | 'caretDown'
  | 'star'
  | 'bulb'
  | 'arrowUp'
  | 'arrowDown'
  | 'image'
  | 'play'
  | 'external'
  | 'filter'
  | 'layers'
  | 'doc'
  | 'gear'
  // 第 47 批（docs/33）：假丢失治理 —— 忽略 / 撤销忽略
  | 'eyeOff'
  | 'undo'
  // 第 54 批（docs/39）：任务快捷方式
  | 'shortcut'

const ICONS: Record<IconName, React.JSX.Element> = {
  /** 放大镜（搜索素材名 / 标签） */
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20.5 20.5 16.6 16.6" />
    </>
  ),
  /** 准星（重新定位：指到文件的新位置）—— 和 search 区分开 */
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  /** 环形箭头（重新扫描） */
  refresh: (
    <>
      <path d="M20.5 11.9a8.5 8.5 0 1 1-2.5-5.9" />
      <path d="M20.5 3.6v6h-6" />
    </>
  ),
  /** 铅笔（编辑） */
  edit: (
    <>
      <path d="M12 20.5h8.5" />
      <path d="M16.7 3.6a2.1 2.1 0 0 1 3 3L7.4 18.9 3.5 20l1.1-3.9Z" />
    </>
  ),
  /** 垃圾桶（删除） */
  trash: (
    <>
      <path d="M3.5 6.5h17" />
      <path d="M9 6.5V4.2h6v2.3" />
      <path d="M18.6 6.5l-.9 13a1.9 1.9 0 0 1-1.9 1.8H8.2a1.9 1.9 0 0 1-1.9-1.8l-.9-13" />
      <path d="M10.2 10.5v7M13.8 10.5v7" />
    </>
  ),
  /** 叉（关闭 / 摘标签） */
  close: <path d="M18.5 5.5 5.5 18.5M5.5 5.5l13 13" />,
  /** 勾（已选 / 完成） */
  check: <path d="M20 6.5 9.2 17.3 4 12.1" />,
  plus: <path d="M12 4.5v15M4.5 12h15" />,
  /** 入库箭头（认领进包 / 待归类包归位） */
  inbox: (
    <>
      <path d="M12 3v11.5m0 0 4-4m-4 4-4-4" />
      <path d="M4 15.5v3.2A2.3 2.3 0 0 0 6.3 21h11.4a2.3 2.3 0 0 0 2.3-2.3v-3.2" />
    </>
  ),
  /**
   * 散件（第 14 批：左栏「未归属」）。
   * 语义是**散落在工作区、还没挂到任何任务上的素材文件** —— 不是"下载/导入"，
   * 所以不画箭头（原来错用 `inbox`，用户 2026-10-01 指出："未归属前面的图标用得不对"）。
   * 形：两张错落叠放的纸，前面那张带两行字，读起来就是"一叠没归位的文件"。
   */
  fileLoose: (
    <>
      <rect x="9.6" y="3.2" width="11.2" height="11.2" rx="2.2" />
      <rect x="3.2" y="9.6" width="11.2" height="11.2" rx="2.2" />
      <path d="M6.4 13.6h4.8M6.4 16.8h4.8" />
    </>
  ),
  /** 出库箭头（解绑项目 / 移出） */
  export: (
    <>
      <path d="M12 14.5V3m0 0 4 4m-4-4-4 4" />
      <path d="M4 15.5v3.2A2.3 2.3 0 0 0 6.3 21h11.4a2.3 2.3 0 0 0 2.3-2.3v-3.2" />
    </>
  ),
  /** 文件夹（包 / 磁盘位置） */
  folder: (
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.3a1 1 0 0 1 .8.4L11 7h7.5A2.5 2.5 0 0 1 21 9.5V17a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z" />
  ),
  /** 归档盒（未激活的工作区 / 结项留底） */
  archive: (
    <>
      <rect x="3" y="3.8" width="18" height="4.4" rx="1.2" />
      <path d="M4.8 8.2V19a2 2 0 0 0 2 2h10.4a2 2 0 0 0 2-2V8.2" />
      <path d="M10 12.5h4" />
    </>
  ),
  /** 包裹（包 / 无封面占位） */
  package: (
    <>
      <path d="M20.5 8.3 12 3.2 3.5 8.3v7.4L12 20.8l8.5-5.1Z" />
      <path d="M3.5 8.3 12 13.4l8.5-5.1" />
      <path d="M12 13.4v7.4" />
    </>
  ),
  /** 价签（标签） */
  tag: (
    <>
      <path d="M3.6 12.7 12.7 3.6h6.2a1.5 1.5 0 0 1 1.5 1.5v6.2l-9.1 9.1a1.5 1.5 0 0 1-2.1 0l-5.6-5.6a1.5 1.5 0 0 1 0-2.1Z" />
      <circle cx="16.3" cy="7.7" r="1.3" />
    </>
  ),
  /** 回形针（绑定已有文件夹） */
  clip: (
    <path d="M20.6 11.4 12.3 19.7a5 5 0 0 1-7.1-7.1l8.3-8.3a3.35 3.35 0 0 1 4.7 4.7l-8.3 8.3a1.68 1.68 0 0 1-2.4-2.4l7.6-7.6" />
  ),
  /** 三角警告（文件丢失） */
  warning: (
    <>
      <path d="M10.3 4.4 2.6 17.7A2 2 0 0 0 4.3 20.7h15.4a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.2" />
      <path d="M12 17.3h.01" />
    </>
  ),
  /** 眼睛划线（第 47 批：忽略这条丢失记录 —— 不再提醒，记录和标签都还在） */
  eyeOff: (
    <>
      <path d="M2.9 12C5.5 7.5 8.7 5.7 12 5.7s6.5 1.8 9.1 6.3c-2.6 4.5-5.8 6.3-9.1 6.3S5.5 16.5 2.9 12Z" />
      <circle cx="12" cy="12" r="2.8" />
      <path d="M4 4l16 16" />
    </>
  ),
  /** 回转箭头（第 47 批：撤销忽略 → 回到「丢失待处理」） */
  undo: (
    <>
      <path d="M4.2 10.2h9.3a4.9 4.9 0 0 1 0 9.8H8.6" />
      <path d="M8 6.2 4.2 10.2 8 14.2" />
    </>
  ),
  /**
   * 第 54 批：快捷方式。
   * 形：一台显示器（桌面）+ 屏内右上角一个「外跳」小箭头 —— 读起来就是"点一下进那个地方"。
   */
  shortcut: (
    <>
      <rect x="2.6" y="3.6" width="18.8" height="12.8" rx="2" />
      <path d="M8.6 20.4h6.8" />
      <path d="M12 16.4v4" />
      <path d="M13.2 12.8l3.6-3.6" />
      <path d="M13.6 9.2h3.2v3.2" />
    </>
  ),
  /** 右向三角（折叠面板） */
  caret: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  caretDown: <path d="M5.5 9.5 12 16l6.5-6.5" />,
  star: (
    <path d="M12 3.7l2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.75-5.2 2.75 1-5.8-4.2-4.1 5.8-.85Z" />
  ),
  bulb: (
    <>
      <path d="M9.2 18.2h5.6" />
      <path d="M10.2 21h3.6" />
      <path d="M12 3a6 6 0 0 0-3.4 10.9v4.3h6.8v-4.3A6 6 0 0 0 12 3Z" />
    </>
  ),
  arrowUp: <path d="M12 20V4.5m0 0L6 10.5m6-6 6 6" />,
  arrowDown: <path d="M12 4v15.5m0 0 6-6m-6 6-6-6" />,
  /** 图片（缩略图占位 / 没有封面） */
  image: (
    <>
      <rect x="3" y="4.2" width="18" height="15.6" rx="2.2" />
      <circle cx="8.6" cy="9.6" r="1.6" />
      <path d="M4.2 17.4 9.3 13l3.4 3 2.6-2.1 4.5 4.1" />
    </>
  ),
  play: <path d="M7.5 5.2v13.6L19 12Z" />,
  /** 外链（打开文件 / 打开文件夹） */
  external: (
    <>
      <path d="M14.2 4.2h5.6v5.6" />
      <path d="M19.8 4.2 10.6 13.4" />
      <path d="M17.8 14v4.8a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V8.2a1.8 1.8 0 0 1 1.8-1.8H10" />
    </>
  ),
  filter: <path d="M4 5.5h16l-6.3 7.3V20l-3.4-1.9v-5.3L4 5.5Z" />,
  /** 层叠（版本层 V1/V2/V3） */
  layers: (
    <>
      <path d="M12 3.2 20.6 8 12 12.8 3.4 8Z" />
      <path d="M3.4 12.6 12 17.4l8.6-4.8" />
      <path d="M3.4 16.6 12 21.4l8.6-4.8" />
    </>
  ),
  /** 文档（第 13 批：工单详情弹窗标题） */
  doc: (
    <>
      <path d="M6 2.8h8.4L19 7.4v13.8H6Z" />
      <path d="M14.2 2.8v4.8H19" />
      <path d="M9 12.4h7M9 15.8h7M9 8.8h3" />
    </>
  ),
  /** 齿轮（第 13 批：工单设置弹窗标题） */
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.2 5.2l2 2M16.8 16.8l2 2M18.8 5.2l-2 2M7.2 16.8l-2 2" />
    </>
  )
}

export function Icon({
  name,
  size = 15,
  className,
  strokeWidth = 1.6
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}
