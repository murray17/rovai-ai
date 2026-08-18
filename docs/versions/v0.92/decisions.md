---
document_type: version-decisions
version: v0.92
lifecycle: historical
last_updated: 2026-08-18
---

# v0.92 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0198](#adr-0198) | Bounded Open-Round Protocol for Self-Contained Grill Duo Skills | `accepted` |

<!-- legacy-adr:begin id=ADR-0198 source-file-sha256=0afe7a6a2f5a5143e3fd386a74c42ca141cf815179557f241af2109412878700 -->
<a id="adr-0198"></a>

## ADR-0198: Bounded Open-Round Protocol for Self-Contained Grill Duo Skills

迁移时原路径：`docs/adr/0198-bounded-open-round-grill-duo-skills.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0198
title: Bounded Open-Round Protocol for Self-Contained Grill Duo Skills
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.92
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0198 -->
<a id="adr-0198-context"></a>
### Context

The original Grill Duo workflow asked exactly one user question at a time. That keeps correlation simple but makes
independent decisions unnecessarily serial. A later simplified draft grouped several questions, yet it did not fully
define partial answers, changed constraints, eligible partner identity or which return can advance the current round.
The documentation variant also carried a second complete copy of the ordinary duo protocol, creating two sources that
could drift while both Skills were expected to remain independently assignable.

The desired workflow is still lightweight Skill-owned coordination over ordinary public A2A Messages. It does not need
a Core-owned Gather, a persisted round entity or a new delivery contract, but it does need a stable cross-version rule
for deciding which questions and partner result are authoritative.

<a id="adr-0198-decision"></a>
### Decision

1. `grill-duo` and `grill-duo-with-docs` remain self-contained, ordinary `user_managed` Skills. Each complete
   executable workflow lives in its own `SKILL.md`; the documentation variant carries only its domain-language and ADR
   references and does not include a shared copy of the ordinary duo protocol.
2. One round contains one to four questions whose prerequisites are already confirmed and which can be answered
   independently. The inviter sends one consolidated initial review request to one fixed partner, the partner returns
   one message with per-question advice, and the inviter sends one consolidated user request. A question that depends
   on another answer waits for a later round.
3. A round remains open until every numbered question is answered, cancelled or invalidated. Unanswered questions keep
   their stable number and current partner advice; no new questions enter an open round. If a user answer changes one
   question, its options or its constraints, only that numbered question loses its advice and is re-reviewed. The next
   round is formed only after the current round closes.
4. The fixed partner must be a non-self member still present in the current Camp and able to receive the request. All
   routing uses Runtime/Core-provided trusted Agent IDs. A partner handles only the review request that triggered its
   current AgentRun, and the inviter accepts only the current fixed partner's direct reply to the current effective
   invitation as formal advice. Old, invalidated or late advice is supplemental and cannot advance, rewind or reopen a
   session.
5. Both partner returns and user-directed messages end the current response only after `rovai send` returns
   `accepted`. Acceptance commits the Message and Delivery but does not prove that the recipient started or completed;
   the Skills do not poll, fabricate a return or use Gather.
6. `grill-duo` excludes sessions whose confirmed decisions must also update domain vocabulary or qualifying ADRs.
   `grill-duo-with-docs` owns that case and records only user-confirmed terms and decisions. Its partner never modifies
   project documentation.
7. Skill `description` metadata states natural-language applicability, continuation roles and exclusion boundaries.
   Round steps, message titles, command details and recovery remain in the Skill body. User-visible short descriptions
   stay concise and descriptive without becoming protocol summaries.

This decision locally replaces the one-question-at-a-time Grill behavior inherited from historical ADR-0144 and
ADR-0150. It does not replace ADR-0191's official inventory, ADR-0158's delivery defaults, ADR-0163's Core-managed reply
reference or any Message Delivery contract.

<a id="adr-0198-consequences"></a>
### Consequences

- Users can resolve up to four independent decisions in one interaction while dependent decisions remain ordered.
- Partial answers preserve question identity and prior work without silently treating omissions as agreement.
- A changed question cannot reuse advice produced for an obsolete option or constraint set.
- Both bundled Skills remain usable when assigned alone, at the cost of a small amount of intentionally duplicated
  workflow text in their top-level `SKILL.md` files.
- The documentation package loses one reference file; Core's embedded manifest and immutable Revision file count must
  change together.
- No database migration, IPC shape, Built-in Tool Transport version, Gather behavior or Renderer state is introduced.
- No compatibility branch recognizes or continues the retired one-question protocol.

<a id="adr-0198-rejected-alternatives"></a>
### Rejected Alternatives

- Keep exactly one question per round: rejected because several independent decisions can be answered safely together.
- Batch an arbitrary number of questions: rejected because it increases user burden and makes partial answers harder to
  reconcile.
- Use Gather for the single fixed partner: rejected because ordinary A2A already provides the required direct reply and
  asynchronous continuation.
- Persist a Core-owned Grill Round and question state: rejected because the bounded workflow can carry stable question
  identities in the Skill-owned public messages without adding a new product protocol.
- Keep a shared `references/grill-duo.md`: rejected because each Skill must remain self-contained and the duplicate
  protocol source had already drifted from its caller.

<a id="adr-0198-references"></a>
### References

- [v0.92 overview](README.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [ADR-0144: Self-Contained Duo Grilling Bundled Skills (historical)](../v0.49/decisions.md#adr-0144)
- [ADR-0150: Evidence-First Agent Codebase Analysis Bundled Skill (historical)](../v0.52/decisions.md#adr-0150)
- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](../v0.62/decisions.md#adr-0163)
- [ADR-0191: Thirteen-Skill Official Inventory](../v0.85/decisions.md#adr-0191)
- [`grill-duo` source](../../../skills/grill-duo/SKILL.md)
- [`grill-duo-with-docs` source](../../../skills/grill-duo-with-docs/SKILL.md)
<!-- legacy-adr-body:end id=ADR-0198 -->
<!-- legacy-adr:end id=ADR-0198 -->
