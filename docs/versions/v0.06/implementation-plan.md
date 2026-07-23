---
document_type: implementation-plan
version: v0.06
lifecycle: current
authority: implementation-plan-and-acceptance
last_updated: 2026-07-23
---

# Lumen AI v0.06 实施计划与验收清单

> 状态：已完成；五个检查点均已通过
>
> 版本范围：[README.md](README.md)
>
> 跨版本约束：[ADR-0012](../../adr/0012-collaboration-v3-lightweight-task.md)、[ADR-0013](../../adr/0013-managed-content-and-read-side-v2.md)、[ADR-0014](../../adr/0014-stable-team-tool-gateway-v2.md)、[ADR-0015](../../adr/0015-action-safety-v2.md)、[ADR-0016](../../adr/0016-multi-runtime-execution-v2.md)
>
> 文档规则：[文档导航](../../README.md)

## 实施原则

- 分成五个可独立验证的检查点；每个检查点完成代码、Migration、测试和文档状态更新后形成一个独立 Commit。
- 先建立单一 Task Schema、命令和查询真源，再接 Renderer、Team MCP 与动态上下文；禁止在 UI 或 Prompt 中临时模拟领域状态。
- v0.06 是开发阶段断代升级。旧 Task、Evidence Gate、Dependency DAG、Capability、Contract 和死代码必须彻底删除，不保留双写或隐藏兼容路径。
- Task 只记录长期责任。创建、指派、改派和状态变化都不发送消息、不创建 AgentRun、不唤醒 Runtime。
- Team MCP 复用现有稳定 Gateway 与 Native Binding 身份；工具参数不能伪造 Camp、Actor、Run、Epoch、Capability 或幂等身份。
- Renderer 从一致 SQLite Snapshot 启动，增量事件只做失效通知与时间线；Task 可见范围在 Core 查询层强制执行。
- Task Context 是有预算的活跃索引，不替代当前 Run 的 Work Brief，也不重复注入 Task 描述。

## 检查点 1：v17 协作断代与轻量 Task Core

> 实施状态：已完成（2026-07-23）。

目标：先让 SQLite、Domain Command 和权限只表达一种 Task 语义。

实施内容：

- 增加 v17 原子 Migration：清除 Camp 聚合和所有从属协作历史，保留 AgentProfile、Member Order、Adapter Installation、模型/权限偏好与独立设置。
- 重建最小 Task 表：`id / camp_id / title / description / status / assignee_agent_id / created_by_* / source_agent_run_id / version / timestamps`。
- 删除 Acceptance Criteria、Evidence Binding、TaskDependency、generation/origin/dedup/archive 字段、旧索引、旧状态和 legacy Task 写入口。
- 删除 `EvidenceService`、Task `EvidenceValidator`、旧 CompleteTask/Dependency Handler；将仍使用的 `ManagedBlobStore` 移出旧证据完成协议或至少保持独立模块边界。
- 实现强类型 `CreateTask`、`UpdateTask` 与授权查询服务；更新使用 `expectedVersion`，字段补丁原子提交，终态不可变。
- 实现 User 全量写、Lead 全量读、普通成员“自己 + 未分配”读取、普通成员认领/更新自己 Task、Assignee 转交/释放和不可用 Assignee 规则。
- 所有活跃 AgentProfile 默认补齐 `task.create`、`task.update`；移除 `task.complete`、`task.cancel`、`task.dependency.manage` 等废弃默认权限。
- Task 创建/更新继续经 ADR-0001 的 `DomainCommandGateway` 和 `event_log(command.result)` 幂等，不增加 CommandRecord 表。
- 删除自动随消息、AgentRun 或 Router 创建 Task 的路径；普通 Camp 消息仍只创建其明确请求的 Turn/Run。

完成门：

