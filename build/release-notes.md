# Rovai AI v0.5.10

<!-- lang:zh-CN -->

本次更新支持直接回答 Pi 发起的原生提问，在会话里引用项目文件和文件夹，以及按需开启执行台自动展开。

感谢 @liangxyz（#706）和 @caoshuisi（#1012）反馈 Pi 提问无法作答的问题，也感谢 @NorethSea 提交 Hermes Profile 修复（#1018）。

- 【功能】**支持直接回答 Pi 的原生提问。** 确认、选择、单行输入和多行编辑会出现在公屏或单聊的「待处理」区域，回答会送回当前执行。飞书、Lark 和钉钉也支持通过卡片作答，提交后可在原卡片回看问题和回答摘要。
- 【功能】**项目会话支持引用文件和文件夹。** 在公屏输入 `@` 后可从「文件」页选择，也可从项目文件树或文件预览插入引用。引用可以单独发送，队员可按路径读取。点击历史消息中的引用可预览文件或在文件树中定位目录。
- 【功能】**可设置是否自动打开执行台。** 开关位于「设置 → 通用 → 会话」，默认关闭。开启后，桌面端和宽屏网页会在发送消息或进入有队员正在执行的会话时自动展开执行台。手机端通过执行入口手动打开。
- 【交互】**调整项目文件的排序和引用显示。** 文件树和 `@` 候选中的文件、文件夹统一按名称排序。消息正文和 Markdown 导出中的文件链接使用短名称，输入框里的引用可打开、重选或移除。
- 【修复】**切回会话时恢复上次选中的执行标签。** 在同一窗口返回原会话，会恢复之前选中的队员或总览。手动收起底部执行详情后，数据刷新也会保持收起。
- 【修复】**Hermes 会按配置的 Profile 启动。** 可在队员的环境变量中设置 `HERMES_PROFILE`，让不同队员使用各自的 Hermes 配置。
- 【界面】**修正手机网页的消息头和会话顶栏。** 队员头像与姓名垂直对齐，隐藏顶栏中占位的桌面文件控件，解决「…」菜单被遮挡的问题。

---

<!-- lang:en -->

This release adds in-place replies to Pi prompts, project file and folder references in conversations, and an option to open the execution desk automatically.

Thanks to @liangxyz (#706) and @caoshuisi (#1012) for reporting Pi prompts that could not be answered, and to @NorethSea for the Hermes profile fix (#1018).

- [Feature] **Answer Pi's native prompts directly.** Confirmations, choices, single-line input, and multi-line edits appear in the Pending area of the public conversation or Single Chat. Answers go back to the current run. Feishu, Lark, and DingTalk support answering through cards, which show a preview of the question and answer after submission.
- [Feature] **Reference project files and folders in conversations.** Use the Files tab in the `@` menu, the project file tree, or a file preview to insert a reference. Send references on their own or with text. Click a reference in a past message to preview the file or locate the folder in the tree.
- [Feature] **Choose whether the execution desk opens automatically.** The setting is off by default under Settings → General → Conversation. Enable it on desktop or wide-screen web to open the desk after sending a message or when entering a conversation with an active run. On phones, open the desk from the execution control.
- [UX] **Sort project files and folders by name and simplify reference labels.** The file tree and `@` results sort both together. Messages and Markdown exports show short link labels. Open, reselect, or remove a reference from the composer.
- [Fix] **Restore the last execution tab when returning to a conversation.** Within the same window, returning to a conversation restores the selected teammate or the overview. Manually closed bottom execution details stay closed when data refreshes.
- [Fix] **Start Hermes with the configured profile.** Set `HERMES_PROFILE` in a teammate's environment so different teammates can use their own Hermes profiles.
- [UI] **Fix alignment and header controls on mobile web.** Teammate avatars align with their names. Desktop file controls are hidden in the mobile header so they no longer cover the more menu.
