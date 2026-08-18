---
document_type: version-overview
version: v1.13
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-19
---

# Rovai-ai v1.13：AgentRun 实际 Runtime 模型展示

> 当前状态：合同、Migration、十 Runtime 观测、Read Model 与共享 ExecutionDrawer 已完成，并通过版本级门禁、
> 真实打包 App UI 验收与本地交付检查。
>
> 前置版本：[v1.12 AgentRun 局部停止](../v1.12/README.md)。v1.12 已完成并冻结为 historical。
>
> 后续版本：[v1.14 Windows x64 产品实现与资格闭环](../v1.14/README.md)。

## 版本目标

当队员使用“Agent 运行时默认”模型策略时，在对应 AgentRun 的执行台元信息中展示 Runtime 实际返回的首个
可信模型。观测不到时继续显示“Agent 运行时默认”；固定模型不增加本版展示。观测只为单次 Run 提供可解释
的展示事实，不改变成员配置、模型目录、调度输入或 Runtime 行为。

## 交付范围

### 十 Runtime 原生观测

- Codex 从 thread start/resume 的结构化 response 读取顶层 `model`；
- OpenCode、GitHub Copilot、Kiro、Qoder、CodeBuddy、Qwen Code 与 TRAE 从 ACP Session 的
  `models.currentModelId` 或 model config option `currentValue` 读取；
- Claude Code 只接受通过 Session identity 校验的 `system/init.model`；
- Antigravity 只接受结构化 init event 中的明确 model 字段；
- 不从模型目录、请求参数、保存配置、usage 或文本输出推断实际模型。

### 持久化与投影

- Migration 96 为 `agent_run` 增加 nullable `runtime_observed_model_id`；Data Contract 提升为 v1.13，
  projection schema 提升为 51；
- 只有 `runtime_default` Run 可以按 `agent_run_id + execution_epoch` 写入首个非空、有界观测；后续同值或
  换模均不覆盖，固定模型观测被忽略；
- 首次写入增加 Run version 并追加 `agent_run.runtime_model_observed`；观测缺失或非法不会使 Run 失败；
- `AgentRunView.runtimeModel` 区分固定模型、尚未观察的默认策略与已观察的默认策略；完整 Read Model schema
  提升为 32，Camp Open schema 提升为 3。

### 共享 ExecutionDrawer

- 每个 Run 的既有 `.execution-run-meta` 原位展示模型，不增加 Drawer 顶部、Toast 或第二套入口；
- 默认未观察显示“模型 Agent 运行时默认”，观察成功显示“模型 {modelId} · 默认”；
- 长模型 ID 单行省略、可聚焦并通过 title 恢复全文，底部与 Inspector 复用同一组件和状态；
- 模型观测事件只触发当前 Camp projection 刷新，不进入 CampMessage 或公共时间线。

## 明确不做

- 不处理固定模型的额外展示；
- 不追踪或展示 Run 中途换模，只保留第一个可信模型；
- 不把 Runtime 默认模型写回成员配置或模型目录；
- 不因 Runtime 未提供、提供空值或提供非法模型 ID 而改变 Run 终态；
- 不从交互稿引入新的执行台结构。

## 数据与兼容性

本版从 Data Contract v1.10 / projection schema 50 / migration 95 单向迁移到 v1.13 / schema 51 / migration 96。
新列为 nullable；历史 Run、无法观测的 Runtime response 与固定模型 Run 均保持无观测值。Renderer 只消费新的
Read Model shape，不建立旧 schema 双读。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.12 冻结为 historical；本概览、实施计划与版本索引建立唯一 current v1.13。 |
| Decisions | 已更新 | [V1.13-D01](decisions.md#v1-13-d01)记录配置策略与 Run 观测分离、Runtime-native evidence 及首值冻结。 |
| Contracts | 已更新 | [Run Process Detail Surface v11](../../contracts/run-process-detail-surface-v11.md)与[Camp Open Projection v3](../../contracts/camp-open-projection-v3.md)冻结采集、字段与展示语义。 |
| Architecture | 已更新 | Runtime Catalog Boundaries、基础不变量与 Camp Open Read Path 明确配置/观测权威和 schema 3 路由。 |
| UI | 已更新 | Camp 会话工作区在既有 Run meta 中增加默认策略的未观察/已观察两态，固定模型不新增字段。 |
| Runtime Activity | 确认无需更新 | `runtime.model.observed` 是内部观测与 projection invalidation，不增加 Canonical Runtime Activity kind 或映射。 |
| Runtime compatibility | 确认无需更新 | 本版不改变 Runtime 准入、实测版本或 capability 结论；无字段时诚实回退默认展示。 |
| Documentation routing | 已更新 | 文档导航、Contract 索引、Decisions CURRENT 与 Architecture 路由切换到 v11/v3/v1.13。 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持 Runtime 集合不变，版本流水账不进入根 README。 |

## References

- [v1.13 实施计划](implementation-plan.md)
- [v1.13 决策记录](decisions.md)
- [Run Process Detail Surface v11](../../contracts/run-process-detail-surface-v11.md)
- [Camp Open Projection v3](../../contracts/camp-open-projection-v3.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
