---
document_type: adr
id: ADR-0182
title: Core-Resolved Current-Camp Display-Name Inline Addressing Alias
status: accepted
date: 2026-08-14
decision_scope: cross-version
source_version: v0.75
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0182: Core-Resolved Current-Camp Display-Name Inline Addressing Alias

## Context

ADR-0163 requires an Agent to use canonical `--to agent_N` or inline `@agent_N` to create a Delivery. Runtime context
also exposes each current Camp member's human-readable display name, so models naturally produce messages such as
`@爱丽丝 请做只读 CR`。The message is publicly accepted but creates zero Delivery because body prose is not an
addressing source; a sender that ignores `effectiveRecipients=[]` can mistake publication for a handoff.

Treating every display-name-like phrase as identity would be unsafe because display names are mutable presentation.
The product nevertheless needs one narrow, deterministic convenience alias that remains inside Core's existing
recipient authority and cannot introduce Renderer- or Runtime-specific routing.

## Decision

1. Canonical `--to agent_N` and inline `@agent_N` remain the stable Agent-addressing forms. Core additionally accepts
   `@<exact current eligible Camp member display name>` only when the complete display name is followed by Unicode
   whitespace or end-of-body.
2. Eligibility uses the same current transaction facts as recipient admission: active CampMember, no pending leave,
   and present AgentProfile. The match is case-sensitive and exact. Fenced code, inline code, URL tokens and escaped
   literals remain excluded.
3. Core resolves a display-name alias to its canonical Agent ID before recipient validation, union, deduplication,
   sorting and freeze. Structured Content stores a Member Mention with Agent ID; CampMessage metadata, Delivery and
   output never use display name as identity.
4. Canonical `@agent_N` parsing has precedence over display-name aliases. When more than one valid name prefix matches,
   the longest complete display name wins. Equal-length ambiguity produces no alias match rather than selecting a
   member by query order.
5. This first grammar does not accept punctuation as a boundary and does not perform case folding, Unicode similarity,
   prefix/nickname/handle matching, cross-Camp lookup or display-name values in `--to`.
6. `effectiveRecipients` remains the authoritative send postcondition. An accepted message with an empty array is
   public-only and proves no Agent Delivery or wakeup.

This ADR locally overrides ADR-0163 Decision 1 only by adding the exact Core-resolved inline alias as a third source.
ADR-0163 continues to own caller return, lineage classification and Core-managed reply reference; ADR-0130 continues
to own atomic recipient freeze and the single public-message/single-Delivery-system boundary.

## Consequences

- Human-readable handoffs such as `@爱丽丝 ` route deterministically without persisting mutable presentation as
  identity.
- Alias resolution requires loading current eligible member names in the send transaction and makes a later profile
  rename affect only future sends, never replayed or frozen messages.
- Help and contracts must teach the exact boundary and require checking `effectiveRecipients`; visually plausible
  punctuation or near matches intentionally remain public prose.
- Renderer, Message Delivery, Runtime Activity, IPC and database schemas remain unchanged because downstream code sees
  the same canonical occurrence and recipient set.

## Rejected Alternatives

- **Keep canonical IDs only and change Skill prose.** This preserves the failure mode for routine sends where a model
  uses a display name already present in context and ignores an empty accepted result.
- **Resolve any `@name` punctuation or fuzzy match.** This increases accidental wakeups and makes grammar dependent on
  locale and similarity heuristics.
- **Accept display names in `--to`.** Structured command input should keep stable identities; the convenience alias is
  intentionally limited to human-readable body text.
- **Let Renderer or Runtime rewrite mentions.** This would split recipient authority and make behavior adapter- or
  client-dependent.
- **Persist display name as recipient identity.** Renames and ambiguity would corrupt replay, audit and Delivery
  stability.

## References

- [v0.75 current version](../versions/v0.75/README.md)
- [ADR-0130: Public A2A Messages and Unified Message Delivery](0130-public-a2a-message-and-unified-delivery.md)
- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](0163-explicit-caller-return-and-core-managed-reply-reference.md)
- [Camp Message Send v6](../contracts/camp-message-send-v6.md)
- [Message Delivery v2](../contracts/message-delivery-v2.md)
- [Public A2A Message and Message Delivery architecture](../architecture/public-a2a-message-delivery.md)
