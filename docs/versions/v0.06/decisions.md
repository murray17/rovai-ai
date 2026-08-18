---
document_type: version-decisions
version: v0.06
lifecycle: historical
last_updated: 2026-08-18
---

# v0.06 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0012](#adr-0012) | Collaboration v3: Camp and Lightweight Task | `superseded` |
| [ADR-0013](#adr-0013) | Managed Content and Read Side v2 | `accepted` |
| [ADR-0014](#adr-0014) | Stable Team Tool Gateway v2 | `accepted` |
| [ADR-0015](#adr-0015) | Action and Safety v2 | `superseded` |
| [ADR-0016](#adr-0016) | Multi-Runtime Execution Boundary v2 | `superseded` |

<!-- legacy-adr:begin id=ADR-0012 source-file-sha256=e40e067354c9d61b1eee7f45eeb739acea87c89d7daa231d3a05ddb3826e63d9 -->
<a id="adr-0012"></a>

## ADR-0012: Collaboration v3: Camp and Lightweight Task

迁移时原路径：`docs/adr/0012-collaboration-v3-lightweight-task.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0012
title: "Collaboration v3: Camp and Lightweight Task"
status: superseded
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0008]
superseded_by: ADR-0058
```

<!-- legacy-adr-body:begin id=ADR-0012 -->
<a id="adr-0012-context"></a>
### Context

ADR-0008 established the current Camp-centered product model, derived Project navigation, first-message Camp creation and permanent Camp deletion. Those boundaries remain correct.

Its Task model no longer matches Lumen's collaboration goal. It treats Task as a structured work commitment with a hard prerequisite DAG, completion evidence and execution-readiness gates. In practice, Agent collaboration needs a lighter durable responsibility record that can remain visible across messages and AgentRuns without becoming a workflow engine. Creating or assigning that record must not silently start Runtime work.

The old schema also contains development-stage compatibility data, legacy Task-as-execution semantics and commands that would force the implementation to carry two meanings for the same table. This ADR replaces ADR-0008 in full so that the unchanged Camp model and the new Task boundary remain available from one current source.

<a id="adr-0012-decision"></a>
### Decision

<a id="adr-0012-collaboration-aggregate"></a>
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

A Camp is the long-lived public collaboration context and user-visible conversation entry. A Conversation is one AgentProfile's private continuity inside that Camp. Task is an optional durable responsibility item, not a conversation container, execution lifecycle, evidence package or workflow node. Lumen does not introduce Project, Team, TeamRun, AgentInstance or AgentProfileVersion aggregates.

A Camp has no archive or trash lifecycle. It either exists or has been permanently deleted.

<a id="adr-0012-project-projection-and-repository-binding"></a>
#### Project projection and repository binding

Project remains a Read Side grouping of Camps, not an entity, table or independent lifecycle. A Camp has either no Project Binding and appears in the Lobby, or carries:

```ts
type ProjectBinding = {
  repositoryScopeId: string;
  projectRoot: string;
  gitCommonDir: string;
  objectFormat: "sha1" | "sha256";
};
```

Multiple Camps verified against the same Git common directory share `repositoryScopeId` and appear under one Project. Paths describe current locations and do not define repository identity. Project name, order and existence are derived from its Camps; deleting the final bound Camp removes the Project from the Read Side.

Each Camp retains its own messages, members, permissions, mutable execution state and Lumen-managed Git ref namespace. Sharing Repository Scope does not merge Camp authority or evidence.

<a id="adr-0012-creation-members-and-routing"></a>
#### Creation, members and routing

Clicking “New conversation” creates only transient Renderer state. The first non-empty user message submits one idempotent command that atomically creates the Camp, initial CampMembers, one Conversation per member, Default Lead, CampMessage, CampTurn and requested AgentRuns. It does not create a Task. Failed preflight leaves no partial Camp.

New Camps snapshot all currently active AgentProfiles. At least one active member must be Runtime Ready. Global Member Order selects the first Runtime Ready member as initial Default Lead. Later profile creation, member reorder or readiness changes do not silently rewrite existing Camp membership or Lead.

Default Lead is only the destination for unaddressed execution requests and the Camp-wide coordination reader. Explicit addresses and replies take precedence. Lead changes affect future routing only and never transfer Task responsibility, rewrite history or replace an already-running AgentRun.

<a id="adr-0012-messages-and-execution"></a>
#### Messages and execution

CampMessage and ConversationMessage keep independent monotonically increasing sequences. Public messages are materialized into Conversations according to the context-delivery protocol. Only a structured execution request creates CampTurn and AgentRun; ordinary stored messages, Task changes and Runtime status notifications do not.

One trigger creates at most one CampTurn. A multi-Agent request creates its target AgentRuns atomically. AgentRun remains the persistent, recoverable execution lifecycle bound to one Conversation and an optional Task. One Conversation may have at most one current running or waiting AgentRun.

InboxMessage remains single-recipient reliable delivery. It carries A2A execution requests and replies but does not transfer Task responsibility or substitute for Task, Approval, Action or AgentRun.

<a id="adr-0012-lightweight-task"></a>
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

Only a User or an Agent acting through a current fenced AgentRun creates a business Task. New Tasks start as `pending`, may move between `pending` and `in_progress`, and may move from either non-terminal state to `completed` or `cancelled`. Terminal Tasks are immutable and cannot reopen; continued work uses a new Task.

`completed` records an authorized declaration, not Core verification of quality, tests, natural-language completion criteria or evidence. Core enforces Actor identity, AgentRun/Execution Epoch, Camp scope, Capability, object version, lifecycle and command idempotency. It does not infer Task changes from messages, Agent output, AgentRun state or Runtime events.

Task has no Acceptance Criteria, Criterion—Evidence binding, generation, origin chain, archive, delete operation, prerequisite DAG or derived dependency readiness. Task status never changes automatically because another Task, AgentRun or Approval changed.

Assignee is optional and references at most one active CampMember at assignment time. Any authorized creator may create an unassigned Task, assign itself or assign another active member. The current Assignee may transfer a non-terminal Task or release it to the public pool. Assignment needs no acceptance workflow and does not alter already-frozen AgentRuns. A removed or disabled Assignee remains historically referenced and produces `assignee_unavailable`; only the User may repair or cancel that Task.

User reads and updates all Camp Tasks. Default Lead reads all Camp Tasks but gains no write authority from the role. An ordinary member reads its own assigned Tasks plus unassigned Tasks, may claim an unassigned Task atomically, and otherwise updates only its own Tasks. Core applies the same visibility rule to list, by-ID reads and dynamic context.

Every active AgentProfile defaults to `task.create` and `task.update`; a CampMember override may revoke either. Task listing is a baseline member read operation rather than a separate Capability. User operations do not depend on Agent Capability.

Task creation, assignment and update never emit an implicit message, create AgentRun or wake Runtime. A User explicitly messages the responsible member when immediate action is needed. An Agent explicitly uses `team.post_message`; that tool does not accept a Task binding parameter. Task references in message text or generic references are collaborative context, not an execution relationship.

Task cannot be deleted or archived individually. Cancellation represents abandonment, and terminal Tasks remain queryable without entering the default active list. Permanent Camp deletion removes all owned Tasks.

<a id="adr-0012-dynamic-task-context"></a>
#### Dynamic Task context

Current AgentRun responsibility remains in `[WORK_BRIEF]`. Visible long-lived Tasks are injected separately as a bounded `[TASK_CONTEXT]` index so that background responsibilities cannot be mistaken for the current execution request.

Task Context contains only authorized active Task ID, title, status and Assignee. It omits descriptions and terminal history, uses deterministic priority/sorting, and explicitly reports omitted counts when its dedicated budget is exhausted. Default Lead receives the Camp-wide active scope; ordinary members receive assigned-to-self plus unassigned Tasks.

Task Context is frozen into the AgentRun ContextManifest under ADR-0049. Later Task changes never rewrite the same Run's input. An Agent must call `team.list_tasks` for full current detail and version before writing.

<a id="adr-0012-permanent-camp-deletion"></a>
#### Permanent Camp deletion

The Camp row menu exposes rename and permanent delete; no Archive, Unarchive or Trash commands exist. `DeleteCamp` is User-only and requires `commandId`, `expectedVersion` and explicit destructive confirmation.

Deletion is allowed only while the Camp is quiescent. Core rejects deletion while any CampTurn or AgentRun is non-terminal, Approval is pending, Action is executable or unresolved, cancellation/member exit is unfinished, a relevant Inbox/Runtime lease is active, or an external effect remains unreconciled. Stopping work and deleting the Camp are separate operations.

One SQLite transaction removes every Camp-owned record and relationship before deleting the Camp. Managed Blob content becomes collectable only after its final authoritative reference disappears. Lumen may remove Camp-private Git refs, but never deletes the repository, normal branches, worktrees, files or commits. Provider history cleanup is best effort and is not a deletion gate.

<a id="adr-0012-required-constraints"></a>
#### Required constraints

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

<a id="adr-0012-development-stage-migration"></a>
#### Development-stage migration

v0.06 performs an explicit collaboration-domain reset. Migration atomically removes existing Camps and all owned messages, Conversations, Tasks, Turns, Runs, Inbox records, Approvals, Actions, context records and Native Bindings. It preserves AgentProfiles, global Member Order, Adapter Installations, model/permission preferences and independent application settings.

Migration then creates one clean current schema. It does not retain a hidden legacy Task table, dual-write facade, Task Dependency, completion evidence protocol or old Task capabilities. Obsolete commands, handlers, contracts, Renderer branches, fixtures and compatibility code must be removed with the schema.

This data loss is accepted because the product is still under development and deterministic current semantics are more valuable than speculative recovery of test history. Migration remains atomic, versioned and repeatable; users must not need to delete SQLite manually.

<a id="adr-0012-consequences"></a>
### Consequences

- Camp remains the single durable public conversation and Project remains a derived local-codebase grouping.
- Task becomes cheap enough for Agents to use as durable coordination without turning every message into a workflow node.
- Assignment is visible responsibility, not implicit execution. Callers must explicitly send a message when immediate work is desired.
- Default Lead can coordinate from a full Task view without becoming a universal administrator.
- Removing dependency and evidence gates reduces schema and command complexity, but Lumen no longer claims that `completed` proves quality or prerequisite satisfaction.
- Terminal Task retention preserves references and audit continuity while active views remain compact.
- The v0.06 migration intentionally discards collaboration history and requires thorough removal of obsolete code.

<a id="adr-0012-rejected-alternatives"></a>
### Rejected Alternatives

- Keeping TaskDependency as a non-enforced hint: rejected because it would look authoritative while allowing contradictory state changes.
- Keeping hard Task dependencies: rejected because a lightweight responsibility item must not become a hidden workflow scheduler.
- Requiring Criterion—Evidence completion: rejected because v0.06 treats completion as an authorized declaration; future verification needs its own explicit model.
- Waking the Assignee when a Task is created or assigned: rejected because responsibility and Runtime execution have different lifecycles.
- Assignment Proposal or acceptance states: rejected because direct assignment plus explicit messaging is sufficient for the current product.
- Individual Task deletion or archive: rejected because cancellation preserves stable references without adding another lifecycle.
- Heuristically migrating legacy Task records: rejected because execution-era data cannot be truthfully reclassified as durable responsibility items.

<a id="adr-0012-references"></a>
### References

- [v0.06 Team Task 协作工具](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0016: Multi-Runtime Execution Boundary v2](decisions.md#adr-0016)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0015: Action and Safety v2](decisions.md#adr-0015)
- [Superseded ADR-0008: Collaboration v2](../v0.04/decisions.md#adr-0008)
<!-- legacy-adr-body:end id=ADR-0012 -->
<!-- legacy-adr:end id=ADR-0012 -->

<!-- legacy-adr:begin id=ADR-0013 source-file-sha256=c351d3060740ff8279482d7623b72bc42041a0acbf539a2dd79ef02af5a56bc8 -->
<a id="adr-0013"></a>

## ADR-0013: Managed Content and Read Side v2

迁移时原路径：`docs/adr/0013-managed-content-and-read-side-v2.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0013
title: "Managed Content and Read Side v2"
status: accepted
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0005]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0013 -->
<a id="adr-0013-context"></a>
### Context

ADR-0005 combined three boundaries: a Task completion Evidence service, a content-addressed Managed Blob store and a consistent SQLite Read Side. ADR-0012 removes structured Acceptance Criteria and Criterion—Evidence completion from Task, so the Evidence service and `task_evidence_binding` no longer have an authoritative caller.

Managed files and the Read Side remain necessary. ContextManifest, MessageAttachment and execution results need immutable content storage, while Renderer snapshots must still come from authoritative SQLite state rather than event replay or a second projection store. This ADR replaces ADR-0005 in full so that the surviving boundaries do not depend on an obsolete Task gate.

<a id="adr-0013-decision"></a>
### Decision

<a id="adr-0013-no-generic-task-evidence-service"></a>
#### No generic Task Evidence service

Task completion is an explicit authorized status update. It does not accept Criterion IDs, semantic attestations or completion evidence, and Core does not judge whether prose, code, tests or attachments satisfy a Task description.

The following protocol is removed:

```text
EvidenceService
EvidenceValidator for Task completion
CompleteTaskCommand with Criterion evidence
task_evidence_binding
Criterion—Evidence GC roots
```

Commands that accept an `EntityReference` validate their own closed set of reference types, Camp/Repository scope, visibility and object state. That command-specific validation must not be repackaged as a generic Artifact or Evidence authority.

Natural domain objects remain the source of their own facts:

```text
public discussion      → CampMessage
private continuity     → ConversationMessage
execution lifecycle    → AgentRun
side-effect result     → ActionExecution / ActionReceipt view
immutable local file   → MessageAttachment + Managed Blob
committed code         → Repository-scoped full Git Commit OID
state transition       → authoritative object + event_log
```

These objects may be linked from messages, Task descriptions or audit records, but a link does not become a Task completion gate.

<a id="adr-0013-managed-blob-store"></a>
#### Managed Blob store

`ManagedBlobStore` remains an independent infrastructure interface for immutable, content-addressed local content. It provides:

- streamed writes while calculating SHA-256;
- atomic placement at the content address;
- integrity validation and deduplication;
- streamed reads through authorized Core APIs;
- garbage collection based on authoritative references.

The write sequence remains:

```text
stream to private temporary file while hashing
→ fsync and atomically place at content address
→ transactionally create/reuse metadata and owning reference
→ collect unreferenced orphan content later
```

Current GC roots include every authoritative Managed Blob reference, such as MessageAttachment, Action result content, ContextManifest payloads and ContextSummary content. The root set is defined by current foreign-key/reference ownership, not a hard-coded assumption that Task evidence exists.

File-name normalization, size limits, media sniffing, path traversal prevention, private file permissions and secret-safe rendering remain mandatory. Managed Blob is storage infrastructure, not an Artifact aggregate, publication system or cross-Camp library.

<a id="adr-0013-read-model-and-subscriptions"></a>
#### Read model and subscriptions

Renderer DTOs are generated from SQLite authoritative tables and deterministic derived rules. Lumen does not create persistent projection tables or a second mutable runtime-state cache.

Every snapshot is read in one transaction and returns the captured `throughGlobalSequence`. Incremental subscription continues after that sequence. Incremental events are invalidation/timeline data; Renderer must not reconstruct authoritative Camp, Task, Run, Approval or Action state solely by replaying them.

On disconnection, sequence gap, unknown Schema Version or uncertain derived cache, Renderer discards the affected cache and fetches a new snapshot. Snapshot DTOs include an explicit Schema Version, and incompatible clients fail closed rather than guessing fields.

Task visibility is applied while querying authoritative rows:

- User and Default Lead read all Camp Tasks;
- an ordinary member reads assigned-to-self plus unassigned Tasks;
- active views default to `pending` and `in_progress`;
- terminal history requires an explicit filter.

Pagination and filtering occur after authorization scope is established. A caller cannot use filters, guessed IDs or stale cached rows to bypass visibility.

<a id="adr-0013-api-boundary"></a>
#### API boundary

Renderer reaches the Core only through the Electron Main allowlist and closed typed contracts. It has no direct SQLite, filesystem, Git, Shell or Managed Blob path access.

The current Camp-oriented surface includes:

```text
camps.* / camps.messages.* / camps.members.*
tasks.create / tasks.update / tasks.list
campTurns.* / agentRuns.*
inbox.* / approvals.* / actions.*
camps.snapshot
events.subscribe(fromGlobalSequence)
attachments.open / attachments.readMetadata
```

Exact transport method spelling can evolve with the closed contract, but there must be one authoritative write path per domain command and one scope-filtered Read Side.

<a id="adr-0013-migration"></a>
#### Migration

v0.06 removes `task_evidence_binding`, evidence-only indexes, completion-evidence request/response types, the old CompleteTask handler and tests that assert Criterion restoration. Obsolete code must be deleted rather than left unreachable.

Managed Blob metadata and content may be rebuilt as part of the collaboration-domain reset. Agent configuration survives, but old collaboration-owned Blob references and unreferenced content are removed through the same reset/GC boundary.

Read models, snapshots and Renderer contracts change atomically to the current Task shape. Legacy Task fields and Evidence DTOs do not remain as an alternate read model.

<a id="adr-0013-consequences"></a>
### Consequences

- Task status becomes simpler and honest: `completed` means declared complete, not independently verified.
- Removing `EvidenceService` and Task bindings reduces schema, command and GC complexity.
- Lumen retains safe local files, immutable context payloads and content integrity without introducing an Artifact aggregate.
- Command-specific reference validators may share low-level helpers, but no generic Evidence service decides business completion.
- Renderer remains resilient to restart and event gaps because snapshots, not event replay, are authoritative.
- Future machine-verifiable delivery gates require a separately named Verification or Review model with explicit lifecycle and invalidation rules.

<a id="adr-0013-rejected-alternatives"></a>
### Rejected Alternatives

- Keeping dormant `task_evidence_binding` for possible future use: rejected because it preserves obsolete authority and migration burden.
- Treating Task description as an implicit list of criteria parsed by an LLM: rejected because natural-language inference cannot change authoritative status.
- Converting every output into a generic Artifact: rejected because Message, Run, Action, Attachment and Commit already own their facts.
- Making Renderer an Event Sourcing projection: rejected because replay and current SQLite state would become competing truth sources.
- Persisting a second projection database for v0.06: rejected because current scale does not justify its synchronization and recovery cost.

<a id="adr-0013-references"></a>
### References

- [v0.06 Team Task 协作工具](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0012: Collaboration v3](decisions.md#adr-0012)
- [Superseded ADR-0005: Evidence & Read Side](../v0.02/decisions.md#adr-0005)
<!-- legacy-adr-body:end id=ADR-0013 -->
<!-- legacy-adr:end id=ADR-0013 -->

<!-- legacy-adr:begin id=ADR-0014 source-file-sha256=10c1974828f77ae760cb7d0bee6ff0a06a84b6c0a261cb126798156df0214947 -->
<a id="adr-0014"></a>

## ADR-0014: Stable Team Tool Gateway v2

迁移时原路径：`docs/adr/0014-stable-team-tool-gateway-v2.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0014
title: "Stable Team Tool Gateway v2"
status: accepted
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0011]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0014 -->
> 后续局部规范：[ADR-0067](../v0.21/decisions.md#adr-0067)
> 删除 A2A Task Context 注入假设；[ADR-0068](../v0.21/decisions.md#adr-0068)
> 与 [ADR-0069](../v0.21/decisions.md#adr-0069) 在同一
> Gateway 增加 Memory read/write tools；
> [ADR-0088](../v0.30/decisions.md#adr-0088) 为无法逐 Run 注入凭据的
> Runtime 增加 OS 进程证明 attachment，并局部替代本文的 Connector credential 与
> Antigravity Unsupported 条款；[ADR-0091](../v0.32/decisions.md#adr-0091)
> 局部替代本文的 `team.post_message` 名称、参数、直接创建目标 AgentRun、reply correlation
> 和 Task 不可链接条款；[ADR-0099](../v0.34/decisions.md#adr-0099) 又删除其
> 回传协议，并把每次 Member Call 统一为独立前向边。本文其余 Gateway、Binding、鉴权与
> 事务边界继续有效。

<a id="adr-0014-context"></a>
### Context

ADR-0011 established an App-lifetime local Team Tool Gateway, stateless Provider-launched MCP connectors and credentials bound to Native Binding rather than AgentRun. That topology solved Native Session reuse and stale per-Run connector credentials and remains correct.

ADR-0011 also fixed `team.post_message` as the only Team tool. Lumen now needs Agents to create, update and query lightweight Camp Tasks without opening a second MCP server or duplicating authorization. The new tools must use the same current-Run identity, execution fencing and command idempotency while preserving the rule that Task changes do not start Agent work.

This ADR replaces ADR-0011 in full and generalizes its stable gateway from one A2A tool to the current Team MCP tool set.

<a id="adr-0014-decision"></a>
### Decision

<a id="adr-0014-stable-gateway-and-replaceable-connectors"></a>
#### Stable gateway and replaceable connectors

Lumen Core starts one Team Tool Gateway for the App process lifetime on a permission-restricted local Unix Socket. It is the trusted entry point, current-identity resolver and authorization boundary for all Team MCP tools.

Codex, OpenCode, Copilot and Claude Code may start one or more stateless MCP stdio connectors according to their Host or Native Session lifecycle. A connector only translates MCP stdio to authenticated Core IPC. It does not read SQLite, retain domain state, decide permissions or become a queue.

Repeated connector startup, Provider-side MCP deduplication and Native Session reuse must not change tool semantics.

<a id="adr-0014-native-binding-credential"></a>
#### Native Binding credential

Connector credentials bind to `(nativeBindingId, nativeBindingGeneration)`, not AgentRun. Re-preparing the same valid Binding during one Core process yields compatible credentials; Core restart, rebind or generation change invalidates prior credentials.

Every invocation dynamically resolves:

```text
Native Binding
→ Conversation
→ exactly one current running AgentRun
→ executionEpoch
→ CampTurn / optional Task
→ AgentProfile + CampMember
→ effective Capability
```

Missing or ambiguous current Run, stale Binding/Generation/Epoch, terminal or cancelled Run, inactive membership and insufficient Capability fail closed. Connector credentials prove only the Binding; they never freeze a previous Run's authority.

`CampTurn.status` is an aggregate lifecycle state, not the sender's execution authority. A current
`running` AgentRun may continue using Team MCP while its non-cancelled CampTurn is `running` or
`waiting`; the latter can mean another responsibility in the same Turn is blocked on approval.
The sender Run itself must still be `running`, current-epoch and uncancelled.

<a id="adr-0014-team-mcp-tool-set"></a>
#### Team MCP tool set

The Team MCP exposes:

```text
team.post_message
team.create_task
team.update_task
team.list_tasks
```

There is no separate Task MCP, secondary socket or independent credential.

`team.post_message` remains an execution request to one other active CampMember. Its model-controlled arguments remain recipient, body, optional reply linkage and allowed generic references. It does not accept `taskId`. Core derives sender, Camp, source Run/Epoch, CampTurn, correlation and idempotency. Success atomically creates InboxMessage, target ConversationMessage, delivery ACK, target queued AgentRun and audit events. The target Run does not inherit the source Run's optional Task association; the A2A body and authorized Task Context carry collaboration context. Tool success means accepted for execution, not target completion.

`team.create_task` accepts title, optional description and optional Assignee. It creates one `pending` Task and never creates a message, Inbox delivery or AgentRun.

`team.update_task` accepts Task ID, expected version and a non-empty patch over title, description, status and Assignee. Omitted fields remain unchanged; a null Assignee releases the Task. The whole patch succeeds atomically or not at all.

`team.list_tasks` is an authenticated Read Side query with optional status, Assignee, limit and opaque pagination cursor filters. It returns only the caller's authorized scope, complete Task details, current version, available operations and explicit truncation/pagination information. It does not require a separate read Capability.

Models never provide `campId`, Actor, AgentRun, Epoch, command identity, Capability or idempotency key. The Gateway derives them from the Binding and Runtime tool-call identity. Unknown input fields fail schema validation.

<a id="adr-0014-authorization-and-scope"></a>
#### Authorization and scope

Tool discovery does not grant authority. `team.post_message` requires its A2A Capability and existing loop/target quotas. `team.create_task` requires `task.create`; `team.update_task` requires `task.update` plus the Task relationship rules from ADR-0012.

Every active AgentProfile defaults to `task.create` and `task.update`, subject to CampMember overrides. Default Lead reads every Camp Task but receives no additional Task write authority.

Task query scope is:

```text
Default Lead → all Camp Tasks
ordinary member → assigned-to-self + unassigned Tasks
```

Visibility is enforced before filters and pagination. Guessed IDs, Assignee filters and stale cached versions cannot reveal or mutate another member's hidden Task.

<a id="adr-0014-idempotency-and-transactions"></a>
#### Idempotency and transactions

Task writes and A2A delivery use the static typed `DomainCommandGateway` from ADR-0001. Runtime tool-call identity contributes to stable command identity and request digest. A repeated semantically identical write returns its persisted `command.result`; it does not create another Task, event, message or AgentRun.

The same command identity with different semantic input returns `idempotency_conflict`. Transactions contain only SQLite reads/writes and audit events; post-commit wakeups remain best effort and recoverable from authoritative object state.

`team.list_tasks` is read-only and does not create command results or events merely because the model queried it.

<a id="adr-0014-charter-and-tool-schema"></a>
#### Charter and Tool Schema

Core embeds `crates/rovai-core/resources/charter-team-tools.md` at build time. When a supported Adapter successfully binds Team MCP, Core appends that resource to the new Native Session Charter without replacing the Provider System Prompt.

The resource explains Task versus A2A use, visibility and completion semantics. It does not duplicate JSON Schema. MCP Tool Schema is the unique source for parameter names, required fields and types.

The embedded content participates in Charter Compatibility Digest. A semantic Charter change invalidates the old Native Session binding so the next Session receives the current contract; resuming the same compatible Session never repeats the Charter.

<a id="adr-0014-adapter-surface"></a>
#### Adapter surface

MCP configuration is appended to Provider-native configuration and does not replace user MCP or upstream prompts:

- Codex CLI uses its App Server/Native Thread MCP configuration;
- OpenCode CLI uses ACP Session MCP configuration;
- Copilot CLI uses its isolated ACP Host configuration;
- Claude Code CLI passes the private MCP config for print/resume and pre-authorizes only the Lumen Team tools.

Adapter availability is determined from the currently discovered local installation and capability probe rather than a fixed version whitelist.

Antigravity App remains unable to advertise or consume Team MCP until its local companion integration is empirically verified. It may execute ordinary Runs, but it is neither A2A-capable nor Task-Team-Tool-capable merely because an AgentProfile references it.

<a id="adr-0014-consequences"></a>
### Consequences

- One trusted local gateway serves A2A and Task collaboration without duplicated credentials, dispatchers or MCP configuration.
- Native Session reuse remains safe because authorization resolves the current Run on every call.
- Agents gain durable Task coordination while Task writes remain side-effect free with respect to Runtime scheduling.
- Read visibility and write Capability are independently enforced, so Default Lead can coordinate without becoming an administrator.
- Tool Schema, Charter prose and Core commands need coordinated versioning and contract tests.
- Providers without verified Team MCP support cannot use Task tools even though their Agents may still participate through user-driven Runs.

<a id="adr-0014-rejected-alternatives"></a>
### Rejected Alternatives

- A separate Task MCP server: rejected because it duplicates topology, credentials and Adapter injection.
- Per-AgentRun connector credentials: rejected because Providers may reuse the MCP process across Runs in one Native Session.
- Supplying `agentRunId`, `executionEpoch` or `campId` as model arguments: rejected because the model is not an authority source.
- Adding `taskId` to `team.post_message`: rejected because Task responsibility and AgentRun execution remain decoupled.
- Copying the source Run's Task association into every A2A target Run: rejected because the request may concern a newly created or entirely different Task and responsibility does not transfer.
- Waking the Assignee from `team.create_task` or `team.update_task`: rejected because Task mutation is not an execution command.
- Treating tool visibility as Capability: rejected because prompts and schemas are not security boundaries.
- Copying JSON Schema into Charter Markdown: rejected because parallel definitions drift.
- Claiming unsupported Antigravity Team Tool integration: rejected until local protocol verification succeeds.

<a id="adr-0014-references"></a>
### References

- [v0.06 Team Task 协作工具](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0016: Multi-Runtime Execution Boundary v2](decisions.md#adr-0016)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0012: Collaboration v3](decisions.md#adr-0012)
- [Superseded ADR-0011: Stable Team Tool Gateway](../v0.05/decisions.md#adr-0011)
<!-- legacy-adr-body:end id=ADR-0014 -->
<!-- legacy-adr:end id=ADR-0014 -->

<!-- legacy-adr:begin id=ADR-0015 source-file-sha256=f0b29017d92fffeccf6671e4d376a90a87b758aa132d34cb3d811e1e562c7d62 -->
<a id="adr-0015"></a>

## ADR-0015: Action and Safety v2

迁移时原路径：`docs/adr/0015-action-safety-v2.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0015
title: "Action and Safety v2"
status: superseded
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0004]
superseded_by: ADR-0059
```

<!-- legacy-adr-body:begin id=ADR-0015 -->
<a id="adr-0015-context"></a>
### Context

ADR-0004 established the durable ActionExecution, single-action Approval, dispatch-attempt fencing, unknown-effect reconciliation and explicit AgentRun Workspace boundaries. Those safety rules remain necessary.

Its acceptance criteria also require Git Commit evidence before Task completion. ADR-0012 and ADR-0013 remove Task completion evidence entirely: Task `completed` is now an authorized declaration, while Action, Commit, Attachment and execution records retain their own natural authority. This ADR replaces ADR-0004 in full so that action safety remains current without preserving an obsolete Task gate.

<a id="adr-0015-decision"></a>
### Decision

<a id="adr-0015-actionexecution-is-the-side-effect-truth"></a>
#### ActionExecution is the side-effect truth

`ActionExecution` is the unique persistent truth for every restricted or potentially side-effecting operation:

```text
prepared
→ executing
→ succeeded | failed | unknown

prepared
→ not_executed
```

A deterministic terminal Action may be projected as an ActionReceipt view, but Lumen does not create a second receipt table or alternate outcome state.

Before dispatch, Core freezes a stable action ID, closed Action Kind, normalized parameters, action digest, source AgentRun and control mode:

- `mediated`: Core performs the operation and can enforce persist-before-dispatch;
- `intercepted`: Runtime asks Lumen before dispatch through a protocol gate;
- `observed`: Runtime reports an already-attempted effect, so Lumen can audit/reconcile but cannot claim prior authorization or exactly-once execution.

The versioned closed Action Kind registry defines normalization and recording rules. Shell execution, file writes, Git mutations, external write APIs, sensitive reads and semantically unknown tools default to an ActionExecution boundary.

<a id="adr-0015-approval-authorizes-one-prepared-action"></a>
#### Approval authorizes one prepared action

Approval answers only whether one normalized `ActionExecution(prepared)` is authorized. Its identity includes at least:

```text
actionId
actionKind
actionDigest
targetUserId
```

Only the target User resolves the Approval. `approved` means authorized, not dispatched or succeeded. Denial, cancellation and expiry move the Action to an appropriate `not_executed` reason.

Reusable Agent/Adapter permission configuration is not an Approval. Approval cannot grant a vague future ability or authorize a different action digest.

<a id="adr-0015-dispatch-attempts-and-reconciliation"></a>
#### Dispatch, attempts and reconciliation

Each dispatch attempt has a distinct fenced identity and dispatch marker. An old attempt, Runtime callback or epoch cannot overwrite a newer fact.

When Core cannot prove whether an external operation was dispatched, the Action becomes `unknown`; timeout or disconnect must not be rewritten as `failed` or `not_executed`. Automatic retry is allowed only when non-occurrence is proven or the external target provides safe stable idempotency.

Manual abandonment of reconciliation preserves the unknown fact and forbids replay of the same Action ID.

Authorization/result delivery to Runtime uses a narrow checkpoint bound to payload digest, target execution epoch and Native request identity. An ACK proves only receipt of that exact payload. Lumen does not blindly resend an authorization when the Runtime protocol cannot prove idempotent receipt.

<a id="adr-0015-workspace-and-git"></a>
#### Workspace and Git

AgentRun freezes its execution workspace before Native Runtime binding:

```text
executionRoot
read_only | write
shared | git_worktree
repositoryScopeId
baseGitCommit
```

The binding cannot silently change during the Run. Core does not promise automatic Worktree creation, merge, cleanup or workspace write locks. User/Agent performs those operations through explicit ActionExecution-governed Git/file actions.

Repository-scoped full Git Commit OIDs, MessageAttachments and Action results retain their own stable identities. They may be referenced from collaboration records, but Core does not require any of them to mark a lightweight Task completed.

<a id="adr-0015-recovery-and-scanning"></a>
#### Recovery and scanning

Action Executor, Reconciler, Delivery handler and cancellation finalizer scan their own authoritative states and use lease/fencing ownership. App recovery reconciles unknown Actions and incomplete Runtime deliveries before resuming affected AgentRuns.

The v0.06 collaboration reset removes Actions and Approvals owned by discarded Camps in the same atomic migration. New Action/Approval schema and behavior continue unchanged after the reset; no orphan action is retained without its Camp/Run authority.

<a id="adr-0015-consequences"></a>
### Consequences

- Authorization, dispatch, external occurrence, result and Runtime receipt remain separate facts that UI and audit can explain after crashes.
- `unknown` prevents unsafe automatic replay but may require explicit reconciliation or user intervention.
- All identifiable effects require stable IDs, normalized digests and attempt fencing, increasing implementation cost in exchange for recoverability.
- Task completion no longer certifies code, tests, commits or action outcomes. Products that need such a gate must add a separately modeled Verification/Review protocol.
- Workspace isolation remains explicit and inspectable without forcing Worktree management into Task.

<a id="adr-0015-rejected-alternatives"></a>
### Rejected Alternatives

- Approval as execution result: rejected because authorization and occurrence are different facts.
- PreparedAction and ActionReceipt as two authoritative stores: rejected because they can diverge.
- Treating timeout as failure/non-occurrence: rejected because an external effect may already have happened.
- Blind retry after lost ACK: rejected unless dispatch/receipt idempotency is proven.
- Generic Outbox as Action truth: rejected because ActionExecution already carries recoverable eligibility and result state.
- Requiring Action, Commit or Attachment evidence before Task completion: rejected because lightweight Task completion is an authorized declaration.
- Automatic Worktree Manager or implicit workspace lock: rejected because isolation is an execution strategy, not Task lifecycle.

<a id="adr-0015-references"></a>
### References

- [v0.06 Team Task 协作工具](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0016: Multi-Runtime Execution Boundary v2](decisions.md#adr-0016)
- [ADR-0012: Collaboration v3](decisions.md#adr-0012)
- [ADR-0013: Managed Content and Read Side v2](decisions.md#adr-0013)
- [Superseded ADR-0004: Action & Safety](../v0.02/decisions.md#adr-0004)
<!-- legacy-adr-body:end id=ADR-0015 -->
<!-- legacy-adr:end id=ADR-0015 -->

<!-- legacy-adr:begin id=ADR-0016 source-file-sha256=4b38e378232fb0bb14ea23590870e8c134b8bc485aa6c52325be8b9d6a7c17c5 -->
<a id="adr-0016"></a>

## ADR-0016: Multi-Runtime Execution Boundary v2

迁移时原路径：`docs/adr/0016-multi-runtime-execution-v2.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0016
title: "Multi-Runtime Execution Boundary v2"
status: superseded
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0003, ADR-0006]
superseded_by: ADR-0065
```

<!-- legacy-adr-body:begin id=ADR-0016 -->
<a id="adr-0016-context"></a>
### Context

ADR-0003 established Conversation-scoped Native Binding, AgentRun execution epochs, Host/event fencing and recoverable Runtime scheduling, but described a Codex-centered topology, fixed version matrix and an unresolved RT-02 input policy.

ADR-0006 introduced `AgentRuntimeAdapter` and multiple locally installed CLI products, but its built-in list predates Claude Code support and still names the Antigravity integration as an `agy` product Adapter rather than Antigravity App with a companion process. ADR-0009 has since closed RT-02 with immutable ContextManifest delivery, and current Adapter support is discovered from the user's installed tools rather than fixed versions.

This ADR replaces ADR-0003 and ADR-0006 in full. It preserves their execution safety and Adapter abstraction while defining the current multi-Runtime boundary from one source.

<a id="adr-0016-decision"></a>
### Decision

<a id="adr-0016-domainruntime-boundary"></a>
#### Domain/runtime boundary

Rust Core exposes one Coding Agent Runtime abstraction named `AgentRuntimeAdapter`. There is no second public `AgentAdapter` interface.

Domain code owns Camp, Conversation, AgentRun, Action/Approval, context manifests and authoritative state transitions. An Adapter:

- discovers a local installation and authentication availability;
- reports observed capabilities, models and native configuration options;
- validates and freezes the configuration selected for one AgentRun;
- translates Provider protocol events and requests into closed Core commands;
- owns its Host/process, Native Session, Resume, interrupt and cleanup strategy.

Core never depends directly on an App Server, ACP or CLI-output protocol type. Shared protocol clients are implementation libraries, not product Adapter identities.

<a id="adr-0016-built-in-adapters"></a>
#### Built-in Adapters

The current built-in registry contains:

```text
AgentRuntimeAdapter
├── CodexCliRuntimeAdapter       → Codex App Server / Native Thread
├── OpenCodeCliRuntimeAdapter    → typed ACP client
├── CopilotCliRuntimeAdapter     → typed ACP client
├── ClaudeCodeCliRuntimeAdapter  → Claude Code CLI Session/JSON protocol
└── AntigravityAppRuntimeAdapter → local agy companion process
```

OpenCode and Copilot may share ACP transport code but remain distinct Adapters with separate capability, permission and lifecycle semantics. Antigravity App is the product-facing Adapter kind; `agy` is only its local companion launch mechanism and legacy discovery alias.

The registry is compiled into Lumen. Dynamic third-party Adapter loading requires a future ADR covering trust, compatibility, upgrade and sandbox boundaries.

<a id="adr-0016-adapterinstallation-and-agent-configuration"></a>
#### AdapterInstallation and Agent configuration

`AdapterInstallation` is an application-level shared launch target identified by Adapter kind, stable executable/launch identity and configuration/authentication scope. Multiple AgentProfiles may use one Installation while keeping independent model and native permission preferences.

Installation discovery records the current executable fingerprint/version as observation, not as a version lock. Each launch or explicit refresh revalidates the actual installation and capabilities. Lumen does not restrict supported Agents to versions tested during development.

AgentProfile defaults, optional Conversation overrides and AgentRun-frozen configuration remain separate:

```text
AgentProfile defaults
→ Conversation explicit override
→ resolve and validate current Installation capabilities
→ freeze actual configuration on AgentRun
```

Later profile, model, permission or installation changes never rewrite an existing Run.

<a id="adr-0016-host-and-process-topology"></a>
#### Host and process topology

`AgentRuntimeHostManager` and `AgentRuntimeHost` are Adapter-internal lifecycle components, not domain entities or a required one-process-per-Conversation topology.

An Adapter may use a shared compatible Host, a bounded pool, one Host per Run or a short-lived process according to its verified protocol. Reuse keys include every Host-level value that could leak account, configuration, MCP or environment state. Run/Thread-level cwd, Workspace, model, permissions, Charter and tools must never cross bindings.

Codex can reuse compatible App Server Hosts with multiple Native Threads. OpenCode and Copilot may use isolated ACP Hosts where dynamic configuration cannot safely share. Claude Code and Antigravity use their verified CLI/session process strategies. These are implementation policies, not persistent collaboration invariants.

<a id="adr-0016-native-binding-scheduling-and-fencing"></a>
#### Native Binding, scheduling and fencing

A Conversation persists one current Native Binding:

```ts
type NativeBinding = {
  adapterInstallationId: string;
  nativeSessionId: string;
  bindingCompatibilityDigest: string;
  generation: number;
};
```

The runtime registry maps Provider-native Session/Thread/Turn identifiers to Conversation, active AgentRun and `executionEpoch`. A Runtime event or Tool call may enter a domain command only when Host/process identity, Native Binding generation, Native Turn, AgentRun and epoch resolve uniquely.

One Conversation has at most one current running or waiting AgentRun. Different Conversations may execute concurrently when the selected Adapters and Hosts support it. A new execution lease increments the epoch; stale Host, Session, Turn, callback and Tool identities fail closed.

No token output is proof of idle state. A Host/Run is reclaimable only after Native Turn, reverse requests, Tool calls, Runtime deliveries, Approval/Action results and cancellation facts are terminal or durably recoverable.

<a id="adr-0016-input-and-session-continuity"></a>
#### Input and Session continuity

Every AgentRun consumes its unique immutable ContextManifest under ADR-0049. RT-02 is closed: retry/recovery of the same Run uses the same frozen Lumen payload and never reassembles a semantically similar prompt from newer database state.

Adapter System Prompt remains upstream-owned. Lumen appends compatible Session Charter content when supported and otherwise puts it in the first frozen payload without replacing the upstream prompt. New Native Sessions Bootstrap from Lumen-owned portable context; Resume uses the current compatible binding.

Switching Adapter Installation or any configuration included in `bindingCompatibilityDigest` preserves Conversation identity but requires prepare-then-CAS replacement of the Native Session. Lumen does not migrate Provider-hidden reasoning, private compression or undisclosed tool state.

<a id="adr-0016-recovery"></a>
#### Recovery

Recovery proceeds from authoritative state:

```text
fence failed Host/process and old epoch
→ preserve or derive the Run's real waiting reason
→ reconcile Approval, Action and Runtime delivery
→ prove replay safety
→ reacquire execution lease and increment epoch
→ Resume compatible Native Session or prepare-and-bind a new Session
→ continue, wait or terminate deterministically
```

Unknown external effects and uncertain input delivery are reconciled before model execution resumes. Process restart is never treated as proof that a command, prompt or effect did not occur.

<a id="adr-0016-optional-capabilities"></a>
#### Optional capabilities

Adapter capabilities are explicit observations, not assumed lowest-common-denominator behavior. Examples include Native Session Resume, appended Charter, model discovery, structured permissions, Action interception and Team MCP injection. A2A receipt and Team Tool origination are separate capabilities: Core can deterministically launch any ready recipient Runtime from an authenticated `team.post_message`, while only a Runtime with an isolated, verified Team MCP projection may originate or continue a Team Tool chain.

Core and UI expose unsupported capabilities honestly. In particular, Codex, OpenCode, Copilot and Claude Code may advertise Team MCP only after real local discovery/Smoke. Antigravity 2.0 Desktop App itself supports standard MCP, including workspace-scoped configuration; Rovai-ai 当前的 `antigravity-app` Adapter 实际仍启动 `agy --print` companion，并未控制 Desktop App。Adapter 名称不再成为发送侧硬编码拒绝条件，发送准入只检查冻结的 `team_tool.post_message` capability。当前 companion 尚未声明该 capability，因此可作为普通 direct/A2A 目标 Runtime，但不能主动继续 `team.post_message`；未来 Desktop App Host 完成隔离注入与 Smoke 后可直接通过 capability 解锁。

<a id="adr-0016-consequences"></a>
### Consequences

- Collaboration and scheduling use one stable Adapter contract while Provider protocol details stay isolated.
- Current local Agent upgrades are recognized by discovery without changing AgentProfile or Conversation identity.
- Native Binding and epoch fencing prevent stale processes, callbacks and MCP connectors from mutating new Runs.
- Immutable ContextManifest delivery makes retry and recovery byte-stable for Lumen-owned input.
- A receiver Runtime does not need the sender-side Team MCP capability; leaf A2A execution and chain continuation remain explicit, distinct states.
- Adapter-specific Host strategies can evolve without changing the domain model, but every reuse policy requires isolation tests.
- Unsupported features remain visible as capability gaps rather than being approximated unsafely.

<a id="adr-0016-rejected-alternatives"></a>
### Rejected Alternatives

- A public `AgentAdapter` beside `AgentRuntimeAdapter`.
- Core depending directly on Codex App Server, ACP or CLI JSON/text output.
- Treating a shared ACP client as the OpenCode/Copilot product Adapter.
- A global Runtime Host singleton or one-process-per-Conversation domain invariant.
- Per-AgentProfile executable/installation copies and repeated authentication truth.
- Fixed CLI version allowlists as the support policy.
- Rebuilding the same AgentRun input from current database state after a crash.
- Replacing Provider System Prompt with Lumen Charter.
- Claiming Antigravity Team Tool support without a verified local protocol.
- Loading arbitrary third-party Adapter binaries before a dedicated trust-boundary ADR.

<a id="adr-0016-references"></a>
### References

- [v0.06 Team Task 协作工具](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0012: Collaboration v3](decisions.md#adr-0012)
- [ADR-0014: Stable Team Tool Gateway v2](decisions.md#adr-0014)
- [ADR-0059: Runtime-Owned Resource Permissions and Path-Only Run Workspace](../v0.16/decisions.md#adr-0059)
- [Superseded ADR-0015: Action and Safety v2](decisions.md#adr-0015)
- [Superseded ADR-0003: Execution Runtime](../v0.02/decisions.md#adr-0003)
- [Superseded ADR-0006: Multi-Runtime Adapter Boundary](../v0.03/decisions.md#adr-0006)
<!-- legacy-adr-body:end id=ADR-0016 -->
<!-- legacy-adr:end id=ADR-0016 -->
