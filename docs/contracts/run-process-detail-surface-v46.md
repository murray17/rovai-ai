---
document_type: protocol-contract
contract: run-process-detail-surface-v46
authority: user-authorized-run-continuation-surface
status: accepted
version: 46
source_version: v1.72
last_updated: 2026-10-08
---

# Run Process Detail Surface v46

继承 [v45](run-process-detail-surface-v45.md) 的全部展示规则，包括终态文本定稿的一次性退避重试。
仅替代会话确认交互：24×24 继续图标直接提交，不显示“使用新会话继续”弹窗，不要求第二次点击。
Core 按 [AgentRun Continuation v2](agent-run-continuation-v2.md) 自动复用或降级会话。

提交中禁用、可访问名称、键盘焦点、响应未知时复用 commandId、受理后可再次提交、来源 Run 状态不变、
独立排队批次和当前工作区保留均不变。真实启动/执行失败继续由原错误展示路径呈现。
