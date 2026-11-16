# Rovai AI v0.5.13

<!-- lang:zh-CN -->

本次更新新增长期记忆开关，支持在会话里直接下载队员发来的文件，并改善长会话的输入、翻阅和恢复。

感谢 @NorethSea 在 Issue #1074 中提出关闭 Rovai 内置长期记忆的建议，也感谢 @liuqiong0319 反馈 GitHub Copilot 无法运行的问题。

- 【功能】**新增长期记忆总开关。** 默认开启，可在「通用设置 → 会话」下切换「记忆」，也可以在记忆页操作。同一实例的桌面端、网页端和移动端共用设置。关闭后暂停队员读写和记忆页管理，已有记忆和待审核项会保留，重新开启后可继续使用。
- 【功能】**可直接下载队员发来的文件。** 鼠标悬停在文件行或用键盘聚焦时，右侧会显示下载按钮。触屏直接显示该按钮，桌面端可以选择保存位置。
- 【性能】**改善长会话的输入和滚动。** 公屏只渲染阅读位置附近的消息，队员的实时输出只更新对应执行。向上加载历史时保留阅读位置。关闭搜索后，页面以用户最新的滚动、发送或定位操作为准。
- 【界面】**执行卡片用一个数字显示已统计的 Token。** 执行中和结束后都可查看本次执行已记录的用量，例如 `12.5K`。点击可查看输入、输出、缓存和耗时明细。
- 【修复】**修复 GitHub Copilot 等智能体恢复长会话时过早失败的问题。** 允许回放更多历史来接续原会话，恢复时限从 30 秒延长到 2 分钟。
- 【修复】**飞书和 Lark 机器人遇到临时断线会自动重连。** 渠道页在连接异常时显示断链图标。如果机器人已发布、只差建立连接，重连成功后会自动完成发布的最后一步。
- 【界面】**缺少模型记录时隐藏模型信息入口。** 消息头和执行卡片会在有模型信息可查看时显示摘要。

---

<!-- lang:en -->

This update adds a long-term memory switch and direct downloads for files shared by teammates. It also improves typing, browsing, and recovery in long conversations.

Thanks to @NorethSea for requesting the Rovai memory switch in Issue #1074, and to @liuqiong0319 for reporting that GitHub Copilot could not run.

- [Feature] **Turn Rovai long-term memory on or off.** Memory is enabled by default. You can change it under General Settings → Conversation or on the Memory page. Desktop, Web, and mobile clients connected to the same instance share the setting. Turning it off pauses teammate access and memory management. Saved memories and pending reviews are available again when you re-enable it.
- [Feature] **Download files shared by teammates from the conversation.** The download button appears when you hover over or focus a file row and is visible on touch devices. Desktop lets you choose where to save the file.
- [Performance] **Improve typing and scrolling in long conversations.** Public history renders around your reading position, and live output updates the relevant execution. Loading older messages preserves your position. After closing search, your most recent scroll, send, or navigation action takes precedence.
- [UI] **Show recorded Token usage as one number on each execution card.** When usage is available, running and completed executions show a total such as `12.5K`. Select it to see input, output, cache, and elapsed time.
- [Fix] **Keep long sessions recoverable in GitHub Copilot and other Agents.** Rovai can replay more history to resume the original session and now allows up to two minutes for recovery.
- [Fix] **Reconnect Feishu and Lark bots after temporary connection losses.** Channels shows a disconnected icon when a bot has a connection problem. If a published bot is still waiting for a connection, reconnecting completes the final setup step.
- [UI] **Hide model details when no model information was recorded.** Message headers and execution cards show the summary when model information is available.
