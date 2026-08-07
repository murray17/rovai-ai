---
document_type: adr
id: ADR-0131
title: Recipient-Scoped Event-Driven Delivery Dispatch and Interrupted Recovery
status: accepted
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes: []
superseded_by: null
---

# ADR-0131: Recipient-Scoped Event-Driven Delivery Dispatch and Interrupted Recovery

## Context

公共 Message 与 Delivery 提交后，目标 Agent 可能暂时忙、Runtime 不可用或容量不足。周期扫描
和启动时全局重调度看似简单，却会把 Core restart 变成历史 Camp 的隐式执行入口，也无法区分
“已经尝试过但暂时等待”和“第一次 dispatch attempt 尚未建立就崩溃”这两个完全不同的事实。

## Decision

Message Delivery 使用 recipient-scoped、纯事件驱动的 Dispatch Pump：

- Delivery 在首次实际 dispatch attempt 前保持 pending；attempt 必须先持久化唯一 fence；
- attempt 已建立但暂时阻塞时记录明确 waitCondition：`target_busy`、`runtime_unavailable` 或
  `capacity_unavailable`；
- 只有新 Delivery 接受、该 recipient 的目标 Run 结束、Runtime 配置/ready 恢复、容量变化或
  针对单条 Delivery 的显式 Retry 才能调用 `dispatchPending(agentId)`；
- 不做周期扫描，不在 Core/App 启动时全局 pump，不使用 Camp 级“继续待处理协作”兜底；
- 崩溃发生在第一次 attempt fence 之前时，Delivery 终态为
  `interrupted_before_dispatch`，标记 manual intervention，任何启动/Camp/新消息/Run 结束/
  Runtime 恢复/容量事件都不能隐式复活；
- Retry 和 Cancel 必须指向具体 Delivery。Retry 复用冻结的 Message、recipient、展示快照、
  Task 和 lineage，并拥有独立 Retry Identity；不得重新解析正文或扩大 fanout。

## Consequences

- 重启不会偷偷启动历史协作，UI 能诚实区分未开始中断和已尝试暂时等待；
- Scheduler 需要维护 recipient-scoped event subscription、attempt fencing 和对账逻辑；
- Delivery 可能长期保持 pending 或 manual intervention，Read Side 必须提供明确行动入口；
- CampTurn settlement 不能忽略 interrupted Delivery，必须等待显式 Retry 或 Cancel；
- 没有 periodic safety net，事件发布、持久化和恢复证据必须具备可验证的一致性。

## Rejected Alternatives

- **启动时扫描全部 pending**：会让 Core/App restart 产生未授权的历史执行，并掩盖崩溃窗口。
- **Camp 级继续事件批量恢复**：不能证明每个 recipient 的等待条件已经解除，且会跨目标错误
  复活 Delivery。
- **固定周期轮询**：延迟、重复尝试和资源开销不可控，无法表达 recipient-scoped causality。
- **把 interrupted 当普通 pending**：会把“从未开始”误报成可自动等待，用户无法知道需要
  明确确认。

## References

- [Message Delivery v1](../contracts/message-delivery-v1.md)
- [Public A2A Message 架构](../architecture/public-a2a-message-delivery.md)
- [v0.45 实施计划](../versions/v0.45/implementation-plan.md)
