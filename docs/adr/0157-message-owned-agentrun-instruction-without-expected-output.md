---
document_type: adr
id: ADR-0157
title: Message-Owned AgentRun Instruction Without Expected Output Metadata
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
---

# ADR-0157: Message-Owned AgentRun Instruction Without Expected Output Metadata

## Context

Every AgentRun currently persists a required free-text `expectedOutput`, but Core does not materialize that
field into `CURRENT_INPUT`, Session Bootstrap or another Runtime input. It does not participate in admission,
scheduling, completion, public-output publication or quality verification. Direct user execution and Message
Delivery therefore fill the field with generic producer-owned text that is neither an authoritative user
instruction nor an enforced acceptance criterion.

The immutable trigger CampMessage or ConversationMessage already owns the per-Run natural-language request.
Task admission facts establish responsibility identity without duplicating mutable Task content, while Runtime,
public-output and cancellation contracts define execution behavior. Retaining a mandatory but behaviorally inert
output field creates a false contract surface and invites callers to assume enforcement that does not exist.

## Decision

The trigger Message body delivered as `CURRENT_INPUT` is the sole per-AgentRun natural-language work instruction.
`purpose` remains a compact Core audit and responsibility descriptor; it is not a second model-input instruction.
Stable execution, Runtime, Task and public-output contracts continue to provide their own non-natural-language
behavioral constraints.

Core removes `expectedOutput` from execution request IPC, AgentRun domain and read models, SQLite persistence and
producer-specific defaults. No optional replacement, derived value or compatibility alias is introduced. The
schema migration drops only the obsolete column and preserves existing AgentRun identity, lifecycle, lineage,
Task admission, Runtime snapshot and evidence.

Core does not infer successful work from Runtime final text or compare an outcome with free-text output metadata.
AgentRun lifecycle remains observation-based, and public Camp output remains governed by the explicit Runtime
public-output boundary and successful `rovai send` operations.

This decision locally replaces ADR-0137 clauses that assign work-instruction ownership to a combination of
message, purpose and expected-output contracts. ADR-0137's one-time Task-linked admission, frozen admission facts,
grandfathering and explicit cancellation boundaries remain unchanged.

## Consequences

Execution requests and AgentRun read models become smaller and no longer claim an unenforced acceptance contract.
Every caller relies on the same trigger Message bytes that Context already freezes and delivers. Historical
`expected_output` text is discarded during migration because no runtime, recovery or audit decision consumes it.

Removing a previously required IPC and read-model field is a deliberate clean break. Callers compiled against the
old shape must stop sending or reading it. Product behavior does not lose a Runtime instruction because the field
was never delivered to Runtime.

## Rejected Alternatives

- Injecting `expectedOutput` into every Runtime request was rejected because generic producer text would duplicate
  or conflict with the authoritative trigger Message and create a second natural-language instruction plane.
- Keeping an optional deprecated field was rejected because it would preserve ambiguous ownership and indefinite
  compatibility work without any behavioral consumer.
- Deriving expected output from Task Acceptance Criteria was rejected because ordinary Runs need not be Task-linked
  and accepted Task responsibility must not become a continuously re-evaluated execution fence.
- Removing `purpose` in the same decision was rejected because it still provides a compact responsibility and audit
  descriptor independently of model input.

## References

- [v0.58 overview](../versions/v0.58/README.md)
- [ADR-0134: Explicit Runtime Public Output Boundary](0134-runtime-public-output-boundary.md)
- [ADR-0137: One-Time Task-Linked Responsibility Admission](0137-one-time-task-linked-responsibility-admission.md)
- [ADR-0147: Lossless Model Context Projection](0147-lossless-model-context-projection-and-layered-delivery-evidence.md)
- [Durable Task v3](../contracts/durable-task-v3.md)
- [Message Delivery v1](../contracts/message-delivery-v1.md)
