---
document_type: version-decisions
version: v0.99
lifecycle: historical
last_updated: 2026-08-18
---

# v0.99 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0205](#adr-0205) | Minimal Runtime Usage Metering | `accepted` |

<!-- legacy-adr:begin id=ADR-0205 source-file-sha256=ed744afbad495f8c07d79fb8a9f7bf24774c52c87c5dcdecaa9eb8c879343506 -->
<a id="adr-0205"></a>

## ADR-0205: Minimal Runtime Usage Metering

迁移时原路径：`docs/adr/0205-minimal-runtime-usage-metering.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0205
title: Minimal Runtime Usage Metering
status: accepted
date: 2026-08-17
decision_scope: cross-version
source_version: v0.99
supersedes: [ADR-0201]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0205 -->
<a id="adr-0205-context"></a>
### Context

ADR-0201 correctly established sparse Runtime Usage, honest Coverage, a clean collection boundary and separate
Provider billing grain. Its first implementation also made Monitoring own raw and normalized observations, permanent
dedupe state, lifecycle/session/tool/reliability projections and a three-view dashboard. That breadth duplicated facts
already owned elsewhere in Core and put high-frequency operational data on the single SQLite write path.

The product needs a much smaller facility: recent Token, Cache and Cost metering. Execution Evidence, Canonical
Activity, AgentRun lifecycle, Approval, Session recovery, Delivery, Context and Runtime health remain useful Core
domains, but Monitoring must not create another copy merely to put them on a dashboard.

<a id="adr-0205-decision"></a>
### Decision

<a id="adr-0205-monitoring-owns-only-usage-derived-persistence"></a>
#### Monitoring owns only Usage-derived persistence

Runtime Monitoring is a Usage metering read model. Its durable schema contains exactly five domain tables:

- one current collection state;
- one sparse summary per logical AgentRun;
- one additive hourly Usage rollup;
- Provider cost reconciliation buckets that cannot be attributed to one Run;
- an active-only checkpoint for cumulative baselines, replay dedupe, restart recovery and counter reset.

Raw Runtime messages, normalized observation history and permanent source-dedupe ledgers are not persisted. Parsing
and compatible in-flight merging happen in memory. A flush updates checkpoint, logical Run summary and hourly rollup
in one short transaction. Ordinary persistence is bounded to a 3–5 second cadence; the Runtime terminal boundary
forces the pending flush, while the authoritative AgentRun terminal transition finalizes the summary and deletes all
of that Run's checkpoints. Recovery epochs share the logical Run summary and use epoch-scoped checkpoints.

Missing fields are `NULL`; only an explicitly reported zero is zero. Input/cache bucket arithmetic is performed only
when the source semantics prove the buckets compatible. Reasoning output is a subset of output. Runtime/version
eligibility is frozen as a bitmask on enrollment and Coverage remains `observed / eligible` for each field.

<a id="adr-0205-read-and-retention-boundaries-stay-bounded"></a>
#### Read and retention boundaries stay bounded

The single `monitoring.snapshot` response contains only collection/range, Usage summary, Usage trend,
Runtime/model breakdown and field Coverage. It never scans Execution Evidence, Transcript, Blob or raw Runtime
payload, and it never performs Provider reconciliation or network work. The Renderer is one Usage page rather than
Overview/Usage/Reliability tabs.

Run summaries, hourly rollups and reconciliation buckets retain 45 days. Active checkpoints are protected; terminal
checkpoints are deleted immediately and abandoned checkpoints expire after at most 72 hours. Cleanup is daily,
batched and independent from page reads; it never performs an automatic full `VACUUM`.

<a id="adr-0205-cost-authority-remains-grain-safe"></a>
#### Cost authority remains grain-safe

Run summary cost may contain only the best source actually attributable to that Run. Provider aggregate cost stays in
a reconciliation bucket keyed by Provider, billing-scope digest, currency and time range. It may be compared with Run
totals but is never allocated into fabricated single-Run cost. Currency is never inferred or silently converted.

<a id="adr-0205-consequences"></a>
### Consequences

- Monitoring storage and query cost scale with logical Runs and hourly dimensions rather than Runtime event volume.
- Runtime Usage never becomes Execution Evidence or model context, and Evidence is not copied back into Monitoring.
- Session, Tool, Reliability, Activity, Delivery, Approval, Context, Compaction and Probe data disappear from the
  Monitoring snapshot and page; their owning Core domains are unchanged.
- The v0.99 migration intentionally destroys the v1 Monitoring dataset and establishes a new collection epoch. No
  backfill, compatibility view, dual read or dual write is permitted.
- A future reliability product must establish its own need and deep read model instead of extending Usage metering by
  default.

<a id="adr-0205-rejected-alternatives"></a>
### Rejected Alternatives

- Retain raw observations for possible rebuild: rejected because it recreates unbounded history on the hot database;
  active checkpoint plus final summaries are sufficient for this bounded product.
- Keep v1 tables hidden for compatibility: rejected because dead schemas preserve accidental authority and cleanup
  cost without serving the new contract.
- Derive reliability panels directly from Evidence on refresh: rejected because it contends on the single Database
  Mutex and makes a support page part of the execution hot path.
- Copy Core lifecycle facts into Usage tables: rejected because it creates two authorities for the same Run.

<a id="adr-0205-references"></a>
### References

- [v0.99 最小 Runtime Usage Metering](README.md)
- [Runtime Usage Monitoring v2](../../contracts/runtime-usage-monitoring-v2.md)
- [Runtime Monitoring architecture](../../architecture/runtime-monitoring.md)
- [Runtime monitoring feasibility audit](../../research/runtime-monitoring/README.md)
- [ADR-0201](../v0.96/decisions.md#adr-0201)
- [ADR-0013](../v0.06/decisions.md#adr-0013)
<!-- legacy-adr-body:end id=ADR-0205 -->
<!-- legacy-adr:end id=ADR-0205 -->
