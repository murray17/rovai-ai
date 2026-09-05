---
document_type: interface-contract
contract: camp-composer-draft
version: 11
status: accepted
authority: camp-composer-document-revision-load-mutation-navigation-app-quit-and-send
last_updated: 2026-09-05
---

# Camp Composer Draft v11

v11 inherits [v10](camp-composer-draft-v10.md)'s closed V2 wire, Lexical and Coordinator authority, exact revision,
autosave, routing, send, attachment, Pending and ordinary navigation semantics. This version adds one application-quit
fence: a controllable normal exit must make the latest active Lexical `EditorState` Core Draft authority before Planned
Shutdown starts.

## Application-quit preparation

Electron Main retains quit authority. Its existing `AppQuitCoordinator` prevents the first native quit and sends one
private preparation request to the loaded Main Window Renderer before service drain or `core.shutdown`. The Renderer
callback reads the current view, active Camp ID and registered `CampLeaveGuard` from live refs. It returns immediately
unless the current view is `camp` and the registration matches that exact Camp.

A matching callback invokes the existing guard while `CampWorkspace` is still mounted. The guard keeps sole ownership
of the synchronous Composer interaction lock, attachment-preparation wait, latest EditorState flush,
`DraftMutationCoordinator` idle wait, Core exact revision and Pending settlement. After successful preparation the
callback calls `complete(true)`; App and Main do not reproduce any Draft or attachment logic.

```text
native quit request
  -> AppQuitCoordinator prevents exit
  -> Renderer preparation request
  -> matching CampLeaveGuard
  -> attachment preparation
  -> latest Lexical EditorState flush
  -> DraftMutationCoordinator idle / Core Draft authoritative
  -> preparation acknowledgement
  -> existing Planned Shutdown
```

On Windows and Linux, closing the Main Window is intercepted before that Renderer is destroyed and enters the same
coordinator. macOS keeps its existing close-window application semantics; native Quit and accepted update installation
enter the coordinator through `before-quit`. Repeated quit requests while preparation or drain is active do not create a
second request.

## Failure and presentation boundary

If the guard or its persistence work fails, Renderer keeps the same Camp and Lexical content mounted, restores Composer
interaction through the guard and shows the existing Draft save failure. Main does not start service drain,
`core.shutdown` or `app.exit`; it clears the in-flight quit attempt so a later user quit retries the same preparation.

The existing shutdown overlay is unchanged. Draft preparation happens before Core publishes
`runtime.state = shutting_down`, so it creates no new quit state, page, dialog or `beforeunload` path. Once preparation
succeeds, Planned Shutdown continues to own AgentRun cancellation, Runtime cleanup, deadline and terminal exit.

## References

- [Camp Composer Draft v10 (historical)](camp-composer-draft-v10.md)
- [Planned Shutdown v6](planned-shutdown-v6.md)
- [Composer architecture](../architecture/camp-composer-draft.md)
- [Planned Shutdown architecture](../architecture/planned-shutdown.md)
