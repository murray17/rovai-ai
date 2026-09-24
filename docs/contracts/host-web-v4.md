---
document_type: protocol-contract
contract: host-web-v4
authority: shared-host-web-transport
status: accepted
version: 4
source_version: v1.67
last_updated: 2026-09-23
---

# Host Web v4

继承 [v3](host-web-v3.md) 的认证、编辑器归属、allowlist、回执、超时和共享页面边界。
Task create/read/update 采用 [Durable Task v5](durable-task-v5.md)：Task read model 没有
`version`，update 输入没有 `expectedVersion`，旧字段由闭合输入拒绝。字段补丁由 Core 在事务中
应用，Web 不代填版本。其他对象的版本规则不变。

登录、票据兑换、Session identity 与 capabilities 的 `protocolVersion` 轮换为 4；新客户端与
Host 拒绝旧版本 Session。旧 Task payload 不进行 reconcile 兼容解码或自动重播。命令 ID 幂等、
`recorded`/`unknown`、用户草稿与恢复行为保持 v3 的非 Task 语义。
