---
document_type: version-architecture
version: v0.21
lifecycle: current
authority: version-design
last_updated: 2026-07-29
---

# Rovai-ai v0.21 架构设计

> 状态：架构已冻结；实现状态以实施计划和代码证据为准
>
> 版本范围：[README.md](README.md)
>
> 当前相关有效决策：
> [ADR-0049](../../adr/0049-reproducible-context-delivery-v2.md) ·
> [ADR-0050](../../adr/0050-camp-shared-progressive-summaries.md) ·
> [ADR-0051](../../adr/0051-boundary-capped-context-retrieval.md) ·
> [ADR-0052](../../adr/0052-explicit-memory-revision-authority.md) ·
> [ADR-0063](../../adr/0063-minimal-a2a-turn-envelope-and-reply-correlation.md) ·
> [ADR-0064](../../adr/0064-default-on-bounded-automatic-partner-memory.md)
>
> 当前 v0.21 决策：
> [ADR-0067](../../adr/0067-native-session-bootstrap-and-agentrun-context-v3.md) ·
> [ADR-0068](../../adr/0068-brokered-memory-retrieval-and-session-entrypoint.md) ·
> [ADR-0069](../../adr/0069-single-effective-memory-and-scope-bounded-agent-mutation.md) ·
> [ADR-0070](../../adr/0070-normalized-sqlite-memory-store-v2.md)

## 1. 已确认的版本边界

v0.21 将上下文投递合同与 Memory 正式读取入口作为一次原子切换交付。原因是删除
`Memory Guide` 后必须存在可鉴权、可审计且不依赖物理路径的替代入口；只删除旧入口会让
已支持的 Memory 能力退化。

本次切换允许同时调整 Memory 容量，但容量政策与 Session Entrypoint 注入预算是两个
独立约束：

| 约束 | 已确认上限 |
|---|---:|
| Active Hearth Memory | 32 |
| 单 Agent Active Companion Memory | 32 |
| 单无序 Pair Active Relationship Memory | 12 |
| 单 Agent 适用的全部 Active Relationship Memory | 48 |

`MemoryRevision` 不增加 Active Memory 条数。产品尚未发布，本版直接替换 Memory
目标 schema 和容量合同，不迁移、回填或兼容旧 Memory 数据；开发数据库允许重建，
因此不存在超限旧 Scope 的保留、自动收缩或特殊准入状态。

同一未发布边界适用于旧 ContextManifest/Native Binding 的执行恢复：v0.21 不保留
Formatter v3 活动恢复分支。开发数据库可以整体重建；若 Migration 保留无关的只读历史，
也必须让不兼容的旧 Binding 与非终态输入不可 Resume，而不是翻译成新载荷。

Active Memory Scope Capacity 只计算条数，不设置 Scope 聚合字节上限。每条
Memory Body 仍不得超过 2,048 UTF-8 bytes；Entrypoint、`memory.search` 和
`memory.read` 分别使用自己的条数与响应字节预算。这样表中的条数上限是真实可达上限，
不会被一个更低的隐含正文总量提前截断。

## 2. 当前实现基线

- `ContextService` 当前按 AgentRun 创建不可变 ContextManifest，Formatter 版本为 3。
- 当前载荷包含 Session Charter、Turn Envelope、Collaboration State、Control Signals、
  Shared Conversation Updates、Context Briefing、Work Brief、Task Context、
  Current Input 和每 Run Memory Guide。
- Codex CLI 与 Claude Code 可通过 Runtime 原生能力在新 Native Session 注入 Charter；
  ACP 与 Antigravity 只能把 Charter 放入首次 AgentRun payload。
- Agent Memory 当前只有 `memory.propose_change`，不存在 Agent 可调用的
  `memory.search` 或 `memory.read`。
- 当前 Memory Projection 使用物理 Markdown 路径，且 Agent 可见内容明确区分
  `user_confirmed` 与 `provisional`。
- 当前持久条数上限为 Hearth 32、Companion 64、Relationship Pair 32；自动形成的
  provisional Companion 与 Pair 上限均为 8。
- 当前附件上下文提供 `managed-blob://` 引用，不存在讨论稿拟议的工作区文件投影。

## 3. 目标上下文模型

