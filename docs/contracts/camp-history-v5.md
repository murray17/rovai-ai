---
document_type: protocol-contract
contract: camp-history-v5
authority: camp-history-retrieval
status: accepted
version: 5
last_updated: 2026-09-09
---

# Camp History Retrieval v5

继承 [v4](camp-history-v4.md) 的认证、publication fence、exact self-written read、搜索与分页合同。
`camp.read` items、`camp.search` 与 `history.search` results 可选增加完整 quotes。每项采用
[ContextManifest v23](context-manifest-evidence-v23.md) 的 message_excerpt 结构，source.scope 为
`camp_messages`，真实 owner 在 read 外层或 search result 的 campId。引用不进入结构化可执行 segment。

正文仍有显式 bodyOffset/bodyLimit/nextBodyOffset；引用完整返回，不随正文分页裁剪。结果序列化上限由
16,000 提升至 80,000 Unicode scalar。Top-K 超限只移除完整结果并标记 truncated；单条或 collection
仍无法容纳时返回 `camp.response_overloaded`，不悄悄删除引用字段。调用者可用 item 精确读取。

私有引用不进入以上公共接口。`single_chat.history` 继续仅查询当前认证 Run 的 exact Conversation 且早于
当前输入；其 schemaVersion=2，messages 可选含 quotes，scope=`current_conversation_messages`。
它保留原有排他 sequence 分页和完整消息正文、附件，不读取其他私聊的引用。
