---
document_type: architecture
architecture: agent-run-recovery
authority: agent-run-session-native-turn-and-isolation-boundaries
last_updated: 2026-10-08
---

# AgentRun Recovery

本文描述 App/Core 持续运行期间的运输恢复、Core 重启后的执行收口，以及 AgentRun 终态与旧执行隔离之间的边界。
当前字段和行为由 [Accepted Input Recovery v8](../contracts/accepted-input-recovery-v8.md)、
[Message Delivery v11](../contracts/message-delivery-v11.md)、
[Network Interruption Recovery v2](../contracts/network-interruption-recovery-v2.md) 和
[Planned Shutdown v8](../contracts/planned-shutdown-v8.md)拥有。

## 1. 四个独立事实

```text
AgentRun durable state
  ├─ Runtime Input Delivery：prepared / accepted / delivery_unknown
  ├─ Native Session / Native Turn：由 Provider 与 Adapter 证明连续性
  ├─ external effect evidence：Action、Approval、工具与文件效果
  └─ execution isolation：旧进程/turn 是否已停止并失去继续产生效果的能力
```

AgentRun 终态只说明本次业务执行已经结算，不证明旧进程已经停止。Native Session 更换只隔离后续会话，也不证明
旧进程无法继续写文件或产生外部效果。Scheduler 因此同时检查 Run/Delivery 状态和 Adapter cleanup/isolation 事实。

## 2. 仅限明确未接受的运输恢复

运行中网络恢复不扫描历史失败，不创建 successor Run，也不复制输入。只有严格网络分类且当前 epoch 输入可证明
`not_accepted`、不存在未决副作用时，Core 才能在同一 AgentRun、同一冻结 ContextManifest 和同一输入集合内继续运输。

generation-local `NetworkRecoveryQueue` 使用固定 `1, 2, 3, 5, 10, 15, 30, 30...` 秒退避。online 与 system
resume 只提前唤醒检查；每次 attempt 都重验 Run/version/epoch、成员、授权、取消、Input Delivery 与未决效果。
Runtime 原生重试存在时仍保持唯一 owner。只有匹配当前 binding/epoch 的 accepted ACK 才证明输入真正被接受。

accepted、delivery_unknown、未决 Action/Approval 或身份变化都关闭自动运输恢复。Core 不因 `retryable` 文本、进程消失、
静默或连接重建而重发可能已经执行的输入。

## 3. accepted / unknown 的自动失败收口

Runtime 已接受输入但最终结果无法对账时，Core：

1. 保留原 ContextManifest、输入投递、Action、工具、文件和外部效果证据；
2. 将 AgentRun 结算为失败，并在内部记录 `accepted_input_outcome_unknown`；
3. 禁止原输入自动或手工重放；
4. 启动既有 Adapter stop/cleanup；
5. 在隔离确认前阻止相关后继 dispatch。

主界面把它作为普通红色执行失败展示，不要求用户理解 “unknown” 状态，提供用户主动继续图标；不提供手工释放清理门禁。
新的用户消息只创建新的 waiting Delivery；它不替代对旧结果的事实判断。

Core 重启执行同一分类。pending planned-shutdown cycle 先按其 durable cancel-all intent 收口；其余非终态 Run 再按
Input Delivery 与 effect evidence 判断。重复启动不得增加执行次数、改写旧终态、重分页上下文或把 accepted 输入重新入队。
历史 Formatter/Manifest 和 receipt 只读保留，不能用新 Formatter 重新格式化后 dispatch。

## 4. Cleanup、lane 与 execution root

Run 可以先进入失败或取消终态，但 `(CampId, AgentId)` lane 只有在旧执行隔离被 Adapter 确认后才能继续 claim。
隔离未确认时，后继输入保持 Delivery，不提前创建一个注定无法执行的 AgentRun。

