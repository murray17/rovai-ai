---
document_type: adr
id: ADR-0033
title: "Advisory Memory Review v2"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: [ADR-0028]
superseded_by: null
---

# ADR-0033: Advisory Memory Review v2

## Context

ADR-0028 correctly made Review advisory and rejected `validFrom`/`validUntil`, but assumed a
new Revision could affect only AgentRuns whose ContextManifest had not been frozen. ADR-0032
replaces body injection with live Markdown reads: the frozen prompt remains immutable, while an
active Run may use its native file tool later and observe a newer Projection.

The time and Review model must retain explicit user governance without claiming that tool-time
filesystem observations are frozen by ADR-0049.

## Decision

MemoryRevision is created when the user's authoritative command commits. Its `createdAt` is also
the confirmation time; v0.10 does not store a duplicate `acceptedAt`.

A new Revision does not rewrite an already frozen AgentRun prompt. It is projected after commit,
and an active AgentRun that later reads the live Memory Projection may observe it. Content already
read into a Native Session is not hot-replaced.

v0.10 does not support `validFrom` or `validUntil`. Future activation and automatic expiry remain
outside Memory; they belong in Current Input, Task or another natural domain object.

Memory has an optional `reviewAfter`:

```text
lesson      → current Revision create/revise + 90 days by default
preference  → null by default
agreement   → null by default
```

The user may schedule Review for any Kind. `now >= reviewAfter` only derives a Read Side
“review suggested” state. It does not change Lifecycle, Revision, Projection eligibility, create
a Proposal, send a message, create a Task, start an AgentRun or wake a Runtime.

Review may lead to an explicit reschedule, revision, retire or forget command.

## Consequences

- Time alone never changes Memory authority or applicability.
- Lesson receives a default governance reminder without automatic expiry.
- Active Runs may observe a newly projected Revision if they choose to read after the update;
  only the frozen prompt remains byte-stable.
- v0.10 cannot express scheduled Memory activation or expiry.
- Confirmation time remains represented by one Revision timestamp.

## Rejected Alternatives

- Retaining ADR-0028's future-Run-only claim: contradicts the selected live Projection behavior.
- `validFrom` or `validUntil`: makes clock time silently change long-term behavior.
- Review automatically retiring or deleting Memory: bypasses explicit user governance.
- Rewriting frozen AgentRun prompts after a Revision: violates ADR-0049.
- Creating a per-Run Memory snapshot solely to preserve the old timing claim: rejected by
  ADR-0032's on-demand live-read model.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0032: User-Authorized Live Memory Projection](0032-user-authorized-live-memory-projection.md)
- [Superseded ADR-0028](0028-advisory-memory-review.md)
