---
document_type: version-decisions
version: v0.15
lifecycle: historical
last_updated: 2026-08-18
---

# v0.15 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0057](#adr-0057) | Member Presence and Retained Permanent Removal | `accepted` |
| [ADR-0058](#adr-0058) | Collaboration v4: Presence-Aware Routing and Execution Admission | `accepted` |

<!-- legacy-adr:begin id=ADR-0057 source-file-sha256=8ae283303c8eb1d475a8931d133b4016b5841b6632eaf1da652f6457f00e7a93 -->
<a id="adr-0057"></a>

## ADR-0057: Member Presence and Retained Permanent Removal

迁移时原路径：`docs/adr/0057-member-presence-and-retained-removal.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0057
title: "Member Presence and Retained Permanent Removal"
status: accepted
date: 2026-07-27
decision_scope: cross-version
source_version: v0.15
supersedes: [ADR-0041]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0057 -->
> 后续局部规范：[ADR-0069](../v0.21/decisions.md#adr-0069)
> 仅把本文保留的默认 `memory.propose_change` Capability 条款替换为
> `memory.write`；本文其余 Presence 与 removal 语义继续有效。
>
> [ADR-0136](../v0.47/decisions.md#adr-0136) 局部替代本文
> “移除后可保留非终态 Task Assignee”与 Default Lead/Task 惰性收口条款：无非终态
> AgentRun 时，RemoveMember 在一个事务中结束全部 Current CampMembership、释放 Task、
> 收口 Lead 后才标记 Profile removed。本文其他 Presence、数据保留、Memory 与历史身份条款
> 继续有效。
>
> [ADR-0137](../v0.47/decisions.md#adr-0137)同时澄清 accepted responsibility
> 与实际启动资格：`away` 不撤销已接受 responsibility，也不影响已经 running 的 Run，但 queued
> AgentRun 或尚未物化的 Delivery 必须等待 `present` 才能进入新的实际执行。本文“非终态 Run
> 继续运行”不再解释为 away 后仍可从 queued 启动。

<a id="adr-0057-context"></a>
### Context

旧 `AgentProfile` 使用 `active | disabled | archived` 同时承载“成员是否在队”、
“是否允许执行”和“是否仍在名册中”等不同含义。Runtime 配置与 Runtime 当前健康度
又是独立事实：一个在队成员可以没有配置 Runtime；一个已经配置 Runtime 的成员也
可能因本机 CLI、认证或探测状态暂时不能执行。

成员管理还需要两个不同强度的生命周期操作：

- 暂时离队是可恢复的用户意图；
- 永久移除是不可恢复的名册操作，但不是数据擦除。

把永久移除实现为物理删除或批量清空身份、头像、Runtime、Memory 和历史引用，会
破坏 Camp、Task、AgentRun 与长期身份的可解释性，并跨越 SQLite、受管头像文件和
Memory 治理边界。相反，仅在 Renderer 中隐藏成员又不能跨重启、Core RPC、Team
Tool 和后台恢复可靠地阻止后续参与。

因此必须建立一个持久、与 Runtime 解耦的成员在队状态，并明确终态移除后的数据
保留与活动资格。

<a id="adr-0057-decision"></a>
### Decision

<a id="adr-0057-stable-presence-state"></a>
#### Stable presence state

`AgentProfile` 的权威成员状态为：

```ts
type MemberPresence = "present" | "away" | "removed";
```

- `present`：成员在队，可以成为 CampMember、Default Lead、Task Assignee 或消息
  目标；是否真的可以启动 AgentRun 仍由执行准入独立判断。
- `away`：成员暂时离队，不能成为新的执行目标，但身份、配置、关系和历史全部保留，
  且可以显式回到 `present`。
- `removed`：成员已被永久移出名册，不能恢复，也不能再成为任何新活动关系或执行
  目标。

新建 AgentProfile 默认是 `present`，即使用户选择“暂不配置执行引擎”。
`present` 不承诺存在 Runtime 配置，更不承诺 Runtime Ready。

Runtime 配置、清除 Runtime、Adapter 探测结果、认证变化、CLI 安装状态和
Runtime Readiness 都不得隐式改变 Member Presence。清除一个在队成员的 Runtime
不会使其离队；外部 Runtime 故障也不会触发离队、归队或永久移除。

允许的状态转换只有：

```text
present ⇄ away
present → removed
away    → removed
```

`removed` 是终态。Core 不提供 restore、rejoin、edit 或重新激活 removed Profile
的命令。

<a id="adr-0057-temporary-leave"></a>
#### Temporary leave

暂时离队只推进 AgentProfile Presence 和版本，不扫描或修改 Camp、CampMember、
Default Lead、Task、Runtime 配置、头像、Memory Lifecycle 或历史记录。

- 离队后不得启动新的 AgentRun。
- 已经存在的非终态 AgentRun 继续运行，除非用户通过原有取消边界主动终止。
- 未完成 Task 保留原 Assignee；不自动清空、取消或改派。
- CampMember 仍表示该身份与 Camp 的成员关系，不复制全局 away 状态。
- 身份、头像、handle、成员指令、Runtime 配置、MCP Assignment 和 Memory 数据
  保留。
- 归队只恢复活动资格，不创建 MemoryRevision，不改写 Camp 历史，也不自动抢回
  已经有效的 Default Lead。

<a id="adr-0057-retained-permanent-removal"></a>
#### Retained permanent removal

永久移除是 User-only、不可逆命令。它在一个 SQLite 事务中只做保持终态所需的最小
权威变更：将 Presence 写为 `removed`、记录 `removedAt`、推进 Profile version，
并写入命令结果与审计事件。它不清空或物理删除：

- handle、display name、角色、persona、instructions 或其他身份字段；
- `avatarRef` 或受管头像文件；
- Runtime installation ID、模型选择或 Adapter permission 配置；
- MCP Assignment 原始记录；
- Companion、Relationship 或 Hearth Memory；
- CampMember、Conversation、CampMessage、Task、AgentRun、ContextManifest、
  Action、Approval 或审计记录。

非终态 AgentRun 是唯一的永久移除阻塞项。移除命令不自动取消运行，用户必须先等待
运行结束或通过既有取消流程使其终止。Default Lead 和未完成 Task 不是移除阻塞项；
它们由 Camp 的惰性修复和显式 Task 改派处理。

removed Profile 的 handle 永久保留，不得被新身份复用。Display name 仍可与其他
身份重复。

<a id="adr-0057-operational-exclusion-and-historical-identity"></a>
#### Operational exclusion and historical identity

removed Profile 从成员名册、成员详情、创建目标、成员管理搜索、`@` 候选、Default
Lead 选择、Task 新指派、Runtime 启动、Team Tool、MCP 投影和其他活动读取模型中
排除。公开 `agents.list/get` 不把 removed Profile 当作可管理成员返回；Core
内部历史读取仍可按稳定 ID 解析其保留身份。Camp 消息、Task、Run 和审计的历史
搜索不因此隐藏或擦除结果。

历史 Camp、消息、Task 和 AgentRun 继续显示原姓名、角色和头像，但该身份位不可
点击进入成员详情，也不能重新成为执行目标。历史展示不得降级为通用“已删除成员”
而丢失已有身份。

removed Profile 的 Runtime 配置是惰性历史数据：

- 不参与启动要求、健康探测、配置完整性检查、投影或活动引用计数；
- 不阻止删除对应 AdapterInstallation；
- 对应 Installation 后来不存在时，原 installation ID、模型和权限值仍可作为历史
  数据保留，但不承诺可重新解析或执行。

removed Profile 的 Memory Lifecycle、Revision、Proposal 和 Supersession 不因
移除而改变。用户治理数据仍保留，但涉及 removed Profile 的 Companion 与
Relationship Memory 不进入未来 Agent 上下文、活动投影、检索或 Agent Proposal
目标。Hearth Memory 的全局作用不因某一个 Profile 被移除而改变。

away Profile 同样不产生新的 AgentRun 投影，也不是其他成员当前 Relationship
Projection 的可用 counterparty；回到 `present` 后，同一批仍然有效的 Memory
重新具备适用资格。removed Profile 永远不会重新获得该资格。

<a id="adr-0057-compatibility-with-earlier-active-agentprofile-rules"></a>
#### Compatibility with earlier `active AgentProfile` rules

有效旧 ADR 中的 `active AgentProfile` 不再是可直接查询的当前生命周期术语。相关
规则按操作边界解释：

- ADR-0018 的 MCP Import 默认分配只选择 `present` Profile；既有 away/removed
  Assignment 原样保留，但不进入当前 Runtime 投影。
- ADR-0039 的 `memory.propose_change` 默认 Capability 仍写入新 Profile 的默认配置；
  Presence 转换不增删该存储配置，只有通过 Presence 与执行准入的新 AgentRun 才能
  使用它。
- Memory 自身的 `active | retired | forgotten` 仍是独立 Memory Lifecycle，不受
  本 ADR 的 AgentProfile 术语替换影响。

任何真正启动、路由或投影到 Runtime 的操作都不能只检查 `presence = present`；
还必须执行该操作已有的 Runtime、Capability、Camp 与安全准入。

<a id="adr-0057-consequences"></a>
### Consequences

- 成员在队意图不再被 Runtime 配置或本机健康状态暗中改写。
- 暂时离队是低副作用、可恢复操作；Camp 和 Task 保持真实历史。
- 永久移除能跨重启和所有 Core 入口可靠阻止后续参与，同时保留历史可解释性。
- 不需要跨 SQLite、Memory 和头像文件系统的伪原子擦除协议，也不会产生头像误删
  或关系记忆误删。
- 所有活动查询、投影、启动要求和引用计数都必须显式处理 `removed`，不能只依赖
  Renderer 过滤。
- 数据保留意味着“永久移除”不是隐私擦除或存储清理承诺；产品文案必须准确表达。
- removed Profile 会继续占用 SQLite 和受管头像磁盘空间；自动最终资产 GC 不在
  本决策范围内。

<a id="adr-0057-rejected-alternatives"></a>
### Rejected Alternatives

- 继续使用 `active | disabled | archived`：同一枚举混合在队、执行和名册语义。
- 用 Runtime 配置或 Readiness 派生成员在队状态：外部环境变化会改写用户意图。
- 清除 Runtime 时自动离队：把配置操作变成隐藏的生命周期操作。
- 永久物理删除 AgentProfile：破坏历史外键、身份展示和审计连续性。
- 永久移除时批量 Forget Memory：违反独立 Memory 治理并可能删除仍属于另一成员
  的 Relationship Memory。
- 永久移除时删除头像文件：跨 SQLite 与文件系统无法形成可靠事务，且历史仍引用
  该身份。
- 在成员页保留“已移除”分组：与用户要求的名册移除语义不符。
- 释放 removed handle：使历史 `@handle` 与新身份产生歧义。

<a id="adr-0057-references"></a>
### References

- [v0.15 成员生命周期与 Camp 执行准入](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0018: File-Backed MCP Library and Runtime Projection](../v0.09/decisions.md#adr-0018)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0035: User-Transparent Agent-Applicable Relationship Memory](../v0.10/decisions.md#adr-0035)
- [ADR-0039: Memory Proposal Capability](../v0.10/decisions.md#adr-0039)
- [ADR-0056: Controlled Member Avatar Assets](../v0.14/decisions.md#adr-0056)
- [Superseded ADR-0041: AgentProfile Status and Memory Independence](../v0.10/decisions.md#adr-0041)
<!-- legacy-adr-body:end id=ADR-0057 -->
<!-- legacy-adr:end id=ADR-0057 -->

<!-- legacy-adr:begin id=ADR-0058 source-file-sha256=bd8a8dae6bd88ade865f50e6ae2ec511716c0576a2198755765913f4a3f7573e -->
<a id="adr-0058"></a>

## ADR-0058: Collaboration v4: Presence-Aware Routing and Execution Admission

迁移时原路径：`docs/adr/0058-collaboration-v4-presence-aware-admission.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0058
title: "Collaboration v4: Presence-Aware Routing and Execution Admission"
status: accepted
date: 2026-07-27
decision_scope: cross-version
source_version: v0.15
supersedes: [ADR-0012]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0058 -->
> 后续局部规范：[ADR-0067](../v0.21/decisions.md#adr-0067)
> 删除本文 Dynamic Task Context 的模型注入条款；本文其余 Collaboration、Task 与
> execution-admission 语义继续有效。
>
> [ADR-0071](../v0.22/decisions.md#adr-0071) 局部替代本文的
> New Camp creation、为全部 CampMember 预建 Conversation、成员加入/恢复时预建
> Conversation，以及“不持久化空 Camp”条款；本文其余 Presence、Addressing、
> Execution Admission、Task 与永久删除语义继续有效。
>
> [ADR-0129](../v0.44/decisions.md#adr-0129) 局部替代本文的
> Conversation Summary、Camp Cursor 与公共消息上下文组成条款；其余协作与准入语义继续有效。
>
> [ADR-0136](../v0.47/decisions.md#adr-0136) 局部替代本文的
> Lightweight Task shape、Default Lead Task 只读、Task assignment 所用的 conjoined
> current-membership 术语、unavailable Assignee 修复与 Task 相关 Presence/removal 条款；
> Current CampMember 现在只表示当前有效 membership，需要 `present` 的操作必须另行检查。
> [ADR-0137](../v0.47/decisions.md#adr-0137) 局部
> 替代 responsibility acceptance 后按 Task 当前状态/负责人继续阻止 dispatch/start 的条款。
> 本文其他 Camp、routing、Presence 与独立 execution admission 条款继续有效。

<a id="adr-0058-context"></a>
### Context

ADR-0012 established the current Camp aggregate, derived Project navigation, atomic first-message
creation, lightweight Task and permanent Camp deletion. Those boundaries remain valid.

Its routing rules assume the legacy AgentProfile `active` state and select the first Runtime Ready
member as a new Camp's Default Lead. It does not define what happens when a global member later
becomes temporarily away or permanently removed while CampMember, Default Lead and Task references
remain. Requiring every global presence transition to scan and rewrite all Camps would couple the
AgentProfile aggregate to every collaboration aggregate and force member-page operations to resolve
Camp-local choices.

Execution admission also needs a stable distinction between identity routing and Runtime
availability. A Default Lead may remain the correct Camp identity even when no Runtime is
configured or the configured Runtime is temporarily unhealthy. Silently routing an unaddressed
message to a different member would violate the user's selected Lead and make delivery ambiguous.

This ADR replaces ADR-0012 in full so the unchanged Camp/Task model and the new presence-aware
routing rules remain available from one current source.

<a id="adr-0058-decision"></a>
### Decision

<a id="adr-0058-collaboration-aggregate"></a>
#### Collaboration aggregate

The authoritative collaboration model is:

```text
Camp
├── CampMember → AgentProfile
├── CampMessage
├── Conversation (campId + agentProfileId unique)
│   └── ConversationMessage / Summary / Camp Cursor / current Native Session
├── Task
├── CampTurn
│   └── AgentRun → Conversation + optional Task
└── InboxMessage
```

A Camp is the long-lived public collaboration context and user-visible conversation entry. A
Conversation is one AgentProfile's private continuity inside that Camp. Task is an optional durable
responsibility item, not a conversation container, execution lifecycle, evidence package or
workflow node. Rovai-ai does not introduce Project, Team, TeamRun, AgentInstance or
AgentProfileVersion aggregates.

A Camp has no archive or trash lifecycle. It either exists or has been permanently deleted.

<a id="adr-0058-project-projection-and-repository-binding"></a>
#### Project projection and repository binding

Project remains a Read Side grouping of Camps, not an entity, table or independent lifecycle. A
Camp has either no Project Binding and appears in the Lobby, or carries:

```ts
type ProjectBinding = {
  repositoryScopeId: string;
  projectRoot: string;
  gitCommonDir: string;
  objectFormat: "sha1" | "sha256";
};
```

Multiple Camps verified against the same Git common directory share `repositoryScopeId` and appear
under one Project. Paths describe current locations and do not define repository identity. Project
name, order and existence are derived from its Camps; deleting the final bound Camp removes the
Project from the Read Side.

Each Camp retains its own messages, members, permissions, mutable execution state and Rovai-ai
managed Git ref namespace. Sharing Repository Scope does not merge Camp authority or evidence.

<a id="adr-0058-camp-membership-and-member-presence"></a>
#### Camp membership and Member Presence

CampMember is the persistent relationship between one Camp and one AgentProfile, including
Camp-specific permissions. Member Presence is global AgentProfile state under ADR-0057 and is not
copied into CampMember.

Changing an AgentProfile to `away` or `removed` does not delete, leave or update historical
CampMember rows. Returning an away Profile to `present` does not recreate memberships. Every
current-membership query combines:

```text
current CampMember relationship
AND AgentProfile.presence = present
```

Runtime configuration and Runtime Readiness are not membership conditions.

<a id="adr-0058-member-order"></a>
#### Member Order

Member Order is one user-controlled global ordering. It is used for:

- member-directory presentation;
- new-Camp initial Default Lead selection after applying the creation-specific Runtime filter;
- future Default Lead repair in existing Camps.

Reordering never changes a currently valid Default Lead. When repair is later required, Core uses
the latest Member Order, not the order that existed when the Camp was created and not a circular
cursor after the former Lead. Ties use stable AgentProfile ID.

<a id="adr-0058-new-camp-creation"></a>
#### New Camp creation

Clicking “New conversation” creates only transient Renderer state. The first non-empty user message
submits one idempotent operation that, after successful admission, atomically creates the Camp,
initial CampMembers, one Conversation per member, Default Lead, CampMessage, CampTurn and requested
AgentRuns. It does not create a Task.

New Camps snapshot all `present` AgentProfiles as initial CampMembers. The initial Default Lead is
the first `present` AgentProfile in current Member Order with a complete Runtime configuration.
Runtime Readiness does not cause Core to skip that identity for a later member:

- if the selected Profile's Runtime is currently admissible, creation may proceed;
- if its Runtime is missing, unhealthy, unauthenticated, stale or otherwise inadmissible, creation
  fails with that target's blocker;
- if no present Profile has a complete Runtime configuration, creation fails.

Failure creates no Camp, CampMember, message, turn or run. The Renderer may keep the composer
editable and preserve its draft, but it cannot represent a failed attempt as a stored Camp.

Later profile creation, Member Order changes, Presence changes, Runtime configuration changes or
Readiness changes do not immediately rewrite an existing Camp membership or valid Lead.

<a id="adr-0058-default-lead-validity-and-reconciliation"></a>
#### Default Lead validity and reconciliation

Default Lead is the CampMember that receives unaddressed execution requests and coordinates
Camp-wide work. Lead validity requires:

```text
Camp exists
AND CampMember relationship is current
AND AgentProfile.presence = present
```

Runtime configuration and Readiness do not determine Lead validity. A present member with no
Runtime may remain or become Default Lead; execution admission will then reject an unaddressed
request without routing it elsewhere.

Entering an existing Camp invokes an explicit, idempotent
`camp.default_lead.reconcile` domain command before loading its snapshot:

1. if the persisted Lead is still valid, do nothing;
2. otherwise select the first valid CampMember by latest global Member Order and stable ID;
3. if no valid CampMember exists, persist `defaultLeadAgentId = null`;
4. emit a Lead-change event only when persisted state changes.

`camps.snapshot` remains a pure read and never mutates Lead as a hidden query side effect.
AgentProfile Presence commands never scan Camps or require successor input.

If a previously empty Camp later has a present member again, the next reconciliation assigns the
first valid member. Returning a higher-priority member does not displace a still-valid current
Lead.

<a id="adr-0058-addressing-and-execution-admission"></a>
#### Addressing and execution admission

Default addressing targets only the persisted Default Lead. Core never silently falls back to a
different Runtime-configured or Runtime-ready member. Explicit addresses target the exact requested
present CampMembers. The user-facing `@所有成员` address expands to every present CampMember; it
does not silently exclude an unavailable or inconvenient recipient.

Before persisting a user execution request, Core revalidates:

- Camp, CampMember and Member Presence;
- exact address resolution;
- Runtime configuration, Adapter installation, capability snapshot, model and permission values;
- Runtime health/authentication/readiness and workspace requirements;
- Conversation serialization, queue rules and all existing safety gates.

A multi-target request is admissible only when every target is admissible. One unavailable target
rejects the complete request; Core does not partially create messages, CampTurns or AgentRuns.

An execution-admission failure has zero business-state side effects for the submitted request:

- no CampMessage or ConversationMessage;
- no CampTurn or AgentRun;
- no automatic Lead change or target fallback;
- no empty Camp during first-message creation.

Under ADR-0001, a syntactically valid command that reaches domain admission may still persist its
single idempotent `command.result(rejected)`. That receipt does not create a business event, Wake
or execution eligibility and cannot contain the rejected message body.

If Lead or Presence changed after the last snapshot, submission rejects and the client reloads and
reconciles before the user retries. The execution command does not choose a new recipient while
the user is pressing Send.

Renderer mention discovery may show every present CampMember regardless of Runtime state, but
Core remains authoritative. Before applying Default addressing, Core scans exact `@handle` tokens
against the global retained handle index. A recognized Profile that is away, removed or not a
current member of the target Camp is an unavailable explicit target and rejects the request. It
cannot be ignored and reinterpreted as an unaddressed message. This validation does not require
Renderer to enumerate or display removed Profiles.

<a id="adr-0058-messages-and-execution"></a>
#### Messages and execution

CampMessage and ConversationMessage keep independent monotonically increasing sequences. Public
messages are materialized into Conversations according to the context-delivery protocol. Only a
successfully admitted structured execution request creates CampTurn and AgentRun; Task changes,
Runtime notifications and rejected submissions do not.

One trigger creates at most one CampTurn. A multi-Agent request creates its target AgentRuns
atomically. AgentRun remains the persistent, recoverable execution lifecycle bound to one
Conversation and an optional Task. One Conversation may have at most one current running or
waiting AgentRun.

InboxMessage remains single-recipient reliable delivery. It carries A2A execution requests and
replies but does not transfer Task responsibility or substitute for Task, Approval, Action or
AgentRun. Its target must still be a present, admissible CampMember at acceptance time.
Accordingly, ADR-0014's earlier phrase “active CampMember” now means a current CampMember whose
AgentProfile is `present` and whose exact execution request passes admission.

Changing a Profile to `away` does not interrupt an already-started AgentRun. Permanent removal is
rejected while that Profile has a non-terminal AgentRun under ADR-0057.

<a id="adr-0058-lightweight-task"></a>
#### Lightweight Task

Task uses this minimum authoritative shape:

```ts
type Task = {
  id: string;
  campId: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  assigneeAgentId: string | null;
  createdByType: "user" | "agent";
  createdById: string;
  sourceAgentRunId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};
```

Only a User or an Agent acting through a current fenced AgentRun creates a business Task. New Tasks
start as `pending`, may move between `pending` and `in_progress`, and may move from either
non-terminal state to `completed` or `cancelled`. Terminal Tasks are immutable and cannot reopen;
continued work uses a new Task.

`completed` records an authorized declaration, not Core verification of quality, tests,
natural-language completion criteria or evidence. Core enforces Actor identity,
AgentRun/Execution Epoch, Camp scope, Capability, object version, lifecycle and command
idempotency. It does not infer Task changes from messages, Agent output, AgentRun state or Runtime
events.

Task has no Acceptance Criteria, Criterion—Evidence binding, generation, origin chain, archive,
delete operation, prerequisite DAG or derived dependency readiness. Task status never changes
automatically because another Task, AgentRun or Approval changed.

Assignee is optional and references at most one present CampMember at assignment time. Runtime
configuration is not required for assignment. Any authorized creator may create an unassigned
Task, assign itself or assign another present member. The current Assignee may transfer a
non-terminal Task or release it to the public pool. Assignment needs no acceptance workflow and
does not alter already-frozen AgentRuns.

An away or removed Assignee remains historically referenced and produces
`assignee_unavailable`; Core never automatically clears, cancels or reassigns the Task. Only the
User may repair, reassign or cancel it. A Task with an away/removed Assignee cannot start a new
AgentRun for that Assignee.

User reads and updates all Camp Tasks. Default Lead reads all Camp Tasks but gains no write
authority from the role. An ordinary present member reads its own assigned Tasks plus unassigned
Tasks, may claim an unassigned Task atomically, and otherwise updates only its own Tasks. Core
applies the same visibility rule to list, by-ID reads and dynamic context.

Every new AgentProfile retains `task.create` and `task.update` in its default Capability
configuration. Presence and Runtime changes do not rewrite those stored defaults. A member can use
them only from a current fenced AgentRun, subject to present Camp membership and any CampMember
override; User operations do not depend on Agent Capability.

Task creation, assignment and update never emit an implicit message, create AgentRun or wake
Runtime. A User explicitly messages the responsible member when immediate action is needed. An
Agent explicitly uses `team.post_message`; that tool does not accept a Task binding parameter.
Task references in message text or generic references are collaborative context, not an execution
relationship.

Task cannot be deleted or archived individually. Cancellation represents abandonment, and
terminal Tasks remain queryable without entering the default active list. Permanent Camp deletion
removes all owned Tasks.

<a id="adr-0058-dynamic-task-context"></a>
#### Dynamic Task context

Current AgentRun responsibility remains in `[WORK_BRIEF]`. Visible long-lived Tasks are injected
separately as a bounded `[TASK_CONTEXT]` index so background responsibilities cannot be mistaken
for the current execution request.

Task Context contains only authorized active Task ID, title, status and Assignee. It omits
descriptions and terminal history, uses deterministic priority/sorting, and explicitly reports
omitted counts when its dedicated budget is exhausted. Default Lead receives the Camp-wide active
scope; ordinary members receive assigned-to-self plus unassigned Tasks.

Task Context is frozen into the AgentRun ContextManifest under ADR-0049. Later Task changes never
rewrite the same Run's input. An Agent must call `team.list_tasks` for full current detail and
version before writing.

<a id="adr-0058-permanent-camp-deletion"></a>
#### Permanent Camp deletion

The Camp row menu exposes rename and permanent delete; no Archive, Unarchive or Trash commands
exist. `DeleteCamp` is User-only and requires `commandId`, `expectedVersion` and explicit
destructive confirmation.

Deletion is allowed only while the Camp is quiescent. Core rejects deletion while any CampTurn or
AgentRun is non-terminal, Approval is pending, Action is executable or unresolved,
cancellation/member exit is unfinished, a relevant Inbox/Runtime lease is active, or an external
effect remains unreconciled. Stopping work and deleting the Camp are separate operations.

One SQLite transaction removes every Camp-owned record and relationship before deleting the Camp.
Managed Blob content becomes collectable only after its final authoritative reference disappears.
Rovai-ai may remove Camp-private Git refs, but never deletes the repository, normal branches,
worktrees, files or commits. Provider history cleanup is best effort and is not a deletion gate.

<a id="adr-0058-required-constraints-and-migration"></a>
#### Required constraints and migration

Persistence must enforce at least:

```text
(camp_id, agent_profile_id) on camp_member
(camp_id, agent_profile_id) on conversation
(camp_id, sequence) on camp_message
(conversation_id, sequence) on conversation_message
conversation source-message partial uniqueness
current Native Session uniqueness within Adapter installation
(camp_id, trigger_type, trigger_id) on camp_turn
one current running/waiting AgentRun per Conversation
AgentRun predecessor/responsibility uniqueness
(camp_id, idempotency_key) on inbox_message
Task lifecycle, closedAt and sourceAgentRun consistency
repository_scope_id lookup without per-Camp uniqueness
Camp-private internal Git ref namespace uniqueness
```

The v0.15 migration preserves all Camps, CampMembers, Conversations, messages, Tasks, Runs and
evidence. It changes AgentProfile Presence and related read/command predicates; it does not repeat
the development-stage collaboration reset described historically by ADR-0012.

<a id="adr-0058-consequences"></a>
### Consequences

- Member-page lifecycle actions no longer need Camp-wide successor input or cross-aggregate writes.
- Camp membership history remains stable while current participation is derived from Member
  Presence.
- Lead identity remains explicit and stable across Runtime outages; users see a targeted admission
  failure instead of silent rerouting.
- Entering a Camp may emit one idempotent Lead repair event before snapshot loading.
- A Camp may legitimately have no Default Lead. It remains readable while execution requests fail
  without persistence until a present member returns.
- Member Order now affects future Lead repair but never changes a still-valid Lead by itself.
- Multi-target all-or-none admission and zero-business-state rejection simplify user understanding
  at the cost of requiring every selected member to be executable.
- Unavailable Task assignees remain visible and require explicit user repair rather than hidden
  automation.
- Core, not disabled controls in Renderer, remains authoritative for current execution admission.

<a id="adr-0058-rejected-alternatives"></a>
### Rejected Alternatives

- Reassign every Camp during a Profile presence command: couples one profile mutation to an
  unbounded number of Camp aggregates.
- Require successor selection in the member page: exposes Camp-local responsibility in the wrong
  information architecture.
- Duplicate away/removed state into CampMember: creates two lifecycle authorities and difficult
  resynchronization.
- Use Camp join time or a circular cursor for succession: conflicts with the visible global Member
  Order and adds hidden priority state.
- Reelect the first member on every entry: returning or reordered members would displace a valid
  user-selected Lead.
- Skip a Runtime-unconfigured existing Lead at reconciliation: conflates identity routing with
  execution availability.
- Fall back to another executable member during Send: changes the recipient without user consent.
- Pick the first Runtime Ready member for new Camp creation: transient health would determine
  durable identity; v0.15 chooses the first configured identity and then admits or rejects it.
- Disable the composer when no target is available: hides authoritative race-safe validation and
  prevents users from drafting before configuration is repaired.
- Persist failed submissions as pending messages or empty Camps: turns an admission error into
  durable collaboration state without an accepted recipient.
- Partially deliver multi-target requests: makes one user instruction have ambiguous recipient and
  message history.
- Automatically clear or reassign unavailable Tasks: rewrites responsibility history.

<a id="adr-0058-references"></a>
### References

- [v0.15 成员生命周期与 Camp 执行准入](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0007: Portable Conversation Handoff](../v0.03/decisions.md#adr-0007)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0015: Action and Safety v2](../v0.06/decisions.md#adr-0015)
- [ADR-0016: Multi-Runtime Execution Boundary v2](../v0.06/decisions.md#adr-0016)
- [ADR-0049: Reproducible Context Delivery v2](../v0.12/decisions.md#adr-0049)
- [ADR-0057: Member Presence and Retained Permanent Removal](decisions.md#adr-0057)
- [Superseded ADR-0012: Collaboration v3](../v0.06/decisions.md#adr-0012)
<!-- legacy-adr-body:end id=ADR-0058 -->
<!-- legacy-adr:end id=ADR-0058 -->
