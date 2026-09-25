# 进度台账

> **AI 每次收工都要更新这个文件。** 这是跨会话协作的接力棒——下次开新会话，AI 读完它就等于接上了。

---

## 当前状态

- 阶段：**MVP 第 5 批「工作区管理与迁移」完成 ✅（2026-09-25）—— 多工作区 + 搬移已落地，待用户上手验收**
- 完成度：环境 100%；第 1 批 100%；项目管理增强 100%；第 2 批 4/4；第 3 批 100%；第 4 批 100%；**第 5 批 100%**；MVP 整体约 85%
- 原型目标（用户 2026-09-24 明确）：**先要能向领导汇报的原型**，不是先要扛得住量产的工具

## 已完成

- [x] 2026-09-23　需求文档定稿 → `docs/素材管家-需求文档.docx`
- [x] 2026-09-23　技术选型确定 → 见 `DECISIONS.md`
- [x] 2026-09-23　本机环境体检完成
- [x] 2026-09-24　项目目录确定：`D:\proj_media`
- [x] 2026-09-24　npm 镜像配置完成（淘宝源；缓存已迁至 `D:\npm-cache`）
- [x] 2026-09-24　Electron 镜像配置完成（用户环境变量 `ELECTRON_MIRROR`）
- [x] 2026-09-24　脚手架生成：electron-vite + React + TypeScript（`react-ts` 模板）
- [x] 2026-09-24　三份档案就位、`git init`、首次提交 `4f68199`
- [x] 2026-09-24　依赖安装完成（667 个包，`package-lock.json` 已生成）
- [x] 2026-09-24　Electron 二进制就位（`node_modules/electron/dist/electron.exe`，201 MB）
- [x] 2026-09-24　编译链路验证通过（main / preload / renderer 三段全部构建成功）
- [x] 2026-09-24　✅ **环境验收通过**：`npm run dev` 窗口弹出成功（Electron 39.8.10 / Chromium 142 / 内置 Node 22.22.1）
- [x] 2026-09-24　**入库功能方案定稿** → `docs/03-MVP入库功能方案.md`（经三轮讨论：包的概念 → 双面板 → 走法乙）
- [x] 2026-09-24　✅ **第 1 批代码完成**：A-01 ~ A-11 全部落地（详见下方会话日志）
- [x] 2026-09-24　✅ **第 1 批自动验收通过**：`node accept.cjs` 45 项断言全过；真实窗口截图验证界面正常、控制台零报错
- [x] 2026-09-24　✅ **项目管理增强完成**（用户中途插入需求）：项目可自建/编辑/真删，11 项新增断言并入回归（共 71 项全过）+ 老库迁移实测通过 + 界面截图验证通过
- [x] 2026-09-24　✅ **排序 + 左栏宽度完成**：项目上下箭头排序（83 项断言）；左栏默认 220px + 拖拽 170~420px 存 localStorage（提交 `c860100` / `20346ce` / `c050a0d`）
- [x] 2026-09-24　✅ **第 2 批步骤 1（图片元信息）完成**：DB 6 新列 + sharp 采集尺寸/色彩 + 列表直显，101 项断言全过 + 截图验证尺寸正确（提交 `0ebae98`）
- [x] 2026-09-24　✅ **第 2 批步骤 2（FFmpeg + 视频）完成**：ffmpeg.exe/ffprobe.exe 随包就位（LGPL 版）+ ffprobe 读时长/编码/尺寸/帧率 + ffmpeg 抽帧做视频缩略图 + 无 FFmpeg 时功能降级，**114 项断言全过** + 截图壳验证视频行信息与真缩略图（提交 `6fdf9d0`）
- [x] 2026-09-24　✅ **第 2 批步骤 4（PSD）提前完成**（用户提供真实样本 访学证.psd）：解析图像资源段取内嵌合成预览 + 文件头读画布尺寸/色彩模式，**127 项断言全过** + 截图壳验证 PSD 行显示预览图与 827×1181 · CMYK
- [x] 2026-09-24　✅ **第 2 批步骤 3（PDF）完成，第 2 批收官**：pdfjs-dist 渲染首页 + 页数入 probe_info，**137 项断言全过** + 截图壳验证 PDF 行（3 页 · 首页缩略图）。四类媒体全链路：图片 sharp / 视频 FFmpeg / PSD 内嵌预览 / PDF pdfjs
- [x] 2026-09-24　✅ **第 3 批「标签体系与检索」完成**（M2 核心）：tags/asset_tags 两表 + 预制标签 + 维度式筛选面板 + 标签管理弹窗 + 批量打标签弹窗（含自动建议）+ 文件行色块；**192 项断言全过** + 截图壳 7 图（提交 `56c2789`）
- [x] 2026-09-24　✅ **热修：点标签右侧筛选恒为空**：项目维度 tag id 负数编码未换算 `packs.project_id`，改 listAssets 拆负数/正数两路；197 项断言 + 截图复现用户操作（提交 `1ca2d6d`）
- [x] 2026-09-24　✅ **按用户拍板砍标签维度 5 → 3**（去掉「所属项目」「时间」，与项目面板/物料固有字段重复）；194 项断言（提交 `e26f270`）
- [x] 2026-09-24　✅ **项目面板去掉「N 包」个数**（用户：包以后会很多、不统计这个数）；提交 `3290ce6`
- [x] 2026-09-24　✅ **用户验收通过**：第 3 批标签体系与检索全部功能，确认可继续
- [x] 2026-09-25　✅ **第 5 批「工作区管理与迁移」完成**（A1 多工作区 + B2 指过去修路径/同盘搬移）：修掉 closeDb 从不调用的切换假切换 bug；配置升级 v2（老格式自动升级 + workspaceRoot 双写兼容旧版）；路径重写（旧根反推 + 两步走事务 + 自动备份到 `_system/backup/` + 逐文件自检）；左栏工作区列表（切换/添加/移除/搬移入口）；**275 项断言全过**（新增 57 项）+ 界面三场景（banner / version / wslist）零报错 + 截图人工确认

