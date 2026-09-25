---
document_type: version-overview
version: v1.68
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: true
last_updated: 2026-09-24
---

# Rovai-ai v1.68：公共历史按需读取与执行边界提示

前置：[v1.67](../v1.67/README.md)。本版按已二次确认的[模型上下文变更说明 revision 1](model-context-change-public-history-hint.md)，从新公开 Camp Run 移除自动公屏历史投影，完整保留 `RUN_INPUT`，在 `RUN_FACTS.historyHint` 冻结上一次有效接受执行前的公屏边界。`camp.read` 默认返回 20 条，显式上限为 100 条并保持诚实分页。旧格式执行不续派、恢复、转换或重播；已有业务行及历史审计原字节保留。

后续：[v1.69](../v1.69/README.md)。

实施范围及验收见[实施计划](implementation-plan.md)，取舍见[版本决定](decisions.md)。
实现和定向验证已完成；完整通用 Gate 因基线合同失败和候选评测清单引用旧自动历史测试而证据不足，
两次报告及一项真实历史定位 Case 的结果见[独立变更说明](model-context-change-public-history-hint.md#实施与验证记录2026-09-23)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.67 冻结；本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)及[索引](../README.md)建立唯一 current v1.68 |
| Decisions | 已更新 | [V1.68-D01](decisions.md#v1-68-d01)记录按需历史、接受水位及旧执行边界，并路由到[当前决定](../../decisions/CURRENT.md) |
| Contracts | 已更新 | [Run Facts v7](../../contracts/run-facts-v7.md)、[ContextManifest v29](../../contracts/context-manifest-evidence-v29.md)、[Profile 9](../../contracts/context-delivery-profile-v9.md)、[Camp History v9](../../contracts/camp-history-v9.md)和[合同索引](../../contracts/README.md) |
| Architecture | 已更新 | [Context 基础不变量](../../architecture/foundational-invariants.md)与[Public Camp 主链](../../architecture/public-a2a-message-delivery.md)记录新历史选择和 schema 172 边界 |
| UI | 确认无需更新 | Renderer 不增加历史提示或新操作；变化只发生于 Agent 模型输入和内置 CLI |
| Runtime Activity | 确认无需更新 | Canonical Activity identity、phase/outcome 和 Adapter 映射均不变 |
| Runtime compatibility | 确认无需更新 | 受支持 Runtime、模型及平台准入不变；新输入仍由统一 Core Formatter 生成 |
| Documentation routing | 已更新 | [文档导航](../../README.md)、合同索引和当前决定指向本版当前合同 |
| Root README | 确认无需更新 | 项目定位与常青能力不变，本版收敛的是内部上下文投递与读取批量 |
