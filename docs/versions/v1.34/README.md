---
document_type: version-overview
version: v1.34
lifecycle: historical
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

仅支持明确的 Claude 官方登录与 Codex ChatGPT 登录，原生能力未知即隐藏。不增加通用 Runtime 性能配置。
本机 Claude 2.1.220 原生 firstParty OAuth 登录在套餐字段为空时仍通过入口认证门禁；Codex 0.147.0
未导出 `serviceTierForTurn`，仍隐藏入口。隔离 fixture 验证 wire 和 UI，不据此宣称真实 Fast 付费执行已验证。

修正将三态意图、模型资格与 Run 观测分开：模型变化只清资格缓存，权限变化不影响 Fast，实际绑定变化才失效覆盖。
成员浮层只显示后续执行偏好；运行观测留在对应 Run 的 Evidence/Usage，不回写 Camp。Migration 119
将 schema 72 升到 73，保留已有覆盖，不增加偏好版本号或状态字段。修正验证见实施计划。

本地实现、数据库升级、自动化回归与 Standards / Spec 双轴复核已完成；验收结果见实施计划。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、[实施计划](implementation-plan.md)、[版本索引](../README.md)，v1.33 lifecycle 冻结 |
| Decisions | 已更新 | [V1.34-D01](decisions.md#v1-34-d01)、[当前决定导航](../../decisions/CURRENT.md) |
| Contracts | 已更新 | [Camp Member Fast v1](../../contracts/camp-member-fast-v1.md)、Runtime Launch v29、Usage v4、Camp Open v9 及[合同索引](../../contracts/README.md) |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)、[Runtime Monitoring](../../architecture/runtime-monitoring.md) |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)，保持既有视觉世界 |
| Runtime Activity | 已更新 | Fast 观测保存为对应 Run 的 Execution Evidence，明确排除 Canonical Activity，不进入模型上下文 |
| Runtime compatibility | 已更新 | [Runtime 兼容性](../../runtime-compatibility.md) 记录两个本机版本的 metadata-only 限制 |
| Documentation routing | 已更新 | [docs/README.md](../../README.md)、当前决定/合同路由与[测试说明](../../development/testing.md) |
| Root README | 确认无需更新 | 产品定位、安装与总体 Runtime 支持范围未扩大 |
