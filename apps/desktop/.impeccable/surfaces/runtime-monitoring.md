---
surface: runtime-monitoring
status: current
last_updated: 2026-08-17
---

# Runtime Monitoring surface brief

## Purpose

This Settings surface is a compact Usage ledger. It answers how much Token, Cache and attributable Cost recent
AgentRuns actually reported, where Coverage is incomplete, and how the totals vary by time, Runtime and model. It is
not an execution debugger or reliability dashboard.

The permanent description is one sentence:

> 汇总 Runtime 实际上报的 Token、Cache 与成本；未上报字段显示为未知。

Do not add cutover notices, historical-data explanations, unsupported-Runtime warnings or implementation prose to the
page. Empty state copy describes only the current result.

## Information architecture

There is one page and no Tab strip. Preserve the established Rovai Settings heading, rail, surface tokens and compact
typography.

Order the content as:

1. range, Runtime, Provider, Model and Cost-kind filters;
2. eight sparse summary metrics with observed/eligible Coverage;
3. Token/Cache trend and optional Cost ledger;
4. Runtime breakdown;
5. Model breakdown;
6. Provider reconciliation only when compatible saved data exists.

Do not render Session, Tool, Activity, Delivery, Approval, Reliability, Context, Compaction, Probe or terminal-state
panels. Unknown is `—`, never zero. Partial Coverage is visible next to the value rather than hidden in a tooltip.

## States

Support Loading, global Empty, Partial, Populated, Stale, Error and Export success/failure without removing the
Settings header or filters. A background refresh failure keeps the last good snapshot visible, identifies its
range end time and offers local retry. Export preserves raw numeric strings and sparse `null` values.

The page never starts Provider reconciliation, pricing sync, retention, Runtime probing or any network request.

## Interaction and accessibility

Filters have persistent visible labels, native keyboard behavior and visible focus. A foreground filter request may
show the loading state; a background failure preserves the last readable snapshot. Status and export feedback use
appropriate live-region semantics without repeated announcements.

Snapshot requests are single-flight. Poll only while the page is visible, at most once per 12 seconds. Coalesce event,
poll, filter and manual requests; ordinary Usage Flush does not request an immediate refresh, non-terminal events use
a global minimum interval, and terminal events refresh after Debounce. Stop all polling after leaving the Settings
item.

At 1040×700 and 200% zoom, filters wrap, summary cards collapse from four to two to one column, tables scroll within
their own surface, and the Settings panel does not gain horizontal overflow. Motion remains optional and respects
reduced-motion preferences.

## Authority

Persistence, Coverage, Cost grain, refresh cadence and Snapshot shape are owned by the
[Runtime Usage Monitoring v2 contract](../../../../docs/contracts/runtime-usage-monitoring-v2.md) and
[Runtime Monitoring architecture](../../../../docs/architecture/runtime-monitoring.md). This brief owns presentation
strategy only.