模型可见合同收敛为两个生命周期：

```text
Native Session Bootstrap（每个 Native Binding generation 一次）
  ├── SESSION_CHARTER
  └── MEMORY_ENTRYPOINT

AgentRun Dynamic Context（每个 AgentRun 一份不可变载荷）
  ├── COLLABORATION_STATE       条件区段
  ├── SHARED_CONVERSATION       条件区段
  ├── RUN_NOTICES               条件区段
  └── CURRENT_INPUT             必需区段
```

v0.21 删除独立的 `TURN_ENVELOPE`、`CONTROL_SIGNALS`、`CONTEXT_BRIEFING`、
`WORK_BRIEF`、`TASK_CONTEXT`、每 Run `MEMORY_GUIDE` 和载荷末尾的通用执行口号。
Core 不再总结 Objective、推断 Responsibility、生成 Deliverable 或从自然语言提炼
Constraints；原始请求、Task、团队状态、共享消息和异常运行事实各留在自己的权威来源。

目标合同版本固定为 `native_session_bootstrap_v1`、Context Formatter v4、
ContextManifest v4、Memory Team Tool v1 和 Memory Search/Read Evidence v1；这些名称
是恢复与审计判别符，不是用户可选模式。

Skills、MCP Exposure 和 Runtime Tool Schema 仍按现有投影与冻结合同提供，但不伪装成
上述模型上下文区段。

## 4. Native Session Bootstrap

### 4.1 一份逻辑 Bootstrap，两种物理投递

Bootstrap 以 Native Binding generation 为身份，而不是以 AgentRun 为身份。Core 在创建
新 Native Session 前生成唯一、不可变的 `NativeSessionBootstrapEvidence`，至少冻结：

```text
conversationId
nativeBindingId + generation
bootstrapFormatterVersion
SESSION_CHARTER blob + digest
MEMORY_ENTRYPOINT snapshot + digest
observed Memory ID + Revision ID
authorization basis
deliveryMode
createdAt
```

投递方式由已验证 Runtime 能力决定：

- `native_append`：Codex CLI、Claude Code 等通过原生 developer/system append 在 Session
  创建时注入；
- `first_payload`：ACP、Antigravity 等把相同逻辑 Bootstrap 放在该 Session 第一份
  AgentRun payload 开头。

两种方式不得产生不同语义。`first_payload` 的 Runtime Input ACK 同时确认 Bootstrap 与
首个动态载荷；`native_append` 必须先确认或可靠完成 Session 创建，之后才允许动态输入。
Bootstrap 未准备完成、投递结果未知或 Evidence 无法复核时，Run fail closed，不发送
残缺上下文。

后续 ContextManifest 只引用同一 `bootstrapEvidenceId`。同一 Binding generation 的恢复
复用原 Bootstrap 字节，不从当前 Profile 或 Memory 重新组装。

### 4.2 Session Charter

`SESSION_CHARTER` 只包含：

- Core 管理且 Companion Profile 不可覆盖的平台合同；
- Agent 名称、稳定角色及可选风格；
- Current Input、Task、共享消息、摘要、Run Notice、Memory、文件与工具结果各自的
  权威边界；
- 工具和资源在调用时由 Core 重新鉴权；
- A2A 来源 Agent 是同级请求者，以及禁止确认式空回信、循环转发和无新增信息的交接。

Charter 不包含当前 Task、成员快照、Lead、A2A sender、附件、配额、恢复状态、
Memory ID、Skill/MCP 清单、Provider 命令或普通执行流程。

Profile 身份、稳定角色、Core Contract 或会改变模型行为边界的 Profile 指令发生实质
变化时轮换 Native Session。普通消息、Task、成员可用性、Memory 新增或 Revision 更新
不重写 Charter。Memory Retire、Forget 或适用范围收缩也不轮换 Session；Entrypoint
陈旧性由实时 Memory Read 合同处理。

## 5. AgentRun Dynamic Context

### 5.1 Collaboration State

`COLLABORATION_STATE` 在新 Session 第一 Run 提供完整团队视图，之后仅在影响协作选择的
结构化状态发生变化时提供当前快照与 `changes`。每名成员最多包含：

```text
agentId
name
role
availability: available | busy | unavailable
reason?        固定枚举的用户可理解投影
```

