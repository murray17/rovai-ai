---
document_type: version-decisions
version: v1.20
lifecycle: current
last_updated: 2026-08-20
---

# v1.20 决策记录

本文件只解释 v1.20 的本机附件打开边界；当前字段和行为由 Architecture、Contracts 与 UI 直接拥有。

<a id="v1-20-d01"></a>

## V1.20-D01：用户打开以 Authority Attachment 为来源，并由 Core 授权、Desktop Main 执行

### 背景

Timeline 已经展示 Published Attachment，但普通文件和目录没有桌面主动作。Renderer 若直接接收 path 并调用
Shell，会把任意本地路径变成可伪造输入；改用 `.rovai` Runtime View 又会把用户打开错误绑定到 Agent
publication/recovery 状态，并让派生投影成为第二来源。仅凭扩展名在 Renderer 判断风险同样无法证明目标身份。

### 决定

Renderer 只提交 canonical Camp ID 与 Attachment ID。Core 只解析同 Camp 的 `message_attachment`，重验精确
Authority 路径、节点、receipt 和 no-follow identity，并返回仅供 Desktop Main 使用的 path 与 Core-owned
`normal | confirm` 风险结论。Desktop Main 独占系统确认、`shell.openPath` 和 `shell.showItemInFolder`。
Renderer 只接收 `opened/revealed` 与稳定错误码，不接收 path 或原始 OS/Core error。

图片预览和用户打开只依赖已提交 Authority Attachment 的当前完整性；Runtime projection state 继续只表达
Agent 可读性。Prepared Attachment 不进入这条 Timeline API。

### 后果

- 普通文件、目录和图片退化路径获得平台原生行为，且不能把任意 Renderer 字符串提升为本地 Shell target；
- Runtime View pending、failed 或 controlled rebuild 不会阻止用户访问仍完整的 Authority 附件；
- 每次动作会执行有界 Authority 完整性校验；大目录打开可能有可见等待，但不会以未验证路径换取即时响应；
- 系统默认应用能否打开只作为 Desktop 动作结果，不表示内容安全、安装成功或 Runtime 可读。

### 被拒绝方案

- Renderer 传绝对路径或接收 Core path：扩大 XSS/Renderer compromise 的本地文件能力；
- `shell.openExternal(file://...)`：把本地文件错误混入外部 URL 语义；
- 使用 Runtime View：把用户文件访问绑定到派生投影可用性，并打开错误权威；
- 只按扩展名在 Renderer 确认：不验证 Camp ownership、真实节点、receipt 或可执行内容；
- 把 `shell.openPath` 原始错误返回 Renderer：错误可能包含 Authority 绝对路径。

### 当前权威影响

- [Camp Attachment v5](../../contracts/camp-attachment-v5.md)
- [Camp Published Attachment View](../../architecture/camp-published-attachment-view.md)
- [当前基础架构不变量](../../architecture/foundational-invariants.md#camp-resources)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
