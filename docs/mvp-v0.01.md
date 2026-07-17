# Lumen AI v0.01：自举 MVP 规格

> 状态：Draft，待确认后进入实现  
> 产品里程碑：v0.01  
> 应用与 Git Tag 版本：`0.0.1` / `v0.0.1`  
> 目标平台：macOS 14+，Apple Silicon  
> Canonical Repository：https://github.com/murray17/lumen-ai  
> 更新日期：2026-07-17

本文件是 v0.01 的范围与验收基线；若与原 `agent-team-mvp-checklist.md` 冲突，以本文件为准。原清单保留为后续版本的产品方向记录。

## 1. 版本目标

v0.01 的唯一目标是完成一个真实、可重复的自举闭环：

> 用户在 Lumen macOS App 中打开 Lumen 自己的 Git 仓库，让沐瓦通过本机 Codex 在独立 Worktree 中修改代码，实时查看过程、处理审批、检查 Diff；应用重启后可以恢复任务，并能从任务 Worktree 构建下一版 Lumen App。

这个版本证明以下核心假设：

1. Lumen 可以作为 Codex 的桌面客户端，而不是终端输出的简单包装。
2. Agent 身份、产品任务和 Codex 原生会话可以彼此独立持久化。
3. Codex 进程是可丢弃 Worker；应用和任务状态不依赖进程永久存活。
4. Lumen 可以在不直接暴露 Node、Shell 和文件系统给 Renderer 的情况下完成编码任务。
5. Lumen 能够用自身产品闭环继续开发自身。

## 2. 已锁定决策

以下决策在 v0.01 中不再作为开放问题：

- 使用 Electron 承载 macOS 桌面 Shell。
- 使用 React + TypeScript 构建 Renderer。
- 使用 Radix Primitives、自建 Design Tokens 和最小组件层。
- 使用 Rust Core 管理业务状态、SQLite、Git、Worktree、Codex 进程和审计。
- 使用本机已经安装并登录的 Codex CLI；v0.01 不内置 Codex 二进制和登录流程。
- 以 `codex app-server` 作为主 Runtime 接口，以 stdio JSON-RPC/JSONL 通信。
- Codex 是受信任、受其 Sandbox 约束的执行 Runtime；Rust 是 Policy Gateway 和 Audit Boundary。
- 编码任务在独立 Git Worktree 中执行，不直接修改用户主工作区。
- 自举指“从任务 Worktree 检查并构建下一版 App”，不要求运行中的 App 热更新自身。
- 四个伙伴身份全部预置，但 v0.01 只有沐瓦能够启动 Codex 执行任务。
- 首个发布物只覆盖 macOS Apple Silicon，不同时承担 Windows 交付。

## 3. 用户承诺

安装并启动 v0.01 后，用户能够：

1. 查看 Codex CLI 是否已安装、版本是否兼容、是否已登录。
2. 选择一个本地 Git 仓库作为项目。
3. 看到四个长期伙伴以及各自职责和状态。
4. 选择沐瓦，输入一个编码任务并确认任务授权。
5. 看到 Lumen 为任务创建的专用 Worktree 和任务分支。
6. 实时看到沐瓦的文本、当前动作、命令输出和文件变更。
7. 对需要人工确认的命令、网络、越界写入等操作批准或拒绝。
8. 在 Turn 执行过程中追加指令或中断执行。
9. 查看任务 Worktree 相对任务起点的文件列表和 Git Diff。
10. 关闭并重新打开 Lumen，在确认后恢复未完成任务。
11. 在 Finder 或终端中打开任务 Worktree，并从那里构建下一版 Lumen App。
12. 查看本次任务的事件、审批和错误记录。

## 4. 明确不做

v0.01 不包含：

- 多 Agent 自动协作、委派、Mailbox、Handoff 或 Task DAG；
- 洛可规划、眠枝自动 Review、绮露 UX Consult 的真实 Runtime；
- Direct Model/API Adapter；
- Claude、Gemini 或其他 Coding Runtime；
- 长期记忆提取、Fact Store、FTS5 检索和 Context Builder；
- 自动合并到主分支、Git push、创建 PR；
- 插件市场、MCP 管理 UI、Skill 管理 UI；
- Windows 安装包；
- Mac App Store、Developer ID 正式签名和 Apple Notarization；
- 自动更新；
- 云同步、多用户和远程执行；
- Python Sidecar；
- 对不可信仓库提供完整 OS 级安全隔离保证；
- 在 Codex 上游请求前再实现一层 Lumen Secret 扫描或流量代理；v0.01 采用用户现有 Codex 配置和信任模型。

