---
document_type: schema-index
authority: cross-version-contract-schema-catalog
last_updated: 2026-08-13
---

# Cross-version contract schemas

本目录保存由长期 Contract 拥有、不能归入历史 Version snapshot 的 JSON Schema。`schema-catalog.json` 固定文件、URI、
Schema version 与 raw-byte SHA-256；实现必须先验证 catalog，再按唯一 `schemaId@schemaVersion` 解析 artifact。

当前包含：

- `semantic-judge-view-suite-v1.schema.json`：Semantic Judge Views v1 的 Suite envelope 与逐项 Review projection。
- `tool-interaction-measurement-v1.schema.json`：Tool Measurement Opportunity、Canonical Interaction 与逐 Opportunity assessment。
- `tool-use-judge-pack-v1.schema.json`：独立 Tool-Use Judge 的 treatment-blind Model-Visible Pack 与 audit Evidence Map。
- `tool-use-judge-configuration-v1.schema.json`：冻结模型 snapshot、prompt、decoding、retry 与 tool-disabled capabilities。
- `tool-use-judge-replica-result-v1.schema.json`：双 Replica exact item output、attempt 与 typed unavailable 证据。
- `tool-use-review-v1.schema.json`：不投票、不平均的逐项 agreement/disagreement reconciliation。
- `resource-measurement-v1.schema.json`：typed Resource Profile/Measurement descriptor、authority 与 coverage。
- `paired-collaboration-experiment-v1.schema.json`：paired Definition、arm plan 和 outcome-conditioned comparison。
