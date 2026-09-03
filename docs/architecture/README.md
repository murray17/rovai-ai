---
document_type: architecture-index
authority: long-lived-architecture-routing
last_updated: 2026-09-03
---

# 长期系统架构

本目录保存跨版本长期存在的组件结构、职责和权威边界。字段级 wire shape 归
[`docs/contracts/`](../contracts/README.md)，决策理由归[版本决策](../decisions/README.md)，实施状态归当前 Version 文档。[当前基础架构不变量](foundational-invariants.md)收敛跨多个主题的长期边界，专题 Architecture 在此基础上说明组件组合。

<!-- architecture-index:begin -->
| 架构 | 内容 |
| --- | --- |
| [Runtime 图片](runtime-images.md) | 结构化观察、混合文件生命周期、现有 Blob、Camp-scoped 按需读取及共享图片 UI；与显式渠道文件交付分离 |
| [Benchmark Protocol](benchmark-protocol.md) | Core 外的 Adapter/Profile/Execution/Evaluation/Reporting、Process/Outcome/Tool-Use Judge、Tool Interaction、typed Resource 与 paired counterfactual 模块 |
| [Diagnostics Center](diagnostics-center.md) | Core 严格只读诊断组装、Skill/MCP 审计、Runtime 缓存事实、Renderer 单项修复复检、Electron v5 导出与 Startup Recovery 边界 |
| [Desktop App Updates](desktop-app-updates.md) | Main 单一更新快照、完成后递归调度、检查来源合并、提醒代次、显式下载/安装、Renderer 深链与 updater-first 受控退出边界 |
| [Desktop Navigation Refresh](desktop-navigation-refresh.md) | Core 提交后失效提示、Renderer 全局 generation drain、失败退避、可见性与低频安全刷新边界 |
| [Availability-first Runtime](availability-first-runtime.md) | Desktop bootstrap/full-core 分层、data-dir lease、SQLite 准入票据、copy migration、Supervisor generation/revision 与请求 fencing |
| [AgentRun Recovery](agent-run-recovery.md) | AgentRun、Native Session、Runtime Input Delivery 与 Native Turn 分离，accepted-input blocker、Scheduler fence、用户/预算安全收敛与未来 reconcile capability |
| [Built-in Tool Runtime](builtin-tool-runtime.md) | 十五项固定 Agent CLI operation、`camp.read` 安全 Timeline 默认、single-Camp History target、safe Agent output projection、Core Router、Runtime Fleet、精确 help、Dynamic Context、ContextManifest/ACK 与外部 MCP 的关系 |
| [Camp Identity](camp-identity.md) | 唯一 `rvcamp_` CampId 的生成、持久化、Context/Tool/path 流转、clean break 与 Native Session identity seam |
| [动态 Camp 队员关系](dynamic-camp-membership.md) | 添加/移除、membership generation/lifetime、原子 cutover、持久 reconciliation、外部来源绑定与 Renderer 权威预览边界 |
| [飞书渠道](feishu-channel.md) | Developer Session/队员 Provisioner、Owner-only 入站、Quick Chat/PendingCampBinding、ExternalPrincipal、多 Bot 聚合、统一 Camp admission、群 roster、响应式状态执行卡、LAN 只读执行台、永久输出/附件及 Main secret/Core Outbox 边界 |
| [钉钉渠道](dingtalk-channel.md) | Renderer 可管理 Provider、Main Web Session/Console API/Stream、独立队员应用机器人、Owner-only 私聊/群聊、多 App durable inbound aggregate、provider-neutral admission、群 roster、Quick Chat、三入口状态卡、更新/撤回双身份、排队卡与 Robot recall、共享 LAN 执行台、永久 Markdown 摘要、安全诊断、能力 gate、共享 credential/Session 持久化与 Main secret/Core Outbox 边界 |
| [持久 Gather Barrier](durable-gather-barrier.md) | 一条公共请求、N 个 Item/forward Delivery、持久 return capture、原子 Barrier、Completion FIFO 与 mandatory typed Current Input 的组件权威 |
| [Runtime Catalog Boundaries](runtime-catalog-boundaries.md) | 可执行 Product Runtime Catalog、机器 Availability 与 Renderer-only Settings Preview 的权威分层、准入和晋升边界 |
| [Runtime Monitoring](runtime-monitoring.md) | 五表 clean-break Usage metering、内存 parser/buffer、短 Flush、稀疏 Rollup、单 Snapshot 与 Renderer 边界 |
| [Native Session Bootstrap Redelivery](native-session-bootstrap-redelivery.md) | compaction detector、Session Observer、Bootstrap/Member Identity 重投递、Redelivery v2、Dynamic Context 与 accepted-input 水位 |
| [Notification Episode](notification-episodes.md) | Occurrence/Disposition/Episode/Change Journal 原子投影、可见来源精确确认、read hydration、并发边界与保留 |
| [Online Memory Capture](online-memory-capture.md) | best-effort Skill discovery、complete exact-Scope View、copyable target、active body aggregate quota、durable rejection、Agent Memory Facade、原子 Supersession、隔离 Hearth Review、formal publication、clean break 与 Forget 闭包 |
| [Planned Shutdown](planned-shutdown.md) | Core execution/terminal 双准入、durable shutdown cycle、退出时 AgentRun 全量取消、product fence 启动补偿、分层 deadline、route reap 与 Desktop child-exit 边界 |
| [Public A2A Message 与 Message Delivery](public-a2a-message-delivery.md) | 公共 Structured Message、统一历史 publication seam、canonical/line-leading display-name addressing、正交 Current User Attention、forward/caller-return Delivery、原子通知、Context gate 与 UI projection 边界 |
| [Camp Activation Lifecycle](camp-activation-lifecycle.md) | 一键 Pending、Composer Draft、Navigation、Restorable Location、首消息原子激活与启动清理的组件权威 |
| [Camp Composer Draft](camp-composer-draft.md) | Structured Content、附件、持久 reply/continuation、显式接收者修复、发送物化、exact-revision user send 与 timeline projection 的组件权威 |
| [Camp Open Read Path](camp-open-read-path.md) | Desktop 两阶段冷启动壳层、enter/reconcile、不读 event_log 的业务 open projection、渐进消息、当前会话精确查找/anchored 定位、Run detail、high-water/cache 与 meaningful-paint 后台维护边界 |
| [Camp Attachments 与 Legacy Published View](camp-published-attachment-view.md) | Managed v2 单副本 ingest、无 Run 等待的普通 Delivery、DB-only Context 路径，以及 legacy Authority/View 只读兼容与清理边界 |
| [First-run Onboarding](first-run-onboarding.md) | Full Core authority-origin 首次安装 admission、schema 2 三页状态、无 Runtime 延后完成、幂等 provisioning 与 Draft-only 第四页边界 |
| [File Preview](file-preview.md) | 消息引用存在性准入、共享资源视觉类型、Core 领域来源、Main 既有 classifier、具体文件能力/窗口句柄/重开、分页读取、显式目录 Root Grant、root watcher、HTML 文档目录协议与资源生命周期 |
| [当前基础架构不变量](foundational-invariants.md) | Core、Camp、身份、协作、Runtime、Context、Memory、Skill、Evidence、Qualification 与 Renderer 的跨主题当前规范内核 |
| [Skill Projection Reconciliation](skill-projection-reconciliation.md) | Skill Library desired state、bundled bootstrap 快速路径、root access ledger、事件驱动 dirty、当前 Run 完整校验 preflight、start-time SkillExposureSnapshot 与无历史目录扫描边界 |
| [Structured Current Input Skill Links](structured-current-input-skill-links.md) | Picker SkillMention、per-Run send snapshot、start-time desired state、verified Exposure、只读 Resolver、`CURRENT_INPUT.skills` 与 unchanged Adapter transport |
| [User Automation](user-automation.md) | 一个 `rovai` binary 下隔离的 Agent/User transport、Main-owned 本机 IPC、封闭 dispatch、Camp navigation、CLI-owned Diagnostic Trial、双 cursor 与安全导出边界 |
| [Windows Desktop Platform](windows-desktop-platform.md) | Windows x64 host envelope、平台 seam、原子 Job 启动、Transport v14、私有 local storage、hidden title strip + top-level menu projection + native controls、NSIS 与真实 Windows 验收组合 |
| [Runtime File Change Observation](runtime-file-change-observation.md) | Runtime 终态文件操作、Command Diff、每 AgentRun 文件变化归约、exact managed-output exclusion、Managed Blob、恢复与授权读取边界；不扫描工作区或依赖 Git |
<!-- architecture-index:end -->
