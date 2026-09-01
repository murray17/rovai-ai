---
document_type: protocol-contract
contract: run-process-detail-surface-v28
authority: cancelled-run-result-presentation
status: accepted
version: 28
source_version: v1.37
last_updated: 2026-09-01
---

# Run Process Detail Surface v28

完整继承 [v27](run-process-detail-surface-v27.md) 的布局、Evidence、Tool 分组、请求阶段和详情交互。本版采用
[Cancellation Settlement v2](cancellation-settlement-v2.md) 的取消终态。

“正在提交停止请求…”仍只覆盖 IPC 尚未返回的时间。Run-local 或 Turn Stop 返回 Applied 后，Renderer 立即将目标
Run 显示为已取消，并清除该 Run 的本地 `hasUnsettledExternalEffects` 旧值；完整 Snapshot 随后覆盖其余字段。
取消保留的 Input/Action 审计证据不显示“外部效果待确认”，也不改变 Composer、兄弟 Run 或下一轮状态。

Read Side 对 v27 期间由取消写成 `failed / accepted_input_outcome_unknown` 的精确历史形状公开为已取消，因此旧会话
刷新后也使用同一呈现。普通 `recovery_blocked` 的显式结束仍显示失败与结果待确认；Runtime terminal 产生的独立
不确定效果继续按其权威投影显示。IPC 结果未知时仍重读 Core，不由 Renderer 猜测成功。
