---
document_type: adr
id: ADR-0101
title: Outcome-Only Collaboration-Value Qualification Cases
status: accepted
date: 2026-08-04
decision_scope: cross-version
source_version: v0.36
supersedes: []
superseded_by: null
---

# ADR-0101: Outcome-Only Collaboration-Value Qualification Cases

## Context

ADR-0090 and ADR-0095 make externally verified delivery the qualification authority and forbid
mechanical collaboration participation gates in scored Trials. The existing schema-v2 Case admission
still assumes every public Check passes on the starting fixture, permits a legacy `collaboration`
contract, and seals a reference implementation without testing whether its withheld verification can
reject plausible incorrect solutions.

Those properties are insufficient for a collaboration-value diagnostic. A public Check that already
passes does not demonstrate missing target behavior. A Case can appear difficult while its verifier
rejects only an obviously broken or non-building implementation. A required Member, Call, Task, or
handoff count can manufacture visible activity without proving that collaboration improved the
delivered workspace.

## Decision

Qualification Case manifest schema v3 is an additive clean-break authoring contract. Readers and
verifiers retain schema-v2 support under its recorded behavior; they do not migrate, rewrite, or
recompute a sealed v2 Case. v0.36 Diagnostic Portfolios admit only v3 Cases.

A v3 Collaboration-Value Qualification Case has exactly six disclosed Delivery Requirements:

1. three independently actionable behavioral Workstreams;
2. one cross-Workstream Integration Invariant;
3. one build and regression requirement; and
4. one Runner-owned delivered change boundary.

Requirements 1 through 4 each have one disclosed Target Public Check that is expected to fail on the
clean fixture and at least one distinct withheld Hard Check mapped to the same Requirement. Requirement
5 has one disclosed Baseline Public Check expected to pass on the clean fixture. Requirement 6 is
observed only by the Runner. A Case therefore has exactly five public Check entries. Every public Check
passes on the admitted reference workspace. Withheld inputs or assertions may vary coverage but cannot
add an undisclosed obligation.

All v3 Cases use the same delivered boundary. Final changes are allowed only below `src/` and
`tests/agent/`. Public tests, fixtures, package metadata, README content, and every other delivered path
remain byte-and-metadata identical. Runner compares independent filesystem trees and does not trust Git
metadata as the sole authority. Agent-authored tests are discovered by the immutable regression command;
their presence or count is not a Hard Gate, but a retained failing test is a regression failure.

The v3 manifest rejects `collaboration` and every legacy required-Member, minimum-Call, minimum-Task,
polling, callback, response-closure, or prescribed-handoff field. The four-Member team is a frozen
execution environment, not a participation requirement. Layer 3 derives only observable collaboration
facts. Necessity, redundancy, feedback absorption, and integration quality remain ADR-0095/0098 Semantic
Review questions and may be indeterminate or unavailable.

Before sealing, admission materializes the clean fixture, reference implementation, and every Challenge
Mutant twice in fresh directories. It requires exact deterministic Check outcomes, a passing reference,
and at least three independently motivated Mutants:

- public-test overfitting;
- a domain-specific edge or state omission; and
- a regression or delivered-boundary violation.

Every Mutant must let the verifier complete normally, fail exactly its declared Check IDs, and pass all
other Hard Checks. At least one passes all five public Checks but fails withheld verification. The
regression-or-boundary Mutant passes Requirements 1 through 4 and fails only Requirement 5 or 6. Extra
Mutants do not create a score or Case weight.

Public Checks, withheld verification, and Mutant admission use a versioned Hermetic Verification
Profile: the frozen Node executable is invoked directly without a shell under an allowlisted UTC/C
environment and isolated HOME/TMP; the delivered tree is read-only; only a per-Check temporary directory
is writable; and network, child process, addon, FFI, WASI, and inspector access are denied. Fixed timeouts,
output caps, serial public test execution, and before/after tree identity are mandatory. Case APIs that
need clocks, IDs, or randomness expose deterministic injection rather than consuming ambient values.

The scored private Pack remains outside Git, Trial workspaces, and Evidence Roots with current-user-only
permissions and no symlinked Pack root. Reference, verifier, Challenge Manifest, and each Mutant carry
unique private canaries. A fail-closed post-Trial scan checks delivered files and all retained or exported
artifacts for canaries, Pack paths and basenames, forbidden fields, and credentials. A match is retained
as an irrecoverable evidence-integrity finding; cleanup cannot authorize a replacement run. A clean scan
proves only absence from observed outputs and does not replace ADR-0094 Formal Isolation.

Case Seal v3 binds the manifest, fixture, prompt, verifier, requirements, Verification Catalog, public
Check expectations, boundary, toolchain profile, Challenge Manifest, all Mutant observations, reference
evidence, and non-leakage policy. Any correction creates a new Case version and Seal.

## Consequences

- Public obligations are understandable while the starting workspace still requires real delivery work.
- A Case cannot seal with only a happy-path reference and a verifier that rejects trivial syntax errors.
- Collaboration remains observable without scripting Agent activity or reviving ADR-0091 return semantics.
- Case admission becomes slower and requires private reference, verifier, and Mutant maintenance.
- Node and environment drift can invalidate admission instead of being silently normalized.
- Canary scans improve observable leak detection but do not establish same-user filesystem secrecy.

## Rejected Alternatives

- **Require a minimum number of Members or Calls.** Rejected because activity can be manufactured and
  is not delivery correctness or proof of collaboration value.
- **Keep all public Checks passing initially.** Rejected because the public contract would not
  demonstrate that the disclosed target behavior is missing.
- **Seal after reference pass only.** Rejected because it does not establish verifier discrimination.
- **Accept compile-error Mutants.** Rejected because globally broken workspaces do not challenge the
  semantic precision of public and withheld Checks.
- **Put scored Cases in Git for reproducibility.** Rejected because it destroys the sealed first-use
  boundary; public identities and digests provide the non-leaking reproducibility surface.
- **Treat a clean canary scan as Formal Isolation.** Rejected because an unobserved same-user read can
  occur without copying private material into a retained output.

## References

- [v0.36 Collaboration-Value Diagnostic Portfolio](../versions/v0.36/README.md)
- [ADR-0090: Team Delivery Qualification Evidence Boundary](0090-team-delivery-qualification-evidence-boundary.md)
- [ADR-0094: Formal Qualification Isolation and External Effect Coverage](0094-formal-qualification-isolation-and-effect-coverage.md)
- [ADR-0095: Layered Qualification Authority and Advisory Semantic Review](0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0099: Cost-Gated Independent Member Calls](0099-cost-gated-independent-member-calls.md)
