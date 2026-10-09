# Rovai AI v0.4.7

<!-- lang:zh-CN -->

本次更新新增一键继续执行，支持在新会话和使命中直接邀请队员，并改善会话导航、图片操作和 DeepSeek Harness 的模型配置。

### 更新内容

- 【功能】**支持一键继续执行。** 停止或失败后，可从执行卡片重新发起，复用原消息，保留工作目录和旧执行记录。继续操作不会额外向公屏插入系统消息。
- 【功能】**新会话的第一条消息也能邀请队员。** 在输入框中 @尚未加入的队员，首次发送时一起完成邀请和消息提交，失败后保留输入。
- 【功能】**使命描述支持 @队员。** 新建或编辑使命时可直接选择队员，保存时邀请尚未加入的成员；描述中的提及可打开资料，队员改名后仍指向同一身份。
- 【交互】**左侧消息导航覆盖完整会话。** 不再只列出已加载的用户消息，点击即可定位较早的消息；悬浮或键盘聚焦时，可查看首条有效直接回复的摘要。
- 【功能】**DeepSeek Harness 可使用 Web 端配置的模型。** 将 Web 模型补充到模型列表并用于执行，保留原生配置优先级和显式禁用设置；Web 配置异常时仍保留原生能力。
- 【交互】**DeepSeek Harness 的思考强度跟随当前模型。** 按所选模型读取可用档位，缓存已有结果，并在读取时显示加载提示。已打开的菜单会原位更新，迟到的目录结果不会覆盖新选项，已保存的值保持不变。
- 【调整】**消息的接收对象信息统一。** 队员处理公屏消息和读取历史时，会拿到一致的接收队员及结构化 @用户信息；正文没有写出接收者名字时，也会提供已指定的对象。
- 【交互】**输入框和消息中的图片都能直接复制、保存。** 缩略图与大图预览共用图片菜单，复制保留原尺寸和透明度，保存保留原始文件，操作不改变当前草稿。
- 【交互】**执行中的思考提示不再中途消失。** 输出正文或调用工具后再次思考时，状态继续更新；Codex、Copilot 提供原生短标题时会直接显示，Web 和手机端同步更新。
- 【调整】**普通执行不再默认受 24 小时限制。** 新执行不会仅因超过一天而结束，已有执行和定时任务的超时规则保持不变。
- 【性能】**减少空闲时的后台扫描。** 移除每 500 毫秒的全局业务扫描，消息、取消和权限审批按状态变化推进，并修复执行准备期间遗漏通知的问题。
- 【修复】**修复停止和会话恢复中的异常。** 解决 macOS 停止后后台工具仍写入文件、ACP 启动失败一直等待，以及连续启动失败丢失仍可恢复的会话引用等问题。
- 【修复】**修复 Windows 上 Claude Code 后续消息卡在排队的问题。** 上一条结束或停止后，下一条在清理完成后自动运行，无需重启；执行台会明确显示等待清理和重试状态。
- 【修复】**修复 Windows 下 DeepSeek Harness 检查结果失效的问题。** 同一程序的不同路径写法不再被误判为配置变化，首次检查和模型刷新可以正常确认结果。
- 【修复】**长消息可以正常选文引用。** 超过 20 行的用户消息，在折叠、展开和再次收起后都能引用。
- 【修复】**执行输入列表正确显示个人资料。** 原消息和排队消息清单使用当前用户的名称与头像，不再固定显示“你”的占位内容。
- 【修复】**修复使命编辑与看板中的操作问题。** @队员候选列表不再被弹窗遮挡，键盘选择不会带动编辑区滚动；窄窗口下滚到最后一列时，状态导航不再跳回前列。
- 【修复】**鼠标侧键不再造成意外页面跳转。** 移除默认前进、后退绑定，保留界面按钮、键盘快捷键和 macOS 触控板手势。

### 感谢

