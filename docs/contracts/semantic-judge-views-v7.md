---
document_type: interface-contract
contract: semantic-judge-views
version: 7
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.57
last_updated: 2026-09-11
---

# Semantic Judge Views v7

v7 继承 [v6](semantic-judge-views-v6.md)，新增显式 `generic-task-v7` / `claim-audit-v2`；旧 profile、rubric、评分及产物保持原义。任务质量权重、适用项、协作五细项、双副本与一次分歧裁决不变。

## 可核对的来源

Outcome 可读取冻结 `evidenceFiles` 对应的初始 fixture，路径标为 `initial-fixture/<path>`，由 Case seal 与文件摘要绑定。初始文件只支持修改前事实，交付文件支持最终状态。不能用修复后的文件否定正确的历史问题描述，也不能用初始文件证明已交付修复。

原生验证补取遵循 [Execution Evaluation v9](execution-evaluation-v9.md)。Judge 只读取转义／脱敏后的有界命令与返回，不读取原生日志、推理、完整过程或 Skill 正文。补取失败保持原有缺口，不能虚构一次成功运行。

`claim-audit-v2` 保留逐声明 Schema 和原始响应。产物事实可引用实际文件读取、状态或 diff 凭据，代码检查存在未截断的真实输出，Judge 检查其是否支持具体事实。Agent 自检成功仍必须有相应执行回执；独立 verifier 与正确产物不能替代。机械来源检查不能证明任意命令正确。

任务规则说明不等于声称已经对所有未来输入做过实验；一次性固定数据仍按冻结目标验收。用户偏好、记忆与历史来源归属继续由独立过程／规则检查负责，Outcome 仅核对实际输出事实，不能凭其质量分证明这些过程发生。

`bounded-evaluation-context-v2` 的来源、脱敏投影与初始文件参与配置和证据摘要。历史证据重评保留原始 observations 与结果修订，新的 Index、Ledger、消息引用和 Judge Pack 必须互相匹配；不能只修改分数或覆盖原始 Judge 响应。

消息证据重建时在私有 payload 保留 `evaluationRevision`（本次 ID、新 Index ID 与 producer 摘要），使空协作消息的修订也有独立身份；旧 payload 与引用不变。
