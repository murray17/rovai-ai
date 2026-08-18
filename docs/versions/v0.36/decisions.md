---
document_type: version-decisions
version: v0.36
lifecycle: historical
last_updated: 2026-08-18
---

# v0.36 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0101](#adr-0101) | Outcome-Only Collaboration-Value Qualification Cases | `accepted` |
| [ADR-0102](#adr-0102) | Immutable Diagnostic Portfolio Authority and Two-Repeat Stability | `accepted` |

<!-- legacy-adr:begin id=ADR-0101 source-file-sha256=d25b52dbe25f96e30ea0858509221b2e2d7c1b83e4834f25978d9624ed4dadb1 -->
<a id="adr-0101"></a>

## ADR-0101: Outcome-Only Collaboration-Value Qualification Cases

迁移时原路径：`docs/adr/0101-outcome-only-collaboration-value-qualification-cases.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0101
title: Outcome-Only Collaboration-Value Qualification Cases
status: accepted
date: 2026-08-04
decision_scope: cross-version
source_version: v0.36
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0101 -->
<a id="adr-0101-context"></a>
### Context

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

<a id="adr-0101-decision"></a>
### Decision

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

<a id="adr-0101-consequences"></a>
### Consequences

- Public obligations are understandable while the starting workspace still requires real delivery work.
- A Case cannot seal with only a happy-path reference and a verifier that rejects trivial syntax errors.
- Collaboration remains observable without scripting Agent activity or reviving ADR-0091 return semantics.
- Case admission becomes slower and requires private reference, verifier, and Mutant maintenance.
- Node and environment drift can invalidate admission instead of being silently normalized.
- Canary scans improve observable leak detection but do not establish same-user filesystem secrecy.

<a id="adr-0101-rejected-alternatives"></a>
### Rejected Alternatives

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

<a id="adr-0101-references"></a>
### References

- [v0.36 Collaboration-Value Diagnostic Portfolio](README.md)
- [ADR-0090: Team Delivery Qualification Evidence Boundary](../v0.31/decisions.md#adr-0090)
- [ADR-0094: Formal Qualification Isolation and External Effect Coverage](../v0.34/decisions.md#adr-0094)
- [ADR-0095: Layered Qualification Authority and Advisory Semantic Review](../v0.34/decisions.md#adr-0095)
- [ADR-0099: Cost-Gated Independent Member Calls](../v0.34/decisions.md#adr-0099)
<!-- legacy-adr-body:end id=ADR-0101 -->
<!-- legacy-adr:end id=ADR-0101 -->

<!-- legacy-adr:begin id=ADR-0102 source-file-sha256=281e555f56d3ec2050e444e4d2c1dc2e31c6a55fecc737f3ade40ee42934cf54 -->
<a id="adr-0102"></a>

## ADR-0102: Immutable Diagnostic Portfolio Authority and Two-Repeat Stability

迁移时原路径：`docs/adr/0102-immutable-diagnostic-portfolio-authority.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0102
title: Immutable Diagnostic Portfolio Authority and Two-Repeat Stability
status: accepted
date: 2026-08-04
decision_scope: cross-version
source_version: v0.36
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0102 -->
<a id="adr-0102-context"></a>
### Context

Qualification Suite is a formal result-set authority with a planned denominator and eventual Pass Rate.
That model is a poor fit for the first high-strength Case portfolio: the goal is to diagnose Case quality,
team delivery behavior, and evidence integrity without ranking a team, selecting a favorable repeat, or
claiming statistical reliability.

A single mutable Portfolio file would also conflate frozen execution identity with evolving Trial state.
Repairing progress after a crash could then silently rewrite the configuration being evaluated or discard
an inconvenient Invalid attempt.

<a id="adr-0102-decision"></a>
### Decision

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

<a id="adr-0102-consequences"></a>
### Consequences

- Portfolio identity cannot drift as Trial state accumulates, and crash recovery does not depend on a
  mutable status file.
- Honest valid failures and repeat disagreement remain visible instead of being replaced by easier Cases
  or a third vote.
- Eight real executions are required even though no aggregate pass statistic is published.
- Frozen Runtime and model configuration can make the Portfolio incomplete when a provider is unavailable.
- Diagnostic completion can coexist with an unstable team observation, while formal promotion remains
  stricter.

<a id="adr-0102-rejected-alternatives"></a>
### Rejected Alternatives

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

<a id="adr-0102-references"></a>
### References

- [v0.36 Collaboration-Value Diagnostic Portfolio](README.md)
- [ADR-0092: Recoverable Qualification Evaluation Integrity](../v0.34/decisions.md#adr-0092)
- [ADR-0093: Core-Owned Atomic CampTurn Execution Budgets](../v0.34/decisions.md#adr-0093)
- [ADR-0095: Layered Qualification Authority and Advisory Semantic Review](../v0.34/decisions.md#adr-0095)
- [ADR-0098: Dual-Replica Evidence-Bound Semantic Judge Protocol](../v0.34/decisions.md#adr-0098)
- [ADR-0101: Outcome-Only Collaboration-Value Qualification Cases](decisions.md#adr-0101)
<!-- legacy-adr-body:end id=ADR-0102 -->
<!-- legacy-adr:end id=ADR-0102 -->
