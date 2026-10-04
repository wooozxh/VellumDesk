# wecom-cli（随软件打包，第 21 批）

此目录在打包分发时随应用一起带上（electron-builder `extraResources`，见 package.json），
装完软件就能直接用工单同步与授权，**同事不需要再自己装 CLI**。

## 内容

- `wecom-cli.exe` — 企业微信官方命令行工具（**单文件、零依赖、免 Node**），
  工单同步 / 写回 / 发通知 / 导出报表 / 授权全部由它完成
- `LICENSE.txt` — MIT 许可证文本（分发时必须随附）

| 项 | 值 |
|---|---|
| 版本 | `wecom-cli 1.3.4 (wecom 2026-09-23T11:47:44Z f9b2815)` |
| 体积 | 9.62 MB（10 091 560 字节） |
| SHA-256 | `10ec26b4c867945422bbc18604820f534c62814909abfd6f548beb77a628d484` |
| 平台 | win32-x64（全公司 Windows，不做 mac / linux 二进制） |
| 许可 | MIT |

## 来源

npm 上的 `@wecom/cli` 只是一个 JS 启动器（`bin/wecom.js`），真正的 CLI 是它的
平台可选依赖里的 **原生可执行文件**：

```
@wecom/cli/node_modules/@wecom/cli-win32-x64/bin/wecom-cli.exe
```

## 重建方式

```bash
npm install @wecom/cli
# 装完从 node_modules 里拷出平台二进制（路径见上）
# 一并拷该平台包里的 LICENSE 为 LICENSE.txt
```

或从一个已经装好 CLI 的机器上整目录拷过来。

## 注意

- **exe 不入 git**（体积 9.6 MB，二进制），`.gitignore` 已排除；
  新环境 clone 后按上面方式重建，或直接整目录拷贝。
- **升级 CLI = 出新安装包**（不做自动升级，版本随包钉死，避免"不同同事跑不同 CLI"的排查噩梦）。
- **授权凭据不在这个目录**：企业微信的授权凭据落在**当前 Windows 用户**的
  用户主目录（`%USERPROFILE%\.config\wecom\`，含 `credentials.enc` + `.encryption_key`），
  与 exe 放哪无关 —— 所以升级 / 重装软件**不需要重新扫码授权**；
  但换电脑、换 Windows 账号则必须重新授权一次（软件内有引导）。
