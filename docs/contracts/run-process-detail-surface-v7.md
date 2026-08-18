---
document_type: renderer-contract
contract: run-process-detail-surface-v7
authority: agent-process-detail-placement-and-recovery-surface
status: accepted
last_updated: 2026-08-18
---

# Run Process Detail Surface v7（取消 Run 的活动停止投影）

本合同完整继承 [Run Process Detail Surface v6](run-process-detail-surface-v6.md) 的执行台位置、
Agent selector、Run stage、Evidence、Recovery Blocker、planned-shutdown 与外部效果诚实投影，并替代
v6 作为当前 Renderer 入口。v7 只增加取消 Run 内尚未闭合活动的停止展示。

## 1. 权威边界

`AgentRun.status` 与 Canonical Runtime Activity 的 `phase/outcome` 继续是彼此独立的事实。Renderer
不得因为父 Run 进入 `cancelled` 而修改、回写或伪造子活动的 Canonical `phase`、`outcome`、Evidence、
terminal timestamp 或 external-effect disposition。

## 2. 停止展示投影

当权威 Snapshot 中 `AgentRun.status = cancelled` 时，该 Run 内仍投影为 `running` 的活动行必须：

- 停止旋转、脉冲和运行强调；
- 使用中性停止图形；
- 主状态显示“已停止”。

这是一层由 Run 执行权终止派生的 Renderer 展示，不声称该子操作成功、失败、未执行或已回滚。已经
投影为 `completed`、`failed`、`waiting` 或 `recorded` 的活动保持原状态。Runtime 对同一 operation
明确报告 canonical `outcome = cancelled` 时，同样显示“已停止”。

本地 `cancelling` 阶段继续显示“正在停止…”，不得在权威 Run 终态到达前提前显示“已停止”。

## 3. 未确认效果与详情

Run 的 `hasUnsettledExternalEffects`、Recovery Blocker 和 Evidence 详情继续按 v6/v5 独立展示；“已停止”
不得隐藏“外部效果待确认”，也不得授权自动重试。活动详情可以保留已收到的最后输出或证据，但不得以
缺少终端回执为由重新显示 spinner。

## 4. 验收

- cancelled Run 中最后一个 canonical `progress + unknown` 活动显示“已停止”且没有动画；
- 同一 Run 中已经完成或失败的活动不被覆盖；
- 非 cancelled Run 的 running 活动继续显示“执行中”；
- canonical cancelled 活动显示“已停止”；
- 底部与 Inspector 执行台共享同一投影，在 Porcelain Day 与 Steel Night 中使用相同结构。
