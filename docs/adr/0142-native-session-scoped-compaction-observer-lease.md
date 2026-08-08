---
document_type: adr
id: ADR-0142
title: Native-Session-Scoped Compaction Observer Lease and Uncertain-Submission Boundary
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
---

# ADR-0142: Native-Session-Scoped Compaction Observer Lease and Uncertain-Submission Boundary

## Context

A completed compaction event can arrive after the AgentRun that triggered it has become terminal.
Routing every callback through `(agentRunId, executionEpoch)` would reject a valid Session fact.
Keeping the AgentRun lease alive would instead preserve prompt, Built-in Tool and collaboration
authority beyond the Run that owns it.

Runtime Hook and native event transports can also be interrupted. Treating every Host exit as possible
compaction would create unbounded false-positive Bootstrap token spend. Treating a callback whose Core
commit result is unknown as absent could lose a real observation.

## Decision

### Independent narrow Observer authority

Rovai creates a Native Session Compaction Observer Lease after a Native Session bind or verified Resume
succeeds. Its identity is scoped at least to:

```text
adapterInstallationId
hostInstanceId
nativeSessionId
nativeBindingId
nativeBindingGeneration
detectorPolicyEpoch
```

The Observer Lease may survive multiple AgentRuns on that Native Session. It authorizes only submission
of the exact version-qualified Compaction Signal Admission Point selected for that Runtime. It cannot
send Runtime input, invoke Built-in Tools, obtain an AgentRun lease, mutate Camp/Task/Message/Memory
state, control the Runtime, or prove that a model observed the event.

Binding replacement, Host replacement or detach, Session invalidation, detector policy epoch change,
or explicit Observer revocation fences the Lease. A verified Resume of the same external Session on a
new Host creates a new Observer identity; callbacks from the prior Host remain stale even though the
provider-native Session ID is unchanged.

### One Session-scoped Core command

Every Runtime-specific Hook, native event or ACP extension is normalized into one Session-scoped
compaction observation command. Core transactionally validates the Observer Lease, current Binding ID
and generation, Host/Session route, effective detector policy epoch, exact admission event and source
observation identity before advancing that Binding generation's requested revision.

No active AgentRun is required. If an AgentRun is active, its identity is optional diagnostic context
and grants no authority to this command. The later Delivery Gate consumes the resulting Requirement
under ADR-0138 independently of which Run, if any, observed the compaction.

### Interruption is not compaction evidence

Ordinary Host exit, process crash, Core restart, relay restart, Session detach or missing callback is
not a compaction observation and must not create a Requirement.

Conservative recovery is allowed only after the Observer or relay has already accepted a concrete,
correctly scoped compaction observation but cannot determine whether Core committed its submission.
That `observation_submission_unknown` evidence retains the same source observation identity and may
advance at most one Requirement for its still-current Binding generation. Core commit or later replay
deduplicates against that identity. If the Binding, Host identity or policy epoch is stale, recovery
fences the record rather than applying it to a replacement Session.

The relay stages one private durable outbox record before Core submission. The record contains only
lifecycle metadata and its stable source identity; Core acknowledgement removes it. Core startup or
the matching Host-exit path replays the record before fencing the old Observer, and the Binding-scoped
dedupe key makes commit-before-response loss idempotent. Invalid or stale records are discarded; a
record whose database submission still fails remains for later recovery. This makes the
known-but-unknown boundary explicit rather than inferring it from generic process lifecycle.

## Consequences

- Late completed events remain admissible after the originating AgentRun ends.
- AgentRun business authority is never extended to solve a Session-observation problem.
- A provider-native Session ID alone cannot spoof or revive a stale observation route.
- Host replacement is safe even when the same external Session is resumed.
- Crash recovery creates a conservative false positive only for a known uncertain submission, not for
  every Host lifecycle event.

## Rejected Alternatives

- Bind observations to AgentRun epoch: loses legitimate asynchronous Session events.
- Extend AgentRun leases: over-authorizes tools, prompts and domain mutation after Run completion.
- Trust only provider-native Session ID: cannot distinguish replaced Hosts, Bindings or policy epochs.
- Treat any Host/relay exit as compaction: turns ordinary lifecycle churn into recurring Bootstrap
  injection.
- Drop an acknowledged-by-relay but commit-unknown observation: can permanently lose Bootstrap
  restoration after a real compaction.

## References

- [v0.48 Native Session Compaction Bootstrap Redelivery](../versions/v0.48/README.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](0138-durable-bootstrap-redelivery-requirement.md)
- [ADR-0139: Version-Owned Runtime Policy](0139-version-owned-bootstrap-redelivery-runtime-policy.md)
- [ADR-0140: Runtime-Specific Signal Admission](0140-runtime-specific-compaction-signal-admission-point.md)
- [ADR-0141: Atomic Bootstrap Redelivery Input Overlay](0141-atomic-bootstrap-redelivery-input-overlay.md)
- [Native Session Bootstrap Redelivery Architecture](../architecture/native-session-bootstrap-redelivery.md)
- [ADR-0143: Best-Effort Non-Blocking Compaction Detector](0143-best-effort-non-blocking-compaction-detector-capability.md)
