---
document_type: protocol-contract
contract: builtin-tool-transport-v33
authority: builtin-tool-transport
status: accepted
version: 33
last_updated: 2026-10-01
---

# Built-in Tool Transport v33

继承 [v32](builtin-tool-transport-v32.md) 的操作能力、IPC 2、Envelope 1、receipt 1、Core Router 与幂等规则。Contract／CLI 为 33，Agent Output 为 6，Runtime capability 为 `builtin_cli.transport.v33`。

`camp.list/search/read/message.send` 的规范 operation 改为 `thread.list/search/read/message.send`；旧名继续作为相同端点的输入别名。CLI、字段、回复链与重复别名规则见 [Thread Naming v1](thread-naming-v1.md)。新 help、catalog、schema 和结果只教新名称；Single Chat 目标由当前 Run 解析。Automation 的公开结果只保留 `threadId`，不再复制为 `conversationId`。

重试身份仍按升级前 operation／输入字段表示计算。旧 envelope 先验证原 receipt，再投影拥有的范围字段；不重写原 receipt 或用户正文。原本不允许范围的 send、Single Chat history 等端点继续拒绝范围参数。

Execution Evidence 的 operation projection schema 为 4，沿用原始 input/result digest binding。仅在原摘要校验成功后将已知名称投影为 Thread。历史 v1–v3 证据保留原版，测量读取须先验原 projection digest，再按字段所有权解释新旧名称。

本次工具目录版本变化不触发 Native Binding 轮换，尤其 Antigravity 的 binding digest 继续引用升级前兼容目录。live catalog 和新 Run 使用当前版本。
