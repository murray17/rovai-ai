# Lumen AI

Lumen AI 是一个本地优先的多 Agent 研发工作空间，通过桌面应用组织长期成员、Camp 协作、任务执行、权限审批、审计与恢复，并驱动用户本机已有的 Coding Agent CLI。

## 当前状态

- v0.02 的 `CampMessage → CampTurn → AgentRun`、持久命令、Action/Approval、审计与恢复继续作为协作控制平面。
- v0.03 的五个实施检查点已经完成：成员管理、共享 `AdapterInstallation`、动态模型目录、Adapter 原生权限与 Native Session 惰性交接均已落地。
- v0.04 的五个实施检查点已经完成：Project 由 Camp 派生，首条消息原子创建完整 Camp 主链，固定侧栏与 Camp 工作区已替换 legacy Project/Task 主路径，停止后永久删除与跨重启恢复已经通过打包 App 验收。
- v0.05 的五个实施检查点已经完成：AgentRun 输入可冻结重现，Native Session 只接收未读公共增量，压缩仅在预算超限时触发；`team.post_message` 已支持 Codex、OpenCode、Copilot 与 Claude Code 的可恢复 A2A 执行链。
- v0.06 的五个实施检查点已经完成：用户与 Agent 可管理长期 Task，分配不会隐式唤醒成员；三个 Task Team Tool、授权读取、乐观并发、`[TASK_CONTEXT]`、真实双 Agent 交接和安全恢复均已落地。
- v0.07 的五个实施检查点已经完成：Hearth & Camp 双主题、系统/白昼/夜间偏好、稳定成员身份色、证据工作区与完整 Day/Night App 验收均已落地。
- v0.08 的五个实施检查点已经完成：受管 Skill Library、不可变 Revision、安全导入、项目级原生投影、AgentRun 暴露清单、设置管理页和五种 Runtime 的真实原生发现均已落地；Lumen 不写入用户级 Agent Skill 目录。
- v0.09 的五个实施检查点已经完成：文件型 MCP Library、六种本机配置 Importer、按成员分配、AgentRun 冻结投影、四种 Runtime 原生注入和结构化设置页均已落地；Lumen 不预装第三方 MCP，也不修改用户的 Runtime 配置。
- 内置 Runtime 包括 Codex CLI（stable）、OpenCode CLI（beta）、GitHub Copilot CLI（beta）、Claude Code CLI（beta）与 Antigravity App（experimental，通过本机 `agy` companion）；版本、模型和能力均从用户本机安装动态探测，不固定上游版本。
- 本机验收覆盖五种 Runtime 的真实最小执行与项目级 Skill 发现、Codex/ACP 审批、双 Agent 隔离、Core 重启恢复、Codex/OpenCode/Copilot/Claude Code A→B→A 显式回信，以及 Antigravity 同 Session 续接和 Antigravity → Codex 跨 Adapter 换绑；Antigravity App 暂不支持 Team Tool。
- 项目仍处于预发布阶段；成熟度标签描述的是 Lumen 对各 Adapter 的验证范围，不代表上游产品稳定性。

## 文档

- [文档导航、权威边界与 AI 读取规则](docs/README.md)
- [v0.04 主工作区导航设计与实施状态](docs/versions/v0.04/README.md)
- [v0.05 上下文治理与 Agent 间通信](docs/versions/v0.05/README.md)
- [v0.06 Team Task 协作工具与动态上下文](docs/versions/v0.06/README.md)
- [v0.07 Hearth & Camp 双主题视觉系统](docs/versions/v0.07/README.md)
- [v0.08 Skill Library 与 Runtime 原生发现](docs/versions/v0.08/README.md)
- [v0.09 MCP Library](docs/versions/v0.09/README.md)
- [Renderer UI 规范](docs/ui/README.md)
- [跨版本架构决策（ADR）](docs/adr/README.md)
- [本地开发、运行、测试与构建](docs/local-development.md)
