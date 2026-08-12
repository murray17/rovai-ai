---
document_type: architecture
architecture: builtin-tool-runtime
authority: builtin-tool-component-boundaries
status: accepted
last_updated: 2026-08-12
---

# Built-in Tool Runtime Architecture

本文件说明 Rovai built-in operations 的长期组件结构。当前字段与版本以
[Built-in Tool Transport v7](../contracts/builtin-tool-transport-v7.md)、
[Durable Task v3](../contracts/durable-task-v3.md) 和
[Camp Message Send v4](../contracts/camp-message-send-v4.md)、
[Current User Attention v1](../contracts/current-user-attention-v1.md)与
[Missing-Send Recovery Publication v1](../contracts/missing-send-recovery-publication-v1.md) 为准；v6 及更早 Transport 只保留
historical 语义。决策理由见
[ADR-0124](../adr/0124-cli-only-transport-for-rovai-built-in-operations.md)、
[ADR-0135](../adr/0135-compact-agent-output-over-canonical-built-in-tool-envelope.md)、
[ADR-0136](../adr/0136-durable-task-v2-responsibility-and-coordination-authority.md)与
[ADR-0137](../adr/0137-one-time-task-linked-responsibility-admission.md)。Native Session context
compaction 后的 Bootstrap 补发可靠性见
[ADR-0138](../adr/0138-durable-bootstrap-redelivery-requirement.md)，版本拥有的 Runtime policy 与
完整矩阵见 [Native Session Bootstrap Redelivery](native-session-bootstrap-redelivery.md)。Self/peer
identity、Collaboration Projection 与输入水位见
[ADR-0146](../adr/0146-sole-native-session-self-identity-and-peer-routing-projection.md)和
[Collaboration State v2](../contracts/collaboration-state-v2.md)。模型投影、ContextManifest Evidence、
Runtime Input Delivery Evidence 与 Profile/Formatter/Manifest 权责见
[ADR-0147](../adr/0147-lossless-model-context-projection-and-layered-delivery-evidence.md)；whole-history
omission 的 bounded aggregate 边界见
[ADR-0149](../adr/0149-bounded-whole-history-omission-evidence.md)和
[ContextManifest Evidence v12](../contracts/context-manifest-evidence-v12.md)。Task authority 与
self-active awareness 见
[ADR-0152](../adr/0152-lead-owned-task-responsibility-and-self-active-task-awareness.md)；真实空集合
的显式 clearing snapshot 见
[ADR-0153](../adr/0153-explicit-empty-self-active-task-snapshot.md)。
Send 的显式 caller return 与 Core-managed reply reference 见
[ADR-0163](../adr/0163-explicit-caller-return-and-core-managed-reply-reference.md)。
Current User Attention 与 progressive CLI teaching 分别见
[ADR-0165](../adr/0165-core-owned-current-user-message-attention.md)和
[ADR-0166](../adr/0166-progressive-built-in-cli-teaching.md)；完整七项 official Skill inventory 与普通
投递见 [ADR-0167](../adr/0167-seven-skill-official-inventory.md)。

## 总体路径

```text
Agent Runtime
    │ fixed business command + process-scoped CLI context
    ▼
bundled `rovai` CLI
    │ authenticated local Unix IPC
    ▼
Core BuiltinToolRouter
    │ current Run / lease / Native Binding
    ├── Public Camp Message / Message Delivery service
    ├── Collaboration / Task service
    ├── Camp History service
    └── Memory Retrieval / Mutation service
```

业务调用的响应路径是：

```text
Domain canonical result
  → complete Core Invocation Envelope
  → envelope validation
  → explicit operation Agent Result Projection
  → one JSON document on Agent stdout
```

CLI 是运输与投影客户端，不拥有领域逻辑、授权、receipt 或 Replay 真源。Router 验证输入、解析
active lease、调用既有领域服务，并生成完整 Envelope、receipt、Replay 和 Core Activity。Projection
不能参与 receipt、Replay 或授权决策。

## 权威与边界

