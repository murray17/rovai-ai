---
document_type: protocol-contract
contract: context-manifest-evidence-v32
authority: public-multi-input-agent-run-context-evidence
status: accepted
version: 32
last_updated: 2026-10-01
---

# ContextManifest Evidence v32

当前 User 主称呼、双别名与新旧冻结投影遵循 [User Naming v1](user-naming-v1.md)。该命名合同替代本文及继承合同的 Principal 主称呼／唯一 `agent_v1` 限制，其他规则保持。

继承 [v31](context-manifest-evidence-v31.md) 的选择、FIFO、历史水位、投递和验摘要规则。新公开 Thread 使用 Formatter/Manifest 32、Profile 10、Run Facts 9；新非 batch 使用 Formatter/Manifest 28、Profile 7、Run Facts 6。命名遵循 [Thread Naming v1](thread-naming-v1.md)。

公开批次的 section 顺序不变。非 batch 的 `SHARED_CONVERSATION` 改为 `SHARED_THREAD`，父范围字段为 `threadId`。模型引用 scope 为 `current_messages`／`thread_messages`；引用的原文、作者、闭包距离和遗漏边界保持。Single Chat 的 Run Facts 采用 `singleChat`、`threadPublicationAllowed`、`responseDelivery: "single_chat_message"`，不暴露私有 Conversation ID。

A2A Guidance Evidence 新版本为 3，Single Chat guidance 为 v3；新旧正文分别严格验摘要，旧 A2A v1／v2 与已冻结 Single Chat v2 仍按原文读取。Run Facts 9/6 只改变公开命名，不增加新的任务策略或权限。

新 Binding 使用 Charter 18、Bootstrap v5／Formatter 5。Native Binding compatibility 保持 Charter 16，其余兼容身份不变，因此改名本身不替换 Native Session。旧 Bootstrap 的 Charter／平台 Skill section／Memory Entrypoint 从既有 evidence 读取，压缩补投复用原证据；`MEMBER_IDENTITY` 的原有更新行为不变。

旧普通 26/27、旧公开 29/30/31 在精确版本和历史证据完整时继续恢复；已准备输入与 Manifest 不重渲染。公开 28 及更早的退役格式不重新准入。Migration 178/schema 128 保留旧行和所有冻结字节，仅扩展新版本约束；旧 Run 中未准备的输入使用其冻结版本，新 Run 使用当前版本。

Migration 179/schema 129 仅扩展 audience CHECK，同时接纳冻结 `agent_v1` 和新 `agent_v2`。公开 Bootstrap 生成共用一份模板；已存 evidence 优先于当前模板，Single Chat 仍使用专用模板。
