---
document_type: architecture
architecture: planned-shutdown
authority: planned-core-lifecycle-and-generation-local-terminal-settlement
last_updated: 2026-08-12
---

# Planned Shutdown

本文组合计划内退出、重启和更新时的 Core 生命周期结构。长期边界由
[ADR-0168](../adr/0168-planned-shutdown-preserves-runtime-terminal-authority.md)拥有，精确 wire、字段、
幂等和 deadline 语义由 [Planned Shutdown v1](../contracts/planned-shutdown-v1.md)拥有。异常崩溃、强杀、
断电和下一 generation 的 accepted-input 分类仍由 [AgentRun Recovery](agent-run-recovery.md)负责。

## 1. 三个独立准入与围栏面

`CoreLifecycleCoordinator` 组合三个 generation-local 深模块：

- **Execution Launch Admission** 覆盖候选领取前到 active execution 已注册、Runtime acquire、input
  prepare 与 prompt send 的确定交接点。`beginDrain` 线性化关闭它并等待已进入者完成交接；此后消息、
  工具结果可以继续形成 queued 责任，但当前 generation 不再 launch。
- **Terminal Settlement Admission** 只在 draining 中为匹配 live route 的 terminal observation 创建短命、
  不可序列化的 guard。deadline 的 `closeAndDrain` 阻止新 guard，并等待已经进入的 terminal 事务及其
  correctness-critical 同步结算完成。
- **Live Runtime Route Admission** 为每个 Codex/ACP callback 和 one-shot acceptance/terminal 提交创建
  短命 guard。它在整个 drain window 保持开放；terminal admission 收口后再线性化关闭，等待
  已进入 callback 完成，使 deadline 后的队列事件无法继续写领域状态。

这些准入面都不在 `beginDrain` 时关闭普通领域存储。Built-in Tool、Adapter event 和 terminal route 在
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

`beginDrain` 完成 launch handoff 后读取 registry 快照，并发把每个 handle 标为
`planned_stop_requested` 后调用 Adapter 的原生 interrupt/cancel。RPC 成功只更新控制面观察，不移除
handle，也不结算 Run。

## 3. Terminal Settlement

Adapter event route 先完成既有 host/session/turn correlation，再向 Terminal Settlement Admission 请求
guard。guard 再绑定当前 Core generation、Run、epoch、live route、Adapter correlation 与
`planned_stop_requested`。同一 terminal fingerprint 的重复观察幂等；同一 binding 的冲突 terminal
被 fence 并留下诊断。

- `succeeded` 继续调用普通成功事务，不能绕过 pending Approval、Action、Runtime Delivery 或 input
  blocker；
- `failed | cancelled` 调用 planned-shutdown abortive settlement。该事务先关闭 Run-local obligation，
  再原子写 AgentRun terminal source/reason、目标 Message Delivery 与 CampTurn 聚合；
- `cancelled` 额外要求 handle 已经记录 `planned_stop_requested`。

Abortive effect closure 只在已有可靠 terminal 后运行：未 dispatch 的 Action 关闭为 `not_executed`；可能
dispatch 的 Action 进入 `unknown/reconciler`；pending Approval 以 planned-shutdown 原因关闭；未完成的
Runtime Delivery 变为 `safely_closed`；prepared input 变为 `not_accepted`；accepted input 证据不改写。

Skill projection、Git observation、MCP 清理等可延后工作不占用 terminal guard，也不阻塞 deadline 的
正确性边界。

## 4. Deadline 与 Reap

Core 使用一个 monotonic 全局 deadline：

```text
close execution launch admission
→ stop Scheduler / recovery launch / background Runtime launch
→ mark and stop current-generation active handles
→ preserve terminal, Built-in IPC and Adapter event routes
→ wait for reliable terminal settlement
→ close and drain terminal settlement admission
→ close and drain live Runtime routes; fence Built-in leases
→ stop and reap unresolved Runtime processes
→ stop event processors and remaining workers
→ flush stdout and exit
```

deadline 之后仍非终态的 Run 不被写成 cancelled 或 failed。旧 route 被 fence 后的任何 event 都不能修改
Run；下一次启动按 ADR-0164 分类 accepted input。

## 5. Desktop Boundary

Electron Main 是唯一调用方。`CoreClient.shutdown()` 在第一次调用时禁止自动重启、发送一次
`core.shutdown`、等待 shutdown report，再等待子进程真实 exit；重复调用复用同一个 Promise。外层
watchdog 只在 Core 协议未按期结束时依次发送 SIGTERM 和 SIGKILL。Preload/Renderer 不暴露此方法。
