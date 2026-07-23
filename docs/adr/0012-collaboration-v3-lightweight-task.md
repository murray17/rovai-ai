---
document_type: adr
id: ADR-0012
title: "Collaboration v3: Camp and Lightweight Task"
status: accepted
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0008]
superseded_by: null
---

# ADR-0012: Collaboration v3 — Camp and Lightweight Task

## Context

ADR-0008 established the current Camp-centered product model, derived Project navigation, first-message Camp creation and permanent Camp deletion. Those boundaries remain correct.

Its Task model no longer matches Lumen's collaboration goal. It treats Task as a structured work commitment with a hard prerequisite DAG, completion evidence and execution-readiness gates. In practice, Agent collaboration needs a lighter durable responsibility record that can remain visible across messages and AgentRuns without becoming a workflow engine. Creating or assigning that record must not silently start Runtime work.

The old schema also contains development-stage compatibility data, legacy Task-as-execution semantics and commands that would force the implementation to carry two meanings for the same table. This ADR replaces ADR-0008 in full so that the unchanged Camp model and the new Task boundary remain available from one current source.

## Decision

### Collaboration aggregate

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

### Project projection and repository binding

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

### Creation, members and routing

Clicking “New conversation” creates only transient Renderer state. The first non-empty user message submits one idempotent command that atomically creates the Camp, initial CampMembers, one Conversation per member, Default Lead, CampMessage, CampTurn and requested AgentRuns. It does not create a Task. Failed preflight leaves no partial Camp.

New Camps snapshot all currently active AgentProfiles. At least one active member must be Runtime Ready. Global Member Order selects the first Runtime Ready member as initial Default Lead. Later profile creation, member reorder or readiness changes do not silently rewrite existing Camp membership or Lead.

Default Lead is only the destination for unaddressed execution requests and the Camp-wide coordination reader. Explicit addresses and replies take precedence. Lead changes affect future routing only and never transfer Task responsibility, rewrite history or replace an already-running AgentRun.

### Messages and execution

CampMessage and ConversationMessage keep independent monotonically increasing sequences. Public messages are materialized into Conversations according to the context-delivery protocol. Only a structured execution request creates CampTurn and AgentRun; ordinary stored messages, Task changes and Runtime status notifications do not.

One trigger creates at most one CampTurn. A multi-Agent request creates its target AgentRuns atomically. AgentRun remains the persistent, recoverable execution lifecycle bound to one Conversation and an optional Task. One Conversation may have at most one current running or waiting AgentRun.

InboxMessage remains single-recipient reliable delivery. It carries A2A execution requests and replies but does not transfer Task responsibility or substitute for Task, Approval, Action or AgentRun.

### Lightweight Task

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

### Dynamic Task context

Current AgentRun responsibility remains in `[WORK_BRIEF]`. Visible long-lived Tasks are injected separately as a bounded `[TASK_CONTEXT]` index so that background responsibilities cannot be mistaken for the current execution request.

Task Context contains only authorized active Task ID, title, status and Assignee. It omits descriptions and terminal history, uses deterministic priority/sorting, and explicitly reports omitted counts when its dedicated budget is exhausted. Default Lead receives the Camp-wide active scope; ordinary members receive assigned-to-self plus unassigned Tasks.

Task Context is frozen into the AgentRun ContextManifest under ADR-0009. Later Task changes never rewrite the same Run's input. An Agent must call `team.list_tasks` for full current detail and version before writing.

### Permanent Camp deletion

The Camp row menu exposes rename and permanent delete; no Archive, Unarchive or Trash commands exist. `DeleteCamp` is User-only and requires `commandId`, `expectedVersion` and explicit destructive confirmation.

Deletion is allowed only while the Camp is quiescent. Core rejects deletion while any CampTurn or AgentRun is non-terminal, Approval is pending, Action is executable or unresolved, cancellation/member exit is unfinished, a relevant Inbox/Runtime lease is active, or an external effect remains unreconciled. Stopping work and deleting the Camp are separate operations.

One SQLite transaction removes every Camp-owned record and relationship before deleting the Camp. Managed Blob content becomes collectable only after its final authoritative reference disappears. Lumen may remove Camp-private Git refs, but never deletes the repository, normal branches, worktrees, files or commits. Provider history cleanup is best effort and is not a deletion gate.

### Required constraints

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

### Development-stage migration

v0.06 performs an explicit collaboration-domain reset. Migration atomically removes existing Camps and all owned messages, Conversations, Tasks, Turns, Runs, Inbox records, Approvals, Actions, context records and Native Bindings. It preserves AgentProfiles, global Member Order, Adapter Installations, model/permission preferences and independent application settings.

Migration then creates one clean current schema. It does not retain a hidden legacy Task table, dual-write facade, Task Dependency, completion evidence protocol or old Task capabilities. Obsolete commands, handlers, contracts, Renderer branches, fixtures and compatibility code must be removed with the schema.

This data loss is accepted because the product is still under development and deterministic current semantics are more valuable than speculative recovery of test history. Migration remains atomic, versioned and repeatable; users must not need to delete SQLite manually.

## Consequences

- Camp remains the single durable public conversation and Project remains a derived local-codebase grouping.
- Task becomes cheap enough for Agents to use as durable coordination without turning every message into a workflow node.
- Assignment is visible responsibility, not implicit execution. Callers must explicitly send a message when immediate work is desired.
- Default Lead can coordinate from a full Task view without becoming a universal administrator.
- Removing dependency and evidence gates reduces schema and command complexity, but Lumen no longer claims that `completed` proves quality or prerequisite satisfaction.
- Terminal Task retention preserves references and audit continuity while active views remain compact.
- The v0.06 migration intentionally discards collaboration history and requires thorough removal of obsolete code.

## Rejected Alternatives

- Keeping TaskDependency as a non-enforced hint: rejected because it would look authoritative while allowing contradictory state changes.
- Keeping hard Task dependencies: rejected because a lightweight responsibility item must not become a hidden workflow scheduler.
- Requiring Criterion—Evidence completion: rejected because v0.06 treats completion as an authorized declaration; future verification needs its own explicit model.
- Waking the Assignee when a Task is created or assigned: rejected because responsibility and Runtime execution have different lifecycles.
- Assignment Proposal or acceptance states: rejected because direct assignment plus explicit messaging is sufficient for the current product.
- Individual Task deletion or archive: rejected because cancellation preserves stable references without adding another lifecycle.
- Heuristically migrating legacy Task records: rejected because execution-era data cannot be truthfully reclassified as durable responsibility items.

## References

- [v0.06 Team Task 协作工具](../versions/v0.06/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0015: Action and Safety v2](0015-action-safety-v2.md)
- [Superseded ADR-0008: Collaboration v2](0008-collaboration-v2.md)
