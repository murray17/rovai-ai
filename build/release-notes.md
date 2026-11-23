# Rovai AI v0.5.16

<!-- lang:zh-CN -->

这版缩小了 macOS 手动安装包，并加入后续版本的增量下载支持。公屏执行状态、侧栏和文件变更预览也有调整。

- 【性能】**缩小 macOS 手动安装包。** 用 v0.5.15 的安装包重新压缩实测，Apple 芯片版约小 26%，Intel 版约小 21%。
- 【功能】**macOS 应用内更新支持增量下载。** 从 v0.5.15 升到本版会下载整包。后续更新在本机缓存和更新索引匹配时，只下载变更部分。macOS 和 Windows 遇到异常的分段响应时，会自动改为下载整包。
- 【交互】**统一公屏回执、执行条和执行卡的状态。** 自动恢复时显示「正在恢复」，需要审批、回答或手动处理时会说明原因。停止和失败优先在执行区显示，执行卡可查看具体原因。
- 【功能】**插话可以查看送达进度。** 回执会区分「待发送」「发送中」「已收到」，转回队列时显示「排队中」。送达结果未确认时，符合条件的 Codex 插话可点「核对结果」。
- 【界面】**调整侧栏搜索入口和会话高亮。** 桌面端和宽屏网页版的搜索图标移到侧栏顶部。项目展开时高亮当前会话，折叠时高亮所属项目。切到队员或团队等页面时，会保留最近选中的会话。
- 【界面】**文件变更详情改用单行工具栏。** 窄窗口可通过文件路径搜索和切换文件，宽窗口可在左侧列表查看各文件的变更统计。差异正文直接展示，省去差异类型标签和修改编号。
- 【交互】**简化从当前会话移出队员的流程。** 影响详情暂时读不到时，也可以确认移出。如果提交时队员名单已变化，会提示重新选择。
- 【交互】**关闭 Codex 队员的原生问卷。** 使用 Codex CLI 0.163.0 及以上版本时，Rovai 会关闭同步和异步问卷。
- 【交互】**简化队员的会话发送指引。** 执行过程留在执行台供实时查看，需要公开的答复、结果和总结再发到公屏。

---

<!-- lang:en -->

This release reduces macOS installer downloads and adds differential downloads for future in-app updates. It also adjusts shared conversation status, the sidebar, and file change previews.

- [Performance] **Smaller macOS installers.** Recompressing the v0.5.15 DMGs reduced their download size by about 26% for Apple silicon and 21% for Intel.
- [Feature] **Differential downloads for macOS in-app updates.** Updating from v0.5.15 downloads the full package. Future updates can download just the changed data when the cached package matches the update indexes. On macOS and Windows, an invalid partial download response triggers a full download.
- [Interaction] **Consistent execution status in shared conversations.** Receipts, execution rows, and execution cards use the same status labels. Automatic recovery shows its progress, and actions such as approvals or questions explain what needs attention. Execution cards show the reason for a stop or failure when available.
- [Feature] **See delivery progress for steering messages.** Receipts distinguish pending, sending, and received, and show when a message returns to the queue. If delivery is uncertain, eligible Codex messages offer a check.
- [UI] **Updated sidebar search and selection.** Search moves to the top of the desktop and wide web sidebars. The current conversation is highlighted in expanded projects, and its project is highlighted when collapsed. Opening views such as Teammates or Teams retains the most recent conversation selection.
- [UI] **A single-row toolbar for file change details.** In a narrow pane, select the file path to search and switch files. In a wider pane, each file's change counts appear in the sidebar. The diff opens directly without extra change-type labels or numbers.
- [Interaction] **Simpler removal of teammates from the current conversation.** You can confirm a removal if its impact preview temporarily fails to load. If the roster has changed, Rovai asks you to select the teammate again.
- [Interaction] **Disable native questionnaires for Codex teammates.** Rovai turns off both synchronous and asynchronous questionnaires with Codex CLI 0.163.0 and later.
- [Interaction] **Simplified guidance for teammate messages.** The execution console shows work in progress. Teammates post answers, results, and summaries that need to be shared to the conversation.
