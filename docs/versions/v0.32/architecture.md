---
document_type: version-architecture
version: v0.32
authority: implementation-contract
status: frozen
implementation_status: complete
last_updated: 2026-08-02
---

# v0.32 实施设计

> 范围：[README.md](README.md)
>
> 决策：[ADR-0091](../../adr/0091-durable-member-calls-and-single-slot-a2a-resume.md)
>
> 状态：[implementation-plan.md](implementation-plan.md)

## 1. 写路径

```text
running AgentRun calls team.call_member
  → authenticate Binding + execution epoch
  → validate recipient / task / depth / slot capacity
  → freeze recipient execution basis
  → insert InboxMessage + recipient ConversationMessage
  → insert ConversationInput(member_call, pending)
  → optionally insert ReturnObligation(open, reserved slot)
  → optionally satisfy current Run's old Obligation
  → commit accepted receipt
```

即使 recipient 当下空闲也不在 Tool 事务创建 AgentRun。Tool 结果只返回安全接受事实；内部
ID、队列位置、剩余额度和 target Run 不进入模型上下文。

## 2. 数据模型与约束

`conversation_input` 使用 `(conversation_id, sequence)` 唯一顺序，`consuming_agent_run_id`
唯一；`agent_run.trigger_conversation_input_id` 也唯一。状态检查保证 pending 没有 materialized/
terminal 时间，materialized 必须有 Run 和 materialized 时间，failed/cancelled 必须有 terminal
reason/time 且没有 Run。

`return_obligation` 对 member-call input 和 consuming Run 分别至多一条。它保存 caller/callee、
caller Conversation、caller logical depth、caller frozen resume basis、root lineage 和 reserved slot。
满足输入唯一，状态与 satisfied/cancelled 时间受 CHECK 约束。

`camp_turn.a2a_run_slots_allocated` 单调递增且不超过 16。普通调用占一个；required 多占一个
返回预留槽；满足旧 Obligation 的调用复用预留槽，只为自身的新 required 责任增加预留。

## 3. FIFO 物化与恢复

调度器每次只为没有 queued/running/waiting Run 的 Conversation 领取最小 pending sequence。
领取事务反序列化并验证 frozen basis，写一个 queued A2A AgentRun，更新 Input 为 materialized，
写 consuming Run 回链和领域事件。Immediate 事务、busy predicate 与 Input/Run 双向唯一索引
共同消除 A2A Input 的并发重复；既有 direct Run 可以排队，并继续由 running/waiting 唯一索引
和 Scheduler 串行执行。

Core 在 Member Call/Outcome、Run 终态和容量释放后发出内存 Notify；500ms scheduler tick、Core
启动和周期扫描提供持久化对账。Notify 丢失不影响正确性。

无法解析 frozen basis、目标域关系永久失效、当前 Capability 不再覆盖冻结授权，或持久化
Installation identity 已与 frozen basis 永久不一致等 Core-only 非重试失败，把 Input 标为
failed。required member-call 同事务关闭 Obligation 并创建 materialization-stage Outcome。
Workspace、真实文件/进程、可执行文件 identity、认证和 Runtime health 的实时检查仍由
AgentRun Dispatch Check 处理。

## 4. Return 与 Outcome

当前 Run 最多有一个 open Obligation。`call_member.recipient == caller_agent_id` 时，新输入与旧
Obligation 在同一事务关联并完成；新调用的 returnPolicy 独立创建反向责任。

所有 Run 终态入口在更新 AgentRun 前调用共同收口函数。若 Turn 未停止且 Obligation open，
函数创建 `call_outcome` input 并 CAS 到 `satisfied_by_core_outcome`；随后同事务提交 Run 终态。
Turn Stop 先把 open Obligation 和 pending Input 标记 `cancelled_by_turn`，因此不会生成 Outcome。

Outcome 不写 InboxMessage 或 ConversationMessage。它只通过
`agent_run.trigger_conversation_input_id` 进入 Current Input，并通过 Read Model/Audit 暴露内部
链路。

## 5. 上下文

Member Call：

```json
{
  "source": {
    "type": "member_call",
    "senderMemberId": "agent-id",
    "senderName": "name",
    "returnPolicy": "required"
  },
  "message": "request"
}
```

Outcome：

```json
{
  "source": {
    "type": "call_outcome",
    "calleeAgentId": "agent-id",
    "calleeName": "name",
    "stage": "run",
    "status": "failed",
    "reason": "no_explicit_return"
  },
  "message": "The member execution ended without an explicit return; no business result was provided or verified."
}
```

ContextManifest 可以记录 internal ConversationInput source ref 用于证据，但 rendered payload 不含
Input、Inbox、Obligation 或 Run ID。Memory participant ordering 可从 input 的 sender/callee 内部
关系推导。

## 6. CampTurn 聚合与取消

聚合器把 pending input 和 open obligation 视为未收敛责任。pending 且可运行时 Turn 为 running；
AgentRun waiting 仍为 waiting。无未终态责任后，Stop、failed input/required Run、required cancel、
all-success 按 ADR-0091 的顺序决定终态。

Stop 事务同时设置 Turn fence、Run cancel request、pending input cancelled 和 open Obligation
cancelled_by_turn。迟到 Tool Call、终态 callback 和 reconciler 都重新检查 fence。

## 7. Breaking rename

Canonical identity、Capability、Rust 类型、MCP alias、Claude MCP name、ACP catalog、Antigravity
permission、Session Charter、Smoke/Qualification 脚本统一使用 `call_member`。不注册兼容别名，
输入严格拒绝 `body`、`source`、`inReplyToMessageId` 和 `references`。

`team.list_tasks` 保留快照用途，但描述明确禁止等待状态变化；没有其他可执行工作时结束 Run，
后续协作输入由 Core 自动恢复。

Breaking catalog 同时把 Attested Team Protocol 升为 3、Antigravity Alias Map 升为 2；旧
Bridge/catalog digest 不得与新 `call_member` Schema 静默互认。
