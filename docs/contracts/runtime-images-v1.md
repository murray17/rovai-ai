---
document_type: contract
contract: runtime-images
version: v1
status: accepted
source_version: v1.37
last_updated: 2026-08-31
---

# Runtime Images v1

## 来源与隔离

AgentRunImage 是本机 Run supplement，不是 CampMessage、Attachment 或模型 Context。仅从已适配 Runtime
的结构化图片结果进入，不扫描目录，不解析正文、Markdown、Shell 输出、locations 或任意 rawOutput 中的路径。
也不触发 `camp.message.send`、ChannelDelivery、A2A、Owner attention 或飞书上传。
Codex 原生图片 result 不进入公开 Tool output；MCP 混合图片结果只保留有序 text blocks，不把完整
Tool Result 的图片 bytes/path 复制进 Evidence。该过滤也适用于开始及中断活动；旧 Evidence 不重写。

- ACP：`session/update` 的 `tool_call/tool_call_update.content[].content`，wrapper 与内层类型分别为
  `content`、`image`。按当前 Prompt/toolCallId 有界累积，合并去重，`completed/failed` 取出并清理；
  终态未携带 content 仍保留此前图片，初始 tool_call 已终态也可接受。
- Claude：已验证 Session 的 `user.message.content[].tool_result` 内 `image.source.type=base64`，
  使用 `tool_use_id`，不按工具名判断图片。重放终态不重复写入。
- Codex：当前 route 的 `item/completed`，`mcpToolCall.result.content[]` 的 image block；
  原生 `imageGeneration.result` 为 PNG base64，`savedPath` 是可选元数据。不得扫描 generated_images。
- Cursor 非标准通知和 Antigravity generate_image 需独立真实终态 fixture 才增加字段适配；未确认字段不猜测。
  Cursor 标准 ACP 路径继承上述规则，不改变 Runtime 的平台准入状态。

来源 wire 依据 [ACP v1 Tool Calls](https://agentclientprotocol.com/protocol/v1/tool-calls)、
[Codex ThreadItem](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/item.rs)、
[Codex ImageGenerationItem](https://github.com/openai/codex/blob/main/codex-rs/ext/items/src/image_generation.rs)。
协议/单测 fixture 不代表十三 Runtime 的真实图片 smoke 全部通过。

## 保存与读取

1. inline bytes 存入现有 ManagedBlob；同时有 path 也不丢弃 bytes。
2. 只有稳定路径时只保存绝对路径引用；不复制，文件改变后读取当前内容，删除后不可用。
3. 只有当前 Run 的精确 `ROVAI_RUN_TMP` 路径时，在 lease unbind/清理前读取一次保存 Blob。
   canonicalize 仅用于临时生命周期识别（含链接、系统路径别名），不是授权范围判断。

相对路径按冻结 executionRoot 解析；允许目录外路径及符号链接。读取前及打开后确认目标为普通文件，
有界读取；不添加 root grant、目录范围限制、符号链接拒绝、安全目录或 File Preview handle。
Core 将结构化 MIME/扩展名作为读取提示，缺失时使用二进制类型而不拒绝路径；最终展示前由 Chromium
`HTMLImageElement.decode()` 真实解码，不能只信 MIME。
PNG/JPEG/WebP/GIF/AVIF/SVG/BMP/ICO 交给现有浏览器解码能力，不增加独立 codec 依赖。
失败局部显示“图片已不可用”，不影响 AgentRun、其他图片或会话。

单张最多 20 MiB，单 Run 最多 20 张/100 MiB；超限不入库。ACP accumulator 同样有界。
重放键为 `(agentRunId, executionEpoch, toolCallId, bytes摘要或路径)`；不跨不同 tool call 或消息附件做语义去重。
只接收 current epoch、running/waiting 且未取消的 Run；既有 host/session/prompt fence 保留。

## 持久和接口

Migration 133 从精确 Data Contract `v1.42 / schema 83` 新增 `agent_run_image`，封闭 `v1.43 / schema 84`。
不搬移或重写既有业务行；DDL、marker、receipt 在同一事务。表保存 opaque id、Run/epoch/toolCallId、sourceKey、
`sourcePath XOR contentBlobId`、displayName、mediaType、byteSize、ordinal、createdAt。sourcePath 不进入 Renderer 元数据。
Run 删除级联删除图片行；Blob 是 GC root，删除行后才能回收 Blob，绝不删除被引用的稳定原文件。

Snapshot/Open 追加可选 `agentRunImages`，缺失视为 `[]`；按 Run/epoch 分组，每组为
`{agentRunId,executionEpoch,createdAt,images:[{id,displayName,mediaType,byteSize}]}`。
读取仅连接 SQLite 元数据，不打开文件。写入后 `agent_run.images.updated` 通知当前 Camp 刷新，不产生 domain event。

`agentRunImages.read({campId,imageId})` 通过 image→Run→Turn 校验所属 Camp，返回
`{mediaType,data}`（base64）或 `null`（不存在、跨 Camp、无法读取）。只读，不接受 Renderer 任意路径；
无有效解码结果时 UI 不展示传回内容。bytes/path 只走内部图片链，不进入 Execution Evidence、日志或渠道 Outbox。

## 展示

正文和有序消息附件之后展示该 Run 图片，再展示 Files Changed。锚定来源 Run 的最后公开消息；无公开消息
则作为独立 supplement，仍在同 Run 的 Files Changed 前。多 Run 独立，不靠图片与文件变化的时间戳猜顺序。
共享 Gallery/Tile/lightbox；一张单列、多张双列、窄容器单列，contain，展示全部已准入图片。
只把连续消息图片合为一组，不跨非图片附件重排。Runtime 图只有看大图；消息附件保留系统打开/显示所在位置，
解码失败仍可系统打开。图片与显式附件重复出现是允许的，二者语义不同。
