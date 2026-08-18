---
document_type: version-decisions
version: v0.75
lifecycle: historical
last_updated: 2026-08-18
---

# v0.75 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0182](#adr-0182) | Core-Resolved Current-Camp Display-Name Inline Addressing Alias | `accepted` |
| [ADR-0183](#adr-0183) | Scope-Identified Agent Memory Revision Targets | `superseded` |

<!-- legacy-adr:begin id=ADR-0182 source-file-sha256=2821704880de324b815cac04c03de7dcc59a66da3bb957309ca3fe9d1a966859 -->
<a id="adr-0182"></a>

## ADR-0182: Core-Resolved Current-Camp Display-Name Inline Addressing Alias

迁移时原路径：`docs/adr/0182-core-resolved-current-camp-display-name-inline-addressing-alias.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
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
```

<!-- legacy-adr-body:begin id=ADR-0182 -->
<a id="adr-0182-context"></a>
### Context

ADR-0163 requires an Agent to use canonical `--to agent_N` or inline `@agent_N` to create a Delivery. Runtime context
also exposes each current Camp member's human-readable display name, so models naturally produce messages such as
`@爱丽丝 请做只读 CR`。The message is publicly accepted but creates zero Delivery because body prose is not an
addressing source; a sender that ignores `effectiveRecipients=[]` can mistake publication for a handoff.

Treating every display-name-like phrase as identity would be unsafe because display names are mutable presentation.
The product nevertheless needs one narrow, deterministic convenience alias that remains inside Core's existing
recipient authority and cannot introduce Renderer- or Runtime-specific routing.

<a id="adr-0182-decision"></a>
### Decision

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

<a id="adr-0182-consequences"></a>
### Consequences

- Human-readable handoffs such as `@爱丽丝 ` route deterministically without persisting mutable presentation as
  identity.
- Alias resolution requires loading current eligible member names in the send transaction and makes a later profile
  rename affect only future sends, never replayed or frozen messages.
- Help and contracts must teach the exact boundary and require checking `effectiveRecipients`; visually plausible
  punctuation or near matches intentionally remain public prose.
- Renderer, Message Delivery, Runtime Activity, IPC and database schemas remain unchanged because downstream code sees
  the same canonical occurrence and recipient set.

<a id="adr-0182-rejected-alternatives"></a>
### Rejected Alternatives

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

<a id="adr-0182-references"></a>
### References

- [v0.75 current version](README.md)
- [ADR-0130: Public A2A Messages and Unified Message Delivery](../v0.45/decisions.md#adr-0130)
- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](../v0.62/decisions.md#adr-0163)
- [Camp Message Send v6](../../contracts/camp-message-send-v6.md)
- [Message Delivery v2](../../contracts/message-delivery-v2.md)
- [Public A2A Message and Message Delivery architecture](../../architecture/public-a2a-message-delivery.md)
<!-- legacy-adr-body:end id=ADR-0182 -->
<!-- legacy-adr:end id=ADR-0182 -->

<!-- legacy-adr:begin id=ADR-0183 source-file-sha256=39f33b2ccd92163d41f69d55aec5789abf3e92b5286b22c58c20977a5342dcd2 -->
<a id="adr-0183"></a>

## ADR-0183: Scope-Identified Agent Memory Revision Targets

迁移时原路径：`docs/adr/0183-scope-identified-agent-memory-revision-targets.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0183
title: Scope-Identified Agent Memory Revision Targets
status: superseded
date: 2026-08-14
decision_scope: cross-version
source_version: v0.75
supersedes: []
intended_supersedes: []
superseded_by: ADR-0186
```

<!-- legacy-adr-body:begin id=ADR-0183 -->
<a id="adr-0183-context"></a>
### Context

ADR-0068 lets one Agent search and read Hearth, its Companion, and multiple applicable Relationship Memories, but its
Search/Read result shape identifies only Memory, Revision, Kind and content metadata. Two directed Relationship
Memories for different counterparties can therefore have indistinguishable text and Retrieval Keys. ADR-0178's
actor-bounded revise guard proves that the caller may mutate a selected Memory; it cannot prove that the selected
counterparty is the one the Agent intended.

Relying only on body similarity or Skill prose would leave a normal, authorized wrong-target mutation possible. Adding
Scope data also must not weaken guessed-ID anti-oracle behavior or turn immutable Scope into an editable field.

<a id="adr-0183-decision"></a>
### Decision

1. Every authorized `memory.search` result exposes the Memory's Agent-relative immutable Scope identity:
   `scope`, and for Relationship additionally `counterpartyAgentId` plus `direction`.
2. `memory.read` exposes the same identity only with `current` or `revision_changed` results that also return the
   currently authorized body. `inactive`, `deleted`, `access_changed` and `unavailable` results expose no Scope,
   counterparty or direction.
3. Agent `memory.write(action=revise)` must repeat the exact Scope identity returned by the deciding read. Companion
   and Hearth repeat `scope`; Relationship also repeats `counterpartyAgentId` and the `directed` direction. These
   fields are immutable target assertions, not proposed changes.
4. Core first requires a well-formed revise shape, then loads an active target and verifies the caller's mutation set.
   Before exposing Revision CAS or exact no-change, it verifies the repeated Scope identity against the target. An
   absent, inactive, unauthorized, reverse-directed, mutual, or identity-mismatched target returns the same
   body-free `memory.unavailable` result.
5. A mutual Relationship may remain visible for use but is not a valid Agent revise shape. A target whose ID,
   Revision, Scope, counterparty or direction cannot be matched exactly must not be revised.
6. The closed input/output schema change advances the Built-in Tool contract, CLI command contract and Runtime
   capability together. Catalog digest fencing remains an additional compatibility check.

This decision locally refines ADR-0068's Search/Read result fields and ADR-0178's exact revise precondition. Their
applicable-set, authorization, cache-state, anti-oracle, actor-bounded mutation and Hearth review decisions otherwise
remain effective.

<a id="adr-0183-consequences"></a>
### Consequences

- Similar Relationship text for different teammates can be selected and revised deterministically.
- Search/Read responses and the revise schema gain explicit fields, so existing Native Sessions must be fenced by the
  successor Built-in Tool contract and catalog digest.
- Agents must perform read-before-revise and copy identity exactly; this adds payload ceremony but turns semantic
  targeting into a Core-verifiable precondition.
- Scope identity remains omitted from body-free stale and unavailable reads, preserving the existing guessed-ID
  anti-oracle.

<a id="adr-0183-rejected-alternatives"></a>
### Rejected Alternatives

- **Return Scope metadata but trust Skill prose to select correctly.** This improves reasoning but leaves Core able to
  commit an authorized mutation to the wrong counterparty.
- **Infer the intended counterparty from candidate text or Retrieval Keys.** Similarity is not identity and would add
  a nondeterministic authorization-adjacent classifier.
- **Return only `counterpartyAgentId`.** Hearth, Companion and Relationship would still lack one complete, copyable
  target identity, and direction would remain ambiguous.
- **Return Scope identity on stale or unavailable reads.** That would reintroduce an existence and target-shape
  oracle for guessed or no-longer-authorized IDs.
- **Treat repeated Scope fields as a requested move.** Memory Scope is immutable; moving an understanding creates a
  new Memory and may be recorded through explicit user Supersession.

<a id="adr-0183-references"></a>
### References

- [v0.75 current version](README.md)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](../v0.21/decisions.md#adr-0068)
- [ADR-0178: Best-Effort Online Memory Capture](../v0.73/decisions.md#adr-0178)
- [Memory Capture v2](../../contracts/memory-capture-v2.md)
- [Built-in Tool Transport v10](../../contracts/builtin-tool-transport-v10.md)
- [Online Memory Capture architecture](../../architecture/online-memory-capture.md)
<!-- legacy-adr-body:end id=ADR-0183 -->
<!-- legacy-adr:end id=ADR-0183 -->
