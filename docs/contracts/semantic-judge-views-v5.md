---
document_type: interface-contract
contract: semantic-judge-views
version: 5
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.57
last_updated: 2026-09-10
---

# Semantic Judge Views v5

v5 继承 [v4](semantic-judge-views-v4.md) 的有界回执、证据摘要和结果／过程隔离；新增显式 `generic-task-v5`。旧 profile 的提示、分歧处理与报告保持原义。

## 指标可验证性

每项评分和协作诊断必须绑定 `observable-task-metrics-v1` 合同：负责 View／规则、可采集来源及有限验证范围。准入器拒绝无证据负责人、缺失或漂移的合同。该校验证明定义已声明，不代替实际证据验证或 Judge 校准。

Outcome 的声明准确性检查交付事实、产物、完成状态及已提供验证回执中可直接核对的结果。协作来源、历史／Memory 检索步骤、分页细节和全程无某行为的声明不属于该项；不能因 Outcome 看不到过程而扩张评分要求。这些声明也不因 Outcome 得高分而获认证。过程质量保留原五项诊断；操作边界仅由声明的规则覆盖，未覆盖的全局网络／主机行为在报告限制中列明。

结果中的实质虚假完成、错误事实和已证实矛盾仍失败；缺少范围内必要证据仍未知。观察到任务未完成或检查不足不能当成评测证据缺失。验证充分性区分评测器检查与 Agent 执行，不要求非代码任务编写代码测试。工作区、Memory 前后状态不证明主机全部行为或无瞬时写入。

## 有界证据裁决

保留反序 A/B 双副本。两者一致的项不再评价；双方一致未知不能靠增加 Judge 填分。只有有效副本的判定分歧会触发一次同模型、同参数、同 View、同证据的裁决，无工具，不扩大读取范围。

裁决输入为冻结 rubric 与指标合同、原 Evidence Pack、分歧项及双方理由。原意见不成为新事实。最多一次调用，不对有效输出或运输失败重试。裁决只作用于原分歧项，不能改写原一致项；证据仍不足则输出未知。不得投票、平均或偏向高分。

原 A/B 判定、理由、引用始终保留；新项状态为 `adjudicated`，保留裁决理由、引用和已绑定原副本摘要的执行记录。Review 内嵌完整裁决 artifact，绑定同一 pack、configuration、原执行身份及提示摘要；原始 provider 调用继续落盘。每项引用经过原有闭包检查，错误引用被隔离为未知。

新 Suite 使用 `semantic-dual-view-judge-2`、envelope schemaVersion `2.0.0` 及 [Suite v2 Schema](schemas/semantic-judge-view-suite-v2.schema.json)。旧 Suite v1 保留独立 Schema 和解析路径。裁决结果仍为可复核的模型评价，不声称客观真值或保证完整总分。
