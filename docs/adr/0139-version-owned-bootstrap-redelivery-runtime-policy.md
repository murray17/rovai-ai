---
document_type: adr
id: ADR-0139
title: Version-Owned Bootstrap Redelivery Runtime Policy and Enablement Transition
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
---

# ADR-0139: Version-Owned Bootstrap Redelivery Runtime Policy and Enablement Transition

> [ADR-0143](0143-best-effort-non-blocking-compaction-detector-capability.md)局部替代本文的
> `enabled` 标签与任何可能的 Readiness 含义：适用值现在是 `disabled | best_effort`，detector
> establishment 不阻塞 AgentRun。本文的版本 ownership、policy epoch、首次
> `disabled -> best_effort` 存量基线和 pending 不可清除条款继续有效。

## Context

Bootstrap redelivery needs Runtime-specific rollout because Runtime protocols expose different
compaction guarantees and detectors. The policy must not become a customer setting, but Rovai must
still be able to maintain the supported matrix by release and disable one Runtime independently.

A Native Binding generation is the lifetime of one Conversation-to-Native-Session binding, not a
Rovai release or AgentRun. It can survive multiple Runs and a Rovai process restart. Freezing an
enablement switch to that generation would prevent a new release from correcting detector policy for
an existing reusable Session. Conversely, changing enablement must not discard a durable compaction
fact already observed for that Session.

When a release enables detection for an existing Session, that Session might already have compacted
while an older release could not observe it. Waiting only for a future signal would leave the first
post-upgrade prompt without a known-good Bootstrap baseline.

## Decision

For Runtimes whose Bootstrap can participate in ordinary Session compaction, Rovai owns an internal,
per-Runtime environment policy. Packaged/versioned launch configuration maintains its defaults. Core
reads the effective matrix once at process startup; it is not a Renderer setting, persisted customer
preference, remotely hot-reloaded flag or Native-Binding-frozen capability.

Claude Code and Codex do not define this switch and never enter the detector admission path because
their Bootstrap is delivered through a compaction-protected instruction layer. The v0.48 version
matrix enables signal-driven admission for Copilot, OpenCode, Kiro, Qoder, CodeBuddy and Qwen Code.
Antigravity remains disabled because no qualified official compaction lifecycle signal has been
accepted.

Core durably records the last applied policy epoch per Runtime and reconciles the process-start matrix
transactionally. The first effective `disabled -> best_effort` transition for one policy epoch advances
exactly one Bootstrap Redelivery Requirement for every already reusable current Binding of that
Runtime. A new Binding that has not yet accepted input already receives normal Bootstrap and needs no
synthetic transition requirement. Repeated startup under the same epoch is idempotent and does not
create another requirement.

The environment policy values are `disabled | best_effort`. Changing one Runtime to `disabled`
does not acknowledge, clear or bypass a Bootstrap Redelivery Requirement that Core already knows.
Such a Requirement remains governed by ADR-0138 and must be consumed by an accepted Runtime Input.
Policy transitions do not create a new Native Session or increment its Binding generation.

Exact environment keys and the implemented matrix are maintained in
[Native Session Bootstrap Redelivery Architecture](../architecture/native-session-bootstrap-redelivery.md).
Detector identities, lifecycle-event success semantics and callback trust must not weaken this policy
transition or the ADR-0138 acknowledgement boundary.

## Consequences

- Rovai releases can maintain and roll back one Runtime detector without exposing product settings.
- An upgraded process can apply a new policy to an existing compatible Native Session.
- First enablement restores a deterministic Bootstrap baseline even if older compactions were never
  observable.
- Durable pending work cannot be silently lost by changing an environment value.
- Persistence needs an idempotent per-Runtime applied policy epoch in addition to Binding-scoped
  requested/acknowledged revisions.

## Rejected Alternatives

- Customer-visible or persisted preference: exposes a protocol-correctness mechanism as a product
  choice and lets users violate delivery guarantees.
- Freeze enablement on Native Binding creation: prevents release policy corrections from reaching
  long-lived Sessions without needless Session replacement.
- Apply enablement only to newly created Bindings: leaves upgraded existing Sessions with an unknown
  Bootstrap baseline.
- Clear pending work when disabled: rewrites an already observed compaction fact as if it never
  happened.
- Force a new Native Session on first enablement: restores context but unnecessarily destroys verified
  Session continuity when one controlled Bootstrap redelivery suffices.

## References

- [v0.48 Native Session Compaction Bootstrap Redelivery](../versions/v0.48/README.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](0138-durable-bootstrap-redelivery-requirement.md)
- [Native Session Bootstrap Redelivery Architecture](../architecture/native-session-bootstrap-redelivery.md)
- [ADR-0140: Runtime-Specific Compaction Signal Admission Point](0140-runtime-specific-compaction-signal-admission-point.md)
- [ADR-0143: Best-Effort Non-Blocking Compaction Detector](0143-best-effort-non-blocking-compaction-detector-capability.md)
