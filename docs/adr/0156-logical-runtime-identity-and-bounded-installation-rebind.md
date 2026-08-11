---
document_type: adr
id: ADR-0156
title: Frozen Logical Runtime Identity and Bounded Installation Rebind
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
---

# ADR-0156: Frozen Logical Runtime Identity and Bounded Installation Rebind

## Context

ADR-0075 freezes an AgentRun executable path and fingerprint, then rejects launch when the executable
content no longer matches. This detects real replacement, but it also turns a normal in-place CLI update
between Run creation and dispatch into a terminal `runtime_integrity_failed`. Product Runtime installations
are mutable discovery and probe state; a queued Run should not require the installation bytes to remain
unchanged forever when Core can re-establish the same trusted and compatible logical Runtime binding.

Removing integrity verification entirely would lose the launch-time safety boundary. Silently overwriting the
Run snapshot would instead lose reproducibility and make repeated drift unbounded. Core needs a recovery path
that preserves the requested Runtime semantics and the initial executable evidence while allowing one verified
effective installation refresh.

## Decision

An AgentRun freezes its logical Runtime identity: Adapter kind, Installation ID, authentication scope, model
selection semantics and permission configuration. An explicit model remains explicit with the same model ID
and options; `runtime_default` remains a request for the refreshed Runtime default. These values cannot be
changed by drift recovery.

The initial reported version and executable fingerprint are immutable audit evidence. The effective path,
reported version, fingerprint, installation/search generation, capability snapshot, compatible protocol,
session compatibility key and derived config digests may change only through the Core-owned pre-dispatch
Runtime rebind command.

When dispatch detects a changed fingerprint, unavailable path, stale snapshot or a snapshot changed by an
earlier refresh, Core must:

1. mark the old capability snapshot stale when the execution-boundary check observed the drift;
2. invalidate resident processes for the Adapter;
3. bypass refresh deferral and synchronously re-discover/deep-probe a managed Installation, or deep-probe the
   same explicit path for a custom Installation;
4. resolve a new effective Runtime from the Run's frozen logical identity;
5. atomically rebind the queued/recovery-waiting Run, write `agent_run.runtime_drift_detected` and
   `agent_run.runtime_rebound`, then repeat blocker and executable-integrity validation;
6. continue the same Run when the repeated validation succeeds.

Automatic rebind is limited to once per AgentRun and is persisted in `runtime_rebind_count`. A second drift
during or after that recovery is terminal. The rebind must also fail closed when the Installation is missing or
disabled, Adapter/Installation/authentication/policy identity changes, an explicit model is unavailable,
authentication or capability probing is not ready, no supported protocol can be resolved, the refreshed config
digest is invalid, or the executable changes again during the bounded refresh.

`runtime_integrity_failed` is reserved for identity/trust/integrity that cannot be re-established. Probe,
authentication, compatibility and refresh failures retain their more specific blocker/error codes. This
decision locally replaces ADR-0075's requirement that an existing AgentRun path and fingerprint remain
immutable; ADR-0075's message-first boundary, metadata fast path, conditional SHA-256 and initial evidence
requirements remain in force.

## Consequences

Normal in-place CLI updates no longer terminally fail an otherwise compatible queued Run. The same public
message, CampTurn and AgentRun continue after one synchronous refresh, while the initial and effective
executable evidence remain distinguishable and the full transition is append-only auditable.

Dispatch after detected drift is slower because it performs discovery, version inspection, deep probing and a
second integrity check. The one-rebind limit favors bounded behavior over indefinite availability. Runtime
implementations without stronger package-signing provenance continue to rely on the Installation source/path,
successful deep probe and existing local trust model; this decision does not claim artifact signature
verification that the product does not perform.

## Rejected Alternatives

- Failing every fingerprint mismatch was rejected because benign in-place Runtime upgrades are recoverable
  installation drift, not necessarily a trust violation.
- Removing fingerprint checks was rejected because Core would no longer detect replacement at the actual
  execution boundary.
- Updating only the capability snapshot was rejected because the Run's JSON and redundant Runtime columns
  would disagree and dispatch would remain blocked.
- Rebinding from the Member's current live configuration was rejected because it could silently change the
  Run's model or permission intent.
- Unlimited refresh/retry was rejected because a repeatedly changing executable could keep a Run nonterminal
  and repeatedly execute probe candidates.

## References

- [v0.58 overview](../versions/v0.58/README.md)
- [ADR-0066: Managed Product Runtime Resolution](0066-managed-product-runtime-resolution.md)
- [ADR-0075: Runtime Integrity at Change and Execution Boundaries](0075-runtime-integrity-at-change-and-execution-boundaries.md)
- [ADR-0127: Atomic Member Runtime Configuration](0127-atomic-member-runtime-configuration.md)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
