---
document_type: protocol-contract
contract: camp-history-v17
authority: public-camp-history-read-scope
status: accepted
version: 17
source_version: v1.72
last_updated: 2026-10-29
---

# Camp History v17

继承 [v16](camp-history-v16.md) 的请求、分页、读取权限、消息可见性和预算。
公开、跨 Thread 及私聊消息的 quotes 统一遵循 [Message Quotes v2](message-quotes-v2.md)：
每项只含 kind=message_excerpt、text，来源与作者不进入输出 schema。
只检查承载消息的读取边界，不查询或过滤其引用来源。已保存文字不随来源变化。
历史冻结输出与 receipt 原样保留；未来的新工具读取采用新格式。
配套 CLI/Core 准入见 [Transport v45](builtin-tool-transport-v45.md)。
