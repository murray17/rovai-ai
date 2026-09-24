---
document_type: version-overview
version: v1.69
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-09-24
---

# Rovai-ai v1.69：Command Code 接入

前置：[v1.68](../v1.68/README.md)。本版按已确认的[模型上下文变更说明 revision 3](model-context-change-command-code.md)，为 Command Code 复用现有 `first_payload`：新 Native Session 首次输入发送完整 Bootstrap 与冻结 Dynamic Context，普通精确恢复只发送当次冻结 Dynamic Context。Bootstrap 位于普通用户 Prompt；这是已接受的指令层级差异，不能当作高权限投递或 First-Class 资格。

实施与证据缺口见[实施计划](implementation-plan.md)、[版本决定](decisions.md)和[Command Code Parity Matrix](../../research/command-code-runtime/parity-matrix.md)。目前仅有隔离的 headless 传输与研究证据；正式 Product Runtime Catalog、平台准入和真实账号验收尚未完成。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.68 冻结；本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)和[版本索引](../README.md)建立唯一 current v1.69 |
| Decisions | 已更新 | [V1.69-D01](decisions.md#v1-69-d01)记录普通 Prompt 指令层级差异；[当前决定导航](../../decisions/CURRENT.md)指向其当前架构边界 |
| Contracts | 确认无需更新 | 此阶段复用现有 `first_payload`、Bootstrap v4、公开 Formatter/Manifest 29 与非 batch 26；没有新增 Product Adapter 或冻结证据字段 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md#command-code-研究接入边界)记录候选与正式准入边界 |
| UI | 确认无需更新 | 未开放 Command Code 选择或 Settings；Renderer 合同未改变 |
| Runtime Activity | 确认无需更新 | 内部 NDJSON normalizer 尚未纳入 Product Adapter；Canonical Activity 合同未改变 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md#command-code-研究状态)记录 1.64.0 的研究证据及未准入状态 |
| Documentation routing | 确认无需更新 | [文档导航](../../README.md)已通过唯一 current 版本指针路由，Command Code 研究仍由本版计划和研究目录共同定位 |
| Root README | 确认无需更新 | 尚未形成常青支持能力，项目定位和支持范围不变 |