## 待办

- [x] ~~第 4 批 打包交付~~（2026-09-25 完成，见下方会话日志）
- [x] ~~第 5 批 工作区管理与迁移~~（2026-09-25 完成，方案见 `docs/07`）
- [ ] **用户装机验收**：把安装包拿到一台没有开发环境的电脑装一遍，按 `docs/06` 第 9 节 8 个检查点过（AI 只能验到"能生成、能装、装上能用"，最后一关必须人来）；装好后顺手把多工作区 / 搬移也点一遍
- [x] ~~清理构建垃圾~~（2026-09-25 完成，**实际释放 15.4 GB**，比预估的 4 GB 多得多）：`release/`（1023 MB）、`release_pkg/`（1351 MB）、`release_pkg2/`（4538 MB）、`release_pkg3/`（8878 MB）已整目录删除。**关键**：沙箱删除护栏在提权（escalation-approved）后不再拦，`shutil.rmtree` 一次全清；正式产物在 `D:\_accept_ws\rel_out` 未受影响
- [ ] 图标替换（拿到 logo 后换 `build/icon.ico` 重出包，约 10 分钟）
- [ ] 代码签名（要不要买证书，约 1000–3000 元/年，用户拍板）
- [ ] 第 3 批遗留：时间维度标签自动生成未接扫描、自动建议快捷按钮未挂
- [ ] 第 6 批：方向见 `NEXT.md`（M6 版本管理 / M5 素材交付打包 / 一键备份 / 进度条与性能）
- [ ] 重出安装包：第 5 批改动尚未打进安装包（`D:\_accept_ws\rel_out` 里还是第 4 批的版本）——等用户验收完界面或攒到图标一起重出

## 下一步（下次开工从这里开始）

**第 6 批：待用户拍板具体方向。** 候选见 `NEXT.md` 第三节。

若用户未指定，默认建议优先级：

1. **M6 版本管理**（需求文档 5.6 节）—— 但要先跟用户定「版本怎么产生」（扫描自动识别 vs 手动挂），文档没写，必须先问
2. **M8-04 一键备份完整版** —— 第 5 批把"搬移"做了，备份（跨盘复制 + 进度）是同一族功能的最后一块
3. 其他用户新提出的需求

注意（复用坑）：
- AI 沙箱里 node 的 **spawnSync 全部 EBUSY**，外部命令一律用异步 spawn
- `out/test/*.cjs` 是 esbuild 独立产物，**改 `src/main` 后必须重打**（accept.cjs 和 ipc.cjs 两个都要）；`npm run build` 会清掉 out/test/，之后要重新补打
- 截图壳 `_shotapp/v4` 的场景工作区全部指向 `D:/_accept_ws/shot*`，**绝不与用户真实工作区 `D:/素材工作区` 共用**

## 已知问题与风险

| 问题 | 影响 | 状态 |
|---|---|---|
| **better-sqlite3 不需要 electron-rebuild** | v13 起用 N-API 预编译二进制（`prebuilds/win32-x64.node`），Electron 下直接可用；旧台账"必须重编译"的结论作废，且本机无 Visual Studio 也编译不了 | ✅ 已实测确认（2026-09-24） |
| 本机有两个 Node 版本（系统 v24.21.0 / 内置 v22.22.2） | 排查"这边能跑那边报错"时留意 | 已知 |
| npm 11 禁止用 `config set` 写非标准配置项 | 曾导致 Electron 镜像配置报错，已改用用户环境变量 | 已解决 |
| C 盘空间紧张（剩 34 GB） | 已通过 npm 缓存外迁到 D 盘缓解 | 已解决 |
| FFmpeg 未安装 | 第 2 批（视频抽帧）前必须补 | 延后处理 |
| **AI 沙箱里跑 Electron 会被拦** | AI 的 shell 带 `ELECTRON_RUN_AS_NODE=1`（Electron 退化成纯 Node）且 GPU 不可用；用户自己双击/终端跑不受影响。AI 验证界面用 `_shotapp/`（内含禁用 GPU 的测试壳） | 已解决（有绕行方案） |
| 正式应用已全局禁用 GPU 硬加速 | 缩略图走 sharp（CPU），界面软件渲染足够；任何显卡有问题的办公机都能稳启动，演示不翻车 | ✅ 有意为之 |

---

## 会话日志

### 2026-09-23（第 1 次会话）

- **做了什么**：
  - 梳理需求，输出 8 大模块 60+ 条需求
  - 完成技术选型（Electron + React + TS + SQLite）
  - 本机环境全面体检（Node / Git / VS Code / 镜像速度）
  - 确立跨会话 AI 协作方式（档案法）