共享 execution root 的保护只在故障窗口生效：旧执行仍可能写该 root 时，暂缓同 root 的新 dispatch；正常执行之间不因
共享 root 建立日常互斥。没有输出、撤销 Core 写权限、用户确认或新 Session 都不是清理证明。cleanup 完成后，Scheduler
按普通 FIFO 规则继续；unknown 后默认使用新 Native Session，除非 Adapter 已能证明旧 native turn 结束。

这是一条失败后的临时调度门禁，不是 Camp pause、工作区锁管理器或新的暂停/恢复产品。

## 5. 精确 Stop

用户 Stop 只接受 `agentRunId + version`，以 CAS 停止精确 Run。目标已终态或版本变化时返回
`stale/already-terminal`，不得误停 successor。Stop 不暂停队列、不取消未 claim Delivery，不自动创建续做请求。

取消事务保留 accepted/delivery_unknown 与可能已执行的效果证据，并请求 Adapter cleanup。只有 cleanup 确认后，后续
Delivery 才按正常调度领取。计划关闭复用同一清理事实，但其 durable cancel-all cycle、writer/route barrier 和 report
仍由 Planned Shutdown 拥有。

## 6. 证据与展示

- accepted 回执只证明 Runtime 接受过整批输入，不证明模型完成、工具成功或产生可靠终态；
- Runtime correlation ID 不自动等于可重连的 Provider Turn ID；
- ContextManifest、Execution Evidence、Git observation 和 workspace 现场不因失败或 cleanup 删除；
- UI 只给出可操作的失败/停止状态，诊断与审计仍保留精确 input outcome 和 isolation 证据；
- Task、Mission、Automation occurrence 与 ChannelDelivery 各自结算，不从 Run 失败自动推断业务完成。

## 7. Codex Host 完成与失败

[Runtime Launch v49](../contracts/runtime-launch-and-verification-v49.md)把原生结果、业务交付和进程回收分开。
Codex 原生 completed 才申请 warm；最终失败、取消和中断通过既有清理 worker 停止，错误是否可分类不影响资格。
终态事务与 Delivery claim 共享数据库边界，清理门禁先于后继 claim；等待进程退出不持有全局锁。

Fleet 的小型释放结果区分复用、回收、租约不存在和回收未确认。Codex 进程先纳入 Fleet 再初始化；停止未确认
保留受管记录和容量。既有 owner record 记录 Run/epoch 及确认回收回执，数据库 ACK 后清除对应证明。
这只是原有停止操作的证据，不是独立调度器、Cleanup Coordinator 或持久化 Native Outcome。

可信失败后可精确恢复原生 Thread；普通执行的恢复错误或 ID 不符仍明确失败。用户主动续做按
[Runtime Launch v53](../contracts/runtime-launch-and-verification-v53.md)，仅在本次输入尚未投递时允许一次新 Thread
降级。输入结果未知继续沿用第 3 节的隔离和默认轮换。正常成功不退化为每轮冷启动，也不增加输入重放。

## 8. 用户授权的独立续做

[AgentRun Continuation v3](../contracts/agent-run-continuation-v3.md) 是新的 User 授权。
命令事务持久化内部授权、来源事实和 waiting Delivery；续做来源没有 message 外键，
不创建消息记录或推进公开消息序号。独立队列序号保持 FIFO，已生成的公开记录保留原样；
唯一 Scheduler 在旧执行清理完成后领取。
原 Run 的业务输入集合限定范围，现有 Context builder 重建当前平台事实，不追加证据或恢复教学。
同一来源可以多次主动继续，状态互不关联；幂等只绑定单次请求。会话兼容时复用当前绑定，换会话保留工作区。
点击继续直接授权新执行，无需单独确认新会话。领取时未知 native turn 自动轮换；后续同一绑定的可信
成功完成可消除更早未知结果对会话选择的影响。兼容判断复用 Runtime，实际恢复失败仅在本次输入尚未
投递时允许一次已有路径的新会话降级；替换失败仍结束，普通运输恢复不因本功能扩大。
