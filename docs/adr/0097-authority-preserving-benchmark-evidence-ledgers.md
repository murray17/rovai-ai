---
document_type: adr
id: ADR-0097
title: Authority-Preserving Benchmark Evidence Ledgers
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
---

# ADR-0097: Authority-Preserving Benchmark Evidence Ledgers

> [ADR-0099](0099-cost-gated-independent-member-calls.md) replaces only this ADR's Return
> Obligation, Core Outcome, explicit-return, source-consumption, and Response Closure clauses.
> Independent Member Call lifecycle and evidence-authority decisions continue unchanged.

## Context

Qualification evidence currently combines periodic Camp Snapshots, bounded execution evidence,
workspace tree diffs, verifier summaries, and a derived collaboration matrix. Core-mediated Team
Tools have authoritative authorization, idempotency, and receipt facts. Shell, file, Git, test,
build, and external MCP activity may instead arrive as adapter-specific Runtime telemetry with
partial identity, timing, arguments, or completion status.

A “unified Tool Call Ledger” can improve diagnosis only if it preserves these authority differences.
Flattening every event into a complete-looking record would turn missing Runtime telemetry into
negative facts, conflate a Tool exit with an external side-effect receipt, and make semantic guesses
about feedback or causality appear objective.

## Decision

Qualification uses a normalized evidence graph with stable Evidence References. Every normalized
fact declares its source, authority class, observation coverage, source sequence or digest, and any
derivation rule. The closed authority classes distinguish at least:

- Core-authoritative domain and Tool facts;
- Runner-authoritative environment, process, snapshot, isolation, and evaluation facts;
- validated Verifier Observations;
- Runtime-reported telemetry;
- deterministic derived facts;
- Semantic Judge findings.

Normalization never promotes a weaker class. Missing or non-applicable fields use explicit states
and reasons rather than false, zero, empty arrays, or inferred success. Every derived metric retains
the Evidence References from which it was computed.

Evidence is a family of closed, independently versioned schemas rather than one permissive result
object. The minimum family separates Case and Verification Catalog identity, Trial lifecycle and
Hard Outcome, normalized evidence index, Verifier Observation, collaboration lifecycle, Tool calls,
workspace mutations, Judge Evidence Pack, Judge Replica/reconciliation results, and Suite summary.
Every artifact declares its schema identity, producer identity, Trial or Suite binding, canonical
content digest, and referenced source boundary. Consumers reject unknown required fields, duplicate
stable IDs, missing expected items, unresolved Evidence References, and unsupported schema versions
instead of partially accepting them. One artifact's version may advance without renumbering the
others, but any semantic change creates a new digest-bound identity.

At the Delivered Workspace Freeze Barrier, Runner freezes one Core evidence boundary, retrieves all
required pages for every AgentRun and collaboration entity, verifies sequence continuity and declared
totals, and records the immutable source digest. A bounded Camp Snapshot or Renderer window cannot be
the complete Qualification source. A gap in Hard Outcome authority makes evaluation pending; a gap
in optional diagnostics makes only the affected finding indeterminate.

The **Tool Call Ledger** is a normalized per-call projection rather than a claim that all Runtimes
offer equal telemetry. Each record supports:

- AgentRun and source-event references;
- canonical Core Tool identity when known, plus native identity and operation classification without
  inventing a canonical name;
- requested, authorized, started, terminal, and observed timestamps when supplied by one comparable
  clock source;
- lifecycle status and typed error class;
- authorization decision and its authority;
- canonical idempotency identity, retry/replay relationship, receipt, and side-effect identity;
- mutation intent, effect references, duplicate-effect finding, and later verification references;
- per-field availability and coverage.

Source sequence is the ordering authority within an evidence stream. Wall-clock timestamps are
presentation facts, not a universal total order. Latency is computed only between events from the
same monotonic clock domain or a recorded clock-correlation interval; otherwise the segment is
indeterminate. Member Call latency is reported by separate acceptance-to-Input-persistence,
Input-to-Run-materialization, materialization-to-recipient-start, recipient-execution, and
acceptance-to-recipient-terminal segments. A later call in any direction has its own latency and is
never joined to the earlier edge as response or end-to-end round-trip time.

An idempotent replay is not a second call or duplicate side effect. Duplicate external effects are
reported only when a Core/provider receipt or complete effect ledger proves them; repeated commands,
same-path writes, or similar arguments remain separate facts. Test/build/Git labels derived from shell
commands carry derivation identity and cannot imply that a compound command fully executed or verified
each mutation.

Mutation verification is a typed relationship to later read-back, diff, test, build, or provider
receipt evidence, not a default Boolean on every mutating call. A later successful test can be linked
to the mutation set it actually covers; mere temporal order or a final Agent statement does not prove
verification.

