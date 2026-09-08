---
version: 10
slug: "settings-workspace"
primary_target: "apps/desktop/src/renderer/src/SettingsPageHeader.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/GeneralSettings.tsx"
  - "apps/desktop/src/renderer/src/AppearanceSettings.tsx"
  - "apps/desktop/src/renderer/src/NotificationSettings.tsx"
  - "apps/desktop/src/renderer/src/SkillSettings.tsx"
  - "apps/desktop/src/renderer/src/McpSettings.tsx"
  - "apps/desktop/src/renderer/src/AboutUpdatesSettings.tsx"
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
header divider. Agent Runtime uses a centered `1040px` title/body track;
its catalog uses one quiet surface with individually raised rows. Other categories retain their
current composition until they are reviewed separately. Skills and MCP instead use the capability library/detail composition below; other categories do not add a second navigation column or page-sized outer card.

All categories implement Loading, Empty, Partial, Error, Disabled, Submitting and Recovery while
retaining the header and navigation. A save, import, repair or probe failure keeps inputs, selection,
scroll and focus.

## 通用

General owns stable startup location, world-map availability and window reset. Stable choices commit immediately through the
narrow Desktop bridge. The App does not expose or enable an OS login-start item on either supported
platform; packaged macOS startup only makes a best-effort removal of any retired registration, while
the first Windows release creates no Startup task or Run-key entry. General does not add hidden/background
launch, default Project, recovery or update policy.

New-conversation defaults use the user-facing terms 队员 and 队长. Ten or fewer selectable teammates
remain directly visible in a two-column chooser; only counts above ten collapse behind a searchable
disclosure whose expanded chooser stays two-column. Narrow layouts reflow the chooser to one column.

World-map availability appears in a 会话 section immediately after 新对话 and before 窗口. A new profile
with no preferences source starts disabled. Exact schema-v4 saved values remain authoritative, while
schema-v1–v3 preferences migrate enabled so an upgrade does not silently revoke the previously effective
map availability. Changes commit immediately. The row does not repeat the default as a badge, add a
current-effective summary or add a conversation-page preview action. Turning it off forces Camp reading
surfaces back to the timeline and removes the entire 会话 / 地图 switcher and map route controls. Do not
retain a disabled entry, explanatory popover or settings shortcut. Conversation find remains available
independently. Re-enabling the setting restores the switcher without opening the map automatically.
Preserve the established 启动 and 新对话 composition. The 窗口 reset row uses one quiet raised surface,
including in Porcelain Day where it reads as a white support card.

## 外观与提醒

Appearance presents exactly “跟随系统 / 日间 / 夜间”, with resolved result and saved preference
remaining distinguishable in the page header. The quiet theme surfaces describe Porcelain Day and
Steel Night; switching preserves page state, focus and open overlays. Follow
[`themes/README.md`](../../../../docs/ui/themes/README.md).

Appearance follows the reviewed three-section composition: 界面主题, 文字与阅读, 显示与动效, on a
centered 980px track. Theme choices are whole-card native radio labels, with a 16:9 UI thumbnail,
Chinese/English name, selection outline and check mark. Follow-system uses a diagonal day/night split
of the same synthetic workspace; day and night show their fixed palettes independently of the selected
page theme. Preserve keyboard arrows and a visible card focus ring.

The reading section places compact controls beside a bounded conversation/document/code preview.
Conversation, document and code sizes default to 13/15/14px and accept integer values from 12–24px.
Valid typing or a stepper change updates the matching preview immediately without transferring focus;
empty/intermediate input is kept while editing and normalized on blur or Enter. Standard/relaxed density
changes prose leading and paragraph spacing. Preview tabs use ArrowLeft/Right, Home/End and roving focus.
Preview messages and files are synthetic examples, never user or Core data.

The display section offers 80–200% zoom choices and follows the existing native Electron zoom shortcuts.
The broader 10–500% shortcut range remains available and an out-of-list current value stays representable.
Reduced motion has exactly 跟随系统 and 始终减少; it suppresses motion in CSS, programmatic scrolling
and the world map while preserving status and progress content. Its one-shot file-tab example can replay.

Preferences apply and save immediately through Desktop Main. Loading legacy theme-only preferences
retains the theme and supplies reading defaults; malformed source is preserved and reported as degraded.
Writes serialize and publish only after an atomic save succeeds. Controls retain focus during rapid edits;
a failure retains the draft and exposes retry with honest unsaved feedback. Restore defaults resets all
appearance preferences, including theme and native zoom, without touching other settings.

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

