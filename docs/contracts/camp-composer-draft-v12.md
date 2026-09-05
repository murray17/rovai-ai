---
document_type: interface-contract
contract: camp-composer-draft
version: 12
status: accepted
authority: camp-composer-draft-window-close-preparation
last_updated: 2026-09-05
---

# Camp Composer Draft v12

v12 inherits [v11](camp-composer-draft-v11.md)'s Draft protocol, navigation guard and App-quit fence unchanged.
It extends the same preparation to standalone macOS Main Window close (red close control / Cmd+W).

## macOS close-only fence

Main prevents the native window close before its Renderer is destroyed and requests the existing Renderer preparation.
The Renderer reuses the same matching active-Camp `CampLeaveGuard`: lock Composer, wait for attachments, flush the
latest Lexical state and settle the Draft mutation queue. No separate Draft store, save path or lifecycle coordinator
is introduced.

After preparation succeeds, Main resumes only that window's native close. It does not stop application services,
invoke `core.shutdown()`, cancel AgentRuns, close Runtime processes or exit the App. The ordinary macOS reopen path
remains available. Windows/Linux window close and macOS Cmd+Q/update-install retain the existing App-quit flow.

Repeated close requests are coalesced while preparation is pending. If Cmd+Q overlaps a close-only request, both
callers await the same per-window preparation result; only the App-quit caller enters Planned Shutdown. This shared
promise is transient and is removed on either success or failure, with no Draft or revision cached in Main.

Preparation failure keeps the window and current Draft mounted, with the existing guard restoring Composer
interaction and showing its save error. No close or shutdown follows; another user close can retry. A destroyed window
is never closed again by a late completion. Missing or still-loading Renderers retain v11's no-op preparation rule.

Draft preparation still precedes `runtime.state = shutting_down`; standalone close creates no shutdown overlay or
new Renderer state. The [Planned Shutdown v6](planned-shutdown-v6.md) Core contract is unchanged.
