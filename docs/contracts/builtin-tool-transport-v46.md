---
document_type: protocol-contract
contract: builtin-tool-transport-v46
authority: builtin-tool-transport
status: accepted
version: 46
source_version: v1.72
last_updated: 2026-11-19
---

# Built-in Tool Transport v46

Transport 和 CLI Command 为 46，运行能力为 `builtin_cli.transport.v46`，Agent Output 为 16。
CLI 与 Core 按现有版本门配套发布。IPC 3、Envelope 2 与 [v45](builtin-tool-transport-v45.md) 的其他操作合同继续适用。

两个公屏消息搜索的当前成功 Schema 只接受 `results` 与 `truncated`。历史回放仍验证当时完整的封闭对象，
包括 `searchIncomplete`、空数组以及使用 `authorType` 或 `senderType` 的旧结果项。旧回执与证据无需改写。
搜索结果和错误语义见 [Camp History v18](camp-history-v18.md)。
