---
slug: "settings-workspace"
primary_target: "apps/desktop/src/renderer/src/SettingsPageHeader.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/GeneralSettings.tsx"
  - "apps/desktop/src/renderer/src/AppearanceSettings.tsx"
  - "apps/desktop/src/renderer/src/ShortcutSettings.tsx"
  - "apps/desktop/src/renderer/src/shortcut-settings.css"
  - "apps/desktop/src/renderer/src/NotificationSettings.tsx"
  - "apps/desktop/src/renderer/src/RebuiltSkillsSettings.tsx"
  - "apps/desktop/src/renderer/src/McpSettings.tsx"
  - "apps/desktop/src/renderer/src/AboutUpdatesSettings.tsx"
  - "apps/desktop/src/renderer/src/RuntimeStartupSettings.tsx"
---

# Settings workspace surface brief

## User goal

Configure application behavior and capabilities while preserving a clear distinction between saved
preference, detected availability, editable source and current effective state.

## Shared composition

Settings replaces the common 270px App rail with the grouped settings navigation defined by
[`app-shell-navigation.md`](../components/app-shell-navigation.md). Every category
uses the shared borderless header, a direct title/description and page-specific actions. Appearance,
Reminder and Agent Runtime use a solid content plane without a decorative top edge, gradient wash or
header divider. Agent Runtime uses a centered `1040px` title/body track;
its catalog uses one quiet surface with individually raised rows. General, Notifications, Channels,
Diagnostics and About use open content rows and fine separators instead of nested gray containers. Skills and MCP instead use the capability library/detail composition below; other categories do not add a second navigation column or page-sized outer card.

