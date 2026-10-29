# Rovai AI v0.5.3

<!-- lang:zh-CN -->

本次更新开放 Hermes 接入，支持运行中插话，优化消息排版、时间显示与文件预览，同时精简桌面安装包，并修复 macOS 启动时原有会话无法加载的问题。

- 【功能】**支持 Hermes 智能体。** macOS、Windows 和 Linux 均可接入本机 Hermes 0.22.4 及以上版本，支持会话恢复，也可在队员执行时补充指令。
- 【交互】**查看文件时保留当前预览。** 右侧正在查看文件、差异或使命活动时，发送消息或返回会话会保留当前页面；关闭预览后，也不会因延迟到来的执行信息再次跳转。
- 【界面】**优化宽屏下的公屏回复排版。** 队员回复会根据正文、表格和代码块调整宽度，减少气泡中的大块留白。短消息保持紧凑，超宽内容在消息内横向滚动。
- 【交互】**公屏消息时间移至操作栏。** 时间显示在复制、回复按钮旁，悬停或键盘聚焦时可见，触屏设备上保持显示。跨天消息会补上日期，连续消息组只在最后一条显示时间，并微调按钮间距。
- 【性能】**精简桌面安装包。** 清理重复打包的程序、依赖和网页资源，减少下载体积和安装后的磁盘占用。
- 【修复】**修复 macOS 启动时误报数据文件变化的问题。** 系统为数据库及相关文件添加标记时，可能被误判为文件发生变化，导致启动受阻、原有会话无法加载，本次修复了这一误判。

感谢 [@liuqiong0319](https://github.com/liuqiong0319) 反馈的宽屏消息排版和消息时间显示问题。

[完整变更](https://github.com/murray17/rovai-ai/compare/v0.5.2...v0.5.3)

---

<!-- lang:en -->

This release adds Hermes agent support with input during execution, improves message layout, timestamps and file previews, reduces Desktop package size, and fixes a macOS startup issue that could prevent existing conversations from loading.

- [Feature] **Use the Hermes agent.** Connect a local Hermes 0.22.4 or later installation on macOS, Windows or Linux, resume conversations, and send additional instructions while a teammate is working.
- [Interaction] **Keep the preview you are reading.** Sending a message or returning to a conversation preserves the file, diff or mission activity visible in the right pane. Delayed execution updates no longer switch the pane after the preview is closed.
- [UI] **Improve public-channel replies on wide screens.** Reply widths adapt to prose, tables and code blocks to reduce empty space. Short messages stay compact, and oversized content scrolls within the message.
- [Interaction] **Move public-message timestamps to the action row.** Time appears beside Copy and Reply on hover or keyboard focus, and stays visible on touch devices. Older messages include the date, and grouped messages show the time on the last message. Button spacing is also adjusted.
- [Performance] **Reduce Desktop package size.** Remove duplicate programs, dependencies and Web resources to reduce download size and installed disk usage.
- [Fix] **Fix false database-change errors during macOS startup.** System-added file markers could be mistaken for database changes, blocking startup and access to existing conversations. This update corrects that classification.

Thanks to [@liuqiong0319](https://github.com/liuqiong0319) for reporting the wide-screen message layout and timestamp display issues.

[Full changelog](https://github.com/murray17/rovai-ai/compare/v0.5.2...v0.5.3)
