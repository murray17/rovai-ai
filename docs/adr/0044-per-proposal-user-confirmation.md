---
document_type: adr
id: ADR-0044
title: "Per-Proposal User Memory Confirmation"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0044: Per-Proposal User Memory Confirmation

## Context

Memory persists across Camps and future AgentRuns. Although every Agent Proposal is
non-authoritative, a bulk-accept workflow could still turn an Agent's end-of-run summary into many
durable Memories with one user gesture. That would weaken the intended user-governed boundary and
encourage collection rather than selective stewardship.

Users still need to correct wording before acceptance and efficiently clear unwanted queue
items. Stale revise Proposals cannot safely be edited into acceptance because their frozen base no
longer represents current Memory.

## Decision

Each pending MemoryProposal offers exactly these user decisions:

- accept the displayed final content;
- edit final content, then accept;
- reject.

Before acceptance, the UI presents the complete final body, Scope, Kind and Relationship
Direction where applicable. User-edited final content passes the same canonicalization, Secret
Filter, Scope/Kind, active capacity and concurrency checks as every other authoritative write.
Only the final confirmed value enters MemoryRevision; the original Agent candidate remains on the
accepted Proposal under ADR-0040.

Acceptance is always per Proposal. v0.10 provides no multi-select, select-all or batch acceptance.
The management UI may support batch rejection; each selected Proposal becomes rejected and has
its candidate body cleared according to ADR-0040.

A stale Proposal cannot be accepted, edited and accepted or rebased in place. The UI disables
those actions with an explicit reason. The user may reject it or create a new candidate against
the latest Revision.

Session-level ignore closes only the current prompt and performs no domain command. The Proposal
remains pending in Memory management.

Renderer interaction follows the accepted renderer UI rules: status is not color-only,
labels are visible, the safer action receives initial focus where applicable, keyboard/focus
behavior is complete and Day/Night behavior is identical.

## Consequences

- Every durable Memory change receives focused user review.
- Agents cannot induce bulk learning through a large proposal batch.
- Users can correct wording without losing the original Agent candidate audit.
- Bulk cleanup remains possible through rejection without bulk authority escalation.
- Stale conflict handling stays explicit and cannot be hidden by an editor.
- UI tests need single acceptance, edit validation, batch rejection, stale disabling and
  accessible focus coverage.

## Rejected Alternatives

- Batch acceptance: makes durable learning too easy to approve without inspection.
- Accepting only Agent text verbatim: prevents users from correcting scope or wording.
- Treating ignore as rejection: conflates notification dismissal with governance.
- Editing a stale Proposal onto a new base: silently changes what concurrency state the Agent
  observed.
- Requiring another Agent to approve Relationship Memory: creates authority beyond the user.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [UI 规范](../ui/README.md)
- [ADR-0021: Atomic Memory and Immutable Revisions](0021-atomic-memory-and-immutable-revisions.md)
- [ADR-0038: Memory Proposal Staleness](0038-memory-proposal-staleness.md)
- [ADR-0040: Terminal Memory Proposal Retention](0040-terminal-memory-proposal-retention.md)
- [ADR-0043: Memory Secret Filter](0043-memory-secret-filter.md)
