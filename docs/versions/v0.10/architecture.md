---
document_type: version-architecture
version: v0.10
lifecycle: historical
authority: version-architecture-and-protocol
last_updated: 2026-07-25
---

# Lumen AI v0.10 长期记忆架构与协议

> 状态：关键架构已实现
>
> 版本范围：[README.md](README.md)
>
> 已确认跨版本边界：
> [ADR-0019](../../adr/0019-application-global-memory-ownership.md)、
> [ADR-0021](../../adr/0021-atomic-memory-and-immutable-revisions.md)、
> [ADR-0022](../../adr/0022-immutable-memory-scope.md)、
> [ADR-0024](../../adr/0024-closed-memory-kinds.md)、
> [ADR-0025](../../adr/0025-proposal-scoped-memory-provenance.md)、
> [ADR-0026](../../adr/0026-explicit-memory-supersession.md)、
> [ADR-0027](../../adr/0027-memory-domain-forgetting.md)、
> [ADR-0029](../../adr/0029-bounded-memory-reactivation.md)、
> [ADR-0032](../../adr/0032-user-authorized-live-memory-projection.md)、
> [ADR-0033](../../adr/0033-advisory-memory-review-v2.md)、
> [ADR-0035](../../adr/0035-user-transparent-agent-applicable-relationship-memory.md)、
> [ADR-0036](../../adr/0036-agent-bounded-memory-proposal-scope.md)、
> [ADR-0037](../../adr/0037-actor-bounded-relationship-proposal-direction.md)、
> [ADR-0038](../../adr/0038-memory-proposal-staleness.md)、
> [ADR-0039](../../adr/0039-memory-proposal-capability.md)、
> [ADR-0040](../../adr/0040-terminal-memory-proposal-retention.md)、
> [ADR-0041](../../adr/0041-agent-profile-status-memory-independence.md)、
> [ADR-0042](../../adr/0042-fail-closed-memory-projection.md)、
> [ADR-0043](../../adr/0043-memory-secret-filter.md)、
> [ADR-0044](../../adr/0044-per-proposal-user-confirmation.md)、
> [ADR-0045](../../adr/0045-normalized-sqlite-memory-store.md)、
> [ADR-0046](../../adr/0046-memory-stewardship-bundled-skill.md)、
> [ADR-0047](../../adr/0047-user-initiated-memory-export-boundary.md)
>
> 相关现行约束：
> [ADR-0001](../../adr/0001-core-transaction.md)、
> [ADR-0009](../../adr/0009-reproducible-context-delivery.md)、
> [ADR-0013](../../adr/0013-managed-content-and-read-side-v2.md)、
> [ADR-0014](../../adr/0014-stable-team-tool-gateway-v2.md)、
> [ADR-0015](../../adr/0015-action-safety-v2.md)、
> [ADR-0016](../../adr/0016-multi-runtime-execution-v2.md)

## 1. 已确认的领域边界

```text
Memory Library
├── Hearth Memory
├── Companion Memory → one AgentProfile
└── Relationship Memory → unordered pair of AgentProfiles
```

Memory Library 是应用级长期状态。Camp、Project、Conversation、Native Session、
Runtime 和 repository 都不是记忆所有者。来源引用可以说明一项记忆从何而来，
但不能改变其作用域或扩大来源对象的可见权限。

这里的作用域只定义所有权边界，不代表每项记忆都会自动注入每个 AgentRun；
上下文选择与冻结协议尚待确认。

## 2. 已确认的写入权威

```text
Agent + current AgentRun/Execution Epoch
    → MemoryProposal
    → user accepts final content
    → authoritative memory change

User
    → authoritative memory change
```

MemoryProposal 是持久但非权威的建议。Agent 无论担任什么 Camp 角色、观察多少次
或给出多高置信度，都不能绕过用户确认。用户主动管理自己的 Memory Library 时
不需要先创建 Proposal。

所有正式变更都必须经 Core 的强类型命令和事务边界提交。用户接受 Proposal 时，
以用户最终看到并确认的内容为准；Proposal 保存成功本身不改变有效记忆。

记忆变化不重写已经冻结的 AgentRun prompt。活动 Run 后续按 Guide 路径读取
live Projection 时可以观察到新状态；具体边界见第 14 节。

## 3. 已确认的正式记录模型

```text
Memory
├── stable memoryId
├── currentRevisionId ──────────────┐
└── version                         │
                                    ▼
                         immutable MemoryRevision
                         ├── revisionId
                         ├── memoryId
                         └── accepted content
```

Memory 是单条原子认识的稳定身份。正式修订总是新增不可变 MemoryRevision，再以
Compare-and-Set 推进该 Memory 的 `currentRevisionId`；不原地编辑旧 Revision。

新增 Proposal 在用户接受时创建 Memory 和首个 Revision。修订 Proposal 冻结
`memoryId + baseRevisionId`。如果当前 Revision 已变化，接受必须返回陈旧冲突并
要求用户基于最新内容重新确认，不能把旧建议静默覆盖到新认识上。不同 Memory
可以独立并发确认。

按作用域组织的 `current.md` 或其他人类可读文件只投影多个 Memory 的当前
Revision。文件位置、段落顺序和整文件摘要不定义 Memory 身份，也不作为反向写入
入口。具体投影协议仍待确认。

## 4. 已确认的作用域变更

Memory Scope 是创建时固定的所有权与最大可见边界：

```text
hearth
companion(agentProfileId)
relationship(minAgentProfileId, maxAgentProfileId)
```

Revision 不能修改 Scope。任何提升、收窄或 Relationship 成员替换都创建一个新
Memory 和首个 Revision。新 Memory 可以记录指向来源 Memory/Revision 的稳定
派生引用，但必须按目标作用域重新执行内容与可见性校验。

来源 Memory 默认保持原状态。用户可以在同一权威操作中另外选择改变其生命周期，
但“创建目标 Memory”和“终结来源 Memory”是两个明确事实，不能因复制或派生而
自动合并。具体生命周期状态机仍待确认。

## 5. 已确认的 Relationship Direction

Relationship Scope 的 pair 是无序的所有权边界；Direction 是另一个创建时
固定的 Agent 适用性属性：

