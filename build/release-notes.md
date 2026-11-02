# Rovai AI v0.5.5

<!-- lang:zh-CN -->

本次更新新增文件目录、搜索与编辑，完善子智能体工具调用的展示，并修复启动配置、附件、MCP 和会话恢复中的问题。

- 【功能】**专业职责上限提升至 30,000 字符，保留完整正文与内部格式。** 较长职责可完整保存；单次执行仍按完整输入容量检查，超限时提示精简后重新提交。
- 【功能】**支持浏览和搜索项目文件。** 在会话中展开当前工作目录，按文件名或路径搜索并打开文件，无需先让文件出现在对话里。目录宽度可拖动调整，窄窗口下以抽屉显示，外部新建、重命名或删除文件后自动更新。
- 【功能】**支持直接编辑并保存文件。** 可修改已打开的可写文本、代码和配置文件，Markdown、HTML 支持源码与预览切换。支持 Ctrl/Cmd+S 保存到原文件，桌面端和 Web 端均可使用。
- 【交互】**切换文件或会话时保留编辑内容。** 同一文件从不同入口打开时，共用标签、草稿和撤销记录。关闭未保存文件时会提醒，取消可继续编辑，确认则放弃修改；文件被其他程序修改后，保存时会提示处理冲突。
- 【功能】**支持查看子智能体的工具调用。** 执行列表可展示原生智能体返回的子任务工具调用，展开查看参数、结果和状态。同一次调用在原位置更新，避免子智能体正文混入主智能体正文，并保留详情的展开状态和滚动位置。
- 【性能】**减少恢复会话时的等待。** 对无需回放历史的原生会话，恢复成功后直接继续执行，省去额外等待。
- 【性能】**优化使命文件差异读取和工作区复用。** 查看单个文件的差异时，不再因其他文件变化反复要求刷新；复用已就绪工作区时减少重复检查，普通任务也减少了对无关使命操作的等待。
- 【修复】**修复局部配置异常导致启动或执行受阻的问题。** 旧附件记录、未使用的智能体配置或外部 MCP 配置异常时，不再连带阻止其他正常功能。损坏的智能体启动设置可在设置页重新选择程序，或恢复自动检测后保存。
- 【修复】**修复 MCP 导入和目录权限问题。** 修复首次从本机导入 MCP 时可能保存失败的问题；复制或恢复数据后，可以正常读写的 MCP 目录不再因权限形式不同而被拒绝使用。
- 【修复】**修复旧日志清理失败导致 Antigravity 无法启用的问题。** 启动不再依赖旧日志目录的删除，原有日志会保留。
- 【修复】**修复长文件名附件被错误拒绝的问题。** 较长文件名的附件可正常添加、恢复和预览，保留原文件名。
- 【修复】**修复部分 Skill 文件无法预览的问题。** 文件数量较多、目录较深，或其他子目录无法读取时，不再影响已选文件的正常查看。
- 【修复】**修复部分智能体的执行兼容问题。** 修复 Grok 新建会话时参数被拒绝的问题；Qoder 子任务改用同步返回，避免结果在当前执行结束后才到达；ZCode 达到账号并发上限时显示明确提示。
- 【界面】**调整文件区域和执行信息的显示。** 统一文件类型图标，精简代码行号与分隔样式，改善窄窗口及高倍缩放下的布局；执行区的模型名称和思考强度改用当前主题的次级文字色。

[完整变更](https://github.com/murray17/rovai-ai/compare/v0.5.4...v0.5.5)

---

<!-- lang:en -->

This release adds file browsing, search, and editing, improves the display of native subagent tool calls, and fixes issues with startup settings, attachments, MCP, and session recovery.

- [Feature] **Responsibilities now support up to 30,000 characters, preserving the full text and internal formatting.** Longer responsibilities can be saved in full; each execution still checks the complete input budget and asks you to shorten and resubmit oversized input.
- [Feature] **Browse and search project files.** Open the current working directory from a conversation and find files by name or path, even if they have never appeared in the conversation. Resize the directory pane, use its drawer in narrow windows, and see external file additions, renames, and deletions reflected automatically.
- [Feature] **Edit and save files directly.** Edit opened writable text, code, and configuration files, and switch between source and preview for Markdown and HTML. Save to the original file with Ctrl/Cmd+S on both Desktop and Web.
- [Interaction] **Keep edits when switching files or conversations.** Opening the same file from different entry points reuses its tab, draft, and undo history. Closing an unsaved file asks for confirmation: Cancel keeps editing, while Confirm discards the changes. Saving after an external modification prompts you to resolve the conflict.
- [Feature] **View native subagent tool calls.** The execution list can show subtask tool calls forwarded by native agents, with expandable parameters, results, and status. Updates keep each call in place, separate subagent text from the main agent text, and preserve expanded details and scroll positions.
- [Performance] **Reduce the wait when resuming conversations.** Native sessions that do not need history replay can continue immediately after a successful resume.
- [Performance] **Streamline Mission file diffs and workspace reuse.** Viewing one file's diff no longer repeatedly requires a refresh because another file changed. Reusing a ready workspace avoids duplicate checks, and ordinary tasks spend less time waiting on unrelated Mission operations.
- [Fix] **Keep optional configuration failures from blocking startup or execution.** Problems with legacy attachment records, unused agent settings, or external MCP configuration no longer make unrelated healthy features unavailable. Damaged agent startup settings can be corrected in Settings by selecting the program again or restoring automatic detection and saving.
- [Fix] **Fix MCP import and directory permission issues.** Fix possible save failures on the first local MCP import. After copying or restoring data, readable and writable MCP directories are no longer rejected because their permission layout differs.
- [Fix] **Fix Antigravity initialization being blocked by legacy log cleanup.** Startup no longer depends on deleting the old log directory, and existing logs are retained.
- [Fix] **Stop incorrectly rejecting attachments with long filenames.** Add, restore, and preview attachments with longer filenames while retaining their original names.
- [Fix] **Fix previews of some Skill files.** Large file counts, deep directories, or unreadable sibling directories no longer prevent the selected file from being viewed.
- [Fix] **Fix execution compatibility for some agents.** Correct rejected parameters when Grok creates a session, use synchronous subtask results in Qoder so they do not arrive after the current execution ends, and show a clear message when ZCode reaches the account concurrency limit.
- [UI] **Refine the file area and execution metadata.** Use consistent file-type icons, simplify code line numbers and separators, improve narrow-window and high-zoom layouts, and use the current theme's secondary text color for model names and reasoning effort.

[Full changelog](https://github.com/murray17/rovai-ai/compare/v0.5.4...v0.5.5)
