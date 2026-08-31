---
document_type: protocol-contract
contract: run-process-detail-surface-v27
authority: authoritative-cancellation-result-presentation
status: accepted
version: 27
source_version: v1.37
last_updated: 2026-09-01
---

# Run Process Detail Surface v27

完整继承 [v26](run-process-detail-surface-v26.md) 的布局、Evidence、Tool 分组和详情。只更新 Run-local 与 Turn Stop
的请求阶段显示，使用 [Cancellation Settlement v1](cancellation-settlement-v1.md) 的提交结果。

“正在提交停止请求…”仅覆盖本地 IPC 尚未返回的时间。收到 Applied 后直接合并 Core 返回的实际 Run/Turn 终态，
清除本地等待，并刷新权威投影；failed/accepted_input_outcome_unknown 不伪装成 cancelled。已终态优先于残留的本地
cancel/confirm 标记。cancel_requested_at 或 Runtime 尚未清理不再产生停止 spinner。

IPC 结果未知时沿用重新读取权威状态的确认路径；不能捏造成功。未知效果保留“外部效果待确认”，不开放自动重试。
普通单 Run Stop 不关闭其他同轮执行或渠道输出，停止按钮不再增加确认弹窗。
