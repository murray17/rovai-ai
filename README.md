# Lumen AI

Lumen AI 是一个本地优先的 AI 研发工作空间。v0.01 打通第一条可验证的自举路径：在 macOS App 中驱动本机 Codex，在独立 Git Worktree 中继续开发 Lumen 自身。

产品范围和验收基线见 [v0.01 MVP 规格](docs/mvp-v0.01.md)。

## v0.01 已实现

- Electron + React/TypeScript 桌面界面，Renderer 开启 Sandbox 且不暴露 Node、Shell、文件系统或 Git。
- 随 App 打包的本地 Rust Core、bundled SQLite/WAL 和 Append-only 任务事件。
- 洛可、沐瓦、眠枝、绮露四个持久角色；v0.01 只启用沐瓦执行 Runtime。
- 本地 Git 项目导入，以及每个修改型任务独立的分支和 Worktree。
- 基于 `codex app-server` 的真实 Thread/Turn、流式文本、命令/文件活动、追加指令和中断。
- 命令、文件和权限审批先持久化，再由用户允许或拒绝；未知请求失败关闭。
- 任务时间线、原生审计事件、审批记录、文件列表和 Git Diff。
- App 重启后发现未完成任务，用户确认后用 Resume Frame 恢复；原 Thread 失败时切换 Session Generation。
- Codex 版本与登录健康检查、Core 有限自动重启、诊断 JSON 导出。

## 运行本地构建

运行 App 只要求 macOS 14+（Apple Silicon）、Git，以及已经安装并登录的 Codex CLI。App 不依赖系统 Node.js 或 Rust。

```bash
codex --version
codex login status
open "dist/mac-arm64/Lumen AI.app"
```

v0.01 的 app-server 兼容基线固定为 `codex-cli 0.144.5`。其他版本会在健康检查中显示为不兼容，并阻止任务启动，避免实验协议变化被静默忽略。

## 在 Lumen 中开始任务

1. 点击“打开本地 Git 项目”，选择一个至少有一次 Commit 的仓库。
2. 进入项目并点击“新建沐瓦任务”。
3. 写明目标和验收标准，确认任务级授权。
4. 在任务工作台查看对话、活动、审批和 Diff；执行中可以追加指令或停止 Turn。
5. 完成后点击“在 Finder 显示 Worktree”，从该目录检查或构建产物。

任务 Worktree 默认位于：

```text
~/Library/Application Support/Lumen AI/worktrees/<project-id>/<task-id>/
```

Lumen v0.01 不会自动合并、Push、创建 PR 或删除 Worktree。

## 本地开发

开发环境要求：

- macOS 14+（Apple Silicon）
- Node.js 24+
- pnpm 11+
- Rust stable
- Git
- 已安装、已登录且版本兼容的 Codex CLI

```bash
pnpm install
pnpm dev
```

常用验证：

```bash
pnpm typecheck
pnpm test
cargo test
pnpm smoke:core
```

`pnpm smoke:core` 会创建一次性临时 Git 仓库，通过 Rust Core 启动真实 Codex app-server、创建 Worktree、执行只读 Turn，并验证流式文本、任务完成状态与干净 Diff。

## 构建 macOS App

```bash
pnpm package:mac
```

本地未签名 App 位于：

```text
dist/mac-arm64/Lumen AI.app
```

可选 DMG：

```bash
pnpm dist:mac
```

正式 Developer ID 签名和 Notarization 不在 v0.01 范围内。

## 数据与诊断

任务、角色、审批和事件保存在 Electron 的 Lumen AI `userData` 目录。可在“诊断”页查看准确路径，并通过“导出诊断 JSON”导出结构化记录。导出不包含 Codex Token；任务源文件仍只存在于原项目和任务 Worktree。

## 当前边界

- 仅支持 macOS Apple Silicon；Windows 从后续版本开始。
- 只有沐瓦连接 Codex Runtime，其他三个伙伴目前只保存身份和职责。
- `codex app-server` 是实验接口，因此 v0.01 不承诺跨版本兼容。
- Worktree 是变更隔离，不是完整安全沙箱；未知仓库或第三方脚本仍需额外隔离。
- App 为本地开发构建，未签名、未公证，也没有自动更新。
