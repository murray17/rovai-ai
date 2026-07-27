---
document_type: adr
id: ADR-0058
title: "Collaboration v4: Presence-Aware Routing and Execution Admission"
status: accepted
date: 2026-07-27
decision_scope: cross-version
source_version: v0.15
supersedes: [ADR-0012]
superseded_by: null
---

# ADR-0058: Collaboration v4 — Presence-Aware Routing and Execution Admission

## Context

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

A Camp is the long-lived public collaboration context and user-visible conversation entry. A
Conversation is one AgentProfile's private continuity inside that Camp. Task is an optional durable
responsibility item, not a conversation container, execution lifecycle, evidence package or
workflow node. Rovai-ai does not introduce Project, Team, TeamRun, AgentInstance or
AgentProfileVersion aggregates.

A Camp has no archive or trash lifecycle. It either exists or has been permanently deleted.

### Project projection and repository binding

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

### Camp membership and Member Presence

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

### Member Order

Member Order is one user-controlled global ordering. It is used for:

- member-directory presentation;
- new-Camp initial Default Lead selection after applying the creation-specific Runtime filter;
- future Default Lead repair in existing Camps.

Reordering never changes a currently valid Default Lead. When repair is later required, Core uses
the latest Member Order, not the order that existed when the Camp was created and not a circular
cursor after the former Lead. Ties use stable AgentProfile ID.

### New Camp creation

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

### Default Lead validity and reconciliation

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

### Addressing and execution admission

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

### Messages and execution

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

### Dynamic Task context

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

### Permanent Camp deletion

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

### Required constraints and migration

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

## Consequences

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

## Rejected Alternatives

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

## References

- [v0.15 成员生命周期与 Camp 执行准入](../versions/v0.15/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0007: Portable Conversation Handoff](0007-portable-conversation-handoff.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0015: Action and Safety v2](0015-action-safety-v2.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
- [ADR-0049: Reproducible Context Delivery v2](0049-reproducible-context-delivery-v2.md)
- [ADR-0057: Member Presence and Retained Permanent Removal](0057-member-presence-and-retained-removal.md)
- [Superseded ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
