---
document_type: contract
name: Runtime Launch and Verification
version: v17
status: accepted
source_version: v1.22
last_updated: 2026-08-21
---

# Runtime Launch and Verification v17

v17 replaces [v16](runtime-launch-and-verification-v16.md). Launch, Session, Runtime process, public command,
retry diagnostic and terminal failure boundaries remain unchanged. This version makes a Runtime update during a
manager-owned Deep Probe a bounded supersession instead of a stable Runtime result, and separates a retained model
catalog from the current executable's Ready evidence.

## Complete-Probe identity check

For each complete Deep Probe, the Check Manager reads the executable's lightweight `ExecutableFileIdentity` before
starting the Probe, awaits the full `Result<RuntimeDeepProbeResult>`, then reads the identity again before classifying
the result.

- if the first identity read fails, the existing successful or failed Probe handling remains authoritative;
- if both reads succeed and are equal, the Probe result is stable;
- if the first read succeeds and the second differs or fails, the Probe is `Superseded`;
- the same classification covers direct errors and `runtime_probe_stdout_cleanup_timed_out` /
  `runtime_probe_stderr_cleanup_timed_out`; a cleanup timeout remains a stable failure only when identity is unchanged.

A Superseded Probe writes no capability snapshot, Probe failure, Runtime diagnostic or public `lastProbeAttempt`.
Successful and failed results are both discarded, so evidence from two executable versions cannot be combined.

## Bounded rebind and outcome

The internal Check Manager outcome is closed:

```text
Ready | StableFailure | Superseded
```

After the first Superseded result, the same manager attempt waits approximately 300 ms without crossing its existing
absolute deadline, resolves and canonicalizes the current executable again, computes one current SHA fingerprint and
runs at most one more complete Deep Probe. Both Probe executions share one attempt ID, one per-Runtime single-flight
slot and the original 90-second absolute deadline. Rebinding does not reuse the first candidate fingerprint and never
creates a second external Check request.

A stable second failure is persisted against the rebound candidate path/fingerprint. If both Probe executions are
Superseded, the attempt finishes `Superseded`: Catalog Open returns `refreshStatus = deferred`, explicit Product Check
returns `outcome/status = deferred`, and Dispatch remains queued/blocked without a Runtime failure settlement. Only
`Ready` releases execution waiters. Supervisor timeout/panic behavior remains the inherited stable manager failure.
After an Execution-triggered attempt finishes Superseded, the Check Manager keeps a process-local deferral fence for
that Runtime: repeated Scheduler ticks remain queued without opening another Probe attempt. Catalog Open or explicit
Product Check clears the fence and may create the next bounded attempt. This fence is not persistent Runtime health.

## Current Ready evidence and retained LKG

When discovery proves a new executable fingerprint before a successful Deep Probe, the current snapshot uses the new
fingerprint and a static `light_ready` status. It does not inherit the prior fingerprint's capabilities, protocols,
authentication evidence, dynamic permission evidence, native Session compatibility or dispatch Ready qualification.
The previous Deep Probe cannot satisfy current-fingerprint Dispatch Preflight.

The discovery transaction may retain only the last successful Deep Probe's model descriptors and
`lastSuccessfulProbeAt`. That catalog is projected `stale` immediately, even when the success is younger than 60
seconds, and continues to use the original success timestamp for the inherited 24-hour service limit. At or beyond 24
hours it is `expired` and no models are served. A successful current-fingerprint Deep Probe atomically replaces the LKG
and establishes Ready; a stable failure preserves the LKG without granting execution qualification.

Public `lastProbeAttempt` selects only the latest historical attempt whose executable fingerprint matches the current
snapshot fingerprint. Older attempts remain stored for diagnostics but cannot classify the current Runtime or model
refresh.

## Public wire additions

```ts
type RuntimeModelCatalogRefreshStatus =
  | 'not_required' | 'scheduled' | 'joined' | 'completed' | 'failed' | 'deferred'

interface ProductRuntimeCheckResult {
  scheduled: true
  completed: true
  ready: boolean
  outcome: 'ready' | 'stable_failure' | 'deferred'
  status: 'ready' | 'stable_failure' | 'deferred'
  runtimeKind: AdapterKind
}
```

`deferred` is neutral: it does not supply a diagnostic code and does not mean authentication, compatibility or Runtime
failure. Renderer may continue showing a serviceable stale LKG while describing the refresh as deferred.

## Acceptance

- an atomic replacement during the first Probe discards its result and a stable second Probe can commit Ready;
- a stable second failure is recorded against the rebound path/fingerprint;
- replacement plus an updater-held stdout/stderr pipe does not persist the obsolete cleanup failure;
- an unchanged executable with a descendant-held pipe preserves the cleanup timeout;
- two consecutive replacements execute at most two Probes and finish deferred without a public failure;
- fingerprint change revokes prior Ready immediately while a non-expired catalog remains stale LKG;
- retained freshness is never reset or extended, and an old-fingerprint failed attempt is not public current state.

## References

- [Runtime Launch and Verification v16](runtime-launch-and-verification-v16.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [V1.22-D01](../versions/v1.22/decisions.md#v1-22-d01)