```text
mutual
    member A ↔ member B

directed
    actorAgentProfileId → counterpartyAgentProfileId
```

`mutual` 对双方行为适用并进入双方的受支持读取视图。`directed(A → B)` 只进入
A 与 B 协作时的读取视图，不会要求 B 执行 A 的义务，也不向 B 提供正式读取或
搜索入口。完整无序 pair 只由用户通过 Memory 管理 Read Side 查看和治理。

mutual/directed 转换或反转 actor/counterparty 会创建新 Memory，不能由 Revision
原地修改。AgentRun 的默认 Relationship Projection 按适用方过滤，见第 15 节。
Direction 不得被用来规避内容规则：人格标签、能力评分和秘密观察档案依然禁止。

## 6. 已确认的 Memory Kind

Memory Kind 是创建时固定的语义身份：

| Kind | 精确定义 | Hearth | Companion | Relationship |
|---|---|---:|---:|---:|
| `preference` | 用户稳定选择 | 允许 | 允许 | 禁止 |
| `agreement` | 面向未来的协作规则 | 允许 | 允许 | 允许 |
| `lesson` | 从真实经历提炼的可复用行动经验 | 允许 | 允许 | 允许 |

Kind 不能由 MemoryRevision 修改。重新分类使用新 Memory，并遵守 Scope 派生与来源
Memory 生命周期的独立处理规则。

v0.10 不建立通用 Fact、人格标签、能力评分、行为画像或观察档案。Task、
AgentRun、Approval、当前计划、TODO 和 Conversation Summary 继续由各自领域拥有；
密钥、Token 和认证资料不能成为 Memory。

## 7. 已确认的 Proposal 溯源

MemoryProposal 保存提案来源，而 MemoryRevision 不复制三层来源包：

```text
MemoryProposal
├── proposedByAgentProfileId
├── proposedAt
├── sourceAgentRunId
├── sourceExecutionEpoch
└── sourceCampId

MemoryRevision
└── createdFromProposalId? + createdAt
```

Gateway 从当前 Native Binding、唯一活动 AgentRun 和 Execution Epoch 推导来源；
模型工具参数不接受这些身份字段。Proposal 属于应用级 Memory Library，
`sourceCampId` 与 `sourceAgentRunId` 是弱稳定审计引用，不把 Proposal 变成
Camp-owned record，也不在 Camp 删除时级联抹掉。

用户直接写入不创建 Proposal。用户 Actor、命令身份和时间继续由 ADR-0001 的
`event_log` 审计，不新增 Origin、Evidence 或 Acceptance 领域对象。Proposal
来源元数据只进入管理和审计 Read Side，不进入 Agent 可读 Memory Projection。

## 8. 已确认的生命周期与 Supersession 边界

```text
Memory.lifecycleStatus
    active | retired | forgotten

MemorySupersession
    predecessorMemoryId → successorMemoryId
```

只有 active Memory 可以进入 Agent 可读 Projection 和未来搜索。Retired Memory
停止沿用，但继续保留内容与 Revision 历史。Forgotten 的内容清除强度与残留
tombstone 尚待确认。

Supersession 是用户确认的 Memory 间关系。建立关系时在同一命令中 retire
predecessor，并保存 successor ID。普通 Revision 只推进同一 Memory 的内容，
不会创建 Supersession。Scope、Kind、Direction 变化或合并等产生新 Memory 时，
用户可以明确建立替代边。

## 9. 已确认的 Forget 边界

Forget 是不可恢复的 Memory Library 内容清除：

```text
clear:
    MemoryRevision readable content
    accepted MemoryProposal readable content
    search / Agent-readable Memory Projection / export

retain:
    minimal Memory tombstone
    opaque Proposal proposer/time/Camp/Run provenance
    redacted permanent command result and request digest

out of scope:
    original CampMessage / Task / Commit / Action
    content already read into a completed Native Session
    upstream Native Session history
    OS snapshots and user-controlled backups
```

Forget 不能被解释成 retire 或可恢复 archive。实现不得把 Memory 或 Proposal 明文
写入永久 `event_log`；命令结果只保留 ID、状态和必要摘要。Runtime 历史可能
继续保留某次 AgentRun 主动读取后的正文，但该内容不能被重新导入、搜索或用于
新的 Projection。

本版本只承诺 Lumen Memory Domain 的不可恢复清除，不承诺对 SQLite 介质、外部
Runtime 或用户备份进行法律级取证擦除。

## 10. 已确认的时间与 Review 模型

MemoryRevision 在用户命令提交时立即创建，`createdAt` 同时承担确认时间，不重复
保存 `acceptedAt`。它不重写已冻结 prompt，但活动 AgentRun 稍后读取 live
Projection 时可以观察到新内容。

v0.10 不支持 `validFrom` 或 `validUntil`。具有预定开始或结束时间的要求仍留在
当前输入、Task 或其他协作领域，不通过时钟自动切换长期记忆。

Memory 可以保存可选 `reviewAfter`：

```text
lesson      → create/revise 后默认 +90 days
preference  → default null
agreement   → default null
```

用户可以手动安排 Review。`now >= reviewAfter` 只产生“建议复核”的 Read Side
状态，不修改 Lifecycle、Revision 或 Context 资格。继续沿用、重新安排、修订、
retire 和 forget 都使用各自的显式用户命令。

## 11. 已确认的 Retire 状态机

```text
active ⇄ retired
active → forgotten
retired → forgotten

retired + outgoing Supersession ⇏ active
forgotten ⇏ any state
```

手动 retired Memory 可以由用户显式重新启用。因为内容、Scope、Kind 和 Direction
均未改变，重新启用不创建 MemoryRevision，只更新 Memory version 并追加审计。

具有 outgoing MemorySupersession 的 predecessor 不能直接回到 active，即使其
successor 后来 retired 或 forgotten。用户若要恢复旧内容，必须从旧 Revision
创建新的 Memory；历史替代边保持不可变。Review due 不阻止重新启用，也不会被
该命令自动清除。

## 12. 已确认的 Proposal 生命周期

```text
pending → accepted
        → rejected
```

