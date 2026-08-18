---
document_type: version-decisions
version: v1.07
lifecycle: historical
last_updated: 2026-08-18
---

# v1.07 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0216](#adr-0216) | Explicit Agent Addressing Intent as the Delivery Gate | `accepted` |
| [ADR-0217](#adr-0217) | Built-in Tool Transport v15 Inherits the Cross-Platform v14 Wire | `accepted` |
| [ADR-0218](#adr-0218) | Audience-Specific Principal Message Projection | `accepted` |

<!-- legacy-adr:begin id=ADR-0216 source-file-sha256=6f73ec16c74e69b60e946eb733e4d705dfc90405b1e0972ac7aa70870c9c48a2 -->
<a id="adr-0216"></a>

## ADR-0216: Explicit Agent Addressing Intent as the Delivery Gate

迁移时原路径：`docs/adr/0216-explicit-agent-addressing-intent-as-delivery-gate.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
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
```

<!-- legacy-adr-body:begin id=ADR-0216 -->
<a id="adr-0216-context"></a>
### Context

Camp visibility and Agent scheduling are different effects. Today an explicit `rovai send` may resolve no recipient,
but that outcome does not prove that the caller intentionally disabled addressing. Conversely, Runtime automatic final
and Missing-Send Recovery already publish recipient-free text and must never acquire an implicit route merely because
their body resembles an Agent mention. Reusing one Boolean for input intent, parsed outcome and historical event audit
would make those facts indistinguishable and would make replay depend on current parser behavior.

<a id="adr-0216-decision"></a>
### Decision

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

<a id="adr-0216-consequences"></a>
### Consequences

- A caller can prove that recipient-free output was intentional rather than an accidental empty parse.
- Public-only publication has a Core-enforced negative guarantee across flags, JSON stdin, input files, IPC and replay.
- Parser evolution cannot retroactively change public-only messages or automatic recovery publications into work.
- The durable command, CampMessage audit, event payload, canonical result and compact Agent projection all need an
  explicit mode field or identity revision.
- Existing `address_mode` keeps its presentation meaning; the old derived event `publicOnly` is retired rather than
  reused for the new intent.

<a id="adr-0216-rejected-alternatives"></a>
### Rejected Alternatives

- **Treat every empty recipient result as public-only intent.** It loses the distinction between a disabled parser and
  an automatic parse that happened to find nothing.
- **Parse first and discard recipients when `publicOnly=true`.** Invalid, stale or self-addressed body tokens could
  still reject or leak presentation metadata even though addressing was supposed to be disabled.
- **Make Runtime final text an implicit routing operation.** Text provenance is insufficient authorization and would
  recreate unbounded A2A wakeups outside the Built-in command boundary.
- **Reuse `address_mode` or reinterpret the historical event `publicOnly`.** Both are existing outcome/presentation
  facts, not durable caller intent; the clean-break event uses accurate names instead.

<a id="adr-0216-references"></a>
### References

- [v1.07 proposal](README.md)
- [Camp Message Send v10](../../contracts/camp-message-send-v10.md)
- [ADR-0130: Public A2A Message and Unified Delivery](../v0.45/decisions.md#adr-0130)
- [ADR-0134: Explicit Runtime Public Output Boundary](../v0.45/decisions.md#adr-0134)
- [ADR-0163: Explicit Caller Return](../v0.62/decisions.md#adr-0163)
- [Missing-Send Recovery Publication v1](../../contracts/missing-send-recovery-publication-v1.md)
<!-- legacy-adr-body:end id=ADR-0216 -->
<!-- legacy-adr:end id=ADR-0216 -->

<!-- legacy-adr:begin id=ADR-0217 source-file-sha256=becc1eaf76023fbec0edc1715b0883c681588fa5a0ae8fdc07e93ab8ada992cf -->
<a id="adr-0217"></a>

## ADR-0217: Built-in Tool Transport v15 Inherits the Cross-Platform v14 Wire

迁移时原路径：`docs/adr/0217-transport-v15-inherits-cross-platform-v14.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0217
title: Built-in Tool Transport v15 Inherits the Cross-Platform v14 Wire
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.07
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0217 -->
<a id="adr-0217-context"></a>
### Context

Built-in Tool Transport v14 is already accepted and assigns protocol identity to the discriminated
`LocalIpcEndpoint`, IPC protocol v2, Unix Socket and secured Windows Named Pipe. The current implementation remains on
v13. Adding `publicOnly`, canonical `--to-principal`, a revised Send projection and errors needs another contract
identity, but assigning v15 to the old `core_socket` / IPC v1 shape would silently revoke an accepted transport
decision and make the version sequence non-monotonic.

<a id="adr-0217-decision"></a>
### Decision

Built-in Tool Transport v15 completely inherits v14's local transport wire and security boundary, then adds the v1.07
Camp Send input, CLI, catalog, error and Agent projection changes. Its fixed axes are:

```text
BUILTIN_TOOL_CONTRACT_VERSION = 15
BUILTIN_TOOL_CLI_COMMAND_VERSION = 15
Runtime capability = builtin_cli.transport.v15
fixed command count = 15
IPC protocol = 2
endpoint = LocalIpcEndpoint { unix_socket | windows_named_pipe }
Envelope = 1; receipt = 1; Agent Output = 2
```

The implementation transition is an atomic v13-to-v15 clean break: Core and bundled CLI must implement all v14
endpoint/IPC requirements and all v15 catalog changes before advertising v15. There is no product mode in which v15
uses IPC v1, `core_socket`, an optional dual endpoint or a v14/v15 mixed binding. macOS repeats the complete Unix Socket
v15 matrix; Windows remains subject to per-Adapter Runtime Platform Admission.

ADR-0212 remains the effective reason and security decision for the inherited cross-platform endpoint. This ADR does
not supersede it; v15 is the next transport contract that composes it with the new command surface.

<a id="adr-0217-consequences"></a>
### Consequences

- The implementation scope includes the currently unimplemented v14 endpoint work as a prerequisite, not only the
  A2A command change.
- One capability continues to identify one wire shape across context, catalog digest, health, diagnostics and Runtime
  compatibility.
- A smaller A2A-only release cannot advertise v15 while retaining v13 IPC; it must either complete this scope or defer
  the transport bump and feature release.
- v14 remains useful as the accepted predecessor and design source even if no production build advertises it.

<a id="adr-0217-rejected-alternatives"></a>
### Rejected Alternatives

- **Use v15 with IPC v1 and `core_socket`.** This silently rolls back ADR-0212 and makes higher version identity mean
  an older incompatible wire.
- **Mutate v14 to add the new Send schema.** v14 is accepted and already identifies another closed contract.
- **Advertise v15 before the endpoint migration is complete.** Runtime capability negotiation would claim security
  and compatibility properties the process does not have.
- **Maintain v13/v14/v15 dual stacks.** Core and CLI ship together, and the additional downgrade surface has no product
  requirement.

<a id="adr-0217-references"></a>
### References

- [v1.07 proposal](README.md)
- [Built-in Tool Transport v15](../../contracts/builtin-tool-transport-v15.md)
- [ADR-0212: Cross-Platform Local IPC for v14](../v1.05/decisions.md#adr-0212)
- [Built-in Tool Transport v14](../../contracts/builtin-tool-transport-v14.md)
<!-- legacy-adr-body:end id=ADR-0217 -->
<!-- legacy-adr:end id=ADR-0217 -->

<!-- legacy-adr:begin id=ADR-0218 source-file-sha256=e1c78e23bc0116f497a7a97ea5cd129c684ed5a186966a0b0bed35fa34c1f4e9 -->
<a id="adr-0218"></a>

## ADR-0218: Audience-Specific Principal Message Projection

迁移时原路径：`docs/adr/0218-audience-specific-principal-message-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0218
title: Audience-Specific Principal Message Projection
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.07
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0218 -->
<a id="adr-0218-context"></a>
### Context

`CurrentUserMention(local_user)` is one durable semantic segment, but the existing plain-text renderer projects it as
the Human-localized `@你` on every path. In Agent context, `@你` can be read as the currently running Agent rather than
the human who owns the Camp objective. Updating the persisted body cache to an Agent term would instead leak model
language into Human UI, FTS and accessibility. String replacement cannot distinguish a real structured mention from
ordinary text containing the same characters.

<a id="adr-0218-decision"></a>
### Decision

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

<a id="adr-0218-consequences"></a>
### Consequences

- The model receives one unambiguous human role token across pushed context and on-demand retrieval.
- Projection becomes an explicit interface with two consumers instead of a hidden global locale choice.
- Digests over Structured Content stay stable, while Agent `projectedBodyDigest`, rendered context bytes, snippets and
  offsets may change and require new formatter/history contracts.
- Any new Agent-visible body path must select the Agent audience explicitly; using a Human cache is a contract error.

<a id="adr-0218-rejected-alternatives"></a>
### Rejected Alternatives

- **Persist `@Principal` in `camp_message.body`.** Human UI and FTS would become model-oriented and localization would
  cease to be a derived presentation concern.
- **Replace `@你` strings after rendering.** Literal user text would be corrupted and structured identity would be
  lost.
- **Expose both localized and English Agent tokens.** Models and fixtures would need unstable aliases for one role.
- **Create a Principal domain entity now.** The product still has exactly one Core-owned local user and no authenticated
  multi-user binding that would justify another identity model.

<a id="adr-0218-references"></a>
### References

- [v1.07 proposal](README.md)
- [Model-context change proposal](model-context-change-a2a-public-only.md)
- [Camp History Retrieval v2](../../contracts/camp-history-v2.md)
- [Gather v3](../../contracts/gather-v3.md)
- [ADR-0165: Core-Owned Current-User Message Attention](../v0.65/decisions.md#adr-0165)
<!-- legacy-adr-body:end id=ADR-0218 -->
<!-- legacy-adr:end id=ADR-0218 -->
