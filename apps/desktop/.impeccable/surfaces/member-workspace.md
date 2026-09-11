---
version: 11
slug: "member-workspace"
primary_target: "apps/desktop/src/renderer/src/MemberManagement.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/MemberSidebar.tsx"
  - "apps/desktop/src/renderer/src/MemberRosterLayout.tsx"
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

1. The persistent App navigation and the active roster.
2. Selected teammate identity, team role, Presence and Runtime availability.
3. Professional profile, work principles and personality background.
4. Runtime configuration and the directly visible Runtime Parameters.
5. Memory Capability and destructive removal.

## First view and layout

Keep the shared 270px App rail visible on the teammate page. The roster shares the detail's workspace
surface (white in Day), with a 1px divider separating the two reading planes. Its default width is 256px;
expanded widths range from 192px to 360px and protect 400px for the detail when space permits.
Dragging below 176px snaps to the same 76px avatar rail as the explicit collapse button; dragging a
collapsed rail past 208px expands it. The different thresholds prevent jitter around the boundary.
The 9px pointer target stays mounted through collapse so the gesture can reverse without losing capture.
Expanding with the button restores the useful width before the collapse gesture. Remember width and
collapse locally, accepting the previous collapse-only preference; viewport clamping does not overwrite
the chosen width. Double-click or Home restores 256px, arrows resize and collapse/expand at the boundary,
and Enter toggles collapse. The options menu provides click-based width presets. Reordering disables
the splitter and collapse button. The detail scrolls internally instead of shrinking identity or actions below usability.

The header uses the controlled portrait plus a separate circular icon. Presence and Runtime are two
distinct inline facts: “在队” is static; “{Runtime} →” uses arrow, hover, focus and an accessible name
to show it opens existing Runtime configuration. An unconfigured teammate says “未配置运行时 →” once.
Keep full configured Runtime status in the accessible name and in the configuration section. Do not put
the Runtime fact in a grey card or merge the two meanings.

## Roster and order

Roster order comes from the authoritative Member Order. Reordering is explicit, keyboard accessible
and preserves selection. Identity color and avatar remain stable across reorder. Loading or partial
Runtime health must not reorder or hide teammates.

Roster rows keep a 40px circular image, 13px name and 11px role in a 60px row without inter-row gaps.
Use a subtle selected surface, 2px selection rail and aligned Runtime column. The header shows the total
once; omit the redundant “在队” group when every teammate is present. If any teammate is away, show
the meaningful presence groups and their counts. Above eight members, offer compact name/role search;
the title reports matching / total counts while filtering. Keep creation and collapse immediately available,
with ordering and width presets in the restrained “名册选项” menu.
Runtime shortcuts show the existing product logo in a 22px carrier; an unconfigured teammate uses a neutral
minus glyph. Attention, unsupported and unqualified states add a small `!` marker. Loading retains the
product identity with a checking label. Each shortcut has a full accessible label/status tooltip and scrolls
to that teammate's Runtime configuration. A small dirty dot and accessible “有未保存更改” label identify pending edits.
`light_ready` 可以使用“可用”主状态，但完整 accessible label 说明登录、模型与能力仍待显式检查或首次实际
任务确认。加载或复扫期间保留产品图标并标注检查中，不得把延迟验证画成失败。

## Detail and editing

Keep a fixed personal-profile entry above the teammate roster, outside counts, search and ordering.
It selects an ordinary detail page with a single-column avatar and name form, capped at 520px. Both defaults are “你”;
renaming keeps that glyph until an image is uploaded. Show the name without an added “· 你” suffix;
keep “个人资料” as the entry subtitle. Reuse the existing circular cropper. Save both fields
together, keep drafts when selecting teammates, and include this editor in the workspace leave guard.
The entry remains clickable above the native window drag strip. Its production semantics are owned by
[Current User Profile v1](../../../../docs/contracts/current-user-profile-v1.md).

Identity editing uses the existing composite avatar asset: circular crop drag, zoom, keyboard nudge
and actual-size previews. The durable asset and fallback rules are in
[`member-identity.md`](../../../../docs/ui/components/member-identity.md).

“运行配置” retains the product Runtime, model, reasoning, permission and sandbox fields exposed by
that Runtime. The Runtime, model and permissions save atomically through the existing command. Keep
“运行参数” directly visible by default in the vertical reading flow. Do not restore the removed
“高级设置”, summary-model configuration or “对话压缩模型”.

For any `light_ready` installation, expose Runtime default model plus only permissions described by the
static Adapter schema. Supporting copy says login, model and capability verification happens on explicit
check or the real task's uniform Dispatch Preflight. Do not offer explicit models before a verified catalog. TRAE uses the same model
catalog cache and Picker behavior as every other Runtime; its permission draft still defaults to the statically
admitted highest value `permission_mode=bypass_permissions`. Kiro exposes the existing compact switch pattern for
`trust_all_tools`; label it “自动允许全部工具” and default it on from Core without adding a separate warning card.

Model rows keep Runtime display names separate from opaque selection IDs and show the Runtime description when
provided, with the full text available on hover. Claude's initialize catalog uses this same Picker; no family-specific
rows or inferred version labels are supplied by Renderer.

