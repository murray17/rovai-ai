---
document_type: version-overview
version: v0.25
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-07-31
---

# Rovai-ai v0.25 Attachment Composer

> 状态：生产实现与验收完成
>
> 前置版本：[v0.24 Arctic Dawn V3](../v0.24/README.md)
>
> 跨版本决策：[ADR-0080](decisions.md#adr-0080) ·
> [ADR-0081](decisions.md#adr-0081)
>
> 生产设计：[production-design.md](production-design.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

在现有 Arctic Dawn Camp Composer 中加入无需文件选择器的附件能力：用户可以粘贴
文件或截图、把普通文件拖入 Composer、跨导航和重启恢复完整 Draft，并把正文和全部
附件作为一个原子公共消息发送。消息附件使用稳定 Camp 公共路径，所有 Agent Runtime
通过冻结上下文获得路径并使用自身文件工具读取。

## 已确认范围

- 只支持粘贴与拖拽，不增加回形针或系统文件选择器。
- 纯文本粘贴保持普通输入；只有剪贴板含文件时才接管 Paste。
- 允许任何满足限制的普通文件；目录、symlink 和非普通文件拒绝。
- 只对安全栅格图生成 Renderer 预览；其他文件显示通用卡片。
- 不允许纯附件消息；正文必须非空。
- 一条消息不部分发送附件；任一准备中或错误项都会阻止发送。
- Draft 保存正文和有序附件，跨 Camp 导航及应用重启恢复。
- 附件是 Camp 公共资源，不随 `@` 寻址缩小可见性。
- 每个附件只有一个稳定应用受管路径；没有 Run Attachment Projection。
- AgentRun 只从自己的冻结消息边界发现附件路径。
- 不新增 Agent 附件读取工具；Runtime 直接读取上下文提供的路径。

## 非目标

- 音视频播放、PDF 内嵌、Office 预览或代码高亮。
- 上传到云端、跨设备同步或外部分享链接。
- Agent 在本版本中主动向公共消息附加新文件。
- 附件重命名、重排、批量下载或版本历史。
- 最终 Night 视觉；本版本继续使用 Arctic Dawn Day。

## 完成定义

实现、Migration、Core/Renderer 测试、Typecheck、桌面构建、macOS 打包 App 与真实
Runtime 验收均已通过。详细证据见[实施与验收](implementation-plan.md)。
