# Lumen AI v0.02 核心组件与实施包

> 状态：CC-01～CC-03 保留为独立组件决策；原 CC-04～CC-20 已收缩为五个实施包；RT-01 已修订通过
> 领域基线：[v0.02 领域模型讨论记录](domain-model.md)
> 上级文档：[v0.02 多 Agent 协作架构基线](README.md)
> 更新日期：2026-07-20

## 文档用途

本文件定义 Lumen v0.02 的 Core 逻辑边界和实施分组。

- `domain-model.md` 回答“系统持久化哪些业务事实”，本文件回答“哪些组件读取事实、执行规则并产生新事实”。
- 以当前 `domain-model.md` 的已收口结论为约束；本文件只定义如何实现这些结论，不重新引入被否决的领域对象。
- 组件是逻辑职责边界，不等于独立进程、微服务、数据表或 Rust crate。
- CC-01～CC-03 保留独立记录；它们已经形成可直接约束实现的组件边界。
- 原 CC-04～CC-20 不再逐项讨论，而是按事务、协作、执行、安全和读侧收缩为五个实施包。
- 只有会改变持久事实、跨重启正确性、安全边界或高成本迁移路径的事项，才继续作为架构决策门槛。
- 类、文件、Handler 和进程内模块如何拆分属于可逆实现选择，由实施 ADR 和代码评审决定。
- 本目录是本地讨论区；被接受的结论仍需整理为受版本控制的 ADR。

## 决策门槛

只有满足以下任一条件的事项，才需要用户或架构层继续拍板：

1. 会新增、删除或重新归属一项持久领域事实。
2. 会改变权限、副作用、幂等、fencing 或跨重启恢复保证。
3. 一旦实施，后续迁移成本明显高于替换普通模块实现。

不满足这些条件的组件拆分，默认直接采用本文件的实施基线，不再逐项讨论。

## 总体边界

```text
Renderer / Electron Main
        │ command                              │ query / subscription
        ▼                                      ▼
Core Transaction                         Evidence & Read Side
        │
        ├── Collaboration
        ├── Execution Runtime ────────────────> Codex
        └── Action & Safety ──────────────────> Filesystem / Git / Runtime
        │
        ▼
SQLite authoritative state + event_log
        │ commit 后 best-effort Wake
        ▼
Typed scanners / schedulers / finalizers
```

该图表示五个实施包的责任方向，不要求它们分别成为 Rust crate、进程或部署单元。

## 实施包关系

```text
IP-01 Core Transaction
├── Domain Command Gateway
├── SQLite Unit of Work / Repository / Migration
└── event_log / command.result

IP-02 Collaboration
├── Message Addressing / Agent Registry & Membership
├── Camp / Task / Turn / Conversation
└── Inbox Dispatcher

IP-03 Execution Runtime
├── AgentRun Scheduler / Execution Context Builder
├── Runtime Manager / AgentRuntimeAdapter
└── Typed Worker Host / Finalizer

IP-04 Action & Safety
├── Action Gateway / Approval
├── Action Execution Engine
└── Workspace & Git

IP-05 Evidence & Read Side
├── Evidence Validator / Managed Blob Store
└── Query DTO / Incremental Subscription
```

跨包写入仍必须通过 IP-01 的同一事务完成；包内模块拆分不得制造第二份状态真源。

## 决策与实施索引

| ID | 范围 | 状态 | 结论 |
|---|---|---|---|
| CC-01 | Message Addressing | 已接受 | 采用无持久状态的确定性地址解析边界，不建立宽职责 Message Router |
| CC-02 | Domain Command Gateway | 已接受 | 静态强类型领域写入口，统一永久幂等、fencing 和事务但不建立通用 Command Bus |
| CC-03 | Agent Registry & Membership Service | 已接受 | 采用单一逻辑组件，内部区分 Agent Registry 与 Camp Membership 并共享事务边界 |
| IP-01 | Core Transaction | 已确定 | 合并原 CC-02、CC-18；直接进入实施 ADR 与编码 |
| IP-02 | Collaboration | 已确定 | 合并原 CC-01、CC-03～CC-08；领域模型已经唯一决定职责边界 |
| IP-03 | Execution Runtime | 已确定 | 合并原 CC-09～CC-12、CC-20；RT-01 采用按 RuntimeHostKey 共享 CodexRuntimeHost 的默认托管策略 |
| IP-04 | Action & Safety | 已确定 | 合并原 CC-13～CC-16；围绕单一 ActionExecution 安全闭环实现 |
| IP-05 | Evidence & Read Side | 已确定 | 合并原 CC-17、CC-19；证据/Blob 分责，读模型不成为业务真源 |

## 保留的独立组件决策

### CC-01 Message Addressing

- **状态**：已接受
- **Lumen 决策**：不建立宽职责 `Message Router`，采用 Rust Core 内部无持久状态的 `Message Addressing`，把且只把一种结构化地址确定性解析为有效 AgentProfile 与唯一 Conversation。
- **核心问题**：只回答“这条消息显式面向哪些 Agent”，不承担公共消息可见性、语义理解、能力匹配、执行请求解释、CampTurn/AgentRun 创建、可靠投递、负载均衡或 Runtime 调度。

