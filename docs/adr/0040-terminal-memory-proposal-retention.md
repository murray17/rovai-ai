---
document_type: adr
id: ADR-0040
title: "Terminal Memory Proposal Retention"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
---

# ADR-0040: Terminal Memory Proposal Retention

## Context

Accepted and rejected MemoryProposals have different audit and privacy value. For an accepted
Proposal, retaining the Agent's original candidate lets the user compare what was proposed with
the final MemoryRevision, especially when the user edited before accepting. For a rejected
Proposal, retaining the declined text indefinitely stores content the user explicitly chose not
to adopt and grows terminal history without supporting future Memory.

A single time-to-live for both states would either erase useful accepted provenance or retain
rejected content longer than necessary. Proposal metadata is still useful for auditing who
proposed from which Camp/Run/Epoch even when candidate text is gone.

## Decision

When a Proposal is accepted:

- retain its original canonical candidate body;
- retain `proposalId`, proposer, proposed time and source Camp/AgentRun/Epoch;
- set terminal status accepted;
- link the created MemoryRevision back through `createdFromProposalId`.

If the user edits before acceptance, the Proposal keeps the Agent's original candidate while the
MemoryRevision stores only the user's final canonical body. No separate Acceptance object is
created.

When a Proposal is rejected, the same transaction:

- sets terminal status rejected;
- irreversibly clears the candidate body;
- retains only `proposalId`, proposer, proposed time, source Camp/AgentRun/Epoch and terminal
  status.

Neither terminal metadata record expires automatically.

If a Memory created or revised from an accepted Proposal is forgotten, ADR-0027's forgetting
transaction also clears the linked accepted Proposal candidate body. Retiring, superseding or
later revising the Memory does not clear that body.

Event log, receipts, diagnostics and permanent command results never copy Proposal candidate
text. Existing redacted command audit remains the only user-action audit; this decision does not
introduce Origin, Evidence or Acceptance entities.

## Consequences

- Users can audit the difference between Agent candidate and final authorized Revision.
- Rejected text does not become indefinite shadow Memory.
- Proposal metadata remains useful for attribution after candidate clearing.
- Rejection and Memory Forget need transactional body clearing, not asynchronous best effort.
- Terminal history can grow in row count but not in rejected-body storage.
- Forget must follow `createdFromProposalId` links without deleting the minimal Proposal record.

## Rejected Alternatives

- Retaining both accepted and rejected bodies forever: keeps declined content unnecessarily.
- Clearing both bodies immediately: removes the accepted proposal-to-revision comparison.
- Applying one automatic TTL: makes audit depend on elapsed time rather than user governance.
- Copying accepted candidate into an Acceptance object: duplicates the Proposal/Revision model.
- Clearing candidate asynchronously: leaves a privacy window after explicit rejection or Forget.
- Deleting the whole Proposal row: loses stable attribution and command-history linkage.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0025: Proposal-Scoped Memory Provenance](0025-proposal-scoped-memory-provenance.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0038: Memory Proposal Staleness](0038-memory-proposal-staleness.md)