`activeAgents`、`changes` 和当前协作确实需要时的 Lead 信息均为条件字段。删除 routing、
current_agent、其他 Agent 的 capabilities、原始 presence/runtime readiness 和含义不明的
`participating_in_current_turn`。Availability 是建议性 Read State，不是执行准入；
`team.post_message` 始终重新校验成员、Runtime、Capability、配额与 fence。

### 5.2 Shared Conversation

`SHARED_CONVERSATION` 统一承载当前 Native Session 尚未完整获得的公共历史：

```text
Summarized History
  coverage range
  injected Segment/Epoch summary bodies
  on-demand retrieval hint when older detail was not injected

New Messages
  ordered public messages not otherwise covered
```

摘要和原文范围不得重叠，也不得出现无声明缺口。摘要保留原消息的来源权威，不成为系统
指令；当前触发消息永远排除，由 `CURRENT_INPUT` 单独且完整提供。区段不包含 Sender
Activity、Task 快照、Pending Action Request、Execution Evidence、Run/Turn/Conversation
ID、Context budget、摘要生成状态或内部 Marker 字段。

### 5.3 Run Notices

`RUN_NOTICES` 只包含 ContextManifest 冻结时已经由 Core 权威状态确定、会直接改变当前
行动且能用固定模板表达的异常事实。v0.21 的闭集为：

```text
native_session_continuity_lost
workspace_state_requires_recheck
unsettled_external_effect
a2a_delegation_budget_exhausted
a2a_loop_blocked
a2a_delegation_policy_restricted
```

Notice 不包含内部 ID、计数器、剩余额度、错误码或状态机。只在作用域仍然有效时注入；
单调成立的深度/总数限制可以预告，Run 启动后才发生的并发变化由工具返回的可行动错误
负责。长期没有某项能力时直接移除工具，不用 Notice 重复声明。

Runtime 必须在 ContextManifest 物化前完成 Resume 或替代 Session 决策，才能诚实冻结
continuity Notice。未确认外部副作用只在当前 Conversation 存在可关联的 unsettled effect
且 Core 不能证明重复安全时注入；Core 不从自然语言猜测副作用。

### 5.4 Current Input

`CURRENT_INPUT` 始终包含完整触发正文，不再使用
`bodyIncludedInSharedUpdates`。普通用户 Run 只标记 `type: user`；A2A Run 使用 Core
提供的可信来源：

```text
source:
  type: a2a
  senderName: Alice
  replyTarget: source
message: |
  ...
attachments:
  - /authorized/run/attachment/path
```

不向模型暴露 sender Agent ID、InboxMessage、Run lineage、Task association、epoch 或
correlation ID。附件只给出已经授权、可由当前 Runtime 读取的 Run Attachment Projection
路径。

## 6. ContextManifest、覆盖与恢复

每个 AgentRun 继续在首次 Dispatch 前拥有唯一不可变 ContextManifest。v0.21 直接使用新
schema，删除旧 `work_brief_*`、`task_context_*`、`control_signals_json` 和
`memory_guide_*` 字段，并冻结：

```text
bootstrapEvidenceId
nativeBindingGeneration
Camp/Conversation message boundary
raw message references
injected Camp summary IDs
internal coverage baseline（如有）
Collaboration State digest
Run Notice event references + rendered digest
Current Input source reference
Run Attachment Projection references + digest
Skill/MCP exposure
formatterVersion
rendered payload Blob + digest
```

Context Read Marker 仍只在 Runtime 接受动态输入且 Core 持久化 ACK 后单调推进，不代表
模型已经阅读或理解。连续覆盖证明收敛为：

1. 原文进入已接受的 `SHARED_CONVERSATION`；
2. 覆盖该消息的摘要正文进入已接受的 `SHARED_CONVERSATION`；
3. 消息是当前 Binding generation 已确认产生的自身公共输出；
4. 更早连续前缀已有可检索摘要覆盖，且已接受的 `SHARED_CONVERSATION` 明确声明覆盖范围
   和 `context.search` 回读入口。

