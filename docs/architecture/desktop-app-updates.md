---
document_type: architecture
authority: desktop-application-update-component-boundary
status: accepted
last_updated: 2026-08-26
---

# Desktop App Updates

## Component authority

| Component | Responsibility |
| --- | --- |
| Release packaging pipeline | Owns one version-bound Markdown source, embeds it into every platform update manifest and fails release verification when source and manifest differ. |
| Electron Main update service | Owns the single snapshot, check source coalescing, timers, release normalization, prompt generations, download/install mutexes and updater degradation. |
| `electron-updater` adapter | Reads packaged channel configuration, performs provider checks/downloads and synchronously stages the platform installer; it never decides Renderer presentation. |
| Preload bridge | Exposes the closed App Update v2 API to the current Main Window, forwards typed snapshots and carries the private quit-preparation request; no provider object, installer path or credential crosses the bridge. |
| Renderer update controller | Hydrates with `get`, subscribes once, shares the same snapshot across Shell and About, and reports action-call failures without replacing Main facts. |
| App Shell prompt/badges | Projects Main-owned prompt generation and actionable release states without reusing Notification Episode authority. |
| About & Updates | Projects all operation/result states, explicit actions, safe release notes and the narrowly admitted fallback links. |
| Main quit coordinator | Freezes the first native quit reason, waits for the Renderer Draft fence, runs one controlled Core drain and completes an updater-accepted or ordinary exit. |

## Release metadata flow

```text
build/release-notes.md
  -> electron-builder releaseInfo.releaseNotesFile
  -> latest.yml / latest-mac.yml releaseNotes
  -> electron-updater UpdateInfo.releaseNotes
  -> Main bounded release normalization
  -> Renderer SafeMarkdown
```

[`build/release-notes.md`](../../build/release-notes.md) is the only repository-owned release-note source. Its first
non-empty heading binds it to the exact package version. macOS arm64, macOS x64 and Windows builds all consume those same
bytes; release verification compares the parsed manifest value with the source and fails on absence, empty content,
version drift or any byte difference. The macOS merge additionally rejects architecture manifests whose stable release
metadata differs.

The GitHub provider may still use the Releases Atom feed to discover a tag. Manifest `releaseNotes` takes precedence over
the provider's Atom-content fallback, so Rovai does not add a second GitHub REST request or a Renderer network path for
release notes. Provider output remains remote untrusted input after publication; Main and Renderer keep their existing
normalization and safe-rendering boundaries.

## Check and prompt flow

```text
first Main Window did-finish-load
  -> wait 5 seconds
  -> Main check(startup)
     -> updater unavailable/error: keep last valid release, publish check_failed, log only
     -> up to date: clear release/prompt, publish up_to_date
     -> newer valid stable release:
        -> keep bounded normalized release
        -> publish available
        -> create Main-memory {prompt id, version}
        -> Renderer shows one right-bottom prompt only when attentive and unblocked
  -> after the check settles, wait 6 hours and run check(interval)

manual About check
  -> join an existing check or start check(manual)
  -> update the same snapshot
  -> never create a prompt by itself
```

Check source is round metadata, not an updater event property. A set of participants is accumulated while one check
Promise is in flight; automatic participation wins only for prompt generation. A new automatic round gets a new prompt
ID even for the same version. Dismissal is exact-generation compare-and-clear, so a stale Renderer cannot clear a newer
reminder.

`availableRelease` is a fact axis independent of `status`. This prevents a transient network failure from erasing the
known version, release notes, badge or direct download retry target. A successful no-update result is the sole transition
that clears the axis.

## Download and installation flow

```text
available
  -> explicit download
  -> downloading (one shared Promise, determinate progress)
     -> provider completion -> ready_to_install
     -> reject/error/cancel -> download_failed -> explicit retry download

ready_to_install
  -> explicit install and restart
  -> installing
  -> updater synchronously stages installer
     -> rejected/error -> install_failed; App/Core stay usable
     -> accepted -> native before-quit -> Renderer Draft fence -> one controlled Core drain -> app.exit(0)
```

The updater event stream and command Promise can report the same failure. The Main service settles by current state, so
only the first terminal observation changes the snapshot. Download and install actions cannot infer eligibility from a
button; Main checks the current release/status again.

The install order is deliberately updater-first. On Windows the updater can launch the staged installer before calling
`app.quit`; on macOS the native updater owns replacement. Main then intercepts the resulting `before-quit`, waits for the
active Composer's existing leave guard, and finishes the same bounded Planned Shutdown used by ordinary quit. It does
not ask Core to shut down before knowing the installer accepted the request. A Draft preparation failure keeps the
App/Core running and allows a later quit retry.

## Renderer coordination

The update prompt is a dedicated shell projection, not a Core Notification Episode and not a dialog. Notification
heads-up, modal dialogs, Onboarding and shutdown have presentation priority. The prompt has no timer and does not focus
itself. Dismissal changes only Main's in-memory prompt generation; it does not remove the release or badge.

Settings retains two targets in one footer group: the main Settings button restores the persisted last section, while
the sibling update badge deep-links to About without persisting `about`. Both routes use the existing unsaved member
draft guard. The details route confirms the exact release section after paint, focuses its heading, scrolls it into view
and only then dismisses the matching prompt.

Release notes remain remote untrusted text even though the release pipeline originates them from a reviewed repository
file. Main bounds and normalizes them; Renderer renders with the shared SafeMarkdown boundary. The bridge never provides
a download URL or installer path, and the fallback is a fixed product-owned HTTPS destination admitted only for
updater-unavailable or download-failed states.

## Recovery and verification boundary

- Main updater import failure degrades to `updater_unavailable`; it cannot abort App startup.
- Window recreation recovers through `get()` even if a prior changed event was missed.
- Timer disposal and idempotent quit coordination prevent post-quit checks and duplicate Core shutdown.
- Unit tests own source coalescing, prompt generations, retained release, action mutexes, event/reject settlement and
  synchronous install failure.
- Repository tests bind the release-note heading to `package.json.version`; macOS and Windows release verifiers own exact
  source-to-manifest equality, while the macOS merge owns cross-architecture release-metadata equality.
- Renderer tests own the state/action/fallback matrix and safe Markdown; packaged UI acceptance owns Day/Night, compact,
  reduced-motion, focus and overflow. Signed cross-version release qualification remains platform-specific.

## References

- [App Update v2](../contracts/app-update-v2.md)
- [Planned Shutdown](planned-shutdown.md)
- [App Shell navigation](../ui/components/app-shell-navigation.md)
- [macOS packaging](../development/packaging.md)
- [Windows packaging](../development/packaging-windows.md)
