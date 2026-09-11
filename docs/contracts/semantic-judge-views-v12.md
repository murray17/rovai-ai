---
document_type: interface-contract
contract: semantic-judge-views
version: 12
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# Semantic Judge Views v12

v12 继承 [v11](semantic-judge-views-v11.md)，新增 `generic-task-v12` / `claim-audit-v6` / 评分 2.10.0。Case、适用范围、权重、硬性门槛与独立 Process 诊断保持；同一新标准统一重评，不覆盖历史结果。

## 声明佐证质量

声明项评价交付结论与依据是否匹配，不要求全知地证明历史动作。审计保留 `supported`、`contradicted`、`unknown`，新增 `unsubstantiated`，明确表示可观察的交付为其声明提供的佐证不足，不代表该声明已被证伪。

Judge 引用原声明和现有依据，说明缺少何种支持、为何是交付依据问题。被捕获的复合命令可能掩盖无独立输出的静默子检查，不能支持其必然成功；有效的独立谓词仍可支撑它实际验证的范围。不能因有界 Trace 未选入某命令就认定未执行；采集遗漏、截断、脱敏或视图不提供必要来源仍为 unknown。完成声明对照整个任务，不能只评价被转发的中间评审是否完成。

代码验证原文引用、合法证据、声明清单和协议，再计算：重大矛盾为不满足；审计有真正未知或无效项为评价未完成；重大声明全无充分佐证为不满足；有支持同时存在未充分佐证或非重大矛盾为部分满足；其余满足。旧 unknown 不能直接换成扣分，必须以新语义重新评价。分数依旧不能抵消硬失败或关键项失败。

`delivery_fact` 只用于发布/文本命题；混合句中的实现、测试成功子命题必须独立审计，不能只引用历史标题就全部认证。先前 Lead 正文为已捕获且摘要匹配的空字符串时，计入完整性清单并保留原始证据，但不构造非空声明；这与正文丢失不同。

评分请求超时等评测器故障仍按 [Execution Evaluation v14](execution-evaluation-v14.md) 单列。实际复现、取舍和预算见[修正记录 revision 2](../versions/v1.58/evaluation-delivery-recovery.md#revision-2-substantiation)。

## 原文引用协议修复

`literal-delivery-quotes-v1` 从最终响应和最新交付生成有限原文选项，单条最长 1200 UTF-16 单元，最多 256 条；长行按步长 1000 切为有重叠的片段。拆分命题时重复引用整句，在 kind/reason 中区分子命题，不能改写引用。空/超限清单为调用前协议失败，引用仍须属于所选源消息。该约束实现原有逐字引用合同，不改变判分。

只恢复无效协议输出时，允许同评分/rubric 的有效 Trial 保留；必须记录每个 Trial 的评测器提交、配置和源报告摘要，不得以旧标准分数补入新标准。恢复不增加独立任务或重复执行样本。
