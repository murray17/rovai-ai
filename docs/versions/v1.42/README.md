---
document_type: version-overview
version: v1.42
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-04
---

# Rovai-ai v1.42：显式文件入口与紧凑资源呈现

前置：[v1.41](../v1.41/README.md)。本版本收敛消息中的文件导航语义：只有作者明确写出的 Markdown
链接产生资源入口，inline-code 始终只是代码样式；同时按已确认交互稿统一 Markdown／代码资源图标，
并限制用户附件文件卡的最大长度。

## 范围与当前状态

- `SafeMarkdown` 只转换 Markdown `link` 节点。inline-code、代码块和普通正文不扫描、不访问磁盘，
  也不请求 Main 解析文件存在性。
- 删除渲染期消息文件候选解析的 Renderer Hook、Preload API、IPC、Request/Result 合同与 Main service；
  Core 的 `message_reference` 只授权 exact Message 中的显式本地 Markdown destination。
- 共享资源视觉类型继续服务显式 Markdown 文件链接与普通 Preview Tab；Markdown 使用折角文档与正文线条，
  代码使用占满视觉区的 `</>`，同一文件在两个入口复用同一 Glyph。
- Main 既有 Preview／系统应用 classifier、owner-scoped Attachment 打开和失败结果不变；不支持预览的文件
  仍不创建 Preview Tab。
- 用户发送区和会话时间线的文件附件卡最大宽度统一为 220px；长基础文件名显示省略号，完整名称继续由
  `title` 和操作按钮可访问名称提供。Agent 交付卡、图片附件和打开行为不变。

## 数据合同

本版本没有 SQLite Migration，也不改变 Camp Message、Attachment 或 File Preview 打开请求。`File Preview v6`
删除 v4 的渲染期存在性探测 wire；显式链接点击继续使用既有 `message_reference`。资源图标和卡片宽度只改变
Renderer 呈现，不进入持久化或模型输入。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.41 按已完成事实冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.42 |
| Decisions | 已更新 | [V1.42-D01](decisions.md#v1-42-d01)记录只有显式 Markdown link 承担导航语义并删除渲染期磁盘探测的取舍；CURRENT 已纳入导航 |
| Contracts | 已更新 | [File Preview v6](../../contracts/file-preview-v6.md)删除 message-reference probing wire，同时继承 v5 owner-scoped Attachment 与既有打开分类 |
| Architecture | 已更新 | [File Preview](../../architecture/file-preview.md)明确 Renderer 只处理 Markdown link，Core/Main 只在点击后进入既有来源和文件分类链 |
| UI | 已更新 | [Camp 文件预览区](../../ui/components/file-preview.md)拥有两枚共享 Glyph，[Camp 会话工作区](../../ui/components/conversation-workspace.md)拥有 220px 用户文件卡上限与完整名称可访问性 |
| Runtime Activity | 确认无需更新 | 不改变 AgentRun、Canonical Activity、Evidence 或展示映射 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Runtime Adapter、协议、模型、版本或平台准入 |
| Documentation routing | 已更新 | 文档总导航、Contracts/Architecture/UI 索引和当前决定导航均指向 File Preview v6 与 current v1.42 |
| Root README | 确认无需更新 | 项目定位、安装方法和公开 Runtime 支持范围不因消息链接语义或局部资源呈现改变 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [File Preview v6](../../contracts/file-preview-v6.md)
- [File Preview Architecture](../../architecture/file-preview.md)
- [Camp 文件预览区](../../ui/components/file-preview.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
