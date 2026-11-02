---
document_type: protocol-contract
contract: builtin-tool-transport-v45
authority: builtin-tool-transport
status: accepted
version: 45
source_version: v1.72
last_updated: 2026-11-02
---

# Built-in Tool Transport v45

继承 [v44](builtin-tool-transport-v44.md) 的输入、IPC、权限、幂等与完整投递规则。
Transport/CLI 45、capability builtin_cli.transport.v45、Agent Output 15；IPC 3、Envelope 2 保持。

所有消息读取输出的可选 quotes 项只含 kind=message_excerpt、text；不含 source 或 author。
按 [History v17](camp-history-v17.md) 与 [Message Quotes v2](message-quotes-v2.md) 读取已保存文字，
取消被引用来源过滤。CLI/Core 配套发布，沿用现有版本门；不新增命令或参数。
历史冻结输出、Envelope、receipt 和摘要不回填。

## 专业职责容量

按[已确认 R2](../versions/v1.72/model-context-change-professional-responsibilities-30000.md)，
`professionalResponsibilities` 沿既有 ECMAScript trim 后按 Unicode scalar 计数，上限由 10,000
放宽至 **30,000**。create/update schema 共用 Core 常量，CLI 先规范化再执行 schema 校验。
内部换行、缩进和合法字符原样保留；空字符串清空，create 省略为空，update 省略保留，null 仍拒绝。
超限整次身份写入拒绝并保留编辑草稿；CLI/Core 配套交付，不保证旧 CLI 接受新增合法长度。
命令、字段 shape、授权和投递语义不变，Transport/CLI 45 保持；历史冻结输入与摘要不回填。
