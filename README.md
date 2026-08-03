# Rovai-ai

> Your camp for the next horizon.

Rovai-ai 是一个本地优先的多 Agent 研发工作空间，通过桌面应用组织长期成员、Camp 协作、任务执行、权限审批、审计与恢复，并驱动用户本机已有的 Coding Agent CLI。

**Build with agents that remember the road.**

## 当前状态

- v0.02 的 `CampMessage → CampTurn → AgentRun`、持久命令、Action/Approval、审计与恢复继续作为协作控制平面。
- v0.03 的五个实施检查点已经完成：成员管理、共享 `AdapterInstallation`、动态模型目录、Adapter 原生权限与 Native Session 惰性交接均已落地。
- v0.04 的五个实施检查点已经完成：Project 由 Camp 派生，首条消息原子创建完整 Camp 主链，固定侧栏与 Camp 工作区已替换 legacy Project/Task 主路径，停止后永久删除与跨重启恢复已经通过打包 App 验收。
- v0.05 的五个实施检查点已经完成：AgentRun 输入可冻结重现，Native Session 只接收未读公共增量，压缩仅在预算超限时触发；当时的 A2A 合同已支持 Codex、OpenCode、Copilot 与 Claude Code，现由 v0.32 Member Call 协议替代。
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
- v0.17、v0.18 与 v0.19 已完成可中断执行、默认伙伴记忆形成和四种新增 ACP
  Runtime 的实现与验收；详细证据保存在对应历史版本文档。
- v0.20 至 v0.23 已冻结为历史版本；受管 Runtime 发现、Native Session 上下文、
  配置式 Camp 创建、普通目录工作区与动态 Git 能力均已落地，详细状态保存在对应版本文档。
- v0.24 至 v0.30 已冻结为历史版本；Arctic Dawn V3、持久 Composer Draft、成员级 Runtime
  参数、伙伴身份、通知中心、队员工作台和 Antigravity 受证明 Team Bridge 均已落地，详细状态
  保存在对应历史版本文档。
- v0.31 已冻结为未完整收口的历史版本：Antigravity 完整十三个内置 MCP 工具对等、Qualification Runner、
  公开 demo、私有 Sealed Pack 与证据链已经实现。首个有效 CAL-001 的 Antigravity
  `delivery_unknown` 失败已保留，修复后的新 Team Configuration 使用同一密封 Case 和原预算
  完成有效校准；十二次自主 Trial 尚未启动，Pass Rate 仍不存在。
- v0.32 是唯一当前版本：`team.call_member` 以持久 ConversationInput、ReturnObligation、
  单 Conversation FIFO 和自动 Resume 取代 Agent 的 sleep + `team.list_tasks` 轮询；实现、
  本地自动化回归以及 Codex/Antigravity 真实 A→B→A Smoke 均已完成。v45 一次性能力规范化
  修复升级数据仍保留 `inbox.send` 而拒绝 `member.call` 的问题；OpenCode 原生工具名与 tester
  模型也已实测修正。新的 Team Pack 正式校准通过，12 次 Trial 严格结果为 4/12，分轴为功能
  6/12、变更边界 10/12、协作协议 12/12；72 个 Run、60 条 Member Call 和 30 次显式 Return
  全部收敛且无轮询。前序 6/12 Lead-only 诊断继续作为非正式基线，不与本轮成绩合并。
- 内置 Runtime 包括 Claude Code、Codex CLI、GitHub Copilot、OpenCode、Kiro、Qoder、
  CodeBuddy、Qwen Code 与 Antigravity；版本、模型和能力均从用户本机安装动态探测，
  不固定上游版本。
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
- [v0.17 可中断执行与持久会话证据](docs/versions/v0.17/README.md)
- [v0.18 伙伴记忆自动形成与长期记忆工作台](docs/versions/v0.18/README.md)
- [v0.19 已验证的 Agent Runtime 扩展](docs/versions/v0.19/README.md)
- [v0.20 受管 Product Runtime 发现与自动恢复](docs/versions/v0.20/README.md)
- [v0.21 Native Session 与动态上下文](docs/versions/v0.21/README.md)
- [v0.22 配置式 Camp 创建](docs/versions/v0.22/README.md)
- [v0.23 普通目录工作区与动态 Git 能力](docs/versions/v0.23/README.md)
- [v0.24 Arctic Dawn V3](docs/versions/v0.24/README.md)
- [v0.25 持久 Composer Draft 与公共附件路径](docs/versions/v0.25/README.md)
- [v0.26 成员级 Runtime 参数与后台检查](docs/versions/v0.26/README.md)
- [v0.27 伙伴身份与内置外观](docs/versions/v0.27/README.md)
- [v0.28 应用内通知中心](docs/versions/v0.28/README.md)
- [v0.29 队员工作台](docs/versions/v0.29/README.md)
- [v0.30 Antigravity 受证明 Team Bridge](docs/versions/v0.30/README.md)
- [v0.31 默认团队交付资格评测（历史未完整收口）](docs/versions/v0.31/README.md)
- [v0.32 事件驱动 Member Call（当前）](docs/versions/v0.32/README.md)
- [v0.32 Benchmark Review](docs/versions/v0.32/benchmark-review.md)
- [完整版本索引](docs/versions/README.md)
- [Renderer UI 规范](docs/ui/README.md)
- [跨版本架构决策（ADR）](docs/adr/README.md)
- [本地开发、运行、测试与构建](docs/development/README.md)
