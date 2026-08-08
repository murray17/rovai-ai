---
document_type: versions-index
authority: version-lifecycle
current_version: v0.48
last_updated: 2026-08-08
---

# Rovai-ai 版本记录

`docs/versions/` 保存版本目标、版本内设计过程、实施计划、验收记录和发布范围。开始使用前先阅读 [文档导航](../README.md)；跨版本长期约束以 [有效 ADR](../adr/README.md) 为准。

## 生命周期

- `current`：唯一的当前版本，可以随范围、实施和验收事实更新。
- `historical`：已经冻结的历史快照，仅用于解释当时背景，不约束当前实现。
- 本文件 Front Matter 中的 `current_version` 是仓库唯一可维护的当前版本指针。
- 索引表中的唯一 `current` 行和各版本概览的 `lifecycle` 是该指针的状态投影，必须由
  `pnpm docs:check` 验证一致。
- 历史文档只修复错字、失效链接、错误元数据或增加明确勘误，不根据新代码重写原始判断。
- 需要跨版本长期成立的决定必须提升为 ADR；版本文档只保留版本影响和 ADR 链接。

## 版本切换清单

创建版本或修改 `current_version` 时，必须按以下顺序完成：

1. 将旧版本概览的 `lifecycle` 改为 `historical`，冻结其范围、实施状态和验收事实；
2. 建立新版本概览与实施计划，并把新版本概览标为唯一 `current`；
3. 更新本文件的 `current_version`、版本索引行和前后版本链接；
4. 在新版本概览中完成“跨版本文档影响”记录；
5. 运行 `pnpm docs:check`。缺少记录、存在多个 `current` 或索引不一致时，版本切换未完成。

每个范围都必须给出“已更新”并附文件路径，或“确认无需更新”并附一句可审阅理由。
目录自己的索引和维护指南拥有具体更新规则；本清单只拥有版本切换时的完整性要求。

| 范围 | 必须判断的问题 | 规则入口 |
| --- | --- | --- |
| `Version lifecycle` | 旧/新版本概览、实施计划、Front Matter、索引和链接是否一致 | 本文件 |
| `ADR` | 是否产生新的跨版本长期约束，或改变既有决定语义 | [ADR 索引与生命周期](../adr/README.md) |
| `Contracts` | 字段级接口、Envelope、receipt、幂等、错误或投递语义是否变化 | [合同索引与生命周期](../contracts/README.md) |
| `Architecture` | 组件职责、权威边界、进程或传输结构是否变化 | [长期架构索引](../architecture/README.md) |
| `UI` | 是否改变跨版本 Renderer / UX 合同；版本局部设计不得自动提升为稳定规范 | [UI 规范索引](../ui/README.md) |
| `Runtime Activity` | Runtime 接入或 Canonical Activity 映射、证据、展示是否变化 | [Runtime Activity 维护指南](../runtime-activity/README.md) |
| `Runtime compatibility` | Runtime 实测版本、能力或兼容性结论是否变化 | [Runtime 兼容性清单](../runtime-compatibility.md) |
| `Documentation routing` | 任务入口、当前合同或目录职责是否变化 | [文档导航](../README.md) |
| `Root README` | 项目定位、常青能力或支持范围是否变化；不得写当前版本断言或版本流水账 | [项目 README](../../README.md) |

新版本概览必须包含标题为 `## 跨版本文档影响` 的记录表，并使用上表九个稳定范围名。
结论列只接受 `已更新` 或 `确认无需更新`；证据或理由不得为空。规则表只在本文件维护，
`AGENTS.md` 和其他导航文档只链接到这里。

## 版本索引

