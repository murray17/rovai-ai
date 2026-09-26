---
document_type: version-overview
version: v1.71
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: false
last_updated: 2026-09-27
---

# Rovai-ai v1.71：会话、使命与任务提醒

前置：[v1.70](../v1.70/README.md)。Principal 已确认通知交互稿与“会话 / 使命 / 任务”分组，并授权独立 worktree
实现、PR 到 main 及合入。范围包括消息关联的本轮完成、单聊回复、真实使命/任务状态变更、显式来源问题、
偏好筛选、精确导航、同来源提醒合并和一致的新回复小点。实施与验证见[计划](implementation-plan.md)。

Migration 175 将确切 v1.70/schema 124 升级为 v1.71/schema 125；通知 wire schema 9。历史事实与用户设置保留，
不补发旧通知。Bootstrap、ContextManifest、Run Facts、工具权限、调度、预算与模型输入均不改变。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [索引](../README.md)、本概览、[计划](implementation-plan.md)和前版 lifecycle |
| Decisions | 已更新 | [D01](decisions.md#v1-71-d01)及[当前导航](../../decisions/CURRENT.md)记录通知图与执行聚合分离 |
| Contracts | 已更新 | [Notification Episode v9](../../contracts/notification-episode-v9.md)、[Current User Attention v8](../../contracts/current-user-attention-v8.md)和[索引](../../contracts/README.md) |
| Architecture | 已更新 | [通知架构](../../architecture/notification-episodes.md)及[索引](../../architecture/README.md) |
| UI | 已更新 | [提醒界面](../../ui/components/notification-center.md)、[UI 索引](../../ui/README.md)、[设置页策略](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md) |
| Runtime Activity | 确认无需更新 | 不改变 Activity identity、phase、outcome 或 Adapter 映射 |
| Runtime compatibility | 确认无需更新 | 不接入或修改 Harness，不声明新的真实 Runtime 能力证据 |
| Documentation routing | 已更新 | [文档入口](../../README.md)指向新的通知与注意力合同 |
| Root README | 确认无需更新 | 产品定位、支持平台与常青能力范围不变 |
