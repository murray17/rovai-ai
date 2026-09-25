---
document_type: contract
contract: context-delivery-profile-v10
status: accepted
target_version: v1.70
last_updated: 2026-09-24
---

# Context Delivery Profile v10

新公开 Camp 批次的冻结 JSON 是 `{"profileVersion":10,"maxSelfActiveTasks":8}`。数值预算与 [Profile 9](context-delivery-profile-v9.md) 相同：完整 FIFO `RUN_INPUT`、默认 96 KiB UTF-8 payload 上限、可选 Task 的既有裁剪；不恢复自动公屏历史。`ROVAI_ADDITIONAL_SKILLS` 完整文本在 `RUN_INPUT` 前参与 payload 字节计算，不截断 section、当前消息或 `RUN_FACTS.historyHint` 以适配预算。无法容纳时按 `context_payload_too_large` 留证并不发送部分输入。

非 batch 新 Run 使用 Profile 7，继承 Profile 6 的数值上限并增加固定动态技能 section。历史公开 Profile 9 与其已冻结 Manifest 29 一同有界恢复；更早公开 Profile 不派发。字段级配对见 [ContextManifest v30](context-manifest-evidence-v30.md)。
