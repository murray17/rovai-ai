# Lumen AI v0.01 As-built Architecture

> 状态：从当前代码反推的架构基线
>
> 基线提交：`65d2a04`
>
> 更新日期：2026-07-18

## 1. 架构目标

v0.01 的架构优先级按顺序为：

1. **本地优先**：项目文件、任务状态和审计数据留在本机；
2. **可解释**：用户能够区分对话、Runtime 活动、审批、Diff 和系统状态；
3. **可恢复**：Codex Worker 可丢弃，产品任务与持久状态不依赖进程长期存活；
4. **最小权限**：Renderer 不直接获得系统能力，高风险操作交由审批边界处理；
5. **可自举**：Lumen 能直接打开自身仓库并完成真实、可验证的开发任务。

## 2. 系统上下文与进程拓扑

```text
┌──────────────────────────── Lumen AI.app ────────────────────────────┐
│                                                                      │
│  React Renderer                                                      │
│  - 页面、交互、事件投影                                              │
│  - Sandbox / no Node / no FS / no Git                                │
│            │                                                         │
│            │ contextBridge + typed IPC                               │
│            ▼                                                         │
│  Electron Main                                                       │
│  - 窗口、系统对话框、Finder、Core 生命周期                           │
│            │                                                         │
│            │ Lumen JSONL over stdio                                  │
│            ▼                                                         │
│  Rust Core                                                           │
│  - Application Service / Policy Gateway / Audit Boundary             │
│  - SQLite / Git / Codex Runtime / Recovery                           │
└──────────┼───────────────────────────────────────────────────────────┘
           │ Codex app-server JSON-RPC over stdio
           ▼
    Disposable Codex Worker
           │ cwd + workspace-write sandbox
           ▼
    App-owned Lobby or selected Git project
```

Electron Main 是桌面父进程。Rust Core 是随 App 打包并由 Main 启动的子进程，不是系统常驻服务。每个运行中的任务对应一个内存中的 Codex Runtime；Codex Worker 退出后可以从 SQLite 保存的 Session 信息恢复。

## 3. 代码边界与所有权

| 边界 | 路径 | 所有权 |
| --- | --- | --- |
| Renderer | `apps/desktop/src/renderer/` | 视图状态、交互、事件投影、可访问性 |
| Preload | `apps/desktop/src/preload/` | 暴露最小化 `window.lumen` API |
| Electron Main | `apps/desktop/src/main/` | IPC Allowlist、系统能力、Core 监管 |
| Shared contracts | `packages/contracts/` | Renderer/Main 使用的 TypeScript 业务协议 |
| Rust Core | `crates/rovai-core/` | 领域状态、持久化、Git、Runtime、审批、恢复 |
| Codex schemas | `schemas/codex-app-server/0.144.5/` | 固定上游实验协议的参考 Schema |
| Build scripts | `scripts/` | Core 构建、Smoke、Recovery、自举与视觉捕获 |

关键所有权规则：

- Renderer 只请求业务动作，不自行读取文件或执行命令。
- Electron Main 只提供桌面系统能力和 Core 进程桥接，不承载业务状态。
- Rust Core 是 Task、Runtime Session、Approval 和 Event 的事实源。
- Codex 是可替换 Worker，不是 Agent 身份、任务状态或审计事实源。

## 4. 领域模型与不变量

### 4.1 主要对象

- `AgentProfile`：持久伙伴身份；v0.01 只有沐瓦启用 Runtime。
- `Project`：执行上下文，`kind` 为 `lobby` 或 `git`。
- `Task`：用户目标及产品状态，保存 `execution_root`、`start_branch` 和 `base_revision`。
- `RuntimeSession`：Provider Session，保存 Native Thread ID 和 `session_generation`。
- `TimelineEvent`：每个 Task 内单调递增的 append-only 审计事件。
- `Approval`：Codex Server Request 的持久化请求与用户决策。

数据库中已有 `turn` 和 `artifact` 表，但当前代码没有完整写入或产品读取路径，因此它们不属于 v0.01 已实现能力。

### 4.2 必须保持的不变量

```text
Project Context != Task
Task != Conversation Projection
Task != Codex Thread
Codex Thread != Codex Process
Task Status != Agent 文本中的自述状态
Lobby Context != Git Project
Role Identity != Runtime Session
```

- 默认大厅使用固定 Project ID 和 App 自有目录，不初始化或检查 Git。
- Git Project 必须至少存在一个 Commit；Task 记录启动时分支和基准提交。
- Core 对同一 Project Context 最多允许一个其他活跃任务，避免并发写入。
- Git Diff 相对 `base_revision` 计算；大厅始终返回空 Diff。
- 原生 Thread 恢复失败时创建新的 Runtime Session Generation，而不是覆盖旧 Session 身份。

