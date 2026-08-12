---
document_type: version-overview
version: v0.62
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-12
---

# Rovai-ai v0.62：显式 A2A 调用者返回

> 当前状态：领域、持久化、CLI、文档与完整自动化门禁均已完成。
>
> 前置版本：[v0.61 队员页来源感知会话返回](../v0.61/README.md)
>
> 后续版本：[v0.63 MCP 队员分配工作台与开放 Library](../v0.63/README.md)

## 版本目标

修复子 Agent 无法把结果投递给直属调用者的问题，同时保留真正的递归调用防护。Agent 继续只用
`rovai send --to agent_id` 或正文 `@agent_id` 表达“发布并唤醒”；Core 根据当前 Run 的调用 lineage
把直属 caller 分类为 return，把其他目标分类为 forward，并自动建立公共消息 reply reference。

## 交付范围

- `--to` 与严格 inline `@agent_id` 继续取并集、去重；未使用两者时只发布公共消息，零 Delivery、
  零唤醒；
- exact Immediate Caller 目标创建 `return` Message Delivery，唤醒新的 caller continuation Run，
  并恢复 caller 原先的 parent/root/depth；
- 其他目标创建 `forward` Delivery，继续受 self、非直属 ancestor、depth、fanout 与 CampTurn budget
  限制；return 同样消耗一个 A2A/AgentRun slot；
- Message Delivery 持久化 `edge_kind`、`target_parent_agent_run_id` 与
  `return_to_agent_run_id`，dispatch、retry、Context gate 和 Read Side 复用冻结值；
- 删除 Agent input `replyToCampMessageId` / CLI `--reply-to-camp-message-id`；Core 从当前 Run 的
  trigger CampMessage 自动写 reply relation，但 reply 永远不推导收件人；
- Built-in Tool Transport 升到 v6，Data Contract 升到 v0.62/schema 31，CampSnapshot 升到 schema
  28，Migration 76 把历史 Delivery 明确回填为 forward；
- `rovai send --help` 用简短摘要、明确 `--to` 场景与 public-only/return 语义，并提供两个示例。

## 冻结边界

- 不增加 `--return-to`，不恢复 reply author default recipient，也不让无寻址 send 唤醒 Agent；
- inline Addressing Token 仍是正式寻址源；Missing-Send Recovery candidate 中的 lookalike Mention
  仍不解析、不投递；
- 只豁免 exact Immediate Caller。grandparent 或其他 lineage ancestor 继续
  `message.addressing_invalid/ancestor_cycle`；
- return 不复用已终态 caller Run 或 Native Session，不免费、不跳过 recipient queue/Runtime
  readiness/Context gate/settlement；
- Message Reply Reference 只服务公共 thread 与 Context closure，不成为执行边或授权依据；
- 不改变 Renderer 布局、Runtime Activity mapping、Runtime Adapter 兼容性与用户工作区数据。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.61 冻结为 historical，v0.62 成为唯一 current，并新增本版本概览与实施计划 |
| ADR | 已更新 | 新增 [ADR-0163](../../adr/0163-explicit-caller-return-and-core-managed-reply-reference.md)，冻结显式 caller return、非直属 ancestor guard 与 Core-managed reply reference |
| Contracts | 已更新 | 新增 [Camp Message Send v3](../../contracts/camp-message-send-v3.md)、[Message Delivery v2](../../contracts/message-delivery-v2.md)与[Built-in Tool Transport v6](../../contracts/builtin-tool-transport-v6.md) |
| Architecture | 已更新 | Public A2A 与 Built-in Tool Runtime 架构改为 forward/return 分离，并区分 Delivery causal source 与 target call lineage |
| UI | 确认无需更新 | Read Side 增加 Delivery 审计字段但本版本不改变 Renderer 交互、视觉或现有 Delivery footer |
| Runtime Activity | 确认无需更新 | 不改变 Canonical Activity 分类、Runtime 原生事件映射或执行活动身份 |
| Runtime compatibility | 确认无需更新 | 九 Runtime 继续调用统一 `rovai send`；未改变 Adapter 协议、实测版本或 capability matrix |
| Documentation routing | 已更新 | 文档导航、CURRENT、Architecture/Contract 索引和版本指针均路由到 v3/v2/v6 当前合同 |
| Root README | 确认无需更新 | 项目定位和常青能力集合不变；根 README 不记录本次协议版本升级 |

## References

- [v0.62 实施与验收计划](implementation-plan.md)
- [ADR-0163：显式调用者返回与 Core 管理回复引用](../../adr/0163-explicit-caller-return-and-core-managed-reply-reference.md)
- [Camp Message Send v3](../../contracts/camp-message-send-v3.md)
- [Message Delivery v2](../../contracts/message-delivery-v2.md)
- [Built-in Tool Transport v6](../../contracts/builtin-tool-transport-v6.md)
- [Public A2A Message 与 Message Delivery 架构](../../architecture/public-a2a-message-delivery.md)