| 版本 | 生命周期 | 内容 | 入口 |
|---|---|---|---|
| v0.01 | `historical` | 本地优先单 Agent 执行基线 | [v0.01/README.md](v0.01/README.md) |
| v0.02 | `historical` | 多 Agent 协作控制平面架构与验收快照 | [v0.02/README.md](v0.02/README.md) |
| v0.03 | `historical` | 多 Runtime 队员管理；五个实施检查点完成时的预发布快照 | [v0.03/README.md](v0.03/README.md) |
| v0.04 | `historical` | Camp-first 主界面导航与工作区；五个实施检查点完成时的预发布快照 | [v0.04/README.md](v0.04/README.md) |
| v0.05 | `historical` | 可重现上下文治理与 Agent 间执行型通信；五个实施检查点完成时的验收快照 | [v0.05/README.md](v0.05/README.md) |
| v0.06 | `historical` | Team Task 协作工具与动态工作上下文；五个实施检查点完成时的验收快照 | [v0.06/README.md](v0.06/README.md) |
| v0.07 | `historical` | Hearth & Camp 双主题视觉系统；五个实施检查点完成时的验收快照 | [v0.07/README.md](v0.07/README.md) |
| v0.08 | `historical` | Skill Library、设置入口与 Runtime 原生项目级发现 | [v0.08/README.md](v0.08/README.md) |
| v0.09 | `historical` | MCP Library、一次性配置导入与 Runtime 投影 | [v0.09/README.md](v0.09/README.md) |
| v0.10 | `historical` | 用户治理的应用级长期记忆；六个实施检查点完成时的预发布快照 | [v0.10/README.md](v0.10/README.md) |
| v0.11 | `historical` | Rovai-ai 受控品牌与技术标识迁移 | [v0.11/README.md](v0.11/README.md) |
| v0.12 | `historical` | 公共消息层检索、渐进摘要与上下文投递 v2 | [v0.12/README.md](v0.12/README.md) |
| v0.13 | `historical` | 伙伴经验自动沉淀与分级记忆权威 | [v0.13/README.md](v0.13/README.md) |
| v0.14 | `historical` | 营地伙伴身份视觉与受管本地头像 | [v0.14/README.md](v0.14/README.md) |
| v0.15 | `historical` | 队员生命周期、保留式永久移除与 Camp 执行准入 | [v0.15/README.md](v0.15/README.md) |
| v0.16 | `historical` | Runtime 权限归属与 Workspace 语义收敛 | [v0.16/README.md](v0.16/README.md) |
| v0.17 | `historical` | 可中断执行、持久会话证据与最小 A2A 上下文 | [v0.17/README.md](v0.17/README.md) |
| v0.18 | `historical` | 默认开启的伙伴记忆自动形成与一级长期记忆工作台 | [v0.18/README.md](v0.18/README.md) |
| v0.19 | `historical` | 已验证 Runtime 目录与四种新增精确 MCP ACP 执行引擎 | [v0.19/README.md](v0.19/README.md) |
| v0.20 | `historical` | 已完成的受管 Product Runtime 发现、选择解析与自动迁移 | [v0.20/README.md](v0.20/README.md) |
| v0.21 | `historical` | 已完成的 Native Session Bootstrap、AgentRun 动态上下文与按需 Memory 访问重构 | [v0.21/README.md](v0.21/README.md) |
| v0.22 | `historical` | 配置式 Camp 创建、协作模式持久化与按目标延迟创建 Conversation | [v0.22/README.md](v0.22/README.md) |
| v0.23 | `historical` | 普通目录工作区、动态 Git 能力与 AgentRun Git 审计 | [v0.23/README.md](v0.23/README.md) |
| v0.24 | `historical` | Arctic Dawn V3 Renderer 设计权威切换与全界面收敛 | [v0.24/README.md](v0.24/README.md) |
| v0.25 | `historical` | 持久 Camp Composer Draft 与稳定公共附件路径 | [v0.25/README.md](v0.25/README.md) |
| v0.26 | `historical` | 队员级模型、Runtime 原生权限与后台可用性检查 | [v0.26/README.md](v0.26/README.md) |
| v0.27 | `historical` | 伙伴身份六字段、内置队员身份与外观更新 | [v0.27/README.md](v0.27/README.md) |
| v0.28 | `historical` | 已完成的持久应用内通知中心与注意事项呈现 | [v0.28/README.md](v0.28/README.md) |
| v0.29 | `historical` | 已完成的队员工作台信息架构、上下文名册与运行配置入口 | [v0.29/README.md](v0.29/README.md) |
| v0.30 | `historical` | 已完成的 Antigravity 受证明 Team Bridge | [v0.30/README.md](v0.30/README.md) |
| v0.31 | `historical` | 默认团队交付资格评测；修复后校准通过，十二次自主 Trial 未运行 | [v0.31/README.md](v0.31/README.md) |
| v0.32 | `historical` | 已完成事件驱动 Member Call；正式 Team Qualification 为严格 4/12、协作协议 12/12 | [v0.32/README.md](v0.32/README.md) |
| v0.33 | `historical` | 已完成统一侧栏操作；同一提交还合入结构化 Mention，范围歧义见历史勘误 | [v0.33/README.md#历史勘误2026-08-06](v0.33/README.md#历史勘误2026-08-06) |
| v0.34 | `historical` | 历史回填已实现 normalization、Ledgers、Bundle、五层报告与 Judge 协议；ADR-0094 Formal isolation 实证仍未完成，不发布正式 Pass Rate | [v0.34/README.md](v0.34/README.md) |
| v0.35 | `historical` | 已完成队员身份迁入 Native Session Bootstrap、Claude/Codex Resume 重注入、非持久完整 Bootstrap 与 clean-break 迁移 | [v0.35/README.md](v0.35/README.md) |
| v0.36 | `historical` | 已完成四 Case Collaboration-Value Diagnostic Portfolio、Case v3 challenge admission、八次真实 Trial 与不可变 Completion 证据 | [v0.36/README.md](v0.36/README.md) |
| v0.37 | `historical` | 已完成标准 MCP JSON、稳定 Assignment、统一设置页、Rovai 优先 Runtime Projection 与 Runtime-group Skill delivery | [v0.37/README.md](v0.37/README.md) |
| v0.38 | `historical` | Task 创建即出现唯一实时卡片，普通更新不再产生会话消息 | [v0.38/README.md](v0.38/README.md) |
| v0.39 | `historical` | 已完成 Codex Isolated Home 与 AgentRun 进程隔离阻断修复 | [v0.39/README.md](v0.39/README.md) |
| v0.40 | `historical` | Camp 历史检索工具收敛与 Agent-bounded 跨 Camp 原文读取 | [v0.40/README.md](v0.40/README.md) |
| v0.41 | `historical` | 已完成跨 Runtime 统一运行活动语义、生命周期投影与观测诚实性 | [v0.41/README.md](v0.41/README.md) |
| v0.42 | `historical` | Rovai built-in operations 的九 Runtime CLI-only transport clean break | [v0.42/README.md](v0.42/README.md) |
| v0.43 | `historical` | Runtime-native additive external MCP 与 Codex Native Home 回退；自动验证完成，真实 Runtime Smoke 未在冻结前全部完成 | [v0.43/README.md](v0.43/README.md) |
| v0.44 | `historical` | 确定性有界原始公共消息上下文与摘要系统移除 | [v0.44/README.md](v0.44/README.md) |
| v0.45 | `historical` | 显式 A2A、公共输出、统一 Message Delivery、Profile v2 引用闭合与 Scheme C 会话区 | [v0.45/README.md](v0.45/README.md) |
| v0.46 | `historical` | 已完成 Agent Result Projection、Agent-facing Discovery 删除与隐式 Camp 作用域的 clean break | [v0.46/README.md](v0.46/README.md) |
| v0.47 | `historical` | 已完成 Durable Task v2、一次性责任准入、原子成员收口与 Built-in Transport v4 | [v0.47/README.md](v0.47/README.md) |
| v0.48 | `current` | 已完成六 Runtime Native Session compaction detector、durable Requirement 与 Bootstrap Redelivery Gate | [v0.48/README.md](v0.48/README.md) |