## 5. 系统架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Lumen AI.app                                                │
│                                                             │
│  React Renderer                                             │
│  - 页面与交互                                               │
│  - 无 Node / Shell / FS / Git 权限                          │
│             │                                               │
│             │ typed preload API                             │
│             ▼                                               │
│  Electron Main + Secure Preload                             │
│  - 窗口生命周期、菜单、通知                                 │
│  - 启动和监管 Rust Core                                     │
│             │                                               │
│             │ Lumen IPC over stdio                          │
│             ▼                                               │
│  Rust Core                                                  │
│  - Project / Task / Session / Approval                      │
│  - SQLite / Git / Worktree / Audit / Recovery               │
│  - Codex Runtime Adapter                                    │
└─────────────┼───────────────────────────────────────────────┘
              │ Codex app-server JSON-RPC over stdio
              ▼
       Disposable Codex Worker
              │
              ▼
       Task Git Worktree
```

### 5.1 进程模型

- Electron Main 是桌面应用主进程。
- Rust Core 是 Electron Main 启动和监管的打包子进程，不是系统常驻服务。
- Rust Core 启动 `codex app-server` 子进程，并独占其 stdin/stdout。
- app-server stdout 只传输协议消息；stderr 作为 Runtime 日志收集。
- Renderer 只能通过 Preload 暴露的有限、类型化 API 与系统交互。
- Renderer 刷新不影响 Rust Core；Electron 整体退出后 Rust Core 和 Codex Worker 一同退出。

### 5.2 领域边界

必须保持：

```text
Project != Git Worktree
Task != Conversation
Conversation != Codex Thread
Turn != Codex Process
Message History != Long-term Memory
Task State != Agent 文本中的自述状态
```

Codex Thread ID 只是 `runtime_session` 的一个 Provider 字段，不能作为 Agent 身份、Task ID 或产品会话 ID。

### 5.3 信任与执行边界

v0.01 不宣称每条命令都由 Rust 亲自执行。实际规则为：

- Codex Runtime 在 Worktree 和 Codex Sandbox 内执行工具。
- Rust 选择 Sandbox、cwd 和审批策略。
- Rust 持久化需要用户判断的审批请求，再将用户决定回复给 app-server。
- Rust 记录 app-server 报告的工具调用、输出、文件 Patch 和退出状态。
- Rust 可以施加比 Codex 默认策略更严格的 Lumen 项目策略。
- Lumen 不修改或绕过用户已有的 Codex 全局安全要求。
- 用户启动任务时，已明确授权 Codex 与其配置的模型服务通信；该模型通道不同于 Agent 发起的任意工具网络访问。
- v0.01 不拦截或代理 Codex 的上游模型流量，也不宣称能够独立检查 Codex 最终上传的全部上下文。

## 6. 技术基线

### 6.1 Desktop

- Electron
- React + TypeScript
- Vite / Electron 构建集成
- Radix Primitives
- 自建 CSS Variables Design Tokens
- macOS 原生窗口、菜单和通知行为
- `nodeIntegration: false`
- `contextIsolation: true`
- Renderer Sandbox 开启

### 6.2 Rust Core

- Rust stable
- Tokio：子进程和异步 I/O
- Serde / serde_json：IPC 与 Runtime 消息
- rusqlite + bundled SQLite：固定随应用分发的 SQLite
- tracing：结构化诊断日志
- Git 命令封装：v0.01 不引入 libgit2

### 6.3 Codex Runtime

- 开发验证基线：`codex-cli 0.144.5`
- 主接口：`codex app-server --listen stdio://`
- 启动时执行版本和认证健康检查。
- 开发时从目标 Codex 版本生成 app-server Schema，并保存版本信息。
- v0.01 只依赖完成闭环所需的最小稳定协议子集。
- 未识别事件保存为原始事件，但不应导致整个 Turn 崩溃。
- `codex exec --json` 仅用于诊断，不作为透明运行时降级。

app-server 在当前 Codex 中仍属于实验接口，所以应用不能无条件声称兼容任意已安装版本。发布构建必须包含明确的兼容版本策略和不兼容提示。

## 7. 仓库结构

```text
lumen-ai/
├── apps/
│   └── desktop/
│       ├── src/main/
│       ├── src/preload/
│       └── src/renderer/
├── crates/
│   └── lumen-core/
│       ├── src/ipc/
│       ├── src/db/
│       ├── src/project/
│       ├── src/git/
│       ├── src/runtime/codex/
│       ├── src/approval/
│       └── src/recovery/
├── packages/
│   ├── contracts/
│   └── ui/
├── schemas/
│   └── codex-app-server/
├── docs/
├── package.json
├── pnpm-workspace.yaml
└── Cargo.toml
```

