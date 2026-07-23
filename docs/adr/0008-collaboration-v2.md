---
document_type: adr
id: ADR-0008
title: "Collaboration v2: Camp-Centered Navigation and Lifecycle"
status: superseded
date: 2026-07-22
decision_scope: cross-version
source_version: v0.04
supersedes: [ADR-0002]
superseded_by: ADR-0012
---

# ADR-0008: Collaboration v2 — Camp-Centered Navigation and Lifecycle

## Context

ADR-0002 established the Camp/Conversation/Task/AgentRun collaboration model, but its repository and lifecycle assumptions no longer match Lumen's product model. It assigned a unique Repository Scope to every Camp, migrated each legacy Project into one Camp, preserved all legacy audit data, and exposed user deletion as terminal Camp archival.

Lumen now presents each long-lived public collaboration context as one user-visible conversation. Multiple Camps may belong to the same local Git repository, Project must disappear when no Camp references it, legacy Task workspaces need independent navigation entries, and this early-stage product explicitly prefers a clean model over speculative recovery of inconsistent compatibility data. Users also require permanent Camp deletion rather than archive or trash.

This ADR replaces ADR-0002 in full so that unchanged collaboration boundaries and revised repository/lifecycle rules remain available from one current source of truth.

## Decision

### Collaboration aggregate

The authoritative collaboration model remains:

```text
Camp
├── CampMember → AgentProfile
├── CampMessage
├── Conversation (campId + agentProfileId unique)
│   └── ConversationMessage / Summary / Camp Cursor / current Native Session
├── Task + optional TaskDependency
├── CampTurn
│   └── AgentRun → Conversation + optional Task
└── InboxMessage
```

A Camp is the long-lived public collaboration context and the user-visible conversation entry. A Conversation is one AgentProfile's private continuity inside that Camp and must never become the public navigation object. A Task is an optional structured work commitment inside a Camp, not a conversation container. Lumen does not introduce Project, Team, TeamRun, AgentInstance or AgentProfileVersion aggregates.

A Camp has no archive or trash lifecycle. In the authoritative v0.04+ model, a Camp either exists or has been permanently deleted. Legacy `status` and `archived_at` columns or values may exist only as migration inputs and must not drive new behavior.

### Project projection and repository binding

Project is a Read Side grouping of Camps, not an entity, table or aggregate. A Camp carries either no Project Binding and appears in the Lobby, or carries this value:

```ts
type ProjectBinding = {
  repositoryScopeId: string;
  projectRoot: string;
  gitCommonDir: string;
  objectFormat: "sha1" | "sha256";
};
```

Multiple Camps that refer to the same verified Git common directory share `repositoryScopeId` and appear under one Project. Therefore `camp.repository_scope_id` is indexed for lookup but is not unique. Paths describe current locations and do not define identity. Worktrees that resolve to the same Git common directory share a Project. Relocation requires explicit validation; Core must not infer identity from directory names, remotes or approximate content.

Each Camp may still use its own Lumen-managed internal Git ref namespace derived from `campId`; the shared Repository Scope does not merge Camp ownership, messages, permissions or mutable execution state. Repository evidence remains Camp-scoped unless another ADR explicitly introduces cross-Camp evidence authority.

Project name, order and existence are derived from its Camps. Deleting the final Camp with a given binding removes that Project from the Read Side. Selecting a folder never creates an empty Project record; the first Camp appears only when the user sends the first non-empty message.

### Creation, members and routing

Clicking “New conversation” creates only transient Renderer input state. The first non-empty user message submits one idempotent command that atomically creates the Camp, its initial CampMembers, one Conversation per member, Default Lead, initial CampMessage, CampTurn and requested AgentRun. A failed preflight leaves no partial Camp.

New Camps snapshot all currently active AgentProfiles as members. At least one active member must be Runtime Ready. Global Member Order selects the first Runtime Ready member as initial Default Lead; readiness does not grant Capability, and later profile additions or reorderings do not mutate existing Camps.

Default Lead remains only the target for unaddressed execution requests. Structured explicit addresses, replies and Task-directed actions take precedence. Changing Lead affects future routing only and never transfers Task ownership, rewrites messages or replaces an already-running AgentRun.

### Messages, context and execution

CampMessage and ConversationMessage retain independent monotonically increasing sequences. Public messages are materialized into each addressed Conversation as a continuous prefix. AgentRun input freezes initial Camp and Conversation watermarks; unrelated later messages cannot enter the same Run.

Only a structured execution request creates CampTurn/AgentRun. One trigger produces at most one CampTurn; a multi-Agent request creates all target Runs atomically. CampTurn aggregates the current responsibility Runs. AgentRun is the persistent, recoverable execution lifecycle and binds to one Conversation plus an optional Task. A Conversation may have at most one current running or waiting Run.

