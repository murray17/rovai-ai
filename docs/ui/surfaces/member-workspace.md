---
slug: "member-workspace"
primary_target: "apps/desktop/src/renderer/src/MemberManagement.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/MemberSidebar.tsx"
  - "apps/desktop/src/renderer/src/MemberRosterLayout.tsx"
  - "apps/desktop/src/renderer/src/MemberAvatar.tsx"
  - "apps/desktop/src/renderer/src/MemberAvatarCropper.tsx"
  - "apps/desktop/src/renderer/src/MemberRuntimeParameters.tsx"
---

# Member workspace surface brief

## User goal

Inspect the current roster, understand each teammate's role and availability, and safely create,
edit or remove a teammate without confusing identity with Runtime state.

## Information priority

1. The persistent App navigation and the active roster.
2. Selected teammate identity, team role, Presence and Runtime availability.
3. Professional profile, work principles and personality background.
4. Runtime configuration and the directly visible Runtime Parameters.
5. Memory Capability and destructive removal.

## First view and layout

Use the shared App rail on the teammate page; its width and complete collapse follow the App Shell contract.
All split boundaries, including the roster, highlight their full 1px line with `--resize-line` on hover or drag; never add a short thicker grip.
The roster shares the detail's workspace
surface (white in Day), with a 1px divider separating the two reading planes. Its default width is 256px;
expanded widths range from 192px to 360px and protect 400px for the detail when space permits.
Use the shared fold gesture from [DESIGN.md](../../../DESIGN.md#components), folding to a 76px avatar rail.
Dragging a collapsed rail to 208px expands it. Escape restores the pre-gesture layout; blur, lost capture and
container-width changes settle the last observed position. Page changes discard the stale gesture.
The 9px pointer target stays mounted through collapse and supports dragging open again.
Expanding restores the useful width before the collapse gesture. Remember width and
collapse locally; viewport clamping does not overwrite
the chosen width. Double-click or Home restores 256px, arrows resize and collapse/expand at the boundary,
and Enter toggles collapse. The separate collapse button and roster options menu are absent. A reorder gesture temporarily disables
the splitter. The detail scrolls internally instead of shrinking identity or actions below usability.

The header uses one compact avatar, name, role and Presence. Remove the repeated Runtime shortcut from this
header; the roster and Runtime configuration retain their existing status and navigation. The entire overflow
button keeps hover, open and touch feedback outside the window drag region. Avatar changes open a dialog directly.

## Roster and order

Roster order comes from the authoritative Member Order. Reordering is explicit, keyboard accessible
and preserves selection. Identity color and avatar remain stable across reorder. Loading or partial
Runtime health must not reorder or hide teammates.

Roster rows keep a 40px circular image, 13px name and 11px role in a 60px row without inter-row gaps.
Use a subtle selected surface without a selection rail and keep the Runtime column aligned. The header shows the total
once; omit the redundant “在队” group when every teammate is present. If any teammate is away, show
the meaningful presence groups and their counts. Above eight members, offer compact name/role search;
the title reports matching / total counts while filtering. Keep one compact “+ Add” action with a separate dropdown arrow,
without an enclosing border or divider; each button has neutral hover/focus feedback and a 44px mobile touch height.
AI conversation remains the default, manual creation stays in its dropdown. New AI conversations prefill the localized,
editable request defined by Member Creation Flow v1 without sending; language changes and return navigation preserve edits.
Reorder rows directly
(on mobile, drag the avatar); preserve the avatar without an overlay handle. Alt+Up/Down and row context-menu
actions provide keyboard movement within the same presence group. The resize divider remains available.
Runtime shortcuts show the existing product logo in a 22px carrier; an unconfigured teammate uses a neutral
minus glyph. Attention, unsupported and unqualified states add a small `!` marker. Loading retains the
product identity with a checking label. Each shortcut has an accessible action label and product tooltip;
only checking or actionable states add status/detail. It scrolls
to that teammate's Runtime configuration. A small dirty dot and accessible “有未保存更改” label identify pending edits.
`ready`、`light_ready` 和 `installed_unverified` 不附加“可用”或“可尝试运行”，也不在 tooltip、accessible
label 或配置区常驻解释验证机制。配置区保留已知版本。加载或复扫期间保留产品图标并按现有状态标注检查中，
不得把延迟验证画成失败。

## Detail and editing

Keep the fixed personal-profile entry above the roster, outside counts, search and ordering.
It remains clickable outside the native window drag region. Its form, avatar and save behavior follow
[Current User Profile](../components/member-identity.md#当前用户个人资料).

Runtime configuration retains each product's model, reasoning, permissions and sandbox fields;
“运行参数” stays visible in the vertical reading flow, without an “高级设置” group or a second model configuration.
Model selection, drafts, conflict handling and native parameter behavior follow the
[member configuration contract](../components/member-identity.md#队员配置页).
Keep Runtime names and known versions; show actionable failures without permanent verification explanations.
Boolean permission switches use the selected theme's action tokens on Desktop, Web and Mobile.
Kiro's `trust_all_tools` uses the compact switch labeled “自动允许全部工具”, initialized from Core.

Product visibility and qualification come from [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md);
platform admission precedes machine availability. Frozen Runtime configurations preserve their exact saved values
while unrelated profile fields remain editable, as defined by the [platform rules](../windows-interaction-delta.md#4-runtime-平台准入与机器可用性).
Kimi's read-only workspace projects effective `plan`; provider credentials remain private. Upstream thinking tags
reported as ordinary assistant text retain the same presentation as other ACP text.
Pi shows model fields only; it has no Rovai approval or sandbox configuration.

Presence and permanent removal stay in the header overflow menu. Removal preview, blockers, confirmation and failure
recovery follow [permanent removal](../components/member-identity.md#永久移除影响). Ordinary profiles do not expose
Installation IDs, executable paths or internal bindings.

## Inheritance and hard boundaries

Inherit root [`DESIGN.md`](../../../DESIGN.md), the [theme registry](../themes/README.md), the shared accessibility
baseline and [member identity contract](../components/member-identity.md). This brief
cannot change AgentProfile fields, Member Order semantics, Runtime catalogs, removal transactions or
Memory authority.

## Inline configuration composition

The right pane is one continuous page: “身份信息” followed by “运行配置”, without tabs or a portrait column.
Name and team role share a row when space permits; professional responsibilities follow. Personality,
principles and growth share the collapsed “更多设定” disclosure and optional “已设置” label.
The compact header and form become one column when space narrows.

Each section has its own “放弃更改” and theme primary save control: a 14px outline save icon plus “保存”,
with accessible names “保存队员信息” / “保存运行配置”. Section drafts, validation, conflicts, partial saves,
avatar selection and crop behavior follow the [member configuration contract](../components/member-identity.md#队员配置页).
The pending new teammate has a separate bottom roster row, excluded from saved counts and ordering;
Runtime configuration becomes available after creation.

The Runtime picker retains product icons; the model label is “模型” and its Runtime-default caption is “默认”.
Keep native dropdown geometry and restrained 1px input boundaries; focus treatment follows DESIGN.
Do not add another Runtime parameters heading to the continuous form.

“应用到其他队员 →” remains a secondary text action in the Runtime save row; on mobile it uses its own left-aligned row.
Its snapshot, selection, per-target results and recovery follow
[apply Runtime configuration](../components/member-identity.md#应用运行配置到其他队员).
Environment editing follows [member environment variables](../components/member-identity.md#队员环境变量),
using the enclosing section's save/discard state without an additional saved message.

All registered palettes share this geometry and state model. Validation commands and fixture boundaries are in the
[member UI acceptance guide](../../development/ui-acceptance.md#队员页内容名册门禁).
