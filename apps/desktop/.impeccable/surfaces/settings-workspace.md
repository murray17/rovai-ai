---
version: 1
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
uses the shared borderless header with bottom divider, a direct title/description and page-specific
actions. The content area does not add a second navigation column or page-sized outer card.

All categories implement Loading, Empty, Partial, Error, Disabled, Submitting and Recovery while
retaining the header and navigation. A save, import, repair or probe failure keeps inputs, selection,
scroll and focus.

## 通用

General owns stable startup location and window reset. Stable choices commit immediately through the
narrow Desktop bridge. The App does not expose or enable a macOS login item; packaged macOS startup
only makes a best-effort removal of any retired registration. General does not add hidden/background
launch, default Project, recovery or update policy.

## 外观与通知

Appearance presents exactly “跟随系统 / 日间 / 夜间”, with resolved result shown separately from
saved preference. The cards describe Porcelain Day and Steel Night; switching preserves page state,
focus and open overlays. Follow [`themes/README.md`](../../../../docs/ui/themes/README.md).

Notification settings control the accepted categories and floating preference without making Toast
the durable notification center. The persistent drawer, unread count and focus return use the same
theme surfaces and existing notification read model.

Notification settings contain one master heads-up switch and exactly four default-on categories:
待审批、提到你、本轮完成、执行未完成. The last category controls both `turn_failed` and
`turn_incomplete`, while cards keep their honest distinct copy. Ordinary Agent messages have no
notification category or setting.

The master heads-up control is the dominant panel. Its four child categories sit below in two open
scenario groups: “需要响应” contains 待审批 and 提到你; “本轮结果” contains 本轮完成 and
执行未完成. Turning the master off disables delivery without erasing child choices, and group
counts describe those choices as retained rather than active. “打开通知中心” remains a tertiary
header action; do not repeat the same persistence explanation in a separate boundary card.

Current User Mention creates one immutable Occurrence per source message. Occurrences in one CampTurn
share a durable Episode card but remain independently acknowledged; the earliest unacknowledged
message is the current exact action. Settings only affect Journal-qualified transient heads-up and
never durable Episode admission, acknowledgement, clearing or the global unread count.

## Skill

Use one open list with stable identity mark, name, source, enabled switch and details for supported
configuration choices. The list contains the nine `user_managed` official Skills, including
`campfire` and the four pinned GitHub-origin Skills; GitHub provenance changes only the short source
badge and details, not grouping or lifecycle. `cli-operations` and `memory-stewardship` are
`system_required`: omit them entirely instead of adding locked rows, disabled controls, a required
badge or a special built-in group. Imported revisions, enablement and `allowed-tools` do not imply
extra Runtime permission or proof that a model read the Skill.

## MCP

Keep the current JSON truth path and import/mutation boundary. The upper assignment workbench has a
bounded teammate roster and a searchable MCP chooser; the lower Library uses the same open-row family
as Skill. Only the active teammate receives Steel selection. Checkbox assignment is the sole chooser
state; do not duplicate risk labels, “assigned/unassigned” badges or a second write surface in details.

Malformed source preserves raw content and blocks overwrite. Secret values stay masked and out of
normal errors/diagnostics. Mutations honor current digest/CAS order; the Renderer stops subsequent
writes after conflict and refreshes.

## Agent 运行时与诊断

Runtime settings always show the complete Product Runtime Catalog. User-facing states are limited to
checking, available, needs login, not installed, unsupported, unavailable and temporarily unknown;
do not expose internal “found/not checked” stages. Use recent Core cache immediately and request
asynchronous refresh. Executable path, fingerprint, backoff and audit remain inside the advanced
diagnostic disclosure.

Diagnostics full check is read-only. Summary counts partition all checks into normal, needs attention
and temporarily unknown. There is no “repair all”; each issue has one bounded next step and is
rechecked after action. v5 export remains allowlisted/redacted and uses an explicit Save Dialog.

## Inheritance and hard boundaries

Inherit root [`DESIGN.md`](../../../../DESIGN.md), theme and accessibility contracts. This brief does
not change Shell persistence, Runtime probing, Skill/MCP authority, secrets, diagnostics redaction or
Core projection semantics.
