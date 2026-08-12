---
document_type: renderer-contract
contract: run-process-detail-surface-v4
authority: agent-process-detail-and-accepted-input-recovery-blocker-surface
status: accepted
last_updated: 2026-08-12
---

# Run Process Detail Surface v4（Accepted Input 结果确认）

本合同以 [Run Process Detail Surface v3](run-process-detail-surface-v3.md) 的 Agent 级连续过程、唯一
Execution Drawer、任务/队员 Inspector、Approval Dock 与 CampTurn Stop 为基础，并替代 v3 作为当前
Renderer 入口。v3 的未变条款继续构成本合同；本版本只增加 Accepted-Input Recovery Blocker 投影和
显式收敛动作。

## 1. 状态投影

`AgentRun.status = waiting` 且 `waitReason = recovery_blocked` 时：

- Run Pulse 与 stage 状态使用“结果待确认”，danger tone，并提供非颜色文本；
- Drawer 不显示 spinner、“恢复中”或任何暗示自动动作仍在执行的动画；
- Run 仍保留在执行过程入口中供用户处理，但不计入“位执行中”或“当前有进行中 AgentRun”汇总；
- blocker 只出现在该 Run 自己的 disclosure，不进入公共消息、Task、Inspector 或 Approval Dock；
- 后台恢复、重载与重进 Camp 仍不得自动打开 Drawer 或抢 Composer 焦点。

## 2. Blocker 内容与动作

Drawer 必须说明：Runtime 已接受任务；Rovai 重启后无法确认最终结果；为避免重复执行不会自动重发；
用户应先检查当前 Workspace，再结束运行并按需发送新的后续任务。

该 surface 只有一个动作“结束此运行”，调用 `agentRuns.resolveRecoveryBlocker` 的 exact Run/version。
提交期间按钮显示“正在结束…”并禁用。成功后刷新 Snapshot，Run 显示失败，普通 Composer 恢复可用并获得
焦点；Renderer 不自动发送原正文、不自动创建 successor、不标记成功、不生成最终消息。

请求失败时保留 Drawer 与 blocker，使用 App 现有错误 surface 告知用户；不得以本地 optimistic state
隐藏 blocker。

## 3. 视觉、响应式与无障碍

- 使用当前 Neutral Porcelain + Steel token；danger border/background 表示结果歧义，不引入新主题；
- blocker 使用具名文本、按钮和 `role=status`，语义不依赖颜色；
- 文案与动作可以换行，在 `1040×700`、200% zoom 和隐藏 Inspector 时仍可达且不产生横向滚动；
- 不使用逐字 `aria-live`、spinner 或自动滚动伪装恢复进度；
- v3 的 Drawer region、resize separator、sticky-bottom、Escape/focus return 和 reduced-motion 条款继续有效。

## 4. 数据边界

Renderer 只消费 CampSnapshot 的真实 Run state/version，并提交版本化 Core 命令。它不查询 Runtime Host、
SQLite、进程状态或 Workspace diff 来猜测旧 Turn 结果。详情页颜色、Agent 身份视觉与 blocker 语义互不
推导。