Accepted 和 rejected 都是终态，不能重新打开。用户在当前会话中选择“忽略”只
关闭提示，不执行领域命令；Proposal 保持 pending，仍可在记忆管理页处理。

修订 Proposal 的 `baseRevisionId` 与当前 Revision 不一致时，Read Side 派生
`stale` 条件，但 Proposal status 不变。用户必须基于最新 Revision 重新确认，
不能让 stale 成为第四种持久状态。Proposal 不参与 AgentRun 的等待或完成门。

## 13. 已确认的持久化真源与 live Projection

```text
SQLite authoritative state
├── Memory
├── MemoryRevision + short text
├── MemoryProposal + short text
├── MemorySupersession
└── projection observation / diagnostics
           │
           └── post-commit reconcile
                    ↓
              Memory Projection
              private live Markdown
```

Memory 领域的结构化状态和 2 KiB 级短正文直接保存在现有 SQLite；不为它们引入
Managed Blob，也不建立文件型第二真源。所有写入通过 DomainCommandGateway，
在同一 SQLite 事务中完成状态、容量、幂等结果和脱敏审计。

Markdown 是 Lumen 私有 userData 中的确定性只读投影。它不进入 project 或 Git，
不被反向解析。缺失、formatter/schema 过旧、损坏或内容摘要与 SQLite 不一致时，
由 projector 原子重建。Context formatter 可以向 Agent 暴露经过 Scope 选择的
精确文件路径，供 Runtime 原生文件工具按需读取。

ADR-0001 禁止在 SQLite 事务内执行文件 I/O，因此权威提交后只发送可丢失 Wake；
projection observation 和稳定扫描负责恢复。投影失败不回滚已确认 Memory，
但必须留下用户可见诊断。用户管理 Read Side 的结构化查询始终读取 SQLite；
v0.10 不暴露 Agent `memory.search`，Agent 原生文件工具只读取当时的 live
Markdown。

## 14. 已确认的 Memory Guide 与按需读取

Context formatter 增加独立区段：

```text
TURN_ENVELOPE
COLLABORATION_STATE
CONTROL_SIGNALS
SHARED_CONVERSATION_UPDATES
MEMORY_GUIDE
WORK_BRIEF
TASK_CONTEXT
CURRENT_INPUT
```

Memory Guide 只包含用途、较低权威说明、建议读取时机，以及当前 Agent 可用的
Memory Projection 精确文件或目录路径。它不内联 Memory 正文，也不是 Provider
System Prompt、Session Charter、Capability、Approval、当前 Task 或 repository
事实。动态信息冲突时按以下顺序解释：

```text
CURRENT_INPUT
→ WORK_BRIEF / TASK_CONTEXT / Core permission / current repository state
→ current collaboration messages / Control Signals
→ files read through MEMORY_GUIDE
```

ContextManifest 冻结 Guide 文本、暴露的文件或目录根路径、formatter version 和
物化时观察到的 Projection digest，不冻结文件正文或目录子文件列表，也不证明
Agent 实际读取。Lumen 不创建 per-Run Memory 文件副本；活动 Run 晚些时候读取
同一路径时可以看到 revise、retire、supersede 或 forget 后的新 Projection。

这类文件读取属于 Runtime tool-time observation，不属于 ADR-0009 冻结的 Lumen
prompt。Runtime 无可靠文件读取工具或权限时明确报告不可用，不回退为正文注入。
Lumen 只提供当前 Scope 允许的路径；对拥有宽泛本机文件权限的 Agent，防止其主动
遍历其他 userData 文件依赖 Adapter 原生文件权限，而不是 Core ACL。

## 15. 已确认的 Agent 专属 Relationship Projection

对于 Camp C 中当前 Agent A，Memory Guide 的记忆位置保持为固定规模：

```text
Hearth Projection file
Companion(A) Projection file
Relationship Projection Directory(C, A)/
    ├── view for member B → mutual(A, B) + directed(A → B)
    ├── view for member D → mutual(A, D) + directed(A → D)
    └── ...
```

Guide 只提供 A 专属 Relationship Projection Directory 的根路径与说明，不按
Camp 成员逐一列出子文件。A 可以用 Runtime 原生目录和文件读取工具自行判断何时
查看哪位伙伴的协作认识。该目录不自动加入与当前 Camp 无共同成员关系的 pair。

对成员 B 的文件只包含 active `mutual(A, B)` 与 active
`directed(A → B)`；`directed(B → A)` 不适用于 A 的行为，因此不进入该文件。
完整无序 pair 只由用户管理视图展示。v0.10 不提供 `memory.search` 或其他
Agent 结构化读取工具，因此 A 没有受支持的反向内容读取入口。

目录是 SQLite 状态的 live 派生视图，不是 per-Run copy。Memory Guide 和
ContextManifest 冻结目录根路径，不把子文件清单写入 prompt 或冻结为 Run
快照。物理目录命名、空文件表现、目录摘要及原子恢复协议仍由后续投影协议确定。

## 16. 已确认的 Projected Memory Entry

Agent 可读 Markdown 中的每条 active Memory 采用最小逻辑字段集：

```text
memoryId
revisionId
kind
direction?   # only Relationship
body
```

Scope 由 Hearth、Companion 或 Relationship 投影位置表达，不在每条重复。
Lifecycle 也不渲染，因为 Agent 投影只包含 active Memory。Relationship 文件中的
`direction` 仍保留，使 Agent 能区分 mutual 与自己的 directed 约定。

`revisionId` 指向该条目渲染时的当前不可变 MemoryRevision。Agent 发起 revise
Proposal 时必须把它作为 `baseRevisionId` 回传，Gateway 再与权威
`currentRevisionId` 比较；文件读取后发生的并发修订不能被旧提案静默覆盖。

Proposal provenance、`proposedAt`、Revision `createdAt`、`reviewAfter`、
Supersession、Lifecycle 和其他管理审计字段不进入 Agent Projection。Markdown 的
具体标记语法、文件头和 digest 表达仍属于待确认的物理投影协议。

## 17. 已确认的 Agent Proposal 操作边界

Agent-facing Team Gateway 只暴露：

```text
memory.propose_change(action = add)
memory.propose_change(action = revise)
```

