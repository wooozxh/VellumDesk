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

这次要做的是：【第 6 批。具体方向我不确定，你先按 PROGRESS.md 的「下一步」给我两个选项，别直接开写】
```

---

## 二、当前进度速览（2026-09-25 第 5 批完成）

| 批次 | 内容 | 状态 |
|---|---|---|
| 环境 | Electron 39.8.10 + React 19 + TS + better-sqlite3 | ✅ |
| 第 1 批 | 素材入库（建包/扫描/未归属池/认领/双面板） | ✅ |
| 增强 | 项目管理（自建/编辑/真删/配色/排序/左栏拖拽） | ✅ |
| 第 2 批 | 缩略图与媒体信息（图片 sharp / 视频 FFmpeg / PSD / PDF） | ✅ 4/4 |
| 第 3 批 | 标签体系与检索（3 维度 + 批量打 + 筛选） | ✅ 验收通过 |
| 第 4 批 | 打包交付（Windows 安装包 + 工作区兜底 + 版本号） | ✅ 待装机验收 |
| **第 5 批** | **工作区管理与迁移（多工作区 + 路径重写 + 同盘搬移）** | ✅ 2026-09-25 |

**第 5 批落地细节**（详见 `docs/07`）：
- 左栏「工作区」是列表：点击切换、`＋ 添加工作区`、当前项有「打开文件夹 / 搬移位置」、非当前项 hover 有 `×`
- 配置 `workspace.json` 是 v2（`workspaces[]` + `activeId`），**末尾的 `workspaceRoot` 是刻意双写**（兼容旧版软件 + 既有断言），别删
- 换位置后的路径修复 = `rewritePaths()`：旧根由 `abs_path - rel_path` 反推、两步走事务、自动备份到 `_system/backup/`、逐文件自检
- **修掉了第 1~4 批一直存在的假切换 bug**（`closeDb` 从不调用）：所有换库动作按「closeDb → 写 activeId → 丢缓存 → 开新库」四步，别打乱
- 回归 275 项全过；界面三场景 `node _shotapp/run-verify4.cjs banner|version|wslist`

---

## 三、第 6 批候选方向（等用户拍板）

1. **M6 版本管理**（需求文档 5.6 节）—— 同一物料挂多版本 / 时间线 / 回滚 / 对比。**先要定「版本怎么产生」**（扫描自动识别 vs 手动挂），需求文档没写，必须先问
2. **M8-04 一键备份完整版** —— 第 5 批做了「搬移」，备份（整个库复制到指定位置 + 进度 + 校验）是同族功能的最后一块；跨盘复制技术可复用
3. **M5 素材交付打包**（需求文档 5.5 节）—— 勾选素材一键生成交付压缩包 + 清单。注意：这是**业务功能**，和第 4 批的"软件安装包"是两回事
4. **图标替换 + 代码签名**（第 4 批遗留）—— 拿到 logo 换 `build/icon.ico` 重出包即可；签名证书约 1000–3000 元/年，需用户拍板买不买
5. **原第 5 批遗留**：进度条 + 中途取消 + 大批量性能
6. 其他用户新提的需求

**另**：第 5 批改动还没打进安装包（`D:\_accept_ws\rel_out` 里是第 4 批版本），出包前记得先重跑 `npm run build:win`（见 README，输出目录必须在项目外）。

---

## 四、本机环境坑速查（踩过别再踩）

| 坑 | 应对 |
|---|---|
| node `spawnSync` 全 EBUSY | 外部命令一律异步 spawn |
| `out/test/*.cjs` 是 esbuild 独立产物 | 改 `src/main` 后**两个都要重打**：`accept.cjs`（命令见 README）和 `ipc.cjs`（截图壳用，把 `src/main/ipc.ts` bundle 成 `out/test/ipc.cjs`）；`npm run build` 会清掉 out/test/，之后要补打；验证新旧**别 grep 中文**（esbuild 默认转义成 `\uXXXX`，会假阴性），用 node 脚本查 ASCII 标识符 |
| **AI 沙箱批量删除护栏** | 单次删除目标树超过约 50 个文件就被拦（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。**正解是走提权**：批准后 fs shim 不注入，`shutil.rmtree` 一次能清 15 GB（2026-09-25 实测）。不要绕着设计 |
| 出包输出目录 | **必须在项目外**（如 `D:/_accept_ws/rel_out`）。输出到项目内会被下一轮打包原样吞进安装包（曾 847 MB → 1574 MB 失控） |
| `node_modules` 出现 `.DELETE.` 后缀文件 | npm 延迟删除残留，症状"模块找不到"；恢复文件名即可，不必重装依赖 |
| 出包二进制要从 GitHub 下 | 先设 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` |
| 出包配置只在 package.json 生效 | **别建 electron-builder.yml**（会被完全忽略，见 DECISIONS 2026-09-25） |
| 截图壳工作区 | `_shotapp/v4` 三个场景全部指向 `D:/_accept_ws/shot*`，**绝不与用户真实工作区 `D:/素材工作区` 共用** |
| 沙箱跑 GUI | 必须 unset `ELECTRON_RUN_AS_NODE`；Electron 需 `--no-sandbox` + `app.disableHardwareAcceleration()` |
| typecheck / 验收 / 截图壳命令 | `npm run typecheck` → 重打 bundle → `node out/test/accept.cjs` → `node _shotapp/run-verify4.cjs banner\|version\|wslist` |
| 探测别人的库别用 readonly 连接 | WAL 模式只读打开需要能创建 `-shm`，否则「刚复制过来、还没生成 -shm」的库直接打不开被误判成坏的（第 5 批踩过） |