- 新库和 v16 数据库升级均得到相同 v17 Schema；Migration 重复打开不重复清除或产生半状态。
- 断代后 Camp/Task/Run 等协作表为空，成员和 Runtime 配置保持不变。
- 创建、认领、转交、释放、状态转换、版本冲突、权限拒绝和终态不可变均有事务级测试。
- 创建或更新 Task 前后，AgentRun、InboxMessage 和 Runtime 调度数量保持不变。
- `cargo fmt --check`、Core 测试和 Clippy 通过后提交检查点。

实施结果：

- v17 以一次原子断代清空旧协作聚合并重建唯一的轻量 Task Schema；重复打开已迁移数据库不会再次清理数据。
- AgentProfile、成员排序、Adapter Installation、模型与权限偏好继续保留；废弃 Task Capability 已迁移为 `task.create / task.update`。
- `CreateTask`、`UpdateTask`、User/Lead/普通成员授权读取范围与 Execution Epoch fencing 已落入 Core；Task 写操作不产生消息、Inbox 或 AgentRun。
- 旧 `tasks.*`、旧 Approval RPC、旧 Task Runtime 恢复入口和 Codex Legacy Task Runtime 已从生产路径删除；Managed Blob 已从 Evidence 完成协议中独立。
- 事务级 Migration、权限、版本冲突、认领、终态不可变和无隐式调度测试已通过；Core 全量测试和严格 Clippy 通过。

## 检查点 2：Read Side、IPC Contract 与用户 Task 管理面

> 实施状态：已完成（2026-07-23）。

目标：让用户在当前 Camp 内直接管理 Task，并证明读取范围不依赖 Renderer 自律。

实施内容：

- 更新共享 Contract 和 Camp Snapshot 的 Task DTO，删除 objective/criteria/readiness/evidence/dependency 字段，加入 description、creator、source Run、version、closedAt 和可执行操作。
- 增加 User Actor 的 Task create/update/list IPC；Electron Main 使用封闭 Allowlist，Renderer 不直接读取 SQLite。
- `list_tasks` 使用稳定排序和不透明游标；默认只返回 `pending / in_progress`，明确返回下一页/截断信息。
- 查询先应用 User/Lead/普通成员的可见范围，再应用 status、Assignee、limit 和 cursor；按 ID 查询使用同一范围。
- 将 Camp Inspector 的 Task 标签页升级为最小管理面：创建、详情、编辑标题/描述/Assignee、四态更新和终态只读。
- 表单提交携带 `expectedVersion`；冲突时保留草稿、刷新当前对象并显示明确提示，不做 last-write-wins。
- 覆盖 loading、empty、validation、disabled、permission denied、version conflict 和提交失败状态；不新增顶级 Task 导航、搜索、归档、删除或一键执行。
- 在 `1440×920` 与 `1040×700` 检查焦点、键盘操作、语义状态和布局。

完成门：

- 用户可创建未分配或已分配 Task，并可修改任意非终态 Task；操作不会唤醒 Assignee。
- Lead Snapshot 包含全部 Task；普通成员查询无法通过过滤器、猜测 ID 或游标读取其他成员 Task。
- 两个编辑者使用同一版本时只有首个写入成功，第二个保留草稿并显示冲突。
- Task 取消后从默认活跃列表消失，但显式终态查询仍可读取；不存在删除入口。
- TypeScript Typecheck、Renderer 单元测试和真实 Electron 两尺寸验收通过后提交检查点。

实施结果：

- Camp Snapshot 已升级为 Schema v3，并只投影 v0.06 Task 字段与当前 Actor 可执行操作；Renderer 不再依赖旧 Objective、Evidence、Dependency 或 Readiness 字段。
- 新增封闭的 `tasks.create / tasks.update / tasks.list / tasks.get` IPC；User 与 Team Tool 共用同一 Task Domain Command 和授权查询服务。
- Task 查询采用授权后过滤、稳定的 `createdAt + id` 倒序和不透明游标；默认只返回活跃 Task，终态可显式查询，读取不会写入事件或改变状态。
- Camp Inspector 已提供创建、详情、编辑、负责人调整、四态更新、终态只读和版本冲突保留草稿；创建与更新不会隐式创建消息、Turn 或 AgentRun。
- Core 全量测试、严格 Clippy、TypeScript Typecheck、Renderer 测试、Core Smoke 和桌面生产构建通过。
- 真实 Electron App 已在 `1440×920` 完成创建、分配、完成与终态只读验收，并在 `1040×700` 验证无横向溢出、Inspector 可滚动操作。

