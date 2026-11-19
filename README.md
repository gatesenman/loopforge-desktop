# LoopForge 桌面版（Windows x64）

把 [Tencent/LoopForge](https://github.com/Tencent/LoopForge)（MIT）打包成 **一个安装包、装完就能用** 的 Windows 桌面应用。

- 内置平台服务（单文件 `agentflow`）+ 本机 **SQLite**，不安装、不依赖 MySQL。
- **不使用 Docker**：所有 SOP、对话工作区和脚本都在本机执行。
- 安装包内置 **Git for Windows**（含 bash/sh）、**Node.js 22**（含 npm）、**Python 3.11**（官方 Windows embeddable）。应用启动时自动把这些工具放到 PATH 最前面，无需再装运行时。

## 下载

Windows x64 安装包请到 [Releases](https://github.com/gatesenman/loopforge-desktop/releases) 下载 `LoopForge-Setup-0.3.8.exe`，解压或直接运行即可安装。本仓库只包含桌面封装源码；Git、Node.js、Python 和平台二进制体积较大，已打进安装包，不放在 Git 里。

## 安装与首次使用

1. 运行 `LoopForge-Setup-0.3.8.exe`（当前用户安装，可选桌面与开始菜单快捷方式）。
2. 启动 **LoopForge**。首次会打开「环境检查」窗口，并在本机启动平台服务（约 10–30 秒，用于初始化数据库）。
3. 在登录页 **创建第一个管理员账号**（用户名 + 密码）。该账号拥有平台管理权限。
4. 进入后可浏览「LoopForge 体验项目」并运行无需模型密钥的示例 SOP（`welcome-workflow`）。
5. 若要使用 AI 对话或「通用交付」类 SOP：在环境检查中用 **内置 npm** 安装至少一个编码 Agent CLI（推荐 CodeBuddy 或 Codex），并在平台的个人设置里登录/填写密钥。装好后点「重新检查」。

数据目录：`%APPDATA%\LoopForge`（库文件、工作区、日志、desktop-config.json）。卸载默认保留数据。

菜单「文件 → 环境检查 / 打开数据目录 / 打开服务日志 / 重启服务」。

## 环境检查覆盖范围

| 项目 | 来源 | 缺失时 |
| --- | --- | --- |
| LoopForge 服务、数据目录 | 应用自身 | 提示查看日志，可重试启动 |
| Git、bash/sh、Node.js、npm、Python 3 | **安装包内置** | 视为安装损坏，请重装本应用；**不会**要求用 winget 再装一份 |
| CodeBuddy / Codex / Claude Code / OpenCode / Gemini CLI / dsh | 可选，用内置 npm 一键安装 | 不阻止启动 |
| Cursor CLI | 可选，官方安装脚本（需账号） | 不阻止启动 |

应用 **不会** 检测、推荐或安装 Docker / Docker Desktop / WSL。

## 内置与需自行安装

**已内置于安装包：**

- LoopForge 平台（`agentflow.exe`）及辅助程序（`agentflow-runner`、`agentflow-gate-mcp`、`agentflow-mcp`、`loopforge-account`）
- Git for Windows 便携版（含 `git`、`bash`、`sh` 及常用 Unix 工具）
- Node.js 22 Windows x64（含 `npm`）
- Python 3.11 Windows embeddable（`python` / `python3`）
- 上游与第三方许可声明（`resources/licenses`）

**不会内置（需登录对应厂商账号，属可选）：** 各编码 Agent CLI 及其 API 密钥。可在环境检查页用内置 npm 安装。

## 运行模式与功能差异

默认且唯一的运行模式是 **本机执行**。上游 Compose 部署里依赖 Docker 隔离沙箱的能力，在此桌面版中做了如下处理：

- 启动参数固定 `LOOPFORGE_DESKTOP=1` / `AGENTFLOW_DISABLE_DOCKER=1`，**不会**设置 `AGENTFLOW_LOCAL_SANDBOX=docker`，也 **不会** 调用 Docker。
- 目录里原先的 “Docker 隔离沙箱”（如 `generic-docker`）会被改写为「本机执行（桌面版）」。内置的「通用后端/前端/产品交付」等 SOP 仍可选用，但命令跑在本机，而不是容器里。
- 对话工作区若选择了 Docker / native 隔离，桌面版会改为本机执行。
- **因此不可用或明显弱化的能力：** 容器隔离、基于镜像的可复现构建环境、在沙箱里预装的 Linux 工具链、以及任何必须与 Docker 守护进程通信的功能。请只在受信任的仓库和任务上使用本机执行。

## 仅能在 Windows 上验证的部分

本安装包在 Linux 上交叉编译并完成了：Windows PE 二进制构建、Linux 下同一套 SQLite 配置的服务自检（`/api/health`、种子目录、本地 SOP 启动）、安装器文件生成。下列事项需要在 Windows 10/11 x64 实机确认：

- 安装/卸载向导、快捷方式、杀毒软件对 `agentflow.exe` 的拦截
- 内置 Git / Node / Python 在资源管理器与 Agent CLI 中的实际调用
- WebView2/Electron 窗口、系统托盘外的单实例行为
- 各编码 Agent CLI 的安装与登录
- 带仓库的完整交付 SOP（本机执行）

## 许可

上游 LoopForge 为 MIT。安装包还包含 Git for Windows、Node.js、CPython 以及 Electron/Chromium 的各自许可，详见安装目录下 `licenses` 与程序内「帮助 → 开源许可与第三方声明」。本桌面封装未改变上游许可证。
