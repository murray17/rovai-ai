# Lumen AI v0.02 多 Agent 协作架构基线

> 状态：领域模型与核心组件边界已收口，五个实施包的代码基础已落地；待 APP 垂直链路收口
> 当前代码基线：[v0.01 实施状态](../v0.01/implementation-status.md)
> 更新日期：2026-07-21

## 文档用途

本文件是 Lumen v0.02 的架构入口，只概括已经确认的目标、边界和实施顺序，不重复保存完整协议。

- [domain-model.md](domain-model.md) 是领域语义、状态机、约束和可靠性协议的详细事实源。
- [core-components.md](core-components.md) 是组件职责、实施包和编码验收的详细事实源。
- [implementation-and-acceptance.md](implementation-and-acceptance.md) 记录真实 APP 验收发现、产品链路缺口、下一阶段收口顺序和直接影响实施的待讨论问题。
- 当前仓库已实现 v0.02 的领域、持久化、安全和读侧基础，但 Codex 产品链路仍主要沿用 v0.01 单 Agent Runtime；基础设施存在不等于 v0.02 产品闭环已经完成。
- 如本文件与上述两份详细文档冲突，以详细文档为准并修订本文件。
- `docs/versions/` 是被 Git 忽略的本地讨论区；实施前仍需把最终 ADR 迁入受版本控制的位置。

## 版本目标

v0.02 要把 Lumen 从“沐瓦驱动的一条可信执行链”演进为“同一长期协作空间内，多名 Agent 可以独立运行、可靠通信并共同完成工作”的本地控制平面。

本版本重点证明：

- 一个长期存在的 `Camp` 可以承接闲聊、连续问题和跨时间的新问题，而不要求人为关闭一次 TeamRun。
- 多个 Agent 以独立 `Conversation` 保持私有连续性，并能在同一 Camp 内并行执行。
- 一次明确执行请求可以形成一个 `CampTurn`，并为一个或多个 Agent 创建独立 `AgentRun`。
- Agent 间消息、审批、受限动作、取消和 Runtime 恢复都能跨应用重启继续，且不会盲目重复副作用。
- Task 仅在需要责任、依赖、进度或验收时出现，不绑架普通对话。
- UI 能从 SQLite 权威状态解释“谁在做什么、为什么等待、发生了什么动作、哪些证据支持完成”。

长期产品方向仍包括 Agent 的持续成长，但 Memory、Evaluation、Profile/Skill 发布和回滚不属于 v0.02 实施范围。本版本先建立成长所需的身份、连续性、执行证据和审计基础。

## 从 v0.01 到 v0.02

v0.01 已经验证 Electron / Rust Core 分界、SQLite/WAL、Codex App Server、审批持久化、事件记录、Git Diff 和重启恢复。v0.02 不推翻这些基础，而是迁移其业务归属。

| v0.01 当前实现 | v0.02 目标 |
|---|---|
| 四个 AgentProfile 中只有沐瓦拥有真实 Runtime，Instructions 和 Owner 仍有硬编码 | AgentProfile 表达长期身份，CampMember 表达 Camp 内资格与权限，AgentRun 冻结实际配置 |
| Project 与 Task 承担主要上下文，Runtime 归属 Task | Camp 承担长期公共上下文，Conversation 绑定当前 Native Session，AgentRun 承担执行生命周期 |
| Runtime 是按 Task 管理的单槽 `task_id/thread_id/turn_id` | 按 `RuntimeHostKey` 共享 Host，并对多个 Native Thread 做独立分流和 fencing |
| 崩溃恢复依赖 Session Generation 与 Resume Frame | Conversation 只保存当前 Session；换绑留事件，不建立 Session Chain 或 Generation 实体 |
| Project 是持久实体，同一项目阻止多个活跃修改 Task | v0.02 不建 Project 聚合；Camp 直接保存路径和稳定 Repository Binding，也不提供 Workspace 写锁 |
| Task 直接使用项目根目录 | AgentRun 冻结实际 Workspace；Worktree 是 Agent/User 可选的隔离策略 |
| Approval 主要围绕 Runtime 请求持久化 | Approval 只授权一个参数冻结的 ActionExecution；ActionExecution 才是动作结果与 unknown 对账真源 |

