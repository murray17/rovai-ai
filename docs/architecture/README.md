---
document_type: architecture-index
authority: long-lived-architecture-routing
last_updated: 2026-09-24
---

# 长期系统架构

本目录保存跨版本长期存在的组件结构、职责和权威边界。字段级 wire shape 归
[`docs/contracts/`](../contracts/README.md)，决策理由归[版本决策](../decisions/README.md)，实施状态归当前 Version 文档。[当前基础架构不变量](foundational-invariants.md)收敛跨多个主题的长期边界，专题 Architecture 在此基础上说明组件组合。

<!-- architecture-index:begin -->
| 架构 | 内容 |
| --- | --- |
| [Missions](missions.md) | 内部 ID 贯通 Agent、UI 展示编号、全局只读/当前写入、独立状态、Core-owned 启动/执行投影、结构化附件、持久工作区与累计 Git Diff |
| [统一 Rust Host](unified-rust-host.md) | Desktop 与三平台 Server 共用的应用运行层、Web、身份、source refs 和平台验证边界 |
| [Rovai AI 多 Agent 协作架构](system-views.md) | 系统全景、Peer 与轻量 Lead、身份与 Runtime、Conversation/AgentRun、A2A、协作组织与任务责任、Rovai CLI Toolkit、动态上下文、记忆治理与成长、技术栈与单次 AgentRun 生命周期的可视化介绍 |
| [Runtime 图片](runtime-images.md) | 结构化观察与保留、Adapter 确认的原生生图公屏来源、混合文件生命周期、Camp-scoped 按需读取、消息内来源合并及作者感知 Gallery variant；与显式渠道文件交付分离 |
| [双轨执行评测](execution-evaluation.md) | 真实任务 Gate／每周回归、每日只读 Trace、规则曲线与分析 Agent 的权限边界 |
| [Benchmark Protocol](benchmark-protocol.md) | Core 外的 Adapter/Profile/Execution/Evaluation/Reporting、Process/Outcome/Tool-Use Judge、Tool Interaction、typed Resource 与 paired counterfactual 模块 |
| [Diagnostics Center](diagnostics-center.md) | Core 严格只读诊断组装、Skill/MCP 审计、Runtime 缓存事实、Renderer 单项修复复检、Electron v5 导出与 Startup Recovery 边界 |
| [Desktop App Updates](desktop-app-updates.md) | Main 单一更新快照、完成后递归调度、检查来源合并、提醒代次、显式下载/安装、Renderer 深链与 updater-first 受控退出边界 |
| [Desktop Navigation Refresh](desktop-navigation-refresh.md) | Core 提交后失效提示、Renderer 全局 generation drain、Main-owned Sidecar Project 首次冻结/成员同步、失败退避、可见性与低频安全刷新边界 |
| [Availability-first Runtime](availability-first-runtime.md) | Desktop bootstrap/full-core 分层、data-dir lease、SQLite 准入票据、copy migration、Supervisor generation/revision 与请求 fencing |
| [AgentRun Recovery](agent-run-recovery.md) | AgentRun、Input Delivery、Native Turn 与 execution isolation 分离，未接受运输恢复、accepted/unknown 自动失败、cleanup 门禁与精确 Run Stop |
| [Built-in Tool Runtime](builtin-tool-runtime.md) | 无 Gather 的当前 operation catalog、Mission 全局 read seam、完整结果运输、Core Router、Runtime Fleet、Dynamic Context、ContextManifest/ACK 与外部 MCP 的关系 |
| [Single Chat](single-chat.md) | 复用 Conversation/CampTurn/AgentRun 的私有会话模式、专用 Context、封闭 Built-in policy、公共 Source Refs、Conversation-local FIFO、exact-ID 结束、串行面板刷新与迟到隔离 |
| [Scheduled Automation](scheduled-automation.md) | Desktop/Core 本机计划、started/skipped(overlap) admission、普通 Delivery claim、occurrence 收口与独立渠道通知 |
| [Camp Identity](camp-identity.md) | 唯一 `rvcamp_` CampId 的生成、持久化、Context/Tool/path 流转、clean break 与 Native Session identity seam |
| [动态 Camp 队员关系](dynamic-camp-membership.md) | 添加/移除、membership generation/lifetime、原子 cutover、持久 reconciliation、外部来源绑定与 Renderer 权威预览边界 |
| [飞书渠道](feishu-channel.md) | Developer Session/队员 Provisioner、Owner-only 入站、Quick Chat/PendingCampBinding、ExternalPrincipal、多 Bot 聚合、统一 Camp admission、群 roster、响应式状态执行卡、LAN 只读执行台、永久输出/附件及 Main secret/Core Outbox 边界 |
| [Lark 渠道](lark-channel.md) | 与飞书并列的独立 provider：参数化飞书 Host 与 Core 领域逻辑、结构等价的 `lark_*` 表族、按请求名推导 Host actor、可信域与 SDK 域分离、模型上下文不变及真实租户验收 gate |
| [钉钉渠道](dingtalk-channel.md) | Renderer 可管理 Provider、Main 接口扫码/SSO/Web Session/Console API/Stream、独立队员应用机器人、Owner-only 私聊/群聊、多 App durable inbound aggregate、provider-neutral admission、群 roster、Quick Chat、三入口状态卡、更新/撤回双身份、排队卡与 Robot recall、共享 LAN 执行台、永久 Markdown 摘要、安全诊断、能力 gate、共享 credential/Session 持久化与 Main secret/Core Outbox 边界 |
| [持久 Gather Barrier（已退役）](durable-gather-barrier.md) | 冻结历史 Gather 的只读解释；当前多人协作使用普通多目标消息，不存在 Barrier/completion |
| [Runtime Catalog Boundaries](runtime-catalog-boundaries.md) | 可执行 Product Runtime Catalog、机器 Availability 与 Renderer-only Settings Preview 的权威分层、准入和晋升边界 |
| [Runtime Monitoring](runtime-monitoring.md) | 五表 clean-break Usage metering、内存 parser/buffer、短 Flush、稀疏 Rollup、单 Snapshot 与 Renderer 边界 |
| [Native Session Bootstrap Redelivery](native-session-bootstrap-redelivery.md) | compaction detector、Session Observer、Bootstrap/Member Identity 重投递、Redelivery v2、Dynamic Context 与 accepted-input 水位 |
| [Notification Episode](notification-episodes.md) | 消息关联的整轮完成、Mission/Task 状态来源、Occurrence/Disposition/Episode/Journal 原子投影与精确确认 |
| [Online Memory Capture](online-memory-capture.md) | best-effort Skill discovery、complete exact-Scope View、copyable target、active body aggregate quota、durable rejection、Agent Memory Facade、原子 Supersession、隔离 Hearth Review、formal publication、clean break 与 Forget 闭包 |
| [Planned Shutdown](planned-shutdown.md) | Core execution/terminal 双准入、durable shutdown cycle、退出时 AgentRun 全量取消、Scheduler/maintenance 共同监督、分层 deadline、route reap 与 Desktop-local Composer/child-exit 边界 |
| [Public Camp Message、Delivery 与 AgentRun](public-a2a-message-delivery.md) | 公共消息、per-target waiting Delivery、claim 时创建多输入 Run、实时可见性、精确 Stop、隔离与 Channel/Automation 复用 |
| [Camp Activation Lifecycle](camp-activation-lifecycle.md) | 一键 Pending 瞬态表面、Renderer-local 首条输入、首消息原子激活与空 Pending 清理的组件权威 |
| [Public Camp Composer](camp-composer-draft.md) | Desktop-local Active Camp snapshot、一次发送快照、失败保留、continuation、附件 authority 和无 Core Draft/Pending 的当前边界 |
| [Camp Open Read Path](camp-open-read-path.md) | Desktop 两阶段冷启动壳层、enter/reconcile、不读 event_log 的业务 open projection、渐进消息、当前会话精确查找/anchored 定位、Run detail、high-water/cache 与 meaningful-paint 后台维护边界 |
| [Camp Attachments：原路径引用、默认输出与旧记录兼容](camp-published-attachment-view.md) | 用户与 Agent Source Refs、默认输出位置、实际路径呈现、Camp 自有目录删除及历史 Managed/Authority/View 兼容边界 |
| [Camp 永久删除](camp-deletion.md) | 全 Runtime 状态异步受理、Camp Deletion Intent、准入 fence、Camp→cleanup journal 阶段交接、崩溃恢复与最小外部状态 |
| [First-run Onboarding](first-run-onboarding.md) | Full Core authority-origin 首次安装 admission、schema 2 三页状态、无 Runtime 延后完成、幂等 provisioning 与 Desktop-local Active Camp starter 第四页边界 |
| [File Preview](file-preview.md) | 显式 Markdown 消息资源入口、来源上下文解析、Main canonical 路径投影、窗口内 Camp Tab shell、项目内子文件独立恢复来源、无副作用恢复、binding generation、具体文件能力/重开、分页、Root Grant、watcher、HTML 协议与资源生命周期 |
| [当前基础架构不变量](foundational-invariants.md) | Core、Camp、身份、协作、Runtime、Context、Memory、Skill、Evidence、Qualification 与 Renderer 的跨主题当前规范内核 |
| [Skills 来源、配置与模型投递](skills.md) | 当前平台/工具箱与 Harness 原生来源、队员配置、消息来源身份、Run 冻结、旧投影安全清理和历史恢复 |
| [Skill Projection Reconciliation（历史）](skill-projection-reconciliation.md) | 旧 Library desired state、项目投递、SkillExposureSnapshot 与旧 Run 审计/清理 |
| [Structured Run Input Skill Links（历史）](structured-current-input-skill-links.md) | 旧 Library/Exposure 的 Picker SkillMention、claim-time snapshot 与消息链接 |
| [User Automation](user-automation.md) | 一个 `rovai` binary 下隔离的 Agent/User transport、Main-owned 本机 IPC、封闭 dispatch、Camp navigation、CLI-owned Diagnostic Trial、双 cursor 与安全导出边界 |
| [Windows Desktop Platform](windows-desktop-platform.md) | Windows x64 host envelope、平台 seam、原子 Job 启动、Transport v14、私有 local storage、hidden title strip + top-level menu projection + native controls、NSIS 与真实 Windows 验收组合 |
| [Runtime File Change Observation](runtime-file-change-observation.md) | Runtime 文件操作、Command Diff、每 AgentRun/epoch 的版本化文件变化归约、exact managed-output exclusion、Managed Blob、迟到事实重算、恢复与授权读取边界；不扫描工作区或依赖 Git |
| [消息选文引用](message-quotes.md) | 正文选择、owner 隔离与 Context 投影 |
<!-- architecture-index:end -->
