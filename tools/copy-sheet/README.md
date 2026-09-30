# copy-sheet —— 文案字典的「在线表格」工作流

软件所有界面文案都在 `src/shared/copy.ts`（505 条）。这套脚本让你**不用改代码**、
在一张腾讯文档在线表格里改文案，然后一键落地。

- 在线表：**素材管家 · 文案清单** → https://docs.qq.com/sheet/DVEZIY0R6V1F6ZEJD
  - `file_id`：`TFHcDzWQzdBC`
  - `1-界面文案` `sheet_id`：`BB08J2`（483 条）
  - `2-默认数据` `sheet_id`：`c3qmog`（22 条）

---

## 一、日常怎么改文案（三步）

### 1. 在表上改

打开表，在 **`改成（你填这列）`** 列填新文案。规矩：

- **留空 = 不改**。只想改 20 条就只填 20 行。
- 表格里那条文案长什么样，就照着改——包括 `{name}` `{n}` 这种**花括号占位符别删**
  （它们会被真实值替换；删了软件就没法把名字填进去）。
- 尖括号 `<b>…</b>` `<code>…</code>` 是**加粗 / 等宽**的标记，可以整段删掉，也可以留着。
- **整列复制粘贴、批量查找替换都没问题**——不用只填改动过的行。
  工具会自动比对出"哪些是真变化"，把没改的那些当成"复制了一遍"忽略掉。

### 2. 让 AI 落地（说一句就行）

> 「表格改好了，落地一下」

AI 会依次跑：

```bash
node tools/copy-sheet/pull.cjs            # 读回在线表 → _sheet_read.json
node tools/copy-sheet/diff.cjs            # 比出真变化 + 自动标出"批量替换误伤"
node tools/copy-sheet/apply.cjs           # 干跑：只报告，不写
node tools/copy-sheet/apply.cjs --write   # 确认无误后写回 copy.ts（带自检）
```

`apply.cjs` 会做自检：条目总数不变、每条新值精确匹配、其余条目一字未动——
**任何一条不符就整份拒绝写回**，不会出现"改一半"的状态。

### 3. 验一遍（AI 负责）

```bash
npm run typecheck
node tools/copy-sheet/publish.cjs         # 重新导出并刷新在线表
# 然后重打 bundle + 跑验收 + 跑界面场景（见项目 README）
```

验收通过后，`publish.cjs` 会把在线表刷新成**最新状态**：
`现在的文案` 换成回填后的值、`改成` 列清空。**链接永远不变**，下次接着改。

---

## 二、publish.cjs —— 把字典刷回表里

```bash
node tools/copy-sheet/publish.cjs
```

等价于 `export.cjs`（`copy.ts` → 两份 CSV）+ `push.cjs`（CSV → 覆盖在线表 + 清空「改成」）。

**什么时候要跑**：每次文案落地之后。不跑的话，表里的「现在的文案」还是旧值，
你下次改的时候会分不清哪句是现状。

---

## 三、每个脚本干什么

### 3.1 工作流（改文案走的）

| 脚本 | 方向 | 说明 |
|---|---|---|
| `export.cjs` | `copy.ts` → CSV | 导出清单；「出现在哪」一列是从源码引用点的 AST 上下文**机械推断**的，不是手写 |
| `pull.cjs` | 在线表 → JSON | 读回两个子表全部单元格 |
| `diff.cjs` | JSON → 变更清单 | 比对「现在的文案」vs「改成」；**自动标出批量替换误伤**（标签配对 / 占位符结构变了但裸文字没变） |
| `apply.cjs` | JSON → `copy.ts` | AST 精确定位回填；默认干跑，`--write` 才落盘；带自检 |
| `push.cjs` | CSV → 在线表 | 分块写入（Windows 命令行 ~32KB 上限，484 行分 13 次），写完清空「改成 / 备注」 |
| `publish.cjs` | 上面两个的合体 | 一条命令刷新表 |

### 3.2 审计与验收（改完之后自查）

| 脚本 | 用途 |
|---|---|
| `audit-unused.cjs` | 统计「字典里定义了但源码没人引用」的条目。**理想值是 0** —— 大于 0 说明有文案没接线 |
| `audit-leftover.cjs` | 扫出字典里仍含某个字的条目。术语统一（如「包」→「任务」）之后用它复核有没有漏网的 |
| `verify-applied.cjs` | **文案改动的硬护栏**：拿改前/改后的两套整屏文字 dump，把改前的每一行按变更清单**正向替换**，看能否得到改后的行。能 → 该差异在清单里；不能 → 未预期变化。用法：`node verify-applied.cjs <改前dump目录> <改后dump目录>` |
| `verify-untouched.cjs` | **"没改文案的改动"的硬护栏**：两份 dump 必须逐字相同（掩掉时间戳）。用法同上。抽字典、换组件这类"只搬位置"的重构用它 |

**dump 从哪来**：`_shotapp/v4/main.cjs` 的 `shot()` 里有个开关 —— 设了
`SHOT_TEXT_DUMP=<目录>`，每张截图额外落盘 `innerText` + 全文字节点 `textContent`；
不设该变量时零行为。

```bash
export SHOT_TEXT_DUMP="D:/_accept_ws/_junk/dump_after"
for s in banner version wslist threelevel lifecycle missing tagcount category versions; do
  node _shotapp/run-verify4.cjs $s
done
```

---

## 四、坑（都是踩过的）

1. **`mcporter` 不能用 `bin/mcporter` 那个 sh 包装脚本**（内部调 `dirname`/`sed`/`uname`，
   Windows 下 spawn 必失败）。要起 `node .../mcporter/dist/cli.js`，
   且必须**异步 spawn + argv 数组**（`spawnSync`/`execFileSync` 在沙箱里一律 EBUSY）。
2. **`set_range_value_by_csv` 会跳过空单元格** —— 所以写完必须显式 `clear_range_cells`，
   否则上一轮的「改成」列残留，下次会被当成新改动读回来。
3. **跑测试/构建前先 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=20000`**：
   沙箱批量删除护栏按"本轮请求"累计（阈值 50），一轮里跑完构建 + 验收 + 场景必超。
   症状极具误导性：不是直接报护栏，而是**工作区被判"连不上"→ 断言大面积连锁 FAIL**。
4. **换行符**：本机 `core.autocrlf=true`，`git checkout` 落 CRLF、编辑工具落 LF。
   做"前后一字不差"比对时先归一换行符——换行符不是"用户看到的字"。
5. **改源码树只许 `copytree`，绝不许 `shutil.move`**（2026-09-30 真实事故：
   为做前后对照换源码版本，`rmtree` + `move` 把未提交的改动整份吃掉了）。
   动 `src` 前先落一份受保护快照到项目外。
