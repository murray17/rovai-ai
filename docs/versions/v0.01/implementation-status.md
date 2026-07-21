# Lumen AI v0.01 实施状态

> 状态：当前代码基线
>
> 基线提交：`65d2a04`
>
> 更新日期：2026-07-18

本文件只记录仓库中已经实现并可从当前代码验证的能力。规划中、仅有数据表骨架或尚未接入产品流程的能力不列为已实现。

系统结构、边界和技术债见 [architecture.md](architecture.md)。

## 桌面应用基础

- [x] Electron 承载 macOS 桌面 Shell，React + TypeScript 构建 Renderer。
- [x] Renderer 启用 Sandbox、`contextIsolation`，不直接获得 Node、Shell、文件系统或 Git 权限。
- [x] Electron Main 通过受限 Preload API 与 Renderer 通信。
- [x] Rust Core 作为随 App 打包的本地子进程运行，并由 Electron Main 监管。
- [x] Rust Core 异常退出后执行有限次数自动重启，并向 UI 投射运行状态。
- [x] SQLite 随 Rust Core 分发，启用 WAL、Foreign Keys 和 Schema Migration。

## 伙伴与上下文

- [x] 预置洛可、沐瓦、眠枝、绮露四个持久角色档案和职责。
- [x] v0.01 仅启用沐瓦的 Codex Runtime，其他伙伴展示持久身份和角色契约。
- [x] 默认大厅作为系统上下文存在，不显示为用户项目。
- [x] 点击“新对话”直接进入空白大厅会话，不出现标题、项目或确认弹窗。
- [x] 大厅输入框自动聚焦；第一条消息发送时才创建并启动任务，标题由消息自动生成。
- [x] 大厅任务不读取用户项目、不初始化 Git、不创建分支或 Worktree，也不展示项目 Diff。

## 项目与任务

- [x] 通过系统目录选择器打开本地 Git 仓库。
- [x] 校验项目根目录、当前分支和起始提交并持久化项目记录。
- [x] 项目任务直接绑定用户选择的项目根目录，不创建或管理 Worktree。
- [x] 创建项目任务时展示目录级授权、已有未提交修改提示和高风险操作边界。
- [x] 同一项目阻止多个活跃修改任务同时运行。
- [x] 保存任务目标、负责人、状态、执行目录、起始分支和起始提交。
- [x] 展示项目任务列表、任务状态、Git 状态、文件变化数量和相对起始提交的 Diff。
- [x] 支持在 Finder 中显示项目执行目录。

## Codex Runtime

- [x] 探测本机 Codex CLI 路径、版本和登录状态。
- [x] 固定并检查 `codex-cli 0.144.5` app-server 兼容基线，不兼容时阻止任务启动。
- [x] 通过 `codex app-server --listen stdio://` 建立 JSON-RPC Runtime。
- [x] 支持 Codex Thread start/resume 和 Turn start/steer/interrupt。
- [x] 流式接收 Agent 文本、命令输出、文件变化、Runtime 状态和错误。
- [x] 用户可以在任务中追加指令或中断当前 Turn。
- [x] 未识别的原生事件保留原始 Method 和 Payload，便于审计协议变化。

## 权限、审批与审计

- [x] Codex 以明确 cwd、`workspace-write` Sandbox 和 `on-request` Approval Policy 启动。
- [x] Approval Request 先写入 SQLite，再展示给用户并回复 Codex。
- [x] 支持拒绝、拒绝并停止 Turn、允许一次和本次任务允许。
- [x] 未支持或无法持久化的 Server Request 失败关闭，不默认批准。
- [x] Append-only `event_log` 保存用户消息、Agent Delta、命令、文件、审批、错误和 Runtime 事件。
- [x] UI 将事件日志投影为对话、活动、审批、变更和审计视图。
- [x] 诊断页展示 Core、SQLite、Git、Codex 路径、版本和登录健康状态。
- [x] 支持导出 Agent、项目、任务、事件和审批组成的诊断 JSON，且不导出 Codex Token。

## 中断与恢复

- [x] 应用启动时将未完成任务标记为 `recovering`，并拒绝沿用崩溃前未决 Approval。
- [x] 恢复前检查执行目录；项目任务重新计算当前 Git 状态和 Diff。
- [x] 优先使用持久化的 Native Thread ID 恢复 Codex Thread。
- [x] 原 Thread 无法恢复时创建新的 Session Generation 和替代 Thread。
- [x] 使用包含任务目标和当前状态的 Resume Frame 继续，不回放完整 Transcript。
- [x] 用户确认后才恢复未完成任务。

## 构建与交付

- [x] 支持构建 macOS 14+ Apple Silicon `.app`。
- [x] Rust Core 作为可执行资源复制到 App Bundle。
- [x] App 使用 ASAR、Hardened Runtime 和本地 ad-hoc 签名进行开发构建。
- [x] 支持生成目录形式 App 和 DMG。
- [x] 打包后的 App 运行不依赖系统 Node.js、pnpm 或 Rust 工具链。