Task remains optional, flat and assigned to exactly one AgentProfile. TaskDependency expresses only same-Camp hard prerequisites. InboxMessage remains single-recipient reliable delivery and cannot transfer Task responsibility or substitute for Task, Review, Approval or AgentRun.

### Permanent deletion

The Camp row menu exposes `RenameCamp` and `DeleteCamp`; no Archive, Unarchive or Trash commands exist. `DeleteCamp` is User-only, permanently removes the Camp aggregate, and requires `commandId`, `expectedVersion` and explicit destructive confirmation.

Deletion is allowed only when the Camp is quiescent. Core must reject with structured blockers while any CampTurn or AgentRun is non-terminal, Approval is pending, ActionExecution is prepared/executing/active-unknown, cancellation or member exit is unfinished, a relevant Inbox/Runtime delivery lease is active, or an external side effect remains unreconciled. UI may help the user stop work, but stopping and deletion are separate commands; Lumen does not add `deleting` or `delete_requested` lifecycle state.

Once quiescent, one SQLite transaction removes every Camp-owned relationship and record before deleting the Camp. Failure rolls back the whole deletion. Managed Blob content becomes collectable only after its final authoritative reference is removed. Lumen may clean up its Camp-private Git refs, but never deletes the repository, ordinary branches, worktrees, user files or Git commits. Native Sessions are unbound locally; Provider-owned history cleanup is best effort and not a deletion gate.

A minimal successful command result may survive outside the deleted aggregate solely to make repeated use of the same `commandId` idempotent. It must not retain Camp content or provide archive, restore or browsing behavior.

### Migration

Valid v0.02/v0.03 Camps remain intact. A legacy Task that acted as a standalone conversation is imported as one Camp, receives the verified Project Binding of its Git workspace, and keeps readable Task/event/execution history where that mapping is deterministic. Lobby Tasks import as unbound Camps. Legacy Native Sessions are not resumed.

Migration does not guess. Dangling references, conflicting ownership, invalid repository bindings, missing required content and other non-deterministically recoverable compatibility data are discarded as the smallest internally consistent set. Migration records a concise diagnostic of discarded legacy IDs but does not block valid data. New writes must stop producing legacy Project or Task-as-conversation projections.

### Required constraints

At minimum, persistence must enforce:

```text
(camp_id, agent_profile_id) on camp_member
(camp_id, agent_profile_id) on conversation
(camp_id, sequence) on camp_message
(conversation_id, sequence) on conversation_message
conversation source Camp/Inbox message partial uniqueness
conversation native Session non-null partial uniqueness per Adapter installation
(camp_id, trigger_type, trigger_id) on camp_turn
one current running/waiting AgentRun per Conversation
AgentRun responsibility generation and predecessor uniqueness
(camp_id, idempotency_key) on inbox_message
repository_scope_id lookup without per-Camp uniqueness
Camp-private internal Git ref namespace uniqueness
```

## Consequences

- Navigation, public collaboration and deletion now align on Camp as the only durable user conversation object.
- Multiple Camps can safely group under one local Project without reviving a Project aggregate or empty Project records.
- Renderer code can derive Project/Camp trees directly from authoritative Camp data; Task no longer needs to masquerade as navigation.
- Permanent deletion provides the product behavior requested by users but intentionally removes audit and recovery history. Quiescence gates and transactional cascade are mandatory to prevent orphaned Runtime work and half-deleted aggregates.
- Early compatibility data may be lost. This is an accepted tradeoff in favor of deterministic migration and a clean current schema.
- Implementations must remove assumptions that Repository Scope is unique per Camp, that every Project has one compatibility Camp, or that Camp archival is the normal deletion path.

## Rejected Alternatives

- Retaining `ArchiveCamp` behind a “Delete” label: rejected because it contradicts the requested permanent deletion semantics and leaves hidden Project/Camp state.
- Deleting a running Camp and cancelling in the background: rejected because callbacks and external side effects could outlive their authority records, requiring a second deletion state machine.
- Keeping Project as a standalone row: rejected because it creates empty and stale project lifecycles that cannot be derived from user conversations.
- One compatibility Camp per legacy Project: rejected because it collapses formerly independent Task workspaces into one navigation entry.
- Heuristic repair of inconsistent legacy data: rejected because path/name/time guesses would contaminate the new authority model.

## References

- [v0.04 主工作区导航](../versions/v0.04/README.md)
- [ADR-0001 Core Transaction](0001-core-transaction.md)
- [ADR-0003 Execution Runtime](0003-execution-runtime.md)
- [ADR-0005 Evidence & Read Side](0005-evidence-read-side.md)
- [Superseded ADR-0002 Collaboration](0002-collaboration.md)
