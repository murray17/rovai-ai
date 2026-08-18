---
document_type: adr
id: ADR-0218
title: Audience-Specific Principal Message Projection
status: proposed
date: 2026-08-18
decision_scope: cross-version
source_version: v1.07
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0218: Audience-Specific Principal Message Projection

## Context

`CurrentUserMention(local_user)` is one durable semantic segment, but the existing plain-text renderer projects it as
the Human-localized `@你` on every path. In Agent context, `@你` can be read as the currently running Agent rather than
the human who owns the Camp objective. Updating the persisted body cache to an Agent term would instead leak model
language into Human UI, FTS and accessibility. String replacement cannot distinguish a real structured mention from
ordinary text containing the same characters.

## Decision

Structured Camp Message Content remains the sole semantic authority and keeps
`CurrentUserMention { userId: "local_user" }`. Projection uses an explicit closed audience:

```text
Human audience → CurrentUserMention = @你 (or the existing localized Human token)
Agent audience → CurrentUserMention = @Principal
```

`@Principal` is the only stable Agent-facing token and always denotes the single human local user who owns the Camp
objective. It never denotes the running Agent, never schedules an Agent and never represents human approval. No
Principal table, Principal ID, actor kind or multi-user binding is introduced.

Every Agent-visible message body must use the same segment-aware Agent renderer: `CURRENT_INPUT`, Shared Conversation
origin/recent/reference closure, Gather completion request/captured bodies, ContextManifest projected-body evidence,
`camp.search`, every `camp.read` mode, `history.search`, compact/canonical Built-in output, replay, recovery and golden
fixtures. Search snippets and Unicode-scalar body offsets are computed in Agent-projected text space. Human UI,
Clipboard/accessibility paths and the stored Human body/FTS cache keep the Human renderer. Structured Content and its
content digest never change.

Agent search candidate selection may use the existing Human-oriented FTS as an optimization, but it must add a
structured CurrentUserMention candidate path when the Agent query can match `@Principal`; final literal matching,
ranking and snippets always run on the Agent projection. Therefore copied Agent-visible text remains searchable without
rewriting Human storage.

This decision locally refines ADR-0165's projection clause while preserving its identity, attention, notification and
Agent-recipient separation.

## Consequences

- The model receives one unambiguous human role token across pushed context and on-demand retrieval.
- Projection becomes an explicit interface with two consumers instead of a hidden global locale choice.
- Digests over Structured Content stay stable, while Agent `projectedBodyDigest`, rendered context bytes, snippets and
  offsets may change and require new formatter/history contracts.
- Any new Agent-visible body path must select the Agent audience explicitly; using a Human cache is a contract error.

## Rejected Alternatives

- **Persist `@Principal` in `camp_message.body`.** Human UI and FTS would become model-oriented and localization would
  cease to be a derived presentation concern.
- **Replace `@你` strings after rendering.** Literal user text would be corrupted and structured identity would be
  lost.
- **Expose both localized and English Agent tokens.** Models and fixtures would need unstable aliases for one role.
- **Create a Principal domain entity now.** The product still has exactly one Core-owned local user and no authenticated
  multi-user binding that would justify another identity model.

## References

- [v1.07 proposal](../versions/v1.07/README.md)
- [Model-context change proposal](../versions/v1.07/model-context-change-a2a-public-only.md)
- [Camp History Retrieval v2 proposal](../contracts/camp-history-v2.md)
- [Gather v3 proposal](../contracts/gather-v3.md)
- [ADR-0165: Core-Owned Current-User Message Attention](0165-core-owned-current-user-message-attention.md)