add Proposal 只描述一条候选新 Memory。revise Proposal 必须引用
`memoryId + baseRevisionId`，只描述同一 Memory 的候选新 Revision；它不能改变
创建时固定的 Scope、Kind 或 Relationship Direction。

Agent 不能通过工具提议 retire、reactivate、forget 或 supersede，也不能在
add/revise 接受事务中附带这些生命周期副作用。即使 add 看似替代现有 Memory，
接受也只创建新 Memory；旧 Memory 保持原状态，直到用户另行执行明确的管理命令。

用户管理界面可以直接提交 Lifecycle 和 Supersession 权威命令，不创建
MemoryProposal。具体 `memory.propose_change` JSON Schema、Capability、限流和
幂等错误仍待后续确认。

## 18. 已确认的 Agent Proposal 目标边界

Gateway 根据当前 fenced AgentRun 解析 Agent A 与来源 Camp C。Agent Proposal 的
目标 Scope 只能是：

```text
hearth
companion(A)
relationship(A, B)  where B is another current CampMember of C
```

add Proposal 不能替其他 Agent 创建 Companion Memory，也不能创建不包含 A 或包含
Camp 外成员的 Relationship Memory。Relationship add 的 Direction 边界见第
19 节。

revise Proposal 进一步受当前 Agent Projection 限制：目标必须是已暴露给 A 的
active Memory，并携带文件中的 `memoryId + baseRevisionId`。A 不能通过猜测
Memory ID 修订 Companion(B)、Relationship(B, C)、反向 directed Memory 或当前
Camp 外的 pair。

Gateway 不接受可覆盖 `proposedByAgentProfileId`、来源 Camp、AgentRun 或
Execution Epoch 的模型参数。它在命令处理时重新验证 Native Binding、Run fencing
与 CampMember 关系；任一边界失效就拒绝保存 Proposal。

这些限制只约束 Agent Proposal。认证用户仍可通过 Memory 管理命令在整个应用级
Library 中直接新增、修订和治理任何合法 Scope。

## 19. 已确认的 Relationship Proposal Direction

对于当前 Agent A 与当前 Camp 成员 B：

```text
allowed add Proposal:
    mutual(A, B)
    directed(A → B)

forbidden:
    directed(B → A)
```

A 可以提议双方共同遵守的 Memory，也可以提议自己在与 B 协作时承担的单向行为，
但不能替 B 设定 B 的单向义务。Gateway 将 directed actor 固定为当前
AgentProfile A；模型只选择 mutual/directed 并提供经验证的 counterparty，不传入
可伪造的 actor ID。

mutual Proposal 不需要 B 增加第二次 Agent 确认。Proposal 仍不具权威，只有用户
接受后才创建正式 Memory 并进入 A、B 双方的适用投影。用户也可以绕过 Proposal
直接创建任何合法 Direction。

revise 不改变 Direction，只能基于 A 已读到的 mutual 或 `directed(A → B)`
MemoryRevision 提议新正文。

## 20. 已确认的 add Proposal 输入

`memory.propose_change` 的 add 模型参数采用 camelCase 扁平对象：

```json
{
  "action": "add",
  "scope": "hearth | companion | relationship",
  "kind": "preference | agreement | lesson",
  "body": "candidate atomic memory",
  "counterpartyAgentId": "relationship only",
  "direction": "relationship only: mutual | directed"
}
```

基础必填字段是 `action + scope + kind + body`。当且仅当
`scope = relationship` 时，`counterpartyAgentId + direction` 必填；其他 Scope
携带这两个字段必须失败。Relationship 只允许 Agreement/Lesson，其他 Kind/Scope
组合按第 6 节校验。

Companion target 隐式为当前 Agent A。Relationship counterparty 必须是当前 Camp
的另一位当前成员；若 direction 为 directed，actor 隐式为 A。模型不能提供
Companion target、directed actor 或任何 proposer/source 身份字段。

Schema 使用 `additionalProperties: false`，但不依赖根级 `oneOf`/`anyOf`；现有
Claude Code Adapter 会丢弃使用这类根联合的 MCP Tool。字段间条件由 Core 再校验，
保证所有 Adapter 具有相同语义。

`proposedByAgentProfileId`、Camp、AgentRun、Execution Epoch、`proposedAt` 和
Runtime tool-call 幂等事实均由 Gateway 推导。add 不接受 `reviewAfter`、理由、
证据、actor 或 model-owned idempotency key。正文长度上限仍随容量协议确认。

## 21. 已确认的 revise Proposal 输入

revise 使用同一个扁平 Tool，但模型参数严格为：

```json
{
  "action": "revise",
  "memoryId": "mem_...",
  "baseRevisionId": "mrev_...",
  "body": "complete candidate replacement"
}
```

`memoryId + baseRevisionId` 必须来自 Projected Memory Entry。Gateway 读取权威
Memory，验证目标 active、当前 Agent 可提议、Revision 属于该 Memory，并在
Proposal 中冻结 base。Scope、Kind、Direction、Companion target 和 Relationship
成员不由模型重复提交，也不能借 revise 改变。

`body` 始终是整条原子认识的完整候选正文。v0.10 不支持 text diff、JSON Patch、
部分字段合并或由 Gateway 猜测省略内容；用户接受后创建完整不可变
MemoryRevision。

与 add 相同，schema 使用 `additionalProperties: false`，proposer、Camp、Run、
Epoch、时间和 Runtime tool-call 幂等事实由 Gateway 推导。创建 Proposal 时
`baseRevisionId` 的并发处理见第 22 节。

## 22. 已确认的 revise Proposal 陈旧协议

revise Proposal 有两个明确的并发时点：

```text
tool submission transaction:
    baseRevisionId != currentRevisionId
        → reject conflict
        → persist no Proposal

after a pending Proposal was saved:
    baseRevisionId later != currentRevisionId
        → status remains pending
        → Read Side derives stale = true
        → acceptance forbidden
```

创建事务必须同时验证 Memory active、目标对当前 Agent 可提议、base Revision 属于
该 Memory 且仍为 current。失败调用不产生“出生即 stale”的持久 Proposal。

