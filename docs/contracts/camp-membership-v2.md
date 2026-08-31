---
document_type: protocol-contract
contract: camp-membership-v2
authority: camp-membership-targeted-terminal-cutover
status: accepted
version: 2
source_version: v1.37
last_updated: 2026-09-01
---

# Camp Membership v2

继承 [v1](camp-membership-v1.md) 的命令、权限、至少一位成员、版本/generation、Preview、来源和 exact lifetime fence。
本版只将原定向 cutover 的收尾前移到同一事务，不改变受影响对象集合。

## 定向范围

直接复用 `camp_membership_affected_deliveries` 与 `camp_membership_affected_run_ids`：

1. 该成员在当前 membership version 的全部非终态 Run；
2. 收件人为该成员的 pending/running Delivery；
3. 该成员发起的未完成 Gather 及其 Delivery；
4. 来源为该成员 Run 的未完成普通公开 A2A Delivery；
5. 上述 Delivery 已持久化关联的 target_agent_run_id。

保留 `recipient_membership_ended`、`gather_initiator_left_camp`、`source_membership_ended` 原因码。
每个 affected Run 使用统一事务结算；尚未物化的 pending Delivery 按原原因关闭，已物化 Delivery 经目标 Run
settlement 收口。原 Gather/item 取消、开放 Task 解除 assignee 并回到待分配、Default Lead 修复都保持不变。
只重算 affected_turn_ids，不递归追踪血缘、不构建依赖图、不取消同轮无关 Run。

## 审计与渠道

新 reconciliation 在 cutover 提交时直接满足 `target_run_count = settled_run_count = affected_run_ids.len()`、
`status = completed`、`completed_at = now`；子 Run 审计同时 settled。它保留离队审计，不再等待 Runtime ACK。
旧 reconciling 记录仍可由原终态 trigger 收敛；重新加入不能复活旧 lifetime。

不得调用 whole-Turn abort helper，也不得直接关闭整轮渠道投递。其他必要 Run 尚在执行时 Turn 保持 active、
ChannelTurnRequest 保持 admitted；真正终态后才走原渠道终态与 Outbox 完成条件。
