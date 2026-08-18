---
document_type: runtime-contract
contract: planned-shutdown-v2
authority: planned-core-shutdown-durable-fence-terminal-binding-and-settlement
status: accepted
last_updated: 2026-08-13
---

# Planned Shutdown v2

Planned Shutdown v2 inherits v1's Main-only ownership, generation-local launch/terminal/route admission, reliable
Runtime terminal binding, abortive Runtime-terminal settlement, CampTurn aggregation and Desktop watchdog unless this
contract explicitly replaces a rule below. v1 remains historical documentation; current Desktop and Core accept v2
only and do not negotiate mixed-version shutdown.

## 1. Request and durable intent

Electron Main sends:

```json
{
  "id": 41,
  "method": "core.shutdown",
  "params": {
    "protocolVersion": 2,
    "deadlineMs": 10000
  }
}
```

Core accepts only protocol version `2`; the v1 deadline range and Main-only exposure remain unchanged. Before closing
the in-memory launch gate, Core persists one `planned_shutdown_cycle` keyed by its generation. A valid row contains the
protocol version and request time and is initially unsettled. Repeating the same generation is idempotent; a conflicting
protocol is rejected.

Persisting first is intentional: Runs that cross a previously admitted launch handoff before the gate closes are still
covered by the same cycle. If shutdown ends before the record commits, the execution is ordinary crash recovery rather
than a completed controlled-shutdown request.

## 2. Runtime terminal priority and product-fence cutoff

Core continues the v1 sequence through launch closure, planned stop, bounded reliable-terminal wait, terminal/route
admission close, tracked callback abort and guard drain. Reliable matching Runtime terminal observations settle first and
retain the v1 `terminal_resolution_source = runtime_terminal` and `planned_shutdown_*` reason codes.

After terminal and live Runtime route admission are closed and drained, Core closes the Built-in Tool listener, fences
its invocation gate, aborts and drains tracked AgentRun/event writers, and settles the durable shutdown cycle in one
immediate database transaction. Every AgentRun still in `queued | running | waiting` is changed to:

```text
status = cancelled
wait_reason = null
runtime_recovery_required = false
execution lease = cleared
manual_retry_allowed = false
ended_at = settlement time
terminal_resolution_source = null
terminal_reason_code = null
last_error_code = planned_shutdown_cancelled
               | planned_shutdown_outcome_unknown
```

`planned_shutdown_outcome_unknown` is required whenever accepted/delivery-unknown input or another unsettled external
effect remains. Null Runtime-terminal fields are normative: product fencing closes Rovai execution authority but does
not claim a Provider terminal outcome.

The transaction fences Run-local obligations as follows:

- possibly dispatched Action → `unknown/active`, still owned by the reconciler;
- definitely undispatched Action → `not_executed`;
- pending Approval → cancelled with controlled-shutdown reason;
- unfinished Runtime Delivery → `safely_closed`;
- accepted Runtime Input → unchanged;
- delivery-unknown Runtime Input → unchanged;
- prepared Runtime Input → `delivery_unknown`, not `not_accepted`;
- AgentRun terminal, target Message Delivery, CampTurn aggregate and shutdown cycle settlement → same transaction.

The fence never creates `camp_turn.cancel_requested_at` or `agent_run.cancel_requested_at`. A pre-existing explicit
CampTurn Stop intent remains authoritative and may aggregate to cancelled; without it, required fenced cancellation
produces failed / `required_run_incomplete`, while optional cancellation does not block completion.

The transaction is admissible only after those writer fences have quiesced. If any prerequisite misses its bounded
window, the live generation does not publish a terminal that a late writer could contradict; it exits with the cycle
still pending, and Section 3 performs the same settlement after the old process is gone.

## 3. Startup compensation

On Core startup, after schema migration and before generic `prepare_v2_recovery`, Core loads every unsettled
`planned_shutdown_cycle` in request order and runs the same product-fence transaction. This step is idempotent:

- a settled cycle is never applied twice;
- already terminal AgentRuns remain unchanged;
- the original input is never sent, resumed or copied into a successor;
- a terminal fenced Run never becomes `runtime_recovery`, `delivery_unknown` waiting or `recovery_blocked`;
- Skill/MCP terminal cleanup may reconcile after the database transaction, but it cannot reopen the Run.

Generic crash recovery remains unchanged when no pending controlled-shutdown cycle exists.

## 4. Read model and Renderer

A product-fenced Run is a normal terminal `cancelled` Run. If its input or effects remain uncertain,
`hasUnsettledExternalEffects = true` and Renderer shows the existing terminal warning “外部效果待确认”. It must not
show a spinner, “恢复中”, “投递待确认” or “结果待确认”, and it must not offer automatic retry or blocker resolution.

The controlled-shutdown overlay states that Rovai first waits for reliable Runtime terminal results, then stops any
execution it cannot confirm while retaining external-effect evidence for later inspection. It does not claim rollback.

## 5. Report and deadline

The v2 response is:

```json
{
  "protocolVersion": 2,
  "status": "completed",
  "deadlineExpired": true,
  "activeExecutionsObserved": 2,
  "stopRequestsIssued": 2,
  "terminalExecutionsSettled": 1,
  "fencedAgentRunsSettled": 1,
  "unsettledEffectAgentRuns": 1,
  "controlledShutdownCyclePersisted": true,
  "unresolvedExecutions": 0
}
```

`terminalExecutionsSettled` counts reliable Runtime terminals only. `fencedAgentRunsSettled` counts AgentRuns closed by
the product fence, including queued or waiting Runs outside the active registry. `unsettledEffectAgentRuns` is the
subset of product-fenced Runs retaining unknown effects. `unresolvedExecutions` is measured after both settlement modes;
normal completion therefore returns zero even when effect evidence remains uncertain.

`deadlineExpired` retains the v1 drain-window meaning. It is normally `true` when an active Runtime did not produce a
reliable terminal before the cutoff and therefore required the product fence; this does not imply that product
settlement failed. `controlledShutdownCyclePersisted=false` means Core could not commit the durable intent and therefore
did not claim product-fence/startup-compensation authority for that request; ordinary crash recovery remains in force.

Core reserves a bounded product-fence window before Runtime reap and stdout flush. If the hard deadline or Desktop
watchdog interrupts that transaction, the pending durable cycle performs the same settlement on next startup. The
watchdog timing and forced-signal escalation remain v1-compatible.

## References

- [Planned Shutdown v1 (historical)](planned-shutdown-v1.md)
- [ADR-0177](../versions/v0.71/decisions.md#adr-0177)
- [Planned Shutdown architecture](../architecture/planned-shutdown.md)
- [Accepted Input Recovery v1](accepted-input-recovery-v1.md)
- [Run Process Detail Surface v5](run-process-detail-surface-v5.md)