| 组件 | 拥有的权威 | 不是 |
| --- | --- | --- |
| Built-in Tool Catalog | canonical names、输入/结果 schema、`agentOutputSchema`、projection identity、错误合同、CLI mapping、digest | Agent-facing discovery API |
| `rovai` CLI | 输入来源解析、IPC、完整 Envelope validation、显式 projection、stdout/exit/stderr 安全边界、有限运输重试 | 领域 handler、授权者、receipt 生成者、通用字段删除器 |
| BuiltinToolRouter | current lease 解析、operation 分发、完整 Envelope、receipt、Replay、Activity | 第二套 Message/Delivery 服务 |
| Domain Services / Gateway | 可见范围、版本、状态、配额、幂等副作用和业务不变量 | CLI 或 MCP 适配层 |
| Runtime Fleet | process ownership、exclusive Run lease、reuse、fence、quiescence | Camp 选择或业务 catalog |
| Runtime Adapter | 启动/恢复 Runtime、注入 CLI 环境、Bootstrap、外部 MCP Projection | built-in schema、alias、Agent discovery |
| Bootstrap / Charter | 固定命令、使用原则、帮助入口和安全恢复原则 | 完整 schema、Envelope、catalog digest、凭据、Camp ID |
| Evidence / Qualification / host debug | 完整 Envelope、receipt、request identity 和诊断证据 | Agent 日常 stdout |

## Catalog 与 Agent command

Core 只维护一份 catalog。它服务 IPC 校验、合同测试、Qualification、Evidence/receipt 验证和
开发诊断；catalog 中的 `agentOutputSchema`、Envelope schema、error contract 和 projection
identity 不构成 Agent discovery 协议。

Agent Runtime 没有 `rovai tool list`、`rovai tool describe`、隐藏 discovery、`tool invoke` 或
`tool call`。Agent 只使用十三个固定业务命令：

```text
rovai send
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory search|read|write|propose-hearth
```

Agent 先用 `rovai --help` 选择 operation，再用该 operation 的精确 `--help`。根 `send` 使用
`rovai send --help`；分组命令必须包含 action，例如 `rovai task create --help`。不存在
`rovai task|camp|memory --help` 教学别名。Help 只列必要 flags、输入来源互斥规则、关键约束
和短示例，不输出完整 JSON Schema、Envelope、receipt 或 catalog。Dotted canonical operation
仍是 Core 内部语义身份，不能直接变成通用 Agent 命令。

## Agent Result Projection

完整 Envelope 经过验证后，CLI 按 operation 显式选择 projection：

| Operation | Projection |
| --- | --- |
| `camp.message.send` | `{messageId, effectiveRecipients}` |
| `team.create_task` | `{taskId, title, status, assigneeAgentId, version, availableActions}` |
| `team.get_task` | 完整 `TaskDetail` |
| `team.update_task` | `{taskId, title, status, assigneeAgentId, version, changed, availableActions}` |
| `team.list_tasks` | 紧凑 `TaskListPage` |
| `memory.write` | `{memoryId, revisionId}` |
| 其余七项 | 去除 Envelope wrapper 后的 canonical result |

Task service 在 mutation 事务中形成完整 exact-version `TaskDetail` canonical result，并由
Command Gateway 持久化后才交给 Transport projection。CLI 不能在 commit 后重新读取 live Task，
也不能从 compact stdout 反推、补造或覆盖 Core result。Get/List 的不同结果层次属于 Task
Read Side 合同，不是 generic projection heuristic。

每项 projection 都有闭合的 `agentOutputSchema` 和 golden fixture；对象外字段被拒绝。边界规则
只防止透传 Envelope-owned `contractVersion`、`ok`、`operation`、`requestId`、`receipt` 和
`result` wrapper，不对业务 JSON 做全局递归禁字段扫描。业务结果中的同名字段若由其自身 schema
定义，仍然有效。`false`、`null`、空数组、截断和 cursor 等业务信息不得为了观测压缩率被删除。

