---
document_type: protocol-contract
contract: context-manifest-evidence-v29
authority: public-multi-input-agent-run-context-evidence
status: accepted
version: 29
last_updated: 2026-09-23
---

# ContextManifest Evidence v29

新公开 Camp Run 使用 Formatter/Manifest 29、[Profile 9](context-delivery-profile-v9.md)、内部 [Run Facts 7](run-facts-v7.md) 与 Session Charter revision 13。动态 section 顺序为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[RUN_INPUT]
```

不生成 `SHARED_CONVERSATION`、历史摘要、遗漏数量或自动历史 locator。`RUN_INPUT.messages` 保留本 Run 完整有序的当前工作项；每条消息的 `messageId`、`body`、`senderId`、`senderType`、`sequence`、可选 `anchorMessageId`、`quotes`、`attachments`、`skills` 以及原有省略规则不变。`RUN_FACTS.historyHint` 每个新公开 Run 必有；其余业务 facts、Collaboration、Task 与 Workspace 的出现条件不变。新 Charter 用下列两句替代原自动历史指导；第一句原样保留：

```text
- Preserve existing user work. Do not infer omitted content; retrieve it only when the current work requires it. Memory indexes and retrieval keys are discovery hints; read a Memory before relying on it.
- Use `rovai camp read` for relevant Camp history. The boundary in `RUN_FACTS.historyHint` is a reference point, not a record of messages read or work completed.
```

Manifest 29 冻结 Profile 9 JSON/digest、执行前已接受公屏边界、本次执行前公屏尾、RUN_FACTS 原始 JSON/digest（`runFactRefs.history_hint`）、完整 RUN_INPUT refs/digest、Skill 与附件 refs、Bootstrap/Collaboration/Workspace 证据以及真实 payload bytes/digest。`recentMessageRefs`、`referenceClosureRefs`、`omissionEntries`、`sharedMessageEvidence` 为 `[]`；`omittedMessageCount` 和 sequence bounds 为 `null`。`rawMessageRefs` 与附件 refs 只来自 `RUN_INPUT`。原数据库列继续容纳这些空值；旧行原样保存。

执行前公屏尾只在本 Run、Binding、generation 的有效 Runtime accepted ACK 后推进 `(CampId, AgentId)` 水位。读取、搜索、发布、prepared/rejected/unknown、停止或迟到 ACK 不推进水位；已有效接受的边界不回退。同一新格式 Run 直接复用冻结的 Manifest、`historyHint` 与 Runtime 输入，不能用最新水位重算。

新写入的公开 AgentRunInput 与 ContextManifest 必须为 29，非 batch（含 Single Chat）仍使用 Formatter/Manifest 26、Profile 6、Run Facts 5。旧 [Manifest 28](context-manifest-evidence-v28.md) 及 payload 只保留审计原字节，不继续派发、恢复、迁移、双读或自动重播；必要时开始新执行或新 Session。Schema migration 172 仅扩展当前写入约束并保留业务行，不回填历史执行。

[独立变更说明 revision 1](../versions/v1.68/model-context-change-public-history-hint.md)固定完整前后结构、兼容策略与二次确认。