#### 决策结果

- **决策**：接受 `Message Addressing` 逻辑边界；内部可以实现为 `MessageAddressResolver`，它在发送命令的数据库事务中读取权威状态并返回临时解析值，但没有自己的数据表、状态机、队列、后台 Worker 或长期 `AddressResolution` 对象。
- **结构化地址**：

  ```ts
  type MessageAddressSpec =
    | { mode: 'default' }
    | { mode: 'explicit'; agentProfileIds: string[] }
    | { mode: 'broadcast' };

  type AddressResolution = {
    source: 'default_lead' | 'explicit' | 'broadcast';
    targets: Array<{
      agentProfileId: string;
      conversationId: string;
    }>;
  };
  ```

  三种模式互斥，不定义 `explicit > broadcast > default` 的运行时优先级。`MessageAddressSpec` 是发送命令的值对象，`AddressResolution` 只是同一事务内的临时计算结果。
- **Default**：读取 `Camp.defaultLeadAgentId` 并重新校验其为有效活跃成员及拥有唯一 Conversation；存在有效活跃成员却没有有效 Lead 时返回不变量错误，不随机选择或自动修复。没有有效活跃成员时解析为空目标：纯记录命令可以保存带空目标快照的公共消息，携带执行请求的命令以 `no_addressable_member` 拒绝且不修改领域状态。
- **Explicit**：调用方必须提交一个或多个稳定 `agentProfileId`；Core 去重并保持首次出现顺序，使用 CC-03 的有效活跃成员规则逐个校验，任一目标无效或缺少唯一 Conversation 时整体失败，不部分成功，也不回退到 Default Lead。
- **Broadcast**：在事务内快照全部有效活跃成员；Agent Actor 发起时排除发送者自身，其他 Actor 包含全部成员；结果按 `CampMember.joinedAt + agentProfileId` 确定性排序。空结果与 Default 空目标相同：纯记录允许，执行请求以 `no_addressable_member` 拒绝。
- **公共可见性**：Addressing 只记录被点名者和候选执行目标，不是 ACL 或投递过滤器；所有 `CampMessage` 仍属于同一公共有序消息流，并按 CC-07 的连续前缀规则进入各 Conversation。单接收者可靠私有投递只能使用 `InboxMessage`。
- **回复与 Task 入口**：`replyToCampMessageId`、Task 引用与 Address 分离；UI 可以在回复 Agent 消息或从 Task 定向入口发送时，确定性预填对应的 `explicit` 地址，但 Core 不根据历史作者、最近回复者、Task 正文或任意引用静默推测目标。`replyToCampMessageId` 单独只表达同 Camp 消息引用。
- **Handle 解析**：Renderer 或外部 Connector 可以通过 Agent Registry 的精确 Handle 查询把 `@handle` 规范化为稳定 `agentProfileId`，再提交结构化地址；`MessageAddressResolver` 不扫描正文，不做模糊名称匹配、LLM 语义寻址、能力专家选择、忙闲改投或自动递归扩散。
- **执行边界**：Addressing 不定义 `none/respond` 等通信或执行意图枚举。普通发送命令可以同时携带可空的结构化 `ExecutionRequest`，其新建 CampTurn、向现有非终态 CampTurn 追加职责、职责幂等和 AgentRun 创建规则由 CC-06 Turn Coordinator 拥有；Addressing 只向其提供已解析目标。
- **等待输入边界**：与 `waiting(user_input)` 关联的用户输入不属于 Addressing，也不创建新 CampTurn；它必须通过独立强类型命令引用唯一 AgentRun 和稳定等待代际，并携带版本前置条件，防止迟到输入恢复错误的等待阶段。等待代际的物理字段留给 CC-06/实施 ADR 确定。
- **持久化与幂等**：不建立 `message_route`、`address_resolution` 或 `routing_job` 领域对象；`CampMessage` 保存不可变地址快照（模式与有序 `addressedAgentProfileIds`）及可空 `replyToCampMessageId`，具体使用 JSON 值对象还是子表由实施 ADR 决定。Domain Command Gateway 必须在同一事务写入消息、地址快照、必要的 CampTurn/AgentRun 与初始输入；同一 `commandId` 重试返回首次 `command.result`，不得按当前 Lead 或成员重新解析。
- **对后续组件的约束**：
  - CC-02 Domain Command Gateway 负责 Actor、权限、幂等、事务和最终对象创建，不把这些职责下沉给 Addressing。
  - CC-03 Agent Registry & Membership Service 提供有效活跃成员、Default Lead 与 AgentProfile 身份的权威查询。
  - IP-02 的 Turn Coordinator（原 CC-06）消费已解析目标并拥有 CampTurn/AgentRun 的创建或追加；Addressing 不决定执行因果边界。
  - IP-02 的 Conversation 模块（原 CC-07）解析每个有效成员的唯一 Conversation，并保持公共消息连续前缀和 waiting Run 补充输入；地址不能造成公共消息序列空洞。
  - IP-02 的 Inbox Dispatcher（原 CC-08）只投递已经确定单一接收者的 InboxMessage，不重新寻址，也不创建或更换 AgentRun。
  - IP-03 的 AgentRun Scheduler（原 CC-09）与 `AgentRuntimeAdapter` 不更换既有目标；忙碌、限流或临时 Runtime 故障只导致排队、恢复或失败。
