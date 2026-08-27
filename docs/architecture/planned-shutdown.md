---
document_type: architecture
architecture: planned-shutdown
authority: planned-core-lifecycle-and-cancel-all-settlement
last_updated: 2026-08-27
---

# Planned Shutdown

本文组合主动退出、重启和更新时的 Core 生命周期结构。当前产品定义是：退出 Rovai 即取消所有非终态
AgentRun，完成本地收口，再结束进程。精确 wire、字段、幂等和 deadline 由
[Planned Shutdown v3](../contracts/planned-shutdown-v3.md)拥有；Runtime terminal 与未知外部效果边界由
[Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)拥有。没有 durable shutdown
cycle 的异常崩溃、强杀、断电继续由 [AgentRun Recovery](agent-run-recovery.md)处理。

## 1. 单调生命周期与 durable intent

`PlannedShutdownCoordinator` 使用单调 phase 表达一次 generation-local 关闭：

```text
accepting → closing_launch → draining → terminal_closed
```

Main 的合法 v3 request 先把当前 generation 写入 `planned_shutdown_cycle`，再关闭 Execution Launch
Admission。cycle record 与 launch gate 之间因此没有遗漏窗口：已经取得 permit、正在 claim 或正在建立 route
handoff 的 Run，最终都由同一 cancel-all intent 覆盖。cycle 持久化后若进程中断，下一 generation 在普通
startup recovery 前补偿结算。

`closing_launch` 拒绝新 launch，并等待已进入 critical section 的 writer 完成 handoff 或安全放弃。只有 barrier
完成后，active registry 的 route binding 才稳定，coordinator 才进入 `draining`。该 happens-before 是读取
稳定 active snapshot 和关闭 terminal/route admission 的前提。

## 2. 三个 generation-local admission

- **Execution Launch Admission**：覆盖候选领取、active 注册、Runtime acquire、input prepare/send 与 route
  handoff。关闭后不再有新的当前代执行。
- **Terminal Settlement Admission**：为匹配 live route 的 terminal transaction 提供短命 guard。v3 不等待
  新 terminal；稳定 snapshot 形成后立即关闭，并只排空 cutoff 前已取得的 guard。
- **Live Runtime Route Admission**：为 Runtime callback、工具结果、公开消息与 input/terminal route 提供短命
  guard。它与 terminal admission 在同一个 cancel-all cutoff 关闭，迟到回调不能写入领域状态。

普通领域存储不是独立的第四个长期 drain 面。Main request loop 在接受 v3 后停止读取新请求；已进入的后台
request 只获得与原生 interrupt 相同的短 grace，随后 abort 并在 writer-fence 预算内排空。

## 3. Active registry 与 cancel-all cutoff

Scheduler 在 claim 前取得 launch permit。claim 成功后，它以 Run、execution epoch、Adapter 和 route identity
注册唯一 active handle；route binding 必须在 permit 释放前完成。launch barrier 结束后，Core 读取一次稳定
snapshot。

随后 Core 立即同步关闭 Terminal Settlement Admission 与 Live Runtime Route Admission。这个动作是 v3 的
产品线性化点：从此时起，退出意图优先于新的 Runtime outcome。cutoff 前已经持有 guard 的事务仍可完成，
所以极小的并发 terminal race 仍保持真实；cutoff 后的 terminal 不会被解释成成功、失败或 Runtime 取消。

Core 对 snapshot 中的 active handle 并发发送原生 interrupt/cancel，并记录 `planned_stop_requested`。该动作
只证明 Rovai 尝试停止对应 Runtime，不移除 handle，也不拥有 AgentRun terminal。控制面只给它 `600ms`
grace；超时任务被 abort，后续由有界 Runtime reap 收口进程权。

## 4. Writer fence 与取消事务

cutoff 后，Core 依次收口会产生 AgentRun 业务效果的 writer：

```text
stop new scheduler / recovery / discovery work
→ stop or abort admitted background requests
→ stop Built-in Tool listener and fence invocation leases
→ abort tracked AgentRun and Runtime-event owners
→ drain terminal and live-route guards admitted before cutoff
→ drain Runtime usage and remaining execution writers
→ settle the durable shutdown cycle
```