感谢 [@arschlochnop](https://github.com/arschlochnop) 反馈并修复鼠标侧键冲突：[Issue #668](https://github.com/murray17/rovai-ai/issues/668)、[PR #669](https://github.com/murray17/rovai-ai/pull/669)。

### 升级提醒

Mac v0.4.1 及更新版本可在应用内升级；v0.4.0 及更早版本需要下载 DMG、退出旧应用并手动替换已安装应用一次。保留原有用户数据。

Server v0.4.1 及更新版本可在网页的“关于与更新”中升级；更早版本请先备份数据、停止 Server，再使用新版官方安装脚本，并保持原有数据目录。

Desktop 与 Server 同版发布，使用同一份源码构建。

Windows x64 仍为未签名预览版，安装时可能出现“未知发布者”提示。请仅从本次官方 GitHub Release 下载安装包。

<!-- lang:en -->

This release adds one-click execution continuation and teammate invitations in new conversations and missions, with improvements to conversation navigation, image actions, and DeepSeek Harness model settings.

### What's changed

- [Feature] **Continue a stopped or failed execution with one click.** Start again from the execution card using the original message, while retaining the working directory and previous execution record. Continuing does not add an extra system message to the shared conversation.
- [Feature] **Invite teammates in the first message of a new conversation.** @mention teammates who have not joined yet to invite them and submit the first message together. The input is retained if submission fails.
- [Feature] **@mention teammates in mission descriptions.** Choose teammates while creating or editing a mission; saving invites members who have not joined. Mentions open their profiles and keep referring to the same person after a name change.
- [Interaction] **The message navigation rail covers the whole conversation.** It is no longer limited to loaded user messages. Click to locate older messages, or hover or focus with the keyboard to read a summary of the first valid direct reply.
- [Feature] **Use models configured in DeepSeek Harness Web.** Web-configured models supplement the native model list and can be used for execution. Native configuration and explicit disable settings take precedence; native capabilities remain available if Web configuration cannot be read.
- [Interaction] **DeepSeek Harness reasoning levels follow the selected model.** Available levels are queried per model, cached, and shown with a loading indicator during queries. Open menus update in place, late catalog responses do not replace fresh options, and saved values are preserved.
- [Change] **Consistent message recipient information.** Teammates receive the same recipient and structured user-mention information when processing shared messages and reading history. Explicit recipients are included even when their names are not written in the message body.
- [Interaction] **Copy or save images from the composer and messages.** Thumbnails and full-size previews use the same image menu. Copying preserves original dimensions and transparency; saving keeps the original file. These actions do not change the current draft.
- [Interaction] **Thinking indicators stay visible during execution.** Status continues updating when an agent thinks again after producing text or using tools. Native short titles from Codex and Copilot are shown when available, with updates also reflected on Web and mobile.
- [Change] **New ordinary executions no longer have a default 24-hour limit.** They do not end solely because a day has passed. Existing executions and scheduled-task timeout rules remain unchanged.
- [Performance] **Less background scanning while idle.** The global 500-millisecond business scan has been removed. Messages, cancellation, and permission approvals advance on state changes, with a fix for missed notifications during execution preparation.
- [Fix] **Fix cancellation and session recovery issues.** Background tools on macOS stop writing after cancellation; failed ACP startup no longer waits indefinitely, and repeated startup failures retain recoverable session references.
- [Fix] **Fix subsequent Claude Code messages getting stuck in the queue on Windows.** After an execution finishes or stops, the next message runs once cleanup completes, without restarting the app. The execution view shows cleanup waiting and retry states.
- [Fix] **Fix stale DeepSeek Harness check results on Windows.** Different path representations of the same program no longer count as configuration changes, allowing initial checks and model refreshes to complete normally.
- [Fix] **Quote text from long messages.** User messages longer than 20 lines can be quoted when collapsed, expanded, or collapsed again.
- [Fix] **Execution input lists show the current profile.** Original and queued inputs use the user's current name and avatar instead of a fixed “You” placeholder.
- [Fix] **Fix mission editing and board navigation.** Teammate suggestions are no longer clipped by dialogs, keyboard selection does not scroll the editor, and scrolling to the last column in a narrow window no longer switches the status navigation back to an earlier column.
- [Fix] **Mouse side buttons no longer cause unexpected navigation.** Default back and forward bindings have been removed. Interface buttons, keyboard shortcuts, and macOS trackpad gestures remain available.

### Thanks

Thanks to [@arschlochnop](https://github.com/arschlochnop) for reporting and fixing the mouse side-button conflict: [Issue #668](https://github.com/murray17/rovai-ai/issues/668) and [PR #669](https://github.com/murray17/rovai-ai/pull/669).

### Upgrading

Mac users on v0.4.1 or later can update in the app. Users on v0.4.0 or earlier need to download the DMG, quit the old app, and replace the installed app once. Keep your existing user data.

Server users on v0.4.1 or later can update through “About & Updates” in the web interface. For earlier versions, back up your data, stop Server, and run the updated official installer while keeping the same data directory.

Desktop and Server share this release and are built from the same source commit.

Windows x64 remains an unsigned preview. SmartScreen may show “Unknown publisher” during installation; download installers only from this official GitHub Release.
