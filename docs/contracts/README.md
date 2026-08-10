---
document_type: contracts-index
authority: protocol-contract-routing
last_updated: 2026-08-10
---

# 长期接口合同

本目录保存跨版本、字段级且可由测试直接验证的接口合同。ADR 解释为什么选择某个边界，
Architecture 解释组件如何组成，Version 文档记录交付范围；它们都不复制本目录的完整 wire shape。

## 生命周期

- 已接受且带版本号的合同语义冻结，只允许修正错字、链接、元数据和不改变语义的表达。
- 字段、wire shape、错误、幂等或投递语义改变时，创建下一个 `<name>-vN.md`，不得原地改写
  已接受版本；旧版本可继续约束既有持久对象或历史恢复。
- 新增或切换合同版本时必须同步更新下方索引，明确当前入口与 historical 入口。合同的
  `accepted` 只表示该版本语义成立，不表示它是新执行的当前入口，也不表示代码已经实现。

| 合同 | 权威范围 |
| --- | --- |
| [Benchmark Protocol v3（当前）](benchmark-protocol-v3.md) | 版本化 Run 信封、Product/Environment fingerprint、五层 Evidence、Adapter/derived projection、逐轴比较资格与 disclosure |
| [Diagnostics Center v1（当前）](diagnostics-center-v1.md) | `diagnostics.check` typed read model、三态分类、显式单项修复映射、Recovery 与集中脱敏的 `rovai-diagnostics-v5` |
| [Collaboration State v2（当前）](collaboration-state-v2.md) | peer-only routing identity、稳定 CampMember 选择、Lead ID/Boolean、完整 projection digest、独立 inclusion、accepted ACK 与 v0.50 clean break |
| [Built-in Tool Transport v4（当前）](builtin-tool-transport-v4.md) | v0.47 十三项固定业务命令、Core Envelope/IPC、receipt、Agent Output v2、Task projection、错误通道与 clean break |
| [Durable Task v2（当前）](durable-task-v2.md) | 五态 Task、字段限制、projected final state、可见性/权限、事务、列表、membership 收口、删除级联与 linked admission |
| [Camp Message Send v2（当前）](camp-message-send-v2.md) | 隐式当前 Run Camp、记录身份 Replay、send clean break 与 A2A 业务错误；v0.47 transport 入口由 v4 合同局部替代 |
| [Pending Camp Activation v1（当前）](pending-camp-activation-v1.md) | 一键 Pending 创建、Snapshot/Navigation activation state、首消息原子激活、mutation guard 与窄 discard/启动清理 |
| [Built-in Tool Transport v3 (historical)](builtin-tool-transport-v3.md) | v0.46 十二项命令与 Agent Result Projection v1；不作为 v0.47 Runtime/CLI compatibility 入口 |
| [Built-in Tool Transport v2 (historical)](builtin-tool-transport-v2.md) | v0.45 Agent CLI、catalog、IPC、Envelope、receipt、幂等、lease 与旧私有 operation clean break |
| [Camp Message Send v1 (historical)](camp-message-send-v1.md) | v0.45 `camp.message.send` / `rovai send`、Addressing Token、recipient resolution、fanout、lineage 与错误 |
| [Message Delivery v1](message-delivery-v1.md) | recipient-specific queue、dispatch attempt、waitCondition、interrupted recovery、retry/cancel 与 settlement |
| [ContextManifest Evidence v9（当前）](context-manifest-evidence-v9.md) | Dynamic Context exact bytes/evidence、bounded whole-history aggregate、exact bounded omission 与 accepted-ACK 分层 |
| [Context Delivery Profile v1](context-delivery-profile-v1.md) | AgentRun 公共消息窗口、Unicode scalar 正文截断、历史字符预算、遗漏提示与 Manifest 证据 |
| [Context Delivery Profile v2](context-delivery-profile-v2.md) | Profile v2 公共引用链最多 3 条、候选选择/排序、Unicode-scalar 截断、预算优先级与 Context gate；模型字段和 Evidence 分属 Formatter/Manifest |
| [Run Process Detail Surface v1](run-process-detail-surface-v1.md) | Scheme C Run Pulse、Execution Drawer、Inspector Activity 删除、Approval Dock 与 Stop 权威 |
