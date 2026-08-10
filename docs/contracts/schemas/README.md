---
document_type: schema-index
authority: cross-version-contract-schema-catalog
last_updated: 2026-08-11
---

# Cross-version contract schemas

本目录保存由长期 Contract 拥有、不能归入历史 Version snapshot 的 JSON Schema。`schema-catalog.json` 固定文件、URI、
Schema version 与 raw-byte SHA-256；实现必须先验证 catalog，再按唯一 `schemaId@schemaVersion` 解析 artifact。

当前包含：

- `semantic-judge-view-suite-v1.schema.json`：Semantic Judge Views v1 的 Suite envelope 与逐项 Review projection。
