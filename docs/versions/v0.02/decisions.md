---
document_type: version-decisions
version: v0.02
lifecycle: historical
last_updated: 2026-08-18
---

# v0.02 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0001](#adr-0001) | Core Transaction | `accepted` |
| [ADR-0002](#adr-0002) | Collaboration | `superseded` |
| [ADR-0003](#adr-0003) | Execution Runtime | `superseded` |
| [ADR-0004](#adr-0004) | Action & Safety | `superseded` |
| [ADR-0005](#adr-0005) | Evidence & Read Side | `superseded` |

<!-- legacy-adr:begin id=ADR-0001 source-file-sha256=6bd8dfff4abee6a65b9558c935ed9cd146397986a802024134b11d69ef25d3ce -->
<a id="adr-0001"></a>

## ADR-0001: Core Transaction

迁移时原路径：`docs/adr/0001-core-transaction.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0001
title: "Core Transaction"
status: accepted
date: 2026-07-20
decision_scope: cross-version
source_version: v0.02
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0001 -->
<a id="adr-0001-context"></a>
### Context

v0.01 的数据库方法可以直接提交状态，`event_log` 仅按 Task 排序，且没有统一的命令身份、请求摘要、永久结果或 Runtime fencing 入口。v0.02 的多 Agent、后台扫描器和恢复流程会从 UI、Agent、Runtime 与 System 多个入口并发重试；如果每个 Service 自行实现幂等和事务，重复状态、重复副作用资格和恢复歧义将不可避免。

<a id="adr-0001-decision"></a>
### Decision

Rust Core 建立唯一的静态强类型 `DomainCommandGateway`。任何创建、修改或终结权威领域事实的操作都必须通过编译期封闭的命令类型和命令专用 Handler。

公共信封至少包含：

```text
commandId
actor（user / agent+sourceAgentRunId / system component）
命令特定业务参数
命令特定 expectedVersion
可选 reason / evidence references
Agent 命令的 executionEpoch fencing 上下文
```

处理顺序固定为：

```text
认证与规范化
→ 计算 versioned requestDigest
→ 查询既有 command.result
→ 可选只读 Preflight
→ BEGIN IMMEDIATE
→ 再次查询 command.result
→ 校验 epoch / capability / version / 领域门禁
→ 修改权威对象
→ 追加普通事件与唯一 command.result
→ COMMIT
→ best-effort typed Wake
```

相同 `commandId + commandType + requestDigest` 永久返回第一次结果；同一 `commandId` 携带不同语义请求返回 `idempotency_conflict`。幂等命中不重复写事件、不产生 Wake，也不重新执行副作用。

`event_log` 同时保存普通审计事件和特殊 `command.result`，但不是业务状态真源、Event Sourcing 存储、Outbox 或 Worker 队列。全局自增序列作为增量订阅游标；旧的 Task 维度序列只保留兼容读取所需语义。

Repository 只在调用方 Unit of Work 中读写，不自行提交事务。Migration 只改变 Schema/数据，不执行 Runtime、Git、网络或文件系统补偿。

<a id="adr-0001-schema-and-migration"></a>
### Schema and migration

第一阶段采用兼容迁移：

- 扩展/重建 `event_log`，允许无 legacy Task 的领域事件，并增加全局序列、Actor、实体引用、命令类型、请求摘要版本、结果码与结果 payload。
- 对非空 `command_id` 建立部分唯一索引，只允许 `event_type = 'command.result'` 持有命令结果字段。
- 保留 v0.01 可读取的 `task_id / turn_id / sequence / native_method / payload_json`，直到 Renderer 完成迁移。
- 在 `schema_migration` 记录新版本；迁移必须可重复打开数据库且不复制历史事件。
- 不在本阶段删除 legacy Project、Task、RuntimeSession、Approval 或 Artifact。

<a id="adr-0001-failure-semantics"></a>
### Failure semantics

- 事务回滚：没有对象变化、事件、结果或 Wake。
- 提交后 Wake 丢失：类型化扫描器从对象状态恢复。
- 进程在响应前崩溃：客户端以同一 commandId 重试并获得原结果。
- Agent 的旧 executionEpoch：不存在历史结果时拒绝；历史完全匹配的幂等查询仍可返回原结果，但必须通过当前读取权限。
- 外部 Preflight 变化：写事务内必须重新验证其冻结摘要或版本。

<a id="adr-0001-implementation-boundary"></a>
### Implementation boundary

- `db.rs` 继续拥有 SQLite 连接与 Migration，但新增明确 Unit of Work/transaction API。
- 强类型命令、Actor、Digest 和结果信封放在独立 Core 模块，不能以任意 JSON Command Bus 实现。
- v0.01 现有写方法可在迁移期作为 legacy facade，但所有新增 v0.02 写入口从第一天起使用 Gateway。
- 使用版本化 canonical JSON 计算 Digest；秘密只能以稳定引用或安全摘要参与，不能进入日志明文。

<a id="adr-0001-acceptance"></a>
### Acceptance

- 同一命令重复 100 次只产生一次对象变化和一个 `command.result`。
- 相同 commandId、不同 payload 返回稳定冲突。
- 在数据库提交后、Wake 前模拟崩溃，扫描器仍能发现工作。
- Migration 从 v0.01 数据库升级两次结果一致，旧事件仍可读取。
- 测试证明事务内不会调用 Runtime、Git、网络或文件系统执行器。

<a id="adr-0001-consequences"></a>
### Consequences

- 所有新增权威写入都必须经过静态强类型命令入口；调用方需要提供稳定 `commandId`、命令特定版本前置条件以及 Agent fencing 上下文。
- 幂等结果、对象变化和审计事件共享一个事务边界，使重试与崩溃恢复可解释，但也要求为每种领域意图维护显式命令和结果 Schema。
- Runtime、Git、网络和文件系统 I/O 必须与数据库事务分离；提交后的工作通过持久资格和扫描恢复，而不是依赖进程内回调可靠到达。
- Migration 与 legacy facade 必须保持单一权威写入方向，迁移期会承担额外的兼容与测试成本。

<a id="adr-0001-rejected-alternatives"></a>
### Rejected Alternatives

- 通用弱类型 Command Bus。
- 独立 `command_record` 真源。
- 依赖进程内 Mutex 提供幂等正确性。
- 通过重放 `event_log` 恢复对象或触发副作用。

<a id="adr-0001-references"></a>
### References

- [v0.02 核心组件与实施包](core-components.md)
- [v0.02 领域模型](domain-model.md)
- [v0.02 实施与验收清单](implementation-and-acceptance.md)
<!-- legacy-adr-body:end id=ADR-0001 -->
<!-- legacy-adr:end id=ADR-0001 -->

<!-- legacy-adr:begin id=ADR-0002 source-file-sha256=f9ab50e5b704c4403bb7fdb594e6349753bc653756aaa3361ddfb62fc9037eb1 -->
<a id="adr-0002"></a>

## ADR-0002: Collaboration

迁移时原路径：`docs/adr/0002-collaboration.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0002
title: "Collaboration"
status: superseded
date: 2026-07-20
decision_scope: cross-version
source_version: v0.02
supersedes: []
superseded_by: ADR-0008
```

<!-- legacy-adr-body:begin id=ADR-0002 -->
<a id="adr-0002-context"></a>
### Context

v0.01 以 Project/Task 作为主要上下文，并把 Runtime 绑定到 Task；只有一个 Agent 能实际执行。v0.02 需要长期公共协作、每 Agent 私有连续性、按需 Task、多目标执行和可靠 Agent 间投递，同时不能强迫所有消息进入工作流。

<a id="adr-0002-decision"></a>
### Decision

协作模型固定为：

```text
Camp
├── CampMember → AgentProfile
├── CampMessage
├── Conversation（campId + agentProfileId 唯一）
│   └── ConversationMessage / Summary / Camp Cursor / current Native Session
├── Task + optional TaskDependency
├── CampTurn
│   └── AgentRun → Conversation + optional Task
└── InboxMessage
```

不建立 Project、Team、TeamRun、AgentInstance 或 AgentProfileVersion。Camp 直接保存工作目录和可空稳定 Repository Binding；现有 Project 表只作为迁移来源/兼容数据保留。

<a id="adr-0002-addressing"></a>
#### Addressing

消息地址是结构化值：`default / explicit agentProfileIds / broadcast`。解析只读取当前有效成员和唯一 Conversation，结果作为 CampMessage 的不可变地址快照写入同一事务。Default Lead 是未定向消息入口，不自动获得额外 Capability，也不绑定 Runtime。

<a id="adr-0002-messages-and-context"></a>
#### Messages and context

CampMessage 与 ConversationMessage 分别拥有作用域内单调序列。公共消息按连续前缀物化到每个 Conversation；一个 AgentRun 创建时冻结初始 Camp/Conversation 水位，后续无关消息不能进入该 Run。

<a id="adr-0002-task"></a>
#### Task

Task 按需创建，状态仅为 `pending / in_progress / completed / cancelled`。创建时绑定唯一且不可变 Assignee；换人只能取消并创建带 `originTaskId` 的替代 Task。`blocked` 是 Readiness 投影。TaskDependency 只表达同 Camp 硬前置 DAG，不形成树、阶段或级联完成/取消。

<a id="adr-0002-campturn-and-agentrun"></a>
#### CampTurn and AgentRun

只有结构化 execution intent 创建 CampTurn/AgentRun。一个触发最多一个 CampTurn；多目标在同一事务创建多个 AgentRun。CampTurn 状态由当前职责 Run 聚合。AgentRun 使用六态 `queued / running / waiting / succeeded / failed / cancelled`，同一 Conversation 同时最多一个 running/waiting Run。

<a id="adr-0002-inbox"></a>
#### Inbox

InboxMessage 是单接收者可靠投递。Dispatcher 以 Inbox ID 作为 ConversationMessage 幂等来源，并在同一事务写入目标消息和 `recipientMessageId/deliveredAt`。它不跟踪消费、不转移 Task 责任、不替代 Review/Task/Run。执行型 Inbox 必须先由 Core 创建或关联目标 Run。

<a id="adr-0002-schema-and-migration"></a>
### Schema and migration

- 新增 `camp`、`camp_member`、`camp_message`、`conversation`、`conversation_message`、`task_dependency`、`camp_turn`、`agent_run`、`inbox_message` 及必要证据关系。
- 现有 `task` 迁移为 v0.02 Task；legacy execution root/branch/base revision 转入迁移 AgentRun Workspace。
- 每个 legacy Project 至少迁移成一个 Camp；大厅迁移为无 Git Repository Binding 的 Camp。
- legacy RuntimeSession 的当前 Thread 迁入对应 Conversation；不迁移成 Session Chain。
- legacy Event/Approval 保持可审计关联，不能静默丢弃。
- 迁移完成前可以保留只读 legacy 表/列；新写入不得继续产生两套权威协作状态。

关键唯一约束包括：

```text
camp.repository_scope_id（非空时全局唯一）
(camp_id, agent_profile_id) on camp_member
(camp_id, agent_profile_id) on conversation
(camp_id, sequence) on camp_message
(conversation_id, sequence) on conversation_message
conversation.sourceCampMessageId / sourceInboxMessageId 的部分唯一索引
conversation.nativeSessionId 的非空部分唯一索引
(camp_id, trigger_type, trigger_id) on camp_turn
同一 Conversation 仅一个 running/waiting agent_run
职责 generation 与 predecessor 的唯一约束
(camp_id, idempotency_key) on inbox_message
```

<a id="adr-0002-failure-semantics"></a>
### Failure semantics

- Camp/成员/Lead 变更与关联状态必须在一个事务维护不变量。
- 成员退出、Task/CampTurn 取消使用持久请求事实和 Finalizer，不提前写虚假终态。
- Inbox 写入目标 Conversation 后崩溃，重试只能复用同一 ConversationMessage。
- queued Run 启动前重新检查成员、Task、依赖、输入、Workspace、权限与 Conversation 锁。
- Agent 自述、Review 文本和系统通知不自动创建 Task、Run 或改变状态。

<a id="adr-0002-acceptance"></a>
### Acceptance

- 普通消息可以只写 CampMessage，不产生 CampTurn/AgentRun。
- 单个多目标触发原子创建一个 CampTurn 和多个 Run，重复请求不复制。
- 两个 Agent 的 Conversation 独立推进，同一 Conversation 的 Run 串行。
- Inbox 在重复投递、进程崩溃、过期和永久失败时保持唯一消息/ACK。
- Default Lead 继任、成员退出、Task 取消和 Camp 归档在重启后收敛。
- v0.01 数据迁移后，用户仍能找到原项目、任务、消息、审批与当前 Thread。

<a id="adr-0002-consequences"></a>
### Consequences

- 公共协作、成员私有连续性、责任任务和执行生命周期由不同实体表达；UI、命令和查询不能继续用 Project/Task 或自然语言消息代替这些边界。
- 多目标执行、Conversation 串行化、Inbox 去重和成员变更需要数据库唯一约束、持久状态机与恢复扫描器共同维护。
- Task 保持按需和扁平，普通 Camp 消息不会隐式创建工作流；需要执行时必须提供结构化 intent。
- v0.01 数据需要经过兼容迁移，迁移完成前会同时存在只读 legacy 结构与新的权威协作模型。

<a id="adr-0002-rejected-alternatives"></a>
### Rejected Alternatives

- TeamRun、TaskProposal、Task Tree、Handoff、结构化 Review、通用 Decision。
- 把所有消息解释为执行请求。
- 通过自然语言 `@name` 或 LLM 猜测权威地址。
- 让 InboxMessage 同时承担投递、消费和责任转移。

<a id="adr-0002-references"></a>
### References

- [v0.02 领域模型](domain-model.md)
- [v0.02 核心组件与实施包](core-components.md)
- [v0.02 实施与验收清单](implementation-and-acceptance.md)
<!-- legacy-adr-body:end id=ADR-0002 -->
<!-- legacy-adr:end id=ADR-0002 -->

<!-- legacy-adr:begin id=ADR-0003 source-file-sha256=6e5f56f3553db806f442329dbb415162258c6840d17f2d3984bde1d2b16c9abb -->
<a id="adr-0003"></a>

## ADR-0003: Execution Runtime

迁移时原路径：`docs/adr/0003-execution-runtime.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0003
title: "Execution Runtime"
status: superseded
date: 2026-07-20
decision_scope: cross-version
source_version: v0.02
supersedes: []
superseded_by: ADR-0016
```

<!-- legacy-adr-body:begin id=ADR-0003 -->
<a id="adr-0003-context"></a>
### Context

v0.01 的 CodexRuntime 只保存一个当前 task/thread/turn，CodexManager 也按 taskId 管理实例。该结构无法在同一进程中可靠分流多个 Conversation 的事件、审批和恢复，也无法阻止旧 Host 或旧执行代际回写新状态。

<a id="adr-0003-decision"></a>
### Decision

Codex Adapter 默认按 `RuntimeHostKey` 复用 Host：

```text
RuntimeHostKey(adapter, protocolVersion, authScope, processConfigDigest)
→ v0.02 默认最多一个 CodexRuntimeHost
→ 多个 Native Thread
→ 每个 Thread 一个 NativeThreadBinding
```

共享 Host 是 Adapter 托管策略，不是全局 Singleton、持久实体或 Conversation 领域不变量。测试证明共享不安全时，可以改为有限 Host Pool，而不改变领域模型。

`NativeThreadBinding` 至少包含：

```text
conversationId
nativeThreadId
activeAgentRunId
executionEpoch
nativeTurnId
```

Host 拥有内存 `hostInstanceId`。事件进入领域命令前依次校验当前 Host Instance、Thread Binding、Native Turn、AgentRun 和 executionEpoch；无法唯一映射的事件只进入诊断/恢复，不能修改权威状态。

同一 Conversation 最多一个 running/waiting AgentRun。不同 Conversation 可以共享 Host 并行执行。Conversation 持久化当前 `nativeSessionId`；Host、连接和 Registry 可由数据库状态重建。

<a id="adr-0003-components"></a>
### Components

- `CodexRuntimeHostManager`：按 RuntimeHostKey 创建、复用、排空和回收 Host。
- `CodexRuntimeHost`：管理一个 App Server 进程/连接和 hostInstanceId。
- `NativeThreadBindingRegistry`：维护 Thread 到 Conversation/Run/Epoch/Turn 的唯一映射。
- `CentralEventDemultiplexer`：统一处理 Response、Notification 和 Server Request 的线程分流。
- `AgentRunScheduler`：扫描完整启动资格、获取执行租约并递增 epoch。
- `ExecutionContextBuilder`：使用冻结配置、水位和显式 continuation 组装输入。
- `RuntimeRecoveryCoordinator`：执行 Host fencing、动作对账、Resume 与 Session 换绑。

<a id="adr-0003-recovery"></a>
### Recovery

```text
确认旧 Host/连接失效
→ fencing hostInstanceId
→ running Run 进入 waiting(runtime_recovery)
→ 已 waiting Run 保留原主要 blocker
→ 对账 Approval / ActionExecution / Runtime Delivery
→ unknown 副作用优先收敛
→ 证明继续不会重复动作
→ 重新取得租约并 executionEpoch++
→ Resume 原 Thread，失败则创建并事务换绑新 Thread
→ 重算 blocker 后继续、等待或终结
```

没有 Token 输出不是 Host 空闲。仅当没有 Native Turn、反向请求、未 ACK Delivery、未确认取消和未关联 Tool Call，且所有状态可持久恢复时，`isHostReclaimable` 才可为真。

<a id="adr-0003-protocol-boundary"></a>
### Protocol boundary

- 固定并显式校验支持的 Codex App Server 版本和能力矩阵。
- `authScope` 使用非秘密标识；`processConfigDigest` 由版本化规范配置计算。
- MCP、插件、Codex Home 和进程环境属于 HostKey；Run/Thread 级 cwd、Sandbox、Instructions、模型和工具配置不得串线。
- Adapter 只翻译协议并调用强类型 Gateway，不直接写数据库。
- RT-02 输入清单精确重现尚未定案；当前不得超越冻结水位，也不得声称 Prompt 字节级可重现。

<a id="adr-0003-acceptance"></a>
### Acceptance

- 两个 Native Thread 的模型请求可以同时在途。
- 两个 Thread 同时请求 Approval 时，threadId/turnId/actionId 不串线。
- cwd、Sandbox、Instructions、模型和工具上下文互不污染。
- 一个 Thread 的失败、取消、迟到事件不会推进另一个 Thread。
- 杀死 Host/Core 后，两条 Run 能分别恢复、换绑或失败。
- 旧 hostInstanceId 与旧 executionEpoch 的普通输出和命令被拒绝；副作用观察进入 Action 对账。
- 同一 Conversation 的两个 Run 永不同时执行。

<a id="adr-0003-consequences"></a>
### Consequences

- Runtime 事件只有在 Host、Thread、Turn、AgentRun 和 epoch 都能唯一映射时才能进入权威命令，旧实例和迟到事件会被 fencing 拒绝。
- 不同 Conversation 可以共享 Host 并发运行，但同一 Conversation 的执行保持串行；Host 复用策略可以演进而不改变领域模型。
- 恢复必须先对账 Approval、Action 和 Runtime Delivery，再决定 Resume、换绑、继续等待或终结，不能把进程重启等同于安全重试。
- 共享 Host、中央分流和恢复协调增加了运行时实现复杂度，但避免把“一 Conversation 一进程”固化为高成本领域约束。

<a id="adr-0003-rejected-alternatives"></a>
### Rejected Alternatives

- 一 Conversation 一 OS 进程作为领域不变量。
- 全局唯一 CodexRuntimeHost。
- 继续按 taskId 索引 Runtime。
- Host 崩溃后不对账副作用就直接 Resume。
- 只重命名现有单槽 CodexRuntime。

<a id="adr-0003-references"></a>
### References

- [ADR-0012: Collaboration v3](../v0.06/decisions.md#adr-0012)
- [ADR-0015: Action and Safety v2](../v0.06/decisions.md#adr-0015)
- [ADR-0006: Multi-Runtime Adapter Boundary](../v0.03/decisions.md#adr-0006)
- [v0.02 核心组件与实施包](core-components.md)
<!-- legacy-adr-body:end id=ADR-0003 -->
<!-- legacy-adr:end id=ADR-0003 -->

<!-- legacy-adr:begin id=ADR-0004 source-file-sha256=c8924be6099333b9a455e6e05da28962ea0eae54d39b3f6957ec333233ea2634 -->
<a id="adr-0004"></a>

## ADR-0004: Action & Safety

迁移时原路径：`docs/adr/0004-action-safety.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0004
title: "Action & Safety"
status: superseded
date: 2026-07-20
decision_scope: cross-version
source_version: v0.02
supersedes: []
superseded_by: ADR-0015
```

<!-- legacy-adr-body:begin id=ADR-0004 -->
<a id="adr-0004-context"></a>
### Context

v0.01 将 Approval 与 Native Request 绑定，但“授权”“是否派发”“是否发生”“结果是什么”和“Runtime 是否收到结果”分散在请求、事件和进程内状态中。崩溃发生在任意边界时，系统无法可靠区分未执行、已执行、结果未知或结果尚未返回 Runtime。

<a id="adr-0004-decision"></a>
### Decision

`ActionExecution` 是每个受限或可能有副作用动作的唯一持久真源。它以稳定 actionId 贯穿：

```text
prepared
→ executing
→ succeeded | failed | unknown

prepared
→ not_executed
```

确定终态可以投影为 ActionReceipt，但不建立第二张 Receipt 表或第二套状态。

动作必须先规范化并冻结参数、Kind、Digest、来源 AgentRun 与控制模式：

- `mediated`：Core 自己执行，能够保证 persist-before-dispatch。
- `intercepted`：Runtime 在执行前请求 Lumen，能通过协议门禁。
- `observed`：Runtime 已执行后才通知，只能审计/对账，不能宣称先审批或 exactly-once。

封闭、版本化的 Action Kind 注册表决定哪些动作必须记录以及如何规范化。Shell、写文件、Git 变更、外部写 API、敏感读取和语义未知工具默认进入 ActionExecution。

<a id="adr-0004-approval"></a>
### Approval

Approval 只授权一个 `ActionExecution(prepared)` 的规范化动作。身份至少绑定：

```text
actionId
actionKind
actionDigest
target user
```

只有目标用户可以解决 Approval。`approved` 只表示授权，不表示动作已经派发或成功；拒绝、取消、过期等结果使 ActionExecution 进入相应 `not_executed` 原因。

<a id="adr-0004-dispatch-and-reconciliation"></a>
### Dispatch and reconciliation

- 每个派发 Attempt 具有独立序号/身份和 dispatch marker，旧 Attempt 结果不能覆盖新事实。
- 在跨系统原子边界无法证明是否派发时，保守进入 `unknown`，不能把超时写成 failed。
- 自动重试只允许在证明未发生或外部目标按稳定幂等键安全重放时进行。
- 人工放弃对账保留 unknown 真相，并永久禁止同一 Action ID 重放。
- 返回 Runtime 的授权/结果使用窄化 Delivery Checkpoint，绑定 payload Digest、目标 epoch 和 Native Request；ACK 只证明对应载荷被接收。
- `authorization_resolution(allow)` 在 ACK 丢失且协议幂等性未经证明时不能盲目重发。

<a id="adr-0004-workspace-and-git"></a>
### Workspace and Git

AgentRun 在 Native Runtime 绑定前保存 Workspace：`executionRoot / read_only|write / shared|git_worktree / repositoryScopeId / baseGitCommit`。绑定后不可静默修改。

v0.02 不实现 Workspace 写锁；Runtime 并行不代表文件写入隔离。Worktree 由 Agent/User 通过显式 Git 动作选择、创建、合入和清理，Core 只做路径、权限、Repository Scope 和 Git 对象校验。

<a id="adr-0004-schema-and-recovery"></a>
### Schema and recovery

- 新增 `action_execution`、`action_attempt`、`approval` v0.02 字段和 Runtime Delivery Checkpoint。
- legacy Approval 迁移时保留原请求/决定；无法构造完整动作参数的记录只能成为不可执行的历史/observed 事实，不能自动重放。
- Executor、Reconciler、Delivery Worker 和 Cancellation Finalizer 只扫描各自权威状态并使用租约/fencing 认领。
- 应用恢复顺序先对账 unknown 和未终结 Delivery，再允许 AgentRun 恢复。

<a id="adr-0004-acceptance"></a>
### Acceptance

- 在 persist、dispatch、result、Approval resolve 和 Runtime ACK 每个边界模拟崩溃，最终状态均可解释。
- 已成功或 unknown 的动作不会因应用重启重复执行。
- 两个并行动作/Approval 不串 actionId、Digest 或 Runtime Request。
- 旧 epoch、旧 Attempt 和重复回调不能覆盖当前结果。
- Approval 通过后执行失败，UI 明确同时显示“已授权”和“执行失败”。
- Git Commit 证据在 Task 完成前已按 Repository Scope 固定并保持可达。

<a id="adr-0004-consequences"></a>
### Consequences

- 授权、派发、外部发生事实、执行结果和 Runtime Delivery 必须分别建模；UI 与审计不能再用 Approval 状态推断动作结果。
- 无法证明外部动作是否发生时必须保留 `unknown`，这限制了自动重试，并要求显式 Reconciler 或人工收敛路径。
- 所有可识别副作用都需要稳定 Action ID、规范化参数、Attempt fencing 和恢复顺序，增加了持久化与 Worker 协调成本。
- Workspace 与 Git 隔离保持显式和可审计，但 v0.02 不承诺自动 Worktree 管理或并发写隔离。

<a id="adr-0004-rejected-alternatives"></a>
### Rejected Alternatives

- Approval 兼任执行结果。
- PreparedAction 与 ActionReceipt 两套权威表。
- 通用 Outbox 驱动动作。
- 将超时、连接断开或 ACK 丢失直接解释为未执行。
- 自动 Worktree Manager、自动合入和 Workspace 写锁。

<a id="adr-0004-references"></a>
### References

- [ADR-0001: Core Transaction](decisions.md#adr-0001)
- [ADR-0003: Execution Runtime](decisions.md#adr-0003)
- [v0.02 核心组件与实施包](core-components.md)
- [v0.02 实施与验收清单](implementation-and-acceptance.md)
<!-- legacy-adr-body:end id=ADR-0004 -->
<!-- legacy-adr:end id=ADR-0004 -->

<!-- legacy-adr:begin id=ADR-0005 source-file-sha256=729c0b663232c0762dc6ab52e193f0639b3fcd3d126cec013eff69abec2148c5 -->
<a id="adr-0005"></a>

## ADR-0005: Evidence & Read Side

迁移时原路径：`docs/adr/0005-evidence-read-side.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0005
title: "Evidence & Read Side"
status: superseded
date: 2026-07-20
decision_scope: cross-version
source_version: v0.02
supersedes: []
superseded_by: ADR-0013
```

<!-- legacy-adr-body:begin id=ADR-0005 -->
<a id="adr-0005-context"></a>
### Context

v0.01 Renderer 主要从 Task 事件流投影 Conversation、Activity、Approval 和 Diff。v0.02 的权威状态分布在 Camp、Task、Run、Inbox、Action 与 Evidence 关系中；如果 Renderer 仅靠增量事件重建状态，断线、重复事件和 Schema 变化会形成第二套不可靠真源。同时，独立文件与长期代码证据需要明确的内容保留边界。

<a id="adr-0005-decision"></a>
### Decision

IP-05 包含两个独立接口和一个读侧边界：

- `EvidenceValidator`：校验证据类型、Camp/Repository Scope、可见性、稳定性、对象状态与保留资格；不理解自然语言 Criterion。
- `ManagedBlobStore`：不可变内容寻址、完整性、去重、流式读写和 GC；不包装成 Artifact Service。
- Query/Subscription：从同一 SQLite 权威快照生成 DTO，并用全局事件序列提供失效通知和时间线。

<a id="adr-0005-evidence"></a>
### Evidence

Task 完成保存不可变的 Criterion—Evidence 映射：每个 Criterion 必须有稳定 ID、至少一个合格引用、完成时 Task 版本、Actor 与 `semanticAttestation=true`。Core 检查引用资格，Actor 对自然语言是否满足负责。

允许的完成证据限于公开、稳定对象：CampMessage、终态 AgentRun、合格 ActionExecution、Repository-scoped full Git Commit OID 和 MessageAttachment。私有 ConversationMessage、InboxMessage、Workspace 路径、普通 Patch 和未提交工作区不能直接完成公共 Task。

Git Commit 身份是 `repositoryScope + objectFormat + fullOid`；作为长期证据前必须通过内部 Ref 或等价机制保持可达。普通 Patch 只用于协作，不是完整 Revision。

<a id="adr-0005-managed-blobs"></a>
### Managed blobs

MessageAttachment 是消息与 Blob 的领域关系；ManagedBlob 是内容寻址存储资源。写入采用：

```text
流式写临时文件并计算 SHA-256
→ fsync / 原子落到内容地址
→ SQLite 事务创建或复用 Blob 元数据与 Attachment/结果引用
→ 无引用孤儿由 GC 清理
```

MessageAttachment、ActionExecution 结果和 Task Evidence Binding 都是 GC Root。文件名规范化、大小限制、媒体类型嗅探、路径逃逸防护和秘密处理属于强制安全边界。

<a id="adr-0005-read-model"></a>
### Read model

- 查询直接从权威表和确定性派生规则生成，不创建持久 Projection 表或第二套运行状态缓存。
- 每个快照在一个读事务中捕获 `throughGlobalSequence`。
- Renderer 先取得快照，再从该序列订阅增量；增量主要用于失效通知和时间线追加。
- 断线、序列缺口、未知 Schema 或缓存不确定时，Renderer 丢弃派生缓存并重新获取快照。
- TaskReadiness、Run Activity、blockers、unresolved effects 和 Camp 时间线必须来自同一一致快照。

<a id="adr-0005-api-boundary"></a>
### API boundary

v0.02 Renderer 的主要入口围绕 Camp，而不是 legacy Project/Task：

```text
camps.list / camps.get / camps.create / camps.archive
camps.messages.list / camps.messages.send
camps.members.*
tasks.* / campTurns.* / agentRuns.*
inbox.* / approvals.* / actions.*
camps.snapshot
events.subscribe(fromGlobalSequence)
attachments.open/read metadata
```

实际 Method 名称在 Contract 中保持封闭枚举，并由 Electron Main Allowlist 与 Rust Handler 同步。Renderer 不获得文件系统、Git、Shell 或数据库访问权。

<a id="adr-0005-migration"></a>
### Migration

- legacy Task/Event/Approval 查询在 Renderer 完成切换前保留兼容 API，但不得成为新领域状态的写入口。
- legacy `artifact` 表只读保留，确认无历史数据或完成显式迁移后再删除；新附件不写入该表。
- 新 DTO 必须包含 Schema Version；旧 Renderer 遇到不兼容版本失败关闭并刷新，而不是猜测字段。

<a id="adr-0005-acceptance"></a>
### Acceptance

- 快照与订阅交界模拟并发写入时不丢事件，重复事件不重复改变 UI。
- 断线后从旧游标检测缺口并完整刷新。
- Task 完成后逐条 Criterion 可以还原证据、Actor、声明和内容完整性。
- Blob 去重、损坏检测、孤儿清理和 GC Root 保留均有测试。
- Tombstone/清理普通消息、动作或 Camp 时不会破坏已完成 Task 的证据。
- Renderer 的 Camp 时间线、Agent 泳道、等待原因、Approval、Action、Diff 与审计来自一致读模型。

<a id="adr-0005-consequences"></a>
### Consequences

- Renderer 必须从一致的权威快照启动，并把增量事件用于失效通知和时间线，而不是通过事件重放维护第二套业务状态。
- Task 完成只能引用公开、稳定且满足保留条件的 Evidence；普通 Patch、工作区路径和私有消息不能直接充当长期完成证据。
- 附件和动作结果需要内容寻址、完整性校验、GC Root 与安全读取边界，增加了 Blob 生命周期管理责任。
- 查询 API 需要显式 Schema Version 和断线刷新协议，换取跨重启、重复事件和版本演进下的一致读体验。

<a id="adr-0005-rejected-alternatives"></a>
### Rejected Alternatives

- 通用 Artifact 实体或成果库。
- Renderer 通过重放事件成为业务状态真源。
- 持久 Projection 表作为 v0.02 默认架构。
- 用颜色、自然语言或 Agent 自述替代结构化状态和证据。

<a id="adr-0005-references"></a>
### References

- [ADR-0001: Core Transaction](decisions.md#adr-0001)
- [ADR-0008: Collaboration v2](../v0.04/decisions.md#adr-0008)
- [v0.02 领域模型](domain-model.md)
- [v0.02 核心组件与实施包](core-components.md)
<!-- legacy-adr-body:end id=ADR-0005 -->
<!-- legacy-adr:end id=ADR-0005 -->