`packages/contracts` 定义 Renderer、Electron Main 和 Rust Core 之间的 Lumen 业务协议，不直接向 Renderer 暴露完整 Codex 原生协议。

## 8. 最小数据模型

SQLite 启用 WAL、Foreign Keys、Schema Migration 和启动一致性检查。

### `project`

- `id`
- `name`
- `root_path`
- `git_common_dir`
- `created_at`
- `last_opened_at`

### `agent_profile`

- `id`
- `slug`
- `display_name`
- `role_contract`
- `persona`
- `visual_state_json`
- `runtime_enabled`
- `created_at`
- `updated_at`

初始数据固定包含：洛可、沐瓦、眠枝、绮露。只有沐瓦的 `runtime_enabled = true`。

### `task`

- `id`
- `project_id`
- `owner_agent_id`
- `title`
- `goal`
- `status`
- `worktree_path`
- `branch_name`
- `base_revision`
- `created_at`
- `updated_at`
- `completed_at`

状态集合：

```text
draft
preparing
running
waiting_approval
interrupted
recovering
completed
failed
cancelled
```

### `runtime_session`

- `id`
- `task_id`
- `provider`
- `native_thread_id`
- `session_generation`
- `codex_version`
- `cwd`
- `status`
- `started_at`
- `last_seen_at`

### `turn`

- `id`
- `runtime_session_id`
- `native_turn_id`
- `user_input`
- `status`
- `started_at`
- `finished_at`
- `error_json`

### `event_log`

- `id`
- `task_id`
- `turn_id`
- `sequence`
- `event_type`
- `native_method`
- `payload_json`
- `created_at`

### `approval`

- `id`
- `task_id`
- `turn_id`
- `native_request_id`
- `approval_type`
- `reason`
- `request_json`
- `status`
- `decision_json`
- `requested_at`
- `resolved_at`

### `artifact`

- `id`
- `task_id`
- `kind`
- `title`
- `uri`
- `metadata_json`
- `created_at`

v0.01 不单独建立 `message_chunk` 和 `tool_output_chunk`。流式 Chunk 先进入内存聚合，并按大小或时间批量写入 `event_log`，避免每个 Token 都形成一次 SQLite 事务。

## 9. Codex Adapter 最小能力

### 必须实现的客户端请求

- `initialize` / `initialized`
- `account/read` 或等价认证状态读取
- `thread/start`
- `thread/resume`
- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `thread/read`

### 必须处理的事件

- Thread 和 Turn 生命周期
- Agent Message Delta
- Command Execution 生命周期与输出 Delta
- File Change 生命周期与 Patch 更新
- Approval Request
- Error
- Turn Completed

### 必须回复的 Server Request

- Command Execution Approval
- File Change Approval
- Permission Escalation Approval
- Tool User Input

MCP Elicitation、动态自定义 Tool 和 Auth Token Refresh 若出现但 v0.01 未支持，必须失败关闭并给出可理解错误，不得默认批准。

### Lumen 标准事件

v0.01 只定义 UI 所需的最小投影：

```text
runtime.state
turn.state
agent.text.delta
command.started
command.output.delta
command.completed
file.change.updated
approval.requested
approval.resolved
artifact.created
error
```

每条标准事件保留 `native_method` 和原始 Payload，以便诊断协议变化。

## 10. Git 与 Worktree

### 创建任务

1. 校验项目是 Git 仓库。
2. 读取当前 HEAD，保存为 `base_revision`。
3. 创建任务分支 `lumen/task-<short-id>`。
4. 在 Lumen Application Support 目录下创建专用 Worktree。
5. 将 Worktree 路径作为 Codex Thread 的 cwd。
6. 只有 Worktree 和明确追加的目录可以写入。

推荐路径：

```text
~/Library/Application Support/Lumen AI/worktrees/<project-id>/<task-id>/
```

### 完成任务

v0.01 不自动合并和删除 Worktree。任务完成后用户可以：

- 查看完整 Diff；
- 在 Finder 中显示 Worktree；
- 复制 Worktree 路径；
- 在终端中打开 Worktree；
- 保留任务及其 Worktree；
- 显式放弃任务，但文件删除仍需要单独确认。

自举验收从该 Worktree 执行构建，不要求先合并回主分支。

## 11. 权限与审批

### 初始任务授权

用户创建任务时确认：

