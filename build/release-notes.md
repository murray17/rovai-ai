# Rovai AI v0.4.3

<!-- lang:en -->

This release makes teammates easier to create and configure, improves conversation navigation and long execution records, and adds a system tray on Windows.

### What's changed

- [Feature] **Create teammates through a conversation.** The Add action opens a conversation with an available teammate and an editable starter request. Three prompts help you explore a character, a work partner, or an original companion. Nothing is sent automatically, and manual creation remains available.
- [Feature] **Apply a saved runtime configuration to other teammates.** Copy the agent, model, parameters, and permissions to selected teammates. Review replacements before applying them, preserve unsaved runtime drafts, and retry only failed items.
- [Feature] **See the model and reasoning effort beside replies.** Conversation message headers and teammate details show model information directly. Historical replies use the configuration recorded for that execution, not the teammate's current settings.
- [Feature] **Keep Rovai running in the Windows system tray.** Choose whether closing the window minimizes to the tray or quits the app, and optionally remember the choice. Tray mode preserves the window and background work; change the behavior in Settings → General → Window.
- [Interaction] **Jump back to your questions.** Wider conversation views show a compact rail of user-message anchors. Hover to preview a question and its first reply, then click or use the keyboard to return to that message.
- [Interaction] **Use context menus and unread reminders in the sidebar.** Open project and conversation actions with a right-click, keyboard shortcut, or long press. Mark conversations read or unread, copy project paths, and reveal project folders in the desktop file manager.
- [Interaction] **Reorder teammates directly.** Drag teammate rows on desktop or their avatars in the mobile layout. Keyboard reordering remains available.
- [Performance] **Load long execution records in complete content blocks.** Folded command groups count as one block and load their operations separately. Short initial views fill automatically, while paging and live updates preserve reading position, expanded results, and focus. Streaming text and older execution records remain visible through updates.
- [Interface] **Give the first execution preview a narrower starting width.** A new conversation's first automatic execution preview leaves more room for the conversation. Existing file tabs and manually chosen widths are preserved.
- [Interaction] **Clarify permission and sandbox choices.** Menus identify recommended options and include brief guidance. Permission switches use consistent sizing without changing existing selections.
- [Fix] **Keep newly created teammate cards with their creating execution.** Cards appear below that execution's last reply, align with file-change cards, and link directly to agent configuration.
- [Interaction] **Show when you stopped an execution.** A subtle "Stopped by you" marker appears beside an interrupted execution’s existing replies or artifacts. Activate it to inspect that exact execution. Stopping before any reply or artifact no longer creates an empty teammate row.
- [Fix] **Restore navigation from execution notifications.** Clicking a notification can now locate its execution even when the target is not in the current cache, rather than failing with an incompatible-contract error.
- [Feature] **Let teammates inspect execution and queued work.** The built-in `rovai thread runs` command lists a conversation's execution states and queued messages, with filtering and pagination. Message reads also expose their recipients and structured mentions. Long-history queries now bound the returned candidate set in SQL.
- [Improvement] **Standardize built-in collaboration terminology.** Built-in commands and agent guidance use Thread and User, while preserving compatibility aliases, historical records, and frozen session recovery.
- [Documentation] **Add a collaboration demo video.** Both READMEs include a workflow demonstration, and the website homepage uses a clearer workspace overview.

### Upgrading

Mac users on v0.4.1 or later can update in the app. Users on v0.4.0 or earlier need to download the DMG and replace the installed app once. Keep your existing user data.

Server users on v0.4.1 or later can update through "About & Updates" in the web interface. For earlier versions, back up your data, stop Server, and run the updated official installer while keeping the same data directory.

Desktop and Server share this release and are built from the same source commit.

Windows x64 remains an unsigned preview. SmartScreen may show "Unknown publisher" during installation; download installers only from this official GitHub Release.

<!-- lang:zh-CN -->

本次更新让队员创建和配置更方便，改善会话定位与长执行记录的阅读体验，并为 Windows 增加系统托盘。

### 更新内容

- 【功能】**可以通过对话创建队员。** 点击添加后，与已有队员一起确定新队员的角色、职责和性格；提供角色、工作伙伴、原创搭档三个起步方向。预填内容可修改，不会自动发送，仍可选择手动创建。
- 【功能】**批量应用队员的运行时配置。** 将已保存的智能体、模型、参数和权限应用到选中的其他队员，替换前可确认内容；保留未保存的配置草稿，失败后可只重试失败项。
- 【功能】**回复旁可查看模型与思考强度。** 在消息头和队员信息中直接查看模型信息；历史回复显示当次执行记录的配置，不会跟随队员当前设置变化。
- 【功能】**Windows 支持系统托盘。** 关闭窗口时可选择最小化到托盘或退出，并记住选择。托盘模式保留窗口与后台工作，可在“设置 → 通用 → 窗口”中调整。
- 【交互】**快速回到之前的问题。** 较宽的会话窗口会显示用户消息定位栏，悬浮可预览问题和首条回复，点击或使用键盘即可跳转。
- 【交互】**侧栏支持右键菜单与未读标记。** 可通过右键、快捷键或长按打开项目和会话操作，手动标记已读或未读、复制项目路径；桌面端可直接在文件管理器中打开项目目录。
- 【交互】**拖动调整队员顺序。** 桌面端可拖动队员列表，移动端可拖动头像，同时保留键盘排序操作。
- 【性能】**长执行记录按完整内容块加载。** 折叠的命令组作为一个内容块，其内部操作单独加载；首屏内容不足时自动补齐。翻页和实时更新会保留阅读位置、已展开的结果与焦点，并修复流式文本和旧记录在更新时丢失的问题。
- 【界面】**首次执行预览为会话留出更多空间。** 新会话第一次自动展开执行预览时采用较窄的初始宽度，已有文件标签页和手动调整的宽度保持不变。
- 【交互】**权限与沙箱选项更清楚。** 菜单标注推荐项并补充简短说明，权限开关统一尺寸，不改变已有选择。
- 【修复】**新队员卡片跟随创建它的执行显示。** 卡片放在对应执行的最后一条回复下方，与文件变更卡片对齐，并可直接打开智能体配置。
- 【交互】**手动停止执行后显示“你已中断”。** 中断标记显示在该次执行已有的回复或成果旁，点击可查看对应执行过程；在产生任何回复或成果前停止，不再创建空白队员行。
- 【修复】**修复点击执行通知无法跳转的问题。** 即使目标执行尚未载入当前缓存，也能定位到它，不再因接口版本不一致而报错。
- 【功能】**队员可查看执行状态与排队消息。** 新增内置命令 `rovai thread runs`，支持筛选和分页；读取消息时可查看接收对象与结构化提及，同时减少长历史查询中的无效读取。
- 【改进】**统一内置协作命令与说明中的术语。** 使用 Thread 和 User，保留旧命令兼容入口、历史记录与原有会话恢复能力。
- 【文档】**新增协作演示视频。** 中英文 README 均提供工作流程演示，官网首页换用更清楚的工作台总览图。

### 升级提醒

Mac v0.4.1 及更新版本可在应用内升级；v0.4.0 及更早版本需要手动下载 DMG 并替换已安装应用一次。保留原有用户数据。

Server v0.4.1 及更新版本可在网页的“关于与更新”中升级；更早版本请先备份数据、停止 Server，再使用新版官方安装脚本，并保持原有数据目录。

Desktop 与 Server 同版发布，使用同一份源码构建。

Windows x64 仍为未签名预览版，安装时可能出现“未知发布者”提示。请仅从本次官方 GitHub Release 下载安装包。
