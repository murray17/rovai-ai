---
document_type: protocol-contract
contract: channel-host-maintenance-v5
authority: channel-host-adaptive-maintenance-and-quiescence
status: accepted
version: 5
source_version: v1.38
last_updated: 2026-09-02
---

# Channel Host Maintenance v5

继承 [v4](channel-host-maintenance-v4.md) 的封闭 tick、Main Actor、单事务维护、provider-scoped outstanding、
无 poll receipt、FIFO、取消收口、suppression、delivery lease、迟到 sent、按需 watchdog 和 terminal/retry one-shot。
本版只收紧飞书 Host 的 Core event 快路径，并把飞书历史群 roster sweep 移出启动恢复热路径；钉钉行为不变，
不增加通用 WorkItem、deadline journal、持久映射或第二份权威状态。

## 1. Tick 响应与静默判定

`channels.host.tick` 与 `channels.dingtalk.host.tick` 的请求仍为：

```json
{ "workerId": "host-worker", "limit": 20 }
```

响应必填布尔字段保持不变：

```json
{
  "deliveries": [],
  "rosterRefreshes": [],
  "hasOutstandingWork": false
}
```

Core 在同一个 IMMEDIATE 事务完成超时、投影、终态封存、FIFO、lease 恢复和 claim 后，按 provider 从现有领域表
计算 `hasOutstandingWork`。以下任一事实仍存在即为 `true`：

- `channel_turn_request` 为 `queued | admitted`；
- `channel_delivery` 为 `pending | attempting`；
- `channel_execution_console` 为 `opening | active | terminal_pending | recall_pending`；
- `channel_inbound_aggregate` 为 `collecting`；
- `pending_camp_binding` 为 `pending | resolving`；
- 本次仍返回待处理的 provider roster refresh。

查询通过 Request/Binding/Conversation 或 PendingBinding/Conversation 归属 provider。另一 provider 的未完成事实不得
武装当前 Host。`deliveries=[]` 只表示本次没有可领取 Delivery，不代表静默；未来 `available_at`、有效 lease、
`terminal_pending` quiet window、排队请求或聚合 deadline 都仍属于 outstanding work。

## 2. Main 的按需调度

Main 不再永久运行 750ms/800ms provider interval。每个 Core generation 启动 Host 时只做一次恢复探测；若结果为
`false`，不保留任何维护定时器。渠道入站、会改变渠道状态的卡片回调、Bot 重连/roster 变化和 Delivery settlement
都会立即请求一次串行、可合并的 pump。

飞书 provider 已处于 outstanding 状态时，Core event 快路径必须按以下范围处理：

- `agent_run.started` 立即唤醒；
- `agent_run.terminal` 立即唤醒，并再安排一次 1000ms one-shot，跨过执行卡 900ms terminal quiet window；
- 其他 live Runtime event 先提取 `agentRunId`；只有该 Run 存在于飞书 Host 当前 execution card state，且状态为
  `opening | active | terminal_pending` 时，才最多每 500ms 合并为一次 live refresh；
- 其他 `agent_run.*`、非 live Runtime event、未跟踪 Run 和 `terminal_sealed` Run 的事件全部忽略。

该过滤只使用飞书既有的 execution card state，不新增持久字段、映射或集合。普通 Core event 必须继续经过 Pump 的
active 门禁；已经休眠的 Host 不得被这些事件重新激活。渠道入站、卡片操作、Bot/roster 变化和 settlement 仍可通过
既有显式 `wake()` 激活。Web 执行台继续直接消费自己的 Core event/SSE 刷新链路，不受该过滤影响。

钉钉继续沿用 v4：provider active 时，`runtime.*` 连续事件最多每 500ms 合并一次，`agent_run.*` 直接唤醒，
`agent_run.terminal` 保留立即维护和 1000ms one-shot。本版不修改钉钉事件过滤或 roster 机制。

飞书 Service 在启动恢复探测前先把历史群 roster sweep deadline 推迟一个正常 sweep 周期。首次 Pump 必须直接完成
遗留 Request、Delivery 与 Execution Console 的 Core 恢复，不得先遍历全部历史群发起 roster 网络请求。若首次 tick
返回 `false`，Host 可以直接休眠，不承诺在 deadline 到达时仅为全量 sweep 自行唤醒；之后的实际渠道活动超过 deadline
时仍可执行运行期 fallback。新群消息的精确刷新、Core 请求的 exact roster refresh 和 Bot roster 事件保持不变。
钉钉启动 roster 行为本版不变。

Delivery settlement 必须追泵，以便 Core 结算 exact Request 并提升 FIFO；若 retry settlement 返回 `availableAt`，
Main 还需在该时刻安排 one-shot，不得把 2–32 秒退避延长到兜底周期。

同一时间最多执行一个 provider pump。执行期间收到的唤醒必须合并为一次后续 pump，不能因“当前正在执行”而丢弃。
Core event 和本地 Notify 只负责提早唤醒，不承担不丢失保证，也不成为持久队列。

每个 execution console 同时最多有一条 `pending | attempting` upsert Delivery。`pending` 时新 snapshot 直接覆盖该条
payload；`attempting` 时只推进 console 的 `latest_sequence/digest`，不得创建第二条 Delivery。原 Delivery 成功 settle
后，若 `delivered_sequence < latest_sequence`，必须在同一 settlement 事务只创建或合并一次 latest-sequence follow-up。
该 latest-wins 流控独立于 500ms Main debounce；终态 quiet window 也不得被 live debounce 吞并。

## 3. 十分钟恢复 watchdog

一次成功 tick 返回 `hasOutstandingWork=true` 后，Main 武装一个可撤销的 10 分钟 one-shot watchdog；后续成功 pump
仍有工作时重新武装。返回 `false` 时立即撤销 watchdog 和尚未触发的 terminal/retry follow-up，provider 进入休眠，
直到新的渠道活动或下一 generation 的启动探测。

Pump 失败不能据此宣称静默；Main 保持 provider active 并重新武装 watchdog。事件丢失、进程内唤醒竞态或短暂网络
失败因此最多把数据库恢复延后约 10 分钟；attempting Delivery 的 lease 已到期时，最坏恢复时间还包括到下一次
watchdog 的等待。这是以显著减少空闲全库维护换取的明确延迟，不改变持久 lease、deadline 或 dedupe 权威。

Core/Main 重启继续只从现有领域表恢复。不得为调度复制这些字段到通用 `channel_work_item`，也不得把 Core event
cursor、Renderer 缓存或 WebSocket 生命周期升级为恢复真源。

## References

- [Core 权威写入与幂等事务](../architecture/foundational-invariants.md#core-command-transaction)
- [飞书渠道架构](../architecture/feishu-channel.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [V1.37-D07](../versions/v1.37/decisions.md#v1-37-d07)
- [v1.38 交付范围](../versions/v1.38/README.md)