- Codex 可以读取项目；
- Codex 可以在该任务 Worktree 内创建、修改和删除文件；这些变化由 Git 隔离、可检查且可恢复；
- Codex 可以运行项目内已有、明确范围的检查和测试；
- Codex 可以通过用户现有登录与其模型服务通信；
- 所有活动会被记录。

### 必须逐次审批

- Agent 工具发起的任意网络访问，不含上述 Codex 模型通道；
- 安装或升级依赖；
- Worktree 外写入；
- 删除 Worktree、项目或 Worktree 外的文件；Worktree 内文件删除作为可回滚 Patch 记录并突出展示；
- Codex 发起的外部应用打开；
- 访问凭据或敏感目录；
- Git commit；
- 任何 Codex 或 Lumen 策略标记为高风险的命令。

v0.01 的审批 UI 至少提供：

- 允许一次；
- 本次任务允许；
- 拒绝；
- 拒绝并中断 Turn。

审批必须先持久化，再回复 Codex。无法识别或无法呈现完整参数的审批默认拒绝。

## 12. 页面与交互范围

### 12.1 首次启动与 Runtime Health

展示：

- Codex 是否安装；
- Codex 版本与兼容性；
- 登录状态；
- Rust Core 状态；
- SQLite 状态；
- Git 是否可用；
- 修复建议和重新检测按钮。

v0.01 不读取或展示原始 Codex Token。

### 12.2 首页

- 最近项目；
- 打开本地项目；
- 四个伙伴卡片和当前状态；
- 最近任务；
- 温暖营地品牌层可以出现，但不实现复杂动画。

### 12.3 任务工作区

```text
┌────────────┬──────────────────────────┬──────────────────────┐
│ Project    │ Conversation / Timeline  │ Activity / Changes   │
│ Agents     │                          │                      │
│ Tasks      │                          │ Command              │
│            │                          │ Diff                 │
│            │                          │ Approval             │
├────────────┴──────────────────────────┴──────────────────────┤
│ Composer                                      Stop / Send   │
└─────────────────────────────────────────────────────────────┘
```

必须具备：

- 当前 Agent、Task 和 Runtime 状态；
- 流式消息；
- 当前动作和命令输出；
- 文件变更列表与 Diff；
- 审批抽屉或模态框；
- 追加指令；
- 中断 Turn；
- 打开任务 Worktree。

### 12.4 设置与诊断

- Codex 路径、版本和登录状态；
- 应用数据目录；
- 原始事件和日志导出；
- 数据库备份或导出；
- 不包含模型市场、MCP 和 Skill 管理。

## 13. 崩溃与恢复语义

v0.01 不承诺恢复已经死亡的同一个 Codex 进程或同一个进行中 Turn。

应用启动时：

1. 查找状态为 `running`、`waiting_approval` 或 `recovering` 的任务。
2. 校验项目和 Worktree 是否仍存在。
3. 检查 Git HEAD、工作区 Diff 和未跟踪文件。
4. 启动新的 Codex app-server 进程。
5. 使用保存的 Native Thread ID 调用 `thread/resume`。
6. 将旧 Turn 标记为 `interrupted`。
7. 生成包含目标、已完成动作、当前 Git 状态和待处理事项的 Resume Frame。
8. 将任务标记为 `recovering` 并展示给用户。
9. 用户确认后，以一个新的 Turn 继续。

如果原生 Thread 无法恢复：

- `session_generation + 1`；
- 创建新 Thread；
- 仅发送 Resume Frame，不回放完整原始 Transcript；
- 明确告诉用户发生了 Session Generation 切换。

应用崩溃时尚未回答的 Approval 不可在新进程中重放为已批准状态。

## 14. macOS 构建与交付

### v0.01 产物

必须生成：

```text
dist/mac-arm64/Lumen AI.app
```

建议同时生成便于本地安装的：

```text
dist/Lumen-AI-0.0.1-arm64.dmg
```

### 发布约束

- Apple Silicon；
- macOS 14+；
- 开发阶段允许 ad-hoc 签名；
- 正式 Developer ID 签名与 Notarization 延后；
- App 不捆绑 Codex CLI；
- 首次启动通过用户 Shell 环境和常见安装位置查找 `codex`；
- 打包后的 Rust Core 必须位于 App Resources 内并具备执行权限；
- App 不依赖全局 Node.js 或 Rust 工具链运行。

## 15. 实现切片

### Slice 0：可安装空壳

- 初始化 Git 和 Monorepo；
- Electron + React + Preload；
- Rust Core 子进程；
- Renderer 到 Rust Ping/Pong；
- 生成并启动 `Lumen AI.app`。

