# Rovai AI v0.4.6

<!-- lang:en -->

This release adds tools for reading and updating teammate profiles, reduces the wait when saving agent settings, and fixes model-list queries and process cleanup after Codex failures.

### What's changed

- [Feature] **New tools for reading and updating teammate profiles.** Agents can query the current conversation's members, read their avatars and portraits, and update profile details and images at the user's explicit request. Text and images are saved together; fields not included in the change remain untouched.
- [Change] **Simpler Claude Code and Codex startup settings.** The built-in API editor has been removed. Connection settings are managed by the native CLI, and existing configuration and credentials are left unchanged.
- [Performance] **Saving agent settings no longer waits for extra checks.** Changing the program path or environment variables only saves local settings. It no longer also queries accounts, refreshes model lists, or restarts the runtime process; the page shows “Saved” as soon as the save completes.
- [Fix] **Fix checks failing when a model-list response is too large.** Probe reading limits have been adjusted, and Claude Code uses its dedicated model query first. If the list is temporarily unavailable, existing model selections and parameters are preserved, without blocking an unchanged save or a new task solely because the list could not be read.
- [Fix] **Stop Codex from reusing a failed process.** Processes from failed, cancelled, or interrupted executions are retired. Subsequent messages wait until cleanup is confirmed, and old inputs with an unknown outcome are not automatically resent.
- [Fix] **Fix process registration and cleanup on Windows.** Directory permissions no longer prevent managed process registration. Descendant-process exit checks have also been completed so recovery cannot start while an old process tree remains unconfirmed.
- [Fix] **Fix relative avatar paths when creating teammates.** Avatar paths in both creation and profile updates are resolved against the current execution's working directory.
- [Interface] **Simpler agent status feedback.** Discovered agents are shown as “Available.” Successful checks no longer repeat explanatory text; failure reasons and actions that need attention remain.

### Upgrading

Mac users on v0.4.1 or later can update in the app. Users on v0.4.0 or earlier need to download the DMG, quit the old app, and replace the installed app once. Keep your existing user data.

Server users on v0.4.1 or later can update through “About & Updates” in the web interface. For earlier versions, back up your data, stop Server, and run the updated official installer while keeping the same data directory.

Desktop and Server share this release and are built from the same source commit.

Windows x64 remains an unsigned preview. SmartScreen may show “Unknown publisher” during installation; download installers only from this official GitHub Release.

<!-- lang:zh-CN -->

本次更新新增队员资料查询与修改工具，减少智能体设置保存时的等待，并修复模型列表读取和 Codex 失败后的进程回收问题。

### 更新内容

- 【功能】**新增队员资料查询与修改工具。** 可查询当前会话成员的身份资料、读取头像与半身照，并按用户明确要求修改资料和头像。文字与图片一起保存，未修改的字段保持原样。
- 【调整】**简化 Claude Code 和 Codex 的启动设置。** 移除内置 API 编辑，连接配置交由原生 CLI 管理，已有配置与凭据保持不变。
- 【性能】**保存智能体设置不再等待额外检查。** 修改程序路径或环境变量后，只保存本地设置，不再连带查询账号、刷新模型列表或重启运行进程，完成后直接显示“已保存”。
- 【修复】**修复模型列表响应过大导致检查失败的问题。** 调整探测读取限制，Claude Code 优先使用专用模型查询；列表暂时不可用时保留已选模型和参数，不再因此阻止原样保存或发起任务。
- 【修复】**修复 Codex 出错后重复使用故障进程的问题。** 失败、取消或中断的进程会被回收，确认清理完成后再处理后续消息，不自动重发结果不明的旧输入。
- 【修复】**修复 Windows 下的进程登记与回收问题。** 解决目录权限导致进程无法登记的问题，并补齐子进程退出检查，避免旧进程尚未清理就开始恢复执行。
- 【修复】**修复创建队员时相对路径头像读取错误的问题。** 创建和修改队员时，头像路径统一按当前执行的工作目录解析。
- 【界面】**精简智能体状态提示。** 已发现的智能体统一显示“可用”，检查成功后不再重复展示说明，保留失败原因及处理入口。

### 升级提醒

Mac v0.4.1 及更新版本可在应用内升级；v0.4.0 及更早版本需要下载 DMG、退出旧应用并手动替换已安装应用一次。保留原有用户数据。

Server v0.4.1 及更新版本可在网页的“关于与更新”中升级；更早版本请先备份数据、停止 Server，再使用新版官方安装脚本，并保持原有数据目录。

Desktop 与 Server 同版发布，使用同一份源码构建。

Windows x64 仍为未签名预览版，安装时可能出现“未知发布者”提示。请仅从本次官方 GitHub Release 下载安装包。