- **理由**：稳定目标 ID、结构化地址、事务内快照和永久命令结果能够避免最近目标猜测、语义路由与成员变化污染历史目标，同时把执行编排和可靠投递留在各自的权威边界。
- **领域模型同步事项**：接受本决策后，应在 DM-12/DM-13 将泛称 `Router` 收窄为 `Message Addressing` 或对应的 Core/Turn Coordinator，并补充 CampMessage 地址快照、公共可见性、回复引用和 waiting 输入代际约束。

### CC-02 Domain Command Gateway

- **状态**：已接受
- **Lumen 决策**：在 Rust Core 内建立唯一的静态强类型 `Domain Command Gateway`，以固定公共流程统一可信 Actor、规范化、Digest、永久幂等、fencing、事务与 Wake，并把 Capability、对象版本和业务不变量留给命令专用 Handler。
- **核心问题**：如何统一所有权威领域写入的基础设施约束，同时避免通用弱类型 Command Bus、动态 Middleware、运行时命令注册和集中式业务规则引擎。

#### 决策结果

- **决策**：接受静态强类型 Domain Command Gateway 加命令专用 Handler；所有由 User、Agent、System 或 Runtime 发起、可能重试且会创建、修改或终结权威领域事实的操作都必须经过该入口，不允许 Service、Worker 或 `AgentRuntimeAdapter` 绕过它直接写领域对象。
- **传输与领域类型**：JSON-RPC/IPC 可以继续共享字符串 Method 与 JSON 信封，但进入 Gateway 前必须转换为编译期封闭的 Rust 命令类型，例如显式枚举或 sealed trait；领域 Handler 不接收任意 `serde_json::Value`，也不允许运行时注册新的权威命令类型。
- **身份与命令 ID**：传输层 Request ID 只关联本次 IPC 请求/响应，不是幂等身份。`commandId` 在数据库生命周期内使用全局命名空间：UI 在首次提交前生成并在业务重试中复用；Agent 命令由 Core/`AgentRuntimeAdapter` 从已持久化 Native Tool Call 映射；System 命令使用已持久化 ID 或按稳定原因、对象版本和命令类型确定性派生。`commandId` 只提供幂等身份，不授予权限。
- **固定公共流程**：
  1. 认证调用来源，解析命令 Schema 和可信稳定 Actor；Agent 输入先确认 Agent 与 `sourceAgentRunId` 的稳定身份绑定，但不在此检查当前 Epoch。
  2. 按命令的规范化版本生成语义请求并计算 Request Digest；Digest 包含命令类型、Actor、业务参数和版本前置条件，排除 Trace、传输时间、租约和 `executionEpoch`。
  3. 可以先做只读的历史结果快速查询；完全命中且调用方仍有读取权限时直接返回原结果，语义不一致时返回 `idempotency_conflict`。
  4. 历史结果不存在时，可以执行命令声明的只读外部 Preflight；Preflight 不得产生副作用，其结果必须以摘要、版本或稳定引用进入后续校验，不能单独成为权威事实。
  5. 开启短 SQLite 写事务并再次查询 `command.result`，消除快速查询、Preflight 与并发提交之间的竞态。
  6. 仍不存在历史结果时，校验当前 `sourceAgentRunId + executionEpoch`、Capability、命令声明的对象版本和具体领域门禁。
  7. 在同一事务写入权威状态或可恢复请求事实、普通领域事件以及唯一不可变的 `command.result(applied|accepted|rejected)`。
  8. 提交后根据已提交状态发送可丢失的类型化 Wake；幂等命中、冲突或事务回滚不发送 Wake，后台正确性只依赖权威对象扫描。
- **命令专用 Handler**：每个命令静态声明允许的 Actor 类型、Agent Capability、必需版本前置条件、领域状态机与不变量、类型化结果 Schema、状态/事件变化和事务后工作资格。公共 Gateway 不解释 Camp、Task、CampTurn、Approval、ActionExecution 等业务规则，也不提供客户端可自由填写的任意对象版本集合。
- **结果语义**：
  - `applied` 表示立即型状态变化已在当前事务完成。
  - `accepted` 表示可恢复编排请求已可靠落盘；后续终态由拥有新 `commandId` 的 System Command 提交，原结果永不回写。
  - `rejected` 表示命令已进入领域处理但 Capability、Version 或命令专用门禁未通过；拒绝结果同样永久幂等。
  - 未认证、Schema/规范化失败、可信 Actor 无法解析、Agent 与来源 Run 的稳定身份不匹配，以及没有历史结果时的旧 Epoch 输入，属于受理前失败，不写 `command.result`。