Opening the model Picker uses Core-owned stale-while-revalidate state. Fresh catalogs display immediately;
serviceable stale catalogs remain interactive while a single background refresh runs; expired, unavailable or
invalidated catalogs show a bounded loading state until discovery settles. A failed refresh keeps and labels the
last successful catalog. Switching Runtime never triggers discovery, and an older async result must not mutate the
new draft. Runtime default remains selectable without a catalog. An existing saved explicit model that cannot yet
be checked reads “尚未核对”; a fresh or stale catalog that omits it uses evidence-specific copy instead of the
absolute “已失效”. This does not add repair semantics for manually modified or technically recovered corrupt data.

Keep presence and destructive removal in the header overflow menu. Removal uses its existing confirmation
and Core preview. Do not expose Installation IDs, executable paths or internal bindings in the ordinary profile.

On Windows, Runtime Platform Admission is evaluated before installation or health. An unqualified row
uses the Runtime logo with a compact `!` marker with the full label “{Runtime}：Windows 尚未验证”; an unsupported row says
“此平台不支持”. Neither may be shown as not installed, rescannable or temporarily checking. Opening the
configuration shows frozen historical values but no Runtime/model/permission mutation or execution action.
Name, role, portrait and other unrelated edits remain available and save while preserving the Runtime
subobject exactly; the Renderer must not manufacture a default or require users to discard that history.

Cursor Agent remains a closed identity and does not enter the ordinary member Runtime selector until a
future contract explicitly opens it. A historically persisted Cursor configuration stays frozen and readable;
unrelated member edits preserve that Runtime subobject exactly, while the Renderer must not manufacture its
`execution_mode` or `approval_policy` defaults or offer a new Cursor selection.

Kimi Code follows the same admission-first rule and is currently qualified on macOS arm64, macOS x64 and
Windows x64. Its model and `default | plan | auto | yolo` permission selector therefore follow the ordinary
available Runtime flow when machine readiness also passes. Read-only workspace always projects effective `plan`;
provider credentials remain private Core configuration and never appear in this surface. Kimi/Grok ACP agent
text is not provider-cleaned: when an upstream Runtime emits thinking tags as ordinary assistant text, process
detail and the resulting final candidate retain that text exactly like every other ACP Runtime.

The member Runtime chooser displays Pi Coding Agent as “PI” immediately after Antigravity; the member sidebar uses the same short label.
Pi Coding Agent is a qualified Product Runtime on macOS arm64, macOS x64 and Windows x64. Keep it selectable and
editable through the ordinary Runtime flow on all three platforms, without an experimental suffix, while continuing
to show real machine availability independently. Qualification does not weaken installation, model or Dispatch checks.
Pi tools follow native Pi semantics; Rovai exposes no Pi approval or sandbox configuration. Its member Runtime
parameters therefore show model fields only.

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

## Inline configuration composition

The right pane is one continuous page: “队员信息” followed by “运行配置”, with no identity/Runtime Tabs
and no create/edit dialogs. Name and team role share a row; professional responsibility and editable
trait tags follow. A 182px, 4:5 portrait sits to their right. Working principles and growth focus use one
collapsed disclosure with a filled-field count. Collapsing preserves draft values; field validation expands
and focuses the relevant field. Counters and input guidance appear on focus.

Each section owns its “放弃更改” and light tonal save control: a 14px outline save icon plus “保存”, with full accessible names “保存队员信息” / “保存运行配置”. Member selection preserves
both sections' pending drafts for each visited teammate. Saving one section advances its accepted baseline
without resetting the other. A conflicting external update preserves the local draft and blocks that section's
save until the user reloads its saved values. Leaving the workspace confirms discarding pending changes.

New teammates use the same page. The pending draft has a separate bottom roster row and is excluded from
saved teammate counts and ordering. Only a name is required. Runtime configuration becomes available after
creation. Presets, upload and native crop editing expand inline and are committed from the identity section’s “保存” control.
Creation includes the selected image in the existing create command. Existing identity and image changes use
successive existing commands with receipt versions; partial success explicitly distinguishes committed text
from an unsaved image, retains the remaining draft and never claims an atomic transaction.

Keep Runtime/model/permission dropdown geometry, colors, borders, menu, selection, options and behavior unchanged; only remove extra focus outlines/halos. The Runtime picker shows the existing product icons in its trigger and keyboard-accessible menu. Model
strategy's Runtime-default caption is “默认”; the underlying `runtime_default` mode and Runtime-native fields,
raw choices, defaults, platform admission, model discovery and recovery remain unchanged. Do not introduce
an additional Runtime parameters heading in this continuous form.

The 620px detail breakpoint narrows the portrait to 128px and stacks name/role. Below 390px detail width,
the portrait and all form columns stack. Both themes keep the same geometry, semantic colors and restrained
1px input borders. Keep destructive removal confirmation and its Core preview, blockers, failures and keyboard operation without automatically refocusing the entry button.

The production-component regression is `node --test scripts/lib/member-editor.test.mjs`. It runs an isolated
Electron fixture, covers both saves, cross-member drafts, conflicts, inline creation, keyboard focus and
1440×920 / 1040×700 / 2560×1440 / 200% layouts, and can retain screenshots with
`ROVAI_KEEP_MEMBER_EDITOR_FIXTURE=1`. This fixture contains explicit test data; production always reads Core.

Selected roster rows use a neutral surface and text without a left selection rail. Keep the roster background and identity assets unchanged.
