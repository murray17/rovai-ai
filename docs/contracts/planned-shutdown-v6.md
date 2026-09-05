---
document_type: protocol-contract
contract: planned-shutdown-v6
authority: renderer-draft-preparation-before-planned-shutdown-and-runtime-cleanup
status: accepted
version: 6
source_version: v1.49
last_updated: 2026-09-05
---

# Planned Shutdown v6

v6 inherits [v5](planned-shutdown-v5.md)'s `protocolVersion = 3` wire, ten-second Core hard deadline, durable cycle,
cancelled business settlement, writer/route barriers, Runtime cleanup and report shape. The Core protocol and shutdown
overlay do not change. This version adds a Desktop precondition before Main invokes the existing protocol.

## Desktop pre-shutdown fence

The existing `AppQuitCoordinator` freezes and prevents the first normal, update-install or application-closing Main
Window quit request. Before any service drain or `CoreClient.shutdown()`, it requests the loaded Renderer to prepare for
quit over a private one-request response channel. A missing, destroyed or still-loading Renderer has no mounted
Composer authority and is a no-op. The bridge does not expose `core.shutdown` or process-lifecycle authority to
Renderer.

Renderer reuses the matching active-Camp `CampLeaveGuard` defined by
[Camp Composer Draft v11](camp-composer-draft-v11.md). A successful response proves attachment preparation, latest
Lexical EditorState flush and the existing Draft mutation queue have completed against Core authority. Only after that
response may Main stop application services and start Planned Shutdown.

If preparation rejects or the response channel fails, the current quit attempt ends without service drain,
`core.shutdown` or `app.exit`. Renderer preserves the active Camp and Draft, restores Composer interaction and displays
the existing save failure; the next native quit starts a new preparation attempt. Repeated requests during one active
attempt remain coalesced.

## Renderer presentation

Draft preparation precedes `runtime.state = shutting_down`. The existing delayed “正在安全退出” overlay continues to
mean Core planned shutdown, AgentRun cancellation and Runtime cleanup only. No new exit state, overlay, modal,
`beforeunload` persistence or Renderer shutdown coordinator is admitted.

## References

- [Planned Shutdown v5 (historical)](planned-shutdown-v5.md)
- [Camp Composer Draft v11](camp-composer-draft-v11.md)
- [Planned Shutdown architecture](../architecture/planned-shutdown.md)
- [Runtime recovery and shutdown invariants](../architecture/foundational-invariants.md#runtime-recovery-shutdown)
