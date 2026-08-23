---
version: 4
slug: "settings-workspace"
primary_target: "apps/desktop/src/renderer/src/SettingsPageHeader.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/GeneralSettings.tsx"
  - "apps/desktop/src/renderer/src/AppearanceSettings.tsx"
  - "apps/desktop/src/renderer/src/NotificationSettings.tsx"
  - "apps/desktop/src/renderer/src/SkillSettings.tsx"
  - "apps/desktop/src/renderer/src/McpSettings.tsx"
---

# Settings workspace surface brief

## User goal

Configure application behavior and capabilities while preserving a clear distinction between saved
preference, detected availability, editable source and current effective state.

## Shared composition

Settings replaces the common 270px App rail with the grouped settings navigation defined by
[`app-shell-navigation.md`](../../../../docs/ui/components/app-shell-navigation.md). Every category
uses the shared borderless header, a direct title/description and page-specific actions. Appearance,
Reminder and Agent Runtime use a solid content plane without a decorative top edge, gradient wash or
header divider. Agent Runtime shares the same centered `1040px` title/body track as Skills and MCP;
its catalog uses one quiet surface with individually raised rows. Other categories retain their
current composition until they are reviewed separately. The content area does not add a second
navigation column or page-sized outer card.

All categories implement Loading, Empty, Partial, Error, Disabled, Submitting and Recovery while
retaining the header and navigation. A save, import, repair or probe failure keeps inputs, selection,
scroll and focus.

## 通用

General owns stable startup location and window reset. Stable choices commit immediately through the
narrow Desktop bridge. The App does not expose or enable an OS login-start item on either supported
platform; packaged macOS startup only makes a best-effort removal of any retired registration, while
the first Windows release creates no Startup task or Run-key entry. General does not add hidden/background
launch, default Project, recovery or update policy.

New-conversation defaults use the user-facing terms 队员 and 队长. Ten or fewer selectable teammates
remain directly visible in a two-column chooser; only counts above ten collapse behind a searchable
disclosure whose expanded chooser stays two-column. Narrow layouts reflow the chooser to one column.

## 外观与提醒

Appearance presents exactly “跟随系统 / 日间 / 夜间”, with resolved result and saved preference
remaining distinguishable in the page header. The quiet theme surfaces describe Porcelain Day and
Steel Night; switching preserves page state, focus and open overlays. Follow
[`themes/README.md`](../../../../docs/ui/themes/README.md).

Reminder settings control only accepted transient heads-up categories. The production Renderer does
not mount the persistent notification drawer, global bell or unread total; the Core notification read
model stays durable while the visible controller uses only a lightweight high-water baseline.

Notification settings contain one master heads-up switch and exactly four default-on categories:
待审批、提到你、本轮完成、执行未完成. The last category controls both `turn_failed` and
`turn_incomplete`, while cards keep their honest distinct copy. Ordinary Agent messages have no
notification category or setting.

The master heads-up control is the dominant panel. Its four child categories sit below in two open
scenario groups: “需要响应” contains 待审批 and 提到你; “本轮结果” contains 本轮完成 and
执行未完成. Turning the master off disables delivery without erasing child choices, and group
counts describe those choices as retained rather than active. Do not add an “打开通知中心” action or
repeat the persistence explanation in a separate boundary card. Explain instead that signals arriving
while the App is not attentive are retained in memory and shown after the user returns.

Current User Mention creates one immutable Occurrence per source message. Occurrences in one CampTurn
share a durable Episode card but remain independently acknowledged; the earliest unacknowledged
message is the current exact action. Settings only affect Journal-qualified transient heads-up and
never durable Episode admission, acknowledgement, clearing or the Core unread fact.

## Skill

Use one open list with stable identity mark, name, source, enabled switch and details for supported
configuration choices. The list contains the nine `user_managed` official Skills, including
`campfire` and the four pinned GitHub-origin Skills; GitHub provenance changes only the short source
badge and details, not grouping or lifecycle. `cli-operations` and `memory-stewardship` are
`system_required`: omit them entirely instead of adding locked rows, disabled controls, a required
badge or a special built-in group. Imported revisions, enablement and `allowed-tools` do not imply
extra Runtime permission or proof that a model read the Skill.

On Windows, an ambiguous or interrupted copy projection is a root-level execution blocker, not an
individual Skill enablement state. Keep the list and saved choices visible, add one actionable recovery
surface with the affected Runtime/root, and disable execution-dependent actions until Core reports the
Execution Root Projection Gate admitted. Do not claim that toggling a Skill repairs journal state.

## MCP

