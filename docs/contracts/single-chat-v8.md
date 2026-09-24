---
document_type: contract
name: Single Chat
version: v8
status: accepted
source_version: v1.67
last_updated: 2026-09-23
---

# Single Chat v8

继承 [v7](single-chat-v7.md) 的私有路由、FIFO、Source Attachment、operation policy、
Execution Evidence change watermark 和 UI 行为。新 Single Chat Run 的动态 Context 使用
Formatter/Manifest 26、Profile 6、[非 batch Run Facts v5](run-facts-nonbatch-v5.md)；
`RUN_FACTS.conversationMode` 仍必有。

新 `SINGLE_CHAT_GUIDANCE` 只包含原有四条 `instructions`，没有 `schemaVersion` 或替代标记；
`MEMBER_IDENTITY` 与 `COLLABORATION_STATE` 同样按
[ContextManifest v28](context-manifest-evidence-v28.md) 的新模型投影生成。内部协议版本及证据保留，
旧冻结 Single Chat 输入不转换、不重播。
