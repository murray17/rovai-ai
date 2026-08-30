---
document_type: version-overview
version: v1.34
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: false
last_updated: 2026-08-31
---

# Rovai-ai v1.34：Camp 队员 Fast 覆盖

在成员浮层中保存当前 Camp、当前成员、当前 Runtime 绑定的 Fast / Standard / 继承选择；每次新执行
冻结并发送原生覆盖。已有 Run、全局配置和 Native Thread 默认不改变。

前置版本：[v1.33](../v1.33/README.md)。[实施计划](implementation-plan.md)；[决定理由](decisions.md)。

仅支持明确的 Claude 订阅登录与 Codex ChatGPT 登录，原生能力未知即隐藏。不增加通用 Runtime 性能配置。
本机 Claude 2.1.220 的 auth status 未明确订阅类型，Codex 0.147.0 未导出 `serviceTierForTurn`，因此本机
两者当前均不会展示 Fast。隔离 fixture 验证 wire 和 UI，不据此宣称真实 Fast 付费执行已验证。

本地实现、数据库升级、自动化回归与 Standards / Spec 双轴复核已完成；验收结果见实施计划。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、[实施计划](implementation-plan.md)、[版本索引](../README.md)，v1.33 lifecycle 冻结 |
| Decisions | 已更新 | [V1.34-D01](decisions.md#v1-34-d01)、[当前决定导航](../../decisions/CURRENT.md) |
| Contracts | 已更新 | [Camp Member Fast v1](../../contracts/camp-member-fast-v1.md)、Runtime Launch v29、Usage v4、Camp Open v9 及[合同索引](../../contracts/README.md) |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)、[Runtime Monitoring](../../architecture/runtime-monitoring.md) |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)，保持既有视觉世界 |
| Runtime Activity | 确认无需更新 | Fast 为独立 metadata，不增加或改变 Canonical Activity/Evidence 映射 |
| Runtime compatibility | 已更新 | [Runtime 兼容性](../../runtime-compatibility.md) 记录两个本机版本的 metadata-only 限制 |
| Documentation routing | 已更新 | [docs/README.md](../../README.md)、当前决定/合同路由与[测试说明](../../development/testing.md) |
| Root README | 确认无需更新 | 产品定位、安装与总体 Runtime 支持范围未扩大 |