完整 Envelope 只保留在 Core IPC、Evidence、Qualification 和 host-controlled debug；不存在
Agent 可控的 envelope output mode、环境变量、隐藏 flag 或 `--full`。

## Runtime process、Lease 与 Camp scope

每个受管 Runtime 根进程拥有稳定 process identity 和私有 CLI context path。Fleet acquire 为
当前 `(agentRunId, executionEpoch)` 轮换 active lease，Core 在输入投递前完成绑定和 CLI preflight。
release 顺序固定为：

```text
stop accepting new Runtime work
  → fence Built-in Tool Lease
  → wait/verify Runtime + CLI quiescence
  → IdleWarm when reusable, otherwise stop and reap
```

Lease/Context 不携带 Agent 可选的 Camp ID。`camp.message.send` 的 Camp 只由

```text
Lease → AgentRun + executionEpoch + NativeBinding
      → resolve_sender_identity()
      → authenticated current Camp
```

推导。首次调用将它写入内部 `CampMessageSendCommand.camp_id`；持久 Replay 读取已记录的
`camp_id + source AgentRun + executionEpoch`，不重新使用当前活跃身份。其他跨 Camp read 工具的
显式 `campId` 仍由各自领域合同控制。

### 新 Session

1. Adapter/Fleet 启动或取得独占 Runtime process；
2. Core 绑定新 active lease，并写 process-private context；
3. Adapter 建立 Native Session 并投递固定命令 Bootstrap；
4. Core 按 Profile 选择并由 Formatter 形成 Model Context Projection，再冻结 ContextManifest；
5. Core 建立 Runtime Input Delivery，将 Manifest 绑定到 execution epoch/Binding generation 后投递；
6. Agent 使用固定命令和 command-local `--help`；Router 从 lease 解析当前 Run 与 Camp。

### Resume / Resident process reuse

Resume 重新投递稳定 Bootstrap，但不改变 catalog 真源；新 Run 必须获得新 lease。兼容 IdleWarm
process 被新 Run acquire 后轮换 lease，再绑定新的 Session/Run route。任何旧 lease、迟到 callback
或旧 request 都 fail closed。Core restart 不接管旧 process context。

### Antigravity one-shot 输入确认

Antigravity companion 的 `--print` 进程同时承担输入投递与完整生成，进程退出不是唯一可用的 accepted
边界。Adapter 只在同一份 process-private log 中依次确认可验证的 Native Conversation ID、本次输入已
forward/send 到该 Conversation，以及其后 `streamGenerateContent` 返回 `ResponseID`，才向 Core 报告
早期 accepted evidence。child process 启动、Conversation 创建或本地 forwarding 单独出现都不构成
ACK；resume 时观察到的 Conversation ID 还必须等于请求冻结的 ID。

Core 收到该 evidence 后先绑定 Prepared Native Session，再持久化 Runtime Input Delivery accepted
ACK，Antigravity 进程继续生成。成功退出以及带可验证 Session identity 的 final-output failure 保留
原有 terminal fallback，以兼容未出现早期 marker 的受支持输出路径；非零退出、取消或日志格式无法
验证且尚无 ACK 时仍进入 `delivery_unknown`。一旦 accepted ACK 已持久化，后续进程失败或取消只能
结算当前 AgentRun，不能把输入降级为 unknown 或触发 replay；terminal identity 与早期 evidence 不同
时 fail closed。

日志只在单个进程生命周期内以私有权限读取，检查上限为 2 MiB，并在进程结算后删除；日志正文不进入
Domain Event、Execution Evidence 或错误文本。具体版本 marker 与实机证据由
[Runtime compatibility register](../runtime-compatibility.md) 维护，不把上游日志文案提升为跨版本合同。

### Claude Code one-shot 输入确认

Claude Code 使用 `--output-format stream-json --include-partial-messages`，但输出流中的进程初始化、Hook、
status 和 stdin 写入都不是 accepted evidence。Adapter 只接受带预期 UUID Session identity 的首个模型
响应事件：Claude `stream_event` 的 message/content 生命周期或完整 `assistant` event。Core 在该事件到达时
持久化 Runtime Input Delivery ACK，Claude 进程继续运行到最终 `result`；匹配 Session 的 success result
保留为未观察到早期事件时的 terminal fallback。