Keep the current JSON truth path and import/mutation boundary. The upper assignment workbench has a
bounded teammate roster and a searchable MCP chooser; the lower Library uses the same open-row family
as Skill. Only the active teammate receives Steel selection. Checkbox assignment is the sole chooser
state; do not duplicate risk labels, “assigned/unassigned” badges or a second write surface in details.

Malformed source preserves raw content and blocks overwrite. Secret values stay masked and out of
normal errors/diagnostics. Mutations honor current digest/CAS order; the Renderer stops subsequent
writes after conflict and refreshes.

## Agent 运行时与诊断

Runtime settings show the reviewed user-facing Runtime catalog, which may omit a closed internal identity that
has not completed any product qualification. User-facing states are limited to
checking, installed but awaiting first-run verification, available, needs handling, needs login, not
installed, unsupported, unavailable and temporarily unknown. A successful bounded light launch and identity
result reads “可用” and means the executable can be selected and tried; supporting copy says login, models and
capabilities are confirmed by explicit check or first task. A path-only result remains temporarily unknown,
never synthetic checking. Do not expose internal “found/not checked”, fingerprint or
attempt stages. Executable path, fingerprint, backoff and audit remain inside advanced diagnostics.

Before those machine states, every row consumes the Core-owned Runtime Platform Admission. On Windows,
`not_qualified` renders “Windows 尚未验证” and `unsupported` renders “此平台不支持”; neither state has an
availability probe, install, rescan, selection or execution action. They must not be rendered as not
installed, unavailable, a red health failure or synthetic checking. Diagnostics may show the platform row
and evidence revision without starting that Adapter.

Cursor Agent remains a closed internal Product Runtime identity for historical reads, but its current macOS and
Windows admissions are all `not_qualified` and the product chain has not passed. Do not render it in the Agent
Runtime settings directory until a later qualified integration explicitly reopens that surface. This is not a
Renderer-only preview and must not be relabeled “待支持”.

Kimi Code is a Product Runtime Catalog row and is qualified on macOS arm64 after its complete Built-in CLI
matrix passed. macOS x64 and Windows x64 remain `not_qualified` and expose no machine action. Settings never
renders the private provider file, token or base URL, and does not expose a Rovai-owned switch that forces
Kimi/MiniMax thinking off.

If an existing teammate references an unqualified Runtime, preserve the Runtime/model/permission/parameter
subobject byte-for-byte through unrelated profile edits. Show the frozen values read-only and keep identity,
role, portrait and other unrelated fields editable. Only a Runtime-subobject mutation receives a field-level
platform error; do not block the whole settings save or silently select a replacement default.

TRAE uses the same bounded startup/rescan version check and “可用” light-ready presentation as the other
Runtime rows. Every supported row uses “检查可用性”; for TRAE that explicit action starts a fast ACP
initialize/session check without sending a model prompt, then presents the resulting Ready or actionable
failure. Startup and rescan may run bounded identity commands, while page entry and selection changes never
start deep checks.

Claude Code and Antigravity explicit-check failures keep the existing machine-state badge and add the safe
public Runtime failure in the same row. The title names the Runtime and follows Core's origin: Runtime returned
an error, incompatible with the current Rovai version, local environment unavailable, Rovai internal error, or
unable to complete. Show the safe summary and optional detail with wrapping; never expose raw stderr, private
logs or a digest. Only `origin=rovai` may use the user-facing phrase “Rovai 内部错误”. Startup shallow version
failures without a public failure keep the existing state copy and last-known-good behavior.

The Runtime settings list may append a separately typed presentation-only preview row after supported
products. A preview must say `待支持` and `尚未接入 AgentRun`, expose no health/configuration action and
remain absent from member selection, diagnostics and every execution surface. It is not a Product Runtime
state or count; logo treatment must not imply readiness. Promotion removes the preview and follows normal
Adapter admission instead of reinterpreting preview data.

Diagnostics full check is read-only. Summary counts partition all checks into normal, needs attention
and temporarily unknown. There is no “repair all”; each issue has one bounded next step and is
rechecked after action. v5 export remains allowlisted/redacted and uses an explicit Save Dialog.

Runtime monitoring follows its dedicated [`runtime-monitoring.md`](runtime-monitoring.md) surface
brief. It shares this workspace's borderless header and content track while keeping sparse Usage,
Coverage, clean-break and freshness semantics local to that page.

## Inheritance and hard boundaries

Inherit root [`DESIGN.md`](../../../../DESIGN.md), theme and accessibility contracts. This brief does
not change Shell persistence, Runtime probing, Skill/MCP authority, secrets, diagnostics redaction or
Core projection semantics.
