---
document_type: implementation-evidence
version: v1.58
status: in-progress
last_updated: 2026-09-11
---

# 主线集成与本机定时配置

用户已明确要求将 PR #324 合入 main，并在本机配置每日 Trace 与每周固定回归。使用 Rovai 现有 Automation、Host 绑定和报告设施，不新增独立调度器或审批系统。

## 合并范围

评测分支原提交 `316d962f26d0558663e0bb67b49c155bc0c9a22c` 与 main `1bf382a507351227bee13d1894df126275c169c8` 合并。main 已有 ZCode 的 v1.57 和 App 0.2.3；保留其代码、迁移和版本历史，评测文档顺延至 v1.58。测试入口同时保留 ZCode 与全部评测测试，不重写已有原始报告，也不将旧构建的 100 分解释为合并后实测分数。

合并前复核 User Automation、Main scheduler、Core Trace seam 的自动合并差异，执行类型检查、完整 Node／Vitest 检查、Rust staged 路由和文档 CI；真实运行与部署另留回执。通过既有 PR 合入，不直接推送 main。

## 拟配置

- 每日 08:00（Asia/Shanghai）：Host 准备前一自然日的规则指标、曲线和有界样本，Automation Agent 分析并登记结果；排除分析自身和每周任务。
- 每周一 09:00（Asia/Shanghai）：宿主按冻结模板运行 12 个固定 Case 和真实 Judge，Automation Agent 等待当前 Camp 回执并总结报告。
- Gate 按实际上下文改动手动触发；每周任务不自动编辑上下文或调整评分。仍受冻结预算、历史保留、缺失不放行及 App 运行条件约束。

`rovai app eval schedule` 与 `rovai app trace schedule` 只绑定已有 Automation，不能创建定义。创建任务使用现有产品入口。计划尚未配置前不得声称启用，绑定成功也不等于已到点执行。
