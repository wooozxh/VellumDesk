/**
 * 第 69 批（docs/51 / 53）：**把信息卡离屏渲染成 png**，供 PS 插件使用。
 *
 * 为什么需要这一步：UXP **没有 CSS 引擎**，插件吃不了 HTML。
 * 但插件读的是镜像里的图片文件（`thumb/p<id>.png`），所以只要软件把卡片渲染成图写进去，
 * **插件侧一行代码都不用改**。
 *
 * 分工（很重要）：
 * · **软件界面**：React 直接渲染 HTML（矢文字、实时、改样式即时生效）——不用这个模块；
 * · **插件**：吃这张 512×512 的 png。
 * 两边共用 `shared/tplCardMarkup.ts` 里的同一份 CSS，所以长得一模一样。
 *
 * 渲染方式：一个**离屏 BrowserWindow**（1024×1024 画布，正好是 cqw 的基准尺寸），
 * `capturePage` 抓 1024 位图，再压到 512 存 png。
 *
 * ⚠️ 本模块依赖 electron，所以 `tplLib` **不能**直接 import 它 ——
 * 通过 `setTplCardRenderer()` 由 ipc 层注入，这样 accept（纯 node）也能跑。
 */
import { BrowserWindow } from 'electron'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { tplCardHtml, type TplCardData } from '../shared/tplCardMarkup'

/** 离屏画布边长（= cqw 的 100% 基准，也是 CSS 里那套比例的基准） */
const RENDER_PX = 1024
/** 输出边长：卡片在插件里约 160-220px 显示，512 足够 2× 屏，且单张约 30-60KB */
const OUT_PX = 512

let win: BrowserWindow | null = null
let queue: Promise<unknown> = Promise.resolve()

async function ensureWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: RENDER_PX,
    height: RENDER_PX,
    show: false,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      // offscreen：不依赖窗口可见性渲染 —— 普通隐藏窗口会被当成后台页节流，抓出来常常是空白
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  return win
}

/**
 * 渲染一张信息卡到 `outAbs`（png，512×512）。失败返回 false，**绝不抛**（不能因为一张图挡住入库）。
 *
 * 串行化：离屏窗口只有一个，并发 `loadURL` 会互相打架 ⇒ 用一条 promise 链排队。
 */
export function renderTplCardPng(data: TplCardData, outAbs: string): Promise<boolean> {
  const job = queue.then(async () => {
    try {
      const w = await ensureWindow()
      const html = tplCardHtml(data, { size: RENDER_PX })
      await new Promise<void>((resolve) => {
        const done = (): void => resolve()
        w.webContents.once('did-finish-load', done)
        w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(done)
        // 兜底：万一事件没来，别把整条队列挂死
        setTimeout(done, 3000)
      })
      // 等字体/布局稳定（离屏渲染不会自动等；系统字体虽同步，但首帧常是 fallback）
      await new Promise((r) => setTimeout(r, 90))
      const img = await w.webContents.capturePage({
        x: 0,
        y: 0,
        width: RENDER_PX,
        height: RENDER_PX
      })
      const png = img.toPNG()
      if (!png || png.length < 1000) return false
      const sharp = (await import('sharp')).default
      mkdirSync(dirname(outAbs), { recursive: true })
      await sharp(png)
        .resize(OUT_PX, OUT_PX, { fit: 'cover' })
        .png({ compressionLevel: 9 })
        .toFile(outAbs)
      return true
    } catch (e) {
      // 渲染失败不能挡住入库，但**必须留痕** —— 否则"插件里没图"会变成无解的悬案
      console.error('[tpl-card] render failed:', (e as Error).message)
      return false
    }
  })
  // 让下一条等这条，同时保持对外返回本条的布尔结果
  queue = job.catch(() => undefined)
  return job
}

/** 应用退出时清掉离屏窗口（不然 electron 会拖着进程不退出） */
export function destroyTplCardRenderer(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}
