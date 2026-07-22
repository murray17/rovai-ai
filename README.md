# Lumen AI

Lumen AI 是一个本地优先的多 Agent 研发工作空间，通过桌面应用组织长期成员、Camp 协作、任务执行、权限审批、审计与恢复，并驱动用户本机已有的 Coding Agent CLI。

## 当前状态

- v0.02 的 `CampMessage → CampTurn → AgentRun`、持久命令、Action/Approval、审计与恢复继续作为协作控制平面。
- v0.03 的五个实施检查点已经完成：成员管理、共享 `AdapterInstallation`、动态模型目录、Adapter 原生权限与 Native Session 惰性交接均已落地。
- 内置 Runtime 包括 Codex CLI（stable）、OpenCode CLI（beta）、GitHub Copilot CLI（beta）与 Antigravity/AGY CLI（experimental）；版本、模型和能力均从用户本机安装动态探测，不固定上游版本。
- 本机验收已覆盖四种 Runtime 的真实最小执行、Codex/ACP 审批、双 Agent 隔离、Core 重启恢复，以及 AGY 同 Session 续接和 AGY → Codex 跨 Adapter 换绑。
- 项目仍处于预发布阶段；成熟度标签描述的是 Lumen 对各 Adapter 的验证范围，不代表上游产品稳定性。

## 文档

- [文档导航、权威边界与 AI 读取规则](docs/README.md)
- [v0.03 多 Runtime 架构与实施状态](docs/versions/v0.03/README.md)
- [跨版本架构决策（ADR）](docs/adr/README.md)
- [本地开发、运行、测试与构建](docs/local-development.md)