后来变成 stale 的 Proposal 保留原始候选正文和来源审计，但不能接受、编辑后接受
或原地改写 base。用户可以将其标记 rejected；若仍希望采用建议，必须基于最新
Revision 创建一个新的 Proposal。这样 `pending | accepted | rejected` 状态机保持
封闭，stale 仍只是派生条件。

## 23. 已确认的 Memory Proposal Receipt

Tool 成功输出严格为：

```json
{
  "lumenTeamTool": "memory.propose_change",
  "lumenTeamReceipt": "Proposal saved; awaiting user confirmation.",
  "proposalId": "mprop_...",
  "status": "pending",
  "effective": false
}
```

`status` 是持久 Proposal 的领域状态，`effective = false` 明确说明这次调用未创建
或修订正式 Memory。输出不回显候选正文，也不返回 Memory/Revision ID；add 尚无
正式 ID，revise 的目标 ID 已在请求中且 current Revision 没有变化。

Gateway 继续用 Runtime tool-call identity 派生幂等键。同一次调用的相同 payload
重试返回原 `proposalId` 和等价 receipt；同一调用身份配不同 payload 返回现有
idempotency conflict。Receipt 与 Tool 描述不得声称 learned、remembered、
accepted 或 updated。

## 24. 已确认的 Memory Proposal Capability

`memory.propose_change` 同时是 Team Tool 名称和独立业务 Capability 名称。每次
调用必须满足：

```text
current fenced AgentRun
AND effective capabilities contains "memory.propose_change"
AND Proposal scope/direction/schema rules pass
```

所有 active AgentProfile 默认包含该 Capability。AgentProfile 默认配置与
CampMember override 继续按现有 effective config 规则合并；用户可以撤销。变更只
影响后来物化的 AgentRun，当前 Run 使用已冻结的 effective config。

Tool discovery、MCP 注入、Default Lead 身份、模型置信度和历史成功调用都不授予
Capability。Gateway 在命令事务中重新解析 current Run 并 fail closed。Capability
只授权持久化 `effective = false` 的 add/revise Proposal，不能接受 Proposal、
创建 MemoryRevision 或执行 Lifecycle/Supersession。

用户是 Memory Library 所有者，其 Renderer 管理命令不依赖 Agent Capability。

## 25. 已确认的 Memory Proposal Run Quota

每个 `sourceAgentRunId` 最多成功持久化四条 MemoryProposal，add 与 revise 共用
一个计数：

```text
persisted proposals from this AgentRun < 4
    → may save one Proposal

persisted proposals from this AgentRun >= 4
    → reject run quota exhausted
```

配额检查与 Proposal INSERT 必须处于同一 SQLite write transaction，使同一 Run
的并发工具调用无法各自看到剩余槽位并共同越界。Runtime tool-call 的幂等重放先
复用既有命令结果，不产生第二条 Proposal，也不消耗第二个名额。

Schema、Capability、fencing、scope、membership、stale 或容量校验失败且未持久化
Proposal 的调用不计数。Proposal 后来 accepted、rejected 或 stale 都不返还
名额；这是 AgentRun 生命周期总量，不是 pending 数量或滚动时间窗。

达到上限后 Gateway 明确返回 quota error，不把调用排队到下一个 Run。用户直接
管理 Memory Library 不受 Agent Proposal Run Quota 约束。

## 26. 已确认的 Memory Body Limit

每个候选或正式正文满足：

```text
body.trim() is not empty
AND utf8_byte_length(stored body) <= 2048
```

该不变量覆盖 Agent add/revise Proposal、用户直接 add/revise，以及用户编辑 Proposal
后接受生成的最终正文。Gateway 在事务提交前验证实际将持久化的 UTF-8 字节数。

超限时整个命令失败；Core 不截断、不自动摘要、不拆分为多个 Memory，也不把字符
数或模型 token 数误当作字节数。`memoryId`、`revisionId`、Kind、Direction 和
Markdown 投影语法不计入正文上限。

外层空白是否在持久化前规范化仍属于待确认的正文规范；无论是否规范化，计数必须
针对最终存储值。

## 27. 已确认的 Active Memory Scope Capacity

容量只约束 Agent 可用的 active 当前工作集：

```text
hearth:
    active count <= 32
    sum(current body bytes) <= 32 KiB

companion(agentProfileId):
    active count <= 64
    sum(current body bytes) <= 64 KiB

relationship(unordered pair):
    active count <= 32
    sum(current body bytes) <= 32 KiB
```

Count 与 byte budget 必须同时满足。统计只读取每个 active Memory 的 current
Revision；pending Proposal、retired Memory、forgotten tombstone、旧 Revision 与
Proposal provenance 不计入。

Proposal 保存不预留空间，因为它不生效。用户接受 add/revise、直接 add/revise 或
reactivate 时，Gateway 在权威事务中按拟提交结果重新计算目标 Scope。并发写入只能
有一个越过剩余容量。Supersession 的 predecessor retire 与 successor add 在同一
事务中按最终 active 集合校验，因此可以原子释放并使用容量。

超限返回明确 capacity error，不自动 retire、淘汰、合并、截断或摘要。用户必须
通过独立管理动作释放空间，或拒绝/修改候选内容。该配额不声称限制 SQLite 中保留
的历史总量；历史保留属于 Proposal/Revision retention 协议。

## 28. 已确认的 Memory Body 文本语义

SQLite 中的 MemoryRevision body 与 MemoryProposal candidate body 是纯 UTF-8
文本。换行可以保留，但 Markdown 和 HTML 字符没有富文本或结构语义：

```text
authoritative value = plain text
Markdown structure = projector-owned rendering
```

Projector 必须把每个正文作为字面文本确定性转义，使它不能结束当前条目、创建伪造
标题、覆盖 ID/Kind/Direction 标签或注入相邻 Memory。具体转义算法和布局由
formatter version 冻结，文件依然不反向解析。

Renderer 的管理 Read Side 同样以文本节点或安全文本控件展示和编辑，不执行正文
中的 Markdown、HTML 或脚本。URL、反引号、`#` 等可以作为普通字符存在，但不改变
领域值。

正文换行与外层空白规范见第 29 节。Markdown 投影采用 blockquote、缩进或其他
字面编码仍由后续物理投影协议确认。