## 检查点 3：Team MCP Task 工具与 Charter 资源

> 实施状态：已完成（2026-07-23）。

目标：在不复制 Gateway 的前提下，让当前 AgentRun 安全调用三个 Task 工具。

实施内容：

- 将 Team MCP `tools/list` 扩展为 `team.post_message`、`team.create_task`、`team.update_task`、`team.list_tasks`。
- 为三个新工具建立 `deny_unknown_fields` 的窄化 JSON Schema；Task 写工具映射到检查点 1 的同一强类型命令，列表映射到同一范围过滤查询。
- 复用 Native Binding 凭据、当前 Run/Execution Epoch 解析和 Runtime Tool Call 幂等身份；模型不接收可信身份字段。
- `team.create_task` 支持可空 Assignee并固定创建 `pending`；`team.update_task` 使用三态 Assignee补丁和 `expectedVersion`；`team.list_tasks` 返回完整详情、版本、可用操作和分页游标。
- `team.list_tasks` 不要求额外 Capability；写工具分别校验 `task.create`、`task.update` 与对象关系。
- 保持 `team.post_message` Schema 不包含 `taskId`，目标 Run 不继承源 Run 的 Task 关联；Task 工具成功不产生 InboxMessage、ConversationMessage 或 AgentRun。
- 新增并编译期嵌入 `crates/lumen-core/resources/charter-team-tools.md`；内容只说明 Task/A2A 边界、可见范围和工具语义，不复制 JSON Schema。
- Charter 资源只在成功绑定 Team MCP 的新 Native Session 中追加一次，并参与 Compatibility Digest；不得替换上游 System Prompt。
- Bridge/Gateway 错误继续使用标准 MCP Error Content，成功输出具有版本化结构且不泄露不可见 Task。

完成门：

- 同一 Runtime Tool Call 重放 100 次只创建或更新一次；不同参数复用同一身份得到幂等冲突。
- 旧 Binding/Epoch、无当前 Run、跨 Camp、Capability 撤销、隐藏 Task 和版本冲突全部确定性拒绝。
- Task 工具事务失败不留下半 Task/半事件；列表查询不创建 command.result 或审计噪音。
- 调用 Task 工具前后 AgentRun、Inbox 和 Scheduler 队列不变；只有显式 `team.post_message` 创建目标 Run。
- Core/MCP 单元测试、Bridge Smoke 和现有 A2A 回归通过后提交检查点。

实施结果：

- 现有 Team MCP 已扩展为 `team.post_message / team.create_task / team.update_task / team.list_tasks`，没有新增第二个 MCP Server、Connector 或授权通道。
- Bridge 只接收模型拥有字段；Camp、Agent、AgentRun、Execution Epoch、Capability、Binding Credential、Command ID 和幂等身份均由 Lumen 私有通道解析。
- Task 写工具复用轻量 Task 的强类型 Domain Command 和 Command Gateway；列表复用授权后过滤、稳定分页与 Read Side，不产生 `command.result` 或额外审计事件。
- Core 内部 Assignee Patch 保持三态；为兼容四种 CLI 的 MCP Schema 子集，模型可见线协议使用 `clearAssignee` 与 `unassignedOnly` 表达清空和未分配过滤，显式 `null` 仅保留兼容解析。
- Task 工具不创建 InboxMessage、ConversationMessage 或 AgentRun；`team.post_message` 也不再让 A2A 目标 Run 继承源 Run 的 Task。
- Team Tool Contract 已作为编译期资源纳入支持 Team MCP 的新 Session Charter 与兼容摘要；Antigravity App 不宣称具备 Team Tool。
- Core 114 项自动测试、严格 Clippy、TypeScript 与 Renderer 测试、Core Smoke 均通过；真实 Codex CLI `0.145.0` 的 A→B→A Team Tool 链路通过，三次 Run 均成功且恢复无重复。

