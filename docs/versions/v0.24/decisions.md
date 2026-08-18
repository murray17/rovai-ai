---
document_type: version-decisions
version: v0.24
lifecycle: historical
last_updated: 2026-08-18
---

# v0.24 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0073](#adr-0073) | Agent-Authored A2A Conversation Messages | `superseded` |
| [ADR-0074](#adr-0074) | Quick Chat Ubiquitous Language and Binding Identity | `accepted` |
| [ADR-0075](#adr-0075) | Runtime Integrity at Change and Execution Boundaries | `accepted` |
| [ADR-0076](#adr-0076) | Message-First AgentRun Dispatch Boundary | `accepted` |
| [ADR-0077](#adr-0077) | Responsive CampTurn Cancellation Boundary | `accepted` |
| [ADR-0078](#adr-0078) | Navigation Projection and Sidebar Wordmark Boundary | `accepted` |
| [ADR-0079](#adr-0079) | Two-Phase Cancellation Projection and Bounded Runtime Interrupt | `accepted` |

<!-- legacy-adr:begin id=ADR-0073 source-file-sha256=da0c3773c6d7a9a949cdb7efea899b35eefa7fd712fad5ddaa30e2c73d4b0176 -->
<a id="adr-0073"></a>

## ADR-0073: Agent-Authored A2A Conversation Messages

迁移时原路径：`docs/adr/0073-agent-authored-a2a-conversation-messages.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0073
title: Agent-Authored A2A Conversation Messages
status: superseded
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: ADR-0130
```

<!-- legacy-adr-body:begin id=ADR-0073 -->
> [ADR-0099](../v0.34/decisions.md#adr-0099) 保留 `team.call_member` 与
> ConversationInput 单槽调度，并删除自动回传协议。本文关于真实 Agent InboxMessage 的
> 用户投影继续有效；Core 不因接收方没有再次联系来源方而创建消息。

<a id="adr-0073-context"></a>
### Context

`team.post_message` is an authenticated action taken by one Agent toward another Agent. Core
already persists its body in an `InboxMessage`, derives the sender and recipient from trusted
runtime state, atomically delivers it to the recipient continuity, and queues the target
AgentRun.

The previous Camp timeline also synthesized `author_type='system'` CampMessages such as
“collaboration request delivered” and “collaboration result returned”. This made an Agent action
look like a system announcement, duplicated the meaningful request with delivery-state prose, and
allowed private A2A boundaries to enter Camp public-message sequence, FTS, summaries, and later
shared context. Labels such as “executing” also attributed Core-observed target state to the
sender even though the sender did not make that claim. A returned reply already has its own
author and body and does not need a second “returned” announcement.

The user still needs one coherent conversation view that shows who said what to whom without
turning every user-visible record into a CampMessage.

<a id="adr-0073-decision"></a>
### Decision

<a id="adr-0073-inboxmessage-owns-a2a-message-content"></a>
#### InboxMessage owns A2A message content

A successfully delivered `team.post_message` body remains authoritative `InboxMessage` content.
The user-facing Camp conversation projects that record exactly once as an Agent-authored directed
message:

```text
<sender name> → @<recipient name>
<body>
```

Sender and recipient identities come from the persisted AgentProfile relationships, never from
model-authored display text. The projection uses the sender's ordinary Agent identity treatment;
it is not a system message or a structured status card.

This user-visible projection does not convert the body into CampMessage. The A2A body remains
excluded from Camp public-message FTS, shared summaries, public context delivery, and unrelated
Agents' readable history. “Visible to the local user” and “public to every Agent” remain separate
authority decisions.

<a id="adr-0073-successful-lifecycle-state-is-not-conversation-content"></a>
#### Successful lifecycle state is not conversation content

Core must not synthesize happy-path CampMessages for A2A request acceptance, delivery, target
execution, result receipt, or return. In particular, the conversation does not add labels such as
“已送达”, “执行中”, or “已返回”.

Delivery and execution state remain authoritative InboxMessage, AgentRun, event-log, Activity,
and Audit facts. Those diagnostic surfaces may report current Core state, but they are not
statements authored by the sender and do not occupy the conversation as messages.

An Agent reply is represented by the reply action and its own authored content. Core never
synthesizes a second message to announce that the reply returned. A rejected `team.post_message`
creates no InboxMessage and therefore no conversation message.

<a id="adr-0073-cross-source-ordering-is-persisted"></a>
#### Cross-source ordering is persisted

The Camp conversation merges user/public CampMessages and delivered A2A InboxMessages using their
persisted domain-event global sequence when both records provide one. Persisted creation time and
stable identity are fallback ordering keys for legacy records. Renderer arrival time, role, and
visual grouping never reorder messages.

<a id="adr-0073-consequences"></a>
### Consequences

- Users see the real collaboration request once, with its actual sender and directed recipient.
- Sender intent is no longer conflated with Core-observed delivery or target execution state.
- A2A content can appear in the local user's conversation without becoming public Agent context.
- The Camp Snapshot must expose stable cross-source ordering evidence for CampMessage and
  InboxMessage projections.
- Existing synthetic `a2a-state` CampMessages must be hidden or tombstoned while their underlying
  audit events remain available.
- Activity and Audit remain the places for delivery failures, target Run state, correlation, and
  recovery evidence.

<a id="adr-0073-rejected-alternatives"></a>
### Rejected Alternatives

<a id="adr-0073-keep-a2a-request-and-result-as-system-campmessages"></a>
#### Keep A2A request and result as system CampMessages

Rejected because it misattributes an Agent action, duplicates authored content with lifecycle
prose, and leaks a private collaboration boundary into public-message infrastructure.

<a id="adr-0073-add-delivered--executing--returned-badges-to-each-directed-message"></a>
#### Add “delivered / executing / returned” badges to each directed message

Rejected because the sender did not author those claims, the state can change independently, and
the reply itself is sufficient evidence that a reply exists.

<a id="adr-0073-copy-inboxmessage-bodies-into-campmessage-for-rendering-convenience"></a>
#### Copy InboxMessage bodies into CampMessage for rendering convenience

Rejected because CampMessage participates in public summaries, search, and shared Agent context.
Presentation convenience cannot broaden the A2A body's authority.

<a id="adr-0073-keep-a2a-bodies-only-in-activity"></a>
#### Keep A2A bodies only in Activity

Rejected because Activity is a diagnostic lifecycle view rather than the Camp's readable human
conversation, and it obscures who actually said what to whom.

<a id="adr-0073-references"></a>
### References

- [v0.24 Arctic Dawn V3](README.md)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0061: Durable User-Visible and Agent-Inaccessible Execution Evidence](../v0.17/decisions.md#adr-0061)
<!-- legacy-adr-body:end id=ADR-0073 -->
<!-- legacy-adr:end id=ADR-0073 -->

<!-- legacy-adr:begin id=ADR-0074 source-file-sha256=04daff7e80e509f3efdfb045db51ef1211790e0d1e1c3cae2a0673b90511e355 -->
<a id="adr-0074"></a>

## ADR-0074: Quick Chat Ubiquitous Language and Binding Identity

迁移时原路径：`docs/adr/0074-quick-chat-ubiquitous-language-and-binding-identity.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0074
title: Quick Chat Ubiquitous Language and Binding Identity
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0074 -->
<a id="adr-0074-context"></a>
### Context

Rovai-ai has an application-managed workspace group for Camps that are not bound to a
user-selected directory. Its previous name entered product copy, domain vocabulary, Rust and
TypeScript identifiers, serialized binding values, Navigation Read Side fields, tests and the
managed filesystem path.

Changing only the displayed label would split one concept across two languages and require every
future feature to translate between a new product name and obsolete internal identifiers. The
product is not released, so retaining aliases, dual reads and data migration branches would add
permanent complexity without protecting a supported compatibility contract.

This ADR locally replaces the old managed-workspace name and binding literal in ADR-0071 and
ADR-0072. Their Camp Creation, directory identity, dynamic Git capability and Project grouping
decisions remain effective.

<a id="adr-0074-decision"></a>
### Decision

<a id="adr-0074-quick-chat-is-the-canonical-term"></a>
#### Quick Chat is the canonical term

The canonical English domain and product term is **Quick Chat**. The Chinese product label is
**快速对话**. Quick Chat groups Camps that use Rovai-ai's application-managed workspace; it is
neither a Camp nor a Project.

Current product surfaces, domain documentation, code, tests and contracts must not retain the
previous term as an alias. Historical version snapshots and the ADR passages whose replacement
this decision records remain unchanged as historical evidence.

<a id="adr-0074-every-active-identifier-uses-the-new-language"></a>
#### Every active identifier uses the new language

The binding and navigation contract is:

```ts
type ProjectBindingKind = 'quick_chat' | 'directory'

interface NavigationSnapshot {
  quickChat: NavigationCampGroup
  projects: NavigationProjectGroup[]
}
```

Rust variants use `QuickChat`; serialized storage and IPC values use `quick_chat`; JavaScript and
TypeScript properties use `quickChat`; CSS/test identifiers use `quick-chat`; and the managed
workspace directory is named `quick-chat/`.

A `quick_chat` Camp remains in Quick Chat even if Git metadata appears in the managed directory.
Directory Camps continue to form Projects only by exact canonical `projectPath`, as required by
ADR-0072.

<a id="adr-0074-the-cutover-has-no-compatibility-layer"></a>
#### The cutover has no compatibility layer

The implementation replaces the current schema, contracts and fixtures in one cutover. It does
not accept the old serialized value, expose deprecated fields, dual-read old state, translate old
IPC payloads or retain code aliases. Existing unreleased collaboration data may be reset rather
than migrated.

The cutover permanently deletes the exact legacy managed directory `<userData>/lobby/` and all of
its contents before creating `<userData>/quick-chat/`. It does not back up, move, import or inspect
those contents for compatibility. Deletion must resolve the authoritative application `userData`
directory, require `lobby` to be its exact direct child, and never follow a symlink outside that
target. Failure to complete the deletion fails the cutover closed rather than starting with
partially migrated state.

<a id="adr-0074-consequences"></a>
### Consequences

- Product, domain, contracts and implementation share one ubiquitous language.
- Quick Chat stays visibly and structurally separate from directory-backed Projects.
- Schema, contract, fixture and managed-path changes must land atomically.
- Existing development collaboration data and every file under the legacy managed directory are
  discarded; old clients are incompatible.
- Historical documents may contain the replaced term, but current implementation guidance cannot
  treat it as an active alias.

<a id="adr-0074-rejected-alternatives"></a>
### Rejected Alternatives

<a id="adr-0074-change-only-user-visible-copy"></a>
#### Change only user-visible copy

Rejected because internal and external vocabulary would diverge permanently.

<a id="adr-0074-preserve-the-old-serialized-value-as-a-compatibility-alias"></a>
#### Preserve the old serialized value as a compatibility alias

Rejected because the application is unreleased and dual vocabulary would complicate every
contract, migration and test without serving a supported client.

<a id="adr-0074-preserve-or-import-the-previous-managed-directory"></a>
#### Preserve or import the previous managed directory

Rejected because the user explicitly requires a clean, incompatible cutover. Retaining or copying
its contents would keep an undeclared compatibility path and could reintroduce obsolete workspace
identity.

<a id="adr-0074-model-quick-chat-as-a-project"></a>
#### Model Quick Chat as a Project

Rejected because Project remains a read-time group of Camps sharing one user-selected canonical
directory. Quick Chat is the separate application-managed workspace group.

<a id="adr-0074-references"></a>
### References

- [v0.24 Arctic Dawn V3](README.md)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](../v0.22/decisions.md#adr-0071)
- [ADR-0072: Directory Workspace Identity and Dynamic Git Capability](../v0.23/decisions.md#adr-0072)
- [Domain vocabulary](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0074 -->
<!-- legacy-adr:end id=ADR-0074 -->

<!-- legacy-adr:begin id=ADR-0075 source-file-sha256=4a89f5bf66c4763002de4b4ee68d07c0891c08cf6fa51dba0ec2a49564759c9c -->
<a id="adr-0075"></a>

## ADR-0075: Runtime Integrity at Change and Execution Boundaries

迁移时原路径：`docs/adr/0075-runtime-integrity-at-change-and-execution-boundaries.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0075
title: Runtime Integrity at Change and Execution Boundaries
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0075 -->
> [ADR-0129](../v0.44/decisions.md#adr-0129) 删除等待摘要完成的
> Context Compaction 执行路径；本文的 AgentRun Runtime integrity 检查与失败边界继续有效。

<a id="adr-0075-context"></a>
### Context

Rovai-ai 为已验证 Runtime 保存 SHA-256 fingerprint，并在 AgentRun 中冻结该证据。
ADR-0066 原先要求发送准入在发现路径或 fingerprint 硬失效时先完成 Runtime
Resolution，只有成功后才创建公开消息、CampTurn 和 AgentRun。当前实现因此在每次
发送前读取并哈希 Runtime 可执行文件。

Codex CLI 等 Runtime 可执行文件可能达到数百 MB。即使优化 SHA-256 实现或在同一请求
内复用结果，把完整内容校验放在每条消息的交互热路径仍会增加发送延迟、磁盘读取、
内存带宽和功耗。Runtime 文件在正常使用期间很少变化，完整哈希的触发频率不应与消息
频率绑定。

本决策局部替代 ADR-0066 第 3、5、6、7 节中关于发送准入必须重新确认 Runtime
fingerprint、fingerprint 变化不得先创建公开消息的条款。ADR-0066 的产品目录、发现、
深度探测、Installation、迁移、能力快照和 Native Session 约束继续有效。

<a id="adr-0075-decision"></a>
### Decision

<a id="adr-0075-1-完整哈希退出消息发送热路径"></a>
#### 1. 完整哈希退出消息发送热路径

普通 `camp.messages.send` 准入不得打开或读取 Runtime 可执行文件，也不得计算其
SHA-256。发送只验证可由持久状态同步确定的成员选择、冻结 Runtime 配置、权限和领域
不变量；成功后原子创建用户消息、CampTurn、AgentRun 与冻结 Runtime 配置。工作目录
launchability、当前 Runtime Readiness 和 Git observation 的进一步时机由 ADR-0076
收敛到 AgentRun 调度边界。

文件在消息提交前被删除或替换，不得撤回或阻止已经通过持久配置准入的用户消息。

<a id="adr-0075-2-成功完整校验同时保存轻量文件身份"></a>
#### 2. 成功完整校验同时保存轻量文件身份

Runtime 安装、更新、自动迁移、成功深度探测或用户主动检查完成完整 SHA-256 后，
Rovai-ai 为当前 Installation 持久保存：

- 可执行路径；
- 已验证 SHA-256；
- 文件大小；
- 纳秒级修改时间；
- 平台文件标识；macOS/Unix 使用 device 与 inode；
- 验证时间。

能力快照继续保存 Runtime 报告版本和完整 fingerprint。轻量文件身份只是判断是否需要
重新完整校验的派生证据，不替代 capability snapshot 或 AgentRun 中冻结的 fingerprint。

<a id="adr-0075-3-实际执行边界先做轻量比较"></a>
#### 3. 实际执行边界先做轻量比较

AgentRun 和 Context Compaction 真正启动 Runtime 前，Core 读取文件 metadata，并与当前
Installation 的已验证轻量身份比较。

- 身份完全一致：直接进入 Runtime 启动，不重新读取文件内容；
- 身份缺失或路径、大小、修改时间、文件标识任一变化：在阻塞线程中执行一次完整
  SHA-256；
- 完整 SHA-256 仍等于冻结 fingerprint：更新轻量身份并继续执行；
- 文件不可用、校验期间再次变化或 SHA-256 不一致：禁止 Runtime 启动，把当前能力
  快照标记为需要修复，并让 AgentRun 或后台工作失败。

完整校验发生在公开消息已经持久化之后，不阻塞消息落库或 Renderer 显示。失败属于执行
结果，不通过删除、撤回或隐藏用户消息来伪装发送未发生。

<a id="adr-0075-4-低频完整校验触发"></a>
#### 4. 低频完整校验触发

完整 SHA-256 只由以下边界触发：

- Runtime 安装完成；
- Runtime 更新、重新发现或自动迁移；
- 轻量文件身份变化或尚无身份记录；
- 用户主动刷新或执行完整性检查。

数据库升级不为既有快照同步读取 Runtime 文件。旧 Installation 第一次进入实际执行边界
时完成一次延迟校验并建立轻量身份。

<a id="adr-0075-5-使用标准-sha-256-实现"></a>
#### 5. 使用标准 SHA-256 实现

完整哈希是低频操作，不再为了消息热路径维护 Rovai-ai 专属的 ARM64 加速配置。所有平台
统一使用依赖库的标准 SHA-256 实现；平台差异只存在于轻量文件标识的采集方式。

<a id="adr-0075-consequences"></a>
### Consequences

- 普通发送不再读取数百 MB Runtime 文件，消息显示延迟、I/O、内存带宽和功耗下降。
- Runtime 未变化时，Agent 启动只承担一次 metadata 读取和数据库查询。
- Runtime 变化时，用户消息会先保留，AgentRun 随后校验并可能失败；UI 与恢复流程必须
  把它呈现为执行失败或 Runtime 需要修复，而不是发送失败。
- 新 Migration 需要持久保存轻量身份；升级后的第一次执行可能进行一次完整哈希。
- metadata 不是内容密码学证明。攻击者若能在同一文件标识下修改内容并精确恢复大小和
  修改时间，轻量比较可能无法触发重新哈希；本决策接受这一取舍，并把完整校验集中在
  安装、更新、显式检查和检测到变化的执行边界。
- 已冻结 AgentRun 的路径和 fingerprint 继续不可变；Installation 更新不能改写历史
  Run。

<a id="adr-0075-rejected-alternatives"></a>
### Rejected Alternatives

- **每条消息发送前完整哈希。** 安全检查频率与消息频率绑定，造成持续的交互延迟和资源
  消耗。
- **只优化或缓存发送请求内的 SHA-256。** 能降低单次耗时，但仍会在每条消息中读取整个
  Runtime 文件。
- **检测到文件变化后撤回用户消息。** 混淆消息事实和执行事实，也会破坏已经显示与持久
  化的会话历史。
- **完全移除完整哈希。** 无法在安装、更新和真实执行边界确认 Runtime 内容仍与已验证
  快照一致。
- **长期使用进程内缓存。** 无法跨 Core 重启保留证据，也不能可靠表达 Installation
  更新和文件替换。

<a id="adr-0075-references"></a>
### References

- [ADR-0066：Managed Product Runtime Discovery, Resolution, and Relocation](../v0.20/decisions.md#adr-0066)
- [ADR-0076：Message-First AgentRun Dispatch Boundary](decisions.md#adr-0076)
- [ADR-0156：Frozen Logical Runtime Identity and Bounded Installation Rebind](../v0.58/decisions.md#adr-0156)
- [v0.24 版本范围](README.md)
- [v0.24 实施与验收](implementation-plan.md)
<!-- legacy-adr-body:end id=ADR-0075 -->
<!-- legacy-adr:end id=ADR-0075 -->

<!-- legacy-adr:begin id=ADR-0076 source-file-sha256=bb3faccee39e8864d3a0bc7dae93d97167ca06746bf7c1d6121a927a23df4500 -->
<a id="adr-0076"></a>

## ADR-0076: Message-First AgentRun Dispatch Boundary

迁移时原路径：`docs/adr/0076-message-first-agent-run-dispatch-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0076
title: Message-First AgentRun Dispatch Boundary
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0076 -->
<a id="adr-0076-context"></a>
### Context

ADR-0075 已将 Runtime 完整哈希移出消息发送热路径，但
`send_camp_message_request()` 仍在消息事务前执行 Pending Execution 准备和完整
`execution_preflight()`。该 Preflight 会检查 Runtime Readiness、重新验证工作目录，并通过
多次 Git 子进程采集仓库状态。只有这些步骤完成后，Core 才保存 CampMessage、CampTurn
和 AgentRun。

Renderer 同时没有本地消息投影。它等待 `camp.messages.send` 完整返回，再依赖最长约
1.4 秒一次的领域事件轮询刷新 Camp Snapshot。因此即使 Runtime 哈希已经移除，用户点击
发送后仍看不到即时反馈。

工作区安全、Runtime 可执行性和 Git 仓库观察都属于 AgentRun 执行边界，而不是用户消息
事实的成立条件。把这些检查放在发送边界会混淆“消息已提交”和“Agent 可以启动”。

本决策局部替代 ADR-0058、ADR-0066 和 ADR-0075 中把完整执行 Preflight、Runtime
Resolution 或工作区 launchability 放在 CampMessage 持久化之前的条款。目标解析、成员
身份、业务 Capability、冻结配置和事务一致性约束继续有效。

<a id="adr-0076-decision"></a>
### Decision

<a id="adr-0076-1-renderer-先乐观显示用户消息"></a>
#### 1. Renderer 先乐观显示用户消息

点击发送后，Renderer 立即创建仅存在于本地的用户消息投影并放入当前 Camp 时间线：

- 使用 `commandId` 派生临时身份；
- 保留正文、寻址方式、目标成员和点击时间；
- 不显示“已送达”“执行中”或其他未经 Core 确认的状态文案；
- 自动滚动到最新消息。

Core 接受命令后，Renderer 使用权威 `campMessageId`、sequence 和 Camp Snapshot 对账。
Core 明确拒绝或 IPC 失败时才移除乐观投影并保留 Composer 草稿。事件轮询仍作为跨进程
变更和恢复的兜底，不再是本机用户发送后首次看到消息的必经路径。

<a id="adr-0076-2-发送请求只提交消息与待执行-run"></a>
#### 2. 发送请求只提交消息与待执行 Run

普通 `camp.messages.send` 不创建新的 Pending Execution Intent，不执行
`execution_preflight()`，也不运行文件系统、Git、Runtime discovery、deep probe 或
完整性检查。

Core 在一个 SQLite 事务中完成仍可同步确定的领域操作：

- 验证 Camp、Actor、目标成员、Mention、Task 和业务 Capability；
- 创建缺失的目标 Conversation；
- 从最后可用的持久 Runtime 快照冻结 Run Runtime Configuration；
- 创建 CampMessage、CampTurn 和 queued AgentRun；
- 返回权威消息和 Run 身份。

Runtime 身份变化导致 capability snapshot 变为 stale 后，最后一次已验证快照仍可用于
创建可审计的 queued AgentRun；调度器随后阻止它启动并记录失败。消息不得因此被删除或
拒绝持久化。

<a id="adr-0076-3-调度器拥有执行前检查"></a>
#### 3. 调度器拥有执行前检查

`dispatch_agent_runs()` 对每个可调度 Run 按以下顺序执行：

1. 轻量工作区安全检查：绝对路径、canonical identity、存在性、目录类型、可读性、受管
   数据目录边界；不启动 Git 子进程；
2. Runtime 检查：当前 Installation/Capability Snapshot 与冻结配置的一致性，以及
   ADR-0075 定义的轻量文件身份和条件完整 SHA-256；
3. 采集一次 starting Git observation；Git 不存在、不是仓库或状态异常只形成观察结果，
   不等同于工作区安全失败；
4. claim AgentRun、写入 `started_at` 和 starting observation；
5. 启动 Agent Runtime。

工作区或 Runtime 检查失败时，调度器直接把尚未启动的 queued AgentRun 标记为失败，
并让所属 CampTurn 进入失败或等待修复/重试状态；它保留触发用户消息，不写
`started_at`，也不伪造 starting/ending Git observation。

<a id="adr-0076-4-ending-git-observation-属于终态"></a>
#### 4. ending Git observation 属于终态

AgentRun 成功、失败或取消并已经实际开始执行时，Core 在终态边界采集一次 ending Git
observation。starting/ending observation 用于用户可见状态、未来 worktree 支持和变更
审计，不是消息发送准入，也不替代 Runtime 自己的文件权限模型。

<a id="adr-0076-5-旧-pending-execution-intent-仅作迁移恢复"></a>
#### 5. 旧 Pending Execution Intent 仅作迁移恢复

普通发送不再创建 Pending Execution Intent。升级前遗留的可恢复 Intent 可以按新路径
提交其消息与 queued Run，成功后标记为 consumed；它们不再重新引入发送前 Runtime
Resolution。

<a id="adr-0076-consequences"></a>
### Consequences

- 用户消息在点击后立即可见，权威持久化只等待一次短 SQLite 事务。
- Workspace、Runtime 和 Git 成本全部退出交互热路径；调度器约 500 ms 的扫描周期只影响
  Agent 开始时间，不影响消息显示和保存。
- Pre-launch 失败成为 AgentRun 失败事实，CampTurn 可等待用户修复后重试；用户继续看到
  原始请求。
- Git observation 更准确地表达一次 Run 的开始和结束状态，不再表达消息发送时的仓库
  状态。
- 乐观投影必须以 `commandId` 和权威消息 ID 对账，避免轮询与直接刷新产生重复消息。

<a id="adr-0076-rejected-alternatives"></a>
### Rejected Alternatives

- **仅在发送成功后立即刷新 Snapshot。** 消息仍会等待完整 IPC 请求，不能提供点击后的
  即时反馈。
- **只保留 Renderer 乐观消息，不移动 Core Preflight。** 视觉延迟下降，但消息实际持久化
  仍会被工作区、Git 和 Runtime 阻塞，失败语义继续错误。
- **让 Git observation 继续作为 Workspace 安全检查。** Git 能力和目录安全是不同事实；
  非 Git 目录也可以是合法 Run Workspace。
- **检查失败时不创建 AgentRun。** 会丢失“用户请求已保存但执行未能启动”的审计关系。

<a id="adr-0076-references"></a>
### References

- [ADR-0058：Collaboration v4](../v0.15/decisions.md#adr-0058)
- [ADR-0066：Managed Product Runtime](../v0.20/decisions.md#adr-0066)
- [ADR-0072：Directory Workspace and Dynamic Git Capability](../v0.23/decisions.md#adr-0072)
- [ADR-0075：Runtime Integrity Boundaries](decisions.md#adr-0075)
- [v0.24 实施与验收](implementation-plan.md)
<!-- legacy-adr-body:end id=ADR-0076 -->
<!-- legacy-adr:end id=ADR-0076 -->

<!-- legacy-adr:begin id=ADR-0077 source-file-sha256=662f1401f47ea5bd9c211ed99bd37851f53f5f8437dd6235827e0a2be9d87ee9 -->
<a id="adr-0077"></a>

## ADR-0077: Responsive CampTurn Cancellation Boundary

迁移时原路径：`docs/adr/0077-responsive-camp-turn-cancellation-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0077
title: "Responsive CampTurn Cancellation Boundary"
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0077 -->
> [ADR-0099](../v0.34/decisions.md#adr-0099) 保留 pending ConversationInput 的
> Stop fence，并删除回传责任与自动结果输入。本文其余 Runtime interrupt 与迟到事件
> fencing 继续有效。

<a id="adr-0077-context"></a>
### Context

ADR-0062 separates RovAI execution cancellation from reconciliation of uncertain external effects,
but the implementation still placed unrelated work on the user-visible stop path. Renderer waited
for Navigation and Camp reloads after the cancellation request, the cancellation coordinator woke
only on periodic polling, and ending Git observation was collected before an AgentRun could be
marked `cancelled` and announced to Renderer.

Those waits did not make cancellation safer. The authoritative safety boundary is the persisted
cancellation request and execution fence. Navigation refresh and Git observation are projections
and evidence collection that can follow asynchronously.

<a id="adr-0077-decision"></a>
### Decision

When the user explicitly stops an active CampTurn:

1. Renderer immediately records the affected Turn IDs in local `cancelling` state and displays
   “正在停止…”. This state does not globally disable unrelated UI.
2. `campTurns.cancel` performs only the short authoritative transaction that records the
   cancellation request and advances the execution fence, then returns its ACK. It does not wait
   for Runtime interrupt, Navigation reload, Camp activation, or Git inspection.
3. A successful request notifies the cancellation coordinator immediately. Periodic scanning
   remains a recovery fallback rather than the normal wake-up path.
4. The coordinator sends the Runtime-native interrupt or confirms that no live process remains,
   then marks the AgentRun `cancelled`.
5. Core emits `agent_run.cancelled` immediately after that transaction. Renderer responds by
   refreshing the active Camp Snapshot once and reconciles local `cancelling` state against the
   authoritative terminal Turn.
6. Ending Git observation is collected and recorded after the cancellation event. It remains
   AgentRun evidence, but cannot delay cancellation status, Composer recovery, or the event sent
   to Renderer.

Event subscription polling and the scheduler interval remain recovery mechanisms for lost UI
events, process restart, or a missed notification.

<a id="adr-0077-consequences"></a>
### Consequences

- Clicking Stop produces immediate feedback and the request ACK is independent of Runtime and Git
  latency.
- Runtime interrupt remains authoritative work performed by Core; Renderer never invents a
  terminal cancellation.
- The Composer stays in “正在停止…” until a terminal Snapshot arrives, while navigation and other
  UI remain usable.
- A cancelled Run can temporarily have no ending Git observation. The background observer appends
  it later as a separately persisted event.
- Cancellation recovery remains durable because SQLite state, not Renderer state or Notify, is
  the source of truth.

<a id="adr-0077-rejected-alternatives"></a>
### Rejected Alternatives

- Reload Navigation and reactivate the Camp before resolving Stop: projection I/O makes the user
  wait without strengthening the fence.
- Wait for Git observation before writing `cancelled`: repository inspection is evidence, not a
  cancellation prerequisite.
- Use only local optimistic terminal state: Renderer cannot prove that Runtime execution rights
  have ended.
- Remove periodic cancellation scanning: Notify is not durable across process failure and cannot
  replace recovery from persisted cancellation requests.

<a id="adr-0077-references"></a>
### References

- [ADR-0062: Interruptible Run Trees and Unsettled External Effects](../v0.17/decisions.md#adr-0062)
- [ADR-0076: Message-First AgentRun Dispatch Boundary](decisions.md#adr-0076)
- [v0.24 Arctic Dawn V3](README.md)
<!-- legacy-adr-body:end id=ADR-0077 -->
<!-- legacy-adr:end id=ADR-0077 -->

<!-- legacy-adr:begin id=ADR-0078 source-file-sha256=59d699593e79a8841c017e2e41e77708f66b1cf460d78fd0d28d22af41fa0eb4 -->
<a id="adr-0078"></a>

## ADR-0078: Navigation Projection and Sidebar Wordmark Boundary

迁移时原路径：`docs/adr/0078-navigation-projection-and-sidebar-wordmark-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0078
title: "Navigation Projection and Sidebar Wordmark Boundary"
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0078 -->
<a id="adr-0078-context"></a>
### Context

ADR-0048 冻结了 `Rovai-ai` 的正式产品、打包与内部命名，ADR-0074 冻结了 Quick
Chat 的领域词汇与 `quick_chat` Workspace Binding，并明确 Quick Chat 不是 Project。
Arctic Dawn 首版 Renderer 因而把 Quick Chat 渲染为独立导航分组，同时在设置页保留
全局侧栏并增加第二列设置导航。

后续导航原型要求减少侧栏分组与并列导航：Quick Chat Camp 应在“项目”列表末尾以
文件夹式分组出现；设置分类应占用同一条 270px 侧栏；侧栏品牌位使用 `Rovai AI`
字标且不再显示副标题。这些都是 Renderer 投影要求，不能反向改变 Quick Chat
Binding、Project 读模型、正式应用身份或数据迁移合同。

<a id="adr-0078-decision"></a>
### Decision

<a id="adr-0078-quick-chat-只在导航中使用项目式投影"></a>
#### Quick Chat 只在导航中使用项目式投影

Renderer 的普通导航固定为“置顶 / 项目”两个分区。“项目”分区先显示全部
directory-backed Project，最后显示一个文件夹样式的“快速对话”分组。

该分组是视觉投影，不是 Project：

- Navigation Snapshot 继续分别提供 `quickChat` 与 `projects`；
- `quick_chat` Camp 不进入 `ProjectNavigationGroup`，不获得 Project identity、
  canonical project path 或 Project pin；
- “快速对话”分组本身不能置顶；其 Camp 仍可单独置顶；
- 置顶 Camp 继续从普通分组移到“置顶”；置顶 directory Project 继续携带完整 Camp
  列表；
- 所有 Core、SQLite、IPC、受管目录和领域词汇继续遵守 ADR-0074。

<a id="adr-0078-设置分类覆盖同一侧栏槽位"></a>
#### 设置分类覆盖同一侧栏槽位

进入设置时，App Shell 保留同一条固定 270px 侧栏，但把普通导航内容替换为设置导航：

1. Logo 与 `Rovai AI` 侧栏字标；
2. “返回 App”；
3. 设置标题与说明；
4. “技能 / MCP / 执行引擎 / 外观 / 诊断”。

设置内容区不再增加 188px 二级导航。返回 App 恢复进入设置前的一级页面和 Camp；
再次进入设置时保留上次选择的设置分类。切换只改变 Renderer 导航投影，不重建设置
数据、不产生领域事件，也不丢失设置页局部状态。

<a id="adr-0078-sidebar-wordmark-与正式产品身份分离"></a>
#### Sidebar wordmark 与正式产品身份分离

普通侧栏和设置侧栏的可见品牌字标统一使用 `Rovai AI`，不显示
“北极晨光 · Workspace”或其他 slogan。该字标是窄范围 Renderer 展示：

- 正式产品名、窗口标题、安装包、应用数据目录、诊断文件和文档主体名称仍是
  `Rovai-ai`；
- `productName`、`appId`、artifact name、`window.rovai`、IPC、环境变量和文件命名
  继续遵守 ADR-0048；
- 不引入第二套内部 namespace，也不迁移任何应用数据。

<a id="adr-0078-core-健康只从诊断页访问"></a>
#### Core 健康只从诊断页访问

普通侧栏底部只保留“设置”。删除 Core 健康摘要与诊断深链，但不删除 Health
Snapshot、探测请求、诊断设置页或导出能力。

<a id="adr-0078-consequences"></a>
### Consequences

- 普通侧栏只有“置顶 / 项目”两个会话分区，Quick Chat 仍能在固定位置被发现。
- Quick Chat 的视觉文件夹不会污染领域模型或让 Project 获得新持久身份。
- 设置页在窄窗口获得更多内容宽度，并且不会同时显示两套导航。
- `Rovai AI` 只作为侧栏字标存在；正式产品和兼容路径继续保持 `Rovai-ai`。
- 删除健康入口后，用户仍可通过“设置 → 诊断”查看同一份健康事实。

<a id="adr-0078-rejected-alternatives"></a>
### Rejected Alternatives

- **把 Quick Chat 真正改成 Project。** 这会破坏 Workspace Binding 与 Project
  读模型，并让受管目录冒充用户选择的 canonical directory。
- **把 `quickChat` 合并进 `projects` IPC。** 视觉排序不需要改变权威合同。
- **设置页同时保留普通侧栏和 188px 二级导航。** 继续占用额外宽度并重复导航层级。
- **每次进入设置都重置到“技能”。** 会丢失用户上次的工作位置。
- **把 `Rovai AI` 扩展成打包或内部正式名称。** 本轮没有授权第二次产品 namespace
  迁移，且会与现有兼容路径冲突。
- **删除健康探测。** 本轮只删除侧栏入口；诊断事实与能力仍然有效。

<a id="adr-0078-references"></a>
### References

- [ADR-0048: Rovai-ai Product Identity](../v0.11/decisions.md#adr-0048)
- [ADR-0074: Quick Chat Ubiquitous Language](decisions.md#adr-0074)
- [v0.24 Arctic Dawn V3](README.md)
- [App Shell 与统一侧栏 UI 合同](../../ui/components/app-shell-navigation.md)
- `rovai-navigation-settings-empty-v7-package`
<!-- legacy-adr-body:end id=ADR-0078 -->
<!-- legacy-adr:end id=ADR-0078 -->

<!-- legacy-adr:begin id=ADR-0079 source-file-sha256=66813f9a7b9eb507bff5538bb8068d9727913bbac3dbb8d1d0edac76fc0e7194 -->
<a id="adr-0079"></a>

## ADR-0079: Two-Phase Cancellation Projection and Bounded Runtime Interrupt

迁移时原路径：`docs/adr/0079-two-phase-cancellation-projection-and-bounded-runtime-interrupt.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0079
title: "Two-Phase Cancellation Projection and Bounded Runtime Interrupt"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0079 -->
> [ADR-0099](../v0.34/decisions.md#adr-0099) 补充：Turn Stop 的第一阶段还必须
> 原子取消 pending ConversationInput。本文两阶段 UI 投影与有界 Runtime interrupt 继续有效。

<a id="adr-0079-context"></a>
### Context

ADR-0077 moved cancellation persistence ahead of Runtime interrupt and ending Git observation.
Renderer therefore acknowledged a stop request quickly, but only the Composer Stop button
projected the local `cancelling` phase. AgentRun cards and Activity still rendered the previous
Snapshot as running, including active emphasis and progress animation.

The cancellation coordinator also awaited each Runtime interrupt serially. Codex interrupt used
the ordinary RPC response timeout, so one slow Runtime could delay its terminal cancellation and
the interrupt of unrelated AgentRuns.

<a id="adr-0079-decision"></a>
### Decision

Cancellation has two user-visible and operationally distinct phases:

1. On click, Renderer derives the affected AgentRuns from the locally cancelling CampTurn IDs.
   Every non-terminal Run in those Turns immediately renders “正在停止…”, stops running animation
   and emphasis, and disables repeat Stop.
2. The Composer draft remains editable, but no new Turn can be submitted while either an
   authoritative active Run or local cancellation state remains.
3. Core persists `cancel_requested_at` and its execution fence before returning the Stop request
   ACK. Renderer does not claim the Run is terminal at this point.
4. The cancellation coordinator starts all candidate Runtime interrupts concurrently.
5. Runtime interrupt uses a cancellation-specific short deadline instead of the ordinary request
   timeout. A timeout or transport failure triggers Runtime detach/route fencing with its own
   bounded deadline; the persisted version and cancellation fence remain authoritative if detach
   cannot complete synchronously.
6. After native interrupt confirmation, process absence, or reliable logical fencing, Core
   persists `cancelled` and emits `agent_run.cancelled`. Renderer refreshes the active Camp
   Snapshot and replaces local “正在停止…” with the authoritative terminal presentation.
7. Ending Git observation is launched only after the cancellation event and cannot occupy the
   coordinator's cancellation path.

Periodic scanning remains the durable recovery path for a missed Notify or interrupted
coordinator.

<a id="adr-0079-consequences"></a>
### Consequences

- The whole Run surface responds immediately without falsely claiming “已停止”.
- A slow Runtime cannot serialize cancellation of other AgentRuns.
- Ordinary Runtime RPC deadlines no longer determine Stop latency.
- A cancelled Run may retain unsettled external-effect evidence when only fencing, rather than a
  native stop confirmation, was possible.
- Draft editing is independent from execution admission; editing remains available while sending
  is fenced.

<a id="adr-0079-rejected-alternatives"></a>
### Rejected Alternatives

- Show `cancelled` optimistically: Renderer cannot prove that native execution rights ended.
- Change only the Stop button: conflicting running cards make the request appear ineffective.
- Disable the whole Composer: stopping execution does not require discarding or freezing draft
  preparation.
- Wait indefinitely for Runtime confirmation: this lets one provider control product Stop
  responsiveness and blocks multi-Agent cancellation.
- Run Git observation before the event: evidence collection is not an execution fence.

<a id="adr-0079-references"></a>
### References

- [ADR-0062: Interruptible Run Trees and Unsettled External Effects](../v0.17/decisions.md#adr-0062)
- [ADR-0077: Responsive CampTurn Cancellation Boundary](decisions.md#adr-0077)
- [v0.24 Arctic Dawn V3](README.md)
<!-- legacy-adr-body:end id=ADR-0079 -->
<!-- legacy-adr:end id=ADR-0079 -->