- **产出文件**：
  - `素材管家-需求文档.docx`
  - `docs/01-长周期开发-AI协作手册.md`
  - `docs/02-开发环境搭建手册.md`
- **遇到的问题**：无
- **下一步**：配置 npm 镜像 → 定项目目录 → 建脚手架

### 2026-09-24（第 2 次会话）

- **做了什么**：
  - 项目目录确定为 `D:\proj_media`
  - 配好 npm 镜像（淘宝源）与缓存位置（`D:\npm-cache`）
  - 解决 npm 11 拒绝写入 `electron_mirror` 的报错 —— 改用用户环境变量
  - 生成 electron-vite + React + TypeScript 脚手架
  - 安置三份档案与 `docs/`，`git init` 并完成首次提交
- **改了哪些文件**：脚手架生成的全部文件；新增 `PROJECT.md` / `PROGRESS.md` / `DECISIONS.md` / `docs/`
- **遇到的问题**：`npm config set electron_mirror` 在 npm 11 下报 `not a valid npm option`
- **验收结果**：✅ 窗口弹出成功（Electron 39.8.10），环境阶段完结
- **下一步**：开新会话做 MVP 第一功能 —— 素材入库

### 2026-09-24（第 3 次会话）

- **做了什么**：
  - 读三份档案接上进度，核对需求文档 M1 全部 11 条、M2 五维度、7.4 节六张表设计
  - 出入库功能方案 → 用户提出**重大调整：入库单元从「文件」改成「任务包」**
  - 逐轮讨论：包的概念 → 包从哪来（先建包 vs 扫出来）→ 双面板 → 走法甲/乙
  - **用户拍板：走法乙**（第 1 批就立「包」为核心对象），理由是要先拿到**能向领导汇报的原型**
  - 方案定稿落文档 → `docs/03-MVP入库功能方案.md`
- **改了哪些文件**：
  - 新增 `docs/03-MVP入库功能方案.md`（方案定稿，含 4 处与需求文档的冲突清单）
  - `PROJECT.md`：重写「包」核心概念、入库施工顺序改 4 批、技术栈加"素材工作区"
  - `DECISIONS.md`：新增 3 条决策（包进第 1 批 / 归类按文件夹不按后缀 / 未归属池）
  - `PROGRESS.md`：本文件
  - **未写任何业务代码**（铁律第 ①②③ 步）
- **遇到的问题**：需求文档 8.1 节把包的核心能力（M6 版本、M5 交付）划在第二步，与"第 1 批立包"冲突 → **已在方案文档 8 节列明，属明知而接受的债务**，第二步做 M6 时回来补
- **验收结果**：方案待用户确认（已口头同意走法乙）
- **下一步**：开新会话写第 1 批代码，先 `npx electron-rebuild`

### 2026-09-24（第 4 次会话）

- **做了什么**：
  - 装依赖 `better-sqlite3@13` + `sharp@0.35`；**实测发现 better-sqlite3 用 N-API 预编译、无需 electron-rebuild**（无 Visual Studio 也能跑），旧风险结清
  - 写第 1 批全部代码（A-01 ~ A-11）：
    - 主进程：`db.ts`（packs/assets 两表）、`workspace.ts`（建包/扫描归位/认领/查询）、`thumbs.ts`（sharp 缩略图）、`ipc.ts`（全部 ipcMain.handle）
    - 通信：preload 用 `contextBridge` 暴露 invoke 接口（遵守方案 6.1，不用 send）
    - 界面：`App.tsx` 双面板主框架 + `PackCard`/`FileRow`/`NewPackModal`/`PackDetailModal`，手写深色 CSS
    - 共享类型抽到 `src/shared/types.ts`（三端同一份）
  - 自动验收：`accept.ts` 按方案 5.3 节主线写 45 项断言，**全部通过**（含"归类按文件夹不按后缀""软件不悄悄扔文件"两条铁则校验）
  - 界面验证：`_shotapp/` 测试壳启动真实窗口截图——包视图/文件视图/新建包弹窗全部正常渲染，控制台零报错
  - 正式应用加 `app.disableHardwareAcceleration()`（缩略图走 CPU，禁 GPU 换取任何机器都能稳启动）
- **改了哪些文件**：
  - 新增 `src/main/db.ts` / `src/main/workspace.ts` / `src/main/thumbs.ts` / `src/main/ipc.ts`
  - 新增 `src/shared/types.ts`、`src/renderer/src/components/{PackCard,FileRow,NewPackModal,PackDetailModal}.tsx`、`src/renderer/src/types.ts`
  - 新增 `accept.ts`（回归验收脚本）、`_shotapp/`（界面测试壳）
  - 重写 `src/main/index.ts` / `src/preload/index.ts` / `src/preload/index.d.ts` / `src/renderer/src/App.tsx` / `src/renderer/src/assets/main.css`
  - `package.json`：+better-sqlite3、+sharp
  - 归档更新：`PROGRESS.md` / `DECISIONS.md` / `PROJECT.md`
