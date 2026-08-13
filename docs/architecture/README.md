---
document_type: architecture-index
authority: long-lived-architecture-routing
last_updated: 2026-08-13
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
| [Built-in Tool Runtime](builtin-tool-runtime.md) | Agent CLI v7、Core Router、Runtime Fleet、精确 help、Charter/official Skill 渐进教学、peer routing Dynamic Context、ContextManifest/ACK 与外部 MCP 的关系 |
| [Native Session Bootstrap Redelivery](native-session-bootstrap-redelivery.md) | compaction detector、Session Observer、Bootstrap/Member Identity 重投递、Redelivery v2、Dynamic Context 与 accepted-input 水位 |
| [Planned Shutdown](planned-shutdown.md) | Core execution/terminal 双准入、current-generation active execution registry、可靠 Runtime terminal、统一 deadline、route fence/reap 与 Desktop child-exit 边界 |
| [Public A2A Message 与 Message Delivery](public-a2a-message-delivery.md) | 公共 Structured Message、正交 Current User Attention、forward/caller-return Delivery、原子通知、Context gate 与 UI projection 边界 |
| [Camp Activation Lifecycle](camp-activation-lifecycle.md) | 一键 Pending、Composer Draft、Navigation、Restorable Location、首消息原子激活与启动清理的组件权威 |
| [Skill Projection Reconciliation](skill-projection-reconciliation.md) | Skill Library desired state、root access ledger、事件驱动 dirty、当前 Run preflight、start-time SkillExposureSnapshot 与无历史目录扫描边界 |
<!-- architecture-index:end -->