### Slice 1：Codex Health 与单 Turn

- Codex 探测、版本检查和登录状态；
- app-server 启动与握手；
- 新建 Thread 和 Turn；
- 流式显示 Agent 文本；
- 中断 Turn。

### Slice 2：项目与 Worktree

- 打开 Git 项目；
- 创建 Task、Branch 和 Worktree；
- 将 cwd 固定到 Worktree；
- 展示 Git 状态和 Diff。

### Slice 3：活动与审批

- 命令和文件事件；
- Approval 持久化；
- 审批 UI 和响应；
- 审计时间线。

### Slice 4：持久化与恢复

- SQLite Migration；
- Task / Session / Turn / Event 状态；
- Electron 和 Codex 崩溃检测；
- 重启恢复与 Session Generation。

### Slice 5：自举与打包验收

- 用 Lumen 打开 Lumen 仓库；
- 在 Worktree 中完成一次真实代码修改；
- 从 Worktree 构建新 `.app`；
- App 打包 Smoke Test；
- 诊断数据导出。

每个 Slice 都必须保持主分支可构建，不先建立未被当前 Slice 使用的大型抽象层。

## 16. 验收场景

### A. macOS App

- [ ] 在干净的 Apple Silicon Mac 开发环境中能够构建 `Lumen AI.app`。
- [ ] `.app` 可以从 Finder 启动。
- [ ] 运行 `.app` 不要求系统安装 Node.js 或 Rust。
- [ ] Rust Core 崩溃后 UI 能显示故障并尝试有限次数重启。

### B. Codex 接入

- [ ] 能检测已安装并已登录的 Codex CLI。
- [ ] 能完成 app-server initialize 握手。
- [ ] 能开始、追加、停止和恢复 Codex Thread/Turn。
- [ ] Agent 文本、命令输出和文件变更能够流式显示。
- [ ] 不兼容的 Codex 版本不会静默继续运行。

### C. Worktree 编码

- [ ] 任务只能在专用 Worktree 中修改代码。
- [ ] 主工作区不会被任务直接修改。
- [ ] UI 显示文件列表和 Diff。
- [ ] 用户可以从 Finder 或终端打开 Worktree。

### D. 审批和审计

- [ ] 高风险操作在执行前出现在 Lumen 审批 UI。
- [ ] Approval 先写入 SQLite，再回复 Codex。
- [ ] 拒绝审批后 Turn 能继续安全处理或被用户中断。
- [ ] 用户能够查看每次工具活动的 Agent、时间、原因、参数和结果。

### E. 恢复

- [ ] 执行过程中强制退出 App，重启后能发现未完成任务。
- [ ] Worktree Diff 不丢失。
- [ ] 用户确认后能通过原 Thread 或新 Session Generation 继续。
- [ ] 不会把崩溃前未回答的 Approval 当作已经批准。

### F. 自举

- [ ] 使用 Lumen 打开 `murray17/lumen-ai` 本地仓库。
- [ ] 让沐瓦完成一个真实、可验证的小型代码任务。
- [ ] 在 Lumen 中检查活动、审批和 Diff。
- [ ] 从任务 Worktree 成功构建下一版 `Lumen AI.app`。
- [ ] 新构建 App 可以启动并读取原有本地任务数据。

## 17. Release Gate

只有同时满足以下条件才能标记 `v0.0.1`：

1. Slice 0～5 全部完成。
2. 验收场景 A～F 全部通过。
3. 没有 Renderer 直接访问 Node、Shell、文件系统或 Git 的路径。
4. 没有默认允许网络、项目外写入或未知审批类型的路径。
5. App 强制退出和 Codex 进程强制退出测试通过。
6. 从 Lumen 任务 Worktree 构建 Lumen 的自举演示通过。
7. 已记录兼容的 Codex CLI 版本。
8. 已生成本地安装说明、已知限制和诊断导出说明。

## 18. v0.02 之后

完成 v0.01 后，优先顺序为：

1. 洛可：独立规划 Thread 和结构化 Task 拆分；
2. 眠枝：只读 Review Thread；
3. 绮露：按需 UX Consult；
4. 三角色显式 Handoff；
5. 结构化 Fact Store 和可解释项目记忆；
6. Windows 打包和 Sandbox 验证；
7. Direct Model Adapter；
8. 正式签名、Notarization 和自动更新。

## 19. 参考

- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Codex CLI](https://developers.openai.com/codex/cli/)
- [Codex Sandbox and approvals](https://developers.openai.com/codex/security/)
- [原 Agent Team MVP 清单](./agent-team-mvp-checklist.md)
