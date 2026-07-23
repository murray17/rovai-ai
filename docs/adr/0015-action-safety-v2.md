---
document_type: adr
id: ADR-0015
title: "Action and Safety v2"
status: accepted
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0004]
superseded_by: null
---

# ADR-0015: Action and Safety v2

## Context

ADR-0004 established the durable ActionExecution, single-action Approval, dispatch-attempt fencing, unknown-effect reconciliation and explicit AgentRun Workspace boundaries. Those safety rules remain necessary.

Its acceptance criteria also require Git Commit evidence before Task completion. ADR-0012 and ADR-0013 remove Task completion evidence entirely: Task `completed` is now an authorized declaration, while Action, Commit, Attachment and execution records retain their own natural authority. This ADR replaces ADR-0004 in full so that action safety remains current without preserving an obsolete Task gate.

## Decision

### ActionExecution is the side-effect truth

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

### Approval authorizes one prepared action

Approval answers only whether one normalized `ActionExecution(prepared)` is authorized. Its identity includes at least:

```text
actionId
actionKind
actionDigest
targetUserId
```

Only the target User resolves the Approval. `approved` means authorized, not dispatched or succeeded. Denial, cancellation and expiry move the Action to an appropriate `not_executed` reason.

Reusable Agent/Adapter permission configuration is not an Approval. Approval cannot grant a vague future ability or authorize a different action digest.

### Dispatch, attempts and reconciliation

Each dispatch attempt has a distinct fenced identity and dispatch marker. An old attempt, Runtime callback or epoch cannot overwrite a newer fact.

When Core cannot prove whether an external operation was dispatched, the Action becomes `unknown`; timeout or disconnect must not be rewritten as `failed` or `not_executed`. Automatic retry is allowed only when non-occurrence is proven or the external target provides safe stable idempotency.

Manual abandonment of reconciliation preserves the unknown fact and forbids replay of the same Action ID.

Authorization/result delivery to Runtime uses a narrow checkpoint bound to payload digest, target execution epoch and Native request identity. An ACK proves only receipt of that exact payload. Lumen does not blindly resend an authorization when the Runtime protocol cannot prove idempotent receipt.

### Workspace and Git

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

### Recovery and scanning

Action Executor, Reconciler, Delivery handler and cancellation finalizer scan their own authoritative states and use lease/fencing ownership. App recovery reconciles unknown Actions and incomplete Runtime deliveries before resuming affected AgentRuns.

The v0.06 collaboration reset removes Actions and Approvals owned by discarded Camps in the same atomic migration. New Action/Approval schema and behavior continue unchanged after the reset; no orphan action is retained without its Camp/Run authority.

## Consequences

- Authorization, dispatch, external occurrence, result and Runtime receipt remain separate facts that UI and audit can explain after crashes.
- `unknown` prevents unsafe automatic replay but may require explicit reconciliation or user intervention.
- All identifiable effects require stable IDs, normalized digests and attempt fencing, increasing implementation cost in exchange for recoverability.
- Task completion no longer certifies code, tests, commits or action outcomes. Products that need such a gate must add a separately modeled Verification/Review protocol.
- Workspace isolation remains explicit and inspectable without forcing Worktree management into Task.

## Rejected Alternatives

- Approval as execution result: rejected because authorization and occurrence are different facts.
- PreparedAction and ActionReceipt as two authoritative stores: rejected because they can diverge.
- Treating timeout as failure/non-occurrence: rejected because an external effect may already have happened.
- Blind retry after lost ACK: rejected unless dispatch/receipt idempotency is proven.
- Generic Outbox as Action truth: rejected because ActionExecution already carries recoverable eligibility and result state.
- Requiring Action, Commit or Attachment evidence before Task completion: rejected because lightweight Task completion is an authorized declaration.
- Automatic Worktree Manager or implicit workspace lock: rejected because isolation is an execution strategy, not Task lifecycle.

## References

- [v0.06 Team Task 协作工具](../versions/v0.06/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
- [ADR-0013: Managed Content and Read Side v2](0013-managed-content-and-read-side-v2.md)
- [Superseded ADR-0004: Action & Safety](0004-action-safety.md)