- **遇到的问题**：
  - `electron-rebuild` 报"找不到 Visual Studio" → 查明 v13 预编译二进制可直接用，问题不存在
  - AI 沙箱环境 `ELECTRON_RUN_AS_NODE=1` + 无 GPU，Electron 退化成纯 Node → 用 `_shotapp`（unset 变量 + 禁 GPU + 软件渲染）绕行完成界面验证；用户本机正常跑不受影响
  - AI 沙箱的"批量删除护栏"会拦 `npm run dev/preview`（Vite 清 out/ 目录触发）→ 用户本机不受影响；AI 侧验证改用直接跑构建产物
- **验收结果**：✅ 45 项断言全过 + 真实窗口截图验证通过。**待用户上手按 5.3 节主线实际操作一遍**
- **下一步**：用户上手验收 → 第 2 批（视频/PDF/PSD 缩略图，先装 FFmpeg）

### 2026-09-24（第 5 次会话）—— 项目管理增强（用户中途插入需求）

- **做了什么**：
  - 用户提出：左栏「所属项目」不能只有预制项目，要能自己新建（公司开新业务 / 内部孵化新项目）
  - 三个设计取舍经用户确认：**删除=能真删但需确认（有包时指定去向）**；**建包弹窗不加新建项目入口（只在左栏建）**；**项目颜色要，且用户自己挑**
  - （同会话续）用户再提小调整：**项目要能自己调上下顺序** → 用户选「上下箭头微调」方案，含义定为**纯左栏显示顺序**（不影响默认归属）；实现 `moveProject`（相邻交换 sort_order，边界静默不动，老库全 0 顺序自动固化）+ 左栏悬浮 ↑↓ 按钮（首位 ↑ / 末位 ↓ 置灰）；新增 12 项排序断言（互换、可逆、边界、持久化、幽灵 ID），总数 83 全过；界面截图验证箭头点击换位成功、控制台零报错
  - （同会话续）用户反馈**左栏太窄**（名称只显示 4 字、悬浮按钮压住文字）→ 两个都做：默认宽 168→220px；**右缘拖拽条**（原生鼠标事件，不引库）可拉 170~420px，宽度存 localStorage 记忆，双击复位；悬浮按钮组改为「让位」方案（文字区右缩 96px + 包数隐藏），按钮永不压字；用 Chromium 真实鼠标事件（sendInputEvent）验证 hover 几何无遮挡、拖拽/钳制/持久化/复位全过，控制台零报错
  - 数据层：新增 `projects` 表（name/color/note/sort_order/archived），`packs.project` 文本列升级为 `project_id` 外键；写幂等迁移（老库自动建表、按旧项目名搬迁回填、包归属不丢），空库落 3 个预制项目
  - 业务层：项目 CRUD 五个函数（列表带包数、建、改、删）；**删项目铁则——包永不跟着消失**，要么转移给别的项目、要么变「未归属」；拒绝删掉最后一个项目
  - 界面层：左栏项目行带色点 + 悬浮出 ✎/✕ 小按钮 +「＋ 新建项目」；`ProjectModal`（新建/编辑，10 色色块自选、重名拦截）；`DeleteProjectModal`（无包直接确认；有包给二选一去向）；包卡片/详情的项目标签用项目配色；`NewPackModal` 项目下拉改读 projects 表
  - 修了两个真 bug：`idx_packs_project` 索引建在新库无 `project_id` 时会崩（移出建表块）；`uniqueFolderPath` 只查磁盘不查库，DB 残留记录触发 UNIQUE 冲突（改为同时查两者）
  - 自动验收：`accept.ts` 扩到 **83 项断言全过**（新增项目 CRUD、删项目铁则、老库迁移、项目排序），工作区改用每次全新的 `D:\_accept_ws\run_<ts>` 规避沙箱删除护栏
  - 界面验证：截图壳驱动态真实 UI 走完整流程——新建项目（选色）→ 悬浮出按钮 → 编辑回填 → 删除空项目 → 删有包项目出二选一 → 新建包下拉带出全部项目；**11 张截图 + 控制台零报错**
- **改了哪些文件**：
  - `src/main/db.ts`（projects 表 + 迁移 + PROJECT_COLORS/pickColor）、`src/main/workspace.ts`（项目 CRUD + createPack 收 projectId + uniqueFolderPath 修 bug）、`src/main/ipc.ts`（project:list/create/update/remove + ws:info 带 projects）
  - `src/shared/types.ts`（+Project/ProjectWithCount，PackCard 改 project_id/projectName/projectColor）
  - `src/preload/index.ts` / `src/preload/index.d.ts`、`src/renderer/src/types.ts`
  - `src/renderer/src/App.tsx`（项目面板重写）、新增 `components/ProjectModal.tsx` / `components/DeleteProjectModal.tsx`
  - `components/PackCard.tsx` / `PackDetailModal.tsx` / `NewPackModal.tsx`（配色 + projectId）、`assets/main.css`（新样式类）
  - `accept.ts`（71 断言）、`_shotapp/main.cjs`（重写为项目管理验证流）
  - 归档更新：`PROGRESS.md` / `DECISIONS.md` / `PROJECT.md`
- **遇到的问题**：
  - 截图壳第一版找不到新项目的 `.mini` 按钮 → 根因是按钮只在 React hover state 为真时才渲染，DOM 派发 `mouseover` 需带 `bubbles: true` 才能触发 React 合成事件；改为先 `body` 上派发移开焦点再对目标行派发，稳定复现
  - 其余坑均已在第 4 次会话记录过（沙箱 ELECTRON_RUN_AS_NODE / GPU / 删除护栏），本次直接沿用绕行方案
