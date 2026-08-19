---
document_type: versions-index
authority: version-lifecycle
current_version: v1.15
last_updated: 2026-08-19
---

# Rovai-ai 版本记录

`docs/versions/` 保存版本目标、版本内设计过程、实施计划、验收记录、决定理由和发布范围。开始使用前先阅读[文档导航](../README.md)；跨版本当前约束由 Architecture、Contracts、Context、UI 和 Development 直接拥有，决定治理见[版本决策](../decisions/README.md)。

## 生命周期

- `current`：唯一的当前版本，可以随范围、实施和验收事实更新。
- `historical`：已经冻结的历史快照，仅用于解释当时背景，不约束当前实现。
- 本文件 Front Matter 中的 `current_version` 是仓库唯一可维护的当前版本指针。
- 索引表中的唯一 `current` 行和各版本概览的 `lifecycle` 是该指针的状态投影，必须由
  `pnpm docs:check` 验证一致。
- 历史文档只修复错字、失效链接、错误元数据或增加明确勘误，不根据新代码重写原始判断。
- 满足准入门槛的重要取舍记录在版本唯一的 `decisions.md`；当前语义必须同时写入相应当前权威文档。

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
| `Decisions` | 是否形成满足准入门槛的重要取舍；是否同步更新当前权威和决定导航 | [版本决策治理](../decisions/README.md) |
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
| v0.48 | `historical` | 已完成六 Runtime Native Session compaction detector、durable Requirement 与 Bootstrap Redelivery Gate | [v0.48/README.md](v0.48/README.md) |
| v0.49 | `historical` | Electron Desktop Shell 通用设置、启动恢复，以及自包含双人追问官方 Skill | [v0.49/README.md](v0.49/README.md) |
| v0.50 | `historical` | Self/Peer、Model Context Projection/Evidence 与 Redelivery v2 已实现并完成版本级全量验证 | [v0.50/README.md](v0.50/README.md) |
| v0.51 | `historical` | 严格只读、显式单项修复的可操作诊断中心与集中脱敏 v5 导出 | [v0.51/README.md](v0.51/README.md) |
| v0.52 | `historical` | Dynamic Context 精确恢复、有界 omission Evidence 与代码证据优先的 Agent 仓库分析 Skill | [v0.52/README.md](v0.52/README.md) |
| v0.53 | `historical` | Versioned Benchmark Protocol v3、逐轴比较资格与 v0.52 当前合同离线回归 | [v0.53/README.md](v0.53/README.md) |
| v0.54 | `historical` | Lead-owned durable Task、Assignee 执行态与 self active Task context | [v0.54/README.md](v0.54/README.md) |
| v0.55 | `historical` | Agent 级连续执行过程、按需详情与 Inspector 收敛 | [v0.55/README.md](v0.55/README.md) |
| v0.56 | `historical` | Neutral Porcelain + Steel Renderer 与生产功能保真迁移 | [v0.56/README.md](v0.56/README.md) |
| v0.57 | `historical` | 可恢复的项目侧栏移除与本机导航偏好迁移 | [v0.57/README.md](v0.57/README.md) |
| v0.58 | `historical` | 可恢复 Runtime 漂移与受控重绑定；冻结时真实 Copilot 原地漂移 smoke 未完成 | [v0.58/README.md](v0.58/README.md) |
| v0.59 | `historical` | 九 Runtime 的零 send 公共输出恢复发布 | [v0.59/README.md](v0.59/README.md) |
| v0.60 | `historical` | 有界 Tool 输出预览与按需全文复制 | [v0.60/README.md](v0.60/README.md) |
| v0.61 | `historical` | 队员页来源感知会话返回 | [v0.61/README.md](v0.61/README.md) |
| v0.62 | `historical` | 显式 A2A 调用者返回、Core 管理 reply reference 与 Built-in Transport v6 | [v0.62/README.md](v0.62/README.md) |
| v0.63 | `historical` | MCP 队员分配工作台、长名册有界滚动与开放 Library | [v0.63/README.md](v0.63/README.md) |
| v0.64 | `historical` | Accepted Input 恢复阻断、安全收敛与 Copilot Native Turn 负向实验证据 | [v0.64/README.md](v0.64/README.md) |
| v0.65 | `historical` | 当前用户注意力与渐进式 CLI 教学未实施冻结；目录附件独立增量已完成 | [v0.65/README.md](v0.65/README.md) |
| v0.66 | `historical` | 已完成计划内受控关闭、同 generation 可靠终态与诚实 unknown 保留 | [v0.66/README.md](v0.66/README.md) |
| v0.67 | `historical` | 已完成 Core-owned 当前用户消息注意力与渐进式 Built-in CLI 教学 | [v0.67/README.md](v0.67/README.md) |
| v0.68 | `historical` | Opportunity-based Tool-use 测量、独立 LLM Judge 与 Team/Solo 配对协作价值协议 | [v0.68/README.md](v0.68/README.md) |
| v0.69 | `historical` | Planned Shutdown launch/terminal 线性化、waiting 终态与硬期限正确性修正 | [v0.69/README.md](v0.69/README.md) |
| v0.70 | `historical` | 消息局部 User Attention 教学收窄、Camp 标题去噪、十项 official Skill inventory 与 Built-in Tool Transport v8；九 Runtime v8 matrix 未执行即关闭 | [v0.70/README.md](v0.70/README.md) |
| v0.71 | `historical` | Core-owned Notification Episode；Campfire、系统必需 operational Skill 管理与受控关闭终态收敛 | [v0.71/README.md](v0.71/README.md) |
| v0.72 | `historical` | Camp 会话区沉浸世界地图、真实执行播报与只读协作叙事 | [v0.72/README.md](v0.72/README.md) |
| v0.73 | `historical` | best-effort 在线长期记忆捕获、actor-bounded mutation、隔离 Hearth Review 与 Built-in Transport v9；真实 Runtime/UI 矩阵未完成即冻结 | [v0.73/README.md](v0.73/README.md) |
| v0.74 | `historical` | Runtime 对齐的 Campfire/Grill Duo、双轴代码评审与十二项 official Skill inventory；真实 duo dry-run 与严格 Clippy 基线未完成即冻结 | [v0.74/README.md](v0.74/README.md) |
| v0.75 | `historical` | 当前 Camp 成员显示名 inline alias；Review Duo 与 Scope-identified Memory 正确性收口 | [v0.75/README.md](v0.75/README.md) |
| v0.76 | `historical` | 显示名 inline alias 的行首寻址门禁 | [v0.76/README.md](v0.76/README.md) |
| v0.77 | `historical` | 持久消息回复链、Draft-only reply intent 与显式接收者修复 | [v0.77/README.md](v0.77/README.md) |
| v0.78 | `historical` | 完整 Exact-Scope Memory View、Copyable Target 与 Memory-domain clean break | [v0.78/README.md](v0.78/README.md) |
| v0.79 | `historical` | Camp 会话轻量打开投影、分段性能诊断与按需历史加载 | [v0.79/README.md](v0.79/README.md) |
| v0.80 | `historical` | Core-owned 接收者延续、失效修复与 Composer 路由去重 | [v0.80/README.md](v0.80/README.md) |
| v0.81 | `historical` | Camp 轻量打开、渐进历史与分段性能诊断 | [v0.81/README.md](v0.81/README.md) |
| v0.82 | `historical` | 冷启动恢复壳层、轻量 Camp 存在性检查与 bundled Skill 快速路径 | [v0.82/README.md](v0.82/README.md) |
| v0.83 | `historical` | TRAE CLI CN Runtime、实证 ACP 准入与设置页待支持预告边界 | [v0.83/README.md](v0.83/README.md) |
| v0.84 | `historical` | 可切换的底部执行台与右侧 Inspector 执行 Sidecar | [v0.84/README.md](v0.84/README.md) |
| v0.85 | `historical` | Agent 主导的伙伴入队、受控头像导入与十三项 official Skill inventory | [v0.85/README.md](v0.85/README.md) |
| v0.86 | `historical` | Benchmark Tool-use Measurement v2、Memory/Task/Camp 证据闭合与 A2A 反馈链投影 | [v0.86/README.md](v0.86/README.md) |
| v0.87 | `historical` | TRAE 静态 Runtime 检测、首次真实任务同进程验证与可选静态版本 | [v0.87/README.md](v0.87/README.md) |
| v0.88 | `historical` | Camp 世界地图环境片段、全局闲时调度与拥挤布局字幕回退 | [v0.88/README.md](v0.88/README.md) |
| v0.89 | `historical` | 持久 Gather Barrier、统一 Completion Delivery 与类型化聚合输入 | [v0.89/README.md](v0.89/README.md) |
| v0.90 | `historical` | Gather 当前代最后结果、独立回传限额与 self-contained completion | [v0.90/README.md](v0.90/README.md) |
| v0.91 | `historical` | 空 MCP Library、预发布 clean break 与用户自主管理 | [v0.91/README.md](v0.91/README.md) |
| v0.92 | `historical` | Grill Duo 有界开放轮次、自包含协议与自然语言路由收敛 | [v0.92/README.md](v0.92/README.md) |
| v0.93 | `historical` | Review Duo 四消息会话语义、结果有界化与 Grill Duo CLI 去重 | [v0.93/README.md](v0.93/README.md) |
| v0.94 | `historical` | 核心模型输入精简、历史投影收敛与结构化 Run Facts | [v0.94/README.md](v0.94/README.md) |
| v0.95 | `historical` | Official Skill 测试去文案化、场景验收分层与协作协议去重 | [v0.95/README.md](v0.95/README.md) |
| v0.96 | `historical` | Clean-break 运行监控、原生 Usage 观测与诚实 Coverage | [v0.96/README.md](v0.96/README.md) |
| v0.97 | `historical` | 持久首次训练、断点恢复与真实“初次集结”快速对话 | [v0.97/README.md](v0.97/README.md) |
| v0.98 | `historical` | Picker 结构化 Skill 身份、发送时冻结与 `CURRENT_INPUT.skills` 文件链接 | [v0.98/README.md](v0.98/README.md) |
| v0.99 | `historical` | 五表 clean-break Runtime Usage Metering、稀疏 Token/Cache/Cost 与单 Snapshot 页面 | [v0.99/README.md](v0.99/README.md) |
| v1.00 | `historical` | 用户确认后直接强制停止执行并物理删除 Camp 聚合 | [v1.00/README.md](v1.00/README.md) |
| v1.01 | `historical` | TRAE 与 Kiro 新队员使用已验证的最高权限默认 | [v1.01/README.md](v1.01/README.md) |
| v1.02 | `historical` | OpenCode 完整 Token/Cache 语义与 Codex 版本化 API 公价估算 | [v1.02/README.md](v1.02/README.md) |
| v1.03 | `historical` | TRAE 启动轻检、统一可用状态与用户显式 ACP Session 验证 | [v1.03/README.md](v1.03/README.md) |
| v1.04 | `historical` | TRAE cold resume、受控 HistoryRestore 与 replay quarantine | [v1.04/README.md](v1.04/README.md) |
| v1.05 | `historical` | Windows x64 技术设计闭环；产品代码、打包和真实 Runtime 资格未实施即冻结 | [v1.05/README.md](v1.05/README.md) |
| v1.06 | `historical` | 统一单 Camp History target、Public A2A 历史可见性与安全 CLI 投影错误 | [v1.06/README.md](v1.06/README.md) |
| v1.07 | `historical` | 显式 Public-only、A2A 边指导与 Principal 双投影提案；revision 1 确认后先冻结，随后作为独立交付实现 | [v1.07/README.md](v1.07/README.md) |
| v1.08 | `historical` | 取消 Run 中未闭合活动的无动画“已停止”投影 | [v1.08/README.md](v1.08/README.md) |
| v1.09 | `historical` | 完整 Camp 会话查找、Mode-aware Built-in CLI 与完整 Tool 结果交互 | [v1.09/README.md](v1.09/README.md) |
| v1.10 | `historical` | 唯一 Rovai Camp ID clean break 与 Claude Code/Antigravity 安全公开失败 | [v1.10/README.md](v1.10/README.md) |
| v1.11 | `historical` | Runtime 模型目录 SWR、主动检查终态与真实执行模型校验 | [v1.11/README.md](v1.11/README.md) |
| v1.12 | `historical` | User-only AgentRun 局部停止、立即写 fence 与权威状态投影 | [v1.12/README.md](v1.12/README.md) |
| v1.13 | `historical` | 十 Runtime 的 AgentRun 首个实际模型观测与执行台展示 | [v1.13/README.md](v1.13/README.md) |
| v1.14 | `historical` | `camp.read` 安全 Timeline 默认、显式消息锚点模式与 Built-in Transport v17 | [v1.14/README.md](v1.14/README.md) |
| v1.15 | `current` | Windows x64 产品实现、平台验收与逐 Runtime 资格闭环 | [v1.15/README.md](v1.15/README.md) |
