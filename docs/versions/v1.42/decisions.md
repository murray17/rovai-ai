---
document_type: version-decisions
version: v1.42
lifecycle: current
last_updated: 2026-09-04
---

# v1.42 决定

<a id="v1-42-d01"></a>
## V1.42-D01：只有显式 Markdown link 承担消息文件导航语义

### 背景

V1.39-D05 为整体 inline-code 增加存在性探测，试图只把真实文件显示为链接。但 inline-code 原本表达代码样式，
不是作者明确的导航意图；为推断这一意图，Renderer、Preload、Main 与 Core 增加了一条渲染期 IPC 和磁盘访问链。
消息只要包含绝对路径就可能在展示期间触碰系统目录权限，而且“文件存在”仍不能证明作者希望它可点击。

继续探测可以减少死链接，却要用权限提示、渲染时 I/O、额外协议和状态竞态交换；只认已知扩展名则会再次把
视觉类型误当导航资格。Markdown link 已经提供无歧义且可由作者控制的入口语义。

### 决定

只有显式 Markdown link 可以产生消息资源入口。本地 target 显示共享资源图标，HTTPS target 显示网页图标；
inline-code、代码块和普通正文永远不扫描、不查询磁盘、不生成文件链接。删除 V1.39-D05 引入的 typed
Preload/Main 存在性探测 wire，Core 的 `message_reference` 来源校验也只接受 exact Message 中的显式本地
Markdown destination。

共享资源类型继续统一显式消息文件链接和普通 Preview Tab 的 `ResourceVisualKind`，未知类型使用通用文件图标；
它不参与消息引用识别。用户点击显式文件链接后，仍由 Main 既有 classifier 根据路径、扩展名、大小、MIME、
内容与平台能力决定 Preview、系统应用或失败，不支持预览的文件不创建 Tab。当前边界由
[File Preview v6](../../contracts/file-preview-v6.md)、[File Preview Architecture](../../architecture/file-preview.md)和
[Camp 文件预览区](../../ui/components/file-preview.md)拥有。

### 后果与被拒绝方案

- 消息展示不再访问磁盘，路径不存在与否只在明确点击后反馈；作者可通过显式链接表达导航意图。
- 旧消息中的 inline-code 文件名恢复为普通代码样式，不再具有点击行为；这是有意的语义收敛。
- 拒绝保留“仅相对路径探测”或“仅已知扩展名自动链接”：两者仍会让代码样式隐式承担导航语义，并产生两套规则。
- 拒绝在 Renderer 直接 `stat` 或缓存存在性：它越过进程权威，也无法消除展示与点击之间的文件竞态。