## 29. 已确认的 Canonical Memory Body

每个写入入口执行相同的 canonicalization：

```text
1. replace CRLF with LF
2. replace remaining CR with LF
3. trim outer whitespace
4. reject C0 controls except TAB (U+0009) and LF (U+000A)
5. reject if empty
6. encode and persist as UTF-8
```

内部空格、TAB、换行和其他 Unicode code point 保持不变。不做 NFC、NFKC、大小写
折叠、宽窄字符折叠或语言相关转换。

规范化结果是唯一权威正文；原始提交字符串不复制进 Proposal、Revision 或
event_log。2,048-byte 单条上限、active Scope body sum、request digest、精确正文
比较和 Projection 全部基于该组持久 UTF-8 bytes。

Projector 仍负责在不改变领域正文的前提下对 Markdown 做输出编码。正文 hash 与
Projection file digest 是不同概念：前者针对 canonical body，后者覆盖完整渲染
文件及 formatter version。

## 30. 已确认的 No-op Memory Proposal

Gateway 在持久化 Agent Proposal 前执行确定性 no-op 检查：

```text
add:
    exists active Memory with identical
    (Scope, Kind, Direction?, canonical body)
        → already_exists

revise:
    candidate canonical body == target current canonical body
        → no_change
```

Relationship pair 先按无序成员规范化，Direction 仍是 identity 的一部分；
Companion target 与 Hearth Scope 使用 Gateway 已解析的权威值。只比较 active
Memory 的 current Revision；retired 内容的再利用留给后续管理协议。

No-op 调用不插入 MemoryProposal、不创建 Revision、不占每 Run 四条配额，也不在
永久 event 中复制正文。命令的幂等失败结果仍可由现有 Gateway 重放。

Core 不做 embedding、编辑距离、模型判断、大小写折叠或其他语义去重。看似相近但
字节或结构字段不同的候选继续交给用户治理；pending Proposal 之间的精确重复行为
见第 31 节。

## 31. 已确认的 Duplicate Pending MemoryProposal

Pending Proposal 使用两类精确候选键：

```text
add key =
    canonical Scope
    + Kind
    + Relationship Direction?
    + canonical body bytes

revise key =
    memoryId
    + baseRevisionId
    + canonical body bytes
```

同一候选键同时只能有一条 pending Proposal。并发保存必须在事务中确定唯一赢家；
最早持久化者保留原 `proposalId`、proposer、Camp、Run、Epoch 与 `proposedAt`。
后续调用返回 `duplicate_pending`，不插入第二条、不覆盖或聚合来源，也不占
AgentRun quota。

这不是 Runtime tool-call 幂等重放：不同调用也可能命中相同候选键。系统不为多位
提案者增加 Evidence 或 proposer list；永久事件只保留现有脱敏失败事实，不复制
候选正文。

当最早 Proposal 变成 rejected 后，pending 唯一约束释放，未来 Run 可重新提出。
若其 accepted，正式 active Memory/no-op 与 Revision CAS 规则阻止重复生效。任何
非精确语义相似仍交由用户判断。

## 32. 已确认的 Pending Proposal Retention

Pending Proposal 是用户治理队列中的持久待办，不是有 TTL 的通知：

```text
pending
    --user accepts--> accepted
    --user rejects--> rejected

elapsed time / session ignore / stale
    → no status or retention transition
```

Schema 不保存 `expiresAt`。会话级 ignore 只影响当前 Renderer 提示；Proposal 继续
出现在管理 Read Side，并继续占据 pending 精确候选键。Stale Proposal 也保留原
candidate 与 proposer/source，直到用户拒绝。

管理 UI 必须支持按 pending/stale 筛选和批量拒绝，以便用户治理积压。后台不能因
Proposal 年龄、队列数量、AgentRun 结束或 Camp 结束自动删除或拒绝。Terminal
Proposal 的长期保留规则见第 33 节。

## 33. 已确认的 Terminal Proposal Retention

Terminal Proposal 的正文保留按结果区分：

```text
accepted:
    retain original candidate body
    retain proposer/time/Camp/Run/Epoch
    link accepted Revision.createdFromProposalId
    linked Memory forget → clear candidate body

rejected:
    clear candidate body in rejection transaction
    retain proposalId + proposer/time/Camp/Run/Epoch + status
```

用户编辑后接受时，原 Proposal candidate 与最终 MemoryRevision body 可以不同；
两者分别保留，允许管理界面对照 Agent 建议和用户最终授权内容。仍不建立 Origin、
Evidence 或 Acceptance 对象，用户 Actor 与命令时间由现有 event_log 审计。

Rejected 表达用户明确不采用候选，因此拒绝事务必须清除 candidate body，不能等
TTL、后台任务或应用重启后再处理。非正文 Proposal 元数据继续保留，用于解释队列
历史和来源身份，但管理 Read Side 不再能够恢复或展示被拒绝文字。

Accepted Proposal candidate 在关联 Memory active、retired 或 superseded 后仍保留；
只有 Memory Forget 按 ADR-0027 同时清除 Revision 与 accepted candidate 正文。
Terminal 元数据不自动过期。Event、receipt、diagnostic 和永久 command result 都
不得复制 candidate body。

## 34. 已确认的 Unavailable Proposal Source

Proposal 的 `sourceCampId + sourceAgentRunId + sourceExecutionEpoch` 是弱稳定审计
引用，不是 foreign-key ownership：

```text
source resolvable and authorized
    → management UI may navigate

source missing / deleted / unreadable
    → derive sourceUnavailable
    → show frozen IDs and unavailable label
    → disable navigation
    → do not mutate Proposal
```

Camp 或 AgentRun 删除不级联 Proposal，不清除 frozen proposer/time/source IDs，也
不改变 pending/accepted/rejected。Read Side 不保存新的 source status；它按当前
对象与授权派生可用性。

Pending candidate 是用户确认的自包含对象。来源不可用不会禁止接受或拒绝，因为
v0.10 没有 Evidence 门槛。管理 UI 必须提醒用户无法复核原上下文，但最终决定仍
属于用户。

