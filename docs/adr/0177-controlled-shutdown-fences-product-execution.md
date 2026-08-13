---
document_type: adr
id: ADR-0177
title: Controlled Shutdown Fences Product Execution Without Claiming Runtime Outcome
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.71
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0177: Controlled Shutdown Fences Product Execution Without Claiming Runtime Outcome

## Context

ADR-0168 preserved Runtime terminal authority during an intentional quit, restart or update. When an Adapter could
not report a reliable terminal before the deadline, the AgentRun remained non-terminal and became an accepted-input
or delivery-unknown recovery blocker after restart. This avoided inventing a Runtime outcome, but it left Rovai's own
execution lifecycle open even though the user had explicitly closed the application and the old Core generation could
never execute that Run again.

ADR-0062 already separates Rovai execution authority from external-effect certainty. A controlled shutdown can
durably revoke the former without claiming the latter, provided the shutdown intent and fence survive interruption and
the original input is never replayed.

## Decision

1. A valid Main-only controlled-shutdown request first persists a durable shutdown cycle, then closes launch admission.
   The cycle is the authority to finish fencing every AgentRun that remains non-terminal at its settlement boundary.
2. The live Core generation still gives matching Runtime terminal observations priority during its bounded drain.
   Reliable success, failure or cancellation retains the existing `runtime_terminal` provenance.
3. After terminal and live-route admission closes, Core must also stop or fence every tracked execution writer,
   including AgentRun tasks and Built-in Tool invocations. It then product-fences every remaining non-terminal AgentRun
   into `cancelled`. This terminal means Rovai has permanently revoked that execution's write and scheduling authority;
   it does not mean the Provider proved that its Native Turn was cancelled. The settlement does not create a CampTurn
   user cancellation intent and does not write Runtime-terminal provenance. If writer quiescence cannot be proved in
   the bounded window, Core leaves the durable cycle pending for next-start compensation instead of publishing an
   unsafe terminal.
4. Runtime Input Delivery and external-effect evidence remain independent. `accepted` and `delivery_unknown` are
   preserved. A `prepared` input at this boundary becomes `delivery_unknown`, because prompt handoff may already have
   occurred without a durable ACK. Unknown dispatched Actions remain reconcilable. The read model must continue to show
   unsettled external effects on the terminal Run and must never retry the original input automatically.
5. If Core or Desktop exits after the cycle is persisted but before settlement commits, the next Core generation
   settles every pending cycle before ordinary startup recovery. Once a cycle is settled, recovery is idempotent and
   cannot restore execution authority to its cancelled Runs.
6. A crash, force-kill or power loss before a controlled-shutdown cycle is durably recorded remains ordinary crash
   recovery. This decision does not claim generic cross-process Native Turn reconciliation.

This decision locally replaces ADR-0168's rule that every accepted input lacking a reliable shutdown terminal must
remain a non-terminal startup blocker. It also narrows ADR-0164 only for AgentRuns covered by a durable controlled-
shutdown cycle; ordinary crash recovery remains unchanged.

## Consequences

- Closing Rovai no longer leaves a planned-shutdown AgentRun indefinitely displayed as active or waiting.
- Users can reopen the application and see a terminal Run while still receiving an explicit warning when files,
  commands, tools or other external effects may be unresolved.
- Core owns a durable shutdown-cycle ledger, an idempotent product-fence settlement and a startup compensation step.
- The shutdown report distinguishes reliable Runtime terminal settlement from product-fenced terminal settlement.
- A controlled shutdown may fail a CampTurn whose required Run was product-fenced, while optional fenced Runs do not
  prevent completion. `CampTurn.cancelled` still requires an explicit user cancellation intent.
- Cross-process automatic continuation of an in-flight Native Turn remains unavailable unless an Adapter separately
  proves the reconciliation capability required by ADR-0164.

## Rejected Alternatives

- **Keep recovery blockers after every controlled shutdown.** This preserves uncertainty by leaving product execution
  authority open, even though the old generation can never use it again.
- **Label process exit or interrupt acknowledgement as a Runtime cancellation.** Neither observation proves the Native
  Turn outcome and both would forge `runtime_terminal` provenance.
- **Rewrite uncertain input as not accepted.** Prompt bytes may have crossed the handoff boundary before ACK loss, so
  this could authorize a duplicate retry.
- **Automatically resend or resume the Run after restart.** Current Session resume does not reattach the same Native
  Turn and may duplicate model work, tools and external effects.
- **Reuse CampTurn Stop.** Application shutdown is not a user decision to cancel the whole CampTurn tree, and writing
  that intent would change sibling and aggregate semantics.
- **Wait indefinitely for Provider confirmation.** A hung Runtime would retain authority over whether Rovai can exit.

## References

- [v0.71 current version](../versions/v0.71/README.md)
- [ADR-0062: Interruptible Runs and Unsettled External Effects](0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0164: Accepted Input Recovery Requires Proven Native Turn Reconciliation](0164-accepted-input-recovery-requires-proven-native-turn-reconciliation.md)
- [ADR-0168: Planned Shutdown Preserves Runtime Terminal Authority](0168-planned-shutdown-preserves-runtime-terminal-authority.md)
- [Planned Shutdown v2](../contracts/planned-shutdown-v2.md)
- [Planned Shutdown architecture](../architecture/planned-shutdown.md)