- **验收结果**：✅ 71 项断言全过 + 老库迁移实测通过（包归属不丢）+ `npm run build` 成功 + 界面截图全流程验证通过（控制台零报错）。**待用户上手验收**
- **下一步**：用户上手验收 → 第 2 批（视频/PDF/PSD 缩略图，先装 FFmpeg）

### 2026-09-24（第 6 次会话）—— 第 2 批开工：排序收尾 + 左栏宽度 + 图片元信息

- **做了什么**：
  - **项目排序**（用户中途需求）：左栏上下箭头微调显示顺序，纯显示不影响默认归属；`moveProject` 相邻交换 sort_order，边界静默，老库全 0 自动固化（提交 `c860100`）
  - **左栏宽度**（用户反馈太窄）：默认 168→220px + 右缘拖拽条 170~420px 存 localStorage，双击复位；悬浮按钮组改「让位」（文字右缩 96px）不压字；用 `sendInputEvent` 真实鼠标事件验证 CSS hover 几何（提交 `20346ce`）
  - **第 2 批方案定稿** → `docs/04-MVP缩略图与媒体信息方案.md`（B-01~B-05）；用户三处拍板：**FFmpeg 随软件打包** / **PSD 做（用户给样本）** / **信息列表直显**
  - **第 2 批步骤 1（图片元信息）完成**：
    - `db.ts` 迁移 4：assets 补 6 列（`width/height/color_mode/duration_ms/video_codec/probe_info`），逐列 `PRAGMA table_info` 判断，幂等
    - `thumbs.ts` 加 `readImageMeta()`（sharp metadata → 尺寸 + 可读色彩模式 RGB/RGBA/灰度/CMYK），损坏文件降级 null；`enrichAllImageMeta()` 全库补齐 + `ensureImageMetaForAssets()` 定点补齐；txt 等非图片不赋值
    - 双补齐路径：启动时后台 `void enrichAllImageMeta()` + `scan:refresh` 返回前补齐
    - `FileRow.tsx` 信息行重构：`尺寸 × 色彩 · 时长 · 编码 · 体积 · 时间`（`buildMetaLine()`），体积从行末挪进 meta 行
    - `accept.ts` 扩到 **101 项断言全过**（6 列存在 / 已知尺寸 137×89 正确 / RGB / 幂等二次 0 个 / 损坏文件降级 / txt 不赋值 / 老库自动补列数据不丢）
    - 截图壳验证：造 `横版海报-1920x1080.png` / `竖版素材-800x1200.png` 样本 → 点界面「刷新扫描」走完整 IPC → 信息行抓到 `800×1200 · RGBA · 22 KB` / `1920×1080 · RGB · 31 KB`，**尺寸交叉核对 OK，控制台零报错**
- **改了哪些文件**：
  - `docs/04-MVP缩略图与媒体信息方案.md`（新增）
  - `src/main/db.ts`（迁移 4 + AssetRow 6 字段）、`src/main/thumbs.ts`（readImageMeta/enrich 系）、`src/main/index.ts`（启动补齐）、`src/main/ipc.ts`（scan:refresh 补齐）
  - `src/shared/types.ts`（AssetItem 5 字段）、`src/renderer/src/components/FileRow.tsx`（buildMetaLine）、`src/renderer/src/assets/main.css`（.fp flex 化）
  - `accept.ts`（[12] 段 18 项断言）、`_shotapp/main.cjs`（步骤 9 排序 + 步骤 10 信息行）、`_shotapp/side.cjs`（新增，宽度专项）
  - `.gitignore`（shot 产物 / tsbuildinfo 等）
  - 归档更新：`PROGRESS.md` / `DECISIONS.md`
- **遇到的问题**：
  - **截图壳 require `out/test/thumbs.cjs` 报「数据库尚未初始化」**：独立打包的 thumbs 包持有自己的 db 单例，与 workspace.cjs 不是同一个 → 修复：截图壳不直接调函数，改点界面「刷新扫描」按钮走完整 IPC（与真实用户操作一致）
  - `hover geometry overlap` 假阴性：JS 派发 mouseover 不触发 CSS `:hover` 伪类 → 必须用 `webContents.sendInputEvent` 真实鼠标事件
  - 注入脚本 `Unexpected token '...'`：JS ASI 坑（上行函数调用 + 下行 `[...arr]` 展开）→ `Array.from()` 中转
  - TS6133：ipc.ts 误 import 未使用的 `readImageMeta` → 移除
- **验收结果**：✅ 101 项断言全过 + `npm run build` 成功 + 截图壳全流程验证（排序换位/信息行尺寸/控制台零报错）
- **下一步**：第 2 批步骤 2 —— FFmpeg 随包 + 视频缩略图/信息

### 2026-09-24（第 6 次会话续）—— 第 2 批步骤 2：FFmpeg + 视频全链路

