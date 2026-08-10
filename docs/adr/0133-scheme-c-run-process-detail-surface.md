---
document_type: adr
id: ADR-0133
title: Scheme C Run Process Detail Surface
status: superseded
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes: []
superseded_by: ADR-0154
---

# ADR-0133: Scheme C Run Process Detail Surface

## Context

执行过程既需要在会话区保持可见，又不能把 Runtime 日志变成第二条聊天时间线。现有 Inspector
“活动”页与会话区执行卡重复过程详情；原型还展示了 Run 级停止按钮，与已经冻结的 CampTurn
级停止权威冲突。v0.45 需要在不改变 Arctic Dawn App Shell 的前提下收敛信息架构。

## Decision

采用 Scheme C：

- Run Pulse 常驻在会话区上方，提供数量、状态摘要和 Run 选择，不自动打开/切换 Drawer 或
  抢焦点；
- Execution Drawer 按需展开，成为唯一的 Run 过程详情面。它只读 Canonical Runtime
  Activity、Execution Evidence、Delivery 和 ContextManifest 摘要，不提供 Run stop/cancel；
- 删除 Inspector “活动”页，Inspector 只保留 Tasks、Context、Approvals、Audit；
- Approval Dock 继续固定在 Composer 正上方。Drawer 空间不足时收缩为摘要，不能遮挡 Dock；
- 存在活跃 CampTurn 时，Composer 发送位置切换为唯一的 CampTurn Stop，fence 整棵
  AgentRun/Message Delivery 执行树；v0.45 不新增 Run 级取消协议；
- HTML 只作为会话区层级和交互参考，现有 Arctic Dawn Token、导航、Composer、Approval、
  断点和无障碍合同优先。

## Consequences

- 用户有一个明确的过程详情入口，不需要在 Inspector 与会话区之间寻找同一 Run；
- Drawer 的只读边界避免把 Run cancel 与 CampTurn stop 混成两套协议；
- Inspector 迁移需要删除旧 Activity tab route/state/test，并将原有 Activity 入口转为 Drawer
  selection；
- 窄窗口下需要优先保证 Approval 和 Stop 可见，Drawer 详情可退化为摘要。

## Rejected Alternatives

- **保留 Inspector Activity 页并新增 Drawer**：形成两个过程详情权威和重复状态；
- **每个 Run 卡提供 Stop**：绕过 CampTurn fence，导致树内部分取消；
- **后台事件自动打开 Drawer**：抢焦点、改变用户阅读位置，并把观察变成注意力副作用；
- **完整复制 HTML Demo Shell**：会覆盖当前 Arctic Dawn 设计系统并把演示数据误当生产状态。

## References

- [Run Process Detail Surface v1](../contracts/run-process-detail-surface-v1.md)
- [Arctic Dawn V3](../ui/arctic-dawn.md)
- [v0.45 会话区原型](../prototypes/run-activity/README.md)
- [ADR-0084：Conversation surface controls](0084-conversation-surface-controls-and-stop-outcome-projection.md)
