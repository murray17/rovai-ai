# Lumen AI

Lumen AI 是一个本地优先的 AI 研发工作空间，通过桌面应用驱动本机 Codex 完成对话、项目开发、审批、审计与任务恢复。

## 当前状态

- v0.01 的历史任务与数据继续兼容读取；新协作入口已经切到 v0.02 的 `CampMessage → CampTurn → AgentRun` 主链。
- v0.02 已贯通持久命令、Camp 多 Agent、Scheduler、共享 Codex Host 下的独立 Native Thread、Action/Approval，以及 Evidence/Read Model/Renderer 控制面。
- 真实 Codex 验收已覆盖单 Agent、双 Agent 隔离执行、动作审批和 Core 重启恢复；v0.02 尚未完成 Inbox 执行唤醒、continuation、取消/重试与完整破坏性 APP 验收，因此仍不属于发布完成状态。

## 文档

- [当前版本架构与已实现功能](docs/versions/v0.01/README.md)
- [v0.02 实施架构决策](docs/adr/README.md)
- [本地开发、运行、测试与构建](docs/local-development.md)
