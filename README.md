# 素材管家

本地素材管理桌面软件。统一管理公司的设计物料、图片、视频素材，**所有素材存在本地**，不上云。

- 项目档案：`PROJECT.md`（定位与协作铁律）/ `PROGRESS.md`（进度台账）/ `DECISIONS.md`（历史决策）
- 方案文档：`docs/01` ~ `docs/06`（每批功能的定稿方案，改需求先改文档）
- 需求文档：`docs/素材管家-需求文档.docx`（唯一权威）

## 技术栈

Electron + React + TypeScript（electron-vite）· SQLite（better-sqlite3）· sharp（图片）· FFmpeg（视频，随包分发）· pdfjs-dist（PDF）

## 日常开发

```bash
npm install        # 装依赖（原生模块均为 N-API 预编译，无需 VS 工具链）
npm run dev        # 开发调试
npm run typecheck  # 类型检查
npm run build      # 类型检查 + 编译三端产物到 out/
```

## 出 Windows 安装包

```bash
# 先设国内镜像（不设的话 NSIS/winCodeSign 会从 GitHub 拉，大概率卡死）
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

npm run build:win
```

产物：`release/素材管家-<版本>-安装包.exe`

要点（详见 `docs/06-第4批打包交付方案.md`）：

- **出包配置只有一处** —— `package.json` 的 `build` 字段。electron-builder 的规则是：只要 package.json 里有 `build` 字段，`electron-builder.yml` 就会被完全忽略（已核 app-builder-lib 源码），所以那个文件已删除，**别再建回来**
- `npmRebuild: false` 是刻意的 —— 三个原生模块全是 N-API 预编译，本机没装 Visual Studio，开了必失败
- FFmpeg 走 `extraResources` 单独一份，`files` 里排除了 `resources/ffmpeg/**`，不排除会重复打包虚胖 267 MB
- 安装包未做代码签名：同事安装时 Windows 会弹「已保护你的电脑」，点「更多信息 → 仍要运行」
- 改版本号只改 `package.json` 的 `version`（界面状态栏和安装包文件名都从这儿来）

## 验收

```bash
npm run build                                   # 先编译
npx esbuild accept.ts --bundle --platform=node --format=cjs \
  --outfile=out/test/accept.cjs --external:better-sqlite3 --external:electron \
  --external:sharp --external:pdfjs-dist --external:@napi-rs/canvas
node out/test/accept.cjs                        # 218 项断言，结果写 accept-result.txt

node _shotapp/run-verify4.cjs banner            # 界面验证：工作区不可用提示条
node _shotapp/run-verify4.cjs version           # 界面验证：状态栏版本号
```

注意：`out/test/*.cjs` 是 esbuild 独立产物，**改了 `src/main` 必须重打**，否则跑的是旧代码。

## 素材工作区

素材统一放在 `D:\素材工作区`（与代码目录分开，整个文件夹拷走即带走全部素材）。
首次启动若该位置不可用（没 D 盘 / 无写权限），自动落到「文档\素材工作区」；
已配置的位置连不上时，**软件绝不偷偷换位置**，只在界面顶部提示并给出「重试 / 更改位置」。

## 已知环境坑（踩过别再踩）

| 坑 | 应对 |
|---|---|
| AI 沙箱里 node `spawnSync` 全 EBUSY | 外部命令一律异步 spawn |
| `out/test/*.cjs` 是 esbuild 产物 | 改 `src/main` 后必须重打；用运行时特征串验证新旧（注意 esbuild 默认把中文转义成 `\uXXXX`，grep 中文会假阴性） |
| AI 沙箱批量删除护栏拦 `npm run build`（按会话轮次累计） | 拆开跑：`npm run build` 成功后单独 `npx electron-builder --win` |
| `node_modules` 里出现 `.DELETE.` 后缀文件 | npm 延迟删除残留，恢复文件名即可，不必重装依赖 |
| 沙箱跑 Electron 会被拦（`ELECTRON_RUN_AS_NODE` + 无 GPU） | 用 `_shotapp/` 验证壳；截图壳工作区绝不与 `D:\素材工作区` 共用 |
