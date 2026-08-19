---
document_type: contract
name: Camp Open Projection
version: v4
status: accepted
source_version: v1.15
last_updated: 2026-08-19
---

# Camp Open Projection v4

本合同完整继承 [Camp Open Projection v3](camp-open-projection-v3.md) 的 Desktop methods、wire schema 3、
Read Model schema 32、SQLite read transaction、collection windows、coverage/high-water、earlier message page、
AgentRun 取消事实、Runtime 模型展示事实与 data-minimized instrumentation。v4 只把 `camps.enter` 的
Default Lead reconciliation 调整为 activation-aware。

## Activation-aware `camps.enter`

Core 在同一串行 request 中读取目标 Camp 的权威 `activation_state`，然后按该状态选择唯一进入路径：

- `pending`：不执行 `camp.default_lead.reconcile`，直接读取并返回有界 `CampOpenProjection`；Camp 保持
  Pending，Default Lead、Camp version、Composer Draft 与 prepared attachments 均不改变；
- `active`：继续先执行幂等 `camp.default_lead.reconcile`，再读取 reconcile 后的有界投影；
- Camp 不存在、状态不可读或 Active reconciliation rejected：整个 request fail closed，不返回投影。

Pending enter 不创建 reconcile command result 或领域事件，不激活 Camp，也不替代第一条用户消息拥有的
原子激活边界。Main Window Session 和应用内导航只把已经 meaningful、因而具备导航与恢复资格的 Pending
Camp Draft 交给这条读取路径；资格仍由 Pending Camp Activation 合同拥有。Renderer 以一次 `camps.enter`
请求取得权威投影，不读取 activation state 后自行选择 `camps.open`。

Core 的 data-minimized timing 允许 Pending 路径把 `reconcile_ms` 记录为 `0`；其余 trace 字段与脱敏边界不变。
`camps.open`、`camps.exists`、projection schema 3、Read Model schema 32、collection windows 和 earlier message
page 均不改变。

## Acceptance

- meaningful Pending Camp 可作为 Restorable Location 冷启动进入，不触发
  `camp.pending_activation_required`；
- Pending enter 返回原 activation state、Default Lead、Camp version 与 Draft，不产生 reconciliation 副作用；
- Active enter 仍保持 reconcile-before-read，rejected 时不泄露 reconcile 前投影；
- Pending 的第一条 accepted 用户消息仍由
  [Pending Camp Activation v1](pending-camp-activation-v1.md) 在消息事务内原子激活。

## References

- [Camp Open Projection v3（历史）](camp-open-projection-v3.md)
- [Pending Camp Activation v1](pending-camp-activation-v1.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
