---
document_type: protocol-contract
contract: message-delivery-v1
authority: message-delivery-lifecycle
status: accepted
version: 1
last_updated: 2026-08-09
---

# Message Delivery v1 Contract

Message Delivery 是一个 Public A2A Message 对一个 canonical Agent ID 的唯一收件人责任。
它拥有投递、排队、Context gate、目标 AgentRun 关联、暂时等待和终态证据；Message 本身不
拥有这些 recipient-specific 状态。派发架构见
[Public A2A Message 与 Message Delivery](../architecture/public-a2a-message-delivery.md)。

## 1. 冻结字段

Delivery 创建时冻结：

```yaml
deliveryId: delivery_…
messageId: msg_…
campId: camp_…
recipientAgentId: agent_27
recipientCanonicalPosition: 0
recipientDigest: sha256:…
messageBodyDigest: sha256:…
replyToCampMessageId: msg_… | null
taskId: task_… | null
lineageSnapshot: {rootDepth: 0, ancestorAgentIds: []}
recipientPresentationSnapshot: {}
```

这些值不因队员改名、离队、Runtime 恢复、正文重解析或重试而改变。`recipientCanonicalPosition`
只表示 canonical identity 集合中的位置，不是 Scheduler priority。

## 2. 状态与 dispatch phase

Delivery 的顶层状态为：

```text
pending | running | settled | failed | cancelled | interrupted_before_dispatch
```

`pending` 另带不可变递增的 `dispatchAttemptCount`、最近 attempt 证据和可选
`waitCondition`：

| phase/字段 | 含义 | 是否可自动再试 |
| --- | --- | --- |
| `never_attempted`, `waitCondition=null` | Message+Delivery 已提交，尚未建立第一次 attempt | 仅正常接受事务内 pump；Core 重启不扫描历史 |
| `attempted_waiting`, `waitCondition=target_busy` | 已建立 attempt，目标当前已有互斥执行 | 仅该 recipient 的目标 Run 结束事件 |
| `attempted_waiting`, `waitCondition=runtime_unavailable` | 身份有效但 Runtime 尚不可用 | 仅该 recipient Runtime 配置/ready 事件 |
| `attempted_waiting`, `waitCondition=capacity_unavailable` | 身份与 Runtime 有效但容量暂满 | 仅该 recipient 容量释放事件 |
| `attempting` | attempt fence 已写入，正在执行一次派发 | 由当前 attempt 完成或明确失败决定 |
| `materialized` | ContextManifest 已冻结且目标 AgentRun 已创建 | 由 AgentRun/Turn 终态推进 |

如果 Core 崩溃在第一次 attempt fence 建立前，恢复器把 Delivery 标记为
`interrupted_before_dispatch`，并写入 `manualInterventionRequired=true`。它不能被启动、恢复、
Camp 打开、新消息、CampTurn 结束、Runtime 恢复或容量变化隐式唤醒。

## 3. Dispatch Attempt 原子边界

一次 attempt 必须按下列顺序持久化/执行：

1. 在 Delivery 行上建立唯一 `dispatchAttemptId`、attempt ordinal、开始时间和 scheduler
   correlation；
2. 重新验证当前 recipient identity 与 Delivery frozen snapshot；
3. 若是暂时条件，原子记录 `attempted_waiting` + waitCondition；
4. 若可运行，先执行 Profile v2 selection/budget gate，由当前 Formatter 形成模型投影并冻结
   ContextManifest Evidence；
5. 只有 gate 成功后才物化一个目标 AgentRun 并绑定 `targetAgentRunId`；
6. 任何终态都保留 attempt evidence，禁止同一 attempt 产生第二个 AgentRun。

“第一次 attempt 已建立”由第 1 步的 durable fence 定义，不由内存函数调用或日志推断。未知
提交结果时必须先对账该 fence；不能为了“继续”创建新的 Message 或猜测外部 Runtime 结果。

## 4. 事件驱动 Dispatch Pump

Pump 不做周期扫描、不在 Core/App 启动时全局重调度，也不使用 Camp 级“继续待处理协作”
作为兜底。允许的触发器只有：

- 新 Delivery 被当前事务接受并明确排入 pump；
- 该 recipient 的目标 AgentRun 结束/释放互斥占用；
- 该 recipient 的 Runtime 配置或 readiness 恢复；
- 该 recipient 的容量变化使 Delivery 可运行；
- 用户针对某一具体 Delivery 发起显式 Retry（这是新 retry identity，不是隐式恢复）。

事件处理必须按 `agentId` 做 recipient-scoped fencing；一个 Agent 的事件不能批量唤醒同一
Camp 其他收件人。Scheduler 自己决定公平性和具体顺序，不能读取 `--to` 或 canonical
recipient order 作为优先级。

## 5. Context gate 与终态失败

Dispatch attempt 在 AgentRun materialization 前使用 Profile v2 完成选择与预算，由当前 Formatter
形成模型投影，并由 ContextManifest version 冻结 Evidence。完整
Current Input、已解析的直接父消息和 mandatory structure 无法容纳时：

```text
Delivery → failed
failureCode = context_payload_too_large
targetAgentRunId = null
waitCondition = null
```

该状态不是暂时阻塞，不能由任何事件自动重试。Public Message、其他 Deliveries 和原始
CampTurn 事实保留。用户可以明确请求该 Delivery 的人工处理（如使用新的正文/新的 send）
或取消它；普通历史重新调度不能改变该事实。

## 6. 显式 Retry / Cancel

### Retry

Retry 只接受一个具体 `deliveryId`，并创建独立的 `retryIdentity`、审计事实和 attempt
ordinal。它复用原 Delivery 冻结的 message ID、body、recipient、presentation metadata、
Task link 和 lineage；不重新解析 inline token、不扩大 recipient、不创建第二条 Public Message。
如果 recipient 已被移除或不再属于 Camp，Retry 以明确的 `delivery.recipient_no_longer_eligible`
失败，要求新的 `camp.message.send`，而不是改写历史 Delivery。

### Cancel

用户可以对 `interrupted_before_dispatch` 或等待中的单个 Delivery 显式 Cancel。Cancel 不
删除 Public Message，不影响兄弟 Deliveries，也不冒充 CampTurn Stop。存在活跃 CampTurn 时，
Composer 的 Stop 仍由 CampTurn cancellation authority fence 整棵执行树；v0.45 不提供 Run
级 cancel protocol。

## 7. CampTurn settlement 与读取

一个有 Delivery 的 CampTurn 只有在每个 Delivery 达到 `settled`、`failed`、`cancelled` 或
明确的 `interrupted_before_dispatch` 后才可结算；interrupted Delivery 不会被“看起来没有
执行”而忽略。Message public-only 的 CampTurn 不因不存在 Delivery 而创建虚假运行责任。

Read Side 必须同时展示 Public Message 和每个 Delivery 的独立状态；聚合摘要不能把一个
recipient 的失败隐藏成整条消息成功，也不能把 AgentRun 的后来公共回复解释为该 Delivery
的自动 result route。
