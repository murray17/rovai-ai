---
document_type: version-decisions
version: v0.68
lifecycle: historical
last_updated: 2026-08-18
---

# v0.68 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0171](#adr-0171) | Opportunity-Based Tool Interaction Measurement and Independent Tool-Use Judge | `accepted` |
| [ADR-0172](#adr-0172) | Paired Collaboration Value and Outcome-Conditioned Efficiency | `accepted` |

<!-- legacy-adr:begin id=ADR-0171 source-file-sha256=b9cadb7dcb173c359f8f99cc7027a26efa492ad194e31236ecb1ac69eeac19c5 -->
<a id="adr-0171"></a>

## ADR-0171: Opportunity-Based Tool Interaction Measurement and Independent Tool-Use Judge

迁移时原路径：`docs/adr/0171-opportunity-based-tool-interaction-measurement.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0171
title: Opportunity-Based Tool Interaction Measurement and Independent Tool-Use Judge
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.68
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0171 -->
<a id="adr-0171-context"></a>
### Context

Qualification currently proves Tool lifecycle, authorization, receipts, selected effects and coverage, while the collaboration
Judge can assess Public A2A process semantics. Those facts do not establish whether an Agent should have used Camp history or
Memory, chose an appropriate query or mutation, interpreted the result correctly, or used it in later work. Counting calls would
reward activity rather than Tool-use quality, and exposing raw Tool payloads or a sealed oracle to an LLM would weaken privacy,
replay and measurement validity.

<a id="adr-0171-decision"></a>
### Decision

Tool-use measurement is based on pre-dispatch **Tool Measurement Opportunities**, not observed call volume. Each opportunity has a
stable identity, a closed class of `forced_use | natural_use | non_use_control`, an operation family, an evidence requirement and a
sealed operation-specific oracle. Missing opportunity evidence remains unavailable; an Agent-created call never creates its own
measurement denominator.

A replayable Tool Interaction Measurement binds Core-authoritative Canonical Operation input/result projections to each opportunity.
Operation adapters own closed, bounded fields for Camp history retrieval, Memory retrieval, Memory mutation and Camp message send.
The deterministic layer owns identity, schema, authorization, lifecycle, input/result digest binding, returned entity/revision
identity, pagination, retry/replay, oracle alignment and coverage. Raw Tool payload, credentials, unrestricted message or Memory
bodies and hidden oracle data are forbidden from model-visible evidence.

For current Built-ins, Core durably records an authenticated, input-digest-bound `started` fact before permitting the operation and a
separate terminal fact after observation. Complete pagination plus that pre-effect start fence is the authority for complete invocation
coverage; a terminal-only historical record is partial, and start/terminal records are one interaction rather than two calls.

An independent Tool-Use Judge may assess only semantic constructs that deterministic evidence cannot decide: use necessity,
input/query strategy, result interpretation, downstream use and Memory retention quality. It receives a treatment-blind allowlist
projection with local Evidence IDs, uses two frozen tool/network/workspace-disabled replicas, preserves disagreement/abstention and
cannot alter Hard Outcome, Collaboration Process Review, Outcome Review or deterministic Tool facts. Public A2A delegation,
handoff, contribution, feedback and integration remain owned by the Process Judge; Camp message send enters this measurement only
for deterministic routing/effect integrity.

Tool Interaction Measurement and Tool-Use Judge output remain separate axes without an aggregate Tool or collaboration score.

<a id="adr-0171-consequences"></a>
### Consequences

- Qualification must retain privacy-bounded Canonical Operation input/result projections with digest closure instead of relying on
  lossy call totals.
- Cases that claim Tool-use measurement must admit a sealed opportunity/oracle/fixture contract and materialize fresh symbolic
  fixtures before dispatch; ordinary cases without such a contract remain valid but Tool-use measurement is not applicable.
- LLM review can judge semantic selection and use without being asked to verify execution facts or seeing hidden answers.
- New operation families require a closed adapter and calibration evidence; unknown operations retain generic lifecycle evidence but
  cannot receive an invented semantic verdict.
- More calls, more Agents or more returned items have no positive direction by themselves.
- Similarity between a retrieved fact and later code or final text is only candidate downstream evidence unless an authoritative
  lineage binds them; an LLM cannot promote that candidate into proven absorption.

<a id="adr-0171-rejected-alternatives"></a>
### Rejected Alternatives

- **Score every observed Tool call:** rejected because it permits Agents to manufacture the denominator and rewards needless calls.
- **Send complete Tool transcripts to the existing Process Judge:** rejected because it mixes constructs, leaks excessive content and
  asks an LLM to re-decide deterministic facts.
- **Use deterministic oracle match as the whole quality verdict:** rejected because it cannot establish whether selection, synthesis
  or later use was semantically appropriate.
- **Publish one weighted Tool-use score:** rejected because weights conceal coverage, disagreement and different operation semantics.

<a id="adr-0171-references"></a>
### References

- [v0.68](README.md)
- [Tool Interaction Measurement v1](../../contracts/tool-interaction-measurement-v1.md)
- [Semantic Judge Views v1](../../contracts/semantic-judge-views-v1.md)
- [ADR-0095](../v0.34/decisions.md#adr-0095)
- [ADR-0097](../v0.34/decisions.md#adr-0097)
- [ADR-0155](../v0.55/decisions.md#adr-0155)
<!-- legacy-adr-body:end id=ADR-0171 -->
<!-- legacy-adr:end id=ADR-0171 -->

<!-- legacy-adr:begin id=ADR-0172 source-file-sha256=5753f4fd8c9346ec377f3ce3716fc2373f48750b4f2a2f1242ba26cfdcad0bfa -->
<a id="adr-0172"></a>

## ADR-0172: Paired Collaboration Value and Outcome-Conditioned Efficiency

迁移时原路径：`docs/adr/0172-paired-collaboration-value-and-outcome-conditioned-efficiency.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
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
```

<!-- legacy-adr-body:begin id=ADR-0172 -->
<a id="adr-0172-context"></a>
### Context

A mechanically correct or semantically persuasive collaboration trace does not prove that a Team outperforms a Solo Agent. Current
independent Qualification Trials, two-repeat stability and cross-version comparisons do not identify a collaboration treatment
effect. Likewise, raw duration and call counts are not collaboration efficiency: faster failure is not better, summed concurrent Run
durations double-count time, and incomplete token/cost telemetry cannot be treated as zero.

<a id="adr-0172-decision"></a>
### Decision

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

<a id="adr-0172-consequences"></a>
### Consequences

- Team/Solo execution needs a first-class paired manifest rather than inferring treatments from existing team metadata.
- Formal causal claims continue to require dedicated isolation and sufficient pre-registered pairs; a single pair is diagnostic.
- Efficiency becomes outcome-conditioned and evidence-typed. Wall time, tokens, cost, Tool latency and coordination wait can be
  compared only where their own authority and coverage permit.
- Process quality, Tool-use quality, delivery outcome and resources remain separate, which makes trade-offs visible rather than
  hiding them in a total score.
- Role ablation or Tool availability ablation may extend the treatment protocol later, but each requires its own pre-registration and
  cannot be reconstructed after observing results.

<a id="adr-0172-rejected-alternatives"></a>
### Rejected Alternatives

- **Infer uplift from successful Team Trials:** rejected because no counterfactual outcome is observed.
- **Compare unrelated Team and Solo runs:** rejected because Case, state, model, budget and order drift confound the treatment.
- **Define efficiency as duration per Agent or per call:** rejected because the denominator has no stable quality interpretation.
- **Rank arms with a weighted outcome/process/cost score:** rejected because weights can compensate failure and erase uncertainty.
- **Treat deterministic replay as a counterfactual arm:** rejected because replay validates evidence identity, not an alternative policy.

<a id="adr-0172-references"></a>
### References

- [v0.68](README.md)
- [Paired Collaboration Experiment v1](../../contracts/paired-collaboration-experiment-v1.md)
- [Benchmark Protocol v3](../../contracts/benchmark-protocol-v3.md)
- [ADR-0094](../v0.34/decisions.md#adr-0094)
- [ADR-0095](../v0.34/decisions.md#adr-0095)
- [ADR-0151](../v0.53/decisions.md#adr-0151)
- [ADR-0155](../v0.55/decisions.md#adr-0155)
<!-- legacy-adr-body:end id=ADR-0172 -->
<!-- legacy-adr:end id=ADR-0172 -->
