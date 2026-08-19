---
document_type: renderer-contract
contract: run-process-detail-surface-v12
authority: agent-process-detail-placement-and-direct-stop-surface
status: accepted
last_updated: 2026-08-19
---

# Run Process Detail Surface v12（AgentRun 直接停止）

本合同完整继承 [Run Process Detail Surface v11](run-process-detail-surface-v11.md) 的执行台位置、Tool chronology、
Runtime failure、Recovery Blocker、planned shutdown、取消活动、AgentRun 局部停止与实际 Runtime 模型语义。
v12 只替代 v10 的停止确认层：用户在共享 ExecutionDrawer 点击“停止”后直接提交当前聚焦 AgentRun 的
`agentRuns.cancel`，不再经过 Dialog、Popover 或第二个确认动作。

## 1. 直接停止入口

- Composer 仍是唯一 CampTurn 级停止入口；ExecutionDrawer 顶栏仍是唯一 AgentRun 级停止入口；
- “停止”按钮只在 v10 定义的 `canStop` 条件成立时显示，并保留可访问名称“停止当前运行”；
- 点击按钮立即进入 Run-local 提交态并调用 `agentRuns.cancel`；同一 Run 在提交态、权威取消请求态或结果
  不确定态均不可再次点击；
- 不显示“停止此运行？”确认层、“继续运行”动作、Run ID fact 或 required/optional 后果说明；
- 底部执行台与右侧 Inspector 继续复用同一个 Drawer、Run selection、停止入口和状态投影。

该改动只删除交互步骤，不扩大取消范围。Core 仍只 fence 当前 AgentRun，不写 CampTurn 取消事实、不取消
兄弟 Run，也不创建 CampMessage 或公共时间线消息。

## 2. 权威状态与失败恢复

Renderer 继续以 Snapshot 为权威，本地状态只覆盖请求延迟：

- 点击后立即显示“正在停止…”；
- Snapshot `cancelRequestedAt != null` 继续显示“正在停止…”；
- Snapshot `status == cancelled` 显示“已停止”；
- 确定性拒绝、版本冲突或已终态时清除本地请求态、刷新 Snapshot，并在既有错误面显示原因；
- 超时、断连或结果不确定时显示“正在确认停止状态”，不得恢复按钮、重复提交或先宣称失败。

`required` 与 `optional` 的 Turn 收敛后果完全继承 v10：required cancelled 仍得到
`failed / required_run_incomplete`，optional cancelled 不单独阻止完成。Renderer 不再把这些后果作为
停止前确认文案，但不得改写 Core 的 `recompute_camp_turn` 结果。

## 3. 实际 Runtime 模型

v11 的 default-only 首个实际模型观测、write-once 持久化与 `.execution-run-meta` 原位展示保持不变。
直接停止不得清除、覆盖或伪造已经观察到的模型，也不得因模型未知阻止停止。

## 4. 验收

- 可停止 Run 的顶栏只有一个“停止”按钮，单击直接提交，不挂载 AgentRun 停止确认 Dialog；
- 连续点击不能形成重复可操作状态，Core 幂等与 cancel fence 保持有效；
- required/optional、Turn-level cancellation、Recovery Blocker、确定性拒绝和结果不确定路径按既有权威状态收敛；
- 底部与 Inspector、Day/Night、键盘与 200% zoom 使用同一直接停止交互；
- v11 Runtime 模型展示与 v10 其他执行过程语义无回归。

## References

- [Run Process Detail Surface v11（历史）](run-process-detail-surface-v11.md)
- [Run Process Detail Surface v10（历史）](run-process-detail-surface-v10.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [AgentRun Recovery](../architecture/agent-run-recovery.md)