现有表和 API 如何迁移、复用或废弃属于各实施 ADR 的 Schema/Migration 部分，不能通过简单改名伪装完成。

## 核心不变量

```text
AgentProfile != CampMember != Conversation != AgentRun != Native Session
Camp != CampTurn != Task
CampMessage / ConversationMessage != Memory
Agent 自述完成 != Task 完成
Approval 通过 != 动作执行成功
event_log != 业务状态真源 != 工作队列
Runtime 恢复 != 模型、工具或副作用重放
```

其中：

- `AgentProfile` 回答 Agent 是谁；`CampMember` 回答它是否属于 Camp、拥有什么权限。
- `Conversation` 是某个 Agent 在某个 Camp 内唯一的长期私有连续性。
- `AgentRun` 是一次持久、可恢复、终态不可逆的执行职责。
- Native Session 只是 Conversation 当前可替换的 Provider 句柄。
- `Camp` 可以长期存在且没有 completed 状态；`CampTurn` 和 `Task` 才是有界执行与工作承诺。

## 目标领域模型

```text
Camp
├── CampMember ──> AgentProfile
├── CampMessage / Resource / Evidence Reference
├── Conversation（每个 AgentProfile 唯一一个）
│   ├── ConversationMessage / Summary / Camp Cursor
│   └── current Native Session Handle
├── Task（按需创建）
│   └── TaskDependency（可选硬前置 DAG）
├── CampTurn（仅由明确执行触发创建）
│   └── AgentRun ──使用──> Conversation
│       ├── optional Task
│       ├── optional immutable Workspace snapshot
│       ├── ActionExecution
│       └── Approval ──一次性授权──> ActionExecution(prepared)
├── InboxMessage
├── MessageAttachment ──> ManagedBlob
└── event_log
```

### 主要对象

| 对象 | 权威职责 |
|---|---|
| Camp | 长期公共协作、项目路径、稳定 Repository Binding、默认入口和归档边界 |
| AgentProfile | Agent 的稳定身份、角色说明和默认配置；不保存 Camp 角色或运行状态 |
| CampMember | Agent 在 Camp 内的成员资格、Capability 覆盖和可恢复退出 |
| Conversation | 单个 Agent 在 Camp 内的私有消息、摘要、公共消息游标和当前 Native Session |
| Task | 可选的扁平工作承诺、固定 Assignee、验收条件和四态生命周期 |
| TaskDependency | 同一 Camp 内 Task 之间可选的硬前置关系 |
| CampTurn | 一次明确执行触发形成的有界公共因果过程 |
| AgentRun | 某个 Conversation 在 CampTurn 中履行一项职责的实际执行生命周期 |
| InboxMessage | Agent 到 Agent 的单接收者可靠定向投递 |
| Approval | 用户对一个已准备、参数冻结的受限动作作出的一次性授权 |
| ActionExecution | 受限动作从准备、授权、派发到确定结果或 unknown 对账的唯一真源 |
| MessageAttachment / ManagedBlob | 消息与不可变受管文件内容之间的关系及存储资源 |
| event_log | 追加式审计事件和永久 `command.result`；不用于重放业务状态或副作用 |

## 协作与执行语义

### Camp、成员与消息入口

- v0.02 不建立 `Project`、`Team` 或 `TeamRun`；Camp 直接保存项目路径与可空 Repository Binding。
- Agent 可动态加入、退出和重新加入 Camp；同一 `(campId, agentProfileId)` 复用唯一 CampMember 与 Conversation。
- Camp 只要存在有效活跃成员，就必须且只能有一个 Default Lead；没有成员时 Lead 为空。
- Default Lead 只是普通未定向消息的默认入口，不自动获得 Task、审批或成员管理权限，也不绑定 Runtime Session。
- Message Addressing 只处理结构化的 `default / explicit / broadcast` 地址，不扫描自然语言猜测目标，也不承担执行调度。
- 所有 CampMessage 都属于同一公共有序消息流；私有可靠投递只能使用 InboxMessage。

### Task 与依赖

