# Rovai AI v0.4.4

<!-- lang:en -->

This release adds execution usage and session context readings, restores unsent drafts in new conversations, and displays release notes in your interface language.

### What's changed

- [Feature] **Inspect token usage on execution cards.** After an execution ends, open its usage entry to see Input Token, Output Token, Cache Read, Cache Write, and duration. Native usage collection has also been extended and corrected across runtimes. Missing fields stay unknown rather than becoming zero.
- [Feature] **See the current session's context usage.** The execution panel shows used tokens, the context window, and a percentage when the runtime provides them. Available observations refresh during execution rather than waiting for the whole turn to finish. Model changes, compaction, and session recovery are checked against the current session; historical executions do not replace its reading.
- [Fix] **Keep unsent drafts in newly created conversations.** Drafts survive conversation switching, page refresh, window recreation, and ordinary restart. A project can keep several new-conversation drafts. Rejected sends preserve the input; accepted sends clear the saved draft.
- [Feature] **Read release notes in your interface language.** Chinese and English interfaces show their matching notes immediately when the language changes. Historical and single-language notes remain readable, and switching languages preserves the selected version tab.
- [Interface] **Restore the new-teammate card layout.** Text sits on the left and the portrait on the right, with adjusted name sizing, filled trait tags, and a separate footer for creation details and agent configuration.
- [Fix] **Stop reporting internal diagnostic failures as HTML page errors.** When a page's security policy blocks Rovai's supplemental diagnostic connection, the preview explains that diagnostics are unavailable without counting it as a page issue. Genuine script and resource errors remain visible, and the page's policy is not weakened.
- [Fix] **Fix DeepSeek Harness tool calls on some Responses endpoints.** Handle optional tool parameters on routes such as sub2api while preserving native settings and explicit provider or model overrides.
- [Performance] **Limit execution-metric reads to the relevant records.** Query active, visible, or newly expanded executions; pause reads while the panel is hidden and stop continuous polling of stable history.

### Upgrading

Mac users on v0.4.1 or later can update in the app. Users on v0.4.0 or earlier need to download the DMG, quit the old app, and replace the installed app once. Keep your existing user data.

Server users on v0.4.1 or later can update through "About & Updates" in the web interface. For earlier versions, back up your data, stop Server, and run the updated official installer while keeping the same data directory.

Desktop and Server share this release and are built from the same source commit. Token and context fields depend on what each runtime reports; this release does not add output-speed measurement.

Windows x64 remains an unsigned preview. SmartScreen may show "Unknown publisher" during installation; download installers only from this official GitHub Release.

<!-- lang:zh-CN -->

本次新增执行用量和会话上下文占用显示，修复新会话草稿丢失，并让更新说明跟随界面语言显示。

### 更新内容

- 【功能】**执行卡片可以查看 Token 用量。** 执行结束后，点击用量入口，可查看输入、输出、缓存读取、缓存写入和执行耗时。同时补齐和修正多种运行时的原生用量采集，缺失项保持未知，不会补成 0。
- 【功能】**执行台新增上下文占用显示。** 原生数据可用时，显示当前会话的已用量、窗口上限和占比，并在执行过程中更新，不必等整轮结束。切换模型、压缩或恢复会话时会校验数据归属，查看历史执行不会替换当前读数。
- 【修复】**新建会话的未发送内容可以恢复。** 切换会话、刷新页面、重新打开窗口或正常重启后，草稿仍会保留。同一项目可以保存多个新会话草稿，发送失败不清空，发送成功后清除。
- 【功能】**更新说明跟随界面语言显示。** 中文界面显示中文说明，英文界面显示英文说明；切换语言即时生效，保留正在查看的版本，并兼容旧版和只有单一语言的更新日志。
- 【界面】**恢复新队员加入卡片的布局。** 文字在左、头像在右，调整名称字号、性格标签和底部操作区，保留创建信息与智能体配置入口。
- 【修复】**修复 HTML 预览误报网页错误的问题。** 页面安全策略阻止 Rovai 的辅助诊断连接时，改为提示诊断不可用，不再算作网页自身的错误。真实脚本和资源错误仍保留，不放宽页面安全策略。
- 【修复】**修复 DeepSeek Harness 在部分 Responses 接口下的工具调用失败。** 处理 sub2api 等场景中的可选参数兼容问题，保留原生配置和用户显式设置。
- 【性能】**减少执行指标的后台读取。** 只查询运行中、可见或刚展开的执行记录，面板隐藏时暂停查询，稳定的历史记录不持续轮询。

### 升级提醒

Mac v0.4.1 及更新版本可在应用内升级；v0.4.0 及更早版本需要下载 DMG、退出旧应用并手动替换已安装应用一次。保留原有用户数据。

Server v0.4.1 及更新版本可在网页的“关于与更新”中升级；更早版本请先备份数据、停止 Server，再使用新版官方安装脚本，并保持原有数据目录。

Desktop 与 Server 同版发布，使用同一份源码构建。用量和上下文字段取决于各运行时实际提供的数据，本次不增加输出测速。

Windows x64 仍为未签名预览版，安装时可能出现“未知发布者”提示。请仅从本次官方 GitHub Release 下载安装包。