- **永久幂等**：`command.result` 在数据库生命周期内永久保留，并以 `commandId` 部分唯一索引保证同一命令只有一个结果。结果 Payload 由 `(commandType, resultSchemaVersion, resultCode)` 对应的封闭 Schema 校验，必须经过脱敏并设硬大小上限；大结果写入自然权威对象或 Managed Blob 后只保存引用。相同命令重试不重新校验会随时间变化的业务门禁、不重复写事件，也不重复 Wake。
- **事务与外部 I/O**：同一命令的最终幂等查询、领域读取、门禁、状态变化、普通事件和 `command.result` 必须位于同一个 `BEGIN IMMEDIATE` 或等价 SQLite 写事务。事务内禁止 Runtime、网络、文件系统或其他不可回滚外部 I/O；真正的副作用通过 `accepted` 请求事实和类型化 Worker 推进。只读 Preflight 可以发生在事务外，但必须在写事务内重新查询幂等结果并校验其冻结输出。
- **并发模型**：正确性依赖数据库唯一约束、对象 Version CAS 与 execution/action Epoch fencing，不依赖进程内全局命令 Mutex。当前单连接 `Mutex<Database>` 或按 Camp/Conversation 的进程内串行化可以保留为连接安全和冲突降低优化，但不能成为并发正确性的唯一依据。
- **不产生独立命令结果的操作**：纯查询、流式 Token/Thinking Delta、普通运行日志与指标、Migration、Eligibility/Scanner 查询、纯内存计算、不改变语义状态的租约获取/续期/Heartbeat，以及同一命令事务内的确定性派生更新，不产生新的领域命令或 `command.result`。
- **仍须使用强类型命令的内部写入**：会建立 Attempt、递增 Epoch、改变领域状态、提交 Runtime 关键结果、确认业务 ACK、解决 Approval、结束重试，或产生事务后工作资格的 Worker/Runtime 操作，必须使用稳定 `commandId` 的强类型 Agent/System Command。纯租约维护不得借机修改业务状态。
- **实现策略**：不要求一次性重写所有读接口、流式事件或诊断路径；先实现公共信封、规范化/Digest、Unit of Work 与 `command.result`，再按 v0.02 垂直功能切片逐个迁移写命令。所有新增 v0.02 领域写入口从一开始必须使用 Gateway，避免形成第二套写协议。
- **对后续组件的约束**：
  - IP-03 的 `AgentRuntimeAdapter`（原 CC-12）负责把 Native Tool Call、Runtime 回调与稳定 Actor/Run/Epoch/commandId 可信映射后再调用 Gateway，不直接修改领域状态。
  - IP-01 的 Transactional State Store（原 CC-18）提供 `BEGIN IMMEDIATE`/Unit of Work、`event_log.command.result` 部分唯一索引、事件 Schema、规范化版本和事务后 Wake 描述。
  - IP-03 的 Background Worker Runtime（原 CC-20）为每类 Worker 定义稳定 System Actor、System Command ID、资格扫描和 Wake 协议；不引入通用 Outbox 或动态命令类型。
- **理由**：DM-17、DM-21 和 DM-22 已要求强类型命令、永久幂等结果、对象版本、Runtime fencing 与可恢复状态扫描；集中实现这些横切约束比让每个 Service/Worker 分别实现更小、更安全，也能在 UI 重试、Runtime 重连、Agent 并发和应用崩溃后稳定返回第一次处理结果。

### CC-03 Agent Registry & Membership Service

- **状态**：已接受
- **Lumen 决策**：在 Rust Core 内采用单一逻辑组件，内部划分 Agent Registry 与 Camp Membership 两个职责区域，分离建模 `AgentProfile` 与 `CampMember` 但共享事务边界。
- **核心问题**：AgentProfile 目录、CampMember 生命周期、Capability 覆盖和 Default Lead 应属于一个逻辑组件还是拆成两个边界。

#### 决策结果

- **决策**：接受单一逻辑组件、双职责区域的方案，以原子维护 AgentProfile 生命周期、有效成员资格和 Default Lead 不变量；该组件是进程内逻辑边界，不表示独立部署服务、数据表或 Rust crate。
- **Agent Registry 负责**：
  - `CreateAgentProfile`、`UpdateAgentProfile`、`EnableAgentProfile`、`DisableAgentProfile` 与 `ArchiveAgentProfile`，不提供普通硬删除。
  - 稳定身份、名称、头像、`@handle`、角色说明、默认指令、默认 Capability、默认 Provider/Model 偏好，以及 Profile 领域查询。
  - Profile 禁用或归档时校验其担任 Default Lead 的全部 Camp 继任映射，并与 Camp Membership 在同一事务维护成员资格与 Lead 不变量。
  - Profile 启用后，如果它令某个活跃 Camp 首次出现有效活跃成员，则在同一事务将其设为 Default Lead；已有有效 Lead 时不隐式更换。
