---
document_type: adr
id: ADR-0201
title: Sparse Runtime Usage Authority and Clean-Break Monitoring Enrollment
status: superseded
date: 2026-08-16
decision_scope: cross-version
source_version: v0.96
supersedes: []
superseded_by: ADR-0205
---

# ADR-0201: Sparse Runtime Usage Authority and Clean-Break Monitoring Enrollment

## Context

Rovai must compare run lifecycle, Token, Cache, Context, Tool duration and cost across Runtime protocols with very
different observation surfaces. Claude, Codex and some ACP agents expose structured Usage, while other ACP agents
omit fields or use private extensions, and Antigravity exposes no authoritative Usage. Provider billing also has a
different grain from an AgentRun. Treating all adapters as complete would turn missing facts into fabricated zeroes;
mixing telemetry into Execution Evidence would expose accounting observations as user-visible activity and tempt later
model-context reuse.

The monitoring feature also begins after substantial local execution history already exists. Reconstructing old
Token, Cache, Session decisions and Tool intervals from final output, logs or current bindings would create a second,
less trustworthy historical contract. A durable boundary is required before schema, parser and rollup choices become
expensive to reverse.

## Decision

### Runtime Usage is a separate sparse authority

Runtime Usage Observation is separate from AgentRun Execution Evidence and Canonical Runtime Activity. Raw
observations are append-only, retain source identity and counter semantics, and contain only data a Runtime/provider
reported or a deliberately labeled local estimator produced. A versioned normalized projection may be rebuilt from
raw observations, but it cannot add a field the source did not establish.

All normalized Usage fields are sparse. Missing is `NULL`, explicit zero remains zero, and a Runtime/version is eligible
for a field only when its protocol contract or real Fixture proves that field and its semantics. A common ACP parser
may share framing, presence handling and validation, but adapter/version dialects own private field paths, input/cache
semantics and delta/cumulative/gauge interpretation. Protocol family membership never grants complete Usage support.

Local tokenizer output is an estimate source, not Runtime Usage. It may estimate Rovai-known Antigravity input/final
output when its tokenizer/version is recorded, but it cannot produce native Cache facts, Provider actual Token or true
cost. It does not increase native Usage Coverage.

### Monitoring uses explicit clean-break enrollment

A persisted Monitoring Collection Epoch establishes the cutover. Only a new AgentRun/execution epoch explicitly
enrolled after that boundary enters monitoring eligibility. Pre-cutover Runs and Runs already active at cutover are not
backfilled, scanned, inferred or mixed into monitoring windows, even when some lifecycle timestamps remain available.
The old Core facts are retained and are not deleted; the clean break changes monitoring interpretation, not execution
history ownership.

Every enrollment freezes the Runtime/parser observation capability used to derive eligible denominators. Coverage is
always `observed / eligible` within one collection epoch and field definition. Missing observations remain partial or
unavailable rather than zero. Query windows disclose and clamp to the collection boundary.

### Session, Tool and Cost truth retain their own grains

Native Session continuation is a new per-AgentRun/execution-epoch fact recorded at the launch decision and actual
outcome boundaries. Historical bindings or conversation identity are not treated as an exact resume decision.

Tool duration is exact only for Core-owned operations or Runtime operations with stable identity and observed started
and terminal boundaries. Unpaired or run-level activity contributes to Coverage, not invented elapsed time. Parallel
call elapsed sum and wall-clock union remain distinct measures.

Runtime-reported cost, Runtime estimate, versioned public-price estimate, Provider-reconciled bucket and explicit
allocation are separate layers. A Provider bucket may become a single-Run cost only with stable request linkage or an
equivalent isolated attribution dimension. Subscription spend and unlinked aggregate bills are never represented as
true AgentRun cost. “Best available” may select only among values with compatible grain, dimensions, time range and
currency.

## Consequences

- Monitoring storage, parsers, rollups and queries must carry collection epoch, source, quality, counter mode,
  semantics and Coverage rather than one universal populated schema.
- Runtime adapters can improve independently through versioned Fixture evidence without changing the common query
  contract or fabricating unsupported fields.
- The monitoring page cannot offer complete historical trends at introduction; it must state when collection began.
- Execution Evidence, model context, Camp messages, Memory and full-text search do not receive Usage payloads.
- Rebuilding normalized Usage is safe only if raw-event deduplication is independent from parser version.
- Provider reconciliation requires a separate billing integration and does not silently upgrade Run-level truth.

## Rejected Alternatives

- Put Usage into Execution Evidence: rejected because accounting/context gauges are not user-visible operation
  evidence and must never become model context by reuse.
- Require a fully populated cross-Runtime row: rejected because ACP notification support is optional and private
  dialects differ; defaults would turn absence into false zeroes.
- Backfill historical Runs from transcripts, text length, current Session bindings or aggregate bills: rejected because
  the missing decision/counter boundaries cannot be recovered exactly.
- Treat tokenizer estimates as native Provider Usage: rejected because Cache and billed Token semantics remain unknown.
- Allocate every Provider bucket across Runs: rejected because arithmetic allocation does not establish causal request
  attribution.
- Derive Tool intervals from titles, final output or workspace diffs: rejected because it violates observation honesty
  and fails under missing events and parallel operations.

## References

- [v0.96 运行监控与原生 Usage 观测](../versions/v0.96/README.md)
- [Runtime Monitoring v1](../contracts/runtime-monitoring-v1.md)
- [Runtime Monitoring architecture](../architecture/runtime-monitoring.md)
- [Runtime monitoring feasibility audit](../research/runtime-monitoring/README.md)
- [ADR-0013](0013-managed-content-and-read-side-v2.md)
- [ADR-0111](0111-core-owned-canonical-runtime-activity.md)
- [ADR-0112](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0117](0117-observation-capability-coverage-levels-across-runtime-adapters.md)
- [ADR-0148](0148-read-only-diagnostics-and-data-minimized-export.md)
