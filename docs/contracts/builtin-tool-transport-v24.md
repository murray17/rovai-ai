---
document_type: protocol-contract
contract: builtin-tool-transport-v24
authority: builtin-tool-transport
status: accepted
version: 24
last_updated: 2026-09-09
---

# Built-in Tool Transport v24

继承 [v23](builtin-tool-transport-v23.md) 的命令、权限、认证、IPC 2、Envelope 1 和 Agent Output Projection 2。
Contract / CLI command version 提升至 24，Runtime capability 为 `builtin_cli.transport.v24`。

仅扩展 [Camp History v5](camp-history-v5.md) 中 read/search/private history 的 closed output schema，允许
完整不可变 message_excerpt；Single Chat history output schemaVersion=2。新版 schema 进入 catalog 与
Binding compatibility digest。CLI 不删掉 quotes，也不将其内容转换为派发、Skill 或命令。

普通 Agent send 不接受客户端构造的 quotes。来源验证、选文快照签发、草稿变更仍为 Core 的本地用户路径，
见 [Message Quotes v1](message-quotes-v1.md)。
