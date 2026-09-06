---
document_type: protocol-contract
contract: camp-open-projection-v16
authority: camp-open-native-generation-image-projection
status: accepted
version: 16
source_version: v1.53
last_updated: 2026-09-06
---

# Camp Open Projection v16

v16 inherits [v15](camp-open-projection-v15.md) 的消息、附件、历史窗口、读取无文件系统副作用及全部 wire
shape，只收紧 `agentRunImages` 的集合语义。

Core 仅投影 `public_display_source` 为 `codex_native_image_generation` 或
`antigravity_native_generate_image` 的 Runtime 图片。来源为空或未知的当前及历史图片不进入
`agentRunImages`；它们仍可保留在底层存储。工具名称、路径、格式或 MIME 不能替代 Adapter 已确认的来源。
精确来源准入由 [Runtime Images v5](runtime-images-v5.md) 定义。

Snapshot、Open、实时失效刷新、重新打开和无公开消息时的终态兜底都读取同一个 Core metadata 集合，
Renderer 不补做来源猜测。过滤发生在消息图片区和独立兜底节点组装之前；显式 CampMessage 图片附件不属于
`agentRunImages`，行为不变。

Open schema 6、Snapshot 34、Navigation 3、`agentRunImages` metadata shape 与
`agentRunImages.read({campId,imageId})` wire 均不变；`public_display_source` 不向 Renderer 暴露。

## References

- [Runtime Images v5](runtime-images-v5.md)
- [Camp Attachment v8](camp-attachment-v8.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
