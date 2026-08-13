---
document_type: adr
id: ADR-0172
title: Paired Collaboration Value and Outcome-Conditioned Efficiency
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.68
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0172: Paired Collaboration Value and Outcome-Conditioned Efficiency

## Context

A mechanically correct or semantically persuasive collaboration trace does not prove that a Team outperforms a Solo Agent. Current
independent Qualification Trials, two-repeat stability and cross-version comparisons do not identify a collaboration treatment
effect. Likewise, raw duration and call counts are not collaboration efficiency: faster failure is not better, summed concurrent Run
durations double-count time, and incomplete token/cost telemetry cannot be treated as zero.

## Decision

Claims of collaboration value require an independent **Paired Collaboration Experiment** with one Team arm and one Solo arm. Before
dispatch it freezes the estimand, sealed Case and verifier, starting fixture, Tool Measurement Spec, model/runtime/permission policy,
ordinary Tool availability, resource profile, treatment difference, arm order policy, isolation requirements and validity rules.
Each arm receives fresh Core, Camp, Workspace, Memory, Conversation and Native Session state. The only permitted differences are
enumerated by the treatment declaration; invalid or incomparable arms do not enter a causal denominator.

The v1 treatment admits exactly multi-Agent versus single-Agent coordination. Before dispatch, Case, Tool Measurement, verifier,
prompt, fixture and budget bindings are recomputed from admitted authorities. After execution, common factors are recomputed from
Bundle-verified normalized artifacts, including Lead runtime/model/permissions, Built-in Tool availability and isolation identity;
copying frozen Definition claims into the observed arm is not evidence. Actual arms must also bind their dispatched plan slot and
fresh-state attestation.

The paired result first reports outcome strata: `both_pass | team_only_pass | solo_only_pass | both_fail | indeterminate`. Hard
Outcome remains authoritative. A treatment-blind Outcome Judge may provide a separate paired semantic outcome comparison when its
packs pass contamination and comparability gates. Process and Tool-Use Judge results explain mechanisms but never establish Team
superiority by themselves.

Resource evidence uses pre-registered typed measures. Each measure declares its construct, unit, direction, interval, aggregation,
clock domain, source authority and coverage. Pairwise deltas are eligible only when both arm measurements are compatible and the
outcome equivalence or non-inferiority condition is satisfied. A Team-only or Solo-only pass is an outcome difference accompanied by
descriptive resources, not a speedup; `both_fail` never rewards faster failure. Missing provider tokens, cost, monotonic time or
critical-path coverage stays unavailable.

The protocol reports the paired vector and uncertainty without a global winner, weighted collaboration score, Pass@k, cross-Lane
ranking or post-hoc estimand change. Holdout membership, arm order/randomization source, exclusions and all raw pairs are retained.

## Consequences

- Team/Solo execution needs a first-class paired manifest rather than inferring treatments from existing team metadata.
- Formal causal claims continue to require dedicated isolation and sufficient pre-registered pairs; a single pair is diagnostic.
- Efficiency becomes outcome-conditioned and evidence-typed. Wall time, tokens, cost, Tool latency and coordination wait can be
  compared only where their own authority and coverage permit.
- Process quality, Tool-use quality, delivery outcome and resources remain separate, which makes trade-offs visible rather than
  hiding them in a total score.
- Role ablation or Tool availability ablation may extend the treatment protocol later, but each requires its own pre-registration and
  cannot be reconstructed after observing results.

## Rejected Alternatives

- **Infer uplift from successful Team Trials:** rejected because no counterfactual outcome is observed.
- **Compare unrelated Team and Solo runs:** rejected because Case, state, model, budget and order drift confound the treatment.
- **Define efficiency as duration per Agent or per call:** rejected because the denominator has no stable quality interpretation.
- **Rank arms with a weighted outcome/process/cost score:** rejected because weights can compensate failure and erase uncertainty.
- **Treat deterministic replay as a counterfactual arm:** rejected because replay validates evidence identity, not an alternative policy.

## References

- [v0.68](../versions/v0.68/README.md)
- [Paired Collaboration Experiment v1](../contracts/paired-collaboration-experiment-v1.md)
- [Benchmark Protocol v3](../contracts/benchmark-protocol-v3.md)
- [ADR-0094](0094-formal-qualification-isolation-and-effect-coverage.md)
- [ADR-0095](0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0151](0151-versioned-benchmark-protocol-and-axis-comparability.md)
- [ADR-0155](0155-treatment-blind-outcome-and-process-judge-views.md)
