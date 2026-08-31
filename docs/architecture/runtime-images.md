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

同一 Run 已通过消息发送的可用图片附件，若其已有 SHA-256 与 Runtime Blob 相同，读取投影仅保留
附件展示，底层两份记录不删除。匹配只读已有 SQLite 元数据，不扫描文件；可变的稳定路径不参与。
两种图片共用消息内容列与图片组件，预览框贴合原比例，不跟随正文长短收缩，不裁图或填充黑边。

显式文件发送继续由 `rovai send --file` 创建不可变 Camp Attachment，再由既有飞书 Outbox/Host 上传。
图片观察不会调用这条发布链，也不增加 CampMessage 或 AgentRun。飞书原生消息和附件可独立重试；
这次不扩展钉钉附件、登录、发布或 Stream 行为。

接口与限额见 [Runtime Images v3](../contracts/runtime-images-v3.md)、投影见
[Camp Open Projection v13](../contracts/camp-open-projection-v13.md)、展示见
[Camp 会话工作区](../ui/components/conversation-workspace.md#runtime-图片与消息图片)。混合保存的理由见
[V1.37-D01](../versions/v1.37/decisions.md#v1-37-d01)。