The **Workspace Mutation Ledger** remains distinct from Tool calls because one shell Tool may cause
many filesystem effects and a writer may mutate without a first-class file Tool event. Under complete
isolation coverage it records path, writer-process and AgentRun attribution, before/after identity, and
ordering. Multi-Agent overlap, overwrite, and exact rollback are objective only within that coverage;
whether they were harmful is Semantic Review.

The **Member Call Lifecycle** derives only from canonical acceptance receipts and linked durable
Input, InboxMessage, and Run facts. Every accepted call is one independent forward edge. Exact
duplicate acceptance and forward-call cycles use frozen identity and lineage rules; repeated route,
role relevance, semantic redundancy, feedback absorption, and Call Semantic Disposition are not
guessed by rules.

For this lifecycle, `accepted` means the canonical Core acceptance receipt, `materialized` means the
durable recipient Input produced one Run, and a terminal Run means only that execution ended. None of
those facts implies that the recipient must contact the source, that the source consumed a result, or
that collaboration was semantically complete.

The v0.34 Collaboration Ledger exposes acceptance, Input persistence and terminal state, recipient
Run materialization/start/terminal state, slot and depth identity, optional Task link, and
`mechanicalSettlement = settled | unsettled | indeterminate` derived only from the Input and
recipient Run. Its schema has no `returnPolicy`, Return Obligation, Call Outcome,
`responseProduced`, `sourceReceived`, Response Closure, source-Resume, or Conversation Input kind
field. Historical artifacts retain their recorded schema without being adapted into current Member
Call semantics.

Objective collaboration diagnostics may report accepted calls, materialized and terminal lifecycle
counts, maximum forward-call depth, exact duplicate acceptances, forward cycles, repeated route facts,
latency segments, actual role activation, and covered file-overlap or rollback facts. A rate is emitted
only when its numerator and denominator have complete compatible coverage. Whether a route was
necessary, information was repeated, a role was omitted, feedback was absorbed, overlap was harmful,
or Lead integration was good remains Semantic Review.

Protocol conformance includes a recipient Run that terminates without any later call to its source.
That call MUST become settled without creating a source Run, synthetic message, missing-response
failure, or open collaboration responsibility. A later call back is instead a separately
accepted edge, consumes its own slot, and increases depth.

A Tool failure is linked to a final Failure Fact only when an authoritative terminal reason explicitly
references it. Otherwise the report states co-occurrence and leaves direct causality indeterminate or
to Semantic Review.

Judge Evidence Pack and public redacted export are separate allowlist projections from normalized
safe evidence. They never serialize raw source objects by default. Credentials, environment values,
private logs, hidden reasoning, full Withheld Verifier details, reference implementations, and Sealed
Pack locators have no output field; redaction is not a best-effort string replacement over a raw dump.

## Consequences

- One report can correlate heterogeneous Tool and collaboration activity without overstating
  completeness or authority.
- Core and adapters need richer stable correlation events, while the Runner needs full paginated
  evidence collection and continuity validation.
- Many desirable metrics legitimately remain `indeterminate` for a Runtime until its coverage
  contract improves.
- File overlap and duplicate-effect diagnosis require isolation/audit infrastructure beyond a final
  Git diff or command list.
- Safe export and Judge input require purpose-built schemas and canary tests rather than reuse of the
  private bundle JSON.
- Cross-Runtime latency and retry metrics may remain unavailable until their clock and identity
  coverage contracts are strong enough; the schema records that limitation rather than normalizing it
  away.

## Rejected Alternatives

- **Treat every Runtime activity event as a canonical Tool call.** Rejected because native telemetry
  differs in identity, lifecycle, authorization, and completeness.
- **Use missing data as failure or zero.** Rejected because unavailable observation is not evidence
  that an action did not happen.
- **Infer duplicate side effects from repeated commands.** Rejected because retries may be idempotent
  and equal commands may intentionally produce distinct effects.
- **Infer feedback absorption from matching text and final diff.** Rejected because temporal or textual
  similarity does not establish causality.
- **Feed the private Evidence Bundle directly to Judge.** Rejected because it violates least disclosure
  and exposes fields the Semantic Review does not need.

## References

- [ADR-0061: Durable Agent-Inaccessible Execution Evidence](0061-durable-agent-inaccessible-execution-evidence.md)
- [ADR-0090: Team Delivery Qualification Evidence Boundary](0090-team-delivery-qualification-evidence-boundary.md)
- [ADR-0091: Durable Member Calls and Single-Slot A2A Resume Scheduling](0091-durable-member-calls-and-single-slot-a2a-resume.md)
- [ADR-0094: Formal Qualification Isolation and External Effect Coverage](0094-formal-qualification-isolation-and-effect-coverage.md)
- [ADR-0095: Layered Qualification Authority and Advisory Semantic Review](0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0098: Dual-Replica Evidence-Bound Semantic Judge Protocol](0098-dual-replica-evidence-bound-semantic-judge.md)
- [ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics](0099-cost-gated-independent-member-calls.md)