- 普通聊天、咨询和无需结构化跟踪的只读工作不创建 Task。
- 需要持久副作用、明确责任、依赖、重试或验收时，由用户或具备能力的 Agent 显式创建 Task；不建立 TaskProposal。
- Task 创建时必须绑定唯一 Assignee，之后不可改绑；需要换人时取消旧 Task，再以 `originTaskId` 创建替代 Task。
- Task 状态只有 `pending / in_progress / completed / cancelled`；终态不可 reopen。
- `blocked` 是由依赖、Assignee 可用性、取消编排和未知副作用派生的 Readiness，不是 TaskStatus。
- `TaskDependency` 只表达同一 Camp 内的硬前置，不形成 Task 树、阶段工作流、自动完成或取消级联。
- Task 只能通过强类型 `CompleteTask` 完成；Core 校验证据覆盖和机器门禁，Actor 对自然语言验收条件是否满足作受审计声明。

### CampTurn 与 AgentRun

- 只有结构化 execution intent 才创建 CampTurn/AgentRun；最终回复、流式片段、通知、审批结果、状态和错误不会递归创建新执行。
- 一个执行触发最多创建一个 CampTurn；多目标请求在该 CampTurn 下原子创建多个独立 AgentRun。
- CampTurn 状态为 `running / waiting / completed / failed / cancelled`，由每项职责当前有效 AgentRun 确定性聚合。
- AgentRun 状态为 `queued / running / waiting / succeeded / failed / cancelled`；同一职责的 Retry/Rework 使用无分叉后继链。
- 同一 Conversation 同时最多一个 `running/waiting` AgentRun；多个 queued Run 可以排队。多 Agent 并行来自不同 Conversation。
- 等待 Approval、用户输入、Runtime 恢复或可安全自动重试仍属于同一个 AgentRun；终态后的再次执行创建后继或新的 CampTurn。
- AgentRun 创建时冻结有效配置、初始公共/私有上下文水位和执行契约，后续消息不能静默扩大其初始可见范围。

### Conversation 与 Native Session

- 每个 Camp 中，每个 AgentProfile 只有一个逻辑 Conversation：`UNIQUE(camp_id, agent_profile_id)`。
- CampMessage 与 ConversationMessage 分别使用作用域内单调序列；公共消息必须按连续前缀物化到 Conversation。
- 一个 Conversation 最多绑定一个当前 Native Session，一个 Native Session 同时最多属于一个 Conversation；非空绑定由数据库部分唯一索引兜底。
- Session 失效时优先 Resume；失败则通过强类型命令事务换绑新 Session，并利用摘要、水位和稳定输入恢复逻辑连续性。
- v0.02 不保存 Session Chain；Host、进程、连接和 Thread Registry 都是可重建 Adapter 资源，不是领域身份。

### Inbox 协作

- 一条 InboxMessage 只有一个接收者；广播由 Core 拆为多条独立消息。
- Dispatcher 使用租约和幂等来源把消息写入目标 Conversation，并在同一事务记录 `recipientMessageId + deliveredAt`。
- ACK 只证明消息已进入接收方 Conversation，不追踪 Agent 是否阅读或处理。
- Review 是普通协作行为：请求、反馈和复查由 InboxMessage、ConversationMessage、CampTurn 与 AgentRun 表达，不建立 Verdict、Finding 或 Review 状态。
- InboxMessage 不表达 Task 责任转移；v0.02 不支持 Handoff。

## 命令、副作用与恢复

### 强类型领域命令

- Domain Command Gateway 是唯一领域写入口；每种命令拥有独立参数、Capability、版本前置条件和门禁。
- 成功、受理或领域拒绝结果以唯一 `command.result` 永久写入 `event_log`，同一 `commandId + requestDigest` 永远返回第一次结果。
- `event_log` 不是 Event Sourcing 真源；Renderer 和 Worker 都不能靠事件重放构造权威对象状态。
- Core 不解析“完成”“LGTM”“取消”等自然语言改变状态，也不建立通用 Decision 或 Gate 引擎。

### Approval 与 ActionExecution

```text
Runtime 请求受限动作
→ Core 规范化并持久化 ActionExecution(prepared)
→ 当前 Policy 决定 allow / deny / ask
→ ask 时创建 Approval(pending)
→ 用户决定只绑定该 actionId + 参数 Digest
→ Executor 派发或记录未执行
→ 确定结果，或进入 unknown 对账
→ 必要结果按窄化 Checkpoint 返回 Runtime
```

