---
document_type: protocol-contract
contract: builtin-tool-transport-v47
authority: builtin-tool-transport
status: accepted
version: 47
source_version: v1.72
last_updated: 2026-11-26
---

# Built-in Tool Transport v47

Transport 和 CLI Command 版本为 47，运行能力为 `builtin_cli.transport.v47`。IPC 3、Envelope 2、Agent Output 16 和历史回执继续沿用 [v46](builtin-tool-transport-v46.md)。

独立聊天新增 `rovai chat history` 和 `rovai thread create`。CLI 在该类 Run 的帮助中展示这两项。Core 从有效原生绑定确定来源话题与执行代次。读取聊天历史只接受分页参数，操作已有 Thread 要显式指定目标，公开写入在事务中复核经办队员的成员资格。旧的会话内单聊继续通过自己的历史命令读取。[聊天工具范围](../versions/v1.72/chat-backend-proposal.md#5-31-项-agent-cli-与授权)

独立聊天的公开发送若在响应丢失后携原请求重连，Core 可凭原租约、请求 ID、目标和参数的完整摘要只读返回已提交的成功或拒绝结果。新写入仍要求有效租约。应用重启后，认证用户也可用原 Run、代次、目标和请求通过 `commands.reconcile` 查回持久回执。缺少确切记录时保留结果未知。
