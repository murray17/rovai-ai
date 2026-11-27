# Rovai AI v0.5.17

<!-- lang:zh-CN -->

这版可以拖动调整侧栏项目顺序，定时任务操作后会留在原位。发送图片时会复用已有预览，飞书、Lark 和钉钉也减少了查询群名单的 API 调用。

- 【功能】**侧栏项目目录支持拖动排序。** 普通项目和置顶项目可以在各自分区内拖动，也可以从项目菜单上移或下移。手机网页版可拖动文件夹图标，刷新后会保留排序。
- 【交互】**定时任务操作后留在原位。** 编辑、开关、运行一次或从详情返回时，列表保留原顺序。在「开启」筛选中刚关闭的任务，可以直接在原位重新打开。本窗口新建的任务会放到顶部。
- 【性能】**减少飞书、Lark 和钉钉的渠道 API 调用。** 普通群收到有效的群内 @ 或确认绑定时，才按需查询机器人名单。启动和重连省去历史群扫描，日常派发使用本地名单。
- 【修复】**首次绑定渠道群时，按发送顺序交付消息。** 如果绑定前先发了文件，再发总结请求，绑定后队员会先收到文件，再收到后续文字。
- 【性能】**发送图片后直接显示已有预览。** 粘贴或拖入的图片如果已在输入框里显示，发送后公屏和回复详情会直接使用这份预览。公屏和多选导出同时用到同一张图时，也会共用一次读取。
- 【修复】**长会话的消息定位条会正确高亮。** 从公屏左侧的定位条跳到较远的消息时，目标消息进入可视区后，对应标记会同步高亮。
- 【修复】**执行台上翻时保持阅读位置。** 向上翻看历史会暂停自动跟随，滚回底部后继续跟随。重新打开会话时，跟随模式也会正确定位到最新记录。
- 【修复】**重新打开图片时恢复缩放和滚动位置。** 图片加载完成后会回到上次的阅读位置。图片自动刷新时，缩放控件也会保留键盘焦点。

---

<!-- lang:en -->

This release adds sidebar project sorting, keeps scheduled tasks in place as you work, and reuses image previews when you send a message. It also reduces group roster API calls for Feishu, Lark, and DingTalk.

- [Feature] **Drag project folders to reorder the sidebar.** Reorder regular and pinned projects within their sections by dragging or from the project menu. On the mobile web app, drag the folder icon. The order is saved across refreshes.
- [Interaction] **Scheduled tasks stay in place.** Editing a task, toggling it, running it once, or returning from its details keeps the list order. You can turn a task back on from where you turned it off in the Enabled filter. Tasks created in the current window appear at the top.
- [Performance] **Fewer API calls for Feishu, Lark, and DingTalk.** For regular groups, Rovai looks up the bot roster when it receives a valid group mention or confirms a binding. Startup and reconnection skip scans of historical groups, and routine dispatch uses the local roster.
- [Fix] **Deliver messages in order when binding a channel group for the first time.** If you send a file and then a request before completing the binding, the teammate receives the file before the follow-up text.
- [Performance] **Reuse existing previews when sending images.** Images already displayed in the composer appear immediately in the shared conversation and reply details. When the conversation and multi-message export need the same image together, they share one read.
- [Fix] **Highlight the correct message marker in long conversations.** When you jump to a distant message from the marker rail, its marker is highlighted once the message comes into view.
- [Fix] **Keep your place while reading execution history.** Scrolling up pauses automatic following, and returning to the bottom resumes it. Reopening a conversation in follow mode correctly locates the latest execution output.
- [Fix] **Restore zoom and scroll position when reopening images.** The viewer restores your position once the image loads. Automatic image refreshes also preserve keyboard focus on the zoom controls.
