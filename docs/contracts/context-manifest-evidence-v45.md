---
document_type: protocol-contract
contract: context-manifest-evidence-v45
status: accepted
version: 45
source_version: v1.72
last_updated: 2026-11-19
---

# ContextManifest Evidence v45

继承 [v43/v44](context-manifest-evidence-v44.md)。公共初始输入和 Steer 使用 Formatter/Manifest 45、
Run Facts 14、Delivery Profile 15。非 batch 使用 44、Facts 13、Profile 16。

公共 batch 领取普通投递时，从同一次领取的内容修订号派生 `RUN_INPUT.messages[].edited`。
修订号大于 1 时写入 `true`，否则省略。正文、附件和 @ 提及沿用当前投影。只改附件也适用。
对应的 [historyHint](run-facts-v11.md#historyhint) 随同一份 claim 冻结，两者都计入实际字节预算。
历史读取使用自己的投影。Steer 使用本次插话内容和不带后缀的提示。

Migration 232 将 projection schema 181 升至 182，扩展现有表和触发器的版本约束。此前领取的
Run 仍使用原版本物化，已物化的 Manifest 使用原 Blob、摘要和接收证据恢复。Bootstrap 和 Binding
按现有规则鉴别和复用。
