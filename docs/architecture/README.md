---
document_type: architecture-index
authority: long-lived-architecture-routing
last_updated: 2026-08-09
---

# 长期系统架构

本目录保存跨版本长期存在的组件结构、职责和权威边界。字段级 wire shape 归
[`docs/contracts/`](../contracts/README.md)，决策理由归 ADR，实施状态归当前 Version 文档。

| 架构 | 内容 |
| --- | --- |
| [Built-in Tool Runtime](builtin-tool-runtime.md) | Agent CLI、Core Router、Runtime Fleet、Bootstrap、ContextManifest 与外部 MCP 的关系 |
| [Public A2A Message 与 Message Delivery](public-a2a-message-delivery.md) | 公共消息事实、统一收件人 Delivery、Context gate、Runtime 输出与 UI projection 的权威边界 |
| [Camp Activation Lifecycle](camp-activation-lifecycle.md) | 一键 Pending、Composer Draft、Navigation、Restorable Location、首消息原子激活与启动清理的组件权威 |
