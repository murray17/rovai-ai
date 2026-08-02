---
document_type: adr
id: ADR-0090
title: "Team Delivery Qualification Evidence Boundary"
status: accepted
date: 2026-08-02
decision_scope: cross-version
source_version: v0.31
supersedes: []
superseded_by: null
---

# ADR-0090: Team Delivery Qualification Evidence Boundary

## Context

Rovai has real Runtime Smoke tests for launch, Session continuity, permissions, Team Tool calls,
recovery and A2A routing. Those tests prove specific integration contracts, but they do not prove
that a configured Agent team can complete an unfamiliar software-delivery task. Conversely, a
Task's `completed` status is an authorized actor declaration rather than Core verification, and an
Agent's final response cannot be its own acceptance evidence.

The first team evaluation must answer a narrower question before comparing team configurations or
attributing value to individual roles: can one frozen production team deliver externally verified
workspace behavior and settle its execution tree under a fixed budget without post-dispatch human
help? The evidence boundary must prevent harness failures, subjective transcript impressions and
retry-friendly metrics from silently changing that claim.

## Decision

### Qualification is an externally verified delivery claim

A Team Delivery Qualification evaluates one exact Qualification Team Configuration against a
versioned Qualification Case. One Formal Qualification Trial passes only when both results hold:

1. **Verified Delivery**: the final workspace satisfies every build, public, withheld, requirement,
   regression and forbidden-change check owned by the external case verifier.
2. **Orchestration Convergence**: the complete AgentRun tree reaches terminal state within the case's
   elapsed-time, AgentRun and A2A budgets without Post-Dispatch Human Intervention.

Agent output, Reviewer approval and Task status never create or override either result. Correct code
with an unsettled or looping Run tree remains an overall failure while retaining its separate
`verifiedDelivery = true` diagnostic fact.

A pre-dispatch fixture, verifier, Runner or required Runtime precondition failure is an Invalid
Qualification Trial and is excluded from the denominator. After accepted task dispatch, Runtime,
permission, tool, timeout, coordination and recovery failures are valid failures of the tested
configuration. A system cannot discard inconvenient post-dispatch outcomes as infrastructure noise.

### Human intervention has an exact boundary

Runtime installation, login, Member configuration, case materialization and preflight occur before
dispatch. After Core accepts the task for the Default Lead, any human message, permission decision,
workspace edit, command, configuration change, Runtime restart or continuation prompt is an
intervention and makes the Trial fail.

Passive observation, Runner-owned evidence capture, automatic deadline enforcement, post-terminal
verification and Core's own recovery behavior are not interventions. The Runner does not retry the
task or synthesize “continue” messages.

### Formal Trials use fresh product state and real Runtimes

A Formal Qualification Trial is driven through public Core commands against one recorded packaged
Release Core. It uses a fresh Core data directory, Camp, Conversations, Native Sessions and Run
Workspace. The Runner configures the frozen Members through domain commands, selects the Default
Lead and sends one ordinary outcome-focused user request. It does not mutate SQLite, drive Renderer,
reuse production Camp/Memory/Task continuity or substitute a mock Runtime.

The host's real Runtime installations, accounts, model services, frozen native permissions and
observable ambient tools remain part of the qualification environment. A formal run requires no
competing Rovai Core process. Debug Core and public demo fixtures can validate the harness but cannot
produce qualification evidence.

Every comparable result set has one immutable Qualification Environment Manifest identifying the
Rovai and Runner builds, host, exact team identities and Capabilities, Runtime executables and
fingerprints, models and options, native permissions, capability snapshots, Team Gateway and ambient
MCP state, case seals and relevant toolchains. Material drift stops the set; later results use a new
Manifest rather than extending the prior sample.

### Cases are sealed before scoring

A Qualification Case contains a clean starting workspace, an outcome-focused request, a Withheld
Verifier, explicit change boundaries and a Trial Budget. Before sealing it MUST demonstrate:

- healthy task-independent installation, build and baseline checks;
- a stable task-specific failure on the starting workspace;
- a stable full pass from an independently prepared reference implementation;
- deterministic repeated verifier results;
- one content identity covering prompt, fixture, verifier, budgets and boundaries.

Correction after sealing creates a new case version and invalidates affected results. Scored case
inputs cannot be used to tune roles, prompts, models or permissions between Independent Qualification
Repeats; a tuned team is a new Qualification Team Configuration.

The scored Sealed Qualification Pack remains outside the open-source repository. Only one starting
workspace and request are materialized for a Trial. The Withheld Verifier and reference answer are
not placed in the Run Workspace and execute only after all Trial Runtime processes terminate. This
is non-adversarial information withholding, not an OS security claim against a same-user process
that intentionally searches the host.