## 检查点 4：TASK_CONTEXT 与 Adapter 实际工具发现

> 实施状态：已完成（2026-07-23）。

目标：让 Agent 在每轮获得正确、紧凑的责任索引，并在支持的本机 Runtime 中发现新工具。

实施内容：

- Context Formatter 在 `[WORK_BRIEF]` 之后增加独立 `[TASK_CONTEXT]`；Task Context 数据进入不可变 ContextManifest 与最终载荷摘要。
- 默认只注入可见的 `pending / in_progress` Task，并只输出 ID、title、status、Assignee。
- 排序优先当前 Task、自己 `in_progress`、自己 `pending`、未分配；Lead 再加入其他成员 Task，同优先级采用稳定排序。
- 为 Task Context 设置独立预算。溢出时输出遗漏数量与 `team.list_tasks` 提示，不摘要 Task description，也不假装索引完整。
- 当前 AgentRun 已关联 Task 时，完整描述只进入 Work Brief；Task Context 中的重复项明确标记为 current。
- Context 冻结后 Task 变化不改写同一 AgentRun 的 Manifest；Agent 更新前必须通过 `team.list_tasks` 读取最新版本。
- 更新 Codex、OpenCode、Copilot 与 Claude Code 的 Team MCP Smoke，使 `tools/list` 和真实模型调用可发现三个新工具；继续按本机能力探测，不锁 CLI 版本。
- Antigravity App 保持 Team Tool Unsupported，不能因为 Task 工具加入而虚报支持。

完成门：

- Lead 与普通成员的冻结 Payload 分别只包含其授权范围；隐藏 Task 的标题、描述和 ID 不泄漏。
- Task 数量超预算时载荷大小有界、排序稳定、遗漏数量正确；无 Task 时不产生误导性工作指令。
- 同一 AgentRun 恢复仍使用原 ContextManifest；后续 Task 更新只进入新 Run。
- 四个已支持 Adapter 均能追加发现三个 Task 工具且不覆盖用户 MCP/System Prompt；Antigravity 明确拒绝。
- Context、Adapter 单元测试和真实 CLI Tool Discovery Smoke 通过后提交检查点。

实施结果：

- Context Formatter v2 已在 `[WORK_BRIEF]` 后加入独立 `[TASK_CONTEXT]`；只包含经 Core 授权的活跃 Task ID、标题、状态、Assignee 与 current 标记。
- 排序按当前 Task、自己进行中、自己待处理、未分配、Lead 可见的其他成员 Task确定性执行；区段按实际 pretty JSON 渲染字节限制为 8 KiB，截断时给出准确遗漏数和查询提示。
- Migration v18 将 Task Context JSON 与摘要写入不可变 ContextManifest；Camp Snapshot 升级为 Schema v4。同一 AgentRun 恢复复用原 Manifest，后续 Task 变化只影响新 Run。
- Team MCP 输入 Schema 收口为四个 Adapter 均接受的简单对象结构；同时修复隔离 ACP Host 之间 Native Prompt ID 冲突，避免并发 Host 事件被唯一约束误判为重复。
- 当前最终 Schema 已通过 OpenCode `1.18.0`、GitHub Copilot CLI `1.0.73` 与 Claude Code `2.1.206` 的真实 `create → list → update` 闭环，并在重启后保持一次性结果。Codex CLI `0.145.0` 已确认 MCP Server 启动和 Prompt 注入正常；本轮最终模型复验因本机账户 `usageLimitExceeded` 被外部额度阻断，先前真实 Codex Task Tool 闭环已通过。
- Antigravity App 继续不注入 Team Tool Charter，也不会在截断提示中虚构 `team.list_tasks` 能力。

## 检查点 5：多 Agent 闭环、清理与 App 验收

