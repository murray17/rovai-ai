---
document_type: contract
contract: context-delivery-profile-v9
status: accepted
target_version: v1.68
last_updated: 2026-09-23
---

# Context Delivery Profile v9

新公开 Camp Run 的冻结 Profile JSON 仅含下列字段：

```json
{"profileVersion":9,"maxSelfActiveTasks":8}
```

`maxSelfActiveTasks` 仅约束可选的 Self Active Task 投影。Profile 8 的四个自动公屏历史上限随该投影退出，不进入新 Profile：`maxPublicMessages`、`maxPublicHistoryChars`、`maxMessageBodyChars`、`maxPublicReferenceChainMessages`。

完整 FIFO `RUN_INPUT` 是必选输入，默认 Runtime payload capacity 为 96 KiB UTF-8 bytes；Core 在 claim 预估和最终序列化时计入完整 `RUN_FACTS.historyHint`。可选 Task 按现有预算裁剪；消息不能拆分或截断。队首仍不适配时产生 `context_payload_too_large` 证据，不向 Runtime 发送部分输入。默认接收者 Mention 在 claim 时冻结并计入正文及预算。该机制继承 [Profile 8](context-delivery-profile-v8.md) 的非历史选择规则。

非 batch（含 Single Chat）仍使用 Profile 6。本 Profile 与 [ContextManifest 29](context-manifest-evidence-v29.md) 配对；旧 Profile 8 仅解释已冻结的历史证据，旧格式执行不再派发或恢复。