- Approval 只回答“这个具体动作是否获准”，不提供 Session 级或长期授权。
- `approved` 不表示动作成功；确定结果、失败、unknown 和对账都属于同一 ActionExecution。
- 不能证明未执行或幂等的动作不得自动重放；人工放弃对账也不能把 unknown 改写成失败或成功。
- Runtime 回调必须通过 `executionEpoch` fencing；旧 epoch 的普通写入被拒绝，可能对应既有副作用的迟到观察进入对账。

### 不使用通用 Outbox

事务只提交权威对象状态和 `event_log`，提交后发送可丢失的本地 Wake。启动扫描和周期扫描从对象自身状态恢复：

```text
queued AgentRun                 → Scheduler
pending Approval                → UI / Action flow
prepared/unknown ActionExecution → Executor / Reconciler
未投递 InboxMessage             → Inbox Dispatcher
取消请求与未完成聚合             → 类型化 Finalizer
```

不建立第二份通用 Outbox、Kind 注册表或 Dead Letter 状态机；Wake 和在线事件只用于降低延迟，不是恢复真源。

## Runtime 拓扑

v0.02 的 `CodexRuntimeAdapter` 默认按以下关系托管：

```text
RuntimeHostKey
→ 默认最多一个 CodexRuntimeHost
→ 多个相互隔离的 Native Thread
→ 每个 Thread 唯一映射一个 Conversation / active AgentRun / executionEpoch / nativeTurnId
```

- `RuntimeHostKey` 由 Adapter 类型、协议版本、非秘密认证作用域和进程级配置摘要组成；它是内存值对象，不是数据库实体。
- 共享 Host 是默认部署策略，不是全局 Singleton 或 Conversation 领域不变量。
- `hostInstanceId` fencing 旧 Host/连接代际，`executionEpoch` fencing 旧 AgentRun 执行代际。
- Host 崩溃后先停止旧代际并对账 Approval、ActionExecution 和 Runtime Delivery，确认没有重复副作用风险后，才续租、递增 epoch 并 Resume/换绑 Session。
- Host 只有在不存在进行中的 Turn、反向请求、未 ACK Delivery、未确认取消和未关联 Tool Call，且全部状态可持久恢复时才可回收。
- 若对能力探测通过的 Codex 本机安装进行验收后，证明单 Host 无法真实并行、配置隔离不足或故障半径不可接受，可升级为有限 Host Pool；领域模型不变。

当前单槽 Runtime 需要实际拆分为 Host Manager、Host、Native Thread Binding Registry、Central Event Demultiplexer 和 Recovery Coordinator，不能只重命名现有类型。

## 核心实施包

| 实施包 | 责任 | 关键约束 |
|---|---|---|
| IP-01 Core Transaction | 强类型命令、SQLite Unit of Work、Repository、Migration、event_log | 同一事务完成幂等查询、状态变化、事件与 command.result；事务内无外部 I/O |
| IP-02 Collaboration | Camp、成员、Task、Turn、Conversation、Inbox | 公共触发原子形成地址快照、CampTurn、AgentRun 和冻结输入；不隐藏引入被否决实体 |
| IP-03 Execution Runtime | Scheduler、Context Builder、`AgentRuntimeAdapter`、Host、恢复 | 多 Thread 分流、双重 fencing、Session 换绑与副作用安全恢复 |
| IP-04 Action & Safety | Action Gateway、Approval、Executor、对账、Workspace/Git | 一个 ActionExecution 贯穿动作闭环；unknown 不盲重发 |
| IP-05 Evidence & Read Side | Evidence Validator、Managed Blob、查询 DTO、增量订阅 | 读模型不成为第二真源；快照与全局序列游标无丢事件窗口 |

以下三个窄组件决策继续保留：

- CC-01 Message Addressing：只解析结构化目标，不做语义路由或调度。
- CC-02 Domain Command Gateway：唯一、强类型、永久幂等的领域写入口。
- CC-03 Agent Registry & Membership：统一维护 AgentProfile 与 CampMember 边界，但不拥有运行状态。

## Workspace 与证据

