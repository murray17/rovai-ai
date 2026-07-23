---
document_type: adr
id: ADR-0013
title: "Managed Content and Read Side v2"
status: accepted
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0005]
superseded_by: null
---

# ADR-0013: Managed Content and Read Side v2

## Context

ADR-0005 combined three boundaries: a Task completion Evidence service, a content-addressed Managed Blob store and a consistent SQLite Read Side. ADR-0012 removes structured Acceptance Criteria and Criterion—Evidence completion from Task, so the Evidence service and `task_evidence_binding` no longer have an authoritative caller.

Managed files and the Read Side remain necessary. ContextManifest, MessageAttachment and execution results need immutable content storage, while Renderer snapshots must still come from authoritative SQLite state rather than event replay or a second projection store. This ADR replaces ADR-0005 in full so that the surviving boundaries do not depend on an obsolete Task gate.

## Decision

### No generic Task Evidence service

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

### Managed Blob store

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

### Read model and subscriptions

Renderer DTOs are generated from SQLite authoritative tables and deterministic derived rules. Lumen does not create persistent projection tables or a second mutable runtime-state cache.

Every snapshot is read in one transaction and returns the captured `throughGlobalSequence`. Incremental subscription continues after that sequence. Incremental events are invalidation/timeline data; Renderer must not reconstruct authoritative Camp, Task, Run, Approval or Action state solely by replaying them.

On disconnection, sequence gap, unknown Schema Version or uncertain derived cache, Renderer discards the affected cache and fetches a new snapshot. Snapshot DTOs include an explicit Schema Version, and incompatible clients fail closed rather than guessing fields.

Task visibility is applied while querying authoritative rows:

- User and Default Lead read all Camp Tasks;
- an ordinary member reads assigned-to-self plus unassigned Tasks;
- active views default to `pending` and `in_progress`;
- terminal history requires an explicit filter.

Pagination and filtering occur after authorization scope is established. A caller cannot use filters, guessed IDs or stale cached rows to bypass visibility.

### API boundary

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

### Migration

v0.06 removes `task_evidence_binding`, evidence-only indexes, completion-evidence request/response types, the old CompleteTask handler and tests that assert Criterion restoration. Obsolete code must be deleted rather than left unreachable.

Managed Blob metadata and content may be rebuilt as part of the collaboration-domain reset. Agent configuration survives, but old collaboration-owned Blob references and unreferenced content are removed through the same reset/GC boundary.

Read models, snapshots and Renderer contracts change atomically to the current Task shape. Legacy Task fields and Evidence DTOs do not remain as an alternate read model.

## Consequences

- Task status becomes simpler and honest: `completed` means declared complete, not independently verified.
- Removing `EvidenceService` and Task bindings reduces schema, command and GC complexity.
- Lumen retains safe local files, immutable context payloads and content integrity without introducing an Artifact aggregate.
- Command-specific reference validators may share low-level helpers, but no generic Evidence service decides business completion.
- Renderer remains resilient to restart and event gaps because snapshots, not event replay, are authoritative.
- Future machine-verifiable delivery gates require a separately named Verification or Review model with explicit lifecycle and invalidation rules.

## Rejected Alternatives

- Keeping dormant `task_evidence_binding` for possible future use: rejected because it preserves obsolete authority and migration burden.
- Treating Task description as an implicit list of criteria parsed by an LLM: rejected because natural-language inference cannot change authoritative status.
- Converting every output into a generic Artifact: rejected because Message, Run, Action, Attachment and Commit already own their facts.
- Making Renderer an Event Sourcing projection: rejected because replay and current SQLite state would become competing truth sources.
- Persisting a second projection database for v0.06: rejected because current scale does not justify its synchronization and recovery cost.

## References

- [v0.06 Team Task 协作工具](../versions/v0.06/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
- [Superseded ADR-0005: Evidence & Read Side](0005-evidence-read-side.md)
