# Rovai AI v0.4.5

<!-- lang:en -->

This release simplifies runtime startup and Fast settings, improves first-run setup and the update page, and fixes executions getting stuck in recovery.

### What's changed

- [Interaction] **Simpler Fast settings.** Claude Code and Codex can switch Fast on or off without a separate eligibility check. The choice applies to subsequent executions, including an explicit off setting that could previously be ignored. When no choice has been saved, the button reflects the runtime's initialization response; actual Fast, standard, or cooldown feedback appears separately during execution.
- [Performance] **Less checking before a task starts.** App startup and rescanning no longer launch every installed runtime for probing. Installed runtimes can be configured and used without being blocked by a version-query timeout or a historical failed check. Required validation happens during the actual task's initialization.
- [Interaction] **Clearer initialization and configuration errors.** Executions show when the runtime is initializing and report specific installation, model, or permission problems. After correcting the configuration, start another task without first running a manual check to clear an old status.
- [Feature] **Apply first-run settings to the other unconfigured built-in teammates.** The runtime, model parameters, and default permissions selected during onboarding are also applied to the remaining unconfigured built-in teammates. Existing configurations are preserved, and the first conversation still includes only the selected teammate.
- [Interface] **Rework the update entry and About & Updates page.** The sidebar shows update, download, and installation states more clearly. The page groups the installed version with its actions, labels release notes with their version, places check history below the notes, and improves narrow-window layouts.
- [Interface] **Reduce routine runtime hints on teammate surfaces.** Teammate cards, member lists, and configuration forms no longer repeat ordinary readiness and startup explanations. Unconfigured, checking, and actionable failure feedback remains.
- [Fix] **Stop executions remaining in recovery after their runtime process exits.** Executions that cannot safely continue are settled while preserving existing output. After cleanup, the next message can run without restarting the app. Inputs with an unknown outcome are not automatically sent again.

### Thanks

Thanks to [@arschlochnop](https://github.com/arschlochnop) for reporting executions stuck in recovery and tasks stuck in the queue after restarting, with detailed analysis and screenshots in [#635](https://github.com/murray17/rovai-ai/issues/635) and [#636](https://github.com/murray17/rovai-ai/issues/636).

### Upgrading

Mac users on v0.4.1 or later can update in the app. Users on v0.4.0 or earlier need to download the DMG, quit the old app, and replace the installed app once. Keep your existing user data.

Server users on v0.4.1 or later can update through "About & Updates" in the web interface. For earlier versions, back up your data, stop Server, and run the updated official installer while keeping the same data directory.

Desktop and Server share this release and are built from the same source commit.

Windows x64 remains an unsigned preview. SmartScreen may show "Unknown publisher" during installation; download installers only from this official GitHub Release.

<!-- lang:zh-CN -->

本次更新简化智能体启动和 Fast 设置，改善首次配置与更新页面，并修复执行卡在“恢复中”的问题。

### 更新内容

- 【交互】**简化 Fast 设置。** Claude Code 和 Codex 可以直接选择开启或关闭，不再需要前置资格检查；选择用于后续执行，修复关闭选择可能被忽略的问题。未手动设置时，按智能体初始化返回的状态显示，实际响应档位和冷却状态在执行过程中单独呈现。
- 【性能】**减少智能体启动前的等待。** 应用启动和重新检测时不再批量启动智能体进行探测。已安装的智能体可直接配置并发起任务，不再因版本查询超时或历史检查失败被拦住；必要校验在实际任务初始化时完成。
- 【交互】**执行的初始化状态和失败原因更清楚。** 启动期间显示“正在初始化 Runtime”；安装、模型或权限配置有问题时显示对应原因，修复后可重新发起任务，无需先手动检测来解除历史状态。
- 【功能】**首次配置会同步到其他未配置的内置队员。** 新手引导中选定的智能体、模型参数和默认权限，会应用到其余未配置的内置队员，不覆盖已有配置；首次会话仍只加入选中的队员。
- 【界面】**调整更新入口和“关于与更新”页面。** 侧栏更清楚地显示更新、下载和安装状态；页面集中展示当前版本与操作按钮，更新日志标明具体版本，检查记录移至日志下方，并改善窄窗口下的布局。
- 【界面】**精简队员的运行状态提示。** 队员卡片、成员列表和配置页减少重复的状态与启动说明，保留未配置、检查中及需要处理的故障提示。
- 【修复】**修复智能体进程退出后，执行一直显示“恢复中”的问题。** 无法安全恢复的执行会结束并保留已有输出，清理完成后可继续发送下一条消息，无需重启应用；不会自动重复发送结果不明的旧消息。

### 感谢

感谢 [@arschlochnop](https://github.com/arschlochnop) 在 [#635](https://github.com/murray17/rovai-ai/issues/635) 和 [#636](https://github.com/murray17/rovai-ai/issues/636) 中反馈执行卡在“恢复中”、重启后任务停在队列中的问题，并提供详细分析和截图，帮助我们定位和修复。

### 升级提醒

Mac v0.4.1 及更新版本可在应用内升级；v0.4.0 及更早版本需要下载 DMG、退出旧应用并手动替换已安装应用一次。保留原有用户数据。

Server v0.4.1 及更新版本可在网页的“关于与更新”中升级；更早版本请先备份数据、停止 Server，再使用新版官方安装脚本，并保持原有数据目录。

Desktop 与 Server 同版发布，使用同一份源码构建。

Windows x64 仍为未签名预览版，安装时可能出现“未知发布者”提示。请仅从本次官方 GitHub Release 下载安装包。