只有全部 correctness-critical writer quiesce 后，`settle_controlled_shutdown_cycle` 才取得 immediate database
transaction。它选择所有 `queued | running | waiting` Run，关闭 Run-local obligation、清除继续调度与写入资格，
并写为普通 `cancelled` terminal。

v3 事务同时形成 Run-local 取消审计。没有显式请求的 Run 使用 cycle `requested_at` 和
`app_shutdown_cancel_all`；已有显式取消 reason 保留；所有目标都写入 acknowledgement。该事务不创建
CampTurn Stop intent，因此 required Run 的逐 Run 取消仍按 `required_run_incomplete` 聚合，optional Run 不阻止
其他职责完成。

产品取消只证明 Rovai execution authority 已终止，不证明 Runtime outcome，也不证明外部效果回滚。因此
`terminal_resolution_source` 与 `terminal_reason_code` 保持空；accepted 或 delivery-unknown input、可能已派发
Action 与其他未知效果继续由自己的证据记录拥有。prepared input 在 product fence 中转为
`delivery_unknown`，不能伪写为未发送。

cycle settlement 与 AgentRun、目标 Message Delivery、CampTurn aggregate 处于同一事务。writer fence 未能
及时 quiesce 时，当前 generation 不发布可被迟到写入推翻的 terminal，而是保留 pending cycle，由下一次启动
补偿。已终态 Run 不会重新进入 Scheduler，也不自动创建 successor。

## 5. Startup compensation

Core 在普通 AgentRun recovery 前按 request 顺序处理 pending cycle：v3 使用 cancel-all transaction 并补齐
Run-local 取消审计；历史 v2 cycle 保持其原协议语义。settled cycle 幂等跳过，已终态 Run 不改写，原 input
不重发、不恢复、不复制。

补偿完成后的 cancelled Run 是普通 terminal。Read Side 可独立投影 `hasUnsettledExternalEffects`，但不得把它
重新显示为恢复中、投递待确认或结果待确认，也不得提供自动重试。

## 6. Deadline 与 Runtime reap

Core 仍接受一个 monotonic hard deadline，但 v3 的正常路径不消费大部分预算等待 terminal：

```text
persist durable cancel-all intent
→ close launch and finish handoff barrier
→ snapshot active handles
→ close terminal and live-route admission
→ bounded best-effort native interrupt
→ abort/drain writers and settle every non-terminal Run as cancelled
→ bounded Runtime shutdown/reap
→ flush report and exit
```

原生 interrupt grace 为 `600ms`；产品事务完成后的 Runtime reap grace 为最多 `2s`；Desktop hard window 仍为
`10s`。这些常量是一个 hard window 内的控制预算，不是第二个领域结算窗口。reap 超时只能影响
`deadlineExpired` 与进程强制回收，不能重开 terminal admission 或撤销已提交的 cancel-all transaction。

若产品事务完成，report 的 `unresolvedExecutions` 为零；未知外部效果不计为非终态执行。若 hard deadline
或 watchdog 在事务前终止 Core，pending cycle 在下次启动补偿。旧 route 的任何迟到 event 都不能修改 Run。

## 7. Desktop boundary 与 Renderer

Electron Main 是唯一 shutdown caller。第一次 `before-quit` 保留 Renderer 等待面，禁止 Core 自动重启，发送
一次 v3 request，并等待 report 与 child 真实 exit；重复 quit 复用同一个 Promise。外层 watchdog 只负责 Core
完全失去响应的最终强制结束，不能伪造领域 terminal。

Renderer 只消费 `runtime.state = shutting_down`。它立即建立覆盖当前页面的交互 guard；若关闭在 400ms 内
完成则不显示反馈，超过门槛才显示可聚焦、无操作按钮的 busy modal：“正在安全退出”。modal 说明 Rovai
正在保存本地状态并关闭后台服务；若有尚未完成的 AgentRun，将一并取消，未确认的文件、命令或工具效果
保留为待核对记录。Renderer 不拥有 shutdown request、deadline、进程信号或取消计数。

应用内更新复用同一个 Main 协调器：只有更新动作已经成功进入可退出阶段后才触发 v3；失败时 App/Core
保持运行并允许重试。关闭协调器最终只完成一次 child-exit wait，不再次发起 native quit 协商。
