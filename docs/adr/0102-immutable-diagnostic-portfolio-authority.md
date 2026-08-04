---
document_type: adr
id: ADR-0102
title: Immutable Diagnostic Portfolio Authority and Two-Repeat Stability
status: accepted
date: 2026-08-04
decision_scope: cross-version
source_version: v0.36
supersedes: []
superseded_by: null
---

# ADR-0102: Immutable Diagnostic Portfolio Authority and Two-Repeat Stability

## Context

Qualification Suite is a formal result-set authority with a planned denominator and eventual Pass Rate.
That model is a poor fit for the first high-strength Case portfolio: the goal is to diagnose Case quality,
team delivery behavior, and evidence integrity without ranking a team, selecting a favorable repeat, or
claiming statistical reliability.

A single mutable Portfolio file would also conflate frozen execution identity with evolving Trial state.
Repairing progress after a crash could then silently rewrite the configuration being evaluated or discard
an inconvenient Invalid attempt.

## Decision

Rovai defines a Diagnostic Case Portfolio independently of Qualification Suite. One Portfolio contains
exactly four sealed schema-v3 Collaboration-Value Cases and exactly two planned Independent Qualification
Repeats per Case. It emits per-Trial findings and Case stability states, never Pass Rate, Pass@k, ranking,
best result, composite score, Solo comparison, role ablation, statistical claim, or team-superiority claim.

Portfolio authority is split into four artifacts:

1. an immutable pre-dispatch Definition binding Portfolio identity, the four Case identities and Seals,
   eight fixed slot IDs, frozen team, uniform budget, toolchain, Judge policy, and configuration digest;
2. a private append-only hash-chained Ledger of attempt and slot state events;
3. a replaceable Status projection rebuilt from Definition, Ledger, and retained Trial Bundles; and
4. a one-time immutable Completion Attestation binding the Definition digest, terminal Ledger head,
   eight authoritative Trial Bundle references and Hard Outcome Fingerprints, and four stability states.

The first Portfolio freezes the current four-Member Qualification Runner configuration, including Member
identities, Runtime adapters, declared model IDs and options, reasoning parameters, and permission
profiles. Every Trial uses `elapsedSeconds=900`, `maxAgentRuns=8`, and `maxAcceptedA2a=7`. The same locally
observable Core, Runner, Runtime, Node/toolchain, team, and Portfolio configuration fingerprints are
required across all slots. Observable fallback or substitution fails closed. An opaque provider's
unpublished model-weight drift is retained as a limitation rather than falsely attested.

Each slot starts with fresh Core data, Camp, Conversation, Native Sessions, workspace, and private Runtime
configuration. A pre-dispatch Invalid attempt may be replacement-linked to the same slot only after the
identical frozen configuration becomes available; the original event remains in the Ledger. After accepted
dispatch, only evaluation of the same frozen Delivered Workspace Snapshot may resume. An irrecoverable
post-dispatch evidence gap, configuration drift, or private-material leak leaves the Portfolio incomplete
and cannot be replaced. A valid Hard failure is a completed observation.

Every valid complete Trial produces a versioned Hard Outcome Fingerprint over all Layer 1 authority fields
and subfields, all six Requirement verdicts, and build, regression, and change-boundary category verdicts.
The two fingerprints for a Case yield:

- `stable_pass` when they are identical passes;
- `stable_fail` when they are identical failures;
- `investigation_required` when both are valid and complete but differ; or
- `incomplete` when either planned slot lacks trusted terminal evidence.

Failure stage, Run graph, messages, Tool counts, latency, and Semantic Review are reported as observed
variation outside the Hard Outcome Fingerprint. A mismatch receives no third deciding run. Root-cause
correction creates a new Case and Portfolio version and retains the old results.

Portfolio implementation is complete when all four Cases pass admission and all eight slots contain
bundle-verified, non-leaking, valid final evidence. `stable_pass`, `stable_fail`, and
`investigation_required` are all honest completed diagnostic findings; no target team pass or real Judge
verdict is required. An `investigation_required` Case cannot be promoted into a later Formal Qualification
Suite until a newly sealed corrected version produces matching repeats. Diagnostic completion therefore
does not weaken formal promotion.

The evaluated prompt states only the goal, six Requirements, public commands, and change/toolchain
constraints. It contains no workstream, Member, role, delegation, `call_member`, Task, or handoff hint.
The four Cases are admitted because they contain independent work and an integration invariant, not because
the Runner scripts a collaboration path.

Layer 5 remains `unavailable` for this Portfolio while no immutable, tool-disabled external Judge provider
is configured. Deterministic Judge fixtures remain protocol tests and are never attached to the eight real
Trial histories. A later real provider may append a new Semantic Review revision without changing Hard
Outcome or Portfolio stability.

## Consequences

- Portfolio identity cannot drift as Trial state accumulates, and crash recovery does not depend on a
  mutable status file.
- Honest valid failures and repeat disagreement remain visible instead of being replaced by easier Cases
  or a third vote.
- Eight real executions are required even though no aggregate pass statistic is published.
- Frozen Runtime and model configuration can make the Portfolio incomplete when a provider is unavailable.
- Diagnostic completion can coexist with an unstable team observation, while formal promotion remains
  stricter.

## Rejected Alternatives

- **Reuse Qualification Suite with a hidden or suppressed Pass Rate.** Rejected because Suite semantics
  still imply a formal denominator and comparison-ready result set.
- **Store Definition and current status in one mutable manifest.** Rejected because recovery can rewrite
  evaluation identity.
- **Run a third repeat on disagreement.** Rejected because it creates an outcome-selection rule after
  observing the first two results.
- **Require every Case to pass or be stable before completing v0.36.** Rejected because that encourages
  favorable or easy-Case selection; stability instead controls later Formal promotion.
- **Attach a deterministic Judge fixture to real Trials.** Rejected because protocol conformance is not an
  LLM semantic finding.

## References

- [v0.36 Collaboration-Value Diagnostic Portfolio](../versions/v0.36/README.md)
- [ADR-0092: Recoverable Qualification Evaluation Integrity](0092-recoverable-qualification-evaluation-integrity.md)
- [ADR-0093: Core-Owned Atomic CampTurn Execution Budgets](0093-core-owned-atomic-campturn-execution-budgets.md)
- [ADR-0095: Layered Qualification Authority and Advisory Semantic Review](0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0098: Dual-Replica Evidence-Bound Semantic Judge Protocol](0098-dual-replica-evidence-bound-semantic-judge.md)
- [ADR-0101: Outcome-Only Collaboration-Value Qualification Cases](0101-outcome-only-collaboration-value-qualification-cases.md)