Each materialized workspace is a disposable Git repository with one Runner-created baseline commit
and no Remote. Agents may use normal Git workflows; the Runner retains an external baseline tree
identity so Git metadata changes cannot hide final filesystem changes. Correctness is behavioral and
never measured by similarity to a reference patch.

### Repeats report reliability without retry-friendly inflation

An Independent Qualification Repeat creates all product and workspace state anew while keeping the
sealed case and team configuration unchanged. Results report raw pass counts and pass rate. They do
not use `Pass@k` as a synonym for reliability, because “at least one success in k attempts” hides
intermittent failure.

Small samples remain exploratory evidence. A demonstrated pass on the evaluated case is not a claim
of general Agent intelligence, superiority to a solo Agent, causal role contribution, statistical
significance or performance on another technology stack.

### Collaboration evidence remains separate

Each Trial produces a Collaboration Evidence Matrix containing observable participation, delegation
paths, handoff closure, A2A depth, repeated routing, overlapping work, feedback-integration evidence,
loops and budget use. Case metadata may identify relevant and unnecessary role categories for this
diagnostic view, but role participation is not a delivery hard gate.

The Matrix has no composite score and does not alter Verified Delivery or Orchestration Convergence.
Unavailable attribution and semantic judgments unsupported by authoritative evidence remain
`indeterminate`. An optional post-hoc human blind review may interpret exported evidence. v0.31 does
not give a participating model or an independent LLM Judge authority over the qualification result.

### Evidence is private by default

A Qualification Evidence Bundle privately retains the Environment Manifest, case identity,
authoritative snapshots, normalized AgentRun Execution Evidence, A2A/Task facts, final workspace
change, verifier output, outcome and Collaboration Evidence Matrix for both successes and failures.

Runtime-private logs, credentials, environment-variable values, hidden reasoning, reference answers
and Withheld Verifiers are excluded. Nothing is written into the source repository automatically.
Publishing requires an explicit redacted export that preserves the claim boundary without revealing
sealed material.

## Consequences

- Rovai can distinguish “the integration mechanism works” from “this exact team delivered this exact
  case,” and can diagnose correctness and convergence independently.
- Formal evidence is more expensive than a Smoke test: every repeat requires fresh product state,
  real model use, an immutable environment record and external verification.
- A private case pack improves first-use leakage resistance but prevents full public reproduction;
  exported seals and reports prove identity and outcome without revealing the verifier.
- Non-adversarial withholding and preserved ambient MCP limit the claim to the recorded real host
  environment. The result is not a security benchmark or a clean-room model comparison.
- Deterministic rules cannot fully judge architecture taste or whether feedback was semantically
  absorbed. Those gaps remain visible rather than being hidden behind an uncalibrated Judge score.
- Comparative baselines, role ablations and stable benchmark statistics can be added later without
  redefining what a single formal delivery pass means.

## Rejected Alternatives

- **Treat Task `completed` or the Lead's final response as verification.** Rejected because both are
  participant-authored declarations rather than external delivery evidence.
- **Score reference-patch similarity.** Rejected because a behaviorally correct implementation may
  have a different valid structure.
- **Use one composite correctness-and-collaboration score.** Rejected because it can let conversational
  activity compensate for broken delivery or conceal a correct artifact behind subjective weights.
- **Use `Pass@3` as the primary reliability result.** Rejected because it rewards repeated attempts
  and can report success despite two failures.
- **Let an LLM Judge determine pass/fail.** Rejected because semantic judgment is useful but biased and
  cannot outrank deterministic build, behavior, boundary and lifecycle evidence.
- **Run formal evidence through Debug Core, Renderer automation or reused production state.** Rejected
  because those paths either change the product boundary or introduce hidden continuity.
- **Commit scored fixtures and hidden tests to the open repository.** Rejected because public access
  destroys the first-use sealed boundary and may leak into future model training.
- **Exclude post-dispatch Runtime failures as invalid.** Rejected because Runtime and Team Tool
  reliability are part of the production configuration being qualified.

## References

- [v0.31 Default Team Delivery Qualification](../versions/v0.31/README.md)
- [ADR-0012: Collaboration v3 Lightweight Task](0012-collaboration-v3-lightweight-task.md)
- [ADR-0061: Durable Agent-Inaccessible Execution Evidence](0061-durable-agent-inaccessible-execution-evidence.md)
- [ADR-0062: Interruptible Run Trees](0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0089: Attested Built-in MCP Tool Parity](0089-attested-built-in-mcp-tool-parity.md)
- [Large Language Models are not Fair Evaluators](https://arxiv.org/abs/2305.17926)
- [Don't Judge Code by Its Cover](https://arxiv.org/abs/2505.16222)
