---
document_type: architecture-index
authority: long-lived-architecture-routing
last_updated: 2026-08-10
---

# 长期系统架构

本目录保存跨版本长期存在的组件结构、职责和权威边界。字段级 wire shape 归
[`docs/contracts/`](../contracts/README.md)，决策理由归 ADR，实施状态归当前 Version 文档。

<!-- architecture-index:begin -->
| 架构 | 内容 |
| --- | --- |
| [Benchmark Protocol](benchmark-protocol.md) | Core 外的 Adapter/Profile/Execution/Evaluation/Reporting 组件、Lane、文件权威与零执行 Project 投影 |
| [Diagnostics Center](diagnostics-center.md) | Core 严格只读诊断组装、Skill/MCP 审计、Runtime 缓存事实、Renderer 单项修复复检、Electron v5 导出与 Startup Recovery 边界 |
| [Built-in Tool Runtime](builtin-tool-runtime.md) | Agent CLI、Core Router、Runtime Fleet、唯一 Self Identity、peer routing Dynamic Context、四层 Context/Evidence、ContextManifest/ACK 与外部 MCP 的关系 |
| [Native Session Bootstrap Redelivery](native-session-bootstrap-redelivery.md) | compaction detector、Session Observer、Bootstrap/Member Identity 重投递、Redelivery v2、Dynamic Context 与 accepted-input 水位 |
| [Public A2A Message 与 Message Delivery](public-a2a-message-delivery.md) | 公共消息事实、统一收件人 Delivery、Context gate、Runtime 输出与 UI projection 的权威边界 |
| [Camp Activation Lifecycle](camp-activation-lifecycle.md) | 一键 Pending、Composer Draft、Navigation、Restorable Location、首消息原子激活与启动清理的组件权威 |
<!-- architecture-index:end -->