## Skills and MCP

Follow [Capability settings](../../../../docs/ui/components/capability-settings.md): a white day surface,
compact left library and right content/configuration pane, with the same component tree in Steel Night.
The divider supports pointer drag, keyboard adjustment, click alternatives and double-click reset.
Skills combine search and 全部 / 已启用 / 已停用 filters, with status beside the row name and an enable
switch in the detail header. MCP uses teammate assignment without a separate enable switch or filter.
Add, preview, import and update confirmation stay in the right pane. Deletion uses the shared application
confirmation dialog, initially focused on Cancel; keep failure feedback in the dialog and restore focus on dismissal.
Add and import are peer buttons in the MCP library heading. Only installed items appear in the list. Leaving an editor/import or switching MCP/Skills clears unfinished input; do not create draft placeholders or restore drafts.

Skills show active `user_managed` items only; omit `system_required` Skills entirely. A source badge
identifies Rovai only; imported Skills retain provenance without extra source badges. Read-only content defaults
to SKILL.md and supports safe Markdown, raw text and package file navigation. Local import invokes
the native folder chooser, then previews the inspected candidate. GitHub import uses its existing
inspection path. The scope tab selects delivery groups using whole rows with member avatars.
New imports and initial official Skills inherit the canonical all-groups policy; updates preserve
saved enablement and explicit group choices. Previews never execute or authorize Skill instructions.

MCP accepts JSON only, with the existing digest/CAS mutation semantics. The right-side local import
shows selectable portable candidates and folds unneeded diagnostics. Expanded unavailable entries separate
name/source/status from the reason and wrapping field list; merge repeated reasons within the same candidate.
Same-name replacement requires
an explicit inline choice. Necessary environment reference edits remain visible. Teammate assignment
uses whole rows with real avatars and a selected check mark. Malformed source blocks overwrite;
secret values stay masked and out of ordinary errors. Conflicts retain the JSON draft and require
refresh/review before retrying. Do not display source file paths as routine configuration content.

## Agent 运行时与诊断

Missing and authentication-required Runtimes expose a quiet, initially collapsed installation or login
guide inside their catalog row. Only one guide is open at a time. On admitted macOS platforms, Claude
Code, Codex CLI and OpenCode show a primary official installation command, collapsed alternatives with
prerequisites, a launch/login step and a recheck action. Other products and other admitted platforms link
to official instructions; Antigravity links to its download site. Commands are copied, never executed by
the Renderer. Admission remains Core-owned; unqualified, unsupported and pending products gain no action.
The post-install action refreshes interactive-shell discovery before checking the selected product.
Pending checks preserve focus and the open guide; real status, public failures and retry feedback remain
in the same row. Guide content and download clicks never imply successful installation or readiness.

The Agent Runtime catalog displays Pi Coding Agent as “PI” immediately after Antigravity, matching the member Runtime chooser.

Runtime settings show the reviewed user-facing Runtime catalog, which may omit a closed internal identity that
has not completed any product qualification. User-facing states are limited to
checking, installed but awaiting first-run verification, available, needs handling, needs login, not
installed, unsupported, unavailable and temporarily unknown. A successful bounded light launch and identity
result reads “可用” and means the executable can be selected and tried; supporting copy says login, models and
capabilities are confirmed by explicit check or first task. A path-only result remains temporarily unknown,
never synthetic checking. Do not expose internal “found/not checked”, fingerprint or
attempt stages. Do not show discovery summaries (source, entrypoint kind, candidate extension, native target
resolution or version probe outcome) in Runtime rows on any platform. Executable path, fingerprint, backoff
and audit remain inside advanced diagnostics.

Before those machine states, every row consumes the Core-owned Runtime Platform Admission. On Windows,
`not_qualified` renders “Windows 尚未验证” and `unsupported` renders “此平台不支持”; neither state has an
availability probe, install, rescan, selection or execution action. They must not be rendered as not
installed, unavailable, a red health failure or synthetic checking. Diagnostics may show the platform row
and evidence revision without starting that Adapter.

The catalog heading shows the Core-reported host platform once. Qualified rows show only a reported version as
supporting copy; no version means no subtitle element or placeholder. Never fall back to static “稳定 / 测试 / 实验性”
labels. Keep the 68px minimum row and vertically center either the name alone or the name/version block with the
logo, machine-state badge and action. Expanded guides and failure details may grow the row.

