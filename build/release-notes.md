# Rovai AI v0.5.15

<!-- lang:zh-CN -->

本次更新支持跨会话搜索公屏消息、归档会话与使命，以及编辑和删除已发送的消息。继续执行、会话读取和失败重试也有调整。

感谢 @arschlochnop 在 Issue #1042 中提出会话归档和跨会话消息搜索的建议。

- 【功能】**侧栏搜索支持查找会话、使命和公屏消息。** 桌面端和网页版均可使用。支持按标题、项目名、使命编号或消息正文查找，点击消息结果可跳到原文。也可用 `⌘K` / `Ctrl+K` 打开搜索。
- 【功能】**支持归档会话和使命。** 归档后会停止相关执行，并从侧栏或使命列表中收起，消息、附件和草稿可在恢复后继续查看。
- 【功能】**新增「设置 → 归档」管理页。** 可按项目筛选，按标题或会话 ID 查找，支持恢复或删除。刚归档时可以直接撤销，也可以点「查看」定位到对应记录。
- 【功能】**已发送的消息可以原地编辑。** 可修改自己发到公屏上的正文、队员提及和附件，保存后显示「已编辑」。正在处理旧内容的相关执行会停止，修改后的消息重新排队。
- 【功能】**支持删除自己和队员发到公屏上的消息。** 删除后，后续回复仍可查看，引用位置会显示「原消息已删除」。
- 【交互】**侧栏会显示并定位当前会话。** 从搜索打开旧会话或恢复上次打开的会话时，即使它还没出现在当前列表里，侧栏也会补上该条目，并在需要时滚动到可见位置。
- 【交互】**继续执行时按消息顺序排队。** 停止或失败后点击继续，原消息会回到对应队员的队列。已经在等待的同一条消息会复用原有排队项。
- 【修复】**收到新回复时，仍可完成会话操作。** 修复确认删除、修改普通会话名称或更换队长期间，队员的新回复导致提交失败的问题。
- 【修复】**改善会话读取失败后的恢复。** 会话刷新失败会自动重试，持续失败时可手动重试。网页版断线恢复后，如果上传文件需要重新选择，会在页面上给出提示。
- 【性能】**减少长会话和执行详情的读取开销。** 执行卡片优先使用已加载的消息，需要时再读取更早的来源内容。
- 【修复】**修复队员查找历史消息时的漏检。** 当前会话和跨会话的查找都按连续原文匹配，忽略英文大小写。
- 【界面】**调整设置侧栏、操作提示和提交按钮。** 设置分类可独立滚动，操作提示可手动关闭。保存、删除等按钮在等待提交结果时保持原位和尺寸，减少界面跳动。

---

<!-- lang:en -->

This release adds cross-conversation search for public messages, archiving for conversations and missions, and editing and deletion of sent messages. It also improves execution retries, conversation loading, and recovery after errors.

Thanks to @arschlochnop for suggesting conversation archiving and cross-conversation message search in Issue #1042.

- [Feature] **Find conversations, missions, and public messages from the sidebar.** On desktop and the web, search by title, project name, mission number, or message text. Open a message result to jump to the original. Use `⌘K` or `Ctrl+K` to open search.
- [Feature] **Archive conversations and missions.** Archiving stops related executions and removes the item from the sidebar or mission list. Restore it to access its messages, attachments, and drafts.
- [Feature] **Manage archived items in Settings → Archive.** Filter by project or search by title or conversation ID, then restore or delete an item. After archiving, use Undo or View to find the archived item.
- [Feature] **Edit your sent messages in place.** Change the text, teammate mentions, or attachments on your public messages. Saved changes are marked Edited. Executions still processing the previous version stop, and the edited message is queued again.
- [Feature] **Delete your own or a teammate’s public messages.** Subsequent replies stay visible, with a placeholder where they reference the deleted message.
- [Interaction] **Show the current conversation in the sidebar.** When an older conversation opens from search or is restored at startup, the sidebar can add it to the visible list and scroll it into view.
- [Interaction] **Resume executions in message order.** Continuing a stopped or failed execution returns its messages to the same teammate’s queue. A message that is already waiting keeps its queue entry.
- [Fix] **Complete conversation actions when a new reply arrives.** Incoming replies no longer block a pending conversation deletion, rename, or change of team lead.
- [Fix] **Recover from conversation loading errors.** Refresh failures retry automatically and offer a manual retry if they persist. The web app also tells you when files need to be selected again after reconnecting.
- [Performance] **Reduce loading work for long conversations and execution details.** Execution cards reuse loaded messages and fetch older source messages only as needed.
- [Fix] **Find previously missed messages in teammate searches.** Searches within and across conversations match contiguous text without regard to letter case.
- [UI] **Update the Settings sidebar, notifications, and submit buttons.** Settings categories scroll independently, notifications can be dismissed, and buttons such as Save and Delete keep their size and position during submission.