- **做了什么**：
  - **FFmpeg 就位**：BtbN `ffmpeg-master-latest-win64-lgpl.zip`（172 MB）下载校验 → 提取 `ffmpeg.exe`/`ffprobe.exe`/`LICENSE.txt` 到 `resources/ffmpeg/`（267 MB，exe 不入 git，README 记录重建方式）；package.json 配 electron-builder `extraResources`（打包后位于 `<安装目录>/resources/ffmpeg`）
  - **thumbs.ts 扩展视频支持**（保持不依赖 electron，路径注入）：
    - `setFfmpegDir()` + 环境变量 `MEDIA_FFMPEG_DIR` 兜底（测试壳 bundle 里 thumbs 副本拿不到显式注入）
    - `runCmd()`：spawn 封装，超时杀进程，绝不挂死主进程
    - `readVideoMeta()`：ffprobe JSON 读时长/编码/宽高/fps/音频编码/总码率 → `ensureVideoMetaForAssets()` 定点补齐 + `enrichAllVideoMeta()` 启动补齐，幂等
    - `ensureVideoThumb()`：`ffmpeg -ss 1 -vframes 1` 抽帧缩 320 宽 jpg，短视频自动回退 `-ss 0` 重试
  - **集成**：`ensureThumbsForAssets` 按扩展名分派（图片走 sharp / 视频走 ffmpeg）；`scan:refresh` 补视频信息；`view:assets`/`view:packDetail` 缩略图读取改为「有 thumb_path 直接读」——修复视频缩略图读不出（原来按素材扩展名 isImage 判断，mp4 被排除）
  - **index.ts**：`locateFfmpegDir()`（dev=项目根 / packaged=process.resourcesPath）+ 启动补视频信息
  - **验收**：accept.ts 加 [13] 段视频断言 → **114 项全过**（真视频 2 秒 mp4：时长 2000ms、h264、320×240、probe_info 含 fps；幂等二次 0 个；抽帧落盘 .jpg；**假视频降级** duration_ms=null 不崩；**摘掉 FFmpeg 整体降级**返回 0）
  - **截图壳**：FFmpeg 造横版 640×360 3 秒 + 竖版 360×640 2 秒测试视频 → 视频行显示 `640×360 · 00:03 · h264`，两个视频都渲染**真抽帧缩略图**（hasImg:true），图片尺寸交叉核对保持 OK，控制台零报错
- **遇到的问题（3 个连环坑）**：
  - **LGPL 版不含 libx264**（GPL 库）→ 测试视频生成报 `Unknown encoder 'libx264'`。改用 **libopenh264**（BSD 许可，LGPL 版自带，codec 名同为 h264，断言不用改）。真实用户场景不受影响：H.264/HEVC **解码**不受 GPL 限制
  - **AI 沙箱 node 的 spawnSync 一律 EBUSY**（连 ping / node 自己都派生失败），异步 spawn 正常 → accept.ts 与截图壳里跑 ffmpeg 一律改异步 spawn + 超时兜底。**用户本机不受任何影响**（正式应用两种都行）
  - **下载 172 MB 中途被杀** → curl `-C -` 断点续传补完 + zip testzip 校验
- **验收结果**：✅ 114 项断言全过 + `npm run build` 成功 + 截图壳视频行验证（信息/缩略图/零报错）
- **下一步**：第 2 批步骤 3 —— PDF 首页缩略图

### 2026-09-24（第 6 次会话续 2）—— 第 2 批步骤 4（PSD，用户给真实样本后提前做）

- **做了什么**：
  - **真实样本分析**（`C:\Users\30873\Desktop\访学证.psd`，25 MB）：PSD 头 8BPS v1 / 通道 4 / **827 宽 × 1181 高（竖版）** / 8 位 / CMYK；图像资源段 29 块，id 1036 含 2219 字节合成预览（头 28 字节 + JPEG 2191 字节，112×160）
  - **thumbs.ts 加 PSD 支持**（零新依赖，纯手写解析）：
    - `readPsdMeta()`：只读 26 字节头拿画布尺寸/色彩模式（mode 代码→中文：RGB/CMYK/灰度/Lab/位图/索引…）；**合理性校验**版本(1/2)、通道(1-56)、位深(1/8/16/32)、尺寸(≤30万)——文本冒充的假文件直接拒
    - `extractPsdPreviewJpg()`：解析颜色模式段→图像资源段→遍历 8BIM 块，id 1036 优先 / 1033 回退，取 28 字节头后的 JPEG（ffd8ff 签名验证 + ffd9 结尾截断）
    - `ensurePsdThumb()`：预览 JPG → sharp → 320 宽 webp（withoutEnlargement，预览本身才 160px 不放大糊化）
    - `ensurePsdMetaForAssets()` + `enrichAllPsdMeta()` 双补齐路径，幂等
  - **集成**：`ensureThumbsForAssets` 三路分派（图片 sharp / 视频 ffmpeg / PSD 内嵌预览）；`scan:refresh` 补 PSD 元信息；index.ts 启动补 PSD
  - **验收**：accept.ts [14] 段 → **127 项全过**（真实样本：宽 827/高 1181/CMYK/预览 2191 字节可解码/缩略图落盘；假 PSD 登记不崩元信息 null；幂等二次 0 个）
  - **截图壳**：复制用户样本进演示包 → PSD 行显示 `827×1181 · CMYK · 25 MB` + 内嵌预览缩略图（hasImg:true），控制台零报错