ADR-0050 的 Camp 共享两级摘要与 ADR-0051 的 Run boundary 封顶检索继续保留。变化是
原 Context Briefing 的诚实覆盖声明并入 Shared Conversation，不再保留独立模型区段。
同一 Run 未确认接受时只能字节级重发原载荷；已接受时只能 Resume；结果未知时先对账，
禁止重新组装或盲目重发。

## 7. A2A 来源别名与 Task

`team.post_message` 的目标参数改为 `recipient`，接受具体 Agent ID 或保留字
`"source"`。`source` 只在 A2A 触发 Run 中合法，由当前可信 Run→InboxMessage→sender
关联解析；第三方目标不得继承 source reply correlation。显式工具调用仍是唯一发送动作，
Core 不自动回复、不自动唤醒来源 Agent，也不把普通 final response 转成 A2A 消息。

A2A parent/root/depth、CampTurn、Task、epoch、idempotency、fence 和 reply ID 全部保留在
Core。模型省略 `inReplyToMessageId` 且目标为 source 时，Core 原子补全可信关联。

删除每 Run Task Context。Task Board 继续是独立权威实体，Agent 通过
`team.list_tasks` 获取最新可见 Task，再以返回的 ID/version 更新。Task assignment 不会
唤醒 Agent；必须立即执行的责任必须由当前用户/A2A 原文明确表达，Core 不把结构化 Task
状态二次概括成当前指令。

## 8. Run Attachment Projection

附件继续以 Managed Blob 为内容真源。Core 在 Run 输入冻结前为每个附件准备可重建、
只读、名称冲突安全的 Run Attachment Projection，并把稳定可读路径及内容 digest 冻结到
ContextManifest。模型只看到投影路径，不看到 Blob ID、原始宿主路径、对象存储地址或
签名 URL。

投影路径是 Rovai-ai 管理的 Run 级只读资源，不是 Run Workspace、sandbox root 或通用
文件权限；它也不要求位于 Git 工作树内。各 Adapter 负责在接收方自身的 Runtime 权限
模型下把该只读根变成真实可读资源；无法证明可读时执行准入失败，不退回附件正文注入或
`managed-blob://` 伪路径。投影丢失可从 Managed Blob 原子重建，同一 Run 恢复保持路径与
digest 不变；生命周期由 ContextManifest 的 Managed Blob 根引用控制。

## 9. Memory Entrypoint 与工具读取

### 9.1 正式读取边界

SQLite 继续是唯一 Memory 真源。Agent 不再看到 Projection root、Markdown 文件、
SQLite 位置或其他存储实现；现有 Markdown Projection 可以作为内部调试/导出兼容物保留，
但不再是支持的 Agent 读取协议。

`MEMORY_ENTRYPOINT` 只在 Session Bootstrap 中出现一次，使用稳定真实 Memory ID，不使用
Run/Session 短 ID。索引为 Markdown 表格：

```text
Hearth:       Memory ID | Kind | Retrieval Keys
Companion:    Memory ID | Kind | Retrieval Keys
Relationships: Counterparty | Memory ID | Kind | Retrieval Keys
```

空范围省略。持有 ID 不授予读取权限；未列入 Entrypoint 的 Memory 仍可通过
`memory.search` 发现。

### 9.2 Revision Retrieval Keys

每个可读 MemoryRevision 必须包含 1～3 个 Retrieval Keys。它们绑定 Revision，与正文
一起不可变；新 Revision 必须重新提交关键词。Agent 在同一次 `memory.write` 或
`memory.propose_hearth` 中提交正文与关键词，不为关键词额外调用模型。

```text
单个 key：2～24 UTF-8 bytes
全部 key：≤ 48 UTF-8 bytes
规范化：trim、连续空白折叠、ASCII case-fold、去重
```

Core 拒绝空泛保留词、控制字符、换行和表格分隔符。用户直接创建/修订时可以采用可编辑
建议，但没有 LLM 也必须能手工完成。

### 9.3 适用范围与容量

当前 Agent A 的支持读取集合为：

```text
全部 active Hearth
active Companion(A)
对当前 Camp 其他 present 成员 B 的：
  mutual(A, B)
  directed(A → B)
```

`directed(B → A)`、历史 Revision、Retired 和 Forgotten 不可见。
Runtime 在线状态不改变 Relationship Memory 适用范围。

Active 条数上限：

