---
document_type: protocol-contract
contract: run-process-detail-surface-v45
authority: user-authorized-run-continuation-surface
status: accepted
version: 45
source_version: v1.72
last_updated: 2026-10-08
---

# Run Process Detail Surface v45

继承 [v44](run-process-detail-surface-v44.md) 的主线块、工具组、详情分页、历史证据与瞬时根思考反馈规则。
公开 batch Run 的失败／停止卡片增加 [AgentRun Continuation v1](agent-run-continuation-v1.md) 图标入口：
24×24、无可见文字、可访问名称“继续执行”。提交时禁用；受理后的来源卡片恢复可点，状态和输出保持不变。
各次请求／Run 独立显示，不生成后继状态关系或历史执行链。

已知需要新会话时只有一次确认弹窗；实际恢复失败结束当前 Run，再次选择新会话产生新请求。
传输结果未知时保留原 commandId 供核对。waiting Delivery 的可选 `continuationRequest: true` 仅表示
独立排队批次，不表示其来源状态。Renderer 的批次聚合不得跨越续做请求。