- **遇到的问题**：
  - **PS 写的 1036 头 compression 字段=0，不符合规范宣称的 JPEG=1** → 首版按 comp===1 校验导致预览提取失败（0 字节）。教训：**别信头字段，只认数据区 JPEG 签名**（ffd8ff@28）
  - **宽高期望写反**：PSD 头 14 处是行数（高 1181）、18 处是列数（宽 827），样本是竖版——第一眼看预览图误判为横版。以文件头实测为准修正断言
  - **假 PSD 误读**：'8BPS 这不是真 PSD' 开头恰好能过签名，头部尺寸读到文本字节 → 加版本/通道/位深/尺寸四重合理性校验拦截
- **验收结果**：✅ 127 项断言全过 + `npm run build` 成功 + 截图壳 PSD 行验证（预览图/信息行/零报错）
- **下一步**：第 2 批步骤 3 —— PDF 首页缩略图（第 2 批最后一块）

### 2026-09-24（第 6 次会话续 3）—— 第 2 批步骤 3（PDF），第 2 批收官

- **做了什么**：
  - **选型一波三折**：最初倾向 mupdf（渲染质量高、单包 14MB）→ 用户拍板 mupdf 后**核查许可证发现是 AGPL-3.0**（强传染：分发需整体开源或买 Artifex 商业授权）→ 再次请示用户 → **换 pdfjs-dist（Apache-2.0）+ @napi-rs/canvas（MIT）**。教训：**npm 装包前必须先看 license 字段**，功能再好许可不对就不能进代码
  - **thumbs.ts 加 PDF 支持**：`ensurePdfThumb()`（pdfjs legacy build 渲染第 1 页 → @napi-rs/canvas 画布白底 → sharp 转 webp 320 宽，画布最长边封顶 1600 防超大页）；`ensurePdfMetaForAssets()`（页数 → probe_info JSON {"pages":N}；**页面是 pt 单位，不写 width/height 免误导**）；`enrichAllPdfMeta()` 启动补齐
  - **界面**：AssetItem 加 probe_info；FileRow 信息行显示「N 页」
  - **打包配置**：package.json `asarUnpack` @napi-rs/canvas 与 pdfjs-dist（原生 .node 二进制与 wasm 不能在 asar 里加载）
  - **验收**：accept.ts [15] 段（手工 makePdf 造 3 页 PDF）→ **137 项全过**（页数 {"pages":3}、缩略图落盘 ≤320 宽、假 PDF 降级、幂等）
  - **截图壳**：造 3 页演示 PDF → PDF 行显示 `3 页 · 937 B` + pdfjs 渲染的首页缩略图，四类媒体同屏（图片/视频/PSD/PDF），控制台零报错
- **遇到的问题**：
  - pdfjs v6 类型变化三连：`isEvalSupported` 参数已移除；`RenderParameters` 新增必填 `canvas`；文档清理用 `loadingTask.destroy()`（doc.destroy 不存在）—— 查 types/src/display/api.d.ts 核对
  - @napi-rs/canvas 的 ctx/canvas 类型与 DOM 不完全一致（缺 drawFocusIfNeeded 等 316 项）→ `as unknown as` 断言绕过（结构兼容渲染够用）
  - pdfjs-dist 读损坏/非 PDF 文件会打印 "Indexing all PDF objects" 警告（正常，走的降级恢复路径）
- **验收结果**：✅ 137 项断言全过 + typecheck 0 错误 + `npm run build` 成功 + 截图壳四类媒体同屏验证
- **下一步**：**第 2 批完结**。用户上手验收 → 第 3 批方向（标签 / M6 版本 / 打包交付）

---

### 2026-09-24（第 6 次会话续 4）—— 第 3 批：标签体系与检索（M2 核心）完结

- **做了什么**（用户验收通过第 2 批后开工；两处拍板：一次做全 5 个维度 / 列表勾选批量打标签）：
  - **方案定稿**：`docs/05-MVP标签与检索方案.md`（C-01~C-08 需求 → 两表结构 → 5 维度定义 → 界面 → 施工 5 步 → 验收标准）
  - **数据层**：db.ts 加 `tags`/`asset_tags` 两表 + 4 索引；迁移 5（空库落预制标签：类别 9 / 渠道 6 / 状态 4，跳过 project/time 维度）；`TAG_DIMENSIONS` 常量（5 维度含 presets/colors/hint/mode）；**项目维度不落 tags 表，实时映射 projects 表，tag id 用负数编码（-projectId）**避免两处维护
  - **业务层**：新文件 `src/main/tags.ts`（listTagDimensions/createTag/updateTag/tagUsage/removeTag/applyTags/removeTagsFrom/tagsOfAssets/suggestTagsForAssets）；`applyTags` 先清同维度旧标签再贴（批量整理直觉）；`suggestTagsForAssets` 按文件名/路径匹配，**只推荐不自动贴**，单字标签跳过
  - **筛选 SQL**：listAssets 支持 tagIds —— 同维度内「或」、跨维度「并且」（`GROUP BY a.id HAVING COUNT(DISTINCT t.dimension) = @dimCount`）
  - **IPC/类型**：9 个 `tag:*` 通道 + preload 暴露；共享类型 Tag/TagWithCount/DimensionGroup/ApplyTagsResult/SuggestTagsResult；AssetItem 加 tags 字段
  - **界面**：左栏改**维度式面板**（5 维度折叠/已选徽标/一键清除，项目维度并入其中）；标签管理弹窗（4 可维护维度切换/加标签/改名/改色/用量提示删除）；批量打标签弹窗（5 维度全展/单选维度自动替换/自动建议★标/一键全选建议）；文件行标签色块（带×可摘除）；claimbar 加「🏷 打标签」按钮
  - **验收**：accept.ts 新增 [16]~[21] 六段 55 项断言 → **192 项全过**；截图壳第 14 段 7 图（面板/筛选/勾选/弹窗/已选/贴完/管理）全过，库内直查 6 条关联正确
