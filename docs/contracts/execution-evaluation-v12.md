---
document_type: interface-contract
contract: execution-evaluation
version: 12
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# Execution Evaluation v12

v12 继承 [v11](execution-evaluation-v11.md)，仅修正每日派生报告与分析输入。Core 原始统计 definitionVersion=2 不变；新日报 reportDefinitionVersion=3、分析输入 schemaVersion=2、策略 `daily-health-analysis-v2`。Gate 题目、权重、Judge、产品上下文及数据库字段不变。

## 状态与总体

A2A 失败率和终态覆盖继续使用当日接纳交接群组。`cohortOpenCountAsOf` 是该群组尚未终结数；`openCountAsOf` 从同口径等待原因分布求和，覆盖窗口结束前创建、采集时仍未结束的全部保留交接，包含跨日积压。没有等待分布时全量积压为未知，不能从当日群组推测。曲线与等待原因展示使用全量积压，并明确标注当日群组剩余数。

工具成功／失败分母不变。所有其余终态原样展示，包括 `unsettled`，不归为成功或失败；按来源提供终态总数、成功失败分母、其他状态及回放身份／终态时间缺口。Run coverage 仅表示有当前 classifier 工具记录的 Run 比例，不认证全部调用覆盖。

## 分析证据与职责

分析样本必须属于明确指标总体：工具排除 Core 运输回放、回放身份未知及不在终态窗口的记录；交接事件仅含已接纳 dispatch 的 public A2A，完成投递不混入。失败事件不等同于当前群组失败率。额外提供最多三个跨日／当日未结束交接样本；各类选择上限和 eligible／selected／omitted 保留，总样本最多 18 条，不声称代表总体。

LLM 读取代码统计、历史差异、版本、采集时点、数据缺口和有界样本；按事实、可能原因和建议输出。不得从元数据推断需求遗漏、反馈吸收或任务成功；不得估算缺失错误码、记忆计数或模型身份。必须区分零样本和不可用，结合覆盖和分母解释趋势；不将不相邻日期称作较昨日，不作无证据因果归因。

`prepared` 在交给分析模型前校验报告身份、日期窗口和输入摘要。登记保留原始提交及引用检查结果，并从冻结输入派生 `citedMetrics` 供复核；该记录不改统计，也不保证自然语言解释正确。旧提交格式 schemaVersion=1 保持兼容。

新旧日报不同定义不连线，旧报告及失败尝试不重写。新增信息均来自已有字段或其确定性派生，不增加日常存储字段或新曲线指标。Memory 精确计数、历史逐 Run build、完整 origin 和通用 Runtime 工具错误码仍不可用。
