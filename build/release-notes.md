# Rovai AI v0.5.12

<!-- lang:zh-CN -->

本次更新新增会话分叉和 Kilo 智能体接入，OpenCode 也可以在执行中插话。

感谢 @arschlochnop 在 Issue #1042 中反馈长会话难以分段继续的问题，也感谢 @caoshuisi 在 Issue #997 中提供本机 CLI 升级后版本信息滞后的复现。

- 【功能】**支持会话分叉。** 可从侧栏会话菜单复制全部公屏历史，也可在队员消息的三点菜单选择「从此处分叉」，只复制到该条消息。新会话沿用原项目目录和在队成员，保留消息引用和附件入口。
- 【功能】**接入 Kilo 智能体。** 可沿用本机 Kilo CLI 的登录和模型配置，在 Rovai 中选择模型与推理强度、使用 MCP，并查看文件变更和子代理进度。Windows x64 可用，macOS（Apple 芯片和 Intel）与 Linux x64 以预览方式开放。
- 【功能】**OpenCode 支持执行中插话。** 使用 2.2.7 起的稳定 2.x 版本时，可以在队员执行中补充指令，后续执行也可以接续原会话。
- 【交互】**`@` 队员时可以用智能体的启动命令搜索。** 例如 `@agy` 查找 Antigravity 队员，`@mcode` 查找 MiniMax Code 队员，也支持 `@cmdc`、`@qodercli` 和 `@kiro-cli`。
- 【交互】**MiniMax Code 按需读取思考强度。** 配置时只查询所选模型的档位，队员摘要、消息和执行详情也会显示已记录的思考强度。
- 【修复】**智能体升级后会按需刷新安装版本。** Homebrew 等工具更新启动链接后，Rovai 会在后续执行时读取新入口，首次启动读到的新版本也会同步到设置页。单次版本查询上限由 15 秒缩短到 10 秒。
- 【界面】**调整回复时的输入区布局。** 回复摘要放在待发送附件上方，点击右侧叉号即可取消回复。
- 【界面】**调整通用提示和文件预览的错误显示。** 通用提示移到窗口顶部居中，多条提示会纵向排列。附件、消息中的文件或变更文件打不开时，会在对应的预览标签内显示「无法打开文件」。
- 【性能】**增量读取 Kilo 和 OpenCode 1.x 的用量。** 长会话积累大量历史消息后，也能继续统计新消息的用量。
- 【修复】**修复中文 Markdown 斜体显示。** 当前字体缺少斜体字形时，中文斜体和加粗斜体也能正确显示。
- 【界面】**统一 Pi 和 DeepSeek Harness 的强度默认项文案。** 队员设置和配置摘要统一显示「跟随模型默认值」。

---

<!-- lang:en -->

This release adds conversation forking, Kilo integration, and the ability to steer a running OpenCode teammate.

Thanks to @arschlochnop for describing the need to continue long conversations in separate parts in Issue #1042, and to @caoshuisi for the reproduction steps in Issue #997 showing how the displayed version could lag after a local CLI upgrade.

- [Feature] **Fork a conversation.** Use Fork in the sidebar menu to copy the entire public history, or use Fork chat from here in a teammate message’s menu to copy through that message. The new conversation uses the same project directory and active teammates, and keeps message quotes and attachment entries.
- [Feature] **Use Kilo as an Agent.** Rovai uses your local Kilo CLI sign-in and model configuration. Select a model and reasoning effort, use MCP, and view file changes and subagent progress. Available on Windows x64, with preview support on Apple silicon, Intel Macs, and Linux x64.
- [Feature] **Steer a running OpenCode teammate.** Stable OpenCode 2.x versions starting at 2.2.7 can receive additional instructions during execution. Later runs can continue the original session.
- [Interaction] **Find teammates by their Agent’s launch command when using `@`.** For example, `@agy` finds Antigravity teammates and `@mcode` finds MiniMax Code teammates. `@cmdc`, `@qodercli`, and `@kiro-cli` also work.
- [Interaction] **Load MiniMax Code thinking effort on demand.** Settings fetch the options for the selected model. Teammate summaries, messages, and run details show the recorded thinking effort.
- [Fix] **Refresh installed Agent versions after upgrades.** When a tool such as Homebrew updates a launch link, Rovai resolves the new entry during a subsequent run. The version read on the first launch after an upgrade also appears in Settings. Individual version checks now time out after 10 seconds.
- [UI] **Rearrange the reply composer.** The reply summary appears above pending attachments, with a close button to cancel the reply.
- [UI] **Move notifications and file errors to clearer locations.** General notifications stack at the top center of the window. If an attachment, a file referenced in a message, or a changed file cannot be opened, its preview tab displays “Could not open file.”
- [Performance] **Read Kilo and OpenCode 1.x usage incrementally.** Rovai can continue tracking usage for new messages even in conversations with a long history.
- [Fix] **Render Chinese Markdown italics correctly.** Chinese italic and bold-italic text display correctly when the selected font lacks italic glyphs.
- [UI] **Use the same model-default label for Pi and DeepSeek Harness.** Teammate settings and configuration summaries use “Model default.”
