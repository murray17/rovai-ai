---
document_type: adr
id: ADR-0140
title: Runtime-Specific Compaction Signal Admission Point and Prepared-Input Cutoff
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
---

# ADR-0140: Runtime-Specific Compaction Signal Admission Point and Prepared-Input Cutoff

## Context

Runtime compaction protocols do not expose one uniform lifecycle. Some provide a reliable completed
event, while the selected Copilot CLI Hook surface exposes `preCompact` without a corresponding
post-compaction Hook. GitHub's separate Copilot SDK documents compaction start/complete events, but
those events are not automatically available through Rovai's current ACP/Hook adapter path. Kiro's ACP
extension reports compaction status with a target-version-qualified nested terminal schema.

Admitting every available pre-event would restore Bootstrap earlier but spend tokens when compaction
later aborts. Admitting only completed events would make Copilot impossible to support and can leave
one additional prompt window when asynchronous completion arrives after that prompt is already
immutable.

The phrase “prompt has not been submitted” is also too transport-specific. Rovai already persists a
prepared Runtime Input Delivery before calling a Runtime. Mutating the payload after that point would
break deterministic retry and delivery-unknown reconciliation.

## Decision

Each enabled Runtime has exactly one version-qualified Compaction Signal Admission Point. Rovai
chooses the latest reliable lifecycle point that still makes the detector useful; it does not apply a
universal pre-event rule.

- If Copilot uses the current Hook/ACP candidate, it admits `preCompact` and immediately advances a
  Requirement because no completed event is qualified on that surface. This is a one-shot edge, not a
  sticky in-progress state: one deduplicated `preCompact` advances requested revision once; one
  accepted Bootstrap redelivery may acknowledge that revision immediately without waiting for a
  completed signal; only a later distinct `preCompact` creates another Requirement. One redundant
  Bootstrap after an aborted compaction is an accepted cost.
- OpenCode v1.18.10 admits only native event `session.compacted`.
- Qoder and Qwen Code admit only successful `PostCompact` with trigger `manual | auto`;
- CodeBuddy `2.133.1` admits only `SessionStart(source=compact)` after its emergency automatic compaction completes. Its separate pre-message compaction path bypasses `PreCompact`, `PostCompact` and `SessionStart(compact)` in real qualification, so that absence remains a documented best-effort coverage gap rather than a token-derived observation;
  their pre-events do not advance a Requirement.
- Kiro v2.16.1 admits only `_kiro.dev/compaction/status` where
  `params.status.type == "completed"`; its preceding `started` state does not advance a Requirement.
- Claude Code and Codex have no admission point. Antigravity has none in v0.48.

Started/delta telemetry, failed or cancelled completion, unknown status values, token-count changes
and inferred context-window discontinuities never advance a Requirement. One Runtime upgrade cannot
silently reinterpret an old event name or payload; the detector mapping and evidence must be revised
with the Rovai version policy.

GitHub documents that background compaction snapshots conversation history and preserves messages
added while compaction is running, and that `preCompact` fires before compaction begins. Copilot CLI
v1.0.78 qualification additionally observed a real `preCompact(manual)` Hook and a subsequent accepted
ACP input. v0.48 therefore accepts the one-shot pre edge; it does not wait on the unrelated SDK
complete event or use a timer.

The cutoff for carrying a newly admitted Requirement in the current input is the Core transaction
that persists `RuntimeInputDelivery.prepared` together with its immutable redelivery selection. An
observation committed before that transaction may be selected for this input. An observation
committed afterward cannot mutate it and remains pending for the next Runtime Input Delivery. The
later process, socket or protocol send call is not a mutability boundary.

Lifecycle duplicates belonging to one compaction occurrence must not create a second redelivery, but
the trusted occurrence identity and durable deduplication mechanism are a separate v0.48 decision.

## Consequences

- Copilot can implement redelivery despite exposing only a pre-compaction hook.
- Copilot does not remain pending merely because no post-compaction Hook arrives; ACK consumes the
  one-shot Requirement normally.
- Runtimes with reliable completion avoid unnecessary Bootstrap token spend and false positives.
- A late asynchronous completion may intentionally miss one already-prepared input and target the
  next; no immutable input is patched in place.
- Kiro's exact nested completed state is version-qualified and must be revalidated on incompatible
  upstream changes.
- Deterministic resend and `delivery_unknown` recovery retain exact prepared-input semantics.

## Rejected Alternatives

- Admit every pre/in-progress event: spends Bootstrap tokens even when a reliable completion event can
  avoid false positives.
- Require completion for every Runtime: makes Copilot unsupported and ignores asymmetric official
  lifecycle capabilities.
- Treat the transport send call as the cutoff: permits payload mutation after durable preparation and
  makes retry bytes ambiguous.
- Infer completion from token telemetry or unknown status values: creates unqualified false facts.
- Hard-code one OpenCode event name across versions: confuses current and legacy event families.

## References

- [v0.48 Native Session Compaction Bootstrap Redelivery](../versions/v0.48/README.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](0138-durable-bootstrap-redelivery-requirement.md)
- [ADR-0139: Version-Owned Runtime Policy](0139-version-owned-bootstrap-redelivery-runtime-policy.md)
- [Native Session Bootstrap Redelivery Architecture](../architecture/native-session-bootstrap-redelivery.md)
- [ADR-0141: Atomic Bootstrap Redelivery Input Overlay](0141-atomic-bootstrap-redelivery-input-overlay.md)
- [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [GitHub Copilot CLI context management](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/context-management)
- [GitHub Copilot SDK streaming events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)