## 5. 核心运行流程

### 5.1 打开项目

1. Renderer 请求系统目录选择器；
2. Electron Main 获取目录后调用 `projects.open`；
3. Rust Core 使用 Git 校验根目录、Common Dir、当前分支和 HEAD；
4. SQLite 按根路径 Upsert `git` Project；
5. Renderer 刷新 Project/Task 视图。

### 5.2 创建并启动任务

1. 大厅首条消息或项目任务表单调用 `tasks.create`；
2. Core 解析 Project Context：大厅使用 App 自有目录，Git Project 使用仓库根目录；
3. Core 保存 Task 与 `task.created` 事件；
4. `tasks.start` 检查同 Project 是否已有其他活跃任务；
5. Core 检查 Codex 版本、创建/读取 Runtime Session，并启动 app-server；
6. 创建或恢复 Native Thread，再启动 Turn；
7. Task 状态成为 `running`，用户消息写入 Event Log。

### 5.3 事件与 UI 投影

Codex stdout 由 Runtime Reader 解码。RPC Response 回到 Pending Request；Notification 和 Server Request 进入统一事件通道。Core 先保存标准化事件，再通过 JSONL 推送 Electron Main，Renderer 将 Event Log 投影为：

- Conversation；
- Activity；
- Changes/Diff；
- Approval；
- Audit。

未知 Notification 以 `runtime.native` 保存原始 Method 和 Payload，避免上游协议扩展导致 Turn 崩溃。

### 5.4 审批

1. Core 识别 Command、File Change 或 Permission Approval；
2. Approval Request 写入 SQLite，Task 进入 `waiting_approval`；
3. UI 显示请求，用户选择允许一次、Session 允许、拒绝或取消；
4. Core 将决定映射为 Codex Response；
5. Approval 和 `approval.resolved` Event 更新，Task 回到 `running`。

无法识别或无法持久化的 Server Request 必须失败关闭，不得默认批准。

### 5.5 中断与恢复

应用启动时，Core：

1. 将未决 Approval 标记为拒绝；
2. 将活跃 Runtime Session 标记为 `interrupted`；
3. 将未完成 Task 标记为 `recovering`；
4. 记录 `application/restarted` 边界；
5. 等待用户确认后才调用 `tasks.resume`。

恢复优先使用保存的 Native Thread ID。失败时增加 `session_generation`、创建替代 Thread，并只发送包含目标、执行目录和当前 Git 状态的 Resume Frame，不回放完整 Transcript。

## 6. 持久化架构

SQLite 文件位于 Electron `userData` 下的 Core Data Directory，配置为：

- `journal_mode = WAL`；
- `foreign_keys = ON`；
- `synchronous = NORMAL`；
- 单 Core 进程内由 `tokio::Mutex<Database>` 串行访问。

当前 Migration 版本：

| 版本 | 作用 |
| --- | --- |
| 1–2 | 建立初始领域表和索引 |
| 3 | 将旧 `worktree_path` / `branch_name` 迁移为 `execution_root` / `start_branch` |
| 4 | 为 Project 增加 `kind`，旧记录默认迁移为 `git` |

Event Sequence 使用每个 Task 当前最大序号加一。该实现依赖当前单进程、串行数据库访问模型；引入并行写入或多进程 Core 前必须改为数据库级原子分配。

## 7. 协议与契约

### 7.1 Renderer ↔ Main ↔ Core

- `packages/contracts` 定义 TypeScript 类型和允许的 `CoreMethod`；
- Electron Main 维护独立 Method Allowlist；
- Rust Core 通过 `Core::handle` 解析相同方法和参数；
- stdio 每行只允许一个 JSON Request、Response 或 Event；
- Rust stdout 只承载协议，诊断写 stderr。

新增业务方法必须同步修改 TypeScript Contract、Main Allowlist、Rust Handler、Renderer 调用和测试。当前 Rust/TypeScript Contract 由人工镜像，存在漂移风险。

### 7.2 Core ↔ Codex

- 协议：实验性 app-server JSON-RPC；
- 传输：`codex app-server --listen stdio://`；
- 兼容基线：严格固定 `0.144.5`；
- 策略：`workspace-write`、`on-request`、`approvalsReviewer = user`；
- 参考 Schema：`schemas/codex-app-server/0.144.5/`。

