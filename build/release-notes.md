# Rovai AI v0.5.6

<!-- lang:zh-CN -->

本次更新将专业职责上限提高到 30,000 字符，支持在会话草稿中浏览项目文件，并修复取消执行、单聊和项目目录的交互问题。

- 【功能】**专业职责上限由 10,000 提高到 30,000 字符。** 可填写更长的角色分工和工作要求。完整输入超出单次执行容量时，会提示精简后重新提交。
- 【功能】**会话草稿也能浏览项目文件。** 绑定目录后，无需先发送消息激活会话，即可浏览目录并打开文件。
- 【修复】**修复退出 App 后取消执行入口消失的问题。** 重新进入会话后，仍可查看各队员最近一次取消执行的过程，并手动继续。继续执行或出现新执行后，旧入口自动收起。
- 【修复】**修复单聊数量必须打开面板后才更新的问题。** 进入会话后会自动读取数量，面板收起时也会同步数量与运行标记；读取过程不阻塞消息显示和输入。
- 【修复】**修复 Markdown 表格长内容跨列重叠的问题。** 长链接、连续标识符会在单元格内换行，多列表格仍可横向滚动。
- 【修复】**修复使命预览中文件目录被遮挡、无法点击的问题。** 目录浮层可正常显示和操作；快速对话不再显示无效的目录入口。
- 【界面】**统一主按钮与单聊代码的主题配色。** 主按钮跟随当前主题，默认浅色主题使用深灰底白字；单聊回复、执行过程和计划说明中的代码样式与公屏保持一致。
- 【界面】**调整会话顶栏和文件夹图标。** 项目名、分隔符与会话名垂直居中，项目名、目录入口、文件标签和目录行统一使用文件夹图标。

感谢 @liangxyz 在 [#706](https://github.com/murray17/rovai-ai/issues/706) 中反馈专业职责长度不足的问题。

[完整变更](https://github.com/murray17/rovai-ai/compare/v0.5.5...v0.5.6)

---

<!-- lang:en -->

This release raises the responsibilities limit to 30,000 characters, enables project-file browsing in conversation drafts, and fixes cancelled execution entries, Single Chat, and project-directory interactions.

- [Feature] **Responsibilities now support 30,000 characters, up from 10,000.** Save longer role descriptions and work requirements. If the complete input exceeds the capacity of one execution, a message asks you to shorten it and resubmit.
- [Feature] **Browse project files from conversation drafts.** After binding a directory, browse and open its files without first sending a message to activate the conversation.
- [Fix] **Keep cancelled execution entries after exiting the app.** On returning to a conversation, inspect and manually continue each teammate's latest cancelled execution. The old entry collapses after continuation or a new execution begins.
- [Fix] **Update the Single Chat count without opening its panel first.** Entering a conversation loads the count automatically. Counts and running indicators also update while the panel is closed, without blocking messages or the composer.
- [Fix] **Prevent long Markdown table content from overlapping adjacent columns.** Long links and unbroken identifiers wrap inside their cells, while wide tables retain horizontal scrolling.
- [Fix] **Keep the file directory accessible above Mission previews.** The directory overlay remains visible and clickable. Quick Chat no longer shows an unusable directory entry point.
- [UI] **Use consistent theme colors for primary buttons and Single Chat code.** Primary buttons follow the active theme, with dark gray and white text in the default light theme. Code in Single Chat replies, execution narration, and plans shares the public conversation's styling.
- [UI] **Align the conversation header and unify folder icons.** Project names, separators, and conversation names are vertically centered. The project name, directory entry point, file tabs, and directory rows use the same folder icon.

Thanks to @liangxyz for reporting the responsibilities length limitation in [#706](https://github.com/murray17/rovai-ai/issues/706).

[Full changelog](https://github.com/murray17/rovai-ai/compare/v0.5.5...v0.5.6)
