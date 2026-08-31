---
document_type: protocol-contract
contract: planned-shutdown-v4
authority: planned-shutdown-business-settlement-and-runtime-cleanup
status: accepted
version: 4
source_version: v1.37
last_updated: 2026-09-01
---

# Planned Shutdown v4

本版是文档合同升级，**wire protocolVersion 仍为 3**。继承 [v3](planned-shutdown-v3.md) 的 Main-only request、
十秒 hard deadline、Desktop watchdog、launch/terminal/route barrier、durable cycle 与完整 report shape；不新增协议版本。

## 业务终态与清理分离

持久化 shutdown cycle 后，先调用 [Cancellation Settlement v1](cancellation-settlement-v1.md) 结算 Run 与业务义务，
再等待既有 writer/launch barrier 并关闭 Runtime。barrier 后再结算期间出现的未终态对象并完成 cycle；本次调用的
计数累计两个事务实际新收口的 Run，重试不重复计数。pending cycle 的原有 NULL 计数约束不变，最终完成时才写
计数；若中途进程退出，后续补偿只记录本次新收口数量，先前 Run 的取消审计仍保留。
进程没有及时退出只影响 deadline/清理事实，不将业务 Run 留在 cancelling。

保留 v3 不设置 CampTurn cancel intent 的聚合：必要 Run 中止可使 Turn failed/required_run_incomplete；原 Turn 用户
取消和预算 intent 保持自身优先级。退出允许关闭其受影响 Turn 的渠道输出，不影响历史已完成请求。

未发送 Run cancelled；accepted/unknown 或可能执行的 Run failed/accepted_input_outcome_unknown，禁止自动重发。
取消审计原因仍为 app_shutdown_cancel_all，原更具体原因保留；不在业务事务写 cancel_acknowledged_at。
Runtime 确认清理后才能写该时间。hasUnsettledExternalEffects 独立呈现，不因终态或退出而清除。

## 兼容与报告

持久 protocol 2/3 cycle 的标识不改写，未完成 cycle 仍沿原入口幂等补偿；protocol 2 的 reason 保持
planned_shutdown_cancelled，不伪装成新的 protocol 3 请求。补偿也使用当前统一取消结算，旧历史证据不重写。

报告字段不变。cancelledAgentRunsSettled 表示本次中止事务收口的数量（含因未知而 failed），
unsettledEffectAgentRuns 是其中未知子集；unresolvedExecutions 只数非终态执行，未知效果不计入。
terminalExecutionsSettled 不把业务中止伪装成 Runtime terminal 证据。