早期事件和 terminal result 的 Session/Turn identity 必须一致。accepted 后的进程失败、取消、输出解析
失败或 final-output 缺失只能结算当前 AgentRun，不能降级为 `delivery_unknown` 或重放输入；在任何合格
模型事件和 success result 之前失败时，结果仍按未知投递处理。单行 stream event 保持 2 MiB 安全上限，
不会把完整流、Hook 正文或模型增量复制进 Runtime Input Delivery Evidence。

### ACP Prompt 输入确认

OpenCode、Copilot、Kiro、Qoder、CodeBuddy 与 Qwen 共用 ACP Host 输入确认。Core 创建 prepared Delivery
并发送 `session/prompt` 后，stdin write/flush 只表示 transport send，不立即 ACK。Host 把 Delivery identity
绑定到当前 Session 的唯一 active prompt，并只在该 prompt 上观察到运行时产生的 agent message/thought、
plan、tool update 或 permission request 时报告早期 accepted evidence；usage、mode、command catalog 等
Session metadata update 不构成 ACK。

若没有早期事件，匹配 JSON-RPC request ID 的成功 prompt response 是 terminal accepted fallback。明确的
JSON-RPC error response 在尚无 accepted evidence 时把 Delivery 结算为 `not_accepted`，不推进水位；若早期
accepted 已持久化，迟到 error/退出不得降级它。Host 在任何关联运行时证据前丢失时继续进入既有
runtime-loss / `delivery_unknown` 对账，不能以 pipe flush 抑制重试或恢复。

### Successful Run 的 Missing-Send Recovery

Runtime final 继续首先服务 AgentRun 成功/失败结算；Adapter 另外形成 optional typed recovery candidate。
Codex 只使用 completed-turn items，Claude 只使用 matched success result，Antigravity 只使用验证且未截断
的 print stdout。ACP 保留全量 assistant aggregate 作为 Run success final，同时独立收集最后一次 tool
activity 后的 assistant suffix；只有匹配 prompt 的 `end_turn` 暴露 candidate，optional `messageId`
身份混乱时 fail closed。

Core 在 successful terminal transaction 检查该 Run 的任意 accepted `camp.message.send`。有 send 则不
发布；无 send 且 candidate 合格时写一条 recipient-free CampMessage，并且不创建 Delivery 或预算责任。
候选缺失、超出 32 KiB 或 provenance 不匹配只改变 recovery decision，不改变 AgentRun success。
该 safety net 不判断进度/最终意图，也不解除 Agent 在需要公开 answer/result/status/summary 时显式
`rovai send` 的 Charter 义务。

### Dispatch 前 Runtime drift 与 rebind

AgentRun 冻结 Adapter、Installation、auth scope、模型选择语义和权限配置；Installation 的路径、版本、
fingerprint、capability snapshot 与 generation 是可变的外部观察。初始 reported version/fingerprint
作为不可变审计证据保留，实际 launch 使用的 effective Runtime 只能由 Core 在 dispatch 前更新。

轻量文件身份或完整 SHA-256 发现漂移，以及 snapshot changed/stale、path invalid、probe required 时，
Core 先使旧 snapshot 失效并停止复用该 Adapter 的 resident process，再同步 re-discover/deep-probe。
只有相同 logical identity 能解析为 enabled、authenticated、ready 且协议/模型/权限兼容的 Runtime 时，
Core 才原子更新 Run effective config 与冗余 Runtime 列，记录 drift/rebound 事件，并重复 blocker 与
executable integrity 校验。每个 Run 最多自动 rebind 一次；第二次漂移、身份变化、歧义或无法确认
兼容性时 terminal fail。完整长期边界见
[ADR-0156](../adr/0156-logical-runtime-identity-and-bounded-installation-rebind.md)。

## Bootstrap 与 Dynamic Context

