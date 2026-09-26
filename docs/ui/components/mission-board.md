---
document_type: ui-contract
authority: mission-renderer-presentation
status: accepted
last_updated: 2026-09-26
---

# Mission board

The board header's creation entry is **新使命**, using the existing neutral primary action tokens
(`--conversation-action` / `--conversation-action-contrast`, black in Day) and their hover token.
This entry still opens the same creation dialog; the dialog's labels and submission choices are unchanged.

Desktop and wide Web expose one 使命板 navigation entry between 记忆 and 定时任务, and retain its surface, route and interaction model.
When one or more Missions have unread Agent replies, a blue dot sits at the entry's right edge and is vertically
centered; the accessible label includes the number of Missions with unread replies, but the visual indicator never
renders a numeral. The indicator follows Core-owned `MissionRecord.hasUnread`, independent of Mission status and
running Agents. Ordinary project/recent/pin navigation does not duplicate Mission Camps. Mobile exposes the same
entry in its main drawer, with four status selectors and one scrolling card list. Its full Camp view returns to
the board from the left panel button; an open file/activity preview returns to the conversation first. Long press
opens shared card actions instead of drag-and-drop. Mobile creation/editing uses the same forms in a bottom sheet.
See [Mobile WebUI](../host-web-mobile.md#使命板) for the phone presentation and validation boundary.

Cards open from their entire surface, including keyboard activation. Card actions have no visible ellipsis;
right click or Shift+F10 opens the same accessible menu. The metadata label uses the stable public number
(`M-018`), never an opaque ID suffix. The footer keeps the lead first and shows at most five 23px member
avatars with 7px overlap; when unread and time leave less room, it reduces the visible count and recalculates
a borderless, backgroundless semibold `+N`. The complete ordered roster remains available from the same
keyboard-accessible group. Project is followed by tags and a plain relative timestamp such as “昨天”. A card
with `queued`, `running` or `waiting` AgentRuns places at most three executing-member avatars, the remaining
plain-text `+N`, and stationary “执行中” text in one upper-right group. An unclaimed Delivery does not show this
group. The execution-console Steel/Ember dual arcs flow around the complete
group; the text itself has no sweep animation, and reduced motion keeps the arcs static. Unread uses an 8px
solid blue dot plus 12px semibold blue “未读” in the footer, and raises that card title from 550 to 600 without
a background, border or flashing. Card and list menus share this order: 编辑、状态、查看队员、队长、标签、删除. Click opens
submenus; chevrons use the existing 16px icon rhythm. Every actionable row exposes the same neutral hover and
keyboard-focus background, while 删除 keeps the danger text and soft-danger background. Tags use a lightweight
search/create/check popover.
Status/tag/project filters use matching icon triggers and neutral filled multi-select checkboxes. No selection
means all, without an extra “all” option. Project and tag pickers have search; status does not. Search and the
low-frequency board/list menu share the toolbar without vertical separators. The page uses the white home
surface in Day and its Night equivalent. Its title/subtitle use the same 34px overview-page top inset as
Memory and Scheduled Automation and align with shell controls. The title, filter bar and board use the full
available page width instead of inheriting the ordinary 1400px reading cap, and lead into four equally tall,
very light neutral rounded lanes, including empty lanes. Lane headings flow directly into their card regions
without a horizontal divider at the top. Scrolling a lane down reveals a dashed divider and a subtle shadow
below only that lane's fixed heading. Returning to the top or fitting all cards without vertical overflow
removes both; filtering, restoring a view and resizing recalculate the cue from the actual scroll position.
This local scroll cue does not add elevation to cards. List mode groups and folds rows by status.
In board mode the page title, filters, and each lane's status name/count remain fixed. The board host owns only
horizontal movement, while each lane's card region is a focusable, independently scrolling vertical region with
contained overscroll. Reaching one lane's end therefore never moves another lane or the whole board. Stable
status keys preserve lane DOM and scroll positions through detail opening, cleanup feedback, list refresh and
status changes in other lanes. Switching temporarily to list mode saves and restores the four lane offsets;
changing search or filters instead starts the newly defined result set at the top. Lanes retain at least 200px
normally and 278px at the narrow desktop breakpoint; the bounded board region scrolls horizontally rather than
squeezing card content. At that breakpoint, a compact status strip moves the horizontal viewport directly to a
lane and exposes the same filtered counts; it does not introduce a mobile Mission surface.

Dragging a card to another lane submits the same authoritative status command as the menu. While dragging near
the target lane's top or bottom edge, only that lane auto-scrolls; the horizontal host may also reveal an adjacent
lane near its left/right edge. Escape or drag end stops the frame loop. Right click and Shift+F10 status controls remain
the pointer and keyboard alternatives to dragging, and focused lane regions use Left/Right to move between
visible lanes without resetting vertical positions. Both user and Agent status activity render only the actor and
resulting status. Tags keep the existing normalized-text stable hash but resolve its eight slots through the
Mission-only `--mission-label-1..8` palette, independent of Mission status and shared identity colors.

Creation uses an 820px writing dialog. Mission name is an unboxed heading field; the unboxed description
fills the remaining writing plane. Source attachments sit between them and support file selection, paste,
drag/drop and removal using the Composer attachment rhythm. They reuse the Composer's file/directory
classification and `DIR` label. Overflow stays in one no-wrap strip with no visible scrollbar; trackpad
horizontal scroll, ordinary-wheel conversion and focusable Left/Right/Home/End browsing match Composer.
Project, the combined member/lead control and tags sit as compact property chips above the footer. Project and
team popovers have focused search fields and bounded, vertically scrollable result lists; project matching uses
name and path, while team matching uses name, role and availability. Tag choices use a prominent Mission-label color
dot with tight dot/name spacing, and choosing a tag remains inside the current picker and definition dialog.
The team popover selects members and lead together and retains the existing default-team preference. The split
primary button defaults to 新建; its dropdown offers 开始使命. Both paths stay on the board without opening the
new Camp. No independent-workspace checkbox is offered; Core decides from the selected project. One unfinished
Mission draft is retained for the lifetime of the mounted creation flow, including title, description, project,
team, tags and attachments, whenever the dialog is dismissed and reopened. Only a confirmed successful create
clears it. Failed or uncertain creation retains the exact definition, attachment draft and command identity for
safe retry.

Production Edit opens only from the card/list right-click or Shift+F10 menu. It reuses the same wide writing
dialog; prototype-only previews may expose a direct shortcut. Name, description, tags and source attachments
remain editable. Project and the combined member/lead chip are visible but locked. Cancel and Save remain at
the right; the attachment action stays at the left. Save is disabled until normalized content or the attachment
set differs and validates against 1–200 name / 12,000 description limits. It submits the internal revision
captured when opened. A stale edit stays open, replaces all editable fields with the latest definition and asks
the user to edit again. Success closes the dialog and refreshes the board, opened Mission, conversation title
and main Camp title.

Card opening shows a right conversation drawer with Activity selected in the shared file preview. The left
edge supports pointer and keyboard resizing, cancellation and double-click expansion. It defaults to
1040px with a 640px minimum, and appears as a 12px-inset rounded floating surface over the board.
Dragging its edge within 48px of the main workspace's left edge expands to the full conversation
immediately on pointer movement, without waiting for release; folding restores the previous drawer width.
When a visible preview and the message area no longer fit while the drawer is shrinking, the preview is
hidden first and its tabs/read state are retained, so the message area never disappears as an accidental
result of resizing. This is workspace presentation, not operating-system fullscreen. The same
CampWorkspace, Composer and preview owner stay mounted across these changes.

Opening a Mission notification on Desktop/wide Web shows the board with that Mission's drawer open,
including when the same Mission was already expanded to a full conversation. The notification still
targets its exact message, turn, approval or private conversation through the shared notification flow.
Message/turn targeting hides a compact preview first, retaining its tabs and reading state so the target is visible.

The drawer hides the conversation title and places close/expand at the left. Full presentation shows
project › conversation title, preceded by return-to-board and fold-to-drawer; the fold control keeps its existing
position and uses the inward-corner collapse glyph from the approved board prototype. Both use one full-width
AppHeader with 执行、任务、队员、单聊、活动 in the message column and the preview toggle at the far
right. There is no Mission ellipsis action in the conversation header. With bottom execution placement, entering
the drawer or producing a Run from its Composer does not automatically select a member or expand execution;
explicit execution entry remains available. Full Mission presentation and other execution placements keep their
shared Camp workspace behavior.

The timeline begins with a read-only 使命 card: title, description clamped to three lines with overflow
expansion, current source attachments, roster, tags and read-only status. Attachments reuse the same Composer
cards and focusable no-wrap strip, including file/directory typing, hidden visual scrollbar and
Left/Right/Home/End browsing. Opening an attachment is not a Mission edit action. The Mission card has no edit,
context menu, or detail/delivery/activity links.
An unstarted Mission has a 36px neutral primary 开始使命 action below the card (black in Day) only while Core
projects `startAvailable`. Pressing it immediately disables the stable button, sets its accessible busy state and
changes the label to `正在开始…`. Explicit rejection restores the action and shows the error. Acceptance hides it
without waiting for claim; an ordinary public message hides it after claim creates a non-terminal Run, including
the queued connection phase. The board, drawer and full conversation consume the same Mission projection and
do not infer availability from business status alone. Starting preserves the explicitly managed status and the
internal start message stays excluded from the timeline; no visible “开始使命” or “使命已开始” message is added.

Activity is a real closeable preview tab containing delivery and Mission history in one scrolling document.
Clicking the Activity entry opens or restores it when absent/hidden and selects it when another preview tab is
active. Clicking the selected Activity entry closes that tab.
Closing selects an adjacent remaining file; closing the last tab also hides the preview. Hiding the whole
preview retains all tabs and reading state. Activity acquires no file handle and remains scoped to its Camp.
In Mission conversations the shared preview tab strip occupies the preview column of the same header,
with the same low-contrast divider continuing through the body. Activity, Execution and ordinary files share
the saved preview ratio and the same 420px stable minimum.
After an automatic resize-driven hide, the far-right toggle can still reopen an intentionally selected
compact preview. Compact preview and source-message navigation preserve the conversation and draft.

Delivery shows the actual directory. Before a Git Mission has created its first workspace, the Activity document
does not render the cumulative-changes heading, controls, empty state or workspace-not-prepared error. Once a ready
workspace exists, Delivery shows its source, fixed base and persisted managed branch. Cumulative changes start
collapsed and do not issue `missions.changes` or `missions.fileDiff` while the Activity tab opens, closes, regains
focus, becomes visible or receives Run-terminal events. The first explicit expansion reads the changed-file list;
collapsing and reopening the same mounted Activity reuses that result. Before the first read, the hint says to click
to read current workspace changes and never presents the unread state as an empty result. A successful read adds a
“读取时分支” row from that view's checkout observation: branch and current `HEAD`, detached `HEAD` with a short
commit, or a neutral unavailable state. This row is separate from the persisted managed branch. A Diff-base failure
keeps the observed checkout visible and reports only that cumulative changes cannot currently be compared. Delivery
has no “工作区信息” wrapper or explanatory net-change subtitle.

Agent completion, visible-window focus and visibility restoration mark an existing result as possibly changed but
never rescan Git. They retain the list, selection, open Diff and file cache until the user explicitly refreshes.
Refresh disables duplicate submission; a failed refresh retains the prior result and its reading position. A
successful refresh replaces checkout and file list together, preserves a still-present selected file, and clears
the prior view's per-file cache. Superseded or unmounted responses cannot commit. A stale `missions.fileDiff` view
shows a refresh action in the existing dialog and does not start `missions.changes` itself. Leaving Activity releases
the Diff session; entering a newly mounted Activity returns to the collapsed unread state.

After a successful list read, the activity surface renders the complete changed-file set as a searchable, vertically scrollable directory tree
with a 480px ceiling. Directories precede files, single-child directory chains compress, and all directories are
expanded by default. Large flattened trees keep a bounded mounted-row window while preserving the complete
scroll range, search result set, accessible sibling metadata and Arrow/Home/End navigation; keyboard focus
reveals an off-screen logical row before moving to it. Expand/collapse-all, refresh and open-reader controls stay
in the heading. File rows show only a type icon, filename and compact status glyph; path, change kind, binary
state and rename source remain available to assistive technology.
Selecting a file opens the wide cumulative Diff dialog and requests only that file's Diff. Its header identifies
the fixed baseline, current Mission workspace, total files and aggregate additions/deletions. The body places a
searchable tree beside one Diff reader with old/new line numbers; the dialog has no bottom footer and closes from
its top-right control or Escape. The 1px splitter exposes a forgiving hit target, pointer cancellation, 24px arrow
steps, 80px Shift+arrow steps, and Home/double-click default restoration, while narrow screens collapse the tree
above the reader. A bounded per-Mission memory cache restores a viewed file
without clearing its content or flashing loading state. Cache misses never show the prior file beneath a new
selection; duplicate requests coalesce and late responses cannot replace the current selection. A file request
carries its view association, rereads current Git state with a fresh private index and asks for an explicit full
view refresh when the association is stale. Definition-only edits do not rescan Git. Binary/type/rename
data and Git modes remain in the contract, but the dialog does not print a
raw “Git 文件模式” row. Agent files reuse AttachmentCard, file preview and source-message navigation.
Activity displays actual Mission history. The delete confirmation is intentionally concise and does not repeat
the Mission title, worktree path or branch. When a workspace record exists it adds one default-unchecked
`同时清理 Worktree 及本地分支` option and a focusable `?` explaining that unchecked resources stay in place.
The existing card/list right-click menu shows `清理使命 Worktree` only from Core's `cleanupAvailable`; there is
no conversation-header ellipsis or retained-workspace page. Its dialog states that it removes the Worktree and
local branch, lists the two identifiers, and uses only neutral `取消` / `清理` actions. A cleanup preflight refusal
for unsaved content or an unsafe detached commit is reported asynchronously, keeps the Mission workspace ready and
shows the existing inline alert with the exact reason, resource status and `再次清理` action. A cleanup failure after partial or uncertain deletion keeps the
Mission and returns to the same explicit retry path. After Core durably accepts the cleanup intent, the
dialog closes without waiting for Git work, the Mission list or the current Camp to refresh. The card adds one
full-width bottom resource row without changing its business-status lane: spinner plus `正在清理 Worktree…`
while pending, persistent `Worktree 清理失败 · 查看` (or `分支清理失败 · 查看`) after failure, and
`✓ Worktree 已清理` for about four seconds after an observed success. Leaving/re-entering or refreshing does
not replay success. The cleanup menu item is unavailable while pending, failed or complete.

Failure also uses the existing bottom-right danger Toast, names `M-NNN` and provides `查看`. Toast expiry does
not remove the card error. The Activity delivery section shows the reason, exact path/branch, actual Worktree
and branch checkpoints, and `重试未完成步骤`; a partial branch failure never suggests the removed Worktree is
recoverable. A refresh failure is separately worded as cleanup having started but status refresh failing and
cannot revert a later success.

Delete-with-cleanup removes the card after Camp deletion and cleanup-intent persistence commit, without waiting
for filesystem work. A later failure raises the same actionable Toast and remains in the existing
`工作区待清理` dialog, which shows both checkpoints and retries only unfinished work; it never restores the card.
Retained resources never enter that route. No percentage, countdown, pause action or new task center is added.
Each explicit source-link click positions and highlights its message once. After presentation, clear that
focus request even when there is no notification acknowledgement waiter; snapshot updates must not replay
the positioning or steal the user's subsequent focus. Status history uses the actor and new status only,
such as “爱丽丝 将状态改为‘未开始’”, for both user and Agent changes.

Business and ownership rules are defined by [Mission v11](../../contracts/mission-v11.md), not this presentation
contract. Theme and ordinary conversation behavior remain under [DESIGN.md](../../../DESIGN.md) and
[Camp workspace](conversation-workspace.md).