Controls follow [DESIGN.md](../../../DESIGN.md#colors), including checkboxes and Portal menus.
Selection uses a quiet fill and neutral text without a left stripe; status/provider colors keep their meaning.
Off switches retain a white thumb. Member Runtime configuration selects retain their dedicated tokens.
Appearance keeps its reading previews. Its zoom selector and
shortcuts share the Chrome desktop presets defined by the theme contract below.

All categories implement Loading, Empty, Partial, Error, Disabled, Submitting and Recovery while
retaining the header and navigation. A save, import, repair or probe failure keeps inputs, selection,
scroll and focus.

## 通用

General owns stable startup location, world-map availability and window reset. Windows Desktop also owns the local
close-behavior selector (ask every time / system tray / quit); its close dialog and remembered choice share Main authority
under [Windows Window Close v1](../../contracts/windows-window-close-v1.md). macOS and Web expose neither this selector nor a tray. Stable choices commit immediately through the
narrow Desktop bridge. The App does not expose or enable an OS login-start item on either supported
platform. General does not add hidden/background
launch, default Project, recovery or update policy. Hiding an already open Windows window is separate from startup policy.

The shared General page receives its preference API explicitly from either entry. Creation team, Lead and
one-click flag come from the same Host-owned record. Web stores only client
presentation preferences; window reset and Host browser-access administration remain injected Desktop
capabilities. Web does not fall back to a native global. [Remote Connection](../host-remote-connection.md)
owns Host management and the current browser connection.

New-conversation defaults follow [Team workspace](../components/team-workspace.md):
choose Team or Custom; Team shows a compact summary, Custom exposes teammate and Lead pickers.
The teammate menu uses portraits, names and selection marks, with search above eight candidates.
The roughly 320px Lead picker shows portrait, name and role; search appears above eight selected members.
Bound menus to the available viewport. Invalid members remain recognizable and cannot become a new Lead.
Keep draft validation and the local error/save row with the shared save icon and “保存”.
The one-click summary shows only saved teammate count and Lead; omit duplicate saved-state text and Project.

World-map availability appears in a 会话 section immediately after 新对话 and before 窗口.
Read the saved availability; a profile without preferences starts disabled. Changes commit immediately.
The row does not repeat the default as a badge, add a
current-effective summary or add a conversation-page preview action. Turning it off forces Thread reading
surfaces back to the timeline and removes the entire 会话 / 地图 switcher and map route controls. Do not
retain a disabled entry, explanatory popover or settings shortcut. Conversation find remains available
independently. Re-enabling the setting restores the switcher without opening the map automatically.
Preserve the established 启动 and 新对话 composition. The 窗口 reset row uses one quiet raised surface,
including in Porcelain Day where it reads as a white support card.

## 快捷键

Desktop places 快捷键 immediately after 外观 in settings navigation. Use the shared borderless header,
1040px content track, theme tokens and neutral dialog. Group side headings organize single-row fields
into 会话工作区, 输入, 应用与导航 and 查找与文件; compact widths move headings above their rows.
Keep this an open settings surface without search, system/edit groups, a separate side-button chooser
or a file-reload action. Follow [快捷键设置](../components/shortcut-settings.md).

Binding fields are transparent at rest and reveal their boundary and input surface on hover or keyboard
focus; inner keycaps remain visible. Clicking the right-hand field starts inline recording of a keyboard
combination or an actual mouse side button. Initially show only “请按下快捷键”; validation and conflict
feedback appear when needed. Keyboard and side-button bindings remain visible together, each with its
own clear action.

Keep failed candidates, local error feedback and scroll position in the same row. After saving or
clearing, restore the current row's binding-entry focus only if the user has not moved elsewhere.
The send-mode row chooses Enter or the platform primary modifier plus Enter; Desktop public and single-chat
send buttons expose the effective combination through dynamic tooltips and accessible names, without
permanent composer instructions. Restore-all uses the existing neutral confirmation dialog. Exact
platform validation, binding and persistence semantics belong to
[Desktop Shortcuts v2](../../contracts/desktop-shortcuts-v2.md).

## 外观与提醒

Appearance presents exactly “跟随系统 / 日间 / 夜间 / 晨雾 / 朝霞 / 绯夜”, with resolved result and saved preference
remaining distinguishable in the page header. The five palettes share the production component tree;
switching preserves page state, focus and open overlays. Follow
[`themes/README.md`](../themes/README.md).

Appearance uses three sections: 界面主题, 文字与阅读, 显示与动效, on a
centered 980px track. Theme choices are whole-card native radio labels, with a 16:9 UI thumbnail,
Chinese/English name, selection outline and check mark. Follow-system uses a diagonal day/night split
of the same synthetic workspace; day and night show their fixed palettes independently of the selected
page theme. Keep the six cards compact: six columns on the full track, three below 900px container width,
and two below 420px. New palette thumbnails reuse the same workspace geometry. Preserve keyboard arrows and the global focus treatment without an extra card focus ring.

The reading section places compact controls beside a bounded conversation/document/code preview.
Conversation, document and code sizes default to 13/15/14px and accept integer values from 12–24px.
Valid typing or a stepper change updates the matching preview immediately without transferring focus;
empty/intermediate input is kept while editing and normalized on blur or Enter. Standard/relaxed density
changes prose leading and paragraph spacing. Preview tabs use ArrowLeft/Right, Home/End and roving focus.
Preview messages and files are synthetic examples, never user or Core data.

The display section uses the shared 25–500% Chrome desktop presets from
[`themes/README.md`](../themes/README.md#外观与阅读偏好), including its exact fractional
factors and shortcut limits. An existing out-of-list saved value stays representable and restorable.
Web delegates page zoom to the browser's own menu and shortcuts, showing this local capability difference
in the same Appearance row instead of saving an ineffective percentage. Resetting appearance defaults in
Web does not reset browser-managed zoom.
Reduced motion has exactly 跟随系统 and 始终减少; it suppresses motion in CSS, programmatic scrolling
and the world map while preserving status and progress content. Its one-shot file-tab example can replay.

Preferences apply and save immediately through the owning appearance API.
Malformed source is preserved and reported as degraded.
Writes serialize and publish only after an atomic save succeeds. Controls retain focus during rapid edits;
a failure retains the draft and exposes retry with honest unsaved feedback. Restore defaults resets all
appearance preferences, including theme and native zoom, without touching other settings.

Reminder settings control only accepted transient heads-up categories. The production Renderer does
not mount the persistent notification drawer, global bell or unread total; the Core notification read
model stays durable while the visible controller uses only a lightweight high-water baseline.

Notification settings use one master switch and three business-object groups: 会话, 使命, 任务.
Conversation contains 待审批、提到你、本轮完成、单聊回复、执行未完成. Mission contains 使命需要你 and
使命状态变更; Task contains 任务状态变更. Task status is default-off with completed/blocked/cancelled selected;
Mission status is default-on with completed selected. Status choices expand inline and persist with the same CAS save.
Conversation spans the two left rows on wide layouts; Mission and Task stack on the right. Stack all three below 960px.
Master/category disabling retains values and filters. Save errors restore current values, focus and scroll and allow retry.
The attentive foreground Thread stays quiet for its conversation, Mission and Tasks; leaving does not replay suppressed cards.
Mission needs-you question copy comes only from an explicit source message. Never invent a question or infer it from an @mention.

Notification behavior and exact acknowledgements follow the
[notification contract](../components/notification-center.md); this brief owns settings composition only.

## Skills and MCP

Use a compact left list and right content/configuration pane with a shared full-height 1px divider.
Inherit global splitter appearance; keep each page's width, keyboard behavior and draft lifecycle in its contract.

- [Skills and toolbox](../components/skills-settings.md): native read-only Skills by Runtime;
  toolbox configuration assigns individual teammates. Do not add Library import, revision or delivery-group controls.
- [MCP](../components/capability-settings.md): JSON configuration, local import and teammate assignment.
  Empty libraries use the first-connection guide; failures retain an explicit retry state.

Keep destructive confirmation and recoverable errors in the active pane/dialog. Ordinary controls, selected marks
and Portal content use the current theme action family; secret disclosure and conflict checks follow the MCP contract.

## 智能体与诊断

Missing and authentication-required Runtimes expose a quiet, initially collapsed installation or login
guide inside their catalog row. Only one guide is open at a time. On admitted macOS platforms, Claude
Code, Codex CLI and OpenCode show a primary official installation command, collapsed alternatives with
prerequisites, a launch/login step and a recheck action. Other products and other admitted platforms link
to official instructions; Antigravity links to its download site. Commands are copied, never executed by
the Renderer. Admission remains Core-owned; unqualified, unsupported and pending products gain no action.
List and guide checks share one backend operation that captures fresh discovery inputs before checking
the selected product. Do not issue a separate frontend rescan first. Failed and deferred responses remain
failed/incomplete even when historical availability is retained.
Pending checks preserve focus and the open guide; real status, public failures and retry feedback remain
in the same row. Guide content and download clicks never imply successful installation or readiness.

The Agent Runtime catalog displays Pi Coding Agent as “PI” immediately after Antigravity, matching the member Runtime chooser.

Runtime settings show the user-facing Runtime catalog, which may omit a closed internal identity that
has not completed any product qualification. User-facing states are limited to
checking, available, needs handling, needs login, not installed, unsupported, unavailable and temporarily
unknown. An admitted executable that has been found reads “可用” and can be selected and tried.
Do not append execution-verification explanations or a separate success message after a check; the status
badge carries the result. Failed or deferred checks keep actionable feedback. Do not expose internal
“found/not checked”, fingerprint or
attempt stages. Do not show discovery summaries (source, entrypoint kind, candidate extension, native target
resolution or version probe outcome) in Runtime rows on any platform. Executable paths are editable in the dedicated startup settings page; fingerprint, backoff
and audit remain inside advanced diagnostics.

Catalog versions come from Core `runtimeAvailability.reportedVersion`; no Renderer fallback to an installation snapshot.
A retained version does not mean the latest check succeeded. Do not show placeholders when the version is unknown.
Public Runtime entries follow [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
across settings, onboarding, teammate selection and monitoring; preserve names on historical records.

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
normal availability checks, selection, diagnostics and execution. Like qualified rows, its subtitle contains only
the reported version and its badge remains the real checking/available/login/install/error result. Check feedback
and onboarding omit qualification notices; all Runtime surfaces retain actionable machine failures without
Preview, testing, trial or experimental labels. Product visibility and platform qualification follow
[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md) and
[Runtime Platform Admission](../../contracts/runtime-platform-admission-v2.md).

Settings never
imports or renders the private native provider file, stored token or native base URL. There is no Rovai-owned
switch that forces Kimi/MiniMax thinking off.

If an existing teammate references an unqualified Runtime, preserve the Runtime/model/permission/parameter
subobject byte-for-byte through unrelated profile edits. Show the frozen values read-only and keep identity,
role, portrait and other unrelated fields editable. Only a Runtime-subobject mutation receives a field-level
platform error; do not block the whole settings save or silently select a replacement default.

TRAE uses the same bounded startup/rescan version check and “可用” light-ready presentation as the other
Runtime rows. Every supported row uses “检查状态”; for TRAE that explicit action starts a fast ACP
initialize/session check without sending a model prompt, then presents the resulting Ready or actionable
failure. Startup and rescan may run bounded identity commands, while page entry and selection changes never
start deep checks.

Claude Code and Antigravity explicit-check failures keep the existing machine-state badge and add the safe
public Runtime failure in the same row. The title names the Runtime and follows Core's origin: Runtime returned
an error, incompatible with the current Rovai version, local environment unavailable, Rovai internal error, or
unable to complete. Show the safe summary and optional detail with wrapping; never expose raw stderr, private
logs or a digest. Only `origin=rovai` may use the user-facing phrase “Rovai 内部错误”. Startup shallow version
failures without a public failure keep the existing state copy and last-known-good behavior.

Diagnostics full check is read-only. Summary counts partition all checks into normal, needs attention
and temporarily unknown. There is no “repair all”; each issue has one bounded next step and is
rechecked after action. Normal checks are compact rows with evidence disclosure. No actionable issues is
labeled “无需修复”, including when some checks remain unknown; never call that state fully healthy. v5 export remains allowlisted/redacted and uses an explicit Save Dialog.

Runtime monitoring follows its dedicated [`runtime-monitoring.md`](runtime-monitoring.md) surface
brief. It shares this workspace's borderless header and content track while keeping sparse Usage,
Coverage, clean-break and freshness semantics local to that page.

## 关于与更新

About & Updates belongs to the Support group and uses a borderless `880px` reading track. Product identity
and the installed version share the top row with one primary action; a single status line follows, adding
a reason for failures or installation. Keep the 34px mark, compact 19px product name and shared theme actions.
Release notes follow immediately, with explicit version numbers in the keyboard-accessible tabs (or one
version label without a candidate), publication date and 13px prose. Do not repeat the release title below
the version selector. Check history follows the notes, collapsed initially with fixed-width fact labels.
The first viewport keeps the installed version and the primary action visible. Desktop-hosted Web stays
read-only, and Server retains its reconnect recovery and exact release links.

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
About row inside Settings repeats the badge as non-interactive status. The ordinary badge is a transparent
34px target with 11.5px text; Settings status uses 11px text and an independently sized inline layout, never
the navigation icon's 22px slot. Failure labels state download/install failure; retry belongs to the page.
Narrow English rails may put the update entry on its own row. Available, checking/downloading,
ready/installing and failed states use different icon/copy and accessible names, not color alone.

The page keeps the installed version visible through idle, checking, available, downloading, up-to-date,
ready-to-install, installing and recoverable check/download/install failure states. Its bundled, version-matched
release notes and publication date remain visible offline after an install. A known newer release is a separate fact and remains visible
when a later check fails. When a newer release exists, the page defaults to its notes and offers keyboard-accessible
tabs to switch between new and installed versions; the switch does not start a network request. The update
shortcut focuses the notes heading and scrolls only as far as needed to reveal it, preserving nearby actions. An absent source has
an explicit empty state. A duplicate first version heading is removed only from the display copy; long notes scroll
within a bounded region, and all notes use the shared safe Markdown renderer. Renderer receives no remote HTML, local
installer path or updater credential.

更新日志正文跟随当前界面语言即时切换，中文与英文不并列重复展示。保持当前/新版本 tab 选择，
不增加语言选择器、额外请求或冗长提示。历史无标记说明保留完整原文；缺少当前语言则显示一个
可用语言版本，全空或歧义格式保留全文。分段、隐藏空容器准入、回退与文档级链接/完整脚注规则由
[App Update v7](../../contracts/app-update-v7.md)拥有，组件职责见
[更新架构](../../architecture/desktop-app-updates.md#多语言发布与展示)。最终仍通过共享
`SafeMarkdown`，不改写发布快照；语言变化不重挂载页面或改变更新资格。

Downloading shows one visible percentage beside the progress bar, transferred/total bytes and speed;
the disabled primary action says only “下载中…”. It does not block navigation or
ordinary App use. Repeated download requests visibly remain one operation. Download completion changes the
primary action to “安装并重启”; `ready_to_install` never quits by itself. A synchronous install failure leaves
the App and Core usable and offers retry. Fixed GitHub Releases/support links appear only when the updater is
unavailable or an in-App download failed; network and invalid-release failures do not offer an unverified
installation handoff. Main stages the updater before entering the existing controlled-shutdown boundary.

## Inheritance and hard boundaries

Inherit root [`DESIGN.md`](../../../DESIGN.md), theme and accessibility contracts. This brief does
not change Shell persistence, Runtime probing, Skill/MCP authority, secrets, diagnostics redaction or
Core projection semantics.


## Runtime startup settings

The catalog retains its white day content surface, including expanded guides. Remove the dot only from
Runtime status badges. Align status, the four-character action “检查状态 / 安装指南 / 登录指南”, its trailing
refresh or chevron icon, and the settings gear as consistent columns. Settings remain available for installed
and missing Runtimes admitted on the current platform. Preserve actual installation/login guide content.

The startup page reuses the 1040px content track and an at-most-800px form. Show Runtime identity, program
path with native picker and restore-auto action, the inline check result, then the common-environment JSON editor below. Keep errors
actionable and local; no empty-state explanation, top-right unsaved badge or repeated “next launch”/
“does not change system variables” small print.

“放弃更改” and “保存” remain visible from first load. Both are disabled while clean or submitting and enabled
when values change; save validates rather than requiring a prior manual check. Save failure preserves the
editable values. Discard, successful save and reverting to original values restore the clean state. Known
unauthenticated installs read “已识别程序，需要登录” and remain savable. Switching settings categories retains
the draft; returning to the catalog asks before discarding an unsaved draft. Behavior is owned by
[Runtime Launch v41](../../contracts/runtime-launch-and-verification-v41.md).

Draft checks and restore-auto previews read fresh private search inputs. Failed previews must not fall back
to the saved program/version as though it had just been checked. Editing or leaving invalidates older
preview responses. Explicitly reloading common configuration also clears the previous check result and does not run a new check.
A fallback search source retains a local warning without exposing environment values.

The global Back to App and other App exits reuse the startup page's discard confirmation. The leave guard and
dialog remain available when another settings category hides the form; cancel keeps the current category and draft.

### Local startup settings only

Claude Code and Codex expose program path, explicit checks, common environment values and save/discard.
Do not add native login/API connection editors, model mappings or replacements for removed fields.
Native login/install guides remain in the Runtime catalog; existing native files stay untouched.

Save ends from its local receipt and shows “已保存” in the shared member-editor footer status slot: muted text
on the left, with save/discard actions on the right. Do not reuse the green Runtime check-result style. It does not call parent reloads, native observation or
runtime checks. Preserve failed drafts and field conflict recovery. Behavior is owned by [Runtime Launch v52](../../contracts/runtime-launch-and-verification-v52.md).

## 通用环境变量

智能体的启动设置在程序路径下提供紧凑 JSON 编辑器“通用环境变量”，沿用原保存和放弃操作。
标题旁的 ? 支持 hover、键盘 focus 和触屏点击，说明为“用于在不同队员之间共享一些配置变量。”；Escape 可收起。
不增加使用人数入口、继承/覆盖数量、模式选择器或密钥管理弹窗。所有值直接显示，不保留显示／隐藏密钥或 `<saved>` 标记。
不添加常驻编辑说明；空配置只显示 JSON placeholder `{ "VARIABLE_NAME": "value" }`，示例不写入草稿或保存值。
输入不改写草稿，保存成功才展示字符串形式。
由队员进入时使用具名返回入口，保留其草稿和位置；直接进入保留原返回。精确数据规则见
[Runtime Launch v69](../../contracts/runtime-launch-and-verification-v69.md)。