> 实施状态：已完成（2026-07-23）。

目标：证明 Task 作为长期责任记录能够与普通消息、A2A、恢复和用户管理协同工作，同时彻底清除旧模型。

实施内容：

- 增加真实闭环：Agent A 创建分配给 Agent B 的 Task；确认 B 未被唤醒；A 再调用 `team.post_message`；B 在新 Run 中从 Task Context/列表读取 Task并显式更新状态。
- 覆盖未分配 Task 被两个成员并发认领、Assignee 转交、Capability 撤销、Lead 更换、Assignee 禁用和用户修复。
- 杀死 App/Core/Runtime，验证已提交 Task 不重复、未提交调用零写入、Native Binding Fencing 和既有 A2A 恢复不回归。
- 删除仓库中旧 Task 状态、Evidence Binding、Dependency、CompleteTask、旧 Contract、旧 UI 文案、迁移 Fixture 和不可达代码；使用全文扫描作为完成门。
- 更新 README/版本实施状态、Schema/Contract 版本和本地开发说明；记录真实 Runtime 版本仅作为验收证据，不形成版本白名单。
- 执行生产构建、macOS 打包、签名检查和隔离数据目录启动验收。

完成门：

- 用户和 Agent 均能创建、查看、分派和更新 Task；所有入口共享一套 Core 语义和错误码。
- 创建或指派 Task 永不唤醒 Agent；只有普通 Camp 执行消息或 `team.post_message` 创建 Run。
- `completed` 无 Evidence Gate且不被 Run 状态自动改变；终态不可修改、不可删除。
- 重启、重复调用和并发更新不产生重复 Task、倒退版本、越权读取或幽灵 AgentRun。
- 仓库全文不存在当前代码对旧 Task Evidence/Dependency/状态协议的生产引用。
- 全量测试、Smoke、生产构建和打包 App 双尺寸验收通过后提交检查点。

实施结果：

- 真实 GitHub Copilot CLI `1.0.73` 的双 Agent 闭环通过：洛可创建并分配 Task 后没有产生接收者 Run；显式 `team.post_message` 只创建一个沐瓦 Run；沐瓦通过查询取得最新版本并将 Task 从 `pending` 更新为 `in_progress`、再更新为 `completed`，最终版本为 3。
- Team MCP 结果增加由 Lumen Bridge 写入的 `lumenTeamTool` 与绑定凭据校验值。Copilot ACP 即使省略工具名、把业务字段误作标题，Core 也只会在校验值与当前私有 Native Binding 匹配时跳过二次 Action 审计；普通或伪造的 Shell/Edit 工具仍走 Action 安全协议。
- OpenCode `1.18.0` 的 Core 硬中断恢复通过：Runtime 已确认接收输入后，重启保留同一 AgentRun、Execution Epoch、ContextManifest 和输入投递记录，并停留在 `waiting(runtime_recovery)` 等待对账；Core 不盲目重发可能已经执行的输入。
- 同一 Task 命令 ID 在重启后返回原结果；第二次重启仍保持零重复 AgentRun、Task 和 InboxMessage。恢复扫描只使用权威对象状态，不以事件重放触发副作用。
- 已删除 legacy Project/执行型 Task/旧 Approval 生产 API、废弃 Runtime Smoke 与 self-bootstrap 脚本；仍保留的旧表名只存在于历史 Migration、v17 清理和“确认已删除”的迁移测试中。
- 全量验证通过：Core 85 个 library 测试与 33 个 binary 测试通过，4 个手工真实 Runtime 测试按设计忽略；Renderer 26 个测试、TypeScript、严格 Clippy、Core Smoke、成员配置 Smoke、真实恢复 Smoke 和真实 Task 交接 Smoke 均通过。
- `pnpm build`、`pnpm package:mac` 与 `codesign --verify --deep --strict` 通过。打包 App 使用隔离数据目录，在 `1440×920` 和 `1040×700` 均完成默认大厅、成员配置、Runtime 诊断与新对话焦点/布局验收；Copilot 成员 Runtime 保存分别耗时 514 ms 与 510 ms。
- 检查点 2 已完成真实 Task Inspector 的创建、分配、完成、终态只读与双尺寸验收；检查点 5 的最终 Release 包复验未发现新的 Renderer 回归。
- 本轮 Codex 最终模型复验受本机账户 `usageLimitExceeded` 限制；OpenCode 曾短暂返回 `No provider available`，随后恢复链路通过。这两项属于外部服务状态，不形成 CLI 版本锁定或对代码验收结果的替代。