升级 Codex 基线必须作为显式兼容性变更，同时更新版本常量、Schema、事件映射、审批映射、健康检查、Smoke Test 和版本文档。

## 8. 信任与安全边界

- Renderer Sandbox、Context Isolation 和禁用 Node Integration 是不可弱化边界。
- Preload 只暴露业务请求、事件订阅、项目选择、Finder 显示和诊断导出。
- Electron Main 对业务 Method 使用 Allowlist，并阻止任意页面导航。
- Rust Core 决定 Task cwd、Codex Sandbox 与 Approval Policy。
- 项目任务直接使用用户仓库根目录；这提供真实开发闭环，但不提供 Worktree 级变更隔离。
- Agent 必须保留用户已有修改，不得默认切换分支、Reset、Commit、Push 或创建 PR。
- 诊断导出不得包含 Codex Token；文件以用户私有权限写出。

Codex 与模型服务的通信沿用用户现有 Codex 配置。Lumen v0.01 不代理或完整检查上游模型流量，也不宣称对未知仓库提供完整 OS 隔离。

## 9. 可观测性与诊断

系统当前提供三类证据：

- SQLite Event Log：产品级、按 Task 排序的持久审计；
- Runtime stderr：Core/Codex 诊断日志，不进入协议 stdout；
- Diagnostics JSON v2：Agent、Project、Task、Event、Approval 和兼容基线快照。

Renderer 不直接消费原始 Codex Transcript，而是基于 Event Log 构建可解释视图。事件标准化逻辑变化必须保留 Native Method 和原始 Payload。

## 10. 构建与部署

- pnpm Workspace 管理 Electron/React/Contracts；Cargo Workspace 管理 Rust Core。
- `scripts/build-core.mjs` 编译 Core，并复制到 `resources/bin/rovai-core`。
- electron-builder 将 Core 作为 `extraResources` 放入 App Bundle。
- macOS 目标为 14+ Apple Silicon，当前使用 Hardened Runtime 和 ad-hoc 签名。
- 打包后不依赖系统 Node.js、pnpm 或 Rust；仍依赖 Git 和兼容的 Codex CLI。

命令和验证入口见 [../../local-development.md](../../local-development.md)。

## 11. 验证策略

- TypeScript：严格 Typecheck；
- Renderer：Vitest 验证事件投影、Diff、审批语义和大厅状态；
- Rust：领域辅助函数、Migration、Lobby、并发写入约束和协议映射单测；
- `smoke:core`：真实 Codex、事件流、Approval Persistence 和拒绝路径；
- `smoke:recovery`：Core 重启、Thread 恢复、Resume Frame 和最终状态；
- macOS Package：构建、签名校验和启动检查。

## 12. 当前风险与技术债

| 风险 | 影响 | 当前缓解 |
| --- | --- | --- |
| 直接修改项目根目录 | Task Diff 会包含用户原有未提交修改，无法完全归因于当前 Task | 启动前提示、保留修改指令、单项目活跃任务约束 |
| app-server 属于实验接口 | 上游事件或审批 Shape 变化可能破坏 Runtime | 固定版本、保存原始事件、Smoke Test |
| TypeScript/Rust Contract 人工同步 | 字段或 Method 可能发生漂移 | Typecheck、Allowlist、集成验证；后续考虑 Schema 生成 |
| SQLite 单连接串行模型 | 不适合多进程或高并发写入 | v0.01 保持单 Core；扩展前重做写入模型 |
| `turn` / `artifact` 只有 Schema 骨架 | 数据模型容易被误判为已实现能力 | 实施状态明确排除无产品调用路径的骨架 |
| Approval 决策跨 Native Response 与 DB 更新 | 进程在中间失败时可能产生短暂不一致 | 重启时拒绝未决 Approval；后续考虑更明确的决策状态机 |
| Core/Event/UI 同时轮询与推送 | 可能产生重复刷新和无谓 I/O | v0.01 以正确性优先；后续统一增量订阅模型 |

## 13. 演进约束

后续版本可以改变实现，但必须显式处理以下兼容性：

- Project `kind`、Task 状态和现有 SQLite Migration；
- Native Thread ID 与 Session Generation 的恢复语义；
- Event Log 的 append-only 审计价值；
- Renderer 无系统权限的信任边界；
- 用户已有 Git 修改不可被静默覆盖；
- Codex 协议升级必须有明确基线和失败提示。

引入 Worktree、多 Agent、其他 Provider、长期记忆或多进程 Core 时，应建立新的版本架构记录，不要把这些能力追加为 v0.01 的既有事实。
