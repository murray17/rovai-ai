---
document_type: adr
id: ADR-0092
title: Recoverable Qualification Evaluation Integrity
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
---

# ADR-0092: Recoverable Qualification Evaluation Integrity

## Context

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

## Decision

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

## Consequences

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

## Rejected Alternatives

- **Count every post-dispatch verifier failure as `verifiedDelivery=false`.** Rejected because it
  attributes evaluator reliability to the Qualification Team Configuration.
- **Re-run the team when verification fails.** Rejected because observed outcomes would influence
  which execution enters the denominator.
- **Apply a repaired verifier retrospectively to the old workspace.** Rejected because changing the
  sealed evaluation contract after observing an execution permits outcome-dependent scoring.
- **Publish a Pass Rate from only the completed subset.** Rejected because the denominator would
  depend on execution and evaluator availability rather than the frozen Suite plan.

## References

- [ADR-0090: Team Delivery Qualification Evidence Boundary](0090-team-delivery-qualification-evidence-boundary.md)
- [Qualification Runner](../../scripts/qualification-runner.mjs)
- [Qualification Suite Runner](../../scripts/qualification-suite.mjs)