- **Agent Registry 不负责**：Camp 生命周期、Repository Binding、Task、Conversation、AgentRun、Native Session、运行状态、Provider 凭据/目录/Adapter，以及面向 UI 的组合读模型。
- **Camp Membership 负责**：
  - `CampMember` 的加入、重新加入、退出请求、退出终结规则和成员资格查询；同一 `(campId, agentProfileId)` 始终复用同一成员记录。
  - Camp 内 Capability allow/deny 覆盖、有效活跃成员判定，以及当前授权是否仍覆盖既有 AgentRun 冻结授权的领域查询。
  - Default Lead 的资格、选择、显式变更和继任规则；`defaultLeadAgentId` 仍保存在 `Camp` 上，Default Lead 只是默认路由入口而不是权限角色。
  - `LeaveCamp` 第一事务写入退出请求并冻结、应用必要的 Lead 继任，随后发起相关非终态 AgentRun 的取消；CampMember Finalizer 只在运行与动作安全收敛后提交 `left`。
- **Camp Membership 不负责**：AgentProfile 身份修改、Provider 配置、Conversation 内容与 Native Session、Task/AgentRun 状态，以及最终运行配置的解析和冻结。
- **配置边界**：本组件只提供 AgentProfile 默认值、CampMember 覆盖和当前授权事实；Execution Context Builder 负责继续叠加 Conversation 覆盖与 Task/AgentRun 上限并冻结 `effectiveConfig`。Profile 或 Member 的后续修改不得改写任何既有 AgentRun 快照。
- **明确不建立**：`AgentInstance`、`AgentProfileVersion` 实体/表/API、`Team` 与 `TeamMember`；`AgentProfile.version` 仍作为乐观版本和快照来源版本保留。
- **不单独建模**：`AgentRole` 由角色说明、Capability 与非权限性的 Default Lead 分别表达；`AgentAssignment` 由固定 `Task.assigneeAgentId`、Conversation 和 AgentRun 执行职责表达。
- **对后续组件的约束**：
  - IP-02 的 Camp 模块（原 CC-04）只负责 Camp 创建、Repository Binding/重定位和归档，不提供成员命令；`ArchiveCamp` 仍须在归档事务清空 `defaultLeadAgentId`。
  - IP-02 的 Turn Coordinator（原 CC-06）不得创建 AgentProfile 或 CampMember，只能消费 Message Addressing 或其他强类型命令已经解析的有效活跃成员与唯一 Conversation，再创建 CampTurn/AgentRun。
  - IP-02 的 Conversation 模块（原 CC-07）拥有 Conversation 内容、连续性和 Native Session Binding；加入时创建或复用、重新加入时复用 `(campId, agentProfileId)` 唯一 Conversation。
  - IP-03 的 AgentRun Scheduler（原 CC-09）以有效活跃成员和“当前授权仍覆盖 `effectiveConfig`”作为成员授权门禁，并与其他启动条件合并；不得查询 `AgentInstance.status`，也不得因授权扩大而扩张既有快照。
  - IP-03 的 Execution Context Builder（原 CC-10）负责解析并冻结最终有效配置，本组件不拥有 AgentRun 配置快照。
  - IP-03 的 Background Worker Runtime（原 CC-20）托管 CampMember Finalizer 的扫描与执行，本组件保留退出资格和终结规则。
- **理由**：长期身份、Camp 内成员关系、Conversation 连续性和 Runtime 状态具有不同生命周期，必须分离；Agent Registry 与 Camp Membership 共享事务边界，则能原子维护 Profile 禁用/归档、成员加入/退出和 Default Lead 继任。

## 收缩后的实施包

### IP-01 Core Transaction

- **状态**：已确定
- **吸收范围**：保留的 CC-02 Domain Command Gateway，以及原 CC-18 Transactional State Store。
- **目标**：为全部权威写入提供一个静态、强类型、可永久幂等的 SQLite 事务边界。

#### 固定边界

- Domain Command Gateway 是唯一领域写入口；命令专用 Handler 拥有 Capability、版本前置条件、状态机和业务不变量。
- SQLite Unit of Work 在同一写事务内完成最终幂等查询、领域读取、状态变化、普通事件和唯一 `command.result`。
- Repository 只提供聚合读写，不自行提交事务；Migration 负责版本化 Schema/数据迁移，不承担运行期补偿编排。
- `event_log` 是追加式审计与永久命令结果存储，不是 Event Sourcing 真源、工作队列或 Outbox。
- 事务外工作只从已提交的权威对象状态派生；提交后的 Wake Signal 可以丢失。
- 事务内禁止 Runtime、网络、文件系统和 Git 等不可回滚 I/O。

#### 编码验收

- 同一 `commandId` 与相同 Digest 永久返回第一次结果，不重复写状态、事件或副作用资格。
- 同一 `commandId` 与不同语义请求返回 `idempotency_conflict`。
- CAS 冲突、事务回滚和进程在提交后、Wake 前崩溃均有自动化测试。
- 任意 Service、Worker 或 Adapter 绕过 Gateway 修改领域状态，应在代码结构或测试中被阻止。

