---
document_type: adr
id: ADR-0043
title: "Memory Secret Filter"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0043: Memory Secret Filter

## Context

Memory persists across Camps and may be projected into files that Runtime Agents read with native
filesystem tools. A credential accidentally proposed or directly entered would therefore outlive
its source context and be copied into multiple Agent-readable projections. User confirmation is
not an adequate exception for credentials: long-term Memory is the wrong storage domain for
secrets.

Ordinary personal information is different. Stable preferences and partnership agreements can
naturally mention personal context, and creating a generic sensitivity score or model-generated
profile would conflict with the closed Memory Kind model.

## Decision

Core applies a non-overridable Memory Secret Filter to every canonical candidate body before any
MemoryProposal or MemoryRevision body is persisted. Covered write paths include:

- Agent add and revise Proposals;
- user direct add and revise;
- user-edited Proposal acceptance;
- any future import path that creates Memory content.

The filter rejects credential-class secrets such as passwords, API/access tokens, private keys
and authentication headers. User identity, Agent Capability, Scope and Kind cannot bypass it.
Users must redact the value and, where useful, store only a non-secret Lesson.

On rejection, no candidate body is persisted. Error results, event log, receipts, diagnostics,
telemetry and test snapshots contain only stable non-sensitive codes and never the matched value
or snippet.

v0.10 does not introduce a `sensitive` Memory Kind, risk score, inferred personal profile,
quarantine lifecycle or model-authored sensitivity field. Ordinary personal information remains
subject to the existing closed Kinds, explicit Scope, user confirmation and user-governed
revise/retire/forget operations.

Concrete high-confidence detectors and fixtures belong to the implementation security protocol.
Model classification cannot be persisted or treated as authoritative secret detection.

## Consequences

- Credentials cannot enter pending Proposals, SQLite Memory bodies or Markdown projections
  through supported writes.
- The same safety invariant applies to Agent and user commands.
- Some false positives require the user to redact or rephrase; there is no unsafe override.
- Ordinary personal context remains possible without building a personality or sensitivity
  dossier.
- Logging, diagnostics and tests need explicit redaction assertions.

## Rejected Alternatives

- Filtering only on acceptance: leaves secrets persisted in pending Proposals.
- Allowing user override: turns Memory into an intentional credential store.
- Filtering only Agent input: user edits could still project secrets to every Runtime.
- Storing matched snippets for diagnostics: duplicates the secret into audit surfaces.
- Adding a generic sensitive status or score: expands the domain into subjective profiling.
- Relying on a model classifier: non-deterministic judgments cannot enforce Core writes.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0024: Closed Memory Kinds](0024-closed-memory-kinds.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0032: User-Authorized Live Memory Projection](0032-user-authorized-live-memory-projection.md)
