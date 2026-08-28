---
document_type: documentation-index
authority: documentation-routing
last_updated: 2026-08-28
---

# Rovai-ai 文档导航

本文件定义 `docs/` 的职责、权威边界和读取顺序。人和 AI 在处理架构、实现、规划或文档任务前，应先从这里判断需要读取哪些资料，而不是默认加载全部历史文档。

## 从这里开始

| 你想做什么 | 入口 |
|---|---|
| 安装和使用 Rovai | [用户指南](guides/README.md) |
| 参与开发 | [开发者指南](development/README.md) |
| 理解当前架构 | [长期架构](architecture/README.md) |
| 查看当前决策 | [当前决定](decisions/CURRENT.md) |
| 查看当前版本 | [版本记录](versions/README.md) |

## 维护者与 Coding Agent 按任务读取

| 任务 | 必读资料 |
|---|---|
| 判断长期架构约束或修改领域、持久化、安全、Runtime 边界 | 先读[当前 Architecture 索引](architecture/README.md)和相关当前 Contract；需要理解取舍时再从[当前决定导航](decisions/CURRENT.md)进入版本理由 |
| 新增或修改 Version Decision、Architecture、Contract、版本文档或文档路由 | [决策治理与准入](decisions/README.md)、[当前决定导航](decisions/CURRENT.md)、对应目录 README，并运行通用文档门禁；禁止新增数字 ADR |
| 判断当前版本目标、范围、进度或验收口径 | 从[版本索引中的唯一 `current` 条目](versions/README.md)进入对应版本概览与实施计划 |
| 查询已接入与候选 Agent Runtime 的实测兼容性 | [Runtime 兼容性清单](runtime-compatibility.md) |
| 新增 Agent Runtime、建立真实 Probe、判断 Settings Preview 或主机平台准入边界 | [Agent Runtime 接入与准入 Checklist](development/runtime-integration-checklist.md)、[Runtime Catalog Boundaries](architecture/runtime-catalog-boundaries.md)、[Runtime Platform Admission v1](contracts/runtime-platform-admission-v1.md)、[Runtime 平台安全不变量](architecture/foundational-invariants.md#runtime-platform-security)、[当前 Kimi Runtime 版本](versions/v1.27/README.md)、[Kimi Research](research/kimi-code-runtime-research.md)、[Cursor Research](research/cursor-agent-runtime-research.md)及[TRAE Research/Probe](research/trae-cli-runtime/README.md) |
| 修改 Runtime Usage、监控 collection、Coverage、成本层或设置页运行监控 | [Evidence 与 Usage 不变量](architecture/foundational-invariants.md#evidence-usage)、[Runtime Monitoring 架构](architecture/runtime-monitoring.md)、[Runtime Usage Monitoring v3](contracts/runtime-usage-monitoring-v3.md)及[可采集性审计](research/runtime-monitoring/README.md) |
| 修改 Runtime 子进程启动、主机平台准入、ACP Client FS/Terminal、Camp attachment root、Run tmp writable root、浅检测/深检、模型目录缓存、检查 attempt、公开 Runtime failure/command、运行中 Runtime diagnostic、Session continuation/cold resume、replay quarantine、静态 Installation、`light_ready`/`installed_unverified`、执行期验证或 nullable Runtime version | [Runtime 平台安全不变量](architecture/foundational-invariants.md#runtime-platform-security)、[Runtime 进程与校验不变量](architecture/foundational-invariants.md#runtime-process-verification)、[Runtime 恢复与关闭不变量](architecture/foundational-invariants.md#runtime-recovery-shutdown)、[Managed Runtime Process v1](contracts/managed-runtime-process-v1.md)、[ACP Client Terminal v2](contracts/acp-client-terminal-v2.md)、[Runtime Platform Admission v1](contracts/runtime-platform-admission-v1.md)、[Runtime Launch and Verification v28](contracts/runtime-launch-and-verification-v28.md)、[Camp Published Attachment View](architecture/camp-published-attachment-view.md)及[Runtime Catalog Boundaries](architecture/runtime-catalog-boundaries.md) |
| 修改队员 Runtime 权限默认、ACP permission response、模型 Picker、Kiro trust-all、TRAE/Cursor/Kimi permission mode、Kimi provider 配置或 permission schema drift | [Runtime 平台安全不变量](architecture/foundational-invariants.md#runtime-platform-security)、[Runtime Launch and Verification v28](contracts/runtime-launch-and-verification-v28.md)、[Runtime Catalog Boundaries](architecture/runtime-catalog-boundaries.md)及[队员工作区 brief](../apps/desktop/.impeccable/surfaces/member-workspace.md) |
| 修改 Camp 主键、`CampId/campId/camp_id`、Camp 文件路径、本机 Camp locator 或 Camp/Native Session identity seam | [Camp Identity v1](contracts/camp-identity-v1.md)、[Camp Identity Architecture](architecture/camp-identity.md)、[Camp 生命周期不变量](architecture/foundational-invariants.md#camp-lifecycle)及当前 Context/History/Built-in 合同 |
| 修改 Camp 动态添加/移除队员、至少一位成员、Default Lead 替换、membership generation/version、离队 cutover/reconciliation、外部 roster 同步或成员管理 UI | [Camp Membership v1](contracts/camp-membership-v1.md)、[动态 Camp 队员关系](architecture/dynamic-camp-membership.md)、[成员生命周期不变量](architecture/foundational-invariants.md#member-lifecycle)、[协作与执行准入不变量](architecture/foundational-invariants.md#collaboration-admission)、[Camp Open Projection v8](contracts/camp-open-projection-v8.md)及[Camp 会话工作区](ui/components/conversation-workspace.md) |
| 新增或修改 Runtime Activity 映射规则 | [Runtime Activity Mapping 维护指南](runtime-activity/README.md)及[Registry](runtime-activity/registry.md) |
| 修改内置 Agent CLI、IPC、Envelope、receipt、Projection、Gather、队员创建、纯附件 Agent Send 或幂等合同 | [Built-in Tool Transport v20 合同](contracts/builtin-tool-transport-v20.md)、[Built-in 运输不变量](architecture/foundational-invariants.md#skills-builtin-transport)、[Gather v4](contracts/gather-v4.md)、[Skill Library 与投影不变量](architecture/foundational-invariants.md#skills-library-projection)、[Camp Message Send v13](contracts/camp-message-send-v13.md)及[Current User Attention v4](contracts/current-user-attention-v4.md) |
| 修改普通用户 `rovai app`、User Automation IPC/credential、Camp/Run 终端自动化、Diagnostic Trial、双 cursor 或诊断 bundle | [User Automation v1](contracts/user-automation-v1.md)、[User Automation Architecture](architecture/user-automation.md)、[User Automation 不变量](architecture/foundational-invariants.md#user-automation-trial)及[v1.21 交付版本](versions/v1.21/README.md) |
| 修改 `camp.search`、`camp.read`、`history.search`、Agent/Human Principal message projection、跨 Camp Manifest/live authorization、Public A2A 历史可见性、Camp message publication fence 或 Agent read 附件输出 | [Camp History Retrieval v4](contracts/camp-history-v4.md)、[公共上下文不变量](architecture/foundational-invariants.md#context-public-history)、[History 与寻址不变量](architecture/foundational-invariants.md#collaboration-history-addressing)、[Message Delivery 不变量](architecture/foundational-invariants.md#collaboration-delivery)、[Built-in Tool Runtime](architecture/builtin-tool-runtime.md)及[Public A2A Message Delivery](architecture/public-a2a-message-delivery.md) |
| 修改 Memory 在线捕获、complete exact-Scope View、Agent mutation、copyable target、Hearth Review、active body quota、clean break、候选清除、Forget 闭包或审核并发 | [Online Memory Capture 架构](architecture/online-memory-capture.md)、[Memory Capture v3](contracts/memory-capture-v3.md)、[Memory 写入与存储不变量](architecture/foundational-invariants.md#memory-write-store)及[Memory 读取与投影不变量](architecture/foundational-invariants.md#memory-read-projection) |
| 修改通知来源、Episode 聚合、未读/清除、会话可见确认、增量、浮层设置或类型化导航 | [Notification Episode v4](contracts/notification-episode-v4.md)、[Current User Attention v4](contracts/current-user-attention-v4.md)、[通知事实与投影](architecture/foundational-invariants.md#core-notifications)及[Notification Episode 架构](architecture/notification-episodes.md) |
| 修改 Camp 文件/目录附件、Managed v2、Draft/Published 授权、Composer/Agent ingress、Timeline 系统打开、Runtime availability、legacy publication recovery、Runtime root 或模型附件路径 | [Camp Attachment v6](contracts/camp-attachment-v6.md)、[Camp Published Attachment View v4（legacy）](contracts/camp-published-attachment-view-v4.md)、[Camp Attachments 架构](architecture/camp-published-attachment-view.md)、[ContextManifest Evidence v21](contracts/context-manifest-evidence-v21.md)、[Camp History Retrieval v4](contracts/camp-history-v4.md)、[Camp Identity v1](contracts/camp-identity-v1.md)、[Camp 资源不变量](architecture/foundational-invariants.md#camp-resources)、[Camp 会话工作区](ui/components/conversation-workspace.md)及[会话区拖放 UI](ui/components/conversation-drop-zone.md) |
| 修改用户消息回复、接收者延续、Composer 路由优先级、纯附件发送、失效换人或 Draft-only user send | [Composer Draft 不变量](architecture/foundational-invariants.md#camp-composer)、[Camp Composer Draft v5](contracts/camp-composer-draft-v5.md)、[Camp Composer Draft 架构](architecture/camp-composer-draft.md)及[Camp 会话工作区](ui/components/conversation-workspace.md) |
| 修改 Camp 打开、冷启动恢复壳层、投影/存在性检查、会话历史分页、运行中 Evidence、membership reconciliation、AgentRun 文件变化、high-water/cache 或首屏性能日志 | [Camp Open Projection v8](contracts/camp-open-projection-v8.md)、[Camp Open Read Path](architecture/camp-open-read-path.md)、[Core 受管内容不变量](architecture/foundational-invariants.md#core-managed-content)、[协作与执行准入不变量](architecture/foundational-invariants.md#collaboration-admission)及[Camp 会话工作区](ui/components/conversation-workspace.md) |
| 修改 Desktop Navigation Snapshot、侧栏 Run marker、Core 失效通知、全局刷新协调、失败退避、前后台刷新或安全轮询 | [Desktop Navigation Refresh](architecture/desktop-navigation-refresh.md)、[Core Snapshot 不变量](architecture/foundational-invariants.md#core-read-side)、[产品与导航不变量](architecture/foundational-invariants.md#product-navigation)及[App Shell 与统一侧栏](ui/components/app-shell-navigation.md) |
| 修改 Desktop 当前 Camp `Command/Ctrl+F`、完整会话正文 exact count、命中遍历、地图快捷返回或旧消息 anchored 定位 | [Camp Conversation Find v1](contracts/camp-conversation-find-v1.md)、[Camp Open Read Path](architecture/camp-open-read-path.md)、[Camp 会话工作区](ui/components/conversation-workspace.md)、[Core 受管内容不变量](architecture/foundational-invariants.md#core-managed-content)及[History 与寻址不变量](architecture/foundational-invariants.md#collaboration-history-addressing) |
| 修改 Camp 永久删除、强制删除、quiescence blocker、删除后的 Runtime 收敛或受管资源清理 | [Camp Permanent Deletion v2](contracts/camp-permanent-deletion-v2.md)、[Camp Published Attachment View](architecture/camp-published-attachment-view.md)、[Camp 资源不变量](architecture/foundational-invariants.md#camp-resources)、[协作与执行准入不变量](architecture/foundational-invariants.md#collaboration-admission)、[Runtime 恢复与关闭不变量](architecture/foundational-invariants.md#runtime-recovery-shutdown)及[Runtime 进程与校验不变量](architecture/foundational-invariants.md#runtime-process-verification) |
| 修改首次安装判断、新手训练页、无 Runtime 延后配置、断点恢复、首次队员/Runtime provisioning、`初次集结` 或 starter Draft 行为 | [First-run Onboarding v2](contracts/first-run-onboarding-v2.md)、[First-run Onboarding 架构](architecture/first-run-onboarding.md)、[首次训练 UI](ui/components/first-run-onboarding.md)、[Camp 生命周期不变量](architecture/foundational-invariants.md#camp-lifecycle)、[Runtime Catalog 与 Installation 不变量](architecture/foundational-invariants.md#runtime-catalog-installation)及[Camp Composer Draft v2](contracts/camp-composer-draft-v2.md) |
| 编写或更新仓库 Skill 的触发 `description`、正文分层、references 或 `agents/openai.yaml` | [Skill 编写与 description 路由规范](development/skill-authoring.md)；若同时修改投影、bootstrap 或执行完整性，再按下一行读取架构约束 |
| 修改 bundled Skill 冷启动 bootstrap、Revision 快速验证或 AgentRun 执行前完整性门禁 | [Skill Library 与投影不变量](architecture/foundational-invariants.md#skills-library-projection)、[Skill Projection Reconciliation](architecture/skill-projection-reconciliation.md)及[Runtime 进程与校验不变量](architecture/foundational-invariants.md#runtime-process-verification) |
| 修改 Composer Skill Picker 的结构化身份、发送时资格、`CURRENT_INPUT.skills` 文件链接或对应 Manifest Evidence | 先按[核心模型上下文变更治理](development/model-context-change-governance.md)确认 revision，再读[ContextManifest 与 Run Facts 不变量](architecture/foundational-invariants.md#context-manifest-run-facts)、[Current Input Skill Links v1](contracts/current-input-skill-links-v1.md)、[ContextManifest Evidence v21](contracts/context-manifest-evidence-v21.md)、[Structured Current Input Skill Links 架构](architecture/structured-current-input-skill-links.md)及[Camp 会话工作区](ui/components/conversation-workspace.md) |
| 修改 CLI 教学分层、Agent inline 寻址、协作 Skill 消息拓扑、`cli-operations` 触发/reference，或 official Skill 精确集合、固定 GitHub 来源与管理策略 | [Message Delivery 不变量](architecture/foundational-invariants.md#collaboration-delivery)、[Built-in 运输不变量](architecture/foundational-invariants.md#skills-builtin-transport)、[History 与寻址不变量](architecture/foundational-invariants.md#collaboration-history-addressing)、[Skill Library 与投影不变量](architecture/foundational-invariants.md#skills-library-projection)及[Built-in Tool Runtime 架构](architecture/builtin-tool-runtime.md) |
| 修改 Task 状态、字段、可见性、权限、列表、CampMember 收口、self-active awareness 或 linked execution 准入 | [Durable Task v3](contracts/durable-task-v3.md)、[ContextManifest 与 Run Facts 不变量](architecture/foundational-invariants.md#context-manifest-run-facts)及[Durable Task 不变量](architecture/foundational-invariants.md#collaboration-task) |
| 修改 Gather Barrier、return capture、Completion Delivery/Run、legacy Attachment projection gate、membership lifetime、AgentRun 公共消息/Task 选择、正文/历史预算、引用链或投递 Profile | [持久 Gather Barrier](architecture/durable-gather-barrier.md)、[Gather v4](contracts/gather-v4.md)、[Gather 不变量](architecture/foundational-invariants.md#collaboration-gather)、[ContextManifest 与 Run Facts 不变量](architecture/foundational-invariants.md#context-manifest-run-facts)、[Context Delivery Profile v4](contracts/context-delivery-profile-v4.md)及[Message Delivery v8](contracts/message-delivery-v8.md) |
| 修改 Native Session Bootstrap、AgentRun Dynamic Context、模型可见字段/JSON、历史截断/遗漏、ContextManifest Evidence、Runtime Input Delivery Evidence 或 Formatter/Manifest/Profile 版本边界 | 先按[核心模型上下文变更治理](development/model-context-change-governance.md)建立独立说明并取得二次确认，再读[Context 当前规范](architecture/foundational-invariants.md#context-session-bootstrap)、当前 ContextManifest/Run Facts 合同及当前版本实施计划 |
| 修改 AgentRun 局部停止入口、直接提交、权威停止状态，实际模型观测、命令展示、Tool 聚合、运行中 Runtime diagnostic、首值冻结、默认策略回退、执行台位置偏好、进入恢复或模型展示 | [Runtime Catalog 与 Installation 不变量](architecture/foundational-invariants.md#runtime-catalog-installation)、[产品/执行表面不变量](architecture/foundational-invariants.md#product-execution-surface)、[Runtime Catalog Boundaries](architecture/runtime-catalog-boundaries.md)、[Run Process Detail Surface v23](contracts/run-process-detail-surface-v23.md)、[Camp Open Projection v8](contracts/camp-open-projection-v8.md)及[Camp 会话工作区](ui/components/conversation-workspace.md) |
| 修改 Runtime-reported 文件操作、Command Diff、AgentRun 文件变化卡片、归约/读取授权或文件变化呈现 | [Runtime File Change Observation v1](contracts/runtime-file-change-observation-v1.md)、[Runtime File Change Observation 架构](architecture/runtime-file-change-observation.md)、[Evidence/Activity 不变量](architecture/foundational-invariants.md#evidence-canonical-activity)、[Camp 会话工作区](ui/components/conversation-workspace.md)及[v1.29 实施计划](versions/v1.29/implementation-plan.md) |
| 修改 `MEMBER_IDENTITY`、`COLLABORATION_STATE`、peer 选择、Lead 引用、projection digest/inclusion 或 accepted ACK 水位 | [成员投影不变量](architecture/foundational-invariants.md#member-projection)、[Collaboration State v2](contracts/collaboration-state-v2.md)及[Built-in Tool Runtime 架构](architecture/builtin-tool-runtime.md) |
| 修改诊断自检、单项修复、三态分类、Recovery 或 v5 导出/脱敏 | [Runtime 平台安全不变量](architecture/foundational-invariants.md#runtime-platform-security)、[Diagnostics Center v1](contracts/diagnostics-center-v1.md)及[诊断中心架构](architecture/diagnostics-center.md) |
| 修改 Benchmark 协议、Judge View、Tool-use/协作测量、Team/Solo paired experiment、Profile、比较资格、失败分类或 Project Review 投影 | [Benchmark 与 Judge 不变量](architecture/foundational-invariants.md#qualification-benchmark)、[Benchmark Protocol v3](contracts/benchmark-protocol-v3.md)、[Semantic Judge Views v1](contracts/semantic-judge-views-v1.md)、[Tool Interaction Measurement v2](contracts/tool-interaction-measurement-v2.md)、[Paired Collaboration Experiment v1](contracts/paired-collaboration-experiment-v1.md)及[Benchmark Protocol 架构](architecture/benchmark-protocol.md) |
| 理解内置 CLI、Core Router、Runtime Fleet、Bootstrap 与外部 MCP 的长期结构 | [Built-in Tool Runtime 架构](architecture/builtin-tool-runtime.md) |
| 修改 Native Session compaction detector、Observer Lease、Runtime 补发 policy、Bootstrap Delivery Gate 或 redelivery payload | [Native Session Bootstrap Redelivery 架构](architecture/native-session-bootstrap-redelivery.md)、[Session 与 Bootstrap 不变量](architecture/foundational-invariants.md#context-session-bootstrap)及[ContextManifest 与 Run Facts 不变量](architecture/foundational-invariants.md#context-manifest-run-facts) |
| 修改 Core 重启、accepted Runtime input、Session/Turn 恢复、`recovery_blocked`、Stop/预算收敛或旧 Turn reattach | [AgentRun Recovery 架构](architecture/agent-run-recovery.md)、[Runtime 恢复与关闭不变量](architecture/foundational-invariants.md#runtime-recovery-shutdown)及[Accepted Input Recovery v3](contracts/accepted-input-recovery-v3.md) |
| 修改主动退出/重启/更新、Core drain、launch/terminal admission、Runtime planned stop、durable shutdown fence、shutdown deadline 或 Desktop child-exit wait | [Planned Shutdown 架构](architecture/planned-shutdown.md)、[Runtime 恢复与关闭不变量](architecture/foundational-invariants.md#runtime-recovery-shutdown)及[Planned Shutdown v3](contracts/planned-shutdown-v3.md) |
| 理解历史设计与演进原因 | [版本索引](versions/README.md)及对应历史版本；历史内容不能作为当前约束 |
| 修改 Renderer UI/UX | 先读根目录[全局设计系统](../DESIGN.md)和[UI 规范索引](ui/README.md)，再按目标读取对应主题、复杂组件、`apps/desktop/.impeccable/surfaces/` brief 与 QA |
| 修改 Windows x64 Desktop、Named Pipe、Job、DACL、data root、Runtime Files Root、Skill copy、NSIS、签名或 Windows 交互差异 | [Windows Desktop Platform](architecture/windows-desktop-platform.md)、[Windows Private Storage v2](contracts/windows-private-storage-v2.md)、[Runtime 平台安全不变量](architecture/foundational-invariants.md#runtime-platform-security)、[v1.05](versions/v1.05/README.md)、[Windows Interaction Delta](ui/windows-interaction-delta.md)及相应当前 Contract |
| 本地运行、测试、Smoke Test 或 macOS 构建 | [开发者指南](development/README.md) |
| 创建、复用、交接或清理开发用 Git worktree | [Git Worktree 生命周期与清理](development/worktrees.md) |

读取相关文档后，仍必须检查目标代码、Migration 和测试；文档不能替代实施事实。

## 目录职责

### `docs/decisions/`

保存版本决定的治理、当前理由导航、数字 ADR clean-break 证据与旧 ID 映射。Version Decisions 回答“为什么在该版本作出这个改变、拒绝了什么、主要后果是什么”。

- Decisions 不是当前规范或实现真源；当前规范由 Architecture、Contracts、Context、UI 和 Development 直接拥有。
- 当前版本使用版本内决定 ID；禁止新增数字 ADR 或全局替代图。
- 历史版本决定冻结，只允许明确勘误、链接或元数据修复。
- `CURRENT.md` 是人工导航，Manifest/Coverage/Legacy Map 只证明本次迁移和追溯，不创造产品约束。

完整规则见[版本决策治理](decisions/README.md)。`docs/adr/README.md` 仅为旧目录退役说明。

### `docs/versions/`

保存各版本的目标、版本内设计过程、实施计划、验收记录和发布范围。

- `lifecycle: current` 的版本可以随实施事实更新。
- `lifecycle: historical` 的版本是历史快照，不约束当前实现。
- 重要取舍记录在版本 `decisions.md`；跨版本当前语义必须同时写入真正拥有它的当前权威文档。

完整规则与当前版本指针见 [版本索引](versions/README.md)。

### 其他文档

`runtime-compatibility.md` 保存 Agent Runtime 实测兼容性证据；`docs/research/` 保存实现前的来源简报、
可复核 Probe 记录与脱敏 Capability Snapshot，不拥有产品准入或当前版本状态；`docs/runtime-activity/` 长期维护
跨 Runtime 活动映射目录和变更门禁；`docs/ui/` 和
`docs/development/` 分别拥有 UI 规范与本地开发流程。它们都不是领域架构或版本状态
真源。本地开发统一从 [开发者指南](development/README.md) 进入。

`docs/contracts/` 保存字段级、可测试的长期接口合同；`docs/architecture/` 保存跨版本系统结构、
组件职责和权威边界。版本文档只引用它们，不复制完整协议或长期架构。

`docs/postmortems/` 保存中文无责事故复盘、证据与纠正措施跟踪。复盘解释故障如何发生、如何
降低复发风险；它们不能替代当前架构与合同、当前版本范围或实现证据。

## 权威性与冲突处理

不存在一个覆盖所有问题的单一优先级，必须先判断问题类型：

- “为什么选择某个长期边界”：从 Decisions CURRENT 进入相关版本决定。
- “当前接受设计如何组合”：读取 Architecture；稳定不变量必须由 Architecture、当前 Contract 或其他明确当前权威直接拥有。
- “精确字段、wire shape、错误和幂等语义”：读取当前 Contract。
- “当前版本要交付什么、进展如何”：读取当前版本文档。
- “仓库现在实际实现了什么”：检查代码、Migration、测试和可复现验收证据。

如果这些来源不一致，必须明确报告“文档—实现漂移”，指出冲突位置和缺失证据；禁止静默
选择一种说法，也禁止用决定或合同的 `accepted` 推断“已实现”。Architecture 与 Contract 不得静默互相推翻；决定理由不能覆盖当前规范。

## AI 使用规则

1. 先读取本文，再按任务选择最小必要文档集。
2. 从 Architecture/Contracts 读取当前规范；需要理由时从 Decisions CURRENT 选择相关版本决定，不默认加载全部历史。
3. 只把版本索引标记的当前版本用于当前范围和状态判断。
4. 历史版本可用于解释背景，不得覆盖当前权威或当前代码事实。
5. 引用决定时使用版本内 ID或迁移保留的旧 ADR ID；引用实施状态时同时给出代码、Migration、测试或验收依据。
6. 新版本、新决定或任何主题文档都使用同一动态门禁；不得为某个 Skill、功能名或版本新增通配例外。
