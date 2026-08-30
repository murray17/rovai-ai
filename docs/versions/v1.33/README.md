---
document_type: version-overview
version: v1.33
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: false
last_updated: 2026-08-30
---

# Rovai-ai v1.33：Camp 连续消息

用户在 Camp 执行期间可以提交下一轮输入，按顺序自动发送，并在发布前编辑或删除。
这是 next-turn queue；没有 Runtime mid-run 注入、Pending 附件、自动重试、重排、合并或持久 working copy。
本地实现、自动化回归、真实 Runtime 验证和开发包构建已完成，界面独立复核结论为 ship。
最终原生鼠标与焦点复验受工具故障限制，夜间、小窗口和 200% 缩放尚未补齐最终截图；
用户验收及主线合入尚未完成，具体证据边界见实施计划。

前置版本：[v1.32](../v1.32/README.md)。

- [实施计划与验证记录](implementation-plan.md)
- [版本决定](decisions.md)
- [Pending Camp Input v1](../../contracts/pending-camp-input-v1.md)

不更改 Prompt、Profile、CLI 教学或模型输入协议；正式消息继续使用已有 Context 管线。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、实施计划与版本索引；v1.32 冻结 |
| Decisions | 已更新 | [V1.33-D01](decisions.md#v1-33-d01) 记录轻量私有准入和无 working copy 的取舍 |
| Contracts | 已更新 | Pending Camp Input v1、Camp Composer Draft v6、Camp Message Send v15 |
| Architecture | 已更新 | [Composer 架构](../../architecture/camp-composer-draft.md) 与基础不变量 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md) 的队列、编辑、停止和附件边界 |
| Runtime Activity | 确认无需更新 | 不修改 Runtime 事件或 Canonical Activity 映射 |
| Runtime compatibility | 确认无需更新 | 使用既有 Runtime 验收消息顺序，不扩大 Runtime/平台支持声明 |
| Documentation routing | 已更新 | 文档入口、合同索引和当前决定导航 |
| Root README | 确认无需更新 | 产品定位、安装和支持范围不变 |
