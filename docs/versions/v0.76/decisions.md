---
document_type: version-decisions
version: v0.76
lifecycle: historical
last_updated: 2026-08-18
---

# v0.76 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0184](#adr-0184) | Line-Leading Display-Name Inline Addressing Alias | `accepted` |

<!-- legacy-adr:begin id=ADR-0184 source-file-sha256=6ae1fff1dc1be0becaa51a9c46988a9ae01c895dc5f6d1b17fd3063116b5950f -->
<a id="adr-0184"></a>

## ADR-0184: Line-Leading Display-Name Inline Addressing Alias

迁移时原路径：`docs/adr/0184-line-leading-display-name-inline-addressing-alias.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
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
```

<!-- legacy-adr-body:begin id=ADR-0184 -->
<a id="adr-0184-context"></a>
### Context

ADR-0182 introduced exact current-Camp display-name aliases so a deliberate `@Alice ` handoff can resolve to a
canonical Agent ID. Its first grammar accepts the alias at any parseable body position. That also turns ordinary prose
such as `让 Bob 分析一下 @Alice 提出的迁移方案` into an execution request, even though the sentence may only discuss
Alice's proposal. Mutable human-readable names need a stronger intent signal than the `@` glyph alone.

<a id="adr-0184-decision"></a>
### Decision

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

<a id="adr-0184-consequences"></a>
### Consequences

- Mid-sentence discussion of an exact member display name remains public prose and cannot accidentally allocate A2A
  responsibility.
- Authors can route naturally at message start or on a dedicated final line without using a canonical ID.
- Indentation is harmless, while Markdown list/quote markers are intentionally not treated as whitespace-only line
  prefixes.
- Canonical automation and downstream Structured Mention/Delivery behavior do not change.

<a id="adr-0184-rejected-alternatives"></a>
### Rejected Alternatives

- **Allow every alias on the final logical line.** A single-line message is also its final line, so the original prose
  ambiguity would remain.
- **Parse Markdown list and quote prefixes.** Prefix-specific grammar increases accidental routing and parser surface;
  an explicit routing line is simpler.
- **Apply the position gate to canonical `@agent_N`.** Stable machine-facing commands would break for a safety issue
  specific to mutable display-name prose.
- **Remove display-name aliases entirely.** This restores the original missed-handoff failure that ADR-0182 solved.

<a id="adr-0184-references"></a>
### References

- [v0.76 current version](README.md)
- [ADR-0182: Core-Resolved Current-Camp Display-Name Inline Addressing Alias](../v0.75/decisions.md#adr-0182)
- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](../v0.62/decisions.md#adr-0163)
- [Camp Message Send v7](../../contracts/camp-message-send-v7.md)
- [Public A2A Message and Message Delivery architecture](../../architecture/public-a2a-message-delivery.md)
<!-- legacy-adr-body:end id=ADR-0184 -->
<!-- legacy-adr:end id=ADR-0184 -->
