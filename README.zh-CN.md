# LoopForge 桌面版（Windows x64）

[English](README.md) · [简体中文](README.zh-CN.md)

将 [Tencent/LoopForge](https://github.com/Tencent/LoopForge)（MIT）打包成 **一个安装包、装完就能用** 的 Windows 桌面应用：**不使用 Docker，不安装 MySQL，也不用再单独装运行环境**。

这是社区桌面封装，不是腾讯官方发布的安装包。

[下载 LoopForge-Setup-0.4.2.exe](https://github.com/gatesenman/loopforge-desktop/releases/latest)

<p align="center">
  <img src="docs/screenshots/startup.png" alt="LoopForge 桌面版启动画面" width="720">
</p>

## 你能直接用到什么

| | 桌面版 0.4.2 |
| --- | --- |
| 运行方式 | 本机进程 + `%APPDATA%\LoopForge` 下的 SQLite |
| 已内置 | Git for Windows **MinGit**（git 与 sh/bash）、Node.js 22（含 npm）、Python 3.11 |
| Docker | 不使用、不依赖。应用不会启动或探测 Docker，因此不会弹出黑色控制台窗口。 |
| 启动 | 内置必需项会静默检查；通过后直接进入工作台，不再强制走环境检查向导。 |
| 更新 | 在应用内对照 GitHub Releases 检查（下载后提示重启安装，不会在工作中途自动重启）。 |
| 编码 Agent CLI | 可选。在「文件 → 环境检查」里用内置 npm 安装，再到设置里登录。安装在应用内完成，不弹出命令行窗口。 |

<p align="center">
  <img src="docs/screenshots/envcheck.png" alt="内置环境检查" width="720">
</p>

环境检查只会在必需项失败时自动出现，或通过菜单（`Ctrl+Shift+E`）打开。登录后可能一次性询问是否安装可选 CLI，可以跳过。

<p align="center">
  <img src="docs/screenshots/workbench.png" alt="桌面应用中的 LoopForge 工作台" width="720">
</p>

上图是创建第一个管理员账号之后，应用内的 LoopForge 工作台（沿用上游界面）。

## 安装与首次使用

1. 从 [Releases](https://github.com/gatesenman/loopforge-desktop/releases) 下载 `LoopForge-Setup-0.4.2.exe` 并运行（当前用户安装，带开始菜单和桌面快捷方式）。
2. 安装包 **没有代码签名**。Windows SmartScreen 可能会提示，选择「仍要运行」即可。应用内更新之后也可能再次出现该提示。
3. 第一次打开会先启动本地服务（初始化数据库大约 10–30 秒）。内置运行时正常时，会直接进入登录 / 工作台。
4. 在登录页创建第一个管理员账号。
5. 可先在「LoopForge 体验项目」里运行无需模型密钥的示例 SOP（`welcome-workflow`）。
6. 若要使用 AI 对话或交付类 SOP：在环境检查里安装至少一个编码 Agent CLI（推荐 CodeBuddy 或 Codex），在个人设置中登录或填写密钥，再点「重新检查」。

数据保存在 `%APPDATA%\LoopForge`，卸载时默认保留。可通过「文件 → 导出诊断包」打包生命周期计数、版本和白名单环境检查结果。原始日志、extraEnv、数据库和工作区均不导出，而不是尝试猜测所有密钥格式。数据库和工作区可能包含凭据，因此暂不提供自动数据备份。会话密钥在可用时使用 Windows DPAPI 保护。

本地服务由守护逻辑监管：异常退出会按间隔自动重启几次，仍失败再进入错误页。退出应用时会尽量优雅停止服务，强制结束只作为兜底。

## 环境检查覆盖范围

| 项目 | 来源 | 缺失时 |
| --- | --- | --- |
| LoopForge 服务、数据目录 | 应用自身 | 查看服务日志，可重试启动 |
| Git、bash/sh、Node.js、npm、Python 3 | **安装包内置** | 请重新安装本应用，不会要求再用 winget 装一份 |
| CodeBuddy / Codex / Claude Code / OpenCode / Gemini CLI / dsh | 可选，用内置 npm 一键安装 | 不阻止启动 |
| Cursor CLI | 可选，官方安装脚本（需账号） | 不阻止启动 |

应用 **不会** 检测、推荐或安装 Docker / Docker Desktop / WSL。

## 运行模式与功能差异

默认且唯一的运行模式是 **本机执行**。上游依赖 Docker 隔离沙箱的能力在此桌面版中不可用或会减弱：容器隔离、基于镜像的可复现环境、沙箱里预装的 Linux 工具链，以及任何必须与 Docker 守护进程通信的功能。请只在受信任的仓库和任务上使用本机执行。

常规官方 MinGit 内含真正的 GNU Bash（也以 sh 名称提供），不再用 BusyBox 冒充 Bash。未内置 Git GUI 和 Perl。Windows CI 在带空格的路径下验证 Bash 数组、sh、Git、Node/npm、Python/pip 和服务启动；这是命令行集成测试，不是 Windows GUI 端到端测试。

## 从源码打包

本仓库存放 Electron / NSIS 桌面封装源码。体积较大的运行时（`vendor-dl/`、`resources/bin/`）不放入 Git，而是打进安装包。供应商锁定、MinGit 取舍、CI 与自动更新产物说明见 [docs/PACKAGING.md](docs/PACKAGING.md)。

```bash
node scripts/fetch-vendors.js
node scripts/build-loopforge-bins.js   # 或设置 LOOPFORGE_SRC 指向已打补丁的 LoopForge 源码
npm ci
npm run dist
```

生成文件为 `dist/LoopForge-Setup-<version>.exe`，以及供 GitHub Releases 自动更新使用的 `latest.yml`。

## 更新说明

### 0.4.2

- 原子配置保存与有效备份恢复；服务启动/重启串行与取消过期重启。
- 精确来源导航限制；预览窗口不继承本地特权 preload。
- 环境探针不覆盖用户文件；本地日志限额及异步错误保护。
- 固定上游加补丁的完整源码导出及逐文件来源核验；增强原生 Windows 包内容与 GUI 回归门禁。

### 0.4.0

- 运行时瘦身：用官方 Git for Windows MinGit 替换完整便携版 Git；安装包只包含 Windows 平台程序（去掉 Linux 的 runner/gate-mcp，以及默认不需要的 `loopforge-account.exe`）。已验证的 NSIS 安装包为 **189.96 MB / 181.16 MiB**（189,957,485 字节）。
- 静默启动：内置 Git / Node / Python 与本地服务通过后直接进工作台；可选 Agent CLI 不再挡住首次启动，登录后的引导可跳过。
- 服务守护：HTTP 健康检查、有限次崩溃重启、退出时优雅停止。
- 在应用内安装 CLI（隐藏进程，不再弹出 `cmd` 窗口）。
- 通过 GitHub Releases 自动更新（`electron-updater`，下载后提示重启）。默认构建未签名。
- 在可用时用 Windows DPAPI 保护会话密钥。文件菜单提供白名单诊断包导出；不导出可能含凭据的原始日志与数据。内置锁定版本的 pip，无需 get-pip 网络引导。
- 可复现的供应商锁定文件，以及 Windows CI 打包工作流。

## 许可

上游 LoopForge 为 MIT。安装包还包含 Git for Windows、Node.js、CPython 以及 Electron/Chromium 的各自许可，详见 `licenses/` 与程序内「帮助 → 开源许可与第三方声明」。本桌面封装未改变上游许可证。

### 桌面配置恢复

桌面设置通过同目录临时文件写入、刷新后替换，更新前保留上一份有效的
`desktop-config.json.bak`。主配置损坏或丢失时会读取有效备份并提示；主配置与
备份都损坏时停止启动，不会静默重置会话密钥。数据库与项目目录不会因配置
恢复被删除。备份同样可能含敏感信息，请勿分享；诊断包不会包含它。
磁盘空间不足、目录权限或安全软件锁定文件仍可能导致保存失败，需要先解决
存储问题。该机制不是数据库备份，也不能替代整个数据目录的定期备份。
