---
document_type: protocol-contract
contract: builtin-tool-transport-v45
authority: builtin-tool-transport
status: accepted
version: 45
source_version: v1.72
last_updated: 2026-11-03
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

## 工作准则与成长课题容量

按[已确认 R1](../versions/v1.72/model-context-change-identity-guidance-3000.md)，`workingPrinciples` 与
`growthTopic` 各由 300 放宽至 **3,000 Unicode scalar**；create/update schema 引用各自 Core 上限常量。
这两个字段沿用既有原始字符串 maxLength 校验，再由 Core 按 Rust trim 保存；不套用专业职责的 schema 前规范化。
create 省略为空、update 省略保留、空串清空、null 拒绝均不变；内部格式和合法字符完整保留。
字段、授权、幂等与所有版本轴保持，旧冻结输入不回填。CLI/Core 配套交付，旧版本可能拒绝超过 300 的新资料。

## Memory capability 发现与回放

按 [Memory Capability v1](memory-capability-v1.md)，CLI context 增加派生 `memoryEnabled`，
Task/Memory 从统一刷新入口读取两个当前值后生成。Hermes 通过既有 Core IPC 的只读 capabilities 请求发现。
目录与 help 隐藏关闭的 Memory 操作；已知命令仍送 Core，不依赖投影作执行授权。
Memory 读回放进入实时读取服务；关闭时正文/片段不交付；写入保留已提交的 body-free 回执。
新增 `memory.feature_disabled` / `stop` 错误，其他命令、输入、版本轴和冻结记录保持。