### IP-02 Collaboration

- **状态**：已确定
- **吸收范围**：保留的 CC-01、CC-03，以及原 CC-04～CC-08。
- **目标**：在同一 Rust Core 内实现 Camp 长期协作、Task 承诺、CampTurn 执行边界、Conversation 连续性和 Inbox 可靠投递。

#### 固定边界

- Camp 模块拥有创建、Repository Binding/重定位和归档门禁；成员命令仍归 CC-03，Git 事实校验委托 IP-04。
- Task 模块拥有扁平 Task、Dependency DAG、Readiness、完成证据门禁和取消请求；后台 Finalizer 只是执行其已确定规则。
- Turn Coordinator 原子创建或追加 CampTurn/AgentRun，维护职责后继、Retry/Rework/Decline 互斥，并确定性聚合 CampTurn。
- Conversation 模块拥有公私消息序列、来源幂等、连续公共前缀、摘要水位、Tombstone 和当前 Native Session Binding。
- Inbox Dispatcher 只扫描 `InboxMessage`，幂等写入目标 Conversation，并在同一事务设置投递 ACK；它不重新寻址、推断执行意图或扩大 AgentRun 冻结水位。
- 跨模块写入由一个命令 Handler 和 IP-01 Unit of Work 编排，不通过相互调用各自提交事务。
- 不得隐藏引入 Project、TeamRun、AgentInstance、Handoff、Review、Decision 或 Artifact 状态。

#### 编码验收

- 一次执行型公共消息能在一个事务内形成消息、地址快照、CampTurn、首批 AgentRun 和冻结输入水位。
- 多目标执行产生同一 CampTurn 下的独立 AgentRun；同一触发重试不重复创建。
- Inbox 在重复投递、进程崩溃、永久失败和普通消息过期时保持 DM-14 的唯一消息与 ACK 约束。
- Default Lead 继任、成员退出、Task 取消和 Camp 归档均通过破坏性恢复测试。

### IP-03 Execution Runtime

- **状态**：已确定；RT-01 已修订通过
- **吸收范围**：原 CC-09～CC-12、CC-20。
- **目标**：从持久 AgentRun 资格安全启动 Codex，并在 Runtime Host、Native Session 或应用崩溃后继续同一逻辑执行。

#### 已确定的实施基线

- AgentRun Scheduler 只扫描权威状态；认领前完整校验输入、Task、成员授权、Workspace、Conversation 执行权和取消状态，再原子获取租约并递增 `executionEpoch`。
- Execution Context Builder 是确定性组装器。`effectiveConfig` 和初始公私水位由 AgentRun 创建事务冻结；Workspace 可按 DM-23 在 Runtime 绑定前补齐。Builder 只能加入冻结前缀和显式关联的 continuation 输入。
- 上下文超预算策略属于可调实现策略：必须保留当前触发、执行契约与安全指令，优先使用带水位的摘要，再裁剪旧明细；不得越过冻结水位读取“现在最新”的 Conversation。
- `AgentRuntimeAdapter` 负责发现用户本机 Code Agent、执行握手与能力探测，并公开本次安装的能力矩阵；报告版本只用于诊断和运行快照，不作为精确版本白名单。具体 Adapter 负责双向协议翻译、事件规范化和错误分类，只调用强类型 Gateway，不直接修改领域状态。
- Background Worker Host 只共享 Wake、时钟、批次、租约、退避、关闭和健康能力；每类 Scanner/Finalizer 保留自己的资格查询与 System Command，不形成通用 Job/Outbox Kind 注册表。

#### RT-01 Runtime 拓扑

- **状态**：已修订通过
- **决策**：v0.02 默认由同一 `RuntimeHostKey` 下的共享 `CodexRuntimeHost` 承载多个相互隔离的 Codex Native Thread；共享 Host 是 `CodexRuntimeAdapter` 的托管策略，不是全局 Singleton、Conversation 领域不变量或持久实体。

##### RuntimeHostKey 与拓扑

```ts
type RuntimeHostKey = {
  adapterKind: 'codex';
  protocolVersion: string;
  authScope: string;
  processConfigDigest: string;
};
```

`authScope` 必须是稳定的非秘密作用域标识或指纹，不能保存凭据明文。`processConfigDigest` 必须由版本化、规范化后的进程级配置计算，覆盖要求进程级一致的 Codex Home、进程环境、MCP、插件和启动参数，但不混入 Run/Thread 级配置或秘密明文。`RuntimeHostKey` 在 Host 存续期间不可变；认证范围或进程配置变化时创建新 Key/Host，并让旧 Host 安全排空，不得原地改写后继续共享。

```text
一个 RuntimeHostKey
→ 0..N 个 CodexRuntimeHost

v0.02 默认
→ 每个 RuntimeHostKey 最多一个 Host

一个 CodexRuntimeHost
→ 多个 Native Thread

一个 Conversation
→ 0..1 个当前 Native Session

一个 Native Session
→ 只属于一个 Conversation

一个 Conversation
→ 同时最多一个 running/waiting AgentRun
```

