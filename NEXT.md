# 下次开工 · 启动提示词

> 换新会话时，把下面 **第一段**（复制框里的内容）整段发给 AI 即可。
> 括号里的 `【】` 是你要替换的部分。

---

## 一、标准启动词（直接复制）

```
开工。项目在 D:\proj_media（素材管家，Electron + React + TS 桌面素材管理软件）。

先读这三个文件，读完再动手：
1. D:\proj_media\PROJECT.md    —— 项目定位、技术栈、协作铁律
2. D:\proj_media\PROGRESS.md   —— 进度台账（当前状态 / 已完成 / 下一步）
3. D:\proj_media\DECISIONS.md  —— 历史决策，不要推翻已验证的结论

读完向我复述三件事，等我确认后再开写：
① 现在做到哪了
② 下一步该做什么、要改哪些文件
③ 有没有需要我先拍板的地方

铁律（PROJECT.md 里有完整版）：
- 开发新功能模块前必须先出方案给我看，我确认后才动代码（这一步只读不写）
- 每步结束时软件必须能正常启动
- 需求文档是唯一权威，我中途改主意就一起改文档再动代码
- 遇需求文档没写到的情况先问我，不要自己拍板

这次要做的是：【第 7 批「记录生命周期」。蓝图在 docs/08 第 16 节，你先出细化方案给我看，别直接开写】
```

---

## 二、当前进度速览（2026-09-25 第 6 批完成）

| 批次 | 内容 | 状态 |
|---|---|---|
| 环境 | Electron 39.8.10 + React 19 + TS + better-sqlite3 | ✅ |
| 第 1 批 | 素材入库（建包/扫描/未归属池/认领/双面板） | ✅ |
| 增强 | 项目管理（自建/编辑/真删/配色/排序/左栏拖拽） | ✅ |
| 第 2 批 | 缩略图与媒体信息（图片 sharp / 视频 FFmpeg / PSD / PDF） | ✅ 4/4 |
| 第 3 批 | 标签体系与检索（3 维度 + 批量打 + 筛选） | ✅ 验收通过 |
| 第 4 批 | 打包交付（Windows 安装包 + 工作区兜底 + 版本号） | ✅ 待装机验收 |
| 第 5 批 | 工作区管理与迁移（多工作区 + 路径重写 + 同盘搬移） | ✅ 2026-09-25 |
| **第 6 批** | **三级目录结构（工作区/项目/包 + 老库迁移 + 改名联动）** | ✅ 2026-09-25 |

**第 6 批落地细节**（详见 `docs/08`）：
- 磁盘三级：工作区根 → 项目文件夹（项目名=folder_name，改名连带改文件夹）→ 包文件夹 → 三组
- 归属判定**深度无关**（最长包前缀 + 相对包找三组名），将来插版本层 V1/V2 不改代码
- 根目录游离包 → 「待归类」（`project_id = NULL`，**启动时不再兜底塞进集团通用**——那条兜底已删）
- `_已解绑的项目` / `_回收站` 两个下划线收纳区，靠"扫描跳过下划线目录"零代码隐身
- 老库一次性迁移 `ensureLayoutV3`：备份 → rename（记逆向）→ 单事务改库 → 写标记；界面弹一次提示条（`meta.layout_notice`，ack 后清）
- 回归 344 项全过；界面四场景 `node _shotapp/run-verify4.cjs banner|version|wslist|threelevel`

---

## 三、第 7 批「记录生命周期」（已拍板，开工前先出细化方案）

蓝图在 `docs/08` §16，覆盖六件事：

1. **包记录自动清理**：本地删了包文件夹 → 刷新扫描后记录摘除（修第 5 批前就存在的 bug：scanAll 从不清理 packs）
2. **包信息可编辑**：改名 / 改类别 / 改归属项目（缺 `pack:update` IPC；改名连带改文件夹名）
3. **待归类归位**：给「待归类」的包选个项目，文件夹搬进该项目文件夹
4. **项目解绑**：软件里不显示、本地全保留 → 整个项目文件夹搬进 `_已解绑的项目`（扫描跳过下划线目录，天然不再被扫进来）
5. **项目删除（真删）**：包搬到 `_回收站`，本地文件一个不少
6. **`asset_tags` 孤儿修复**：删包/删项目后无外键的标签关联会积累孤儿

之后候选：第 8 批 M8-03 文件已丢失标记 + 重新定位；M8-04 一键备份完整版；图标替换 + 代码签名；M6 版本管理；M5 素材交付打包；进度条与性能。

**另**：第 5、6 批改动还没打进安装包（`D:\_accept_ws\rel_out` 里是第 4 批版本），出包前记得先重跑 `npm run build:win`（见 README，输出目录必须在项目外）。

---

## 四、本机环境坑速查（踩过别再踩）

| 坑 | 应对 |
|---|---|
| node `spawnSync` 全 EBUSY | 外部命令一律异步 spawn |
| `out/test/*.cjs` 是 esbuild 独立产物 | 改 `src/main` 后**三个都要重打**：`accept.cjs`、`ipc.cjs`、`workspace.cjs`（截图壳和 threelevel 场景都用它；命令见 README）。验证 bundle 新旧**别 grep 中文**（esbuild 默认转义成 `\uXXXX`，会假阴性），用 node 脚本查 ASCII 标识符 |
| 场景壳 setup 抛异常会挂死 | `_shotapp/v4/main.cjs` 的 whenReady 已挂 `.catch` 兜底退出（exit 9）；新场景沿用，别裸奔 |
| **AI 沙箱批量删除护栏** | 单次删除目标树超过约 50 个文件就被拦（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。**正解是走提权**：批准后 fs shim 不注入，`shutil.rmtree` 一次能清 15 GB（2026-09-25 实测）。不要绕着设计 |
| 出包输出目录 | **必须在项目外**（如 `D:/_accept_ws/rel_out`）。输出到项目内会被下一轮打包原样吞进安装包（曾 847 MB → 1574 MB 失控） |
| `node_modules` 出现 `.DELETE.` 后缀文件 | npm 延迟删除残留，症状"模块找不到"；恢复文件名即可，不必重装依赖 |
| 出包二进制要从 GitHub 下 | 先设 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` |
| 出包配置只在 package.json 生效 | **别建 electron-builder.yml**（会被完全忽略，见 DECISIONS 2026-09-25） |
| 截图壳工作区 | `_shotapp/v4` 四个场景全部指向 `D:/_accept_ws/shot*`，**绝不与用户真实工作区 `D:/素材工作区` 共用** |
| 沙箱跑 GUI | 必须 unset `ELECTRON_RUN_AS_NODE`；Electron 需 `--no-sandbox` + `app.disableHardwareAcceleration()` |
| typecheck / 验收 / 截图壳命令 | `npm run typecheck` → 重打 bundle → `node out/test/accept.cjs` → `node _shotapp/run-verify4.cjs banner\|version\|wslist\|threelevel` |
| 探测别人的库别用 readonly 连接 | WAL 模式只读打开需要能创建 `-shm`，否则「刚复制过来、还没生成 -shm」的库直接打不开被误判成坏的（第 5 批踩过） |
