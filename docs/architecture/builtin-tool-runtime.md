---
document_type: architecture
architecture: builtin-tool-runtime
authority: builtin-tool-component-boundaries
status: accepted
last_updated: 2026-08-27
---

# Built-in Tool Runtime Architecture

本文件说明 Rovai built-in operations 的长期组件结构。当前字段与版本以
[Built-in Tool Transport v20](../contracts/builtin-tool-transport-v20.md)、
[Built-in Tool Agent Output Projection v1](../contracts/builtin-tool-agent-output-projection-v1.md)、
[Camp History Retrieval v4](../contracts/camp-history-v4.md)、
[Durable Task v3](../contracts/durable-task-v3.md) 和
[Camp Message Send v13](../contracts/camp-message-send-v13.md)、
[Gather v4](../contracts/gather-v4.md)、
[Current User Attention v4](../contracts/current-user-attention-v4.md)与
[Missing-Send Recovery Publication v2](../contracts/missing-send-recovery-publication-v2.md) 为准；v19 及更早 Transport 只保留
historical 语义。决策理由见
[Built-in 运输不变量](foundational-invariants.md#skills-builtin-transport)、
[Built-in 运输不变量](foundational-invariants.md#skills-builtin-transport)、
[Built-in 运输不变量](foundational-invariants.md#skills-builtin-transport)、
[Built-in 运输不变量](foundational-invariants.md#skills-builtin-transport)、
[History 与寻址不变量](foundational-invariants.md#collaboration-history-addressing)、
[Durable Task 不变量](foundational-invariants.md#collaboration-task)与
[Durable Task 不变量](foundational-invariants.md#collaboration-task)。Native Session context
compaction 后的 Bootstrap 补发可靠性见
[Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)，版本拥有的 Runtime policy 与
完整矩阵见 [Native Session Bootstrap Redelivery](native-session-bootstrap-redelivery.md)。Self/peer
identity、Collaboration Projection 与输入水位见
[成员投影不变量](foundational-invariants.md#member-projection)和
[Collaboration State v2](../contracts/collaboration-state-v2.md)。模型投影、ContextManifest Evidence、
Runtime Input Delivery Evidence 与 Profile/Formatter/Manifest 权责见
[ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)；whole-history
omission 的 bounded aggregate 边界见
[公共上下文不变量](foundational-invariants.md#context-public-history)和
[ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)、
[ContextManifest Evidence v22](../contracts/context-manifest-evidence-v22.md)及
[Run Facts v2](../contracts/run-facts-v2.md)。Task authority 与
self-active awareness 见
[ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)；真实空集合
的显式 clearing snapshot 见
[ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)。
Send 的显式 caller return 与 Core-managed reply reference 见
[Message Delivery 不变量](foundational-invariants.md#collaboration-delivery)；显式 Agent 寻址意图硬门与
Principal audience 投影分别见 [History 与寻址不变量](foundational-invariants.md#collaboration-history-addressing)和
[公共上下文不变量](foundational-invariants.md#context-public-history)。
当前 Camp 显示名 inline alias 的事务内解析与 canonical freeze 见
[History 与寻址不变量](foundational-invariants.md#collaboration-history-addressing)，line-leading position
门禁见 [History 与寻址不变量](foundational-invariants.md#collaboration-history-addressing)。
Current User Attention 与 progressive CLI teaching 分别见
[Message Delivery 不变量](foundational-invariants.md#collaboration-delivery)和
[Built-in 运输不变量](foundational-invariants.md#skills-builtin-transport)；完整十三项 official Skill inventory、Agent 主导队员创建、
Runtime 对齐的 Camp 协作 Skill、四项固定 GitHub 来源与 management policy 见
[Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)。
Memory 单命令的局部 Transport 决策见
[Built-in 运输不变量](foundational-invariants.md#skills-builtin-transport)，独立 Hearth Review 与 actor-bounded mutation
组合见 [Online Memory Capture](online-memory-capture.md)。Complete exact-Scope View 与 copyable target
合同见 [Memory 读取与投影不变量](foundational-invariants.md#memory-read-projection)。

## 总体路径

```text
Agent Runtime
    │ fixed business command + process-scoped CLI context
    ▼
bundled `rovai` CLI
    │ authenticated local IPC v2
    │ Unix Socket | Windows Named Pipe
    ▼
Core BuiltinToolRouter
    │ current Run / lease / Native Binding
    ├── Public Camp Message / Message Delivery service
    ├── Collaboration / Task service
    ├── Camp History service
    ├── Memory Retrieval / Mutation service
    └── Member Profile service + narrow managed-avatar importer
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

每次 Agent 业务 operation 都必须匹配 current Run、lease、Native Binding 与 Run 冻结的 exact active Camp
membership version；这一统一 Router fence 覆盖整个 catalog，而不是只覆盖 send。terminal evidence 通过独立窄
路径结算既有 Run/Delivery/Gather，不因此获得业务 operation 或 public publication 权限。

## 权威与边界

| 组件 | 拥有的权威 | 不是 |
| --- | --- | --- |
| Built-in Tool Catalog | canonical names、输入/结果 schema、`agentOutputSchema`、projection identity、错误合同、CLI mapping、digest | Agent-facing discovery API |
| `rovai` CLI | 输入来源解析、`camp.read` 默认补全、canonical Schema 校验、IPC、完整 Envelope validation、显式 projection、stdout/exit/stderr 安全边界、有限运输重试 | 领域 handler、授权者、receipt 生成者、通用字段删除器 |
| BuiltinToolRouter | current lease 解析、operation 分发、完整 Envelope、receipt、Replay、Activity | 第二套 Message/Delivery 服务 |
| Domain Services / Gateway | 可见范围、版本、状态、配额、幂等副作用和业务不变量 | CLI 或 MCP 适配层 |
| Runtime Fleet | process ownership、exclusive Run lease、reuse、fence、quiescence | Camp 选择或业务 catalog |
| Runtime Adapter | 启动/恢复 Runtime、注入 CLI 环境、Bootstrap、外部 MCP Projection | built-in schema、alias、Agent discovery |
| Bootstrap / Charter | 固定命令、使用原则、帮助入口和安全恢复原则 | 完整 schema、Envelope、catalog digest、凭据、Camp ID |
| Evidence / Qualification / host debug | 完整 Envelope、receipt、request identity 和诊断证据 | Agent 日常 stdout |

Local IPC 的外部 seam 只有 `LocalIpcEndpoint` 与异步 byte stream。macOS Adapter 使用 Unix Socket；Windows
Adapter 使用在创建时带 protected DACL、拒绝 remote client 的 Named Pipe。Raw `SECURITY_ATTRIBUTES`、listener
补位与 Pipe instance 生命周期只存在于 Windows transport implementation；Router、Catalog、receipt 和 replay
不感知端点类型。OS ACL 永不替代 process/lease token。

## Catalog 与 Agent command

Core 只维护一份 catalog。它服务 IPC 校验、合同测试、Qualification、Evidence/receipt 验证和
开发诊断；catalog 中的 `agentOutputSchema`、Envelope schema、error contract 和 projection
identity 不构成 Agent discovery 协议。

Agent Runtime 没有 `rovai tool list`、`rovai tool describe`、隐藏 discovery、`tool invoke` 或
`tool call`。Agent 只使用十五个固定业务命令：

```text
rovai send
rovai gather
rovai member create
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory view|search|read|write
```

`rovai gather` 只在当前 Default Lead 需要向多个成员派发同一共享主题、并在所有责任终态后统一继续时
使用。它由持久 Gather Barrier 产生一条普通 FIFO Completion Delivery；成员仍用正常公开 send 返回，
精确 return capture 不会逐条物化 Lead Run。成员的最后一条 current-generation return 是结果权威；每个
Item/generation 最多捕获 16 条且不消耗普通 A2A ledger。组件边界见[持久 Gather Barrier](durable-gather-barrier.md)。

Agent 在 operation 不清楚时使用 `rovai --help`，在本次 invocation 所需 syntax 不清楚时查询所选
operation 的精确 `--help`，并尽量复用当前 Native Session 已有的 help。根 `send` 使用
`rovai send --help`；分组命令必须包含 action，例如 `rovai task create --help`。不存在
`rovai task|camp|memory --help` 教学别名。Help 只列必要 flags、输入来源互斥规则、关键约束
和短示例，不输出完整 JSON Schema、Envelope、receipt 或 catalog。Dotted canonical operation
仍是 Core 内部语义身份，不能直接变成通用 Agent 命令。

当 canonical input Schema 是清晰的 top-level discriminated `oneOf` 时，exact help 从各 branch 读取
requiredness、const/enum、type、minimum/maximum、长度与 field scope，并按 Schema branch 顺序分组；
只有定义和 requiredness 在所有 branch 完全一致的字段才进入 Common options。Flattened arguments 仍只
负责识别全部合法 direct flag、field mapping、基本类型和任意参数顺序，不能作为 union requiredness 或
字段作用域权威。不清晰的 union 回退 ordinary flat help，不猜 discriminator。

Camp History exact help 保持三段职责：目标未知时用 `history.search` 跨授权历史 Camp 发现；目标已知时
用 `camp.search --camp-id` 搜索一个 Camp；获得稳定消息 ID 后用 `camp.read --camp-id` 读取。Search/Read
省略 `--camp-id` 时只解析当前 Camp，显式当前 ID 与省略等价，不会扩张为全历史或按 message ID 反查。

`camp.read` exact help 还必须忠实展示 CLI 与 canonical Schema 的分层：CLI 省略 mode 时使用
`timeline + before + limit 20`，Timeline direction/limit 可由调用者显式覆盖，cursor 不设默认；Core Schema
仍要求完整 canonical mode 和对应 direction。`item`、`around`、`thread` 都是显式 message-anchored 选择，
CLI 不根据 `messageId` 或其他 branch 字段猜测 mode。

`rovai send --help` 的基础示例分别演示 `--public-only`、Agent-only 与
`--public-only --to-principal`。`--to-principal` 的精确字段帮助拥有“新产生且未解决的 Principal 决定、
回答或行动”正向条件、常规负向场景、消息局部不继承、无 Agent Delivery 与不代表批准；旧
`--to-user` 只在 CLI 参数归一化层作为不可发现 alias。

Send exact help 公开 line-leading display-name alias：它必须是 logical line 的首个非空白 token，并在完整
显示名后跟 whitespace/EOF；trailing handoff 使用专门 final line。`--to` 仍只接受 canonical ID，稳定自动化
优先使用 `agent_N`。`--public-only` 在任何 alias/member lookup 前绕过正文寻址，并与显式 `to/taskId`
原子冲突；`agentAddressingMode` 表达 caller intent，`effectiveRecipients/deliveryIds` 表达实际结果。
Parser 和 alias map 属于 Domain Service；
CLI、Runtime Adapter、Bootstrap 与 Skill 都不重写正文。该 teaching/schema 继续进入当前 catalog digest。
当前 v20 contract/CLI command version、`builtin_cli.transport.v20` capability 与 IPC protocol 2 必须同时进入
Binding compatibility 和 digest。Camp History 使用 v4；Native Binding context contract 加入内部
`sessionCharterRevision: 2`，使旧 Charter Binding 不可兼容恢复。Bootstrap v3/Formatter 3 不变；动态 Context
继续使用 Formatter 21 / ContextManifest 21。v20 Context 不做 endpoint 猜测并 fail closed。

`ROVAI_RUN_TMP` 是 Runtime Host 启动时继承的稳定精确路径，不是 process root、Camp workspace 或附件存储。
每次新 lease 在 active context 写入前 fail-closed 清空并重建该目录；unbind/fence 只做 best-effort 清理，后继
bind 必须再次成功重置。Codex `runtimeWorkspaceRoots`、Claude/Antigravity `--add-dir`、ACP
`additionalDirectories` 与 Copilot Host 参数都显式加入这一 exact root，不加入其父目录。Runtime 只能把当前
lease 生成的临时输出交给 `--file`，authentication 与 freeze 继续绑定 process、lease generation、Run、epoch
和 exact Run tmp identity。

Send v12 的 `body` 缺省为空字符串，`files` 缺省为空数组；领域服务要求 trim 后正文非空或至少一个文件。
因此 `rovai send --file <path>` 是完整命令，不生成占位正文。Schema/default 只负责 transport shape，跨字段
payload 门禁仍在 Domain Service。

`member.create` 只接受 attested active、direct user-triggered AgentRun。Agent 依照 `member-studio` 展示完整
名牌并取得用户确认，可选地把当前 Run 中 Core 可读的 PNG/JPEG 路径交给 CLI；Core 在领域提交前完成
有界解码、轻量方形粗裁和 managed asset 发布。临时路径只存在于调用输入，不进入 Command payload、
canonical result 或 Evidence；这条 narrow importer 与 Renderer 上传继续写出相同的 avatar manifest v1，
但不形成通用文件导入或 Main↔Core bridge。

## Agent Result Projection

完整 Envelope 经过验证后，CLI 按 operation 显式选择 projection：

| Operation | Projection |
| --- | --- |
| `camp.message.send` | `{messageId, agentAddressingMode, effectiveRecipients, deliveryIds}` |
| `member.create` | `{agentId, version, avatarRef, avatarStatus}` |
| `team.create_task` | `{taskId, title, status, assigneeAgentId, version, availableActions}` |
| `team.get_task` | 完整 `TaskDetail` |
| `team.update_task` | `{taskId, title, status, assigneeAgentId, version, changed, availableActions}` |
| `team.list_tasks` | 紧凑 `TaskListPage` |
| `memory.view` | complete exact-Scope canonical result；不分页、不截断 |
| `memory.write` | `{outcome: effective, memoryId, revisionId} \| {outcome: review_pending, reviewItemId}` |
| 其余七项 | 去除 Envelope wrapper 后的 canonical result |

`memory.view` item 与 authorized current/revised `memory.read` 的 canonical result 包含同一个 indivisible
`target(memoryId, revisionId, complete Agent-relative Scope identity)`。Agent revise 原样复制 target；CLI 只
传输，不推断、拆分或改写。Body-free stale/unavailable Read result 不含 target。`memory.search` 保留 flat
Scope discovery metadata，不承担 complete exact-Scope duplicate judgment。

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

如果 Core 已完成 operation 且完整 Envelope 已验证，但显式 Agent projection 或其 closed Schema 失败，CLI
不得把它伪装成 Camp 授权失败或普通 `builtin_tool.cli_error`。它只向 stdout 输出闭合的
`builtin_tool.output_contract_mismatch`、`recovery=stop` 和 canonical operation；完整 error chain 仅写入
受管 Run 临时目录的私有 local diagnostic。该分支不改变 receipt、Replay 或
`builtin_tool.outcome_indeterminate / confirm_outcome`。

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

带 `files` 的 Send 将一次 invocation 分成短授权、锁外 Authority freeze、短重授权/commit 三段。第一段只做
request replay 与 exact lease/run/epoch/run-tmp 认证；随后释放全局 invocation guard 和 Database mutex，在
blocking work 中执行 no-follow copy/hash/fsync；最后重取 guard/Database 并验证同一身份后提交统一 publication
aggregate。重放不重新读源，身份漂移只清理本 operation 尚未拥有的 Authority 节点。该分段是 Send adapter 的
内部实现，不扩大 generic Router interface，也不把路径或 projection 状态加入 Agent output。

推导。首次调用将它写入内部 `CampMessageSendCommand.camp_id`；持久 Replay 读取已记录的
`camp_id + source AgentRun + executionEpoch`，不重新使用当前活跃身份。Camp History service 为
`camp.search` 和 `camp.read` 共用一个 single-target resolver：省略或显式当前 Camp 使用 current sequence
boundary；其他 Camp 必须同时通过 ContextManifest snapshot 与 live membership/profile authorization，并使用
冻结 global public boundary。`history.search` 保持独立 multi-Camp discovery；任何 message ID 都不授予范围。

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

Kiro 的 additive MCP Host 配置按 AgentRun 冻结，且 ACP process 在存活期间持有 Native Session lock，
因此 Kiro Host 不进入 IdleWarm。Adapter 必须在 AgentRun terminal 对 successor 可见前停止并回收旧
Host；后继 Run 由新 Host 通过 `session/load` 续接持久 Native Session。停止 Host 不能清除 compatible
Native Session binding。

TRAE 不具有 Kiro 的 Host 排除条件。兼容 Host 在 Run 完成且进程静默后进入 IdleWarm；
后继 Run 获取它时先轮换 lease，再直接复用该 Host 已持有的 Native Session。冷 Host 优先使用
ACP `session/resume`；当前构建未声明 resume，exact-ID Provider Resume Probe 也不合格，因此进入受控
`session/load` HistoryRestore。Host 在 load 前以 `LoadingReplay` 独占精确 Session route，成功 response 后才
进入 Ready 并发送当前 prompt；所有 replay 在 Evidence、Action/Approval、Usage、Missing-Send、Renderer
和最终输出之前隔离，并受事件/字节/时间上限约束。恢复失败先持久记录 continuity lost、停止 Host、轮换
Binding，再以 `session/new` 继续。每次重新绑定仍要满足 Runtime/解析后 MCP Server 集合/cwd/权限 compatibility
digest；只含 AgentRun ID 的投影文件 digest 不是 Host 输入。旧 lease、旧 Prompt
与迟到 Session event 在任何 Evidence、Action 或 Renderer 副作用前 fail closed。

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

OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen 与 TRAE 共用 ACP Host 输入确认。Core 创建
prepared Delivery 并发送 `session/prompt` 后，stdin write/flush 只表示 transport send，不立即 ACK。
Host 把 Delivery identity 绑定到当前 Session 的唯一 active prompt；ACP v1 的普通
`session/update` 和 `session/request_permission` 只含 Session ID，无法单独证明它们属于当前输入，
因此不再报告早期 accepted evidence。

匹配 JSON-RPC request ID 的成功 `session/prompt` response 产生 `InputAccepted`。匹配 error response 到达前，
若同一个 fenced active Prompt 已观察到非 metadata assistant、Tool、permission 或其他 Prompt activity，则输入
同样产生 `InputAccepted`，error 只结算 AgentRun failure，不能把已经处理的输入降级为未接收或开放重放；
没有任何当前 Prompt activity 的 matching error 才产生 `InputNotAccepted`。activity 本身仍不产生早期 ACK。
Host 在 response 前丢失时继续进入既有 runtime-loss / `delivery_unknown` 对账，不能以 pipe flush 抑制恢复。
历史 load replay 仅能在 `LoadingReplay` route 中被丢弃，不能进入该 ACK 边界。字段级合同见
[Runtime Launch and Verification v27](../contracts/runtime-launch-and-verification-v27.md)。

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
[Runtime Catalog 与 Installation 不变量](foundational-invariants.md#runtime-catalog-installation)。

## Bootstrap 与 Dynamic Context

> 当前 compact history、Charter 与 Run Facts 边界由 ADR-0200 和 v0.94 实现；历史 v0.50 的完整
> continuation/Run Notice shape 不再是当前合同。

Session Charter 只说明：

- CLI contract 标题固定为 `Rovai Built-in CLI Contract`，不显示应用 release/version；
- 使用 bundled `rovai`；
- 本地 `rovai` CLI 中的完整固定业务命令 catalog；operation 不清楚时使用根帮助，本次 invocation 所需
  syntax 不清楚时查询具体 operation 的精确 `--help`，尽量复用当前 Native Session 已有 help，且不假设 family help；
- `camp.message.send` 使用当前 Run Camp，不能传入 Camp ID；
- 对 `explicit_send_only` Runtime，narration/final response 只是私有执行证据；当前责任需要在 Camp
  公开 answer/result/status/summary 时必须在结束前调用 `rovai send`，只有成功 send 才发布该回复；
- `rovai send` 永远发布一条公开 CampMessage；必须不唤醒 Agent 时使用 `--public-only`，只有当前消息产生
  新的未解决 Principal 决定、回答或行动，或履行其明确要求的重要结果通知时才使用 `--to-principal`；
- Agent addressing 不是 CC；acknowledgement、agreement、thanks、closure、standby、no-new-information、
  repeated conclusion 或 courtesy reply 不得创建新 Agent routing；
- Core 可能在 successful zero-send 且 Adapter final boundary 可靠时执行 Missing-Send Recovery，但它不
  保证完整最终结论公开，也不应被 Agent 当作省略 `rovai send` 的正常路径；
- Task responsibility definition belongs to the User or current Camp Default Lead；
- Public Message、Message Delivery、Memory 和 read 工具保持各自稳定业务原则；
- Core 在每次 invocation 重做授权，任何模型可见 ID/fact 都不是 authorization token；
- Dynamic Context 可能截断或省略：`SHARED_CONVERSATION.campId` 适用于全部投影消息，截断消息只以
  Unicode-scalar `nextBodyOffset` 对齐 `camp.read item.bodyOffset`；遗漏 sequence envelope 可有空洞且
  不可执行；公共 A2A 继续遵循 Profile v4 的 bounded reference closure、self-authored recent filter 与 self-active Task selection；
- `RUN_FACTS` 字段化表达冻结 Task reference、Session continuity、external effect、Gather member 与
  delegation budget；命令特定教学不回填 Charter。

Charter 不承载 Task 创建克制、字段权限、Camp-wide read、local planning/A2A、wake/send、Memory
治理或 polling 操作指导。普通 flags 属于精确 operation help；命令族选择、message→Task、多操作协调
与复杂 recovery 属于窄触发 `cli-operations` official Skill；Memory 治理属于
`memory-stewardship`。特别是
`task create --help` 面向 User/Default Lead 说明只持久化跨 Run/交接的独立责任，并优先推进已有
Task；Core 不做语义去重。

Bootstrap 不含完整 Schema、Envelope、receipt、catalog digest、socket、process token、lease、
AgentRun ID、epoch、Camp ID 或 Native Binding ID。完整 operation/input 对象仍是 Executable Retrieval
Locator；Shared Conversation 的 compact offset 则与同一对象内的顶层 Camp 和 message ID 组合，且只在
实际调用时成为输入。遗漏 envelope 不伪装成 tool input，也不重复 transport 细节。

`cli-operations` 和 `memory-stewardship` 都沿用 official Skill Library，但 management policy 为
`system_required`：Core 始终保持 enabled 与九个 Runtime Group Assignment，拒绝相关修改命令，并在
bundled install 时修复旧配置漂移；Renderer Settings 不展示这两个非配置项。Skill Exposure 只证明
Runtime-native discovery 可见，不证明模型读取正文，也不授予命令、文件、网络或协作权限。普通单一
send/`--public-only`/`--to-principal`/list/get/search/read 不要求加载 `cli-operations`。

`diagnosing-bugs`、`tdd` 与 `writing-for-agents` 同样使用 ordinary official delivery，但以
`mattpocock/skills@84fdeffd12f2ee307994d1eb6feb48173b6e0502` 的完整选定目录、MIT license 与 NOTICE
离线打包。Core 不在 build、install 或运行时解析浮动 GitHub 状态；Renderer 的“GitHub”只表示固定
上游来源，不把它们变成用户 Imported Skill，也不赋予诊断、测试 seam、文档写入或实现权威。

`campfire` 是无外部上游的 Rovai original official Skill，并使用 ordinary `user_managed` delivery。
只有用户直接请求当前 Default Lead 才能开始新讨论；普通成员不会代为启动或把用户请求发送给 Lead。
第一轮以一次 Gather 邀请 2–3 位成员独立作答，只有一个会改变结论的关键分歧可以触发一次邀请 1–2 人的
定向回应 Gather。成员回传保持公开，但精确绑定当前 Item/Run/retry generation 的最后一条 captured return
不会逐条唤醒 Lead；所有 Item 终态后，Completion Delivery 才按原 initiator Conversation FIFO 物化一次
continuation。原发起者失去 Default Lead 身份后仍完成本场纪要，但不得再创建第二轮 Gather。自然阶段标题
不是 Core protocol，`### 篝火纪要` 不触发续跑，也不产生 Task、Memory、ADR 或实施副作用。

`grill-duo`、`grill-duo-with-docs` 与 `review-duo` 同样使用 ordinary `user_managed` delivery。自然标题只
提供公屏阅读线索；Skill 进入后使用可信 Current Input sender、显式 Agent recipient 和 reference closure
中的真实 reply relation。Agent 不提供或选择 reply ID，Core 始终把新消息链接到当前 AgentRun trigger。
两个 Grill 按 [Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)使用 Skill-owned 有界开放轮次：
每轮包含 1–4 个前提已确认且彼此独立的问题，一条初始 A2A 邀请和一条固定搭档直接回复覆盖全轮；未回答题
保留稳定编号与建议，改变的问题单独重新复核，当前轮关闭前不混入新题。它们不接入 Gather，也不创建 Core
持久轮次。普通版排除领域词汇/ADR 维护；文档版把完整执行协议保留在自己的 `SKILL.md`，immutable Revision
只额外携带 domain-modeling、glossary 和 ADR references。面向搭档或用户的当前响应都只在 `rovai send`
返回 accepted 后结束；accepted 不代表接收方开始或完成。三个 CLI 动作只在各 Skill 的“消息方式”章节
定义一次，其它阶段只说明本轮内容与推进条件，不复制命令示例。

Review Duo 按 [Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)使用正常 Camp 会话中的
四消息拓扑：Lead 向固定搭档发送 Standards 请求，public-only 保存独立 Spec 结果；搭档直接返回一条
Standards 结果后，Lead public-only 发布有界最终报告。四条消息携带相同的不可变 Git 或 patch 评审范围，
Lead 只接受可信当前搭档对当前有效请求的直接回复，并且同一 Lead 在一个 Camp 中一次只推进一场未完成评审。
该 Skill 不使用 Gather，不建立 review key、request-message locator、completion locator、parts、manifest 或
Core 持久评审对象，也不承诺会话上下文全部丢失后的确定性恢复或 exactly-once 发布。

每个轴最多八条 finding，每个字段保持一至两句，完整轴结果目标约 2,000–2,500 个中文字符；超出时标记
partial 并建议缩小范围。最终报告只列每轴状态、数量、最多三条重要问题和覆盖限制，不重复两轴全文。
public-only 结果必须没有 effective Agent recipient，定向消息必须只产生预期可信收件人；意外 recipient 的
消息不能推进评审。`review-duo` 是带原则级 MIT attribution、但无 vendored upstream 的 Rovai original
Skill；五文件 bundle 只接受双方可解析的 Git-object-backed SHA 范围或用户已提供的稳定共享 patch。

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
文案变化由 Bootstrap Evidence 的精确 bytes/digest 证明，不单独创建 Bootstrap v4。v0.94 同时改变
AgentRun Formatter/Manifest binding contract，并由 Migration 89 clean break 全部旧 Binding/Session 技术
状态，因此 replacement Session 原子获得新 Charter；既有 Evidence 不回写。
v1.23 不修改 Bootstrap wrapper、Formatter 或数据库，而是在 Native Binding context contract 中加入
`sessionCharterRevision: 2`；该字段只进入每个 Adapter 的 Binding compatibility digest，使新 Run 轮换旧
Native Session 并投递完整新 Charter，历史 Bootstrap Evidence 保留原 bytes/digest。
`MEMBER_IDENTITY` 是该 Native Session 唯一的 self identity，包含最新已提交的完整六字段；它只在
既有 eligible Bootstrap boundary 原子读取，不进入 AgentRun Dynamic Context，不持久化 Identity
Blob、snapshot、digest 或 history。身份编辑不轮换 Session，也不构造下一 Run 的 patch。

Context Formatter v21 的 `COLLABORATION_STATE` schema v2 只描述 peers。Core 从 stable current
CampMembers 中排除 `snapshot.agent_id`；away 和 leave-requested 关系保留到正式 `left`。每个 peer
只含 Agent ID、Name、Team Role 和 Professional Responsibilities；Default Lead 只以
`defaultLeadAgentId` 和派生的 `selfIsDefaultLead` 表达。调用资格仍在 BuiltinToolRouter/Domain
Service admission 时按当前 membership、Presence、Runtime、Capability、quota 与 fence 重判。

Core 先构建完整 v2 projection，再计算 `collaboration_state_digest`。ContextManifest v20 无论本轮是否
渲染 section 都冻结该完整 digest，并以 `collaborationStateIncluded` 单独记录 inclusion。只有 Runtime
Input accepted ACK 才把 `conversation.native_collaboration_state_digest` 推进到 Delivery 冻结的完整
digest；failure、`delivery_unknown` 和未 accepted 输入不推进。因此 self identity 编辑和其他不改变
模型投影的内部变化不会形成重复 Collaboration State 或部分 self update。

### Self Active Task Projection

Profile v4 对目标 Agent 当前 Camp 中自己负责的 active Task 按 `updatedAt DESC, taskId DESC` 选择最多
八项。Formatter v21 在 `COLLABORATION_STATE` 后、`SHARED_CONVERSATION` 前独立输出 compact
`SELF_ACTIVE_TASKS`，每项只有 `taskId/title/status`。真实 candidate 空集合必须输出
`{"tasks":[]}`，以覆盖同一 Native Session 的旧责任认知；只有候选存在但 Runtime payload budget
将所有 Task entry 淘汰时才省略整个 section。Default Lead 不获得其他成员 Task 的隐式 projection。
公共历史先为 Runtime budget 让位，随后从 Task tail 移除，并以 aggregate `omittedCount` 说明
selection/budget omission。

ContextManifest v20 冻结 inclusion、有序 `taskId/version/updatedAt` references、optional omission count
与 exact projection digest；真实空集合为 `included:true`、空 refs 与 empty projection digest，预算
全量淘汰为 `included:false`、空 refs 与 positive omission count。A2A preflight 和 direct
materialization 使用同一 selector。该 Evidence 不创建 freshness watermark、delta 或 ACK，恢复只
复用冻结 bytes。完整共享面板通过 Camp-wide `task list/get` 按需读取，所有 mutation 继续读取 live
Task 并由 Core 重授权。

### Shared Conversation 与 Run Facts

Formatter v21 按 `COLLABORATION_STATE? → SELF_ACTIVE_TASKS? → SHARED_CONVERSATION? → RUN_FACTS →
A2A_GUIDANCE? → CURRENT_INPUT` 输出，`CURRENT_INPUT` 始终完整且最后。只有 ordinary A2A
`public_a2a/dispatch/forward|return` 注入固定 edge-specific guidance；direct、Gather Completion 与 capture
不注入。Shared Conversation 顶层 `campId` 必须等于冻结
Run Camp，origin/reference/recent 三类消息不得跨 Camp。单消息保留 identity/reply/attachment/body，
`mentionsCurrentUser` 仅在完整 Structured Content 为 true 时出现；即使 mention 位于截断 prefix 之外也
不能丢失。截断只投影 `nextBodyOffset`，omitted aggregate 只投影 count 与最小/最大 sequence envelope。

同一 Structured `CurrentUserMention(local_user)` 在 Human/FTS 投影为 `@你`，在 Agent Current Input、Shared
Conversation、reference closure、Camp History 和 Gather v4 投影为 `@Principal`；content digest 不变，Agent
offset/digest 只在 `agent_v1` 空间计算。Recent selector 在 top-15 前排除目标 Agent 自己发布的消息，且
whole-history omission 使用同一 eligible set；自身消息仍可作为必要 reference ancestor。ContextManifest v20 冻结该 audience、真实 Camp/source refs、完整
body length、truncation/offset、source/projected digests、A2A guidance closed evidence、attachment identity/digest
和 omission evidence。所有 attachment path 由 PublishedAttachmentPathResolver 解析到当前 Camp View；Manifest
另存完整 catalog/root/generation receipt。Run Facts v2 的 mandatory `campResources` 始终公开当前 Camp exact
read-only enumerable root，其余单项缺失时省略字段；Manifest 独立保存 typed refs、exact compact JSON text 与 digest。Gather fallback 只承认当前 target
Run/active retry generation 在无 captured return 时的 successful Runtime final output；delegation budget 中
的 captured-return `false` 不代表其他 admission 已获授权。

Direct user Current Input 可按 [Current Input Skill Links v1](../contracts/current-input-skill-links-v1.md)增加
optional sibling `skills[{name,path}]`。Picker identity、per-Run send snapshot、start-time desired state 与
verified Exposure 由 Core resolver 组合；正文和附件不变，零 entry 省略字段。ContextManifest v20 保存
完整 included/omitted resolution 与 exact bytes；Runtime Adapter 仍只发送既有完整 payload，不解释 Skill
或创建 Provider-specific input item。

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
Native Session。完整语义见 [Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)。
各 Runtime 只使用一个版本限定的 signal admission point；新 Requirement 能否进入当前输入以
`RuntimeInputDelivery.prepared` 事务为截止，而非 transport send。具体见
[Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)。
ContextManifest 与 Runtime Input Delivery 必须在一个 serialized Core preparation critical section
中冻结 redelivery selection 和 combined budget；实现可以使用 unsendable staging Manifest，但在
Delivery `prepared` 前不能释放数据库权威或把 payload 交给 transport。完整 identity-bearing overlay
保持瞬时，不进入 Manifest 或持久 digest。见
[Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)。Redelivery v2 的 reason marker、单句
Core recovery authority 与 Envelope/Formatter version 见
[ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)；它不改变这里的
transient overlay、Delivery Evidence 或 accepted-ACK 边界。
Runtime compaction callback 使用独立、窄权限且跨 AgentRun 的 Native Session Observer Lease；它不
延长 Built-in Tool/Run lease。普通 Host 退出不创建 Requirement，只有具体 observation 的提交结果
未知才允许一次保守 pending。见
[Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)。
六个目标 Runtime 的 detector 是 `best_effort` enhancement：与 Host 启动并行建立，失败或恢复不
参与 Runtime Readiness/AgentRun admission，也不触发 one-shot fallback 或 gap 推断。既有 pending
仍由 Delivery Gate 处理。见
[Session 与 Bootstrap 不变量](foundational-invariants.md#context-session-bootstrap)。

## Built-in CLI 与外部 MCP

```text
Rovai-owned operations ── rovai CLI ── Core Router
user-configured MCP    ── Runtime-native MCP Projection
```

两条路径不共享 catalog、授权、receipt、生命周期或代理层。外部 MCP 继续由 Library、Assignment、
Projection 和 Exposure Snapshot 管理；built-in operations 永不进入 `McpProjectionInput`、
Runtime MCP config 或 MCP runtime-name mapping。`rovai_team` 没有保留语义，同名外部 Server 只是
普通第三方 MCP。新建 MCP Library 为空，Rovai-ai 不物化或恢复任何产品内置第三方 Server；定义只
来自用户手动添加或确认导入。见
[外部 MCP 不变量](foundational-invariants.md#skills-external-mcp)。

## Activity、Evidence 与故障边界

Core 为每次已验证调用创建 canonical Built-in Tool Activity。若 Runtime Shell Evidence 与
request/receipt 有显式可验证关联，它作为同一 Activity 的 supporting Evidence；否则保留为独立
Activity。命令文本、时间、cwd 或输出相似度不能建立关联。Shell 子进程共享当前 Run 身份，但
系统不声称能够证明模型主观意图。

- CLI 先从 direct flags、JSON stdin/heredoc 或 `--input-file` 三种互斥来源构造一个对象。仅 `camp.read`
  在这个汇合点把省略 mode 补为 Timeline，并补齐省略的 `direction=before` 与 `limit=20`；随后所有来源
  共用 catalog canonical input Schema validator，只有通过后才加载 lease/context 并发送 IPC。Core 因此只
  接收完整 canonical input，不感知输入来源或默认补全。其他 operation 不添加 enum 同义词、业务默认值
  或 cursor 纠正，Core 继续保留权威校验；
- CLI 参数或输入来源错误：Agent stdout 使用 `builtin_tool.invalid_input` + `fix_input`，退出码
  `2`。Schema failure 最多返回 4 条确定性字段 issue，顺序为 missing required、当前 mode 不允许、
  enum/const、type、numeric bounds、string/array bounds；合法 mode 只解释选中 branch。Issue 只含
  operation、mode、field/flag、reason、合法值/边界/valid modes，不含用户正文、input-file path、Schema
  path、Rust error、IPC endpoint、lease 或凭据；其他 parse、IPC/lease/catalog preflight 失败继续使用安全
  通用 structured error，退出码 `2`；
- Core 业务拒绝：完整 Envelope 记录在 Core/Evidence，Agent stdout 输出业务 `error`，退出码 `1`；
- 响应丢失：CLI 对同一 request identity 有界重试，Core 执行 Replay；Projection 不暴露 request
  identity；
- 无法证明 mutation 结果：Agent 只收到无 request identity 的 `builtin_tool.outcome_indeterminate`，
  退出码 `3`，必须先确认当前状态；
- `camp.message.send` 的内部 Camp 不变量失败：fail closed，不加入稳定 Agent error contract；
- external MCP 失败：遵循其独立 non-blocking degradation，不回退为 built-in MCP；
- macOS 每个正式 Runtime、以及 Windows 每个 `qualified` Runtime 未通过 v20 command、projection、replay、
  fence 和 negative-path 验收：对应平台版本不得完成。未准入 Windows Runtime 不进入 AgentRun。
