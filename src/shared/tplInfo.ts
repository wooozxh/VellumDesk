/**
 * 第 69 批（docs/51）：**模板卡片上那几行字怎么来** —— 纯函数，无 IO，accept 直接单测。
 *
 * 背景：模板库的缩略图不用 PSD 画面（分辨率不够、也没必要），改成一张**信息卡**
 * （品类大字 + 成品尺寸 + 出血 + 色彩模式）。信息从三个来源拼：
 *
 * | 卡片上的字 | 来源 |
 * |---|---|
 * | 品类（「展架」） | **文件名**第一个 `_` 之前（`_` 之后是备注，不进卡片） |
 * | 成品尺寸 | PSD 关键词里的 `80cm×180cm`；没写就用画布像素 ÷ ppi 算（算出来含出血） |
 * | 出血 | PSD 关键词里的 `bleed:5mm`（也认 `出血:5mm` / `出血5`） |
 * | 色彩模式 | PSD 头（`colorMode`），已在 `readPsdMeta` 里读 |
 *
 * 为什么尺寸优先读关键词而不是算：**画布含出血**。
 * 实测 `展架.psd` 画布 4783×10689 @150ppi = 80.99×181.00cm，成品是 80×180（各边 5mm 出血）。
 * 直接算会显示 81×181，与用户认知不符。
 */

/** 关键词里能认出来的东西（约定见 `docs/52-模板关键词约定.md`） */
export interface TplPrintInfo {
  /** 成品尺寸的展示文本（已规范化，如 `80cm×180cm`）；没读到 = null */
  sizeText: string | null
  /** 出血，单位 mm；没读到 = null */
  bleedMm: number | null
  /** 用途 / 场景（室内、户外…） */
  usage: string | null
  /** 客户 / 品牌 */
  client: string | null
  /** 标签，可多值 */
  tags: string[]
  /** 备注 */
  note: string | null
  /** 认不出的条目（进 tooltip / 将来扩展，不报错） */
  others: string[]
}

/**
 * key → 字段的别名表。**英文和中文都认**：
 * 英文 key 在 ExifTool / 命令行里好处理，中文 key 在 PS / XnView 里手写更直观。
 * 不在表里的 key 一律进 `others`（约定 §4：认不出不等于错）。
 */
const KEY_ALIAS: Record<string, 'size' | 'bleed' | 'usage' | 'client' | 'tag' | 'note'> = {
  size: 'size',
  尺寸: 'size',
  成品尺寸: 'size',
  成品: 'size',
  bleed: 'bleed',
  出血: 'bleed',
  usage: 'usage',
  用途: 'usage',
  场景: 'usage',
  client: 'client',
  客户: 'client',
  品牌: 'client',
  tag: 'tag',
  标签: 'tag',
  note: 'note',
  备注: 'note',
  说明: 'note'
}

/** `key:value` / `key：value` / `key=value`（key 限制 2-8 个中英文，避免把普通句子当 key） */
const KV_RE = /^([A-Za-z\u4e00-\u9fa5]{2,8})\s*[:：=]\s*(.+)$/

/** `80cm×180cm` / `80x180` / `80 * 180 cm` / `800×1800mm` */
const SIZE_RE =
  /^\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|px)?\s*[×xX*✕]\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|px)?\s*$/i

/** `bleed:5mm` / `bleed 5` / `出血:5mm` / `出血 5` / `出血5mm` */
const BLEED_RE = /^\s*(?:bleed|出血)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm)?\s*$/i

/**
 * 尺寸数字的显示规则：**最多 1 位小数，接近整数就去掉小数**。
 *
 * 为什么不能固定保留 2 位：像素 ÷ ppi 必然带小数噪声
 * （1772px @150ppi = 30.0053cm，4783px = 80.993cm），直接显示会变成
 * 「30.01cm」「80.99cm」—— 用户会以为模板做错了。
 * 印刷行业本来也只认到毫米（0.1cm）。
 */
function trimNum(n: number): string {
  const r1 = Math.round(n * 10) / 10
  if (Math.abs(r1 - Math.round(r1)) < 0.05) return String(Math.round(r1))
  return String(r1)
}

/** 尺寸值规范化：`80x180` → `80cm×180cm`；认不出（如 `A3`）返回 null（交给 others） */
function normalizeSize(v: string): string | null {
  const m = v.match(SIZE_RE)
  if (!m) return null
  const u1 = (m[2] ?? m[4] ?? 'cm').toLowerCase()
  const u2 = (m[4] ?? m[2] ?? 'cm').toLowerCase()
  // 两端单位不一致就原样显示（不猜）
  if (u1 !== u2) return v
  return `${trimNum(Number(m[1]))}${u1}×${trimNum(Number(m[3]))}${u2}`
}

