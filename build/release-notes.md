# Rovai AI v0.5.11

<!-- lang:zh-CN -->

感谢 @NorethSea 在 PR #1020 中加入本地自动化指定发送队员的功能，也感谢其在 Issue #1041 中反馈删除队员后无法保存工具箱设置的问题。感谢 @arschlochnop 在 Issue #1050 中提供 macOS 下 Shell 启动信息干扰智能体检测的复现步骤。

- 【功能】**`@` 队员时可以按智能体名称、简称或前缀搜索。** 例如输入 `@com` 可找到使用 Command Code 的队员，当前会话的队员优先显示。公屏、会话草稿和使命描述都支持。
- 【功能】**Pi 有问题等待回答时会在应用内提醒。** 浏览其他会话或页面时也能收到提示。点击可定位到原公屏或单聊里的问题，开关位于「设置 → 提醒 → 待审批与回答」。
- 【功能】**Hermes 支持按队员设置推理强度。** 可选择 Hermes 提供的档位，切回「跟随模型默认值」时会清除之前设定的强度。
- 【功能】**本地自动化支持指定发送队员。** 桌面版运行时，脚本可在 `rovai app thread send` 中用 `--sender-agent-id` 指定消息署名，用 `--agent-id` 指定接收队员。发送受理后会返回消息和投递编号。
- 【交互】**模型选择器增加手动刷新。** 点击搜索框旁的按钮可重新读取模型列表。打开队员参数设置时按需加载，读取失败时保留已选模型和上次成功读取的列表。
- 【修复】**智能体检测会重新读取本机版本。** 「检查状态」和「重新检测」只检查安装入口并读取版本，模型列表在打开配置时单独加载。版本查询时限调整为 15 秒，备用安装检查失败时会保留当前入口。
- 【修复】**修复 macOS 下 Shell 启动输出干扰智能体检测的问题。** Shell 的启动信息没有换行时，也能正确读取 PATH。
- 【修复】**修复网页端的队员操作和头像加载。** 队员菜单中的「暂时离队」和「归队」恢复可用。头像遇到临时加载错误会自动重试，断线恢复后也会重新加载失败的头像。
- 【修复】**修复删除队员后无法保存工具箱设置的问题。** 删除队员时会清理其 Skill 分配，已有的残留记录会在保存对应 Skill 时一并清理。
- 【修复】**HTML 预览减少布局提示误报。** 浏览器原生布局提示会从诊断记录中过滤，辅助诊断限制只在已有的详情里显示。脚本和资源错误照常提示。
- 【界面】**统一应用内的蓝色标识。** 启动页、导航、关于与更新、网页登录等页面采用相同标识，并调整了无可用队员时「前往队员」和「查看智能体」的按钮样式。

---

<!-- lang:en -->

Thanks to @NorethSea for adding teammate senders to local automation in PR #1020 and reporting that Toolbox settings could not be saved after deleting a teammate in Issue #1041. Thanks to @arschlochnop for the detailed reproduction of the macOS shell startup output problem in Issue #1050.

- [Feature] **Find teammates by Agent name when using `@`.** Search by product name, abbreviation, or prefix. For example, `@com` finds teammates using Command Code. Teammates in the current conversation appear first. Search works in public conversations, drafts, and Mission descriptions.
- [Feature] **Get an in-app reminder when Pi is waiting for an answer.** Select the reminder to jump to the question in its original public conversation or Single Chat. The setting is under Settings → Notifications → Approvals and answers.
- [Feature] **Set Hermes reasoning effort per teammate.** Choose from the options Hermes exposes. Select Follow model default to clear the previous override.
- [Feature] **Send a local automation message under a teammate's name.** While Desktop is running, use `--sender-agent-id` with `rovai app thread send` to choose the sender and `--agent-id` to choose the recipient. Accepted sends return the message and delivery IDs.
- [Interaction] **Refresh the model list from the model picker.** The refresh button sits beside search. Model options load when the relevant teammate settings are opened. If a read fails, the saved selection and last successful list stay available.
- [Fix] **Agent checks read the installed version again.** Check status and Rescan find the installed entry and read its version. Version reads have a 15-second limit. A failed check of an alternate installation preserves the selected entry.
- [Fix] **Correct macOS Agent detection when shell startup output has no newline.** Rovai can read PATH when startup text runs into the detection output.
- [Fix] **Restore Web teammate actions and avatar loading.** The teammate menu supports Away and Rejoin again. Failed avatar loads retry after temporary errors and when the connection recovers.
- [Fix] **Restore Toolbox saves after a teammate is removed.** Removing a teammate clears their Skill assignments. Saving an affected Skill also clears any older stale assignments.
- [Fix] **Keep HTML preview diagnostics focused on page errors.** Native browser layout notices are filtered from the diagnostic records, and auxiliary diagnostic limits stay out of the toolbar. Script and resource errors still appear.
- [UI] **Use a consistent blue mark across the app.** The startup screen, navigation, About and Updates, and Web sign-in share the same mark. The actions shown when no teammates are available have also been adjusted.