> 本节的 compact projection、Charter 补充规则和 canonical continuation 已由 v0.50 实现；实施状态见
> [v0.50 概览](../versions/v0.50/README.md)。

Session Charter 只说明：

- CLI contract 标题固定为 `Rovai Built-in CLI Contract`，不显示应用 release/version；
- 使用 bundled `rovai`；
- 固定业务命令，以及“先 `rovai --help`、再运行具体 operation 精确 `--help`，不假设 family help”；
- `camp.message.send` 使用当前 Run Camp，不能传入 Camp ID；
- 对 `explicit_send_only` Runtime，narration/final response 只是私有执行证据；当前责任需要在 Camp
  公开 answer/result/status/summary 时必须在结束前调用 `rovai send`，只有成功 send 才发布该回复；
- Core 可能在 successful zero-send 且 Adapter final boundary 可靠时执行 Missing-Send Recovery，但它不
  保证完整最终结论公开，也不应被 Agent 当作省略 `rovai send` 的正常路径；
- Task responsibility definition belongs to the User or current Camp Default Lead；
- Public Message、Message Delivery、Memory 和 read 工具保持各自稳定业务原则；
- Dynamic Context 可能截断或省略：单条正文只使用可直接提交给 canonical operation schema 的
  executable continuation；整条历史的 sequence envelope 只是 navigation hint；公共 A2A 遵循
  Profile v3 的 bounded reference closure 与 self-active Task selection。

Charter 不承载 Task 创建克制、字段权限、Camp-wide read、local planning/A2A、wake/send、Memory
治理或 polling 操作指导。普通 flags 属于精确 operation help；命令族选择、message→Task、多操作协调
与复杂 recovery 属于窄触发 `cli-operations` official Skill；Memory 治理属于
`memory-stewardship`。特别是
`task create --help` 面向 User/Default Lead 说明只持久化跨 Run/交接的独立责任，并优先推进已有
Task；Core 不做语义去重。

Bootstrap 不含完整 Schema、Envelope、receipt、catalog digest、socket、process token、lease、
AgentRun ID、epoch、Camp ID 或 Native Binding ID。只有无损映射到当前 schema 的完整 operation/input
对象才是 Executable Retrieval Locator；非可执行 navigation hint 不伪装成 tool input，也不重复
transport 细节。

`cli-operations` 和 `memory-stewardship` 都沿用 ordinary official Skill Library、默认 enabled、默认九
Runtime Group Assignment 与用户后续修改保持。Skill Exposure 只证明 Runtime-native discovery 可见，
不证明模型读取正文，也不授予命令、文件、网络或协作权限。普通单一 send/`--to-user`/list/get/search/read
不要求加载 `cli-operations`。

### 四层 Context 权威

```text
Context Source State
  → Profile selection/budget
  → Formatter-owned Model Context Projection
  → ContextManifest-owned Projection Evidence
  → Runtime Input Delivery binding + accepted ACK
```

Context Source State 是 CampMessage、Attachment、CampMember、Task 和 Memory 等领域真源。模型 DTO
只含隐私过滤后对当前行动有用的字段；ContextManifest 冻结 source refs/digests、选择、顺序、截断、
遗漏和 exact Dynamic Context bytes/digest；Runtime Input Delivery 单独绑定 Manifest、Run epoch、Binding
generation 与投递版本。只有 accepted ACK 推进水位，Message Delivery/AgentRun 创建、transport send、
failure 或 `delivery_unknown` 都不能替代它。各层不得通过复制完整对象或复用同名 digest 合并权威。

### Self Identity 与 Peer Routing Identity

Bootstrap v3 按固定顺序组装 Session Charter、`MEMBER_IDENTITY` 和 Memory Entrypoint。Charter
文案变化不参与 Native Binding compatibility digest，也不主动轮换已存在的 Native Session；既有
Run 与 Bootstrap Evidence 不回写，新建 Native Session 使用当前内置 Charter。
`MEMBER_IDENTITY` 是该 Native Session 唯一的 self identity，包含最新已提交的完整六字段；它只在
既有 eligible Bootstrap boundary 原子读取，不进入 AgentRun Dynamic Context，不持久化 Identity
Blob、snapshot、digest 或 history。身份编辑不轮换 Session，也不构造下一 Run 的 patch。

