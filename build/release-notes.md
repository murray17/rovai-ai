# Rovai AI v0.5.9

<!-- lang:zh-CN -->

本次更新支持从侧栏导出完整会话，减少打开和切换会话时的查询开销，并修复执行状态显示和智能体收尾时的误判。

感谢 @caoshuisi 在 Issue #1012 中反馈 Pi 执行结束后被误判为失败，以及 CodeBuddy 报错原因不明确的问题。

- 【功能】**支持从侧栏导出完整会话。** 在会话菜单选择「导出会话」，无需先滚动加载历史消息，即可预览并保存为 HTML、PNG 或 Markdown。需要导出片段时可多选消息，选中文字后的浮条仅提供引用。
- 【界面】**优化手机端的导出预览。** 长按会话可打开导出菜单，HTML 预览随屏幕宽度排版，底部按钮更便于触控。
- 【性能】**减少打开和切换会话时对无关历史的扫描。** 执行数量、执行列表和文件变更按当前会话读取。部分旧版执行卡片及其文件变更会从公屏的相应列表中移除，历史消息和原始记录仍保存在数据库中。
- 【修复】**重新执行后，消息回执会跟随最新状态。** 执行失败或手动停止后再次执行，回执会随新一轮更新，「查看执行」也会打开新一轮的记录。同时修复没有投递或执行记录却误显示「待处理」的问题。
- 【修复】**修复智能体正常结束却被判为失败的问题。** Pi、Codex、Antigravity 及部分 ACP 智能体明确返回成功时，即使没有最后一条文字回复，执行也会正常结束。
- 【修复】**CodeBuddy 执行卡片会显示具体报错。** 模型请求失败时，如果 CodeBuddy 返回了鉴权失败、请求参数有误等详情，可直接在执行卡片中查看。
- 【交互】**项目收起后再展开，从第一页显示会话。** 普通项目、置顶项目和快速对话均先显示 5 条未置顶会话，可点击「查看更多」继续加载。

---

<!-- lang:en -->

This release adds full conversation export, reduces the amount of history scanned when opening or switching conversations, and fixes how execution status and Agent completion are reported.

Thanks to @caoshuisi for reporting Pi runs being marked as failed after completion and unclear CodeBuddy errors in Issue #1012.

- [Feature] **Export a full conversation from the sidebar.** Choose “Export thread” from the conversation menu to preview and save the conversation as HTML, PNG, or Markdown without scrolling back to load older messages. To export an excerpt, select multiple messages. The text-selection toolbar now offers only quoting.
- [UI] **Improve export preview on phones.** Long-press a conversation to open the export menu. The HTML preview fits the screen width, and the buttons are easier to tap.
- [Performance] **Scan less unrelated history when opening or switching conversations.** Run counts, run lists, and file changes are read for the current conversation. Some older run cards and their file changes are removed from these lists. Messages and original records are retained in the database.
- [Fix] **Show the latest run status after retrying.** After a failed or manually stopped run is retried, the message receipt follows the new attempt and “View run” opens it. Receipts no longer show “Pending” when there is no delivery or run record.
- [Fix] **Recognize successful runs without a final text reply.** When Pi, Codex, Antigravity, or a supported ACP Agent reports success, the run can complete without a final chat message.
- [Fix] **Show the error details returned by CodeBuddy.** When a model request fails, the run card shows available details, such as an authentication error or invalid request parameters.
- [UX] **Show the first page of conversations when a group is reopened.** Regular projects, pinned projects, and Quick Chat initially show five unpinned conversations. Use “Show more” to load additional entries.
