---
document_type: adr
id: ADR-0184
title: Line-Leading Display-Name Inline Addressing Alias
status: accepted
date: 2026-08-14
decision_scope: cross-version
source_version: v0.76
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0184: Line-Leading Display-Name Inline Addressing Alias

## Context

ADR-0182 introduced exact current-Camp display-name aliases so a deliberate `@Alice ` handoff can resolve to a
canonical Agent ID. Its first grammar accepts the alias at any parseable body position. That also turns ordinary prose
such as `让 Bob 分析一下 @Alice 提出的迁移方案` into an execution request, even though the sentence may only discuss
Alice's proposal. Mutable human-readable names need a stronger intent signal than the `@` glyph alone.

## Decision

1. A display-name alias participates in Agent addressing only when its `@` is the first non-whitespace token of a
   logical line. The first body line and every line after `\n` use the same rule; spaces, tabs and CRLF `\r` are
   permitted before the token.
2. A trailing handoff should use a dedicated final non-empty routing line. Being on the final line does not by itself
   authorize a mid-line alias; that line must still begin with the alias after optional whitespace.
3. The exact display-name, following whitespace/EOF, active Camp eligibility, canonical precedence, longest match,
   ambiguity, code/URL/escape exclusions and canonical freeze from ADR-0182 remain unchanged.
4. Canonical inline `@agent_N` remains a stable machine-facing addressing token and keeps its existing parseable-body
   positions. This new position gate applies only to display-name presentation aliases.
5. Help and schema must state the line-leading rule and `effectiveRecipients` remains the authoritative postcondition.

This ADR locally overrides only ADR-0182's unrestricted alias position. ADR-0182 continues to own alias identity,
eligibility, matching and freeze; ADR-0163 continues to own caller return and Core-managed reply reference.

## Consequences

- Mid-sentence discussion of an exact member display name remains public prose and cannot accidentally allocate A2A
  responsibility.
- Authors can route naturally at message start or on a dedicated final line without using a canonical ID.
- Indentation is harmless, while Markdown list/quote markers are intentionally not treated as whitespace-only line
  prefixes.
- Canonical automation and downstream Structured Mention/Delivery behavior do not change.

## Rejected Alternatives

- **Allow every alias on the final logical line.** A single-line message is also its final line, so the original prose
  ambiguity would remain.
- **Parse Markdown list and quote prefixes.** Prefix-specific grammar increases accidental routing and parser surface;
  an explicit routing line is simpler.
- **Apply the position gate to canonical `@agent_N`.** Stable machine-facing commands would break for a safety issue
  specific to mutable display-name prose.
- **Remove display-name aliases entirely.** This restores the original missed-handoff failure that ADR-0182 solved.

## References

- [v0.76 current version](../versions/v0.76/README.md)
- [ADR-0182: Core-Resolved Current-Camp Display-Name Inline Addressing Alias](0182-core-resolved-current-camp-display-name-inline-addressing-alias.md)
- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](0163-explicit-caller-return-and-core-managed-reply-reference.md)
- [Camp Message Send v7](../contracts/camp-message-send-v7.md)
- [Public A2A Message and Message Delivery architecture](../architecture/public-a2a-message-delivery.md)
