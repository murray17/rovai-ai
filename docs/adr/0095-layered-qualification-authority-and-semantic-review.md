---
document_type: adr
id: ADR-0095
title: Layered Qualification Authority and Advisory Semantic Review
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
---

# ADR-0095: Layered Qualification Authority and Advisory Semantic Review

## Context

ADR-0090 makes Verified Delivery and Orchestration Convergence the qualification authority and keeps
collaboration evidence diagnostic. The current Qualification Runner nevertheless includes a
Case-specific `collaborationAudit.passed` in Overall, while the proposed Benchmark expansion adds
requirement detail, Tool evidence, final-response review, and an LLM Judge. Without a single authority
formula, each diagnostic layer can silently become another pass gate or a compensating score.

Orchestration also currently conflates lifecycle settlement with zero human intervention in the
glossary, even though these facts have different causes and evidence sources. Free-text response
accuracy, role relevance, feedback absorption, and implementation quality require semantic judgment
and cannot be promoted to deterministic delivery facts merely because a Judge returns structured
JSON.

## Decision

A scorable Formal Qualification Trial has exactly one **Hard Outcome**. It is `pass` if and only if:

1. every public Delivery Requirement and every sealed delivery Hard Check passes, producing
   `Verified Delivery = pass`;
2. execution responsibilities, budgets, Runtime termination, and external effects satisfy
   `Orchestration Convergence = pass`;
3. `Post-Dispatch Human Intervention = absent` under complete Intervention Coverage.

An invalid or Evaluation-Pending Trial has no pass/fail Hard Outcome. Collaboration, Tool, mutation,
Diagnostic, final-response, and Semantic evidence never fills an unavailable Hard Outcome.

Post-Dispatch Human Intervention is an independent Hard Gate rather than part of Orchestration
Convergence. A mechanically settled Trial with observed human help has Convergence pass and Overall
fail. Conversely, an observation gap produces Evaluation Pending rather than a guessed absence or a
team failure.

Orchestration Convergence is derived from named facts: Run-tree settlement, durable Input
settlement, Approval settlement, budget compliance, Runtime exit, and External Effect Settlement.
A known unfinished responsibility, budget exhaustion, incomplete Runtime exit, or unsettled external
effect makes Convergence fail; an indeterminate required fact makes evaluation pending. Terminal
failed or cancelled Runs do not by themselves fail Convergence after their resulting responsibilities
settle. Recipient completion creates no response, callback, source wake-up, or integration obligation;
any later Member Call is an independent responsibility. Recovery observations are retained as
`failureRecoveryFacts[]` for diagnosis rather than collapsed into an all-Runs-succeeded rule.

All Delivery Requirements are disclosed in the user request or public Case Contract and are Hard
Gates. A Withheld Verification Check may hide implementation and inputs but MUST map to disclosed
Requirement IDs and cannot add an obligation. Non-gating quality observations are Diagnostic Checks,
not “non-critical requirements.” Runner derives Verified Delivery from exact, sealed per-check facts;
neither a verifier summary Boolean nor a participant statement is authoritative.

The sealed Verification Catalog is the completeness authority. A valid Verifier Observation binds
the exact Case Seal and Delivered Workspace Snapshot and reports every expected stable Check ID
exactly once with its category, Requirement references, typed status, and bounded evidence. Logical
check failures still exit successfully and report `failed`; a Hard Check explicitly blocked by an
already failed prerequisite is also a delivery failure. Process non-zero exit, signal, timeout,
malformed schema, missing or duplicate result, unknown Check ID, impossible status, snapshot
mismatch, or internal contradiction makes evaluation pending rather than
`Verified Delivery = fail`. A top-level verifier Boolean, if retained for migration, is ignored.

Formal Autonomous Trials have no hard collaboration participation contract. Required members,
minimum calls, durable delivery settlement, and Task completion may gate a non-scoring
Collaboration Path Calibration, but are evidence only in scored Trials. Route necessity, repeated
information, role selection, and integration quality require Semantic Review. Correctly delivering
without delegation remains a valid team outcome.

The report has five non-compensating layers:

1. Hard Outcome;
2. Delivery Evidence;
3. Collaboration Evidence;
4. Tool and Mutation Evidence;
5. Semantic Engineering Review.

Layer 1 exposes Validity, evaluation state, Verified Delivery, Orchestration Convergence,
Post-Dispatch Human Intervention, and Overall without filling unavailable fields from lower layers.
Layer 2 exposes per-Requirement and per-Check results, build/regression/change-boundary categories,
every Failure Fact plus the deterministic earliest observed hard failure, Delivered Workspace change
facts, and Final Response Evidence. Layer 3 exposes the Run graph, independent Member Call lifecycle,
delivery and terminal facts, routing facts, feedback candidates, and overlap facts without a blended
collaboration score. Layer 4 exposes Tool and Workspace Mutation Ledgers, coverage, authorization,
retry/recovery, effect identity, latency, and typed mutation verification. Layer 5 exposes the frozen
checklist's Replica results, evidence references, confidence, abstentions, disagreements, or
unavailability. No layer computes one mixed quality total.