## 验收矩阵

| 编号 | 场景 | 预期结果 |
|---|---|---|
| AC-01 | v16 数据库首次升级 | 协作聚合清空；成员、Adapter 和偏好保留；v17 原子记录 |
| AC-02 | 重复打开 v17 数据库 | 不重复清理，不改变已创建的新 Task |
| AC-03 | 用户创建未分配 Task | `pending` Task 出现；无消息、Run 或 Runtime Wake |
| AC-04 | Agent 创建分配给 B 的 Task | Task 创建且 B 未唤醒；来源 AgentRun 被记录 |
| AC-05 | A 随后 `team.post_message` 给 B | 只有该消息创建 B Run；Task 与 Run 不被隐式绑定 |
| AC-06 | 普通成员列出 Task | 只返回 assigned-to-self 与 unassigned |
| AC-07 | Default Lead 列出 Task | 返回 Camp 全部授权 Task，但无额外写操作 |
| AC-08 | 普通成员猜测他人 Task ID | `not_found/forbidden` 等不泄漏结果，正文不返回 |
| AC-09 | 两人并发认领同一 Task | 首个 CAS 成功，第二个版本冲突，无覆盖 |
| AC-10 | 当前 Assignee 转交或释放 | 单事务更新；不通知、不停止或创建 Run |
| AC-11 | Agent 修改他人 Task | 即使能猜到 ID也被范围校验拒绝 |
| AC-12 | User 修改任意非终态 Task | 更新成功并记录 User Actor 与版本 |
| AC-13 | `pending ↔ in_progress` | 显式转换成功，版本单调增加 |
| AC-14 | 直接 `pending → completed` | 无 Acceptance/Evidence Gate，写入 closedAt |
| AC-15 | 修改 completed/cancelled | 确定性拒绝，Task 和事件不变 |
| AC-16 | 重复 MCP create/update | 返回首次 command.result，不重复写 Task/Event |
| AC-17 | `team.list_tasks` 翻页 | 授权后分页稳定，nextCursor/截断信息明确 |
| AC-18 | TASK_CONTEXT 超预算 | 只保留高优先级索引并报告遗漏数量 |
| AC-19 | Task 在 Run 冻结后更新 | 旧 Manifest 不变，新 Run 看到新版本 |
| AC-20 | Assignee 被禁用/移出 | 派生 unavailable；其他 Agent不能修复，User 可以 |
| AC-21 | Camp 永久删除 | Task 随聚合删除，无单独 Task 删除 API |
| AC-22 | 旧 Binding/Epoch 调 Task Tool | Fencing 拒绝，数据库零写入 |
| AC-23 | Adapter 不支持 Team MCP | 不注入 Charter Tool 规则，不宣称 Task Tool 可用 |
| AC-24 | App/Core 在提交后崩溃 | 已提交 Task 保持一次；Wake 丢失不会产生额外 Run |

## 每个检查点的验证基线

```text
cargo fmt --check
cargo test -p lumen-core
cargo clippy -p lumen-core --all-targets -- -D warnings
pnpm typecheck
pnpm test
pnpm smoke:core
```

涉及 Team MCP 时追加 Bridge、`smoke:team-context` 与各支持 Adapter 的真实 Tool Discovery；涉及上下文时追加 Manifest/恢复/过载测试；涉及 Renderer 时启动真实 Electron App检查 `1440×920` 与 `1040×700`。最终检查点执行：

```text
pnpm build
pnpm package:mac
```
