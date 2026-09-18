---
document_type: ui-contract
authority: mission-renderer-presentation
status: accepted
last_updated: 2026-09-18
---

# Mission board

Desktop and wide Web retain the Mission board surface, route and interaction model, but the current release
hides its 使命板 navigation menu entry. The hidden entry's badge would count `needs_you` Missions independently
of unread messages and running Agents. Ordinary project/recent/pin navigation does not duplicate Mission Camps.
Mobile has no Mission entry; a Mission deep link directs the user to desktop.

Cards open from their entire surface, including keyboard activation. Card actions have no visible ellipsis;
right click or Shift+F10 opens the same accessible menu. The metadata label uses the stable public number
(`M-018`), never an opaque ID suffix. Show all member avatars with the lead first, project followed by tags,
and a plain relative timestamp such as “昨天”. An active card places at most three running-member avatars,
the remaining `+N`, and the execution-console sweep text “执行中” in one muted row at the upper right.
Unread uses a message icon plus “未读” in the footer rather than a small isolated dot. Card and list menus
share this order: 编辑、状态、查看队员、队长、标签、删除. Click opens
submenus; chevrons use the existing 16px icon rhythm. Tags use a lightweight search/create/check popover.
Status/tag/project filters use matching icon triggers and neutral filled multi-select checkboxes. No selection
means all, without an extra “all” option. Project and tag pickers have search; status does not. Search and the
low-frequency board/list menu share the toolbar without vertical separators. The page uses the white home
surface in Day and its Night equivalent. Its title/subtitle use the same 34px overview-page top inset as
Memory and Scheduled Automation, align with shell controls, and lead into four equally tall,
very light neutral rounded lanes, including empty lanes. List mode groups and folds rows by status.
Lanes retain at least 200px at narrow widths or increased zoom; the board scrolls horizontally rather than squeezing card content.
Dragging a card to another lane submits the same authoritative status command as the menu; both user and
Agent status activity render only the actor and resulting status. Tags reuse the eight stable identity colors,
independent of Mission status.

Creation uses an 820px writing dialog. Mission name is an unboxed heading field; the unboxed description
fills the remaining writing plane. Source attachments sit between them and support file selection, paste,
drag/drop and removal using the Composer attachment rhythm. They reuse the Composer's file/directory
classification and `DIR` label. Overflow stays in one no-wrap strip with no visible scrollbar; trackpad
horizontal scroll, ordinary-wheel conversion and focusable Left/Right/Home/End browsing match Composer.
Project, the combined member/lead control and
tags sit as compact property chips above the footer. The team popover selects members and lead together and
retains the existing default-team preference. The split primary button defaults to 新建; its dropdown offers
开始使命. Both paths stay on the board without opening the new Camp. No independent-workspace checkbox is
offered; Core decides from the selected project. Failed or uncertain creation retains the exact definition,
attachment draft and command identity for safe retry.

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
project › conversation title, preceded by return-to-board and fold-to-drawer. Both use one full-width
AppHeader with 执行、任务、队员、单聊、活动 in the message column and the preview toggle at the far
right. There is no Mission ellipsis action in the conversation header. Drawer runs do not automatically
open the execution inspector or overlay; explicit execution entry remains available.

The timeline begins with a read-only 使命 card: title, description clamped to three lines with overflow
expansion, current source attachments, roster, tags and read-only status. Attachments reuse the same Composer
cards and focusable no-wrap strip, including file/directory typing, hidden visual scrollbar and
Left/Right/Home/End browsing. Opening an attachment is not a Mission edit action. The Mission card has no edit,
context menu, or detail/delivery/activity links.
An unstarted Mission has a 36px neutral primary 开始使命 action below the card (black in Day).
Starting schedules the Mission and preserves its explicitly managed status without inserting a visible user-authored message;
the timeline remains unchanged until a teammate publishes a message.

Activity is a real closeable preview tab containing delivery and Mission history in one scrolling document.
Clicking the Activity entry opens or restores it when absent/hidden; when its tab already exists in the
visible preview, the same entry closes that tab even if another file is currently selected.
Closing selects an adjacent remaining file; closing the last tab also hides the preview. Hiding the whole
preview retains all tabs and reading state. Activity acquires no file handle and remains scoped to its Camp.
In Mission conversations the shared preview tab strip occupies the preview column of the same header,
with the same low-contrast divider continuing through the body. Activity defaults to a narrow 320px
column (300px stable minimum); ordinary files retain the normal preview ratio and 420px stable minimum.
After an automatic resize-driven hide, the far-right toggle can still reopen an intentionally selected
compact preview. Compact preview and source-message navigation preserve the conversation and draft.

Delivery shows the actual directory and, for Git, associated branch/base and cumulative changes. It has no
“工作区信息” wrapper or explanatory net-change subtitle. Opening the section reads the changed-file list;
the activity surface initially shows five files and uses “再显示 N 个文件 / 收起文件” to expand in place.
switching files requests only the selected Diff. A bounded per-Mission memory cache restores a viewed file
without clearing its content or flashing loading state. Cache misses never show the prior file beneath a new
selection; duplicate requests coalesce and late responses cannot replace the current selection. Explicit
refresh and coalesced Run-terminal/workspace invalidation clear the cache and update the list; definition-only
edits do not. Binary/type/rename data and Git modes remain in the contract, but the dialog does not print a
raw “Git 文件模式” row. Agent files reuse AttachmentCard, file preview and source-message navigation.
Activity displays actual Mission history. The delete confirmation is intentionally concise and does not repeat
the Mission title, worktree path or branch; failed cleanup remains visible and retryable after deletion.
Each explicit source-link click positions and highlights its message once. After presentation, clear that
focus request even when there is no notification acknowledgement waiter; snapshot updates must not replay
the positioning or steal the user's subsequent focus. Status history uses the actor and new status only,
such as “爱丽丝 将状态改为‘未开始’”, for both user and Agent changes.
The cumulative Diff dialog uses the wide desktop reading surface rather than the standard compact-dialog width.

Business and ownership rules are defined by [Mission v2](../../contracts/mission-v2.md), not this presentation
contract. Theme and ordinary conversation behavior remain under [DESIGN.md](../../../DESIGN.md) and
[Camp workspace](conversation-workspace.md).
