---
document_type: protocol-contract
contract: mission-v14
authority: mission-workspace-reads
status: accepted
version: 14
last_updated: 2026-11-01
---

# Mission v14

Inherits [Mission v13](mission-v13.md). This version replaces the inherited whole-view equality
requirement for `missions.fileDiff`; request and response fields, storage and model context are unchanged.

`missions.changes` still reads cumulative final content against the workspace's fixed `baseSha`, including
committed, staged, unstaged and untracked files. A bounded process-local `viewId` associates the Mission,
workspace ID/path/generation and `fileId` with Git's trusted raw path or rename path pair. It stores neither
historical file bytes nor a retained temporary index. Renderer cannot supply another path.

`missions.fileDiff` verifies that association and the current workspace's canonical identity, registration,
owner and fixed base. It then prepares a request-owned private index only for the selected existing leaf
paths and reads raw metadata, line statistics and patch together in one path-scoped Git Diff. Copying the
real index and shared index remains permitted; neither is written. Absent selected paths do not trigger an
unqualified `git add`, and a selected file replaced by a directory does not expand the read to its children.
Intermediate links cannot redirect the selected path outside the workspace. Existing Gitlink entries retain
their submodule semantics. External Diff and textconv remain disabled.

Other files, checkout branch or HEAD may change without invalidating this selection. Diff remains against
the fixed `baseSha`; no branch switching or historical-content reconstruction occurs. The response's file
kind, paths, modes, binary flag and statistics describe the same current target read as its patch. A tracked
target removed since listing can return its deletion. A target with no remaining difference, a lost mapping,
or a rename pair that no longer identifies one item uses `mission.changes_refresh_required`; it does not
guess a new path. Workspace replacement, cleanup or generation change still invalidates the old handle.
The existing post-read database fence remains required. Real Git/I/O errors remain errors.

Renderer retains its existing list, aggregate totals, per-file cache, request coalescing, late-response
isolation and explicit refresh action. The selected detail's header, icon, path, copied path and statistics
use `fileDiff.file`, while list totals continue to describe the list read. Unrelated changes alone do not
require refreshing that list before opening an uncached detail. This remains a dynamic read, not an atomic
filesystem snapshot, new cache or background refresh service.

Creation, patch application, cleanup, current execution ownership and the conservative Mission lifecycle
gate fallback from v13 are unchanged.
