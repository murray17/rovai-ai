---
document_type: adr
id: ADR-0180
title: Single Agent Memory Write Command with Outcome-Discriminated Output
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.73
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0180: Single Agent Memory Write Command with Outcome-Discriminated Output

## Context

ADR-0124 fixes separate `memory.write` and `memory.propose_hearth` Agent commands, and ADR-0135 currently projects
their different results. The Memory domain now requires the Agent to decide only whether one durable understanding
should be added, revised or not written. Whether a valid submission is immediately effective or enters isolated
Hearth review follows from the authenticated target Scope rather than an additional proposal decision by the model.

Keeping two verbs makes the model translate the same add/revise judgment into a second transport choice and exposes a
historical domain noun that no longer exists. Combining commands is nevertheless a transport decision: it must not
collapse Hearth Review Item into Memory or weaken user activation.

## Decision

Built-in Tool Transport v9 exposes exactly three Agent Memory commands:

```text
rovai memory search
rovai memory read
rovai memory write
```

`memory.propose_hearth` and `rovai memory propose-hearth` are removed from the fixed catalog, root help, exact-help
paths, Session Charter, Skills, schemas, fixtures and qualification. `memory.write` accepts only `add | revise`.
Companion and permitted directed Relationship targets commit an effective Memory/Revision; Hearth targets create an
isolated pending Hearth Review Item. The Agent never supplies a proposal flag or chooses a different operation.

Successful Agent stdout is a closed discriminated union:

```json
{"outcome":"effective","memoryId":"memory_123","revisionId":"revision_456"}
```

or:

```json
{"outcome":"review_pending","reviewItemId":"review_789"}
```

No additional fields are allowed. Business failures keep the existing closed error projection with stable code,
safe message and recovery. Ordinary stdout is an operation-specific Agent Result Projection, not a receipt; it never
contains canonical operation, requestId, receipt or the complete Envelope. Full canonical results, Envelope, receipt,
Replay and Evidence remain Core/host-only under ADR-0135.

v9 changes the fixed command set from thirteen to twelve and requires a new contract version, CLI command version,
catalog digest, Runtime capability, exact help, input schema, output schema and golden fixtures. All nine supported
Runtimes must prove correct command choice, effective-versus-review-pending reporting and conflict read-then-decide
behavior before the transport version is complete.

This decision locally replaces only ADR-0124's fixed Memory command list and only ADR-0135's `memory.write` /
`memory.propose_hearth` Agent output clauses. Their CLI-only transport, equal Member eligibility, lease, Envelope,
receipt, Replay, recovery and projection boundaries remain effective. The independent Hearth Review domain remains
effective even if a future transport successor reintroduces separate presentation commands.

## Consequences

- The Agent makes one semantic add/revise decision and learns effectiveness from a typed result instead of choosing a
  proposal verb.
- The catalog and every supported Runtime move together to v9; mixed v8/v9 command exposure is not supported.
- Agent wording can be tested precisely: `review_pending` must never be described as saved or effective.
- The single command does not make Memory and Hearth Review one aggregate; Core still routes to distinct domain
  modules and persistence invariants.

## Rejected Alternatives

- **Keep both commands indefinitely.** It preserves an avoidable transport choice and the obsolete Proposal term after
  the domain has moved to Review Item.
- **Return `{effective: boolean}` without a discriminator.** It permits ambiguous field combinations and gives no
  stable identity for a pending review outcome.
- **Call Agent stdout a receipt.** The actual receipt and request identity are intentionally host-only and have
  different replay responsibilities.
- **Return the full Envelope for Memory only.** It would violate the common Agent Result Projection boundary and make
  Memory a transport exception.
- **Treat unified write as proof of a unified domain aggregate.** Command convenience does not justify putting pending
  candidate content into formal MemoryRevision lifecycle.

## References

- [v0.73 在线长期记忆捕获与 Hearth 审核隔离](../versions/v0.73/README.md)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](0124-cli-only-transport-for-rovai-built-in-operations.md)
- [ADR-0135: Compact Agent Output](0135-compact-agent-output-over-canonical-built-in-tool-envelope.md)
- [ADR-0178: Best-Effort Online Memory Capture](0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md)
- [Built-in Tool Transport v9](../contracts/builtin-tool-transport-v9.md)
- [Memory Capture v1](../contracts/memory-capture-v1.md)
