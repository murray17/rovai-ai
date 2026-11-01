---
slug: "memory-workspace"
primary_target: "apps/desktop/src/renderer/src/MemoryLibrary.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/memory-workspace.css"
  - "apps/desktop/src/renderer/src/MemoryChangeNotice.tsx"
  - "apps/desktop/src/renderer/src/MemoryReviewDialog.tsx"
  - "apps/desktop/src/renderer/src/memory-review-dialog.css"
---

# Memory workspace surface brief

## User goal and first view

Read and manage durable memories with minimal scanning effort. Preserve the shared App rail and typography.
The header has the title, “查看、搜索和管理长期记忆。” subtitle, review/history entry, and neutral primary Add action.
Three quiet inline counts show active memories, active agent-origin memories, and memories due for review.
Loading counts use a dash. A compact dismissible change notice remains visible on the Memory page and in the Thread.
No capacity meters or separate lifecycle/source filter row is shown.

Use the achromatic `--memory-*` family under every App palette, according to its day/night mode. Add and Revise use dark neutral primary actions in day and
inverse light actions at night. Amber means attention; red means error or permanent forgetting. Do not add blue
selection, badges, borders or decoration. Scope neutral overrides to Memory content and portals. The shared sidebar, logo and identity avatars keep their production theme; its pending dot is vertically centered.

## Scope, search and workbench

Tabs are All / Shared / Member / Between members, defaulting to All. Tabs and search narrow the authoritative list;
legacy navigation filters must not invisibly narrow it. Active and retired records remain available; forgotten content
never returns. Search includes complete content, keys, owner, kind and source. Mobile starts with the list and preserves
explicit Back navigation rather than auto-selecting a row.

The desktop list/detail split is always present and selects the first record by default. Compact rows show one-line
previews, owner/type, shared/member/paired avatars and only exceptional due/stopped badges. No extra creation/date row.
The detail header shows the avatar and owner/type, then SVG overflow followed by Revise. Add and Revise share height
and right edge. Only the detail body scrolls; body and retrieval keys sit on a neutral tinted reading surface.
At widths from 1536px, the workspace grows to at most 1920px with a 360–600px catalog; prose stays at most 76ch.
Both 2560px displays and their scaled logical viewports retain the split and aligned actions. Retire, schedule and permanent Forget are in that menu. Source, update time, next review and version are folded
under “详情与版本”; revision history and each revision can expand independently. Full text remains available.

## Notices and Hearth review

Automatic notices distinguish creation from revision and count changed identities, not repeated events. Missing scope
must remain generic until the authoritative record resolves it; never default an unknown revision to Shared. Dismissal
survives a late lookup. View selects the actual changed memory. Pending review remains a distinct notice and persistent
header/rail entry; after resolution the header exposes Review history.

Candidate content is not active memory. A centered modal shows a compact candidate list and one selected detail,
including source, requested action and target/base. Header and action footer remain outside scrolling content.
On Windows, the portal reserves the native WCO title-bar inset and fits the remaining viewport; its close control must
clear native caption buttons as well as the page's drag strip. Close, Escape, backdrop and “返回记忆” always exit,
including during a submitted command; closing never cancels or resubmits that command. Review does not reset the underlying formal scope/search or navigate away from its selection; normal list fallback
still applies if that record is no longer visible. Narrow viewports use previous/next controls and a single candidate.
Editing stays inside the selected detail, with per-item drafts retained across selection and dismissal. Resolving selects
the next candidate; completion offers an explicit return and body-free history.
Fresh items support accept, edit then accept, or reject. Stale revise items support reject only and explain the changed
target. Dismissing changes no domain state. Accepted, rejected and invalidated items are body-free history; never
reconstruct cleared content or describe invalidation as a user rejection.

## Editing and concurrency

Creation chooses scope/type/participants; revision shows immutable identity as quiet context. Body and key chips are
editable, with byte limits and validation retained. Show counters near their limit and errors where the edit happens.
Use aligned, regular-weight 12px labels and a shared platform font across choices, body and keys. Creation choices use
equal-height neutral menu triggers, a checked selected option and keyboard navigation. Keep participant and direction
constraints intact, including the responsible member for one-way relationships. Menus remain inside the viewport.
Cancel/reopen retains an unsubmitted draft for that identity; success clears only that draft. Commands keep expected
versions and exact base Revision. On conflict, retain draft, refresh authority and require explicit retry; never silently
merge. Review actions with an unknown outcome or an acknowledged write followed by a failed refresh disable further
commands until an explicit read-only refresh succeeds. Terminal or removed candidates clear retained editing drafts.
Review scheduling retains its authority-unknown and applied-but-refresh-failed recovery. Forget requires explicit
danger confirmation. Renderer success follows Core, not optimistic presentation.

## Inheritance and validation

Inherit [`DESIGN.md`](../../../DESIGN.md), theme contracts and the
[accessibility baseline](../qa/accessibility.md). This brief owns presentation only; Memory scope,
authority, review policy, capacities, persistence and concurrency remain in current Contracts and Core.
`pnpm test:memory-workspace-ui` exercises production components with an isolated transport fixture, including day/night 2K/scaled layouts, Windows title-bar clearance, review exit paths, draft recovery and failed-refresh protection. Real SQLite,
restart, scheduling conflicts and permanent erasure remain covered by `pnpm accept:memory-ui` against an isolated App.
