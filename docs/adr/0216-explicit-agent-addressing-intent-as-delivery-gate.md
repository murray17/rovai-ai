---
document_type: adr
id: ADR-0216
title: Explicit Agent Addressing Intent as the Delivery Gate
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.07
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0216: Explicit Agent Addressing Intent as the Delivery Gate

## Context

Camp visibility and Agent scheduling are different effects. Today an explicit `rovai send` may resolve no recipient,
but that outcome does not prove that the caller intentionally disabled addressing. Conversely, Runtime automatic final
and Missing-Send Recovery already publish recipient-free text and must never acquire an implicit route merely because
their body resembles an Agent mention. Reusing one Boolean for input intent, parsed outcome and historical event audit
would make those facts indistinguishable and would make replay depend on current parser behavior.

## Decision

Only an explicit Built-in routing operation with an admitted Agent-addressing intent may create Message Delivery.
`camp.message.send` persists one closed `AgentAddressingMode` independently from its resolved recipients:

```text
automatic
  → resolve explicit `to` plus the existing restricted inline Agent addressing
  → zero or more effective Agent recipients

public_only
  → reject explicit Agent recipients and Task attachment
  → bypass inline Agent addressing before alias or recipient lookup
  → preserve Agent-like `@...` body text as Text
  → require zero effective recipients, zero Delivery and zero A2A allocation
```

The Agent input field is `publicOnly`, the canonical CLI flag is `--public-only`, and the internal/durable value is
`AgentAddressingMode::{Automatic, PublicOnly}`. Human attention remains an orthogonal effect, so `mentionUser` /
`--to-principal` is valid in either mode and never contributes an Agent recipient.

Resolved `effectiveRecipients` and `deliveryIds` remain outcome facts. The historical
`camp_message.public_a2a_sent.publicOnly` field meant only the derived predicate `deliveryIds.is_empty()` and is never
reinterpreted as input intent. Because v1.07 adopts a no-old-data clean break, the new event payload removes that
misnamed field and records `recipientFree` for the same derived outcome plus `agentAddressingMode` for explicit Send
intent. The Gather event variant marks the mode not applicable instead of manufacturing Send intent. Replay uses the
persisted Send mode and frozen command input; it never re-infers intent from empty recipients or message text.

Runtime automatic final and Missing-Send Recovery have no `AgentAddressingMode` because they are not an explicit send
invocation. They permanently publish recipient-free Structured Content containing literal Text only, with no reply
relation, Delivery or A2A allocation. `rovai gather` remains the other explicit routing operation and keeps its own
required-recipient contract. No Runtime final parser or fallback routing path is admitted.

This decision locally refines ADR-0130's public-message/Delivery split, ADR-0134's automatic-final boundary,
ADR-0163's explicit caller return and ADR-0165's separate human-attention axis; it does not replace their remaining
semantics.

## Consequences

- A caller can prove that recipient-free output was intentional rather than an accidental empty parse.
- Public-only publication has a Core-enforced negative guarantee across flags, JSON stdin, input files, IPC and replay.
- Parser evolution cannot retroactively change public-only messages or automatic recovery publications into work.
- The durable command, CampMessage audit, event payload, canonical result and compact Agent projection all need an
  explicit mode field or identity revision.
- Existing `address_mode` keeps its presentation meaning; the old derived event `publicOnly` is retired rather than
  reused for the new intent.

## Rejected Alternatives

- **Treat every empty recipient result as public-only intent.** It loses the distinction between a disabled parser and
  an automatic parse that happened to find nothing.
- **Parse first and discard recipients when `publicOnly=true`.** Invalid, stale or self-addressed body tokens could
  still reject or leak presentation metadata even though addressing was supposed to be disabled.
- **Make Runtime final text an implicit routing operation.** Text provenance is insufficient authorization and would
  recreate unbounded A2A wakeups outside the Built-in command boundary.
- **Reuse `address_mode` or reinterpret the historical event `publicOnly`.** Both are existing outcome/presentation
  facts, not durable caller intent; the clean-break event uses accurate names instead.

## References

- [v1.07 proposal](../versions/v1.07/README.md)
- [Camp Message Send v10](../contracts/camp-message-send-v10.md)
- [ADR-0130: Public A2A Message and Unified Delivery](0130-public-a2a-message-and-unified-delivery.md)
- [ADR-0134: Explicit Runtime Public Output Boundary](0134-runtime-public-output-boundary.md)
- [ADR-0163: Explicit Caller Return](0163-explicit-caller-return-and-core-managed-reply-reference.md)
- [Missing-Send Recovery Publication v1](../contracts/missing-send-recovery-publication-v1.md)
