# Rovai AI v0.5.4

<!-- lang:zh-CN -->

本次更新增加表格复制和常见 HTML 内容显示，调整消息引用与执行条交互，并改善启动、会话切换及异常退出后的恢复。

感谢 [@LumePure](https://github.com/LumePure) 在 [#942](https://github.com/murray17/rovai-ai/issues/942) 中反馈 Windows 无法启动的问题，以及 [@liuqiong0319](https://github.com/liuqiong0319) 提出的一键复制表格建议。

- 【功能】**支持一键复制表格。** 消息和 Markdown 文件预览中的表格增加复制按钮，可复制完整表格，保留单元格格式和换行；同时调整表头、分隔线和宽表滚动样式。
- 【功能】**支持显示常见 HTML 内容。** 消息和 Markdown 文件中的表格换行、折叠内容等可正常显示，代码块及转义文本仍保留原文。
- 【交互】**简化消息引用。** 引用直接保存选中的文字，旧引用仍可使用；有来源信息时可跳回原消息，定位以整条消息为单位。
- 【交互】**手动停止后保留执行条。** 在原位置显示“已停止”和最终耗时，可通过图标继续执行；失败时提供图标重试入口。执行条中的工具名称也与执行详情保持一致。
- 【性能】**减少启动时的重复处理。** 精简数据库检查和重复打开步骤，历史进程清理改为启动后的限时后台处理，减少进入工作区前的等待。
- 【性能】**恢复最近会话的快速切换。** 修复关闭任务功能时，会话缓存被反复清空的问题。返回最近访问的会话时，先显示已有消息，再更新内容。
- 【修复】**改善异常退出后的继续执行与资源清理。** 历史异常记录不再阻挡新任务、使命工作区清理和会话删除；修复队员异常退出或启动过程中停止后，后续执行可能卡住的问题。
- 【修复】**改善模型列表和参数兼容。** 重复模型自动合并，个别异常条目不再导致整份列表失效。读取失败时保留已有列表、模型和参数，不因列表未收录而阻止执行。
- 【修复】**修复 Codex 部分配置下无法启动的问题。** 正确处理默认模型、手动指定模型与 Fast、思考强度的组合，避免有效配置被错误拦截。
- 【修复】**修复 Windows 部分权限环境下的启动失败。** 已有数据目录可正常读写时，不再因权限模板差异被错误拦截。
- 【界面】**侧栏长标题显示更多内容。** 项目名、会话名及搜索结果充分利用可用宽度，超出部分采用末尾渐隐；操作按钮出现时再让出空间。
- 【界面】**统一控件状态与主题配色。** 调整模型菜单、新对话、提及候选和附件菜单等控件的悬停、选中颜色，减淡会话中的用户姓名，并修正部分按钮的文字对比度。

[完整变更](https://github.com/murray17/rovai-ai/compare/v0.5.3...v0.5.4)

---

<!-- lang:en -->

This release adds table copying and support for common HTML content, updates message quotes and execution controls, and improves startup, conversation switching, and recovery after unexpected exits.

Thanks to [@LumePure](https://github.com/LumePure) for reporting the Windows startup failure in [#942](https://github.com/murray17/rovai-ai/issues/942), and to [@liuqiong0319](https://github.com/liuqiong0319) for suggesting one-click table copying.

- [Feature] **Copy a complete table with one click.** Tables in messages and Markdown file previews now have a copy button that preserves cell formatting and line breaks. Table headers, separators, and horizontal scrolling have also been adjusted.
- [Feature] **Display common HTML content.** Messages and Markdown files can render table line breaks, collapsible content, and other common HTML elements. Code blocks and escaped text keep their original content.
- [Interaction] **Simplify message quotes.** Quotes save the selected text directly, and existing quotes remain usable. When source information is available, you can jump back to the original message; navigation targets the whole message.
- [Interaction] **Keep the execution row after a manual stop.** The row shows Stopped and the final elapsed time, with an icon to continue. Failed executions offer an icon to retry. Tool names in the row now match those in execution details.
- [Performance] **Reduce repeated work during startup.** Streamline database checks and repeated opens, and move historical process cleanup to a bounded background operation after startup to reduce the wait before entering the workspace.
- [Performance] **Restore fast switching between recent conversations.** Fix repeated cache clearing when Tasks are disabled. Returning to a recently opened conversation shows cached messages first, then refreshes the content.
- [Fix] **Improve continuation and resource cleanup after unexpected exits.** Historical error records no longer block new tasks, mission workspace cleanup, or conversation deletion. Fix subsequent executions getting stuck after a teammate exits unexpectedly or is stopped during startup.
- [Fix] **Improve model catalog and parameter compatibility.** Merge duplicate models and keep individual malformed entries from invalidating the whole catalog. Failed reads preserve the existing list, model, and parameters; missing catalog entries no longer block execution.
- [Fix] **Fix Codex failing to start with some configurations.** Handle combinations of the default or an explicit model with Fast and reasoning effort without incorrectly rejecting valid configurations.
- [Fix] **Fix Windows startup failures in some permission environments.** Existing data directories that are readable and writable are no longer rejected because their permissions differ from a fixed template.
- [UI] **Show more of long navigation titles.** Project names, conversation names, and search results use the available width and fade at the end when needed. Space is reserved for action buttons only when they appear.
- [UI] **Align control states with the selected theme.** Adjust hover and selection colors in model menus, new conversation menus, mention suggestions, and attachment menus; soften user names in conversations and improve text contrast on some buttons.

[Full changelog](https://github.com/murray17/rovai-ai/compare/v0.5.3...v0.5.4)
