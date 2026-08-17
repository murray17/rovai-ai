---
version: 2
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

1. The persistent App navigation and the active roster.
2. Selected teammate identity, team role, Presence and Runtime availability.
3. Professional profile, work principles and personality background.
4. Runtime configuration and the directly visible Runtime Parameters.
5. Memory Capability and destructive removal.

## First view and layout

Keep the shared 270px App rail visible on the teammate page. Inside the content area, keep a 236px
roster as the stable secondary navigation column and the selected teammate as the flexible detail
surface. The user can explicitly collapse the roster to 76px; remember that presentation preference
locally. The detail scrolls internally instead of shrinking identity or actions below usability.

The header uses the controlled portrait plus a separate circular icon. Presence and Runtime are two
distinct inline facts: “在队” is static; “{Runtime} 可用 →” uses arrow, hover, focus and an accessible
name to show it opens existing Runtime configuration. Do not put the Runtime fact in a grey card or
merge the two meanings.

## Roster and order

Roster order comes from the authoritative Member Order. Reordering is explicit, keyboard accessible
and preserves selection. Identity color and avatar remain stable across reorder. Loading or partial
Runtime health must not reorder or hide teammates.

Roster Runtime shortcuts use the approved compact `✓`, `!` and `…` states rather than product logos.
Each shortcut has a full accessible label and opens that teammate's Runtime configuration.
TRAE 的静态 Installation 使用中性的“已安装”状态，不借用 `✓` 暗示 Ready；完整 accessible label 说明登录与
能力将在首次实际任务验证。加载或复扫期间仍使用 `…`，不得把延迟验证画成失败。

## Detail and editing

Identity editing uses the existing composite avatar asset: circular crop drag, zoom, keyboard nudge
and actual-size previews. The durable asset and fallback rules are in
[`member-identity.md`](../../../../docs/ui/components/member-identity.md).

“运行配置” retains the product Runtime, model, reasoning, permission and sandbox fields exposed by
that Runtime. The Runtime, model and permissions save atomically through the existing command. Keep
“运行参数” directly visible by default in the vertical reading flow. Do not restore the removed
“高级设置”, summary-model configuration or “对话压缩模型”.

For any `light_ready` installation, expose Runtime default model plus only permissions described by the
static Adapter schema. Supporting copy says login, model and capability verification happens on explicit
check or the first real task. Do not offer explicit models before a verified catalog. TRAE keeps its narrower
`installed_unverified` state and Runtime default model, while its permission draft defaults to the statically
admitted highest value `permission_mode=bypass_permissions`. Kiro exposes the existing compact switch pattern for
`trust_all_tools`; label it “自动允许全部工具” and default it on from Core without adding a separate warning card.

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
