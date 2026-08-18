---
document_type: version-decisions
version: v0.67
lifecycle: historical
last_updated: 2026-08-18
---

# v0.67 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0170](#adr-0170) | Current-Run Committed Self-Write Exact Read | `accepted` |

<!-- legacy-adr:begin id=ADR-0170 source-file-sha256=c74756ad658c50f3d4c58c116e920fb32b595a88f54e84db4c872350c02d69a4 -->
<a id="adr-0170"></a>

## ADR-0170: Current-Run Committed Self-Write Exact Read

迁移时原路径：`docs/adr/0170-current-run-committed-self-write-exact-read.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0170
title: Current-Run Committed Self-Write Exact Read
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.67
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0170 -->
<a id="adr-0170-context"></a>
### Context

Agent history reads are capped by the immutable ContextManifest fence so a running Agent cannot discover public
messages committed after its frozen input. Camp Message Send nevertheless returns an authoritative message locator,
and recovery guidance requires an exact item read to verify the committed addressing of that send. A message written
by the same AgentRun necessarily has a sequence above its own frozen boundary, so applying the ordinary fence makes
that verification path impossible.

Widening the Run's history boundary would expose unrelated user or Agent messages and would turn a write receipt into
a live subscription. A separate mutable outcome store would duplicate the durable command result that already proves
the accepted send.

<a id="adr-0170-decision"></a>
### Decision

`camp.read(mode="item")` may read one message above the current Camp fence only when the supplied exact message ID
identifies an untombstoned Agent message in the current Camp, authored by the authenticated Agent, sourced from the
current AgentRun and linked through its nonempty source operation to that Run's accepted `camp.message.send` command
result. The command result must match the same Camp, Agent, Run, execution epoch, message entity and result payload.

The exception is a receipt verification path, not a new history boundary. `around`, `thread`, `timeline`, Camp search,
History search, another Run's writes, user messages, tombstones and cross-Camp messages remain constrained by the
original immutable fence. Exact item reads that do not prove every condition fail with the existing unavailable
behavior and reveal no post-boundary metadata.

<a id="adr-0170-consequences"></a>
### Consequences

- A Run can verify the authoritative addressing of its own committed send without weakening immutable input or
  exposing concurrently arriving messages.
- Recovery can follow the locator-present exact-read instruction it already publishes; locator-absent recovery still
  cannot search, guess or resend.
- Implementations must bind the message to the durable command result rather than trust a client-provided operation ID
  or message row alone.
- Collection reads keep one uniform ContextManifest fence and cannot be used to traverse outward from the receipt.

<a id="adr-0170-rejected-alternatives"></a>
### Rejected Alternatives

- **Raise the current Run fence after every send.** This exposes unrelated concurrent history and changes the frozen
  Run authority.
- **Permit all exact IDs above the fence.** Guessable or leaked IDs would become a post-boundary read capability.
- **Add a second send-outcome query.** It duplicates durable command-result authority and expands the operation surface
  without providing more proof than the narrowly authorized exact item.
- **Keep recovery documentation as-is without implementation support.** The advertised verification step would remain
  deterministically unavailable for the very send it is meant to verify.

<a id="adr-0170-references"></a>
### References

- [v0.67 current version](README.md)
- [ADR-0129: Deterministic Bounded Raw Public Context Delivery](../v0.44/decisions.md#adr-0129)
- [ADR-0108: Discovery-Only Camp Message Search and Sequence-Paged Reads](../v0.40/decisions.md#adr-0108)
- [Built-in Tool Transport v7](../../contracts/builtin-tool-transport-v7.md)
- [Camp Message Send v4](../../contracts/camp-message-send-v4.md)
- [Current User Attention v2](../../contracts/current-user-attention-v2.md)
<!-- legacy-adr-body:end id=ADR-0170 -->
<!-- legacy-adr:end id=ADR-0170 -->