不同 Conversation 可以在同一 Host 中并行。若锁定版本的验收证明全局 single-flight、配置串味、OS 级隔离或 Crash Blast Radius 不可接受，可以将某个 `RuntimeHostKey` 升级为有限 Host Pool 或专用 Host，不改变 Conversation、Native Session、AgentRun 或 `executionEpoch` 的领域关系。

##### Native Thread Binding 与双重 fencing

```ts
type NativeThreadBinding = {
  conversationId: string;
  nativeThreadId: string;
  activeAgentRunId: string | null;
  executionEpoch: number | null;
  nativeTurnId: string | null;
};

type CodexRuntimeHost = {
  hostInstanceId: string;
  hostKey: RuntimeHostKey;
  connection: AppServerConnection;
  threads: Map<string, NativeThreadBinding>;
};
```

`hostInstanceId` 表示一次 Host 进程与 App Server 连接代际，`executionEpoch` 表示一次 AgentRun 执行租约代际。事件进入 Core 前必须依次验证当前 Host Instance、唯一 Thread Binding、Native Turn、AgentRun 和 Execution Epoch。无法唯一映射的事件只进入诊断或恢复路径，不得直接修改 AgentRun、Approval 或 ActionExecution。

Host 代际先阻止旧连接 Reader；AgentRun Epoch 再阻止旧执行推进当前状态。可能对应已经发生副作用的迟到观察仍进入 IP-04 的 Action 对账路径，不能简单丢弃。

##### Session 绑定与恢复

- `Conversation.nativeSessionId` 在 `CodexRuntimeAdapter` 内解释为 `nativeThreadId`，不绑定 Task、AgentRun 或 Host 进程。
- 同一 Conversation 的后续 AgentRun 在 Workspace、Sandbox 和冻结配置兼容时优先 Resume 当前 Thread；失败时创建新 Thread，并通过强类型命令换绑。
- Session 换绑必须在同一事务校验旧绑定、新 Session 唯一性，更新 Conversation 并写入 `event_log`；不能只修改内存 Registry。
- v0.02 在 Conversation 上使用非空 `nativeSessionId` 的部分唯一索引；未来多 Adapter 时扩展为 `(adapterKind, nativeSessionId)` 唯一。

Host/连接失效后的恢复顺序固定为：

```text
确认旧 Host/连接失效
→ fencing 旧 hostInstanceId
→ running AgentRun 进入 waiting(runtime_recovery)
→ 已 waiting 的 AgentRun 保留原主要 blocker
→ 检查 Approval、ActionExecution 与 Runtime Delivery
→ unknown 副作用优先对账
→ 确认不存在可能重复执行的动作
→ 重新取得执行租约并 executionEpoch++
→ Resume 原 Native Thread
→ 失败则创建新 Thread 并事务换绑
→ 重新聚合全部 blocker
→ 满足条件后继续或收敛终态
```

`waiting(approval)`、`waiting(user_input)` 和 `waiting(unknown_action_outcome)` 不得被 Host 故障覆盖成单一恢复原因；Runtime Recovery 可以作为附加活动条件或恢复事实显示。

##### Host 回收

Runtime Manager 必须实现明确的 `isHostReclaimable(host)`。只有不存在进行中的 Native Turn、待当前连接响应的反向请求、未 ACK Runtime Delivery、未确认停止的取消、未可靠关联的 Native Tool Call，并且所有存续 Conversation/AgentRun 都能仅凭持久状态安全 Resume 时，Host 才可进入空闲 TTL。没有 Token 输出不代表可以回收。

##### 实施边界

当前按 Task 保存单一 `thread_id/turn_id` 的 Runtime 实现必须拆为以下进程内职责，不得只做重命名：

- `CodexRuntimeHostManager`：按 RuntimeHostKey 创建、复用、回收 Host。
- `CodexRuntimeHost`：管理单条 App Server 连接与 `hostInstanceId`。
- `NativeThreadBindingRegistry`：维护 Thread → Conversation/Run/Epoch/Turn 映射。
- `CentralEventDemultiplexer`：按 Host、Thread、Turn、Run 和 Epoch 分流事件。
- `RuntimeRecoveryCoordinator`：执行 Host fencing、Action 对账、Resume 和 Session 换绑顺序。

这些都是可重建运行组件，不增加 `runtime_worker` 表、Worker Owner、进程租约或 Worker 状态机。

#### 编码验收

- 对能力探测通过的 Codex 本机安装，两个 Native Thread 的模型请求必须能同时在途；若失败，不得宣称该安装通过单 Host 提供多 Agent 并行。
- 两个 Thread 同时请求 Approval 时，`threadId/turnId/actionId` 不得串线；cwd、Sandbox、Instructions、模型和工具上下文不得互相污染。
- 两个 Conversation 可以并行执行，同一 Conversation 的两个 Run 必须串行。
- 杀死共享 Host 或应用后，两条 AgentRun 可以分别恢复、换绑或失败，不会被错误聚合。
- 一个 Thread 的失败、取消、反向请求和迟到事件不得推进或中断另一个 Thread。
- MCP、插件和其他进程级配置不得被某个 Run 静默修改并影响其他 Thread。
- 旧 `hostInstanceId` 与旧 `executionEpoch` 的输出、命令和普通回调都被 fencing；可能已产生副作用的迟到观察进入 Action 对账路径。
- queued Run 不会读取晚于自身冻结水位的其他 Turn 消息。