| 范围 | 上限 |
|---|---:|
| Hearth | 32 |
| Companion(A) | 32 |
| unordered Relationship pair | 12 |
| Agent A 的全部适用 Relationship | 48 |

Pair 上限同时计算 mutual、A→B 和 B→A；Agent 总上限计算 mutual 及以该 Agent 为 actor
的 directed，反向 directed 不占用该 Agent 的总额。Mutual 写入同时检查双方的适用总额，
directed 只检查 actor 的适用总额；Agent-origin 子限额使用同一适用规则。Add 与
Reactivate 检查条数；Revision、Retire 和 Forget 不增加条数。无 Scope 聚合字节上限。

Agent 直接形成的 Memory 使用独立来源子限额。来源是不可变审计与 UI 信息，不是
Revision Authority，也不改变 Active Memory 的模型效力：

| 范围 | 上限 |
|---|---:|
| Hearth | 0 |
| Companion(A) | 8 |
| unordered Relationship pair | 4 |
| Agent-origin、对 Agent A 适用的全部 Relationship | 16 |

达到来源子限额后，增加 Agent-origin Memory 的写入被明确拒绝，不产生 pending Proposal，
也不淘汰或静默丢弃既有 Memory。用户直接创建的 Memory 不占 Agent-origin 子限额；
用户后来修订 Agent-origin Memory 不改变该 Memory 的形成来源或释放条数。经用户接受的
Hearth Proposal 只占普通 Hearth 容量，不算直接 Agent-origin Memory。

### 9.4 Entrypoint 预算与排序

```text
Hearth index       ≤ 16
Companion index    ≤ 32
Relationship index ≤ 24
total              ≤ 72
```

Hearth/Companion 和 Pair 内排序固定为 Agreement → Preference → Lesson → Memory ID。
Relationship 的 24 个槽位先按结构化相关性排列 counterparty：A2A source、当前 Task 的
结构化参与者、当前 Turn active participant、Default Lead、Member Order；不从自然语言
猜测。多个 counterparty 使用确定性配额轮转，单 Pair 最多 12，未列内容仍可搜索。

### 9.5 `memory.search` 与 `memory.read`

`memory.search` 先按当前 Run/Agent/Camp/Presence/Scope 过滤，再搜索 active current
Revision。派生索引使用 SQLite FTS5 trigram + BM25，Retrieval Keys 权重 6、正文权重 1。

```text
query             ≤ 512 UTF-8 bytes
limit             ≤ 6
snippet/item      ≤ 256 UTF-8 bytes
all snippets      ≤ 2 KiB
```

结果返回 Memory ID、Kind、Retrieval Keys、短 snippet；完整正文必须再调用
`memory.read`。`memory.read` 每次最多 4 个真实 Memory ID，正文总量最多 8 KiB，并在
每次调用时重新校验 Binding、Run、epoch、Scope、Camp membership、Presence、Lifecycle
和 Current Revision。当前仍 active 且有权限的 ID 始终可以读取当前正文；如果同一
Binding generation 的 Entrypoint 或此前成功 Search/Read Evidence 记录过旧 Revision，
则返回最新 Revision 并标记 `cacheState: revision_changed`。失去资格时不返回旧正文：

```text
active + same Revision       → cacheState: current
active + newer Revision      → cacheState: revision_changed + latest Revision/body
retired                      → cacheState: inactive
forgotten                    → cacheState: deleted
Scope/Presence no longer fits→ cacheState: access_changed
unknown or unauthorized ID   → cacheState: unavailable
```

`inactive`、`deleted` 和 `access_changed` 只对当前 Binding generation 的 Entrypoint 或
此前成功 Search/Read Evidence 能证明该 Agent 先前合法读取过的 ID 返回。任意猜测 ID、
从未获得过的 ID 与未授权 ID 使用不可区分的 `unavailable`，避免存在性侧信道。Session
Charter 稳定声明：Entrypoint 是发现缓存，Retrieval Keys 本身不是可依赖的 Memory 正文；
使用前必须通过 `memory.read` 获取当前状态。

在线 FTS 只包含 active current Revision，可整层重建。Memory Search/Read Evidence 保存
查询 digest、授权范围、请求/返回 ID、Revision 和鉴权结果，不复制搜索正文或完整查询，
避免审计层成为另一份 Memory/secret 存储。

