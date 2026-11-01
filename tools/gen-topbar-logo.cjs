/**
 * 生成顶栏图标位用的 logo：`src/renderer/src/assets/app-icon.png`
 *
 * 用法：`node tools/gen-topbar-logo.cjs`
 *
 * 源图：`docs/manual/images/logo.png`（白底，上方是标志、下方是「Vellum Desk」字样，1452×836）
 *
 * 为什么要在构建前跑一次、而不是直接把原图丢进 src：
 *   ① 原图 500 KB，顶栏只显示 26px —— 白底大图直接引用会拖慢首屏；
 *   ② 26px 的槽位里「Vellum Desk」那行字只会糊成一条灰杠（放大 3 倍确认过），
 *      所以这里**裁掉文字只留标志**；
 *   ③ 裁切下界靠「标志与文字之间那条全白空隙」自动找，不写死像素，换 logo 也能跑。
 *
 * 第 78 批：**白底去掉，改透明底**。
 *   · 标志是「羊皮纸 + 蓝绿光带」，纸面本身就是浅米色（最亮处 min 通道 ≈ 200+）。
 *     如果按「亮度越高越透明」一刀切，纸面会被抠成半透明，深色顶栏上直接发灰。
 *   · 所以只对**接近纯白**的一小段做键控：min 通道 ≥ 244 全透明，225~244 之间线性渐隐
 *     （吃掉抗锯齿留下的白边），225 以下一律不透明 —— 米色纸面（min≈205）安然无恙。
 *   · 输出仍是 96px（26px 显示 × 3 倍），只是 alpha 通道换成了真透明。
 */
const sharp = require('sharp')

const SRC = 'docs/manual/images/logo.png'
const OUT = 'src/renderer/src/assets/app-icon.png'
const SIZE = 96 // 26px 显示 × 3 倍，够 200% 缩放屏

/** 键控阈值：≥ FULL 视为纯白（透明），FULL..RAMP 之间线性渐隐，< RAMP 保持不透明 */
const WHITE_FULL = 244
const WHITE_RAMP = 225

;(async () => {
  const img = sharp(SRC)
  const { data, info } = await img.clone().raw().ensureAlpha().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const C = info.channels

  const rowInk = (y) => {
    let n = 0
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C
      if (data[o + 3] < 12) continue
      if (data[o] < 244 || data[o + 1] < 244 || data[o + 2] < 244) n++
    }
    return n
  }

  // 从 40% 高处往下找第一段「连续空白」（>= 6 行几乎没有墨点）—— 标志与文字之间的缝
  let cut = H
  let blank = 0
  for (let y = Math.round(H * 0.4); y < H; y++) {
    if (rowInk(y) < 2) {
      blank++
      if (blank >= 6) {
        cut = y - blank + 1
        break
      }
    } else blank = 0
  }

  // 标志区（0..cut）里取非白包围盒
  let minX = W
  let minY = cut
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < cut; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C
      if (data[o + 3] < 12) continue
      if (data[o] > 244 && data[o + 1] > 244 && data[o + 2] > 244) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  // 正方形裁切框（透明底不用再补白，只留一点呼吸边）
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.06)
  const side = Math.max(maxX - minX, maxY - minY) + pad * 2
  const left = Math.max(0, Math.round((minX + maxX) / 2 - side / 2))
  const top = Math.max(0, Math.round((minY + maxY) / 2 - side / 2))
  const width = Math.min(side, W - left)
  const height = Math.min(side, cut - top)

  // 取出裁切区，逐像素把白底键成透明
  const crop = await sharp(SRC)
    .extract({ left, top, width, height })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true })

  const cw = crop.info.width
  const ch = crop.info.height
  const cc = crop.info.channels
  const px = Buffer.from(crop.data)

  for (let i = 0; i < cw * ch; i++) {
    const o = i * cc
    const mn = Math.min(px[o], px[o + 1], px[o + 2])
    let a = 1
    if (mn >= WHITE_FULL) a = 0
    else if (mn > WHITE_RAMP) a = (WHITE_FULL - mn) / (WHITE_FULL - WHITE_RAMP)
    px[o + 3] = Math.round(a * 255)
  }

  await sharp(px, { raw: { width: cw, height: ch, channels: 4 } })
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(OUT)

  console.log(
    `[gen-topbar-logo] 文字下界 y=${cut}，裁切 ${width}×${height} @(${left},${top}) → ${OUT}（透明底）`
  )
})()
