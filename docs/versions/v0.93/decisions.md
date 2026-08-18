---
document_type: version-decisions
version: v0.93
lifecycle: historical
last_updated: 2026-08-18
---

# v0.93 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0199](#adr-0199) | Session-Semantic Four-Message Review Duo | `accepted` |

<!-- legacy-adr:begin id=ADR-0199 source-file-sha256=034d514a8a8532d25aacbd6f462a23a012208d04751fc9836f60891affd60d5a -->
<a id="adr-0199"></a>

## ADR-0199: Session-Semantic Four-Message Review Duo

迁移时原路径：`docs/adr/0199-session-semantic-four-message-review-duo.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0199
title: Session-Semantic Four-Message Review Duo
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.93
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0199 -->
<a id="adr-0199-context"></a>
### Context

Review Duo originally used result parts, manifests, request-message locators and exact historical reads to make both
review axes recoverable after context loss. That design was executable over ordinary Camp Messages, but it turned a
two-person review into a transport protocol whose complexity dominated the review itself.

The intended product surface is narrower: two current Camp members review one immutable code range in a normal active
conversation. Unlike Campfire, it has one fixed partner and does not need Gather. It also does not promise that a Lead
can reconstruct or deduplicate the workflow after both Native Session context and visible conversation context are
lost. The durable code-range identifier, trusted sender identity and Core-managed direct reply relation are sufficient
for this session-scoped collaboration, provided result size and recipient boundaries remain explicit.

<a id="adr-0199-decision"></a>
### Decision

1. `review-duo` remains an ordinary `user_managed` official Skill and keeps one Spec reviewer, one Standards reviewer,
   an immutable shared code range and two independently reported axes. It is packaged as exactly five files: `SKILL.md`,
   `NOTICE`, `agents/openai.yaml`, `references/findings.md` and `references/snapshot.md`.
2. The normal duo uses four accepted Camp Messages: the Lead sends one Standards request to a fixed partner, publishes
   one public-only Spec result, the partner directly returns one Standards result, and the Lead publishes one
   public-only bounded final report. It uses neither Gather nor result parts, manifests, pointer messages, launch or
   waiting messages.
3. Every message carries the same immutable review range, such as `git:<merge-base>...<head>` or
   `patch:sha256:<digest>`. The Lead accepts only the current fixed partner's direct reply to the current effective
   request with the same range. One Lead advances at most one unfinished Review Duo in one Camp at a time.
4. The Skill adds no review key, request-message correlation field, completion locator or persisted review entity.
   Natural headings and the range aid session correlation but do not authenticate a result; trusted Runtime identity,
   explicit recipient and direct reply relation remain authoritative. The Skill intentionally provides no
   deterministic recovery or exactly-once publication guarantee after all relevant conversation context is lost.
5. Each axis reports at most eight findings. Each finding keeps its problem, evidence, impact and recommendation to one
   or two sentences per field, and one complete axis result targets roughly 2,000–2,500 Chinese characters. A result
   that cannot retain its important evidence within that bound becomes `partial` and recommends a narrower review.
6. The final report does not duplicate the complete axis results. For each axis it preserves status, total finding
   count, at most three highest-priority findings in the original order, and coverage limitations. The earlier axis
   messages remain the complete results, and the final report never merges, reranks or converts the axes into one score.
7. Public-only results are valid only with no effective Agent recipient. Directed messages are valid only when their
   effective recipient is exactly the trusted partner or request sender. Non-routing `@` text is escaped or placed in
   code, and a message with an unexpected recipient cannot advance the review.
8. After the request is accepted, the partner remains fixed unless explicitly unavailable or delivery fails. A
   replacement receives the same immutable range; only the replacement's direct reply to the current request can
   advance, while older results remain supplemental. The final report marks session completion; duplicate or late
   results for the same range do not advance or republish it.

This decision locally replaces the detailed Review Duo packaging and result-transport behavior inherited through
ADR-0191 from ADR-0181. It does not supersede ADR-0191's official inventory, management policy, member creation or
provenance decisions, and it does not change Core Message Delivery or Built-in Tool Transport contracts.

<a id="adr-0199-consequences"></a>
### Consequences

- A normal Review Duo has a small, readable four-message topology and five-file bundled Revision.
- Findings remain bounded enough for one-message axis results, while oversized or broad reviews fail visibly as
  partial instead of introducing another transport protocol.
- The final report stays compact and the full evidence remains visible in the two preceding axis messages.
- Session correlation depends on the active conversation, trusted fixed partner, direct reply relation and immutable
  range. Complete context loss may require stopping or starting a new review, and exactly-once completion is not
  guaranteed by a durable workflow object.
- Core removes six compile-time file references and updates immutable bundled file-set tests, but adds no database,
  migration, operation, Envelope or Renderer state.

<a id="adr-0199-rejected-alternatives"></a>
### Rejected Alternatives

- **Keep parts, manifests and exact historical locators.** Rejected because the recovery strength is disproportionate
  to the intended fixed-partner, normal-session workflow.
- **Add a review key and completion locator.** Rejected because this would rebuild a durable transaction protocol the
  Skill explicitly does not promise.
- **Use Gather for the partner.** Rejected because Gather solves multi-recipient barrier aggregation; one direct fixed
  partner already has an executable return path.
- **Allow unbounded one-message results.** Rejected because Camp Message size is finite and a finding count alone does
  not bound prose volume.
- **Copy both full axes into the final report.** Rejected because it duplicates public evidence and can exceed the
  message budget without improving review independence.

<a id="adr-0199-references"></a>
### References

- [v0.93 overview](README.md)
- [ADR-0191: Agent-Mediated Member Creation and Thirteen-Skill Official Inventory](../v0.85/decisions.md#adr-0191)
- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](../v0.62/decisions.md#adr-0163)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [`review-duo` bundled source](../../../skills/review-duo/SKILL.md)
<!-- legacy-adr-body:end id=ADR-0199 -->
<!-- legacy-adr:end id=ADR-0199 -->
