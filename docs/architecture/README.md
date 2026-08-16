---
document_type: architecture-index
authority: long-lived-architecture-routing
last_updated: 2026-08-16
---

# 长期系统架构

本目录保存跨版本长期存在的组件结构、职责和权威边界。字段级 wire shape 归
[`docs/contracts/`](../contracts/README.md)，决策理由归 ADR，实施状态归当前 Version 文档。

<!-- architecture-index:begin -->
| 架构 | 内容 |
| --- | --- |
| [Benchmark Protocol](benchmark-protocol.md) | Core 外的 Adapter/Profile/Execution/Evaluation/Reporting、Process/Outcome/Tool-Use Judge、Tool Interaction、typed Resource 与 paired counterfactual 模块 |
| [Diagnostics Center](diagnostics-center.md) | Core 严格只读诊断组装、Skill/MCP 审计、Runtime 缓存事实、Renderer 单项修复复检、Electron v5 导出与 Startup Recovery 边界 |
| [AgentRun Recovery](agent-run-recovery.md) | AgentRun、Native Session、Runtime Input Delivery 与 Native Turn 分离，accepted-input blocker、Scheduler fence、用户/预算安全收敛与未来 reconcile capability |
| [Built-in Tool Runtime](builtin-tool-runtime.md) | Agent CLI v13、十五项固定 operation、`rovai gather`、Core Router、direct-user `member.create`、Runtime Fleet、精确 help、十三项 official Skill、peer routing Dynamic Context、ContextManifest/ACK 与外部 MCP 的关系 |
| [持久 Gather Barrier](durable-gather-barrier.md) | 一条公共请求、N 个 Item/forward Delivery、持久 return capture、原子 Barrier、Completion FIFO 与 mandatory typed Current Input 的组件权威 |
| [Runtime Catalog Boundaries](runtime-catalog-boundaries.md) | 可执行 Product Runtime Catalog、机器 Availability 与 Renderer-only Settings Preview 的权威分层、准入和晋升边界 |
| [Runtime Monitoring](runtime-monitoring.md) | Clean-break enrollment、Runtime Usage dialect/raw/projection/parser state、Rollup、Tool Duration、Cost layer、三个只读查询与 Renderer 边界 |
| [Native Session Bootstrap Redelivery](native-session-bootstrap-redelivery.md) | compaction detector、Session Observer、Bootstrap/Member Identity 重投递、Redelivery v2、Dynamic Context 与 accepted-input 水位 |
| [Notification Episode](notification-episodes.md) | Occurrence/Disposition/Episode/Change Journal 原子投影、可见来源精确确认、read hydration、并发边界与保留 |
| [Online Memory Capture](online-memory-capture.md) | best-effort Skill discovery、complete exact-Scope View、copyable target、active body aggregate quota、durable rejection、Agent Memory Facade、原子 Supersession、隔离 Hearth Review、formal publication、clean break 与 Forget 闭包 |
| [Planned Shutdown](planned-shutdown.md) | Core execution/terminal 双准入、durable shutdown cycle、可靠 Runtime terminal 优先、product fence 启动补偿、统一 deadline、route reap 与 Desktop child-exit 边界 |
| [Public A2A Message 与 Message Delivery](public-a2a-message-delivery.md) | 公共 Structured Message、canonical/line-leading display-name addressing、正交 Current User Attention、forward/caller-return Delivery、原子通知、Context gate 与 UI projection 边界 |
| [Camp Activation Lifecycle](camp-activation-lifecycle.md) | 一键 Pending、Composer Draft、Navigation、Restorable Location、首消息原子激活与启动清理的组件权威 |
| [Camp Composer Draft](camp-composer-draft.md) | Structured Content、附件、持久 reply/continuation、显式接收者修复、发送物化、exact-revision user send 与 timeline projection 的组件权威 |
| [Camp Open Read Path](camp-open-read-path.md) | Desktop 两阶段冷启动壳层、enter/reconcile、有界 SQLite open projection、轻量 exists、渐进消息/Run detail、high-water/cache 与 meaningful-paint 后台维护边界 |
| [First-run Onboarding](first-run-onboarding.md) | Desktop 首次安装 admission、三页持久状态、幂等 Core provisioning、`初次集结` restore 与 Draft-only 第四页边界 |
| [Skill Projection Reconciliation](skill-projection-reconciliation.md) | Skill Library desired state、bundled bootstrap 快速路径、root access ledger、事件驱动 dirty、当前 Run 完整校验 preflight、start-time SkillExposureSnapshot 与无历史目录扫描边界 |
<!-- architecture-index:end -->
