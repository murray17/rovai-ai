---
document_type: protocol-contract
contract: builtin-tool-transport-v45
authority: builtin-tool-transport
status: accepted
version: 45
source_version: v1.72
last_updated: 2026-10-29
---

# Built-in Tool Transport v45

继承 [v44](builtin-tool-transport-v44.md) 的输入、IPC、权限、幂等与完整投递规则。
Transport/CLI 45、capability builtin_cli.transport.v45、Agent Output 15；IPC 3、Envelope 2 保持。

所有消息读取输出的可选 quotes 项只含 kind=message_excerpt、text；不含 source 或 author。
按 [History v17](camp-history-v17.md) 与 [Message Quotes v2](message-quotes-v2.md) 读取已保存文字，
取消被引用来源过滤。CLI/Core 配套发布，沿用现有版本门；不新增命令或参数。
历史冻结输出、Envelope、receipt 和摘要不回填。
