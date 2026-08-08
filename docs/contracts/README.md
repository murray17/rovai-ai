---
document_type: contracts-index
authority: protocol-contract-routing
last_updated: 2026-08-08
---

# 长期接口合同

本目录保存跨版本、字段级且可由测试直接验证的接口合同。ADR 解释为什么选择某个边界，
Architecture 解释组件如何组成，Version 文档记录交付范围；它们都不复制本目录的完整 wire shape。

| 合同 | 权威范围 |
| --- | --- |
| [Built-in Tool Transport v3](builtin-tool-transport-v3.md) | v0.46 Agent Result Projection、固定业务命令、Core Envelope/IPC、receipt、错误通道、显式 projection schema 与 catalog 边界 |
| [Camp Message Send v2](camp-message-send-v2.md) | v0.46 隐式当前 Run Camp、记录身份 Replay、send clean break 与错误合同 |
| [Built-in Tool Transport v2 (historical)](builtin-tool-transport-v2.md) | v0.45 Agent CLI、catalog、IPC、Envelope、receipt、幂等、lease 与旧私有 operation clean break |
| [Camp Message Send v1 (historical)](camp-message-send-v1.md) | v0.45 `camp.message.send` / `rovai send`、Addressing Token、recipient resolution、fanout、lineage 与错误 |
| [Message Delivery v1](message-delivery-v1.md) | recipient-specific queue、dispatch attempt、waitCondition、interrupted recovery、retry/cancel 与 settlement |
| [Context Delivery Profile v1](context-delivery-profile-v1.md) | AgentRun 公共消息窗口、Unicode scalar 正文截断、历史字符预算、遗漏提示与 Manifest 证据 |
| [Context Delivery Profile v2](context-delivery-profile-v2.md) | Profile v2 公共引用链最多 3 条、预算优先级、omission、Manifest/ACK 与 Context gate |
| [Run Process Detail Surface v1](run-process-detail-surface-v1.md) | Scheme C Run Pulse、Execution Drawer、Inspector Activity 删除、Approval Dock 与 Stop 权威 |