`preview` remains an admitted Product Runtime state, distinct from a Renderer-only `待支持` preview. It enters
normal availability checks, selection, diagnostics and execution while supporting copy says “实验性开放”; its
machine-state badge remains the real checking/available/login/install/error result. Pi no longer uses this state: its
three shipped platforms are qualified by platform-specific immutable evidence and follow the ordinary machine flow
without experimental disclosure.

Cursor Agent remains a closed internal Product Runtime identity for historical reads, but its current macOS and
Windows admissions are all `not_qualified` and the product chain has not passed. Do not render it in the Agent
Runtime settings directory until a later qualified integration explicitly reopens that surface. This is not a
Renderer-only preview and must not be relabeled “待支持”.

Kimi Code is a Product Runtime Catalog row and is qualified on macOS arm64, macOS x64 and Windows x64.
Each platform follows the ordinary machine availability flow after platform admission. Settings never
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

DeepSeek Harness is hidden on macOS arm64, macOS x64 and Windows x64. The Runtime settings list currently
contains no presentation-only pending preview rows. DSH remains an unimplemented candidate, absent from
member selection, diagnostics and every execution surface; restoring an entry requires an explicit product
decision and normal Adapter admission before it can become executable.

Diagnostics full check is read-only. Summary counts partition all checks into normal, needs attention
and temporarily unknown. There is no “repair all”; each issue has one bounded next step and is
rechecked after action. v5 export remains allowlisted/redacted and uses an explicit Save Dialog.

Runtime monitoring follows its dedicated [`runtime-monitoring.md`](runtime-monitoring.md) surface
brief. It shares this workspace's borderless header and content track while keeping sparse Usage,
Coverage, clean-break and freshness semantics local to that page.

## 关于与更新

About & Updates belongs to the Support group and extends the same borderless `1040px` settings track,
two-column section rhythm and quiet raised rows used by reviewed settings pages. The first viewport
shows the installed Rovai AI version and one primary action. It is a compact updater surface, not an
updater dashboard or installation wizard.

Packaged Main checks the official stable `murray17/rovai-ai` GitHub Release channel five seconds after the
first window load and again six hours after each automatic check settles. Checking never starts a download.
Only explicit user actions start download, installation and restart. A manual page check updates the shared
snapshot but does not create a global reminder.

The global reminder borrows the quiet footprint of collaboration-complete attention: a non-modal 340px
surface at the lower right, target/current version, compact “稍后 / 查看更新内容 / 下载更新” actions and
no focus grab or timeout. It is a dedicated update prompt rather than a normal Notification Episode. Do not
stack it with ordinary heads-up, dialogs, onboarding, shutdown or the same release already open in About.
Main owns an in-memory prompt generation and exact dismiss; closing one reminder does not remove the release
badge and the next automatic round may create another generation.

The ordinary Settings footer keeps its remembered-section behavior. When an actionable release exists, a
separate focusable badge beside Settings deep-links to About without overwriting `lastSettingsSection`; the
About row inside Settings repeats the badge as non-interactive status. Available, checking/downloading,
ready/installing and failed states use different icon/copy and accessible names, not color alone.

The page keeps the installed version visible through idle, checking, available, downloading, up-to-date,
ready-to-install, installing and recoverable check/download/install failure states. A known release is a
separate fact and remains visible when a later check fails. Its valid name, version, date and bounded release
notes appear below the action; empty notes have an explicit state, long notes scroll within a bounded region,
and all notes use the shared safe Markdown renderer. Renderer receives no remote HTML, local installer path
or updater credential.

Downloading shows determinate percent, transferred/total bytes and speed without blocking navigation or
ordinary App use. Repeated download requests visibly remain one operation. Download completion changes the
primary action to “安装并重启”; `ready_to_install` never quits by itself. A synchronous install failure leaves
the App and Core usable and offers retry. Fixed GitHub Releases/support links appear only when the updater is
unavailable or an in-App download failed; network and invalid-release failures do not offer an unverified
installation handoff. Main stages the updater before entering the existing controlled-shutdown boundary.

## Inheritance and hard boundaries

Inherit root [`DESIGN.md`](../../../../DESIGN.md), theme and accessibility contracts. This brief does
not change Shell persistence, Runtime probing, Skill/MCP authority, secrets, diagnostics redaction or
Core projection semantics.
