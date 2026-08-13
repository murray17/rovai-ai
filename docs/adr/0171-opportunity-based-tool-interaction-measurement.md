---
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
---

# ADR-0171: Opportunity-Based Tool Interaction Measurement and Independent Tool-Use Judge

## Context

Qualification currently proves Tool lifecycle, authorization, receipts, selected effects and coverage, while the collaboration
Judge can assess Public A2A process semantics. Those facts do not establish whether an Agent should have used Camp history or
Memory, chose an appropriate query or mutation, interpreted the result correctly, or used it in later work. Counting calls would
reward activity rather than Tool-use quality, and exposing raw Tool payloads or a sealed oracle to an LLM would weaken privacy,
replay and measurement validity.

## Decision

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

## Consequences

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

## Rejected Alternatives

- **Score every observed Tool call:** rejected because it permits Agents to manufacture the denominator and rewards needless calls.
- **Send complete Tool transcripts to the existing Process Judge:** rejected because it mixes constructs, leaks excessive content and
  asks an LLM to re-decide deterministic facts.
- **Use deterministic oracle match as the whole quality verdict:** rejected because it cannot establish whether selection, synthesis
  or later use was semantically appropriate.
- **Publish one weighted Tool-use score:** rejected because weights conceal coverage, disagreement and different operation semantics.

## References

- [v0.68](../versions/v0.68/README.md)
- [Tool Interaction Measurement v1](../contracts/tool-interaction-measurement-v1.md)
- [Semantic Judge Views v1](../contracts/semantic-judge-views-v1.md)
- [ADR-0095](0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0097](0097-authority-preserving-benchmark-evidence-ledgers.md)
- [ADR-0155](0155-treatment-blind-outcome-and-process-judge-views.md)
