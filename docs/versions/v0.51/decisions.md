---
document_type: version-decisions
version: v0.51
lifecycle: historical
last_updated: 2026-08-18
---

# v0.51 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0148](#adr-0148) | Read-Only Diagnostics and Data-Minimized Export | `accepted` |

<!-- legacy-adr:begin id=ADR-0148 source-file-sha256=9118ed5026a5188248799d317b37a701cb40bf7bca5e497c7f0ea8b95e0484eb -->
<a id="adr-0148"></a>

## ADR-0148: Read-Only Diagnostics and Data-Minimized Export

迁移时原路径：`docs/adr/0148-read-only-diagnostics-and-data-minimized-export.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0148
title: Read-Only Diagnostics and Data-Minimized Export
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.51
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0148 -->
<a id="adr-0148-context"></a>
### Context

The former Diagnostics Settings page combined cached health facts with a button that ran Runtime discovery.
That made “check” ambiguous: reading the current state could also rescan PATH and schedule deeper Runtime work.
Skill projection truth was available only through reconciliation, MCP reads could initialize a missing file, and
SQLite health only proved that Core had already opened the database. The v4 export was assembled from broad raw
objects and included absolute application, Runtime and project paths.

A repair center must distinguish observation from mutation. It must also remain available only after normal Core
startup; a database that prevents Core startup continues through Startup Recovery instead of a second partial Core.

<a id="adr-0148-decision"></a>
### Decision

<a id="adr-0148-strict-read-boundary"></a>
#### Strict read boundary

`diagnostics.check` is a typed Core read model. It may read Core metadata, filesystem metadata, Git version,
`PRAGMA quick_check`, Skill Library and managed-link facts, an existing MCP file, current member Runtime selections,
and cached Runtime discovery/probe evidence. It must not reconcile Skill projections, initialize or rewrite MCP,
rescan Runtime discovery, schedule a Runtime check, alter SQLite, log in, replace a Runtime, or execute another
repair.

The read model reports every check as `ok | attention | unknown`. An incomplete, timed-out or transient observation
is `unknown`; it is never promoted to an actionable failure. Last-success Runtime evidence may be retained only with
an explicit stale marker and the failed current attempt. All Product Runtimes remain visible, but an unavailable
Runtime is `attention` only when at least one non-removed AgentProfile persistently selects that AdapterKind.

<a id="adr-0148-explicit-single-item-repair-boundary"></a>
#### Explicit single-item repair boundary

Repair is a separate user action and is limited to existing safety-preserving operations:

- Skill reconciliation manages only Rovai-owned projections and preserves project-owned conflicts;
- MCP permission repair may only tighten the parent/file permissions and cannot change JSON bytes;
- Runtime retry explicitly schedules one product check, while hard unavailable states navigate to Runtime settings;
- SQLite and other data failures provide explanation and diagnostics export, never automatic mutation.

There is no “repair all”. A repair is not presented as successful until a subsequent `diagnostics.check` reports
the affected check as `ok`. Failed refresh preserves the last successful report as Recovery evidence.

<a id="adr-0148-diagnostics-export-v5"></a>
#### Diagnostics export v5

`rovai-diagnostics-v5` is the only newly emitted diagnostics format and locally replaces the v4 identifier listed
in ADR-0048. There is no dual-write or v4 compatibility branch. The export is built from the typed diagnostics
report plus allowlisted aggregate counts, then passes through one centralized redaction boundary before Electron
writes it atomically with mode `0600`.

The export excludes credentials, tokens, cookies, login data, user messages, Memory bodies, attachment bodies and
Tool output. It also emits no absolute Home, application data, SQLite, Runtime executable, Skill entry, execution
root, workspace or project paths. Finder reveal accepts only the exact path successfully exported in the current
Main process session.

<a id="adr-0148-consequences"></a>
### Consequences

- “Run full self-check” has a stable no-write meaning and can be regression-tested independently from repair.
- Diagnostics can honestly show Partial and Recovery states without turning missing evidence into failure.
- Skill and MCP require dedicated strict-read paths in addition to their existing mutation APIs.
- Export consumers must adopt v5; v4 is intentionally not emitted or translated.
- Core-start database failures remain outside the Diagnostics Center and continue through Startup Recovery.

<a id="adr-0148-rejected-alternatives"></a>
### Rejected Alternatives

- Reconcile Skill or initialize MCP as part of self-check: observation would mutate the condition being diagnosed.
- Rescan or probe every Runtime during self-check: it would make the read path slow, externally observable and
  semantically different from cached evidence.
- Mark every missing Runtime as a problem: unused products would create noise and pressure users to install tools
  they do not use.
- Keep v4 beside v5: broadens the privacy surface and prolongs an unneeded raw-object contract.
- Automatically rebuild SQLite or overwrite malformed MCP: risks destructive recovery without enough authority.

<a id="adr-0148-references"></a>
### References

- [v0.51 诊断中心](README.md)
- [Diagnostics Center v1 contract](../../contracts/diagnostics-center-v1.md)
- [Diagnostics Center architecture](../../architecture/diagnostics-center.md)
- [ADR-0048](../v0.11/decisions.md#adr-0048)
<!-- legacy-adr-body:end id=ADR-0148 -->
<!-- legacy-adr:end id=ADR-0148 -->