Memory Domain 不复制 CampMessage、Task、Run input、Commit 或 Action 正文作为来源
缓存，也不借 Proposal 恢复删除对象。若来源仍存在，跳转继续遵守来源领域权限；
弱引用自身不授予读取权。

## 35. 已确认的 AgentProfile Status / Memory Independence

AgentProfile status 与 Memory Lifecycle 是两个独立状态机：

```text
AgentProfile:
    active | disabled | archived

Memory:
    active | retired | forgotten

AgentProfile transition
    ⇏ Memory transition
    ⇏ Proposal transition
```

Profile disabled/archived 不级联 retire、forget、Proposal rejection 或正文清除。
与该身份绑定的 active Companion/Relationship Memory 仍计入各自 Active Scope
Capacity，用户也可继续新增、修订、retire、forget 或处理已有 Proposal。

Inactive Profile 不能产生新 AgentRun，因此没有自己的 Companion Projection。它也
不满足当前 Camp member 的 Agent 读取条件，其他 Agent 的 live Relationship
Projection Directory 不包含该成员文件。这里停止的是投影资格，不是 Memory
Lifecycle。

Profile 重新设为 active 并再次成为有效 Camp 参与者后，projector 从同一权威 active
Memory 重建适用视图，不创建 MemoryRevision、reactivate 命令或新 Proposal。
用户若确实希望停用时同时停止沿用，必须显式执行独立 Memory 管理操作。

## 36. 已确认的 Projection File Safety Limit

Projector 在 publish 前对最终 Markdown UTF-8 bytes 执行：

```text
rendered_file_bytes <= 262144
```

计数覆盖 formatter-owned header、字段标签、ID、Direction、转义后的正文、换行和
文件级元数据。Relationship Directory 没有 aggregate byte quota；每个
counterparty child file 独立受限。

超限不触发正文截断、条目抽样、分页或自动拆文件。Projector 不发布 temp/partial
结果，写入诊断并由稳定 reconciliation 重试。SQLite 中已经提交的 Memory 状态、
Scope capacity 和用户命令结果都不回滚。

在第 27 节 active body budget 下，合法文件应显著小于 256 KiB，因此该阈值是
formatter/escaping/metadata 异常的安全保险，不是常规产品容量。发布失败时旧文件
或 unavailable sentinel 的处理见第 37 节。

## 37. 已确认的 Unavailable Memory Projection

Projector 一旦确认暴露路径上的文件不再匹配权威状态，就执行 fail-closed 发布：

```text
known stale / corrupt / oversized / render failed
    → do not serve last-good as current
    → atomically publish body-free UNAVAILABLE sentinel
    → emit user-visible diagnostic
    → stable reconciliation retries

reconcile succeeds
    → atomically replace sentinel with current projection
```

Sentinel 是 projector-owned Markdown，只说明该路径的长期记忆暂不可用，可包含稳定
diagnostic code，但不得包含 Memory body、Proposal candidate、旧 ID 列表或来源
正文。Agent 必须把它解释为“不要依赖此 Scope”，而不是“当前没有记忆”。

单文件 Scope 替换该文件。Relationship Directory 的具体 sentinel 文件名和目录
原子交换方式属于物理协议，但必须确保已知 stale child 不被故意保留为兜底。

如果底层文件系统连 sentinel 替换或旧文件移除也失败，projector 记录高优先级诊断
并持续重试。此时 Lumen 不能保证物理 bytes 已消失，但不得把旧 digest 标记
current 或向新 Read Side 报告健康。SQLite 权威事务不因该文件失败回滚。

## 38. 已确认不生成 Complete-Pair Markdown

Relationship Projection 只有两个按适用方派生的 Agent 视图：

```text
view(A, B) = mutual(A, B) + directed(A → B)
view(B, A) = mutual(A, B) + directed(B → A)
```

Projector 不再生成第三个包含双方 directed 内容的 complete-pair `current.md`。
用户管理界面需要完整 pair 时直接从 SQLite Read Side 查询，保持 Direction 与
Revision 的结构化信息；这不是 Agent 可见 Projection。

完整导出若后续提供，由独立导出协议生成，不把用户审计文件混入 Runtime 路径。
这样避免重复渲染同一正文，也减少 Agent 通过相邻路径发现反向义务的默认表面积。

## 39. 已确认的 Memory Secret Filter

所有候选与正式正文采用同一个 pre-persistence 安全边界：

```text
canonical body
    → credential/secret validation
        → safe: continue normal command validation
        → secret match: reject entire command, persist no body
```

该检查覆盖 Agent add/revise Proposal、用户直接 add/revise、用户编辑 Proposal 后
accept，以及任何导入型 Memory 写入口。它必须发生在 Proposal 或 Revision INSERT
之前，并且不能因用户身份、Capability、Scope 或 Kind 绕过。

目标是凭据类秘密：密码、API/access token、私钥、认证 Header 等。错误只返回稳定
非敏感 code；event_log、receipt、diagnostic、遥测和测试快照都不得包含命中值或
片段。用户若要保存相关经验，只能写成删除 secret value 后的 Lesson。

普通个人信息仍可能构成合法 Preference、Agreement 或 Lesson。v0.10 不新增
`sensitive` Kind、风险分数、人格标签、自动隔离状态或模型判定字段；用户在确认时
查看正文与 Scope，并用 revise/retire/forget 治理。

v0.10 不引入 Memory 专用静态加密。SQLite 与 Runtime 需要直接读取的 Markdown
Projection 都以本机可读形式存在，依赖操作系统账户、磁盘保护和 Lumen 私有
`userData` 边界；本版本不承诺抵御拥有同一系统用户文件权限的其他进程。只加密
SQLite 无法覆盖 Projection，而完整加密需要新的密钥管理与解密代理架构，明确不在
本版本范围内。

Secret 检测器的具体高置信规则与测试语料属于实施安全协议，但任何版本都不能把
模型分类结果直接持久化为领域权威。

## 40. 已确认的 Memory Proposal Confirmation

Pending Proposal 的用户决策面严格为：

```text
accept as shown
edit final content → accept
reject

session ignore → no domain command
```

