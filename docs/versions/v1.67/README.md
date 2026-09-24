---
document_type: version-overview
version: v1.67
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: true
last_updated: 2026-09-23
---

# Rovai-ai v1.67：Task 去版本化与模型输入精简

前置：[v1.66](../v1.66/README.md)。本版按已确认的 [revision 3](model-context-change-task-versionless.md)
删除 Task 对象版本及更新前提，保留字段补丁、权限、状态机、事务与命令幂等；Agent 四类 Task 结果均省略
`availableActions`。新 Bootstrap 和动态模型输入从源投影省略 `schemaVersion`，覆盖公开 Camp、普通 Camp、
A2A、Single Chat 和重投路径。其他系统协议版本继续由 Core 内部管理。

后续：[v1.68](../v1.68/README.md)。

旧冻结输入、历史审计与用户项目文件保留原样；旧执行不转换或自动重放。Migration 171 只调整当前
Task、AgentRun、Delivery 和上下文证据表结构，保留业务行。

实施范围与验证见[实施计划](implementation-plan.md)；当前取舍见[版本决定](decisions.md)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.66 冻结；本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)、[索引](../README.md)建立唯一 current v1.67 |
| Decisions | 已更新 | [V1.67-D01](decisions.md#v1-67-d01)记录 Task 字段补丁和模型投影 clean break，并同步[当前决定](../../decisions/CURRENT.md) |
| Contracts | 已更新 | [Durable Task v5](../../contracts/durable-task-v5.md)、[Built-in Transport v32](../../contracts/builtin-tool-transport-v32.md)、[ContextManifest v28](../../contracts/context-manifest-evidence-v28.md)、[Run Facts v6](../../contracts/run-facts-v6.md)、[Host Web v4](../../contracts/host-web-v4.md)和[合同索引](../../contracts/README.md) |
| Architecture | 已更新 | [基础不变量](../../architecture/foundational-invariants.md)的 Task 与 Context 边界及[架构导航](../../architecture/README.md)指向新合同 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)说明字段补丁和并发编辑行为 |
| Runtime Activity | 确认无需更新 | Canonical Activity identity、phase/outcome 和 Adapter 映射均不因 Task 字段版本删除而变化 |
| Runtime compatibility | 确认无需更新 | 受支持 Runtime 列表及资格不变；新输入由统一 Core Formatter 生成 |
| Documentation routing | 已更新 | [文档导航](../../README.md)、合同索引和当前决定均路由到本版当前合同 |
| Root README | 确认无需更新 | 项目定位和常青能力不变；本版收敛的是内部 Task 更新和模型投影字段 |