This layered report does not add a leaderboard, Pass@k, Solo Agent baseline, role ablation, Team
Configuration ranking, statistical-significance claim, or automatic prompt, role, model, permission,
or Tool adaptation from Judge results. Any later comparative or adaptive benchmark requires its own
sealed protocol and cannot reinterpret these Trial outcomes.

Semantic Engineering Review uses only a content-identified, allowlist-built Judge Evidence Pack. It
evaluates a frozen checklist and returns per-item applicability, verdict or abstention, Evidence
References, confidence, and bounded rationale. It produces no aggregate qualification score. Judge
failure, timeout, invalid output, disagreement, or unavailability changes only the Semantic Review
state and never delays, upgrades, or downgrades a complete Hard Outcome. The independently
versioned execution, disagreement, and safety protocol is frozen by ADR-0098 so it can evolve without
changing this authority boundary.

Free-text final-response accuracy, role relevance, handoff clarity, semantic redundancy, feedback
absorption, and Lead integration belong only to Semantic Engineering Review. Objective layers expose
the Lead final response, Member-authored messages, independent calls, Tasks, file mutations, test
execution, verifier facts, and other comparison evidence without claiming semantic causality.

Historical v0.31 and v0.32 Trial outcomes remain immutable under their recorded Runner and schema
identities. New readers may label unavailable later-layer evidence, but MUST NOT recompute or overwrite
their Overall results.

An implementation claiming this boundary MUST prove it with controlled public-demo, Hard-pass,
delivery-failure, convergence-failure, invalid-preflight, Evaluation-Pending, budget-exhaustion, and
human-intervention fixtures, plus Judge complete, abstain, disagreement, and unavailable fixtures.
The same Hard Outcome fixture is evaluated across differing Judge results to prove non-interference,
and private-bundle/Judge-Pack export canaries prove that withheld material has no output path. Release
acceptance concerns evaluator behavior and evidence integrity; it never requires the evaluated team
to achieve a chosen Pass Rate or Semantic verdict distribution.

This decision locally replaces ADR-0090's two-result Overall formula by making Human Intervention a
third independent Hard Gate, removes Human Intervention from the definition of Convergence, and
removes Case-authored “relevant” or “unnecessary” role expectations from objective Formal Trial
judgment. ADR-0090's external delivery verification, fresh product state, raw-repeat reporting,
private evidence, and no-LLM-Hard-authority boundaries remain in force.

## Consequences

- A correct independent Lead delivery can pass even when no other Member runs; collaboration quality
  remains visible without becoming a hidden orchestration script.
- Human help, lifecycle failure, delivery failure, evidence unavailability, and Judge unavailability
  become distinguishable states instead of one Boolean.
- Case authors must publish every normative obligation and maintain a sealed check-to-requirement
  mapping.
- Semantic quality becomes inspectable without claiming that an LLM is an objective correctness
  oracle.
- Reports cannot offer one convenient overall quality score; consumers must read the layer relevant
  to their question.

## Rejected Alternatives

- **Keep collaboration audit in Formal Overall.** Rejected because it measures compliance with a
  prescribed hidden path and penalizes justified non-delegation.
- **Allow non-critical requirements to fail while claiming Verified Delivery.** Rejected because a
  known failed requirement contradicts the delivery claim; non-gating facts are Diagnostic Checks.
- **Let the verifier declare its own delivery Boolean.** Rejected because omitted or contradictory
  check results could pass without exact catalog validation.
- **Use Judge quality to compensate for Hard Outcome failure.** Rejected because subjective semantic
  evidence cannot repair broken behavior, boundaries, or lifecycle settlement.
- **Run Judge before publishing Hard Outcome or block on Judge availability.** Rejected because the
  advisory layer must not control qualification availability.

## References

- [ADR-0090: Team Delivery Qualification Evidence Boundary](0090-team-delivery-qualification-evidence-boundary.md)
- [ADR-0092: Recoverable Qualification Evaluation Integrity](0092-recoverable-qualification-evaluation-integrity.md)
- [ADR-0093: Core-Owned Atomic CampTurn Execution Budgets](0093-core-owned-atomic-campturn-execution-budgets.md)
- [ADR-0094: Formal Qualification Isolation and External Effect Coverage](0094-formal-qualification-isolation-and-effect-coverage.md)
- [ADR-0097: Authority-Preserving Benchmark Evidence Ledgers](0097-authority-preserving-benchmark-evidence-ledgers.md)
- [ADR-0098: Dual-Replica Evidence-Bound Semantic Judge Protocol](0098-dual-replica-evidence-bound-semantic-judge.md)
- [ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics](0099-cost-gated-independent-member-calls.md)
