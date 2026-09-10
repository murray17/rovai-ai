---
document_type: interface-contract
contract: execution-evaluation
version: 13
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.57
last_updated: 2026-09-11
---

# Execution Evaluation v13

v13 继承 [v12](execution-evaluation-v12.md)，仅收紧每日分析的输出引用与已知零值表达。Core definitionVersion=2、报告 reportDefinitionVersion=3、分析输入 schemaVersion=2 不变，分析策略升级为 `daily-health-analysis-v3`。Gate 评分、产品上下文与数据库字段不变。

`prepared` 根据已核验输入生成 `analysisSchema`：固定报告身份与输入摘要，枚举可引用的指标路径及有界样本 ID。历史深层指标可引用包含其完整值的父对象，避免重复展开全部叶节点；完整数值仍在冻结输入内。调用方应将此 schema 交给模型作为结构化输出约束。日期和采集时点引用 coverage 下的已有字段；报告 ID 不能当成样本 ID。登记仍独立检查引用存在性，不能补写前缀、替换错误引用或改写原始提交来获得成功。

已有可信稀疏终态分布中，未出现的标准状态在派生报告显式写零；未知／不可用的总体仍保持未知。所有原始非标准状态保留，成功失败分母不变。显式零只表示该保留、可观察总体内未出现该状态，不声明全部调用均被采集。原始 Trace、旧报告及失败分析保持原样。

规则只验证结构、身份和引用，不证明自然语言解释正确。真实分析仍须核对数值、总体、覆盖限制及假设边界；结构错误修复后的新尝试须另存输入、配置、输出与登记状态，遵守已冻结预算。