/** 出血值 → 毫米。缺单位按 mm；`0.5cm` → 5 */
function parseMm(v: string): number | null {
  const m = v.match(/^(\d+(?:\.\d+)?)\s*(mm|cm)?$/i)
  if (!m) return null
  let n = Number(m[1])
  if (!Number.isFinite(n)) return null
  if (m[2] && m[2].toLowerCase() === 'cm') n *= 10
  return n
}

/**
 * 把一组 PSD 关键词解析成卡片要用的字段。约定见 `docs/52-模板关键词约定.md`。
 *
 * 顺序很要紧：
 * 1. **先试 `key:value`** —— 这是约定的标准写法，`size` / `bleed` / `usage` / `client` / `tag` / `note` 都走这里；
 * 2. 再试**无冒号特例**（`出血3mm`、裸尺寸 `80x180`）—— 照顾手写省事的习惯；
 * 3. 都不认 ⇒ 进 `others`。
 *
 * 🔴 容错原则：**认不出不等于错**。写歪了、写了软件不认识的字段，都只进 `others`，
 * 绝不报错、绝不影响入库 —— 关键词是附加信息，不是必填项。
 */
export function parseTplKeywords(keywords: string[] | null | undefined): TplPrintInfo {
  const out: TplPrintInfo = {
    sizeText: null,
    bleedMm: null,
    usage: null,
    client: null,
    tags: [],
    note: null,
    others: []
  }

  for (const raw of keywords ?? []) {
    const kw = String(raw ?? '').trim()
    if (!kw) continue

    // ① key:value（`: ` `：` `=` 都认；key 大小写不敏感）
    const kv = kw.match(KV_RE)
    if (kv) {
      const field = KEY_ALIAS[kv[1].toLowerCase()]
      const value = kv[2].trim()
      if (field === 'size') {
        const t = normalizeSize(value)
        if (t) {
          out.sizeText = t
          continue
        }
      } else if (field === 'bleed') {
        const n = parseMm(value)
        if (n !== null) {
          out.bleedMm = n
          continue
        }
      } else if (field === 'usage') {
        out.usage = value
        continue
      } else if (field === 'client') {
        out.client = value
        continue
      } else if (field === 'tag') {
        if (value) out.tags.push(value)
        continue
      } else if (field === 'note') {
        out.note = value
        continue
      }
      // key 认得但值不合法（如 `size:很大`）⇒ 进 others，不静默丢
      out.others.push(kw)
      continue
    }

    // ② 无冒号特例：`出血3mm` / `出血 5` / 裸尺寸 `80x180`
    const bleed = kw.match(BLEED_RE)
    if (bleed) {
      const n = parseMm(`${bleed[1]}${bleed[2] ?? ''}`)
      if (n !== null) {
        out.bleedMm = n
        continue
      }
    }
    const size = normalizeSize(kw)
    if (size) {
      out.sizeText = size
      continue
    }

    out.others.push(kw)
  }

  return out
}

/**
 * 品类：文件名**第一个 `_` 之前**的部分（`_` 之后是备注，不进卡片）。
 * 兼容全角下划线 `＿`（中文输入法很容易打错）。
 * 没有下划线就整名去掉扩展名；下划线在首位时也退回整名（否则会得到空标题）。
 */
export function tplTitleOf(fileName: string): string {
  const base = fileName.replace(/\.(psd|psb)$/i, '').trim()
  const i = base.search(/[_＿]/)
  const head = i > 0 ? base.slice(0, i).trim() : base
  return head || base
}

/** `_` 之后的备注（卡片上暂时不显示，留给 tooltip） */
export function tplNoteOf(fileName: string): string {
  const base = fileName.replace(/\.(psd|psb)$/i, '').trim()
  const i = base.search(/[_＿]/)
  return i > 0 ? base.slice(i + 1).trim() : ''
}

/**
 * 兜底：画布像素 ÷ ppi → 厘米。**算出来的是画布尺寸（含出血）**。
 * ppi 缺失或为 0 时返回 null（宁可不显示，也不显示错的数字）。
 */
export function physicalSizeText(
  width: number | null,
  height: number | null,
  ppi: number | null
): string | null {
  if (!width || !height || !ppi || ppi <= 0) return null
  const cmW = (width / ppi) * 2.54
  const cmH = (height / ppi) * 2.54
  if (!Number.isFinite(cmW) || !Number.isFinite(cmH)) return null
  return `${trimNum(cmW)}cm×${trimNum(cmH)}cm`
}

/** 色彩模式显示名：PSD 头的数字码 → 用户认得的词（与 `psdColorMode` 保持一致） */
export function colorModeText(mode: string | null): string {
  const m = (mode ?? '').toUpperCase()
  if (!m) return '—'
  return m
}
