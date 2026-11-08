---
document_type: protocol-contract
contract: host-web-v11
status: accepted
version: 11
source_version: v1.72
last_updated: 2026-11-08
---

# Host Web v11

继承 [v10](host-web-v10.md)。

本版 protocolVersion 6 → 7。app.info.composerProjectFileReferenceVersion 为 2，包含目录类型；旧 Web 在认证时拒绝。
projectFiles.open 与 projectFileReferences.resolve 的条目类型、根校验、恢复和正式发布遵守 [Project File Reference v2](project-file-reference-v2.md)。
Desktop 配套 Host，旧 Core 被 schema 172 准入阻止。其他权限、Session 和传输行为沿用 v10。
