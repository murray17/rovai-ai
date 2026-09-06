---
document_type: version-decisions
version: v1.53
lifecycle: historical
last_updated: 2026-09-06
---

# v1.53 决定

<a id="v1-53-d01"></a>
## V1.53-D01：自动公屏只接受 Adapter 确认的原生生图来源

### 背景

Runtime 图片链原先把所有已适配的结构化 image result 都视为可展示 supplement。该边界能避免从文本或目录猜图，
却仍会把截图和读图结果带进 Camp 公屏：例如 Codex `mcp__cua_repl/js` 返回的屏幕截图会被保存并随 Run 的最后
公开消息显示。图片确实是结构化结果，并不等于它是 Agent 希望公开呈现的生成作品。

### 决定

继续保留结构化图片观察与底层存储，但把自动展示资格改为 Adapter 在原生事件验证时写入的闭集来源：Codex
`item/completed` 的 `imageGeneration`，以及精确 conversation/step 关联、类型为 generate-image 且状态为 done 的
Antigravity `generateImage.generatedMedia`。Core 持久化 nullable `public_display_source`，Camp 图片 metadata 查询只
投影这两个值。字段缺失、历史行和所有其他 Adapter 图片都按未确认处理。

显式 CampMessage 图片附件不经过该字段。过滤只改变公屏集合，不删除 Runtime 图片行、Blob 或稳定原文件引用，
也不阻断 Runtime 使用截图、读图和工具结果。

### 后果与被拒绝方案

- 实时、刷新、重开、消息合并和终态独立兜底在 Core 查询处共享同一 fail-closed 结果；Renderer 不需要第二套判断。
- 历史来源无法可靠恢复，保持 `NULL` 和隐藏；未来若接入第三方生图，必须先增加 Adapter 原生事件证明与闭集版本。
- 拒绝按工具显示名（包括 `generate_image`）准入：名称可由第三方任意选择，不能证明结果语义。
- 拒绝按文件名、目录、扩展名、MIME 或图片内容猜测：这些只描述载体，不能证明生成来源。
- 拒绝停止解析或删除截图/读图记录：本次范围是展示投影，保留底层数据避免改变 Runtime 工具链和历史生命周期。
- 拒绝只在 Renderer 隐藏：它会让 Snapshot/Open、实时更新与无消息兜底产生分叉，并把来源权威泄漏到 UI。

当前规范见 [Runtime Images v5](../../contracts/runtime-images-v5.md)、
[Camp Open Projection v16](../../contracts/camp-open-projection-v16.md)与
[Runtime 图片架构](../../architecture/runtime-images.md)。