Context Formatter v14 的 `COLLABORATION_STATE` schema v2 只描述 peers。Core 从 stable current
CampMembers 中排除 `snapshot.agent_id`；away 和 leave-requested 关系保留到正式 `left`。每个 peer
只含 Agent ID、Name、Team Role 和 Professional Responsibilities；Default Lead 只以
`defaultLeadAgentId` 和派生的 `selfIsDefaultLead` 表达。调用资格仍在 BuiltinToolRouter/Domain
Service admission 时按当前 membership、Presence、Runtime、Capability、quota 与 fence 重判。

Core 先构建完整 v2 projection，再计算 `collaboration_state_digest`。ContextManifest v12 无论本轮是否
渲染 section 都冻结该完整 digest，并以 `collaborationStateIncluded` 单独记录 inclusion。只有 Runtime
Input accepted ACK 才把 `conversation.native_collaboration_state_digest` 推进到 Delivery 冻结的完整
digest；failure、`delivery_unknown` 和未 accepted 输入不推进。因此 self identity 编辑和其他不改变
模型投影的内部变化不会形成重复 Collaboration State 或部分 self update。

### Self Active Task Projection

Profile v3 对目标 Agent 当前 Camp 中自己负责的 active Task 按 `updatedAt DESC, taskId DESC` 选择最多
八项。Formatter v14 在 `COLLABORATION_STATE` 后、`SHARED_CONVERSATION` 前独立输出 compact
`SELF_ACTIVE_TASKS`，每项只有 `taskId/title/status`。真实 candidate 空集合必须输出
`{"tasks":[]}`，以覆盖同一 Native Session 的旧责任认知；只有候选存在但 Runtime payload budget
将所有 Task entry 淘汰时才省略整个 section。Default Lead 不获得其他成员 Task 的隐式 projection。
公共历史先为 Runtime budget 让位，随后从 Task tail 移除，并以 aggregate `omittedCount` 说明
selection/budget omission。

ContextManifest v12 冻结 inclusion、有序 `taskId/version/updatedAt` references、optional omission count
与 exact projection digest；真实空集合为 `included:true`、空 refs 与 empty projection digest，预算
全量淘汰为 `included:false`、空 refs 与 positive omission count。A2A preflight 和 direct
materialization 使用同一 selector。该 Evidence 不创建 freshness watermark、delta 或 ACK，恢复只
复用冻结 bytes。完整共享面板通过 Camp-wide `task list/get` 按需读取，所有 mutation 继续读取 live
Task 并由 Core 重授权。

### Context compaction redelivery accounting

Runtime Adapter 可以把受支持的 Runtime 原生 compaction signal 规范化为当前 Native Binding 的
Bootstrap Redelivery Requirement，但 Adapter process memory 不拥有待补发真源。Core 按 Binding
generation 持久维护 requested/acknowledged revision；Delivery Gate 把所选 requested revision 冻结到
Runtime Input Delivery，只有该输入的 accepted ACK 才推进 acknowledged revision。

因此发送失败、`delivery_unknown` 与 Core restart 不会清除补发要求；Gate 选择后到达的新 signal
也不会被旧输入的 ACK 覆盖。旧 Binding、旧 generation、旧 Host route 或 fenced execution 的迟到
callback 必须 fail closed。Runtime detector 矩阵、signal completion 语义和补发 payload 格式由各自
长期决策与 Runtime compatibility evidence 维护，不能由 Adapter 自行改变这套 ACK 边界。

