---
document_type: protocol-contract
contract: host-web-v10
status: accepted
version: 10
source_version: v1.72
last_updated: 2026-11-07
---

# Host Web v10

继承 [v9](host-web-v9.md)。本版将 Host Web `protocolVersion` 从 5 升为 6，
在认证准入处拒绝旧客户端读写新增的封闭消息段；既有会话、鉴权及命令回执语义保持。

新增认证用户操作 `projectFileReferences.resolve`，最大 32 项，使用目标 Thread 的有效根确认或重新签发引用，
不接受客户端绝对路径。Desktop 与 Web 使用同一 Host 实现。`app.info.composerProjectFileReferenceVersion:1`
声明 Composer 文件变体能力；缺少能力时关闭选择入口并阻止文件文档写入，保留已有草稿。

请求／响应、根边界及恢复规则见 [Project File Reference v1](project-file-reference-v1.md)。
完整输入 shape、预算和不变版本轴见[已确认 R1](../versions/v1.72/model-context-change-project-file-reference.md)。
