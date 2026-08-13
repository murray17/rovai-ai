---
document_type: adr
id: ADR-0170
title: Current-Run Committed Self-Write Exact Read
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.67
supersedes: []
superseded_by: null
---

# ADR-0170: Current-Run Committed Self-Write Exact Read

## Context

Agent history reads are capped by the immutable ContextManifest fence so a running Agent cannot discover public
messages committed after its frozen input. Camp Message Send nevertheless returns an authoritative message locator,
and recovery guidance requires an exact item read to verify the committed addressing of that send. A message written
by the same AgentRun necessarily has a sequence above its own frozen boundary, so applying the ordinary fence makes
that verification path impossible.

Widening the Run's history boundary would expose unrelated user or Agent messages and would turn a write receipt into
a live subscription. A separate mutable outcome store would duplicate the durable command result that already proves
the accepted send.

## Decision

`camp.read(mode="item")` may read one message above the current Camp fence only when the supplied exact message ID
identifies an untombstoned Agent message in the current Camp, authored by the authenticated Agent, sourced from the
current AgentRun and linked through its nonempty source operation to that Run's accepted `camp.message.send` command
result. The command result must match the same Camp, Agent, Run, execution epoch, message entity and result payload.

The exception is a receipt verification path, not a new history boundary. `around`, `thread`, `timeline`, Camp search,
History search, another Run's writes, user messages, tombstones and cross-Camp messages remain constrained by the
original immutable fence. Exact item reads that do not prove every condition fail with the existing unavailable
behavior and reveal no post-boundary metadata.

## Consequences

- A Run can verify the authoritative addressing of its own committed send without weakening immutable input or
  exposing concurrently arriving messages.
- Recovery can follow the locator-present exact-read instruction it already publishes; locator-absent recovery still
  cannot search, guess or resend.
- Implementations must bind the message to the durable command result rather than trust a client-provided operation ID
  or message row alone.
- Collection reads keep one uniform ContextManifest fence and cannot be used to traverse outward from the receipt.

## Rejected Alternatives

- **Raise the current Run fence after every send.** This exposes unrelated concurrent history and changes the frozen
  Run authority.
- **Permit all exact IDs above the fence.** Guessable or leaked IDs would become a post-boundary read capability.
- **Add a second send-outcome query.** It duplicates durable command-result authority and expands the operation surface
  without providing more proof than the narrowly authorized exact item.
- **Keep recovery documentation as-is without implementation support.** The advertised verification step would remain
  deterministically unavailable for the very send it is meant to verify.

## References

- [v0.67 current version](../versions/v0.67/README.md)
- [ADR-0129: Deterministic Bounded Raw Public Context Delivery](0129-deterministic-bounded-raw-public-context-delivery.md)
- [ADR-0108: Discovery-Only Camp Message Search and Sequence-Paged Reads](0108-discovery-only-camp-message-search-and-sequence-paged-reads.md)
- [Built-in Tool Transport v7](../contracts/builtin-tool-transport-v7.md)
- [Camp Message Send v4](../contracts/camp-message-send-v4.md)
- [Current User Attention v2](../contracts/current-user-attention-v2.md)
