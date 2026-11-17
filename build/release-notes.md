# Rovai AI v0.5.14

<!-- lang:zh-CN -->

本次更新新增 Goose 智能体，并调整执行卡片和消息多选入口。

- 【功能】**新增 Goose 智能体。** 安装并配置官方 Goose 后，可在智能体设置中检查，并在队员管理或首次引导中选用。支持 Windows x64，macOS（Apple 芯片和 Intel）与 Linux x64 提供预览。
- 【功能】**Goose 支持会话恢复和执行中插话。** 重新打开会话后可以接着之前的工作继续，任务运行时也可以补充指令。
- 【功能】**Goose 接入 Skills、MCP 和工具审批。** 可以在 Skills 页查看本机 Goose 发现的技能，在会话中使用分配给队员的 MCP 工具，并处理工具审批。
- 【功能】**可以在会话中查看 Goose 的文件变更。** 新建文件可查看新增内容，编辑文件可查看具体修改片段。
- 【交互】**Goose 模型列表支持手动刷新。** 本机 Goose 的服务商或模型有变化时，可以在模型选择器中刷新。个别服务商刷新失败时，成功刷新的结果仍会显示。
- 【修复】**Goose 的思考强度随所选模型更新。** 队员设置和首次引导都会读取当前模型支持的档位，也可选择「跟随模型默认值」。
- 【优化】**省去 Goose 为原生会话自动起名的请求。** 执行任务和检查模型时，省去生成标题的辅助模型调用。
- 【修复】**执行卡片在运行中持续显示已用时间。** 执行结束后，有用量记录的卡片会显示 Token 总量，点击可查看输入、输出、缓存和耗时。
- 【交互】**统一消息多选入口。** 用户消息和队员消息使用相同的勾选列表图标，队员消息菜单显示「多选」，用户消息按钮提示为「多选消息」。选好消息后，可在工具栏导出。

---

<!-- lang:en -->

This release adds Goose as an Agent and updates the execution card and message selection controls.

- [Feature] **Use Goose as an Agent.** Install and configure the official Goose CLI, check it in Agent settings, and select it for a teammate or during setup. Goose is available on Windows x64 and in preview on Apple silicon, Intel Macs, and Linux x64.
- [Feature] **Resume Goose sessions and steer running tasks.** Pick up where you left off when reopening a conversation, or send more instructions while a task is running.
- [Feature] **Use Skills, MCP, and tool approvals with Goose.** See the skills your local Goose installation discovers on the Skills page. In a conversation, Goose can use a teammate's assigned MCP tools and request tool approval.
- [Feature] **Preview Goose file changes in the conversation.** Open a new file to see the added content, or an edited file to see the changes Goose made.
- [Interaction] **Refresh the Goose model list on demand.** Use the model picker to refresh after providers or models change in your local Goose configuration. Results from providers that refreshed successfully still appear if another provider fails.
- [Fix] **Show the thinking effort levels for the selected Goose model.** Teammate settings and initial setup load the levels that the selected model supports. You can also choose Follow model default.
- [Performance] **Skip Goose's automatic session-title request.** Running tasks and checking models skip the auxiliary model call used to generate a native session title.
- [Fix] **Keep elapsed time visible while an execution is running.** After execution ends, cards with recorded usage show the Token total. Select it to see input, output, cache, and elapsed time.
- [Interaction] **Use a consistent message selection control.** User and teammate messages share the checklist icon. Choose Select in the teammate message menu or Select messages on a user message, then use Export in the selection toolbar.