- **遇到的问题**：
  - db.ts `TAG_DIMENSIONS` 引用了声明在后面的 `PROJECT_COLORS`（TS2448）→ 把配色池上移到维度常量前
  - accept.ts 新段落变量 `dup`/`upd` 与 [0] 段重名 → 改名 dupTag/updTag
  - 截图壳第一次跑「row tag chips 只显示海报不显示抖音」→ 排查是**旧库残留脏数据**（上次会话的测试行只贴了海报），重置工作区库后 6 条关联完全正确，代码本身无 bug
  - heredoc 写 TS 探针被 shell 展开 `${...}` → 改用 Write 工具（再次踩，牢记）
- **提交**：`56c2789`
- **下一步**：第 3 批收尾（时间维度自动生成还没接 scanAll；自动建议入口已有但未挂「建议」快捷按钮）→ 或直接进第 4 批（M6 版本 / 打包交付，见 DECISIONS）

---

### 2026-09-24（第 6 次会话续 5）—— 热修：点项目维度标签右侧筛选恒为空

- **用户实测报障**：激活「集团通用」标签（徽标显示 7），右侧面板空白。确认为 BUG 非误操作
- **根因**：项目维度的 tag id 是负数编码（-projectId），`listAssets` 拿它直接查 tags 表（无负数 id）→ 必然 0 行。项目维度本应换算成 `packs.project_id` 过滤，接线时漏了；验收只测了正向标签，此路径漏测
- **修复**：`listAssets` 把 tagIds 拆成负数（→ WHERE k.project_id IN）与正数（→ 原联表 + HAVING），项目维度与标签维度可跨维度「并且」；accept.ts [20] 补 4 项断言（197 项全过）；截图壳 14.0 挂包到「集团通用」复现用户操作 → 点标签右侧 7 条
- **教训**：
  1. **编码过的 id（负数映射）必须在业务层统一拆解**，不能指望调用方自觉拆参
  2. **截图壳/验收用的 out/test/*.cjs bundle 是独立产物**，改了 src/main 后必须重打（esbuild 输出吞进 /dev/null 会把失败静默成「跑旧 bundle」）；验证 bundle 新旧要 grep 运行时特征串（如 `@tp$`），别 grep 注释
  3. **截图壳绝不能再与用户真实工作区共用**（_shotapp/_userdata/workspace.json 已改指 D://_accept_ws//shot_ws）——此前共用 D://素材工作区，调试时重置过库，幸运未伤用户数据
- **提交**：`1ca2d6d`

---

### 2026-09-24（第 6 次会话续 6）—— 用户拍板：维度砍到 3 个；项目面板数字加单位

- **用户反馈两件事**：
  1. 项目面板「集团通用 1」vs 右侧 7 条文件 —— 不是 bug，是数字没标单位（1 = 1 个包，7 = 包里的文件数）。处理：项目面板所有数字加「包」字（全部 2 包 / 集团通用 1 包 / 未指定项目 N 包）
  2. **拍板砍掉「所属项目」「时间」两个标签维度** —— 项目与左栏项目面板重复；时间是物料固有字段（信息行已显示）。维度从 5 → 3（物料类别 / 使用渠道 / 状态）
- **改动**：db.ts（DimensionKey/DimensionDef 砍 project/time、删 source 字段、迁移 5 直落 3 维度）；tags.ts（listTagDimensions 删 projects 映射分支、suggestTags 删项目名匹配）；渲染层清理残留；listAssets 保留负数 id 兼容（accept [20] 兜底）
- **验收**：194 项断言全过；截图壳 3 维度 + 「1 包」单位验证通过
- **提交**：`e26f270`
- **下一步**：等用户验收；之后第 4 批（M6 版本 / 打包交付）

---

### 2026-09-24（第 6 次会话续 7）—— 项目面板去掉「N 包」个数

- **用户拍板**：包以后会很多、也不统计这个数据 → 项目面板（全部 / 各项目 / 未指定项目）右侧的「N 包」全部去掉。上一条「加包单位」被本条反转（上线 1 小时内）
- **改动**：App.tsx 三处数字删除、`noProjectCount` 改 `hasNoProjectPacks`（some 布尔）、`currentProjectLabel` 不再拼包数；main.css `.proj-item` 常态 padding-right 26→8、删 hover 隐藏 .n 规则。筛选区「未归属 / 全部文件」的文件数保留（那是文件统计不是包数）
- **验收**：typecheck 0 错、构建过、截图壳断言 b3 proj panel no count（正则扫左栏无「N 包」泄漏）+ 截图确认、控制台零报错
- **提交**：`3290ce6`

---

<!-- ============ 下面是空白模板，以后每次会话复制一份填 ============

### YYYY-MM-DD（第 N 次会话）

- **做了什么**：
- **改了哪些文件**：
- **遇到的问题**：
- **下一步**：

================================================================= -->
