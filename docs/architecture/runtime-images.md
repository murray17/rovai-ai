---
document_type: architecture
authority: runtime-image-boundaries
last_updated: 2026-09-01
---

# Runtime 图片

Runtime Adapter 在原始结果被摘要化前提取结构化图片；ACP 以当前 Prompt 内 toolCallId 暂存增量，
工具终态进入 Core。Core 沿用 Run epoch/session fence，保存独立 AgentRunImage：inline 与 Run 临时图片
使用 ManagedBlob，稳定路径直接引用。内部观察事件在进入 Execution Evidence 前被消费，不能公开原始 bytes/path。

TRAE 与 Copilot 的专用图片结果在各自 Adapter 下显式提取，再交给同一 ACP accumulator；不增加全局
rawOutput 路径猜测。Antigravity 的 stream-json 完成事件不携带图片结果，因此仅在 generate_image 完成时，
由该 CLI 子进程专属启动日志取得本机 HTTP 端口，读取精确 conversation/step 的结构化 generatedMedia。
固定 loopback、只读、两秒有界，无账号凭据或新进程；查询失败略过图片，不阻止 Run 结算。
不读 transcript 正文，不扫描 brain、workspace 或 generated_images。真实 wire 与验收边界见
[v1.37 图片验收](../versions/v1.37/runtime-image-acceptance.md)。

Camp Snapshot/Open 只查询图片元数据，Main 转发 opaque id 的 Camp-scoped 读取；共享 Gallery 在实际显示前
用浏览器 decoder 验证内容，失败仅该图不可用。没有文件预览面板、Root Grant、文件复制框架或第二套权限 UI。
文件路径允许目录外位置和符号链接；普通文件及真实图片解码是读取链的必要检查。

Renderer 在当前进程内以实际 Blob 大小维护 128 MiB 的已解码 payload 缓存，Object URL 仍由每个 Tile
独立创建和释放。消息附件命中缓存后不再读取；任意 Runtime 图片命中后先使用缓存内容，再后台复用同一
进行中 Promise 调用既有 Camp-scoped 接口，不区分稳定路径和 ManagedBlob。请求异常保留旧图，正常返回
不可用或新内容解码失败则清除缓存；成功候选解码后无空白替换。该缓存不持久化，也不保证 Chromium
保留内部解码结果。

Renderer 在来源 Run 尚未公开发言且未终态时保留图片等待，不把无作者图片提前混入其他队员消息；
公开消息出现后把图片并入该 Run 最后一条公开 Agent 消息的图片区，只有终态仍无公开消息时才释放独立兜底。

同一 Run 已通过消息发送的可用图片附件，若其已有 SHA-256 与 Runtime Blob 相同，读取投影仅保留
附件展示，底层两份记录不删除。匹配只读已有 SQLite 元数据，不扫描文件；可变的稳定路径不参与。
显式图片附件和 Runtime 图片继续共用读取、decoder、cache、Tile 与 Lightbox owner。Agent variant 把两种来源
合进正文后的同一图片区，按原比例和 160–240px 响应式单元呈现；用户消息 variant 在正文前使用 72px 方形
缩略图，只有缩略图允许 `cover`。图片与普通文件先稳定分区并保持各自内部顺序，永不混排在同一内容行。

显式文件发送继续由 `rovai send --file` 创建不可变 Camp Attachment，再由既有飞书 Outbox/Host 上传。
图片观察不会调用这条发布链，也不增加 CampMessage 或 AgentRun。飞书原生消息和附件可独立重试；
这次不扩展钉钉附件、登录、发布或 Stream 行为。

接口与限额见 [Runtime Images v4](../contracts/runtime-images-v4.md)、投影见
[Camp Open Projection v14](../contracts/camp-open-projection-v14.md)、展示见
[Camp 会话工作区](../ui/components/conversation-workspace.md#runtime-图片与消息图片)。混合保存的理由见
[V1.37-D01](../versions/v1.37/decisions.md#v1-37-d01)。
