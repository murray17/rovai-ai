---
document_type: version-decisions
version: v0.10
lifecycle: historical
last_updated: 2026-08-18
---

# v0.10 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0019](#adr-0019) | Application-Global Memory Ownership | `accepted` |
| [ADR-0020](#adr-0020) | User-Authorized Memory Mutation | `superseded` |
| [ADR-0021](#adr-0021) | Atomic Memory and Immutable Revisions | `superseded` |
| [ADR-0022](#adr-0022) | Immutable Memory Scope | `accepted` |
| [ADR-0023](#adr-0023) | Transparent Relationship Direction | `superseded` |
| [ADR-0024](#adr-0024) | Closed Memory Kinds | `superseded` |
| [ADR-0025](#adr-0025) | Proposal-Scoped Memory Provenance | `superseded` |
| [ADR-0026](#adr-0026) | Explicit Memory Supersession | `accepted` |
| [ADR-0027](#adr-0027) | Memory-Domain Forgetting | `accepted` |
| [ADR-0028](#adr-0028) | Advisory Memory Review | `superseded` |
| [ADR-0029](#adr-0029) | Bounded Memory Reactivation | `accepted` |
| [ADR-0030](#adr-0030) | SQLite Memory Authority and Read-Only Projection | `superseded` |
| [ADR-0031](#adr-0031) | Frozen Low-Priority Memory Context | `superseded` |
| [ADR-0032](#adr-0032) | User-Authorized Live Memory Projection | `superseded` |
| [ADR-0033](#adr-0033) | Advisory Memory Review v2 | `superseded` |
| [ADR-0034](#adr-0034) | Agent-Applicable Relationship Projection | `superseded` |
| [ADR-0035](#adr-0035) | User-Transparent, Agent-Applicable Relationship Memory | `superseded` |
| [ADR-0036](#adr-0036) | Agent-Bounded Memory Proposal Scope | `superseded` |
| [ADR-0037](#adr-0037) | Actor-Bounded Relationship Proposal Direction | `superseded` |
| [ADR-0038](#adr-0038) | Memory Proposal Staleness | `superseded` |
| [ADR-0039](#adr-0039) | Memory Proposal Capability | `superseded` |
| [ADR-0040](#adr-0040) | Terminal Memory Proposal Retention | `superseded` |
| [ADR-0041](#adr-0041) | AgentProfile Status and Memory Independence | `superseded` |
| [ADR-0042](#adr-0042) | Fail-Closed Memory Projection | `superseded` |
| [ADR-0043](#adr-0043) | Memory Secret Filter | `superseded` |
| [ADR-0044](#adr-0044) | Per-Proposal User Memory Confirmation | `superseded` |
| [ADR-0045](#adr-0045) | Normalized SQLite Memory Store | `superseded` |
| [ADR-0046](#adr-0046) | Memory Stewardship Bundled Skill | `superseded` |
| [ADR-0047](#adr-0047) | User-Initiated Memory Export Boundary | `accepted` |

<!-- legacy-adr:begin id=ADR-0019 source-file-sha256=5b7db81c79587b48bea16819d4b90c25315cd9ec1b66179318b4548650fb7a27 -->
<a id="adr-0019"></a>

## ADR-0019: Application-Global Memory Ownership

迁移时原路径：`docs/adr/0019-application-global-memory-ownership.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0019
title: "Application-Global Memory Ownership"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0019 -->
<a id="adr-0019-context"></a>
### Context

Lumen 的主要协作聚合以 Camp 为权限和生命周期边界，而 AgentProfile 是跨 Camp
延续的稳定成员身份。长期记忆如果由 Camp、Project 或 Conversation 所有，同一位
伙伴会在不同协作空间中形成互不相认的身份碎片；如果由 Native Session 或 Runtime
所有，切换 Adapter 时又会丢失 Lumen 承诺的连续性。

另一方面，应用级记忆可能引用某个 Camp、AgentRun、消息、Task 或 Git Commit。
若把来源对象的存在误当成跨边界授权，记忆可能把原本局部可见的信息泄露给未获授权
的伙伴。

<a id="adr-0019-decision"></a>
### Decision

Lumen 建立一个应用级、由用户治理的 Memory Library。它独立于每个 Camp、
Project、Conversation、Native Session、Runtime 和 repository。

Memory Library 使用三种稳定所有权作用域：

```text
Hearth Memory
    面向本机 Lumen home 中的全部 AgentProfile。

Companion Memory
    绑定用户与一个 AgentProfile，跨该身份参与的 Camps 和 Runtime 变化延续。

Relationship Memory
    绑定一对无序 AgentProfile，跨两者共同协作的 Camps 延续。
```

作用域定义所有权和最大可见边界，不等于无条件向每个 AgentRun 注入全部内容。
具体召回和 ContextManifest 冻结由版本协议另行定义。

记忆可以保存对 Camp、AgentRun、消息、Task、Git Commit 或其他稳定对象的来源
引用，但引用不转移所有权，也不得扩大来源对象原有的可见权限。无法在目标记忆
作用域内合法概括的来源内容不得通过记忆跨作用域传播。

<a id="adr-0019-consequences"></a>
### Consequences

- AgentProfile 可以跨 Camp 和 Runtime 保持由 Lumen 管理的长期连续性。
- 删除 Camp 或移动 Project 不会仅因所有权级联而删除应用级记忆；来源变化和
  遗忘规则必须被独立建模。
- 所有记忆写入、搜索、召回和来源验证都必须执行应用级作用域检查，不能复用
  “当前 Camp 可见”作为充分授权。
- Relationship Memory 必须使用规范化的无序成员对身份；具体条目是否具有方向
  仍由版本协议定义。
- 未来若引入多用户账号，必须新增明确的用户/家庭所有权迁移，不能把当前本机
  应用边界静默解释成共享租户边界。

<a id="adr-0019-rejected-alternatives"></a>
### Rejected Alternatives

- Camp-owned memory：会把稳定伙伴身份切碎到各 Camp，并让 Camp 删除意外决定
  长期认识的生命周期。
- Project-owned memory：Project 目前只是共享 repository binding 的派生视图，
  不是可拥有权威状态的领域实体。
- Conversation-owned memory：Conversation 只表达一个 AgentProfile 在一个
  Camp 内的私有连续性，边界过窄。
- Native Session 或 Runtime-owned memory：外部执行句柄可替换，不能成为
  Lumen 长期状态的身份来源。
- 来源对象自动授予记忆可见性：稳定引用是来源说明，不是跨作用域授权。

<a id="adr-0019-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0007: Portable Conversation Handoff](../v0.03/decisions.md#adr-0007)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0012: Collaboration v3](../v0.06/decisions.md#adr-0012)
<!-- legacy-adr-body:end id=ADR-0019 -->
<!-- legacy-adr:end id=ADR-0019 -->

<!-- legacy-adr:begin id=ADR-0020 source-file-sha256=eeed9e96913c96ca7d0e9c42cd3f3315059d7d4061574a64256cddacd4c68d6c -->
<a id="adr-0020"></a>

## ADR-0020: User-Authorized Memory Mutation

迁移时原路径：`docs/adr/0020-user-authorized-memory-mutation.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0020
title: "User-Authorized Memory Mutation"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0032
```

<!-- legacy-adr-body:begin id=ADR-0020 -->
<a id="adr-0020-context"></a>
### Context

Agent 可以从长期对话和协作经历中发现可能值得保留的偏好、约定或经验，但这种
推断可能错误、过时、过度概括，或把临时任务状态和敏感信息误当成稳定认识。
如果模型置信度、重复观察或 Camp 角色能够自动写入长期记忆，Agent 就可以在用户
不知情时改变未来所有 AgentRun 的输入。

另一方面，用户是 Memory Library 的治理者。强迫用户主动新增或修改记忆时也先
创建 Proposal，会把非权威建议层错误地变成所有写入的必经草稿层。

<a id="adr-0020-decision"></a>
### Decision

只有经过认证的用户命令可以新增或修订正式记忆，或改变正式记忆的生命周期。
所有权威变更都通过 ADR-0001 的强类型 DomainCommandGateway 在一个 SQLite
事务中提交，并记录用户 Actor。

Agent 只能通过一个当前、唯一解析且通过 Execution Epoch fencing 的 AgentRun
创建 `MemoryProposal`。Proposal 是持久但非权威的建议：

- 保存成功只表示建议已被记录；
- 它不改变当前有效记忆，也不进入长期记忆上下文；
- 用户接受或编辑后接受时，以用户最终确认的内容生成权威变更；
- 拒绝、暂不处理或重复提案不能形成正式记忆。

Default Lead 身份、Agent Capability、模型置信度、观察次数、多个 Agent 的一致
意见或时间经过都不能自动接受 Proposal。Capability 只决定 Agent 是否可以提交
建议，不授予正式记忆写入权。

用户从管理界面主动新增、修订或执行生命周期操作时，直接提交权威命令，不需要
先创建一个发给自己的 Proposal。Renderer、Agent 和任何投影都不得直接编辑
SQLite 或人类可读文件来绕过命令边界。

正式变更只影响尚未冻结上下文的后续 AgentRun。已有 ContextManifest 的 Run
继续使用原冻结输入，不能在执行中热更新。

<a id="adr-0020-consequences"></a>
### Consequences

- 用户可以在任何长期记忆影响未来行为前检查并修改它。
- Agent 的“学习”成为可审核的建议流程，而不是隐藏的模型副作用。
- Proposal 与正式记忆必须是不同权威级别的记录，Read Side 和 UI 不能把二者
  混成一个状态字段。
- 用户主动管理保持直接；Proposal 接受路径和用户直接写入路径最终必须复用同一
  正式变更校验。
- AgentRun 身份解析、Capability、幂等和速率限制仍然需要单独协议，但都不能
  提升 Agent 的最终确认权。

<a id="adr-0020-rejected-alternatives"></a>
### Rejected Alternatives

- 高置信度或重复观察后自动写入：无法证明推断正确，也让未来上下文发生隐式变化。
- Default Lead 自动批准：Camp 协调角色不等于应用级用户治理权。
- 多 Agent 投票自动批准：模型间一致不等于用户授权，还可能放大同源错误。
- 所有用户编辑也先创建 Proposal：把非权威建议层误用为用户草稿层，增加无意义
  的状态和操作。
- 允许 Agent 直接编辑 Markdown 或数据库：绕过事务、审计、权限和冻结边界。

<a id="adr-0020-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0019: Application-Global Memory Ownership](decisions.md#adr-0019)
<!-- legacy-adr-body:end id=ADR-0020 -->
<!-- legacy-adr:end id=ADR-0020 -->

<!-- legacy-adr:begin id=ADR-0021 source-file-sha256=80d35c903239f3416aa64e9a4cbf1853e52d8e3c32648d9eeea8ad496fccc536 -->
<a id="adr-0021"></a>

## ADR-0021: Atomic Memory and Immutable Revisions

迁移时原路径：`docs/adr/0021-atomic-memory-and-immutable-revisions.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0021
title: "Atomic Memory and Immutable Revisions"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0052
```

<!-- legacy-adr-body:begin id=ADR-0021 -->
<a id="adr-0021-context"></a>
### Context

Memory Library 需要按家园、伙伴和伙伴对呈现人类可读内容，但一份作用域文档可能
包含数十条彼此独立的认识。如果整份 `current.md` 是一个可变聚合，修订其中一条
记忆会制造整文件版本冲突；单条遗忘、来源审计和并发确认也只能依赖脆弱的段落
位置或文本匹配。

长期记忆还必须保留用户曾确认过什么。原地覆盖正文会让历史内容、确认时刻和
陈旧 Proposal 的基准消失。

<a id="adr-0021-decision"></a>
### Decision

每条原子长期认识建模为一个独立 `Memory`，拥有永久稳定的 `memoryId`。Memory
选择一个当前 `MemoryRevision`，并以自身版本参与乐观并发控制。

每个 `MemoryRevision`：

- 拥有独立 `revisionId` 并且只属于一个 Memory；
- 保存该次用户确认的完整内容；
- 发布后不可修改；
- 即使不再是当前 Revision，也作为独立审计历史保留，除非后续遗忘协议明确要求
  清除。

正式修订创建新 Revision，并以 Memory 当前版本和 `currentRevisionId` 执行
Compare-and-Set。旧 Revision 不原地更新。

新增 MemoryProposal 在用户接受时原子创建 Memory 与首个 MemoryRevision。
修订 MemoryProposal 必须记录目标 `memoryId` 和提出时的 `baseRevisionId`。
如果接受时目标 Memory 已推进到其他 Revision，该 Proposal 是陈旧建议，Core
必须拒绝直接覆盖；用户需要查看最新内容并重新确认。针对不同 Memory 的命令不因
共享一个展示文件而产生整文件冲突。

按作用域生成的 `current.md` 或等价人类可读文件是多个 Memory 当前 Revision 的
确定性只读投影。文件路径、段落顺序、行号和整文件版本都不定义 Memory 身份；
外部文件编辑不能成为领域写入入口。

本 ADR 不决定 Memory 的字段、生命周期、持久化真源或投影目录协议。

<a id="adr-0021-consequences"></a>
### Consequences

- 单条记忆可以独立修订、审计、停止沿用和遗忘。
- 陈旧 Proposal 有明确基准，不会覆盖用户后来确认的认识。
- 并发控制粒度与用户操作粒度一致，不需要锁住整份家园或伙伴文档。
- Read Side 和投影必须使用稳定 ID，而不能用正文内容或数组位置做身份。
- 不可变 Revision 增加记录数量与遗忘清理责任，但使历史与恢复语义可解释。

<a id="adr-0021-rejected-alternatives"></a>
### Rejected Alternatives

- 每个作用域一份可变 Markdown 聚合：产生无关冲突，并把文本布局误当成身份。
- 每个作用域一个整文档 Revision：任何单条修改都复制并替换整组内容，审计和
  并发粒度过粗。
- 直接更新 Memory 正文：无法证明用户历史上确认的具体内容，也无法检测陈旧建议。
- 使用正文摘要作为 Memory 身份：合法修订会改变身份，重复或相似内容也会碰撞。
- 接受陈旧 Proposal 时最后写入者获胜：会静默覆盖较新的用户确认。

<a id="adr-0021-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0020: User-Authorized Memory Mutation](decisions.md#adr-0020)
<!-- legacy-adr-body:end id=ADR-0021 -->
<!-- legacy-adr:end id=ADR-0021 -->

<!-- legacy-adr:begin id=ADR-0022 source-file-sha256=9b5be925d0301d8794b1678dd3eed94a4c3eb6ec86070a28f721067a17495f04 -->
<a id="adr-0022"></a>

## ADR-0022: Immutable Memory Scope

迁移时原路径：`docs/adr/0022-immutable-memory-scope.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0022
title: "Immutable Memory Scope"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0022 -->
<a id="adr-0022-context"></a>
### Context

Hearth、Companion 和 Relationship 不只是展示分组；它们决定一条长期认识由谁
共同拥有，以及最多可以向哪些 AgentProfile 暴露。若普通 Revision 能把
Companion Memory 改成 Hearth Memory，内容更新就会同时完成一次不显眼的权限
扩大，历史审计也无法稳定回答旧 Revision 当时属于什么边界。

Relationship Scope 还以一对 AgentProfile 为身份。原地替换其中一位成员会把
同一个 Memory ID 解释成两段不同关系。

<a id="adr-0022-decision"></a>
### Decision

Memory Scope 是 Memory 创建时固定的身份属性，只能是：

```text
hearth
companion(agentProfileId)
relationship(minAgentProfileId, maxAgentProfileId)
```

Relationship 成员对按稳定 AgentProfile ID 规范化为无序 pair。MemoryRevision
不能修改 Scope 或 Relationship 成员。

将内容提升到更宽作用域、收窄到更小作用域，或更换 Relationship 成员时，必须
创建新的 Memory 与首个 MemoryRevision。新 Memory 可以记录来源
`memoryId/revisionId` 作为派生引用，但派生关系不转移权限；目标内容必须独立
满足目标 Scope 的可见性和敏感信息规则。

创建目标 Memory 不自动修改来源 Memory。用户可以在同一权威命令中明确请求一个
独立的来源生命周期变化，但系统必须分别记录“创建派生 Memory”和“改变来源
Memory 状态”。在生命周期协议定稿前，不推断具体终态。

<a id="adr-0022-consequences"></a>
### Consequences

- 每个 Memory ID 在全部历史 Revision 中具有稳定的所有权和最大可见边界。
- Companion → Hearth 等权限扩大变成可识别、可确认、可审计的操作。
- 相同语义可能在不同 Scope 拥有不同 Memory ID，需要显式重复检测与派生关系。
- 投影目录可以按 Scope 稳定分组，但目录移动不能冒充领域变更。
- 用户若希望“移动而非复制”，UI 必须把创建目标与处理来源作为一个明确的复合
  选择，而不能在后台偷偷终结来源。

<a id="adr-0022-rejected-alternatives"></a>
### Rejected Alternatives

- 把 Scope 放进 MemoryRevision：同一 Memory 的历史会跨越不同权限边界。
- 原地修改 Memory Scope：审计无法稳定解释旧内容对谁可见。
- 通过移动 Markdown 文件改变 Scope：文件是投影，不是授权或写入入口。
- 创建目标后自动删除来源：复制与生命周期是不同用户意图，自动合并可能造成
  数据丢失。
- Relationship pair 中原地替换成员：会把两段不同伙伴关系错误复用为同一身份。

<a id="adr-0022-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0019: Application-Global Memory Ownership](decisions.md#adr-0019)
- [ADR-0020: User-Authorized Memory Mutation](decisions.md#adr-0020)
- [ADR-0052: Explicit Memory Revision Authority](../v0.13/decisions.md#adr-0052)
<!-- legacy-adr-body:end id=ADR-0022 -->
<!-- legacy-adr:end id=ADR-0022 -->

<!-- legacy-adr:begin id=ADR-0023 source-file-sha256=f0b8c4bafaf082c3e2814de80480b795d2fad9d573f15b0b7a05db5a1ebb6a70 -->
<a id="adr-0023"></a>

## ADR-0023: Transparent Relationship Direction

迁移时原路径：`docs/adr/0023-transparent-relationship-direction.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0023
title: "Transparent Relationship Direction"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0035
```

<!-- legacy-adr-body:begin id=ADR-0023 -->
<a id="adr-0023-context"></a>
### Context

Relationship Memory 属于一对无序 AgentProfile，但某些协作约定天然只要求其中
一方行动，例如“洛可向沐瓦交接前先给出验收口径”。如果所有条目都被解释成对称
义务，另一位伙伴会收到错误指令。

反过来，若 `directed` 被解释成只有一方可见的记录，Relationship Memory 就会
变成用户或 Agent 对另一位伙伴建立的隐藏观察档案。这既破坏共同协作的透明性，
也会混淆适用性与访问控制。

<a id="adr-0023-decision"></a>
### Decision

每个 Relationship Memory 在创建时固定一个 Relationship Direction：

```text
mutual

directed {
  actorAgentProfileId,
  counterpartyAgentProfileId
}
```

`mutual` 表示该认识对 pair 双方的协作行为对称适用。`directed(A → B)` 表示该
认识主要指导 A 与 B 协作时的行为；它不能反向解释成 B 必须履行 A 的义务。

Direction 不改变访问边界。经过授权的用户以及 pair 中两位 AgentProfile 都可以
查看和搜索该 Relationship Memory。系统不建立只让 actor、counterparty 或其中
一方看见的 Relationship Memory。

Directed 的 actor 与 counterparty 必须是 Relationship Scope 中两个不同成员。
Direction 是 Memory 身份属性，不是 MemoryRevision 字段。mutual 与 directed
互换或调换 actor/counterparty 时创建新 Memory；来源 Memory 的处理遵守
ADR-0022。

无论 Direction 如何，Relationship Memory 都不得成为人格标签、能力评分或秘密
观察档案。Direction 只描述协作认识对谁的行为适用。

本 ADR 不决定 AgentRun 召回条件。后续协议必须根据当前 AgentProfile、相关协作
成员和 Direction 决定适用内容，同时保持用户与 pair 双方的管理透明度。

<a id="adr-0023-consequences"></a>
### Consequences

- 非对称协作约定可以被准确表达，而不会把义务错误施加给另一位伙伴。
- 双方能够检查和纠正影响彼此协作的长期认识，不存在隐藏 Relationship 档案。
- Read Side、搜索和管理 UI 必须区分“谁可见”与“主要对谁适用”。
- Relationship Memory 需要验证 pair 与 Direction 端点一致，投影也必须稳定
  显示方向。
- 如果未来确实需要 Agent 私有笔记，必须建立另一个明确的领域与安全模型，不能
  复用 directed Relationship Memory。

<a id="adr-0023-rejected-alternatives"></a>
### Rejected Alternatives

- Relationship Memory 全部 mutual：无法表达真实的单方协作义务。
- Directed 表示仅 actor 可见：会形成对 counterparty 的隐藏档案。
- Directed 表示仅 counterparty 可见：混淆行为适用方和信息接收方。
- 把 Direction 放进 Revision：一次内容修订可以暗中改变义务承担者。
- 用自然语言中的名字推断方向：重命名、歧义和模型解释会破坏稳定语义。

<a id="adr-0023-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0019: Application-Global Memory Ownership](decisions.md#adr-0019)
- [ADR-0022: Immutable Memory Scope](decisions.md#adr-0022)
<!-- legacy-adr-body:end id=ADR-0023 -->
<!-- legacy-adr:end id=ADR-0023 -->

<!-- legacy-adr:begin id=ADR-0024 source-file-sha256=649f88c8a632411917cfe8359a6cdc534973f37d2224b25138fcf7ac069c07b2 -->
<a id="adr-0024"></a>

## ADR-0024: Closed Memory Kinds

迁移时原路径：`docs/adr/0024-closed-memory-kinds.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0024
title: "Closed Memory Kinds"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
```

<!-- legacy-adr-body:begin id=ADR-0024 -->
<a id="adr-0024-context"></a>
### Context

“长期记忆”很容易退化成任何旧信息的容器。若 v0.10 提供通用 Fact、人格标签、
能力评分或任务状态，Memory Library 会与 repository、Task、AgentRun、
Conversation Summary 和 AgentProfile 等现有真源竞争，并可能让过时推断覆盖当前
事实。

长期协作真正需要的是稳定偏好、明确约定和从实际经历中形成的可复用行动经验。
这些类别具有不同来源要求和适用语义，因此不能只作为自由标签。

<a id="adr-0024-decision"></a>
### Decision

v0.10 的 Memory Kind 是封闭枚举：

```text
preference
agreement
lesson
```

定义如下：

- `preference`：用户确认的稳定选择，描述 Lumen 或某位 Companion 如何沟通、
  展示信息或与用户协作；
- `agreement`：由用户确认采用、面向未来的协作规则；
- `lesson`：从真实经历提炼的可复用行动方式，不评价任何成员的人格或能力。

Scope 与 Kind 的合法组合为：

```text
hearth        → preference | agreement | lesson
companion     → preference | agreement | lesson
relationship  → agreement | lesson
```

Kind 是 Memory 创建时固定的身份属性，不属于 MemoryRevision。重新分类必须创建
新 Memory，并遵守 ADR-0022 的派生和来源处理规则。

v0.10 明确不支持通用 `fact`、人格标签、能力评分、行为画像或观察档案。Task、
AgentRun、Approval、Action、当前计划、TODO、Conversation Summary 和 repository
事实继续由其自然领域对象拥有。秘密、Token、密钥和认证资料禁止进入 Memory。

<a id="adr-0024-consequences"></a>
### Consequences

- Memory Library 保持为长期协作认识，而不是第二个知识库、Task 系统或 Agent
  评分系统。
- Kind 可以驱动来源校验、UI 文案和召回规则，而不会被普通内容修订偷换。
- 某些用户希望保存的稳定事实在 v0.10 中没有对应类型；需要继续依赖原领域真源
  或未来单独设计的知识模型。
- Relationship Memory 无法用 Preference 包装对另一位伙伴的单边画像。
- 新增 Kind 是跨版本 Schema 和语义扩展，不能通过未知字符串静默兼容。

<a id="adr-0024-rejected-alternatives"></a>
### Rejected Alternatives

- 通用 Fact Memory：会与当前 repository、Task 和协作状态竞争权威。
- 自由字符串 Kind：无法可靠执行来源、作用域和安全约束。
- Kind 放进 Revision：普通修订会改变一条 Memory 的语义类别和校验规则。
- Personality、Trait 或 Capability Memory：会把协作经验变成长期人物评分。
- 把所有内容统一称为 Note：无法区分稳定偏好、未来约定和有经验依据的 Lesson。

<a id="adr-0024-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0012: Collaboration v3](../v0.06/decisions.md#adr-0012)
- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0052: Explicit Memory Revision Authority](../v0.13/decisions.md#adr-0052)
- [ADR-0022: Immutable Memory Scope](decisions.md#adr-0022)
<!-- legacy-adr-body:end id=ADR-0024 -->
<!-- legacy-adr:end id=ADR-0024 -->

<!-- legacy-adr:begin id=ADR-0025 source-file-sha256=4773b8234214ff803bf912e933225c0e5946365a9a2968c086aa5249a96346e5 -->
<a id="adr-0025"></a>

## ADR-0025: Proposal-Scoped Memory Provenance

迁移时原路径：`docs/adr/0025-proposal-scoped-memory-provenance.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0025
title: "Proposal-Scoped Memory Provenance"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
```

<!-- legacy-adr-body:begin id=ADR-0025 -->
<a id="adr-0025-context"></a>
### Context

用户需要知道一项 Agent 建议由哪位伙伴、在何时和哪次协作中提出。但为每个
MemoryRevision 分别建立 Origin、Evidence 和 Acceptance 对象会重复 Lumen
已有的命令审计，产生比首版用途更细碎的模型；本机 Lumen 当前也只有一个用户，
单独复制 accepter 身份没有额外区分价值。

来源元数据若进入 AgentRun 上下文，还会消耗 token 并干扰真正需要执行的记忆
正文。另一方面，只依赖对 AgentRun 的可级联外键会在来源 Camp 永久删除后抹掉
应用级记忆的基本提案历史。

<a id="adr-0025-decision"></a>
### Decision

提案来源记录在 MemoryProposal 本身。每个 Agent 提交的 Proposal 至少持久化：

```text
proposedByAgentProfileId
proposedAt
sourceAgentRunId
sourceExecutionEpoch
sourceCampId
```

Gateway 根据 Native Binding、当前唯一活动 AgentRun、Execution Epoch 和所属
Camp 推导这些字段。Agent 工具 Schema 不允许模型提供或覆盖身份、时间和 Camp。

MemoryProposal 是应用级记录。`sourceCampId` 和 `sourceAgentRunId` 是不可由
调用方伪造的弱稳定审计引用，而不是 Camp ownership 外键；删除来源 Camp 或其
AgentRun 不得级联抹掉 Proposal 中已经记录的提案者、时间和来源标识。这些引用
不保留来源正文，也不扩大已删除或不可读对象的权限。

由 Proposal 接受而来的 MemoryRevision 只保存可选 `createdFromProposalId` 和
自身 `createdAt`。用户直接创建或修订 Memory 时不创建 Proposal。

v0.10 不建立独立 Origin、Evidence 或 Acceptance 领域对象。用户 Actor、命令
身份、命令时间和结果继续由 ADR-0001 的 `event_log` 记录。Proposal 的来源字段
只提供给记忆管理和审计 Read Side，不进入 Agent 可读 Memory Projection 或普通
Agent 搜索结果。

<a id="adr-0025-consequences"></a>
### Consequences

- 用户可以识别提案伙伴、时间和协作来源，而不为每个 Revision 复制一套来源包。
- 用户编辑后接受时，Proposal 保留原建议，Revision 保留最终正文，两者可以通过
  `createdFromProposalId` 对照。
- 来源 Camp 删除后仍能显示不透明 ID 和提案时间，但原 Camp 名称或正文若未另行
  保存就可能不可恢复；UI 需要明确显示来源已不可用。
- Proposal 的保留与遗忘策略会影响 Revision 链接可以解析多久，必须在版本协议
  中另行确定。
- 来源元数据不消耗 AgentRun token，也不能被 Agent 当作额外行为指令。

<a id="adr-0025-rejected-alternatives"></a>
### Rejected Alternatives

- 每个 Revision 保存 Origin/Evidence/Acceptance 三层对象：重复审计并增加首版
  模型复杂度。
- 只记录 Proposal 正文而不记录提案者和来源 Run：无法解释建议来自哪次协作。
- 让模型传入 Agent、Run 或 Camp ID：身份可以被伪造并绕过 Gateway 解析。
- 将 Proposal 作为 Camp-owned record：Camp 删除会意外清除应用级记忆的提案
  历史。
- 把 Proposal provenance 写入 Agent 可读 Memory Projection：浪费上下文，并把
  审计元数据误作执行指导。

<a id="adr-0025-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0012: Collaboration v3](../v0.06/decisions.md#adr-0012)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0020: User-Authorized Memory Mutation](decisions.md#adr-0020)
<!-- legacy-adr-body:end id=ADR-0025 -->
<!-- legacy-adr:end id=ADR-0025 -->

<!-- legacy-adr:begin id=ADR-0026 source-file-sha256=2c6a9966db8a5d49cf072604e8c3579bde3d3319a9e4827571b71d9ef3abcc66 -->
<a id="adr-0026"></a>

## ADR-0026: Explicit Memory Supersession

迁移时原路径：`docs/adr/0026-explicit-memory-supersession.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0026
title: "Explicit Memory Supersession"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0026 -->
<a id="adr-0026-context"></a>
### Context

一条 Memory 可能因为用户不再沿用而结束，也可能因为 Scope、Kind、Direction
变化或多条合并而被另一条 Memory 取代。若两种情况都只写成 `superseded` 状态，
系统无法回答旧认识被哪条新认识替代；若普通内容 Revision 也叫 Supersession，
又会混淆同一身份的历史与不同 Memory 身份之间的演进。

<a id="adr-0026-decision"></a>
### Decision

Memory 的权威生命周期枚举为：

```text
active
retired
forgotten
```

Active Memory 可以进入 Agent 可读 Memory Projection 与未来搜索。Retired
Memory 停止沿用，但保留正文、Revision 历史和管理可见性。Forgotten 是终态，
其正文清除和最小 tombstone 规则由 v0.10 后续协议单独确定。

`superseded` 不作为 Memory 生命周期值。替代通过独立的
`MemorySupersession` 关系表达：

```text
predecessorMemoryId → successorMemoryId
```

创建 Supersession 必须是用户授权的权威命令，并在同一 SQLite 事务中把
predecessor 从 active 转为 retired、创建指向 successor 的稳定关系并追加审计
事件。没有 successor 的普通停止沿用只执行 retire。

同一 Memory 内发布新 MemoryRevision 不是 Supersession。只有创建了新 Memory
身份后，用户才可以从一个或多个旧 Memory 建立明确替代边。具体 merge/split
基数可以在 Schema 协议中收紧，但不得退化为没有 successor 的布尔标记。

<a id="adr-0026-consequences"></a>
### Consequences

- UI 可以区分“用户停止沿用”和“已被具体新认识替代”。
- Revision 历史保持同一 Memory 身份，Scope/Kind/Direction 迁移则通过新身份和
  显式关系表达。
- 替代关系需要引用完整性与循环检查；retire 与创建关系必须原子提交。
- Retired 内容仍占容量和本地存储，但不进入未来 Agent 上下文。
- Forgotten 的隐私语义仍需确保 Supersession 不通过残留正文或投影重新暴露内容。

<a id="adr-0026-rejected-alternatives"></a>
### Rejected Alternatives

- `superseded` 作为无目标生命周期状态：无法解释被什么替代。
- 用 `supersededById` 可选列代替关系：过早限制合并或拆分，并把生命周期与图边
  混在一个字段。
- 每次新 Revision 都 supersede 旧 Memory：把内容历史错误建模为身份替换。
- 创建 successor 时自动终结来源：派生与生命周期是不同用户意图，必须显式确认。
- 只 retire 而不记录 successor：丢失跨 Scope、Kind 或合并时的演进关系。

<a id="adr-0026-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0052: Explicit Memory Revision Authority](../v0.13/decisions.md#adr-0052)
- [ADR-0022: Immutable Memory Scope](decisions.md#adr-0022)
<!-- legacy-adr-body:end id=ADR-0026 -->
<!-- legacy-adr:end id=ADR-0026 -->

<!-- legacy-adr:begin id=ADR-0027 source-file-sha256=cb3ddebd548a967e4a5566deb5429f722fedc8af1f86555112299ab2b6828dd8 -->
<a id="adr-0027"></a>

## ADR-0027: Memory-Domain Forgetting

迁移时原路径：`docs/adr/0027-memory-domain-forgetting.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0027
title: "Memory-Domain Forgetting"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0027 -->
<a id="adr-0027-context"></a>
### Context

用户需要让一项长期记忆不再被保留或影响未来行为。仅把状态改成 `forgotten`
却继续保存 MemoryRevision、已接受 Proposal 和 Markdown 明文，不构成诚实的
遗忘。

同时，Memory 内容可能最初来自 CampMessage、Task、Git Commit 或其他自然领域
对象，也可能已经被冻结进已完成 AgentRun 的 ContextManifest 或上游 Native
Session。跨领域改写这些历史会破坏 ADR-0049 的执行可重现性；Lumen 也无法控制
Time Machine、文件系统快照、用户复制品或 Provider 历史。

<a id="adr-0027-decision"></a>
### Decision

Memory Forget 是用户发起、不可恢复的 Memory Domain 清除命令。它必须：

- 将 Memory 转入终态 `forgotten`；
- 删除或不可逆清空该 Memory 的所有 MemoryRevision 可读正文；
- 清空与该 Memory 已接受路径关联的 MemoryProposal 可读正文；
- 从搜索、Agent 可读 Memory Projection 和 Memory 导出中移除该 Memory；
- 阻止旧 Revision、旧 Proposal、Supersession 或其他引用重新激活内容。

系统只保留安全和审计所需的最小 tombstone，例如 `memoryId`、`forgottenAt` 和
必要命令标识；Proposal 可以保留提案者、时间及 Camp/Run 的不透明来源标识，但
不能保留提案正文。ADR-0001 要求的永久 `command.result` 和 request digest
继续存在，事件与结果 payload 只能保存 ID、状态、脱敏摘要或摘要值，不能复制
Memory/Proposal 明文。

Forget 不删除或改写：

- 原始 CampMessage、ConversationMessage、Task、AgentRun、Action 或 Git Commit；
- 已完成 AgentRun 的不可变 ContextManifest 及其历史载荷；
- 上游 Native Session 或 Provider 保存的历史；
- 操作系统快照、Time Machine、用户导出或其他不受 Memory Domain 控制的备份。

旧 ContextManifest 可以继续证明某次 Run 当时使用过某个 Revision，但 Forgotten
内容不能由该历史路径重新导入 Memory Library、参与新搜索或注入新 AgentRun。

产品文案必须把该操作称为“从长期记忆中遗忘”或等价的领域限定表达，不能宣称
法律级全局擦除或外部副本销毁。仅希望停止未来使用并保留正文时，用户应执行
retire。

<a id="adr-0027-consequences"></a>
### Consequences

- 用户可以不可逆地清除 Memory Library 中的可读内容，而不会让停用条目继续潜伏
  在投影或导出中。
- 执行历史和自然来源对象保持真实，不因 Memory 生命周期被篡改。
- Memory 相关命令、事件和结果从第一天起就必须避免永久复制明文，否则无法兑现
  Forget。
- 管理 UI 必须明确 retire 与 forget 的差别，并对不可恢复操作进行显式确认。
- Lumen 无法承诺 SQLite 页、WAL、OS 快照或外部 Provider 的取证擦除；更强保证
  需要单独的加密、介质和备份生命周期设计。

<a id="adr-0027-rejected-alternatives"></a>
### Rejected Alternatives

- Forgotten 只改状态但保留正文：内容仍可泄露、导出或被错误召回。
- Forget 级联删除原始来源：Memory 不拥有 Camp、Task、Commit 或 Action。
- 重写已完成 ContextManifest：破坏不可变执行输入和恢复审计。
- 宣称清除 Native Session 与系统备份：Lumen 不拥有或无法证明这些副本已销毁。
- Forget 可撤销：与不可恢复内容清除的用户预期冲突；可恢复停用应使用 retire。

<a id="adr-0027-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0025: Proposal-Scoped Memory Provenance](decisions.md#adr-0025)
- [ADR-0026: Explicit Memory Supersession](decisions.md#adr-0026)
<!-- legacy-adr-body:end id=ADR-0027 -->
<!-- legacy-adr:end id=ADR-0027 -->

<!-- legacy-adr:begin id=ADR-0028 source-file-sha256=e39d6a4a99eaa75aaa2af4de18ffd8303492bf66a25f5f5572b74a8b2e300a34 -->
<a id="adr-0028"></a>

## ADR-0028: Advisory Memory Review

迁移时原路径：`docs/adr/0028-advisory-memory-review.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0028
title: "Advisory Memory Review"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0033
```

<!-- legacy-adr-body:begin id=ADR-0028 -->
<a id="adr-0028-context"></a>
### Context

长期认识可能需要定期复核，尤其是从一次经历总结出的 Lesson。但若
`validFrom`、`validUntil` 或 Review 日期直接控制 Lifecycle，墙上时钟会在没有
用户命令、版本检查或审计事件的情况下改变未来 AgentRun 的行为。

明确具有起止时间的要求通常是当前计划、Task 或一次协作输入，而不是长期记忆。
同时为确认时间再保存 `acceptedAt` 会与 MemoryRevision 的创建事实重复。

<a id="adr-0028-decision"></a>
### Decision

MemoryRevision 在用户正式命令提交时立即创建，`createdAt` 同时表达该版本的确认
时间。它只影响尚未冻结 ContextManifest 的后续 AgentRun。v0.10 不保存单独的
`acceptedAt`。

v0.10 不支持 `validFrom` 或 `validUntil`。未来生效和自动到期的要求继续由当前
输入、Task 或其他自然领域对象表达，不能通过 Memory 的时间窗口静默改变效力。

Memory 可以保存可选 `reviewAfter`。默认规则为：

```text
lesson      → 创建或修订当前 Revision 后 90 天
preference  → null
agreement   → null
```

用户可以为任意 Kind 手动安排 Review。`now >= reviewAfter` 只产生 Read Side 的
“建议复核”状态，不修改 Memory Lifecycle、MemoryRevision 或 Context 资格。
用户复核后可以通过显式命令继续沿用并重新安排、修订、retire 或 forget。

Review reminder 不自动创建 Proposal、消息、Task、AgentRun 或 Runtime Wake。

<a id="adr-0028-consequences"></a>
### Consequences

- Agent 行为不会仅因系统时间经过而无审计地改变。
- Lesson 获得默认治理提醒，但不会因为用户没有及时处理而突然失效。
- 首版无法表达“下周开始采用”或“月底自动失效”的 Memory；这类要求应留在
  Task 或当前上下文。
- Read Side 需要按当前时间派生 review-due 状态，但权威记录保持不变。
- 用户确认时间与 Revision 创建时间一致，减少重复字段和不一致风险。

<a id="adr-0028-rejected-alternatives"></a>
### Rejected Alternatives

- `validFrom` 定时启用：引入无命令的行为变化和恢复时钟语义。
- `validUntil` 自动 retire：把临时要求误装进长期记忆，并绕过用户生命周期命令。
- Review 到期自动失效或删除：提醒不能代替用户治理决定。
- 为每个 Revision 另存 `acceptedAt`：与用户命令提交创建 Revision 的时间重复。
- 到期自动创建 Task 或 AgentRun：治理提醒不应隐式启动协作或 Runtime 工作。

<a id="adr-0028-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0012: Collaboration v3](../v0.06/decisions.md#adr-0012)
- [ADR-0020: User-Authorized Memory Mutation](decisions.md#adr-0020)
- [ADR-0026: Explicit Memory Supersession](decisions.md#adr-0026)
<!-- legacy-adr-body:end id=ADR-0028 -->
<!-- legacy-adr:end id=ADR-0028 -->

<!-- legacy-adr:begin id=ADR-0029 source-file-sha256=f7eedd6ffe453106300cf24d95b2c7df6558c1527edcd7f715a89ed667a05c7c -->
<a id="adr-0029"></a>

## ADR-0029: Bounded Memory Reactivation

迁移时原路径：`docs/adr/0029-bounded-memory-reactivation.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0029
title: "Bounded Memory Reactivation"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0029 -->
<a id="adr-0029-context"></a>
### Context

Retire 用于停止未来沿用但保留正文。用户可能只是暂时停用一项仍然正确的认识；
若每次恢复都必须复制成新 Memory，会制造不必要的身份和 Revision。

但被 MemorySupersession 取代的 predecessor 已有明确历史事实：另一条 Memory
替代了它。直接重新启用 predecessor 会让“已被 successor 替代”和“两者同时
active”并存，删除替代边又会篡改审计历史。

<a id="adr-0029-decision"></a>
### Decision

Memory Lifecycle 允许以下转换：

```text
active → retired
retired → active
active → forgotten
retired → forgotten
```

所有转换均由显式用户命令、Memory expected version 和 ADR-0001 事务边界控制。

只有没有 outgoing MemorySupersession 的 retired Memory 可以重新变为 active。
重新启用不创建新 MemoryRevision，因为正文与 Memory 身份属性没有变化；它只
更新 Memory lifecycle/version 并追加脱敏审计事件。

存在 outgoing Supersession 的 predecessor 不能直接重新启用，即使 successor
后来 retired 或 forgotten。需要恢复旧内容时，用户从可读历史 Revision 创建一个
新的 Memory，并保留原 Supersession 关系。Forgotten Memory 是终态，不能恢复。

Review due 是派生治理提醒，不影响重新启用资格；重新启用也不自动修改
`reviewAfter`。

<a id="adr-0029-consequences"></a>
### Consequences

- 临时停用可以无损恢复同一 Memory 身份，不制造重复内容。
- Supersession 历史不会因用户反悔而被删除或形成自相矛盾的 active 状态。
- UI 必须对普通 retired 与 superseded predecessor 提供不同可用操作。
- 恢复 superseded 内容需要创建新 Memory，身份链会更长，但历史保持真实。
- Lifecycle 命令与 Revision 命令保持分离，审计能区分内容变化和适用性变化。

<a id="adr-0029-rejected-alternatives"></a>
### Rejected Alternatives

- 所有 retired 都不可恢复：对临时停用过于昂贵，会产生重复 Memory。
- 所有 retired 都可恢复：会让 superseded predecessor 与 successor 同时 active。
- 重新启用总是创建 Revision：内容没有变化时伪造了一次内容确认。
- 删除 Supersession 后恢复 predecessor：篡改已经发生的替代事实。
- Forgotten 可恢复：与 ADR-0027 的不可逆内容清除冲突。

<a id="adr-0029-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0026: Explicit Memory Supersession](decisions.md#adr-0026)
- [ADR-0027: Memory-Domain Forgetting](decisions.md#adr-0027)
- [ADR-0028: Advisory Memory Review](decisions.md#adr-0028)
<!-- legacy-adr-body:end id=ADR-0029 -->
<!-- legacy-adr:end id=ADR-0029 -->

<!-- legacy-adr:begin id=ADR-0030 source-file-sha256=66499177dae2183395acea9203f8129f1cf4e37d2d3767ae5dbed8563526675b -->
<a id="adr-0030"></a>

## ADR-0030: SQLite Memory Authority and Read-Only Projection

迁移时原路径：`docs/adr/0030-sqlite-memory-authority.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0030
title: "SQLite Memory Authority and Read-Only Projection"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0032
```

<!-- legacy-adr-body:begin id=ADR-0030 -->
<a id="adr-0030-context"></a>
### Context

Memory、Revision、Proposal、Supersession、容量与 Forget 需要共享一个可回滚的
事务边界。若按 Scope 保存的 Markdown 同时可写，文件和数据库会形成双真源；
外部编辑、并发用户确认和进程崩溃会让两者无法确定谁覆盖谁。

Memory 正文具有严格的小尺寸上限，不需要 Managed Blob 的流式大文件、内容寻址
和 GC 复杂度。用户仍需要可检查的人类可读视图，但 AgentRun 的恢复不能依赖一个
可能丢失或被外部污染的文件。

<a id="adr-0030-decision"></a>
### Decision

现有 SQLite 数据库是 Memory Domain 的唯一权威存储。以下状态和短正文全部保存
在 SQLite：

```text
Memory
MemoryRevision
MemoryProposal
MemorySupersession
projection observations and diagnostics
```

MemoryRevision 与 MemoryProposal 的正文按版本限制为小型文本，直接使用 SQLite
字段，不存入 Managed Blob。新增、接受、修订、Lifecycle、Supersession、Forget、
容量校验、命令结果和脱敏事件在 ADR-0001 的同一 SQLite 事务中提交。

Lumen 在私有 userData 下生成按 Scope 组织的确定性 Markdown Memory Projection。
Projection：

- 只由权威 SQLite 状态生成；
- 对人类可读，但不是写入入口；
- 不被 Core 反向解析；
- 不进入 project、execution root 或 Git；
- 可以在缺失、损坏、formatter/schema 过旧或 digest 不匹配时完全重建。

Projection 文件使用原子替换和 Lumen-private 权限。具体目录、文件名、内容格式、
安全大小上限和 formatter version 在 v0.10 协议中定义。

ADR-0001 禁止在权威事务内执行文件系统 I/O。Memory 命令提交后发送 best-effort
typed Wake；Projector 根据 SQLite 权威状态、projection observation 和稳定扫描
重建文件。文件写入失败不回滚已经提交的 Memory，但必须保留诊断并可在重启后
恢复。不建立通用 Outbox。

Agent 搜索、召回、Memory Context 组装和 ContextManifest 冻结只查询 SQLite。
它们不得读取 Markdown，也不得因为 Projection 暂时失败而退回到过旧文件。

<a id="adr-0030-consequences"></a>
### Consequences

- 记忆确认、修订、并发保护、容量与 Forget 拥有一个明确事务真源。
- Markdown 可以被用户检查、删除或污染而不改变 Memory；Projector 会按权威状态
  重建并覆盖外部变化。
- 小正文直接进入 SQLite，查询和清除简单，但数据库承担全部 Memory 内容保密和
  备份责任。
- Projection 是含有记忆正文的敏感副本，需要私有权限、原子写入、诊断和
  Forget 后的确定性清理。
- Projector 与 Agent Context 读取分离，文件故障不会向 Runtime 注入陈旧记忆。

<a id="adr-0030-rejected-alternatives"></a>
### Rejected Alternatives

- Markdown 作为唯一真源：难以提供事务、并发确认、幂等、Forget 和结构化查询。
- SQLite 与 Markdown 双向同步：冲突和恢复无法确定权威方向。
- 每条短正文使用 Managed Blob：对 2 KiB 级文本增加不必要的文件、GC 和引用
  生命周期。
- 在 Memory 命令事务中同步写 Markdown：违反 ADR-0001 的事务无文件 I/O 边界。
- Agent 从 Markdown 搜索或组装 Context：丢失或污染文件会改变执行输入。
- 把投影写入项目目录：会污染 repository、扩大可见性并可能进入 Git。

<a id="adr-0030-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0021: Atomic Memory and Immutable Revisions](decisions.md#adr-0021)
- [ADR-0027: Memory-Domain Forgetting](decisions.md#adr-0027)
<!-- legacy-adr-body:end id=ADR-0030 -->
<!-- legacy-adr:end id=ADR-0030 -->

<!-- legacy-adr:begin id=ADR-0031 source-file-sha256=8d7e1790f94c5ce8b00f0530eeb268d2dddd9a648cee0d1095d992b9e771e879 -->
<a id="adr-0031"></a>

## ADR-0031: Frozen Low-Priority Memory Context

迁移时原路径：`docs/adr/0031-frozen-low-priority-memory-context.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0031
title: "Frozen Low-Priority Memory Context"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0032
```

<!-- legacy-adr-body:begin id=ADR-0031 -->
<a id="adr-0031-context"></a>
### Context

长期记忆需要影响未来 AgentRun，但它表达的是历史上确认的协作指导，不是当前
用户输入、任务责任、权限或 repository 事实。若将 Memory 写入 Provider System
Prompt 或 Session Charter，它会获得过高且难以逐轮更新的权威；若恢复同一
AgentRun 时从最新 Library 重新选择，又会违反 ADR-0049 的不可变输入协议。

Memory 还可能在 Run 执行期间被 revise、retire 或 forget。热更新正在运行的模型
会让同一 AgentRun 在不同恢复尝试中接收不同规则。

<a id="adr-0031-decision"></a>
### Decision

Context formatter 增加独立的 `[MEMORY_CONTEXT] ... [/MEMORY_CONTEXT]` 动态输入
区段。它位于 Shared Conversation Updates 之后、Work Brief、Task Context 和
Current Input 之前。

Memory Context 必须明确标注为用户确认的历史协作指导。它：

- 不进入 Provider System Prompt 或 Session Charter；
- 不授予 Capability、Adapter permission、Approval 或 Action authority；
- 不改变 AgentRun Workspace、Task 状态或完成语义；
- 不证明 repository、外部服务或当前协作状态的事实；
- 不能覆盖当前用户输入、Work Brief、Task Context、Core 权限、当前 repository
  状态、Control Signal 或更新的协作消息。

Lumen 动态输入冲突时使用以下优先关系：

```text
Current Input
→ Work Brief / Task Context / Core permissions / current repository state
→ current collaboration messages / Control Signals
→ Memory Context
```

每个 AgentRun 在首次 Dispatch 前从权威 SQLite 选择并冻结一个 Memory Context。
ContextManifest 至少保存：

```text
memoryId
revisionId
scope/kind applicability metadata
selectionReason
memoryFormatterVersion
rendered Memory Context or immutable payload inclusion
memoryContextDigest
```

同一个 AgentRun 的 retry、Core restart 或 Runtime recovery 复用原冻结内容与
digest，不能从当前 Memory Library 重新组装。Memory 的后续 add、revise、
retire、reactivate、supersede 或 forget 只影响尚未冻结的新 AgentRun。

ADR-0027 的 Forget 不重写已完成 AgentRun 的 ContextManifest；历史输入可以继续
证明该 Run 当时使用过某个 Revision，但不能成为新 Run 的 Memory 来源。

具体 eligibility、召回、排序和预算算法由 v0.10 版本协议另行定义。

<a id="adr-0031-consequences"></a>
### Consequences

- 长期记忆可以逐 Run 更新，同时保持同一 AgentRun 的输入可重现。
- Current Input 与真实系统状态明确高于历史指导，减少陈旧记忆支配当前工作的
  风险。
- ContextManifest 和 formatter 需要新增版本化字段、摘要和 Inspector 展示。
- Forget 后的历史 Run 仍可能显示旧 Memory Context；UI 必须解释这是不可变执行
  历史，不是有效记忆。
- Memory Context 消耗模型预算，需要确定性选择和严格上限。

<a id="adr-0031-rejected-alternatives"></a>
### Rejected Alternatives

- 把全部 Memory 加入 System Prompt：权威过高，且无法逐 AgentRun 冻结更新。
- 把 Memory 加入 Session Charter：把动态用户内容误作稳定协作契约，并可能要求
  Native Session 重建。
- Runtime Resume 时查询最新 Memory：同一个 AgentRun 会获得不同输入。
- Run 执行中热更新 Memory：破坏重试、审计和行为解释。
- 让 Memory 覆盖当前输入或 repository 状态：历史指导不能成为当前事实真源。

<a id="adr-0031-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0016: Multi-Runtime Execution Boundary v2](../v0.06/decisions.md#adr-0016)
- [ADR-0027: Memory-Domain Forgetting](decisions.md#adr-0027)
- [ADR-0030: SQLite Memory Authority](decisions.md#adr-0030)
<!-- legacy-adr-body:end id=ADR-0031 -->
<!-- legacy-adr:end id=ADR-0031 -->

<!-- legacy-adr:begin id=ADR-0032 source-file-sha256=ef782813384e243cc60ec3ce08790812b2ba6216c0bd344ceb73d361cb18e3c0 -->
<a id="adr-0032"></a>

## ADR-0032: User-Authorized Live Memory Projection

迁移时原路径：`docs/adr/0032-user-authorized-live-memory-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0032
title: "User-Authorized Live Memory Projection"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: [ADR-0020, ADR-0030, ADR-0031]
superseded_by: ADR-0053
```

<!-- legacy-adr-body:begin id=ADR-0032 -->
<a id="adr-0032-context"></a>
### Context

ADR-0020 established user-only formal Memory authority and assumed changes would affect only
future AgentRuns. ADR-0030 made SQLite authoritative and prohibited Agent dependence on Markdown.
ADR-0031 then froze selected Memory bodies into every AgentRun prompt.

Preloading bodies consumes token even when a task does not need long-term memory. The selected
product behavior is instead to provide paths and guidance, allowing each Runtime Agent to decide
when to use its native file-reading tools. This intentionally treats a Memory read like other
tool-time local state: an active Run can observe a newer projection when it reads later.

<a id="adr-0032-decision"></a>
### Decision

<a id="adr-0032-user-authority-remains-exclusive"></a>
#### User authority remains exclusive

Only authenticated user commands create or revise formal Memory or change its Lifecycle.
Agents can submit fenced MemoryProposals but cannot make them effective. Proposal success,
Default Lead status, model confidence, repetition or Agent agreement never substitutes for user
confirmation. User-initiated management does not require a Proposal.

All formal writes use ADR-0001 typed commands, expected versions, idempotency and redacted
events. Renderer, Agent and projection files cannot write authoritative state directly.

<a id="adr-0032-sqlite-authority-and-live-markdown-projection"></a>
#### SQLite authority and live Markdown projection

The existing SQLite database remains the sole source of truth for Memory, MemoryRevision,
MemoryProposal, MemorySupersession and their bounded text. Small Memory text remains in SQLite,
not Managed Blob.

Lumen projects current authorized state into deterministic read-only Markdown under private
userData. The files are disposable, atomically replaceable and rebuilt after missing, stale,
corrupt or digest-mismatched observations. They are never reverse-parsed, never authoritative,
and never placed in a project or Git.

Projection runs after the SQLite transaction through best-effort Wake plus stable reconciliation.
A file failure does not roll back a committed Memory and must produce visible diagnostics.

<a id="adr-0032-memory-guide-and-native-on-demand-reads"></a>
#### Memory Guide and native on-demand reads

AgentRun input includes a short `[MEMORY_GUIDE]` section containing:

- what long-term Memory is and its lower authority;
- when reading may help;
- exact paths for the Memory Projection files exposed to this AgentRun;
- the rule that Current Input, Work Brief, permissions, current collaboration and repository
  state override Memory.

The Guide contains no Memory body. The Agent chooses whether, when and which file to read through
the Runtime's native filesystem tools. Lumen does not create a per-Run Memory copy and does not
fall back to full prompt injection.

ContextManifest freezes the Guide text, exposed path list, Guide formatter version and projection
digests observed during materialization. It does not freeze Markdown contents and does not prove
that the Runtime or model read them. A later tool read may observe a projection changed by
add, revise, retire, reactivate, supersede or forget during the same AgentRun. The already frozen
prompt is not rewritten.

This relaxation applies only to native tool-time Memory reads. ADR-0049 continues to govern the
immutable Lumen prompt and its delivery. Runtime lacking reliable file-read capability or
permission reports Memory unavailable rather than receiving hidden inline content.

Lumen exposes only paths allowed by the current Agent and scope-selection protocol. Because
Runtime processes may execute with the same local OS user, those paths are not a Core-enforced
filesystem ACL against an Agent with broad native file permission. Strict isolation would require
a future broker or per-Run projection and is not claimed by this design.

Proposal provenance is never rendered into Agent-readable Projection. Forgotten content is
removed from the next projection, but text already read into a Native Session or copied by a
Runtime remains outside Memory-Domain erasure under ADR-0027.

<a id="adr-0032-consequences"></a>
### Consequences

- Tasks that do not need Memory pay only for a small Guide, not all selected bodies.
- Agents can use their native reading strategies and inspect only the scope files they judge
  relevant.
- Same-Run Memory observation is no longer byte-reproducible: the frozen prompt is stable, while
  later native file reads can see current projection state.
- Projection availability and Adapter filesystem permission become part of effective Memory
  capability; unsupported paths receive no automatic inline fallback.
- Scope path exposure is enforced by Core, but confidentiality against deliberate sibling-path
  traversal depends on Runtime filesystem permissions rather than SQLite authorization.
- SQLite remains the only write truth, so live reads cannot make external Markdown edits
  authoritative.

<a id="adr-0032-rejected-alternatives"></a>
### Rejected Alternatives

- Injecting selected Memory bodies into every AgentRun: consumes token before relevance is known.
- Creating immutable per-Run Memory files: preserves deterministic reads but adds private copies,
  cleanup and storage work not desired for this product behavior.
- Treating Markdown as writable truth: breaks transactional authority and user confirmation.
- Rebuilding the frozen prompt after Memory changes: violates ADR-0049 input delivery.
- Silently falling back to body injection when file tools fail: makes Runtime behavior and token
  cost unpredictable.
- Claiming path exposure is a filesystem security sandbox: Agents may share the local user's OS
  permissions.

<a id="adr-0032-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0016: Multi-Runtime Execution Boundary v2](../v0.06/decisions.md#adr-0016)
- [ADR-0027: Memory-Domain Forgetting](decisions.md#adr-0027)
- [Superseded ADR-0020](decisions.md#adr-0020)
- [Superseded ADR-0030](decisions.md#adr-0030)
- [Superseded ADR-0031](decisions.md#adr-0031)
<!-- legacy-adr-body:end id=ADR-0032 -->
<!-- legacy-adr:end id=ADR-0032 -->

<!-- legacy-adr:begin id=ADR-0033 source-file-sha256=3caf6c0e1b0193fe1b5f2d6967995058fc2acd4072930ce22382b5c2e993d530 -->
<a id="adr-0033"></a>

## ADR-0033: Advisory Memory Review v2

迁移时原路径：`docs/adr/0033-advisory-memory-review-v2.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0033
title: "Advisory Memory Review v2"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: [ADR-0028]
superseded_by: ADR-0052
```

<!-- legacy-adr-body:begin id=ADR-0033 -->
<a id="adr-0033-context"></a>
### Context

ADR-0028 correctly made Review advisory and rejected `validFrom`/`validUntil`, but assumed a
new Revision could affect only AgentRuns whose ContextManifest had not been frozen. ADR-0032
replaces body injection with live Markdown reads: the frozen prompt remains immutable, while an
active Run may use its native file tool later and observe a newer Projection.

The time and Review model must retain explicit user governance without claiming that tool-time
filesystem observations are frozen by ADR-0049.

<a id="adr-0033-decision"></a>
### Decision

MemoryRevision is created when the user's authoritative command commits. Its `createdAt` is also
the confirmation time; v0.10 does not store a duplicate `acceptedAt`.

A new Revision does not rewrite an already frozen AgentRun prompt. It is projected after commit,
and an active AgentRun that later reads the live Memory Projection may observe it. Content already
read into a Native Session is not hot-replaced.

v0.10 does not support `validFrom` or `validUntil`. Future activation and automatic expiry remain
outside Memory; they belong in Current Input, Task or another natural domain object.

Memory has an optional `reviewAfter`:

```text
lesson      → current Revision create/revise + 90 days by default
preference  → null by default
agreement   → null by default
```

The user may schedule Review for any Kind. `now >= reviewAfter` only derives a Read Side
“review suggested” state. It does not change Lifecycle, Revision, Projection eligibility, create
a Proposal, send a message, create a Task, start an AgentRun or wake a Runtime.

Review may lead to an explicit reschedule, revision, retire or forget command.

<a id="adr-0033-consequences"></a>
### Consequences

- Time alone never changes Memory authority or applicability.
- Lesson receives a default governance reminder without automatic expiry.
- Active Runs may observe a newly projected Revision if they choose to read after the update;
  only the frozen prompt remains byte-stable.
- v0.10 cannot express scheduled Memory activation or expiry.
- Confirmation time remains represented by one Revision timestamp.

<a id="adr-0033-rejected-alternatives"></a>
### Rejected Alternatives

- Retaining ADR-0028's future-Run-only claim: contradicts the selected live Projection behavior.
- `validFrom` or `validUntil`: makes clock time silently change long-term behavior.
- Review automatically retiring or deleting Memory: bypasses explicit user governance.
- Rewriting frozen AgentRun prompts after a Revision: violates ADR-0049.
- Creating a per-Run Memory snapshot solely to preserve the old timing claim: rejected by
  ADR-0032's on-demand live-read model.

<a id="adr-0033-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0032: User-Authorized Live Memory Projection](decisions.md#adr-0032)
- [Superseded ADR-0028](decisions.md#adr-0028)
<!-- legacy-adr-body:end id=ADR-0033 -->
<!-- legacy-adr:end id=ADR-0033 -->

<!-- legacy-adr:begin id=ADR-0034 source-file-sha256=50c84d4bec1b3dde1a7d6419285fba205134f7060b5941639eb3048b444ad1c5 -->
<a id="adr-0034"></a>

## ADR-0034: Agent-Applicable Relationship Projection

迁移时原路径：`docs/adr/0034-agent-applicable-relationship-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0034
title: "Agent-Applicable Relationship Projection"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0035
```

<!-- legacy-adr-body:begin id=ADR-0034 -->
<a id="adr-0034-context"></a>
### Context

ADR-0023 makes every Relationship pair transparent to the user and both AgentProfiles while
using Direction only to express whose behavior a Memory addresses. Rendering the complete pair
into both Agents' default files would nevertheless present `directed(B → A)` to A as routine
guidance even though it applies to B. Visibility and default applicability therefore need separate
read views.

ADR-0032 also requires Memory Guide to stay short and expose live projections for native
file-tool reads. Listing one exact Relationship file path per Camp member would make Guide and
ContextManifest path lists grow with Camp size even though the Agent can enumerate a directory
with its existing Runtime tools.

<a id="adr-0034-decision"></a>
### Decision

For an AgentRun whose current AgentProfile is A in Camp C, Memory Guide exposes:

- one Hearth Projection file;
- one Companion(A) Projection file;
- one live Relationship Projection Directory specific to `(C, A)`.

The Guide provides the exact directory root and its meaning; it does not enumerate child files.
ADR-0032's exposed path list therefore contains the Relationship directory root as one location.
ContextManifest freezes that root, not the directory's child-file list or contents. The directory
is a disposable live projection and never a per-Run copy.

For each other current member B of Camp C, A's default pair view contains only active:

```text
mutual(A, B)
directed(A → B)
```

It excludes `directed(B → A)` and does not automatically add Relationship pairs outside Camp C.
This is applicability filtering, not an ACL. The user-facing management view retains the complete
unordered pair, and both pair members remain authorized to inspect or search either direction
explicitly under ADR-0023.

Projection files remain derived from authoritative SQLite state and cannot be edited back into
Memory. Exact physical directory names, child filenames, empty-view behavior, directory digest
format and reconciliation mechanics are version protocol details, provided they preserve this
selection boundary.

<a id="adr-0034-consequences"></a>
### Consequences

- A receives only Relationship guidance that applies mutually or to A's own behavior by default.
- B's one-way obligations are not duplicated into A's routine context, while neither direction
  becomes a hidden dossier.
- Memory Guide remains bounded to a Relationship directory root instead of growing by one path
  per Camp member.
- Runtime Agents must enumerate or search the exposed directory before choosing a pair file.
- Projector and tests need distinct `(Camp, AgentProfile)` Relationship views in addition to the
  complete pair representation used by user management.
- Camp membership and live Memory changes can alter directory contents without rewriting the
  frozen Guide; a completed prompt remains reproducible, while later native reads remain live.

<a id="adr-0034-rejected-alternatives"></a>
### Rejected Alternatives

- Rendering both directed orientations for A: confuses transparency with behavioral
  applicability and wastes reading context.
- Hiding reverse-directed content from A everywhere: turns Direction into an ACL and violates
  pair transparency.
- Listing every pair file in Memory Guide: makes prompt and manifest path data scale with Camp
  size.
- Exposing one global directory containing A's pairs outside the current Camp: introduces
  unrelated collaborators into the Run's default memory surface.
- Creating a per-Run directory snapshot: restores immutable reads at the cost of copies and
  cleanup already rejected by ADR-0032.

<a id="adr-0034-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0019: Application-Global Memory Ownership](decisions.md#adr-0019)
- [ADR-0023: Transparent Relationship Direction](decisions.md#adr-0023)
- [ADR-0032: User-Authorized Live Memory Projection](decisions.md#adr-0032)
<!-- legacy-adr-body:end id=ADR-0034 -->
<!-- legacy-adr:end id=ADR-0034 -->

<!-- legacy-adr:begin id=ADR-0035 source-file-sha256=38ff31c637dfa933182a473635bb02087180493caa2a75b377caf7692778d4e7 -->
<a id="adr-0035"></a>

## ADR-0035: User-Transparent, Agent-Applicable Relationship Memory

迁移时原路径：`docs/adr/0035-user-transparent-agent-applicable-relationship-memory.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0035
title: "User-Transparent, Agent-Applicable Relationship Memory"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: [ADR-0023, ADR-0034]
superseded_by: ADR-0068
```

<!-- legacy-adr-body:begin id=ADR-0035 -->
<a id="adr-0035-context"></a>
### Context

ADR-0023 treated one unordered Relationship pair as fully visible to the user and both
AgentProfiles, even when Direction made a Memory applicable to only one Agent. ADR-0034 filtered
each Agent's default projection by applicability but retained an explicit structured search path
for the reverse direction.

That produces two Agent read models: native reads of an applicability-filtered Markdown directory
and structured SQLite search of the complete pair. Besides adding a second tool and response
format, the search path lets routine Agent use bypass the deliberately narrow file view. The
selected v0.10 behavior is simpler: users govern the complete pair, while Agents receive only the
content that applies to their own behavior through native file reads.

<a id="adr-0035-decision"></a>
### Decision

Relationship Scope remains an immutable unordered pair of AgentProfiles. The authenticated user
can view, search and govern the complete pair through the Memory management Read Side.

Each Relationship Memory has an immutable Direction:

```text
mutual

directed {
  actorAgentProfileId,
  counterpartyAgentProfileId
}
```

For pair `(A, B)`, `mutual` enters both Agents' supported read views.
`directed(A → B)` enters only A's view when A collaborates with B; it does not enter B's view.
Changing mutual/directed or reversing actor and counterparty creates a new Memory under ADR-0022.

For an AgentRun of A in Camp C, Memory Guide exposes one live Relationship Projection Directory
specific to `(C, A)`, rather than enumerating one file per member. For every other current member
B, the corresponding file contains only active:

```text
mutual(A, B)
directed(A → B)
```

Pairs outside C and `directed(B → A)` are absent. Memory Guide and ContextManifest freeze the
directory root, not child names, child contents or a per-Run snapshot.

v0.10 exposes no `memory.search` or other structured Memory read tool to Agents. Their supported
Memory read surface consists solely of the Hearth file, their own Companion file and their
applicability-filtered Relationship directory, read with Runtime-native filesystem tools. The
complete pair is available only to the user-facing Memory management Read Side.

This boundary does not claim OS-level isolation. As established by ADR-0053, a Runtime process
with broad local filesystem permission may traverse unadvertised userData paths; Lumen neither
advertises that as supported behavior nor treats paths as a Core security sandbox.

Direction may narrow Agent delivery but must not create a user-hidden record. Relationship Memory
still cannot store personality labels, capability scores, behavior dossiers, secrets or temporary
task state.

<a id="adr-0035-consequences"></a>
### Consequences

- Agents have one Memory read mechanism and one applicability model: live projected files.
- A does not spend context on B's one-way obligations and cannot use a Lumen Memory search tool
  to retrieve them.
- The user remains the sole party with a complete, searchable pair view and mediates corrections
  involving content hidden from one Agent's supported read surface.
- A rule intended to guide both Agents must be stored as `mutual`; two directed rules are not
  automatically treated as a shared agreement.
- Memory Guide remains bounded to one Relationship directory root regardless of Camp size.
- The only v0.10 Agent-facing Memory mutation surface can be designed around
  `memory.propose_change`; user lifecycle and management operations stay outside Agent tools.

<a id="adr-0035-rejected-alternatives"></a>
### Rejected Alternatives

- Keeping `memory.search` for explicit complete-pair inspection: creates a second Agent read
  protocol and bypasses the applicability-filtered projection.
- Giving both Agents the complete pair file: exposes reverse-direction material during routine
  reads and wastes context.
- Listing every collaborator file in Memory Guide: makes prompt metadata grow with Camp size.
- Making Relationship Scope itself directional: duplicates pair identity and conflates ownership
  with Agent delivery.
- Hiding directed content from the user: undermines user governance and creates an unauditable
  Agent dossier.

<a id="adr-0035-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0019: Application-Global Memory Ownership](decisions.md#adr-0019)
- [ADR-0022: Immutable Memory Scope](decisions.md#adr-0022)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](../v0.13/decisions.md#adr-0053)
- [Superseded ADR-0023](decisions.md#adr-0023)
- [Superseded ADR-0034](decisions.md#adr-0034)
<!-- legacy-adr-body:end id=ADR-0035 -->
<!-- legacy-adr:end id=ADR-0035 -->

<!-- legacy-adr:begin id=ADR-0036 source-file-sha256=cc445abf48a7a64a763be13b1351017c5fa561a77d4e9fe927a6cd389ee55321 -->
<a id="adr-0036"></a>

## ADR-0036: Agent-Bounded Memory Proposal Scope

迁移时原路径：`docs/adr/0036-agent-bounded-memory-proposal-scope.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0036
title: "Agent-Bounded Memory Proposal Scope"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
```

<!-- legacy-adr-body:begin id=ADR-0036 -->
<a id="adr-0036-context"></a>
### Context

Memory Library is application-global, while an Agent acts through one current fenced AgentRun in
one Camp. User confirmation prevents a Proposal from becoming effective automatically, but it
does not justify letting an Agent create durable suggestions about unrelated Companions or
relationships it is not currently participating in. Such Proposals would pollute the user's
governance queue and let guessed application-level IDs cross the collaboration boundary.

At the same time, limiting every Agent to its own Companion scope would prevent useful Hearth
suggestions and collaboration lessons involving another current Camp member.

<a id="adr-0036-decision"></a>
### Decision

For a current AgentProfile A acting through a fenced AgentRun in Camp C,
`memory.propose_change` may target only:

```text
hearth
companion(A)
relationship(A, B)  where B is another current CampMember of C
```

This boundary applies to both `add` and `revise`. A revise Proposal has the additional
requirements that the target active Memory is present in A's supported Projection and that the
request carries its exact `memoryId + baseRevisionId`.

An Agent cannot target Companion(B), Relationship(B, D), a Relationship pair outside the source
Camp, or a reverse-directed Memory omitted from A's applicability view. Guessing a Memory ID does
not expand this boundary.

Gateway derives A, Camp C, AgentRun and Execution Epoch from the Native Binding and current run
resolution. It validates current Camp membership and fencing while handling the command; these
identity facts are not model-supplied parameters. Losing a required membership or current Epoch
causes the Proposal request to fail without persistence.

This restriction applies only to Agent Proposals. An authenticated user can directly govern every
legal Scope in the application-global Memory Library through user management commands.

This ADR does not decide which Relationship Directions an `add` Proposal by A may request within
an otherwise valid pair; v0.10 protocol must resolve that separately.

<a id="adr-0036-consequences"></a>
### Consequences

- An Agent can suggest home-wide principles, its own user partnership memories and collaboration
  memories involving a current peer.
- Agents cannot create durable governance noise about unrelated AgentProfiles or Camps.
- Revise authorization matches the material Lumen intentionally exposes to the Agent.
- Gateway needs transactional membership, Run/Epoch and target-Scope validation in addition to
  Capability and schema validation.
- User management remains broader than Agent Proposal authority.

<a id="adr-0036-rejected-alternatives"></a>
### Rejected Alternatives

- Letting any Agent propose against the whole application Memory Library: permits unrelated and
  guessed-ID targets.
- Limiting A to Companion(A): blocks valid Hearth and current-collaborator lessons.
- Allowing any Relationship pair containing A across all Camps: makes the current Camp boundary
  irrelevant and permits unsolicited cross-context proposals.
- Trusting proposer, Camp or membership IDs from model arguments: bypasses Native Binding and
  fencing guarantees.
- Applying the same restriction to the user: confuses Agent proposal safety with user ownership.

<a id="adr-0036-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0019: Application-Global Memory Ownership](decisions.md#adr-0019)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](../v0.13/decisions.md#adr-0053)
- [ADR-0035: User-Transparent, Agent-Applicable Relationship Memory](decisions.md#adr-0035)
<!-- legacy-adr-body:end id=ADR-0036 -->
<!-- legacy-adr:end id=ADR-0036 -->

<!-- legacy-adr:begin id=ADR-0037 source-file-sha256=463ca4d8be952ba62a4241e9c69eb612279b4a6a29665c97fddfafcc5641fff4 -->
<a id="adr-0037"></a>

## ADR-0037: Actor-Bounded Relationship Proposal Direction

迁移时原路径：`docs/adr/0037-actor-bounded-relationship-proposal-direction.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0037
title: "Actor-Bounded Relationship Proposal Direction"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
```

<!-- legacy-adr-body:begin id=ADR-0037 -->
<a id="adr-0037-context"></a>
### Context

ADR-0036 allows Agent A to create an add Proposal for Relationship(A, B) when B is another
current member of the source Camp, but deliberately leaves the requested Direction unresolved.
Allowing A to propose `directed(B → A)` would let one Agent assign a durable one-way obligation
to another Agent. User confirmation prevents automatic effect, yet the Proposal itself would
still frame B's future conduct without coming from B.

Forbidding A from proposing `mutual` would be unnecessarily restrictive: mutual content is
explicitly presented as a suggestion and the user remains the sole formal authority.

<a id="adr-0037-decision"></a>
### Decision

Within a Relationship(A, B) target authorized by ADR-0036, Agent A may create an add Proposal only
with:

```text
mutual(A, B)
directed(A → B)
```

Agent A cannot propose `directed(B → A)`. A one-way rule for B must instead be proposed from a
current fenced AgentRun of B or created directly by the user.

For `directed`, Gateway derives actor A from the current Native Binding and AgentRun. The model
does not provide an actor ID; it only selects the direction form and a counterparty that Gateway
validates as another current member of the source Camp.

Either pair member may propose `mutual`. The other Agent does not gain a separate acceptance or
veto state: a MemoryProposal remains non-authoritative until the user accepts it, and the user is
the only formal confirmation authority.

Revise Proposals cannot change Direction. Agent A can revise only a mutual or
`directed(A → B)` Memory already present in A's supported Projection, subject to
`memoryId + baseRevisionId` concurrency checks.

<a id="adr-0037-consequences"></a>
### Consequences

- Agents can suggest shared collaboration rules and volunteer obligations for themselves.
- One Agent cannot create durable Proposal queue items that unilaterally assign another Agent's
  behavior.
- Gateway schema can omit actor ID and derive it from trusted execution identity.
- Mutual proposals still affect both Agent projections after user acceptance without introducing
  an Agent-consensus workflow.
- Users retain direct authority to create or correct any legal Direction.

<a id="adr-0037-rejected-alternatives"></a>
### Rejected Alternatives

- Allowing A to propose both directed orientations: permits A to assign B a one-way obligation.
- Allowing only `directed(A → B)`: prevents Agents from suggesting genuinely shared agreements.
- Requiring B to accept a mutual Proposal: creates a second authority and a distributed approval
  state inconsistent with user governance.
- Taking actor ID from model arguments: permits identity spoofing and weakens Gateway fencing.
- Making all Relationship Memory mutual: loses asymmetric but legitimate collaboration rules.

<a id="adr-0037-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0022: Immutable Memory Scope](decisions.md#adr-0022)
- [ADR-0035: User-Transparent, Agent-Applicable Relationship Memory](decisions.md#adr-0035)
- [ADR-0036: Agent-Bounded Memory Proposal Scope](decisions.md#adr-0036)
<!-- legacy-adr-body:end id=ADR-0037 -->
<!-- legacy-adr:end id=ADR-0037 -->

<!-- legacy-adr:begin id=ADR-0038 source-file-sha256=ee9eba675db125f6b1983f0cc9b4b8f8298983a7f72f09a7e945aba40e17a97c -->
<a id="adr-0038"></a>

## ADR-0038: Memory Proposal Staleness

迁移时原路径：`docs/adr/0038-memory-proposal-staleness.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0038
title: "Memory Proposal Staleness"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
```

<!-- legacy-adr-body:begin id=ADR-0038 -->
<a id="adr-0038-context"></a>
### Context

A revise MemoryProposal freezes the `baseRevisionId` that the Agent read from live Markdown.
Another user command can publish a newer Revision between file read, Proposal submission and later
user acceptance. ADR-0052 prevents an old Proposal from overwriting a newer Revision but does not
distinguish a base that is already obsolete at submission from one that becomes obsolete after a
valid Proposal has been saved.

Persisting an immediately stale Proposal creates governance noise with no valid acceptance path.
Deleting a once-valid Proposal when it later becomes stale would instead erase useful proposal
provenance and hide the real concurrency event.

<a id="adr-0038-decision"></a>
### Decision

Gateway validates a revise Proposal's `baseRevisionId` against the authoritative
`currentRevisionId` in the same transaction that would save the Proposal. If they differ, the
request returns a conflict and persists no MemoryProposal.

If the base is current when saved but the Memory later advances to another Revision, the Proposal
remains `pending` and its Read Side derives `stale = true`. Stale is not a fourth Proposal status.

A stale Proposal cannot be accepted, edited and accepted, rebased in place or have its frozen base
changed. The user may reject it. Adopting any part of the candidate requires a new Proposal based
on the latest Revision.

Acceptance repeats the `baseRevisionId == currentRevisionId` Compare-and-Set check in its own
transaction. A race after a management read therefore still returns conflict without creating a
MemoryRevision or changing Proposal status.

This ADR addresses Revision drift. Lifecycle invalidation, source-object loss and Proposal
retention remain separate protocols.

<a id="adr-0038-consequences"></a>
### Consequences

- The governance queue never stores a revise Proposal known to be unusable at creation.
- A once-valid suggestion remains auditable if a later Revision makes it stale.
- Proposal status stays closed to `pending | accepted | rejected`; stale remains derived.
- Rebase always requires a new user-visible candidate and cannot silently reinterpret Agent text.
- Submission and acceptance both need transactional current-Revision checks.

<a id="adr-0038-rejected-alternatives"></a>
### Rejected Alternatives

- Saving an already stale Proposal: creates an immediately unactionable pending item.
- Automatically rebasing candidate text onto the latest Revision: changes what the Agent actually
  proposed and risks semantic merge errors.
- Deleting a Proposal when it later becomes stale: loses provenance and conceals concurrency.
- Adding `stale` as a persisted status: duplicates a condition derivable from immutable base and
  current Revision.
- Accepting with last-write-wins: allows old Agent context to overwrite newer user-authorized
  Memory.

<a id="adr-0038-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0052: Explicit Memory Revision Authority](../v0.13/decisions.md#adr-0052)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](../v0.13/decisions.md#adr-0053)
<!-- legacy-adr-body:end id=ADR-0038 -->
<!-- legacy-adr:end id=ADR-0038 -->

<!-- legacy-adr:begin id=ADR-0039 source-file-sha256=1099ca42b19f859eb979918e071d64076f22dc398fed9df8efc2fbce83b0ba41 -->
<a id="adr-0039"></a>

## ADR-0039: Memory Proposal Capability

迁移时原路径：`docs/adr/0039-memory-proposal-capability.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0039
title: "Memory Proposal Capability"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
```

<!-- legacy-adr-body:begin id=ADR-0039 -->
<a id="adr-0039-context"></a>
### Context

MemoryProposal is non-authoritative and requires user confirmation, but it is still durable
application-global state that can create user review work. Merely exposing a Team MCP tool to a
Runtime is not a Core authorization boundary under ADR-0014. Lumen therefore needs an explicit
business Capability controlling which AgentRuns may add items to the proposal queue.

The feature should work by default for active Companions without requiring every user to discover
and enable a new setting, while preserving the existing AgentProfile default and CampMember
override mechanisms for users who want a quieter or more restricted Agent.

<a id="adr-0039-decision"></a>
### Decision

Define one business Capability:

```text
memory.propose_change
```

Every active AgentProfile receives it in the default capability configuration. A user may revoke
it in the AgentProfile default configuration or through a CampMember override. Effective
Capability is materialized and frozen into each AgentRun under the existing collaboration
configuration protocol; configuration changes affect later Runs and do not rewrite the current
Run.

Every `memory.propose_change` invocation must resolve the current Native Binding, AgentRun and
Execution Epoch, then verify the frozen effective configuration contains
`memory.propose_change`. Missing or ambiguous identity, a fenced Run, inactive membership or
missing Capability fails closed before a Proposal is persisted.

Tool discovery, Team MCP injection, Default Lead status, model confidence, repeated observations
and earlier successful calls never substitute for Capability. Capability authorizes only saving
the bounded `add` and `revise` Proposals defined by ADR-0036 and ADR-0037.

It does not authorize accepting a Proposal, creating or selecting a MemoryRevision, changing
Lifecycle, creating Supersession or reading broader Memory state. Authenticated user management
commands do not depend on Agent Capability.

<a id="adr-0039-consequences"></a>
### Consequences

- Long-term Memory proposals work by default for active AgentProfiles.
- Users can disable proposal creation globally for one Companion or within a particular Camp.
- Existing per-Run capability freezing and fail-closed Gateway checks are reused across Adapters.
- Seeing the tool does not imply that a call will be authorized.
- Proposal authority remains strictly weaker than user Memory authority.
- Migration must add the new default Capability without overwriting user-customized capability
  choices.

<a id="adr-0039-rejected-alternatives"></a>
### Rejected Alternatives

- Treating Tool visibility as permission: violates ADR-0014 and cannot survive Runtime variance.
- Requiring no Capability because Proposals are non-effective: ignores durable queue spam and
  governance cost.
- Defaulting the Capability off: makes the core v0.10 behavior undiscoverable without setup.
- Granting it only to Default Lead: role does not imply Memory judgment or broader authority.
- Letting Capability accept Proposals: would make Agent authority equivalent to the user's.
- Applying Agent Capability to user commands: confuses delegated Agent action with ownership.

<a id="adr-0039-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [Superseded ADR-0020](decisions.md#adr-0020)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](../v0.13/decisions.md#adr-0053)
- [ADR-0036: Agent-Bounded Memory Proposal Scope](decisions.md#adr-0036)
- [ADR-0037: Actor-Bounded Relationship Proposal Direction](decisions.md#adr-0037)
<!-- legacy-adr-body:end id=ADR-0039 -->
<!-- legacy-adr:end id=ADR-0039 -->

<!-- legacy-adr:begin id=ADR-0040 source-file-sha256=0790ba2694708c57ca2e2c200ce3a941a4efe19fe302ff6885fafe24a0d7fd90 -->
<a id="adr-0040"></a>

## ADR-0040: Terminal Memory Proposal Retention

迁移时原路径：`docs/adr/0040-terminal-memory-proposal-retention.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0040
title: "Terminal Memory Proposal Retention"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
```

<!-- legacy-adr-body:begin id=ADR-0040 -->
<a id="adr-0040-context"></a>
### Context

Accepted and rejected MemoryProposals have different audit and privacy value. For an accepted
Proposal, retaining the Agent's original candidate lets the user compare what was proposed with
the final MemoryRevision, especially when the user edited before accepting. For a rejected
Proposal, retaining the declined text indefinitely stores content the user explicitly chose not
to adopt and grows terminal history without supporting future Memory.

A single time-to-live for both states would either erase useful accepted provenance or retain
rejected content longer than necessary. Proposal metadata is still useful for auditing who
proposed from which Camp/Run/Epoch even when candidate text is gone.

<a id="adr-0040-decision"></a>
### Decision

When a Proposal is accepted:

- retain its original canonical candidate body;
- retain `proposalId`, proposer, proposed time and source Camp/AgentRun/Epoch;
- set terminal status accepted;
- link the created MemoryRevision back through `createdFromProposalId`.

If the user edits before acceptance, the Proposal keeps the Agent's original candidate while the
MemoryRevision stores only the user's final canonical body. No separate Acceptance object is
created.

When a Proposal is rejected, the same transaction:

- sets terminal status rejected;
- irreversibly clears the candidate body;
- retains only `proposalId`, proposer, proposed time, source Camp/AgentRun/Epoch and terminal
  status.

Neither terminal metadata record expires automatically.

If a Memory created or revised from an accepted Proposal is forgotten, ADR-0027's forgetting
transaction also clears the linked accepted Proposal candidate body. Retiring, superseding or
later revising the Memory does not clear that body.

Event log, receipts, diagnostics and permanent command results never copy Proposal candidate
text. Existing redacted command audit remains the only user-action audit; this decision does not
introduce Origin, Evidence or Acceptance entities.

<a id="adr-0040-consequences"></a>
### Consequences

- Users can audit the difference between Agent candidate and final authorized Revision.
- Rejected text does not become indefinite shadow Memory.
- Proposal metadata remains useful for attribution after candidate clearing.
- Rejection and Memory Forget need transactional body clearing, not asynchronous best effort.
- Terminal history can grow in row count but not in rejected-body storage.
- Forget must follow `createdFromProposalId` links without deleting the minimal Proposal record.

<a id="adr-0040-rejected-alternatives"></a>
### Rejected Alternatives

- Retaining both accepted and rejected bodies forever: keeps declined content unnecessarily.
- Clearing both bodies immediately: removes the accepted proposal-to-revision comparison.
- Applying one automatic TTL: makes audit depend on elapsed time rather than user governance.
- Copying accepted candidate into an Acceptance object: duplicates the Proposal/Revision model.
- Clearing candidate asynchronously: leaves a privacy window after explicit rejection or Forget.
- Deleting the whole Proposal row: loses stable attribution and command-history linkage.

<a id="adr-0040-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0025: Proposal-Scoped Memory Provenance](decisions.md#adr-0025)
- [ADR-0027: Memory-Domain Forgetting](decisions.md#adr-0027)
- [ADR-0038: Memory Proposal Staleness](decisions.md#adr-0038)
<!-- legacy-adr-body:end id=ADR-0040 -->
<!-- legacy-adr:end id=ADR-0040 -->

<!-- legacy-adr:begin id=ADR-0041 source-file-sha256=1f3f8c82a047f3b24dd42ea3ad87f6bca9853898c8dfe5dedf428c81fa2e4496 -->
<a id="adr-0041"></a>

## ADR-0041: AgentProfile Status and Memory Independence

迁移时原路径：`docs/adr/0041-agent-profile-status-memory-independence.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0041
title: "AgentProfile Status and Memory Independence"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0057
```

<!-- legacy-adr-body:begin id=ADR-0041 -->
<a id="adr-0041-context"></a>
### Context

AgentProfile is a stable identity with `active`, `disabled` and `archived` states. Disabled or
archived profiles cannot participate in new execution but can later return to active. Companion
and Relationship Memory are application-global, long-lived records bound to that stable identity,
not to one Runtime or Camp membership.

Automatically retiring or forgetting Memory when a profile becomes inactive would turn a
reversible execution/configuration action into a hidden bulk Memory mutation. It would also make
reactivation ambiguous: Lumen would need either to revive old Memory automatically or silently
lose the partnership history.

<a id="adr-0041-decision"></a>
### Decision

AgentProfile status transitions never change:

- Memory Lifecycle;
- a Memory's current Revision, Scope, Kind or Direction;
- MemorySupersession;
- MemoryProposal status or retained content.

Active Companion and Relationship Memories remain active and continue to count against their
Active Memory Scope Capacity while a related AgentProfile is disabled or archived. The user may
continue to govern those Memories and accept or reject existing Proposals.

An inactive AgentProfile cannot have a new AgentRun, so Lumen produces no Companion projection
for it. It is also ineligible as a current collaborator in another Agent's Relationship
Projection Directory. This is projection eligibility, not a Memory Lifecycle transition.

When the AgentProfile returns to active and participates in an eligible Camp, projector exposes
the same currently active Memories again. Reactivation creates no MemoryRevision, Memory
reactivation event or Proposal.

Users who want profile deactivation to coincide with Memory retirement or forgetting must issue
those explicit Memory management commands separately. The UI may offer a clearly separated batch
workflow but cannot make it an implicit status side effect.

<a id="adr-0041-consequences"></a>
### Consequences

- Disabling an Agent cannot accidentally erase or retire long-term partnership history.
- Re-enabling an Agent restores applicable Memory without synthetic Revisions.
- Inactive identities can continue consuming active Scope Capacity until the user governs them.
- Projection selection must check current profile/member eligibility independently from Memory
  Lifecycle.
- Pending Proposal review remains possible after the proposing or scoped Agent becomes inactive.

<a id="adr-0041-rejected-alternatives"></a>
### Rejected Alternatives

- Automatically retiring all related Memory: conflates reversible profile state with user Memory
  governance.
- Automatically forgetting related Memory: makes a non-destructive profile action destructive.
- Excluding inactive Memory from capacity: lets active state later exceed limits on reactivation.
- Creating new Revisions on reactivation: invents content changes where none occurred.
- Automatically rejecting the profile's pending Proposals: discards user-owned review work.

<a id="adr-0041-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0019: Application-Global Memory Ownership](decisions.md#adr-0019)
- [ADR-0035: User-Transparent, Agent-Applicable Relationship Memory](decisions.md#adr-0035)
- [ADR-0036: Agent-Bounded Memory Proposal Scope](decisions.md#adr-0036)
<!-- legacy-adr-body:end id=ADR-0041 -->
<!-- legacy-adr:end id=ADR-0041 -->

<!-- legacy-adr:begin id=ADR-0042 source-file-sha256=6e44fa4c1b6998be33c1499f4d4bd7071d7a223e87cb268b76d12baa2c08e5f2 -->
<a id="adr-0042"></a>

## ADR-0042: Fail-Closed Memory Projection

迁移时原路径：`docs/adr/0042-fail-closed-memory-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0042
title: "Fail-Closed Memory Projection"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0068
```

<!-- legacy-adr-body:begin id=ADR-0042 -->
<a id="adr-0042-context"></a>
### Context

Memory Projection is a live, disposable read view rather than an immutable Run snapshot. After a
Memory is revised, retired, superseded or forgotten, a previously correct file can become stale.
If projector then fails, keeping the last-good file as an availability fallback can expose content
that SQLite no longer considers active or readable. This is especially harmful after Forget.

Deleting the path silently gives Runtime Agents no way to distinguish “no Memory” from a broken
projection. A small explicit unavailable file provides a clearer fail-closed result while keeping
the stable Guide path useful for recovery.

<a id="adr-0042-decision"></a>
### Decision

When projector knows an exposed Memory Projection is stale, corrupt, oversized or cannot be
rendered from authoritative SQLite, it must not intentionally continue presenting last-good
content as current.

It attempts to atomically publish a deterministic, body-free `UNAVAILABLE` Markdown sentinel at
the affected projection location. The sentinel:

- states that long-term Memory at this location is temporarily unavailable;
- tells the Agent not to rely on the Scope;
- may include a stable non-sensitive diagnostic code;
- contains no Memory body, Proposal candidate, previous entry list or source content.

Stable reconciliation continues retrying. When current projection rendering succeeds, projector
atomically replaces the sentinel with the deterministic current file without changing SQLite or
the frozen Memory Guide.

For Relationship directories, physical sentinel naming and directory-swap mechanics are version
protocol details, but known-stale children cannot be deliberately retained as fallback.

If the filesystem prevents both sentinel replacement and stale-file removal, Lumen records a
high-priority user-visible diagnostic and keeps retrying. It cannot guarantee that physical bytes
have disappeared during a total filesystem failure, but it must not mark the old digest current
or report projection health as successful.

Authoritative SQLite commands never roll back because projection or sentinel publication fails,
consistent with ADR-0001 and ADR-0053.

<a id="adr-0042-consequences"></a>
### Consequences

- Agents do not intentionally receive retired or forgotten last-good Memory as current context.
- A stable path can communicate unavailability and recover without a new AgentRun.
- Projection health must distinguish valid-empty, unavailable and stale-write-failed states.
- Projector needs atomic file replacement plus stable retry and high-priority diagnostics.
- Total filesystem failure remains an explicit physical limitation rather than a claimed erasure
  guarantee.
- Tests must inject render, size, rename, permission and disk failures around lifecycle changes.

<a id="adr-0042-rejected-alternatives"></a>
### Rejected Alternatives

- Serving last-good indefinitely: prioritizes availability over current Memory governance.
- Publishing a truncated or partial file: makes omissions invisible and breaks deterministic
  projection.
- Treating a missing file as an empty Memory set: hides failure from the Agent.
- Rolling back SQLite: violates the authoritative transaction boundary and couples Core to file
  I/O.
- Claiming physical deletion under any filesystem failure: cannot be guaranteed by the
  application.

<a id="adr-0042-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0027: Memory-Domain Forgetting](decisions.md#adr-0027)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](../v0.13/decisions.md#adr-0053)
<!-- legacy-adr-body:end id=ADR-0042 -->
<!-- legacy-adr:end id=ADR-0042 -->

<!-- legacy-adr:begin id=ADR-0043 source-file-sha256=a642dd58ab996217a85865e383e49142f76a65250426c5536090b8debc2e0b4e -->
<a id="adr-0043"></a>

## ADR-0043: Memory Secret Filter

迁移时原路径：`docs/adr/0043-memory-secret-filter.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0043
title: "Memory Secret Filter"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0054
```

<!-- legacy-adr-body:begin id=ADR-0043 -->
<a id="adr-0043-context"></a>
### Context

Memory persists across Camps and may be projected into files that Runtime Agents read with native
filesystem tools. A credential accidentally proposed or directly entered would therefore outlive
its source context and be copied into multiple Agent-readable projections. User confirmation is
not an adequate exception for credentials: long-term Memory is the wrong storage domain for
secrets.

Ordinary personal information is different. Stable preferences and partnership agreements can
naturally mention personal context, and creating a generic sensitivity score or model-generated
profile would conflict with the closed Memory Kind model.

<a id="adr-0043-decision"></a>
### Decision

Core applies a non-overridable Memory Secret Filter to every canonical candidate body before any
MemoryProposal or MemoryRevision body is persisted. Covered write paths include:

- Agent add and revise Proposals;
- user direct add and revise;
- user-edited Proposal acceptance;
- any future import path that creates Memory content.

The filter rejects credential-class secrets such as passwords, API/access tokens, private keys
and authentication headers. User identity, Agent Capability, Scope and Kind cannot bypass it.
Users must redact the value and, where useful, store only a non-secret Lesson.

On rejection, no candidate body is persisted. Error results, event log, receipts, diagnostics,
telemetry and test snapshots contain only stable non-sensitive codes and never the matched value
or snippet.

v0.10 does not introduce a `sensitive` Memory Kind, risk score, inferred personal profile,
quarantine lifecycle or model-authored sensitivity field. Ordinary personal information remains
subject to the existing closed Kinds, explicit Scope, user confirmation and user-governed
revise/retire/forget operations.

Concrete high-confidence detectors and fixtures belong to the implementation security protocol.
Model classification cannot be persisted or treated as authoritative secret detection.

<a id="adr-0043-consequences"></a>
### Consequences

- Credentials cannot enter pending Proposals, SQLite Memory bodies or Markdown projections
  through supported writes.
- The same safety invariant applies to Agent and user commands.
- Some false positives require the user to redact or rephrase; there is no unsafe override.
- Ordinary personal context remains possible without building a personality or sensitivity
  dossier.
- Logging, diagnostics and tests need explicit redaction assertions.

<a id="adr-0043-rejected-alternatives"></a>
### Rejected Alternatives

- Filtering only on acceptance: leaves secrets persisted in pending Proposals.
- Allowing user override: turns Memory into an intentional credential store.
- Filtering only Agent input: user edits could still project secrets to every Runtime.
- Storing matched snippets for diagnostics: duplicates the secret into audit surfaces.
- Adding a generic sensitive status or score: expands the domain into subjective profiling.
- Relying on a model classifier: non-deterministic judgments cannot enforce Core writes.

<a id="adr-0043-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0024: Closed Memory Kinds](decisions.md#adr-0024)
- [ADR-0027: Memory-Domain Forgetting](decisions.md#adr-0027)
- [ADR-0032: User-Authorized Live Memory Projection](decisions.md#adr-0032)
<!-- legacy-adr-body:end id=ADR-0043 -->
<!-- legacy-adr:end id=ADR-0043 -->

<!-- legacy-adr:begin id=ADR-0044 source-file-sha256=f494c4f66fd2fc409ad391ca7759650e20217d3c9e66b13e364234301eec932c -->
<a id="adr-0044"></a>

## ADR-0044: Per-Proposal User Memory Confirmation

迁移时原路径：`docs/adr/0044-per-proposal-user-confirmation.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0044
title: "Per-Proposal User Memory Confirmation"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0053
```

<!-- legacy-adr-body:begin id=ADR-0044 -->
<a id="adr-0044-context"></a>
### Context

Memory persists across Camps and future AgentRuns. Although every Agent Proposal is
non-authoritative, a bulk-accept workflow could still turn an Agent's end-of-run summary into many
durable Memories with one user gesture. That would weaken the intended user-governed boundary and
encourage collection rather than selective stewardship.

Users still need to correct wording before acceptance and efficiently clear unwanted queue
items. Stale revise Proposals cannot safely be edited into acceptance because their frozen base no
longer represents current Memory.

<a id="adr-0044-decision"></a>
### Decision

Each pending MemoryProposal offers exactly these user decisions:

- accept the displayed final content;
- edit final content, then accept;
- reject.

Before acceptance, the UI presents the complete final body, Scope, Kind and Relationship
Direction where applicable. User-edited final content passes the same canonicalization, Secret
Filter, Scope/Kind, active capacity and concurrency checks as every other authoritative write.
Only the final confirmed value enters MemoryRevision; the original Agent candidate remains on the
accepted Proposal under ADR-0040.

Acceptance is always per Proposal. v0.10 provides no multi-select, select-all or batch acceptance.
The management UI may support batch rejection; each selected Proposal becomes rejected and has
its candidate body cleared according to ADR-0040.

A stale Proposal cannot be accepted, edited and accepted or rebased in place. The UI disables
those actions with an explicit reason. The user may reject it or create a new candidate against
the latest Revision.

Session-level ignore closes only the current prompt and performs no domain command. The Proposal
remains pending in Memory management.

Renderer interaction follows the accepted renderer UI rules: status is not color-only,
labels are visible, the safer action receives initial focus where applicable, keyboard/focus
behavior is complete and Day/Night behavior is identical.

<a id="adr-0044-consequences"></a>
### Consequences

- Every durable Memory change receives focused user review.
- Agents cannot induce bulk learning through a large proposal batch.
- Users can correct wording without losing the original Agent candidate audit.
- Bulk cleanup remains possible through rejection without bulk authority escalation.
- Stale conflict handling stays explicit and cannot be hidden by an editor.
- UI tests need single acceptance, edit validation, batch rejection, stale disabling and
  accessible focus coverage.

<a id="adr-0044-rejected-alternatives"></a>
### Rejected Alternatives

- Batch acceptance: makes durable learning too easy to approve without inspection.
- Accepting only Agent text verbatim: prevents users from correcting scope or wording.
- Treating ignore as rejection: conflates notification dismissal with governance.
- Editing a stale Proposal onto a new base: silently changes what concurrency state the Agent
  observed.
- Requiring another Agent to approve Relationship Memory: creates authority beyond the user.

<a id="adr-0044-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [UI 规范](../../ui/README.md)
- [ADR-0021: Atomic Memory and Immutable Revisions](decisions.md#adr-0021)
- [ADR-0038: Memory Proposal Staleness](decisions.md#adr-0038)
- [ADR-0040: Terminal Memory Proposal Retention](decisions.md#adr-0040)
- [ADR-0043: Memory Secret Filter](decisions.md#adr-0043)
<!-- legacy-adr-body:end id=ADR-0044 -->
<!-- legacy-adr:end id=ADR-0044 -->

<!-- legacy-adr:begin id=ADR-0045 source-file-sha256=491780bfd11597ca3db3900cf3f4539cd9922e6bd8505a1709688457dab908de -->
<a id="adr-0045"></a>

## ADR-0045: Normalized SQLite Memory Store

迁移时原路径：`docs/adr/0045-normalized-sqlite-memory-store.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0045
title: "Normalized SQLite Memory Store"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0070
```

<!-- legacy-adr-body:begin id=ADR-0045 -->
<a id="adr-0045-context"></a>
### Context

Lumen already commits authoritative domain state, expected-version concurrency, idempotent command
results and redacted audit events in one SQLite database. Memory adds stable entities, immutable
Revisions, non-authoritative Proposals, explicit Supersession and reconstructible filesystem
projections. Collapsing these relationships into one JSON document would create whole-library
write conflicts and weak constraints; replaying Memory from events would introduce a second
persistence architecture.

No released version before v0.10 has authoritative Memory records, so migration does not need to
infer durable knowledge from historical chats or repository files.

<a id="adr-0045-decision"></a>
### Decision

Add a normalized Memory Store to the existing `lumen.sqlite` with these table families:

```text
memory
memory_revision
memory_proposal
memory_supersession
memory_projection_observation
```

`memory` owns stable identity, immutable Scope/Kind/Direction, Lifecycle, selected current
Revision, Review scheduling, entity version and timestamps.

`memory_revision` stores immutable canonical body text, Memory identity, creation time and optional
`createdFromProposalId`.

`memory_proposal` stores add/revise candidate state, target/base where applicable, closed status,
proposer/time and weak source Camp/AgentRun/Epoch. Candidate body is nullable only for the clearing
rules established by ADR-0027 and ADR-0040.

`memory_supersession` stores immutable predecessor-to-successor relationships independently from
Lifecycle.

`memory_projection_observation` is derived recovery state for exposed location, formatter version,
digest, health and diagnostics. It never owns Memory content.

All authoritative writes use the existing DomainCommandGateway and one SQLite transaction for
domain changes, expected versions, idempotent result and redacted event. Small bodies remain
SQLite text, not Managed Blob.

Memory is not rebuilt from event replay and has no single JSON aggregate, FTS index, separate
database or Markdown write path. Proposal source IDs must remain weak audit references and cannot
use cascading ownership that deletes Proposals with a Camp or AgentRun.

Migration adds new tables, constraints and indexes through the existing additive schema mechanism.
It does not scan Conversation, Camp, Task, AgentRun, Skill, Git or project files to synthesize
initial Memory.

<a id="adr-0045-consequences"></a>
### Consequences

- Atomic Memories and Revisions can update independently without whole-file conflicts.
- SQLite constraints and indexes can enforce scope, lifecycle, duplicate and capacity protocols.
- Proposal retention and source deletion semantics remain representable without copied source
  content.
- Projection reconciliation can be diagnosed without becoming a second content truth.
- Migration is additive and starts with an empty Memory Library.
- Exact DDL, CHECK constraints and indexes remain implementation-plan details bounded by this ADR.

<a id="adr-0045-rejected-alternatives"></a>
### Rejected Alternatives

- One JSON Memory Library row: creates coarse concurrency and weak relational validation.
- Event-sourced Memory: adds replay and migration complexity absent from other current domains.
- Markdown as database: breaks transactional user authority and deterministic rebuild.
- Separate Memory database: fragments Core transactions, backup and diagnostics.
- FTS in v0.10: there is no Agent search tool and user-scale bounded collections do not require it.
- Backfilling from history: would infer durable knowledge without user proposals or confirmation.

<a id="adr-0045-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0052: Explicit Memory Revision Authority](../v0.13/decisions.md#adr-0052)
- [ADR-0025: Proposal-Scoped Memory Provenance](decisions.md#adr-0025)
- [ADR-0026: Explicit Memory Supersession](decisions.md#adr-0026)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](../v0.13/decisions.md#adr-0053)
<!-- legacy-adr-body:end id=ADR-0045 -->
<!-- legacy-adr:end id=ADR-0045 -->

<!-- legacy-adr:begin id=ADR-0046 source-file-sha256=8815d324db62496cfae4414fb26b0ea57f93d2a59ba4bd0aab5aa2c8961c7bdf -->
<a id="adr-0046"></a>

## ADR-0046: Memory Stewardship Bundled Skill

迁移时原路径：`docs/adr/0046-memory-stewardship-bundled-skill.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0046
title: "Memory Stewardship Bundled Skill"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0054
```

<!-- legacy-adr-body:begin id=ADR-0046 -->
<a id="adr-0046-context"></a>
### Context

Long-term Memory needs model-facing guidance for deciding what is durable, reading applicable
projections, avoiding duplicates, choosing scope and direction, filtering secrets, and submitting
a Proposal. These are one stewardship workflow rather than three unrelated workflows for Hearth,
Companion, and Relationship.

Lumen already has an authoritative Skill Library, immutable SkillRevision, project-level
same-name shadowing, Runtime-native SkillProjection, and ContextManifest recording. Creating a
second prompt-distribution mechanism for Memory would duplicate that architecture and make
Runtime behavior diverge.

Guidance must also remain distinct from authority: a Skill can teach an Agent to call a tool but
cannot grant the corresponding business Capability or approve its own Proposal.

<a id="adr-0046-decision"></a>
### Decision

Ship one Bundled Skill named `memory-stewardship`, displayed as “共同记忆维护”. It is enabled by
default for AgentProfiles whose Runtime supports Skills, and the user may disable it.

The Skill teaches a single bounded workflow:

1. decide whether the candidate is durable rather than transient task state, personality
   assessment, or gamified score;
2. use the current Run's authorized projection paths to read applicable confirmed Memory;
3. avoid exact duplicates and choose the allowed Scope, Kind, and Relationship Direction;
4. write one atomic canonical text without secret credentials;
5. submit add or revise through `memory.propose_change`;
6. treat a successful receipt as a saved pending Proposal, never as effective Memory.

Hearth, Companion, and Relationship do not receive separate Skills. Runtime providers do not
receive semantically separate variants.

Distribution reuses the existing Skill Library, immutable SkillRevision, Runtime-native
SkillProjection, project same-name shadowing, and ContextManifest digest rules. A project Skill
with the same logical name wins according to the existing shadow policy.

Skill enablement and `memory.propose_change` Capability are independent inputs to AgentRun
resolution. The Skill grants no Capability and cannot relax Memory scope, direction, quota,
Secret Filter, CAS, or user-confirmation enforcement.

If a Runtime cannot consume Skills, Lumen exposes that degradation and lets the Run continue.
It does not inject the Skill body into a System Prompt, emulate a hidden Skill channel, inline
Memory bodies, or block the Run solely because this guidance is unavailable.

<a id="adr-0046-consequences"></a>
### Consequences

- One maintained workflow stays consistent across all three Memory scopes.
- Memory guidance inherits existing Skill revisioning, projection, shadowing, and reproducibility.
- Security remains enforced by Gateway and Memory Domain rather than by model compliance.
- Users can disable the stewardship guidance without changing their Memory Library or user
  management authority.
- Unsupported Runtimes may propose less effectively, but the degradation is explicit and does not
  create a second delivery contract.

<a id="adr-0046-rejected-alternatives"></a>
### Rejected Alternatives

- One Skill per Scope: duplicates judgment and submission guidance while inviting drift.
- One variant per Runtime: makes policy depend on provider-specific prompt packaging.
- Mandatory System Prompt text: bypasses Skill enablement, projection, and shadowing semantics.
- Skill-implied Capability: confuses model guidance with business authorization.
- Hidden fallback prompt or inline Memory: creates an unaudited context-delivery path.
- Blocking unsupported Runtimes: makes optional guidance a hard execution dependency.

<a id="adr-0046-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0017: Managed Skill Library and Runtime-Native Projection](../v0.08/decisions.md#adr-0017)
- [ADR-0032: User-Authorized Live Memory Projection](decisions.md#adr-0032)
- [ADR-0039: Memory Proposal Capability](decisions.md#adr-0039)
<!-- legacy-adr-body:end id=ADR-0046 -->
<!-- legacy-adr:end id=ADR-0046 -->

<!-- legacy-adr:begin id=ADR-0047 source-file-sha256=dd051eb2bf93c2ca9782e1a3d1f6e587891eb09f170bd4d6a7e801df01502e3d -->
<a id="adr-0047"></a>

## ADR-0047: User-Initiated Memory Export Boundary

迁移时原路径：`docs/adr/0047-user-initiated-memory-export-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0047
title: "User-Initiated Memory Export Boundary"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0047 -->
<a id="adr-0047-context"></a>
### Context

Memory is personal, user-governed data, so users need a way to take a copy outside Lumen.
Automatic Memory-specific backup or cloud synchronization would introduce another replica,
retention policy, identity boundary, and Forget contract. Those systems are not otherwise part of
v0.10.

The Markdown Projection cannot serve as an export or backup source. It is a disposable,
Agent-specific read side that may omit directions not applicable to that Agent and may be
temporarily unavailable while SQLite remains healthy.

Once a user exports plaintext data to a location outside Lumen, the Memory Domain cannot reliably
find or erase every copy after a later Forget command.

<a id="adr-0047-decision"></a>
### Decision

v0.10 provides explicit user-initiated Memory export. It does not add Memory-specific automatic
backup, background replication, cloud synchronization, or restore.

Every export is generated from the authoritative SQLite Memory state, never by copying or parsing
Markdown Projection files. Forgotten bodies are excluded from every export path.

Before creating an export, the product must clearly state that the resulting external copy leaves
Lumen's Lifecycle and Forget boundary. A later Memory Forget clears Lumen's controlled Memory
content but cannot retract or erase user-controlled export files, operating-system snapshots, or
other external copies.

The export encoding, selectable scope and lifecycle filters, and included revision-history depth
are implementation-protocol choices. They must preserve this boundary and cannot turn Projection
into a backup source.

<a id="adr-0047-consequences"></a>
### Consequences

- Users can take custody of their Memory data without introducing hidden automatic replicas.
- v0.10 avoids designing cloud identity, encryption keys, synchronization conflicts, retention,
  and restore semantics.
- Export remains complete according to authoritative state rather than an Agent's partial view.
- UI copy must distinguish Lumen-controlled Forget from deletion of external copies.
- An import or restore workflow is not implied by the existence of export.

<a id="adr-0047-rejected-alternatives"></a>
### Rejected Alternatives

- Memory-specific automatic local backup: creates another managed retention and Forget surface.
- Cloud synchronization in v0.10: requires identity, encryption, conflict, and deletion semantics
  beyond the Memory domain being introduced.
- Copying the Projection tree: exports partial, derived, and possibly unavailable views.
- Claiming Forget covers exported files: Lumen cannot discover or control user-owned copies.
- Treating export as restore format by default: import trust and conflict behavior require a
  separate decision.

<a id="adr-0047-references"></a>
### References

- [v0.10 长期记忆](README.md)
- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0027: Memory-Domain Forgetting](decisions.md#adr-0027)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](../v0.13/decisions.md#adr-0053)
- [ADR-0045: Normalized SQLite Memory Store](decisions.md#adr-0045)
<!-- legacy-adr-body:end id=ADR-0047 -->
<!-- legacy-adr:end id=ADR-0047 -->
