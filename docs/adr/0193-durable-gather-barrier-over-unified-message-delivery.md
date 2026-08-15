---
document_type: adr
id: ADR-0193
title: Durable Gather Barrier over Unified Message Delivery
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.89
supersedes: []
superseded_by: null
---

# ADR-0193: Durable Gather Barrier over Unified Message Delivery

## Context

让 Lead 同时询问多个成员并在全部责任结束后统一综合，不能靠每个成员普通 return 逐次唤醒 Lead：同一
Conversation 会持续排队多个 continuation，先到结果也无法证明其余责任已经终态。进程内 suppress flag、正文
阶段解析或 Barrier 直接 spawn Run 又会在重启、retry、Stop 与并发终态时丢失关联或绕过 Delivery FIFO。

现有 CampMessage 与 recipient-specific Message Delivery 已经拥有公共事实、队列、attempt、Context gate、
Runtime readiness 和恢复权威。新能力必须扩展该统一权威，而不是建立第二套 inbox 或 scheduler。

## Decision

Rovai 采用持久 Gather Barrier，并继续以统一 Message Delivery 作为唯一执行投递权威：

1. 一个 Gather 接受一条公共 CampMessage，并为 canonical-deduped recipient 创建 N 条 forward Delivery；每个
   GatherItem 的责任身份是对应 `dispatchDeliveryId`，而不是正文、message recipient 文本或临时状态。
2. Gather forward 在接受时即为 optional responsibility。成员照常公开 send；从 Item 当前 target Run 精确
   return 原 initiator 的 Delivery 持久冻结为 `gather_captured`，正常保留公共消息，但直接 settled 且不
   materialize initiator Run。普通 return 仍遵循 ADR-0163。
3. 显式 return 只提供结果 evidence，不结束 Item。Run 尚未 materialize 时以 forward Delivery 终态关闭；
   一旦 materialize，则以当前 retry generation 的成员 Run 终态关闭，并在必要时保存有界 final fallback。
4. 最后一个 Item 终态时，Barrier 在同一事务冻结 immutable completion input、CAS 标记 Gather ready，并在
   原 initiator recipient FIFO 创建唯一 Completion Delivery。Barrier 不直接创建 AgentRun。
5. Completion Delivery 使用冻结的 initiator Agent/Conversation、现有 attempt fence、wait condition、Runtime、
   Context 与恢复边界；空闲后只 materialize 一个 required continuation。Native Session 和当前 Default Lead
   都不是路由权威。
6. accepted A2A 与 AgentRun responsibility 使用独立、单调账本。Capture 消耗前者但不消耗后者；completion
   的 Run responsibility 在 Gather 接受时预留。
7. Stop、Camp 关闭或原 initiator 离场取消 Gather且不转交；Default Lead 变化不重路由；ready 后 retry 不得
   重开 Items。多个 Gather 各自创建 completion，并按 Barrier commit 顺序共享同一 FIFO。

本决定局部覆盖 ADR-0163 中“每个 return 必然创建 caller continuation”的条款，仅限可信 GatherItem 当前
Run 到冻结 initiator 的精确 return；ADR-0130/0131 的公共消息、统一 Delivery 与事件驱动恢复继续生效。

## Consequences

- 成员结果保持公共可见，Lead 不再被 N 条 return 逐次唤醒，并且聚合闭环可跨重启、retry 与并发恢复；
- Message Delivery、CampTurn budget、AgentRun trigger 与 Read Side 必须升级为判别联合和 retry generation；
- Barrier 的每个终态入口都必须和事实写入同事务，且以唯一约束/CAS 防止重复 completion；
- Gather acceptance 预留一个未来 completion responsibility，因此即使成员全部失败仍可让 Lead统一处理；
- 取消保留审计事实但不制造替代 completion，系统不会把结果静默转交另一个 Lead。

## Rejected Alternatives

- **每个成员普通 return 后由 Lead 自行计数**：会创建 N 个 continuation，且模型私有历史不是持久 Barrier。
- **进程内 suppress wake 或短时间窗口**：重启和竞态后无法恢复，也不能证明关联来源。
- **解析正文、Mention 或阶段标题判断结果**：展示文本和身份关联混合，重命名与自然语言变化会误路由。
- **Barrier 直接 spawn Lead Run**：绕过 recipient FIFO、target-busy、attempt fence、Context gate 与恢复权威。
- **独立 Gather inbox/scheduler**：复制 Message Delivery 的队列和故障协议，形成两套执行真源。
- **按当前 Default Lead 转交 completion**：改变已接受请求的责任人和 Conversation，破坏幂等与审计。

## References

- [v0.89 版本目标](../versions/v0.89/README.md)
- [ADR-0130: Public A2A Messages and Unified Delivery](0130-public-a2a-message-and-unified-delivery.md)
- [ADR-0131: Recipient-Scoped Event-Driven Delivery](0131-recipient-scoped-event-driven-delivery-recovery.md)
- [ADR-0163: Explicit Caller Return](0163-explicit-caller-return-and-core-managed-reply-reference.md)
- [Gather v1](../contracts/gather-v1.md)
- [Message Delivery v3](../contracts/message-delivery-v3.md)
- [持久 Gather Barrier 架构](../architecture/durable-gather-barrier.md)