Runtime 环境开关与 Requirement 属于不同生命周期：前者由 Rovai 版本维护并在 Core process 启动
时冻结，只控制新 compaction observation 的准入；后者属于一个 Binding generation，不能被后续
disable 清除。首次 `disabled -> best_effort` 对既有可复用 Binding 幂等创建一次 Requirement，不轮换
Native Session。完整语义见 [ADR-0139](../adr/0139-version-owned-bootstrap-redelivery-runtime-policy.md)。
各 Runtime 只使用一个版本限定的 signal admission point；新 Requirement 能否进入当前输入以
`RuntimeInputDelivery.prepared` 事务为截止，而非 transport send。具体见
[ADR-0140](../adr/0140-runtime-specific-compaction-signal-admission-point.md)。
ContextManifest 与 Runtime Input Delivery 必须在一个 serialized Core preparation critical section
中冻结 redelivery selection 和 combined budget；实现可以使用 unsendable staging Manifest，但在
Delivery `prepared` 前不能释放数据库权威或把 payload 交给 transport。完整 identity-bearing overlay
保持瞬时，不进入 Manifest 或持久 digest。见
[ADR-0141](../adr/0141-atomic-bootstrap-redelivery-input-overlay.md)。Redelivery v2 的 reason marker、单句
Core recovery authority 与 Envelope/Formatter version 见
[ADR-0147](../adr/0147-lossless-model-context-projection-and-layered-delivery-evidence.md)；它不改变这里的
transient overlay、Delivery Evidence 或 accepted-ACK 边界。
Runtime compaction callback 使用独立、窄权限且跨 AgentRun 的 Native Session Observer Lease；它不
延长 Built-in Tool/Run lease。普通 Host 退出不创建 Requirement，只有具体 observation 的提交结果
未知才允许一次保守 pending。见
[ADR-0142](../adr/0142-native-session-scoped-compaction-observer-lease.md)。
六个目标 Runtime 的 detector 是 `best_effort` enhancement：与 Host 启动并行建立，失败或恢复不
参与 Runtime Readiness/AgentRun admission，也不触发 one-shot fallback 或 gap 推断。既有 pending
仍由 Delivery Gate 处理。见
[ADR-0143](../adr/0143-best-effort-non-blocking-compaction-detector-capability.md)。

## Built-in CLI 与外部 MCP

```text
Rovai-owned operations ── rovai CLI ── Core Router
user-configured MCP    ── Runtime-native MCP Projection
```

两条路径不共享 catalog、授权、receipt、生命周期或代理层。外部 MCP 继续由 Library、Assignment、
Projection 和 Exposure Snapshot 管理；built-in operations 永不进入 `McpProjectionInput`、
Runtime MCP config 或 MCP runtime-name mapping。`rovai_team` 没有保留语义，同名外部 Server 只是
普通第三方 MCP。

## Activity、Evidence 与故障边界

Core 为每次已验证调用创建 canonical Built-in Tool Activity。若 Runtime Shell Evidence 与
request/receipt 有显式可验证关联，它作为同一 Activity 的 supporting Evidence；否则保留为独立
Activity。命令文本、时间、cwd 或输出相似度不能建立关联。Shell 子进程共享当前 Run 身份，但
系统不声称能够证明模型主观意图。

- CLI 参数或输入来源错误：Agent stdout 使用 `builtin_tool.invalid_input` + `fix_input`，退出码
  `2`；其他 IPC/lease/catalog preflight 失败使用安全通用 structured error，退出码 `2`；
- Core 业务拒绝：完整 Envelope 记录在 Core/Evidence，Agent stdout 输出业务 `error`，退出码 `1`；
- 响应丢失：CLI 对同一 request identity 有界重试，Core 执行 Replay；Projection 不暴露 request
  identity；
- 无法证明 mutation 结果：Agent 只收到无 request identity 的 `builtin_tool.outcome_indeterminate`，
  退出码 `3`，必须先确认当前状态；
- `camp.message.send` 的内部 Camp 不变量失败：fail closed，不加入稳定 Agent error contract；
- external MCP 失败：遵循其独立 non-blocking degradation，不回退为 built-in MCP；
- 任一正式 Runtime 未通过 v5 command、projection、replay、fence 和 negative-path 验收：版本不
  得完成。
