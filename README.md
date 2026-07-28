# Rovai-ai

> Your camp for the next horizon.

Rovai-ai 是一个本地优先的多 Agent 研发工作空间，通过桌面应用组织长期成员、Camp 协作、任务执行、权限审批、审计与恢复，并驱动用户本机已有的 Coding Agent CLI。

**Build with agents that remember the road.**

## 当前状态

- v0.02 的 `CampMessage → CampTurn → AgentRun`、持久命令、Action/Approval、审计与恢复继续作为协作控制平面。
- v0.03 的五个实施检查点已经完成：成员管理、共享 `AdapterInstallation`、动态模型目录、Adapter 原生权限与 Native Session 惰性交接均已落地。
- v0.04 的五个实施检查点已经完成：Project 由 Camp 派生，首条消息原子创建完整 Camp 主链，固定侧栏与 Camp 工作区已替换 legacy Project/Task 主路径，停止后永久删除与跨重启恢复已经通过打包 App 验收。
- v0.05 的五个实施检查点已经完成：AgentRun 输入可冻结重现，Native Session 只接收未读公共增量，压缩仅在预算超限时触发；`team.post_message` 已支持 Codex、OpenCode、Copilot 与 Claude Code 的可恢复 A2A 执行链。
- v0.06 的五个实施检查点已经完成：用户与 Agent 可管理长期 Task，分配不会隐式唤醒成员；三个 Task Team Tool、授权读取、乐观并发、`[TASK_CONTEXT]`、真实双 Agent 交接和安全恢复均已落地。
- v0.07 的五个实施检查点已经完成：Hearth & Camp 双主题、系统/白昼/夜间偏好、稳定成员身份色、证据工作区与完整 Day/Night App 验收均已落地。
- v0.08 的五个实施检查点已经完成：受管 Skill Library、不可变 Revision、安全导入、项目级原生投影、AgentRun 暴露清单、设置管理页和五种 Runtime 的真实原生发现均已落地；Rovai-ai 不写入用户级 Agent Skill 目录。
- v0.09 的五个实施检查点已经完成：文件型 MCP Library、六种本机配置 Importer、按成员分配、AgentRun 冻结投影、四种 Runtime 原生注入和结构化设置页均已落地；Rovai-ai 不预装第三方 MCP，也不修改用户的 Runtime 配置。
- v0.10 的六个实施检查点已经完成：用户治理的应用级 Memory Library、SQLite
  真源、不可变 Revision、Agent 专属 live Markdown Projection、受 Native Binding
  约束的 `memory.propose_change`、单一 Stewardship Skill、管理 UI 与安全导出均已落地。
- v0.11 已将产品品牌、桌面应用、Core、私有包和 GitHub 仓库统一为 Rovai-ai；
  新命名优先，已有用户数据、Runtime 配置和持久协议标识通过明确兼容边界继续可用。
- v0.15 已完成成员生命周期、保留式永久移除、Camp Default Lead
  惰性修复与原子执行准入已经完成；Core、Renderer、fresh/v0.14 upgrade、冷重启、
  Day/Night 双尺寸、鼠标/键盘与严格 codesign 的打包 App 验收全部通过。
- v0.16 已完成 Runtime-owned resource permission、path-only Workspace、
  per-Run v1/v2 兼容语义、A2A 接收方配置隔离与 Runtime 原生审批选项往返；
  legacy 字段只为未完成旧 Run 的恢复暂时保留。
- v0.17 是唯一当前版本：已冻结整棵 CampTurn 可中断、持久但对 Agent 不可检索的
  AgentRun Execution Evidence、Safe GFM、Task/A2A 时间线卡和最小 A2A
  Turn Envelope 协议；生产代码、Migration v28、Contracts/Read Model v9 与自动
  测试已落地，真实 Runtime smoke 和打包 App 验收待完成。
- 内置 Runtime 包括 Codex CLI（stable）、OpenCode CLI（beta）、GitHub Copilot CLI（beta）、Claude Code CLI（beta）与 Antigravity App（experimental，通过本机 `agy` companion）；版本、模型和能力均从用户本机安装动态探测，不固定上游版本。
- 本机历史验收覆盖五种 Runtime 的真实最小执行与项目级 Skill 发现、Codex/ACP 审批、双 Agent 隔离、Core 重启恢复、Codex/OpenCode/Copilot/Claude Code A→B→A 显式回信，以及 Antigravity 同 Session 续接和 Antigravity → Codex 跨 Adapter 换绑。v0.17 不再按 Adapter 名称限制 A2A：接收只要求目标 Runtime 可准入，主动继续 A2A 则以冻结 Runtime 是否声明 `team_tool.post_message` 为准；Antigravity App 的真实发送 smoke 尚待完成。
- 项目仍处于预发布阶段；成熟度标签描述的是 Rovai-ai 对各 Adapter 的验证范围，不代表上游产品稳定性。

## 文档

- [文档导航、权威边界与 AI 读取规则](docs/README.md)
- [v0.04 主工作区导航设计与实施状态](docs/versions/v0.04/README.md)
- [v0.05 上下文治理与 Agent 间通信](docs/versions/v0.05/README.md)
- [v0.06 Team Task 协作工具与动态上下文](docs/versions/v0.06/README.md)
- [v0.07 Hearth & Camp 双主题视觉系统](docs/versions/v0.07/README.md)
- [v0.08 Skill Library 与 Runtime 原生发现](docs/versions/v0.08/README.md)
- [v0.09 MCP Library](docs/versions/v0.09/README.md)
- [v0.10 用户治理的长期记忆](docs/versions/v0.10/README.md)
- [v0.11 Rovai-ai 受控品牌与技术标识迁移](docs/versions/v0.11/README.md)
- [v0.12 公共消息检索、渐进摘要与上下文投递 v2](docs/versions/v0.12/README.md)
- [v0.13 伙伴经验自动沉淀与分级记忆权威](docs/versions/v0.13/README.md)
- [v0.14 营地伙伴身份视觉与受管本地头像](docs/versions/v0.14/README.md)
- [v0.15 成员生命周期与 Camp 执行准入](docs/versions/v0.15/README.md)
- [v0.16 Runtime 权限归属与 Workspace 语义收敛](docs/versions/v0.16/README.md)
- [v0.17 可中断执行与持久会话证据（当前）](docs/versions/v0.17/README.md)
- [Renderer UI 规范](docs/ui/README.md)
- [跨版本架构决策（ADR）](docs/adr/README.md)
- [本地开发、运行、测试与构建](docs/local-development.md)
