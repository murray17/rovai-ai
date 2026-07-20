# ADR-0003: Execution Runtime

- Status: Accepted
- Scope: IP-03
- Date: 2026-07-20

## Context

v0.01 的 CodexRuntime 只保存一个当前 task/thread/turn，CodexManager 也按 taskId 管理实例。该结构无法在同一进程中可靠分流多个 Conversation 的事件、审批和恢复，也无法阻止旧 Host 或旧执行代际回写新状态。

## Decision

Codex Adapter 默认按 `RuntimeHostKey` 复用 Host：

```text
RuntimeHostKey(adapter, protocolVersion, authScope, processConfigDigest)
→ v0.02 默认最多一个 CodexRuntimeHost
→ 多个 Native Thread
→ 每个 Thread 一个 NativeThreadBinding
```

共享 Host 是 Adapter 托管策略，不是全局 Singleton、持久实体或 Conversation 领域不变量。测试证明共享不安全时，可以改为有限 Host Pool，而不改变领域模型。

`NativeThreadBinding` 至少包含：

```text
conversationId
nativeThreadId
activeAgentRunId
executionEpoch
nativeTurnId
```

Host 拥有内存 `hostInstanceId`。事件进入领域命令前依次校验当前 Host Instance、Thread Binding、Native Turn、AgentRun 和 executionEpoch；无法唯一映射的事件只进入诊断/恢复，不能修改权威状态。

同一 Conversation 最多一个 running/waiting AgentRun。不同 Conversation 可以共享 Host 并行执行。Conversation 持久化当前 `nativeSessionId`；Host、连接和 Registry 可由数据库状态重建。

## Components

- `CodexRuntimeHostManager`：按 RuntimeHostKey 创建、复用、排空和回收 Host。
- `CodexRuntimeHost`：管理一个 App Server 进程/连接和 hostInstanceId。
- `NativeThreadBindingRegistry`：维护 Thread 到 Conversation/Run/Epoch/Turn 的唯一映射。
- `CentralEventDemultiplexer`：统一处理 Response、Notification 和 Server Request 的线程分流。
- `AgentRunScheduler`：扫描完整启动资格、获取执行租约并递增 epoch。
- `ExecutionContextBuilder`：使用冻结配置、水位和显式 continuation 组装输入。
- `RuntimeRecoveryCoordinator`：执行 Host fencing、动作对账、Resume 与 Session 换绑。

## Recovery

```text
确认旧 Host/连接失效
→ fencing hostInstanceId
→ running Run 进入 waiting(runtime_recovery)
→ 已 waiting Run 保留原主要 blocker
→ 对账 Approval / ActionExecution / Runtime Delivery
→ unknown 副作用优先收敛
→ 证明继续不会重复动作
→ 重新取得租约并 executionEpoch++
→ Resume 原 Thread，失败则创建并事务换绑新 Thread
→ 重算 blocker 后继续、等待或终结
```

没有 Token 输出不是 Host 空闲。仅当没有 Native Turn、反向请求、未 ACK Delivery、未确认取消和未关联 Tool Call，且所有状态可持久恢复时，`isHostReclaimable` 才可为真。

## Protocol boundary

- 固定并显式校验支持的 Codex App Server 版本和能力矩阵。
- `authScope` 使用非秘密标识；`processConfigDigest` 由版本化规范配置计算。
- MCP、插件、Codex Home 和进程环境属于 HostKey；Run/Thread 级 cwd、Sandbox、Instructions、模型和工具配置不得串线。
- Adapter 只翻译协议并调用强类型 Gateway，不直接写数据库。
- RT-02 输入清单精确重现尚未定案；当前不得超越冻结水位，也不得声称 Prompt 字节级可重现。

## Acceptance

- 两个 Native Thread 的模型请求可以同时在途。
- 两个 Thread 同时请求 Approval 时，threadId/turnId/actionId 不串线。
- cwd、Sandbox、Instructions、模型和工具上下文互不污染。
- 一个 Thread 的失败、取消、迟到事件不会推进另一个 Thread。
- 杀死 Host/Core 后，两条 Run 能分别恢复、换绑或失败。
- 旧 hostInstanceId 与旧 executionEpoch 的普通输出和命令被拒绝；副作用观察进入 Action 对账。
- 同一 Conversation 的两个 Run 永不同时执行。

## Rejected

- 一 Conversation 一 OS 进程作为领域不变量。
- 全局唯一 CodexRuntimeHost。
- 继续按 taskId 索引 Runtime。
- Host 崩溃后不对账副作用就直接 Resume。
- 只重命名现有单槽 CodexRuntime。
