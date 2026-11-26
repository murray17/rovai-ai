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

## 公屏消息图片预览

同一已认证客户端可复用按 Thread、正式消息和附件标识绑定的内存预览。输入框已显示的原图在
发送回执确认公开消息后交给公屏与回复详情，队员投递可以仍在等待。渠道用户图片在首次授权读取后
也可复用。命中时，切回会话、重新聚焦和打开大图均直接使用已显示的内容，源文件的后续变化在下次读取时体现。

缓存未命中、新客户端或页面重载时，缩略图遵循 [v2 的来源核验](host-web-v2.md)。
Host 按当前凭据核对精确附件归属、可用性、大小和内容版本；匹配已确认上传时可使用客户端保留的 File。
认证作用域结束时释放展示缓存。下载原件始终经过[来源下载授权](host-web-v7.md)，预览不授予下载能力。