- Camp 保存项目路径和稳定 Repository Scope；AgentRun 保存本次实际 `executionRoot / access / isolation / baseGitCommit`。
- v0.02 不建立 Workspace 写锁。多个 AgentRun 可以指向同一目录，因此“Runtime 可并行”不等于“并发写入安全”。
- Worktree 是 Agent/User 在 Run 启动前选择的 Skill 策略，不建立 Worktree 或 WorktreeRevision 实体，也不由 Core 自动创建、合并或清理。
- 普通 Patch 只用于 Review 和协作附件，不能作为清理 Worktree 后仍可恢复的完整代码 Revision。
- 长期代码证据使用绑定 Camp Repository Scope、保持可达的完整 Git Commit OID。
- 其他完成证据直接引用 CampMessage、AgentRun、ActionExecution、Commit 或 MessageAttachment；确定终态的 ActionExecution 可按需投影为 Receipt，但 Receipt 不是独立引用或真源。

## 明确不进入 v0.02

已经否决、不得通过其他名字重新引入：

```text
Project 聚合 / Team / TeamRun
AgentProfileVersion / AgentInstance
TaskProposal / Task Tree / 通用 Workflow
Handoff / Review 实体 / Decision 实体
Artifact / 独立 ActionReceipt 真源 / CommandRecord 表
Transactional Outbox / Worktree Manager / Workspace 写锁
Session Chain / Session Generation 领域模型
```

延期到后续版本：

- 长期 Memory、Fact/Lesson、Agent 成长画像和跨 Run 召回。
- Evaluation、Profile/Skill 发布、晋升、降级与回滚。
- 第二 Provider、分布式执行、云同步、插件市场和无审核自我改写。
- 强制 Review Gate、结构化 Finding、多 Reviewer 和自动合入工作流。

## 实施顺序

1. 为五个实施包各补一份受版本控制的实施 ADR，明确接口、Schema/Migration、事务边界、失败语义和自动化验收。
2. 先实现 IP-01 与 v0.01→v0.02 Schema 迁移骨架，禁止新模块绕过 Gateway 写状态。
3. 实现 IP-02 的 Camp、Conversation、消息、Task、CampTurn、AgentRun 与 Inbox 最小闭环。
4. 共同推进 IP-04 动作安全协议与 IP-03 多 Thread Runtime；Runtime 恢复必须依赖 Action 对账，不能先做不安全 Resume。
5. 实现 IP-05 查询、增量订阅和 Renderer 工作台，再补完整破坏性恢复与并发隔离测试。

## 首个垂直验收场景

```text
用户创建或打开 Camp
→ 添加多名 Agent 并指定 Default Lead
→ 发送带明确 execution intent 的多目标消息
→ Core 原子写入 CampMessage、CampTurn、多个 AgentRun 和冻结输入水位
→ 不同 Conversation 在共享 CodexRuntimeHost 的独立 Native Thread 中并行
→ Agent 通过 InboxMessage 请求检查或补充工作
→ 受限动作进入 ActionExecution / Approval / Result 对账闭环
→ 需要结构化承诺时创建固定 Assignee 的 Task
→ CompleteTask 绑定稳定 Criterion—Evidence
→ UI 从权威状态展示时间线、等待原因、动作、Diff 和审计
```

必须同时通过：

- 同一触发、命令、Inbox 投递或 Runtime 回调重试不会重复创建对象或副作用。
- 两个 Native Thread 可以真实并行，Approval、cwd、Sandbox、Instructions、模型和工具上下文不串线。
- 同一 Conversation 的两个 AgentRun 不会并行推进私有连续性。
- 杀死 Host、Rust Core 或 Electron 后，每条 AgentRun 能独立恢复、换绑或失败。
- unknown 动作先对账，不能因恢复而盲目再次执行。
- Task、CampTurn、成员退出、取消和 Camp 归档最终收敛，不依赖内存 Wake 或事件重放。
- Renderer 快照与增量订阅之间不存在丢事件窗口，且不能形成第二套业务真源。

## 已保留的待讨论问题

- **RT-02 AgentRun 输入物化与可重现性**：恢复同一个 AgentRun 时，应按第一次实际输入清单精确重建，还是允许依据冻结水位重新组装语义等价的上下文。该问题属于上下文协议，暂不在本轮定案。

除此之外，当前剩余工作主要是实施 ADR 和可逆编码选择，不再恢复逐对象、逐组件讨论。若实现发现必须新增持久事实、改变安全/恢复保证或引入高成本迁移，再回到领域模型修订。
