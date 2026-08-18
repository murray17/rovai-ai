---
document_type: version-decisions
version: v0.34
lifecycle: historical
last_updated: 2026-08-18
---

# v0.34 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0092](#adr-0092) | Recoverable Qualification Evaluation Integrity | `accepted` |
| [ADR-0093](#adr-0093) | Core-Owned Atomic CampTurn Execution Budgets | `accepted` |
| [ADR-0094](#adr-0094) | Formal Qualification Isolation and External Effect Coverage | `accepted` |
| [ADR-0095](#adr-0095) | Layered Qualification Authority and Advisory Semantic Review | `accepted` |
| [ADR-0097](#adr-0097) | Authority-Preserving Benchmark Evidence Ledgers | `accepted` |
| [ADR-0098](#adr-0098) | Dual-Replica Evidence-Bound Semantic Judge Protocol | `accepted` |
| [ADR-0099](#adr-0099) | Cost-Gated Independent Member Calls Without Return Semantics | `superseded` |

<!-- legacy-adr:begin id=ADR-0092 source-file-sha256=58f480dd9ed18aa364d9acd3c9ef4b5c1f87911f0ec3dcdb597474b8370ce632 -->
<a id="adr-0092"></a>

## ADR-0092: Recoverable Qualification Evaluation Integrity

迁移时原路径：`docs/adr/0092-recoverable-qualification-evaluation-integrity.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0092
title: Recoverable Qualification Evaluation Integrity
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0092 -->
<a id="adr-0092-context"></a>
### Context

ADR-0090 makes accepted task dispatch the boundary after which Runtime, permission, tool,
coordination, timeout, and recovery failures are valid failures of the evaluated team. That rule
prevents a harness from discarding inconvenient outcomes. It does not, however, safely classify a
post-terminal verifier crash, invalid verifier result, Runner evaluation failure, or loss of evidence
needed to establish the result.

Counting an evaluator defect as a team failure measures the harness rather than the Qualification
Team Configuration. Re-running the team after seeing the delivered workspace creates a stronger
selection bias: the harness can keep an execution only when evaluation succeeds or the result is
favorable. Qualification therefore needs a recoverable evaluation state that preserves the original
execution without granting authority to replay it.

<a id="adr-0092-decision"></a>
### Decision

Accepted task dispatch remains an irreversible evaluation boundary. Every subject-side Runtime,
permission, authorization, tool, workspace, delivery, coordination, budget, timeout, termination,
and autonomous recovery failure after that boundary is a valid observable outcome of the frozen
Qualification Team Configuration.

Before external verification, the Runner MUST complete a Delivered Workspace Freeze Barrier. Core
fences the CampTurn against new Runs and mutation; every Trial workspace writer terminates; the
Intervention Isolation Profile remains complete; and Runner-managed projections are separated from
the delivered file set. A live tree scan while a Runtime may still write is not a final artifact. A
barrier or Hard Outcome coverage failure initially makes the accepted execution Evaluation Pending;
if the missing interval or identity cannot be recovered without reconstruction, the retained Trial
then becomes Invalid rather than a team failure.

The Runner then retains a content-identified, immutable Delivered Workspace Snapshot and the
authoritative evidence needed to evaluate it. Workspace diff, verification, private evidence, and
every evaluation recovery attempt MUST consume that same snapshot digest rather than independent
copies of the live Run Workspace. Evaluation identity MUST bind the Trial, Case Seal, delivered-
workspace digest, verifier digest, verifier configuration, and result schema version.

A verifier non-zero exit, signal, timeout, malformed or incomplete result, Runner evaluation error,
or detected evidence-integrity gap MUST NOT be converted to `verifiedDelivery=false`. The accepted
execution becomes an **Evaluation-Pending Qualification Trial**. It is neither pass nor fail, is
excluded from every Pass Rate denominator, and keeps its Suite incomplete.

Trial reporting keeps three axes separate: `validity = valid | invalid`, `evaluationState = pending |
complete`, and `hardOutcome = unavailable | pass | fail`. Invalid or pending Trials have
`hardOutcome = unavailable`; only a valid, complete evaluation may expose pass or fail. Partial Hard
facts may remain visible as evidence while Overall is unavailable, but they are never a provisional
outcome.

Only evaluation may resume. If the Delivered Workspace Snapshot already exists, a recovery attempt
MUST use that exact snapshot, Case Seal, verifier digest, configuration, and result schema. If the
barrier was interrupted first, Runner may finish it only against the same fenced execution and
continuous isolation evidence. Recovery MUST NOT re-dispatch the request, resume an AgentRun, allow
a workspace writer, mutate the delivered files, or create a replacement team execution. Every
evaluation attempt and its outcome remains append-only evidence.

If trustworthy evaluation requires changing the verifier, Case Seal, delivered workspace, or other
sealed evaluation identity, the original execution becomes an **Invalid Qualification Trial** with
an explicit retained reason. The corrected verifier creates a new Qualification Case version and
Seal; it cannot retroactively score the old execution. Missing or corrupt authoritative outcome
evidence has the same invalidating effect.

A Suite may publish progress counts while any Trial is invalid or Evaluation-Pending, but MUST NOT
publish a final Pass Rate until every planned Formal Qualification Trial has a trusted pass or fail
under the Suite's frozen identities. An Evaluation-Pending slot blocks the Suite and permits no new
team execution. A pre-dispatch Invalid attempt may be replacement-linked to the same planned slot
only when every frozen identity remains byte-for-byte unchanged and no subject execution was
accepted.

An accepted execution that later becomes irrecoverably Invalid permanently leaves that Suite without
a Pass Rate; replacing only the observed execution would create outcome-selection bias. Any material
Case, verifier, Runner, environment, or team-configuration correction likewise requires a new Suite
identity and complete new planned set rather than a replacement inside the old Suite. Calibration and
invalid attempts never enter a denominator. Once every planned Formal slot in one unchanged Suite is
scorable, `Pass Rate = passing planned Formal slots / total planned Formal slots`; permitted
pre-dispatch replacement links do not add or remove a slot.

This decision locally replaces ADR-0090 only where that ADR limits invalidity to pre-dispatch
failures. ADR-0090's rule that post-dispatch subject-side failures remain valid failures is preserved.

<a id="adr-0092-consequences"></a>
### Consequences

- Evaluator defects no longer lower a team's delivery result.
- The harness cannot improve results by replaying the team after observing an execution.
- Formal evidence storage must retain the complete delivered workspace and evaluation identities,
  not only a workspace diff or a transient verifier copy.
- Final workspace capture must wait for a proven writer-free barrier and make managed Runtime
  projections explicit; this adds termination and snapshot coordination before verification.
- Verifier recovery becomes deterministic and auditable, but may leave a Suite without a final Pass
  Rate until evaluation succeeds or the affected Case is versioned again.
- An irrecoverable post-dispatch evaluation defect invalidates the entire Suite's final rate rather
  than permitting selective per-case reruns.
- Changing a verifier after a sealed execution is intentionally expensive because prior executions
  cannot be rescored under the new contract.

<a id="adr-0092-rejected-alternatives"></a>
### Rejected Alternatives

- **Count every post-dispatch verifier failure as `verifiedDelivery=false`.** Rejected because it
  attributes evaluator reliability to the Qualification Team Configuration.
- **Re-run the team when verification fails.** Rejected because observed outcomes would influence
  which execution enters the denominator.
- **Apply a repaired verifier retrospectively to the old workspace.** Rejected because changing the
  sealed evaluation contract after observing an execution permits outcome-dependent scoring.
- **Publish a Pass Rate from only the completed subset.** Rejected because the denominator would
  depend on execution and evaluator availability rather than the frozen Suite plan.

<a id="adr-0092-references"></a>
### References

- [ADR-0090: Team Delivery Qualification Evidence Boundary](../v0.31/decisions.md#adr-0090)
- [Qualification Runner](../../../scripts/qualification-runner.mjs)
- [Qualification Suite Runner](../../../scripts/qualification-suite.mjs)
<!-- legacy-adr-body:end id=ADR-0092 -->
<!-- legacy-adr:end id=ADR-0092 -->

<!-- legacy-adr:begin id=ADR-0093 source-file-sha256=a09ea9ceaeafda9be0d91a3674130d6654b35b663d96f8cfbd3624462a0de9a7 -->
<a id="adr-0093"></a>

## ADR-0093: Core-Owned Atomic CampTurn Execution Budgets

迁移时原路径：`docs/adr/0093-core-owned-atomic-campturn-execution-budgets.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0093
title: Core-Owned Atomic CampTurn Execution Budgets
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0093 -->
> [ADR-0099](decisions.md#adr-0099) replaces only this ADR's return-slot
> reservation clauses. Every accepted Member Call now allocates exactly one A2A Run slot; the
> remaining atomic budget authority continues unchanged.

<a id="adr-0093-context"></a>
### Context

The Qualification Runner currently observes Camp Snapshots periodically and requests cancellation
after counts exceed a Case budget. Observation cannot reject an admission transaction. Concurrent
Member Calls can both commit before the next Snapshot, and a Core restart can accidentally extend an
elapsed allowance if time is represented only by one process's timer.

Benchmark-only counters inside the Runner therefore cannot establish a strict execution budget.
Moving Qualification entities into Core would violate the existing boundary that Trial, Case, and
qualification outcome belong to the external evaluation domain. Rovai needs a general CampTurn
execution-safety contract that the formal Runner can configure without teaching Core about a
Benchmark.

<a id="adr-0093-decision"></a>
### Decision

The public initial execution dispatch MAY supply a `CampTurn Execution Budget`. Core freezes the
effective budget in the same transaction that admits the CampTurn and its root AgentRun. Ordinary
product execution uses Core defaults. A requested value cannot weaken a stricter product safety
maximum.

The frozen budget contains these independent ceilings:

- elapsed time, represented by dispatch `acceptedAt` and an absolute `deadlineAt`;
- total AgentRun responsibility, counting the root Run plus one future A2A Run slot for every
  accepted Member Call;
- accepted A2A, counting only new canonical Member Call acceptance receipts.

AgentRun capacity is allocated before responsibility is accepted. Every Member Call counts exactly
one callee Run slot. A later call in any direction is another independent acceptance and consumes
another slot. Materialization, dispatch, Runtime retry, or Core restart does not count the same
accepted responsibility again.

Core first authenticates the caller and validates the command/idempotency envelope, then resolves the
canonical idempotency identity. A same-actor, same-payload replay of an accepted command returns its
original receipt even if the Turn was later fenced, without revalidating current capacity, consuming
capacity, or creating another effect. An identity collision remains an error. Only a novel request
continues through schema, target, current fence, and authorization validation before Core evaluates
the frozen budget. Invalid and unauthorized requests remain ordinary Tool denials. Only a novel
request that would otherwise be accepted can exhaust a count budget.

Such a request atomically records `Budget Exhaustion`, rejects the new responsibility without an
InboxMessage, Conversation Input, AgentRun, or other partial business side effect,
and fences the CampTurn against further execution. Budget Exhaustion is a terminal valid execution
failure; later delivery success cannot recover qualification within that Trial.

Core uses a monotonic timer while the original process remains alive. The persisted absolute
deadline is authoritative across Core recovery and never resets. When the deadline is reached, Core
records Budget Exhaustion and fences new Runs, Tool mutations, and recovery execution. A separate,
bounded termination-and-evidence grace period may stop processes and capture facts but cannot change
the budget result.

The Qualification Runner supplies the Case projection through the public dispatch contract and uses
the same frozen deadline as an independent watchdog. A material disagreement between Core and Runner
deadline observations, or a system-clock discontinuity outside the frozen tolerance, is evaluation
integrity loss rather than a selectable outcome; the Trial becomes Evaluation Pending.

Core emits authoritative budget configuration, allocation, acceptance, exhaustion, fencing, and
terminal facts. Runner snapshots remain evidence consumers and watchdogs, not admission authority.

This decision refines ADR-0099's fixed A2A Run-slot safety maximum with a frozen per-CampTurn
effective budget. It does not add Trial, Case, verifier, Pass Rate, or qualification status to Core.

<a id="adr-0093-consequences"></a>
### Consequences

- Concurrent Agent activity cannot commit responsibility beyond the effective budget.
- Formal Qualification and ordinary product safety share one atomic execution contract without
  sharing Benchmark outcome state.
- CampTurn persistence, initial dispatch, Member Call admission, recovery, scheduling, termination,
  Read Side evidence, and public contracts all require coordinated changes.
- Every accepted Member Call consumes one prospective slot, making budget use conservative and
  deterministic even when the eventual Run is cancelled before materialization.
- Core restart cannot create extra execution time, while clock disagreement fails evaluation closed
  instead of choosing the more favorable observer.
- An Agent cannot recover inside the same Trial after first attempting an otherwise valid operation
  beyond the frozen budget.

<a id="adr-0093-rejected-alternatives"></a>
### Rejected Alternatives

- **Let the Runner stop a Trial after observing excess.** Rejected because periodic observation is
  not atomic with concurrent Core acceptance.
- **Keep a separate Benchmark quota implementation in Core.** Rejected because qualification entities
  and outcomes do not belong to the product execution domain.
- **Reject an over-budget Tool call but let the Turn continue.** Rejected because that treats the
  budget as side-effect capacity rather than a qualification constraint and permits unbounded denied
  attempts.
- **Count actual materialized Runs instead of accepted responsibility.** Rejected because pending
  accepted Inputs could overcommit future execution.
- **Reset elapsed time after Core restart.** Rejected because product recovery would silently grant a
  different Case budget.

<a id="adr-0093-references"></a>
### References

- [ADR-0090: Team Delivery Qualification Evidence Boundary](../v0.31/decisions.md#adr-0090)
- [ADR-0091: Durable Member Calls and Single-Slot A2A Resume Scheduling](../v0.32/decisions.md#adr-0091)
- [ADR-0092: Recoverable Qualification Evaluation Integrity](decisions.md#adr-0092)
- [ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics](decisions.md#adr-0099)
- [Qualification Runner](../../../scripts/qualification-runner.mjs)
<!-- legacy-adr-body:end id=ADR-0093 -->
<!-- legacy-adr:end id=ADR-0093 -->

<!-- legacy-adr:begin id=ADR-0094 source-file-sha256=5ea1512650d3ab33268424ed98a5e6f2bc4e4d30f3bc47b12ae7a14a8ecc070a -->
<a id="adr-0094"></a>

## ADR-0094: Formal Qualification Isolation and External Effect Coverage

迁移时原路径：`docs/adr/0094-formal-qualification-isolation-and-effect-coverage.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0094
title: Formal Qualification Isolation and External Effect Coverage
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0094 -->
<a id="adr-0094-context"></a>
### Context

ADR-0090 permits formal evaluation on a real host with recorded network access and
`preserved_uncontrolled` ambient MCP state. The current Runner can detect Core user messages and
resolved approvals, compare workspace trees, and inspect portions of Runtime execution evidence. It
cannot attribute every filesystem write to a process, prove that a shared-user editor did not mutate
the workspace, or determine the terminal identity of arbitrary shell, network, Git remote, or ambient
MCP effects.

Treating “no recorded event” as zero human intervention or settled external effects would turn an
observation gap into a favorable result. A formal Hard Pass needs an environment contract that can
establish absence and settlement without claiming that non-adversarial Qualification is a general
security sandbox.

<a id="adr-0094-decision"></a>
### Decision

Every Formal Qualification Trial MUST bind a versioned, digested Intervention Isolation Profile in
its Qualification Environment Manifest. The Profile covers the complete post-dispatch interval and
defines authority for Core commands, approvals, configuration, Runtime lifecycle, workspace writers,
process ancestry, network access, Git remotes, external tools, and observation continuity.

The formal baseline is isolation-first: a disposable VM, dedicated host session, or dedicated
non-interactive OS execution identity owns the private Core control interface and Trial workspace.
No editor, interactive shell, second Runner, or unrelated writable process may share the identity or
workspace after dispatch. The Runner freezes allowed Core and Runtime process roots and verifies
their descendants through the Delivered Workspace Freeze Barrier. A GUI Runtime qualifies only when
its dedicated graphical session satisfies the same Profile.

The Profile also freezes authorized Runner automation: passive observation, deadline watchdog,
evidence capture, fencing, and bounded post-terminal cleanup are evaluator actions rather than human
intervention. Product-owned Core recovery and predeclared Runtime retry are subject execution facts,
not human intervention. An operator initiating, approving, editing, restarting, reconfiguring, or
continuing any of them after dispatch is intervention.

A shared login identity, operator promise, start/end tree diff, best-effort watcher, or temporal
correlation with Runtime Tool events cannot establish complete Intervention Coverage. Such an
environment may produce diagnostic evidence but not a Formal Trial Pass Rate.

Post-Dispatch Human Intervention is `absent | present | indeterminate`:

- `absent` requires complete Profile coverage and no intervention fact;
- `present` is an observed human message, approval decision, configuration or workspace mutation,
  continuation, Runtime control, or other covered intervention and is a valid Hard Outcome failure;
- `indeterminate` is any required observation gap and makes the Trial Evaluation Pending rather than
  failing the Qualification Team Configuration.

The Profile MUST be admitted completely before dispatch; a known preflight coverage gap makes the
attempt Invalid without running the team. Unexpected post-dispatch loss of required coverage first
makes the accepted execution Evaluation Pending. If the lost interval cannot be recovered under the
same frozen identities, ADR-0092's retained Invalid transition applies instead of assigning a failure
to the team.

External Effect Settlement is `settled | unsettled | indeterminate`:

- `settled` requires potential external mutation channels to be disabled or every accepted mutation
  to have a correlated side-effect identity and terminal receipt;
- `unsettled` means an observed mutation began or was accepted without a known terminal or compensated
  state and fails Orchestration Convergence;
- `indeterminate` means a mutation-capable channel lacks complete observation and makes evaluation
  pending.

Formal profiles therefore block unaudited write-capable network traffic and Git remote mutation.
Read-only package access uses a frozen allowlist or controlled cache. External MCP mutation is allowed
only through a ledgered authorization and receipt path with side-effect identity. A
`preserved_uncontrolled` ambient MCP environment is diagnostic-only.

Isolation establishes an evidence boundary, not resistance to a privileged malicious operator. The
Profile, account/session identities, writable roots, network policy, process observations, coverage
gaps, and effect receipts remain private evidence with a safe redacted summary.

This decision locally replaces ADR-0090's permission for preserved uncontrolled ambient tools and
ordinary shared-host operation to participate in future Formal Trial evidence. It does not reclassify
or recompute the immutable v0.31 or v0.32 historical Trials.

<a id="adr-0094-consequences"></a>
### Consequences

- A formal “zero human intervention” claim now requires positive coverage evidence rather than lack
  of a recorded Core event.
- Existing mixed-user local workflows and uncontrolled ambient MCP configurations become diagnostic
  until an isolation profile is implemented and admitted.
- GUI Runtime qualification may require a dedicated graphical host/session and can lag CLI Runtime
  diagnostics.
- Network and external Tool setup becomes more expensive, particularly for package caches,
  authorization receipts, and mutable MCP integrations.
- Observation failure no longer lowers a team score, while an observed unsettled effect remains a
  real convergence failure.

<a id="adr-0094-rejected-alternatives"></a>
### Rejected Alternatives

- **Infer human absence from Core messages and approvals alone.** Rejected because same-user
  workspace, configuration, shell, and Runtime interventions remain invisible.
- **Correlate file changes with Runtime Tool timestamps.** Rejected because correlation is neither
  complete writer identity nor proof that another process did not write.
- **Allow uncontrolled network and ambient MCP while reporting settlement.** Rejected because remote
  mutations may have no observable identity or terminal receipt.
- **Treat coverage gaps as team failures.** Rejected because harness observability is not a property
  of the Qualification Team Configuration.
- **Retroactively invalidate earlier Qualification results.** Rejected because historical Trial
  semantics and evidence identities remain immutable.

<a id="adr-0094-references"></a>
### References

- [ADR-0062: Interruptible Run Trees and Unsettled External Effects](../v0.17/decisions.md#adr-0062)
- [ADR-0090: Team Delivery Qualification Evidence Boundary](../v0.31/decisions.md#adr-0090)
- [ADR-0092: Recoverable Qualification Evaluation Integrity](decisions.md#adr-0092)
<!-- legacy-adr-body:end id=ADR-0094 -->
<!-- legacy-adr:end id=ADR-0094 -->

<!-- legacy-adr:begin id=ADR-0095 source-file-sha256=569c9cea42b93a93a8afff639b89d1bb9227d70f2c494f3184a5a336c65b1847 -->
<a id="adr-0095"></a>

## ADR-0095: Layered Qualification Authority and Advisory Semantic Review

迁移时原路径：`docs/adr/0095-layered-qualification-authority-and-semantic-review.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0095
title: Layered Qualification Authority and Advisory Semantic Review
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0095 -->
<a id="adr-0095-context"></a>
### Context

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

<a id="adr-0095-decision"></a>
### Decision

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

<a id="adr-0095-consequences"></a>
### Consequences

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

<a id="adr-0095-rejected-alternatives"></a>
### Rejected Alternatives

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

<a id="adr-0095-references"></a>
### References

- [ADR-0090: Team Delivery Qualification Evidence Boundary](../v0.31/decisions.md#adr-0090)
- [ADR-0092: Recoverable Qualification Evaluation Integrity](decisions.md#adr-0092)
- [ADR-0093: Core-Owned Atomic CampTurn Execution Budgets](decisions.md#adr-0093)
- [ADR-0094: Formal Qualification Isolation and External Effect Coverage](decisions.md#adr-0094)
- [ADR-0097: Authority-Preserving Benchmark Evidence Ledgers](decisions.md#adr-0097)
- [ADR-0098: Dual-Replica Evidence-Bound Semantic Judge Protocol](decisions.md#adr-0098)
- [ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics](decisions.md#adr-0099)
<!-- legacy-adr-body:end id=ADR-0095 -->
<!-- legacy-adr:end id=ADR-0095 -->

<!-- legacy-adr:begin id=ADR-0097 source-file-sha256=b87546e130018bf4a650726dbee0236b151060286f3d6121785668a7eb74c10c -->
<a id="adr-0097"></a>

## ADR-0097: Authority-Preserving Benchmark Evidence Ledgers

迁移时原路径：`docs/adr/0097-authority-preserving-benchmark-evidence-ledgers.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0097
title: Authority-Preserving Benchmark Evidence Ledgers
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0097 -->
> [ADR-0099](decisions.md#adr-0099) replaces only this ADR's Return
> Obligation, Core Outcome, explicit-return, source-consumption, and Response Closure clauses.
> Independent Member Call lifecycle and evidence-authority decisions continue unchanged.

<a id="adr-0097-context"></a>
### Context

Qualification evidence currently combines periodic Camp Snapshots, bounded execution evidence,
workspace tree diffs, verifier summaries, and a derived collaboration matrix. Core-mediated Team
Tools have authoritative authorization, idempotency, and receipt facts. Shell, file, Git, test,
build, and external MCP activity may instead arrive as adapter-specific Runtime telemetry with
partial identity, timing, arguments, or completion status.

A “unified Tool Call Ledger” can improve diagnosis only if it preserves these authority differences.
Flattening every event into a complete-looking record would turn missing Runtime telemetry into
negative facts, conflate a Tool exit with an external side-effect receipt, and make semantic guesses
about feedback or causality appear objective.

<a id="adr-0097-decision"></a>
### Decision

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

<a id="adr-0097-consequences"></a>
### Consequences

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

<a id="adr-0097-rejected-alternatives"></a>
### Rejected Alternatives

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

<a id="adr-0097-references"></a>
### References

- [ADR-0061: Durable Agent-Inaccessible Execution Evidence](../v0.17/decisions.md#adr-0061)
- [ADR-0090: Team Delivery Qualification Evidence Boundary](../v0.31/decisions.md#adr-0090)
- [ADR-0091: Durable Member Calls and Single-Slot A2A Resume Scheduling](../v0.32/decisions.md#adr-0091)
- [ADR-0094: Formal Qualification Isolation and External Effect Coverage](decisions.md#adr-0094)
- [ADR-0095: Layered Qualification Authority and Advisory Semantic Review](decisions.md#adr-0095)
- [ADR-0098: Dual-Replica Evidence-Bound Semantic Judge Protocol](decisions.md#adr-0098)
- [ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics](decisions.md#adr-0099)
<!-- legacy-adr-body:end id=ADR-0097 -->
<!-- legacy-adr:end id=ADR-0097 -->

<!-- legacy-adr:begin id=ADR-0098 source-file-sha256=2371868dc8aa29904409c3e7a84faaad277c0993e20494e3dbe719e9c5f87afd -->
<a id="adr-0098"></a>

## ADR-0098: Dual-Replica Evidence-Bound Semantic Judge Protocol

迁移时原路径：`docs/adr/0098-dual-replica-evidence-bound-semantic-judge.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0098
title: Dual-Replica Evidence-Bound Semantic Judge Protocol
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0098 -->
<a id="adr-0098-context"></a>
### Context

ADR-0095 makes Semantic Engineering Review advisory and forbids it from changing Hard Outcome. That
authority boundary does not make an LLM Judge reliable by itself. Published evaluations show prompt
and order sensitivity, inconsistent constraint-level judgments, systematic reactions to superficial
code changes, and susceptibility to prompt injection. One apparently precise score would hide those
failure modes, while free retries or majority voting could select a favorable result after observing
it.

The Judge also consumes participant-authored messages, code, comments, and final responses. Those
inputs may contain credentials, private locators, irrelevant volume, or instructions aimed at the
evaluator. A formal Semantic Review therefore needs a frozen evidence, invocation, validation, and
disagreement protocol rather than a model name plus a prompt string.

<a id="adr-0098-decision"></a>
### Decision

Semantic Engineering Review consumes only one content-identified Judge Evidence Pack built by an
allowlist projection. The Pack contains public Case obligations, pseudonymous Member and declared
role facts, Delivered Workspace changes and bounded code context, objective verification facts,
collaboration lifecycles, Tool and mutation evidence, and Final Response Evidence. It omits the
computed Hard Outcome and participant model/provider identities to reduce anchoring and
self-preference. Hidden reasoning, credentials, environment values, Runtime-private logs, complete
Withheld Verifier details, reference implementations, raw private source objects, and Sealed Pack
locators have no Pack field.

Participant messages, repository text, code comments, and final responses are explicitly delimited
as untrusted evidence, never instructions. Judge execution has no Tool or network access. Pack
construction records per-item Evidence Coverage and never silently truncates dimension-critical
evidence: a coverage gap forces an item to abstain or makes the Review unavailable. Pack and export
builders use allowlist serialization, secret canaries, and schema validation rather than redacting a
raw Qualification Evidence Bundle after serialization.

The Pack preserves communication visibility and edge identity. Private Member Call content,
recipient Input, recipient public CampMessage, and any later independent Call remain distinct facts;
they are never flattened into a shared transcript that implies the source observed a recipient's
output. The Judge may inspect those facts as evaluator evidence but MUST assess participant knowledge
and integration only from the visibility and later-action references the Pack establishes.

The initial checklist freezes these stable items:

- `SER.requirements.understanding`;
- `SER.design.solution_fit`;
- `SER.implementation.quality`;
- `SER.testing.strategy`;
- `SER.scope.discipline`;
- `SER.collaboration.delegation`;
- `SER.collaboration.handoff_clarity`;
- `SER.collaboration.feedback_absorption`;
- `SER.collaboration.lead_integration`;
- `SER.response.claim_accuracy`;
- `SER.response.limitations`.

The response items compare claims and disclosed limits with evidence; they do not infer a
participant's private intent. Checklist evolution versions the Semantic Judge Configuration and
never rewrites an earlier Review.

`SER.collaboration.delegation` applies ADR-0099's send gate to each independent Call: whether the
target needed the message to continue acting or decide, had a clear next action, or was waiting for a
necessary result. Acknowledgement-only, courtesy, non-blocking progress, and repeated-information
Calls are adverse semantic evidence. `SER.collaboration.handoff_clarity` evaluates whether the
authored content made that action or decision clear. Missing evidence yields `indeterminate`; the
absence of a later call to the source is never itself a defect or an unanswered-response finding.

Each item returns exactly one categorical verdict from `satisfied`, `partially_satisfied`,
`not_satisfied`, `indeterminate`, or `not_applicable`; a categorical `low | medium | high`
self-reported confidence; validated Evidence References; and a bounded reason. Indeterminate and
not-applicable verdicts require a typed reason. Confidence is diagnostic rather than a calibrated
probability and never changes the verdict. There is no item weighting, dimension total, or aggregate
Semantic score.

The v0.34 Semantic Judge Configuration requires exactly two independent, tool-disabled Judge
Replicas over the same Pack. It freezes an immutable model snapshot rather than a moving alias;
replica prompt templates and counterbalanced checklist presentation order; checklist rubric;
decoding parameters and provider seed when available; Pack and output schemas; redaction policy;
transport retry schedule; Evidence Reference validation; and reconciliation rules. Both Replicas use
the same model snapshot and semantic rubric, then reconcile by stable item ID. They are sensitivity
probes, not a heterogeneous model committee. An unidentifiable moving model endpoint is inadmissible
for comparable Semantic Reviews.

A valid Replica result is never retried for selection. A transport retry is allowed only when the
predeclared schedule applies, and every attempt remains append-only evidence. The Review is
`complete` only when both Replicas and every required item validate. Any categorical verdict mismatch
produces `disagreement` at the affected item and preserves both results without tolerance merging,
averaging, voting, tie-breaking, or selecting the favorable result. Confidence differences alone are
retained diagnostics. If either required Replica remains missing, times out, fails schema or Evidence
Reference validation, or cannot consume a complete Pack, the Review is `unavailable`; a surviving
observation may be retained privately but is not the Review result. None of these states affects Hard
Outcome availability or value.

Judge acceptance includes success, abstention, unavailable, and disagreement fixtures plus prompt-
injection attempts, evidence-order perturbations, secret canaries, invalid Evidence References,
malformed outputs, transport failure, and semantically equivalent code transformations. These cases
validate protocol behavior; they do not claim that the Judge is objectively correct on open-ended
engineering quality.

The collaboration fixture set includes three visibility-preserving cases: self-contained recipient
work with no later Call, a necessary result Call that gives its target a required next action, and an
acknowledgement-only Call after completion. The protocol never penalizes the first as a missing
response, lets the checklist evaluate the second for clarity and integration, and treats the third as
adverse Call Necessity evidence unless the Pack requires abstention.

<a id="adr-0098-consequences"></a>
### Consequences

- Two frozen Replicas increase latency and cost, but expose instability that one score would hide.
- Moving model aliases and providers that cannot identify the evaluated revision may still support
  local experiments, but their results are not comparable Formal Semantic Reviews.
- Some checklist items legitimately abstain when the Pack lacks sufficient safe evidence.
- Judge prompt, rubric, model, decoding, Pack schema, redaction, or reconciliation changes create a
  new Configuration digest without changing historical results or Hard Outcome.
- Prompt-injection defenses remain measurable protocol controls rather than a claim that arbitrary
  untrusted content is harmless.

<a id="adr-0098-rejected-alternatives"></a>
### Rejected Alternatives

- **One Judge call and one overall score.** Rejected because it hides item-specific uncertainty,
  prompt sensitivity, and code-surface bias.
- **Majority voting or a heterogeneous model committee.** Rejected for this version because it
  manufactures a winner without proving checklist correctness and adds a new model-comparison
  problem.
- **Retry valid outputs until they agree.** Rejected because it permits outcome selection after the
  verdicts are visible.
- **Send the private Evidence Bundle directly to the Judge.** Rejected because least disclosure,
  injection boundaries, and per-item coverage cannot be established from a raw archive.
- **Show the Judge Hard Outcome or participant model identity.** Rejected because they can anchor the
  advisory review without adding evidence about the semantic checklist item.

<a id="adr-0098-references"></a>
### References

- [ADR-0095: Layered Qualification Authority and Advisory Semantic Review](decisions.md#adr-0095)
- [ADR-0097: Authority-Preserving Benchmark Evidence Ledgers](decisions.md#adr-0097)
- [ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics](decisions.md#adr-0099)
- [JudgeSense: A Benchmark for Prompt Sensitivity in LLM-as-a-Judge Systems](https://arxiv.org/abs/2604.23478)
- [MCJudgeBench: A Benchmark for Constraint-Level Judge Evaluation in Multi-Constraint Instruction Following](https://arxiv.org/abs/2605.03858)
- [Don't Judge Code by Its Cover: Exploring Biases in LLM Judges for Code Evaluation](https://arxiv.org/abs/2505.16222)
- [Adversarial Attacks on LLM-as-a-Judge Systems: Insights from Prompt Injections](https://arxiv.org/abs/2504.18333)
<!-- legacy-adr-body:end id=ADR-0098 -->
<!-- legacy-adr:end id=ADR-0098 -->

<!-- legacy-adr:begin id=ADR-0099 source-file-sha256=c0ac3dd18e3028dd862be4c4f71d31f8d442b2f1570bf081cff35a702b96a67a -->
<a id="adr-0099"></a>

## ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics

迁移时原路径：`docs/adr/0099-cost-gated-independent-member-calls.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0099
title: Cost-Gated Independent Member Calls Without Return Semantics
status: superseded
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: [ADR-0091]
superseded_by: ADR-0130
```

<!-- legacy-adr-body:begin id=ADR-0099 -->
<a id="adr-0099-context"></a>
### Context

ADR-0091 made every Member Call choose `returnPolicy=none|required`. A required call created a
durable Return Obligation, reserved a second Run slot, instructed the recipient to call the source
back, and caused Core to enqueue a synthetic Call Outcome when that callback never arrived. This
made receiving a message or finishing work look like an automatic reason to communicate again.

Member-to-member communication is itself a costly collaboration action. A follow-up is useful only
when its target needs the information to continue acting or decide; acknowledgements, courtesy
replies, non-blocking progress updates, and repeated information create Runs and noise without
advancing responsibility. Rovai therefore needs durable Member Calls without a protocol-level reply
expectation or a Core-authored substitute for a message the member did not send.

<a id="adr-0099-decision"></a>
### Decision

The model-controlled tool contract is:

```text
team.call_member({
  recipient: AgentProfileId,
  content: string,
  taskId?: TaskId
})
```

`returnPolicy` and every equivalent requires-reply field are absent from the input schema, parser,
durable command, receipt, Current Input, prompt, and public contract. A Member Call still requests
one recipient execution opportunity through one durable InboxMessage and one persist-first
Conversation Input; it remains neither a passive notification nor proof that a Run started or work
completed.

Every accepted Member Call is an independent forward edge. A later call to the original sender is
another ordinary call, allocates one new A2A Run slot, and increases logical A2A depth. It does not
close or satisfy the earlier call, inherit reserved capacity, or receive privileged scheduling. The
Conversation Input store has only this one active input form and therefore carries no single-value
kind discriminator.

Return Obligation and Call Outcome are removed from the domain, SQLite schema, terminal Run
transactions, Read Side, Renderer contracts, qualification evidence, and tests. Core never wakes or
messages a source merely because the recipient ended, failed, was cancelled, or did not contact the
source. Input and Run failure remain authoritative Audit/UI facts and continue to participate in
CampTurn settlement. A recipient Run's ordinary final output remains a user-facing CampMessage, but
is not routed to the source and creates no source Run.

A CampTurn settles when its accepted Conversation Inputs and AgentRuns settle. It does not wait for
the original caller or Default Lead to run again, and missing integration is not a mechanical
settlement blocker. Qualification may record each independent Call lifecycle, duplicate acceptance,
cycles, depth, latency, and budget use, but has no response-closure, explicit-return, or Core-Outcome
protocol metric. Whether another call was necessary or a result was integrated belongs to Semantic
Review and may remain indeterminate.

The Session Charter and canonical tool description impose a complete send gate:

- `call_member` is not the default action for ending current work;
- call only when the target needs the message to continue acting or make a decision;
- never call merely to acknowledge receipt, reply politely, send non-blocking progress, or repeat
  shared information;
- before calling, confirm the target will have a clear next action or is waiting for this necessary
  result.

This gate is normative model instruction, not heuristic content classification in Core. Core
continues to enforce structural schema, identity, authorization, recipient, Task, turn, depth, and
budget invariants without guessing the purpose of natural-language content.

Because the replaced protocol was not released, implementation rewrites its migration and removes
the old contract without a compatibility alias, legacy parser, or retained Return/Outcome data path.
The breaking built-in catalog increments the Attested Team Protocol version so an older Bridge
cannot claim the new schema.

This ADR preserves ADR-0091's persist-first Conversation Input, per-Conversation FIFO,
single-active-Run scheduling, crash recovery, no-polling rule, and safe accepted receipt. It replaces
all of ADR-0091's Return Policy, Return Obligation, Call Outcome, reply-depth, reserved-return-slot,
and source-resume clauses.

<a id="adr-0099-consequences"></a>
### Consequences

- Member communication becomes intentional and uniformly costed; a reverse route cannot bypass
  depth or Run-slot accounting.
- Call acceptance, materialization, terminalization, cancellation, Read Side, and Renderer state no
  longer coordinate an exactly-once response subsystem.
- A caller receives no synthetic lifecycle explanation as model input. Users instead rely on public
  Run output, failure presentation, Activity, Audit, and CampTurn state.
- Core cannot prove that collaboration was semantically integrated. That ambiguity is explicit and
  belongs to advisory review rather than a hidden execution obligation.
- Prompt and tool-description quality become the primary prevention for low-value calls; structural
  Core validation deliberately cannot reject them from message text.

<a id="adr-0099-rejected-alternatives"></a>
### Rejected Alternatives

<a id="adr-0099-keep-returnpolicynonerequired-but-improve-the-default"></a>
#### Keep `returnPolicy=none|required` but improve the default

Rejected because the field still makes callback expectation part of every call contract and keeps
the obligation, reservation, terminal transaction, and synthetic Outcome machinery alive.

<a id="adr-0099-preserve-a-derived-voluntary-return-edge"></a>
#### Preserve a derived voluntary-return edge

Rejected because a call back would regain privileged depth or capacity semantics even though no
response responsibility exists. Every communication instead uses the same forward-edge accounting.

<a id="adr-0099-forward-a-recipients-final-output-or-failure-automatically"></a>
#### Forward a recipient's final output or failure automatically

Rejected because final output is user-facing rather than addressed to the source, while a synthetic
failure input would still be a Core-authored substitute for member communication.

<a id="adr-0099-enforce-the-send-gate-by-classifying-content-in-core"></a>
#### Enforce the send gate by classifying content in Core

Rejected because acknowledgement, progress, repetition, necessity, and decision dependence cannot
be reliably established from message text without false acceptance or rejection.

<a id="adr-0099-references"></a>
### References

- [ADR-0091: Durable Member Calls and Single-Slot A2A Resume Scheduling](../v0.32/decisions.md#adr-0091)
- [v0.32 Event-Driven Member Calls](../v0.32/README.md)
<!-- legacy-adr-body:end id=ADR-0099 -->
<!-- legacy-adr:end id=ADR-0099 -->