### IP-04 Action & Safety

- **状态**：已确定
- **吸收范围**：原 CC-13～CC-16。
- **目标**：围绕单一 `ActionExecution` 完成动作规范化、Policy、一次性 Approval、执行、unknown 对账、Runtime Delivery 和 Workspace/Git 边界。

#### 固定边界

- Action Gateway 校验来源 Run/Epoch，规范化参数，判定 mediated/intercepted/observed 控制模式，并在冻结权限与当前硬性 Policy 的交集中计算 allow/deny/ask。
- Approval 只授权一个已准备、参数冻结的 ActionExecution；批准不表示动作已经执行成功，也不授予长期权限。
- Action Execution Engine 是一个逻辑组件，内部使用类型化 Executor、Observed Intake、Reconciler 和 Runtime Delivery Handler；这些 Handler 不建立第二份动作状态。
- Workspace & Git 模块负责 Repository Binding、AgentRun Workspace 和 Commit 作用域的确定性校验；文件/Git 副作用仍必须通过 ActionExecution。
- 不建立通用 Outbox、Worktree 实体、Workspace 写锁或额外 ActionReceipt 真源；确定终态按需投影 ActionReceipt。

#### 编码验收

- Approval 解决与实际执行分属两个可恢复步骤，任一步崩溃都能从权威状态继续。
- `unknown` 动作不会盲目重发；Reconciler 能提交确定结果、保持未知或接受受审计的人工证明。
- 旧 Epoch、重复回调和互相冲突的观察不能重复提交结果。
- Git Commit 证据在完成 Task 前已经绑定 Repository Scope 并保持完整 OID 可达。

### IP-05 Evidence & Read Side

- **状态**：已确定
- **吸收范围**：原 CC-17、CC-19。
- **目标**：验证稳定证据、保存受管文件，并为 Renderer 提供不竞争业务真源的查询与增量订阅。

#### 固定边界

- `EvidenceValidator` 校验 Criterion—EntityReference 的类型、作用域、可见性、保留资格与当前对象状态；它不理解自然语言是否满足 Criterion。
- `ManagedBlobStore` 负责不可变内容寻址、完整性、去重、流式读写和 GC；MessageAttachment、ActionExecution 与 Task 证据关系是 GC Root。
- 两者可以位于同一实施包，但必须保持独立接口；不得重新包装为通用 Artifact Service。
- Read Model 直接从 SQLite 权威表和确定性派生规则生成 DTO；v0.02 不建立持久 Projection 表或第二套运行状态缓存。
- 每次快照返回事务内捕获的 `throughGlobalSequence`；增量订阅从该游标继续。断线、序列缺口、Schema 不兼容或缓存不确定时，Renderer 丢弃派生缓存并重新获取快照。
- 增量事件用于失效通知和时间线，不允许 Renderer 仅靠重放事件构造权威对象状态。

#### 编码验收

- Task Readiness、Run Activity、unresolved effects 和 Camp 时间线由同一数据库快照一致生成。
- 快照与订阅交界不存在丢事件窗口；重复事件不会重复改变 Renderer 状态。
- Blob 去重、损坏检测、引用保留和 GC 有自动化测试。
- 删除/Tombstone 普通消息或清理动作时，不会破坏已完成 Task 的证据。

## 明确不作为 v0.02 核心组件

下列名称已被领域模型否决，不能通过“组件”名义重新引入：`Project Service`、`Team/TeamRun Orchestrator`、`AgentInstance Manager`、`Profile Version Registry`、`Handoff Manager`、`Review Engine`、`Decision Engine`、`Artifact Service`、`Transactional Outbox`、`Worktree Manager`。

长期 Memory、成长评测、Profile/Skill 发布、第二 Provider 和分布式执行仍属于后续阶段，不进入本轮核心组件决策。

## 后续维护方式

1. 五个实施包均已收口；不再恢复原 CC-04～CC-20 的逐项讨论。
2. IP-03 实施 ADR 必须先核验当前单槽 Runtime、事件 Reader 与 Approval 回调的引用路径，并以能力探测通过的 Codex 本机安装完成 RT-01 并发隔离验收。
3. 每个实施包只补一份实施 ADR，固定模块接口、事务边界、Schema/Migration、失败语义和自动化验收；普通类与 Handler 拆分留给代码评审。
4. 新问题先经过“决策门槛”判断。未改变领域事实、可靠性或高成本边界的，直接更新实施 ADR，不新增 CC。
5. 若实施发现需要改变领域事实，先回到 `domain-model.md` 修订，再同步本文件。