### 9.6 单一有效状态与来源透明度

v0.21 删除 `MemoryRevisionAuthority` 的 `user_confirmed | provisional` 状态机。Active
Memory 只有一个有效语义；Entrypoint、`memory.search` 和 `memory.read` 不返回 Authority，
也不存在“确认后才生效”的 Agent 推理规则。

数据库保留不可变的创建来源及每个 Revision 的 actor provenance，供 UI 显示
“Agent 形成 / 用户创建 / 最近由谁修订”和审计使用。来源不是 Authority、Lifecycle、
Scope、Kind 或模型优先级。

通用 `MemoryProposal`、policy-auto resolution 和 Memory Confirmation 退出目标领域。
Agent 对自己的 Companion 及当前可访问 Relationship 的合法 add/revise 在一个事务中直接
创建 Active Memory 或新 Current Revision；工具名为 `memory.write`，失败不留下候选正文
或待办。

Hearth 是唯一保留 Proposal 的 Scope。Agent 只能提交非有效的 Hearth Memory Proposal；
用户逐条接受或编辑后接受才创建 Active Hearth Memory/Revision，拒绝不生效。接受后的
Memory 与其他 Active Memory 没有更高 Authority，只保留“Agent 建议、用户采纳”的来源
证据。Agent 工具名为 `memory.propose_hearth`；用户可以绕过 Proposal 直接创建或修订
Hearth。两个 Agent 写工具共享每 Run 四次成功持久化的硬配额。

应用级开关重命名为 `agentMemoryWritesEnabled`，默认开启。Core 在每次 Agent 写事务中
读取最新策略；关闭后拒绝新的 `memory.write` 和 `memory.propose_hearth`，但不 Retire、
Forget 或重写既有 Memory/Hearth Proposal。冻结的 Memory Write Capability、实时全局
策略、Scope 准入和工具可见性是不同边界，任一失败都 fail closed。

Review 不再根据 Agent/用户来源产生不同语义：所有 Lesson 默认 90 天后进入建议复查，
Preference/Agreement 默认不设复查时间；Review 仍只是 Read Side 提醒，不改变效力或
Lifecycle。

### 9.7 Entrypoint 陈旧与 Session 连续性

Memory 新增不追加到已有 Entrypoint，由 `memory.search` 发现。Revision 更新、Retire、
Forget、Relationship 适用范围变化或成员 Presence 变化都不轮换 Native Session，也不
尝试从模型历史删除 Entrypoint 行。

Core 通过每次 `memory.read` 的实时鉴权和 `cacheState` 阻止旧正文回流。ContextManifest
继续引用原 Bootstrap Evidence，审计可以解释 Agent 当时见过哪个 ID/Revision；这一
历史证据不重新导入 Memory Store，不参与搜索，也不改变当前读取结果。

## 10. 文档与 ADR 切换规则

v0.21 使用四份已接受 ADR 原子替代旧语义，不直接改写历史理由：

- [ADR-0067](../../adr/0067-native-session-bootstrap-and-agentrun-context-v3.md)：
  Native Session Bootstrap 与 AgentRun Dynamic Context；整篇替代 ADR-0049、
  ADR-0063，并局部替代 ADR-0014、ADR-0058 的 Task Context 条款；
- [ADR-0068](../../adr/0068-brokered-memory-retrieval-and-session-entrypoint.md)：
  Entrypoint、Relationship 适用性、Search/Read 与缓存失效；替代 ADR-0035、
  ADR-0042；
- [ADR-0069](../../adr/0069-single-effective-memory-and-scope-bounded-agent-mutation.md)：
  单一 Active 效力、来源证据、直接 Agent 写入与 Hearth 用户确认；替代 ADR-0024、
  ADR-0025、ADR-0036～ADR-0040、ADR-0052、ADR-0064，并局部替代 ADR-0057 的旧
  Memory Capability 条款；
- [ADR-0070](../../adr/0070-normalized-sqlite-memory-store-v2.md)：
  新 Memory 表族与可重建 FTS；替代 ADR-0045。

ADR-0050 的共享摘要生成协议和 ADR-0051 的边界封顶检索原则继续有效，仅更新对旧模型
区段的引用。
