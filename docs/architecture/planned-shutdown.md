---
document_type: architecture
architecture: planned-shutdown
authority: planned-core-lifecycle-and-generation-local-terminal-settlement
last_updated: 2026-08-13
---

# Planned Shutdown

本文组合计划内退出、重启和更新时的 Core 生命周期结构。长期边界由
[ADR-0168](../adr/0168-planned-shutdown-preserves-runtime-terminal-authority.md)拥有，精确 wire、字段、
幂等和 deadline 语义由 [Planned Shutdown v1](../contracts/planned-shutdown-v1.md)拥有。异常崩溃、强杀、
断电和下一 generation 的 accepted-input 分类仍由 [AgentRun Recovery](agent-run-recovery.md)负责。

## 1. 单调生命周期与三个准入面

`CoreLifecycleCoordinator` 使用单调 lifecycle phase 表达一次 generation-local 受控关闭：

```text
accepting → closing_launch → draining → terminal_closed
```

`closing_launch` 立即拒绝新的 execution launch，但尚未改变 terminal settlement 语义。它先等待已经
进入 launch critical section 的执行完成 route handoff 或在 input 尚未 accepted 时安全退出；只有该
writer barrier 完成、active registry 的 route binding 已稳定后才进入 `draining`。因此在
`closing_launch` 到达的 terminal 仍走普通 terminal 路径，任何看到 `draining` 的 terminal handler 都能
依赖“不会再有 binding 正在建立”的 happens-before。真实 route mismatch 在 `draining` 中仍是最终
identity fence，不能被解释为可等待或重试的 handoff。

coordinator 在这个 lifecycle 内组合三个 generation-local 准入面：

- **Execution Launch Admission** 覆盖候选领取前到 active execution 已注册、Runtime acquire、input
  prepare 与 prompt send 的确定交接点。进入 `closing_launch` 线性化关闭它并等待已进入者完成交接；
  route binding 写入先于 launch permit 释放。此后消息、工具结果可以继续形成 queued 责任，但当前
  generation 不再 launch。
- **Terminal Settlement Admission** 只在 draining 中为匹配 live route 的 terminal observation 创建短命、
  不可序列化的 guard。deadline 的 `closeAndDrain` 阻止新 guard，并等待已经进入的 terminal 事务及其
  correctness-critical 同步结算完成。
- **Live Runtime Route Admission** 为每个 Codex/ACP callback 和 one-shot acceptance/terminal 提交创建
  短命 guard。它在整个 drain window 保持开放；terminal admission 收口后再线性化关闭，等待
  已进入 callback 完成，使 deadline 后的队列事件无法继续写领域状态。

这些准入面都不在 `closing_launch` 或 `draining` 时关闭普通领域存储。Built-in Tool、Adapter event 和 terminal route 在
drain window 内继续存活，
从而允许当前 Runtime 提交工具结果、CampMessage 和可靠终态。Core 收到 shutdown request 后不再读取新的
Main request；此前已经进入后台 request set 的领域写入最多等待到同一 deadline，不能因为进入 draining 就被
无条件丢弃。这些 request 与 planned stop、Runtime terminal 等待并行收口，不能成为向 active execution 发出
planned stop 的前置条件。deadline 到达后中止尚未完成的 request 也不产生 AgentRun terminal 事实。

## 2. Active Execution Registry

Scheduler 在 claim 前取得 launch permit；claim 成功后把当前 generation 的 active execution 注册为唯一
handle。handle 绑定 Run、epoch、Adapter、当前 route identity 和 Adapter Turn correlation；Provider Turn
ID 是 Adapter 可选的增强证据。登记与 prompt send 之间仍受 launch permit 保护，因此 drain 不能遗漏
一个已经跨过 claim、但尚未完成 route handoff 的执行。

进入 `draining` 的 transition 完成 launch handoff barrier 后读取 registry 快照，并发把每个 handle 标为
`planned_stop_requested` 后调用 Adapter 的原生 interrupt/cancel。RPC 成功只更新控制面观察，不移除
handle，也不结算 Run。

## 3. Terminal Settlement

