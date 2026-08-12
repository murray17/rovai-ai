---
version: 1
slug: "member-workspace"
primary_target: "apps/desktop/src/renderer/src/MemberManagement.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/MemberSidebar.tsx"
  - "apps/desktop/src/renderer/src/MemberAvatar.tsx"
  - "apps/desktop/src/renderer/src/MemberPortrait.tsx"
  - "apps/desktop/src/renderer/src/MemberAvatarCropper.tsx"
  - "apps/desktop/src/renderer/src/MemberRuntimeParameters.tsx"
---

# Member workspace surface brief

## User goal

Inspect the current roster, understand each teammate's role and availability, and safely create,
edit or remove a teammate without confusing identity with Runtime state.

## Information priority

1. Source-aware return, page title and the active roster.
2. Selected teammate identity, team role, Presence and Runtime availability.
3. Professional profile, work principles and personality background.
4. Runtime configuration and the default-collapsed Runtime Parameters.
5. Memory Capability and destructive removal.

## First view and layout

Use the shared 270px App rail. Inside the page, keep the roster as the stable navigation column and
the selected teammate as the flexible detail surface. At narrow supported widths the roster is 250px;
the detail scrolls internally instead of shrinking identity or actions below usability.

The header uses the controlled portrait plus a separate circular icon. Presence and Runtime are two
distinct badges: “在队” is static; “{Runtime} 可用 →” uses arrow, hover, focus and an accessible name to
show it opens existing Runtime configuration. Never merge the two meanings.

## Roster and order

Roster order comes from the authoritative Member Order. Reordering is explicit, keyboard accessible
and preserves selection. Identity color and avatar remain stable across reorder. Loading or partial
Runtime health must not reorder or hide teammates.

## Detail and editing

Identity editing uses the existing composite avatar asset: circular crop drag, zoom, keyboard nudge
and actual-size previews. The durable asset and fallback rules are in
[`member-identity.md`](../../../../docs/ui/components/member-identity.md).

“运行配置” retains the product Runtime, model, reasoning, permission and sandbox fields exposed by
that Runtime. The Runtime, model and permissions save atomically through the existing command. Keep
“运行参数” present and collapsed by default. Do not restore the removed “高级设置”, summary-model
configuration or “对话压缩模型”.

After Runtime configuration, keep Memory Capability and the danger zone. Do not expose Installation
IDs, executable paths or internal bindings in the ordinary profile.

## Removal

Permanent removal is blocked while the teammate owns a non-terminal AgentRun. Otherwise the Chinese
confirmation shows the Camps they will leave and the number of unfinished Tasks whose responsibility
will be released. The Renderer presents the Core preview and result; it does not independently close
membership, Task or Lead state.

On conflict or failure, keep the dialog, selection, draft edits and focus. Do not claim partial
removal succeeded.

## Inheritance and hard boundaries

Inherit root [`DESIGN.md`](../../../../DESIGN.md), both theme contracts, the shared accessibility
baseline and [member identity contract](../../../../docs/ui/components/member-identity.md). This brief
cannot change AgentProfile fields, Member Order semantics, Runtime catalogs, removal transactions or
Memory authority.
