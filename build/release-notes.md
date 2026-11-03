# Rovai AI v0.5.7

<!-- lang:zh-CN -->

本次更新新增消息导出和 Mermaid 图表阅读，将工作准则、成长课题的上限提高到 3,000 字符，并修复本机 Skills、执行状态和 Windows Antigravity 的使用问题。

- 【功能】**支持消息多选与导出。** 可多选公屏中已加载的消息，也可导出选中的文字，预览后保存为 HTML、PNG 或 Markdown。支持修改导出标题，选择保留作者、时间和发送对象等信息。
- 【功能】**支持直接查看 Mermaid 图表。** Markdown 文件预览及公屏、单聊中的队员回复可显示流程图、时序图等，支持图形与源码切换、复制和大图缩放。流式回复中的完整图块会先行显示，无需等待整条回复结束。
- 【功能】**工作准则和成长课题分别由 300 提高到 3,000 字符。** 可以填写更完整的做事方式、质量要求和成长方向，保留正文中的换行与格式。
- 【修复】**完善本机 Skill 的发现、引用和预览。** 说明文件头部信息缺失或异常时，仍可发现和选择可读的 Skill；支持中文、下划线名称筛选，并完善大文件预览及异常提示。
- 【修复】**修正 Claude Code 的执行结束判断。** 不再因收到结果后等待状态事件而提前报错；空回复、不支持的提问和收尾清理异常不会覆盖已经确认的成功结果。
- 【修复】**补充消息结果待核对时，不再连带阻塞后续输入。** 通道仍有效时，可以继续发送新的补充消息；待核对的原消息不会被自动重发。
- 【修复】**减少本机智能体更新造成的执行中断。** 优化 Codex、Pi 等智能体的进程复用，程序文件更新或准备新执行时，避免误回收其他会话仍在使用的进程。
- 【修复】**修复 Windows 下 Antigravity 执行 Shell 命令失败的问题。** 解决部分程序路径导致正常命令被误报为“Shell Injection Detected”的情况。
- 【界面】**提醒操作文字跟随当前主题配色。** 修复“查看下一条”仍显示固定蓝色的问题。

感谢 @liangxyz 在 [#706](https://github.com/murray17/rovai-ai/issues/706) 中反馈角色设定长度不足的问题，@liuqiong0319 反馈本机 Skill 发现问题，以及 @arschlochnop 在 [#979](https://github.com/murray17/rovai-ai/issues/979) 中提出 Mermaid 图表预览需求。

[完整变更](https://github.com/murray17/rovai-ai/compare/v0.5.6...v0.5.7)

---

<!-- lang:en -->

This release adds message export and Mermaid diagram reading, raises the working principles and growth topic limits to 3,000 characters each, and fixes native Skills, execution status, and Antigravity on Windows.

- [Feature] **Select and export messages.** Select loaded messages in the public conversation, or export selected text, then preview and save it as HTML, PNG, or Markdown. Edit the export title and choose whether to include authors, timestamps, recipients, and other information.
- [Feature] **Read Mermaid diagrams directly.** Markdown file previews and teammate replies in public conversations and Single Chat can display flowcharts, sequence diagrams, and more. Switch between diagrams and source, copy the source, and zoom into larger diagrams. Complete diagram blocks appear during streaming without waiting for the entire reply to finish.
- [Feature] **Working principles and growth topic now support 3,000 characters each, up from 300.** Save more detailed working methods, quality requirements, and growth goals while retaining line breaks and formatting.
- [Fix] **Improve native Skill discovery, selection, and preview.** Readable Skills remain discoverable and selectable when their header metadata is missing or malformed. Filtering supports Chinese characters and underscores, with better large-file previews and diagnostics.
- [Fix] **Correct Claude Code completion handling.** Waiting for status events after a result no longer causes premature failure. Empty final text, unsupported questionnaires, and cleanup errors do not override a confirmed successful result.
- [Fix] **A supplemental message awaiting confirmation no longer blocks later inputs.** New supplemental messages can proceed while the channel remains valid. The original unconfirmed message is not automatically resent.
- [Fix] **Reduce execution interruptions after local Agent updates.** Improve process reuse for Codex, Pi, and other supported Agents. Updating program files or preparing a new execution no longer incorrectly retires processes still serving other conversations.
- [Fix] **Fix Antigravity Shell command failures on Windows.** Resolve executable path handling that could cause valid commands to be rejected with “Shell Injection Detected”.
- [UI] **Reminder actions follow the active theme.** Fix the “View next” action retaining a fixed blue color.

Thanks to @liangxyz for reporting role-description length limits in [#706](https://github.com/murray17/rovai-ai/issues/706), @liuqiong0319 for reporting native Skill discovery issues, and @arschlochnop for requesting Mermaid previews in [#979](https://github.com/murray17/rovai-ai/issues/979).

[Full changelog](https://github.com/murray17/rovai-ai/compare/v0.5.6...v0.5.7)
