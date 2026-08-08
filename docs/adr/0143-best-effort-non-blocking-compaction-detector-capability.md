---
document_type: adr
id: ADR-0143
title: Best-Effort Non-Blocking Compaction Detector Capability
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
---

# ADR-0143: Best-Effort Non-Blocking Compaction Detector Capability

## Context

Compaction detectors depend on external Runtime Hooks, ACP extensions and native event schemas that can
be temporarily unavailable or fail to establish after an upstream upgrade. Making detector readiness
an AgentRun admission condition would turn an optional continuity enhancement into a complete Runtime
outage.

Rovai still must preserve any Requirement it already knows. It also needs to distinguish a deliberate
version policy transition from ordinary detector recovery: the former can establish a one-time
Bootstrap baseline for existing Sessions, while the latter has no evidence that compaction occurred
during its observation gap.

## Decision

### Closed internal policy

The version-owned per-Runtime environment policy has exactly two applicable values:

```text
disabled
best_effort
```

`disabled` establishes no detector. `best_effort` asks Core and the Runtime Host to establish the
version-qualified Hook, Observer or ACP compaction route asynchronously and in parallel with normal
Runtime startup. Claude Code and Codex remain outside this policy because their Bootstrap delivery
layer does not require redelivery.

The v0.48 matrix is:

- `best_effort`: GitHub Copilot, OpenCode, Kiro, Qoder, CodeBuddy and Qwen Code;
- `disabled`: Antigravity;
- not applicable and no environment switch: Claude Code and Codex CLI.

This locally replaces ADR-0139's `enabled` label with `best_effort`; ADR-0139's version ownership,
process-start snapshot, durable policy epoch and pending-preservation rules remain effective.

### Detector state is not Runtime Readiness

Detector establishment and operational state are internal enhancement diagnostics such as
`establishing | observing | unavailable`. They do not participate in Product Runtime Readiness,
Member Runtime Configuration validity, AgentRun admission, Native Session creation/Resume, model
selection or permission readiness.

An AgentRun proceeds normally while a best-effort detector is establishing, unavailable or recovering.
Rovai does not respond by forcing one-shot Sessions, changing Runtime/model selection, modifying user
configuration, or inferring compaction from token/context-window telemetry.

An already persisted Bootstrap Redelivery Requirement is independent of detector health and must still
be selected and acknowledged under ADR-0138/0141.

### No retrospective inference on operational recovery

When a detector becomes observing after temporary unavailability within the same policy epoch, it
admits only signals observed from that recovery point onward. It does not create a synthetic
Requirement for the gap and does not guess whether compaction occurred.

This differs from a version-owned policy transition from `disabled` to `best_effort`. ADR-0139's
idempotent transition requirement remains: existing reusable Bindings receive one deliberate
Bootstrap baseline when the new policy epoch is first applied. Repeated detector reconnects under that
epoch do not repeat it.

### Support claims remain evidence-bound

Real target-version Runtime smoke is required before documentation claims that a detector works. A
temporarily failed detector after qualification degrades only the enhancement state, not Runtime
availability. Compatibility evidence must describe the exact Runtime version, selected surface,
observed signal and known gaps; a configured but never observed Hook is not proof of support.

## Consequences

- Users can continue running an otherwise healthy Runtime during detector outages.
- Rovai honestly has an observation gap without inventing compaction facts.
- Known pending work remains reliable even when future observation is degraded.
- Version policy rollout and transient reconnect have distinct, deterministic semantics.
- UI and Runtime Readiness remain free of a protocol-internal detector status.

## Rejected Alternatives

- Mandatory detector Readiness: makes third-party Hook availability a full Runtime outage.
- Silently run a fallback one-shot Session: changes continuity semantics and cost without product
  authorization.
- Mark pending whenever a detector reconnects: treats an observation gap as evidence of compaction.
- Clear pending while detector is unavailable: loses a fact Core already knows.
- Customer-visible detector toggle: exposes internal protocol correctness as a user preference.

## References

- [v0.48 Native Session Compaction Bootstrap Redelivery](../versions/v0.48/README.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](0138-durable-bootstrap-redelivery-requirement.md)
- [ADR-0139: Version-Owned Runtime Policy](0139-version-owned-bootstrap-redelivery-runtime-policy.md)
- [ADR-0142: Native-Session-Scoped Observer Lease](0142-native-session-scoped-compaction-observer-lease.md)
- [Native Session Bootstrap Redelivery Architecture](../architecture/native-session-bootstrap-redelivery.md)
