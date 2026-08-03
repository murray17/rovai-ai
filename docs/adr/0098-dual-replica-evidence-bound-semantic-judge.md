---
document_type: adr
id: ADR-0098
title: Dual-Replica Evidence-Bound Semantic Judge Protocol
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
---

# ADR-0098: Dual-Replica Evidence-Bound Semantic Judge Protocol

## Context

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

## Decision

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

## Consequences

- Two frozen Replicas increase latency and cost, but expose instability that one score would hide.
- Moving model aliases and providers that cannot identify the evaluated revision may still support
  local experiments, but their results are not comparable Formal Semantic Reviews.
- Some checklist items legitimately abstain when the Pack lacks sufficient safe evidence.
- Judge prompt, rubric, model, decoding, Pack schema, redaction, or reconciliation changes create a
  new Configuration digest without changing historical results or Hard Outcome.
- Prompt-injection defenses remain measurable protocol controls rather than a claim that arbitrary
  untrusted content is harmless.

## Rejected Alternatives

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

## References

- [ADR-0095: Layered Qualification Authority and Advisory Semantic Review](0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0097: Authority-Preserving Benchmark Evidence Ledgers](0097-authority-preserving-benchmark-evidence-ledgers.md)
- [ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics](0099-cost-gated-independent-member-calls.md)
- [JudgeSense: A Benchmark for Prompt Sensitivity in LLM-as-a-Judge Systems](https://arxiv.org/abs/2604.23478)
- [MCJudgeBench: A Benchmark for Constraint-Level Judge Evaluation in Multi-Constraint Instruction Following](https://arxiv.org/abs/2605.03858)
- [Don't Judge Code by Its Cover: Exploring Biases in LLM Judges for Code Evaluation](https://arxiv.org/abs/2505.16222)
- [Adversarial Attacks on LLM-as-a-Judge Systems: Insights from Prompt Injections](https://arxiv.org/abs/2504.18333)
