---
version: 11
slug: "new-conversation-dialog"
primary_target: "apps/desktop/src/renderer/src/NewConversationDialog.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/styles.css"
---

# New Conversation dialog surface brief

## User goal

Create one durable conversation with the correct workspace, teammate set, Lead and optional name,
without hiding safety checks or creating a second Draft model.

## Geometry and hierarchy

Open the same Radix Dialog from every entry point. Width is
`min(520px, viewport width - 48px)` and maximum height is `viewport height - 48px`.
Header and footer remain fixed while the body scrolls. Use the raised theme surface, a 1px neutral
boundary and no colored top stripe. Semantic errors keep their own color.

Mobile Web presents the same form as a bottom sheet inside the visible viewport. Workspace,
teammate and Lead pickers use a second Radix sheet with a back button. Teammates use single-column
68px rows and a fixed “完成” action. Closing a picker or pressing Escape preserves the parent
form and restores the originating picker focus without reopening the name keyboard. Desktop
retains its existing geometry and menus. Both presentations share one draft and submission path.
Selected teammate checkboxes use the neutral `conversation-action` token and its paired contrast:
black in Day and light in Night, matching the create action. Disabled candidates keep their muted treatment.

Header: title “新对话” and an accessibly named close button. Keep the description available to
assistive technology without repeating it visually. Use the paired dialog label and field tokens,
regular-weight labels and 44px picker rows.

Workspace, teammate, Lead and optional-configuration controls share one 16px stroke chevron and one
right-edge inset. Lead uses the established accessible custom radio menu rather than a native select,
so the trigger and every selected-member option can show a portrait while preserving keyboard focus,
arrow-key navigation, `Esc` dismissal and focus return.

## Field order

1. **工作目录 · 可选** — default Quick Chat, a known canonical Project or “选择工作目录…”. Preserve
   native folder-picker cancellation, directory safety validation and asynchronous Git capability. A valid
   ordinary directory is usable before Git detection completes; do not run `git init`. Valid Git metadata
   uses the semantic success foreground and surface, while the in-progress inspection state remains neutral.
   Before removed-Project authority is ready, keep Project choices disabled, do not inspect or submit a cached
   directory, and identify the wait with neutral loading copy; Quick Chat creation remains available.
2. **队员 / 队长** — initialize from the saved team filtered to currently available teammates,
   otherwise all available teammates in Member Order. A candidate is available only when its runtime
   configuration is saved and readiness is `ready` or `light_ready`; both display green “可用”.
   Unconfigured candidates display “未配置智能体”; configured but unavailable candidates display
   “智能体不可用”. Both remain visible, gray and unselectable. All-selection and Lead candidates use
   the same rule; do not prefer deep readiness over light readiness. No routine explanatory footer or
   runtime warning appears. When no candidates are available, show the empty state.
   These are shared selection rules; they do not change Core structural preflight or dispatch checks.
   Keep the existing teammate dropdown entry. Its menu uses two columns (four teammates occupy two rows),
   with portraits, role labels and checkboxes. Arrow keys follow the visual columns; Escape returns focus
   to the trigger. The heading spans both columns, and larger rosters scroll.
   “全选 / 取消全选” toggles all available teammates; the last selected teammate can also be removed.
   Empty draft selection does not raise an error or disable “新建”. On submission, show
   “请至少选择一位队员。” beneath the teammate field and focus that field without calling Core.
   Selecting again clears the error and supplies a Lead when the draft has none.
3. **添加对话名称 / 对话名称** — collapsed by default. Expansion focuses the input. Normalize and count
   Unicode scalars up to 80; align the expanded name editor with the form without a child rail and keep the exact
   placeholder `输入名称...`. Empty means “未命名对话” and is not delegated to a Runtime/LLM.
4. **以后使用此队伍一键新建** — unchecked on every opening. Place an independently focusable “?”
   immediately to the right. Its hover, focus and click tooltip says “保存所选队员和队长，下次点击「新对话」直接创建。”
   and “可在「设置 → 通用」关闭。”. Escape closes the tooltip without closing the dialog; opening it must
   not toggle the checkbox. No inline explanation or effective-after-creation text is shown.
   Do not save the workspace or optional name as defaults.

Footer contains “取消 / 新建”. The creation action uses the neutral conversation-action tokens (black in Day, the paired light action in Night). Do not repeat directory, teammate count or Lead in a summary.

## Submission and recovery

Submitting locks controls that could mutate the Draft and prevents duplicate create. Close only after
Core atomically accepts the Active Camp, then refresh Navigation, enter it and focus Composer. A Camp
with no messages, AgentRun or prebuilt Conversation is valid.

If one-click was requested, persist the team and enable flag in one Host-owned preference write only
after Core accepts creation. Cancel or creation failure must not change preferences. A preference-write
failure still opens the accepted Camp and reports that defaults were not saved; it must not invite a
second creation. Ordinary saves in General settings preserve the existing one-click flag.

Failure preserves directory, teammate selection, Lead, name, scroll and focus. Candidate refresh must
not silently drop a teammate, replace Lead or fall back to Quick Chat. Esc/close/cancel in non-submitting
state returns focus to the exact opener. If a selected teammate becomes unavailable during refresh,
retain the draft and block submission until the user explicitly chooses a valid team (for example, “全选”).
One-click creation checks the same availability rule and opens this dialog when the saved team is
unavailable, without permanently invalidating preferences because of a temporary runtime outage.

Do not restore “协作方式 / 并肩协作 / 领队统筹 / 暂未开放”; the request continues to submit the existing
`peer` semantics. This is a Renderer simplification, not a Core union or SQLite migration.

## Inheritance and hard boundaries

Inherit root [`DESIGN.md`](../../../../DESIGN.md), both theme contracts and
[accessibility baseline](../../../../docs/ui/qa/accessibility.md). This brief cannot alter directory
safety, Camp creation transactions, Pending/Active semantics, Member Order or Core draft authority.