接受界面必须在一个稳定审阅单元中展示最终 body、Scope、Kind 和 Relationship
Direction，不只显示 Agent 摘要或差异。编辑后的最终值重新执行正文规范化、Secret
Filter、Kind/Scope、active capacity 和并发校验；MemoryRevision 只保存用户最终
确认值，Proposal 按 ADR-0040 保留 Agent 原候选。

每条接受都需要独立用户命令，不提供 select-all 或 batch accept。管理界面可以批量
reject；每条 Proposal 都进入 rejected 终态并在事务中清除 candidate body。批量
失败必须遵守现有 Core 原子命令边界，不靠 Renderer 乐观伪造状态。

Stale Proposal 的接受和编辑后接受控件禁用并显示原因。用户只能 reject，或回到
最新 Revision 形成新的候选。会话 ignore 只关闭提示，管理队列中的 pending 保持
不变。

UI 实现必须遵守现行 UI 规范（v0.10 交付时为 Hearth & Camp，已被
[Meridian 详细规范](../../ui/meridian.md)取代）：状态以文字/结构表达，表单使用可见
Label，最安全选项优先获得焦点，Dialog 支持键盘与焦点返回，Day/Night 功能等价。

## 41. 已确认的 Normalized SQLite Memory Store

Memory Domain 进入现有 `lumen.sqlite`，使用五类规范化表：

```text
memory
    stable identity, Scope/Kind/Direction, Lifecycle
    currentRevisionId, reviewAfter, version, timestamps

memory_revision
    immutable canonical body
    memoryId, createdAt, createdFromProposalId?

memory_proposal
    add/revise candidate and status
    target/base + proposer/time/Camp/Run/Epoch

memory_supersession
    immutable predecessorMemoryId → successorMemoryId

memory_projection_observation
    derived path/digest/formatter/health/diagnostic
```

`memory_projection_observation` 是恢复 Read Side，不拥有 Memory 内容。Proposal 的
source Camp/Run 使用弱 ID，不能配置会因 Camp 删除而级联 Proposal 的所有权外键。
正文直接以短 SQLite text 存储，不进入 Managed Blob。

所有权威写入继续经过 DomainCommandGateway，在一个 SQLite transaction 内提交
状态、expected version、capacity、幂等结果与脱敏 event。Memory 不通过 event
replay 重建，也不使用单行 JSON document、FTS、另一个数据库或 Markdown 反向
解析。

Migration 只为现有 schema 增量增加新表、约束和索引。v0.10 之前不存在正式
Memory，因此不读取历史 Conversation、Task、AgentRun、Skill 或项目文件推断回填
内容。具体列、CHECK、partial index 和 migration version 在实施计划中定稿，但
不得改变上述聚合边界。

## 42. 已确认的 Memory Stewardship Skill

v0.10 只新增一个 Bundled Skill：

```text
memory-stewardship
界面名称：共同记忆维护
```

它覆盖 Hearth、Companion 与 Relationship 的共同维护流程：判断候选是否值得长期
保存，按当前 Run 得到的路径阅读适用 Memory Projection，避免精确重复，选择
Scope/Kind/Direction，形成无 Secret 的原子正文，并调用
`memory.propose_change`。工具成功只意味着 Proposal 已保存，Skill 必须明确这一点。

该 Skill 复用 ADR-0017 的 Skill Library、不可变 SkillRevision、项目同名 shadow
规则与 Runtime 原生 SkillProjection。对支持 Skill 的 AgentProfile 默认启用，
用户可以关闭；实际选中的 Revision、投影与 digest 进入 ContextManifest。三个
Scope 不拆成三套 Skill，不为不同 Runtime 复制语义变体。

Skill 与 Capability 独立：启用 Skill 不授予 `memory.propose_change`，禁用 Skill
也不改变已经冻结进当前 AgentRun 的 Capability。所有 Scope、Direction、quota、
Secret Filter 和用户确认仍由 Gateway 与 Memory Domain 强制执行。

Runtime 不支持 Skill 时，Run 可继续但必须暴露降级事实。Lumen 不把 Skill 全文
塞入 System Prompt，不伪造兼容层，也不以内联 Memory 正文作为后备。

## 43. 已确认的导出与备份边界

v0.10 只新增用户主动触发的 Memory 导出，不新增 Memory 专属自动备份、后台复制
或云同步。操作系统快照、用户自行复制和未来可能存在的应用级整体备份都不属于
Memory Domain 可控制的副本。

导出器从 SQLite 权威状态读取数据，不能复制 Agent 视角的 Markdown Projection。
Projection 可能只包含某一 Agent 可见的方向、可能暂时不可用，而且本身是可丢弃
Read Side，不具备备份语义。

导出前必须明确说明：文件离开 Lumen 后不再受 Lifecycle 管理，之后执行
`forget` 只会清除 Lumen Memory Library 内的可读内容，无法召回或擦除已经导出的
副本。任何导出路径都必须排除 forgotten 正文。

具体文件格式、用户选择的 Scope/Lifecycle 范围及历史粒度在实施协议中确定，不
改变“显式触发、SQLite 生成、外部副本脱离 Forget 控制”的边界。

## 44. 实施协议移交

不会改变领域边界的细节已经移交
[implementation-plan.md](implementation-plan.md)，由实施默认值统一确定：

- Migration v21 的列、约束与索引；
- Projection v1 的私有目录、formatter、目录 digest、原子 generation 与 sentinel；
- Core Method、稳定 error taxonomy 与 Export v1；
- Memory Library UI、会话提示和完整测试矩阵。

这些默认值不是新的跨版本 ADR。如果实施发现某个选择会改变用户权威、Agent
可见性、Forget 保证、SQLite 真源或 Runtime 安全边界，必须暂停实现并回到架构
决策；普通文件名、错误文案和等价内部实现不再逐项询问。

CampMember 离开/移除并不存在于当前正式 Collaboration 命令面，因此其发生后的
Relationship Projection 子文件行为明确不由 v0.10 Memory 设计；未来协作版本新增
该生命周期时必须另行决策，不能从 live Memory Projection 推断。

当前代码实施状态为 6/6；具体完成证据与环境相关手工验证由
[implementation-plan.md](implementation-plan.md)维护。