Adapter event route 先完成既有 host/session/turn correlation，再向 Terminal Settlement Admission 请求
guard。guard 再绑定当前 Core generation、Run、epoch、live route、Adapter correlation 与
`planned_stop_requested`。同一 terminal fingerprint 的重复观察幂等；同一 binding 的冲突 terminal
被 fence 并留下诊断。

- `succeeded` 继续调用普通成功事务，不能绕过 pending Approval、Action、Runtime Delivery 或 input
  blocker；
- `failed | cancelled` 调用 planned-shutdown abortive settlement。只要 generation-local guard 有效，
  该路径接受仍持有 live route 的 `running | waiting` Run；事务先关闭 Run-local obligation，再原子写
  AgentRun terminal source/reason、目标 Message Delivery 与 CampTurn 聚合；
- `cancelled` 额外要求 handle 已经记录 `planned_stop_requested`。

`waiting/recovery_blocked` 等没有当前 generation live route 的 Run 无法获得 guard；允许 live `waiting`
Run 结算不会扩大异常恢复或普通 cancellation authority。success 继续使用普通 blocker，不能借 abortive
settlement 绕过 waiting obligation。

Abortive effect closure 只在已有可靠 terminal 后运行：未 dispatch 的 Action 关闭为 `not_executed`；可能
dispatch 的 Action 进入 `unknown/reconciler`；pending Approval 以 planned-shutdown 原因关闭；未完成的
Runtime Delivery 变为 `safely_closed`；prepared input 变为 `not_accepted`；accepted input 证据不改写。

terminal guard 与外层 Runtime route guard 只覆盖 route/correlation 校验、correctness-critical 前置读取、
AgentRun terminal transaction，以及 transaction 成功后的 active → settled registry transition/notification。
active handle 收口后立即同时释放两个 guard。Renderer event emit、Skill/MCP reconciliation、
Adapter detach/complete/release 等可延后工作位于 guard 外，并可在 deadline 收口时中止。

## 4. Deadline 与 Reap

Core 使用一个 monotonic 全局 deadline：

```text
enter closing_launch and close execution launch admission
→ stop Scheduler / recovery launch / background Runtime launch
→ finish launch handoff barrier and enter draining
→ mark and stop current-generation active handles
→ preserve terminal, Built-in IPC and Adapter event routes
→ wait for reliable terminal settlement
→ before the reserved cleanup budget, close terminal and live-route admission
→ abort tracked guard holders and drain only until the hard deadline
→ fence Built-in leases and boundedly reap unresolved Runtime processes
→ boundedly stop event processors and remaining workers
→ flush stdout and exit
```

Core 必须从总窗口中预留 fence、abort、reap、worker 与 stdout 收口预算，terminal wait 不能占满整个窗口。
launch/terminal/route barrier、task abort/join、Runtime shutdown/reap、worker join 与 stdout flush 都不得在
hard deadline 后继续无界等待。若 guard 没有及时释放，Core 关闭新 admission、abort 持有它的 tracked task，
并只等待到同一 deadline；此后只允许一个固定、严格有界的 process-runtime teardown grace，其间不得
再做领域写入、等待 guard、Runtime graceful shutdown 或 worker join。该 grace 的精确值是位于 Desktop
outer watchdog 内的实现常量，不构成第二个领域结算窗口。

deadline 之后仍非终态的 Run 不被写成 cancelled 或 failed。旧 route 被 fence 后的任何 event 都不能修改
Run；下一次启动按 ADR-0164 分类 accepted input。Desktop watchdog 仍是 Core 完全失去响应时的最终兜底，
不是普通 callback、cleanup 或 reap 卡住时的主要收口机制。

## 5. Desktop Boundary

Electron Main 是唯一调用方。`CoreClient.shutdown()` 在第一次调用时禁止自动重启、发送一次
`core.shutdown`、等待 shutdown report，再等待子进程真实 exit；重复调用复用同一个 Promise。外层
watchdog 只在 Core 协议未按期结束时依次发送 SIGTERM 和 SIGKILL。Preload/Renderer 不暴露此方法。
