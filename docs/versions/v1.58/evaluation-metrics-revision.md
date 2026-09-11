---
document_type: implementation-plan
version: v1.58
lifecycle: current
authority: evaluation-metrics-change-scope
status: in_progress
last_updated: 2026-09-10
---

# 评测指标与报告修订

开发者已确认通用质量三维度、协作分项统计及有界离线报告方案，并授权继续实现。本修订只改变评测配置、Judge 输入投影与报告口径，不改变产品上下文、内置 Skill、任务题目或 Runtime 权限。实现状态与实测记录见[实施计划](implementation-plan.md)。

## 旧检查项映射

| 原检查 | 新归属 | 执行前冻结的依据 |
| --- | --- | --- |
| requirements.understanding | 目标达成（50） | Case 的具体目标与关键子目标；正确处理预定义阻塞可以达成目标，普通任务拒绝执行不算完成 |
| design.solution_fit | 目标达成 | 方法、输出结构是否适合本 Case，不要求每个任务编写软件设计 |
| implementation.quality | 目标达成 | 具体交付物质量；代码看实现，资料分析看字段、事实与结论，保留旧 ID 便于追溯 |
| testing.strategy | 目标达成 | Case 所需验证；非代码任务不因没有代码测试扣分 |
| response.claim_accuracy / limitations | 证据一致性（25） | 完成声明、实际产物、验证事实与未知是否一致 |
| scope.discipline | 边界遵守（25） | 交付内容中的指令与信息适用边界；不推测不可见工具或权限行为 |
| 既有 change_boundary / A2A 上限 / Memory 状态规则 | 边界遵守 | 权威规则结果单独汇总；同一检查只有一个判定来源，硬失败仍阻断 |
| delegation | 协调必要性 | 保留原始判定、理由和证据 |
| handoff_clarity | 信息交接充分性 | 同上 |
| contribution_value / feedback_absorption / lead_integration | 贡献整合有效性 | 同上；按不满足、未知、部分满足、满足的顺序合并状态 |
| 可靠性、耗时、Token／费用、重试 | 独立实测指标 | 有权威证据才展示，不混入质量分 |

## 最小改动范围

1. 在回归目录保存版本化评分配置，明确每个现有 Case 的权重、适用细项、评价依据、判定来源和关键项。冻结计划绑定配置摘要。题目、fixture、verifier 与 Case seals 不变。
2. 为既有双 View Judge 增加显式版本化回归评价 profile；旧 profile 和历史报告仍可追溯。结果 View 读取交付物与验证事实，过程 View 读取对应协作轨迹。按冻结配置执行不适用判定，要求协作却未执行不能转为 N/A。
3. 代码先汇总计划重复、再汇总固定 Case 权重。未知保留权重与分母；缺必需评价不发布完整总分。协作按计划 Case × repetition 统计，额外保留独立 Case 数；重跑 attempt 独立，不拼接最佳结果。
4. Gate 保持硬性验收、关键条件、逐项退化优先，新增质量对照与协作状态变化。初版不设置未经校准的统一 80% 下限，也不让平均改善掩盖具体退化。
5. 复用 JSON、Markdown、SVG 与报告目录生成离线 HTML：版本摘要、三维质量、协作分布、逐 Case 变化及受限证据导航。每周趋势按评分、适用性及环境分组，首次尝试不被重跑替代。
6. 每日运行健康与质量评分分离，补比例／数量／覆盖呈现、离线曲线与分析完成记录；Memory 两项仍不可用，不新增数据库字段。

## 验证与边界

验证非代码任务、适用性与未执行区分、未知与分歧不抬分、关键部分满足不放行、分组失败仍保留细项未知、重跑与重复分离、零分母、断线、证据链接和不可信内容转义。测试夹具明确标识，不能成为真实评测数据。

评分升级不覆盖旧报告，也不把旧 Judge 判定直接换算为新分数。需要比较时，在同一标准下重新评价两侧保留证据；缺少所需证据则重新执行。真实 Judge 与完整新旧对照仍须实际运行后记录，未运行不得写成通过。既有 macOS 受管 Runtime 中嵌套 Runner 受阻的事实保持，不为调度放宽沙箱。
